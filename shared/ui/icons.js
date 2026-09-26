/**
 * IKONY (krok 11): metale, stacje, okręty, drony, dyplomacja - SVG z kodu,
 * bez plików graficznych (tak jak portrety ras i cała grafika gry).
 *
 * Każda funkcja zwraca napis <svg>...</svg> (do innerHTML). Gradienty mają
 * unikalne id, więc wiele kopii tej samej ikony na stronie się nie gryzie.
 * Styl: lekko "szklane" bryły z odblaskiem i poświatą w kolorze - ten sam
 * język co HUD (szkło, gradienty, akcenty).
 */

let uid = 0;
const nid = (p) => `${p}${++uid}`;
const wrap = (size, body, cls = '') => `<svg class="ico ${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;

// ------------------------------------------------------------
// METALE
// ------------------------------------------------------------
const METAL_STYLE = {
  zelazo:  { a: '#eef2f6', b: '#7d8894', c: '#3d454e' },
  nikiel:  { a: '#c9fff0', b: '#46c49c', c: '#1b5b49' },
  kobalt:  { a: '#d6e2ff', b: '#5a7dff', c: '#1d2d78' },
  platyna: { a: '#fff6d6', b: '#f2c14e', c: '#8a5a12' },
};
export function metalIcon(m, size = 18) {
  const s = METAL_STYLE[m] ?? METAL_STYLE.zelazo;
  const g = nid('mg');
  const defs = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.a}"/><stop offset=".55" stop-color="${s.b}"/><stop offset="1" stop-color="${s.c}"/></linearGradient></defs>`;
  let body;
  if (m === 'zelazo') { // sztabka
    body = `<path d="M5 20 L11 12 H27 L21 20 Z" fill="url(#${g})"/><path d="M5 20 H21 V24 H5 Z" fill="${s.c}"/><path d="M21 20 L27 12 V16 L21 24 Z" fill="${s.b}"/><path d="M8 18 L12 13 H18" stroke="#fff" stroke-opacity=".55" stroke-width="1.1" fill="none"/>`;
  } else if (m === 'nikiel') { // skupisko kryształów
    body = `<path d="M9 26 L6 14 L10 7 L14 14 L12 26 Z" fill="url(#${g})"/><path d="M14 27 L13 11 L18 3 L23 11 L20 27 Z" fill="url(#${g})"/><path d="M21 27 L22 16 L26 11 L28 18 L25 27 Z" fill="url(#${g})"/><path d="M18 3 L16.5 12" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>`;
  } else if (m === 'kobalt') { // heksagonalny kryształ
    body = `<path d="M16 3 L26 9 V21 L16 29 L6 21 V9 Z" fill="url(#${g})"/><path d="M16 3 L16 29 M6 9 L26 21 M26 9 L6 21" stroke="#fff" stroke-opacity=".22" stroke-width=".9"/><path d="M16 3 L26 9 L16 15 L6 9 Z" fill="#fff" fill-opacity=".25"/>`;
  } else { // samorodek platyny z błyskiem
    body = `<path d="M6 20 C5 13 11 8 17 9 C24 9 28 14 26 20 C25 25 18 27 13 26 C9 26 7 24 6 20 Z" fill="url(#${g})"/><path d="M11 13 C13 11 16 11 18 12" stroke="#fff" stroke-opacity=".7" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M24 4 L25 7 L28 8 L25 9 L24 12 L23 9 L20 8 L23 7 Z" fill="#fff"/>`;
  }
  return wrap(size, defs + body, `ico-metal ico-${m}`);
}

