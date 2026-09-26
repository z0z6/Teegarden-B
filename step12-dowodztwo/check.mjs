// Bezgłowy test Dowództwa (krok 12) w Node, bez przeglądarki:
//   npm i three@0.184.0   (raz, np. katalog wyżej - repo nie ma package.json)
//   node step12-dowodztwo/check.mjs
//
// Prawdziwe moduły: economy (wiele pól), command (siedziba, hangar, wyprawy,
// huta, zasilanie, nauka, ulepszenia), strategy + army (mnożniki floty).
import * as THREE from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

const { spawnOf, SYSTEM_ORDER } = await import('../shared/systems/star-systems.js');
const { generateFields } = await import('../shared/systems/fields.js');
const { createEconomy } = await import('../shared/systems/economy.js');
const { createCommand, VISIBLE_PHASES } = await import('../shared/systems/command.js');
const { createStrategy, PLAYER } = await import('../shared/systems/strategy.js');
const { createArmy } = await import('../shared/systems/army.js');
const { createCombat } = await import('../shared/systems/combat.js');
const { createNpcManager } = await import('../shared/systems/npc-ships.js');
const { seededRng } = await import('../shared/systems/asteroid-belt.js');
const { METAL_ORDER, STATIONS, WARSHIPS } = await import('../shared/data/economy.js');
const { HQ, DRONE_TYPES, EXPEDITION, TECHS, UPGRADES } = await import('../shared/data/command.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
Math.random = seededRng(777);
const sum = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);
const fmt = (n) => Math.round(n);

function makeWorld({ memory = new Map(), hostiles = [] } = {}) {
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const eco = createEconomy({ scene, storage, random: seededRng(5), combat, getHostiles: () => hostiles, fieldsFor: (id, sp) => generateFields(id, sp), saveKey: 'test12' });
  eco.enterSystem('teegarden', spawnOf('teegarden'));
  const decisions = [], events = [];
  const cmd = createCommand({ economy: eco, combat, getHostiles: () => hostiles, hqName: 'Siedziba testowa',
    onDecision: (d) => decisions.push(d), onEvent: (e) => events.push(e), random: seededRng(9) });
  cmd.found();
  const tick = (sec, dt = 1 / 20) => { for (let t = 0; t < sec; t += dt) { eco.update(dt); cmd.update(dt); } };
  const answer = (id, act) => { const i = decisions.findIndex((d) => d.id === id); if (i < 0) return false; const d = decisions.splice(i, 1)[0]; d.onChoose(act); return true; };
  const runUntil = (pred, max = 120, dt = 1 / 20) => { for (let t = 0; t < max; t += dt) { eco.update(dt); cmd.update(dt); if (pred()) return t; } return -1; };
  return { scene, combat, eco, cmd, decisions, events, tick, answer, runUntil, memory, hostiles };
}

// ------------------------------------------------------------
console.log('\n1. Siedziba, huta i reaktor przed polem macierzystym');
{
  const W = makeWorld();
  const st = W.eco.stations();
  const hq = W.cmd.hq();
  ok(hq && hq.type === 'siedziba' && hq.status === 'gotowa' && !hq.temp, `siedziba stoi: ${hq?.name}`);
  ok(st.some((s) => s.type === 'huta') && st.some((s) => s.type === 'reaktor'), 'obok: huta orbitalna i reaktor');
  const f = W.cmd.frame();
  const home = W.eco.fieldDefs('teegarden')[0];
  const toField = new THREE.Vector3(home.center.x, home.center.y, home.center.z).sub(f.pos).setY(0).normalize();
  ok(f.fwd.dot(toField) > 0.99, 'siedziba zwrócona dziobem (hangar, mostek) do pola macierzystego');
  ok(f.pos.distanceTo(new THREE.Vector3(home.center.x, home.center.y, home.center.z)) > home.radius, 'siedziba poza pasem — z mostka pas widać przed sobą');
  ok(W.cmd.hangarPos().distanceTo(f.pos) < 400 && W.cmd.bridgePos().y > f.pos.y, 'wylot hangaru i mostek w bryle siedziby');
  ok(W.cmd.state.hangar.zwiadowca === HQ.startDrones.zwiadowca && W.cmd.state.hangar.gornik === HQ.startDrones.gornik, `hangar na start: ${JSON.stringify(W.cmd.state.hangar)}`);
  ok(Object.keys(W.cmd.state.surveyed).length === 2, 'dwie najbliższe skały zbadane od razu');
  ok(W.eco.poolTotals().zelazo >= HQ.start.zelazo, `skład siedziby jest pulą metalu (${fmt(W.eco.poolTotals().zelazo)} t Fe)`);
  ok(W.cmd.found() === hq && W.eco.stations().filter((s) => s.type === 'siedziba').length === 1, 'found() drugi raz nic nie dubluje');
}

