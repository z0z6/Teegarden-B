// Bezgłowy test grup bojowych i operacji (krok 12c) w Node:
//   npm i three@0.184.0   (raz, katalog wyżej)
//   node step12-dowodztwo/check-military.mjs
//
// Prawdziwe moduły: economy, command (siedziba), strategy, army, npc-ships +
// tactical-ai (walka na żywo), fleet-ops (grupy, misje, łączność, wywiad).
import * as THREE from 'three';

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };

const { spawnOf, SYSTEM_ORDER } = await import('../shared/systems/star-systems.js');
const { generateFields } = await import('../shared/systems/fields.js');
const { createEconomy } = await import('../shared/systems/economy.js');
const { createCommand } = await import('../shared/systems/command.js');
const { createStrategy, PLAYER } = await import('../shared/systems/strategy.js');
const { createArmy } = await import('../shared/systems/army.js');
const { createCombat } = await import('../shared/systems/combat.js');
const { createNpcManager } = await import('../shared/systems/npc-ships.js');
const { createTactics, formationSlot, slotWorld } = await import('../shared/systems/tactical-ai.js');
const { createFleetOps } = await import('../shared/systems/fleet-ops.js');
const { seededRng } = await import('../shared/systems/asteroid-belt.js');
const { WARSHIPS } = await import('../shared/data/economy.js');
const { FORMATIONS, FORMATION_ORDER, OPS } = await import('../shared/data/military.js');
const { buildBattleReport } = await import('../shared/systems/battle-report.js');
const { createRaids } = await import('../shared/systems/raids.js');
const { createWeapons } = await import('../shared/systems/weapons.js');
const { applyDifficulty } = await import('../shared/systems/difficulty.js');
const { STRATEGY, RAIDS, START } = await import('../shared/data/economy.js');
const { REPAIR } = await import('../shared/data/military.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
Math.random = seededRng(4242);

/** Świat: gospodarka + siedziba w Teegarden, strategia, armia, taktyka, NPC, operacje. */
function makeWorld({ seed = 3, live = false, onAttack = null } = {}) {
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  const scene = new THREE.Scene();
  const combat = createCombat(scene);
  const hostiles = [];
  const eco = createEconomy({ scene, storage, random: seededRng(5), combat, getHostiles: () => hostiles, fieldsFor: (id, sp) => generateFields(id, sp), saveKey: 'test12c' });
  eco.enterSystem('teegarden', spawnOf('teegarden'));
  const cmd = createCommand({ economy: eco, combat, getHostiles: () => hostiles, hqName: 'Siedziba', onDecision: () => {}, onEvent: () => {}, random: seededRng(9) });
  cmd.found();
  const homeField = eco.fieldDefs('teegarden')[0].id;
  const strategy = createStrategy({ economy: eco, playerRace: 'wybudzeni', systems: SYSTEM_ORDER, spawnOf, seed,
    hooks: { playerFieldIds: () => [homeField], playerPower: () => army.power(), playerFieldDefense: (f) => 1 + army.fieldDefense(f), attackPlayer: (a) => onAttack?.(a), systemName: (x) => x } });
  strategy.ensure('teegarden');
  const events = [];
  const tactics = live ? createTactics({ combat, onEvent: (e) => { events.push(e); ops?.onTacticEvent(e); } }) : null;
  const player = { position: new THREE.Vector3(0, 0, 90000), quaternion: new THREE.Quaternion(), getVelocity: (o) => o.set(0, 0, 0), isAlive: () => true };
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 1e7);
  const weapons = live ? createWeapons({ scene, combat, camera }) : null; // jak w grze: bronie ras (torpedy Wybudzonych)
  const npcs = createNpcManager(scene, combat, player, { tactics, weapons, getContacts: () => [] });
  let ops = null;
  const army = createArmy({ economy: eco, strategy, npcs, player, playerRace: () => 'wybudzeni', tactics, brainFor: (s) => ops?.brainFor(s) });
  const radio = [], reports = [];
  ops = createFleetOps({ army, strategy, economy: eco, tactics, homeSystem: () => 'teegarden', homeField: () => homeField,
    onEvent: (e) => radio.push(e), onReport: (r) => reports.push(r), rng: seededRng(11) });
  const addShips = (cls, n) => {
    const st = eco.state.army ??= { ships: [], queue: [], nextId: 1, lost: 0, built: 0 };
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = { id: `ok${st.nextId++}`, cls, hull: WARSHIPS[cls].hull, sysId: 'teegarden', order: 'obrona', field: homeField, callsign: `${cls}-${i + 1}` };
      st.ships.push(s); out.push(s.id);
    }
    return out;
  };
  const tick = (sec, dt = 0.25) => {
    for (let t = 0; t < sec; t += dt) {
      if (live) { npcs.update(dt); combat.update(dt); weapons.update(dt); }
      army.update(dt); ops.update(dt); strategy.update(dt);
    }
  };
  // pole rasy w innym układzie (do rajdów zaocznych)
  const foreignElsewhere = () => strategy.allFields.find((f) => strategy.foreignOwner(f) && strategy.systemOf(f) !== 'teegarden');
  const foreignHere = () => strategy.allFields.find((f) => strategy.foreignOwner(f) && strategy.systemOf(f) === 'teegarden');
  return { eco, cmd, strategy, army, ops, npcs, tactics, combat, radio, reports, events, addShips, tick, homeField, foreignElsewhere, foreignHere, player, hostiles };
}

