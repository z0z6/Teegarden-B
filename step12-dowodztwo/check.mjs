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
const { createSaveSlots } = await import('../shared/systems/save-slots.js');
const { createExchange } = await import('../shared/systems/exchange.js');
const { SENTRY, FREIGHTER, AUTOMATION } = await import('../shared/data/command.js');

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
  ok(W.cmd.state.hangar.gornik === HQ.startDrones.gornik, 'górnicy w hangarze');
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

// ------------------------------------------------------------
console.log('\n10. Garnizon: trzy okręty bronią bazy od początku');
{
  const memory = new Map();
  const W = makeWorld({ memory });
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const mkArmy = (eco) => {
    const strategy = createStrategy({ economy: eco, playerRace: 'wybudzeni', systems: SYSTEM_ORDER, spawnOf, seed: 3,
      hooks: { playerFieldIds: () => [], playerPower: () => 1, playerFieldDefense: () => 1, attackPlayer: () => {}, systemName: (x) => x } });
    strategy.ensure('teegarden');
    const player = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), getVelocity: (o) => o.set(0, 0, 0), isAlive: () => true };
    const npcs = createNpcManager(scene, combat, player, {});
    return { strategy, npcs, army: createArmy({ economy: eco, strategy, npcs, player, playerRace: () => 'wybudzeni' }) };
  };
  const { army, strategy } = mkArmy(W.eco);
  const field = W.eco.fieldDefs('teegarden')[0].id;
  const got = army.grantGarrison({ cls: 'eskorta', n: 3, sysId: W.cmd.state.home, field });
  ok(got.length === 3 && army.ships.length === 3 && army.ships.every((x) => x.cls === 'eskorta' && x.order === 'obrona' && x.field === field),
    `3 × ${WARSHIPS.eskorta.name}, rozkaz: obrona pola macierzystego (${strategy.defs.get(field)?.name})`);
  ok(army.power() === 3 * WARSHIPS.eskorta.power && army.fieldDefense(field) >= 3 * WARSHIPS.eskorta.power, `siła ${army.power()} liczy się do obrony pola`);
  ok(army.upkeepPerMin() === 0, 'garnizon bez utrzymania (siedziba go opłaca)');
  const cr = W.eco.state.credits;
  for (let t = 0; t < 12; t += 0.25) army.update(0.25);
  ok(W.eco.state.credits === cr, 'kredyty nie maleją przez garnizon');
  ok(army.spawned.size === 3, `okręty stoją w układzie jako NPC (${army.spawned.size})`);
  ok(army.grantGarrison({ cls: 'eskorta', n: 3, sysId: W.cmd.state.home, field }).length === 0 && army.ships.length === 3, 'garnizon tylko raz na kampanię');
  W.eco.save();
  const W2 = makeWorld({ memory });
  const { army: army2 } = mkArmy(W2.eco);
  ok(army2.ships.length === 3 && army2.grantGarrison({ sysId: 'teegarden', field }).length === 0, 'po wczytaniu: te same 3 okręty, bez drugiego garnizonu');
}

// ------------------------------------------------------------
console.log('\n11. Zapisy gry: sloty, wczytanie, eksport i import');
{
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  const W = makeWorld({ memory });
  W.eco.state.credits = 4321;
  W.cmd.state.techs.push('flotacja');
  W.eco.save();
  let clock = 1000;
  const slots = createSaveSlots({ storage, prefix: 'tst', now: () => clock });
  const a = slots.save({ name: 'Przed wojną', data: memory.get('test12'), meta: { home: 'teegarden', ship: 'x', credits: 4321 }, liveKey: 'test12' });
  ok(a.ok && slots.list().length === 1 && slots.list()[0].name === 'Przed wojną', `zapis w slocie: ${a.text}`);
  // gra toczy się dalej i autozapis się zmienia
  W.eco.state.credits = 10;
  W.cmd.state.techs.length = 0;
  W.eco.save();
  clock = 2000;
  const b = slots.save({ name: 'Bieda', data: memory.get('test12'), meta: {}, liveKey: 'test12' });
  ok(b.ok && slots.list()[0].id === b.id, 'lista: najnowszy zapis na górze');
  const r = slots.restore(a.id);
  const W2 = makeWorld({ memory });
  ok(r && W2.eco.state.credits === 4321 && W2.cmd.has('flotacja'), `wczytanie slotu przywraca stan (kredyty ${W2.eco.state.credits}, nauka)`);
  ok(W2.cmd.hq()?.id === W.cmd.hq().id && W2.eco.stations().filter((x) => x.type === 'siedziba').length === 1, 'po wczytaniu jedna, ta sama siedziba');
  const over = slots.save({ name: 'Przed wojną', data: memory.get('test12'), meta: {}, liveKey: 'test12', id: a.id });
  ok(over.ok && slots.list().length === 2, 'nadpisanie nie dubluje slotu');
  const file = slots.exportText(a.id);
  const imp = slots.importText(file);
  ok(imp.ok && slots.list().length === 3 && slots.read(imp.id).data === slots.read(a.id).data, 'eksport → import pliku daje ten sam stan');
  ok(!slots.importText('{"x":1}').ok && !slots.importText('nie json').ok, 'import odrzuca obce pliki');
  ok(slots.remove(b.id).ok && slots.list().length === 2 && !memory.has(`tst.slot.${b.id}`), 'usunięcie slotu czyści pamięć');
  const full = createSaveSlots({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} }, prefix: 'q' });
  ok(!full.save({ name: 'x', data: '{}', liveKey: 'k' }).ok, 'brak miejsca w pamięci: czytelny błąd zamiast wyjątku');
}