// ------------------------------------------------------------
console.log('\n2. Zasilanie');
{
  const W = makeWorld();
  const p = W.cmd.power('teegarden');
  ok(p.supply === 85 && p.demand === 14 && p.ratio > 1, `start: ${p.supply} MW podaży / ${p.demand} MW poboru`);
  const huta = W.cmd.huta();
  ok(W.cmd.efficiency('teegarden', huta) === 1, 'huta pracuje pełną mocą');
  for (let i = 0; i < 8; i++) {
    const s = W.eco.placeReady('stocznia', W.cmd.frame().pos.clone().add(new THREE.Vector3(3000 + i * 800, 0, 3000)), { temp: false });
    s.name = `Stocznia ${i}`;
  }
  const p2 = W.cmd.power('teegarden');
  ok(p2.ratio < 1 && W.cmd.efficiency('teegarden', huta) < 1 && W.cmd.efficiency('teegarden', W.cmd.hq()) === 1, `przeciążenie: ${p2.supply}/${p2.demand} MW → huta ${Math.round(W.cmd.efficiency('teegarden', huta) * 100)}%, siedziba 100%`);
  W.eco.state.credits = 1e6;
  for (const s of W.eco.stations()) if (s.type === 'siedziba') Object.assign(s.storage, { zelazo: 5000, nikiel: 600, kobalt: 300, platyna: 0 });
  ok(!W.cmd.setAutonomy(huta.id).ok, 'autonomiczne zasilanie wymaga badania');
  W.cmd.state.techs.push('reaktory', 'ogniwa');
  const res = W.cmd.setAutonomy(huta.id);
  ok(res.ok && W.cmd.efficiency('teegarden', huta) === 1, `ogniwa autonomiczne: ${res.text}`);
  W.eco.state.time += 1;
  ok(W.cmd.power('teegarden').autonomous === 1 && W.cmd.power('teegarden').supply > 85, 'huta poza siecią, reaktory fuzyjne dają więcej mocy');
}

// ------------------------------------------------------------
console.log('\n3. Zwiad: nieznane złoże → odkrycie pola, raport, decyzja');
{
  const W = makeWorld();
  const { unknown } = W.cmd.targets();
  ok(unknown.length === 4, `4 nieznane złoża w układzie (${unknown.map((u) => u.def.name).join(', ')})`);
  ok(!W.cmd.dispatch('gornik', 4, unknown[0].id).ok, 'górnicy nie lecą na nieznane złoże');
  const r = W.cmd.dispatch('zwiadowca', 2, unknown[0].id);
  ok(r.ok && W.cmd.state.hangar.zwiadowca === 1, `start: ${r.text}`);
  const e = r.exp;
  const phases = [e.phase];
  const vis = [];
  const p = new THREE.Vector3();
  W.cmd.hooks.phase = (x, ph) => { if (x === e) phases.push(ph); };
  W.runUntil(() => { if (W.cmd.pose(e, p)) vis.push(e.phase); return !W.cmd.expedition(e.id); }, 60);
  ok(phases.join(' > ') === 'wylot > przelot > dolot > praca > odlot > powrot > podejscie > rozladunek > koniec', `fazy: ${phases.join(' > ')}`);
  ok(!vis.includes('przelot') && !vis.includes('powrot') && vis.includes('wylot') && vis.includes('dolot'), 'przelot i powrót „w skrócie” (poza przestrzenią), wylot i dolot widać');
  ok(W.eco.isDiscovered('teegarden', unknown[0].id), 'pole odkryte przez zwiadowców');
  const inField = W.eco.asteroidsIn('teegarden').filter((a) => a.fieldId === unknown[0].id);
  const surveyedHere = inField.filter((a) => W.cmd.surveyed(a.id)).length;
  ok(surveyedHere === Math.min(3, inField.length), `bez spektrometrii zbadane ${surveyedHere} skały z ${inField.length}`);
  ok(W.cmd.state.hangar.zwiadowca === 3, 'zwiadowcy wrócili do hangaru');
  const d = W.decisions.find((x) => x.kind === 'survey');
  ok(d && /Wysłać górników/.test(d.text) && d.choices.some((c) => c.act === 'send'), `raport: „${d?.title}: ${d?.text}”`);
  W.answer(d.id, 'send');
  ok(W.cmd.expeditions().some((x) => x.type === 'gornik'), 'decyzja „Tak” wysyła górników na najbogatszą skałę');
}

