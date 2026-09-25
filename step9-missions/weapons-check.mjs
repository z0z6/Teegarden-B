// Bezgłowa symulacja zasad walki kroku 9 (combat-rules.js):
//   node step9-missions/weapons-check.mjs
// 1) ile rakiet gracza trafia w cel robiący uniki - na każdym poziomie trudności,
// 2) ile wrogich rakiet trafia gracza, gdy bronią go automatyczne flary,
// 3) po ilu sekundach ciągłego ognia przegrzewa się działko.
import * as THREE from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

const { createCombat } = await import('../shared/systems/combat.js');
const { createWeapons, createPlayerArsenal, PLAYER_SHOOTER } = await import('../shared/systems/weapons.js');
const { createFlares } = await import('../shared/systems/flares.js');
const { COMBAT_DIFFICULTY, loadoutFor } = await import('../shared/systems/combat-rules.js');

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
const DT = 1 / 60;

function world(seed) {
  Math.random = mulberry(seed);
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const weapons = createWeapons({ scene, combat, camera: new THREE.PerspectiveCamera() });
  return { scene, combat, weapons, step() { combat.update(DT); weapons.update(DT); } };
}

// cel robiący uniki: 260 j/s, zmienia kierunek co 0,4-1,0 s
function jinker(W, pos) {
  const t = { pos: pos.clone(), vel: new THREE.Vector3(260, 0, 0), timer: 0, hits: 0 };
  t.actor = { side: 'hostile', get position() { return t.pos; }, radius: 14, isAlive: () => true, takeDamage: () => { t.hits++; } };
  W.combat.register(t.actor);
  t.ref = { position: t.pos, velocity: t.vel, isAlive: () => true };
  t.update = () => {
    t.timer -= DT;
    if (t.timer <= 0) { t.timer = 0.4 + Math.random() * 0.6; t.vel.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize().multiplyScalar(260); }
    t.pos.addScaledVector(t.vel, DT);
  };
  return t;
}

// ---------------------------------------------------------------- 1) trafienia
console.log('\n1. Rakiety gracza w cel robiący uniki (odległość 900-1400 j.)');
const table = {};
for (const [diff, R] of Object.entries(COMBAT_DIFFICULTY)) {
  table[diff] = {};
  for (const id of ['missile', 'dart', 'salvo']) {
    const W = world(11 + id.length);
    let rockets = 0, hitRockets = 0;
    for (let shot = 0; shot < 120; shot++) {
      const dist = 900 + Math.random() * 500;
      const dir0 = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, -1).normalize();
      const tgt = jinker(W, dir0.clone().multiplyScalar(dist));
      const aim = tgt.pos.clone().normalize();
      const n = id === 'salvo' ? 5 : 1;
      const results = [];
      W.weapons.fire(id, {
        origin: new THREE.Vector3(), dir: aim, side: 'player', shooter: PLAYER_SHOOTER, target: tgt.ref, baseSpeed: 200,
        up: new THREE.Vector3(0, 1, 0), fate: () => ({ hit: Math.random() < R.hitChance }),
        onResult: (hit) => results.push(hit),
      });
      const before = tgt.hits;
      for (let k = 0; k < 60 * 6; k++) { tgt.update(); W.step(); }
      W.combat.unregister(tgt.actor);
      rockets += n;
      // dart/salvo: wynik z onResult (każda rakieta osobno); Sokół: czy cel oberwał
      hitRockets += id === 'missile' ? (tgt.hits > before ? 1 : 0) : results.filter(Boolean).length;
    }
    table[diff][id] = hitRockets / rockets;
  }
  const t = table[diff];
  console.log(`   ${diff.padEnd(9)} cel ${Math.round(R.hitChance * 100)}%  ->  Sokół ${Math.round(t.missile * 100)}%  Grot ${Math.round(t.dart * 100)}%  Salwa ${Math.round(t.salvo * 100)}%`);
}
for (const [diff, R] of Object.entries(COMBAT_DIFFICULTY)) {
  for (const id of ['missile', 'dart', 'salvo']) {
    ok(Math.abs(table[diff][id] - R.hitChance) < 0.1, `${diff}: ${id} trafia ${Math.round(table[diff][id] * 100)}% (cel ${Math.round(R.hitChance * 100)}% ±10)`);
  }
}

