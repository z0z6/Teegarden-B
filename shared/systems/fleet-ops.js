import * as THREE from 'three';
import { WARSHIPS } from '../data/economy.js';
import { RACES } from '../data/races.js';
import { FORMATIONS, ROE, MISSIONS, STRIKE_TARGETS, OPS, GROUP_NAMES } from '../data/military.js';
import { PLAYER } from './strategy.js';

/**
 * GRUPY BOJOWE I OPERACJE (krok 12c): "daj rozkaz i zapomnij".
 *
 * army.js zna pojedyncze okręty i trzy proste rozkazy. Tu okręty łączą się
 * w GRUPY (s.group), a grupa dostaje MISJĘ i prowadzi ją sama, faza po fazie:
 *
 *   przelot (fałda między układami) -> zbiórka (czekanie na resztę operacji,
 *   "godzina H") -> akcja -> powrót -> raport (karta decyzji) -> obrona bazy
 *
 * Misje: obrona pola, patrol, zwiad, uderzenie na infrastrukturę (wieże /
 * doki / drony), zdobycie pola. Grupa ma SZYK (military.js FORMATIONS) i
 * ZASADY UŻYCIA SIŁY (ROE: kiedy się wycofać).
 *
 * Dwa sposoby rozstrzygania, jak w army.js:
 *   NA ŻYWO   - grupa w układzie gracza: okręty to NPC z mózgiem 'fleet'
 *               (tactical-ai.js). Ten moduł prowadzi RAMĘ szyku (punkt,
 *               kierunek, prędkość) i sprawdza cel misji (rival.outpostInfo),
 *   ZAOCZNIE  - grupa gdzie indziej: rundy co OPS.roundEvery s, siła grupy
 *               (× szyk × ROE × świeży zwiad × kilka grup naraz) kontra obrona
 *               pola ze strategii.
 *
 * ŁĄCZNOŚĆ: wszystkie okręty gracza są w sieci 'flota' (wspólny obraz celów,
 * tactical-ai.js). Eskadra, która przegrywa, woła o wsparcie - tu wybieramy
 * najbliższą grupę z misją obrony/patrolu i kierujemy ją na miejsce. Grupy
 * meldują się przez `onEvent` (dziennik łączności w stanie, ostatnie 40).
 *
 * WYWIAD: zwiad zapisuje stan pola (właściciel, poziom, wieże, okręty) z
 * czasem obserwacji; świeży wywiad daje premię w starciu i dobór składu.
 *
 * Stan w economy.state.ops (w zapisie gry). Czysta logika + three.js (Node).
 */

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const plain = (v) => ({ x: v.x, y: v.y, z: v.z });

