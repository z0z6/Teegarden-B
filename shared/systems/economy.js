import * as THREE from 'three';
import {
  METALS, METAL_ORDER, STATIONS, DRONE, PLAYER_MINING, MARKET, LOGISTICS, START, SWARM_NAMES, BELT, ASTEROID_CLASSES, RAIDS,
} from '../data/economy.js';
import {
  generateBelt, createAsteroidBelt, surfacePoint, markMined, markDepleted, remaining, hashString,
} from './asteroid-belt.js';
import {
  buildStationModel, setStationProgress, animateStation, disposeObject, createDroneRenderer, createSparks,
  createMiningBeam, createTugLanes,
} from './economy-visuals.js';

/**
 * WARSTWA EKONOMICZNA (krok 10).
 *
 * STAN (serializowalny, zapisywany w localStorage):
 *   credits, market (mnożniki kursów), hold (ładownia gracza),
 *   systems[id] = { beltCenter, stations[], swarms[], mined{}, nextId }
 *     station = { id, type, name, pos, status: 'budowa'|'gotowa', need{}, progress,
 *                 storage{}, queue[] (swarmId drona w produkcji - tylko dok), buildT }
 *     swarm   = { id, name, home, drop, target ('auto'|id planetoidy), prefer, mode, drones }
 *     mined   = aktualne zasoby planetoid, które ktoś już ruszył
 *
 * RUNTIME (tylko bieżący układ, nie zapisywany): siatki pasa i stacji oraz
 * drony z pozycją i automatem stanów. Drony nie są zapisywane pojedynczo -
 * rój pamięta tylko liczbę, po wczytaniu drony startują z doku.
 *
 * DWA POZIOMY SYMULACJI. Układ, w którym jest gracz, liczymy dokładnie:
 * każdy dron leci, ląduje na obracającej się skale, wierci, wraca. Pozostałe
 * układy - "zaocznie": rój wydobywa średnią wydajnością (wiercenie ~45% czasu,
 * reszta to przeloty), a logistyka, sprzedaż, budowy i produkcja dronów idą tą
 * samą ścieżką kodu co w bieżącym układzie. Imperium pracuje, gdy gracz
 * lata gdzie indziej.
 *
 * WALKA (opcjonalnie, `combat` + `getHostiles`): drony i gotowe stacje są
 * aktorami combat.js (pociski wroga je trafiają) i kontaktami dla mózgów NPC
 * (contacts() -> npc-ships `getContacts`), więc rabusie (raids.js) mogą na nie
 * polować. Dron ma 30 pkt kadłuba; stacji się nie niszczy, tylko łupi: gdy
 * kadłub spadnie do zera, rabusie zabierają część zapasów, a stacja na chwilę
 * przestaje być celem. Platforma obronna sama strzela do wrogów w zasięgu.
 * Alarm (setAlert) wysyła roje z włączoną ewakuacją do doków.
 */

const SAVE_KEY = 'teegarden-b.ekonomia.v1'; // krok 10; krok 11 podaje własny (saveKey)
const OFFLINE_DUTY = 0.45;

const zeroMetals = () => Object.fromEntries(METAL_ORDER.map((m) => [m, 0]));
const sumMetals = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const plain = (v) => ({ x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: Math.round(v.z * 10) / 10 });

export function freshState() {
  return {
    version: 1,
    credits: START.credits,
    time: 0,
    market: Object.fromEntries(METAL_ORDER.map((m) => [m, 1])),
    hold: zeroMetals(),
    systems: {},
    stats: {
      earned: 0, sold: zeroMetals(), minedPlayer: 0, minedDrones: 0, dronesBuilt: 0,
      dronesLost: 0, stolen: 0, raids: 0, raidersKilled: 0, bounty: 0,
    },
    raids: {}, // [układ] = { threat, cooldown } - reżyser nalotów (raids.js)
    tutorial: { step: 0 },
  };
}

/** Środek pasa planetoid dla danego punktu startowego (spawn -> lookAt). */
export function beltCenterFor(spawnPos, lookAt) {
  const fwd = v3(lookAt).sub(v3(spawnPos)).normalize();
  const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  return v3(spawnPos)
    .addScaledVector(side, BELT.offset.side)
    .addScaledVector(fwd, -BELT.offset.forward)
    .add(new THREE.Vector3(0, BELT.offset.up, 0));
}

/**
 * @param {object} opts
 *   scene        - THREE.Scene (w Node: zwykła scena, nic nie jest rysowane)
 *   storage      - obiekt z getItem/setItem (localStorage) albo null (bez zapisu)
 *   onEvent(e)   - { key, text, urgency: 'info'|'warning'|'danger' } -> dashboard załogi
 *   quality      - 0..1 (telefony: mniej planetoid i iskier)
 *   random       - źródło losowości (testy: deterministyczne)
 */
