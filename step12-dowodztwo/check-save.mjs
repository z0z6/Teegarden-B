// Bezgłowy test odporności zapisu gry (save-sanitize.js) w Node:
//   npm i three@0.184.0   (raz, katalog wyżej)
//   node step12-dowodztwo/check-save.mjs
//
// 1. Prawdziwy, bogaty zapis kampanii (wyprawy, badanie, okręty, grupa bojowa,
//    strategia) przechodzi przez sanityzację BEZ ŻADNEJ ZMIANY.
// 2. Zapisy z nieznanymi id / złymi typami (plik od gracza, stara wersja):
//    gra wczytuje się, symulacja rusza, a odwołania, na których panele się
//    wywracały (TECHS[id].name, WARSHIPS[cls].hull, ...), działają.
import * as THREE from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

const { spawnOf, SYSTEM_ORDER } = await import('../shared/systems/star-systems.js');
const { generateFields } = await import('../shared/systems/fields.js');
const { createEconomy } = await import('../shared/systems/economy.js');
const { createCommand } = await import('../shared/systems/command.js');
const { createStrategy } = await import('../shared/systems/strategy.js');
const { createArmy } = await import('../shared/systems/army.js');
const { createCombat } = await import('../shared/systems/combat.js');
const { createNpcManager } = await import('../shared/systems/npc-ships.js');
const { createFleetOps } = await import('../shared/systems/fleet-ops.js');
const { seededRng } = await import('../shared/systems/asteroid-belt.js');
const { sanitizeState } = await import('../shared/systems/save-sanitize.js');
const { WARSHIPS, STATIONS } = await import('../shared/data/economy.js');
const { TECHS, DRONE_TYPES } = await import('../shared/data/command.js');
const { RACES } = await import('../shared/data/races.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
Math.random = seededRng(31337);
const KEY = 'teegarden-b.dowodztwo.v1.test';
const origWarn = console.warn;
console.warn = () => {}; // brak modeli .glb w Node + komunikaty o naprawach - nie zaśmiecamy wyniku

function makeWorld(memory = new Map()) {
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const eco = createEconomy({ scene, storage, random: seededRng(5), combat, getHostiles: () => [], fieldsFor: (id, sp) => generateFields(id, sp), saveKey: KEY });
  eco.enterSystem('teegarden', spawnOf('teegarden'));
  const cmd = createCommand({ economy: eco, combat, getHostiles: () => [], onDecision: () => {}, onEvent: () => {}, random: seededRng(9) });
  cmd.found();
  const homeField = eco.fieldDefs('teegarden')[0].id;
  let army = null;
  const strategy = createStrategy({ economy: eco, playerRace: 'wybudzeni', systems: SYSTEM_ORDER, spawnOf, seed: 3,
    hooks: { playerFieldIds: () => [homeField], playerPower: () => army.power(), playerFieldDefense: (f) => 1 + army.fieldDefense(f), attackPlayer: () => {}, systemName: (x) => x } });
  strategy.ensure('teegarden');
  const player = { position: new THREE.Vector3(0, 0, 90000), quaternion: new THREE.Quaternion(), getVelocity: (o) => o.set(0, 0, 0), isAlive: () => true };
  const npcs = createNpcManager(scene, combat, player, {});
  let ops = null;
  army = createArmy({ economy: eco, strategy, npcs, player, playerRace: () => 'wybudzeni', brainFor: (s) => ops?.brainFor(s) });
  ops = createFleetOps({ army, strategy, economy: eco, homeSystem: () => 'teegarden', homeField: () => homeField, onEvent: () => {}, onReport: () => {}, rng: seededRng(11) });
  const tick = (sec, dt = 0.25) => { for (let t = 0; t < sec; t += dt) { eco.update(dt); cmd.update(dt); army.update(dt); ops.update(dt); strategy.update(dt); } };
  return { memory, eco, cmd, strategy, army, ops, tick, homeField };
}

/** To, co robią panele przy renderze - tu wywracały się złe zapisy. */
function renderLookups(W) {
  const out = [];
  const c = W.eco.state.command;
  if (c?.research) out.push(TECHS[c.research.id].name);
  for (const t of c?.techs ?? []) out.push(TECHS[t].name);
  for (const e of c?.expeditions ?? []) out.push(DRONE_TYPES[e.type].name);
  for (const s of W.army.ships) out.push(WARSHIPS[s.cls].name, Math.round((s.hull / WARSHIPS[s.cls].hull) * 100));
  for (const st of W.eco.stations()) out.push(STATIONS[st.type].name);
  for (const f of Object.values(W.eco.state.strategy?.fields ?? {})) if (f.owner && f.owner !== 'player') out.push(RACES[f.owner].name);
  return out.length;
}

// ------------------------------------------------------------
console.log('\n1. Poprawny, bogaty zapis przechodzi bez zmian');
let good;
{
  const W = makeWorld();
  W.eco.state.credits = 500000;
  W.tick(20);
  const rock = W.cmd.bestRock();
  const d1 = W.cmd.dispatch('zwiadowca', 1, W.eco.fieldDefs('teegarden')[1]?.id ?? W.homeField);
  const d2 = rock ? W.cmd.dispatch('gornik', 4, rock.id) : { ok: false };
  const rs = W.cmd.research(Object.keys(TECHS).find((id) => W.cmd.research(id).ok) ?? 'flotacja');
  W.army.grantGarrison({ sysId: 'teegarden', field: W.homeField });
  const g = W.ops.createGroup(W.army.ships.slice(0, 2).map((s) => s.id), { name: 'Alfa' });
  W.tick(90);
  W.eco.save();
  good = W.memory.get(KEY);
  const st = JSON.parse(good);
  ok(d1.ok || d2.ok, `w zapisie są wyprawy dronów (${st.command.expeditions.length})`);
  ok(st.army?.ships?.length >= 3 && g.ok && st.ops?.groups?.length === 1, `okręty (${st.army.ships.length}) i grupa bojowa w zapisie`);
  ok(st.strategy && Object.keys(st.strategy.fields).length > 10, `strategia: ${Object.keys(st.strategy.fields).length} pól`);
  void rs;
  const { state, fixes } = sanitizeState(JSON.parse(good));
  ok(fixes.length === 0 && JSON.stringify(state) === good, `sanityzacja nie zmienia poprawnego zapisu (${good.length} znaków, poprawek: ${fixes.length})`);
  const W2 = makeWorld(new Map([[KEY, good]]));
  ok(W2.eco.state.credits === st.credits && W2.army.ships.length === st.army.ships.length, 'wczytanie poprawnego zapisu: ten sam stan');
}

// ------------------------------------------------------------
console.log('\n2. Zepsute zapisy: gra wczytuje się i działa');
const cases = {
  'nieznane badanie w toku': (s) => { s.command.research = { id: 'teleportacja', t: 5 }; },
  'nieznane badanie ukończone': (s) => { s.command.techs.push('magia', 42); },
  'okręt nieznanej klasy': (s) => { s.army.ships.push({ id: 'ok99', cls: 'gwiazda-smierci', hull: 1e9, sysId: 'teegarden', order: 'obrona', callsign: 'X' }); },
  'kadłub okrętu jako tekst': (s) => { s.army.ships[0].hull = 'pełny'; },
  'stocznia z nieznaną klasą': (s) => { s.army.queue.push({ cls: 'ufo', t: 1 }); },
  'stacja nieznanego typu': (s) => { s.systems.teegarden.stations.push({ id: 's999', type: 'portal', pos: { x: 0, y: 0, z: 0 } }); },
  'wyprawa nieznanych dronów': (s) => { s.command.expeditions.push({ id: 'x999', type: 'smok', n: 3, target: { kind: 'ast', id: 'a1' }, phase: 'wylot', t: 0 }); },
  'hangar z tekstem i obcym typem': (s) => { s.command.hangar.gornik = 'dużo'; s.command.hangar.kosmita = 5; },
  'pole z nieznanym właścicielem': (s) => { s.strategy.fields[Object.keys(s.strategy.fields)[0]].owner = 'klingoni'; },
  'kredyty jako tekst': (s) => { s.credits = '1e99'; },
  'command jako tekst': (s) => { s.command = 'hakerzy'; },
  'army jako liczba': (s) => { s.army = 7; },
  'strategy bez pól': (s) => { s.strategy = { factions: {} }; },
  'grupy bojowe jako obiekt': (s) => { s.ops.groups = { a: 1 }; },
  'nieznany poziom trudności': (s) => { s.difficulty = 'koszmar'; },
  'metal spoza tabeli': (s) => { s.hold.unobtainium = 5; s.market.zelazo = null; },
};
for (const [name, corrupt] of Object.entries(cases)) {
  const st = JSON.parse(good);
  corrupt(st);
  const memory = new Map([[KEY, JSON.stringify(st)]]);
  let err = null, n = 0, fixes = [];
  try {
    fixes = sanitizeState(JSON.parse(JSON.stringify(st))).fixes;
    const W = makeWorld(memory);
    W.tick(10);
    n = renderLookups(W);
    W.eco.save();
    // po zapisie i ponownym wczytaniu stan jest już czysty
    const again = sanitizeState(JSON.parse(memory.get(KEY)));
    if (again.fixes.length) throw new Error(`po ponownym zapisie wciąż ${again.fixes.length} poprawek: ${again.fixes[0]}`);
  } catch (e) { err = e; }
  ok(!err && fixes.length > 0, `${name}: ${err ? `BŁĄD ${err.message}` : `${fixes.length} poprawk(a/i), panele czytają ${n} wpisów`}`);
}

// ------------------------------------------------------------
console.log('\n3. Bez sanityzacji te same zapisy wywracały panele (kontrola testu)');
{
  const st = JSON.parse(good);
  cases['nieznane badanie w toku'](st);
  let threw = false;
  try { void TECHS[st.command.research.id].name; } catch { threw = true; }
  ok(threw, 'TECHS[nieznany].name rzuca TypeError - test sprawdza prawdziwy problem');
  ok(sanitizeState('nie obiekt').state === null && sanitizeState({ version: 2 }).state === null, 'obce dane i nieznana wersja: brak stanu (nowa gra)');
}

console.warn = origWarn;
console.log(`\n${fails ? `BŁĘDY: ${fails}` : 'Wszystko OK'}`);
process.exit(fails ? 1 : 0);