// ------------------------------------------------------------
console.log('\n4. Górnicy: pełne ładownie → decyzja → huta → metal');
{
  const W = makeWorld();
  const rock = W.cmd.bestRock();
  ok(!!rock, `najlepsza zbadana skała: ${rock?.name} (${rock?.cls})`);
  const unsurveyed = W.cmd.targets().asteroids.find((x) => !x.surveyed);
  ok(!W.cmd.dispatch('gornik', 3, unsurveyed.id).ok, 'na niezbadaną skałę górnicy nie lecą');
  const r = W.cmd.dispatch('gornik', 6, rock.id);
  const e = r.exp;
  const t = W.runUntil(() => e.phase === 'pelne', 120);
  const cap = DRONE_TYPES.gornik.hold * 6;
  ok(t > 0 && Math.abs(sum(e.cargo) - cap) < 0.5, `ładownie pełne po ${t.toFixed(1)} s: ${sum(e.cargo).toFixed(1)} / ${cap} t`);
  const d = W.decisions.find((x) => x.id === `full-${e.id}`);
  ok(d && d.defaultAct === 'return' && d.manage.some((m) => m.label === 'Zaalarmuj pozostałych') && d.manage.some((m) => m.label === 'Przywołaj ochronę'), `decyzja: „${d?.text}” [${d?.choices.map((c) => c.label).join(' / ')}] + Zarządzaj: ${d?.manage.map((m) => m.label).join(', ')}`);
  const fe0 = W.cmd.hq().storage.zelazo, co0 = W.cmd.hq().storage.kobalt;
  W.answer(d.id, 'return');
  W.runUntil(() => !W.cmd.expedition(e.id), 60);
  ok(W.cmd.state.hangar.gornik === 6, 'górnicy w hangarze');
  const ore = sum(W.cmd.state.ore);
  ok(ore > 0 || W.cmd.hq().storage.zelazo > fe0, `urobek w hucie (${ore.toFixed(1)} t czeka na przetop)`);
  W.tick(40);
  const gotFe = W.cmd.hq().storage.zelazo - fe0;
  ok(gotFe > cap * 0.3 && sum(W.cmd.state.ore) < 0.5, `huta przetopiła urobek: +${gotFe.toFixed(1)} t Fe do składu`);
  ok(W.cmd.hq().storage.kobalt - co0 < 1e-6 && W.cmd.state.stats.smelted.kobalt === 0, 'bez badań kobalt idzie na hałdę (odzysk 0%)');
}

