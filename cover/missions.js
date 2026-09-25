import * as THREE from 'three';
import { createSpaceBackground } from '../shared/systems/space-background.js';
import { SYSTEMS, SYSTEM_ORDER } from '../shared/systems/star-systems.js';
import { MISSIONS, MISSION_ORDER } from '../shared/systems/missions.js';
import { DIFFICULTY } from '../shared/systems/tactical-ai.js';
import { SHIPS } from '../shared/ships/fleet.js';
import { RACES, SHIP_RACE, deriveStats } from '../shared/data/races.js';
import { getAudio } from '../shared/audio/audio.js';
import { mountAudioControls } from '../shared/audio/audio-controls.js';
import { racePortrait } from '../shared/data/race-portraits.js';

/**
 * TABLICA MISJI - drugi ekran okładki (intro -> tablica -> gra).
 *
 * Wcześniej tablica była nakładką w grze (N). Wydzielona:
 *  - odprawa ma miejsce na schemat, warunki i wskazówkę, a nie tylko linijkę;
 *  - wybór statku, trudności i watahy dzieje się PRZED startem, więc gra
 *    ładuje od razu właściwy statek zamiast przełączać go w locie;
 *  - gra dostaje wszystko w adresie (?misja=&statek=&trudnosc=&wataha=&uklad=),
 *    więc link do konkretnej misji da się komuś wysłać.
 * Wybory zapamiętuje przeglądarka (localStorage).
 */

const STORE = 'teegarden-b:misje';
const SYSTEM_KEY = 'teegarden-b:uklad';
const FREE = 'wolny';
const CAMPAIGN = 'kampania'; // krok 11: gra główna - gospodarka, ekspansja, dyplomacja, podbój
const ORDER = [CAMPAIGN, ...MISSION_ORDER, FREE];
const CAMPAIGN_DEF = {
  name: 'Dominacja — kampania', desc: 'Gra główna: zbieraj, rozbudowuj, zbrój się i przejmuj przestrzeń surowcową sektora.', threat: 3,
  tags: ['gospodarka', 'ekspansja', 'dyplomacja', 'podbój'], pack: 'optional',
  brief: 'Sześć ras dzieli między siebie 25 pól surowcowych w pięciu układach. Kopiesz, stawiasz magazyny i doki, wypuszczasz roje dronów, sprzedajesz metal i budujesz flotę. Rasy robią to samo — a kto dzieli z kimś układ, ten z nim rywalizuje: żądania, pakty, sojusze i wojny o najbogatsze pola.',
  win: 'Kontroluj połowę wartości wszystkich pól sektora.',
  lose: 'Nie ma przegranej — ale nieobronione kopalnie rasy złupią, a wolne pola zajmą przed tobą.',
  tip: 'Na starcie rasy nie atakują przez 10 minut. Postaw magazyn przy polu macierzystym, potem dok i przeładunek. Sygnały „nieznane złoże” prowadzą do nowych pól; mapa strategiczna to M.',
};
const FREE_DEF = {
  name: 'Wolny lot', desc: 'Bez zadania: układ, sceny demo (7/8/9) i wataha na żądanie (L).', threat: 0, tags: ['swobodnie'], pack: 'optional',
  brief: 'Bez misji i bez presji czasu. Możesz latać po układzie, skakać przez fałdę, uruchamiać sceny demo z kroku 5 i ćwiczyć rozkazy watahy.',
  win: '—', lose: '—', tip: 'N w grze wraca na tę tablicę.',
};
const FREE_DEF_10 = { ...FREE_DEF, name: 'Wolny lot — piaskownica', desc: 'Krok 10: sama gospodarka, bez ras i dyplomacji. Kopalnia, stacje, roje, piraci.',
  brief: 'Piaskownica gospodarki z kroku 10: jedno pole przy starcie, stacje, roje dronów i rabusie, bez rywalizujących ras.', tip: 'Zapis piaskownicy jest osobny od kampanii.' };
const def = (id) => (id === CAMPAIGN ? CAMPAIGN_DEF : id === FREE ? FREE_DEF_10 : MISSIONS[id]);

// ------------------------------------------------------------
// Stan (adres > zapamiętane > domyślne)
// ------------------------------------------------------------
const q = new URLSearchParams(location.search);
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { /* bez zapisu */ }
let savedSystem = null;
try { savedSystem = localStorage.getItem(SYSTEM_KEY); } catch { /* bez zapisu */ }

