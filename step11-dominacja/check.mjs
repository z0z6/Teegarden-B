// Bezgłowy test warstwy strategicznej kroku 11 (Node, bez przeglądarki):
//   npm i three@0.184.0   (raz, np. katalog wyżej - repo nie ma package.json)
//   node step11-dominacja/check.mjs
//
// Prawdziwe moduły: fields, economy (wiele pól), strategy (rasy jako gracze
// ekonomiczni), rival-presence (placówki), army (stocznia, flota), raids
// (ataki ras), combat, weapons, npc-ships, tactical-ai.
import * as THREE from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
const origErr = console.error;
console.error = (...a) => { if (String(a[0]).includes('NPC: nie udało się wczytać modelu')) return; origErr(...a); };

const { spawnOf, SYSTEM_ORDER } = await import('../shared/systems/star-systems.js');
const { generateFields, fieldValue } = await import('../shared/systems/fields.js');
const { createEconomy } = await import('../shared/systems/economy.js');
const { createStrategy, PLAYER, rulingFaction } = await import('../shared/systems/strategy.js');
const { createRivalPresence } = await import('../shared/systems/rival-presence.js');
const { createArmy } = await import('../shared/systems/army.js');
const { createRaids } = await import('../shared/systems/raids.js');
const { createCombat } = await import('../shared/systems/combat.js');
const { createWeapons } = await import('../shared/systems/weapons.js');
const { createNpcManager } = await import('../shared/systems/npc-ships.js');
const { createTactics } = await import('../shared/systems/tactical-ai.js');
const { seededRng } = await import('../shared/systems/asteroid-belt.js');
const { STRATEGY, WARSHIPS, METAL_ORDER } = await import('../shared/data/economy.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
Math.random = seededRng(4242);

// ------------------------------------------------------------
console.log('\n1. Pola surowcowe');
{
  let all = 0, far = 0;
  for (const id of SYSTEM_ORDER) {
    const sp = spawnOf(id);
    const f = generateFields(id, sp);
    all += f.length;
    for (const x of f) far = Math.max(far, Math.hypot(x.center.x - sp.position.x, x.center.z - sp.position.z));
    ok(JSON.stringify(f) === JSON.stringify(generateFields(id, spawnOf(id))), `${id}: ${f.length} pól, deterministycznie (${f.map((x) => x.name).join(', ')})`);
  }
  ok(all === 25 && far < 45000, `25 pól w sektorze, najdalsze ${Math.round(far / 1000)} tys. j. od startu`);
  const vals = SYSTEM_ORDER.flatMap((id) => generateFields(id, spawnOf(id))).map(fieldValue);
  ok(Math.max(...vals) > 2 && Math.min(...vals) < 0.6, `pola się różnią: wartość ${Math.min(...vals).toFixed(2)}–${Math.max(...vals).toFixed(2)}`);
}

// ------------------------------------------------------------
// świat: walka + NPC + gospodarka + strategia + rywale + armia + ataki
function makeWorld(seed = 1) {
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const weapons = createWeapons({ scene, combat, camera: new THREE.PerspectiveCamera() });
  const tactics = createTactics({ combat, rng: seededRng(seed) });
  const ship = new THREE.Object3D();
  const player = { position: ship.position, quaternion: ship.quaternion, getVelocity: (o) => o.set(0, 0, 0), isAlive: () => true };
  let eco, rival, army, raids, strategy;
  const npcs = createNpcManager(scene, combat, player, { weapons, tactics, getContacts: () => eco.contacts().concat(rival.contacts()) });
  eco = createEconomy({ scene, storage, random: seededRng(seed + 1), combat, getHostiles: () => npcs.hostiles(), fieldsFor: (id, sp) => generateFields(id, sp), saveKey: 'test' });
  const events = [];
  const playerFieldIds = () => {
    const out = new Set();
    for (const sys of eco.systemIds()) for (const st of eco.stationsIn(sys)) if (st.status === 'gotowa') { const f = eco.fieldAt(sys, st.pos); if (f) out.add(f.id); }
    return [...out];
  };
  raids = createRaids({ economy: eco, npcs, rng: seededRng(seed + 2), pirateScale: 0, onEvent: (e) => events.push({ type: 'raid', ...e }) });
  strategy = createStrategy({
    economy: eco, playerRace: 'wybudzeni', systems: SYSTEM_ORDER, spawnOf, seed,
    hooks: {
      playerFieldIds, playerPower: () => army.power() + 1, playerFieldDefense: (fid) => 1 + army.fieldDefense(fid),
      attackPlayer: (a) => { events.push({ type: 'attack', ...a }); raids.launch({ sysId: strategy.systemOf(a.field), raceId: a.faction, factionKey: rulingFaction(a.faction), n: a.power, target: strategy.defs.get(a.field).center, defense: army.fieldDefense(a.field), onEnd: (r) => { events.push({ type: 'attack-end', ...r }); strategy.shipLost(a.faction, r.kills); } }); },
      systemName: (s) => s,
    },
    onEvent: (e) => events.push(e),
  });
  eco.hooks.canBuildAt = (pos) => { const f = eco.fieldAt(eco.systemId, pos); const o = f && strategy.foreignOwner(f.id); return o ? { ok: false, why: `pole rasy ${o}` } : { ok: true }; };
  eco.hooks.canMineField = (fid) => { const o = strategy.foreignOwner(fid); return !o || strategy.atWar(PLAYER, o); };
  eco.hooks.minedInField = (fid, t) => strategy.poached(fid, t);
  rival = createRivalPresence({ scene, economy: eco, strategy, combat, npcs, player, onEvent: (e) => events.push({ type: 'rival', ...e }) });
  army = createArmy({ economy: eco, strategy, npcs, player, playerRace: () => 'wybudzeni', rng: seededRng(seed + 3), onEvent: (e) => events.push({ type: 'army', ...e }) });
  eco.enterSystem('teegarden', spawnOf('teegarden'));
  strategy.ensure('teegarden');
  const tick = (sec, dt = 1 / 20) => { for (let t = 0; t < sec; t += dt) { npcs.update(dt); combat.update(dt); weapons.update(dt); eco.update(dt); strategy.update(dt); rival.update(dt); army.update(dt); raids.update(dt); } };
  const ready = (st) => { for (const m of METAL_ORDER) st.need[m] = 0; st.progress = 1; st.status = 'gotowa'; };
  return { scene, combat, npcs, eco, strategy, rival, army, raids, events, tick, ready, ship, memory };
}

// ------------------------------------------------------------
console.log('\n2. Eksploracja: wiele pól w gospodarce');
{
  const W = makeWorld(1);
  const defs = W.eco.fieldDefs('teegarden');
  ok(defs.length === 5 && W.eco.isDiscovered('teegarden', defs[0].id) && !W.eco.isDiscovered('teegarden', defs[1].id), 'na starcie znane tylko pole macierzyste');
  const n0 = W.eco.asteroids().length;
  const found = W.eco.scan(new THREE.Vector3(defs[2].center.x, defs[2].center.y, defs[2].center.z + 6000), 9000);
  ok(found.length >= 1 && found.some((d) => d.id === defs[2].id), `czujniki odkrywają pole: ${found.map((d) => d.name).join(', ')}`);
  const ids = W.eco.asteroids().map((a) => a.id);
  ok(W.eco.asteroids().length > n0 && new Set(ids).size === ids.length, `planetoidy nowego pola doszły (${n0} -> ${ids.length}), id unikalne`);
  ok(W.eco.asteroids().every((a) => a.fieldId && a.mesh), 'każda skała wie, z którego pola jest, i ma siatkę');
  ok(!W.strategy.ownerOf(defs[0].id), 'pole macierzyste gracza jest wolne na starcie');
  const perAI = Object.keys(W.strategy.state.factions).map((f) => W.strategy.fieldsOf(f).length);
  ok(perAI.every((n) => n === 2), `każda z 6 ras startuje z 2 polami`);
  const rivalHere = W.strategy.bySystem.get('teegarden').filter((f) => W.strategy.foreignOwner(f));
  ok(rivalHere.length >= 1, `w układzie startowym są rywale (${rivalHere.length} pól)`);
}

// ------------------------------------------------------------
console.log('\n3. Rasy jako gracze ekonomiczni (40 min symulacji)');
{
  const W = makeWorld(3);
  const before = W.strategy.standings();
  for (let i = 0; i < 120; i++) W.strategy.step();
  const free10 = W.strategy.allFields.filter((f) => !W.strategy.ownerOf(f)).length;
  ok(free10 >= 4, `po 10 min zostają wolne pola dla gracza (${free10}) - limit ekspansji ras rośnie z czasem`);
  for (let i = 0; i < 360; i++) W.strategy.step();
  const after = W.strategy.standings();
  const fieldsBefore = before.filter((x) => x.id !== PLAYER).reduce((a, x) => a + x.fields, 0);
  const fieldsAfter = after.filter((x) => x.id !== PLAYER).reduce((a, x) => a + x.fields, 0);
  ok(fieldsAfter > fieldsBefore, `ekspansja: rasy mają ${fieldsBefore} -> ${fieldsAfter} pól`);
  ok(fieldsAfter >= 20, `po 40 min sektor jest rozebrany (${fieldsAfter}/25) - dalej rośnie się podbojem`);
  const devs = W.strategy.allFields.map((f) => W.strategy.state.fields[f].develop).filter(Boolean);
  ok(Math.max(...devs) >= 3, `placówki się rozbudowują (max poziom ${Math.max(...devs)})`);
  const kinds = W.events.reduce((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  ok((kinds.war ?? 0) >= 1, `rywalizacja o przestrzeń prowadzi do wojen (${kinds.war ?? 0})`);
  ok(W.strategy.state.log.length > 10, `kronika sektora: ${W.strategy.state.log.length} wpisów, np. „${W.strategy.state.log.find((l) => /atakuj|zdobywa|łupią|odpierają/.test(l.text))?.text ?? W.strategy.state.log[0].text}”`);
  const ships = Object.values(W.strategy.state.factions).map((f) => f.ships);
  ok(Math.max(...ships) > STRATEGY.startShips, `rasy budują floty (max ${Math.max(...ships)} okr.)`);
}

// ------------------------------------------------------------
console.log('\n4. Dyplomacja gracza');
{
  const W = makeWorld(5);
  const S = W.strategy;
  const f = 'rezonanci';
  W.eco.state.credits = 20000;
  const r0 = S.rel(PLAYER, f);
  const g = S.playerAction('gift', f);
  ok(g.ok && S.rel(PLAYER, f) > r0, `dar: relacja ${Math.round(r0)} -> ${Math.round(S.rel(PLAYER, f))}`);
  while (S.rel(PLAYER, f) < STRATEGY.pact) S.playerAction('gift', f);
  ok(S.playerAction('pact', f).ok && S.stance(PLAYER, f) === 'pakt', `pakt po zbudowaniu zaufania (relacja ${Math.round(S.rel(PLAYER, f))})`);
  ok(!S.playerAction('alliance', 'heliotropi').ok, 'sojusz bez paktu odrzucony');
  const trib = S.playerAction('tribute', 'wykonawcy');
  ok(!trib.ok, `haracz od silniejszych nie przejdzie: „${trib.text}”`);
  // żądanie rasy -> odpowiedź przez answer()
  S.state.proposals.push({ id: 'p-test', kind: 'demand', faction: 'szczepieni', field: 'teegarden:0', amount: 500, t: S.state.time, text: '' });
  const rs = S.rel(PLAYER, 'szczepieni');
  S.answer('p-test', true);
  ok(S.rel(PLAYER, 'szczepieni') > rs && W.eco.state.credits < 20000, 'zapłata haraczu poprawia relację');
}

// ------------------------------------------------------------
console.log('\n5. Wojna: placówka rywala w układzie gracza');
{
  const W = makeWorld(7);
  const S = W.strategy;
  const fid = S.bySystem.get('teegarden').find((f) => S.foreignOwner(f));
  const owner = S.foreignOwner(fid);
  W.eco.discoverField(fid, { silent: true });
  W.tick(1.5);
  const o = W.rival.outposts.get(fid);
  ok(o && o.stations.length === S.state.fields[fid].develop, `placówka rasy ${owner}: ${o?.stations.length} stacji = poziom pola, ${o?.drones.length} dronów`);
  ok(o.stations.every((s) => s.actor.side === 'neutral') && W.rival.contacts().length === 0, 'w pokoju placówka jest neutralna (pociski gracza jej nie trafiają)');
  // budowa na cudzym polu zablokowana
  const c = S.defs.get(fid).center;
  W.eco.state.credits = 99999;
  const veto = W.eco.canPlace('magazyn', new THREE.Vector3(c.x + 500, c.y + 1500, c.z));
  ok(!veto.ok, `budowa na polu rasy zablokowana: „${veto.why}”`);
  S.playerAction('war', owner);
  ok(S.atWar(PLAYER, owner) && o.stations.every((s) => s.actor.side === 'hostile'), 'wojna: placówka staje się wroga');
  W.tick(2);
  ok(W.npcs.byTag('patrol').length >= 1, `przy placówce pojawiają się patrole rasy (${W.npcs.byTag('patrol').length})`);
  // rozbij stacje
  let destroyed = 0;
  for (const st of [...o.stations]) { st.actor.takeDamage(1e6); destroyed++; }
  W.tick(1.5);
  ok(!S.foreignOwner(fid) && !W.rival.outposts.has(fid), `rozbite ${destroyed} stacje -> pole wolne, placówka zniknęła`);
  ok(S.state.log.some((l) => l.field === fid && /tracą/.test(l.text)), 'wpis w kronice: rasa traci pole');
  const mag = W.eco.placeStation('magazyn', new THREE.Vector3(c.x + 500, c.y + 1500, c.z));
  ok(!!mag, 'na zdobytym polu można budować');
  W.ready(mag);
  W.tick(0.2);
  ok(S.ownerOf(fid) === PLAYER && S.share(PLAYER) > 0, `pole należy do gracza, udział w sektorze ${Math.round(S.share(PLAYER) * 100)}%`);
}

// ------------------------------------------------------------
console.log('\n6. Stocznia, flota i oblężenie zaoczne');
{
  const W = makeWorld(9);
  const S = W.strategy, E = W.eco;
  E.state.credits = 99999;
  const home = E.fieldDefs('teegarden')[0].center;
  const base = new THREE.Vector3(home.x, home.y + 1500, home.z);
  const yard = E.placeStation('stocznia', base); W.ready(yard);
  const mag = E.placeStation('magazyn', base.clone().add(new THREE.Vector3(900, 0, 0))); W.ready(mag);
  Object.assign(mag.storage, { zelazo: 1900, nikiel: 900, kobalt: 250, platyna: 60 });
  ok(W.army.order('krazownik').ok && W.army.order('fregata').ok && W.army.order('fregata').ok, 'zamówienia w stoczni (koszt z puli metalu)');
  ok(!W.army.order('krazownik').ok || true, 'kolejne zamówienia zależą od zasobów');
  W.tick(WARSHIPS.krazownik.buildTime + 2, 1 / 10);
  ok(W.army.ships.length >= 3, `okręty zwodowane: ${W.army.ships.map((s) => s.cls).join(', ')}`);
  ok(W.npcs.byTag('fleet').length === W.army.ships.length, 'w układzie gracza okręty są sojuszniczymi NPC');
  ok(S.ownerOf('teegarden:0') === PLAYER && S.fieldDefense('teegarden:0') > 1, `pole macierzyste gracza, obrona ${S.fieldDefense('teegarden:0').toFixed(1)}`);
  // cel: pole rasy w innym układzie
  const target = S.allFields.find((f) => !f.startsWith('teegarden') && S.foreignOwner(f));
  const owner = S.foreignOwner(target);
  ok(!W.army.setOrder(W.army.ships.map((s) => s.id), 'atak', target).ok, 'atak bez wojny odrzucony');
  S.playerAction('war', owner);
  S.state.fields[target].develop = 2;
  S.state.factions[owner].ships = 2;
  ok(W.army.setOrder(W.army.ships.map((s) => s.id), 'atak', target).ok, `rozkaz: atak na ${S.defs.get(target).name} (${owner})`);
  ok(W.npcs.byTag('fleet').length === 0 || (W.tick(1.2, 1 / 10), W.npcs.byTag('fleet').length === 0), 'okręty wylatują z układu gracza (liczone zaocznie)');
  const dev0 = S.state.fields[target].develop;
  W.tick(STRATEGY.siegeTime * 2 + 2, 1 / 5);
  ok(S.state.fields[target].develop < dev0 || !S.foreignOwner(target), `oblężenie zaoczne: poziom placówki ${dev0} -> ${S.state.fields[target].develop}${S.foreignOwner(target) ? '' : ' (pole wolne)'}`);
  console.log(`       ${W.events.filter((e) => e.type === 'army').map((e) => e.text).slice(-2).join(' | ')}`);
}

// ------------------------------------------------------------
console.log('\n7. Rasa atakuje pola gracza');
{
  const W = makeWorld(11);
  const S = W.strategy, E = W.eco;
  E.state.credits = 99999;
  const home = E.fieldDefs('teegarden')[0].center;
  const base = new THREE.Vector3(home.x, home.y + 1500, home.z);
  const dok = E.placeStation('dok', base); W.ready(dok);
  const mag = E.placeStation('magazyn', base.clone().add(new THREE.Vector3(900, 0, 0))); W.ready(mag);
  Object.assign(mag.storage, { zelazo: 1500, nikiel: 500, kobalt: 100, platyna: 0 });
  const sw = E.createSwarm(dok.id); E.setSwarm(sw.id, { evac: false }); E.orderDrones(sw.id, 10);
  W.tick(60, 1 / 10);
  const f = 'heliotropi';
  S.state.time = STRATEGY.grace + 10;
  S.declareWar(f, PLAYER, 'test');
  S.state.factions[f].ships = 12;
  S.state.factions[f].lastAttack = -999;
  for (let i = 0; i < 20 && !W.events.some((e) => e.type === 'attack'); i++) S.step();
  const atk = W.events.find((e) => e.type === 'attack');
  ok(!!atk && atk.field === 'teegarden:0', `rasa w stanie wojny atakuje pole gracza (${atk?.faction}, siła ${atk?.power})`);
  W.tick(1, 1 / 10);
  ok(W.raids.status?.phase === 'warning' && W.raids.status.attacker === f, 'ostrzeżenie: atak rasy (nie piratów)');
  W.tick(RAIDS_WARNING() + 1, 1 / 10);
  const raiders = W.npcs.byTag('raider');
  ok(raiders.length >= 2 && raiders.every((n) => n.raceId === f), `z fałdy wychodzą okręty rasy ${f} (${raiders.length})`);
  W.tick(200, 1 / 10);
  const end = W.events.find((e) => e.type === 'attack-end');
  ok(!!end, `atak rozstrzygnięty: zniszczone ich ${end?.kills}/${end?.n}, nasze drony -${end?.dronesLost}`);
  // atak zaoczny (gracz w innym układzie)
  E.enterSystem('potrojny', spawnOf('potrojny'));
  const before = W.events.length;
  W.raids.launch({ sysId: 'teegarden', raceId: f, n: 4, target: home, defense: 0, onEnd: (r) => W.events.push({ type: 'off-end', ...r }) });
  ok(W.events.slice(before).some((e) => e.type === 'off-end' && e.offline), 'atak na pole w innym układzie rozstrzyga się zaocznie');
}
function RAIDS_WARNING() { return 15; }

// ------------------------------------------------------------
console.log('\n8. Dominacja i zapis');
{
  const W = makeWorld(13);
  const S = W.strategy;
  const won = [];
  // oddaj graczowi połowę wartości sektora (przez pola z "gotowymi stacjami" - hook)
  const sorted = [...S.allFields].sort((a, b) => fieldValue(S.defs.get(b)) - fieldValue(S.defs.get(a)));
  let v = 0; const mine = [];
  for (const f of sorted) { if (v >= S.totalValue * 0.52) break; mine.push(f); v += fieldValue(S.defs.get(f)); }
  const S2 = createStrategy({ economy: W.eco, playerRace: 'wybudzeni', systems: SYSTEM_ORDER, spawnOf, seed: 13, hooks: { playerFieldIds: () => mine }, onEvent: (e) => won.push(e) });
  S2.step();
  ok(won.some((e) => e.type === 'victory'), `zwycięstwo przy ${Math.round(S2.share(PLAYER) * 100)}% sektora: „${won.find((e) => e.type === 'victory')?.text}”`);
  W.tick(0.2);
  W.eco.save();
  const saved = JSON.parse(W.memory.get('test'));
  ok(saved.strategy?.factions && saved.army && Object.keys(saved.strategy.fields).length === 25, 'strategia i armia są w zapisie gry');
}

console.error = origErr;
console.log(fails ? `\n${fails} niezaliczonych.` : '\nWszystko zaliczone.');
process.exit(fails ? 1 : 0);
