import { METALS, METAL_ORDER, STATIONS, WARSHIPS, WARSHIP_ORDER } from '../data/economy.js';
import { DRONE_TYPES, DRONE_TYPE_ORDER, UPGRADES, UPGRADE_ORDER, TECHS, TECH_ORDER, POWER, EXPEDITION, ORE_ROUTES, ORE_ROUTE_ORDER, FREIGHTER } from '../data/command.js';
import { GOODS, GOOD_NAME } from './exchange.js';
import { RACES } from '../data/races.js';
import { PHASE_LABEL } from './command.js';
import { PLAYER } from './strategy.js';
import {
  metalIcon, creditsIcon, stationIcon, droneTypeIcon, powerIcon, oreIcon, scienceIcon, upgradeIcon, pilotIcon,
  eyeIcon, fieldIcon, scanIcon, warshipIcon, saveIcon, routeIcon,
} from '../ui/icons.js';

/**
 * PANEL GRACZA (krok 12): wszystko, czym dowodzi się z mostka, myszą.
 *
 *   góra     - siedziba, kredyty, metal w składzie, urobek w hucie, prąd, badanie
 *   lewo     - ROZKAZY: wyślij zwiadowców / górników / holowniki / strażników
 *              (klik = wybór celu i liczby dronów), alarm, automatyczne powroty
 *   dół      - WYPRAWY w toku (faza, postęp, ładownia, Odwołaj / Zarządzaj)
 *   prawo    - Hangar, Moduły (stacje, zasilanie), Ulepszenia, Nauka, Flota
 *   akcje    - Za sterami (lot myśliwcem), Mapa sektora, Przemysł i rynek
 *   flota    - garnizon i okręty: stały blok pod rozkazami (siła, kadłuby,
 *              Broń bazy / Obserwuj / Buduj okręty) i zakładka Flota ze
 *              stocznią (budowa klas okrętów prosto z mostka) i rozkazami
 *
 * TRYB KOMPAKTOWY (telefon, body.ui-compact): zamiast czterech paneli naraz
 * jest dolny pasek nawigacji (cp-mnav), a otwarty jest najwyżej jeden arkusz
 * (Rozkazy / Wyprawy / Baza / Flota) po prawej stronie ekranu. Ponowne
 * dotknięcie przycisku chowa arkusz i odsłania widok z mostka.
 *
 * DOM przebudowywany tylko przy zmianie struktury (klucze), paski postępu
 * odświeżane osobno - kliknięcia nie giną w trakcie przebudowy.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('pl-PL');
const sum = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);

function costHtml(cost, can = true) {
  const parts = [];
  if (cost.credits) parts.push(`<span>${creditsIcon(13)}${fmt(cost.credits)}</span>`);
  for (const m of METAL_ORDER) if (cost[m]) parts.push(`<span title="${METALS[m].name}">${metalIcon(m, 13)}${fmt(cost[m])}</span>`);
  return `<span class="cp-cost${can ? '' : ' short'}">${parts.join('')}</span>`;
}
const TABS = [['hangar', 'Hangar'], ['moduly', 'Moduły'], ['logistyka', 'Logistyka'], ['gielda', 'Giełda'], ['ulepszenia', 'Ulepszenia'], ['nauka', 'Nauka'], ['flota', 'Flota']];
const BUILDABLE = ['huta', 'reaktor', 'magazyn', 'skladnica', 'dok', 'wieza', 'stocznia', 'przeladunek'];
const goodIcon = (g, size = 16) => (g === 'kredyty' ? creditsIcon(size) : g === 'urobek' ? oreIcon(size) : metalIcon(g, size));

export function createCommandPanel(root, {
  command, economy, strategy = null, army = null, raids = null, playerRace, systemName = (s) => s,
  onPilot = () => {}, onMap = () => {}, onIndustry = () => {}, onFleet = () => {}, onWatch = () => {}, onHover = () => {},
  onSaves = () => {}, compact = () => false, exchange = null, onTactical = () => {},
  // krok 12c: dodatkowe zakładki (np. Operacje floty z fleet-ops-panel.js):
  // { id, label, badge(), render() -> [key, html()], refresh(root), onAction(act, btn), onChange(e) }
  // akcje zakładki mają prefiks "op-"
  extraTabs = [],
}) {
  const ALL_TABS = [...TABS, ...extraTabs.map((t) => [t.id, t.label])];
  const extraTab = (id) => extraTabs.find((t) => t.id === id) ?? null;
  root.innerHTML = `
    <header class="cp-top" data-r="top"></header>
    <aside class="cp-orders glass"><div class="cp-orders-list" data-r="orders"></div><section class="cp-fleet" data-r="fleetbox"></section></aside>
    <section class="cp-exps" data-r="exps"></section>
    <aside class="cp-side glass"><nav class="cp-tabs" data-r="tabs"></nav><div class="cp-tab" data-r="tab"></div></aside>
    <nav class="cp-actions" data-r="actions"></nav>
    <div class="cp-picker glass" data-r="picker" hidden></div>
    <nav class="cp-mnav" data-r="mnav" aria-label="Panele mostka"></nav>
    <div class="cp-toast" data-r="toast" aria-live="polite"></div>`;
  const R = Object.fromEntries([...root.querySelectorAll('[data-r]')].map((el) => [el.dataset.r, el]));
  let tab = 'hangar';
  let picker = null; // { type, target, n }
  let sheet = null;  // tryb kompaktowy: 'orders' | 'exps' | 'side' | null (widok z mostka)
  const ex = { from: 'zelazo', to: 'kredyty', amt: 50 }; // giełda: wybrana para i ilość
  const keys = {};
  let toastT = 0;

  function toast(text, bad = false) {
    if (!text) return;
    R.toast.textContent = text;
    R.toast.classList.toggle('bad', bad);
    R.toast.classList.add('on');
    toastT = 3.2;
  }
  const result = (r) => { if (r) toast(r.text, !r.ok); return r; };
  const s = () => command.state;
  const set = (name, key, html) => { if (keys[name] !== key) { keys[name] = key; R[name].innerHTML = html(); return true; } return false; };

  // ------------------------------------------------------------
  // GÓRA: zasoby
  // ------------------------------------------------------------
  function renderTop() {
    const pool = economy.poolTotals();
    const pw = command.power(s().home);
    const ore = sum(s().ore);
    const race = RACES[playerRace()];
    const rs = s().research;
    const share = strategy ? Math.round(strategy.share(PLAYER) * 100) : 0;
    const war = strategy && Object.keys(strategy.state.factions).some((f) => strategy.atWar(PLAYER, f));
    const powPct = Math.min(100, pw.demand > 0 ? (pw.supply / pw.demand) * 50 : 100);
    const fleetN = army ? army.ships.length : 0;
    const key = [fmt(economy.state.credits), ...METAL_ORDER.map((m) => Math.round(pool[m])), Math.round(ore), Math.round(pw.supply), Math.round(pw.demand), rs?.id, share, war, economy.systemId, fleetN].join('|');
    set('top', key, () => `
      <div class="cp-hq">${stationIcon('siedziba', 30, race.color)}<div><b>${esc(command.hq()?.name ?? 'Siedziba')}</b><small>${esc(race.name)} · ${esc(systemName(s().home))}${economy.systemId !== s().home ? ` · <em>jesteś w: ${esc(systemName(economy.systemId))}</em>` : ''}</small></div></div>
      <div class="cp-res" title="Kredyty">${creditsIcon(18)}<b>${fmt(economy.state.credits)}</b></div>
      ${METAL_ORDER.map((m) => `<div class="cp-res" title="${METALS[m].name} w składzie i magazynach">${metalIcon(m, 18)}<b>${fmt(pool[m])}</b></div>`).join('')}
      <div class="cp-res" title="Urobek czekający na przetop w hucie">${oreIcon(18)}<b>${fmt(ore)}</b><small>urobek</small></div>
      <div class="cp-res cp-power${pw.ratio < 1 ? ' low' : ''}" title="Zasilanie: podaż / pobór">${powerIcon(18)}<span class="cp-pbar"><i style="width:${powPct}%"></i></span><small>${fmt(pw.supply)} / ${fmt(pw.demand)} MW</small></div>
      <div class="cp-res cp-sci" title="Badanie w toku">${scienceIcon(18)}${rs ? `<span><b>${esc(TECHS[rs.id].name)}</b><span class="cp-pbar"><i data-live="sci"></i></span></span>` : '<small>laboratoria wolne</small>'}</div>
      ${army ? `<button class="cp-res cp-fleetres" data-act="fleet-tab" title="Flota: okręty i stocznia">${warshipIcon('fregata', 18, '#ff7a45')}<b>${fleetN}</b><small>okr.</small></button>` : ''}
      <div class="cp-res cp-dom" title="Udział w wartości pól sektora">${fieldIcon(18, '#ffd36b')}<b>${share}%</b><small>sektora${war ? ' · <span class="war">WOJNA</span>' : ''}</small></div>
      <button class="cp-savebtn" data-act="saves" title="Menu gry: zapisz, wczytaj, porzuć (Esc; Ctrl+S — szybki zapis)">${saveIcon(18)}<span>Menu <kbd>Esc</kbd></span></button>`);
    const bar = R.top.querySelector('[data-live="sci"]');
    if (bar && rs) bar.style.width = `${(1 - rs.t / TECHS[rs.id].time) * 100}%`;
  }

  // ------------------------------------------------------------
  // LEWO: rozkazy
  // ------------------------------------------------------------
  function renderOrders() {
    const h = s().hangar;
    const nSent = command.sentries().length;
    const key = DRONE_TYPE_ORDER.map((t) => `${h[t]}:${command.droneTypeState(t).ok}`).join('|') + `|${s().auto.returns}|${command.has('automatyka')}|${economy.alert}|${picker?.type}|${nSent}`;
    set('orders', key, () => `
      <h3>Rozkazy</h3>
      <button class="cp-tactical" data-act="tactical" title="Wieże strażnicze i przydział dronów do pól">${fieldIcon(26, '#ff5a8a')}<span><b>Mapa taktyczna</b><small>wieże · sektory · ile dronów w polu</small></span></button>
      ${DRONE_TYPE_ORDER.map((t) => {
        const d = DRONE_TYPES[t], st = command.droneTypeState(t);
        if (d.sentry) return `<button class="cp-order" data-act="tac-place" ${h[t] ? '' : 'disabled'} style="--c:${d.color}">
          ${droneTypeIcon(t, 30, d.color)}<span><b>Rozstaw wieże</b><small>w hangarze: ${h[t]} · na pozycjach: ${nSent}</small></span></button>`;
        const verb = { zwiadowca: 'Wyślij zwiadowców', gornik: 'Wyślij górników', holownik: 'Wyślij holowniki', straznik: 'Postaw straż' }[t];
        return `<button class="cp-order${picker?.type === t ? ' on' : ''}" data-act="pick" data-type="${t}" ${st.ok && h[t] ? '' : 'disabled'} style="--c:${d.color}">
          ${droneTypeIcon(t, 30, d.color)}<span><b>${verb}</b><small>${st.ok ? `w hangarze: ${h[t]}` : esc(st.why)}</small></span></button>`;
      }).join('')}
      <label class="cp-toggle"><input type="checkbox" data-act="auto" ${s().auto.returns || command.has('automatyka') ? 'checked' : ''} ${command.has('automatyka') ? 'disabled' : ''}/><span>Wyprawy wracają same i ruszają na kolejny kurs</span></label>
      <button class="cp-alarm${economy.alert ? ' on' : ''}" data-act="alarm">${economy.alert ? 'Odwołaj alarm' : 'Zaalarmuj wszystkich'}</button>`);
  }

  // ------------------------------------------------------------
  // LEWO, POD ROZKAZAMI: flota (zawsze na widoku)
  // ------------------------------------------------------------
  const homeShips = () => (army ? army.ships.filter((x) => x.sysId === s().home) : []);
  function renderFleetBox() {
    if (!army) { set('fleetbox', 'none', () => ''); return; }
    const ships = army.ships, home = homeShips();
    const race = RACES[playerRace()];
    const defending = home.filter((x) => x.order === 'obrona').length;
    const key = `${ships.map((x) => `${x.id}:${x.order}:${x.sysId}:${Math.round((x.hull / WARSHIPS[x.cls].hull) * 10)}`).join()}|${army.queue.length}|${Math.round(army.power() * 10)}|${economy.systemId}`;
    set('fleetbox', key, () => `
      <h3>${warshipIcon('fregata', 22, '#ff7a45')} Flota <span class="cp-fleet-n">${ships.length}</span></h3>
      <p class="cp-fleet-sum">${ships.length ? `siła <b>${army.power().toFixed(1)}</b> · przy bazie <b>${home.length}</b>${defending ? ` · broni pola <b>${defending}</b>` : ''}${army.queue.length ? ` · w budowie <b>${army.queue.length}</b>` : ''}` : 'Brak okrętów — baza bez osłony.'}</p>
      ${ships.length ? `<div class="cp-fleet-ships">${ships.slice(0, 12).map((x) => `<span title="${esc(`„${x.callsign}” · ${WARSHIPS[x.cls].name} · kadłub ${Math.round((x.hull / WARSHIPS[x.cls].hull) * 100)}%`)}">${warshipIcon(x.cls, 16, race.color)}<i style="--h:${Math.round((x.hull / WARSHIPS[x.cls].hull) * 100)}%"></i></span>`).join('')}${ships.length > 12 ? `<small>+${ships.length - 12}</small>` : ''}</div>` : ''}
      <div class="cp-fleet-b">
        <button data-act="fleet-defend" ${home.length ? '' : 'disabled'} title="Wszystkie okręty w układzie bronią pola macierzystego">Broń bazy</button>
        <button data-act="watch-fleet" ${ships.some((x) => x.sysId === economy.systemId) ? '' : 'disabled'} title="Podgląd floty z bliska">${eyeIcon(14)}</button>
        <button class="primary" data-act="fleet-tab">Buduj okręty</button>
      </div>`);
  }

  // ------------------------------------------------------------
  // DÓŁ: wyprawy
  // ------------------------------------------------------------
  const phaseProgress = (e) => {
    const d = DRONE_TYPES[e.type];
    if (e.phase === 'praca' && d.hold > 0) return sum(e.cargo) / Math.max(1, command.holdOf(e));
    if (e.phase === 'pelne' || e.phase === 'straz') return 1;
    const dur = command.phaseDur(e);
    return Number.isFinite(dur) ? Math.min(1, e.t / dur) : 0;
  };
  function renderExps() {
    const list = command.expeditions();
    const key = list.map((e) => `${e.id}:${e.phase}:${e.n}:${e.hold ? 1 : 0}:${e.repeat ? 1 : 0}`).join('|') + `|${s().hangar.straznik}`;
    set('exps', key, () => (list.length ? list.map((e) => {
      const d = DRONE_TYPES[e.type];
      const info = command.targetInfo(e);
      const back = ['odlot', 'powrot', 'podejscie', 'rozladunek'].includes(e.phase);
      return `<article class="cp-exp ph-${e.phase}" style="--c:${d.color}" data-exp="${e.id}">
        <div class="cp-exp-h">${droneTypeIcon(e.type, 22, d.color)}<b>${esc(e.name)}</b><small>${e.n} × ${esc(d.name.toLowerCase())}</small>${e.repeat ? '<span class="cp-loop" title="pętla: wraca na złoże">⟳</span>' : ''}</div>
        <div class="cp-exp-t">${back ? '← ' : '→ '}${esc(info.name)}</div>
        <div class="cp-exp-p"><span>${esc(PHASE_LABEL[e.phase] ?? e.phase)}${e.hold ? ' (czeka)' : ''}</span><small data-live="cargo-${e.id}"></small></div>
        <span class="cp-bar"><i data-live="bar-${e.id}"></i></span>
        <div class="cp-exp-b">
          ${back ? '' : `<button data-act="recall" data-exp="${e.id}">Odwołaj</button>`}
          ${e.phase === 'pelne' ? `<button class="primary" data-act="return" data-exp="${e.id}">Wracaj</button>` : ''}
          <button data-act="watch" data-exp="${e.id}" title="Obserwuj">${eyeIcon(14)}</button>
          <button data-act="manage" data-exp="${e.id}">Zarządzaj ▾</button>
        </div>
        <div class="cp-exp-m" hidden>
          <button data-act="redirect" data-exp="${e.id}" ${command.bestRock() && d.hold > 0 ? '' : 'disabled'}>Poślij na inną skałę</button>
          <button data-act="guard" data-exp="${e.id}" ${s().hangar.straznik ? '' : 'disabled'}>Przywołaj ochronę</button>
          <button data-act="fleet" data-exp="${e.id}">Poślij flotę</button>
          <button data-act="alarm">Zaalarmuj pozostałych</button>
        </div>
      </article>`;
    }).join('') : '<p class="cp-empty">Brak wypraw. Wyślij drony z hangaru — Rozkazy.</p>'));
    for (const e of list) {
      const bar = R.exps.querySelector(`[data-live="bar-${e.id}"]`);
      if (bar) bar.style.width = `${phaseProgress(e) * 100}%`;
      const c = R.exps.querySelector(`[data-live="cargo-${e.id}"]`);
      if (c) { const t = DRONE_TYPES[e.type].hold > 0 ? `${fmt(sum(e.cargo))} / ${fmt(command.holdOf(e))} t` : ''; if (c.textContent !== t) c.textContent = t; }
    }
  }

  // ------------------------------------------------------------
  // PRAWO: zakładki
  // ------------------------------------------------------------
  function renderTabs() {
    const n = army ? army.ships.length : 0;
    const badges = extraTabs.map((t) => t.badge?.() ?? '').join(',');
    set('tabs', `${tab}|${n}|${badges}`, () => ALL_TABS.map(([id, label]) => {
      const x = extraTab(id), badge = x?.badge?.();
      return `<button data-act="tab" data-tab="${id}" class="${tab === id ? 'on' : ''}${id === 'flota' || x ? ' cp-tab-fleet' : ''}">${label}${id === 'flota' && army ? ` <em>${n}</em>` : badge ? ` <em>${badge}</em>` : ''}</button>`;
    }).join(''));
  }
  const can = (cost) => economy.canPayIn(s().home, cost);

  function tabHangar() {
    const h = s().hangar, q = s().queue;
    const counts = {};
    for (const t of q) counts[t] = (counts[t] ?? 0) + 1;
    const key = `h|${DRONE_TYPE_ORDER.map((t) => `${h[t]}:${command.droneTypeState(t).ok}:${can(DRONE_TYPES[t].cost)}:${counts[t] ?? 0}`).join()}|${command.fleetCount()}|${command.hangarCap()}|${q[0]}`;
    return [key, () => `
      <p class="cp-note">Hangar siedziby buduje drony z metalu w składzie. Miejsca: <b>${command.fleetCount()} / ${command.hangarCap()}</b>.</p>
      ${q.length ? `<div class="cp-queue">${droneTypeIcon(q[0], 18, DRONE_TYPES[q[0]].color)}<span>W produkcji: ${esc(DRONE_TYPES[q[0]].name)}${q.length > 1 ? ` (+${q.length - 1})` : ''}</span><span class="cp-bar"><i data-live="queue"></i></span></div>` : ''}
      ${DRONE_TYPE_ORDER.map((t) => {
        const d = DRONE_TYPES[t], st = command.droneTypeState(t);
        return `<div class="cp-card${st.ok ? '' : ' locked'}" style="--c:${d.color}">
          <div class="cp-card-h">${droneTypeIcon(t, 34, d.color)}<div><b>${esc(d.name)}</b><small>${esc(d.role)}</small></div><span class="cp-count">${h[t]}</span></div>
          <div class="cp-stats"><span>prędkość <b>${fmt(command.speedOf(t))}</b></span>${d.hold ? `<span>ładownia <b>${fmt(d.hold * command.mult('drony-ladownie'))} t</b></span>` : ''}<span>budowa <b>${d.buildTime} s</b></span>${counts[t] ? `<span>w kolejce <b>${counts[t]}</b></span>` : ''}</div>
          ${st.ok ? `<div class="cp-card-b">${costHtml(d.cost, can(d.cost))}<button data-act="build" data-type="${t}" data-n="1">+1</button><button data-act="build" data-type="${t}" data-n="5">+5</button></div>` : `<p class="cp-lock">${esc(st.why)}</p>`}
        </div>`;
      }).join('')}`];
  }

  function tabModules() {
    const home = s().home;
    const list = economy.stationsIn(home);
    const pw = command.power(home);
    const here = economy.systemId === home;
    const key = `m|${list.map((x) => `${x.id}:${x.status}:${Math.round(x.progress * 20)}:${s().autonomy[x.id] ? 1 : 0}:${command.autonomyState(x).ok}`).join()}|${Math.round(pw.supply)}|${Math.round(pw.demand)}|${BUILDABLE.map((t) => can(STATIONS[t].cost)).join()}|${here}`;
    return [key, () => `
      <div class="cp-powerbox${pw.ratio < 1 ? ' low' : ''}">${powerIcon(22)}<div><b>Sieć: ${fmt(pw.supply)} MW / pobór ${fmt(pw.demand)} MW</b>
        <small>${pw.ratio >= 1 ? 'Wszystkie stacje pracują pełną mocą.' : `Niedobór prądu: stacje pracują na ${Math.round(Math.max(POWER.minEfficiency, pw.ratio) * 100)}%. Postaw reaktor albo daj stacjom własne ogniwa.`}${pw.autonomous ? ` Na własnym zasilaniu: ${pw.autonomous}.` : ''}</small></div></div>
      <h4>Stacje układu</h4>
      ${list.map((x) => {
        const d = STATIONS[x.type];
        const au = command.autonomyState(x);
        const eff = Math.round(command.efficiency(home, x) * 100);
        const pwTxt = (POWER.supply[x.type] ? `+${POWER.supply[x.type]} MW` : '') + (POWER.demand[x.type] ? `−${POWER.demand[x.type]} MW` : '');
        return `<div class="cp-st">${stationIcon(x.type, 24, d.accent)}<div><b>${esc(x.name)}</b><small>${x.status === 'gotowa' ? (s().autonomy[x.id] ? 'własne ogniwa' : `${pwTxt || 'bez poboru'}${POWER.demand[x.type] ? ` · praca ${eff}%` : ''}`) : `budowa ${Math.round(x.progress * 100)}%${sum(x.need) > 0.5 ? ` · czeka na ${fmt(sum(x.need))} t metalu` : ''}`}</small></div>
          ${x.status === 'gotowa' && POWER.demand[x.type] > 0 && !s().autonomy[x.id] ? `<button data-act="autonomy" data-st="${x.id}" ${au.ok ? '' : 'disabled'} title="${esc(au.ok ? 'Własne ogniwa zasilania' : au.why)}">${powerIcon(13)} ogniwa</button>` : ''}</div>`;
      }).join('')}
      <h4>Buduj przy siedzibie</h4>
      ${here ? '' : '<p class="cp-note">Jesteś w innym układzie — budowa z mostka działa w układzie siedziby. Tu buduj w panelu Przemysł.</p>'}
      <div class="cp-build">${BUILDABLE.map((t) => {
        const d = STATIONS[t];
        return `<button class="cp-bcard" data-act="station" data-type="${t}" ${here && can(d.cost) ? '' : 'disabled'} title="${esc(d.role)}">${stationIcon(t, 26, d.accent)}<b>${esc(d.name)}</b>${costHtml(d.cost, can(d.cost))}</button>`;
      }).join('')}</div>
      ${command.has('ogniwa') ? `<p class="cp-note">Ogniwa: ${costHtml(POWER.autonomyCost)} za stację.</p>` : ''}`];
  }

  function tabLogistics() {
    const o = command.oreStock(), f = s().freighter;
    const stores = command.stores();
    const route = s().route;
    const allocs = Object.entries(s().alloc).filter(([, a]) => a.gornik || a.zwiadowca || a.holownik);
    const key = `l|${route}|${s().askRoute}|${Math.round(o.huta)}|${stores.map((x) => `${x.id}:${Math.round(command.oreIn(x) / 10)}`).join()}|${f.n}|${f.phase}|${Math.round(sum(f.hold) / 5)}|${Math.round(sum(f.pending) / 5)}|${Math.round(f.earned)}|${can(STATIONS.skladnica.cost)}|${can(STATIONS.magazyn.cost)}|${can(FREIGHTER.cost)}|${allocs.map(([k, a]) => `${k}${a.gornik}${a.zwiadowca}${a.holownik}${a.route}`).join()}|${Math.round(command.smeltRate * 10)}`;
    return [key, () => `
      <p class="cp-note">Dokąd drony wiozą urobek. Wybór pada przy wysyłce górników (karta), a potem logistyka działa sama: huta dobiera z magazynów, pełne magazyny opróżnia frachtowiec.</p>
      <h4>Urobek domyślnie</h4>
      <div class="cp-routes">${ORE_ROUTE_ORDER.map((r) => `<button data-act="route" data-r="${r}" class="${route === r ? 'on' : ''}"><b>${ORE_ROUTES[r].name}</b><small>${esc(ORE_ROUTES[r].desc)}</small></button>`).join('')}</div>
      <label class="cp-toggle"><input type="checkbox" data-act="ask-route" ${s().askRoute ? 'checked' : ''}/><span>Pytaj o trasę przy każdej wysyłce górników</span></label>
      <h4>Huta</h4>
      <div class="cp-st">${stationIcon('huta', 24, STATIONS.huta.accent)}<div><b>Kolejka do pieca: ${fmt(o.huta)} t</b><small>przetop ~${(command.smeltRate || 0).toFixed(1)} t/s${o.huta > 600 ? ' · kolejka rośnie — ulepsz piece albo kieruj nadmiar do magazynu' : ''}</small></div></div>
      <h4>Magazyny urobku</h4>
      ${stores.length ? stores.map((x) => `<div class="cp-st">${stationIcon(x.type, 24, STATIONS[x.type].accent)}<div><b>${esc(x.name)}</b><small>${fmt(command.oreIn(x))} / ${fmt(command.oreCap(x))} t${x.draining ? ' · frachtowiec opróżnia' : ''}</small><span class="cp-hullbar"><i style="width:${Math.round((command.oreIn(x) / command.oreCap(x)) * 100)}%;background:#ffb45c"></i></span></div></div>`).join('')
        : '<p class="cp-note">Brak magazynów — trasa „Magazyn” wysyła wtedy urobek do huty.</p>'}
      <div class="cp-row"><button data-act="station" data-type="magazyn" ${can(STATIONS.magazyn.cost) ? '' : 'disabled'}>${stationIcon('magazyn', 16, STATIONS.magazyn.accent)} Magazyn (${STATIONS.magazyn.oreCapacity} t)</button><button data-act="station" data-type="skladnica" ${can(STATIONS.skladnica.cost) ? '' : 'disabled'}>${stationIcon('skladnica', 16, STATIONS.skladnica.accent)} Wielki magazyn (${STATIONS.skladnica.oreCapacity} t)</button></div>
      <h4>Frachtowiec</h4>
      <div class="cp-st">${warshipIcon('eskorta', 24, '#4dd6a0')}<div><b>${f.n} × frachtowiec · ${f.phase === 'dok' ? 'przy siedzibie' : `w kursie (${Math.ceil(f.t)} s)`}</b><small>ładownia ${fmt(sum(f.hold))} / ${fmt(FREIGHTER.cap * f.n)} t · na nabrzeżu ${fmt(sum(f.pending))} t · sprzedał za ${fmt(f.earned)} kr</small></div>
        <button data-act="buy-freighter" ${f.n < FREIGHTER.max && can(FREIGHTER.cost) ? '' : 'disabled'} title="${fmt(FREIGHTER.cost.credits)} kr">+1</button></div>
      <h4>Przydziały do pól</h4>
      ${allocs.length ? allocs.map(([fid, a]) => `<div class="cp-st">${fieldIcon(20, '#ffd36b')}<div><b>${esc(economy.fieldDefs(s().home).find((d) => d.id === fid)?.name ?? fid)}</b><small>${['gornik', 'zwiadowca', 'holownik'].filter((t) => a[t]).map((t) => `${DRONE_TYPES[t].plural} ${command.allocCount(fid, t)}/${a[t]}`).join(' · ')} · urobek → ${ORE_ROUTES[a.route ?? route].name.toLowerCase()}</small></div></div>`).join('')
        : '<p class="cp-note">Brak stałych przydziałów. Ustaw je na mapie taktycznej (Sektory).</p>'}
      <div class="cp-row"><button class="primary" data-act="tactical-sectors">Mapa taktyczna — sektory</button></div>`];
  }

  function tabExchange() {
    if (!exchange) return ['x', () => '<p class="cp-note">Giełda niedostępna.</p>'];
    const q = exchange.quote(ex.from, ex.to, ex.amt);
    const rates = exchange.rates();
    const unit = (g) => (g === 'kredyty' ? 'kr' : 't');
    const r1 = (n) => (n >= 100 ? fmt(n) : (Math.round(n * 10) / 10).toLocaleString('pl-PL'));
    const key = `x|${ex.from}|${ex.to}|${ex.amt}|${r1(q.out)}|${r1(q.amount)}|${q.ok}|${rates.map((r) => `${r.sell.toFixed(1)}:${Math.round(r.have)}`).join()}|${exchange.fee()}`;
    const chips = (side) => GOODS.filter((g) => side === 'from' || g !== 'urobek').map((g) => `<button data-act="ex-${side}" data-g="${g}" class="${ex[side] === g ? 'on' : ''}" ${side === 'to' && g === ex.from ? 'disabled' : ''}>${goodIcon(g, 15)}<span>${esc(GOOD_NAME[g])}</span></button>`).join('');
    return [key, () => `
      <p class="cp-note">Wymień dowolny zasób na inny po kursie rynku. Prowizja ${Math.round(exchange.fee() * 100)}%${exchange.port() ? ' (własny terminal: stacja przeładunkowa)' : ' — stacja przeładunkowa obniża ją do 3%'}; kupno metalu z marżą 10%. Duże wymiany psują kurs.</p>
      <h4>Oddaję</h4><div class="cp-goods">${chips('from')}</div>
      <p class="cp-note">Masz: <b>${r1(exchange.available(ex.from))} ${unit(ex.from)}</b></p>
      <div class="cp-amts">${(ex.from === 'kredyty' ? [100, 500, 1000, 5000] : [10, 50, 100, 500]).map((a) => `<button data-act="ex-amt" data-a="${a}" class="${ex.amt === a ? 'on' : ''}">${fmt(a)}</button>`).join('')}<button data-act="ex-amt" data-a="half">½</button><button data-act="ex-amt" data-a="all">wszystko</button></div>
      <h4>Dostaję</h4><div class="cp-goods">${chips('to')}</div>
      <div class="cp-quote${q.ok ? '' : ' bad'}">${q.ok ? `<span>${goodIcon(ex.from, 20)}<b>${r1(q.amount)}</b> ${unit(ex.from)}</span><span class="cp-arrow">→</span><span>${goodIcon(ex.to, 20)}<b>${r1(q.out)}</b> ${unit(ex.to)}</span><small>kurs 1 ${unit(ex.from)} = ${q.rate >= 1 ? r1(q.rate) : q.rate.toFixed(3).replace('.', ',')} ${unit(ex.to)} · prowizja ${fmt(q.fee)} kr${q.amount + 1e-6 < Math.min(ex.amt, exchange.available(ex.from)) ? ' · ograniczone miejscem w składzie' : ''}</small>` : `<small>${esc(q.why)}</small>`}</div>
      <div class="cp-row"><button class="primary" data-act="ex-trade" ${q.ok ? '' : 'disabled'}>Wymień</button><button data-act="ex-swap">⇄ Odwróć</button></div>
      <h4>Kursy (1 t)</h4>
      <table class="cp-rates"><tr><th></th><th>sprzedaż</th><th>kupno</th><th>rynek</th><th>masz</th></tr>
        ${rates.map((r) => `<tr><td>${goodIcon(r.id, 14)} ${esc(GOOD_NAME[r.id])}</td><td>${r.sell.toFixed(1)}</td><td>${r.buy ? r.buy.toFixed(1) : '—'}</td><td class="${r.market == null ? '' : r.market < 0.95 ? 'down' : r.market > 1.05 ? 'up' : ''}">${r.market == null ? '—' : `${Math.round(r.market * 100)}%`}</td><td>${fmt(r.have)}</td></tr>`).join('')}</table>`];
  }

  function tabUpgrades() {
    const cats = [...new Set(UPGRADE_ORDER.map((id) => UPGRADES[id].cat))];
    const key = `u|${UPGRADE_ORDER.map((id) => `${command.lvl(id)}:${command.upgradeState(id).ok}`).join()}`;
    return [key, () => cats.map((c) => `<h4>${esc(c)}</h4>${UPGRADE_ORDER.filter((id) => UPGRADES[id].cat === c).map((id) => {
      const u = UPGRADES[id], st = command.upgradeState(id), l = command.lvl(id);
      return `<div class="cp-up${st.max ? ' max' : ''}">
        <div class="cp-up-h">${upgradeIcon(20, st.max ? '#4dd6a0' : '#ffd36b')}<b>${esc(u.name)}</b><span class="cp-pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('')}</span></div>
        <small>${esc(u.desc)}</small>
        ${st.max ? '<p class="cp-lock ok">Poziom maksymalny</p>' : st.why && !st.ok && st.why.startsWith('wymaga') ? `<p class="cp-lock">${esc(st.why)}</p>`
          : `<div class="cp-card-b">${costHtml(command.upgradeCost(id), st.ok)}<button data-act="upgrade" data-id="${id}" ${st.ok ? '' : 'disabled'}>Ulepsz → ${l + 1}</button></div>`}
      </div>`;
    }).join('')}`).join('')];
  }

  function tabScience() {
    const rs = s().research;
    const key = `n|${rs?.id}|${s().techs.join()}|${TECH_ORDER.map((id) => command.techState(id).ok).join()}`;
    return [key, () => `
      ${rs ? `<div class="cp-research">${scienceIcon(26)}<div><b>${esc(TECHS[rs.id].name)}</b><small>${esc(TECHS[rs.id].desc)}</small><span class="cp-bar"><i data-live="sci2"></i></span></div></div>`
        : '<p class="cp-note">Laboratoria siedziby czekają na temat badań. Odkrycia dają nowe metody wydobycia, typy dronów i mocniejsze stacje.</p>'}
      ${TECH_ORDER.map((id) => {
        const d = TECHS[id], st = command.techState(id);
        const cls = st.done ? 'done' : st.active ? 'active' : st.locked ? 'locked' : '';
        return `<div class="cp-tech ${cls}"><div class="cp-up-h">${st.done ? '<span class="cp-check">✓</span>' : scienceIcon(18, st.locked ? '#56606c' : '#c39bff')}<b>${esc(d.name)}</b>${st.done ? '' : `<small class="cp-time">${d.time} s</small>`}</div>
          <small>${esc(d.desc)}</small>
          ${st.done || st.active ? '' : st.locked ? `<p class="cp-lock">${esc(st.why)}</p>` : `<div class="cp-card-b">${costHtml(d.cost, can(d.cost))}<button data-act="research" data-id="${id}" ${st.ok ? '' : 'disabled'}>Badaj</button></div>`}
        </div>`;
      }).join('')}`];
  }

  function tabFleet() {
    if (!army) return ['f', () => '<p class="cp-note">Brak floty w tym trybie.</p>'];
    const ships = army.ships;
    const yard = army.yardHere();
    const here = economy.systemId === s().home;
    const race = RACES[playerRace()];
    const yardAtHome = economy.stationsIn(s().home).find((x) => x.type === 'stocznia');
    const key = `f|${ships.map((x) => `${x.id}:${x.order}:${x.field}:${x.sysId}`).join()}|${army.queue.length}|${Math.round(army.power() * 10)}|${yard?.id}|${yardAtHome?.status}|${WARSHIP_ORDER.map((c) => economy.canPayCost(WARSHIPS[c].cost)).join()}|${can(STATIONS.stocznia.cost)}|${here}`;
    const orderOpts = (x) => {
      const opts = [`<option value="eskorta|"${x.order === 'eskorta' && !x.group ? ' selected' : ''}>Eskorta (leci z tobą)</option>`];
      if (x.group) opts.unshift('<option value="" selected disabled>W grupie bojowej (Operacje)</option>');
      for (const fid of strategy ? strategy.fieldsOf(PLAYER) : []) {
        const d = strategy.defs.get(fid);
        opts.push(`<option value="obrona|${fid}"${x.order === 'obrona' && x.field === fid ? ' selected' : ''}>Obrona: ${esc(d.name)}</option>`);
      }
      for (const fid of strategy ? strategy.allFields : []) {
        const o = strategy.foreignOwner(fid);
        if (!o || !strategy.atWar(PLAYER, o)) continue;
        opts.push(`<option value="atak|${fid}"${x.order === 'atak' && x.field === fid ? ' selected' : ''}>Atak: ${esc(strategy.defs.get(fid).name)} — ${esc(RACES[o].name)}</option>`);
      }
      return opts.join('');
    };
    return [key, () => `
      <div class="cp-powerbox cp-fleethead">${warshipIcon('fregata', 26, '#ff7a45')}<div><b>Flota: ${ships.length} okr. · siła ${army.power().toFixed(1)}</b><small>Utrzymanie ${fmt(army.upkeepPerMin())} kr/min${ships.some((x) => x.garrison) ? ' (garnizon siedziby bez opłat)' : ''} · straty ${army.lost}</small></div></div>
      <div class="cp-row"><button data-act="fleet-defend" ${homeShips().length ? '' : 'disabled'}>Broń bazy</button><button data-act="watch-fleet" ${ships.some((x) => x.sysId === economy.systemId) ? '' : 'disabled'}>${eyeIcon(14)} Obserwuj</button><button data-act="industry-fleet">Rozkazy w innych układach</button></div>
      ${extraTab('operacje') ? '<div class="cp-row"><button class="primary" data-act="tab" data-tab="operacje">Grupy bojowe i operacje →</button></div>' : ''}
      <h4>Stocznia</h4>
      ${yard ? `<p class="cp-note">${esc(yard.name)} buduje okręty z metalu w składzie. Nowe okręty dołączają jako eskorta — zmień rozkaz na liście niżej.</p>`
        : yardAtHome && yardAtHome.status !== 'gotowa' ? `<p class="cp-note">Stocznia w budowie (${Math.round(yardAtHome.progress * 100)}%). Holowniki dowożą metal ze składu.</p>`
        : `<div class="cp-yardcta"><p class="cp-note">Bez stoczni flota się nie powiększy. Postaw ją przy siedzibie — potem budujesz okręty tutaj.</p><button class="primary" data-act="station" data-type="stocznia" ${here && can(STATIONS.stocznia.cost) ? '' : 'disabled'}>${stationIcon('stocznia', 18, '#c39bff')} Postaw stocznię</button>${costHtml(STATIONS.stocznia.cost, can(STATIONS.stocznia.cost))}</div>`}
      ${WARSHIP_ORDER.map((cls) => {
        const d = WARSHIPS[cls], ok = economy.canPayCost(d.cost);
        return `<div class="cp-card cp-ship" style="--c:#ff7a45">
          <div class="cp-card-h">${warshipIcon(cls, 30, race.color)}<div><b>${esc(d.name)}</b><small>${esc(d.role)}</small></div><span class="cp-count">${ships.filter((x) => x.cls === cls).length}</span></div>
          <div class="cp-stats"><span>siła <b>${d.power}</b></span><span>kadłub <b>${d.hull}</b></span><span>budowa <b>${d.buildTime} s</b></span><span>utrzymanie <b>${d.upkeep * 6} kr/min</b></span></div>
          <div class="cp-card-b">${costHtml(d.cost, ok)}<button data-act="build-ship" data-cls="${cls}" ${yard && ok ? '' : 'disabled'}>Zbuduj</button></div>
        </div>`;
      }).join('')}
      ${army.queue.length ? `<h4>W budowie</h4>${army.queue.map((q, i) => `<div class="cp-queue">${warshipIcon(q.cls, 18, race.color)}<span>${esc(WARSHIPS[q.cls].name)}</span><span class="cp-bar"><i data-live="shipq-${i}"></i></span></div>`).join('')}` : ''}
      <h4>Okręty</h4>
      ${ships.length ? ships.map((x) => `<div class="cp-st cp-shiprow">${warshipIcon(x.cls, 22, race.color)}<div><b>„${esc(x.callsign)}”</b><small>${esc(WARSHIPS[x.cls].name)}${x.garrison ? ' · garnizon' : ''} · ${x.transit ? 'w fałdzie' : esc(systemName(x.sysId))}${x.group ? ' · grupa bojowa' : ''}</small><span class="cp-hullbar"><i data-live="hull-${x.id}"></i></span></div>
          <select data-act="ship-order" data-ship="${x.id}" aria-label="Rozkaz dla ${esc(x.callsign)}">${orderOpts(x)}</select></div>`).join('')
        : '<p class="cp-note">Nie masz okrętów. Flota broni pól przed nalotami i odbiera pola rywalom.</p>'}`];
  }

  function renderTab() {
    const x = extraTab(tab);
    const [key, html] = x ? x.render() : { hangar: tabHangar, moduly: tabModules, logistyka: tabLogistics, gielda: tabExchange, ulepszenia: tabUpgrades, nauka: tabScience, flota: tabFleet }[tab]();
    set('tab', `${tab}|${key}`, html);
    x?.refresh?.(R.tab);
    const q = R.tab.querySelector('[data-live="queue"]');
    if (q && s().queue.length) { const d = DRONE_TYPES[s().queue[0]]; q.style.width = `${s().buildT > 0 ? (1 - s().buildT / (d.buildTime / (1 + 0.5 * command.lvl('hangar')))) * 100 : 0}%`; }
    if (army) {
      army.queue.forEach((q, i) => { const el = R.tab.querySelector(`[data-live="shipq-${i}"]`); if (el) el.style.width = `${(1 - q.t / WARSHIPS[q.cls].buildTime) * 100}%`; });
      for (const x of army.ships) { const el = R.tab.querySelector(`[data-live="hull-${x.id}"]`); if (el) el.style.width = `${(x.hull / WARSHIPS[x.cls].hull) * 100}%`; }
    }
    const sci = R.tab.querySelector('[data-live="sci2"]');
    if (sci && s().research) sci.style.width = `${(1 - s().research.t / TECHS[s().research.id].time) * 100}%`;
  }

  // ------------------------------------------------------------
  // AKCJE i WYBÓR CELU
  // ------------------------------------------------------------
  function renderActions() {
    set('actions', 'a', () => `
      <button class="cp-pilot" data-act="pilot">${pilotIcon(22)}<span><b>Za sterami</b><small>leć myśliwcem</small></span></button>
      <button data-act="map">${fieldIcon(20, '#ffd36b')}<span><b>Mapa sektora</b><small>pola, rasy, dyplomacja</small></span></button>
      <button data-act="industry">${stationIcon('przeladunek', 20, '#4dd6a0')}<span><b>Przemysł</b><small>rynek, roje, stocznia</small></span></button>`);
  }

  // tryb kompaktowy: dolny pasek - jeden arkusz naraz
  function renderMnav() {
    const exps = command.expeditions().length, fleet = army ? army.ships.length : 0;
    const fleetTab = tab === 'flota' || tab === 'operacje'; // krok 12c: Operacje to część floty
    const on = (k) => (k === 'base' ? sheet === 'side' && !fleetTab : k === 'fleet' ? sheet === 'side' && fleetTab : sheet === k);
    const alarm = !!raids?.status;
    const key = `${sheet}|${tab}|${exps}|${fleet}|${alarm}|${command.state.research?.id}`;
    set('mnav', key, () => `
      <button data-act="sheet" data-sheet="orders" class="${on('orders') ? 'on' : ''}">${droneTypeIcon('gornik', 20, '#ffb13d')}<span>Rozkazy</span></button>
      <button data-act="sheet" data-sheet="exps" class="${on('exps') ? 'on' : ''}">${routeIcon(20)}<span>Wyprawy</span>${exps ? `<em>${exps}</em>` : ''}</button>
      <button data-act="sheet" data-sheet="base" class="${on('base') ? 'on' : ''}">${stationIcon('siedziba', 20, '#ffd36b')}<span>Baza</span></button>
      <button data-act="sheet" data-sheet="fleet" class="cp-mnav-fleet${on('fleet') ? ' on' : ''}${alarm ? ' alarm' : ''}">${warshipIcon('fregata', 20, '#ff7a45')}<span>Flota</span><em>${fleet}</em></button>
      <button data-act="tactical" class="cp-mnav-tac">${fieldIcon(20, '#ff5a8a')}<span>Taktyka</span></button>
      <button data-act="map">${fieldIcon(20, '#ffd36b')}<span>Mapa</span></button>
      <button data-act="industry">${stationIcon('przeladunek', 20, '#4dd6a0')}<span>Przemysł</span></button>
      <button data-act="saves">${saveIcon(20)}<span>Menu</span></button>
      <button data-act="pilot" class="cp-mnav-pilot">${pilotIcon(20)}<span>Za sterami</span></button>`);
  }
  function setSheet(k) {
    const fleetTab = tab === 'flota' || tab === 'operacje';
    if (k === 'base') { if (sheet === 'side' && !fleetTab) sheet = null; else { sheet = 'side'; if (fleetTab) tab = 'hangar'; } }
    else if (k === 'fleet') { if (sheet === 'side' && fleetTab) sheet = null; else { sheet = 'side'; if (!fleetTab) tab = 'flota'; } }
    else sheet = sheet === k ? null : k;
    if (sheet !== 'orders' && picker) { picker = null; onHover(null); }
  }

  function renderPicker() {
    if (!picker) { R.picker.hidden = true; keys.picker = null; return; }
    R.picker.hidden = false;
    const d = DRONE_TYPES[picker.type];
    const { asteroids, unknown } = command.targets();
    const mines = d.hold > 0;
    const rows = [];
    if (picker.type === 'zwiadowca') for (const u of unknown) rows.push({ id: u.id, html: `${scanIcon(22, '#9fd8ff')}<span><b>Nieznane złoże</b><small>sygnał · ${fmt(u.dist / 1000)} tys. j.</small></span>` });
    for (const x of asteroids) {
      if (mines && (!x.surveyed || x.foreign)) continue;
      if (picker.type === 'zwiadowca' && x.surveyed) continue;
      const a = x.a, tot = Math.max(1, sum(a.reserves));
      const bars = x.surveyed ? `<span class="cp-mix">${METAL_ORDER.map((m) => `<i style="width:${(a.reserves[m] / tot) * 100}%;background:${METALS[m].color}"></i>`).join('')}</span><small>${fmt(tot)} t · ${METAL_ORDER.filter((m) => a.reserves[m] > 1).map((m) => METALS[m].symbol).join(' ')}</small>`
        : '<small>niezbadana — skład nieznany</small>';
      rows.push({ id: x.id, html: `<span class="cp-rock c-${a.cls}"></span><span><b>${esc(a.name)}${x.surveyed ? ` <em>kl. ${a.cls}</em>` : ''}</b>${bars}<small>${esc(x.field?.name ?? '')} · ${fmt(x.dist / 1000)} tys. j.${x.foreign ? ' · pole innej rasy' : ''}</small></span>` });
    }
    if (!picker.target || !rows.some((r) => r.id === picker.target)) picker.target = rows[0]?.id ?? null;
    const max = s().hangar[picker.type];
    picker.n = Math.max(1, Math.min(picker.n, max));
    const key = `${picker.type}|${picker.target}|${picker.n}|${max}|${rows.map((r) => r.id).join()}`;
    set('picker', key, () => `
      <h3>${droneTypeIcon(picker.type, 26, d.color)} ${esc({ zwiadowca: 'Zwiad: wybierz cel', gornik: 'Górnicy: wybierz skałę', holownik: 'Holowniki: wybierz skałę', straznik: 'Straż: gdzie pilnować' }[picker.type])}</h3>
      <p class="cp-note">${esc(picker.type === 'zwiadowca' ? 'Zwiadowcy badają skały i odkrywają nieznane pola.' : mines ? 'Tylko zbadane skały na wolnych lub twoich polach. Pasek = skład metalu.' : 'Strażnicy pilnują skały i strzelają do napastników.')}</p>
      <div class="cp-list">${rows.length ? rows.map((r) => `<button class="cp-target${r.id === picker.target ? ' on' : ''}" data-act="target" data-id="${r.id}">${r.html}</button>`).join('') : `<p class="cp-empty">${mines ? 'Brak zbadanych skał — najpierw wyślij zwiadowców.' : 'Brak celów.'}</p>`}</div>
      <div class="cp-send">
        <span>Dronów:</span><button data-act="n" data-d="-1">−</button><b>${picker.n}</b><button data-act="n" data-d="1">+</button><button data-act="n" data-d="99">wszystkie (${max})</button>
        <span class="grow"></span><button data-act="cancel">Anuluj</button><button class="primary" data-act="send" ${picker.target ? '' : 'disabled'}>Poślij</button>
      </div>`);
  }

  // ------------------------------------------------------------
  // KLIKNIĘCIA
  // ------------------------------------------------------------
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('change', (e) => {
    if (e.target.dataset.act?.startsWith('op-')) {
      const x = extraTab(tab);
      const r = x?.onChange?.(e);
      if (r && r.text) result(r);
      keys.tab = null; keys.fleetbox = null;
      refresh();
      return;
    }
    if (e.target.dataset.act === 'auto') { s().auto.returns = e.target.checked; economy.save(); keys.orders = null; }
    if (e.target.dataset.act === 'ask-route') { s().askRoute = e.target.checked; economy.save(); keys.tab = null; }
    if (e.target.dataset.act === 'ship-order' && army) {
      const [kind, field] = e.target.value.split('|');
      result(army.setOrder([e.target.dataset.ship], kind, field || null));
      keys.tab = null; keys.fleetbox = null;
      refresh();
    }
  });
  root.addEventListener('pointerover', (e) => {
    const b = e.target.closest('[data-act="target"]');
    onHover(b ? b.dataset.id : null);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act, exp = b.dataset.exp;
    if (act.startsWith('op-')) {
      const x = extraTabs.find((t) => t.id === (b.dataset.tabId ?? tab)) ?? extraTab(tab);
      const r = x?.onAction?.(act, b);
      if (r && r.text) result(r);
      if (r?.tab) { tab = r.tab; sheet = 'side'; }
    }
    switch (act) {
      case 'pick': picker = picker?.type === b.dataset.type ? null : { type: b.dataset.type, target: null, n: DRONE_TYPES[b.dataset.type].group }; keys.orders = null; break;
      case 'target': picker.target = b.dataset.id; break;
      case 'n': picker.n = b.dataset.d === '99' ? 999 : picker.n + Number(b.dataset.d); break;
      case 'cancel': picker = null; keys.orders = null; onHover(null); break;
      case 'send': result(command.dispatch(picker.type, picker.n, picker.target)); picker = null; keys.orders = null; onHover(null); if (compact()) sheet = null; break;
      case 'alarm': if (economy.alert) { economy.setAlert(false); toast('Alarm odwołany — roje wracają do pracy.'); } else result(command.alarmAll()); break;
      case 'recall': result(command.recall(exp)); break;
      case 'return': { const x = command.expedition(exp); if (x) { x.hold = false; result(command.recall(exp)); } break; }
      case 'manage': { const m = b.closest('.cp-exp').querySelector('.cp-exp-m'); m.hidden = !m.hidden; break; }
      case 'redirect': { const r = command.bestRock(); const x = command.expedition(exp); if (r && x) { x.next = r.id; result(command.recall(exp)); } break; }
      case 'guard': { const x = command.expedition(exp); result(command.sendGuards(x ? command.targetInfo(x).field?.id : null, x?.target.id)); break; }
      case 'fleet': { const x = command.expedition(exp); onFleet(x ? command.targetInfo(x).field?.id : null); break; }
      case 'watch': { const x = command.expedition(exp); if (x) onWatch(x); break; }
      case 'tab': tab = b.dataset.tab; break;
      case 'build': result(command.buildDrones(b.dataset.type, Number(b.dataset.n))); break;
      case 'station': result(command.buildStation(b.dataset.type)); break;
      case 'autonomy': result(command.setAutonomy(b.dataset.st)); break;
      case 'upgrade': result(command.upgrade(b.dataset.id)); break;
      case 'research': result(command.research(b.dataset.id)); break;
      case 'industry-fleet': onIndustry('flota'); break;
      case 'watch-fleet': onFleet(null, { watchOnly: true }); break;
      case 'fleet-defend': onFleet(null, { watch: false }); break;
      case 'fleet-tab': tab = 'flota'; sheet = 'side'; break;
      case 'build-ship': if (army) result(army.order(b.dataset.cls)); break;
      case 'saves': onSaves(); break;
      case 'tactical': onTactical({}); break;
      case 'tactical-sectors': onTactical({ tab: 'sektory' }); break;
      case 'tac-place': onTactical({ place: true }); break;
      case 'route': result(command.setRoute(b.dataset.r)); break;
      case 'buy-freighter': result(command.buyFreighter()); break;
      case 'ex-from': ex.from = b.dataset.g; if (ex.to === ex.from || (ex.from === 'kredyty' && ex.to === 'kredyty')) ex.to = ex.from === 'kredyty' ? 'zelazo' : 'kredyty'; ex.amt = ex.from === 'kredyty' ? 500 : 50; break;
      case 'ex-to': ex.to = b.dataset.g; break;
      case 'ex-amt': { const have = exchange?.available(ex.from) ?? 0; ex.amt = b.dataset.a === 'all' ? have : b.dataset.a === 'half' ? have / 2 : Number(b.dataset.a); break; }
      case 'ex-swap': if (ex.from !== 'urobek') { [ex.from, ex.to] = [ex.to, ex.from]; ex.amt = ex.from === 'kredyty' ? 500 : 50; } break;
      case 'ex-trade': if (exchange) { const r = exchange.trade(ex.from, ex.to, ex.amt); result(r); } break;
      case 'sheet': setSheet(b.dataset.sheet); break;
      case 'pilot': onPilot(); break;
      case 'map': onMap(); break;
      case 'industry': onIndustry('eco'); break;
      default: break;
    }
    for (const k of ['tab', 'tabs', 'exps', 'picker', 'fleetbox']) keys[k] = act === 'manage' && k === 'exps' ? keys[k] : null;
    refresh();
  });

  function refresh() {
    renderTop(); renderOrders(); renderFleetBox(); renderExps(); renderTabs(); renderTab(); renderActions(); renderPicker(); renderMnav();
    const sh = compact() ? (picker ? 'orders' : sheet ?? '') : 'all';
    if (root.dataset.sheet !== sh) root.dataset.sheet = sh;
    root.classList.toggle('has-picker', !!picker);
  }
  let acc = 0;
  return {
    update(dt) {
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) R.toast.classList.remove('on'); }
      acc -= dt;
      if (acc > 0) return;
      acc = 0.2;
      refresh();
    },
    refresh, toast, result,
    /** Krok 12c: otwórz zakładkę (np. Operacje po "Kontratak" z raportu potyczki). */
    showTab(id) { tab = id; sheet = 'side'; picker = null; for (const k in keys) keys[k] = null; refresh(); },
    openPicker(type) { picker = { type, target: null, n: DRONE_TYPES[type].group }; sheet = 'orders'; refresh(); },
    /** Tryb kompaktowy: otwarty arkusz ('orders' | 'exps' | 'side' | null). */
    get sheet() { return sheet; },
    setSheet(k) { setSheet(k); refresh(); },
    get picker() { return picker; },
    setTab(t) { tab = t; if (compact()) sheet = 'side'; refresh(); },
  };
}