export function createEconomy({
  scene, storage = null, onEvent = () => {}, quality = 1, random = Math.random,
  combat = null, getHostiles = null,
  // krok 11: kilka pól surowcowych na układ (fields.js) i własny klucz zapisu
  fieldsFor = null, saveKey = SAVE_KEY,
} = {}) {
  let state = load() ?? freshState();
  let rt = null;            // runtime bieżącego układu
  const beltCache = new Map(); // dane pasów (bez siatek) - także dla układów "zaocznych"
  let structVersion = 1;    // rośnie przy zmianie listy stacji/rojów (panel przebudowuje DOM)
  let saveTimer = 0;
  const incomeLog = [];     // [czas, kr] - przychód z ostatniej minuty
  const eventCooldown = new Map();

  const sparks = scene ? createSparks(scene, quality < 0.8 ? 400 : 900) : null;
  const beam = scene ? createMiningBeam(scene) : null;
  const drones3d = scene ? createDroneRenderer(scene, 600) : null;
  const tugs = scene ? createTugLanes(scene) : null;

  function emit(key, text, urgency = 'info', cooldown = 0) {
    if (cooldown) {
      const last = eventCooldown.get(key) ?? -1e9;
      if (state.time - last < cooldown) return;
      eventCooldown.set(key, state.time);
    }
    onEvent({ key, text, urgency });
  }
  const bump = () => { structVersion++; };
  const hooks = {}; // raids.js: droneLost(d), stolen(tons, st)
  // krok 12: zasilanie (command.js) - mnożnik tempa pracy stacji 0..1
  const eff = (sysId, st) => hooks.efficiency?.(sysId, st) ?? 1;

  // ------------------------------------------------------------
  // ZAPIS
  // ------------------------------------------------------------
  function load() {
    try {
      const raw = storage?.getItem(saveKey);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s?.version !== 1) return null;
      // zapis sprzed rabusiów: brakujące pola z nowego stanu
      const f = freshState();
      s.stats = { ...f.stats, ...s.stats };
      s.raids ??= {};
      return s;
    } catch { return null; }
  }
  function save() {
    if (!storage) return;
    // obiekty tymczasowe (misja "Obrona kopalni") nie trafiają do zapisu
    const replacer = (k, v) => (Array.isArray(v) && (k === 'stations' || k === 'swarms') ? v.filter((x) => !x.temp) : v);
    try { storage.setItem(saveKey, JSON.stringify(state, replacer)); } catch { /* prywatne okno / brak miejsca - gra działa dalej */ }
  }
  function reset() {
    const sysId = rt?.sysId, spawn = rt?.spawn;
    leaveSystem();
    state = freshState();
    beltCache.clear();
    defsCache.clear();
    try { storage?.removeItem(saveKey); } catch { /* jw. */ }
    if (sysId) enterSystem(sysId, spawn);
    bump();
  }

  // ------------------------------------------------------------
  // UKŁADY
  // ------------------------------------------------------------
  function sysState(id) {
    return state.systems[id] ?? null;
  }
  // ------------------------------------------------------------
  // POLA SUROWCOWE: bez `fieldsFor` jedno pole = pas z kroku 10 (te same id)
  // ------------------------------------------------------------
  const defsCache = new Map();
  function fieldDefs(id) {
    const sys = sysState(id);
    if (!sys) return [];
    let defs = defsCache.get(id);
    if (!defs) {
      defs = fieldsFor && sys.spawn
        ? fieldsFor(id, { position: v3(sys.spawn.position), lookAt: v3(sys.spawn.lookAt) })
        : [{ id: `${id}:0`, index: 0, systemId: id, name: 'Pas', kind: 'pas', center: sys.beltCenter, seed: hashString(`pas:${id}`), idPrefix: '', home: true, count: BELT.count, radius: BELT.radius, shares: null, richness: 1 }];
      defsCache.set(id, defs);
    }
    return defs;
  }
  function beltOf(def) {
    let belt = beltCache.get(def.id);
    if (!belt) {
      belt = generateBelt(def.seed, def.center, {
        quality, count: def.count, radius: def.radius, shares: def.shares, richness: def.richness, idPrefix: def.idPrefix, fieldId: def.id,
      });
      const sys = sysState(def.systemId);
      for (const a of belt.asteroids) if (sys?.mined[a.id]) a.reserves = sys.mined[a.id];
      beltCache.set(def.id, belt);
    }
    return belt;
  }
  const isDiscovered = (sysId, fid) => !!sysState(sysId)?.discovered?.[fid];
  /** Planetoidy odkrytych pól układu (dla dronów, gracza, zaocznego wydobycia). */
  function asteroidsIn(sysId) {
    const out = [];
    for (const d of fieldDefs(sysId)) if (isDiscovered(sysId, d.id)) out.push(...beltOf(d).asteroids);
    return out;
  }
  function beltFor(id) { return { asteroids: asteroidsIn(id) }; }

  function refreshAsteroids() {
    if (!rt) return;
    rt.belt = { asteroids: asteroidsIn(rt.sysId) };
  }
  /** Odkrycie pola: pojawia się pas, drony i gracz mogą tam kopać. */
  function discoverField(fid, { silent = false } = {}) {
    const def = rt && fieldDefs(rt.sysId).find((d) => d.id === fid);
    const sys = rt && sysState(rt.sysId);
    if (!def || sys.discovered[fid]) return false;
    sys.discovered[fid] = true;
    if (scene) rt.fieldViews.set(fid, createAsteroidBelt(scene, beltOf(def), { quality }));
    refreshAsteroids();
    bump();
    if (!silent) { hooks.discovered?.(def); save(); }
    return true;
  }
  /** Czujniki statku: pola w zasięgu (od skraju pasa) zostają odkryte. */
  function scan(pos, range) {
    if (!rt) return [];
    const found = [];
    for (const d of fieldDefs(rt.sysId)) {
      if (isDiscovered(rt.sysId, d.id)) continue;
      const dist = Math.hypot(pos.x - d.center.x, pos.y - d.center.y, pos.z - d.center.z) - d.radius;
      if (dist < range && discoverField(d.id)) found.push(d);
    }
    return found;
  }
  /** Pole, w którym leży punkt (środek pasa + jego promień + margines). */
  function fieldAt(sysId, pos, margin = 2500) {
    let best = null, bestD = Infinity;
    for (const d of fieldDefs(sysId)) {
      const dist = Math.hypot(pos.x - d.center.x, pos.y - d.center.y, pos.z - d.center.z);
      if (dist < d.radius + margin && dist < bestD) { best = d; bestD = dist; }
    }
    return best;
  }

  /** Wejście do układu: pas, stacje i drony stają się widoczne i liczone dokładnie. */
  function enterSystem(id, spawn) {
    leaveSystem();
    if (!state.systems[id]) {
      state.systems[id] = {
        beltCenter: plain(beltCenterFor(spawn.position, spawn.lookAt)),
        stations: [], swarms: [], mined: {}, nextId: 1,
        spawn: { position: plain(v3(spawn.position)), lookAt: plain(v3(spawn.lookAt)) },
        discovered: {},
      };
    }
    const sysS = state.systems[id];
    sysS.discovered ??= {};
    sysS.spawn ??= { position: plain(v3(spawn.position)), lookAt: plain(v3(spawn.lookAt)) };
    const defs = fieldDefs(id);
    sysS.discovered[defs[0].id] = true; // pole macierzyste znamy od razu
    rt = { sysId: id, spawn, belt: null, fieldViews: new Map(), views: new Map(), stationRt: new Map(), drones: [], time: 0, alert: false };
    if (scene) for (const d of defs) if (sysS.discovered[d.id]) rt.fieldViews.set(d.id, createAsteroidBelt(scene, beltOf(d), { quality }));
    refreshAsteroids();
    for (const st of sysState(id).stations) { addStationView(st); attachStation(st); }
    for (const sw of sysState(id).swarms) for (let i = 0; i < sw.drones; i++) rt.drones.push(newDrone(sw));
    bump();
  }
  function leaveSystem() {
    if (!rt) return;
    for (const d of rt.drones) combat?.unregister(d.actor);
    for (const r of rt.stationRt.values()) combat?.unregister(r.actor);
    for (const v of rt.fieldViews.values()) v.dispose();
    for (const v of rt.views.values()) { scene.remove(v.group); disposeObject(v.group); }
    rt = null;
    beam?.hide();
  }

  function addStationView(st) {
    if (!scene || !rt) return;
    const model = buildStationModel(st.type, STATIONS[st.type].accent);
    model.group.position.copy(v3(st.pos));
    model.group.rotation.y = st.yaw ?? (hashString(st.id + st.type) % 628) / 100; // krok 12: siedziba zwrócona do pasa
    setStationProgress(model, st.progress, st.status === 'gotowa');
    scene.add(model.group);
    rt.views.set(st.id, model);
  }

  // ------------------------------------------------------------
  // STACJE W WALCE: kontakt (cel dla mózgów NPC) + aktor (trafienia)
  // ------------------------------------------------------------
  function attachStation(st) {
    if (!rt || rt.stationRt.has(st.id)) return;
    const def = STATIONS[st.type];
    st.hull ??= def.hull;
    const pos = v3(st.pos);
    const alive = () => st.status === 'gotowa' && !(st.immune > 0);
    const r = { fireCd: 0, muzzle: 0, target: null, lastHit: -99 };
    r.contact = {
      id: `st-${st.id}`, kind: 'station', station: st, side: 'ally', value: st.type === 'wieza' ? 0.9 : 0.6,
      position: pos, velocity: new THREE.Vector3(),
      get hullFrac() { return st.hull / def.hull; },
      radius: def.radius * 0.7, recentAttackers: new Map(), isAlive: alive,
    };
    r.actor = {
      side: 'ally', position: pos, radius: def.radius * 0.7, isAlive: alive,
      takeDamage: (amount, shooter) => damageStation(st, amount, shooter),
    };
    r.shooter = { callsign: st.name, contact: r.contact }; // odwet: NPC wie, kto go bije
    rt.stationRt.set(st.id, r);
    combat?.register(r.actor);
  }

  function damageStation(st, amount, shooter) {
    if (st.status !== 'gotowa' || st.immune > 0) return;
    const def = STATIONS[st.type];
    st.hull -= amount * 0.6; // pancerz stacji
    const r = rt?.stationRt.get(st.id);
    if (r) r.lastHit = state.time;
    if (shooter?.contact && r) r.contact.recentAttackers.set(shooter.contact, state.time);
    emit(`station-hit-${st.id}`, `${st.name} pod ostrzałem! Kadłub ${Math.max(0, Math.round(st.hull / def.hull * 100))}%.`, 'danger', 8);
    if (st.hull <= 0) lootStation(st);
  }

  /** Kadłub stacji na zero: rabusie zabierają część zapasów, stacja chwilowo bez znaczenia. */
  function lootStation(st) {
    const def = STATIONS[st.type];
    let stolen = 0;
    for (const m of METAL_ORDER) {
      const k = st.storage[m] * RAIDS.stationLoot;
      st.storage[m] -= k; stolen += k;
    }
    state.stats.stolen += stolen;
    hooks.stolen?.(stolen, st);
    st.hull = def.hull * 0.35;
    st.immune = RAIDS.stationImmune;
    if (rt && scene) combat?.flash(v3(st.pos), def.radius * 1.6, 0xff7a45, 0.7);
    emit(`looted-${st.id}`, st.type === 'wieza'
      ? `${st.name} wyłączona na ${RAIDS.stationImmune} s — systemy uzbrojenia przegrzane.`
      : `${st.name} splądrowana: rabusie zabrali ${Math.round(stolen)} t metalu.`, 'danger');
    bump();
  }

  // ------------------------------------------------------------
  // POMOCNICZE: stacje, magazynowanie, pula metalu
  // ------------------------------------------------------------
  const stationsOf = (sysId) => sysState(sysId)?.stations ?? [];
  const byId = (sysId, id) => stationsOf(sysId).find((s) => s.id === id) ?? null;
  const swarmById = (sysId, id) => sysState(sysId)?.swarms.find((w) => w.id === id) ?? null;
  const freeSpace = (st) => STATIONS[st.type].capacity - sumMetals(st.storage);
  /** Stacje, z których holowniki biorą metal (magazyny najpierw, potem doki). */
  function poolStations(sysId) {
    // krok 12: skład siedziby rasy też jest pulą (po magazynach, przed dokami)
    const rank = { magazyn: 0, siedziba: 1, dok: 2 };
    return stationsOf(sysId).filter((s) => s.status === 'gotowa' && s.type in rank)
      .sort((a, b) => rank[a.type] - rank[b.type]);
  }
  function poolTotals(sysId) {
    const t = zeroMetals();
    for (const s of poolStations(sysId)) for (const m of METAL_ORDER) t[m] += s.storage[m];
    return t;
  }
  function takeFromPool(sysId, metal, amount) {
    let left = amount;
    for (const s of poolStations(sysId)) {
      const k = Math.min(left, s.storage[metal]);
      s.storage[metal] -= k; left -= k;
      if (left <= 1e-9) break;
    }
    return amount - left;
  }
  /** Czy pula + kredyty wystarczą na koszt? */
  function canPay(sysId, cost) {
    if ((cost.credits ?? 0) > state.credits) return false;
    const pool = poolTotals(sysId);
    return METAL_ORDER.every((m) => (cost[m] ?? 0) <= pool[m] + 1e-9);
  }
  function pay(sysId, cost) {
    state.credits -= cost.credits ?? 0;
    for (const m of METAL_ORDER) if (cost[m]) takeFromPool(sysId, m, cost[m]);
  }
  /** Wkłada metal do stacji (do jej pojemności). Zwraca, ile weszło, per metal. */
  function deposit(st, metals) {
    const moved = zeroMetals();
    for (const m of METAL_ORDER) {
      const k = Math.min(metals[m] || 0, freeSpace(st));
      if (k <= 0) continue;
      st.storage[m] += k; metals[m] -= k; moved[m] = k;
    }
    return moved;
  }
  /** Stacja, do której rój oddaje urobek: wskazana, a gdy pełna/nie istnieje - najbliższa z miejscem. */
  function dropStationFor(sysId, swarm, from) {
    const chosen = swarm.drop ? byId(sysId, swarm.drop) : null;
    if (chosen && chosen.status === 'gotowa' && freeSpace(chosen) > 0.5) return chosen;
    let best = null, bestD = Infinity;
    for (const s of stationsOf(sysId)) {
      if (s.status !== 'gotowa' || freeSpace(s) <= 0.5) continue;
      const d = from ? v3(s.pos).distanceTo(from) : 0;
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  // ------------------------------------------------------------
  // RYNEK
  // ------------------------------------------------------------
  function price(metal) {
    const phase = METAL_ORDER.indexOf(metal) * 1.9;
    const drift = 1 + MARKET.drift * Math.sin(state.time / (70 + phase * 9) + phase);
    return METALS[metal].price * state.market[metal] * drift;
  }
  function sell(metal, tons) {
    if (tons <= 0) return 0;
    const kr = tons * price(metal);
    state.credits += kr;
    state.stats.earned += kr;
    state.stats.sold[metal] += tons;
    state.market[metal] = Math.max(MARKET.floor, state.market[metal] - tons * MARKET.impact);
    incomeLog.push([state.time, kr]);
    return kr;
  }

  // ------------------------------------------------------------
  // GRACZ: budowa, rozładunek, wydobycie
  // ------------------------------------------------------------
  /** Sprawdza, czy można postawić stację typu `type` w `pos`. */
  function canPlace(type, pos) {
    if (!rt) return { ok: false, why: 'Brak układu.' };
    const def = STATIONS[type];
    if ((def.cost.credits ?? 0) > state.credits) return { ok: false, why: `Za mało kredytów (${def.cost.credits} kr).` };
    const p = v3(pos);
    const veto = hooks.canBuildAt?.(p, type);
    if (veto && !veto.ok) return veto;
    for (const s of stationsOf(rt.sysId)) {
      if (v3(s.pos).distanceTo(p) < PLAYER_MINING.minSpacing + STATIONS[s.type].radius) return { ok: false, why: `Za blisko: ${s.name}.` };
    }
    for (const a of rt.belt.asteroids) {
      if (a.position.distanceTo(p) < a.radius * 1.3 + def.radius + 60) return { ok: false, why: `W tym miejscu jest planetoida ${a.name}.` };
    }
    return { ok: true };
  }

  /** Zakłada plac budowy: kredyty od razu, metal trzeba dowieźć (albo przyjdzie z magazynów). */
  function placeStation(type, pos) {
    const chk = canPlace(type, pos);
    if (!chk.ok) { emit('build-fail', chk.why, 'warning'); return null; }
    const sys = sysState(rt.sysId);
    const def = STATIONS[type];
    state.credits -= def.cost.credits ?? 0;
    const count = sys.stations.filter((s) => s.type === type).length + 1;
    const st = {
      id: `s${sys.nextId++}`, type, name: `${def.name} ${count}`, pos: plain(v3(pos)),
      status: 'budowa', need: Object.fromEntries(METAL_ORDER.map((m) => [m, def.cost[m] ?? 0])),
      progress: 0, storage: zeroMetals(), queue: [], buildT: 0, hull: def.hull,
    };
    sys.stations.push(st);
    addStationView(st);
    attachStation(st);
    bump();
    const needTxt = METAL_ORDER.filter((m) => st.need[m] > 0).map((m) => `${st.need[m]} t ${METALS[m].symbol}`).join(', ');
    emit('build', `Plac budowy: ${st.name}. Potrzeba: ${needTxt}. Dowieź metal (Y) albo poczekaj na holowniki z magazynów.`, 'info');
    save();
    return st;
  }

  /**
   * Krok 12: wolne miejsce na stację typu `type` w pobliżu `near` (bez
   * latania statkiem - budowa z mostka). Kolejne pierścienie wokół punktu,
   * najpierw w płaszczyźnie poziomej. Zwraca pozycję albo null.
   */
  function findSpot(type, near, { from = 700, to = 4200, step = 280 } = {}) {
    if (!rt) return null;
    const c = v3(near), p = new THREE.Vector3();
    const credits = state.credits;
    state.credits = Infinity; // tu pytamy tylko o miejsce, nie o pieniądze
    try {
      for (let r = from; r <= to; r += step) {
        const n = Math.max(8, Math.round((Math.PI * 2 * r) / 500));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r * 0.013;
          p.set(c.x + Math.cos(a) * r, c.y + Math.sin(a * 3) * 120, c.z + Math.sin(a) * r);
          if (canPlace(type, p).ok) return p.clone();
        }
      }
    } finally { state.credits = credits; }
    return null;
  }
  /** Plac budowy w wolnym miejscu przy `near` (koszt jak placeStation). */
  function placeNear(type, near, opts) {
    const p = findSpot(type, near, opts);
    if (!p) { emit('build-fail', 'Brak wolnego miejsca na stację w pobliżu.', 'warning'); return null; }
    return placeStation(type, p);
  }

  /** Najbliższa stacja w zasięgu dokowania (od powierzchni). */
  function nearestStation(pos, range = PLAYER_MINING.dockRange) {
    if (!rt) return null;
    let best = null, bestD = Infinity;
    for (const s of stationsOf(rt.sysId)) {
      const d = v3(s.pos).distanceTo(pos) - STATIONS[s.type].radius;
      if (d < range && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  /** Rozładunek ładowni gracza w stacji `st`. Zwraca opis albo null. */
  function unloadAt(st) {
    if (!st) return null;
    const before = sumMetals(state.hold);
    if (before <= 0) { emit('unload', 'Ładownia pusta — najpierw coś wykop (T).', 'info', 2); return null; }
    let text;
    if (st.status === 'budowa') {
      let moved = 0;
      for (const m of METAL_ORDER) {
        const k = Math.min(st.need[m], state.hold[m]);
        st.need[m] -= k; state.hold[m] -= k; moved += k;
      }
      // nadwyżka (np. nikiel, gdy plac chce tylko żelaza) idzie do zapasów
      // przyszłej stacji - inaczej gracz przed pierwszą stacją nie miałby gdzie
      // zrzucić ładowni i utknąłby z pełnym statkiem niepotrzebnego metalu
      const extra = sumMetals(deposit(st, state.hold));
      const left = sumMetals(st.need);
      text = moved + extra > 0
        ? `${st.name}: przyjęto ${Math.round(moved)} t na budowę` + (extra > 0.5 ? ` i ${Math.round(extra)} t do zapasów.` : '.')
          + (left > 0 ? ` Brakuje jeszcze ${Math.round(left)} t.` : ' Materiał kompletny, montaż ruszył.')
        : `${st.name}: brak miejsca.`;
    } else {
      const moved = deposit(st, state.hold);
      const n = sumMetals(moved);
      text = n > 0
        ? (st.type === 'przeladunek'
          ? `${st.name}: przyjęto ${Math.round(n)} t do wysyłki. Kredyty wpłyną w miarę sprzedaży.`
          : `${st.name}: rozładowano ${Math.round(n)} t.`)
        : `${st.name}: brak miejsca.`;
      if (sumMetals(state.hold) > 0.5 && n > 0) text += ` W ładowni zostało ${Math.round(sumMetals(state.hold))} t.`;
    }
    bump();
    emit('unload', text, 'info');
    save();
    return text;
  }

  const _toShip = new THREE.Vector3(), _hit = new THREE.Vector3(), _dirL = new THREE.Vector3(), _n = new THREE.Vector3();
  let playerMineAcc = 0;
  /**
   * Promień wydobywczy: celuje w planetoidę przed dziobem (stożek ~20°) w
   * zasięgu. Zwraca { asteroid, point, full } albo null. Rysuje promień.
   */
  function playerMine(dt, shipPos, fwd, holdCap, active, beamFrom = null) {
    if (!rt || !active) { beam?.hide(); return null; }
    const target = aimedAsteroid(shipPos, fwd, PLAYER_MINING.range);
    if (!target) { beam?.hide(); return null; }
    // punkt trafienia: powierzchnia w stronę statku
    _toShip.copy(shipPos).sub(target.position).normalize();
    if (target.mesh) { _dirL.copy(shipPos); target.mesh.worldToLocal(_dirL).normalize(); } else _dirL.copy(_toShip);
    surfacePoint(target, _dirL, 0, _hit);
    const nose = beamFrom ?? _n.copy(fwd).multiplyScalar(8).add(shipPos);
    beam?.show(nose, _hit, dt);
    const full = sumMetals(state.hold) >= holdCap - 0.01;
    if (!full && remaining(target) > 0) {
      const got = extract(target, Math.min(PLAYER_MINING.rate * dt, holdCap - sumMetals(state.hold)), state.hold);
      state.stats.minedPlayer += got;
      hooks.minedInField?.(target.fieldId, got);
      playerMineAcc += got;
      if (playerMineAcc > 1.5) { markMined(target, _dirL, playerMineAcc); playerMineAcc = 0; }
      sparks?.emit(_hit, _toShip, '#ffc26b', quality < 0.8 ? 3 : 6, 60, 0.9, 0.7, 9);
      if (remaining(target) <= target.total0 * 0.02) depleted(target);
    }
    return { asteroid: target, point: _hit, full };
  }

  const _a = new THREE.Vector3();
  function aimedAsteroid(pos, fwd, range, cone = 0.94) {
    let best = null, bestScore = -Infinity;
    for (const a of rt.belt.asteroids) {
      _a.copy(a.position).sub(pos);
      const dist = _a.length();
      const surf = dist - a.radius;
      if (surf > range) continue;
      const cos = _a.dot(fwd) / Math.max(dist, 1e-6);
      const angR = Math.asin(Math.min(1, a.radius / Math.max(dist, a.radius))); // kątowy promień bryły
      if (cos < Math.min(cone, Math.cos(angR + 0.2))) continue;
      const score = cos - surf / range * 0.3;
      if (score > bestScore) { best = a; bestScore = score; }
    }
    return best;
  }

  /** Wydobywa `tons` z planetoidy w proporcji do pozostałego składu. Zwraca, ile wydobyto. */
  function extract(ast, tons, into) {
    const left = remaining(ast);
    if (left <= 0 || tons <= 0) return 0;
    const k = Math.min(1, tons / left);
    let got = 0;
    for (const m of METAL_ORDER) {
      const take = ast.reserves[m] * k;
      ast.reserves[m] -= take; into[m] += take; got += take;
    }
    const sys = sysState(rt?.sysId ?? ast.sysId);
    if (sys) sys.mined[ast.id] = ast.reserves;
    return got;
  }

  function depleted(ast) {
    if (ast.depleted) return;
    ast.depleted = true;
    markDepleted(ast);
    emit(`depleted-${ast.id}`, `Planetoida ${ast.name} wyczerpana.`, 'info');
    bump();
  }

  // ------------------------------------------------------------
  // ROJE I DRONY
  // ------------------------------------------------------------
  function createSwarm(dockId, { temp = false } = {}) {
    if (!rt) return null;
    const sys = sysState(rt.sysId);
    const dock = byId(rt.sysId, dockId);
    if (!dock || dock.type !== 'dok' || dock.status !== 'gotowa') { emit('swarm', 'Rój potrzebuje gotowego doku.', 'warning'); return null; }
    const used = new Set(Object.values(state.systems).flatMap((s) => s.swarms.map((w) => w.name)));
    const name = `Rój ${SWARM_NAMES.find((n) => !used.has(`Rój ${n}`)) ?? sys.nextId}`;
    const sw = { id: `w${sys.nextId++}`, name, home: dock.id, drop: null, target: 'auto', prefer: null, mode: 'wydobycie', drones: 0, evac: true, ...(temp ? { temp: true } : {}) };
    sys.swarms.push(sw);
    bump();
    save();
    return sw;
  }
  // ------------------------------------------------------------
  // OBIEKTY TYMCZASOWE (misje): gotowe od ręki, bez kosztów, poza zapisem
  // ------------------------------------------------------------
  /** Stacja gotowa od razu, bez kosztów i sprawdzania miejsca (scenariusz misji). */
  function placeReady(type, pos, { name = null, storage: stock = null, temp = true, yaw = null } = {}) {
    if (!rt) return null;
    const sys = sysState(rt.sysId);
    const def = STATIONS[type];
    const st = {
      id: `s${sys.nextId++}`, type, name: name ?? def.name, pos: plain(v3(pos)), status: 'gotowa',
      need: zeroMetals(), progress: 1, storage: { ...zeroMetals(), ...(stock ?? {}) }, queue: [], buildT: 0, hull: def.hull,
      ...(temp ? { temp: true } : {}), ...(yaw != null ? { yaw } : {}),
    };
    sys.stations.push(st);
    addStationView(st);
    attachStation(st);
    bump();
    return st;
  }
  /** `n` dronów roju od razu w doku (bez produkcji). */
  function spawnDrones(swarmId, n) {
    const sw = rt && swarmById(rt.sysId, swarmId);
    if (!sw) return 0;
    for (let i = 0; i < n; i++) { sw.drones++; rt.drones.push(newDrone(sw)); }
    bump();
    return n;
  }
  /** Usuwa wszystko, co tymczasowe: stacje, ich roje i drony. */
  function removeTemp() {
    if (!rt) return;
    const sys = sysState(rt.sysId);
    for (const sw of sys.swarms.filter((w) => w.temp)) {
      for (const d of rt.drones.filter((x) => x.swarm === sw)) removeDrone(d);
      sys.swarms.splice(sys.swarms.indexOf(sw), 1);
    }
    for (const st of sys.stations.filter((x) => x.temp)) {
      const r = rt.stationRt.get(st.id);
      if (r) { combat?.unregister(r.actor); rt.stationRt.delete(st.id); }
      const v = rt.views.get(st.id);
      if (v) { scene.remove(v.group); disposeObject(v.group); rt.views.delete(st.id); }
      sys.stations.splice(sys.stations.indexOf(st), 1);
    }
    bump();
  }

  function dockLoad(sysId, dockId) {
    const sys = sysState(sysId);
    const queued = byId(sysId, dockId)?.queue.length ?? 0;
    return sys.swarms.filter((w) => w.home === dockId).reduce((a, w) => a + w.drones, 0) + queued;
  }
  /** Zamawia `n` dronów dla roju (budowa w doku bazowym, koszt pobierany przy starcie każdego). */
  function orderDrones(swarmId, n = 1) {
    if (!rt) return 0;
    const sw = swarmById(rt.sysId, swarmId);
    const dock = sw && byId(rt.sysId, sw.home);
    if (!dock) return 0;
    const free = STATIONS.dok.droneSlots - dockLoad(rt.sysId, dock.id);
    const k = Math.max(0, Math.min(n, free));
    for (let i = 0; i < k; i++) dock.queue.push(sw.id);
    if (k < n) emit('dock-full', `${dock.name}: brak miejsc (limit ${STATIONS.dok.droneSlots} dronów). Postaw kolejny dok.`, 'warning', 3);
    bump();
    save();
    return k;
  }
  /** Rozbiera `n` dronów roju (w doku: odzysk połowy metalu do magazynu doku). */
  function scrapDrones(swarmId, n = 1) {
    if (!rt) return 0;
    const sw = swarmById(rt.sysId, swarmId);
    if (!sw) return 0;
    const dock = byId(rt.sysId, sw.home);
    let k = 0;
    // najpierw z kolejki produkcji, potem drony w doku, na końcu dowolne
    for (let i = dock.queue.length - 1; i >= 0 && k < n; i--) if (dock.queue[i] === sw.id) { dock.queue.splice(i, 1); k++; }
    const mine = rt.drones.filter((d) => d.swarm === sw);
    mine.sort((a, b) => (a.state === 'dok' ? 0 : 1) - (b.state === 'dok' ? 0 : 1));
    for (const d of mine) {
      if (k >= n) break;
      removeDrone(d);
      sw.drones--; k++;
      const back = {};
      for (const m of METAL_ORDER) back[m] = (DRONE.cost[m] ?? 0) * 0.5 + (d.cargo[m] || 0);
      deposit(dock, back);
    }
    bump();
    save();
    return k;
  }
  function disbandSwarm(swarmId) {
    const sw = rt && swarmById(rt.sysId, swarmId);
    if (!sw) return;
    scrapDrones(swarmId, sw.drones + 999);
    const sys = sysState(rt.sysId);
    sys.swarms.splice(sys.swarms.indexOf(sw), 1);
    bump();
    save();
  }
  function setSwarm(swarmId, patch) {
    const sw = rt && swarmById(rt.sysId, swarmId);
    if (!sw) return;
    Object.assign(sw, patch);
    if ('target' in patch || 'prefer' in patch) for (const d of rt.drones) if (d.swarm === sw && (d.state === 'lot' || d.state === 'ladowanie')) d.ast = null;
    bump();
    save();
  }

  let droneSeq = 0;
  function newDrone(sw, at = null) {
    const home = byId(rt.sysId, sw.home);
    const d = {
      swarm: sw, state: 'dok', pos: at ? at.clone() : (home ? v3(home.pos) : new THREE.Vector3()),
      vel: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), cargo: zeroMetals(), load: 0,
      ast: null, site: new THREE.Vector3(), timer: random() * 2, minedAcc: 0,
      jitter: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(2),
      drop: null, hull: DRONE.hull, alive: true, id: `dron-${++droneSeq}`,
    };
    // w doku dron jest schowany: nie da się go trafić ani wybrać na cel
    const alive = () => d.alive && d.state !== 'dok';
    d.contact = {
      id: d.id, kind: 'drone', drone: d, side: 'ally', value: 0.35,
      position: d.pos, velocity: d.vel,
      get hullFrac() { return d.hull / DRONE.hull; },
      radius: 7, recentAttackers: new Map(), isAlive: alive,
    };
    d.actor = { side: 'ally', position: d.pos, radius: 7, isAlive: alive, takeDamage: (a) => damageDrone(d, a) };
    combat?.register(d.actor);
    return d;
  }
  function removeDrone(d) {
    const i = rt.drones.indexOf(d);
    if (i >= 0) rt.drones.splice(i, 1);
    combat?.unregister(d.actor);
  }
  function damageDrone(d, amount) {
    if (!d.alive) return;
    d.hull -= amount;
    if (d.hull > 0) { sparks?.emit(d.pos, _n.set(0, 1, 0), '#ffffff', 4, 40, 1, 0.3, 4); return; }
    d.alive = false;
    removeDrone(d);
    d.swarm.drones = Math.max(0, d.swarm.drones - 1);
    state.stats.dronesLost++;
    combat?.flash(d.pos, 34, 0xffa640, 0.5);
    sparks?.emit(d.pos, _n.set(0, 1, 0), '#ffb13d', 14, 70, 1, 0.8, 6);
    hooks.droneLost?.(d);
    emit('drone-lost', `Tracimy drony! ${d.swarm.name}: zostało ${d.swarm.drones}.`, 'danger', 6);
    bump();
  }

  /** Cel roju: wskazana planetoida albo najlepsza pod względem wartości/odległości. */
  function swarmTarget(sw, from) {
    const belt = rt.belt;
    if (sw.target !== 'auto') {
      const a = belt.asteroids.find((x) => x.id === sw.target);
      if (a && remaining(a) > a.total0 * 0.02) return a;
      if (a && !sw._warned) { sw._warned = true; emit(`swarm-target-${sw.id}`, `${sw.name}: złoże ${a.name} wyczerpane, przechodzę na automatyczny wybór.`, 'info'); }
      sw.target = 'auto';
      bump();
    }
    let best = null, bestScore = -Infinity;
    for (const a of belt.asteroids) {
      const left = remaining(a);
      if (left <= a.total0 * 0.02) continue;
      if (sw.field && sw.field !== 'auto' && a.fieldId !== sw.field) continue;
      if (hooks.canMineField && !hooks.canMineField(a.fieldId)) continue; // cudze pole (krok 11)
      let value = 0;
      for (const m of METAL_ORDER) value += a.reserves[m] * price(m) * (sw.prefer === m ? 4 : 1);
      const score = Math.log(1 + value) - a.position.distanceTo(from) / 2500;
      if (score > bestScore) { best = a; bestScore = score; }
    }
    return best;
  }

  const _t = new THREE.Vector3(), _dv = new THREE.Vector3(), _q = new THREE.Vector3();
  function steer(d, target, dt, arriveR = 8) {
    _t.copy(target).sub(d.pos);
    const dist = _t.length();
    const want = Math.min(DRONE.speed, dist * 1.4 + 4);
    _dv.copy(_t).multiplyScalar(want / Math.max(dist, 1e-6)).sub(d.vel);
    const maxDv = DRONE.accel * dt * 3;
    if (_dv.length() > maxDv) _dv.setLength(maxDv);
    d.vel.add(_dv);
    d.pos.addScaledVector(d.vel, dt);
    if (d.vel.lengthSq() > 1) d.dir.copy(d.vel).normalize();
    return dist < arriveR;
  }

  function updateDrones(dt) {
    const sysId = rt.sysId;
    // max ~3 starty/s na układ - rój wylatuje sznurem, nie "wybuchem"
    rt.launchAcc = Math.min(3, (rt.launchAcc ?? 0) + dt * 3);
    for (const d of [...rt.drones]) {
      const sw = d.swarm;
      const home = byId(sysId, sw.home);
      if (!home) continue;
      const evac = rt.alert && sw.evac !== false;
      if (evac && d.state !== 'dok' && d.state !== 'ewakuacja') { d.state = 'ewakuacja'; d.drop = null; }
      switch (d.state) {
        case 'ewakuacja': {
          if (!evac) { d.state = d.load > 0.01 ? 'powrot' : 'lot'; d.ast = null; break; }
          if (steer(d, v3(home.pos), dt, STATIONS.dok.radius * 0.6)) {
            deposit(home, d.cargo); // urobek zostaje w doku (co się zmieści)
            d.load = sumMetals(d.cargo);
            d.state = 'dok'; d.timer = random() * 2;
          }
          break;
        }
        case 'dok': {
          d.pos.copy(v3(home.pos));
          if (sw.mode === 'wydobycie' && !evac) {
            d.timer -= dt;
            if (d.timer <= 0 && rt.launchAcc >= 1) {
              rt.launchAcc -= 1;
              d.state = 'lot'; d.ast = null;
              d.pos.y -= STATIONS.dok.radius * 0.5; // zatoka u spodu doku
              d.vel.set(0, -40, 0);
            }
          }
          break;
        }
        case 'lot': case 'ladowanie': {
          if (sw.mode === 'powrot') { d.state = 'powrot'; break; }
          if (!d.ast || remaining(d.ast) <= d.ast.total0 * 0.02) {
            d.ast = swarmTarget(sw, d.pos);
            if (!d.ast) { d.state = 'powrot'; emit('no-ore', 'Pas wyczerpany: brak złóż dla rojów w tym układzie.', 'warning', 30); break; }
            // losowe miejsce na półkuli zwróconej do drona: krótsze lądowanie, rój rozłożony po skale
            _q.copy(d.pos); d.ast.mesh ? d.ast.mesh.worldToLocal(_q) : _q.sub(d.ast.position);
            d.site.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize().addScaledVector(_q.normalize(), 1.2).normalize();
            d.carryFrom = null;
            d.state = 'lot';
          }
          // dopasowanie ruchu: punkt nad obracającą się skałą przesuwa się (do
          // ~20 j./s na dużych planetoidach), więc dron najpierw "jedzie" razem z
          // nim, a dopiero potem się do niego zbliża - jak przy prawdziwym dokowaniu
          const lift = d.state === 'lot' ? 30 + d.ast.radius * 0.25 : DRONE.hover;
          surfacePoint(d.ast, d.site, lift, _t);
          if (d.state === 'lot') _t.addScaledVector(d.jitter, 6);
          if (d.carryFrom && d.carryAst === d.ast && d.carryLift === lift) d.pos.add(_dv.copy(_t).sub(d.carryFrom));
          d.carryFrom = (d.carryFrom ?? new THREE.Vector3()).copy(_t);
          d.carryAst = d.ast; d.carryLift = lift;
          if (d.state === 'lot') {
            if (steer(d, _t, dt, 14)) d.state = 'ladowanie';
          } else if (steer(d, _t, dt, 2.5)) { d.state = 'wiercenie'; d.timer = 0; d.carryFrom = null; }
          break;
        }
        case 'wiercenie': {
          surfacePoint(d.ast, d.site, DRONE.hover, _t);
          d.pos.copy(_t);
          d.vel.set(0, 0, 0);
          _q.copy(d.ast.position).sub(d.pos).normalize();
          d.dir.lerp(_q, Math.min(1, dt * 4)).normalize();
          const got = extract(d.ast, Math.min(DRONE.mineRate * dt, DRONE.hold - d.load), d.cargo);
          d.load += got;
          state.stats.minedDrones += got;
          hooks.minedInField?.(d.ast.fieldId, got);
          d.minedAcc += got;
          if (d.minedAcc > 2) { markMined(d.ast, d.site, d.minedAcc); d.minedAcc = 0; }
          d.timer += dt;
          if (sparks && d.timer > 0.12) {
            d.timer = 0;
            _dv.copy(_q).negate();
            sparks.emit(d.pos, _dv, remaining(d.ast) && d.ast.cls === 'M' ? '#ffe6a8' : '#ffb13d', 1, 22, 1, 0.45, 2.5);
          }
          if (remaining(d.ast) <= d.ast.total0 * 0.02) depleted(d.ast);
          if (d.load >= DRONE.hold - 1e-6 || d.ast.depleted || sw.mode === 'powrot') {
            d.state = 'powrot'; d.vel.copy(_q).multiplyScalar(-30);
          }
          break;
        }
        case 'powrot': case 'czeka': {
          if (d.load <= 0.01 && sw.mode === 'powrot') {
            if (steer(d, v3(home.pos), dt, STATIONS.dok.radius * 0.6)) { d.state = 'dok'; d.timer = random(); }
            break;
          }
          if (d.load <= 0.01) { d.state = 'lot'; d.ast = null; break; }
          const drop = (d.drop && byId(sysId, d.drop) && freeSpace(byId(sysId, d.drop)) > 0.5) ? byId(sysId, d.drop) : dropStationFor(sysId, sw, d.pos);
          if (!drop) {
            d.state = 'czeka';
            emit('storage-full', 'Magazyny pełne: drony czekają z urobkiem. Postaw magazyn albo stację przeładunkową.', 'warning', 25);
            _t.copy(v3(home.pos)).addScaledVector(d.jitter, STATIONS.dok.radius * 1.6);
            steer(d, _t, dt, 20);
            break;
          }
          d.drop = drop.id;
          d.state = 'powrot';
          _t.copy(v3(drop.pos)).addScaledVector(d.jitter, STATIONS[drop.type].radius * 0.35);
          if (steer(d, _t, dt, STATIONS[drop.type].radius * 0.5)) { d.state = 'rozladunek'; d.timer = DRONE.unloadTime; }
          break;
        }
        case 'rozladunek': {
          d.vel.multiplyScalar(Math.max(0, 1 - dt * 3));
          d.pos.addScaledVector(d.vel, dt);
          d.timer -= dt;
          if (d.timer <= 0) {
            const st = byId(sysId, d.drop);
            if (st) deposit(st, d.cargo);
            d.load = sumMetals(d.cargo);
            d.drop = null;
            d.state = d.load > 0.01 ? 'czeka' : (sw.mode === 'powrot' ? 'powrot' : 'lot');
            d.ast = sw.target === 'auto' ? d.ast : null;
          }
          break;
        }
      }
    }
  }

  function drawDrones(time) {
    if (!drones3d) return;
    drones3d.begin();
    for (const d of rt.drones) {
      if (d.state === 'dok') continue;
      const pulse = d.state === 'wiercenie' ? 0.7 + 0.5 * Math.sin(time * 18 + d.jitter.x * 10) : 1;
      drones3d.push(d.pos, d.dir, d.state, pulse);
    }
    drones3d.end();
  }

  // ------------------------------------------------------------
  // PLATFORMY OBRONNE
  // ------------------------------------------------------------
  const _aim = new THREE.Vector3(), _mz = new THREE.Vector3(), _fd = new THREE.Vector3();
  function updateTowers(dt) {
    if (!combat) return;
    const hostiles = getHostiles?.() ?? [];
    const def = STATIONS.wieza;
    for (const st of stationsOf(rt.sysId)) {
      if (st.type !== 'wieza' || st.status !== 'gotowa' || st.immune > 0) continue;
      const r = rt.stationRt.get(st.id);
      const pos = r.contact.position;
      // cel: najbliższy żywy wróg w zasięgu (trzymamy poprzedni, dopóki w zasięgu)
      let t = r.target;
      if (!t || !t.alive || t.hidden || t.group.position.distanceTo(pos) > def.range) {
        t = null;
        let best = def.range;
        for (const h of hostiles) {
          if (!h.alive || h.hidden || h.arriving) continue;
          const dd = h.group.position.distanceTo(pos);
          if (dd < best) { best = dd; t = h; }
        }
        r.target = t;
      }
      r.fireCd -= dt * eff(rt.sysId, st);
      if (!t) continue;
      const dist = t.group.position.distanceTo(pos);
      _aim.copy(t.group.position).addScaledVector(t.velocity, dist / def.boltSpeed);
      const v = rt.views.get(st.id);
      if (v?.turret) {
        v.group.updateMatrixWorld();
        v.turret.lookAt(_aim);
        v.turret.updateMatrixWorld();
      }
      if (r.fireCd > 0) continue;
      r.fireCd = def.fireEvery;
      if (v?.turret && v.muzzles.length) {
        _mz.copy(v.muzzles[r.muzzle++ % v.muzzles.length]);
        v.turret.localToWorld(_mz);
      } else _mz.copy(pos).add(_fd.set(0, 60, 0));
      _fd.copy(_aim).sub(_mz).normalize();
      _fd.x += (random() - 0.5) * 0.02; _fd.y += (random() - 0.5) * 0.02; _fd.z += (random() - 0.5) * 0.02;
      combat.fire({
        origin: _mz.clone(), direction: _fd.normalize().clone(), side: 'ally', speed: def.boltSpeed,
        damage: def.damage, color: 0xffa060, life: def.range / def.boltSpeed + 0.3, shooter: r.shooter, hitScale: 1.8,
      });
      hooks.towerFire?.(st, _mz);
    }
  }

  /**
   * Nalot rozstrzygnięty "zaocznie" (gracza nie ma w układzie albo odleciał
   * w trakcie). Platformy zatrzymują po RAIDS.towerKills rabusiów, reszta
   * niszczy drony (roje z ewakuacją tracą połowę mniej) i łupi stacje.
   */
  function resolveRaidOffline(sysId, raiders, extraDefense = 0) {
    const sys = sysState(sysId);
    if (!sys) return null;
    const towers = sys.stations.filter((s) => s.type === 'wieza' && s.status === 'gotowa').length;
    // extraDefense (krok 11): siła armii gracza w układzie - ~1 zatrzymany napastnik na punkt siły
    const stop = towers * RAIDS.towerKills + Math.floor(extraDefense);
    const through = Math.max(0, raiders - stop);
    const killed = Math.min(raiders, stop);
    let dronesLost = 0, stolen = 0;
    if (through > 0) {
      for (const sw of sys.swarms) {
        const k = Math.min(sw.drones, Math.round(through * 3 * (sw.evac !== false ? 0.5 : 1)));
        sw.drones -= k; dronesLost += k;
        if (rt?.sysId === sysId) for (const d of rt.drones.filter((x) => x.swarm === sw).slice(0, k)) removeDrone(d);
      }
      const share = Math.min(0.6, RAIDS.stationLoot * through / 3);
      for (const st of sys.stations) for (const m of METAL_ORDER) { const k = st.storage[m] * share; st.storage[m] -= k; stolen += k; }
    }
    state.stats.dronesLost += dronesLost;
    state.stats.stolen += stolen;
    state.stats.raidersKilled += killed;
    const bounty = killed * RAIDS.bounty;
    state.credits += bounty;
    state.stats.bounty += bounty;
    bump();
    save();
    return { raiders, towers, killed, dronesLost, stolen, bounty, repelled: through === 0 };
  }

  // ------------------------------------------------------------
  // SYMULACJA UKŁADU (wspólna: bieżący i "zaoczne")
  // ------------------------------------------------------------
  function tickSystem(sysId, dt, detailed) {
    const sys = sysState(sysId);
    if (!sys) return;

    // 0) stacje: odliczanie po splądrowaniu, powolna naprawa kadłuba (bez ostrzału od 10 s)
    for (const st of sys.stations) {
      const def = STATIONS[st.type];
      st.hull ??= def.hull;
      if (st.immune > 0) { st.immune = Math.max(0, st.immune - dt); if (!st.immune) bump(); }
      const lastHit = rt?.sysId === sysId ? rt.stationRt.get(st.id)?.lastHit ?? -99 : -99;
      if (st.hull < def.hull && state.time - lastHit > 10) st.hull = Math.min(def.hull, st.hull + def.hull * 0.01 * dt);
    }

    // 1) budowy: holowniki dowożą brakujący metal z puli, potem montaż
    let tugBudget = LOGISTICS.rate * dt;
    const lanes = [];
    for (const st of sys.stations) {
      if (st.status !== 'budowa') continue;
      if (sumMetals(st.need) > 0) {
        for (const m of METAL_ORDER) {
          if (st.need[m] <= 0 || tugBudget <= 0) continue;
          const src = poolStations(sysId).find((s) => s.storage[m] > 0.01);
          const k = takeFromPool(sysId, m, Math.min(st.need[m], tugBudget));
          st.need[m] -= k; tugBudget -= k;
          if (k > 0 && src && detailed) lanes.push({ from: v3(src.pos), to: v3(st.pos) });
        }
        if (sumMetals(st.need) <= 1e-6) { st.need = zeroMetals(); bump(); }
      } else {
        st.progress = Math.min(1, st.progress + dt * eff(sysId, st) / STATIONS[st.type].buildTime);
        if (st.progress >= 1) {
          st.status = 'gotowa';
          bump();
          emit(`built-${st.id}`, `${st.name} ukończona. ${STATIONS[st.type].role}`, 'info');
          save();
        }
      }
    }

    // 2) produkcja dronów w dokach
    for (const st of sys.stations) {
      if (st.type !== 'dok' || st.status !== 'gotowa' || !st.queue.length) continue;
      if (st.buildT <= 0) {
        if (!canPay(sysId, DRONE.cost)) {
          if (detailed) emit(`dock-wait-${st.id}`, `${st.name}: za mało metalu lub kredytów na drona (${Object.entries(DRONE.cost).map(([k, v]) => k === 'credits' ? `${v} kr` : `${v} t ${METALS[k].symbol}`).join(', ')}).`, 'warning', 20);
          continue;
        }
        pay(sysId, DRONE.cost);
        st.buildT = DRONE.buildTime;
      }
      st.buildT -= dt * eff(sysId, st);
      if (st.buildT <= 0) {
        st.buildT = 0;
        const swId = st.queue.shift();
        const sw = sys.swarms.find((w) => w.id === swId);
        if (sw) {
          sw.drones++;
          state.stats.dronesBuilt++;
          if (detailed && rt?.sysId === sysId) rt.drones.push(newDrone(sw));
          if (!st.queue.length) emit(`dock-done-${st.id}`, `${st.name}: zamówione drony gotowe (${sw.name}: ${sw.drones}).`, 'info');
        }
        bump();
      }
    }

    // 3) sprzedaż z buforów stacji przeładunkowych
    for (const st of sys.stations) {
      if (st.type !== 'przeladunek' || st.status !== 'gotowa') continue;
      let budget = STATIONS.przeladunek.throughput * dt * eff(sysId, st);
      // najpierw najdroższe - frachtowiec zabiera to, co się najbardziej opłaca
      for (const m of [...METAL_ORDER].sort((a, b) => price(b) - price(a))) {
        const k = Math.min(budget, st.storage[m]);
        if (k <= 0) continue;
        st.storage[m] -= k; budget -= k;
        sell(m, k);
      }
    }

    // 4) roje "zaocznie": średnia wydajność zamiast pojedynczych dronów
    if (!detailed) {
      const belt = beltFor(sysId);
      for (const sw of sys.swarms) {
        if (sw.mode !== 'wydobycie' || sw.drones <= 0) continue;
        const home = byId(sysId, sw.home);
        if (!home) continue;
        let ast = sw.target !== 'auto' ? belt.asteroids.find((a) => a.id === sw.target) : null;
        if (!ast || remaining(ast) <= ast.total0 * 0.02) {
          ast = belt.asteroids.filter((a) => remaining(a) > a.total0 * 0.02)
            .sort((a, b) => b.cls.localeCompare(a.cls) || remaining(b) - remaining(a))[0];
        }
        if (!ast) continue;
        const drop = dropStationFor(sysId, sw, v3(home.pos));
        if (!drop) continue;
        const got = zeroMetals();
        const want = Math.min(sw.drones * DRONE.mineRate * OFFLINE_DUTY * dt, freeSpace(drop));
        const left = remaining(ast), k = Math.min(1, want / Math.max(left, 1e-9));
        for (const m of METAL_ORDER) { const t = ast.reserves[m] * k; ast.reserves[m] -= t; got[m] += t; }
        sys.mined[ast.id] = ast.reserves;
        state.stats.minedDrones += sumMetals(got);
        deposit(drop, got);
      }
    }
    return lanes;
  }

  // ------------------------------------------------------------
  // PĘTLA
  // ------------------------------------------------------------
  function update(dt, camera = null) {
    state.time += dt;
    // rynek wraca do równowagi
    for (const m of METAL_ORDER) state.market[m] += (1 - state.market[m]) * Math.min(1, MARKET.recovery * dt);
    while (incomeLog.length && incomeLog[0][0] < state.time - 60) incomeLog.shift();

    for (const id of Object.keys(state.systems)) {
      const lanes = tickSystem(id, dt, rt?.sysId === id);
      if (rt?.sysId === id) rt.lanes = lanes;
    }
    if (rt) {
      rt.time += dt;
      for (const v of rt.fieldViews.values()) v.update(dt);
      updateDrones(dt);
      drawDrones(rt.time);
      // stacje: postęp budowy, obrót, światła, iskry spawania
      for (const st of stationsOf(rt.sysId)) {
        const v = rt.views.get(st.id);
        if (!v) continue;
        const ready = st.status === 'gotowa';
        setStationProgress(v, st.progress, ready);
        animateStation(v, dt, rt.time, ready);
        if (!ready && sumMetals(st.need) <= 0 && sparks && Math.random() < dt * 12) {
          const p = v.parts[Math.min(v.parts.length - 1, Math.floor(st.progress * v.parts.length))];
          if (p) { p.getWorldPosition(_hit); sparks.emit(_hit, _n.set(0, 1, 0), '#9fe0ff', 5, 30, 1, 0.5, 4); }
        }
      }
      tugs?.update(rt.lanes ?? [], rt.time);
      updateTowers(dt);
    }
    sparks?.update(dt);

    saveTimer += dt;
    if (saveTimer > 10) { saveTimer = 0; save(); }
  }

  // ------------------------------------------------------------
  // ODCZYT DLA HUD/PANELU
  // ------------------------------------------------------------
  function summary() {
    const sysId = rt?.sysId;
    const drones = { total: 0, wiercenie: 0, lot: 0, powrot: 0, czeka: 0, dok: 0, ewakuacja: 0 };
    for (const d of rt?.drones ?? []) {
      drones.total++;
      const k = d.state === 'ladowanie' ? 'lot' : d.state === 'rozladunek' ? 'powrot' : d.state;
      drones[k] = (drones[k] ?? 0) + 1;
    }
    let offlineDrones = 0;
    for (const [id, s] of Object.entries(state.systems)) if (id !== sysId) offlineDrones += s.swarms.reduce((a, w) => a + w.drones, 0);
    return {
      credits: state.credits,
      income: incomeLog.reduce((a, e) => a + e[1], 0),
      hold: state.hold,
      pool: sysId ? poolTotals(sysId) : zeroMetals(),
      drones, offlineDrones,
      stations: stationsOf(sysId).length,
      prices: Object.fromEntries(METAL_ORDER.map((m) => [m, price(m)])),
      market: state.market,
      stats: state.stats,
    };
  }

  /** Etykiety na ekranie: stacje (zawsze) i planetoida w celowniku. */
  function labelItems(shipPos, fwd) {
    if (!rt) return [];
    const out = [];
    for (const st of stationsOf(rt.sysId)) {
      const def = STATIONS[st.type];
      let sub;
      if (st.status === 'budowa') {
        const need = sumMetals(st.need);
        sub = need > 0 ? `budowa: brakuje ${Math.round(need)} t` : `montaż ${Math.round(st.progress * 100)}%`;
      } else {
        const fill = sumMetals(st.storage) / def.capacity;
        sub = st.type === 'dok'
          ? `${sysState(rt.sysId).swarms.filter((w) => w.home === st.id).reduce((a, w) => a + w.drones, 0)} dronów · ${Math.round(fill * 100)}%`
          : st.type === 'wieza' ? `zasięg ${def.range} j.`
          : `${Math.round(sumMetals(st.storage))} / ${def.capacity} t`;
        if (st.immune > 0) sub = st.type === 'wieza' ? `wyłączona ${Math.ceil(st.immune)} s` : 'splądrowana';
        else if ((st.hull ?? def.hull) < def.hull * 0.98) sub += ` · kadłub ${Math.round(st.hull / def.hull * 100)}%`;
      }
      out.push({ id: `eco-${st.id}`, position: v3(st.pos).add(_n.set(0, def.radius * 0.9, 0)), title: st.name, sub, color: def.accent });
    }
    const a = shipPos && aimedAsteroid(shipPos, fwd, 4000, 0.985);
    if (a) {
      const left = remaining(a);
      const k = ASTEROID_CLASSES[a.cls];
      const rich = METAL_ORDER.filter((m) => a.reserves[m] > 0.5).map((m) => METALS[m].symbol).join(' ');
      out.push({
        id: 'eco-aim', position: a.position.clone().add(_n.set(0, a.radius * 1.05, 0)),
        title: `${a.name} · ${k.name}`, sub: a.depleted ? 'wyczerpana' : `${Math.round(left)} t · ${rich}`, color: '#ffd9a0',
      });
    }
    return out;
  }

  /** Ciała stałe dla kolizji statku (planetoidy + stacje). */
  function solids() {
    if (!rt) return [];
    const out = [];
    for (const a of rt.belt.asteroids) if (a.solid) out.push(a.solid);
    for (const st of stationsOf(rt.sysId)) {
      const v = rt.views.get(st.id);
      if (v && st.status === 'gotowa') out.push({ position: v.group.position, radius: STATIONS[st.type].radius * 0.55, name: st.name });
    }
    return out;
  }

  return {
    get state() { return state; },
    get version() { return structVersion; },
    get runtime() { return rt; },
    get systemId() { return rt?.sysId ?? null; },
    get alert() { return !!rt?.alert; },
    /** Alarm w bieżącym układzie: roje z ewakuacją chowają się w dokach. */
    setAlert(v) { if (rt && rt.alert !== !!v) { rt.alert = !!v; bump(); } },
    /** Cele dla mózgów NPC (npc-ships getContacts): drony poza dokiem i gotowe stacje. */
    contacts() {
      if (!rt) return [];
      const out = [];
      for (const d of rt.drones) if (d.alive && d.state !== 'dok') out.push(d.contact);
      for (const r of rt.stationRt.values()) if (r.contact.isAlive()) out.push(r.contact);
      return out;
    },
    hooks, resolveRaidOffline, systemIds: () => Object.keys(state.systems),
    stationsIn: (id) => stationsOf(id), swarmsIn: (id) => sysState(id)?.swarms ?? [],
    beltCenter: (id) => sysState(id)?.beltCenter ?? null,
    fieldDefs, fieldAt, discoverField, scan, isDiscovered, asteroidsIn, placeReady, spawnDrones, removeTemp,
    // krok 12 (command.js): budowa z mostka, wydobycie wypraw, skład siedziby
    findSpot, placeNear, extract, remaining, depleted, deposit, emit,
    poolOf: (sysId) => poolStations(sysId), stationById: (sysId, id) => byId(sysId, id),
    /** Koszt { credits, metale } z kredytów i puli metalu bieżącego układu (stocznia, krok 11). */
    canPayCost: (cost) => !!rt && canPay(rt.sysId, cost),
    canPayIn: (sysId, cost) => canPay(sysId, cost), payIn: (sysId, cost) => { pay(sysId, cost); bump(); },
    payCost: (cost) => { if (rt) { pay(rt.sysId, cost); bump(); } },
    stationsNear: (sysId, pos, r) => stationsOf(sysId).filter((s) => Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y, s.pos.z - pos.z) < r),
    enterSystem, leaveSystem, update, save, reset,
    // gracz
    playerMine, aimedAsteroid: (pos, fwd, range) => rt && aimedAsteroid(pos, fwd, range), nearestStation, unloadAt, canPlace, placeStation,
    // roje
    createSwarm, orderDrones, scrapDrones, disbandSwarm, setSwarm, dockLoad: (id) => rt && dockLoad(rt.sysId, id),
    // odczyt
    summary, labelItems, solids, price, stations: () => stationsOf(rt?.sysId), swarms: () => sysState(rt?.sysId)?.swarms ?? [],
    asteroids: () => rt?.belt.asteroids ?? [], freeSpace, sumMetals, poolTotals: () => (rt ? poolTotals(rt.sysId) : zeroMetals()),
    dispose() { leaveSystem(); sparks?.dispose(); beam?.dispose(); drones3d?.dispose(); tugs?.dispose(); },
  };
}