// ------------------------------------------------------------
console.log('\n5. Nauka: odkrycia zmieniają gospodarkę');
{
  const W = makeWorld();
  W.eco.state.credits = 1e5;
  Object.assign(W.cmd.hq().storage, { zelazo: 3000, nikiel: 800, kobalt: 200, platyna: 20 });
  ok(!W.cmd.research('lugowanie').ok && W.cmd.techState('lugowanie').locked, 'ługowanie kobaltu wymaga flotacji');
  ok(W.cmd.recovery('nikiel') === 0.7 && W.cmd.recovery('kobalt') === 0, 'odzysk na start: Ni 70%, Co 0%');
  ok(W.cmd.research('flotacja').ok && !W.cmd.research('holowniki').ok, 'jedno badanie naraz');
  W.runUntil(() => W.cmd.has('flotacja'), TECHS.flotacja.time + 5);
  const d = W.decisions.find((x) => x.kind === 'science');
  ok(W.cmd.has('flotacja') && W.cmd.recovery('nikiel') === 0.95 && d && /naukowcy/.test(d.text), `odkrycie: „${d?.text}”`);
  W.cmd.research('lugowanie');
  W.runUntil(() => W.cmd.has('lugowanie'), TECHS.lugowanie.time + 5);
  ok(W.cmd.recovery('kobalt') === 0.75, 'po ługowaniu huta odzyskuje kobalt (75%)');
  ok(!W.cmd.buildDrones('holownik', 2).ok, 'holowniki wymagają badania');
  W.cmd.research('holowniki');
  W.runUntil(() => W.cmd.has('holowniki'), TECHS.holowniki.time + 5);
  const d2 = W.decisions.find((x) => x.id === 'tech-holowniki');
  ok(d2 && d2.choices.some((c) => c.act === 'build'), `po odkryciu propozycja: ${d2?.choices.map((c) => c.label).join(' / ')}`);
  W.answer('tech-holowniki', 'build');
  W.runUntil(() => W.cmd.state.hangar.holownik >= 3, 60);
  ok(W.cmd.state.hangar.holownik === 3, 'hangar zbudował 3 holowniki');
  // kobalt z urobku po badaniu
  const co0 = W.cmd.hq().storage.kobalt;
  W.cmd.state.ore.kobalt = 10;
  W.tick(10);
  ok(W.cmd.hq().storage.kobalt - co0 > 7, `10 t kobaltu w urobku → +${(W.cmd.hq().storage.kobalt - co0).toFixed(1)} t w składzie`);
}

// ------------------------------------------------------------
console.log('\n6. Ulepszenia');
{
  const W = makeWorld();
  W.eco.state.credits = 1e5;
  Object.assign(W.cmd.hq().storage, { zelazo: 5000, nikiel: 2000, kobalt: 500 });
  const c1 = W.cmd.upgradeCost('drony-naped');
  const s0 = W.cmd.speedOf('gornik');
  ok(W.cmd.upgrade('drony-naped').ok, 'napęd dronów: poziom 1');
  const c2 = W.cmd.upgradeCost('drony-naped');
  ok(c2.credits > c1.credits && W.cmd.speedOf('gornik') > s0 * 1.14, `koszt rośnie (${c1.credits} → ${c2.credits} kr), dron szybszy (${s0} → ${W.cmd.speedOf('gornik')})`);
  for (let i = 0; i < 6; i++) W.cmd.upgrade('drony-naped');
  ok(W.cmd.lvl('drony-naped') === UPGRADES['drony-naped'].max && W.cmd.upgradeState('drony-naped').max, `limit poziomów (${UPGRADES['drony-naped'].max})`);
  ok(!W.cmd.upgrade('flota-kadlub').ok, 'ulepszenia floty wymagają kompozytów');
  const cap0 = W.cmd.hangarCap();
  W.cmd.upgrade('hangar');
  ok(W.cmd.hangarCap() > cap0, `rozbudowa hangaru: ${cap0} → ${W.cmd.hangarCap()} miejsc`);
  // flota: mnożniki w army.js
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const strategy = createStrategy({ economy: W.eco, playerRace: 'wybudzeni', systems: SYSTEM_ORDER, spawnOf, seed: 3,
    hooks: { playerFieldIds: () => [], playerPower: () => 1, playerFieldDefense: () => 1, attackPlayer: () => {}, systemName: (s) => s } });
  strategy.ensure('teegarden');
  const player = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), getVelocity: (o) => o.set(0, 0, 0), isAlive: () => true };
  const npcs = createNpcManager(scene, combat, player, {});
  let pm = 1;
  const army = createArmy({ economy: W.eco, strategy, npcs, player, playerRace: () => 'wybudzeni', mods: () => ({ power: pm, hull: 1 }) });
  army.ships.push({ id: 'okX', cls: 'fregata', hull: WARSHIPS.fregata.hull, sysId: 'teegarden', order: 'obrona', field: null, callsign: 'X' });
  const p1 = army.power();
  pm = 1.3;
  ok(Math.abs(army.power() - p1 * 1.3) < 1e-6, `uzbrojenie floty mnoży siłę (${p1} → ${army.power().toFixed(2)})`);
}

