import * as THREE from 'three';
import { RAIDS, BELT } from '../data/economy.js';
import { RACES } from '../data/races.js';

/**
 * RABUSIE: reżyser nalotów na kopalnie (krok 10).
 *
 * ZAGROŻENIE. Każdy układ z choć jedną gotową stacją ma licznik zagrożenia,
 * który rośnie z tym, co widać z daleka: liczbą dronów i obrotem stacji
 * przeładunkowej (RAIDS w shared/data/economy.js). Po nalocie jest przerwa
 * (cooldown). Zapisuje się razem z gospodarką (economy.state.raids).
 *
 * NALOT W UKŁADZIE GRACZA - trzy fazy:
 *   warning  15 s ostrzeżenia: alarm, roje z ewakuacją wracają do doków,
 *   active   rabusie wychodzą z fałdy na skraju pasa. To zwykłe wrogie NPC z
 *            mózgiem z tactical-ai.js, tylko z priorytetem celów "drony >
 *            stacje > gracz" (prio). Walczą, robią uniki, odskakują ranni,
 *            biją tego, kto bije ich. Gracz, wataha i platformy obronne
 *            (economy.js) się bronią. Rabusie odlatują, gdy mają dość łupu
 *            (RAIDS.lootDrones / lootTons) albo po RAIDS.maxTime,
 *   koniec   gdy nikt z nich nie został: raport i nagroda kupców za każdego
 *            zestrzelonego (RAIDS.bounty).
 *
 * NALOT W INNYM UKŁADZIE (albo gracz odleciał w trakcie) rozstrzyga się
 * zaocznie: economy.resolveRaidOffline (platformy vs rabusie, straty dronów,
 * zrabowany metal) - kwatermistrz raportuje wynik.
 *
 * W trakcie misji (canRaid() = false) nalot czeka - misje mają swój balans.
 *
 * KROK 11: napastnikiem może być też RASA w stanie wojny z graczem
 * (strategy.js -> launch({ sysId, raceId, n, target, onEnd })). Taki atak
 * omija licznik zagrożenia, wchodzi okrętami wojennymi tej rasy (mocniejsze
 * kadłuby, stronnictwo rządzące), a wynik wraca do strategii (onEnd: straty
 * rasy, łup). Piraci zostają, ale rzadsi (pirateScale).
 */

const CALLSIGNS = ['Hiena', 'Szakal', 'Sęp', 'Kruk', 'Łasica', 'Szczur', 'Pijawka', 'Ćma'];

