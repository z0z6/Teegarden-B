import * as THREE from 'three';
import { METALS, METAL_ORDER, STATIONS } from '../data/economy.js';
import {
  HQ, DRONE_TYPES, DRONE_TYPE_ORDER, EXPEDITION, POWER, SMELTER, UPGRADES, UPGRADE_TECH, TECHS, TECH_ORDER,
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
  };
}

export function createCommand({
  economy, onEvent = () => {}, onDecision = () => {}, getHostiles = () => [], combat = null,
  hqName = 'Siedziba', random = Math.random,
}) {
  const S = () => (economy.state.command ??= freshCommand());
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
    if (!st || S().autonomy[st.id] || st.type === 'siedziba' || st.type === 'reaktor' || st.type === 'magazyn') return 1;
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
    return sum(s.hangar) + s.queue.length + s.expeditions.reduce((a, e) => a + e.n, 0);
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

  function dispatch(type, n, targetId, { auto = false, silent = false } = {}) {
    const s = S();
    const d = DRONE_TYPES[type];
    if (!hq()) return { ok: false, text: 'Brak siedziby.' };
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
      id: `x${s.nextId++}`, type, n, n0: n, target, phase: 'wylot', t: 0, cargo: zero(), repeat: auto || !!s.auto.returns,
      name: `${d.name} ${s.nextId - 1}`,
    };
    s.expeditions.push(e);
    s.stats.expeditions++;
    economy.save();
    if (!silent) emit(`exp-${e.id}`, `${e.name}: ${n} × ${d.name.toLowerCase()} startuje — cel: ${targetInfo(e).name}.`);
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
    if (has('automatyka')) e.repeat = true;
    if (e.repeat) { setPhase(e, 'odlot'); emit(`full-${e.id}`, `${e.name}: ładownie pełne (${fmt(cargo)} t) — wracają do huty.`); return; }
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
    const h = huta();
    if (h && DRONE_TYPES[e.type].hold > 0 && !e.aborted) return { pos: v3(h.pos), radius: STATIONS.huta.radius };
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
          for (const m of METAL_ORDER) s.ore[m] += e.cargo[m];
          s.hangar[e.type] += e.n;
          s.expeditions.splice(s.expeditions.indexOf(e), 1);
          runtime.delete(e.id);
          if (cargo > 0.5) emit(`home-${e.id}`, `${e.name}: ${fmt(cargo)} t urobku w ${huta() ? 'hucie' : 'siedzibie'}.`);
          hooks.phase?.(e, 'koniec');
          // pętla: następny kurs na to samo złoże (albo na wskazaną skałę)
          const next = e.next ?? (e.target.kind === 'ast' ? e.target.id : null);
          const a = next && astById(s.home, next);
          if ((e.repeat || e.next) && a && economy.remaining(a) > a.total0 * 0.02 && d.hold > 0) {
            dispatch(e.type, e.n, a.id, { auto: e.repeat, silent: true });
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
    const shield = mult('drony-pancerz') * (1 + guards * 0.5);
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
    updateSmelter(dt);
  }

  return {
    get state() { return S(); }, hooks,
    found, hq, huta, inHome, frame, hangarPos, bridgePos, local,
    // hangar i wyprawy
    buildDrones, droneTypeState, hangarCap, fleetCount, dispatch, recall, redirect, keepWorking, sendGuards, alarmAll,
    targets, targetInfo, pose, phaseDur, bestRock, surveyed, holdOf, speedOf,
    expeditions: () => S().expeditions, expedition: byId,
    // huta, energia
    recovery, power, efficiency, autonomyState, setAutonomy, get smeltRate() { return lastSmelt; },
    // rozwój
    lvl, mult, has, upgradeCost, upgradeState, upgrade, techState, research,
    /** Budowa stacji z mostka: plac budowy w wolnym miejscu przy siedzibie. */
    buildStation(type) {
      if (!inHome()) return { ok: false, text: 'Budowa z mostka tylko w układzie siedziby.' };
      const base = hq();
      const st = economy.placeNear(type, v3(base.pos), { from: 1300, to: 5200 });
      return st ? { ok: true, text: `Plac budowy: ${st.name}. Holowniki dowiozą metal ze składu.` } : { ok: false, text: 'Nie udało się założyć placu budowy.' };
    },
    update,
  };
}

export { DRONE_TYPES, DRONE_TYPE_ORDER, UPGRADES, TECHS, TECH_ORDER };
