import * as THREE from 'three';

/**
 * WARSTWA AUDIO GRY: tłumaczy stan gry na wywołania silnika (audio.js).
 * Osobny moduł, żeby main.js kroku dostał kilka linii, a nie sto.
 *
 * Źródła dźwięku:
 *  - dashboard załogi   -> powiadomienia wg pilności (info / uwaga / zagrożenie),
 *                          z regułami dla kanałów, które mają własny dźwięk
 *  - komunikator        -> "otwarcie kanału" przy każdej nowej wiadomości
 *  - fazy fałdy gracza  -> ładowanie, zanurzenie, tunel, (zatrzaśnięcie z warp-drive)
 *  - stan statku        -> alarm kadłuba < 30%, ostrzeżenie o naprowadzanym pocisku
 *                          (tym szybsze, im bliżej), napęd znów gotowy
 *  - misja              -> start, nowy cel, zaliczona / nieudana
 *  - walka              -> wystrzały, wybuchy, trafienia (z odległością i panoramą)
 *  - muzyka             -> intensywność z liczby wrogów w pobliżu, trafień i pocisków
 */

// Które kanały dashboardu dostają jaki dźwięk. null = cisza (dźwięk gra
// ktoś inny: trafienie gra damagePlayer, koniec misji - przerywnik muzyki).
function dashboardSound(key, urgency, text) {
  if (key === 'hit' || key === 'mission-end' || key === 'race' || key === 'system') return null;
  if (key.startsWith('bark-')) return 'pack-ack';
  if (key === 'mission-start') return 'mission-start';
  if (key === 'm-amb') return 'ambush';
  if (key === 'heat') return urgency === 'danger' ? 'alarm-heat' : 'notify-info';
  if (key === 'lock') return urgency === 'warning' ? 'lock-lost' : /^Namierzono/.test(text) ? 'lock' : 'notify-info';
  if (key === 'warp') return urgency === 'danger' ? 'warp-denied' : urgency === 'warning' ? 'notify-warning' : null;
  return urgency === 'danger' ? 'notify-danger' : urgency === 'warning' ? 'notify-warning' : 'notify-info';
}
const SEVERITY = { info: 0, warning: 1, danger: 2 };

const FIRE_SOUND = { pulse: 'fire-pulse', missile: 'fire-missile', dart: 'fire-dart', salvo: 'fire-salvo', torpedo: 'fire-torpedo' };

/**
 * @param {object} o
 *   audio, camera, ship (Object3D gracza), playerState, playerWarp, npcs, combat,
 *   dashboard, comms, missions, getRadius(), getWarpJam()
 */