// ------------------------------------------------------------
console.log('\n1. Szyki: sloty są rozłączne, lider w punkcie ramy');
{
  for (const kind of FORMATION_ORDER) {
    const n = 7;
    const pts = [...Array(n)].map((_, i) => formationSlot(kind, i, n).clone());
    let minD = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, pts[i].distanceTo(pts[j]));
    ok(minD > 0.5, `${FORMATIONS[kind].name}: ${n} slotów, najmniejszy odstęp ${minD.toFixed(2)} × spacing`);
  }
  ok(formationSlot('klin', 0, 5).length() === 0 && formationSlot('klin', 1, 5).z < 0, 'klin: lider na czele, skrzydłowi z tyłu');
  const F = { kind: 'linia', spacing: 300, anchor: new THREE.Vector3(100, 0, 0), fwd: new THREE.Vector3(1, 0, 0) };
  const a = slotWorld(F, 0, 3), b = slotWorld(F, 2, 3);
  ok(Math.abs(a.x - 100) < 1e-6 && Math.abs(b.x - 100) < 1e-6 && Math.abs(Math.abs(a.z - b.z) - 600) < 1e-6, 'linia stoi prostopadle do kierunku ramy');
}

// ------------------------------------------------------------
console.log('\n2. Grupa i uderzenie zaoczne na wieże („daj rozkaz i zapomnij”)');
{
  const W = makeWorld();
  const fid = W.foreignElsewhere();
  const owner = W.strategy.foreignOwner(fid);
  W.addShips('krazownik', 2); W.addShips('fregata', 2);
  const g = W.ops.createGroup(W.army.ships.map((s) => s.id), { name: 'Alfa' }).group;
  ok(g && W.army.ships.every((s) => s.group === g.id), `grupa ${g.name}: ${g.ships.length} okr.`);
  const rNo = W.ops.assign(g.id, { kind: 'uderzenie', field: fid, strike: 'obrona', declareWar: true });
  ok(!rNo.ok && !W.strategy.atWar(PLAYER, owner), `placówka poziomu 1 nie ma wież: „${rNo.text}” (bez wojny)`);
  W.strategy.state.fields[fid].develop = 3; // wieże od poziomu 3
  const r0 = W.ops.assign(g.id, { kind: 'uderzenie', field: fid, strike: 'obrona' });
  ok(!r0.ok && r0.needWar === owner, `bez wojny odmowa: „${r0.text}”`);
  const dfn0 = W.strategy.fieldDefense(fid);
  const r = W.ops.assign(g.id, { kind: 'uderzenie', field: fid, strike: 'obrona', declareWar: true });
  ok(r.ok && W.strategy.atWar(PLAYER, owner), `rozkaz z wypowiedzeniem wojny: ${r.text}`);
  ok(g.transit && W.army.ships.every((s) => s.sysId === null && s.transit), `przelot w fałdzie: ETA ${g.transit?.eta.toFixed(0)} s`);
  W.tick(g.transit.eta + 1);
  ok(g.phase === 'akcja' && g.sysId === W.strategy.systemOf(fid), `na miejscu: ${g.sysId}, faza ${g.phase}`);
  W.tick(OPS.roundEvery * 6);
  const rep = W.reports.find((x) => x.group === g.id);
  ok(rep && rep.ok, `raport: ${rep?.text}`);
  const fs = W.strategy.state.fields[fid];
  ok(!fs.owner || (fs.suppressed && W.strategy.fieldDefense(fid) < dfn0), `obrona pola osłabiona: ${dfn0.toFixed(2)} → ${W.strategy.fieldDefense(fid).toFixed(2)}`);
  W.tick(40);
  const gg = W.ops.group(g.id);
  ok(gg && gg.sysId === 'teegarden' && gg.mission?.kind === 'obrona' && gg.formation === 'jez', `po powrocie: obrona bazy w jeżu (${gg?.sysId}, ${gg?.mission?.kind})`);
  ok(W.radio.some((e) => /przyjąłem/.test(e.text)) && W.radio.some((e) => /fałdy/.test(e.text)), `łączność: ${W.radio.length} meldunków, np. „${W.radio[0].text}”`);
}

