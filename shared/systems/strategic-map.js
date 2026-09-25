import { RACES } from '../data/races.js';
import { racePortrait } from '../data/race-portraits.js';
import { WARSHIPS } from '../data/economy.js';
import { ARCHETYPES, fieldValue } from './fields.js';
import { PLAYER } from './strategy.js';
import { fieldIcon, stanceIcon, STANCE_LABEL, creditsIcon, warshipIcon, scanIcon, stationIcon } from '../ui/icons.js';

/**
 * MAPA STRATEGICZNA (krok 11, klawisz M): trzy karty.
 *   Sektor      mapa wybranego układu - pola surowcowe w kolorach właścicieli,
 *               aura wpływu (poziom rozwoju), statek gracza, jego stacje i
 *               flota; po prawej ranking dominacji. Klik w pole: szczegóły,
 *               kurs (znacznik na ekranie), skok do układu, wysłanie floty.
 *   Dyplomacja  karty ras: portret, stronnictwo rządzące, stan stosunków,
 *               miernik relacji, siła, pola i akcje (wojna, pokój, pakt,
 *               sojusz, dar, haracz).
 *   Kronika     wieści z sektora z portretami ras.
 * Grafika: SVG z kodu (portrety ras, ikony), bez plików.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('pl-PL');
const PLAYER_COLOR = '#ffd36b';

export function createStrategicMap(root, {
  strategy, economy, army, systems, systemName, currentSystem, shipPos, playerRace, onJump, onWaypoint, onClose,
}) {
  let open = false, tab = 'sektor', viewSys = null, selected = null, note = '', acc = 0;
  const portraits = new Map();
  const portrait = (raceId, size) => {
    const k = `${raceId}:${size}`;
    if (!portraits.has(k)) portraits.set(k, racePortrait(raceId, { seed: 3, faction: strategy.rulingFaction(raceId), size }));
    return portraits.get(k);
  };
  const colorOf = (who) => (who === PLAYER ? PLAYER_COLOR : who ? RACES[who].color : '#5b6674');
  const nameOf = (who) => (who === PLAYER ? 'Ty' : RACES[who].name);

  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'close') { setOpen(false); onClose?.(); return; }
    if (a === 'tab') { tab = b.dataset.tab; render(); return; }
    if (a === 'sys') { viewSys = b.dataset.sys; selected = null; render(); return; }
    if (a === 'field') { selected = b.dataset.fid; render(); return; }
    if (a === 'waypoint') { onWaypoint?.(selected); note = 'Kurs ustawiony: znacznik celu na ekranie.'; render(); return; }
    if (a === 'jump') { onJump?.(viewSys); setOpen(false); return; }
    if (a === 'send') {
      const ships = army.ships.filter((s) => s.sysId === currentSystem() && s.order === 'eskorta').map((s) => s.id);
      if (!ships.length) { note = 'Brak wolnych okrętów w eskorcie (stocznia: panel P → Flota).'; render(); return; }
      const r = army.setOrder(ships, b.dataset.order, selected);
      note = r.ok ? `${ships.length} okr.: ${b.dataset.order === 'atak' ? 'atak na pole' : 'obrona pola'}.` : r.text;
      render(); return;
    }
    if (a === 'dip') {
      const r = strategy.playerAction(b.dataset.kind, b.dataset.race);
      note = r.text; render(); return;
    }
  });

  // ------------------------------------------------------------
  // SEKTOR
  // ------------------------------------------------------------
  function project(sysId) {
    const ids = strategy.bySystem.get(sysId);
    const pts = ids.map((fid) => strategy.defs.get(fid).center);
    let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.18 + 1;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    return (p) => [300 + ((p.x - cx) / span) * 560, 300 + ((p.z - cz) / span) * 560];
  }

  function mapSvg(sysId) {
    const P = project(sysId);
    const [ox, oy] = P({ x: 0, z: 0 });
    const ids = strategy.bySystem.get(sysId);
    const here = sysId === currentSystem();
    let out = `<defs>
      <radialGradient id="sm-star"><stop offset="0" stop-color="#fff4d6"/><stop offset=".25" stop-color="#ffb45c"/><stop offset="1" stop-color="#ff7a45" stop-opacity="0"/></radialGradient>
      <radialGradient id="sm-bg" cx=".5" cy=".5" r=".7"><stop offset="0" stop-color="#101c30"/><stop offset="1" stop-color="#05080e"/></radialGradient>
      <pattern id="sm-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 H0 V40" fill="none" stroke="#9fd8ff" stroke-opacity=".05"/></pattern>
    </defs>
    <rect width="600" height="600" fill="url(#sm-bg)"/><rect width="600" height="600" fill="url(#sm-grid)"/>`;
    // gwiazda (barycentrum) i pierścień pól
    const r0 = Math.hypot(...(() => { const c = strategy.defs.get(ids[0]).center; const [x, y] = P(c); return [x - ox, y - oy]; })());
    out += `<circle cx="${ox}" cy="${oy}" r="${r0}" fill="none" stroke="#ffd9a0" stroke-opacity=".12" stroke-dasharray="3 7"/>`;
    out += `<circle cx="${ox}" cy="${oy}" r="46" fill="url(#sm-star)"/><circle cx="${ox}" cy="${oy}" r="7" fill="#fff4d6"/>`;
    out += `<text x="${ox}" y="${oy + 30}" class="sm-sys">${esc(systemName(sysId))}</text>`;
    for (const fid of ids) {
      const def = strategy.defs.get(fid);
      const known = economy.isDiscovered(sysId, fid);
      const owner = strategy.ownerOf(fid);
      const fs = strategy.state.fields[fid];
      const [x, y] = P(known ? def.center : def.signal);
      const col = colorOf(owner);
      const sel = selected === fid;
      const lvl = owner === PLAYER ? economy.stationsNear(sysId, def.center, def.radius + 2500).length : fs.develop;
      const halo = 18 + 7 * Math.min(5, lvl);
      const war = owner && owner !== PLAYER && strategy.atWar(PLAYER, owner);
      out += `<g class="sm-field ${sel ? 'sel' : ''} ${known ? '' : 'unknown'}" data-act="field" data-fid="${fid}" style="--c:${col}">`;
      if (owner) out += `<circle cx="${x}" cy="${y}" r="${halo}" fill="${col}" fill-opacity=".13" stroke="${col}" stroke-opacity=".45" ${war ? 'stroke-dasharray="4 3"' : ''}/>`;
      if (fs.siege) out += `<circle cx="${x}" cy="${y}" r="${halo + 6}" fill="none" stroke="#ff5a4d" stroke-width="2" class="sm-pulse"/>`;
      const hex = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + i * Math.PI / 3; return `${x + Math.cos(a) * 13},${y + Math.sin(a) * 13}`; }).join(' ');
      out += `<polygon points="${hex}" fill="${known ? '#0b1422' : '#0b142299'}" stroke="${known ? col : '#8fa3b8'}" stroke-width="${sel ? 3 : 1.8}"/>`;
      out += known ? `<circle cx="${x - 3}" cy="${y - 2}" r="3.2" fill="${col}"/><circle cx="${x + 4}" cy="${y + 3}" r="2.2" fill="${col}" opacity=".7"/>`
        : `<text x="${x}" y="${y + 5}" class="sm-q">?</text>`;
      out += `<text x="${x}" y="${y + halo + 14}" class="sm-name">${known ? esc(def.name) : 'nieznane złoże'}</text>`;
      if (owner) out += `<text x="${x}" y="${y + halo + 27}" class="sm-owner" fill="${col}">${esc(nameOf(owner))}${lvl ? ` · ${'▮'.repeat(Math.min(5, lvl))}` : ''}</text>`;
      out += `</g>`;
    }
    // flota gracza w układzie
    const ships = army.ships.filter((s) => s.sysId === sysId);
    if (ships.length) out += `<text x="18" y="580" class="sm-fleet">Twoja flota tutaj: ${ships.length} okr. · siła ${army.power(sysId).toFixed(1)}</text>`;
    if (here) {
      const sp = shipPos();
      const [x, y] = P(sp);
      out += `<g class="sm-ship"><circle cx="${x}" cy="${y}" r="10" fill="none" stroke="${PLAYER_COLOR}" stroke-opacity=".5" class="sm-pulse"/><path d="M${x} ${y - 7} L${x + 5} ${y + 5} L${x} ${y + 2} L${x - 5} ${y + 5} Z" fill="${PLAYER_COLOR}"/></g>`;
    }
    return `<svg class="sm-svg" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
  }

  function fieldCard() {
    if (!selected) return `<div class="sm-hint">${scanIcon(22)}<p>Kliknij pole na mapie. Nieznane złoża („?”) odkrywasz, podlatując bliżej — czujniki statku widzą ok. 9 tys. j.</p></div>`;
    const def = strategy.defs.get(selected);
    const sysId = def.systemId;
    const known = economy.isDiscovered(sysId, selected);
    const owner = strategy.ownerOf(selected);
    const fs = strategy.state.fields[selected];
    const val = fieldValue(def);
    const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(val * 2)))) + '☆'.repeat(Math.max(0, 5 - Math.round(val * 2)));
    const here = sysId === currentSystem();
    const sp = shipPos();
    const dist = here ? Math.hypot(sp.x - def.center.x, sp.y - def.center.y, sp.z - def.center.z) : null;
    const war = owner && owner !== PLAYER && strategy.atWar(PLAYER, owner);
    let who;
    if (owner === PLAYER) who = `<div class="sm-own"><span class="sm-dot" style="background:${PLAYER_COLOR}"></span><b>Twoje pole</b> · obrona ${strategy.fieldDefense(selected).toFixed(1)}</div>`;
    else if (owner) who = `<div class="sm-own"><span class="sm-pic">${portrait(owner, 34)}</span><span><b style="color:${RACES[owner].color}">${esc(RACES[owner].name)}</b><br><small>${esc(strategy.factionName(owner))} · placówka poz. ${fs.develop} · obrona ${strategy.fieldDefense(selected).toFixed(1)}</small></span></div>`;
    else who = `<div class="sm-own"><span class="sm-dot"></span><b>Wolne pole</b> — kto pierwszy postawi stację, ten bierze.</div>`;
    const idle = army.ships.filter((s) => s.sysId === currentSystem() && s.order === 'eskorta').length;
    let actions = '';
    if (here) actions += `<button class="sm-btn" data-act="waypoint">Ustaw kurs${dist ? ` · ${(dist / 1000).toFixed(1)} tys. j.` : ''}</button>`;
    else actions += `<button class="sm-btn" data-act="jump">Skok do układu ${esc(systemName(sysId))}</button>`;
    if (owner === PLAYER) actions += `<button class="sm-btn ghost" data-act="send" data-order="obrona" ${idle ? '' : 'disabled'}>Flota: broń pola (${idle})</button>`;
    else if (owner) actions += `<button class="sm-btn ghost ${war ? 'danger' : ''}" data-act="send" data-order="atak" ${idle && war ? '' : 'disabled'} title="${war ? '' : 'Najpierw wojna (karta Dyplomacja)'}">Flota: zdobądź pole (${idle})</button>`;
    return `<div class="sm-card">
      <div class="sm-card-h">${fieldIcon(22, colorOf(owner))}<div><b>${known ? esc(def.name) : 'Nieznane złoże'}</b><small>${esc(systemName(sysId))} · ${known ? esc(ARCHETYPES[def.kind]?.label ?? def.kind) : 'sygnał czujników'}</small></div></div>
      <div class="sm-val"><span>Wartość</span><b class="sm-stars">${stars}</b><small>×${val.toFixed(2)}</small></div>
      ${who}
      ${fs.siege ? `<div class="sm-alert">Oblężenie: ${esc(RACES[fs.siege.attacker].name)} (${Math.ceil(fs.siege.t)} s)</div>` : ''}
      <div class="sm-actions">${actions}</div>
    </div>`;
  }

  function standings() {
    return strategy.standings().map((r) => {
      const c = colorOf(r.id);
      const pic = r.id === PLAYER ? `<span class="sm-dot big" style="background:${PLAYER_COLOR}"></span>` : `<span class="sm-pic">${portrait(r.id, 30)}</span>`;
      return `<div class="sm-rank ${r.id === PLAYER ? 'me' : ''}">
        ${pic}<div class="sm-rank-b"><div><b style="color:${c}">${esc(nameOf(r.id))}</b>${r.stance ? `<span class="sm-st">${stanceIcon(r.stance, 14)}</span>` : ''}</div>
        <span class="sm-bar"><i style="width:${Math.min(100, Math.max(2, r.share * 200)).toFixed(1)}%;background:${c}"></i></span>
        <small>${r.fields} pól · ${Math.round(r.share * 100)}% sektora · siła ${r.power.toFixed(0)}</small></div></div>`;
    }).join('');
  }

  // ------------------------------------------------------------
  // DYPLOMACJA
  // ------------------------------------------------------------
  const temperTags = (id) => {
    const f = strategy.state.factions[id];
    const t = [];
    if (f.aggression > 0.7) t.push('agresywni'); else if (f.aggression < 0.5) t.push('ugodowi');
    if (f.greed > 0.6) t.push('chciwi');
    if (f.caution > 0.55) t.push('ostrożni');
    if (f.expansion > 0.6) t.push('ekspansywni');
    return t;
  };
  function diplomacy() {
    return `<div class="sm-dip">${Object.keys(strategy.state.factions).map((id) => {
      const r = strategy.rel(PLAYER, id), st = strategy.stance(PLAYER, id);
      const f = strategy.state.factions[id];
      const pos = (r + 100) / 2;
      const c = RACES[id].color;
      const fields = strategy.fieldsOf(id).length;
      return `<div class="sm-race" style="--c:${c}">
        <div class="sm-race-pic">${portrait(id, 92)}</div>
        <div class="sm-race-b">
          <div class="sm-race-h"><b>${esc(RACES[id].name)}</b><span class="sm-chip st-${st}">${stanceIcon(st, 14)} ${STANCE_LABEL[st]}</span></div>
          <small class="sm-fac">${esc(strategy.factionName(id))} · ${temperTags(id).join(', ') || 'wyważeni'}</small>
          <div class="sm-rel"><span class="sm-rel-track"><i style="left:${pos}%"></i></span><small>relacja ${r > 0 ? '+' : ''}${Math.round(r)}</small></div>
          <div class="sm-race-stats"><span>${fieldIcon(14, c)} ${fields} pól</span><span>${warshipIcon('fregata', 14, c)} ${f.ships} okr.</span><span>${creditsIcon(14)} ~${fmt(Math.round(f.credits / 500) * 500)}</span></div>
          <div class="sm-race-act">
            ${st === 'wojna' ? `<button class="sm-btn" data-act="dip" data-kind="peace" data-race="${id}">Pokój</button>`
              : `<button class="sm-btn ghost danger" data-act="dip" data-kind="war" data-race="${id}">Wojna</button>`}
            ${st === 'pokoj' ? `<button class="sm-btn ghost" data-act="dip" data-kind="pact" data-race="${id}">Pakt</button>` : ''}
            ${st === 'pakt' ? `<button class="sm-btn ghost" data-act="dip" data-kind="alliance" data-race="${id}">Sojusz</button>` : ''}
            <button class="sm-btn ghost" data-act="dip" data-kind="gift" data-race="${id}">Dar 1000 kr</button>
            <button class="sm-btn ghost" data-act="dip" data-kind="tribute" data-race="${id}">Haracz</button>
          </div>
        </div></div>`;
    }).join('')}</div>`;
  }

  function chronicle() {
    const log = strategy.state.log;
    if (!log.length) return '<p class="sm-empty">Na razie cisza w sektorze.</p>';
    return `<div class="sm-log">${log.map((e) => `<div class="sm-log-e ${e.kind ?? ''}">${e.faction ? `<span class="sm-pic">${portrait(e.faction, 28)}</span>` : `<span class="sm-dot"></span>`}<span>${esc(e.text)}</span><small>${Math.floor(e.t / 60)}:${String(Math.floor(e.t % 60)).padStart(2, '0')}</small></div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------
  function render() {
    viewSys ??= currentSystem();
    const sysTabs = systems.map((id) => {
      const ids = strategy.bySystem.get(id);
      const dots = ids.map((fid) => `<i style="background:${colorOf(strategy.ownerOf(fid))}"></i>`).join('');
      return `<button class="sm-sysb ${id === viewSys ? 'on' : ''} ${id === currentSystem() ? 'here' : ''}" data-act="sys" data-sys="${id}"><b>${esc(systemName(id))}</b><span class="sm-dots">${dots}</span></button>`;
    }).join('');
    const mine = strategy.fieldsOf(PLAYER).length;
    root.innerHTML = `
      <div class="sm-head">
        <div><div class="sm-kicker">Mapa strategiczna</div><div class="sm-title">Przestrzeń surowcowa sektora</div></div>
        <div class="sm-score">${fieldIcon(18, PLAYER_COLOR)} <b>${mine}</b> pól · <b>${Math.round(strategy.share(PLAYER) * 100)}%</b> sektora <small>(dominacja: 50%)</small></div>
        <nav class="sm-tabs">${['sektor', 'dyplomacja', 'kronika'].map((t) => `<button data-act="tab" data-tab="${t}" class="${tab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</nav>
        <button class="sm-close" data-act="close" aria-label="Zamknij">×</button>
      </div>
      ${note ? `<div class="sm-note">${esc(note)}</div>` : ''}
      ${tab === 'sektor' ? `<div class="sm-sector">
          <div class="sm-left"><div class="sm-systems">${sysTabs}</div>${fieldCard()}</div>
          <div class="sm-map">${mapSvg(viewSys)}</div>
          <div class="sm-right"><h3>Dominacja</h3>${standings()}
            <div class="sm-legend">${stationIcon('dok', 16, PLAYER_COLOR)} twoje pola · ${stanceIcon('wojna', 14)} wojna · przerywana aura = wróg</div></div>
        </div>` : tab === 'dyplomacja' ? diplomacy() : chronicle()}`;
  }

  // mapa (statek się rusza) co 0,5 s, reszta co 4 s - pełne przebudowanie
  // restartowałoby animacje portretów, więc rzadko
  let accFull = 0;
  function update(dt) {
    if (!open) return;
    acc += dt; accFull += dt;
    if (accFull > 4) { accFull = acc = 0; render(); return; }
    if (acc > 0.5 && tab === 'sektor') {
      acc = 0;
      const m = root.querySelector('.sm-map');
      if (m) m.innerHTML = mapSvg(viewSys);
    }
  }
  function setOpen(v) {
    open = v;
    root.classList.toggle('visible', v);
    if (v) { viewSys = currentSystem(); note = ''; render(); }
  }
  return {
    update, setOpen, toggle: () => setOpen(!open), get open() { return open; },
    show(t) { tab = t; setOpen(true); },
  };
}
