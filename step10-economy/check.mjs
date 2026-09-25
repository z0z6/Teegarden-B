// Bezgłowa symulacja warstwy ekonomicznej kroku 10 (Node, bez przeglądarki):
//   npm i three@0.184.0   (raz, np. katalog wyżej - repo nie ma package.json)
//   node step10-economy/check.mjs
//
// Prawdziwe moduły: shared/systems/economy.js, asteroid-belt.js,
// economy-visuals.js (siatki powstają, ale nic nie jest rysowane).
// Scenariusz przechodzi całą pętlę: kopanie -> magazyn -> przeładunek ->
// sprzedaż -> dok -> rój dronów kopiących na powierzchni -> zapis/odczyt ->
// praca "zaoczna" imperium w innym układzie.
import * as THREE from 'three';
import { createEconomy, freshState } from '../shared/systems/economy.js';
import { generateBelt, remaining, surfacePoint, seededRng } from '../shared/systems/asteroid-belt.js';
import { STATIONS, DRONE, METAL_ORDER, PLAYER_MINING } from '../shared/data/economy.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
const sum = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);
const r0 = (x) => Math.round(x);

Math.random = seededRng(12345); // iskry i drobna losowość - powtarzalnie

const memory = new Map();
const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
const events = [];
const spawn = { position: new THREE.Vector3(0, 3000, 40000), lookAt: new THREE.Vector3() };
const HOLD = 18 * PLAYER_MINING.holdPerCargo;

function makeEco() {
  const scene = new THREE.Scene();
  const eco = createEconomy({ scene, storage, onEvent: (e) => events.push(e), random: seededRng(7) });
  return { scene, eco };
}
function run(eco, seconds, step = 1 / 30, each = null) {
  for (let t = 0; t < seconds; t += step) { eco.update(step); each?.(t); }
}
/** Ustawia "statek" przy planetoidzie, dziobem do niej. */
function parkAt(ast, dist = 200) {
  const dir = new THREE.Vector3(1, 0.2, 0.3).normalize();
  const pos = ast.position.clone().addScaledVector(dir, ast.radius + dist);
  const fwd = ast.position.clone().sub(pos).normalize();
  return { pos, fwd };
}
function mineFull(eco, ast) {
  const { pos, fwd } = parkAt(ast);
  let t = 0;
  while (sum(eco.state.hold) < HOLD - 0.01 && t < 120) { eco.playerMine(1 / 30, pos, fwd, HOLD, true); eco.update(1 / 30); t += 1 / 30; }
  return t;
}
/** Leci (teleportem) pod stację i rozładowuje. */
function deliver(eco, st) {
  const at = new THREE.Vector3(st.pos.x, st.pos.y, st.pos.z).add(new THREE.Vector3(STATIONS[st.type].radius + 100, 0, 0));
  const near = eco.nearestStation(at);
  ok(near?.id === st.id, `w zasięgu dokowania: ${st.name}`);
  return eco.unloadAt(near);
}

// ------------------------------------------------------------
console.log('\n1. Pas planetoid');
{
  const a = generateBelt(99, { x: 0, y: 0, z: 0 });
  const b = generateBelt(99, { x: 0, y: 0, z: 0 });
  ok(JSON.stringify(a.asteroids.map((x) => [x.cls, r0(x.radius), x.reserves])) === JSON.stringify(b.asteroids.map((x) => [x.cls, r0(x.radius), x.reserves])),
    `deterministyczny (${a.asteroids.length} planetoid, to samo ziarno = ten sam pas)`);
  const classes = new Set(a.asteroids.map((x) => x.cls));
  ok(classes.size >= 2, `różne klasy: ${[...classes].join(', ')}`);
  const overlap = a.asteroids.some((x, i) => a.asteroids.some((y, j) => i < j && x.position.distanceTo(y.position) < x.radius + y.radius));
  ok(!overlap, 'planetoidy nie nachodzą na siebie');
  const m = a.asteroids.filter((x) => x.cls === 'M'), c = a.asteroids.filter((x) => x.cls === 'C');
  if (m.length && c.length) {
    const pt = (xs) => xs.reduce((s, x) => s + x.reserves.platyna, 0) / xs.reduce((s, x) => s + x.total0, 0);
    ok(pt(m) > pt(c), 'metaliczne (M) mają więcej platyny niż węglowe (C)');
  }
}

// ------------------------------------------------------------
console.log('\n2. Wydobycie ręczne i pierwszy magazyn');
const { eco } = makeEco();
eco.enterSystem('teegarden', spawn);
const belt = eco.asteroids();
ok(belt.length > 10 && belt[0].mesh, `pas w scenie (${belt.length} siatek)`);
const rich = [...belt].sort((x, y) => remaining(y) - remaining(x));
const ore = rich[0];
const credits0 = eco.state.credits;
let t = mineFull(eco, ore);
ok(Math.abs(sum(eco.state.hold) - HOLD) < 0.05, `ładownia pełna (${r0(sum(eco.state.hold))}/${HOLD} t) po ${t.toFixed(1)} s`);
ok(remaining(ore) < ore.total0 - HOLD + 1, `złoże ${ore.name} ubyło o ${r0(ore.total0 - remaining(ore))} t`);
const nothing = eco.playerMine(1 / 30, new THREE.Vector3(1e6, 0, 0), new THREE.Vector3(1, 0, 0), HOLD, true);
ok(nothing === null, 'promień w pustkę nic nie łapie');