// ------------------------------------------------------------
// STACJE (sylwetki w kolorze akcentu)
// ------------------------------------------------------------
export function stationIcon(type, size = 20, color = '#9fd8ff') {
  const g = nid('sg');
  const defs = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8eef5"/><stop offset="1" stop-color="#7c8896"/></linearGradient></defs>`;
  const hull = `url(#${g})`;
  const shapes = {
    magazyn: `<rect x="4" y="14" width="24" height="4" rx="1" fill="#566270"/><rect x="5" y="7" width="6" height="18" rx="3" fill="${hull}"/><rect x="13" y="7" width="6" height="18" rx="3" fill="${hull}"/><rect x="21" y="7" width="6" height="18" rx="3" fill="${hull}"/><path d="M5 12 H27" stroke="${color}" stroke-width="1.6"/>`,
    przeladunek: `<rect x="2" y="14" width="28" height="3" fill="#566270"/><rect x="4" y="9" width="6" height="5" fill="#b3462c"/><rect x="11" y="9" width="6" height="5" fill="#2a8f86"/><rect x="18" y="9" width="6" height="5" fill="#d9a93a"/><rect x="7" y="17" width="6" height="5" fill="#39639e"/><rect x="15" y="17" width="6" height="5" fill="#d6dde3"/><circle cx="27" cy="16" r="4.5" fill="none" stroke="${color}" stroke-width="1.6"/>`,
    dok: `<ellipse cx="16" cy="15" rx="13" ry="5" fill="none" stroke="${hull}" stroke-width="2.6"/><rect x="13" y="4" width="6" height="22" rx="2.5" fill="${hull}"/><ellipse cx="16" cy="26" rx="6" ry="2" fill="${color}"/><circle cx="16" cy="3.5" r="1.4" fill="#ff5a4d"/>`,
    wieza: `<path d="M7 26 L10 19 H22 L25 26 Z" fill="#566270"/><rect x="13" y="13" width="6" height="7" fill="${hull}"/><circle cx="16" cy="12" r="5" fill="${hull}"/><rect x="18" y="8.5" width="11" height="2" rx="1" fill="${hull}"/><rect x="18" y="12" width="11" height="2" rx="1" fill="${hull}"/><path d="M7 26 H25" stroke="${color}" stroke-width="1.6"/>`,
    stocznia: `<rect x="3" y="8" width="2.5" height="18" fill="#566270"/><rect x="26.5" y="8" width="2.5" height="18" fill="#566270"/><rect x="3" y="7" width="26" height="2.5" fill="#566270"/><path d="M9 22 C9 15 13 12 16 11 C19 12 23 15 23 22 Z" fill="none" stroke="${hull}" stroke-width="2"/><path d="M16 11 V22 M11 17 H21" stroke="${hull}" stroke-width="1.2"/><circle cx="16" cy="7" r="1.6" fill="${color}"/>`,
    siedziba: `<ellipse cx="16" cy="20" rx="14" ry="4.5" fill="none" stroke="${hull}" stroke-width="2.4"/><rect x="11" y="6" width="10" height="16" rx="2" fill="${hull}"/><rect x="12" y="9" width="8" height="2" fill="${color}"/><rect x="14" y="22" width="4" height="6" fill="#566270"/><circle cx="16" cy="4" r="1.4" fill="#ff5a4d"/><path d="M3 20 H29" stroke="${color}" stroke-width="1" opacity=".6"/>`,
    huta: `<path d="M9 27 L10 11 H22 L23 27 Z" fill="${hull}"/><path d="M8 11 L12 5 H20 L24 11 Z" fill="#566270"/><path d="M11 16 H21 M10.6 20 H21.4 M10.3 24 H21.7" stroke="#ff8a3a" stroke-width="1.6"/><rect x="24" y="4" width="3" height="12" fill="#566270"/><circle cx="25.5" cy="3" r="1.6" fill="#ff8a3a" opacity=".8"/>`,
    reaktor: `<circle cx="16" cy="16" r="5.5" fill="#9ff6ff"/><circle cx="16" cy="16" r="8.5" fill="${color}" opacity=".25"/><ellipse cx="16" cy="16" rx="13" ry="4.5" fill="none" stroke="${hull}" stroke-width="1.8"/><ellipse cx="16" cy="16" rx="4.5" ry="13" fill="none" stroke="${hull}" stroke-width="1.8" transform="rotate(35 16 16)"/>`,
  };
  return wrap(size, defs + (shapes[type] ?? shapes.dok), `ico-station ico-${type}`);
}

