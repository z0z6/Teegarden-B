import {
  createGalaxy, galaxyStats, TIERS, STAR_NAMES, RULES, militarization, accessFor, canOperate,
  validCoalition, startCampaign, advance, relation, adjustRelation, readiness, activeCampaignAgainst,
} from '../../shared/data/galaxy.js';

/**
 * Narzędzie deweloperskie: podgląd galaktyki z shared/data/galaxy.js -
 * domeny, rdzenie, stolice, militaryzacja, dostęp dla rasy gracza i
 * symulacja kampanii koalicji (odwrót, przeniesienie, odbudowa).
 */
const seed = Number(new URLSearchParams(location.search).get('seed')) || undefined;
const g = createGalaxy(seed ? { seed } : {});
const raceIds = Object.keys(g.races);

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
let W = 0, H = 0, dpr = 1;
const view = { x: 0, y: 0, scale: 1 };
let selected = null;
let playerRace = 'wybudzeni';

const ACCESS_COLOR = { free: '#8fe3a2', toll: '#ffd98a', patrol: '#ffb38a', escort: '#9fd8ff', closed: '#ff7a7a', front: '#ffc98a' };
const TIER_DOT = { capital: 0, core: 2.6, domain: 1.3, march: 1.1, wild: 0.9 };

// ------------------------------------------------------------
// widok
// ------------------------------------------------------------
function fit() {
  const panelW = window.innerWidth > 700 ? 340 : 0;
  const panelH = window.innerWidth > 700 ? 0 : window.innerHeight * 0.46;
  view.scale = Math.min((W - panelW - 40) / (g.options.radius * 2.1), (H - panelH - 40) / (g.options.radius * 2.1));
  view.x = panelW / 2 / view.scale;
  view.y = -panelH / 2 / view.scale;
}
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  if (!view.fitted) { fit(); view.fitted = true; }
  draw();
}
const toScreen = (s) => [W / 2 + (s.x + view.x) * view.scale, H / 2 + (s.y + view.y) * view.scale];
const toWorld = (px, py) => [(px - W / 2) / view.scale - view.x, (py - H / 2) / view.scale - view.y];

function zoomAt(px, py, f) {
  const [wx, wy] = toWorld(px, py);
  view.scale = Math.min(60, Math.max(0.05, view.scale * f));
  view.x = (px - W / 2) / view.scale - wx;
  view.y = (py - H / 2) / view.scale - wy;
  draw();
}