// ------------------------------------------------------------
console.log('\n3. Zdobycie pola i ROE (ostrożna grupa wycofuje się przy stratach)');
{
  const W = makeWorld({ seed: 5 });
  const fid = W.foreignElsewhere();
  const owner = W.strategy.foreignOwner(fid);
  W.strategy.declareWar(PLAYER, owner);
  W.addShips('krazownik', 5);
  const g = W.ops.createGroup(W.army.ships.map((s) => s.id)).group;
  W.ops.assign(g.id, { kind: 'zdobycie', field: fid, roe: 'agresywna' });
  W.tick(200);
  ok(W.strategy.foreignOwner(fid) !== owner, `silna grupa zdobywa ${fid}: właściciel ${W.strategy.foreignOwner(fid) ?? 'brak (pole wolne)'}`);
  const rep = W.reports.find((x) => x.group === g.id);
  ok(rep?.ok, `raport: ${rep?.text}`);

  const W2 = makeWorld({ seed: 5 });
  const fid2 = W2.foreignElsewhere();
  const o2 = W2.strategy.foreignOwner(fid2);
  W2.strategy.declareWar(PLAYER, o2);
  W2.strategy.state.fields[fid2].develop = 5;
  W2.strategy.state.factions[o2].ships = 20;
  W2.addShips('eskorta', 2);
  const g2 = W2.ops.createGroup(W2.army.ships.map((s) => s.id)).group;
  W2.ops.assign(g2.id, { kind: 'zdobycie', field: fid2, roe: 'ostrozna' });
  W2.tick(150);
  const rep2 = W2.reports.find((x) => x.group === g2.id);
  ok(rep2 && !rep2.ok && /odwrót/.test(rep2.text) && W2.ops.group(g2.id), `słaba, ostrożna grupa zrywa kontakt i przeżywa: ${rep2?.text}`);
}

// ------------------------------------------------------------
console.log('\n4. Zwiad: wywiad, odkrycie pól, premia w starciu');
{
  const W = makeWorld({ seed: 7 });
  const fid = W.foreignElsewhere();
  W.addShips('eskorta', 3); W.addShips('krazownik', 1);
  const pick = W.ops.suggestShips({ kind: 'zwiad', field: fid });
  ok(pick.length === 2 && pick.every((id) => W.army.byId(id).cls === 'eskorta'), `dobór do zwiadu: najszybsze okręty (${pick.map((id) => W.army.byId(id).cls).join(', ')})`);
  const g = W.ops.createGroup(pick).group;
  const r = W.ops.assign(g.id, { kind: 'zwiad', field: fid });
  ok(r.ok && !W.strategy.atWar(PLAYER, W.strategy.foreignOwner(fid)), 'zwiad nie wymaga wojny i jej nie wywołuje');
  W.tick(120);
  const i = W.ops.intel(fid);
  ok(i && i.owner === W.strategy.foreignOwner(fid) && i.defense > 0, `wywiad: ${i?.owner}, poziom ${i?.develop}, obrona ${i?.defense}`);
  ok(W.ops.intelFresh(fid), 'wywiad jest świeży (premia do uderzenia)');
  ok(W.eco.state.ops.pending[W.strategy.systemOf(fid)]?.length > 0, 'pola układu czekają na odkrycie przy wejściu gracza');
  const need = W.ops.suggestShips({ kind: 'zdobycie', field: fid });
  ok(need.length >= 1, `dobór składu na szturm po zwiadzie: ${need.length} okr.`);
}