// ------------------------------------------------------------
console.log('\n12. Więcej górników i wieże strażnicze na start');
{
  const W = makeWorld();
  ok(W.cmd.state.hangar.gornik === HQ.startDrones.gornik && HQ.startDrones.gornik >= 12, `hangar: ${W.cmd.state.hangar.gornik} górników (było 6)`);
  ok(W.cmd.state.hangar.wieza === 2, 'hangar: 2 wieże strażnicze');
  // stary zapis (bez pól 12b): jednorazowy dodatek
  const memory = new Map();
  const W0 = makeWorld({ memory });
  const c = W0.eco.state.command;
  delete c.v2; delete c.sentries; delete c.alloc; delete c.freighter; c.hangar.gornik = 6; delete c.hangar.wieza;
  W0.eco.save();
  const W1 = makeWorld({ memory });
  ok(W1.cmd.state.hangar.gornik === 12 && W1.cmd.state.hangar.wieza === 2 && Array.isArray(W1.cmd.state.sentries), 'stary zapis: +6 górników i 2 wieże, raz');
  W1.eco.save();
  const W2 = makeWorld({ memory });
  ok(W2.cmd.state.hangar.gornik === 12, 'dodatek nie powtarza się przy kolejnym wczytaniu');
}

// ------------------------------------------------------------
console.log('\n13. Wieże strażnicze: rozstawienie, zasięg, ogień, osłona wypraw');
{
  const hostiles = [];
  const W = makeWorld({ hostiles });
  const rock = W.cmd.bestRock();
  const r = W.cmd.deploySentry({ x: rock.position.x + 300, z: rock.position.z });
  ok(r.ok && W.cmd.state.hangar.wieza === 1 && W.cmd.sentries().length === 1, `rozstawienie: ${r.text}`);
  const x = r.sentry;
  W.runUntil(() => x.phase === 'straz', 30);
  ok(x.phase === 'straz' && Math.abs(x.pos.y - (W.eco.fieldDefs('teegarden').find((d) => d.id === rock.fieldId).center.y + SENTRY.hover)) < 1, `na pozycji, ${SENTRY.hover} j. nad płaszczyzną pola`);
  ok(W.cmd.coverAt(rock.position) === 1 && W.cmd.coverAt(rock.position.clone().add(new THREE.Vector3(SENTRY.range + 900, 0, 0))) === 0, `okrąg zasięgu ${W.cmd.sentryRange()} j.: skała w środku, dalej już nie`);
  const shots = { gun: 0, rocket: 0 };
  W.cmd.hooks.sentryFire = (s, p, kind) => { shots[kind]++; };
  const foe = { alive: true, hidden: false, arriving: false, group: { position: new THREE.Vector3(x.pos.x + 900, x.pos.y, x.pos.z) }, velocity: new THREE.Vector3() };
  foe.contact = { position: foe.group.position, velocity: foe.velocity, isAlive: () => foe.alive };
  hostiles.push(foe);
  W.tick(9);
  ok(shots.gun > 15 && shots.rocket >= 2, `wróg w zasięgu: działko ${shots.gun} strzałów, rakiety ${shots.rocket}`);
  ok(W.cmd.contacts().length === 1, 'wieża jest celem dla wrogów (kontakt)');
  // osłona: ta sama wyprawa pod ostrzałem traci drony wolniej w zasięgu wieży
  const loss = (cover) => {
    const h2 = [];
    const V = makeWorld({ hostiles: h2 });
    const rr = V.cmd.bestRock();
    if (cover) { const d = V.cmd.deploySentry({ x: rr.position.x, z: rr.position.z }).sentry; V.runUntil(() => d.phase === 'straz', 30); }
    const e = V.cmd.dispatch('gornik', 6, rr.id).exp;
    V.runUntil(() => e.phase === 'praca', 40);
    const p = V.cmd.pose(e, new THREE.Vector3());
    h2.push({ alive: true, hidden: false, arriving: false, group: { position: p.clone().add(new THREE.Vector3(5000, 0, 0)) }, velocity: new THREE.Vector3() });
    h2[0].group.position.copy(p).add(new THREE.Vector3(600, 0, 0));
    V.tick(12);
    return V.cmd.state.stats.lost;
  };
  const bare = loss(false), covered = loss(true);
  ok(covered < bare, `osłona wieży: strata dronów ${bare} → ${covered} w tym samym czasie`);
  const mv = W.cmd.moveSentry(x.id, { x: x.pos.x + 2000, z: x.pos.z });
  ok(mv.ok && x.phase === 'lot', 'przestawienie: wieża leci na nowe miejsce');
  hostiles.length = 0;
  W.cmd.recallSentry(x.id);
  W.runUntil(() => !W.cmd.sentries().length, 40);
  ok(W.cmd.state.hangar.wieza === 2, 'wycofanie: wieża wraca do hangaru');
  const d = W.cmd.deploySentry({ x: 0, z: 0 }).sentry;
  W.runUntil(() => d.phase === 'straz', 40);
  W.cmd.contacts();
  const rt = [...Array(1)].map(() => W.cmd.contacts()[0])[0];
  ok(!!rt, 'wieża na pozycji ma kontakt');
}