const state = {
  mission: ORDER.includes(q.get('misja')) ? q.get('misja') : ORDER.includes(saved.mission) ? saved.mission : CAMPAIGN,
  ship: SHIPS.some((s) => s.id === q.get('statek')) ? q.get('statek') : SHIPS.some((s) => s.id === saved.ship) ? saved.ship : SHIPS[0].id,
  diff: DIFFICULTY[q.get('trudnosc')] ? q.get('trudnosc') : DIFFICULTY[saved.diff] ? saved.diff : 'normalna',
  pack: q.has('wataha') ? q.get('wataha') === '1' : !!saved.pack,
  system: SYSTEMS[q.get('uklad')] ? q.get('uklad') : SYSTEMS[savedSystem] ? savedSystem : 'teegarden',
  picks: saved.picks && typeof saved.picks === 'object' ? saved.picks : {}, // ostatni model każdej rasy
};
state.picks[SHIP_RACE[state.ship]] = state.ship;
function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ mission: state.mission, ship: state.ship, diff: state.diff, pack: state.pack, picks: state.picks }));
    localStorage.setItem(SYSTEM_KEY, state.system);
  } catch { /* bez zapisu */ }
}

// ------------------------------------------------------------
// Audio: nastrój "odprawa" (ta sama tonacja co okładka i lot)
// ------------------------------------------------------------
const audio = getAudio();
audio.setMood('briefing');
mountAudioControls(audio, { corner: 'top-right', offset: [16, 16] });