// ------------------------------------------------------------
console.log('\n5. Operacja skoordynowana: godzina H');
{
  const W = makeWorld({ seed: 9 });
  const fid = W.foreignElsewhere();
  W.strategy.declareWar(PLAYER, W.strategy.foreignOwner(fid));
  const a = W.addShips('eskorta', 2), b = W.addShips('krazownik', 2);
  const ga = W.ops.createGroup(a).group, gb = W.ops.createGroup(b).group;
  const r = W.ops.launchOperation([ga.id, gb.id], { kind: 'uderzenie', field: fid, strike: 'gospodarka' });
  ok(r.ok && ga.mission.op && ga.mission.op === gb.mission.op, `operacja ${r.op}: ${r.text}`);
  ok(ga.transit.eta < gb.transit.eta, `eskortowce szybsze (${ga.transit.eta.toFixed(0)} s vs ${gb.transit.eta.toFixed(0)} s)`);
  W.tick(ga.transit.eta + 1);
  ok(ga.phase === 'zbiorka' && gb.transit, 'szybsza grupa czeka na zbiórce');
  W.tick(gb.transit.eta + 1);
  ok(ga.phase === 'akcja' && gb.phase === 'akcja', 'godzina H: obie grupy w akcji naraz');
  ok(W.radio.some((e) => /godzina H/.test(e.text)), 'meldunek „godzina H”');
  const cr0 = W.strategy.state.factions[W.strategy.foreignOwner(fid)]?.credits ?? 0;
  W.tick(OPS.roundEvery * 5);
  const fs = W.strategy.state.fields[fid];
  ok(W.reports.some((x) => x.group === ga.id), `raport operacji: ${W.reports.find((x) => x.group === ga.id)?.text}`);
  ok(!fs.owner || fs.disrupted, `doki trafione: dochód pola ×${fs.disrupted?.mul ?? '—'}`);
}

// ------------------------------------------------------------
console.log('\n6. Na żywo: szyk obronny, łącze danych, wezwanie wsparcia');
{
  const W = makeWorld({ seed: 11, live: true });
  const def = W.addShips('fregata', 3);
  const pat = W.addShips('eskorta', 3);
  const gd = W.ops.createGroup(def, { name: 'Tarcza' }).group;
  const gp = W.ops.createGroup(pat, { name: 'Włócznia' }).group;
  W.ops.assign(gd.id, { kind: 'obrona', field: W.homeField, formation: 'jez' });
  W.ops.assign(gp.id, { kind: 'patrol', field: W.homeField });
  W.tick(3);
  ok(W.army.spawned.size === 6, `okręty grup w układzie jako NPC (${W.army.spawned.size})`);
  ok([...W.army.spawned.values()].every((n) => n.brain?.base === 'fleet'), 'mózgi: baza fleet');
  W.tick(40);
  const F = W.ops.frame(gd.id);
  const sq = W.tactics.squad(`grp-${gd.id}`);
  const dists = def.map((id) => { const n = W.army.spawned.get(id); return n.group.position.distanceTo(slotWorld(F, n.brain.fslot, sq.fN)); });
  ok(Math.max(...dists) < 400, `jeż się ułożył: okręty ≤ ${Math.max(...dists).toFixed(0)} j. od slotów`);
  // napad: silna eskadra wrogów przy polu obrony
  const c = new THREE.Vector3().copy(F.anchor);
  for (let i = 0; i < 7; i++) {
    W.npcs.spawn({ raceId: 'heliotropi', factionKey: 'hawk', side: 'hostile', position: c.clone().add(new THREE.Vector3(1800 + i * 120, 100, 400 - i * 150)),
      arrival: 'none', mode: 'tactical', hull: 520, ai: { base: 'hunt', squad: 'napad' } });
  }
  let fired = 0;
  const origFire = W.combat.fire;
  W.combat.fire = (o) => { if (o.side === 'ally') fired++; return origFire(o); };
  W.tick(25);
  ok(fired > 0, `obrońcy strzelają z szyku (${fired} strzałów)`);
  const seen = W.tactics.netContacts('flota');
  ok(seen && seen.size >= 5, `łącze danych: flota widzi ${seen?.size} wrogów`);
  ok(W.events.some((e) => e.type === 'support'), 'przegrywająca eskadra wzywa wsparcia');
  ok(W.radio.some((e) => /wezwanie|wsparcie/.test(e.text)), `łączność: „${W.radio.find((e) => /wezwanie/.test(e.text))?.text ?? W.radio.find((e) => /wsparcie/.test(e.text))?.text}”`);
  ok(gp.support || W.radio.some((e) => /Włócznia: przyjąłem wezwanie/.test(e.text)), 'patrol odpowiada na wezwanie');
}

