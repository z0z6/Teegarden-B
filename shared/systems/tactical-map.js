import * as THREE from 'three';
import { STATIONS } from '../data/economy.js';
import { DRONE_TYPES, ORE_ROUTES, ORE_ROUTE_ORDER } from '../data/command.js';
import { droneTypeIcon, creditsIcon, metalIcon } from '../ui/icons.js';

/**
 * MAPA TAKTYCZNA (krok 12b): układ siedziby z góry.
 *
 *  - WIEŻE STRAŻNICZE: "Postaw wieżę" + dotknięcie mapy = wieża leci z hangaru
 *    w to miejsce. Wieżę na mapie można przeciągnąć (przestawienie). Okrąg
 *    wokół wieży to zasięg jej skutecznej osłony - widać od razu, które skały
 *    i pola obejmuje. Podczas stawiania okrąg idzie za kursorem / palcem.
 *  - SEKTORY: każde pole surowcowe ma licznik górników, zwiadowców
 *    i holowników (−/+). Zarządca (command.js updateAlloc) sam wysyła,
 *    dosyła i odwołuje drony, żeby w polu pracowało dokładnie tyle.
 *
 * Mapa jest w płaszczyźnie pasa: siedziba na dole, jej dziób (wylot hangaru)
 * w górę ekranu - tak jak widok z mostka. Kółko myszy / przyciski ± = zoom,
 * przeciąganie tła = przesuwanie.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('pl-PL');
const CLS_COLOR = { C: '#8a7f72', S: '#c9b28f', M: '#e3e9f0' };
const ALLOC = ['gornik', 'zwiadowca', 'holownik'];

export function createTacticalMap(root, { command, economy, getHostiles = () => [], onResult = () => {}, onClose = () => {} }) {
  root.innerHTML = `
    <div class="tm-mapwrap">
      <svg class="tm-svg" data-r="svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
        <g data-r="static"></g><g data-r="dyn"></g><g data-r="ghost"></g>
      </svg>
      <div class="tm-hint" data-r="hint"></div>
      <div class="tm-toast" data-r="toast" aria-live="polite"></div>
      <div class="tm-zoom"><button data-act="zin" aria-label="Przybliż">+</button><button data-act="zout" aria-label="Oddal">−</button><button data-act="home" aria-label="Okolice siedziby">⌂</button><button data-act="fit" aria-label="Cały układ">⤢</button></div>
    </div>
    <aside class="tm-side">
      <header class="tm-head"><div><div class="tm-kicker">Układ siedziby</div><div class="tm-title">Mapa taktyczna</div></div><button class="tm-close" data-act="close" aria-label="Zamknij">×</button></header>
      <nav class="tm-tabs" data-r="tabs"></nav>
      <div class="tm-body" data-r="body"></div>
    </aside>`;
  const R = Object.fromEntries([...root.querySelectorAll('[data-r]')].map((el) => [el.dataset.r, el]));
  const NS = 'http://www.w3.org/2000/svg';
  let open = false, tab = 'sektory', placing = false, selSentry = null, selField = null;
  let view = null;     // { cx, cy, w } w jednostkach mapy
  let fitBox = null;   // pełny układ
  const keys = {};
  let drag = null;     // { kind: 'sentry'|'pan', id, x0, y0, start, moved }
  let hover = null;    // punkt mapy pod kursorem (podgląd stawiania)
  let acc = 0;

  // ------------------------------------------------------------
  // UKŁAD WSPÓŁRZĘDNYCH: świat (x, z) <-> mapa (u, v); siedziba = (0, 0), dziób w górę
  // ------------------------------------------------------------
  let basis = null;
  function updateBasis() {
    const f = command.frame();
    if (!f) return false;
    basis = { o: f.pos.clone(), side: f.side.clone().setY(0).normalize(), fwd: f.fwd.clone().setY(0).normalize() };
    return true;
  }
  const toMap = (p) => { const dx = p.x - basis.o.x, dz = p.z - basis.o.z; return { u: dx * basis.side.x + dz * basis.side.z, v: -(dx * basis.fwd.x + dz * basis.fwd.z) }; };
  const toWorld = (u, v) => ({ x: basis.o.x + basis.side.x * u - basis.fwd.x * v, z: basis.o.z + basis.side.z * u - basis.fwd.z * v });

  function computeFit() {
    const home = command.state.home;
    let minU = -2500, maxU = 2500, minV = -2500, maxV = 2500;
    const grow = (p, r = 0) => { const m = toMap(p); minU = Math.min(minU, m.u - r); maxU = Math.max(maxU, m.u + r); minV = Math.min(minV, m.v - r); maxV = Math.max(maxV, m.v + r); };
    for (const d of economy.fieldDefs(home)) grow(d.center, d.radius);
    for (const x of command.sentries()) grow(x.pos, command.sentryRange());
    const pad = Math.max(maxU - minU, maxV - minV) * 0.06;
    fitBox = { cx: (minU + maxU) / 2, cy: (minV + maxV) / 2, w: Math.max(maxU - minU, maxV - minV) + pad * 2 };
  }
  /** Widok startowy: siedziba i pole macierzyste (tam pracuje większość dronów). */
  function homeView() {
    const d = economy.fieldDefs(command.state.home)[0];
    if (!d) return { ...fitBox };
    const c = toMap(d.center);
    const w = Math.max(9000, Math.hypot(c.u, c.v) * 1.9 + d.radius * 2 + command.sentryRange() * 2);
    return { cx: c.u / 2, cy: c.v / 2, w };
  }
  function applyView() {
    const rect = R.svg.getBoundingClientRect();
    const asp = rect.width > 0 && rect.height > 0 ? rect.height / rect.width : 0.6;
    const w = view.w, h = w * asp;
    R.svg.setAttribute('viewBox', `${view.cx - w / 2} ${view.cy - h / 2} ${w} ${h}`);
    root.style.setProperty('--px', `${w / Math.max(1, rect.width)}`); // jednostki mapy na piksel (grubości, napisy)
  }
  const px = () => view.w / Math.max(1, R.svg.getBoundingClientRect().width);
  function svgPoint(ev) {
    const pt = R.svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const m = R.svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  // ------------------------------------------------------------
  // WARSTWA STAŁA: pola, skały, stacje (przebudowa przy zmianie klucza)
  // ------------------------------------------------------------
  function renderStatic() {
    const home = command.state.home;
    const defs = economy.fieldDefs(home);
    const rocks = economy.asteroidsIn(home);
    const stations = economy.stationsIn(home);
    const k = px();
    const key = [view.w.toFixed(0), defs.map((d) => `${d.id}:${economy.isDiscovered(home, d.id)}`).join(), rocks.map((a) => `${command.surveyed(a.id) ? 1 : 0}${economy.remaining(a) > a.total0 * 0.02 ? 1 : 0}`).join(''), stations.map((s) => s.id + s.status).join(), selField].join('|');
    if (keys.static === key) return;
    keys.static = key;
    const out = [];
    // pierścienie odległości od siedziby
    for (let r = 5000; r < fitBox.w; r += 5000) out.push(`<circle class="tm-ring" cx="0" cy="0" r="${r}"/><text class="tm-ringl" x="${r * 0.707 + 4 * k}" y="${-r * 0.707}" style="font-size:${10 * k}px">${r / 1000} tys. j.</text>`);
    for (const d of defs) {
      const c = toMap(d.center);
      const known = economy.isDiscovered(home, d.id);
      const s = command.fieldSummary(d.id);
      out.push(`<g class="tm-field${known ? '' : ' unknown'}${s.foreign ? ' foreign' : ''}${selField === d.id ? ' sel' : ''}" data-field="${d.id}">
        <circle cx="${c.u}" cy="${c.v}" r="${d.radius}"/>
        <text x="${c.u}" y="${c.v - d.radius - 8 * k}" style="font-size:${13 * k}px">${esc(known ? d.name : 'Nieznane złoże')}</text>
        ${known ? '' : `<text class="tm-q" x="${c.u}" y="${c.v + 10 * k}" style="font-size:${30 * k}px">?</text>`}
      </g>`);
    }
    for (const a of rocks) {
      if (!economy.isDiscovered(home, a.fieldId)) continue;
      const c = toMap(a.position);
      const live = economy.remaining(a) > a.total0 * 0.02;
      const col = !live ? '#3a3f46' : command.surveyed(a.id) ? CLS_COLOR[a.cls] : '#5d6670';
      out.push(`<circle class="tm-rock" cx="${c.u}" cy="${c.v}" r="${Math.max(a.radius, 3.5 * k)}" fill="${col}"${command.surveyed(a.id) ? '' : ` stroke="#9fb3c6" stroke-dasharray="${2 * k} ${2 * k}" stroke-width="${k}"`}/>`);
    }
    for (const st of stations) {
      const c = toMap(st.pos);
      const r = Math.max(STATIONS[st.type].radius, 7 * k);
      out.push(`<g class="tm-station ${st.type}"><rect x="${c.u - r}" y="${c.v - r}" width="${r * 2}" height="${r * 2}" rx="${r * 0.3}" fill="${STATIONS[st.type].accent}" fill-opacity="${st.status === 'gotowa' ? 0.85 : 0.3}"/>${st.type === 'siedziba' || st.type === 'magazyn' || st.type === 'skladnica' ? `<text x="${c.u}" y="${c.v + r + 13 * k}" style="font-size:${11 * k}px">${esc(st.type === 'siedziba' ? 'Siedziba' : st.name)}</text>` : ''}</g>`);
    }
    R.static.innerHTML = out.join('');
  }

  // ------------------------------------------------------------
  // WARSTWA RUCHOMA: wieże z okręgami, wyprawy, wrogowie
  // ------------------------------------------------------------
  const _p = new THREE.Vector3();
  function renderDyn() {
    const k = px();
    const range = command.sentryRange();
    const out = [];
    for (const x of command.sentries()) {
      const target = toMap(x.pos);
      const cur = toMap(command.sentryPose(x, _p));
      const dragging = drag?.kind === 'sentry' && drag.id === x.id && drag.moved;
      const at = dragging ? drag.at : target;
      out.push(`<g class="tm-sentry${selSentry === x.id ? ' sel' : ''}${x.phase !== 'straz' ? ' moving' : ''}" data-sentry="${x.id}">
        <circle class="tm-range" cx="${at.u}" cy="${at.v}" r="${range}"/>
        ${x.phase === 'lot' || dragging ? `<line class="tm-path" x1="${cur.u}" y1="${cur.v}" x2="${at.u}" y2="${at.v}" stroke-dasharray="${6 * k} ${5 * k}"/>` : ''}
        <path class="tm-hex" transform="translate(${dragging ? at.u : cur.u} ${dragging ? at.v : cur.v}) scale(${k})" d="M0 -11 L9.5 -5.5 L9.5 5.5 L0 11 L-9.5 5.5 L-9.5 -5.5 Z"/>
        <circle class="tm-hit" cx="${dragging ? at.u : cur.u}" cy="${dragging ? at.v : cur.v}" r="${22 * k}"/>
        <rect class="tm-hull" x="${cur.u - 10 * k}" y="${cur.v + 14 * k}" width="${20 * k * Math.max(0, x.hull / DRONE_TYPES.wieza.hull)}" height="${2.5 * k}"/>
      </g>`);
    }
    for (const e of command.expeditions()) {
      if (!command.pose(e, _p)) continue;
      const c = toMap(_p);
      const col = DRONE_TYPES[e.type].color;
      out.push(`<g class="tm-exp"><circle cx="${c.u}" cy="${c.v}" r="${5 * k}" fill="${col}"/><text x="${c.u + 8 * k}" y="${c.v + 4 * k}" style="font-size:${10 * k}px;fill:${col}">${e.n}</text></g>`);
    }
    const fp = command.freighterPos();
    if (fp && command.state.freighter.phase === 'dok') { const c = toMap(fp); out.push(`<g class="tm-freighter"><rect x="${c.u - 14 * k}" y="${c.v - 6 * k}" width="${28 * k}" height="${12 * k}" rx="${3 * k}"/><text x="${c.u}" y="${c.v + 20 * k}" style="font-size:${10 * k}px">frachtowiec</text></g>`); }
    for (const h of getHostiles()) {
      if (!h.alive || h.hidden) continue;
      const c = toMap(h.group.position);
      out.push(`<path class="tm-foe" transform="translate(${c.u} ${c.v}) scale(${k})" d="M0 -9 L8 7 L-8 7 Z"/>`);
    }
    R.dyn.innerHTML = out.join('');
    // podgląd stawiania: okrąg pod kursorem
    R.ghost.innerHTML = placing && hover ? `<circle class="tm-range ghost" cx="${hover.x}" cy="${hover.y}" r="${range}"/><path class="tm-hex ghost" transform="translate(${hover.x} ${hover.y}) scale(${k})" d="M0 -11 L9.5 -5.5 L9.5 5.5 L0 11 L-9.5 5.5 L-9.5 -5.5 Z"/>` : '';
  }

  // ------------------------------------------------------------
  // PANEL BOCZNY
  // ------------------------------------------------------------
  const set = (name, key, html) => { if (keys[name] !== key) { keys[name] = key; R[name].innerHTML = html(); } };
  function renderTabs() {
    set('tabs', tab, () => `<button data-act="tab" data-tab="sektory" class="${tab === 'sektory' ? 'on' : ''}">Sektory</button><button data-act="tab" data-tab="wieze" class="${tab === 'wieze' ? 'on' : ''}">Wieże strażnicze</button>`);
  }
  function tabSentries() {
    const s = command.state;
    const list = command.sentries();
    const d = DRONE_TYPES.wieza;
    const canBuild = economy.canPayIn(s.home, d.cost);
    const fieldOf = (x) => economy.fieldDefs(s.home).find((f) => Math.hypot(f.center.x - x.pos.x, f.center.z - x.pos.z) < f.radius + command.sentryRange());
    const key = `w|${s.hangar.wieza}|${list.map((x) => `${x.id}:${x.phase}:${Math.round(x.hull / 20)}`).join()}|${placing}|${selSentry}|${canBuild}|${s.queue.filter((q) => q === 'wieza').length}`;
    set('body', key, () => `
      <p class="tm-note">Wieże to autonomiczne drony z działkiem i rakietami. Okrąg to zasięg skutecznej osłony: wrogów w nim ostrzeliwują, a górnicy i zwiadowcy w środku giną dużo wolniej.</p>
      <div class="tm-row">
        <button class="tm-btn primary${placing ? ' on' : ''}" data-act="place" ${s.hangar.wieza > 0 || placing ? '' : 'disabled'}>${placing ? 'Stawianie… (dotknij mapy)' : `Postaw wieżę (${s.hangar.wieza} w hangarze)`}</button>
        <button class="tm-btn" data-act="build-sentry" ${canBuild ? '' : 'disabled'} title="Hangar: +1 wieża">+1 wieża <small>${creditsIcon(12)}${d.cost.credits} ${metalIcon('zelazo', 12)}${d.cost.zelazo}</small></button>
      </div>
      ${s.queue.includes('wieza') ? `<p class="tm-note">W produkcji: ${s.queue.filter((q) => q === 'wieza').length} × wieża.</p>` : ''}
      <h4>Rozstawione (${list.length})</h4>
      ${list.length ? list.map((x) => `<div class="tm-item${selSentry === x.id ? ' sel' : ''}" data-act="sel-sentry" data-id="${x.id}">
        ${droneTypeIcon('wieza', 22, d.color)}<div><b>${esc(x.name)}</b><small>${x.phase === 'straz' ? `na pozycji${fieldOf(x) ? ` · ${esc(fieldOf(x).name)}` : ''}` : x.phase === 'lot' ? 'w locie na pozycję' : 'wraca do hangaru'}</small><span class="tm-hbar"><i style="width:${Math.round((x.hull / d.hull) * 100)}%"></i></span></div>
        <button class="tm-btn" data-act="recall-sentry" data-id="${x.id}" ${x.phase === 'powrot' ? 'disabled' : ''}>Wycofaj</button></div>`).join('')
        : '<p class="tm-note">Żadnej wieży na pozycji. Kliknij „Postaw wieżę”, potem miejsce na mapie — najlepiej tak, by okrąg objął skały, na których pracują górnicy.</p>'}
      <p class="tm-note dim">Wieżę przestawisz, przeciągając ją po mapie. Zasięg: ${fmt(command.sentryRange())} j. (ulepszenie „Uzbrojenie wież” go zwiększa).</p>`);
  }
  function stepper(fid, type, want, now, busy) {
    const d = DRONE_TYPES[type];
    const st = command.droneTypeState(type);
    return `<div class="tm-step${st.ok ? '' : ' locked'}" title="${esc(st.ok ? `${d.name}: ile ma pracować w tym polu` : st.why)}">
      ${droneTypeIcon(type, 18, d.color)}<span class="tm-sl">${esc(d.name)}</span>
      <button data-act="alloc" data-f="${fid}" data-t="${type}" data-d="-1" ${st.ok && want > 0 ? '' : 'disabled'} aria-label="mniej">−</button>
      <b>${want}</b>
      <button data-act="alloc" data-f="${fid}" data-t="${type}" data-d="1" ${st.ok ? '' : 'disabled'} aria-label="więcej">+</button>
      <small>${now || busy ? `pracuje ${now}${busy ? ` (+${busy} z rozkazu)` : ''}` : ''}</small>
    </div>`;
  }
  function tabSectors() {
    const s = command.state;
    const defs = economy.fieldDefs(s.home);
    const sums = defs.map((d) => command.fieldSummary(d.id));
    sums.sort((a, b) => (b.discovered - a.discovered) || (a.foreign - b.foreign));
    const key = `s|${ALLOC.map((t) => s.hangar[t]).join()}|${sums.map((x) => `${x.id}:${x.discovered}:${x.surveyed}:${x.live}:${ALLOC.map((t) => `${x.want[t]}/${x.now[t]}/${x.busy[t]}`).join()}:${x.route}:${x.cover}:${Math.round(x.remaining / 50)}`).join()}|${selField}|${ALLOC.map((t) => command.droneTypeState(t).ok).join()}`;
    set('body', key, () => `
      <p class="tm-note">Ustal, ile dronów ma pracować w każdym polu. Zarządca sam je wyśle, dośle po powrocie i odwoła nadmiar. Wolne w hangarze: <b>${ALLOC.filter((t) => command.droneTypeState(t).ok).map((t) => `${DRONE_TYPES[t].plural} ${s.hangar[t]}`).join(' · ')}</b>.</p>
      ${sums.map((x) => `<section class="tm-sector${selField === x.id ? ' sel' : ''}${x.foreign ? ' foreign' : ''}" data-act="sel-field" data-id="${x.id}">
        <header><b>${esc(x.discovered ? x.name : 'Nieznane złoże')}</b>${x.cover ? `<span class="tm-cover" title="Wieże osłaniające pole">${droneTypeIcon('wieza', 14, '#ff5a8a')}${x.cover}</span>` : '<span class="tm-cover none" title="Pole bez osłony wież">bez osłony</span>'}</header>
        <small>${x.discovered ? `skały zbadane ${x.surveyed}/${x.rocks} · do wydobycia ${fmt(x.remaining)} t` : 'sygnał czujników — wyślij zwiadowców'}${x.foreign ? ' · pole innej rasy' : ''}</small>
        ${stepper(x.id, 'zwiadowca', x.want.zwiadowca, x.now.zwiadowca, x.busy.zwiadowca)}
        ${x.discovered ? stepper(x.id, 'gornik', x.want.gornik, x.now.gornik, x.busy.gornik) + stepper(x.id, 'holownik', x.want.holownik, x.now.holownik, x.busy.holownik) : ''}
        ${x.discovered ? `<div class="tm-route"><span>Urobek:</span>${ORE_ROUTE_ORDER.map((r) => `<button data-act="route" data-f="${x.id}" data-r="${r}" class="${x.route === r ? 'on' : ''}" title="${esc(ORE_ROUTES[r].desc)}">${ORE_ROUTES[r].name}</button>`).join('')}</div>` : ''}
      </section>`).join('')}`);
  }
  function renderSide() {
    renderTabs();
    if (tab === 'wieze') tabSentries(); else tabSectors();
    R.hint.textContent = placing ? 'Dotknij mapy, żeby postawić wieżę (Esc — anuluj)' : '';
    R.hint.hidden = !placing;
    root.classList.toggle('placing', placing);
  }

  // ------------------------------------------------------------
  // STEROWANIE
  // ------------------------------------------------------------
  let toastT = null;
  const result = (r) => {
    if (!r) return r;
    onResult(r);
    keys.body = null;
    R.toast.textContent = r.text ?? '';
    R.toast.classList.toggle('bad', !r.ok);
    R.toast.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => R.toast.classList.remove('on'), 2800);
    return r;
  };
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled || b.closest('.tm-svg')) return;
    const act = b.dataset.act;
    switch (act) {
      case 'close': hide(); return;
      case 'tab': tab = b.dataset.tab; placing = false; break;
      case 'place': placing = !placing && command.state.hangar.wieza > 0; tab = 'wieze'; break;
      case 'build-sentry': result(command.buildDrones('wieza', 1)); break;
      case 'recall-sentry': ev.stopPropagation(); result(command.recallSentry(b.dataset.id)); break;
      case 'sel-sentry': selSentry = b.dataset.id; focusOn(command.sentries().find((x) => x.id === selSentry)?.pos); break;
      case 'alloc': {
        ev.stopPropagation();
        const f = command.fieldSummary(b.dataset.f);
        result(command.setAlloc(b.dataset.f, b.dataset.t, f.want[b.dataset.t] + Number(b.dataset.d)));
        selField = b.dataset.f;
        break;
      }
      case 'route': ev.stopPropagation(); result(command.setAllocRoute(b.dataset.f, b.dataset.r)); break;
      case 'sel-field': selField = b.dataset.id; break;
      case 'zin': zoom(0.7); break;
      case 'zout': zoom(1 / 0.7); break;
      case 'fit': view = { ...fitBox }; applyView(); keys.static = null; break;
      case 'home': view = homeView(); applyView(); keys.static = null; break;
      default: break;
    }
    keys.body = null; keys.static = null;
    refresh();
  });
  function zoom(f, at = null) {
    const c = at ?? { x: view.cx, y: view.cy };
    const w = Math.min(fitBox.w * 2.5, Math.max(1500, view.w * f));
    const k = w / view.w;
    view = { cx: c.x + (view.cx - c.x) * k, cy: c.y + (view.cy - c.y) * k, w };
    applyView();
    keys.static = null;
  }
  function focusOn(p) { if (!p) return; const m = toMap(p); view.cx = m.u; view.cy = m.v; applyView(); }
  R.svg.addEventListener('wheel', (ev) => { ev.preventDefault(); zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, svgPoint(ev)); renderStatic(); renderDyn(); }, { passive: false });
  R.svg.addEventListener('pointerdown', (ev) => {
    const p = svgPoint(ev);
    const sg = ev.target.closest('[data-sentry]');
    R.svg.setPointerCapture(ev.pointerId);
    if (sg && !placing) drag = { kind: 'sentry', id: sg.dataset.sentry, x0: ev.clientX, y0: ev.clientY, at: { u: p.x, v: p.y }, moved: false };
    else if (placing) { hover = p; drag = { kind: 'place', x0: ev.clientX, y0: ev.clientY }; }
    else drag = { kind: 'pan', x0: ev.clientX, y0: ev.clientY, cx: view.cx, cy: view.cy, field: ev.target.closest('[data-field]')?.dataset.field ?? null, moved: false };
  });
  R.svg.addEventListener('pointermove', (ev) => {
    const p = svgPoint(ev);
    if (placing) { hover = p; renderDyn(); }
    if (!drag) return;
    const moved = Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 6;
    if (drag.kind === 'sentry') { drag.moved ||= moved; drag.at = { u: p.x, v: p.y }; renderDyn(); }
    if (drag.kind === 'pan' && (drag.moved ||= moved)) {
      const k = px();
      view.cx = drag.cx - (ev.clientX - drag.x0) * k;
      view.cy = drag.cy - (ev.clientY - drag.y0) * k;
      applyView();
    }
  });
  R.svg.addEventListener('pointerup', (ev) => {
    const d = drag;
    drag = null;
    if (!d) return;
    const p = svgPoint(ev);
    if (d.kind === 'place') {
      const w = toWorld(p.x, p.y);
      const r = result(command.deploySentry(w));
      if (r?.ok) selSentry = r.sentry.id;
      placing = false; // jedno dotknięcie = jedna wieża (kolejną: „Postaw wieżę” jeszcze raz)
    } else if (d.kind === 'sentry') {
      if (d.moved) { const w = toWorld(d.at.u, d.at.v); result(command.moveSentry(d.id, w)); }
      selSentry = d.id; tab = 'wieze';
    } else if (d.kind === 'pan' && !d.moved) {
      selField = d.field; if (d.field) tab = 'sektory';
    }
    keys.body = null; keys.static = null;
    refresh();
  });
  R.svg.addEventListener('pointerleave', () => { if (placing) { hover = null; renderDyn(); } });
  for (const ev of ['mousedown', 'keydown', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation());
  addEventListener('keydown', (e) => {
    if (!open || e.key !== 'Escape') return;
    e.preventDefault(); // menu gry (Esc) - dopiero, gdy mapa zamknięta
    if (placing) { placing = false; refresh(); } else hide();
  });
  addEventListener('resize', () => { if (open) { applyView(); keys.static = null; } });

  function refresh() {
    if (!open || !updateBasis()) return;
    renderStatic(); renderDyn(); renderSide();
  }
  function show(opts = {}) {
    if (!updateBasis()) return;
    open = true;
    root.classList.add('visible');
    computeFit();
    view ??= homeView();
    if (opts.tab) tab = opts.tab;
    placing = !!opts.place && command.state.hangar.wieza > 0;
    if (opts.place) tab = 'wieze';
    if (opts.field) selField = opts.field;
    for (const k of Object.keys(keys)) keys[k] = null;
    requestAnimationFrame(() => { applyView(); refresh(); });
    applyView();
    refresh();
  }
  function hide() { if (!open) return; open = false; placing = false; drag = null; root.classList.remove('visible'); onClose(); }

  return {
    show, hide, toggle: (o) => (open ? hide() : show(o)),
    get open() { return open; },
    get placing() { return placing; },
    update(dt) {
      if (!open) return;
      acc -= dt;
      if (acc > 0) return;
      acc = 0.2;
      refresh();
    },
    /** Test: punkt mapy -> świat (x, z). */
    mapToWorld: (u, v) => (updateBasis() ? toWorld(u, v) : null),
    worldToMap: (p) => (updateBasis() ? toMap(p) : null),
  };
}