// ------------------------------------------------------------
// rysowanie
// ------------------------------------------------------------
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Jądro
  const [cx, cy] = toScreen({ x: 0, y: 0 });
  const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, g.options.bulgeRadius * 1.6 * view.scale);
  gr.addColorStop(0, 'rgba(255, 226, 180, 0.22)');
  gr.addColorStop(1, 'rgba(255, 226, 180, 0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);

  // terytorium: miękkie plamy w kolorze rasy
  const blob = Math.max(3, 16 * view.scale);
  ctx.globalAlpha = 0.07;
  for (const s of g.systems) {
    if (!s.owner) continue;
    const [x, y] = toScreen(s);
    if (x < -blob || y < -blob || x > W + blob || y > H + blob) continue;
    ctx.fillStyle = g.races[s.owner].color;
    ctx.beginPath(); ctx.arc(x, y, blob, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // układy
  const zoomDot = Math.min(3, Math.max(0.6, Math.sqrt(view.scale * 2.2)));
  for (const s of g.systems) {
    const [x, y] = toScreen(s);
    if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
    const r = TIER_DOT[s.tier] * zoomDot;
    if (!r) continue;
    ctx.fillStyle = s.owner ? g.races[s.owner].color : (s.tier === 'march' ? '#8aa0b4' : '#5b6878');
    ctx.globalAlpha = s.tier === 'core' ? 1 : s.owner ? 0.75 : 0.55;
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.globalAlpha = 1;

  // kampanie: linie od stolic napastników do stolicy celu
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  for (const c of g.campaigns) {
    if (c.status !== 'active') continue;
    const [tx, ty] = toScreen(g.systems[g.races[c.target].capital]);
    for (const a of c.attackers) {
      const [ax, ay] = toScreen(g.systems[g.races[a].capital]);
      ctx.strokeStyle = g.races[a].color;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // utracone planety macierzyste
  ctx.font = '11px "Segoe UI", sans-serif';
  for (const r of Object.values(g.races)) {
    if (!r.homeworldLost) continue;
    const [x, y] = toScreen(g.systems[r.homeworld]);
    ctx.strokeStyle = r.color; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
    ctx.fillStyle = r.color; ctx.globalAlpha = 0.7;
    ctx.fillText(`${g.systems[r.homeworld].name} (utracona)`, x + 8, y + 4);
    ctx.globalAlpha = 1;
  }

  // stolice
  ctx.font = '600 12px "Segoe UI", sans-serif';
  for (const r of Object.values(g.races)) {
    const [x, y] = toScreen(g.systems[r.capital]);
    ctx.strokeStyle = r.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = r.color;
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillText(r.capitalName, x + 11, y - 3);
    ctx.globalAlpha = 0.7; ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillText(r.name, x + 11, y + 11);
    ctx.globalAlpha = 1; ctx.font = '600 12px "Segoe UI", sans-serif';
  }

  // układy z kroku 8
  ctx.font = '11px "Segoe UI", sans-serif';
  for (const s of g.systems) {
    if (!s.anchor) continue;
    const [x, y] = toScreen(s);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill();
    if (view.scale > 1.2 || s.anchor === 'teegarden') ctx.fillText(s.name, x + 8, y + 4);
  }

  // nazwy sektorów przy dużym przybliżeniu
  if (view.scale > 1.6) {
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(217, 243, 255, 0.45)';
    for (const sec of g.sectors) {
      const [x, y] = toScreen(sec);
      if (x > 0 && y > 0 && x < W && y < H) ctx.fillText(sec.name, x - ctx.measureText(sec.name).width / 2, y);
    }
  }

  // zaznaczenie
  if (selected != null) {
    const [x, y] = toScreen(g.systems[selected]);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
  }
}

// ------------------------------------------------------------
// panel
// ------------------------------------------------------------
function renderSummary() {
  const st = galaxyStats(g);
  $('summary').textContent = `${st.systems.toLocaleString('pl-PL')} układów w ${st.sectors} sektorach, dysk o promieniu ${g.options.radius} lat świetlnych (seed ${g.options.seed}).`;
  const labels = { capital: 'stolice', core: 'układy core\'owe', domain: 'domeny', march: 'pogranicze', wild: 'dzicz' };
  const mil = (tier) => {
    const a = g.systems.filter((s) => s.tier === tier);
    return a.length ? Math.round(a.reduce((s, x) => s + militarization(g, x.id), 0) / a.length) : 0;
  };
  $('tiers').innerHTML = Object.keys(TIERS).map((t) =>
    `<span>${labels[t]}</span><span class="n">militaryzacja ~${mil(t)}</span><span class="n">${st.byTier[t].toLocaleString('pl-PL')}</span>`).join('');
}

function raceStatus(r) {
  const c = g.campaigns.find((x) => x.status === 'active' && (x.target === r.id || x.attackers.includes(r.id)));
  if (c && c.target === r.id) return 'broni rdzenia';
  if (c) return `oblega ${g.races[c.target].name}`;
  if (r.graceUntil > g.cycle) return `okres ochronny: ${r.graceUntil - g.cycle} cykli`;
  if (r.rebuilding) return 'odbudowa';
  return '';
}

function renderRaces() {
  const st = galaxyStats(g);
  $('races').innerHTML = Object.values(g.races).map((r) => {
    const ready = Math.round(readiness(g, r.id) * 100);
    const status = raceStatus(r);
    return `<div class="race">
      <span class="dot" style="background:${r.color}"></span>
      <span>${r.name}</span><span class="n">${ready}%</span>
      <div class="bar"><i style="width:${ready}%;background:${r.color}"></i></div>
      <span class="meta">${r.capitalName} · ${st.byRace[r.id] ?? 0} układów, ${r.domainSectors.length} sektorów${status ? ` · ${status}` : ''}</span>
    </div>`;
  }).join('');
}

function renderSystem() {
  if (selected == null) return;
  const s = g.systems[selected];
  const sec = g.sectors[s.sector];
  const owner = s.owner ? g.races[s.owner] : null;
  const acc = accessFor(g, s.id, playerRace);
  const homeOf = Object.values(g.races).filter((r) => r.homeworld === s.id);
  const lines = [
    `<b>${s.name}</b>${s.anchor ? ' (grywalny w kroku 8)' : ''}`,
    `${STAR_NAMES[s.star]}, ${sec.name}${sec.occupiedFrom ? ` (zajęty od: ${g.races[sec.occupiedFrom].name})` : ''}`,
    `${TIERS[s.tier].name}${owner ? ` — ${owner.name}` : ''}${s.marchOf?.length ? ` (${s.marchOf.map((r) => g.races[r].name).join(', ')})` : ''}`,
    `Militaryzacja: ${militarization(g, s.id)}/100`,
  ];
  for (const r of homeOf) lines.push(`Planeta macierzysta: ${r.name}${r.homeworldLost ? ' (utracona)' : ''}`);
  $('system').innerHTML = lines.join('<br>') +
    `<div class="access" style="border-color:${ACCESS_COLOR[acc.level]}">${acc.text}<br><span style="opacity:.7">Walka w pojedynkę: ${acc.militaryOps ? 'możliwa' : 'niemożliwa'}</span></div>`;
}

function renderCampaignForm() {
  const target = $('target').value;
  const checks = $('attackers');
  const prev = new Set([...checks.querySelectorAll('input:checked')].map((i) => i.value));
  checks.innerHTML = raceIds.filter((r) => r !== target).map((r) =>
    `<label><input type="checkbox" value="${r}" ${prev.has(r) ? 'checked' : ''}><span style="color:${g.races[r].color}">${g.races[r].name}</span></label>`).join('');
  checks.querySelectorAll('input').forEach((i) => i.addEventListener('change', renderVerdict));
  renderVerdict();
}

function renderVerdict() {
  const target = $('target').value;
  const attackers = [...$('attackers').querySelectorAll('input:checked')].map((i) => i.value);
  const active = activeCampaignAgainst(g, target);
  const el = $('verdict');
  if (active) {
    el.className = 'ok';
    el.textContent = `Trwa kampania (${active.cycles} cykli). Gotowość obrońcy: ${Math.round(readiness(g, target) * 100)}%, odwrót przy ${RULES.breakPoint * 100}%.`;
    $('start').disabled = true;
    return;
  }
  const v = validCoalition(g, attackers, target);
  el.className = v.ok ? 'ok' : 'no';
  el.innerHTML = v.ok ? 'Koalicja może ruszyć.' : v.reasons.map((r) => `• ${r}`).join('<br>');
  $('start').disabled = !v.ok;
}

function renderMatrix() {
  const short = (r) => g.races[r].name.slice(0, 3);
  let html = `<tr><th></th>${raceIds.map((r) => `<th style="color:${g.races[r].color}">${short(r)}</th>`).join('')}</tr>`;
  for (const a of raceIds) {
    html += `<tr><th style="color:${g.races[a].color};text-align:left">${short(a)}</th>`;
    for (const b of raceIds) {
      if (a === b) { html += '<td class="self">·</td>'; continue; }
      const v = relation(g, a, b);
      const bg = v >= RULES.partnerMinRelation ? `rgba(143,227,162,${0.12 + v / 200})` : v <= RULES.targetMaxRelation ? `rgba(255,122,122,${0.12 - v / 200})` : 'rgba(159,216,255,0.06)';
      html += `<td data-a="${a}" data-b="${b}" style="background:${bg}" title="${g.races[a].name} ↔ ${g.races[b].name}">${v}</td>`;
    }
    html += '</tr>';
  }
  $('matrix').innerHTML = html;
}

function renderLog() {
  $('log').innerHTML = g.log.slice().reverse().map((e) => `<p class="${e.kind}"><b>c${e.cycle}</b> ${e.text}</p>`).join('') || '<p style="opacity:.55">Nic się jeszcze nie wydarzyło.</p>';
  $('cycle').textContent = `Cykl strategiczny: ${g.cycle}.`;
}

function renderAll() {
  renderSummary(); renderRaces(); renderSystem(); renderVerdict(); renderMatrix(); renderLog(); draw();
}

// ------------------------------------------------------------
// wejście
// ------------------------------------------------------------
for (const r of raceIds) {
  $('player').insertAdjacentHTML('beforeend', `<option value="${r}">${g.races[r].name}</option>`);
  $('target').insertAdjacentHTML('beforeend', `<option value="${r}">${g.races[r].name}</option>`);
}
$('target').value = 'szczepieni';
$('player').addEventListener('change', (e) => { playerRace = e.target.value; renderSystem(); });
$('target').addEventListener('change', renderCampaignForm);
$('start').addEventListener('click', () => {
  const attackers = [...$('attackers').querySelectorAll('input:checked')].map((i) => i.value);
  const res = startCampaign(g, attackers, $('target').value);
  if (res.ok) selected = g.races[$('target').value].capital;
  renderAll();
});
$('step1').addEventListener('click', () => { advance(g, 1); renderAll(); });
$('step10').addEventListener('click', () => { advance(g, 10); renderAll(); });
$('matrix').addEventListener('click', (e) => {
  const td = e.target.closest('td[data-a]');
  if (!td) return;
  adjustRelation(g, td.dataset.a, td.dataset.b, e.shiftKey ? -5 : 5);
  renderMatrix(); renderVerdict(); renderSystem();
});

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('drag'); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  view.x += dx / view.scale; view.y += dy / view.scale;
  drag.x = e.clientX; drag.y = e.clientY;
  draw();
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('drag');
  if (drag && drag.moved < 5) pick(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
$('zin').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.5));
$('zout').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.5));
$('zreset').addEventListener('click', () => { fit(); draw(); });

function pick(px, py) {
  const [wx, wy] = toWorld(px, py);
  let best = null, bd = 12 / view.scale;
  for (const s of g.systems) {
    const d = Math.hypot(s.x - wx, s.y - wy);
    if (d < bd) { bd = d; best = s.id; }
  }
  selected = best;
  if (best == null) $('system').innerHTML = '<span class="empty">Kliknij układ na mapie.</span>';
  renderSystem();
  draw();
}

window.addEventListener('resize', resize);
resize();
renderCampaignForm();
renderAll();
window.__galaxy = g;
window.__ready = true;