// ------------------------------------------------------------
console.log('\n7. Na żywo: uderzenie na placówkę w układzie gracza');
{
  const W = makeWorld({ seed: 3, live: true });
  const fid = W.foreignHere();
  ok(!!fid, `pole rasy w układzie siedziby: ${fid}`);
  if (fid) {
    const owner = W.strategy.foreignOwner(fid);
    W.strategy.declareWar(PLAYER, owner);
    W.strategy.state.fields[fid].develop = 3;
    const outposts = { stations: [{ type: 'wieza', alive: true }, { type: 'dok', alive: true }] };
    const fakeRival = { outpostInfo: () => ({ owner, byType: Object.fromEntries(outposts.stations.filter((s) => s.alive).map((s) => [s.type, 1])),
      stations: outposts.stations.filter((s) => s.alive).length, towers: outposts.stations.filter((s) => s.alive && s.type === 'wieza').length, drones: 0, patrols: 0 }) };
    const ops2 = createFleetOps({ army: W.army, strategy: W.strategy, economy: W.eco, tactics: W.tactics, rival: fakeRival,
      homeSystem: () => 'teegarden', homeField: () => W.homeField, onEvent: (e) => W.radio.push(e), onReport: (r) => W.reports.push(r) });
    const g = ops2.createGroup(W.addShips('fregata', 3)).group;
    ops2.assign(g.id, { kind: 'uderzenie', field: fid, strike: 'obrona' });
    ok(g.phase === 'akcja' && !g.transit, 'cel w tym samym układzie: bez skoku, od razu akcja');
    ops2.update(0.1);
    const F = ops2.frame(g.id);
    ok(F && F.posture === 'offensive' && F.kind === 'linia', `rama szyku: ${F?.kind}, ${F?.posture}`);
    outposts.stations[0].alive = false; // wieża zniszczona
    ops2.update(0.1);
    ok(g.mission?.kind === 'obrona' && W.strategy.state.fields[fid].suppressed, `wieże zniszczone → powrót do obrony bazy i osłabiona obrona pola (${g.mission?.kind})`);
    ok(W.reports.some((x) => x.group === g.id && x.ok), `raport: ${W.reports.find((x) => x.group === g.id)?.text}`);
  }
}


