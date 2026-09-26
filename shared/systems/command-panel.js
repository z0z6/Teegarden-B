import { METALS, METAL_ORDER, STATIONS, WARSHIPS } from '../data/economy.js';
import { DRONE_TYPES, DRONE_TYPE_ORDER, UPGRADES, UPGRADE_ORDER, TECHS, TECH_ORDER, POWER, EXPEDITION } from '../data/command.js';
import { RACES } from '../data/races.js';
import { PHASE_LABEL } from './command.js';
import { PLAYER } from './strategy.js';
import {
  metalIcon, creditsIcon, stationIcon, droneTypeIcon, powerIcon, oreIcon, scienceIcon, upgradeIcon, pilotIcon,
  eyeIcon, fieldIcon, scanIcon, warshipIcon,
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
const TABS = [['hangar', 'Hangar'], ['moduly', 'Moduły'], ['ulepszenia', 'Ulepszenia'], ['nauka', 'Nauka'], ['flota', 'Flota']];
const BUILDABLE = ['huta', 'reaktor', 'magazyn', 'dok', 'wieza', 'stocznia', 'przeladunek'];

export function createCommandPanel(root, {
  command, economy, strategy = null, army = null, raids = null, playerRace, systemName = (s) => s,
  onPilot = () => {}, onMap = () => {}, onIndustry = () => {}, onFleet = () => {}, onWatch = () => {}, onHover = () => {},
}) {
  root.innerHTML = `
    <header class="cp-top" data-r="top"></header>
    <aside class="cp-orders glass" data-r="orders"></aside>
    <section class="cp-exps" data-r="exps"></section>
    <aside class="cp-side glass"><nav class="cp-tabs" data-r="tabs"></nav><div class="cp-tab" data-r="tab"></div></aside>
    <nav class="cp-actions" data-r="actions"></nav>
    <div class="cp-picker glass" data-r="picker" hidden></div>
    <div class="cp-toast" data-r="toast" aria-live="polite"></div>`;
  const R = Object.fromEntries([...root.querySelectorAll('[data-r]')].map((el) => [el.dataset.r, el]));
  let tab = 'hangar';
  let picker = null; // { type, target, n }
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
    const key = [fmt(economy.state.credits), ...METAL_ORDER.map((m) => Math.round(pool[m])), Math.round(ore), Math.round(pw.supply), Math.round(pw.demand), rs?.id, share, war, economy.systemId].join('|');
    set('top', key, () => `
      <div class="cp-hq">${stationIcon('siedziba', 30, race.color)}<div><b>${esc(command.hq()?.name ?? 'Siedziba')}</b><small>${esc(race.name)} · ${esc(systemName(s().home))}${economy.systemId !== s().home ? ` · <em>jesteś w: ${esc(systemName(economy.systemId))}</em>` : ''}</small></div></div>
      <div class="cp-res" title="Kredyty">${creditsIcon(18)}<b>${fmt(economy.state.credits)}</b></div>
      ${METAL_ORDER.map((m) => `<div class="cp-res" title="${METALS[m].name} w składzie i magazynach">${metalIcon(m, 18)}<b>${fmt(pool[m])}</b></div>`).join('')}
      <div class="cp-res" title="Urobek czekający na przetop w hucie">${oreIcon(18)}<b>${fmt(ore)}</b><small>urobek</small></div>
      <div class="cp-res cp-power${pw.ratio < 1 ? ' low' : ''}" title="Zasilanie: podaż / pobór">${powerIcon(18)}<span class="cp-pbar"><i style="width:${powPct}%"></i></span><small>${fmt(pw.supply)} / ${fmt(pw.demand)} MW</small></div>
      <div class="cp-res cp-sci" title="Badanie w toku">${scienceIcon(18)}${rs ? `<span><b>${esc(TECHS[rs.id].name)}</b><span class="cp-pbar"><i data-live="sci"></i></span></span>` : '<small>laboratoria wolne</small>'}</div>
      <div class="cp-res cp-dom" title="Udział w wartości pól sektora">${fieldIcon(18, '#ffd36b')}<b>${share}%</b><small>sektora${war ? ' · <span class="war">WOJNA</span>' : ''}</small></div>`);
    const bar = R.top.querySelector('[data-live="sci"]');
    if (bar && rs) bar.style.width = `${(1 - rs.t / TECHS[rs.id].time) * 100}%`;
  }

  // ------------------------------------------------------------
  // LEWO: rozkazy
  // ------------------------------------------------------------
  function renderOrders() {
    const h = s().hangar;
    const key = DRONE_TYPE_ORDER.map((t) => `${h[t]}:${command.droneTypeState(t).ok}`).join('|') + `|${s().auto.returns}|${command.has('automatyka')}|${economy.alert}|${picker?.type}`;
    set('orders', key, () => `
      <h3>Rozkazy</h3>
      ${DRONE_TYPE_ORDER.map((t) => {
        const d = DRONE_TYPES[t], st = command.droneTypeState(t);
        const verb = { zwiadowca: 'Wyślij zwiadowców', gornik: 'Wyślij górników', holownik: 'Wyślij holowniki', straznik: 'Postaw straż' }[t];
        return `<button class="cp-order${picker?.type === t ? ' on' : ''}" data-act="pick" data-type="${t}" ${st.ok && h[t] ? '' : 'disabled'} style="--c:${d.color}">
          ${droneTypeIcon(t, 30, d.color)}<span><b>${verb}</b><small>${st.ok ? `w hangarze: ${h[t]}` : esc(st.why)}</small></span></button>`;
      }).join('')}
      <label class="cp-toggle"><input type="checkbox" data-act="auto" ${s().auto.returns || command.has('automatyka') ? 'checked' : ''} ${command.has('automatyka') ? 'disabled' : ''}/><span>Wyprawy wracają same i ruszają na kolejny kurs</span></label>
      <button class="cp-alarm${economy.alert ? ' on' : ''}" data-act="alarm">${economy.alert ? 'Odwołaj alarm' : 'Zaalarmuj wszystkich'}</button>`);
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
    }).join('') : '<p class="cp-empty">Brak wypraw. Wyślij drony z hangaru — rozkazy po lewej.</p>'));
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
    set('tabs', tab, () => TABS.map(([id, label]) => `<button data-act="tab" data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join(''));
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
    const key = `f|${ships.map((x) => `${x.id}:${x.order}:${x.field}:${x.sysId}`).join()}|${army.queue.length}|${Math.round(army.power() * 10)}`;
    return [key, () => `
      <div class="cp-powerbox">${warshipIcon('fregata', 24, '#ff7a45')}<div><b>Flota: ${ships.length} okr. · siła ${army.power().toFixed(1)}</b><small>Utrzymanie ${fmt(army.upkeepPerMin())} kr/min · w budowie ${army.queue.length} · straty ${army.lost}</small></div></div>
      <div class="cp-row"><button data-act="industry-fleet">Stocznia i rozkazy</button><button data-act="watch-fleet" ${ships.some((x) => x.sysId === economy.systemId) ? '' : 'disabled'}>${eyeIcon(14)} Obserwuj flotę</button></div>
      ${ships.length ? ships.map((x) => `<div class="cp-st">${warshipIcon(x.cls, 22, RACES[playerRace()].color)}<div><b>„${esc(x.callsign)}”</b><small>${esc(WARSHIPS[x.cls].name)} · ${x.order === 'obrona' ? `obrona: ${esc(strategy?.defs.get(x.field)?.name ?? '')}` : x.order === 'atak' ? `atak: ${esc(strategy?.defs.get(x.field)?.name ?? '')}` : 'eskorta'} · ${esc(systemName(x.sysId))}</small></div></div>`).join('')
        : '<p class="cp-note">Nie masz okrętów. Postaw stocznię (Moduły), a potem buduj okręty w panelu Stocznia. Flota broni pól i odbiera je rywalom.</p>'}`];
  }

  function renderTab() {
    const [key, html] = { hangar: tabHangar, moduly: tabModules, ulepszenia: tabUpgrades, nauka: tabScience, flota: tabFleet }[tab]();
    set('tab', key, html);
    const q = R.tab.querySelector('[data-live="queue"]');
    if (q && s().queue.length) { const d = DRONE_TYPES[s().queue[0]]; q.style.width = `${s().buildT > 0 ? (1 - s().buildT / (d.buildTime / (1 + 0.5 * command.lvl('hangar')))) * 100 : 0}%`; }
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
    if (e.target.dataset.act === 'auto') { s().auto.returns = e.target.checked; economy.save(); keys.orders = null; }
  });
  root.addEventListener('pointerover', (e) => {
    const b = e.target.closest('[data-act="target"]');
    onHover(b ? b.dataset.id : null);
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act, exp = b.dataset.exp;
    switch (act) {
      case 'pick': picker = picker?.type === b.dataset.type ? null : { type: b.dataset.type, target: null, n: DRONE_TYPES[b.dataset.type].group }; keys.orders = null; break;
      case 'target': picker.target = b.dataset.id; break;
      case 'n': picker.n = b.dataset.d === '99' ? 999 : picker.n + Number(b.dataset.d); break;
      case 'cancel': picker = null; keys.orders = null; onHover(null); break;
      case 'send': result(command.dispatch(picker.type, picker.n, picker.target)); picker = null; keys.orders = null; onHover(null); break;
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
      case 'pilot': onPilot(); break;
      case 'map': onMap(); break;
      case 'industry': onIndustry('eco'); break;
      default: break;
    }
    for (const k of ['tab', 'tabs', 'exps', 'picker']) keys[k] = act === 'manage' && k === 'exps' ? keys[k] : null;
    refresh();
  });

  function refresh() {
    renderTop(); renderOrders(); renderExps(); renderTabs(); renderTab(); renderActions(); renderPicker();
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
    openPicker(type) { picker = { type, target: null, n: DRONE_TYPES[type].group }; refresh(); },
    get picker() { return picker; },
    setTab(t) { tab = t; refresh(); },
  };
}
