import * as THREE from 'three';
import { RACES } from '../data/races.js';

/**
 * TRYB WATAHY (krok 9): kilka statków RASY GRACZA leci z nim i poluje w
 * skoordynowany sposób. Skrzydłowi to zwykli NPC z mózgiem tactical-ai.js
 * (baza 'pack', wspólna eskadra 'pack'), więc korzystają z tego samego
 * dowodzenia co wrogowie: żetony natarcia, flanki, odwet, osłona rannego
 * kolegi - tylko po stronie gracza. Gracz jest przewodnikiem stada i wydaje
 * rozkazy:
 *
 *   G  ATAK NA MÓJ CEL   cała wataha na cel namierzony przez gracza (albo
 *                        najbliższy przed dziobem); +1 żeton natarcia
 *   H  KLESZCZE          wataha dzieli się na dwa skrzydła, każde wychodzi
 *                        na przeciwną flankę celu i dopiero stamtąd atakuje
 *   V  OSŁONA            trzymają się przy graczu, biją tych, którzy go biją
 *   B  SZYK              formacja w klin za graczem; strzelają tylko w obronie
 *   (start)  SWOBODNE ŁOWY  dowódca eskadry sam dobiera cele i role
 *
 * Skrzydłowi skaczą z graczem przez fałdę (tryb 'escort' dla followJump -
 * patrz npc-ships.js), a ciężko uszkodzeni wracają pod skrzydło gracza,
 * zamiast ginąć (tactical-ai.js: odwrót/odskok).
 */

export const PACK_ORDERS = {
  free: { name: 'Swobodne łowy', key: '—' },
  focus: { name: 'Atak na mój cel', key: 'G' },
  pincer: { name: 'Kleszcze', key: 'H' },
  cover: { name: 'Osłona', key: 'V' },
  regroup: { name: 'Szyk', key: 'B' },
};

const CALLSIGNS = ['Kieł', 'Szron', 'Basior', 'Wilczyca', 'Popiół'];
// klin za graczem (x - w bok, y - w górę, z - do tyłu), skalowany rozmiarem statku
const SLOTS = [
  new THREE.Vector3(-150, 10, 170), new THREE.Vector3(150, 10, 170),
  new THREE.Vector3(-300, 25, 330), new THREE.Vector3(300, 25, 330), new THREE.Vector3(0, 45, 360),
];

export function createWolfpack({ npcs, tactics, player, playerState, dashboard = null, CREW = null, size = 3 }) {
  let members = [];
  let order = 'free';
  let active = false;
  const SQUAD = 'pack';

  function basis(f, r, u) {
    const q = player.quaternion;
    return player.position.clone()
      .add(new THREE.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(f))
      .add(new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(r))
      .add(new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(u));
  }

  function say(text, urgency = 'info', ttl = 3500) {
    dashboard?.show('pack', { crew: CREW?.tactical ?? { role: 'Wataha', initial: 'W', color: '#4dd6a0' }, text, urgency, ttl });
  }

  function spawn(n = size) {
    dismiss(true);
    active = true;
    order = 'free';
    const raceId = playerState.raceId;
    for (let i = 0; i < n; i++) {
      const slot = SLOTS[i % SLOTS.length];
      const npc = npcs.spawn({
        // tryb 'escort' + mózg: walczy wg tactical-ai.js, a przy skoku gracza
        // followJump (npc-ships.js) zabiera skrzydłowych ze sobą
        raceId, factionKey: 'hawk', side: 'ally', mode: 'escort',
        position: basis(-slot.z - 250, slot.x, slot.y),
        facing: player.quaternion.clone(),
        callsign: CALLSIGNS[i % CALLSIGNS.length], maxSpeed: 700, combatSpeed: 290,
        hull: 190 * (RACES[raceId].ship.hull / 100), role: 'wingman', tag: 'pack',
        ai: { base: 'pack', squad: SQUAD, formation: slot },
      });
      members.push(npc);
    }
    tactics.setOrder(SQUAD, 'free');
    say(`Wataha (${n}) dołącza: ${RACES[raceId].name}. G atak · H kleszcze · V osłona · B szyk.`, 'info', 6000);
    return members;
  }

  /** Odprawa: skrzydłowi odlatują przez fałdę. */
  function dismiss(silent = false) {
    for (const m of members) if (m.alive) npcs.depart(m);
    members = [];
    if (active && !silent) say('Wataha odprawiona.');
    active = false;
  }

  function toggle() { if (active) dismiss(); else spawn(); return active; }

  /**
   * Rozkaz. `target` - kontakt celu (dla 'focus'; gracz podaje namierzony cel).
   */
  function command(kind, target = null) {
    if (!active || !members.some((m) => m.alive)) { say('Brak watahy (L — przyzwij).', 'warning'); return false; }
    if (kind === 'focus' && !target) { say('Brak celu dla watahy.', 'warning'); return false; }
    order = kind;
    tactics.setOrder(SQUAD, kind, target);
    const name = PACK_ORDERS[kind]?.name ?? kind;
    say(kind === 'focus' ? `${name}: ${target.npc?.callsign ?? 'cel'}.` : `${name}.`);
    return true;
  }

  function update() {
    members = members.filter((m) => m.alive);
    // cel rozkazu zniszczony -> wracamy do swobodnych łowów
    const s = tactics.squad(SQUAD);
    if (order === 'focus' && s && !s.orderTarget?.isAlive()) { order = 'free'; tactics.setOrder(SQUAD, 'free'); say('Cel zniszczony. Swobodne łowy.'); }
  }

  return {
    spawn, dismiss, toggle, command, update,
    get active() { return active && members.some((m) => m.alive); },
    get order() { return order; },
    get members() { return members; },
    SQUAD,
  };
}