export function createFleetOps({
  army, strategy, economy, tactics = null, rival = null,
  homeSystem = () => economy.state.command?.home ?? economy.systemId,
  homeField = () => economy.fieldDefs(homeSystem())[0]?.id ?? null,
  systemName = (id) => id,
  onEvent = () => {}, onReport = () => {}, rng = Math.random,
}) {
  const frames = new Map();   // gid -> rama szyku (runtime, nie w zapisie)
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();

  const state = () => {
    const st = (economy.state.ops ??= { groups: [], nextId: 1, nextOp: 1, intel: {}, log: [], clock: 0, pending: {} });
    st.pending ??= {};
    return st;
  };
  const clock = () => state().clock;
  const groups = () => state().groups;
  const group = (gid) => groups().find((g) => g.id === gid) ?? null;
  const shipsOf = (g) => g.ships.map((id) => army.byId(id)).filter(Boolean);
  const squadId = (g) => `grp-${g.id}`;
  const fieldName = (fid) => strategy.defs.get(fid)?.name ?? fid;
  const here = () => economy.systemId;
  const isLive = (g) => g.sysId && g.sysId === here() && !g.transit;

  // ------------------------------------------------------------
  // ŁĄCZNOŚĆ
  // ------------------------------------------------------------
  function radio(g, text, urgency = 'info', extra = {}) {
    const st = state();
    const who = g ? `${g.name}` : 'Dowództwo floty';
    st.log.unshift({ t: Math.round(st.clock), g: g?.id ?? null, who, text, urgency });
    st.log.length = Math.min(st.log.length, OPS.maxLog);
    onEvent({ key: `ops-${g?.id ?? 'hq'}-${extra.key ?? 'r'}`, urgency, text: `${who}: ${text}`, group: g?.id ?? null, ...extra });
  }

  // ------------------------------------------------------------
  // SIŁA
  // ------------------------------------------------------------
  const shipPower = (s) => WARSHIPS[s.cls].power * (s.hull / WARSHIPS[s.cls].hull);
  function groupPower(g) {
    const mods = army.mods?.() ?? { power: 1 };
    return shipsOf(g).reduce((a, s) => a + shipPower(s), 0) * (mods.power ?? 1);
  }
  function slowest(g) {
    const list = shipsOf(g);
    return list.length ? Math.min(...list.map((s) => WARSHIPS[s.cls].speed)) : 1;
  }
  const travelTime = (g, from, to) => (from === to ? 0 : OPS.travelBase / slowest(g) / (FORMATIONS[g.formation]?.travel ?? 1));

  // ------------------------------------------------------------
  // WYWIAD
  // ------------------------------------------------------------
  const intelFresh = (fid) => {
    const i = state().intel[fid];
    return i && clock() - i.t < OPS.intelFresh ? i : null;
  };
  function gatherIntel(fid, { live = false } = {}) {
    const fs = strategy.state.fields[fid];
    const owner = strategy.foreignOwner(fid);
    const info = live ? rival?.outpostInfo?.(fid) : null;
    const f = owner ? strategy.state.factions[owner] : null;
    const rec = {
      t: clock(), owner: owner ?? null, develop: fs?.develop ?? 0,
      defense: owner ? +strategy.fieldDefense(fid).toFixed(2) : 0,
      ships: f?.ships ?? 0, byType: info?.byType ?? null, patrols: info?.patrols ?? null, drones: info?.drones ?? null,
      atWar: owner ? strategy.atWar(PLAYER, owner) : false,
    };
    state().intel[fid] = rec;
    // przelot przez układ odkrywa jego pola (dla dronów i budowy)
    const sys = strategy.systemOf(fid);
    const fids = strategy.bySystem.get(sys) ?? [fid];
    if (sys === here()) for (const x of fids) economy.discoverField?.(x, { silent: true });
    else if (economy.state.systems?.[sys]) for (const x of fids) (economy.state.systems[sys].discovered ??= {})[x] = true;
    else state().pending[sys] = fids;
    return rec;
  }

  // ------------------------------------------------------------
  // GRUPY
  // ------------------------------------------------------------
  function createGroup(shipIds, { name = null, formation = 'klin', roe = 'zrownowazona' } = {}) {
    const list = shipIds.map((id) => army.byId(id)).filter(Boolean);
    if (!list.length) return { ok: false, text: 'Wybierz okręty do grupy.' };
    if (list.some((s) => s.transit)) return { ok: false, text: 'Okręt w fałdzie — poczekaj na przylot.' };
    const sys = list[0].sysId;
    if (list.some((s) => s.sysId !== sys)) return { ok: false, text: 'Grupę tworzą okręty z jednego układu.' };
    const st = state();
    for (const s of list) if (s.group) removeFromGroup(s.id, true);
    const n = st.nextId++;
    const g = {
      id: `g${n}`, name: name ?? GROUP_NAMES[(n - 1) % GROUP_NAMES.length] + (n > GROUP_NAMES.length ? `-${Math.ceil(n / GROUP_NAMES.length)}` : ''),
      ships: list.map((s) => s.id), formation, roe, sysId: sys, mission: null, phase: 'postoj', t: 0,
      stats: { lost: 0, stations: 0, drones: 0, rounds: 0 },
    };
    st.groups.push(g);
    for (const s of list) { s.group = g.id; s.order = 'grupa'; }
    for (const s of list) army.rebrain?.(s.id);
    economy.save?.();
    radio(g, `grupa sformowana: ${list.length} okr., szyk ${FORMATIONS[formation].name.toLowerCase()}.`);
    return { ok: true, text: `Grupa ${g.name}: ${list.length} okr.`, group: g };
  }

  function removeFromGroup(shipId, silent = false) {
    const s = army.byId(shipId);
    const g = s && group(s.group);
    if (!g) return false;
    g.ships = g.ships.filter((id) => id !== shipId);
    delete s.group;
    if (s.sysId) { s.order = 'obrona'; s.field = s.sysId === homeSystem() ? homeField() : ownFieldIn(s.sysId); if (!s.field) s.order = 'eskorta'; }
    army.rebrain?.(shipId);
    if (!g.ships.length) dropGroup(g, silent);
    return true;
  }
  function dropGroup(g, silent) {
    const st = state();
    st.groups.splice(st.groups.indexOf(g), 1);
    frames.delete(g.id);
    if (!silent) radio(null, `grupa ${g.name} rozwiązana.`);
  }
  function ownFieldIn(sysId) { return strategy.fieldsOf(PLAYER).find((f) => strategy.systemOf(f) === sysId) ?? null; }

  /** Rozwiązanie grupy: na miejscu od razu, z daleka - po powrocie. */
  function disband(gid) {
    const g = group(gid);
    if (!g) return { ok: false, text: 'Nie ma takiej grupy.' };
    if (g.transit || g.sysId !== homeSystem()) { g.disbandOnReturn = true; startReturn(g, 'rozkaz'); return { ok: true, text: `${g.name} wraca do bazy i tam się rozwiąże.` }; }
    for (const id of [...g.ships]) removeFromGroup(id, true);
    if (groups().includes(g)) dropGroup(g, true);
    economy.save?.();
    return { ok: true, text: `Grupa ${g.name} rozwiązana — okręty bronią pola.` };
  }

  function setFormation(gid, kind) {
    const g = group(gid);
    if (!g || !FORMATIONS[kind]) return { ok: false, text: 'Nieznany szyk.' };
    g.formation = kind;
    const F = frames.get(g.id);
    if (F) applyFormation(g, F);
    radio(g, `zmiana szyku: ${FORMATIONS[kind].name.toLowerCase()}.`);
    economy.save?.();
    return { ok: true, text: `${g.name}: szyk ${FORMATIONS[kind].name}.` };
  }
  function setRoe(gid, roe) {
    const g = group(gid);
    if (!g || !ROE[roe]) return { ok: false, text: 'Nieznane zasady.' };
    g.roe = roe;
    for (const id of g.ships) army.rebrain?.(id);
    economy.save?.();
    return { ok: true, text: `${g.name}: zasady ${ROE[roe].name.toLowerCase()}.` };
  }

  // ------------------------------------------------------------
  // MISJE
  // ------------------------------------------------------------
  /**
   * Rozkaz dla grupy. m = { kind, field, strike, op, declareWar }.
   * Zwraca { ok, text }.
   */
  function assign(gid, m) {
    const g = group(gid);
    if (!g) return { ok: false, text: 'Nie ma takiej grupy.' };
    const def = MISSIONS[m.kind];
    if (!def) return { ok: false, text: 'Nieznana misja.' };
    const fid = m.field ?? (def.target === 'own' ? homeField() : null);
    if (!fid || !strategy.defs.has(fid)) return { ok: false, text: 'Wybierz pole docelowe.' };
    const owner = strategy.foreignOwner(fid);
    if (def.target === 'own' && owner) return { ok: false, text: `${fieldName(fid)} nie jest twoim polem.` };
    const strikeDef = m.kind === 'uderzenie' ? STRIKE_TARGETS[m.strike ?? 'obrona'] : null;
    const lvl = strategy.state.fields[fid]?.develop ?? 0;
    if (strikeDef?.minDevelop && owner && lvl < strikeDef.minDevelop) {
      return { ok: false, text: `Placówka na polu ${fieldName(fid)} nie ma wież (poziom ${lvl}). Uderz w doki albo drony — albo od razu zdobądź pole.` };
    }
    if (def.target === 'foreign') {
      if (!owner) return { ok: false, text: `${fieldName(fid)} nie należy do żadnej rasy — nie ma czego atakować.` };
      if (!strategy.atWar(PLAYER, owner)) {
        if (!m.declareWar) return { ok: false, text: `Atak na rasę ${RACES[owner].name} wymaga wojny.`, needWar: owner };
        strategy.declareWar(PLAYER, owner, 'uderzenie floty');
      }
    }
    if (m.kind === 'uderzenie' && !STRIKE_TARGETS[m.strike ?? 'obrona']) return { ok: false, text: 'Wybierz cel uderzenia.' };
    if (!g.ships.length) return { ok: false, text: 'Grupa nie ma okrętów.' };
    g.mission = {
      kind: m.kind, field: fid, strike: m.kind === 'uderzenie' ? (m.strike ?? 'obrona') : null, op: m.op ?? null,
      owner: owner ?? null, startPower: groupPower(g), startShips: g.ships.length, since: clock(), result: null,
      start: rival?.outpostInfo?.(fid) ?? null,
    };
    g.stats = { lost: 0, stations: 0, drones: 0, rounds: 0 };
    g.support = null;
    g.roundT = OPS.roundEvery;
    g.dwell = OPS.scoutDwell;
    if (m.formation && FORMATIONS[m.formation]) g.formation = m.formation;
    else if (!m.keepFormation) g.formation = def.formation === 'kleszcze' && g.ships.length < 4 ? 'klin' : def.formation;
    if (m.roe && ROE[m.roe]) g.roe = m.roe;
    const dest = strategy.systemOf(fid);
    // okręty obrony liczą się do obrony pola w strategii (army.fieldDefense)
    for (const s of shipsOf(g)) {
      if (m.kind === 'obrona') { s.order = 'obrona'; s.field = fid; } else { s.order = 'grupa'; s.field = fid; }
    }
    if (g.sysId !== dest) { g.phase = 'przelot'; startTransit(g, dest); } else enterAction(g);
    for (const id of g.ships) army.rebrain?.(id);
    const F = frames.get(g.id);
    if (F) applyFormation(g, F);
    economy.save?.();
    const tgt = owner ? ` — ${RACES[owner].name}` : '';
    const what = m.kind === 'uderzenie' ? `${def.name.toLowerCase()} (${STRIKE_TARGETS[g.mission.strike].name.toLowerCase()})` : def.name.toLowerCase();
    if (!m.quiet) radio(g, `przyjąłem: ${what}, ${fieldName(fid)}${tgt}.${g.transit ? ` Skok, ETA ${Math.ceil(g.transit.eta)} s.` : ''}`);
    return { ok: true, text: `${g.name}: ${what} → ${fieldName(fid)}.` };
  }

  /**
   * Operacja skoordynowana: kilka grup na jeden cel, uderzenie o godzinie H
   * (wszystkie czekają na zbiórce na ostatnią). Grupy podchodzą z różnych stron.
   */
  function launchOperation(gids, m) {
    const list = gids.map(group).filter(Boolean);
    if (list.length < 2) return assign(gids[0], m);
    const op = `op${state().nextOp++}`;
    const res = [];
    for (const g of list) {
      const r = assign(g.id, { ...m, op, declareWar: m.declareWar });
      if (!r.ok) return r;
      res.push(g.name);
    }
    radio(null, `operacja ${op.toUpperCase()}: ${res.join(', ')} — wspólne uderzenie na ${fieldName(m.field)}. Godzina H po zbiórce.`, 'info', { key: op });
    return { ok: true, text: `Operacja: ${res.join(' + ')} → ${fieldName(m.field)}.`, op };
  }

  /** Dobór składu: najlepszy zestaw okrętów bez grupy z układu siedziby. */
  function suggestShips({ kind, field, strike = 'obrona' }) {
    const pool = army.ships.filter((s) => !s.group && !s.transit && s.sysId === homeSystem())
      .sort((a, b) => WARSHIPS[b.cls].power - WARSHIPS[a.cls].power);
    if (kind === 'zwiad') {
      const fast = pool.slice().sort((a, b) => WARSHIPS[b.cls].speed - WARSHIPS[a.cls].speed);
      return fast.slice(0, Math.min(2, fast.length)).map((s) => s.id);
    }
    if (kind === 'obrona' || kind === 'patrol') return pool.slice(0, Math.max(1, Math.ceil(pool.length / 2))).map((s) => s.id);
    const intel = intelFresh(field);
    const dfn = (intel?.defense ?? strategy.fieldDefense(field)) * (kind === 'uderzenie' && strike === 'drony' ? 0.5 : 1);
    const need = dfn * 1.4 + 0.5;
    const out = [];
    let p = 0;
    for (const s of pool) { if (p >= need) break; out.push(s.id); p += shipPower(s) * (army.mods?.().power ?? 1); }
    return out;
  }

  function recall(gid) {
    const g = group(gid);
    if (!g) return { ok: false, text: 'Nie ma takiej grupy.' };
    startReturn(g, 'rozkaz');
    return { ok: true, text: `${g.name} wraca do bazy.` };
  }

  // ------------------------------------------------------------
  // FAZY
  // ------------------------------------------------------------
  function startTransit(g, dest) {
    const eta = travelTime(g, g.sysId, dest);
    g.transit = { from: g.sysId, to: dest, eta, total: eta };
    for (const s of shipsOf(g)) { s.transit = { to: dest }; s.sysId = null; }
    g.sysId = null;
    frames.delete(g.id);
  }
  function arrive(g) {
    const dest = g.transit.to;
    delete g.transit;
    g.sysId = dest;
    const stage = stagePoint(g);
    for (const s of shipsOf(g)) { delete s.transit; s.sysId = dest; s.arrive = true; s.spawnAt = plain(stage.clone().add(_a.set((rng() - 0.5) * 500, (rng() - 0.5) * 150, (rng() - 0.5) * 500))); }
    if (g.phase === 'powrot') { finish(g); return; }
    radio(g, `wyszliśmy z fałdy: ${systemName(dest)}.`);
    enterAction(g);
  }
  function enterAction(g) {
    const m = g.mission;
    if (m?.op && ['uderzenie', 'zdobycie'].includes(m.kind)) { g.phase = 'zbiorka'; g.t = 0; return; }
    g.phase = 'akcja';
    g.t = 0;
    const F = frames.get(g.id);
    if (F) F.engaged = false;
  }
  function startReturn(g, why) {
    if (!g.mission) g.mission = { kind: 'powrot', field: homeField(), since: clock(), startPower: groupPower(g), startShips: g.ships.length };
    if (g.phase === 'powrot') return;
    g.mission.result ??= why;
    g.phase = 'powrot';
    g.support = null;
    const home = homeSystem();
    if (g.transit) { // zawrócenie w fałdzie: droga powrotna = czas, który już minął
      g.transit.eta = Math.max(2, g.transit.total - g.transit.eta);
      g.transit.to = home;
      for (const s of shipsOf(g)) s.transit = { to: home };
      return;
    }
    if (g.sysId !== home) startTransit(g, home);
    else finish(g);
  }

  /** Koniec misji: raport i powrót do obrony bazy ("zapomnij"). */
  function finish(g) {
    const m = g.mission;
    if (m && m.kind !== 'powrot' && m.kind !== 'obrona' && m.kind !== 'patrol') report(g);
    if (g.disbandOnReturn) { g.disbandOnReturn = false; g.mission = null; g.phase = 'postoj'; disband(g.id); return; }
    // po powrocie grupa broni pola macierzystego w jeżu
    g.mission = null;
    g.phase = 'postoj';
    const r = assign(g.id, { kind: 'obrona', field: homeField(), formation: 'jez', quiet: true });
    if (r.ok) radio(g, `w bazie. Bronimy pola: ${fieldName(homeField())}, szyk jeż.`);
  }

  function report(g) {
    const m = g.mission;
    const lost = m.startShips - g.ships.length;
    const pct = m.startPower > 0 ? Math.round((1 - groupPower(g) / m.startPower) * 100) : 0;
    const owner = m.owner ? RACES[m.owner].name : null;
    const res = m.result ?? 'wykonane';
    let head, ok = res === 'wykonane';
    switch (m.kind) {
      case 'zwiad': {
        const i = state().intel[m.field];
        head = i ? `Zwiad — ${fieldName(m.field)}: ${i.owner ? `${RACES[i.owner].name}, poziom ${i.develop}, obrona ≈${i.defense.toFixed(1)}, flota rasy ${i.ships} okr.${i.byType ? `, wieże ${i.byType.wieza ?? 0}` : ''}` : 'pole wolne'}.`
          : `Zwiad — ${fieldName(m.field)}: przerwany.`;
        break;
      }
      case 'uderzenie': head = `Uderzenie (${STRIKE_TARGETS[m.strike].name.toLowerCase()}) — ${fieldName(m.field)}${owner ? `, ${owner}` : ''}: ${ok ? 'cel osiągnięty' : res}.`; break;
      case 'zdobycie': head = `Szturm — ${fieldName(m.field)}${owner ? `, ${owner}` : ''}: ${ok ? 'placówka rozbita, pole wolne' : res}.`; break;
      default: head = `${MISSIONS[m.kind]?.name ?? 'Misja'}: ${res}.`;
    }
    const text = `${head}${g.stats.stations ? ` Zniszczone stacje: ${g.stats.stations}.` : ''} Straty: ${lost ? `${lost} okr.` : 'brak'}${pct > 5 ? `, uszkodzenia ${pct}% siły` : ''}.`;
    radio(g, text, ok ? 'info' : 'warning', { key: 'report' });
    onReport({ group: g.id, name: g.name, mission: { ...m }, ok, text, lost, canRepeat: m.kind !== 'zwiad' || true });
  }

  // ------------------------------------------------------------
  // RAMA SZYKU (na żywo)
  // ------------------------------------------------------------
  function fieldAnchor(fid) { const c = strategy.defs.get(fid).center; return new THREE.Vector3(c.x, c.y + 300, c.z); }
  function sysSpawn(sys) { const p = economy.state.systems?.[sys]?.spawn?.position; return p ? v3(p) : new THREE.Vector3(0, 0, 60000); }
  /** Kierunek podejścia do pola: od strony wejścia do układu, rozchylony dla kolejnych grup operacji. */
  function approachDir(g, fid) {
    const c = fieldAnchor(fid);
    const d = sysSpawn(strategy.systemOf(fid)).sub(c).setY(0);
    if (d.lengthSq() < 1) d.set(0, 0, 1);
    d.normalize();
    const m = g.mission;
    if (m?.op) {
      const mates = groups().filter((x) => x.mission?.op === m.op).map((x) => x.id).sort();
      const i = mates.indexOf(g.id), n = mates.length;
      d.applyAxisAngle(new THREE.Vector3(0, 1, 0), (i - (n - 1) / 2) * 0.9);
    }
    return d;
  }
  /** Punkt i smycz obrony pola (pas + stacje przy nim, army.defenseZone). */
  const defZone = (fid) => army.defenseZone?.(fid) ?? { anchor: fieldAnchor(fid), leash: 4500 };
  function stagePoint(g) {
    const fid = g.phase === 'powrot' ? homeField() : g.mission?.field ?? homeField();
    if (!fid) return new THREE.Vector3();
    const kind = g.mission?.kind;
    if (g.phase === 'powrot' || kind === 'obrona' || kind === 'patrol' || !kind) return defZone(fid).anchor;
    return fieldAnchor(fid).addScaledVector(approachDir(g, fid), kind === 'zwiad' ? 9000 : 7000);
  }
  /** Punkt, do którego zmierza rama, i kierunek frontu. */
  function goalFor(g, F, out) {
    const m = g.mission;
    if (g.support && g.support.until > clock()) { out.copy(g.support.point); return; }
    if (!m) { out.copy(F.anchor); return; }
    const fid = m.field;
    switch (m.kind) {
      case 'patrol': {
        const route = strategy.fieldsOf(PLAYER).filter((f) => strategy.systemOf(f) === g.sysId);
        if (!route.length) { out.copy(fieldAnchor(fid)); return; }
        g.wp = (g.wp ?? 0) % route.length;
        out.copy(fieldAnchor(route[g.wp])).addScaledVector(_b.set(0, 0, 1), 1800);
        if (F.anchor.distanceTo(out) < 450) g.wp = (g.wp + 1) % route.length;
        return;
      }
      case 'zwiad': out.copy(fieldAnchor(fid)).addScaledVector(approachDir(g, fid), 4200); return;
      case 'uderzenie': case 'zdobycie': {
        if (g.phase === 'zbiorka') { out.copy(stagePoint(g)); return; }
        out.copy(fieldAnchor(fid)).addScaledVector(approachDir(g, fid), 1300);
        return;
      }
      default: out.copy(defZone(fid).anchor); // obrona: między polem a stacjami
    }
  }
  function applyFormation(g, F) {
    const f = FORMATIONS[g.formation] ?? FORMATIONS.klin;
    const m = g.mission;
    F.kind = g.formation;
    F.spacing = f.spacing;
    F.posture = m?.kind === 'zwiad' ? 'transit' : f.posture === 'transit' && ['uderzenie', 'zdobycie'].includes(m?.kind) ? 'offensive' : f.posture;
    F.evasive = m?.kind === 'zwiad';
    F.holdFire = false;
    F.contactR = OPS.contactRange;
    F.leash = m?.kind === 'obrona' ? defZone(m.field).leash : m?.kind === 'patrol' ? 6000 : 9000;
    if (g.support && g.support.until > clock()) { F.posture = 'offensive'; F.engaged = true; F.leash = 6000; }
  }
  function frameFor(g) {
    let F = frames.get(g.id);
    if (F) return F;
    const pts = g.ships.map((id) => army.spawned?.get(id)).filter((n) => n?.alive).map((n) => n.group.position);
    const anchor = new THREE.Vector3();
    if (pts.length) { for (const p of pts) anchor.add(p); anchor.multiplyScalar(1 / pts.length); } else anchor.copy(stagePoint(g));
    F = { kind: g.formation, spacing: 260, anchor, fwd: new THREE.Vector3(0, 0, -1), vel: new THREE.Vector3(), posture: 'offensive', engaged: false, contactR: OPS.contactRange, leash: 9000 };
    applyFormation(g, F);
    frames.set(g.id, F);
    return F;
  }
  const _goal = new THREE.Vector3();
  function moveFrame(g, F, dt) {
    goalFor(g, F, _goal);
    const npcsAlive = g.ships.map((id) => army.spawned?.get(id)).filter((n) => n?.alive);
    // opóźnienie ramy, gdy okręty zostają w tyle (szyk nie rozciąga się w nitkę)
    let lag = 0;
    if (npcsAlive.length) {
      for (const n of npcsAlive) lag += n.group.position.distanceTo(F.anchor);
      lag /= npcsAlive.length;
    }
    const maxV = Math.min(OPS.frameSpeed * (FORMATIONS[g.formation]?.travel ?? 1), 700 * slowest(g) * 0.65);
    const v = F.engaged && F.posture === 'offensive' ? maxV * 0.5 : lag > 900 ? maxV * 0.25 : maxV;
    _a.copy(_goal).sub(F.anchor);
    const d = _a.length();
    if (d > 30) {
      const step = Math.min(d, v * dt);
      F.vel.copy(_a).multiplyScalar(step / d / Math.max(dt, 1e-3));
      F.anchor.addScaledVector(_a, step / d);
      _a.setY(_a.y * 0.2);
      if (_a.lengthSq() > 1) F.fwd.lerp(_a.normalize(), Math.min(1, dt * 1.5)).normalize();
    } else F.vel.set(0, 0, 0);
    // po walce szyk się zwiera: nikogo w pobliżu przez 8 s = z powrotem do szyku
    const shared = tactics?.netContacts?.('flota');
    if (F.engaged && !(g.support?.until > clock())) {
      let near = false;
      if (shared) for (const c of shared) if (c.isAlive() && c.position.distanceTo(F.anchor) < F.contactR * 1.6) { near = true; break; }
      F.calm = near ? 0 : (F.calm ?? 0) + dt;
      if (F.calm > 8) { F.engaged = false; F.calm = 0; }
    }
    // front ku zagrożeniu (postawa obronna): najbliższy wróg przy ramie
    if (F.posture === 'defensive') {
      let best = null, bd = 9000;
      if (shared) for (const c of shared) { const dd = c.isAlive() ? c.position.distanceTo(F.anchor) : Infinity; if (dd < bd) { bd = dd; best = c; } }
      if (best) { _a.copy(best.position).sub(F.anchor).setY(0); if (_a.lengthSq() > 1) F.fwd.lerp(_a.normalize(), Math.min(1, dt * 2)).normalize(); }
    }
    return d;
  }

  /** Mózg okrętu w grupie (hook army.brainFor). */
  function brainFor(s) {
    const g = group(s.group);
    if (!g) return null;
    const F = frameFor(g);
    const m = g.mission;
    let prio = null;
    if (m?.kind === 'uderzenie') {
      const tg = STRIKE_TARGETS[m.strike];
      prio = (c) => (c.kind === 'station' ? (tg.stations.includes(c.station?.type) ? 4 : 0.4) : c.kind === 'drone' ? (tg.drones ? 2.2 : 0.2) : 1);
    } else if (m?.kind === 'zdobycie') prio = (c) => (c.kind === 'station' ? (c.station?.type === 'wieza' ? 3.5 : 2.5) : c.kind === 'drone' ? 0.4 : 1);
    return { base: 'fleet', squad: squadId(g), anchor: F.anchor, leash: F.leash, prio, shelterAt: ROE[g.roe]?.retreatHull ?? 0.25, noRetreat: false };
  }

  // ------------------------------------------------------------
  // CEL MISJI: na żywo
  // ------------------------------------------------------------
  function liveObjective(g, F, dist, dt) {
    const m = g.mission;
    if (!m) return;
    const fid = m.field;
    if (m.kind === 'zwiad') {
      if (dist < 600) {
        g.dwell -= dt;
        if (g.dwell <= 0) { const i = gatherIntel(fid, { live: true }); radio(g, `obserwacja zakończona: ${i.owner ? `${RACES[i.owner].name}, ${i.byType ? `stacje ${Object.values(i.byType).reduce((a, x) => a + x, 0)}, wieże ${i.towers ?? i.byType.wieza ?? 0}` : `poziom ${i.develop}`}, patrole ${i.patrols ?? '?'}` : 'pole wolne'}. Wracamy.`); m.result = 'wykonane'; startReturn(g, 'wykonane'); }
      }
      return;
    }
    if (m.kind === 'uderzenie' || m.kind === 'zdobycie') {
      economy.discoverField?.(fid, { silent: true }); // flota widzi placówkę, do której leci
      const info = rival?.outpostInfo?.(fid);
      const fs = strategy.state.fields[fid];
      if (!m.start && info) m.start = info;
      if (m.start) g.stats.stations = Math.max(g.stats.stations, m.start.stations - (info?.stations ?? 0));
      let done = false;
      if (m.kind === 'zdobycie' || !info) done = !fs?.owner || fs.owner !== m.owner || fs.develop <= 0;
      else {
        const tg = STRIKE_TARGETS[m.strike];
        const left = tg.stations.reduce((a, t) => a + (info.byType[t] ?? 0), 0);
        const dronesDone = !tg.drones || !m.start || info.drones <= Math.floor(m.start.drones * 0.3);
        done = left === 0 && dronesDone;
      }
      if (done) {
        if (m.kind === 'uderzenie') applyStrikeEffect(g, true);
        radio(g, m.kind === 'zdobycie' ? `${fieldName(fid)}: placówka rozbita! Wracamy.` : `cel zniszczony (${STRIKE_TARGETS[m.strike].name.toLowerCase()}). Odchodzimy.`);
        m.result = 'wykonane';
        startReturn(g, 'wykonane');
      }
    }
  }

  /** Skutek strategiczny rajdu (na żywo po wykonaniu, zaocznie po wygranej rundzie). */
  function applyStrikeEffect(g, live = false) {
    const m = g.mission;
    const fid = m.field;
    if (!strategy.state.fields[fid]?.owner) return;
    const val = strategy.defs.get(fid).richness ?? 1;
    if (m.strike === 'obrona') {
      strategy.sabotage(fid, 'obrona', { mul: OPS.suppressMul, time: OPS.suppressTime });
      if (!live) { strategy.damageOutpost(fid, 1, PLAYER); g.stats.stations += 1; }
    } else if (m.strike === 'gospodarka') {
      strategy.sabotage(fid, 'gospodarka', { mul: 0.5, time: OPS.disruptTime, credits: Math.round(350 * val) });
      if (!live) { strategy.damageOutpost(fid, 1, PLAYER); g.stats.stations += 1; }
    } else {
      strategy.sabotage(fid, 'gospodarka', { mul: 0.8, time: OPS.disruptTime * 0.5, credits: Math.round(150 * val) });
      g.stats.drones += 1;
    }
  }

  // ------------------------------------------------------------
  // ROZSTRZYGNIĘCIE ZAOCZNE
  // ------------------------------------------------------------
  function offlineScout(g, dt) {
    g.dwell -= dt;
    if (g.dwell > 0) return;
    const fid = g.mission.field;
    const dfn = strategy.foreignOwner(fid) ? strategy.fieldDefense(fid) : 0;
    // ryzyko wykrycia: obrona pola kontra liczba i szybkość zwiadowców
    const risk = Math.min(0.6, dfn * 0.05 / (g.ships.length * slowest(g)));
    if (rng() < risk) {
      const s = shipsOf(g).sort((a, b) => a.hull - b.hull)[0];
      if (s && rng() < 0.5) { army.lose(s.id); g.ships = g.ships.filter((x) => x !== s.id); g.stats.lost++; radio(g, `wykryci! Straciliśmy „${s.callsign}”.`, 'warning'); }
      else if (s) { s.hull *= 0.6; radio(g, 'wykryci, ostrzał, uszkodzenia — dane mamy.', 'warning'); }
    }
    if (!g.ships.length) return;
    gatherIntel(fid);
    g.mission.result = 'wykonane';
    radio(g, `dane z ${fieldName(fid)} zebrane. Skok do domu.`);
    startReturn(g, 'wykonane');
  }

  function offlineRounds(dt) {
    // grupy w akcji zaocznej na ten sam cel walczą razem (operacje skoordynowane)
    const clusters = new Map();
    for (const g of groups()) {
      if (g.phase !== 'akcja' || isLive(g) || !g.mission || g.transit) continue;
      if (g.mission.kind === 'zwiad') { offlineScout(g, dt); continue; }
      if (!['uderzenie', 'zdobycie'].includes(g.mission.kind)) continue;
      g.roundT -= dt;
      if (g.roundT > 0) continue;
      g.roundT = OPS.roundEvery;
      const k = `${g.mission.field}|${g.mission.kind}|${g.mission.strike}`;
      (clusters.get(k) ?? clusters.set(k, []).get(k)).push(g);
    }
    for (const list of clusters.values()) resolveRound(list);
  }

  function resolveRound(list) {
    const m0 = list[0].mission;
    const fid = m0.field;
    const owner = strategy.foreignOwner(fid);
    if (!owner || owner !== m0.owner) {
      for (const g of list) { g.mission.result = g.mission.kind === 'zdobycie' ? 'wykonane' : 'cel zniknął'; radio(g, `${fieldName(fid)}: placówki już nie ma. Wracamy.`); startReturn(g, g.mission.result); }
      return;
    }
    const intel = intelFresh(fid) ? OPS.intelBonus : 1;
    const multi = 1 + Math.min(0.2, 0.1 * (list.length - 1)); // uderzenie z kilku stron
    let atk = 0;
    for (const g of list) {
      const f = FORMATIONS[g.formation] ?? FORMATIONS.klin;
      const pincer = g.formation === 'kleszcze' && g.ships.length < (f.minShips ?? 0) ? 1 / f.atk : 1;
      const vsSt = m0.kind === 'uderzenie' && m0.strike !== 'drony' ? (f.vsStations ?? 1) : 1;
      atk += groupPower(g) * f.atk * pincer * vsSt * ROE[g.roe].atk;
    }
    atk *= intel * multi * (0.8 + rng() * 0.4);
    const strikeK = m0.kind === 'uderzenie' ? (m0.strike === 'drony' ? 0.45 : 0.75) : 1;
    const dfn = strategy.fieldDefense(fid) * strikeK * (0.8 + rng() * 0.4);
    // straty rozłożone po grupach proporcjonalnie do ich siły
    const totalP = list.reduce((a, g) => a + groupPower(g), 0) || 1;
    for (const g of list) {
      g.stats.rounds++;
      const f = FORMATIONS[g.formation] ?? FORMATIONS.klin;
      const ships = shipsOf(g);
      const hullSum = ships.reduce((a, s) => a + s.hull, 0);
      const dmg = Math.min(dfn * 70 * ROE[g.roe].loss / f.def * (groupPower(g) / totalP), hullSum * (ROE[g.roe].roundCap ?? 1));
      for (const s of ships) s.hull -= Math.min(s.hull, dmg / ships.length);
      for (const s of ships) if (s.hull < WARSHIPS[s.cls].hull * 0.12) {
        army.lose(s.id); g.ships = g.ships.filter((x) => x !== s.id); g.stats.lost++;
        radio(g, `straciliśmy „${s.callsign}” (${WARSHIPS[s.cls].name.toLowerCase()}).`, 'warning', { key: `lost-${s.id}` });
      }
    }
    strategy.shipLost(owner, Math.max(0, Math.round(atk * 0.2)));
    const won = atk > dfn;
    for (const g of list) {
      if (!g.ships.length) continue;
      const m = g.mission;
      if (won) {
        if (m.kind === 'uderzenie') {
          applyStrikeEffect(g);
          m.result = 'wykonane';
          radio(g, `${fieldName(fid)}: ${STRIKE_TARGETS[m.strike].name.toLowerCase()} zniszczone. Odchodzimy.`);
          startReturn(g, 'wykonane');
        } else {
          if (g === list[0]) { strategy.damageOutpost(fid, 2, PLAYER); }
          g.stats.stations += 2;
          if (!strategy.foreignOwner(fid)) { m.result = 'wykonane'; radio(g, `${fieldName(fid)} zdobyte — placówka rozbita!`); startReturn(g, 'wykonane'); }
          else radio(g, `${fieldName(fid)}: przełamujemy obronę, placówka traci poziomy (zostało ${strategy.state.fields[fid].develop}).`);
        }
      } else radio(g, `${fieldName(fid)}: obrona trzyma. Ponawiamy natarcie.`, 'warning', { key: 'round' });
    }
    checkWithdraw(list);
  }

  function checkWithdraw(list) {
    for (const g of list) {
      if (g.phase !== 'akcja' || !g.mission) continue;
      if (!g.ships.length) continue;
      const lossFrac = g.mission.startPower > 0 ? 1 - groupPower(g) / g.mission.startPower : 0;
      if (lossFrac >= ROE[g.roe].withdrawAt) {
        g.mission.result = 'odwrót (straty)';
        radio(g, `straty ${Math.round(lossFrac * 100)}% — zgodnie z zasadami wycofujemy się.`, 'warning');
        startReturn(g, 'odwrót (straty)');
      }
    }
  }

  // ------------------------------------------------------------
  // WSPARCIE (zdarzenia taktyki)
  // ------------------------------------------------------------
  function onTacticEvent(e) {
    const s = e.npc?.fleetShip;
    if (e.type === 'support' && e.net === 'flota') {
      const g = s ? group(s.group) : null;
      const who = g ? g.name : s ? `„${s.callsign}”` : 'eskadra';
      const where = e.point;
      const cands = groups().filter((x) => x !== g && isLive(x) && x.phase === 'akcja' && MISSIONS[x.mission?.kind]?.answersCalls && !(x.support?.until > clock()) && x.ships.length);
      let best = null, bd = Infinity;
      for (const x of cands) { const F = frameFor(x); const d = F.anchor.distanceTo(where); if (d < bd) { bd = d; best = x; } }
      const nearField = economy.fieldAt?.(here(), where)?.name ?? 'pole';
      if (!best) { radio(g, `${who}: przegrywamy — ${nearField}, ${e.enemies} wrogów! Nikt wolny nie odpowiada.`, 'danger', { key: 'call' }); return; }
      best.support = { point: where.clone(), until: clock() + 45, from: g?.id ?? null };
      const F = frameFor(best);
      applyFormation(best, F);
      for (const id of best.ships) army.rebrain?.(id);
      const eta = Math.ceil(bd / Math.max(200, OPS.frameSpeed));
      radio(g, `${who}: pod ostrzałem — ${nearField}, potrzebne wsparcie!`, 'danger', { key: 'call' });
      radio(best, `przyjąłem wezwanie, lecimy: ${nearField}, ETA ${eta} s.`, 'info', { key: 'answer' });
      return;
    }
    if (!s?.group) return;
    const g = group(s.group);
    if (!g) return;
    if (e.type === 'contact') radio(g, `kontakt! ${FORMATIONS[g.formation].name} rozwija się do natarcia.`, 'info', { key: 'contact' });
    if (e.type === 'shelter') {
      g.sheltered ??= {};
      if (clock() - (g.sheltered[s.id] ?? -99) > 30) { g.sheltered[s.id] = clock(); radio(g, `„${s.callsign}” ciężko trafiony — wraca do szyku.`, 'warning', { key: `sh-${s.id}` }); }
    }
  }

  // ------------------------------------------------------------
  // PĘTLA
  // ------------------------------------------------------------
  function update(dt) {
    const st = state();
    st.clock += dt;
    // odkrycia ze zwiadu w układzie, do którego gracz właśnie wszedł
    const pend = st.pending[here()];
    if (pend) { for (const f of pend) economy.discoverField?.(f, { silent: true }); delete st.pending[here()]; }

    for (const g of [...groups()]) {
      // okręty zniszczone na żywo (army usuwa je ze stanu) albo wyjęte ręcznym rozkazem
      const dead = g.ships.filter((id) => !army.byId(id)).length;
      g.ships = g.ships.filter((id) => army.byId(id)?.group === g.id);
      g.stats.lost += dead;
      if (!g.ships.length) {
        if (g.mission && g.mission.kind !== 'obrona' && g.mission.kind !== 'patrol') { g.mission.result = 'grupa zniszczona'; report(g); }
        dropGroup(g, true);
        continue;
      }
      if (g.transit) {
        g.transit.eta -= dt;
        if (g.transit.eta <= 0) arrive(g);
        continue;
      }
      if (g.phase === 'zbiorka') {
        g.t += dt;
        const mates = groups().filter((x) => x.mission?.op === g.mission.op && x.ships.length);
        const ready = mates.every((x) => x.phase === 'zbiorka' || x.phase === 'akcja');
        if (ready || g.t > OPS.stageTimeout) {
          for (const x of mates) if (x.phase === 'zbiorka') { x.phase = 'akcja'; x.t = 0; const F = frames.get(x.id); if (F) F.engaged = false; }
          radio(null, `godzina H: ${mates.map((x) => x.name).join(', ')} — naprzód na ${fieldName(g.mission.field)}!`, 'info', { key: g.mission.op });
        }
      }
      if (g.support && g.support.until <= clock()) {
        g.support = null;
        const F = frames.get(g.id);
        if (F) applyFormation(g, F);
        for (const id of g.ships) army.rebrain?.(id);
        radio(g, 'wsparcie zakończone, wracamy na posterunek.');
      }
      if (isLive(g)) {
        const F = frameFor(g);
        if (tactics) { const sq = tactics.squad(squadId(g)); if (sq && sq.formation !== F) tactics.setFormation(squadId(g), F); }
        const d = moveFrame(g, F, dt);
        if (g.phase === 'akcja') { liveObjective(g, F, d, dt); checkWithdraw([g]); }
      } else frames.delete(g.id);
    }
    offlineRounds(dt);
  }

  // ------------------------------------------------------------
  // ODCZYT (panel, mapa)
  // ------------------------------------------------------------
  const PHASE_NAME = { postoj: 'postój', przelot: 'w fałdzie', zbiorka: 'zbiórka', akcja: 'w akcji', powrot: 'powrót' };
  function describe(g) {
    const m = g.mission;
    const where = g.transit ? `fałda → ${systemName(g.transit.to)} (${Math.ceil(g.transit.eta)} s)` : systemName(g.sysId);
    const what = !m ? 'bez zadania' : m.kind === 'uderzenie' ? `uderzenie: ${STRIKE_TARGETS[m.strike].name.toLowerCase()}` : MISSIONS[m.kind]?.name.toLowerCase() ?? m.kind;
    return {
      id: g.id, name: g.name, ships: shipsOf(g), power: groupPower(g), formation: g.formation, roe: g.roe,
      phase: g.support?.until > clock() ? 'wsparcie' : PHASE_NAME[g.phase] ?? g.phase, where, what,
      field: m?.field ?? null, fieldName: m?.field ? fieldName(m.field) : null, op: m?.op ?? null,
      live: isLive(g), transit: g.transit ? { ...g.transit } : null,
      losses: m?.startPower ? Math.max(0, 1 - groupPower(g) / m.startPower) : 0,
      anchor: frames.get(g.id)?.anchor ?? null,
    };
  }

  return {
    update, onTacticEvent, brainFor,
    createGroup, disband, removeFromGroup, setFormation, setRoe, assign, launchOperation, recall, suggestShips,
    gatherIntel, intel: (fid) => state().intel[fid] ?? null, intelFresh,
    groups: () => groups().map(describe), group, groupPower, travelTime,
    get log() { return state().log; }, get clock() { return clock(); },
    frame: (gid) => frames.get(gid) ?? null,
  };
}