// stacja przed "dziobem" - daleko od planetoid
const base = spawn.position.clone().add(new THREE.Vector3(0, 0, -1500));
const bad = eco.canPlace('magazyn', ore.position);
ok(!bad.ok, `nie da się stawiać w planetoidzie (${bad.why})`);
const mag = eco.placeStation('magazyn', base);
ok(mag && mag.status === 'budowa' && eco.state.credits === credits0 - STATIONS.magazyn.cost.credits, `plac budowy magazynu, kredyty ${credits0} -> ${eco.state.credits}`);
ok(!eco.canPlace('dok', base.clone().add(new THREE.Vector3(100, 0, 0))).ok, 'odstęp między stacjami pilnowany');
deliver(eco, mag);
ok(sum(mag.need) === 0 && sum(eco.state.hold) < 0.01, `metal na placu, nadwyżka do zapasów stacji (${r0(sum(mag.storage))} t)`);
run(eco, STATIONS.magazyn.buildTime + 1);
ok(mag.status === 'gotowa', 'magazyn ukończony po czasie montażu');
mineFull(eco, ore);
deliver(eco, mag);
ok(sum(mag.storage) > HOLD, `druga ładownia w magazynie: ${r0(sum(mag.storage))} t`);

// ------------------------------------------------------------
console.log('\n3. Przeładunek i rynek');
// holowniki: plac budowy dostaje metal z magazynu sam
for (let i = 0; i < 3; i++) { mineFull(eco, ore.depleted ? rich[1] : ore); deliver(eco, mag); }
const przPos = base.clone().add(new THREE.Vector3(900, 0, 0));
const prz = eco.placeStation('przeladunek', przPos);
const fe0 = mag.storage.zelazo;
run(eco, 20);
ok(sum(prz.need) === 0 && mag.storage.zelazo < fe0, `holowniki dowiozły metal z magazynu (Fe ${r0(fe0)} -> ${r0(mag.storage.zelazo)} t)`);
run(eco, STATIONS.przeladunek.buildTime + 1);
ok(prz.status === 'gotowa', 'stacja przeładunkowa gotowa');
mineFull(eco, rich[1]);
const cr = eco.state.credits, pFe = eco.price('zelazo');
deliver(eco, prz);
run(eco, 30);
ok(eco.state.credits > cr + 50, `sprzedaż: ${r0(cr)} -> ${r0(eco.state.credits)} kr (przychód/min ${r0(eco.summary().income)} kr)`);
ok(eco.state.market.zelazo < 1, `kurs Fe spadł po podaży (mnożnik ${eco.state.market.zelazo.toFixed(3)}, cena ${pFe.toFixed(2)} -> ${eco.price('zelazo').toFixed(2)})`);
run(eco, 200);
ok(eco.state.market.zelazo > 0.99, `kurs wraca do równowagi (${eco.state.market.zelazo.toFixed(3)})`);

// ------------------------------------------------------------
console.log('\n4. Dok roju i drony górnicze');
// na dok potrzeba sporo metalu - dosypujemy do magazynu (test logiki, nie cierpliwości)
Object.assign(mag.storage, { zelazo: 900, nikiel: 300, kobalt: 60, platyna: 0 });
eco.state.credits += 5000;
const dok = eco.placeStation('dok', base.clone().add(new THREE.Vector3(-900, 0, 0)));
run(eco, 30 + STATIONS.dok.buildTime);
ok(dok.status === 'gotowa', 'dok roju zbudowany z metalu z magazynu');
const sw = eco.createSwarm(dok.id);
ok(sw && sw.name.startsWith('Rój'), `rój: ${sw?.name}`);
const ordered = eco.orderDrones(sw.id, 12);
ok(ordered === 12, 'zamówiono 12 dronów');
const fe1 = mag.storage.zelazo;
run(eco, 12 * DRONE.buildTime + 2);
ok(sw.drones === 12 && eco.runtime.drones.length === 12, `drony gotowe (${sw.drones}), koszt z puli (Fe ${r0(fe1)} -> ${r0(mag.storage.zelazo)} t)`);
const reserves0 = eco.asteroids().reduce((a, x) => a + remaining(x), 0);
const stored0 = sum(mag.storage) + sum(dok.storage) + sum(prz.storage);
const cr0 = eco.state.credits;
let sawDrill = 0, landErr = 0;
run(eco, 150, 1 / 30, () => {
  for (const d of eco.runtime.drones) {
    if (d.state !== 'wiercenie') continue;
    sawDrill++;
    const surf = surfacePoint(d.ast, d.site, 0, new THREE.Vector3());
    landErr = Math.max(landErr, Math.abs(d.pos.distanceTo(surf) - DRONE.hover));
  }
});
const reserves1 = eco.asteroids().reduce((a, x) => a + remaining(x), 0);
const s = eco.summary();
ok(sawDrill > 0, `drony wiercą na powierzchni (${sawDrill} próbek); odchyłka od powierzchni ${landErr.toFixed(2)} j.`);
ok(landErr < 3, 'dron trzyma się obracającej się skały (punkt lokalny bryły)');
ok(reserves1 < reserves0 - 100, `roje wydobyły ${r0(reserves0 - reserves1)} t w 150 s`);
const stored1 = sum(mag.storage) + sum(dok.storage) + sum(prz.storage);
ok(stored1 + (eco.state.credits - cr0) / 3 > stored0, `urobek dotarł do stacji (${r0(stored0)} -> ${r0(stored1)} t, +${r0(eco.state.credits - cr0)} kr)`);
console.log(`       stan rojów: ${JSON.stringify(s.drones)}`);