// ------------------------------------------------------------
console.log('\n14. Przydział dronów do sektorów (pól)');
{
  const W = makeWorld();
  const home = W.eco.fieldDefs('teegarden')[0];
  const r1 = W.cmd.setAlloc(home.id, 'gornik', 8);
  W.tick(2);
  ok(r1.ok && W.cmd.allocCount(home.id, 'gornik') === 8 && W.cmd.state.hangar.gornik === 4, `„${home.name}: 8 górników” — zarządca wysłał 8 (w hangarze zostało ${W.cmd.state.hangar.gornik})`);
  ok(W.cmd.expeditions().filter((e) => e.alloc === home.id).every((e) => W.eco.asteroidsIn('teegarden').find((a) => a.id === e.target.id)?.fieldId === home.id), 'wszyscy pracują na skałach tego pola');
  ok(!W.decisions.some((d) => d.kind === 'logistics'), 'przydział nie pyta o trasę (automatyka)');
  W.cmd.setAlloc(home.id, 'gornik', 3);
  W.tick(2);
  const working = W.cmd.expeditions().filter((e) => e.alloc === home.id).reduce((a, e) => a + e.n, 0);
  ok(working === 3, `zmniejszenie do 3: nadmiar odesłany (pracuje ${working})`);
  W.runUntil(() => W.cmd.state.hangar.gornik === 9, 60);
  ok(W.cmd.state.hangar.gornik === 9, 'odesłani górnicy wrócili do hangaru');
  // pełne ładownie w przydziale: bez karty, sami wracają i zarządca dosyła
  const full = W.runUntil(() => W.cmd.expeditions().some((e) => e.alloc && e.phase === 'odlot'), 120);
  ok(full >= 0 && !W.decisions.some((d) => d.kind === 'return'), 'pełne ładownie: powrót bez pytania');
  const ore0 = W.cmd.state.stats.ore;
  W.tick(60);
  ok(W.cmd.allocCount(home.id, 'gornik') === 3 && W.cmd.state.stats.ore > ore0, 'zarządca trzyma 3 górników w pracy, urobek płynie');
  // zwiadowcy na nieznane pole
  const unknown = W.cmd.targets().unknown[0];
  const r2 = W.cmd.setAlloc(unknown.id, 'zwiadowca', 2);
  W.tick(2);
  ok(r2.ok && W.cmd.allocCount(unknown.id, 'zwiadowca') === 2, `zwiadowcy (2) lecą na nieznane pole ${unknown.def.name}`);
  W.runUntil(() => W.eco.isDiscovered('teegarden', unknown.id) && W.cmd.fieldSummary(unknown.id).surveyed > 0, 90);
  const fs = W.cmd.fieldSummary(unknown.id);
  ok(fs.discovered && fs.surveyed > 0, `pole odkryte, zbadane skały: ${fs.surveyed}/${fs.rocks}`);
  ok(W.cmd.setAlloc(home.id, 'wieza', 2).ok === false, 'wież nie przydziela się do sektorów (rozstawia się je na mapie)');
}

