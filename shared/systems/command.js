import * as THREE from 'three';
import { METALS, METAL_ORDER, STATIONS } from '../data/economy.js';
import {
  HQ, DRONE_TYPES, DRONE_TYPE_ORDER, EXPEDITION, POWER, SMELTER, UPGRADES, UPGRADE_TECH, TECHS, TECH_ORDER,
  SENTRY, ORE_ROUTES, FREIGHTER, AUTOMATION,
} from '../data/command.js';

/**
 * DOWÓDZTWO (krok 12): gra widziana z mostka siedziby rasy.
 *
 * Siedziba (stacja 'siedziba' w economy.js) stoi przed polem macierzystym,
 * zwrócona do pasa, a obok niej huta i reaktor. Gracz nie musi latać, żeby
 * gospodarka działała. Wysyła drony z hangaru na WYPRAWY:
 *
 *   wylot -> przelot (w skrócie) -> dolot -> praca -> [pełne: decyzja]
 *         -> odlot -> powrót (w skrócie) -> podejście do huty -> rozładunek
 *
 * Wylot i podejście do huty widać z mostka. Przelot jest skrócony: widok
 * pokazuje go w okienku (command-view.js), a w symulacji to kilka sekund.
 * Zwiadowcy badają skały i odkrywają pola, górnicy i holowniki wożą urobek,
 * strażnicy pilnują pól. Urobek przetapia huta; odzysk metali zależy od
 * nauki (TECHS). Reaktory zasilają stacje układu; niedobór prądu spowalnia
 * pracę stacji (hook economy.hooks.efficiency). Ulepszenia (UPGRADES)
 * kosztują metal i kredyty.
 *
 * Decyzje (pełne ładownie, raport zwiadu, odkrycie naukowców, wyprawa pod
 * ostrzałem) idą przez onDecision({ id, title, text, choices, manage,
 * timeout, defaultAct, onChoose }). Brak odpowiedzi = domyślny wybór, więc
 * gra toczy się sama, a gracz tylko koryguje.
 *
 * KROK 12b:
 *  - WIEŻE STRAŻNICZE (sentries): drony obronne rozstawiane w dowolnym
 *    punkcie (mapa taktyczna). Działko + rakiety, okrąg zasięgu; wyprawy
 *    w zasięgu giną wolniej. Wrogowie mogą je zestrzelić.
 *  - PRZYDZIAŁ DO SEKTORÓW (alloc): gracz mówi "na polu X ma pracować 8
 *    górników i 2 zwiadowców", a zarządca sam wysyła, dosyła i odwołuje
 *    grupy (bez kart decyzji - to jest automatyka).
 *  - TRASY UROBKU (route): huta / magazyn / frachtowiec. Wybór przy wysyłce
 *    górników, potem logistyka działa sama: huta dobiera z magazynów,
 *    pełne magazyny opróżnia frachtowiec (sprzedaż poza układem), a karty
 *    podpowiadają następny krok (większy magazyn, drugi frachtowiec,
 *    szybsza huta) z gotowym przyciskiem.
 *
 * Stan (economy.state.command) jest w zapisie gospodarki. Czysta logika:
 * działa też w Node (testy), bez DOM.
 */

const zero = () => Object.fromEntries(METAL_ORDER.map((m) => [m, 0]));
const sum = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const plain = (v) => ({ x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, z: Math.round(v.z * 10) / 10 });
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const fmt = (n) => Math.round(n).toLocaleString('pl-PL');

/** Fazy wyprawy, w których drony są w przestrzeni (widać je / można je trafić). */
export const VISIBLE_PHASES = new Set(['wylot', 'dolot', 'praca', 'pelne', 'straz', 'odlot', 'podejscie', 'rozladunek']);
export const PHASE_LABEL = {
  wylot: 'wylot z hangaru', przelot: 'w drodze', dolot: 'dolot', praca: 'praca', pelne: 'ładownie pełne',
  straz: 'na straży', odlot: 'odlot', powrot: 'powrót', podejscie: 'podejście do huty', rozladunek: 'rozładunek',
};

export function freshCommand() {
  return {
    home: null, hq: null, hangar: Object.fromEntries(DRONE_TYPE_ORDER.map((t) => [t, 0])), queue: [], buildT: 0,
    expeditions: [], nextId: 1, ore: zero(), upgrades: {}, techs: [], research: null, surveyed: {}, autonomy: {},
    auto: { returns: false }, stats: { expeditions: 0, ore: 0, smelted: zero(), lost: 0, surveyed: 0 },
    ...fresh12b(),
  };
}
/** Pola kroku 12b - dokładane też do starszych zapisów (migrate). */
function fresh12b() {
  return {
    sentries: [], alloc: {}, route: 'huta', askRoute: true, v2: true,
    freighter: { n: 1, hold: zero(), pending: zero(), phase: 'dok', t: 0, idle: 0, earned: 0, trips: 0 },
    stats12b: { sentryKills: 0, sentriesLost: 0, freighted: 0 },
  };
}