// ------------------------------------------------------------
console.log('\n8. Raport z potyczki: werdykty');
{
  const ships = (ids) => ids.map((id) => ({ id, callsign: id, cls: 'fregata', hull: 420 }));
  const base = { n: 6, raceName: 'Rezonanci', faction: 'Kworum', killsBy: { flota: 4, obrona: 2 }, dronesLost: 0, stolen: 0,
    before: { ships: ships(['a', 'b', 'c']), stations: [] }, after: { ships: ships(['a', 'b', 'c']), stations: [] },
    race: { name: 'Rezonanci', shipsBefore: 12, shipsAfter: 6, ourPower: 14, theirPower: 7, atWar: true } };
  const r1 = buildBattleReport({ ...base, kills: 6, fled: 0 });
  ok(r1.verdict === 'rozbity' && r1.advantage && /rozbiła/.test(r1.text), `wszyscy zestrzeleni: „${r1.title}” — ${r1.text}`);
  const r2 = buildBattleReport({ ...base, kills: 3, fled: 3, stolen: 20, race: { ...base.race, ourPower: 8, theirPower: 9 } });
  ok(r2.verdict === 'przegoniony' && /przegoniła/.test(r2.text) && !r2.advantage, `część uciekła bez łupu: „${r2.title}” — ${r2.text}`);
  const r3 = buildBattleReport({ ...base, kills: 1, fled: 5, sated: true, dronesLost: 6, stolen: 300, after: { ships: ships(['a']).map((x) => ({ ...x, hull: 100 })), stations: [] } });
  ok(r3.verdict === 'porazka' && r3.lostShips.length === 2 && r3.tone === 'danger', `łup i ciężkie straty: „${r3.title}” (stracone ${r3.lostShips.join(', ')})`);
  const r4 = buildBattleReport({ ...base, kills: 0, fled: 6, sated: true, stolen: 200, before: { ships: [], stations: [] }, after: { ships: [], stations: [] } });
  ok(r4.verdict === 'lup' && /Floty nie było/.test(r4.text), `bez floty: ${r4.text}`);
  const r5 = buildBattleReport({ offline: true, repelled: true, n: 4, kills: 4, raceName: 'Heliotropi', systemName: 'Bliźnięta' });
  ok(r5.verdict === 'rozbity' && /bez nas/.test(r5.text), `zaocznie: ${r5.text}`);
  ok(r1.rows.some((x) => x.label === 'Kto strzelał' && /flota 4/.test(x.value)) && r1.rows.some((x) => /Flota rasy/.test(x.label) && /12 → 6/.test(x.value)), 'wiersze: kto strzelał, flota rasy przed → po');
}

// ------------------------------------------------------------
console.log('\n9. Nalot rasy na siedzibę: flota broni, raport z przypisaniem zestrzeleń');
{
  const W = makeWorld({ seed: 13, live: true });
  const g = W.ops.createGroup([...W.addShips('krazownik', 3), ...W.addShips('fregata', 2)], { name: 'Tarcza' }).group;
  W.ops.assign(g.id, { kind: 'obrona', field: W.homeField, formation: 'jez' });
  const reports = [];
  const raids = createRaids({ economy: W.eco, npcs: W.npcs, rng: seededRng(3),
    snapshot: (sys) => ({ ships: W.army.ships.filter((s) => s.sysId === sys).map((s) => ({ id: s.id, callsign: s.callsign, cls: s.cls, hull: s.hull })), stations: [] }),
    onReport: (r) => reports.push(r) });
  W.tick(5);
  const shots = { ally: 0, hostile: 0 }, hits = { n: 0 };
  const of = W.combat.fire; W.combat.fire = (o) => { shots[o.side] = (shots[o.side] ?? 0) + 1; return of(o); };
  W.npcs.on('hit', () => hits.n++);
  const c = W.strategy.defs.get(W.homeField).center;
  raids.launch({ sysId: 'teegarden', raceId: 'heliotropi', factionKey: 'hawk', n: 4, target: c, defense: 3 });
  for (let t = 0; t < 240 && !reports.length; t += 0.25) {
    W.tick(0.25); raids.update(0.25);
    if (process.env.DBG && Math.round(t * 4) % 60 === 0) {
      const F = W.ops.frame(g.id);
      const foes = W.npcs.hostiles();
      const ours = g.ships.map((id) => W.army.spawned.get(id)).filter(Boolean);
      console.log(t.toFixed(0), 'raid', raids.status?.phase, 'foes', foes.map((n) => `${n.brain?.plan}/${Math.round(n.group.position.distanceTo(F?.anchor ?? new THREE.Vector3()))}/${Math.round(n.hull)}`).join(' '),
        '| ours', ours.map((n) => `${n.brain?.plan}/${n.brain?.enemies.length}`).join(' '), 'leash', F?.leash, F?.posture);
    }
  }
  const r = reports[0];
  if (process.env.DBG) console.log('strzały', shots, 'trafienia', hits.n, 'bolts', W.combat.boltCount);
  ok(!!r, `nalot zakończony po walce (${r ? Math.round(r.duration) : '?'} s)`);
  if (r) {
    ok(r.kills > 0 && (r.killsBy.flota ?? 0) > 0, `zestrzelenia według strzelca: ${JSON.stringify(r.killsBy)} (${r.kills}/${r.n})`);
    ok(r.before?.ships.length === 5 && r.after, 'migawka floty przed i po');
    const rep = buildBattleReport({ ...r, race: null });
    ok(['rozbity', 'przegoniony'].includes(rep.verdict), `werdykt: ${rep.title} — ${rep.text}`);
  }
}