// ------------------------------------------------------------
// OKRĘTY I DRONY
// ------------------------------------------------------------
export function warshipIcon(cls, size = 20, color = '#9fd8ff') {
  const g = nid('wg');
  const defs = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7c8896"/><stop offset=".5" stop-color="#eef3f8"/><stop offset="1" stop-color="#7c8896"/></linearGradient></defs>`;
  const f = `url(#${g})`;
  const shapes = {
    eskorta: `<path d="M16 4 L22 24 L16 20 L10 24 Z" fill="${f}"/><path d="M16 20 L16 27" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`,
    fregata: `<path d="M16 3 L21 12 L27 22 L19 21 L16 27 L13 21 L5 22 L11 12 Z" fill="${f}"/><circle cx="16" cy="13" r="2" fill="${color}"/><path d="M12 26 L12 29 M20 26 L20 29" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
    krazownik: `<path d="M16 2 L20 8 L20 14 L28 20 L28 24 L20 23 L18 28 H14 L12 23 L4 24 L4 20 L12 14 L12 8 Z" fill="${f}"/><rect x="14.5" y="9" width="3" height="7" rx="1" fill="${color}"/><path d="M10 27 V30 M16 29 V31 M22 27 V30" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`,
  };
  return wrap(size, defs + (shapes[cls] ?? shapes.eskorta), `ico-ship ico-${cls}`);
}
export function droneIcon(size = 18, color = '#ffb13d') {
  return wrap(size, `<path d="M16 6 L24 16 L16 26 L8 16 Z" fill="#dfe6ee"/><path d="M8 16 H24" stroke="#566270" stroke-width="1.2"/><circle cx="16" cy="28" r="2.4" fill="${color}"/><circle cx="16" cy="28" r="4.5" fill="${color}" opacity=".3"/>`, 'ico-drone');
}

// ------------------------------------------------------------
// KREDYTY, POLA, EKSPLORACJA, DYPLOMACJA
// ------------------------------------------------------------
export function creditsIcon(size = 18) {
  const g = nid('cg');
  return wrap(size, `<defs><radialGradient id="${g}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff6cf"/><stop offset=".55" stop-color="#ffd36b"/><stop offset="1" stop-color="#a0701a"/></radialGradient></defs><circle cx="16" cy="16" r="12" fill="url(#${g})"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="#8a5a12" stroke-width="1.3" opacity=".7"/><path d="M13 10 V22 M13 16 L19 10 M14.5 15 L19.5 22" stroke="#6b430b" stroke-width="2" stroke-linecap="round" fill="none"/>`, 'ico-credits');
}
export function fieldIcon(size = 18, color = '#ffd9a0') {
  return wrap(size, `<path d="M16 3 L27 9.5 V22.5 L16 29 L5 22.5 V9.5 Z" fill="none" stroke="${color}" stroke-width="1.6"/><circle cx="12" cy="14" r="3.2" fill="${color}" opacity=".85"/><circle cx="20" cy="18" r="2.3" fill="${color}" opacity=".6"/><circle cx="15" cy="21" r="1.6" fill="${color}" opacity=".5"/>`, 'ico-field');
}
export function scanIcon(size = 18, color = '#9fd8ff') {
  return wrap(size, `<circle cx="16" cy="16" r="12" fill="none" stroke="${color}" stroke-opacity=".35"/><circle cx="16" cy="16" r="7" fill="none" stroke="${color}" stroke-opacity=".55"/><path d="M16 16 L26 10" stroke="${color}" stroke-width="2" stroke-linecap="round"/><circle cx="22" cy="20" r="1.8" fill="${color}"/>`, 'ico-scan');
}
export function stanceIcon(stance, size = 18) {
  const shapes = {
    wojna: `<path d="M6 6 L22 22 M26 6 L10 22" stroke="#ff5a4d" stroke-width="2.6" stroke-linecap="round"/><path d="M19 25 L25 19 M7 19 L13 25" stroke="#ffb0a6" stroke-width="2.2" stroke-linecap="round"/>`,
    pokoj: `<circle cx="16" cy="16" r="11" fill="none" stroke="#9fb3c6" stroke-width="1.6"/><path d="M16 5 V27 M16 16 L8.5 23.5 M16 16 L23.5 23.5" stroke="#9fb3c6" stroke-width="1.6"/>`,
    pakt: `<circle cx="12" cy="16" r="7" fill="none" stroke="#6fd6b4" stroke-width="2.2"/><circle cx="20" cy="16" r="7" fill="none" stroke="#6fd6b4" stroke-width="2.2"/>`,
    sojusz: `<path d="M16 3 L27 7 V15 C27 22 22 27 16 29 C10 27 5 22 5 15 V7 Z" fill="#4dd6a0" fill-opacity=".2" stroke="#4dd6a0" stroke-width="2"/><path d="M11 16 L15 20 L22 11" stroke="#4dd6a0" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  };
  return wrap(size, shapes[stance] ?? shapes.pokoj, `ico-stance ico-${stance}`);
}
export const STANCE_LABEL = { wojna: 'wojna', pokoj: 'pokój', pakt: 'pakt o nieagresji', sojusz: 'sojusz' };