// ------------------------------------------------------------
// Lista misji
// ------------------------------------------------------------
const list = document.getElementById('list');
const threatPips = (n) => `<span class="threat" aria-label="zagrożenie ${n} z 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
ORDER.forEach((id, i) => {
  const d = def(id);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'm' + (id === FREE ? ' free' : '') + (id === CAMPAIGN ? ' campaign' : '');
  b.dataset.id = id;
  b.setAttribute('role', 'option');
  b.innerHTML = `<span class="n">${id === FREE ? '∞' : id === CAMPAIGN ? '♛' : i}</span><b></b>${id === FREE || id === CAMPAIGN ? '<span></span>' : threatPips(d.threat)}<small></small>`;
  b.querySelector('b').textContent = d.name;
  b.querySelector('small').textContent = d.desc;
  b.addEventListener('click', () => select(id));
  b.addEventListener('pointerenter', () => audio.play('ui-hover'));
  b.addEventListener('dblclick', start);
  list.appendChild(b);
});

// ------------------------------------------------------------
// Ustawienia: statek, trudność, wataha, układ
// ------------------------------------------------------------
// Statek = rasa załogi. Najpierw rasa (kafelek z portretem), pod spodem
// modele tej rasy (miniatury 3D). Statystyki zależą tylko od rasy, więc
// pokazujemy je raz, w nagłówku modeli. Rasy bez żadnego statku nie mają
// kafelka - pojawią się same, gdy build-ships doda ich pierwszy model.
const racesEl = document.getElementById('races');
const hullsEl = document.getElementById('hulls');
const raceOf = (shipId) => SHIP_RACE[shipId];
const shipsOf = (raceId) => SHIPS.filter((s) => raceOf(s.id) === raceId);
const RACE_IDS = Object.keys(RACES).filter((r) => shipsOf(r).length);
// "Goniec — Kwartał Spisowy" -> kadłub "Goniec", wariant "Kwartał Spisowy"
function splitName(name) {
  const i = name.indexOf(' — ');
  return i < 0 ? { hull: name, variant: name } : { hull: name.slice(0, i), variant: name.slice(i + 3) };
}
const modelsWord = (n) => (n === 1 ? 'model' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'modele' : 'modeli');

for (const r of RACE_IDS) {
  const race = RACES[r];
  const n = shipsOf(r).length;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'race';
  b.dataset.race = r;
  b.style.setProperty('--c', race.color);
  b.innerHTML = `<span class="pic">${racePortrait(r, { seed: 3, faction: 'trade', size: 52 })}</span><b></b><small></small>`;
  b.querySelector('b').textContent = race.name;
  b.querySelector('small').textContent = `${n} ${modelsWord(n)}`;
  b.title = `${race.name}: wybierz, żeby zobaczyć ${n === 1 ? 'statek' : 'statki'} tej rasy`;
  b.addEventListener('click', () => pickRace(r));
  b.addEventListener('pointerenter', () => audio.play('ui-hover'));
  racesEl.appendChild(b);
}

function pickRace(r) {
  if (raceOf(state.ship) === r) return;
  const remembered = state.picks[r];
  state.ship = shipsOf(r).some((s) => s.id === remembered) ? remembered : shipsOf(r)[0].id;
  audio.play('ui-click');
  render();
}

let shownRace = null;
// Miniatura = gotowy PNG z build-ships (models/thumbs/<id>.png). Ścieżki we
// fleet.js są względne do stron o katalog głębiej, tablica leży w korzeniu.
const thumbUrl = (s) => s.file.replace(/^\.\.\//, './').replace(/\/models\/([^/]+)-lod0\.glb$/, '/models/thumbs/$1.png');
function renderHulls(r) {
  shownRace = r;
  const race = RACES[r];
  const st = deriveStats(r);
  hullsEl.style.setProperty('--c', race.color);
  hullsEl.replaceChildren();
  const head = document.createElement('p');
  head.className = 'race-stats';
  head.textContent = `${race.name} · kadłub ${st.hull} · pancerz ${st.armor} · czujniki ${st.attrs.sensors}`;
  hullsEl.appendChild(head);
  // grupy po kadłubie (rasa może mieć np. przechwytywacz i niszczyciel)
  const groups = new Map();
  for (const s of shipsOf(r)) {
    const { hull } = splitName(s.name);
    if (!groups.has(hull)) groups.set(hull, []);
    groups.get(hull).push(s);
  }
  for (const [hull, list] of groups) {
    const h = document.createElement('h4');
    h.textContent = hull;
    const grid = document.createElement('div');
    grid.className = 'models';
    for (const s of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'model';
      b.dataset.id = s.id;
      b.title = s.name;
      b.innerHTML = '<span class="thumb"><img alt="" decoding="async" /></span><span class="v"></span>';
      b.querySelector('.v').textContent = splitName(s.name).variant;
      b.addEventListener('click', () => { state.ship = s.id; state.picks[r] = s.id; audio.play('ui-click'); render(); });
      b.addEventListener('pointerenter', () => audio.play('ui-hover'));
      const img = b.querySelector('img');
      img.addEventListener('load', () => img.classList.add('ok'), { once: true });
      img.addEventListener('error', () => b.querySelector('.thumb').classList.add('none'), { once: true }); // brak miniatury: kropka w kolorze rasy
      img.src = thumbUrl(s);
      grid.appendChild(b);
    }
    hullsEl.append(h, grid);
  }
}

const diffEl = document.getElementById('diff');
const DIFF_NOTE = { latwa: '1 naraz', normalna: '2 naraz', trudna: '3 naraz' };
for (const k of Object.keys(DIFFICULTY)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'opt';
  b.dataset.id = k;
  b.innerHTML = `<b>${DIFFICULTY[k].name}</b><span>${DIFF_NOTE[k] ?? ''}</span>`;
  b.title = 'Ilu wrogów naraz naciera na ciebie, czas reakcji, skuteczność uników';
  b.addEventListener('click', () => { state.diff = k; audio.play('ui-click'); render(); });
  diffEl.appendChild(b);
}

const packEl = document.getElementById('pack');
const packBtn = document.createElement('button');
packBtn.type = 'button';
packBtn.className = 'opt';
packBtn.style.setProperty('--c', '#4dd6a0');
packBtn.innerHTML = '<i></i><b></b><span></span>';
packBtn.addEventListener('click', () => {
  if (def(state.mission).pack === 'auto') return;
  state.pack = !state.pack;
  audio.play('ui-click');
  render();
});
packEl.appendChild(packBtn);

const sysEl = document.getElementById('system');
for (const id of SYSTEM_ORDER) {
  const o = document.createElement('option');
  o.value = id; o.textContent = SYSTEMS[id].name;
  sysEl.appendChild(o);
}
sysEl.addEventListener('change', () => { state.system = sysEl.value; background?.reseed?.(SYSTEMS[state.system].skySeed); render(); });

// ------------------------------------------------------------
// Szczegóły misji + schemat
// ------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function select(id) {
  if (id === state.mission) return;
  state.mission = id;
  audio.play('ui-click');
  render();
}

function render() {
  const d = def(state.mission);
  for (const b of list.children) b.setAttribute('aria-selected', String(b.dataset.id === state.mission));
  $('d-name').textContent = d.name;
  $('d-tags').innerHTML = (d.tags ?? []).map((t) => `<span>${t}</span>`).join('');
  $('d-schema').innerHTML = SCHEMA[state.mission] ?? '';
  $('d-schema').setAttribute('aria-label', `Schemat taktyczny: ${d.name}`);
  $('d-brief').textContent = d.brief ?? d.desc;
  $('d-win').textContent = d.win ?? '';
  $('d-lose').textContent = d.lose ?? '';
  $('d-tip').textContent = d.tip ?? '';
  const shipRace = raceOf(state.ship);
  for (const b of racesEl.children) b.setAttribute('aria-pressed', String(b.dataset.race === shipRace));
  if (shownRace !== shipRace) renderHulls(shipRace);
  for (const b of hullsEl.querySelectorAll('.model')) b.setAttribute('aria-pressed', String(b.dataset.id === state.ship));
  for (const b of diffEl.children) b.setAttribute('aria-pressed', String(b.dataset.id === state.diff));
  const auto = d.pack === 'auto';
  const packOn = auto || state.pack;
  packBtn.setAttribute('aria-pressed', String(packOn));
  packBtn.disabled = auto;
  packBtn.querySelector('b').innerHTML = `${packOn ? 'Leci z tobą' : 'Bez watahy'} <kbd>W</kbd>`;
  packBtn.querySelector('span').textContent = auto
    ? 'Ta misja jest dla watahy — trzech skrzydłowych startuje zawsze.'
    : `Trzech skrzydłowych rasy ${RACES[SHIP_RACE[state.ship]].name}. W grze: L, rozkazy G/H/V/B.`;
  sysEl.value = state.system;
  $('start').firstChild.textContent = state.mission === CAMPAIGN ? 'Graj ' : state.mission === FREE ? 'Leć ' : 'Start misji ';
  persist();
}

function gameUrl() {
  const p = new URLSearchParams({ uklad: state.system, trudnosc: state.diff, statek: state.ship });
  if (state.mission !== FREE && state.mission !== CAMPAIGN) p.set('misja', state.mission);
  if (state.pack || def(state.mission).pack === 'auto') p.set('wataha', '1');
  // kampania i misje: krok 11 (najnowszy); wolny lot: piaskownica gospodarki z kroku 10
  return state.mission === FREE ? `./step10-economy/?${p}` : `./step11-dominacja/?${p}`;
}

let leaving = false;
async function go(url, sound) {
  if (leaving) return;
  leaving = true;
  audio.play(sound, { force: true });
  await audio.fadeOut(0.45); // muzyka nie urywa się w pół taktu
  location.href = url;
}
function start() { go(gameUrl(), 'ui-confirm'); }
$('start').addEventListener('click', start);
$('back').addEventListener('click', (e) => { e.preventDefault(); go(`./index.html`, 'ui-back'); });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.altKey || e.ctrlKey || e.metaKey) return;
  const i = ORDER.indexOf(state.mission);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    select(ORDER[(i + (e.key === 'ArrowDown' ? 1 : ORDER.length - 1)) % ORDER.length]);
    list.querySelector(`[data-id="${state.mission}"]`)?.focus({ preventScroll: false });
  } else if (e.key === 'Enter') {
    if (e.target.closest?.('.opt, .start, .au, a')) return; // tam Enter robi swoje (klik)
    e.preventDefault(); start();
  } else if (e.key === 'Escape') {
    go('./index.html', 'ui-back');
  } else if (e.key === 't' || e.key === 'T') {
    const ks = Object.keys(DIFFICULTY);
    state.diff = ks[(ks.indexOf(state.diff) + 1) % ks.length]; audio.play('ui-click'); render();
  } else if (e.key === 'w' || e.key === 'W') {
    packBtn.click();
  }
});
// powrót przyciskiem "wstecz" z gry: strona może przyjść z pamięci podręcznej już wyciszona
window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

// ------------------------------------------------------------
// Schematy taktyczne (SVG 400×200). Kolory: gracz niebieski, wróg
// czerwony, wataha/sojusznik zielony, cel/handlowiec złoty.
// ------------------------------------------------------------
const ship = (x, y, rot, cls, s = 1) => `<path class="${cls}" transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" d="M8 0 L-6 -5 L-3 0 L-6 5 Z" stroke-width="0.5"/>`;
const foe = (x, y, s = 1, extra = '') => `<path class="h ${extra}" transform="translate(${x} ${y}) scale(${s})" d="M0 -5 L5 0 L0 5 L-5 0 Z"/>`;
const gold = (x, y, s = 1, extra = '') => `<path class="t ${extra}" transform="translate(${x} ${y}) scale(${s})" d="M0 -6 L6 0 L0 6 L-6 0 Z"/>`;
const ring = (x, y, r, cls) => `<circle class="ring ${cls}" cx="${x}" cy="${y}" r="${r}" fill="none"/>`;
const path = (d, cls) => `<path class="path ${cls}" d="${d}" fill="none"/>`;
const label = (x, y, t, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}">${t}</text>`;