export function createGameAudio({
  audio, camera, ship, playerState, playerWarp, npcs, combat, dashboard, comms, missions,
  getRadius = () => 10,
}) {
  const _cam = new THREE.Vector3(), _q = new THREE.Quaternion(), _right = new THREE.Vector3(), _d = new THREE.Vector3();

  /** odległość od statku gracza (słuchacz) i panorama względem kamery */
  function spatial(pos) {
    camera.getWorldPosition(_cam);
    camera.getWorldQuaternion(_q);
    _right.set(1, 0, 0).applyQuaternion(_q);
    _d.copy(pos).sub(_cam);
    const len = _d.length();
    const pan = len > 1 ? (_d.dot(_right) / len) * 0.75 : 0;
    return { distance: pos.distanceTo(ship.position), pan };
  }

  // ------------------------------------------------------------
  // Dashboard: dźwięk tylko przy POJAWIENIU się karty albo wzroście pilności
  // (updateDashboard odświeża te same karty ~10 razy na sekundę)
  // ------------------------------------------------------------
  const shown = new Map(); // key -> { until, sev }
  const origShow = dashboard.show.bind(dashboard);
  dashboard.show = (key, opts) => {
    const now = performance.now();
    const sev = SEVERITY[opts.urgency ?? 'info'] ?? 0;
    const prev = shown.get(key);
    const fresh = !prev || now > prev.until || sev > prev.sev;
    shown.set(key, { until: now + (opts.ttl ?? 1200), sev });
    if (fresh) {
      const name = dashboardSound(key, opts.urgency ?? 'info', opts.text ?? '');
      if (name) audio.play(name);
    }
    return origShow(key, opts);
  };

  // ------------------------------------------------------------
  // Komunikator
  // ------------------------------------------------------------
  for (const m of ['say', 'open']) {
    const orig = comms[m]?.bind(comms);
    if (!orig) continue;
    comms[m] = (o) => {
      // podsumowanie misji ma własny przerywnik muzyczny
      if (!/^MISJA /.test(o?.sender ?? '')) audio.play('comms');
      return orig(o);
    };
  }

  // ------------------------------------------------------------
  // Walka
  // ------------------------------------------------------------
  npcs.on?.('killed', (n) => audio.play('explosion', { ...spatial(n.group.position), size: Math.min(3, 0.6 + (n.radius ?? 20) / 40), force: true }));
  npcs.on?.('hit', ({ npc, shooter }) => {
    // trafienia gracza słychać bliżej (satysfakcja z celnego strzału)
    const s = spatial(npc.group.position);
    audio.play('impact', { ...s, ref: shooter?.isPlayer ? 1600 : 600 });
  });

  function fire(id, origin, side) {
    const name = FIRE_SOUND[id];
    if (!name) return;
    if (side === 'player') audio.play(name, { gain: 0.9, force: id !== 'pulse' });
    else audio.play(name, { ...spatial(origin), gain: 0.8 });
  }
  function blast(kind, pos, size) {
    audio.play(kind === 'implosion' ? 'implosion' : 'blast', { ...spatial(pos), size: size / 40 });
  }
  function playerHit(amount) {
    audio.play('hit', { amount });
  }

  // ------------------------------------------------------------
  // Fałda
  // ------------------------------------------------------------
  let phase = 'idle', chargeH = null, transitH = null, wasCooling = false;
  function stopWarpHolds(fade = 0.2) {
    chargeH?.stop(fade); chargeH = null;
    transitH?.stop(fade); transitH = null;
  }
  function slam(pos, sig) {
    audio.play('warp-slam', { ...spatial(pos), race: sig?.raceId });
  }
  function updateWarp() {
    const p = playerWarp.phase;
    if (p !== phase) {
      const race = playerState.raceId;
      if (p === 'charge') {
        chargeH = audio.play('warp-charge', { race });
        audio.duck(0.6, 1.2);
      } else if (p === 'dive') {
        chargeH?.stop(0.08); chargeH = null;
        audio.play('warp-dive', { race });
        transitH = audio.play('warp-transit', { race });
        audio.duck(0.3, 0.4);
      } else if (p === 'emerge') {
        transitH?.stop(0.7); transitH = null;
      } else if (p === 'idle') {
        stopWarpHolds(0.3);
        audio.duck(1, 1.5);
      }
      phase = p;
    }
    // napęd znów gotowy (koniec chłodzenia) - krótki sygnał, bez karty w dashboardzie
    const cooling = playerWarp.cooldown > 0;
    if (wasCooling && !cooling && playerState.alive) audio.play('warp-ready');
    wasCooling = cooling;
  }

  // ------------------------------------------------------------
  // Misja
  // ------------------------------------------------------------
  let mStatus = 'idle', mObjective = '', mSince = 0;
  function updateMission(dt) {
    const st = missions.state;
    mSince += dt;
    if (st.status !== mStatus) {
      if (st.status === 'success') audio.stinger('success');
      if (st.status === 'fail' && playerState.alive) audio.stinger('fail');
      if (st.status === 'active') mSince = 0;
      mStatus = st.status;
      mObjective = st.objective;
    } else if (st.status === 'active' && st.objective !== mObjective) {
      mObjective = st.objective;
      if (mSince > 1.5) audio.play('objective');
    }
  }

  // ------------------------------------------------------------
  // Alarmy i muzyka
  // ------------------------------------------------------------
  let lastIncoming = null;
  function update(dt) {
    updateWarp();
    updateMission(dt);
    const alive = playerState.alive;

    const lowHull = alive && playerState.hull < playerState.maxHull * 0.3;
    audio.alarm('alarm-hull', lowHull, 2.4);

    lastIncoming = alive && !playerWarp.ghost ? combat.incoming?.(ship.position, getRadius(), 'player', 3) : null;
    const guided = !!(lastIncoming && lastIncoming.guided && lastIncoming.tca < 3);
    audio.alarm('alarm-missile', guided, guided ? Math.max(0.09, Math.min(0.6, 0.06 + lastIncoming.tca * 0.18)) : 1);

    // intensywność walki dla muzyki
    let I = 0;
    if (alive) {
      let near = 0;
      for (const h of npcs.hostiles()) {
        const d = h.group.position.distanceTo(ship.position);
        if (d < 4000) near += d < 1500 ? 1 : 0.5;
      }
      I = Math.min(1, near * 0.22);
      if ((playerState.sinceHit ?? 99) < 5) I = Math.max(I, 0.75);
      if (guided) I = Math.max(I, 0.8);
      if (missions.active) I = Math.max(I, 0.12);
    }
    audio.setIntensity(I);
  }

  function death() {
    stopWarpHolds(0.1);
    audio.play('death');
    audio.stinger('death');
    audio.setMood('aftermath');
  }
  function respawn() {
    audio.setMood('flight');
  }

  audio.setMood('flight');
  return { update, fire, blast, playerHit, slam, death, respawn, spatial };
}