export function createRaids({
  economy, npcs, onEvent = () => {}, rng = Math.random,
  canRaid = () => true, systemName = (id) => id, playerRaceId = () => null,
  pirateScale = 1, // krok 11: piraci rzadziej, bo zagrożeniem są głównie rasy
}) {
  let raid = null;
  const pending = []; // ataki ras czekające, aż skończy się bieżący nalot
  let squadSeq = 0;
  // odlot przez fałdę (npcs.remove) zdejmuje statek z listy, ale nie gasi `alive`
  const present = (n) => n.alive && npcs.list.includes(n);
  const say = (key, text, urgency = 'danger', ttl) => onEvent({ key, text, urgency, ttl });

  npcs.on('killed', (npc) => {
    if (raid?.raiders.includes(npc)) raid.kills++;
  });
  economy.hooks.droneLost = () => { if (raid?.phase === 'active') raid.dronesLost++; };
  economy.hooks.stolen = (t) => { if (raid?.phase === 'active') raid.stolen += t; };

  const slot = (id) => (economy.state.raids[id] ??= { threat: 0, cooldown: RAIDS.cooldown * 0.5 });
  const droneCount = (id) => economy.swarmsIn(id).reduce((a, w) => a + w.drones, 0);
  const hasBase = (id) => economy.stationsIn(id).some((s) => s.status === 'gotowa');

  function raiderCount(id) {
    const n = RAIDS.minRaiders + Math.floor(droneCount(id) / 12) + Math.floor(economy.state.stats.raids / 2);
    return Math.max(RAIDS.minRaiders, Math.min(RAIDS.maxRaiders, n));
  }

  /** Środek tego, co warto obrabować: gotowe stacje, a bez nich pas. */
  function lootCenter(id) {
    const sts = economy.stationsIn(id).filter((s) => s.status === 'gotowa');
    if (!sts.length) { const c = economy.beltCenter(id); return new THREE.Vector3(c.x, c.y, c.z); }
    const c = new THREE.Vector3();
    for (const s of sts) c.add(new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z));
    return c.multiplyScalar(1 / sts.length);
  }

  function startWarning(id, attacker = null) {
    raid = {
      sysId: id, phase: 'warning', t: RAIDS.warning, raiders: [], kills: 0, dronesLost: 0, stolen: 0, leaving: false,
      n: attacker?.n ?? raiderCount(id), attacker,
    };
    economy.setAlert(true);
    const who = attacker ? `${raid.n} okręty wojenne rasy ${RACES[attacker.raceId].name}` : `${raid.n} rabusiów`;
    say('raid-warn', `Sygnatury fałdy na skraju pasa: ${who} za ${RAIDS.warning} s! Roje z ewakuacją wracają do doków.`, 'danger', 9000);
  }
  const label = () => (raid.attacker ? 'napastnicy' : 'rabusie');

  /**
   * Krok 11: atak rasy na pole gracza. W układzie gracza - prawdziwa walka
   * (albo w kolejce, gdy trwa inny nalot); gdzie indziej - rozstrzygnięcie
   * zaoczne od razu. spec: { sysId, raceId, n, target: {x,y,z}, defense, onEnd(res) }
   */
  function launch(spec) {
    spec.n = Math.max(1, Math.min(RAIDS.maxRaiders + 2, Math.round(spec.n)));
    if (spec.sysId === economy.systemId) {
      if (!raid && canRaid()) startWarning(spec.sysId, spec);
      else pending.push(spec);
      return;
    }
    const res = economy.resolveRaidOffline(spec.sysId, spec.n, spec.defense ?? 0);
    economy.state.stats.raids++;
    const name = RACES[spec.raceId].name;
    onEvent({
      key: `raid-off-${spec.sysId}`, urgency: res.repelled ? 'info' : 'warning', ttl: 9000,
      text: res.repelled
        ? `${name} zaatakowali twoją kopalnię w układzie ${systemName(spec.sysId)} — obrona odparła atak (zniszczeni: ${res.killed}).`
        : `${name} złupili twoją kopalnię w układzie ${systemName(spec.sysId)}: stracono ${res.dronesLost} dronów, zrabowano ${Math.round(res.stolen)} t.`,
    });
    spec.onEnd?.({ kills: res.killed, n: spec.n, dronesLost: res.dronesLost, stolen: res.stolen, offline: true });
  }

  function spawnRaiders() {
    const id = raid.sysId;
    const c = economy.beltCenter(id);
    const belt = new THREE.Vector3(c.x, c.y, c.z);
    const target = raid.attacker?.target ? new THREE.Vector3(raid.attacker.target.x, raid.attacker.target.y, raid.attacker.target.z) : lootCenter(id);
    // wejście z fałdy po drugiej stronie pasa niż stacje - najpierw przelatują nad kopalnią
    const dir = belt.clone().sub(target);
    if (dir.lengthSq() < 1) dir.set(rng() - 0.5, 0, rng() - 0.5);
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (rng() - 0.5) * 1.2);
    const entry = belt.clone().addScaledVector(dir, BELT.radius + 1200);
    const facing = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(entry, target, new THREE.Vector3(0, 1, 0)));
    const races = Object.keys(RACES).filter((r) => r !== playerRaceId());
    const raceId = raid.attacker?.raceId ?? races[Math.floor(rng() * races.length)];
    const war = !!raid.attacker;
    const squad = `raid-${++squadSeq}`;
    const prio = (ct) => (ct.kind === 'drone' ? 3 : ct.kind === 'station' ? (ct.station.type === 'wieza' ? 1.6 : 2.1) : 1);
    for (let i = 0; i < raid.n; i++) {
      const off = new THREE.Vector3((rng() - 0.5) * 500, (rng() - 0.5) * 200, (rng() - 0.5) * 500);
      const npc = npcs.spawn({
        raceId, factionKey: war ? (raid.attacker.factionKey ?? 'hawk') : 'coalition', side: 'hostile', position: entry.clone().add(off), facing,
        mode: 'tactical', hull: war ? RAIDS.raiderHull * 1.4 : RAIDS.raiderHull, label: war ? `wojna: ${RACES[raceId].name}` : 'rabuś', tag: 'raider',
        callsign: war ? undefined : CALLSIGNS[Math.floor(rng() * CALLSIGNS.length)],
        ai: { base: 'hunt', squad, prio, anchor: target, leash: 9000 },
      });
      raid.raiders.push(npc);
    }
    raid.raceName = RACES[raceId].name;
    raid.faction = RACES[raceId].factions[war ? (raid.attacker.factionKey ?? 'hawk') : 'coalition'];
    raid.phase = 'active';
    raid.t = 0;
    economy.state.stats.raids++;
    say('raid-in', war
      ? `Atak! ${raid.n} okręty rasy ${raid.raceName} (${raid.faction}) wychodzą z fałdy. Celują w drony i stacje.`
      : `Rabusie z fałdy: ${raid.n} statki (${raid.raceName}, ${raid.faction}). Celują w drony i stacje — nagroda kupców ${RAIDS.bounty} kr za każdego.`, 'danger', 9000);
  }

  function endRaid(offlineRest = 0) {
    const id = raid.sysId;
    let text;
    let bounty = raid.attacker ? 0 : raid.kills * RAIDS.bounty; // za okręty wojenne ras kupcy nie płacą
    economy.state.credits += bounty;
    economy.state.stats.bounty += bounty;
    economy.state.stats.raidersKilled += raid.kills;
    if (offlineRest > 0) {
      const res = economy.resolveRaidOffline(id, offlineRest, raid.attacker?.defense ?? 0);
      if (!raid.attacker) bounty += res.bounty;
      raid.kills += res.killed;
      raid.dronesLost += res.dronesLost;
      raid.stolen += res.stolen;
    }
    const losses = `stracone drony: ${raid.dronesLost}, zrabowano ${Math.round(raid.stolen)} t`;
    if (raid.phase === 'warning') economy.state.stats.raids++;
    if (raid.phase === 'warning') text = `Nalot w układzie ${systemName(id)} rozegrał się bez nas: ${losses}.`;
    else if (raid.kills >= raid.n) text = `${raid.attacker ? 'Atak' : 'Nalot'} odparty! Zestrzelono wszystkich (${raid.kills}). ${losses[0].toUpperCase() + losses.slice(1)}.${bounty ? ` Nagroda: +${bounty} kr.` : ''}`;
    else text = `${label()[0].toUpperCase() + label().slice(1)} odlecieli. Zestrzeleni: ${raid.kills}/${raid.n}, ${losses}${bounty ? `. Nagroda: +${bounty} kr` : ''}.`;
    say('raid-end', text, raid.dronesLost + raid.stolen > 0 && raid.kills < raid.n ? 'warning' : 'info', 9000);
    const s = slot(id);
    s.threat = 0;
    s.cooldown = RAIDS.cooldown;
    if (economy.systemId === id) economy.setAlert(false);
    raid.attacker?.onEnd?.({ kills: raid.kills, n: raid.n, dronesLost: raid.dronesLost, stolen: raid.stolen, offline: offlineRest > 0 });
    raid = null;
    economy.save();
  }

  function tickRaid(dt) {
    // gracz opuścił układ: to, co zostało z nalotu, rozstrzyga się zaocznie
    if (economy.systemId !== raid.sysId) {
      const rest = raid.phase === 'warning' ? raid.n : raid.raiders.filter(present).length;
      endRaid(rest);
      return;
    }
    if (raid.phase === 'warning') {
      raid.t -= dt;
      if (raid.t <= 0) spawnRaiders();
      return;
    }
    raid.t += dt;
    const alive = raid.raiders.filter(present);
    if (!alive.length) { endRaid(); return; }
    const sated = raid.dronesLost >= RAIDS.lootDrones || raid.stolen >= RAIDS.lootTons;
    if (!raid.leaving && (sated || raid.t > RAIDS.maxTime)) {
      raid.leaving = true;
      for (const n of alive) npcs.retreat(n);
      const L = label()[0].toUpperCase() + label().slice(1);
      say('raid-leave', sated ? `${L} mają łup i uciekają w fałdę! Ostatnia szansa, żeby ich dopaść.` : `${L} się wycofują.`, 'warning', 6000);
    }
  }

  function update(dt) {
    for (const id of economy.systemIds()) {
      if (!hasBase(id) || raid?.sysId === id) continue;
      const s = slot(id);
      if (s.cooldown > 0) { s.cooldown = Math.max(0, s.cooldown - dt); continue; }
      const income = id === economy.systemId ? economy.summary().income : 0;
      s.threat = Math.min(1, s.threat + dt * pirateScale * (RAIDS.base + droneCount(id) * RAIDS.perDrone + income * RAIDS.perKrMin));
      if (s.threat < 1) continue;
      if (id === economy.systemId) {
        if (!raid && canRaid()) startWarning(id); // inaczej zagrożenie czeka na pełnym (np. do końca misji)
      } else {
        const res = economy.resolveRaidOffline(id, raiderCount(id));
        economy.state.stats.raids++;
        s.threat = 0;
        s.cooldown = RAIDS.cooldown;
        onEvent({
          key: `raid-off-${id}`, urgency: res.repelled ? 'info' : 'warning', ttl: 9000,
          text: res.repelled
            ? `Nalot na kopalnię w układzie ${systemName(id)} odparty przez platformy obronne (+${res.bounty} kr).`
            : `Nalot na kopalnię w układzie ${systemName(id)}: stracono ${res.dronesLost} dronów, zrabowano ${Math.round(res.stolen)} t.${res.killed ? ` Platformy zestrzeliły ${res.killed} (+${res.bounty} kr).` : ''}`,
        });
      }
    }
    if (raid) tickRaid(dt);
    // kolejka ataków ras: następny, gdy skończy się bieżący (albo gracz odleciał - wtedy zaocznie)
    if (!raid && pending.length && canRaid()) {
      const next = pending.shift();
      if (next.sysId === economy.systemId) startWarning(next.sysId, next); else launch(next);
    }
  }

  return {
    update,
    /** Stan dla HUD: null albo { phase, t, n, alive, kills, dronesLost, stolen, leaving } */
    get status() {
      if (!raid) return null;
      return {
        phase: raid.phase, t: raid.t, n: raid.n, kills: raid.kills, dronesLost: raid.dronesLost, attacker: raid.attacker?.raceId ?? null,
        stolen: raid.stolen, leaving: raid.leaving, alive: raid.raiders.filter(present).length,
      };
    },
    /** Zagrożenie bieżącego układu 0..1 (HUD). */
    threat: () => (economy.systemId ? slot(economy.systemId).threat : 0),
    /** Testy / debug: nalot teraz (w bieżącym układzie albo zaocznie w `id`). */
    trigger(id = economy.systemId) { const s = slot(id); s.threat = 1; s.cooldown = 0; },
    launch,
    /** Kto napada: null (piraci) albo id rasy. */
    get attacker() { return raid?.attacker?.raceId ?? null; },
    get raiders() { return raid?.raiders ?? []; },
  };
}