// cel ręczny + preferencja
const target = eco.asteroids().filter((a) => !a.depleted).sort((a, b) => b.reserves.kobalt - a.reserves.kobalt)[0];
eco.setSwarm(sw.id, { target: target.id });
run(eco, 60);
const onTarget = eco.runtime.drones.filter((d) => d.ast === target).length;
ok(onTarget >= 6, `rój przestawiony na ${target.name}: ${onTarget}/12 dronów tam pracuje`);
// powrót do doku
eco.setSwarm(sw.id, { mode: 'powrot' });
run(eco, 90);
ok(eco.runtime.drones.every((d) => d.state === 'dok'), 'rozkaz „powrót”: wszystkie drony zadokowane');
eco.setSwarm(sw.id, { mode: 'wydobycie', target: 'auto' });
run(eco, 20);
ok(eco.runtime.drones.some((d) => d.state !== 'dok'), 'rozkaz „wydobycie”: rój znów wylatuje');
const scrapped = eco.scrapDrones(sw.id, 2);
ok(scrapped === 2 && sw.drones === 10, 'rozbiórka 2 dronów');

// ------------------------------------------------------------
console.log('\n5. Pełne magazyny');
{
  // przeładunek zatkany: przestawiamy rój na magazyn i zapychamy wszystko
  for (const st of eco.stations()) Object.assign(st.storage, { zelazo: STATIONS[st.type].capacity, nikiel: 0, kobalt: 0, platyna: 0 });
  const thr = STATIONS.przeladunek.throughput;
  STATIONS.przeladunek.throughput = 0; // frachtowce nie przylatują
  const before = events.length;
  run(eco, 120);
  ok(eco.runtime.drones.some((d) => d.state === 'czeka'), 'drony z urobkiem czekają, gdy nie ma miejsca');
  ok(events.slice(before).some((e) => e.key === 'storage-full'), 'alert załogi: magazyny pełne');
  STATIONS.przeladunek.throughput = thr;
  for (const st of eco.stations()) st.storage.zelazo = 0;
}

// ------------------------------------------------------------
console.log('\n6. Zapis i odczyt');
eco.save();
const snap = JSON.parse(memory.get('teegarden-b.ekonomia.v1'));
ok(snap.systems.teegarden.stations.length === 3 && snap.systems.teegarden.swarms[0].drones === 10, 'zapis: 3 stacje, rój 10 dronów');
{
  const { eco: eco2 } = makeEco();
  eco2.enterSystem('teegarden', spawn);
  ok(eco2.stations().length === 3 && eco2.runtime.drones.length === 10, 'odczyt: stacje i drony wróciły');
  const a = eco2.asteroids().find((x) => x.id === ore.id);
  ok(Math.abs(remaining(a) - remaining(ore)) < 1, `wydobycie zapamiętane (${ore.name}: ${r0(remaining(a))} t)`);
  eco2.dispose();
}

// ------------------------------------------------------------
console.log('\n7. Imperium pracuje zaocznie');
{
  eco.setSwarm(sw.id, { drop: mag.id });
  const storedA = sum(mag.storage), crA = eco.state.credits;
  eco.enterSystem('potrojny', { position: new THREE.Vector3(0, 5000, 90000), lookAt: new THREE.Vector3() });
  ok(eco.runtime.drones.length === 0 && eco.stations().length === 0, 'nowy układ: czysto, własny pas');
  run(eco, 120, 0.25);
  ok(sum(mag.storage) > storedA + 50 || eco.state.credits > crA, `rój w Teegarden kopał pod nieobecność gracza (magazyn ${r0(storedA)} -> ${r0(sum(mag.storage))} t)`);
  eco.enterSystem('teegarden', spawn);
  ok(eco.runtime.drones.length === 10, 'powrót: rój na miejscu');
}

// ------------------------------------------------------------
console.log('\n8. Nowa gra');
eco.reset();
ok(eco.state.credits === freshState().credits && eco.stations().length === 0, 'reset: czysty stan, pas odnowiony');

eco.dispose();
console.log(fails ? `\n${fails} niezaliczonych.` : '\nWszystko zaliczone.');
process.exit(fails ? 1 : 0);