const SCHEMA = {
  capture:
    ring(262, 100, 90, 'h') + label(262, 18, 'kurier ładuje fałdę, gdy jesteś > 1600 j.', 'middle') +
    ring(262, 100, 30, 't') + label(262, 145, 'abordaż < 320 j., 5 s', 'middle') +
    path('M60 150 Q 150 150 238 108', 'p') + ship(56, 150, 0, 'p', 1.3) + label(40, 172, 'ty') +
    `<g class="drift">${gold(262, 100, 1.3, 'pulse')}${foe(232, 70)}${foe(292, 124)}</g>` +
    label(304, 96, 'kurier: unieruchom < 35%'),
  blockade:
    ring(250, 100, 88, 'h') + ring(250, 100, 50, 'h') + label(250, 196, 'zagłuszanie fałdy · spowolnienie', 'middle') +
    [28, 62, 138, 172].map((y) => foe(250, y)).join('') + foe(250, 100, 1.7, 'pulse') +
    foe(170, 46, 0.9) + foe(176, 156, 0.9) + label(170, 34, 'pikiety', 'middle') +
    `<line class="t" x1="375" y1="20" x2="375" y2="180" stroke-width="2" stroke-dasharray="4 4"/>` + label(368, 16, 'brama', 'end') +
    path('M40 100 L 370 100', 'h') + label(95, 94, 'boost: wykryją cię') +
    path('M40 110 C 120 230, 330 230, 370 130', 'a') + label(120, 196, 'łuk po cichu: wyższa nagroda') +
    ship(36, 105, 0, 'p', 1.3),
  waves:
    ring(200, 105, 26, 'p') + ship(200, 105, -30, 'p', 1.5) +
    path('M40 30 L 176 92', 'h') + foe(40, 30) + foe(28, 44) + foe(54, 20) + label(40, 62, 'fala 1 · 3', 'middle') +
    path('M372 50 L 226 96', 'h') + foe(372, 50) + foe(360, 36) + foe(384, 66) + label(372, 84, 'fala 2 · 3', 'middle') +
    path('M200 196 L 200 132', 'h') + foe(186, 190) + foe(200, 184) + foe(214, 190) + foe(200, 170) + label(234, 186, 'fala 3 · 4') +
    label(200, 18, 'zniszcz albo przegoń: wycofany też się liczy', 'middle'),
  escort:
    path('M30 170 L 140 130 L 250 90 L 360 42', 't') + ring(365, 40, 16, 't') + label(360, 18, 'punkt skoku', 'middle') +
    gold(150, 126, 1.5, 'pulse') + ship(164, 144, -20, 'p', 1.3) + label(150, 162, 'karawana + ty', 'middle') +
    path('M270 170 L 168 132', 'h') + foe(276, 172) + foe(290, 160) + label(292, 186, 'napad 2') +
    path('M80 40 L 142 116', 'h') + foe(76, 36) + foe(62, 48) + label(40, 24, 'napad 1'),
  ambush:
    ring(250, 100, 95, 'h') + label(150, 30, 'zagłuszacz „Sidło”', 'end') +
    gold(250, 100, 1.3, 'pulse') + label(262, 104, 'SOS') +
    `<g class="ghost">${[[190, 50], [320, 55], [335, 145], [205, 160], [275, 185]].map(([x, y]) => foe(x, y, 1.2)).join('')}</g>` +
    label(330, 188, 'ukryci: 5') +
    path('M44 100 L 225 100', 'p') + ship(40, 100, 0, 'p', 1.3) + label(40, 124, 'czujniki mogą ich wykryć', 'start'),
  pursuit:
    ring(120, 110, 70, 'h') + label(120, 196, '„Sieć”: zagłuszanie', 'middle') +
    `<g class="drift">${foe(110, 92)}${foe(96, 124)}${foe(138, 134)}</g>` + label(60, 70, 'łowcy (sprint)') +
    path('M150 112 L 250 112', 'h') + ship(262, 112, 0, 'p', 1.5) + path('M276 112 L 330 112', 'p') +
    `<g class="ghost">${foe(360, 60)}${foe(372, 160)}</g>` + label(366, 188, 'posiłki co 45 s', 'end') +
    label(262, 90, 'zgub ich > 7500 j.', 'middle'),
  wolfhunt:
    ship(70, 140, -20, 'p', 1.4) + ship(52, 124, -20, 'a') + ship(52, 158, -20, 'a') + ship(34, 140, -20, 'a') + label(24, 182, 'wataha') +
    path('M70 124 C 120 30, 200 30, 238 76', 'a') + path('M70 156 C 150 200, 250 170, 256 108', 'a') + label(130, 40, 'kleszcze (H)') +
    gold(248, 92, 1.7, 'pulse') + foe(226, 72) + foe(276, 80) + foe(250, 124) + label(248, 150, 'frachtowiec + 3 eskorty', 'middle') +
    path('M262 84 L 362 36', 't') + ring(366, 34, 14, 't') + label(360, 64, 'nie może skoczyć', 'end'),
  [CAMPAIGN]: (() => {
    const hex = (x, y, r, c, o = 1) => `<polygon points="${[0, 1, 2, 3, 4, 5].map((k) => { const a = Math.PI / 6 + k * Math.PI / 3; return `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`; }).join(' ')}" fill="${c}" fill-opacity="${0.18 * o}" stroke="${c}" stroke-opacity="${0.9 * o}" stroke-width="1.4"/>`;
    const F = [[70, 60, '#ffd36b'], [118, 100, '#ffd36b'], [176, 58, '#7fd1ff'], [230, 104, '#7fd1ff'], [286, 56, '#ff9d5c'], [336, 110, '#c39bff'], [150, 158, '#9fb3c6'], [262, 164, '#7ee08a']];
    return `<circle class="t" cx="200" cy="-40" r="70" opacity="0.25"/>` + F.map(([x, y, c], i) => hex(x, y, 20 + (i % 3) * 3, c)).join('') +
      path('M118 100 C 160 120, 200 130, 230 104', 'h') + label(176, 128, 'spór o pole', 'middle') +
      ship(96, 132, -30, 'p', 1.4) + label(24, 124, 'ty: kopalnie i flota') + label(336, 146, 'rasy', 'middle') + label(150, 192, 'wolne złoże', 'middle');
  })(),
  [FREE]:
    `<circle class="t" cx="200" cy="100" r="16" opacity="0.9"/>` + ring(200, 100, 44, 'p') + ring(200, 100, 78, 'p') +
    `<circle class="p" cx="244" cy="100" r="4"/><circle class="p" cx="152" cy="140" r="5"/>` +
    ship(300, 60, 30, 'p', 1.3) + label(200, 196, 'układ jest twój', 'middle'),
};

render();

// ------------------------------------------------------------
// Tło: niebo wybranego układu, bardzo wolny obrót. Bez WebGL - gradient z CSS.
// ------------------------------------------------------------
let background = null;
try {
  const sky = document.getElementById('sky');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.setSize(innerWidth, innerHeight);
  sky.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 1e6);
  background = createSpaceBackground(renderer, scene, { seed: SYSTEMS[state.system].skySeed ?? 7, cubeSize: 512 });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0, prev = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    t += dt * (reduce ? 0.2 : 1);
    camera.rotation.set(Math.sin(t * 0.02) * 0.08, t * 0.012, 0);
    background.update(camera);
    renderer.render(scene, camera);
    if (!sky.classList.contains('live')) sky.classList.add('live');
  });
} catch (err) {
  console.warn('Tablica misji: brak WebGL, zostaje tło z CSS.', err);
}

// testy automatyczne
window.__missions = { state, gameUrl, select, render };