// ------------------------------------------------------------
console.log('\n10. Naprawy: siedziba, pauza pod ostrzałem, remont przyspieszony, stacje, grupa na naprawę');
{
  const W = makeWorld({ seed: 17 });
  const [a, b] = W.addShips('fregata', 2);
  W.tick(1.5); // sync: NPC w układzie
  const A = W.army.byId(a), B = W.army.byId(b);
  const hurt = (S, h) => { S.hull = h; const n = W.army.spawned.get(S.id); if (n) n.hull = h; }; // obrażenia trafiają w NPC
  hurt(A, 210); hurt(B, 210); // 50%
  const info = W.army.repairInfo(A);
  ok(info.site === 'siedziba' && info.rate > 0 && info.damaged, `bez stoczni naprawia siedziba: ${info.rate * 100}%/s, ok. ${Math.ceil(info.eta / 60)} min`);
  W.army.spawned.get(b).sinceHit = 0; // B pod ostrzałem
  W.tick(20);
  ok(A.hull > 230 && Math.abs(B.hull - 210) < 1, `naprawa polowa: A ${Math.round(A.hull)}, B (pod ostrzałem) ${Math.round(B.hull)} — ekipy czekają`);
  W.army.spawned.get(b).sinceHit = 99;
  W.eco.state.credits = 50;
  const poor = W.army.rushRepair([a, b]);
  ok(!poor.ok && /Brak środków/.test(poor.text), `bez kredytów: „${poor.text}”`);
  W.eco.state.credits = 5000;
  const cost = W.army.repairCost([a, b]);
  const cr0 = W.eco.state.credits;
  const r = W.army.rushRepair([a, b]);
  ok(r.ok && W.eco.state.credits === cr0 - cost.credits && cost.zelazo > 0, `remont przyspieszony: ${r.text} (koszt ${cost.credits} kr, ${cost.zelazo} t Fe)`);
  W.tick(25);
  ok(A.hull === 420 && B.hull === 420 && !A.rush, 'po ok. 20 s obie fregaty w pełni sprawne');
  const again = W.army.rushRepair([a]);
  ok(!again.ok && /sprawna/.test(again.text), `sprawnych nie ma czego naprawiać: „${again.text}”`);
  // okręt poza zapleczem
  const [c] = W.addShips('eskorta', 1);
  const C = W.army.byId(c); C.sysId = W.strategy.systemOf(W.foreignElsewhere()); C.hull = 60;
  ok(!W.army.repairInfo(C).site && !W.army.rushRepair([c]).ok, 'poza zapleczem: brak naprawy, remont odmówiony');

  // stacje: splądrowana huta wraca do pracy od razu
  const huta = W.eco.stationsIn('teegarden').find((x) => x.type === 'huta');
  huta.hull = 100; huta.immune = 60;
  ok(W.eco.damagedStations('teegarden').includes(huta), 'huta na liście do naprawy');
  const rs = W.eco.rushStationRepair('teegarden');
  ok(rs.ok && huta.immune === 0 && huta.rush, `remont stacji: ${rs.text}`);
  for (let i = 0; i < 80; i++) W.eco.update(0.25);
  ok(!huta.rush && W.eco.damagedStations('teegarden').length === 0, `kadłub huty odbudowany (${Math.round(huta.hull)})`);

  // grupa z daleka: "Na naprawę" = powrót i remont po przylocie
  const fid = W.foreignElsewhere();
  W.strategy.declareWar(PLAYER, W.strategy.foreignOwner(fid));
  const g = W.ops.createGroup([a, b], { name: 'Kowal' }).group;
  W.ops.assign(g.id, { kind: 'zdobycie', field: fid });
  W.tick(g.transit.eta + 1);
  for (const s of [A, B]) s.hull = 200;
  const rr = W.ops.repair(g.id);
  ok(rr.ok && g.phase === 'powrot' && g.repairOnReturn, `rozkaz z daleka: ${rr.text}`);
  W.tick(g.transit.eta + 1);
  ok(g.sysId === 'teegarden' && (A.rush || A.hull > 400), `po przylocie remont przyspieszony (${A.rush ? 'w toku' : 'gotowe'})`);
  ok(W.radio.some((e) => /remont przyspieszony w toku/.test(e.text)), 'meldunek grupy o remoncie');
  const set = W.ops.setAutoRush(g.id, true);
  ok(set.ok && W.ops.groups().find((x) => x.id === g.id).autoRush, `auto-remont po misji: ${set.text}`);
}