// ------------------------------------------------------------
// KROK 12: DOWÓDZTWO - typy dronów, energia, nauka, urobek
// ------------------------------------------------------------
export function droneTypeIcon(type, size = 22, color = '#9fd8ff') {
  const g = nid('dg');
  const defs = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f8fb"/><stop offset="1" stop-color="#7c8896"/></linearGradient></defs>`;
  const f = `url(#${g})`;
  const shapes = {
    zwiadowca: `<path d="M16 3 L21 17 L16 14 L11 17 Z" fill="${f}"/><circle cx="16" cy="23" r="6" fill="none" stroke="${color}" stroke-opacity=".5"/><circle cx="16" cy="23" r="2.4" fill="${color}"/><path d="M16 17 L16 20" stroke="${color}" stroke-width="1.4"/>`,
    gornik: `<path d="M16 5 L24 13 L16 21 L8 13 Z" fill="${f}"/><path d="M16 21 L16 28" stroke="#566270" stroke-width="3"/><path d="M13 28 L16 31 L19 28" fill="${color}"/><circle cx="16" cy="13" r="2.2" fill="${color}"/>`,
    holownik: `<rect x="6" y="9" width="20" height="13" rx="3" fill="${f}"/><rect x="9" y="12" width="14" height="7" rx="1.5" fill="#566270"/><path d="M11 15.5 H21" stroke="${color}" stroke-width="2"/><circle cx="9" cy="25" r="2.2" fill="${color}"/><circle cx="23" cy="25" r="2.2" fill="${color}"/>`,
    straznik: `<path d="M16 3 L26 10 L22 26 H10 L6 10 Z" fill="${f}"/><path d="M16 8 V20" stroke="#566270" stroke-width="3"/><circle cx="16" cy="8" r="2.4" fill="${color}"/><path d="M10 26 L8 30 M22 26 L24 30" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>`,
  };
  return wrap(size, defs + (shapes[type] ?? shapes.gornik), `ico-dtype ico-${type}`);
}
export function powerIcon(size = 18, color = '#6ff0ff') {
  return wrap(size, `<path d="M18 2 L7 18 H15 L13 30 L25 12 H17 Z" fill="${color}"/><path d="M18 2 L7 18 H15" fill="#fff" fill-opacity=".35"/>`, 'ico-power');
}
export function oreIcon(size = 18) {
  return wrap(size, `<path d="M4 24 L9 14 L15 16 L20 9 L28 15 L27 25 L16 28 Z" fill="#6c6358"/><path d="M9 14 L15 16 L13 23 L4 24 Z" fill="#8a7d6c"/><circle cx="19" cy="18" r="2" fill="#ffb13d"/><circle cx="23" cy="22" r="1.4" fill="#c3ccd6"/><circle cx="12" cy="20" r="1.2" fill="#6fd6b4"/>`, 'ico-ore');
}
export function scienceIcon(size = 18, color = '#c39bff') {
  return wrap(size, `<path d="M12 3 H20 M13 3 V12 L6 25 C5 27 6 29 8 29 H24 C26 29 27 27 26 25 L19 12 V3" fill="none" stroke="#dfe6ee" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 21 H23 L25.5 26 C26 27.5 25 28 24 28 H8 C7 28 6 27.5 6.5 26 Z" fill="${color}"/><circle cx="14" cy="17" r="1.5" fill="${color}"/><circle cx="18" cy="14" r="1" fill="${color}"/>`, 'ico-science');
}
export function upgradeIcon(size = 18, color = '#ffd36b') {
  return wrap(size, `<path d="M16 3 L27 14 H20 V29 H12 V14 H5 Z" fill="${color}" fill-opacity=".9"/><path d="M16 3 L27 14 H20" fill="#fff" fill-opacity=".3"/>`, 'ico-upgrade');
}
export function pilotIcon(size = 18, color = '#ff7a45') {
  return wrap(size, `<path d="M16 3 L20 13 L29 18 L20 20 L16 29 L12 20 L3 18 L12 13 Z" fill="#e8eef5"/><circle cx="16" cy="16" r="3" fill="${color}"/>`, 'ico-pilot');
}
export function eyeIcon(size = 18, color = '#9fd8ff') {
  return wrap(size, `<path d="M3 16 C8 8 24 8 29 16 C24 24 8 24 3 16 Z" fill="none" stroke="${color}" stroke-width="2"/><circle cx="16" cy="16" r="4.5" fill="${color}"/><circle cx="17.5" cy="14.5" r="1.4" fill="#fff"/>`, 'ico-eye');
}