export function createCommand({
  economy, onEvent = () => {}, onDecision = () => {}, getHostiles = () => [], combat = null,
  hqName = 'Siedziba', random = Math.random,
}) {
  const migrated = new WeakSet();
  const S = () => {
    const s = (economy.state.command ??= freshCommand());
    if (!migrated.has(s)) { migrated.add(s); migrate(s); }
    return s;
  };
  /** Starsze zapisy: brakujące pola 12b i jednorazowo więcej górników i dwie wieże. */
  function migrate(s) {
    const old = !s.v2;
    const f = fresh12b();
    for (const k of Object.keys(f)) if (s[k] === undefined) s[k] = f[k];
    for (const t of DRONE_TYPE_ORDER) s.hangar[t] ??= 0;
    if (old && s.home) for (const [t, n] of Object.entries(HQ.bonusDrones)) s.hangar[t] += n;
  }
  const emit = (key, text, urgency = 'info') => onEvent({ key, text, urgency });
  let powerCache = new Map(), powerStamp = '';
  const runtime = new Map(); // expId -> { lossAcc, fireCd, flashAt } (poza zapisem)

  // ------------------------------------------------------------
  // SIEDZIBA
  // ------------------------------------------------------------
  const hq = () => { const s = S(); return s.hq ? economy.stationById(s.home, s.hq) : null; };
  const inHome = () => !!S().home && economy.systemId === S().home;
  const ready = (type) => (S().home ? economy.stationsIn(S().home).filter((x) => x.type === type && x.status === 'gotowa') : []);
  const huta = () => ready('huta')[0] ?? null;

  /**
   * Zakłada siedzibę (raz na kampanię) w bieżącym układzie: przed polem
   * macierzystym, zwróconą do pasa, z hutą po prawej i reaktorem po lewej.
   */
  function found() {
    const s = S();
    if (hq()) return hq();
    const sysId = economy.systemId;
    if (!sysId) return null;
    const def = economy.fieldDefs(sysId)[0];
    const sp = economy.state.systems[sysId].spawn;
    const center = v3(def.center);
    const fwd = center.clone().sub(v3(sp.position)).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const pos = center.clone().addScaledVector(fwd, -(HQ.back + def.radius * 0.35)).add(new THREE.Vector3(0, HQ.up, 0));
    const yaw = Math.atan2(fwd.x, fwd.z);
    const st = economy.placeReady('siedziba', pos, { name: hqName, storage: HQ.start, temp: false, yaw });
    const up = new THREE.Vector3(0, 1, 0);
    economy.placeReady('huta', pos.clone().addScaledVector(side, HQ.hutaSide).addScaledVector(fwd, HQ.hutaAhead).addScaledVector(up, HQ.hutaUp), { name: 'Huta orbitalna 1', temp: false, yaw });
    economy.placeReady('reaktor', pos.clone().addScaledVector(side, HQ.reaktorSide).addScaledVector(fwd, HQ.reaktorAhead).addScaledVector(up, HQ.reaktorUp), { name: 'Reaktor 1', temp: false, yaw });
    s.home = sysId;
    s.hq = st.id;
    for (const [t, n] of Object.entries(HQ.startDrones)) s.hangar[t] = n;
    // dwie najbliższe skały znamy od razu (dane z budowy siedziby)
    const near = economy.asteroidsIn(sysId).slice().sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos));
    for (const a of near.slice(0, 2)) s.surveyed[a.id] = true;
    economy.save();
    return st;
  }

  /** Położenie i orientacja siedziby: pozycja, dziób (+Z modelu), bok, kwaternion. */
  const _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
  function frame(out = {}) {
    const st = hq();
    if (!st) return null;
    out.pos = v3(st.pos);
    out.quat = _q.clone().setFromAxisAngle(_Y, st.yaw ?? 0);
    out.fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(out.quat);
    out.side = new THREE.Vector3().crossVectors(out.fwd, _Y).normalize();
    return out;
  }
  const local = (p) => { const f = frame(); return f ? v3(p).applyQuaternion(f.quat).add(f.pos) : null; };
  const hangarPos = () => local(HQ.hangar);
  const bridgePos = () => local(HQ.bridge);
  const launchPos = () => local(HQ.launch);

  // ------------------------------------------------------------
  // ULEPSZENIA, NAUKA
  // ------------------------------------------------------------
  const lvl = (id) => S().upgrades[id] ?? 0;
  const mult = (id) => 1 + UPGRADES[id].per * lvl(id);
  const has = (tech) => S().techs.includes(tech);
  const scaleCost = (cost, k) => Object.fromEntries(Object.entries(cost).map(([m, v]) => [m, Math.round(v * k)]));
  const upgradeCost = (id) => scaleCost(UPGRADES[id].cost, (lvl(id) + 1) ** 1.5);
  const canPay = (cost) => !!S().home && economy.canPayIn(S().home, cost);
  const pay = (cost) => economy.payIn(S().home, cost);

  function upgradeState(id) {
    const d = UPGRADES[id];
    const tech = UPGRADE_TECH[id];
    if (tech && !has(tech)) return { ok: false, why: `wymaga badania: ${TECHS[tech].name}` };
    if (lvl(id) >= d.max) return { ok: false, why: 'maksymalny poziom', max: true };
    if (!canPay(upgradeCost(id))) return { ok: false, why: 'za mało zasobów' };
    return { ok: true };
  }
  function upgrade(id) {
    const chk = upgradeState(id);
    if (!chk.ok) return { ok: false, text: `${UPGRADES[id].name}: ${chk.why}.` };
    pay(upgradeCost(id));
    S().upgrades[id] = lvl(id) + 1;
    economy.save();
    return { ok: true, text: `${UPGRADES[id].name}: poziom ${lvl(id)}.` };
  }

  function techState(id) {
    const s = S(), d = TECHS[id];
    if (has(id)) return { ok: false, done: true, why: 'odkryte' };
    if (s.research?.id === id) return { ok: false, active: true, why: 'w toku' };
    const miss = d.requires.filter((r) => !has(r));
    if (miss.length) return { ok: false, locked: true, why: `wymaga: ${miss.map((r) => TECHS[r].name).join(', ')}` };
    if (s.research) return { ok: false, why: 'laboratoria zajęte' };
    if (!canPay(d.cost)) return { ok: false, why: 'za mało zasobów' };
    return { ok: true };
  }
  function research(id) {
    const chk = techState(id);
    if (!chk.ok) return { ok: false, text: `${TECHS[id].name}: ${chk.why}.` };
    pay(TECHS[id].cost);
    S().research = { id, t: TECHS[id].time };
    economy.save();
    return { ok: true, text: `Laboratoria: ${TECHS[id].name} (${TECHS[id].time} s).` };
  }
  function finishResearch() {
    const s = S();
    const id = s.research.id, d = TECHS[id];
    s.research = null;
    s.techs.push(id);
    economy.save();
    const choices = [{ label: 'Świetnie', act: 'ok', primary: true }];
    const follow = { holowniki: ['holownik', 3], straznicy: ['straznik', 4] }[id];
    if (follow) choices.unshift({ label: `Zbuduj ${follow[1]} × ${DRONE_TYPES[follow[0]].name.toLowerCase()}`, act: 'build', primary: true });
    onDecision({
      id: `tech-${id}`, kind: 'science', title: d.name, text: d.discovery, urgency: 'info',
      choices, timeout: 14, defaultAct: 'ok',
      onChoose: (act) => { if (act === 'build') buildDrones(follow[0], follow[1]); },
    });
  }

  /** Odzysk metalu w hucie (0..1) - nauka + separatory. */
  function recovery(m) {
    let r = SMELTER.recovery[m];
    if (m === 'nikiel' && has('flotacja')) r = 0.95;
    if (m === 'kobalt' && has('lugowanie')) r = 0.75;
    if (m === 'platyna' && has('rafinacja')) r = 0.7;
    if (r > 0) r += UPGRADES['huta-odzysk'].per * lvl('huta-odzysk');
    return Math.min(0.99, r);
  }

  // ------------------------------------------------------------
  // ZASILANIE
  // ------------------------------------------------------------
  function power(sysId) {
    const stamp = `${economy.state.time}|${economy.version}`;
    if (powerStamp !== stamp) { powerCache = new Map(); powerStamp = stamp; }
    if (powerCache.has(sysId)) return powerCache.get(sysId);
    const s = S();
    let supply = 0, demand = 0, autonomous = 0;
    const core = mult('reaktor-rdzen');
    for (const st of economy.stationsIn(sysId)) {
      if (st.status !== 'gotowa') continue;
      if (s.autonomy[st.id]) { autonomous++; continue; }
      supply += (POWER.supply[st.type] ?? 0) * core * (st.type === 'reaktor' && has('reaktory') ? 1.5 : 1);
      demand += POWER.demand[st.type] ?? 0;
    }
    if (sysId === s.home) {
      if (s.queue.length) demand += POWER.hangar;
      if (s.research) demand += POWER.lab;
    }
    const out = { supply, demand, autonomous, ratio: demand <= 0 ? 1 : supply / demand };
    powerCache.set(sysId, out);
    return out;
  }
  /** Mnożnik pracy stacji (hook dla economy.js). */
  function efficiency(sysId, st) {
    if (!st || S().autonomy[st.id] || st.type === 'siedziba' || st.type === 'reaktor' || st.type === 'magazyn' || st.type === 'skladnica') return 1;
    return THREE.MathUtils.clamp(power(sysId).ratio, POWER.minEfficiency, 1);
  }
  const hqEff = () => (S().home ? THREE.MathUtils.clamp(power(S().home).ratio, POWER.minEfficiency, 1) : 1);
  function autonomyState(st) {
    if (S().autonomy[st.id]) return { ok: false, done: true, why: 'ma własne zasilanie' };
    if (!has('ogniwa')) return { ok: false, locked: true, why: `wymaga badania: ${TECHS.ogniwa.name}` };
    if (!(POWER.demand[st.type] > 0)) return { ok: false, why: 'nie pobiera prądu' };
    if (!economy.canPayIn(economy.systemId, POWER.autonomyCost)) return { ok: false, why: 'za mało zasobów' };
    return { ok: true };
  }
  function setAutonomy(stId) {
    const st = economy.stations().find((x) => x.id === stId);
    if (!st) return { ok: false, text: 'Brak stacji.' };
    const chk = autonomyState(st);
    if (!chk.ok) return { ok: false, text: `${st.name}: ${chk.why}.` };
    economy.payIn(economy.systemId, POWER.autonomyCost);
    S().autonomy[st.id] = true;
    economy.save();
    return { ok: true, text: `${st.name}: własne ogniwa zasilania — niezależna od sieci.` };
  }

  // ------------------------------------------------------------
  // HANGAR
  // ------------------------------------------------------------
  const hangarCap = () => Math.round(EXPEDITION.maxHangar * mult('hangar'));
  const fleetCount = () => {
    const s = S();
    return DRONE_TYPE_ORDER.reduce((a, t) => a + (s.hangar[t] ?? 0), 0) + s.queue.length + s.expeditions.reduce((a, e) => a + e.n, 0) + s.sentries.length;
  };
  function droneTypeState(type) {
    const d = DRONE_TYPES[type];
    if (d.tech && !has(d.tech)) return { ok: false, locked: true, why: `wymaga badania: ${TECHS[d.tech].name}` };
    return { ok: true };
  }
  function buildDrones(type, n = 1) {
    const s = S();
    const chk = droneTypeState(type);
    if (!chk.ok) return { ok: false, text: `${DRONE_TYPES[type].name}: ${chk.why}.` };
    const k = Math.max(0, Math.min(n, hangarCap() - fleetCount()));
    if (!k) return { ok: false, text: `Hangar pełny (${hangarCap()} dronów). Rozbuduj hangar w ulepszeniach.` };
    for (let i = 0; i < k; i++) s.queue.push(type);
    economy.save();
    return { ok: true, text: `Hangar: ${k} × ${DRONE_TYPES[type].name.toLowerCase()} w produkcji.` };
  }
  function updateHangar(dt) {
    const s = S();
    if (!s.queue.length || !hq()) return;
    if (s.buildT <= 0) {
      const d = DRONE_TYPES[s.queue[0]];
      if (!canPay(d.cost)) { waitNote(`Hangar czeka na metal lub kredyty (${d.name}).`); return; }
      pay(d.cost);
      s.buildT = d.buildTime / (1 + 0.5 * lvl('hangar'));
    }
    s.buildT -= dt * hqEff();
    if (s.buildT <= 0) {
      s.buildT = 0;
      const type = s.queue.shift();
      s.hangar[type]++;
      if (!s.queue.length) emit('hangar-done', `Hangar: produkcja zakończona. Gotowe: ${DRONE_TYPE_ORDER.filter((t) => s.hangar[t]).map((t) => `${DRONE_TYPES[t].name.toLowerCase()} ${s.hangar[t]}`).join(', ')}.`);
    }
  }
  let waitT = -99;
  function waitNote(text) { if (economy.state.time - waitT > 25) { waitT = economy.state.time; emit('hangar-wait', text, 'warning'); } }

  // ------------------------------------------------------------
  // CELE WYPRAW
  // ------------------------------------------------------------
  const astById = (sysId, id) => economy.asteroidsIn(sysId).find((a) => a.id === id) ?? null;
  const fieldById = (sysId, id) => economy.fieldDefs(sysId).find((d) => d.id === id) ?? null;
  const surveyed = (id) => !!S().surveyed[id];
  const canMine = (fid) => economy.hooks.canMineField?.(fid) ?? true;

  /** Co da się wybrać jako cel wyprawy w układzie siedziby. */
  function targets() {
    const s = S();
    if (!s.home) return { asteroids: [], unknown: [] };
    const base = frame()?.pos ?? new THREE.Vector3();
    const asteroids = economy.asteroidsIn(s.home)
      .filter((a) => economy.remaining(a) > a.total0 * 0.02)
      .map((a) => ({ a, id: a.id, surveyed: surveyed(a.id), dist: a.position.distanceTo(base), field: fieldById(s.home, a.fieldId), foreign: !canMine(a.fieldId) }))
      .sort((x, y) => x.dist - y.dist);
    const unknown = economy.fieldDefs(s.home).filter((d) => !economy.isDiscovered(s.home, d.id))
      .map((d) => ({ def: d, id: d.id, dist: v3(d.center).distanceTo(base) })).sort((x, y) => x.dist - y.dist);
    return { asteroids, unknown };
  }
  function targetInfo(e) {
    const s = S();
    if (e.target.kind === 'field') { const d = fieldById(s.home, e.target.id); return { name: d ? `nieznane złoże (${d.name})` : 'nieznane złoże', pos: d ? v3(d.center) : null, radius: 1200, field: d }; }
    const a = astById(s.home, e.target.id);
    return { name: a?.name ?? '?', pos: a?.position ?? null, radius: a?.radius ?? 100, ast: a, field: a ? fieldById(s.home, a.fieldId) : null };
  }

  // ------------------------------------------------------------
  // WYPRAWY
  // ------------------------------------------------------------
  const speedOf = (type) => DRONE_TYPES[type].speed * mult('drony-naped');
  const holdOf = (e) => DRONE_TYPES[e.type].hold * e.n * mult('drony-ladownie');

  function dispatch(type, n, targetId, { auto = false, silent = false, alloc = null, route = null } = {}) {
    const s = S();
    const d = DRONE_TYPES[type];
    if (!hq()) return { ok: false, text: 'Brak siedziby.' };
    if (d.sentry) return { ok: false, text: 'Wieże strażnicze rozstawiasz na mapie taktycznej.' };
    n = Math.min(n, s.hangar[type]);
    if (n <= 0) return { ok: false, text: `W hangarze nie ma: ${d.name.toLowerCase()}. Zbuduj drony (Hangar).` };
    const isField = economy.fieldDefs(s.home).some((f) => f.id === targetId);
    let target;
    if (isField) {
      if (type !== 'zwiadowca') return { ok: false, text: 'Na nieznane złoże lecą tylko zwiadowcy.' };
      target = { kind: 'field', id: targetId };
    } else {
      const a = astById(s.home, targetId);
      if (!a) return { ok: false, text: 'Nie ma takiej skały w odkrytych polach.' };
      if (d.mine > 0 && !surveyed(a.id)) return { ok: false, text: `${a.name} nie jest zbadana — najpierw wyślij zwiadowców.` };
      if (d.mine > 0 && !canMine(a.fieldId)) return { ok: false, text: `${a.name} leży na cudzym polu — w czasie pokoju drony tam nie kopią.` };
      if (d.mine > 0 && economy.remaining(a) <= a.total0 * 0.02) return { ok: false, text: `${a.name} jest wyczerpana.` };
      target = { kind: 'ast', id: a.id };
    }
    s.hangar[type] -= n;
    const e = {
      id: `x${s.nextId++}`, type, n, n0: n, target, phase: 'wylot', t: 0, cargo: zero(), repeat: !alloc && (auto || !!s.auto.returns),
      name: `${d.name} ${s.nextId - 1}`, alloc,
      route: d.hold > 0 ? (route ?? (alloc ? s.alloc[alloc]?.route : null) ?? s.route) : null,
    };
    s.expeditions.push(e);
    s.stats.expeditions++;
    economy.save();
    if (!silent) emit(`exp-${e.id}`, `${e.name}: ${n} × ${d.name.toLowerCase()} startuje — cel: ${targetInfo(e).name}.`);
    if (d.hold > 0 && !auto && !silent && !alloc && !route && s.askRoute) askRoute(e);
    return { ok: true, exp: e, text: `${e.name} w drodze.` };
  }

  const phaseDur = (e) => ({
    wylot: EXPEDITION.launch, przelot: EXPEDITION.transit, dolot: EXPEDITION.approach, odlot: EXPEDITION.depart,
    powrot: EXPEDITION.transit, podejscie: EXPEDITION.dock, rozladunek: EXPEDITION.unload,
    praca: DRONE_TYPES[e.type].survey ?? Infinity,
  }[e.phase] ?? Infinity);
  function setPhase(e, phase) {
    e.phase = phase; e.t = 0;
    hooks.phase?.(e, phase);
  }
  const byId = (id) => S().expeditions.find((e) => e.id === id) ?? null;

  /** Odwołanie: wyprawa wraca z tym, co ma. */
  function recall(id) {
    const e = byId(id);
    if (!e) return { ok: false, text: 'Brak wyprawy.' };
    if (['odlot', 'powrot', 'podejscie', 'rozladunek'].includes(e.phase)) return { ok: true, text: `${e.name} już wraca.` };
    e.repeat = false;
    if (e.phase === 'wylot' || e.phase === 'przelot') { setPhase(e, 'podejscie'); e.aborted = true; }
    else setPhase(e, 'odlot');
    return { ok: true, text: `${e.name}: odwołana, wraca${sum(e.cargo) > 0.5 ? ` z ${fmt(sum(e.cargo))} t urobku` : ''}.` };
  }
  /** Zmiana celu (wyprawa w pracy/pełna): leci od razu na inną zbadaną skałę. */
  function redirect(id, targetId) {
    const e = byId(id);
    const a = astById(S().home, targetId);
    if (!e || !a) return { ok: false, text: 'Brak celu.' };
    e.target = { kind: 'ast', id: a.id };
    setPhase(e, 'dolot');
    return { ok: true, text: `${e.name}: nowy cel ${a.name}.` };
  }
  /** Zostańcie dłużej: z pełnymi ładowniami nic nie zrobią, ale strażnicy / zwiad tak. */
  function keepWorking(id) { const e = byId(id); if (e && e.phase === 'pelne') { e.hold = true; } }

  /** Najlepsza zbadana skała dla górników (najbliższa z bogatszych). */
  function bestRock(type = 'gornik') {
    const t = targets().asteroids.filter((x) => x.surveyed && !x.foreign);
    if (!t.length) return null;
    const val = (x) => METAL_ORDER.reduce((a, m) => a + x.a.reserves[m] * METALS[m].price * (recovery(m) > 0 ? 1 : 0.15), 0) / (1 + x.dist / 4000);
    return t.sort((p, q) => val(q) - val(p))[0].a;
  }

  function survey(e) {
    const s = S();
    const info = targetInfo(e);
    let rocks = [];
    if (e.target.kind === 'field') {
      if (economy.systemId === s.home) economy.discoverField(e.target.id, { silent: true });
      const all = economy.asteroidsIn(s.home).filter((a) => a.fieldId === e.target.id);
      rocks = has('spektrometria') ? all : all.sort((a, b) => a.position.distanceTo(info.pos) - b.position.distanceTo(info.pos)).slice(0, 3);
      // cel na potrzeby lotu powrotnego: skała, przy której byli
      if (rocks[0]) e.target = { kind: 'ast', id: rocks[0].id, from: 'field' };
    } else {
      const a = info.ast;
      rocks = has('spektrometria') && a ? economy.asteroidsIn(s.home).filter((x) => x.fieldId === a.fieldId) : a ? [a] : [];
    }
    let fresh = 0;
    for (const a of rocks) { if (!s.surveyed[a.id]) fresh++; s.surveyed[a.id] = true; }
    s.stats.surveyed += fresh;
    const best = rocks.slice().sort((p, q) => q.total0 - p.total0)[0];
    const field = best ? fieldById(s.home, best.fieldId) : null;
    economy.save();
    if (!best) return;
    const mix = METAL_ORDER.filter((m) => best.reserves[m] > 1).sort((p, q) => best.reserves[q] - best.reserves[p]).slice(0, 3)
      .map((m) => `${METALS[m].symbol} ${fmt(best.reserves[m])} t`).join(' · ');
    const foreign = field && !canMine(field.id);
    const miners = s.hangar.gornik;
    if (e.alloc) { // przydział do sektora: bez karty, zarządca sam pośle górników, jeśli ich przydzielono
      emit(`survey-${e.id}`, `Zwiad (${field?.name ?? 'pole'}): zbadano ${rocks.length} ${rocks.length === 1 ? 'skałę' : 'skał'}. Najbogatsza: ${best.name} — ${mix}.`);
      return;
    }
    onDecision({
      id: `survey-${e.id}`, kind: 'survey', urgency: 'info',
      title: `Zwiad: ${e.target.from === 'field' ? `odkryto pole ${field?.name ?? ''}` : best.name}`,
      text: `${rocks.length > 1 ? `Zbadane skały: ${rocks.length}. Najbogatsza: ` : ''}${best.name} (klasa ${best.cls}): ${mix}.${foreign ? ' Pole należy do innej rasy — w czasie pokoju drony tam nie kopią.' : miners ? ` Wysłać górników (${Math.min(miners, DRONE_TYPES.gornik.group)})?` : ' Hangar nie ma wolnych górników.'}`,
      choices: foreign || !miners ? [{ label: 'Przyjąłem', act: 'ok', primary: true }]
        : [{ label: 'Tak', act: 'send', primary: true }, { label: 'Nie', act: 'ok' }],
      manage: foreign || !miners ? null : [{ label: 'Poślij wszystkich górników', act: 'send-all' }, { label: 'Poślij holowniki', act: 'send-tugs', disabled: !s.hangar.holownik }],
      timeout: 16, defaultAct: 'ok',
      onChoose: (act) => {
        if (act === 'send') hooks.result(dispatch('gornik', DRONE_TYPES.gornik.group, best.id));
        if (act === 'send-all') hooks.result(dispatch('gornik', s.hangar.gornik, best.id));
        if (act === 'send-tugs') hooks.result(dispatch('holownik', s.hangar.holownik, best.id));
      },
    });
  }

  function askReturn(e) {
    const info = targetInfo(e);
    const cargo = sum(e.cargo);
    const depleted = info.ast && economy.remaining(info.ast) <= info.ast.total0 * 0.02;
    if (has('automatyka') && !e.alloc) e.repeat = true;
    if (e.repeat || e.alloc) { setPhase(e, 'odlot'); emit(`full-${e.id}`, `${e.name}: ładownie pełne (${fmt(cargo)} t) — wracają do huty.`); return; }
    onDecision({
      id: `full-${e.id}`, kind: 'return', urgency: 'info',
      title: `${e.name}: ładownie pełne`,
      text: `${e.n} × ${DRONE_TYPES[e.type].name.toLowerCase()} przy ${info.name}${depleted ? ' (skała wyczerpana)' : ''}: ${fmt(cargo)} t urobku. Wracać do huty?`,
      choices: [{ label: 'Tak', act: 'return', primary: true }, { label: 'Tak, i wracajcie na złoże', act: 'loop' }, { label: 'Nie', act: 'wait' }],
      manage: [
        { label: 'Odwołaj', act: 'return' },
        { label: 'Poślij na inną skałę', act: 'redirect', disabled: !bestRock() },
        { label: 'Przywołaj ochronę', act: 'guard', disabled: !S().hangar.straznik },
        { label: 'Zaalarmuj pozostałych', act: 'alarm' },
      ],
      timeout: EXPEDITION.decisionTimeout, defaultAct: 'return',
      onChoose: (act) => {
        if (!byId(e.id)) return;
        if (act === 'return') setPhase(e, 'odlot');
        if (act === 'loop') { e.repeat = true; setPhase(e, 'odlot'); }
        if (act === 'wait') e.hold = true;
        if (act === 'redirect') { const r = bestRock(); if (r) { setPhase(e, 'odlot'); e.next = r.id; } } // najpierw rozładunek, potem nowa skała
        if (act === 'guard') hooks.result(sendGuards(info.field?.id ?? null, e.target.id));
        if (act === 'alarm') hooks.result(alarmAll());
      },
    });
  }

  /** Strażnicy na pole (albo przy skale wyprawy). */
  function sendGuards(fieldId = null, astId = null) {
    const s = S();
    let target = astId;
    if (!target && fieldId) target = economy.asteroidsIn(s.home).find((a) => a.fieldId === fieldId)?.id ?? null;
    if (!target) target = s.expeditions.find((e) => e.target.kind === 'ast' && e.type !== 'straznik')?.target.id ?? bestRock()?.id;
    if (!target) return { ok: false, text: 'Brak celu dla strażników.' };
    return dispatch('straznik', s.hangar.straznik, target);
  }
  /** Alarm: wszystkie wyprawy wracają, roje doków chowają się (ewakuacja). */
  function alarmAll() {
    let k = 0;
    for (const e of S().expeditions) if (e.type !== 'straznik' && !['odlot', 'powrot', 'podejscie', 'rozladunek'].includes(e.phase)) { recall(e.id); k++; }
    economy.setAlert(true);
    return { ok: true, text: `Alarm: ${k} wypraw wraca, roje w dokach.` };
  }

  // ------------------------------------------------------------
  // POZYCJE (dla widoku i zagrożeń)
  // ------------------------------------------------------------
  /** Punkt dokowania: huta (z urobkiem) albo wylot hangaru. */
  function dockPoint(e) {
    if (DRONE_TYPES[e.type].hold > 0 && !e.aborted) {
      if (e.route === 'frachtowiec') { const p = freighterPos(); if (p) return { pos: p, radius: 90 }; }
      if (e.route === 'magazyn') {
        const st = (e.dropId && economy.stationById(S().home, e.dropId)) || pickStore();
        if (st) { e.dropId = st.id; return { pos: v3(st.pos), radius: STATIONS[st.type].radius }; }
      }
      const h = huta();
      if (h) return { pos: v3(h.pos), radius: STATIONS.huta.radius };
    }
    return { pos: hangarPos(), radius: 20 };
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
  /**
   * Środek grupy wyprawy w świecie (albo null, gdy "w skrócie" - poza
   * przestrzenią). dir - kierunek lotu.
   */
  function pose(e, out = new THREE.Vector3(), dir = null) {
    const f = frame();
    const info = targetInfo(e);
    if (!f || !info.pos) return null;
    const hang = hangarPos();
    const tgt = info.pos;
    const k = Math.min(1, e.t / Math.max(0.01, phaseDur(e)));
    _d.copy(tgt).sub(hang).normalize();
    const setDir = (v) => { if (dir) dir.copy(v).normalize(); };
    switch (e.phase) {
      case 'wylot': {
        // najpierw prosto z hangaru, potem łuk na cel i przyspieszenie
        const s = e.t;
        // (cel za siedzibą też: najpierw ~450 j. przed dziób, dopiero potem zawracają)
        out.copy(hang).addScaledVector(f.fwd, easeOut(Math.min(1, s / 2.2)) * 450);
        out.y += Math.min(1, s / 1.4) * 70; // nad krawędź pokładu - z mostka widać wylot
        const turn = Math.max(0, s - 1.6);
        out.addScaledVector(_d, turn ** 1.7 * 240 * (speedOf(e.type) / 420));
        setDir(_a.copy(f.fwd).lerp(_d, Math.min(1, turn)));
        return out;
      }
      case 'dolot': {
        _a.copy(hang).sub(tgt).normalize();
        const far = _b.copy(tgt).addScaledVector(_a, info.radius + 2400);
        out.copy(far).lerp(_a.clone().multiplyScalar(info.radius + 90).add(tgt), easeOut(k));
        setDir(_a.clone().negate());
        return out;
      }
      case 'praca': case 'pelne': case 'straz': {
        _a.copy(hang).sub(tgt).normalize();
        out.copy(tgt).addScaledVector(_a, info.radius + (e.phase === 'straz' ? 380 : 90));
        setDir(_a.clone().negate());
        return out;
      }
      case 'odlot': {
        _a.copy(hang).sub(tgt).normalize();
        const near = _b.copy(tgt).addScaledVector(_a, info.radius + 90);
        out.copy(near).addScaledVector(_a, easeIn(k) * 2600);
        setDir(_a);
        return out;
      }
      case 'podejscie': case 'rozladunek': {
        const dp = dockPoint(e);
        _a.copy(tgt).sub(dp.pos).normalize(); // od doku w stronę złoża
        const far = _b.copy(dp.pos).addScaledVector(_a, 2600).addScaledVector(f.fwd, 400);
        const near = dp.pos.clone().addScaledVector(_a, dp.radius + 40);
        if (e.phase === 'rozladunek') out.copy(near); else out.copy(far).lerp(near, easeOut(k));
        setDir(_a.clone().negate());
        return out;
      }
      default: return null; // przelot / powrót: w skrócie (okienko podglądu)
    }
  }

  // ------------------------------------------------------------
  // PĘTLA WYPRAW
  // ------------------------------------------------------------
  const _p = new THREE.Vector3();
  function updateExpedition(e, dt) {
    const s = S();
    const d = DRONE_TYPES[e.type];
    e.t += dt;
    const dur = phaseDur(e);
    const info = targetInfo(e);
    if (!info.pos && !['podejscie', 'rozladunek'].includes(e.phase)) { recall(e.id); return; }

    // zagrożenie: wrogowie przy grupie (tylko w układzie, który gracz ogląda)
    if (VISIBLE_PHASES.has(e.phase) && economy.systemId === s.home && pose(e, _p)) threat(e, dt, _p);
    if (e.n <= 0) return;

    switch (e.phase) {
      case 'wylot': if (e.t >= dur) setPhase(e, 'przelot'); break;
      case 'przelot':
        if (e.t >= dur) {
          // zwiadowcy na nieznanym złożu: czujniki łapią pole już przy dolocie (skały widać w okienku)
          if (e.target.kind === 'field' && economy.systemId === s.home) economy.discoverField(e.target.id, { silent: true });
          setPhase(e, 'dolot');
        }
        break;
      case 'dolot':
        if (e.t >= dur) {
          setPhase(e, d.guard ? 'straz' : 'praca');
          emit(`arrive-${e.id}`, d.guard ? `${e.name}: strażnicy na pozycji przy ${info.name}.`
            : d.hold > 0 ? `${e.name}: drony na miejscu (${info.name}) — wiercą.` : `${e.name}: zwiadowcy przy celu (${info.name}) — skanują.`);
        }
        break;
      case 'praca':
        if (d.survey) {
          if (e.t >= d.survey) { survey(e); setPhase(e, 'odlot'); }
          break;
        }
        if (d.hold > 0) {
          const a = info.ast;
          const cap = holdOf(e);
          const want = Math.min(d.mine * e.n * mult('drony-wiertla') * dt, cap - sum(e.cargo));
          if (a && want > 0) { const got = economy.extract(a, want, e.cargo); s.stats.ore += got; }
          const out = !a || economy.remaining(a) <= a.total0 * 0.02;
          if (out && a) economy.depleted(a);
          if (sum(e.cargo) >= cap - 1e-6 || out) { setPhase(e, 'pelne'); askReturn(e); }
        }
        break;
      case 'pelne': break; // czeka na decyzję (onDecision: timeout = powrót)
      case 'straz': guardFire(e, dt); break;
      case 'odlot': if (e.t >= dur) setPhase(e, 'powrot'); break;
      case 'powrot': if (e.t >= dur) setPhase(e, 'podejscie'); break;
      case 'podejscie': if (e.t >= dur) setPhase(e, 'rozladunek'); break;
      case 'rozladunek':
        if (e.t >= dur) {
          const cargo = sum(e.cargo);
          const where = deliver(e);
          s.hangar[e.type] += e.n;
          s.expeditions.splice(s.expeditions.indexOf(e), 1);
          runtime.delete(e.id);
          if (cargo > 0.5 && !e.alloc) emit(`home-${e.id}`, `${e.name}: ${fmt(cargo)} t urobku — ${where}.`);
          hooks.phase?.(e, 'koniec');
          // pętla: następny kurs na to samo złoże (albo na wskazaną skałę); przydział - zarządca sektora
          const next = e.next ?? (e.target.kind === 'ast' ? e.target.id : null);
          const a = next && astById(s.home, next);
          if (!e.alloc && (e.repeat || e.next) && a && economy.remaining(a) > a.total0 * 0.02 && d.hold > 0) {
            dispatch(e.type, e.n, a.id, { auto: e.repeat, silent: true, route: e.route });
          }
          economy.save();
        }
        break;
      default: break;
    }
  }

  function threat(e, dt, pos) {
    const hostiles = getHostiles();
    let near = null, best = EXPEDITION.threatRange;
    for (const h of hostiles) {
      if (!h.alive || h.hidden || h.arriving) continue;
      const dd = h.group.position.distanceTo(pos);
      if (dd < best) { best = dd; near = h; }
    }
    const r = runtime.get(e.id) ?? runtime.set(e.id, { lossAcc: 0, fireCd: 0, warned: false }).get(e.id);
    if (!near) { r.lossAcc = Math.max(0, r.lossAcc - dt * 0.5); return; }
    if (DRONE_TYPES[e.type].guard) return; // strażnicy sami walczą (guardFire)
    const guards = S().expeditions.filter((g) => g.type === 'straznik' && g.phase === 'straz' && targetInfo(g).field?.id === targetInfo(e).field?.id)
      .reduce((a, g) => a + g.n, 0);
    const shield = mult('drony-pancerz') * (1 + guards * 0.5) * (1 + coverAt(pos) * SENTRY.shield);
    r.lossAcc += dt / shield;
    if (!r.warned) {
      r.warned = true;
      onDecision({
        id: `under-fire-${e.id}`, kind: 'threat', urgency: 'danger',
        title: `${e.name} pod ostrzałem`, text: `Wrogie statki przy ${targetInfo(e).name}. Drony giną co kilka sekund.`,
        choices: [{ label: 'Odwołaj', act: 'recall', primary: true }, { label: 'Zostań', act: 'stay' }],
        manage: [
          { label: 'Przywołaj ochronę', act: 'guard', disabled: !S().hangar.straznik },
          { label: 'Zaalarmuj pozostałych', act: 'alarm' },
          { label: 'Poślij flotę', act: 'fleet' },
        ],
        timeout: 10, defaultAct: 'recall',
        onChoose: (act) => {
          if (act === 'recall') hooks.result(recall(e.id));
          if (act === 'guard') hooks.result(sendGuards(targetInfo(e).field?.id ?? null, e.target.id));
          if (act === 'alarm') hooks.result(alarmAll());
          if (act === 'fleet') hooks.fleet?.(targetInfo(e).field?.id ?? null);
        },
      });
    }
    while (r.lossAcc >= EXPEDITION.lossEvery && e.n > 0) {
      r.lossAcc -= EXPEDITION.lossEvery;
      const k = sum(e.cargo) / e.n;
      for (const m of METAL_ORDER) e.cargo[m] *= (e.n - 1) / e.n;
      e.n--;
      S().stats.lost++;
      combat?.flash(pos, 40, 0xffa640, 0.5);
      hooks.lost?.(e, pos, k);
      if (e.n <= 0) {
        S().expeditions.splice(S().expeditions.indexOf(e), 1);
        runtime.delete(e.id);
        emit(`exp-lost-${e.id}`, `${e.name} zniszczona przy ${targetInfo(e).name}.`, 'danger');
        hooks.phase?.(e, 'koniec');
      }
    }
  }

  const _fd = new THREE.Vector3(), _mz = new THREE.Vector3();
  function guardFire(e, dt) {
    if (!combat || economy.systemId !== S().home) return;
    const g = DRONE_TYPES.straznik.guard;
    const r = runtime.get(e.id) ?? runtime.set(e.id, { lossAcc: 0, fireCd: 0 }).get(e.id);
    r.fireCd -= dt * e.n;
    if (r.fireCd > 0 || !pose(e, _mz)) return;
    let t = null, best = g.range;
    for (const h of getHostiles()) {
      if (!h.alive || h.hidden || h.arriving) continue;
      const dd = h.group.position.distanceTo(_mz);
      if (dd < best) { best = dd; t = h; }
    }
    if (!t) { r.fireCd = 0; return; }
    r.fireCd = g.every;
    _mz.x += (random() - 0.5) * 60; _mz.y += (random() - 0.5) * 30; _mz.z += (random() - 0.5) * 60;
    _fd.copy(t.group.position).addScaledVector(t.velocity ?? _fd.set(0, 0, 0), best / 1400).sub(_mz).normalize();
    combat.fire({ origin: _mz.clone(), direction: _fd.clone(), side: 'ally', speed: 1400, damage: g.damage * mult('drony-pancerz'), color: 0xff9a5a, life: g.range / 1400 + 0.3, hitScale: 1.6 });
    hooks.guardFire?.(e, _mz);
  }

  // ------------------------------------------------------------
  // HUTA
  // ------------------------------------------------------------
  function updateSmelter(dt) {
    const s = S();
    const base = hq();
    const total = sum(s.ore);
    if (!base || total <= 1e-6) return;
    const h = huta();
    const rate = h ? SMELTER.rate * mult('huta-piece') * efficiency(s.home, h) : SMELTER.rate * SMELTER.withoutHuta * hqEff();
    const k = Math.min(total, rate * dt);
    const frac = k / total;
    const out = zero();
    for (const m of METAL_ORDER) { const t = s.ore[m] * frac; s.ore[m] -= t; out[m] = t * recovery(m); }
    const made = { ...out };
    economy.deposit(base, out);
    for (const st of economy.poolOf(s.home)) if (sum(out) > 1e-6 && st !== base) economy.deposit(st, out);
    let stored = 0;
    for (const m of METAL_ORDER) { const k2 = made[m] - out[m]; s.stats.smelted[m] += k2; stored += k2; }
    if (sum(out) > 1e-3) {
      // skład pełny: nieprzetopiona część wraca do kolejki huty
      for (const m of METAL_ORDER) if (out[m] > 0) s.ore[m] += out[m] / recovery(m);
      if (economy.state.time - fullT > 30) { fullT = economy.state.time; emit('huta-full', 'Huta stoi: skład siedziby i magazyny są pełne. Sprzedaj metal albo postaw magazyn.', 'warning'); }
    }
    lastSmelt = stored / Math.max(dt, 1e-6);
  }
  let fullT = -99, lastSmelt = 0;

  // ------------------------------------------------------------
  // WIEŻE STRAŻNICZE (krok 12b)
  // ------------------------------------------------------------
  const sentryRange = () => SENTRY.range * (1 + 0.1 * lvl('wieze'));
  const sentryDur = (x) => Math.max(2, v3(x.from).distanceTo(v3(x.phase === 'powrot' ? plain(hangarPos()) : x.pos)) / speedOf('wieza'));
  const sentryRt = new Map(); // id -> { gunCd, rocketCd, actor, contact, pos, lastHit }
  const sentryById = (id) => S().sentries.find((x) => x.id === id) ?? null;

  /** Wysokość rozstawienia: płaszczyzna najbliższego pola (albo siedziby) + zawis. */
  function sentryAltitude(x, z) {
    const s = S();
    let y = frame()?.pos.y ?? 0, best = Infinity;
    for (const d of economy.fieldDefs(s.home)) {
      const dd = Math.hypot(d.center.x - x, d.center.z - z);
      if (dd < best) { best = dd; if (dd < d.radius * 1.6) y = d.center.y; }
    }
    return y + SENTRY.hover;
  }
  /** Rozstawia wieżę z hangaru w punkcie (x, z) układu siedziby. */
  function deploySentry(p) {
    const s = S();
    if (!hq()) return { ok: false, text: 'Brak siedziby.' };
    if (!(s.hangar.wieza > 0)) return { ok: false, text: 'W hangarze nie ma wież strażniczych — zbuduj je (Hangar).' };
    s.hangar.wieza--;
    const pos = plain({ x: p.x, y: p.y ?? sentryAltitude(p.x, p.z), z: p.z });
    const x = { id: `w${s.nextId++}`, pos, from: plain(hangarPos()), phase: 'lot', t: 0, hull: DRONE_TYPES.wieza.hull };
    x.name = `Wieża ${x.id.slice(1)}`;
    s.sentries.push(x);
    economy.save();
    return { ok: true, sentry: x, text: `${x.name} leci na pozycję.` };
  }
  /** Przestawia wieżę (leci z bieżącego miejsca na nowe). */
  function moveSentry(id, p) {
    const x = sentryById(id);
    if (!x) return { ok: false, text: 'Brak wieży.' };
    const cur = sentryPose(x, new THREE.Vector3());
    x.from = plain(cur);
    x.pos = plain({ x: p.x, y: p.y ?? sentryAltitude(p.x, p.z), z: p.z });
    x.phase = 'lot'; x.t = 0;
    economy.save();
    return { ok: true, text: `${x.name}: nowa pozycja.` };
  }
  /** Wieża wraca do hangaru. */
  function recallSentry(id) {
    const x = sentryById(id);
    if (!x) return { ok: false, text: 'Brak wieży.' };
    x.from = plain(sentryPose(x, new THREE.Vector3()));
    x.phase = 'powrot'; x.t = 0;
    economy.save();
    return { ok: true, text: `${x.name} wraca do hangaru.` };
  }
  function sentryPose(x, out = new THREE.Vector3()) {
    if (x.phase === 'straz') return out.set(x.pos.x, x.pos.y + Math.sin(economy.state.time * 0.8 + x.pos.x) * 6, x.pos.z);
    const to = x.phase === 'powrot' ? hangarPos() : v3(x.pos);
    const k = Math.min(1, x.t / sentryDur(x));
    const kk = k * k * (3 - 2 * k);
    return out.copy(v3(x.from)).lerp(to, kk);
  }
  /** Ile wież (na pozycji) osłania punkt. */
  function coverAt(pos, extra = 0) {
    const r = sentryRange() + extra;
    let n = 0;
    for (const x of S().sentries) if (x.phase === 'straz' && Math.hypot(x.pos.x - pos.x, x.pos.y - pos.y, x.pos.z - pos.z) < r) n++;
    return n;
  }
  function sentryRuntime(x) {
    let r = sentryRt.get(x.id);
    if (r) return r;
    const pos = sentryPose(x, new THREE.Vector3());
    const alive = () => S().sentries.includes(x) && x.hull > 0 && economy.systemId === S().home;
    r = { gunCd: random() * 0.3, rocketCd: 1 + random() * 2, pos, lastHit: -99 };
    r.contact = { id: `wz-${x.id}`, kind: 'station', side: 'ally', value: 0.8, position: pos, velocity: new THREE.Vector3(),
      get hullFrac() { return x.hull / DRONE_TYPES.wieza.hull; }, radius: 26, recentAttackers: new Map(), isAlive: alive };
    r.actor = { side: 'ally', position: pos, radius: 26, isAlive: alive, takeDamage: (a) => damageSentry(x, a) };
    r.shooter = { callsign: x.name, contact: r.contact };
    combat?.register(r.actor);
    sentryRt.set(x.id, r);
    return r;
  }
  function dropSentryRt(id) { const r = sentryRt.get(id); if (r) { combat?.unregister(r.actor); sentryRt.delete(id); } }
  function damageSentry(x, a) {
    x.hull -= a;
    const r = sentryRt.get(x.id);
    if (r) r.lastHit = economy.state.time;
    if (x.hull > 0) return;
    const s = S();
    s.sentries.splice(s.sentries.indexOf(x), 1);
    s.stats12b.sentriesLost++;
    if (r) combat?.flash(r.pos, 90, 0xff5a8a, 0.8);
    dropSentryRt(x.id);
    emit(`sentry-lost-${x.id}`, `${x.name} zestrzelona. Zbuduj nową w hangarze i rozstaw na mapie taktycznej.`, 'danger');
    economy.save();
  }
  const _sa = new THREE.Vector3(), _sd = new THREE.Vector3();
  function updateSentries(dt) {
    const s = S();
    const here = economy.systemId === s.home;
    for (const x of s.sentries.slice()) {
      if (x.phase !== 'straz') {
        x.t += dt;
        if (x.t >= sentryDur(x)) {
          if (x.phase === 'powrot') { s.sentries.splice(s.sentries.indexOf(x), 1); s.hangar.wieza++; dropSentryRt(x.id); economy.save(); continue; }
          x.phase = 'straz'; x.t = 0;
          emit(`sentry-${x.id}`, `${x.name} na pozycji — osłania ${fmt(sentryRange())} j. wokół.`);
        }
      }
      if (!here || !combat) continue;
      const r = sentryRuntime(x);
      sentryPose(x, r.pos);
      if (x.phase !== 'straz') continue;
      if (economy.state.time - r.lastHit > 6) x.hull = Math.min(DRONE_TYPES.wieza.hull, x.hull + SENTRY.repair * dt);
      sentryFire(x, r, dt);
    }
    if (!here) for (const id of [...sentryRt.keys()]) dropSentryRt(id);
  }
  function sentryFire(x, r, dt) {
    r.gunCd -= dt; r.rocketCd -= dt;
    if (r.gunCd > 0 && r.rocketCd > 0) return;
    const range = sentryRange();
    let t = null, best = range;
    for (const h of getHostiles()) {
      if (!h.alive || h.hidden || h.arriving) continue;
      const dd = h.group.position.distanceTo(r.pos);
      if (dd < best) { best = dd; t = h; }
    }
    if (!t) { r.gunCd = Math.max(r.gunCd, 0); r.rocketCd = Math.max(r.rocketCd, 0); return; }
    const dmg = mult('wieze');
    if (r.gunCd <= 0) {
      const g = SENTRY.gun;
      r.gunCd = g.every;
      _sa.copy(r.pos).add(_sd.set(0, 14, 0));
      _sd.copy(t.group.position).addScaledVector(t.velocity ?? _sd.set(0, 0, 0), best / g.speed).sub(_sa).normalize();
      _sd.x += (random() - 0.5) * 0.03; _sd.y += (random() - 0.5) * 0.03; _sd.z += (random() - 0.5) * 0.03;
      combat.fire({ origin: _sa.clone(), direction: _sd.normalize().clone(), side: 'ally', speed: g.speed, damage: g.damage * dmg,
        color: 0xff7aa8, life: range / g.speed + 0.3, hitScale: 1.6, shooter: r.shooter });
      hooks.sentryFire?.(x, r.pos, 'gun');
    }
    if (r.rocketCd <= 0) {
      const k = SENTRY.rocket;
      r.rocketCd = k.every;
      _sa.copy(r.pos).add(_sd.set(0, 20, 0));
      _sd.copy(t.group.position).sub(_sa).normalize();
      const target = t.contact ?? { position: t.group.position, velocity: t.velocity, isAlive: () => t.alive && !t.hidden };
      combat.fire({ origin: _sa.clone(), direction: _sd.clone(), side: 'ally', speed: k.speed, maxSpeed: k.maxSpeed, accel: k.accel,
        damage: k.damage * dmg, color: 0xffc27a, life: range / k.speed + 1.5, size: 1.6, hitScale: 1.4, proximity: 30,
        homing: { target, turnRate: k.turnRate }, aoe: { radius: k.aoe.radius, damage: k.aoe.damage * dmg }, shooter: r.shooter });
      hooks.sentryFire?.(x, r.pos, 'rocket');
    }
  }
  /** Cele dla mózgów wrogich NPC: wieże na pozycjach (można je zestrzelić). */
  function contacts() {
    const out = [];
    for (const r of sentryRt.values()) if (r.contact.isAlive()) out.push(r.contact);
    return out;
  }

  // ------------------------------------------------------------
  // PRZYDZIAŁ DRONÓW DO SEKTORÓW (krok 12b)
  // ------------------------------------------------------------
  const ALLOC_TYPES = ['gornik', 'zwiadowca', 'holownik'];
  const expField = (e) => (e.target.kind === 'field' ? e.target.id : astById(S().home, e.target.id)?.fieldId ?? null);
  /** Ile dronów danego typu pracuje teraz z przydziału w polu (także w drodze powrotnej). */
  const allocCount = (fid, type) => S().expeditions.filter((e) => e.alloc === fid && e.type === type).reduce((a, e) => a + e.n, 0);
  function setAlloc(fid, type, n) {
    const s = S();
    if (!fieldById(s.home, fid)) return { ok: false, text: 'Nie ma takiego pola w układzie siedziby.' };
    if (!ALLOC_TYPES.includes(type)) return { ok: false, text: 'Tego typu nie przydziela się do sektora.' };
    const st = droneTypeState(type);
    if (!st.ok) return { ok: false, text: `${DRONE_TYPES[type].name}: ${st.why}.` };
    const a = (s.alloc[fid] ??= { gornik: 0, zwiadowca: 0, holownik: 0, route: s.route });
    a[type] = Math.max(0, Math.min(99, Math.round(n)));
    allocT = 0;
    economy.save();
    return { ok: true, text: `${fieldById(s.home, fid).name}: ${DRONE_TYPES[type].plural} — ${a[type]}.` };
  }
  function setAllocRoute(fid, route) {
    const s = S();
    if (!ORE_ROUTES[route]) return { ok: false, text: 'Nieznana trasa.' };
    const a = (s.alloc[fid] ??= { gornik: 0, zwiadowca: 0, holownik: 0, route });
    a.route = route;
    for (const e of s.expeditions) if (e.alloc === fid && !['podejscie', 'rozladunek'].includes(e.phase)) e.route = route;
    economy.save();
    return { ok: true, text: `${fieldById(s.home, fid)?.name}: urobek → ${ORE_ROUTES[route].name.toLowerCase()}.` };
  }
  /** Stan pola dla mapy taktycznej. */
  function fieldSummary(fid) {
    const s = S();
    const d = fieldById(s.home, fid);
    const rocks = economy.asteroidsIn(s.home).filter((a) => a.fieldId === fid);
    const live = rocks.filter((a) => economy.remaining(a) > a.total0 * 0.02);
    const a = s.alloc[fid] ?? { gornik: 0, zwiadowca: 0, holownik: 0, route: s.route };
    return {
      def: d, id: fid, name: d?.name ?? fid, discovered: economy.isDiscovered(s.home, fid), foreign: !canMine(fid),
      rocks: rocks.length, surveyed: rocks.filter((x) => surveyed(x.id)).length, live: live.length,
      remaining: live.filter((x) => surveyed(x.id)).reduce((t, x) => t + economy.remaining(x), 0),
      want: a, route: a.route ?? s.route,
      now: Object.fromEntries(ALLOC_TYPES.map((t) => [t, allocCount(fid, t)])),
      busy: Object.fromEntries(ALLOC_TYPES.map((t) => [t, s.expeditions.filter((e) => e.type === t && !e.alloc && expField(e) === fid).reduce((x, e) => x + e.n, 0)])),
      cover: d ? coverAt(d.center, d.radius * 0.5) : 0,
    };
  }
  /** Oddziela k dronów z grupy i odsyła je do domu (reszta pracuje dalej). */
  function splitReturn(e, k) {
    const s = S();
    if (k >= e.n) { recall(e.id); e.alloc = null; return; }
    const part = k / e.n;
    const cargo = Object.fromEntries(METAL_ORDER.map((m) => [m, e.cargo[m] * part]));
    for (const m of METAL_ORDER) e.cargo[m] -= cargo[m];
    e.n -= k;
    const back = { ...e, id: `x${s.nextId++}`, n: k, n0: k, cargo, alloc: null, repeat: false, t: 0, name: `${e.name}·${k}` };
    if (e.phase === 'wylot' || e.phase === 'przelot') { back.phase = 'podejscie'; back.aborted = true; } else back.phase = 'odlot';
    s.expeditions.push(back);
  }
  let allocT = 0;
  const allocNoteT = new Map();
  function allocNote(key, text, urgency = 'info') {
    if (economy.state.time - (allocNoteT.get(key) ?? -1e9) < 90) return;
    allocNoteT.set(key, economy.state.time);
    emit(key, text, urgency);
  }
  function updateAlloc(dt) {
    allocT -= dt;
    if (allocT > 0) return;
    allocT = 1;
    const s = S();
    for (const [fid, a] of Object.entries(s.alloc)) {
      const d = fieldById(s.home, fid);
      if (!d) continue;
      for (const type of ALLOC_TYPES) {
        const want = a[type] ?? 0;
        let cur = allocCount(fid, type);
        // nadmiar: odsyłamy z grup, które jeszcze pracują / lecą na pole
        if (cur > want) {
          for (const e of s.expeditions.filter((x) => x.alloc === fid && x.type === type && !['odlot', 'powrot', 'podejscie', 'rozladunek'].includes(x.phase)).sort((p, q) => p.n - q.n)) {
            if (cur <= want) break;
            const k = Math.min(e.n, cur - want);
            splitReturn(e, k);
            cur -= k;
          }
          continue;
        }
        if (cur >= want || !(s.hangar[type] > 0) || !droneTypeState(type).ok || economy.alert) continue; // alarm: nikogo nie dosyłamy
        let left = Math.min(want - cur, s.hangar[type]);
        if (type === 'zwiadowca') {
          const busy = new Set(s.expeditions.filter((e) => e.type === 'zwiadowca').map((e) => e.target.id));
          const goals = !economy.isDiscovered(s.home, fid) ? [fid]
            : economy.asteroidsIn(s.home).filter((x) => x.fieldId === fid && !surveyed(x.id)).map((x) => x.id);
          const free = goals.filter((g) => !busy.has(g));
          if (!goals.length) { a.zwiadowca = 0; emit(`alloc-done-${fid}`, `${d.name}: wszystkie skały zbadane — zwiadowcy wracają do hangaru.`); continue; }
          for (const g of free) {
            if (left <= 0) break;
            const n = Math.min(left, 2);
            if (dispatch('zwiadowca', n, g, { alloc: fid, silent: true }).ok) left -= n;
          }
        } else {
          if (!canMine(fid)) { allocNote(`alloc-foreign-${fid}`, `${d.name} należy do innej rasy — w czasie pokoju górnicy tam nie pracują.`, 'warning'); continue; }
          const rocks = economy.asteroidsIn(s.home).filter((x) => x.fieldId === fid && surveyed(x.id) && economy.remaining(x) > x.total0 * 0.02);
          if (!rocks.length) {
            allocNote(`alloc-wait-${fid}`, `${d.name}: ${DRONE_TYPES[type].plural} czekają — brak zbadanych skał. Przydziel zwiadowców na to pole.`, 'warning');
            continue;
          }
          // rozkładamy grupy po skałach: najpierw te, przy których pracuje najmniej dronów
          const load = (x) => s.expeditions.filter((e) => e.target.id === x.id).reduce((t, e) => t + e.n, 0);
          const val = (x) => METAL_ORDER.reduce((t, m) => t + x.reserves[m] * METALS[m].price * (recovery(m) > 0 ? 1 : 0.15), 0);
          rocks.sort((p, q) => load(p) - load(q) || val(q) - val(p));
          let i = 0;
          while (left > 0 && i < rocks.length * 2) {
            const n = Math.min(left, DRONE_TYPES[type].group);
            if (dispatch(type, n, rocks[i % rocks.length].id, { alloc: fid, silent: true }).ok) left -= n; else break;
            i++;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------
  // LOGISTYKA UROBKU (krok 12b): huta / magazyn / frachtowiec
  // ------------------------------------------------------------
  const stores = () => (S().home ? economy.stationsIn(S().home).filter((x) => x.status === 'gotowa' && STATIONS[x.type].oreCapacity) : []);
  const oreIn = (st) => sum(st.ore ?? {});
  const oreCap = (st) => STATIONS[st.type].oreCapacity;
  /** Magazyn z wolnym miejscem na urobek - najbliższy siedziby. */
  function pickStore() {
    const base = frame()?.pos;
    let best = null, bd = Infinity;
    for (const st of stores()) {
      if (oreCap(st) - oreIn(st) < 1) continue;
      const d = base ? v3(st.pos).distanceTo(base) : 0;
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }
  function freighterPos() {
    const f = frame();
    if (!f) return null;
    return f.pos.clone().addScaledVector(f.side, -1500).addScaledVector(f.fwd, 700).add(new THREE.Vector3(0, -120, 0));
  }
  const add = (to, from, k = 1) => { for (const m of METAL_ORDER) to[m] = (to[m] ?? 0) + (from[m] ?? 0) * k; };
  /** Rozładunek wyprawy wg trasy. Zwraca opis "gdzie trafiło". */
  function deliver(e) {
    const s = S();
    const cargo = { ...e.cargo };
    if (sum(cargo) <= 1e-6) return 'pusto';
    if (e.aborted || !e.route || e.route === 'huta') { add(s.ore, cargo); return huta() ? 'do huty' : 'do siedziby'; }
    if (e.route === 'frachtowiec') { add(s.freighter.pending, cargo); return 'na frachtowiec'; }
    // magazyn: do wskazanego (albo innego z miejscem); nadmiar do huty
    let left = sum(cargo);
    const tried = new Set();
    let st = (e.dropId && economy.stationById(s.home, e.dropId)) || pickStore();
    while (st && left > 1e-6 && !tried.has(st.id)) {
      tried.add(st.id);
      st.ore ??= zero();
      const k = Math.min(left, oreCap(st) - oreIn(st));
      if (k > 0) { const frac = k / sum(cargo); add(st.ore, cargo, frac); for (const m of METAL_ORDER) cargo[m] *= 1 - frac; left -= k; }
      st = pickStore();
    }
    if (left > 1e-3) {
      add(s.ore, cargo);
      if (!stores().length) offerStore('none');
      return 'do huty (brak miejsca w magazynach)';
    }
    return 'do magazynu';
  }
  /** Urobek w układzie siedziby: kolejka huty + magazyny + frachtowiec. */
  function oreStock() {
    const s = S();
    const out = { huta: sum(s.ore), magazyn: 0, magazynCap: 0, frachtowiec: sum(s.freighter.hold) + sum(s.freighter.pending) };
    for (const st of stores()) { out.magazyn += oreIn(st); out.magazynCap += oreCap(st); }
    return out;
  }
  /** Zdejmuje urobek (najpierw z magazynów, potem z kolejki huty) - giełda. Zwraca skład zdjętego urobku. */
  function takeOre(tons) {
    const s = S();
    const got = zero();
    let left = tons;
    const pools = [...stores().map((st) => (st.ore ??= zero())), s.ore];
    for (const p of pools) {
      const have = sum(p);
      if (left <= 1e-9 || have <= 1e-9) continue;
      const k = Math.min(left, have) / have;
      for (const m of METAL_ORDER) { const t = p[m] * k; p[m] -= t; got[m] += t; }
      left -= Math.min(left, have);
    }
    return got;
  }
  /** Wartość urobku w kredytach (czysty metal po kursie). */
  const oreValue = (o) => METAL_ORDER.reduce((t, m) => t + (o[m] ?? 0) * economy.price(m), 0);

  const autoT = new Map();
  function autoCard(key, d) {
    if (economy.state.time - (autoT.get(key) ?? -1e9) < AUTOMATION.cooldown) return;
    autoT.set(key, economy.state.time);
    onDecision(d);
  }
  /** Karta "postaw magazyn" z gotowym przyciskiem (why: 'none' | 'full'). */
  function offerStore(why, st = null) {
    const canBig = canPay(STATIONS.skladnica.cost), canSmall = canPay(STATIONS.magazyn.cost);
    autoCard(`store-${why}`, {
      id: `store-${why}`, kind: 'logistics', urgency: why === 'full' ? 'warning' : 'info',
      title: why === 'full' ? `${st?.name ?? 'Magazyn'} pełny` : 'Brak magazynu na urobek',
      text: why === 'full'
        ? `Frachtowiec sam odbiera urobek z pełnego magazynu i sprzeda go poza układem. Żeby urobek szedł do huty zamiast na sprzedaż, potrzeba więcej miejsca — postawić większy magazyn?`
        : 'Wyprawy wiozą urobek do magazynu, a w układzie siedziby żadnego nie ma — na razie trafia do huty. Postawić magazyn?',
      choices: [
        { label: `Zbuduj wielki magazyn (${fmt(STATIONS.skladnica.cost.credits)} kr)`, act: 'big', primary: canBig },
        { label: 'Zbuduj magazyn', act: 'small', primary: !canBig && canSmall },
        { label: 'Nie teraz', act: 'no' },
      ],
      timeout: 20, defaultAct: 'no',
      onChoose: (act) => {
        if (act === 'big') hooks.result(buildStation('skladnica'));
        if (act === 'small') hooks.result(buildStation('magazyn'));
      },
    });
  }
  function buyFreighter() {
    const f = S().freighter;
    if (f.n >= FREIGHTER.max) return { ok: false, text: `Siedziba obsłuży najwyżej ${FREIGHTER.max} frachtowce.` };
    if (!canPay(FREIGHTER.cost)) return { ok: false, text: 'Za mało zasobów na frachtowiec.' };
    pay(FREIGHTER.cost);
    f.n++;
    economy.save();
    return { ok: true, text: `Frachtowce: ${f.n} (ładownia ${fmt(FREIGHTER.cap * f.n)} t na kurs).` };
  }
  function setRoute(route, { ask = null } = {}) {
    const s = S();
    if (!ORE_ROUTES[route]) return { ok: false, text: 'Nieznana trasa.' };
    s.route = route;
    if (ask !== null) s.askRoute = ask;
    economy.save();
    return { ok: true, text: `Urobek domyślnie: ${ORE_ROUTES[route].long}.` };
  }
  /** Karta przy wysyłce górników: dokąd urobek? */
  function askRoute(e) {
    const s = S();
    const noStore = !stores().length;
    onDecision({
      id: `route-${e.id}`, kind: 'logistics', urgency: 'info',
      title: `${e.name}: dokąd urobek?`,
      text: `Huta przetopi od razu. Magazyn zbuforuje (huta dobierze sama, pełny opróżni frachtowiec)${noStore ? ' — nie masz jeszcze magazynu' : ''}. Frachtowiec sprzeda surowiec poza układem.`,
      choices: ['huta', 'magazyn', 'frachtowiec'].map((r) => ({ label: ORE_ROUTES[r].name, act: r, primary: r === s.route })),
      manage: ['huta', 'magazyn', 'frachtowiec'].map((r) => ({ label: `Zawsze: ${ORE_ROUTES[r].name.toLowerCase()} (nie pytaj)`, act: `always-${r}` })),
      timeout: 14, defaultAct: s.route,
      onChoose: (act) => {
        const r = act.replace('always-', '');
        if (!ORE_ROUTES[r]) return;
        const x = byId(e.id);
        if (x && !['podejscie', 'rozladunek'].includes(x.phase)) { x.route = r; x.dropId = null; }
        s.route = r;
        if (act.startsWith('always-')) { s.askRoute = false; emit('route-always', `Urobek zawsze: ${ORE_ROUTES[r].long}. Zmienisz to w zakładce Logistyka.`); }
        if (r === 'magazyn' && !stores().length) offerStore('none');
        economy.save();
      },
    });
  }
  function updateLogistics(dt) {
    const s = S();
    const f = s.freighter;
    const cap = FREIGHTER.cap * f.n;
    // huta dobiera z magazynów, gdy ma wolne moce
    if (sum(s.ore) < AUTOMATION.hutaFeed) {
      let want = AUTOMATION.feedRate * dt;
      for (const st of stores()) {
        const have = oreIn(st);
        if (want <= 0 || have <= 1e-6) continue;
        const k = Math.min(want, have) / have;
        for (const m of METAL_ORDER) { const t = st.ore[m] * k; st.ore[m] -= t; s.ore[m] += t; }
        want -= Math.min(want, have);
      }
    }
    // frachtowiec
    if (f.phase === 'dok') {
      let room = cap - sum(f.hold);
      let loaded = 0;
      const rate = FREIGHTER.load * f.n * dt;
      const pend = sum(f.pending);
      if (room > 0 && pend > 1e-6) {
        const k = Math.min(rate, pend, room) / pend;
        for (const m of METAL_ORDER) { const t = f.pending[m] * k; f.pending[m] -= t; f.hold[m] += t; loaded += t; }
        room -= loaded;
      }
      // pełny magazyn: frachtowiec sam go opróżnia
      for (const st of stores()) {
        // histereza: od 95% frachtowiec opróżnia magazyn do połowy
        if (oreIn(st) >= oreCap(st) * AUTOMATION.magazynFull && !st.draining) { st.draining = true; offerStore('full', st); }
        if (st.draining && oreIn(st) <= oreCap(st) * 0.5) st.draining = false;
        if (!st.draining) continue;
        if (room <= 1e-6) continue;
        const have = oreIn(st);
        const k = Math.min(rate, have, room) / have;
        for (const m of METAL_ORDER) { const t = st.ore[m] * k; st.ore[m] -= t; f.hold[m] += t; loaded += t; }
        room = cap - sum(f.hold);
      }
      f.idle = loaded > 1e-6 ? 0 : f.idle + dt;
      const hold = sum(f.hold);
      if (hold >= cap * 0.98 || (hold > 1 && f.idle > FREIGHTER.idleDepart)) {
        f.phase = 'kurs'; f.t = FREIGHTER.trip; f.idle = 0;
        emit('freighter-out', `Frachtowiec odlatuje z ${fmt(hold)} t urobku na sprzedaż (kurs ${FREIGHTER.trip} s).`);
      }
    } else {
      f.t -= dt;
      if (sum(f.pending) > cap * 1.2) {
        const can = f.n < FREIGHTER.max && canPay(FREIGHTER.cost);
        autoCard('freighter-slow', {
          id: 'freighter-slow', kind: 'logistics', urgency: 'warning',
          title: 'Frachtowiec nie nadąża',
          text: `Na nabrzeżu czeka ${fmt(sum(f.pending))} t urobku, a frachtowiec jest w kursie. Dokupić kolejny albo kierować urobek do huty?`,
          choices: [
            { label: `Kup frachtowiec (${fmt(FREIGHTER.cost.credits)} kr)`, act: 'buy', primary: can },
            { label: 'Urobek do huty', act: 'huta', primary: !can },
            { label: 'Nie', act: 'no' },
          ],
          timeout: 20, defaultAct: 'no',
          onChoose: (act) => { if (act === 'buy') hooks.result(buyFreighter()); if (act === 'huta') hooks.result(setRoute('huta')); },
        });
      }
      if (f.t <= 0) {
        const kr = oreValue(f.hold) * FREIGHTER.price;
        const tons = sum(f.hold);
        economy.state.credits += kr;
        economy.state.stats.earned += kr;
        f.earned += kr; f.trips++;
        s.stats12b.freighted += tons;
        f.hold = zero(); f.phase = 'dok'; f.t = 0;
        emit('freighter-in', `Frachtowiec wrócił: sprzedał ${fmt(tons)} t urobku za ${fmt(kr)} kr.`);
        economy.save();
      }
    }
    // huta nie nadąża
    if (sum(s.ore) > AUTOMATION.hutaBacklog) {
      const up = upgradeState('huta-piece');
      autoCard('huta-backlog', {
        id: 'huta-backlog', kind: 'logistics', urgency: 'warning',
        title: 'Huta nie nadąża',
        text: `W kolejce do pieca czeka ${fmt(sum(s.ore))} t urobku. Przyspieszyć hutę albo kierować nadmiar gdzie indziej?`,
        choices: [
          { label: 'Ulepsz piece', act: 'up', primary: up.ok },
          { label: stores().length ? 'Nowy urobek do magazynu' : 'Postaw magazyn', act: 'store' },
          { label: 'Nowy urobek na frachtowiec', act: 'ship' },
        ],
        timeout: 20, defaultAct: 'none',
        onChoose: (act) => {
          if (act === 'up') hooks.result(upgrade('huta-piece'));
          if (act === 'store') { if (stores().length) hooks.result(setRoute('magazyn')); else offerStore('none'); }
          if (act === 'ship') hooks.result(setRoute('frachtowiec'));
        },
      });
    }
  }

  /** Budowa stacji z mostka: plac budowy w wolnym miejscu przy siedzibie. */
  function buildStation(type) {
    if (!inHome()) return { ok: false, text: 'Budowa z mostka tylko w układzie siedziby.' };
    const base = hq();
    const st = economy.placeNear(type, v3(base.pos), { from: 1300, to: 5200 });
    return st ? { ok: true, text: `Plac budowy: ${st.name}. Holowniki dowiozą metal ze składu.` } : { ok: false, text: 'Nie udało się założyć placu budowy.' };
  }

  // ------------------------------------------------------------
  // PĘTLA
  // ------------------------------------------------------------
  // phase(e, phase), result(res), lost(e, pos), fleet(fieldId), guardFire(e, pos). result zawsze jest
  // funkcją: hooks.result(dispatch(...)) bez haka nie wykonałby samego rozkazu (argumenty ?.() się nie liczą)
  const hooks = { result: () => {} };
  economy.hooks.efficiency = efficiency;

  function update(dt) {
    const s = S();
    if (!s.home) return;
    updateHangar(dt);
    if (s.research) {
      s.research.t -= dt * hqEff();
      if (s.research.t <= 0) finishResearch();
    }
    for (const e of s.expeditions.slice()) updateExpedition(e, dt);
    updateAlloc(dt);
    updateSentries(dt);
    updateLogistics(dt);
    updateSmelter(dt);
  }

  return {
    get state() { return S(); }, hooks,
    found, hq, huta, inHome, frame, hangarPos, bridgePos, launchPos, local,
    // hangar i wyprawy
    buildDrones, droneTypeState, hangarCap, fleetCount, dispatch, recall, redirect, keepWorking, sendGuards, alarmAll,
    targets, targetInfo, pose, phaseDur, bestRock, surveyed, holdOf, speedOf,
    expeditions: () => S().expeditions, expedition: byId,
    // huta, energia
    recovery, power, efficiency, autonomyState, setAutonomy, get smeltRate() { return lastSmelt; },
    // rozwój
    lvl, mult, has, upgradeCost, upgradeState, upgrade, techState, research,
    buildStation,
    // krok 12b: wieże, sektory, logistyka
    deploySentry, moveSentry, recallSentry, sentryPose, sentryRange, coverAt, contacts, sentryAltitude,
    sentries: () => S().sentries,
    setAlloc, setAllocRoute, fieldSummary, allocCount,
    setRoute, buyFreighter, oreStock, takeOre, oreValue, stores, oreIn, oreCap, freighterPos, pickStore,
    update,
  };
}

export { DRONE_TYPES, DRONE_TYPE_ORDER, UPGRADES, TECHS, TECH_ORDER };