// ------------------------------------------------------------
console.log('\n11. Poziomy trudności: stałe gry i przebieg wojny z rasami');
{
  const base = { grace: STRATEGY.grace, raid: RAIDS.base, fr: WARSHIPS.fregata.cost.credits, yard: REPAIR.yardRate, start: START.credits };
  applyDifficulty('latwa');
  ok(STRATEGY.grace === 1200 && RAIDS.base < base.raid && WARSHIPS.fregata.cost.credits < base.fr && REPAIR.yardRate > base.yard && START.credits > base.start,
    `łatwy: ochrona ${STRATEGY.grace / 60} min, fregata ${WARSHIPS.fregata.cost.credits} kr, stocznia ${(REPAIR.yardRate * 100).toFixed(1)}%/s, start ${START.credits} kr`);
  applyDifficulty('trudna');
  ok(STRATEGY.grace === 420 && RAIDS.base > base.raid && WARSHIPS.fregata.cost.credits > base.fr && RAIDS.raiderHull === 150,
    `trudny: ochrona ${STRATEGY.grace / 60} min, fregata ${WARSHIPS.fregata.cost.credits} kr, rabuś ${RAIDS.raiderHull} kadłuba`);
  applyDifficulty('trudna'); applyDifficulty('normalna');
  ok(STRATEGY.grace === base.grace && RAIDS.base === base.raid && WARSHIPS.fregata.cost.credits === base.fr && REPAIR.yardRate === base.yard && STRATEGY.attackMul === 1,
    'przełączanie w kółko wraca do wartości bazowych (bez kumulowania)');

  // 30 min wojny ze wszystkimi rasami - ile ataków, jak silnych, ile propozycji pokoju
  const sim = (key) => {
    applyDifficulty(key);
    const attacks = [];
    const W = makeWorld({ seed: 21, onAttack: (a) => attacks.push(a.power) });
    W.strategy.state.time = STRATEGY.grace + 1;
    for (const f of Object.keys(W.strategy.state.factions)) W.strategy.declareWar(f, PLAYER);
    for (let t = 0; t < 1800; t += 1) W.strategy.update(1);
    const fid = W.foreignElsewhere();
    return { n: attacks.length, power: attacks.reduce((a, b) => a + b, 0), def: fid ? W.strategy.fieldDefense(fid) : 0, credits: W.eco.state.credits };
  };
  const E = sim('latwa'), N = sim('normalna'), H = sim('trudna');
  applyDifficulty('normalna');
  const line = (x) => `${x.n} ataków, łącznie ${x.power} okr.`;
  console.log(`       łatwy: ${line(E)} · średni: ${line(N)} · trudny: ${line(H)}`);
  ok(E.power < N.power && N.power < H.power, 'łączna siła ataków rośnie z poziomem');
  ok(E.n <= N.n && N.n <= H.n, 'ataki są częstsze na wyższym poziomie');
  ok(E.credits > N.credits && N.credits > H.credits, `kredyty na start: ${E.credits} / ${N.credits} / ${H.credits}`);
}

console.log(fails ? `\n${fails} błędów.` : '\nWszystko działa.');
process.exit(fails ? 1 : 0);