// ------------------------------------------------------------
console.log('\n15. Trasy urobku i automatyka logistyki');
{
  const W = makeWorld();
  W.eco.state.credits = 20000;
  const rock = W.cmd.bestRock();
  W.cmd.dispatch('gornik', 6, rock.id);
  const card = W.decisions.find((d) => d.id.startsWith('route-'));
  ok(card && card.choices.map((c) => c.act).join() === 'huta,magazyn,frachtowiec', `wysłanie górników: karta „${card?.title}” [${card?.choices.map((c) => c.label).join(' / ')}]`);
  W.answer(card.id, 'magazyn');
  ok(W.cmd.state.route === 'magazyn' && W.decisions.some((d) => d.id === 'store-none'), 'magazyn bez magazynu: karta z gotowym „Zbuduj magazyn”');
  W.answer('store-none', 'small');
  W.runUntil(() => W.cmd.stores().length > 0, 120);
  ok(W.cmd.stores().length === 1, 'magazyn postawiony z karty');
  W.runUntil(() => W.decisions.some((d) => d.kind === 'return'), 200);
  W.answer(W.decisions.find((d) => d.kind === 'return').id, 'return');
  W.runUntil(() => !W.cmd.expeditions().length, 200);
  const mag = W.cmd.stores()[0];
  mag.ore ??= Object.fromEntries(METAL_ORDER.map((m) => [m, 0]));
  ok(W.cmd.oreIn(mag) > 1 || W.cmd.state.stats.smelted.zelazo > 0, `urobek trafił do magazynu (${fmt(W.cmd.oreIn(mag))} t) i huta dobiera z niego`);
  // huta dobiera z magazynu, gdy ma wolne moce
  mag.ore.zelazo += 300;
  const m0 = W.cmd.oreIn(mag);
  W.tick(10);
  ok(W.cmd.oreIn(mag) < m0 - 20, `huta sama dobiera urobek z magazynu (${fmt(m0)} → ${fmt(W.cmd.oreIn(mag))} t)`);
  // pełny magazyn: frachtowiec odbiera + karta "większy magazyn"
  mag.ore.zelazo = W.cmd.oreCap(mag);
  const cr = W.eco.state.credits;
  W.tick(3);
  ok(W.decisions.some((d) => d.id === 'store-full' && d.choices[0].act === 'big'), 'pełny magazyn: karta „Zbuduj wielki magazyn”');
  ok(W.cmd.oreIn(mag) < W.cmd.oreCap(mag) * AUTOMATION.magazynFull && W.cmd.state.freighter.hold.zelazo > 0, 'frachtowiec sam odbiera urobek z pełnego magazynu');
  W.runUntil(() => W.cmd.state.freighter.phase === 'kurs', 120);
  W.runUntil(() => W.cmd.state.freighter.phase === 'dok', FREIGHTER.trip + 5);
  ok(W.eco.state.credits > cr && W.cmd.state.freighter.trips === 1, `frachtowiec sprzedał urobek: +${fmt(W.eco.state.credits - cr)} kr`);
  W.answer('store-full', 'big');
  W.runUntil(() => W.cmd.stores().some((x) => x.type === 'skladnica'), 200);
  ok(W.cmd.stores().some((x) => x.type === 'skladnica'), `wielki magazyn z karty (urobek: ${W.cmd.oreStock().magazynCap} t miejsca)`);
  // trasa frachtowiec
  W.cmd.setRoute('frachtowiec', { ask: false });
  const e = W.cmd.dispatch('gornik', 6, W.cmd.bestRock().id).exp;
  ok(e.route === 'frachtowiec' && !W.decisions.some((d) => d.id === `route-${e.id}`), '„zawsze frachtowiec”: bez pytania');
  W.runUntil(() => W.decisions.some((d) => d.id === `full-${e.id}`), 200);
  W.answer(`full-${e.id}`, 'return');
  W.runUntil(() => !W.cmd.expedition(e.id), 200);
  ok(W.cmd.oreStock().frachtowiec > 1, `urobek na frachtowcu (${fmt(W.cmd.oreStock().frachtowiec)} t)`);
  // huta nie nadąża
  W.cmd.state.ore.zelazo = AUTOMATION.hutaBacklog + 100;
  W.tick(1);
  ok(W.decisions.some((d) => d.id === 'huta-backlog' && d.choices.some((c) => c.act === 'up')), 'huta nie nadąża: karta „Ulepsz piece / do magazynu / na frachtowiec”');
  W.cmd.hq().storage.zelazo += 300; W.cmd.hq().storage.nikiel += 100;
  const b = W.cmd.buyFreighter();
  ok(b.ok && W.cmd.state.freighter.n === 2, `drugi frachtowiec: ${b.text}`);
}

