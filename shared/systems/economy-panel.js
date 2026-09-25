import { METALS, METAL_ORDER, STATIONS, STATION_ORDER, DRONE, ASTEROID_CLASSES, costText } from '../data/economy.js';
import { remaining } from './asteroid-belt.js';

/**
 * PANEL PRZEMYSŁU (krok 10, klawisz P): budowa stacji, stan stacji,
 * zarządzanie rojami dronów i rynek.
 *
 * Dwie prędkości odświeżania. Strukturę (listy stacji i rojów, opcje
 * wyboru) przebudowujemy tylko, gdy economy.version się zmieni - inaczej
 * rozwinięta lista <select> zamykałaby się graczowi pod palcem, a klik
 * trafiałby w element, którego już nie ma. Liczby (kredyty, zapasy, stany
 * dronów) odświeżamy kilka razy na sekundę przez atrybuty data-live.
 */

const fmt = (n) => Math.round(n).toLocaleString('pl-PL');
const fmtDist = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)} tys. j.` : `${Math.round(d)} j.`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sum = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);

export function createEconomyPanel(root, { economy, getShip, getSystemName, onClose }) {
  let builtVersion = -1;
  let open = false;
  let confirmReset = 0;

  root.addEventListener('mousedown', (e) => e.stopPropagation()); // klik w panel to nie strzał
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  function metalBar(storage, cap, key) {
    return `<span class="ip-bar">${METAL_ORDER.map((m) => `<i style="background:${METALS[m].color}" data-live="${key}-${m}"></i>`).join('')}</span>`;
  }

  function build() {
    builtVersion = economy.version;
    const stations = economy.stations();
    const swarms = economy.swarms();
    const docks = stations.filter((s) => s.type === 'dok' && s.status === 'gotowa');
    const asteroids = economy.asteroids();

    const market = METAL_ORDER.map((m) => `
      <div class="ip-metal" style="--mc:${METALS[m].color}">
        <b>${METALS[m].symbol}</b><span>${METALS[m].name}</span>
        <em data-live="price-${m}"></em><small data-live="trend-${m}"></small>
        <span class="ip-sub">w układzie <b data-live="pool-${m}"></b> · w ładowni <b data-live="hold-${m}"></b></span>
      </div>`).join('');

    const buildCards = STATION_ORDER.map((type) => {
      const d = STATIONS[type];
      return `<div class="ip-card" style="--ac:${d.accent}">
        <div class="ip-card-h"><b>${d.name}</b><span class="ip-tag">${d.short}</span></div>
        <p>${d.role}</p>
        <div class="ip-cost">${costText(d.cost)} · montaż ${d.buildTime} s${d.capacity ? ` · ${fmt(d.capacity)} t` : ''}</div>
        <button class="ip-btn" data-act="place" data-type="${type}">Postaw przed dziobem</button>
        <div class="ip-why" data-live="why-${type}"></div>
      </div>`;
    }).join('');

    const stationRows = stations.length ? stations.map((st) => {
      const d = STATIONS[st.type];
      const own = swarms.filter((w) => w.home === st.id);
      return `<div class="ip-card ip-st" style="--ac:${d.accent}">
        <div class="ip-card-h"><b>${esc(st.name)}</b><span class="ip-tag" data-live="st-${st.id}-status"></span></div>
        ${metalBar(st.storage, d.capacity, `st-${st.id}`)}
        <div class="ip-sub" data-live="st-${st.id}-sub"></div>
        ${st.type === 'dok' && st.status === 'gotowa' ? `
          <div class="ip-sub">${own.length ? own.map((w) => esc(w.name)).join(', ') : 'brak rojów'} · limit ${STATIONS.dok.droneSlots} dronów</div>
          <button class="ip-btn ghost" data-act="swarm-new" data-dock="${st.id}">+ Nowy rój</button>` : ''}
      </div>`;
    }).join('') : '<p class="ip-empty">Brak stacji. Zacznij od magazynu: wykop żelazo (T), postaw magazyn (lista obok) i dowieź metal na plac budowy (Y).</p>';

    const astOptions = (sel, from) => {
      const list = asteroids.filter((a) => !a.depleted)
        .map((a) => ({ a, d: from ? Math.hypot(a.position.x - from.x, a.position.y - from.y, a.position.z - from.z) : 0 }))
        .sort((x, y) => x.d - y.d);
      return `<option value="auto"${sel === 'auto' ? ' selected' : ''}>Automatycznie (wartość / odległość)</option>` +
        list.map(({ a, d }) => `<option value="${a.id}"${sel === a.id ? ' selected' : ''}>${a.name} · ${ASTEROID_CLASSES[a.cls].name} · ${fmt(remaining(a))} t · ${fmtDist(d)}</option>`).join('');
    };
    const swarmRows = swarms.length ? swarms.map((w) => {
      const home = stations.find((s) => s.id === w.home);
      return `<div class="ip-card ip-sw">
        <div class="ip-card-h"><b>${esc(w.name)}</b><span class="ip-tag ${w.mode === 'wydobycie' ? 'on' : ''}">${w.mode === 'wydobycie' ? 'wydobycie' : 'w doku'}</span></div>
        <div class="ip-sub">baza: ${esc(home?.name ?? '—')} · <b data-live="sw-${w.id}-n"></b></div>
        <div class="ip-states" data-live="sw-${w.id}-states"></div>
        <label>Złoże<select data-act="target" data-sw="${w.id}">${astOptions(w.target, home?.pos)}</select></label>
        <label>Szukaj<select data-act="prefer" data-sw="${w.id}"><option value="">wszystkiego</option>${METAL_ORDER.map((m) => `<option value="${m}"${w.prefer === m ? ' selected' : ''}>głównie ${METALS[m].name.toLowerCase()}</option>`).join('')}</select></label>
        <label>Urobek do<select data-act="drop" data-sw="${w.id}"><option value="">najbliższej stacji z miejscem</option>${stations.filter((s) => s.status === 'gotowa').map((s) => `<option value="${s.id}"${w.drop === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <div class="ip-row">
          <button class="ip-btn" data-act="drones" data-sw="${w.id}" data-n="1">+1 dron</button>
          <button class="ip-btn" data-act="drones" data-sw="${w.id}" data-n="5">+5</button>
          <button class="ip-btn ghost" data-act="scrap" data-sw="${w.id}">−1</button>
          <button class="ip-btn ghost" data-act="mode" data-sw="${w.id}">${w.mode === 'wydobycie' ? 'Do doku' : 'Wydobycie'}</button>
          <button class="ip-btn ghost danger" data-act="disband" data-sw="${w.id}" title="Rozbiera drony (połowa metalu wraca do doku)">Rozwiąż</button>
        </div>
      </div>`;
    }).join('') : `<p class="ip-empty">${docks.length ? 'Utwórz rój przy doku (kolumna „Stacje”).' : 'Roje wymagają doku roju. Dok to droga inwestycja: najpierw magazyn i stacja przeładunkowa, żeby zarobić na niego.'}</p>`;

    root.innerHTML = `
      <div class="ip-head">
        <div><div class="ip-kicker">Przemysł · ${esc(getSystemName())}</div><div class="ip-credits"><span data-live="credits"></span> <small>kr</small></div></div>
        <div class="ip-income" data-live="income"></div>
        <button class="ip-close" data-act="close" aria-label="Zamknij">×</button>
      </div>
      <div class="ip-market">${market}</div>
      <div class="ip-cols">
        <section><h3>Budowa</h3>${buildCards}<p class="ip-note">Kredyty płacisz od razu, metal trafia na plac budowy: dowieź go sam (Y przy placu) albo holowniki przywiozą go z magazynów i doków. Dron: ${costText(DRONE.cost)}.</p></section>
        <section><h3>Stacje</h3>${stationRows}</section>
        <section><h3>Roje dronów</h3>${swarmRows}</section>
      </div>
      <div class="ip-foot">
        <span data-live="stats"></span>
        <button class="ip-btn ghost danger" data-act="reset" data-live="reset">Nowa gra ekonomiczna</button>
      </div>`;
    refresh();
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const act = b.dataset.act;
    if (act === 'close') { setOpen(false); onClose?.(); }
    else if (act === 'place') {
      const ship = getShip();
      economy.placeStation(b.dataset.type, ship.ahead);
    } else if (act === 'swarm-new') economy.createSwarm(b.dataset.dock);
    else if (act === 'drones') economy.orderDrones(b.dataset.sw, +b.dataset.n);
    else if (act === 'scrap') economy.scrapDrones(b.dataset.sw, 1);
    else if (act === 'mode') {
      const w = economy.swarms().find((x) => x.id === b.dataset.sw);
      economy.setSwarm(w.id, { mode: w.mode === 'wydobycie' ? 'powrot' : 'wydobycie' });
    } else if (act === 'disband') economy.disbandSwarm(b.dataset.sw);
    else if (act === 'reset') {
      if (confirmReset > 0) { economy.reset(); confirmReset = 0; } else { confirmReset = 4; refresh(); }
    }
  });
  root.addEventListener('change', (e) => {
    const s = e.target.closest('select[data-act]');
    if (!s) return;
    const key = s.dataset.act;
    economy.setSwarm(s.dataset.sw, { [key]: s.value || (key === 'target' ? 'auto' : null) });
  });

  function set(key, text) {
    for (const el of root.querySelectorAll(`[data-live="${key}"]`)) if (el.textContent !== text) el.textContent = text;
  }
  function width(key, pct) {
    const el = root.querySelector(`[data-live="${key}"]`);
    if (el) el.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
  }

  function refresh() {
    const s = economy.summary();
    const ship = getShip();
    set('credits', fmt(s.credits));
    set('income', s.income > 0 ? `+${fmt(s.income)} kr / min` : 'brak sprzedaży w ostatniej minucie');
    for (const m of METAL_ORDER) {
      set(`price-${m}`, `${s.prices[m].toFixed(1)} kr/t`);
      const k = s.market[m];
      set(`trend-${m}`, k < 0.97 ? `▼ ${Math.round((1 - k) * 100)}% (nasycony)` : 'kurs stabilny');
      set(`pool-${m}`, `${fmt(s.pool[m])} t`);
      set(`hold-${m}`, `${fmt(s.hold[m])} t`);
    }
    for (const type of STATION_ORDER) {
      const chk = economy.canPlace(type, ship.ahead);
      set(`why-${type}`, chk.ok ? '' : chk.why);
      const btn = root.querySelector(`[data-act="place"][data-type="${type}"]`);
      if (btn) btn.disabled = !chk.ok;
    }
    for (const st of economy.stations()) {
      const d = STATIONS[st.type];
      const need = sum(st.need);
      set(`st-${st.id}-status`, st.status === 'gotowa' ? d.short : need > 0 ? 'plac budowy' : `montaż ${Math.round(st.progress * 100)}%`);
      for (const m of METAL_ORDER) width(`st-${st.id}-${m}`, (st.storage[m] / d.capacity) * 100);
      let sub = `${fmt(sum(st.storage))} / ${fmt(d.capacity)} t`;
      if (st.status === 'budowa' && need > 0) sub = `brakuje: ${METAL_ORDER.filter((m) => st.need[m] > 0.5).map((m) => `${fmt(st.need[m])} t ${METALS[m].symbol}`).join(', ')}`;
      else if (st.type === 'dok' && st.queue.length) sub += ` · w produkcji ${st.queue.length} ${st.buildT > 0 ? `(${st.buildT.toFixed(1)} s)` : '(czeka na metal)'}`;
      else if (st.type === 'przeladunek' && sum(st.storage) > 0.5) sub += ' · wysyłka trwa';
      set(`st-${st.id}-sub`, sub);
    }
    const rt = economy.runtime;
    for (const w of economy.swarms()) {
      const c = { wiercenie: 0, lot: 0, powrot: 0, czeka: 0, dok: 0 };
      for (const d of rt?.drones ?? []) if (d.swarm === w) c[d.state === 'ladowanie' ? 'lot' : d.state === 'rozladunek' ? 'powrot' : d.state]++;
      const queued = economy.stations().find((s) => s.id === w.home)?.queue.filter((x) => x === w.id).length ?? 0;
      set(`sw-${w.id}-n`, `${w.drones} dronów${queued ? ` (+${queued} w budowie)` : ''}`);
      set(`sw-${w.id}-states`, `wierci ${c.wiercenie} · leci ${c.lot} · wraca ${c.powrot}${c.czeka ? ` · czeka ${c.czeka}` : ''} · w doku ${c.dok}`);
    }
    const st = s.stats;
    set('stats', `Wydobyto: ${fmt(st.minedPlayer)} t ręcznie, ${fmt(st.minedDrones)} t dronami · sprzedano ${fmt(sum(st.sold))} t za ${fmt(st.earned)} kr · zbudowano ${st.dronesBuilt} dronów${s.offlineDrones ? ` · ${s.offlineDrones} dronów pracuje w innych układach` : ''}`);
    if (confirmReset > 0) confirmReset -= 1;
    set('reset', confirmReset > 0 ? 'Na pewno? Kliknij jeszcze raz' : 'Nowa gra ekonomiczna');
  }

  let acc = 0;
  function update(dt) {
    if (!open) return;
    if (economy.version !== builtVersion && !root.contains(document.activeElement?.tagName === 'SELECT' ? document.activeElement : null)) build();
    acc += dt;
    if (acc > 0.25) { acc = 0; refresh(); }
  }
  function setOpen(v) {
    open = v;
    root.classList.toggle('visible', v);
    if (v) build();
  }
  return { update, setOpen, toggle: () => setOpen(!open), get open() { return open; } };
}