// ---------------------------------------------------------------- 2) flary
console.log('\n2. Wrogie rakiety w gracza, flary automatyczne (porównanie z lotem bez flar)');
function enemyVolley(diff, R, useFlares, N = 60) {
  const W = world(5);
  const ship = new THREE.Object3D();
  const vel = new THREE.Vector3(0, 0, -220);
  let hull = 0;
  const actor = { side: 'player', get position() { return ship.position; }, radius: 12, isAlive: () => true, takeDamage: (a) => { hull += a; } };
  W.combat.register(actor);
  const flares = createFlares({ combat: W.combat, weapons: W.weapons, ship, getVelocity: (o) => o.copy(vel) });
  flares.configure({ ...R, flares: useFlares ? 999 : 0 });
  const target = { position: ship.position, velocity: vel, isAlive: () => true };
  let hits = 0;
  for (let i = 0; i < N; i++) {
    const from = ship.position.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.2, Math.random() - 0.5).normalize().multiplyScalar(1400));
    const before = hull;
    W.weapons.fire('missile', { origin: from, dir: ship.position.clone().sub(from).normalize(), side: 'hostile', target, npc: true, baseSpeed: 150 });
    for (let k = 0; k < 60 * 4; k++) { ship.position.addScaledVector(vel, DT); flares.update(DT); W.step(); }
    if (hull > before) hits++;
  }
  return { rate: hits / N, used: 999 - flares.state.count };
}
for (const [diff, R] of Object.entries(COMBAT_DIFFICULTY)) {
  const base = enemyVolley(diff, R, false);
  const withF = enemyVolley(diff, R, true);
  const expected = base.rate * (1 - R.flareChance);
  console.log(`   ${diff.padEnd(9)} bez flar trafia ${Math.round(base.rate * 100)}%, z flarami ${Math.round(withF.rate * 100)}% (oczekiwane ~${Math.round(expected * 100)}%), pakietów: ${withF.used} na 60 rakiet`);
  ok(Math.abs(withF.rate - expected) < 0.13, `${diff}: flary zatrzymują ~${Math.round(R.flareChance * 100)}% rakiet`);
  ok(withF.used >= 55 && withF.used <= 60, `${diff}: jeden pakiet na nadlatującą rakietę (${withF.used})`);
}
{
  // zapas flar się kończy
  const W = world(6);
  const ship = new THREE.Object3D();
  W.combat.register({ side: 'player', get position() { return ship.position; }, radius: 12, isAlive: () => true, takeDamage: () => {} });
  const flares = createFlares({ combat: W.combat, weapons: W.weapons, ship, getVelocity: (o) => o.set(0, 0, 0) });
  flares.configure(COMBAT_DIFFICULTY.trudna);
  let emptyMsg = 0;
  flares.on('empty', () => emptyMsg++);
  const target = { position: ship.position, velocity: new THREE.Vector3(), isAlive: () => true };
  for (let i = 0; i < 12; i++) {
    W.weapons.fire('missile', { origin: new THREE.Vector3(1400, 0, 0), dir: new THREE.Vector3(-1, 0, 0), side: 'hostile', target, npc: true });
    for (let k = 0; k < 60 * 3; k++) { flares.update(DT); W.step(); }
  }
  ok(flares.state.count === 0 && emptyMsg === 1, `trudna: ${COMBAT_DIFFICULTY.trudna.flares} flar zużyte, jeden komunikat „brak flar”`);
}

// ---------------------------------------------------------------- 3) ciepło
console.log('\n3. Ciągły ogień działkiem do przegrzania (rasa o thermal 60)');
for (const [diff, R] of Object.entries(COMBAT_DIFFICULTY)) {
  const W = world(3);
  const ship = new THREE.Object3D();
  const arsenal = createPlayerArsenal({ weapons: W.weapons, ship, getRadius: () => 10, getSpeed: () => 0, getTargets: () => [] });
  arsenal.setRace('wybudzeni', 60, 1);
  arsenal.configure(loadoutFor('wybudzeni', diff), R);
  const res = {};
  for (const gun of ['pulse', 'photon', 'phase']) {
    arsenal.refill();
    arsenal.select(gun);
    let t = 0;
    while (t < 30 && !arsenal.state.overheated) { arsenal.update(DT, true, true); W.step(); t += DT; }
    res[gun] = arsenal.state.overheated ? t : null;
  }
  const f = (v) => (v == null ? 'nigdy' : `${v.toFixed(1)} s`);
  console.log(`   ${diff.padEnd(9)} impulsowe ${f(res.pulse)}, fotonowe ${f(res.photon)}, fazowe ${f(res.phase)}`);
  if (R.gunOverheatSec == null) ok(res.pulse == null && res.photon == null && res.phase == null, `${diff}: działka się nie przegrzewają`);
  else ok(Math.abs(res.pulse - R.gunOverheatSec) < 1, `${diff}: impulsowe przegrzewa się po ${f(res.pulse)} (cel ${R.gunOverheatSec} s)`);
}

// ---------------------------------------------------------------- 4) zapas
console.log('\n4. Zapas amunicji');
{
  const W = world(4);
  const ship = new THREE.Object3D();
  const arsenal = createPlayerArsenal({ weapons: W.weapons, ship, getRadius: () => 10, getSpeed: () => 0, getTargets: () => [] });
  arsenal.setRace('heliotropi', 90, 1);
  arsenal.configure(loadoutFor('heliotropi', 'trudna'), COMBAT_DIFFICULTY.trudna);
  arsenal.select('missile');
  const start = arsenal.state.ammo.missile;
  let empty = 0;
  arsenal.on('empty', () => empty++);
  for (let t = 0; t < 30; t += DT) { arsenal.update(DT, true, true); W.step(); }
  ok(start === 2 && arsenal.state.ammo.missile === 0 && empty > 0, `trudna, Heliotropi: Sokołów ${start}, po ogniu 0, komunikat „pusto”`);
  arsenal.refill();
  ok(arsenal.state.ammo.missile === start, 'odnowienie zapasu (start misji / odrodzenie)');
  const L = loadoutFor('wybudzeni', 'normalna');
  ok(L.order.join(',') === 'pulse,photon,phase,missile,torpedo,mine', `Wybudzeni: ${L.order.join(', ')}`);
}

console.log(fails ? `\n${fails} niezaliczonych.` : '\nWszystko zaliczone.');
process.exit(fails ? 1 : 0);