// ------------------------------------------------------------
console.log('\n7. Autonomia rojów (pętla bez decyzji)');
{
  const W = makeWorld();
  W.cmd.state.techs.push('spektrometria', 'automatyka');
  const rock = W.cmd.bestRock();
  const e = W.cmd.dispatch('gornik', 6, rock.id).exp;
  let trips = 0;
  W.cmd.hooks.phase = (x, ph) => { if (ph === 'koniec') trips++; };
  W.runUntil(() => trips >= 2, 200);
  ok(trips >= 2 && !W.decisions.some((d) => d.kind === 'return'), `${trips} kursy bez pytania o powrót`);
  ok(W.cmd.expeditions().some((x) => x.type === 'gornik' && x.target.id === rock.id), 'po rozładunku rój sam wraca na złoże');
  ok(e && W.cmd.state.stats.ore > DRONE_TYPES.gornik.hold * 6 * 1.9, `urobek łącznie ${fmt(W.cmd.state.stats.ore)} t`);
}

// ------------------------------------------------------------
console.log('\n8. Zagrożenie: wrogowie przy wyprawie, ochrona');
{
  const hostiles = [];
  const W = makeWorld({ hostiles });
  const rock = W.cmd.bestRock();
  const e = W.cmd.dispatch('gornik', 6, rock.id).exp;
  W.runUntil(() => e.phase === 'praca', 30);
  const p = W.cmd.pose(e, new THREE.Vector3());
  hostiles.push({ alive: true, hidden: false, arriving: false, group: { position: p.clone().add(new THREE.Vector3(600, 0, 0)) }, velocity: new THREE.Vector3() });
  W.tick(EXPEDITION.lossEvery * 2.2);
  const d = W.decisions.find((x) => x.kind === 'threat');
  ok(d && d.choices[0].act === 'recall' && d.manage.some((m) => m.act === 'fleet'), `„${d?.title}” [${d?.choices.map((c) => c.label).join(' / ')}] + ${d?.manage.map((m) => m.label).join(', ')}`);
  ok(e.n === 4 && W.cmd.state.stats.lost === 2, `pod ostrzałem giną drony (zostało ${e.n}/6)`);
  W.answer(d.id, 'recall');
  ok(e.phase === 'odlot', 'odwołanie: wyprawa wraca z tym, co ma');
  const r = W.cmd.alarmAll();
  ok(r.ok && W.eco.alert, `alarm: ${r.text}`);
}

// ------------------------------------------------------------
console.log('\n9. Hangar, budowa z mostka, zapis');
{
  const memory = new Map();
  const W = makeWorld({ memory });
  W.eco.state.credits = 5000;
  const n0 = W.cmd.state.hangar.gornik;
  const b = W.cmd.buildDrones('gornik', 3);
  const fe0 = W.eco.poolTotals().zelazo;
  W.runUntil(() => W.cmd.state.hangar.gornik === n0 + 3, 30);
  ok(b.ok && W.cmd.state.hangar.gornik === n0 + 3 && W.eco.poolTotals().zelazo < fe0, `hangar: +3 górników z metalu składu (${b.text})`);
  const s = W.cmd.buildStation('magazyn');
  ok(s.ok && W.eco.stations().some((x) => x.type === 'magazyn' && x.status === 'budowa'), `budowa z mostka: ${s.text}`);
  W.runUntil(() => W.eco.stations().find((x) => x.type === 'magazyn')?.status === 'gotowa', 80);
  ok(W.eco.stations().find((x) => x.type === 'magazyn')?.status === 'gotowa', 'holowniki dowiozły metal ze składu siedziby, magazyn gotowy');
  W.cmd.dispatch('zwiadowca', 2, W.cmd.targets().unknown[0].id);
  W.cmd.state.techs.push('flotacja');
  W.eco.save();
  const W2 = makeWorld({ memory });
  ok(W2.cmd.hq()?.id === W.cmd.hq().id && W2.eco.stations().filter((x) => x.type === 'siedziba').length === 1, 'po wczytaniu ta sama siedziba (bez duplikatu)');
  ok(W2.cmd.has('flotacja') && W2.cmd.expeditions().length === 1 && W2.cmd.state.hangar.gornik === n0 + 3, 'zapis: nauka, wyprawy i hangar');
}

console.log(fails ? `\n${fails} błędów` : '\nWszystko działa.');
process.exit(fails ? 1 : 0);