// ------------------------------------------------------------
console.log('\n16. Giełda: wymiana zasobów');
{
  const W = makeWorld();
  W.eco.state.credits = 5000;
  const ex = createExchange({ economy: W.eco, command: W.cmd });
  const pool = () => W.eco.poolOf('teegarden').reduce((a, s) => { for (const m of METAL_ORDER) a[m] += s.storage[m]; return a; }, Object.fromEntries(METAL_ORDER.map((m) => [m, 0])));
  const fe0 = pool().zelazo, ni0 = pool().nikiel;
  const q = ex.quote('zelazo', 'nikiel', 100);
  ok(q.ok && q.out > 0 && q.out < 100 * 4 / 9, `wycena: 100 t Fe → ${q.out.toFixed(1)} t Ni (prowizja ${fmt(q.fee)} kr)`);
  const t = ex.trade('zelazo', 'nikiel', 100);
  ok(t.ok && Math.abs(pool().zelazo - (fe0 - 100)) < 1e-6 && Math.abs(pool().nikiel - (ni0 + q.out)) < 0.01, `wymiana: ${t.text}`);
  ok(W.eco.state.market.zelazo < 1 && W.eco.state.market.nikiel > 1, 'sprzedaż obniża kurs Fe, kupno podnosi kurs Ni');
  const c0 = W.eco.state.credits;
  const t2 = ex.trade('kredyty', 'kobalt', 1000);
  ok(t2.ok && W.eco.state.credits === c0 - 1000 && pool().kobalt > 8, `kredyty → metal: ${t2.text}`);
  const t3 = ex.trade('platyna', 'kredyty', 50);
  ok(!t3.ok, `bez platyny: „${t3.text}”`);
  W.cmd.state.ore.nikiel = 40; W.cmd.state.ore.zelazo = 60;
  const c1 = W.eco.state.credits;
  const t4 = ex.trade('urobek', 'kredyty', 100);
  ok(t4.ok && W.eco.state.credits > c1 && W.cmd.oreStock().huta < 1, `urobek na sprzedaż: ${t4.text}`);
  ok(!ex.quote('kredyty', 'urobek', 10).ok && !ex.quote('zelazo', 'zelazo', 10).ok, 'nie da się kupić urobku ani wymienić towaru na ten sam');
  const fee0 = ex.fee();
  W.eco.placeReady('przeladunek', W.cmd.hq().pos.x !== undefined ? { x: W.cmd.hq().pos.x + 3000, y: W.cmd.hq().pos.y, z: W.cmd.hq().pos.z } : null, { temp: false });
  ok(ex.fee() < fee0, `stacja przeładunkowa obniża prowizję (${fee0 * 100}% → ${ex.fee() * 100}%)`);
  // pełny skład: metal, który się nie mieści, nie jest kupowany
  for (const s of W.eco.poolOf('teegarden')) s.storage.zelazo += W.eco.freeSpace(s);
  const q5 = ex.quote('kredyty', 'zelazo', 3000);
  ok(!q5.ok || q5.out < 1, 'pełny skład: giełda nie sprzeda metalu, którego nie ma gdzie złożyć');
}
console.log(fails ? `\n${fails} błędów` : '\nWszystko działa.');
process.exit(fails ? 1 : 0);
