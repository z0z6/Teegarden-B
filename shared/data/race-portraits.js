/**
 * WIZERUNKI RAS - proceduralne portrety (SVG) przedstawicieli siedmiu ras.
 *
 * Karty ras nie opisują wyglądu, więc wizerunki są wyprowadzone z tego,
 * co o rasach wiadomo z ich kart (nazwa, stronnictwa, zasób, sposób mówienia):
 *
 *   Wybudzeni   humanoidy "dopiero co przebudzone": ciężkie, półprzymknięte
 *               powieki; numer ewidencyjny (kreskowy) na czole - obsesja
 *               spisu i manifestu. Stronnictwo "Bez Numeru" ma w tym miejscu bliznę.
 *   Rezonanci   istoty krystaliczne; zamiast ust KOMORA REZONANSOWA, z której
 *               rozchodzą się fale. "Szczyt Okna" nosi kryształową koronę,
 *               "Przesypiający" mają przygaszone oczy.
 *   Pieśniarze  ptasia głowa z grzebieniem piór, czworo oczu (widzą tory lotu
 *               "trzy pieśni wcześniej") i świecący worek krtaniowy do śpiewu.
 *   Szczepieni  organizm z przeszczepów: szwy, świecące guzki kolonii (szczepy),
 *               maska filtrująca (kwarantanna), jedno oko wszczepione (skaner).
 *   Wykonawcy   maszyny: płyta twarzowa z wygrawerowanymi wierszami klauzul,
 *               wizjer ze skanującym punktem. "Rewizjoniści" mają klauzule skreślone.
 *   Heliotropi  gadzia twarz w kryzie płatków jak słonecznik (zwracają się ku
 *               gwieździe); "Żar" - płatki rozżarzone, "Hibernatorzy" - złożone.
 *   Świetliści  półprzezroczysta skóra z bioluminescencyjnymi wzorami; MASKA
 *               zależy od stronnictwa: Czerwone Maski - czerwona, Prawdziwe
 *               Skóry - bez maski, Dziedzice - złota.
 *
 * Każdy osobnik jest trochę inny (ziarno `seed`: odcień, znaki, liczba
 * płatków/piór, układ guzków), a stronnictwo zmienia wizerunek tam, gdzie
 * wynika to z jego nazwy. Portrety są delikatnie animowane (mruganie, fale,
 * pulsowanie), animacja wyłącza się przy prefers-reduced-motion.
 *
 * Bez plików graficznych - tak jak gwiazdy i planety w grze.
 */

let uidCounter = 0;

function rng(seed) {
  let s = (Math.abs(Math.floor(seed * 9973)) + 1) >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Ziarno z tekstu (np. id statku) - ten sam NPC ma zawsze ten sam wizerunek. */
export function seedFrom(text) {
  let h = 2166136261;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296 * 1000;
}

// ------------------------------------------------------------
// kolory
// ------------------------------------------------------------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
/** lekkie przesunięcie odcienia (różnice między osobnikami) */
const jitter = (hex, r, amt = 18) => rgbToHex(hexToRgb(hex).map((v) => v + (r() - 0.5) * 2 * amt));

// ------------------------------------------------------------
// wspólne elementy kadru
// ------------------------------------------------------------
function shoulders(id, suit, trim) {
  return `
  <path d="M6 122 C 12 101, 34 92, 60 92 C 86 92, 108 101, 114 122 Z" fill="url(#${id}-suit)"/>
  <path d="M30 98 C 42 93, 50 92, 60 92 C 70 92, 78 93, 90 98" fill="none" stroke="${trim}" stroke-width="1.6" opacity="0.85"/>
  <defs><linearGradient id="${id}-suit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${suit}"/><stop offset="1" stop-color="#05080e"/></linearGradient></defs>`;
}

// ============================================================
// RASY
// ============================================================
const DRAW = {
  // ----------------------------------------------------------
  wybudzeni(id, c, r, faction) {
    const skin = jitter('#d8c9ad', r, 14), skinD = mix(skin, '#3b2f22', 0.55);
    const gold = c;
    // kod ewidencyjny: losowe grubości kresek (każdy osobnik ma inny numer)
    let bars = '';
    if (faction !== 'coalition') {
      let x = 49;
      while (x < 71) { const w = 0.5 + Math.floor(r() * 3) * 0.55; bars += `<rect x="${x.toFixed(2)}" y="33" width="${w}" height="5.5" fill="${gold}" opacity="0.9"/>`; x += w + 0.6 + r() * 0.8; }
    } else {
      // "Bez Numeru": wypalony numer - blizna zamiast kodu
      bars = `<path d="M48 36 C 54 33, 62 39, 72 35" fill="none" stroke="${mix(skinD, '#7a3b2e', 0.5)}" stroke-width="2.2" stroke-linecap="round"/>`;
    }
    return `
    <defs>
      <radialGradient id="${id}-skin" cx="0.42" cy="0.35" r="0.75"><stop offset="0" stop-color="${skin}"/><stop offset="1" stop-color="${skinD}"/></radialGradient>
    </defs>
    ${shoulders(id, '#2a2418', gold)}
    <circle cx="60" cy="104" r="4.2" fill="${gold}" opacity="0.9"/><circle cx="60" cy="104" r="2" fill="#2a2418"/>
    <path d="M51 76 L51 94 L69 94 L69 76 Z" fill="${skinD}"/>
    <path d="M38 50 C 38 30, 48 22, 60 22 C 72 22, 82 30, 82 50 C 82 66, 74 80, 60 82 C 46 80, 38 66, 38 50 Z" fill="url(#${id}-skin)"/>
    <ellipse cx="37.5" cy="54" rx="2.6" ry="5" fill="${skinD}"/><ellipse cx="82.5" cy="54" rx="2.6" ry="5" fill="${skinD}"/>
    ${bars}
    <g class="rp-eyes">
      <ellipse cx="51" cy="54" rx="5" ry="2.4" fill="#f2ead8"/><ellipse cx="69" cy="54" rx="5" ry="2.4" fill="#f2ead8"/>
      <circle cx="51" cy="54.4" r="2" fill="${gold}"/><circle cx="69" cy="54.4" r="2" fill="${gold}"/>
      <circle cx="51" cy="54.4" r="0.9" fill="#1b140c"/><circle cx="69" cy="54.4" r="0.9" fill="#1b140c"/>
      <g class="rp-lid"><path d="M45.5 54 C 47 50, 55 50, 56.5 54 L56.5 51 L45.5 51 Z" fill="${skinD}"/><path d="M63.5 54 C 65 50, 73 50, 74.5 54 L74.5 51 L63.5 51 Z" fill="${skinD}"/></g>
    </g>
    <path d="M45 49.5 L56 50.5 M64 50.5 L75 49.5" stroke="${mix(skinD, '#000', 0.3)}" stroke-width="1.1"/>
    <path d="M58 58 L57 65 L61 65" fill="none" stroke="${skinD}" stroke-width="0.9" opacity="0.8"/>
    <path d="M53 71 C 57 72.5, 63 72.5, 67 71" fill="none" stroke="${mix(skinD, '#000', 0.25)}" stroke-width="1.2" stroke-linecap="round"/>`;
  },

  // ----------------------------------------------------------
  rezonanci(id, c, r, faction) {
    const glass = jitter(c, r, 12), deep = mix(c, '#06121f', 0.75), light = mix(c, '#ffffff', 0.6);
    const sleepy = faction === 'coalition';
    const crown = faction === 'hawk'
      ? `<path d="M46 22 L49 10 L53 21 L60 5 L67 21 L71 10 L74 22 Z" fill="${light}" opacity="0.75"/>` : '';
    // fasety: ten sam sześciokąt, różna jasność ścianek - wygląda jak kryształ
    return `
    ${shoulders(id, '#0d2233', c)}
    <path d="M22 110 L30 96 L36 112 Z M98 110 L90 96 L84 112 Z" fill="${glass}" opacity="0.55"/>
    <path d="M52 78 L68 78 L66 96 L54 96 Z" fill="${deep}"/>
    ${crown}
    <polygon points="60,18 82,34 80,70 60,86 40,70 38,34" fill="${deep}"/>
    <polygon points="60,18 82,34 60,46" fill="${light}" opacity="0.55"/>
    <polygon points="60,18 38,34 60,46" fill="${glass}" opacity="0.7"/>
    <polygon points="38,34 60,46 40,70" fill="${glass}" opacity="0.4"/>
    <polygon points="82,34 60,46 80,70" fill="${glass}" opacity="0.28"/>
    <polygon points="40,70 60,46 60,86" fill="${glass}" opacity="0.2"/>
    <polygon points="80,70 60,46 60,86" fill="${glass}" opacity="0.12"/>
    <polygon points="60,18 82,34 80,70 60,86 40,70 38,34" fill="none" stroke="${light}" stroke-width="0.8" opacity="0.8"/>
    <g opacity="${sleepy ? 0.35 : 1}">
      <path d="M47 40 L54 42 M73 40 L66 42" stroke="${light}" stroke-width="2" stroke-linecap="round"/>
    </g>
    <circle cx="60" cy="60" r="9" fill="#04101c"/>
    <circle cx="60" cy="60" r="4" fill="${light}" class="rp-glow"/>
    <circle cx="60" cy="60" r="6" fill="none" stroke="${light}" stroke-width="1.2" class="rp-ripple"/>
    <circle cx="60" cy="60" r="6" fill="none" stroke="${light}" stroke-width="1.2" class="rp-ripple rp-d2"/>`;
  },

  // ----------------------------------------------------------
  piesniarze(id, c, r, faction) {
    const plume = jitter(c, r, 16), plumeD = mix(plume, '#1a0f2e', 0.6), face = mix(c, '#2a2240', 0.55);
    const n = 5 + Math.floor(r() * 3);
    let quills = '';
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.28 + (r() - 0.5) * 0.08;
      const L = 30 + r() * 12;
      const x = 60 + Math.cos(a) * L, y = 42 + Math.sin(a) * L;
      const tip = faction === 'hawk' ? '#ff5a6e' : plume;
      quills += `<path d="M60 44 Q ${(60 + x) / 2 + Math.cos(a + 1.57) * 4} ${(42 + y) / 2 + Math.sin(a + 1.57) * 4} ${x.toFixed(1)} ${y.toFixed(1)}" stroke="${plumeD}" stroke-width="5" stroke-linecap="round" fill="none"/>
        <path d="M60 44 Q ${(60 + x) / 2} ${(42 + y) / 2} ${x.toFixed(1)} ${y.toFixed(1)}" stroke="${tip}" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.9"/>`;
    }
    const mottle = faction === 'coalition'
      ? Array.from({ length: 7 }, () => `<circle cx="${(46 + r() * 28).toFixed(1)}" cy="${(40 + r() * 20).toFixed(1)}" r="${(1 + r() * 1.6).toFixed(1)}" fill="${plumeD}" opacity="0.7"/>`).join('') : '';
    return `
    ${shoulders(id, '#1d1430', c)}
    ${quills}
    <ellipse cx="60" cy="84" rx="7" ry="10" fill="${face}"/>
    <ellipse cx="60" cy="87" rx="9" ry="6" fill="${plume}" class="rp-sac" opacity="0.85"/>
    <ellipse cx="60" cy="52" rx="21" ry="21" fill="${face}"/>
    <path d="M40 52 C 42 38, 52 31, 60 31 C 68 31, 78 38, 80 52" fill="${plumeD}" opacity="0.6"/>
    ${mottle}
    <path d="M52 62 C 55 60, 65 60, 68 62 L60 80 Z" fill="#d9c9b0"/>
    <path d="M60 64 L60 79" stroke="#8a7a66" stroke-width="0.8"/>
    <g class="rp-eyes">
      <circle cx="50" cy="51" r="4.6" fill="#0d0718"/><circle cx="70" cy="51" r="4.6" fill="#0d0718"/>
      <circle cx="50" cy="51" r="2.4" fill="${plume}" class="rp-glow"/><circle cx="70" cy="51" r="2.4" fill="${plume}" class="rp-glow"/>
      <circle cx="51.3" cy="49.6" r="0.9" fill="#fff"/><circle cx="71.3" cy="49.6" r="0.9" fill="#fff"/>
      <circle cx="54" cy="42" r="1.8" fill="#0d0718"/><circle cx="66" cy="42" r="1.8" fill="#0d0718"/>
      <circle cx="54" cy="42" r="0.9" fill="${plume}"/><circle cx="66" cy="42" r="0.9" fill="${plume}"/>
    </g>`;
  },

  // ----------------------------------------------------------
  szczepieni(id, c, r, faction) {
    const skin = jitter('#8fa38a', r, 16), skinD = mix(skin, '#1b2418', 0.6), glow = c;
    const count = faction === 'hawk' ? 9 : faction === 'coalition' ? 3 : 6;
    let nodes = '';
    for (let i = 0; i < count; i++) {
      const a = Math.PI * (1.05 + r() * 0.95), rr = 18 + r() * 5;
      const x = 60 + Math.cos(a) * rr, y = 50 + Math.sin(a) * rr * 1.1, s = 1.6 + r() * 2.4;
      nodes += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(s + 1.2).toFixed(1)}" fill="${skinD}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(1)}" fill="${glow}" class="rp-glow${i % 2 ? ' rp-d2' : ''}"/>`;
    }
    // szew przeszczepu - inny przebieg u każdego
    const sy = 40 + r() * 16;
    const seam = `<path d="M40 ${sy.toFixed(1)} C 50 ${(sy - 6).toFixed(1)}, 62 ${(sy + 8).toFixed(1)}, 79 ${(sy - 2).toFixed(1)}" fill="none" stroke="${mix(skinD, '#000', 0.3)}" stroke-width="1.1" stroke-dasharray="1.6 1.4"/>`;
    const hood = faction === 'trade'
      ? `<ellipse cx="60" cy="54" rx="31" ry="36" fill="${mix(c, '#ffffff', 0.5)}" opacity="0.12" stroke="${mix(c, '#ffffff', 0.4)}" stroke-width="0.8" stroke-opacity="0.6"/>` : '';
    return `
    ${shoulders(id, '#15241a', c)}
    <path d="M51 76 L51 94 L69 94 L69 76 Z" fill="${skinD}"/>
    <path d="M39 52 C 39 32, 49 24, 60 24 C 71 24, 81 32, 81 52 C 81 68, 73 80, 60 82 C 47 80, 39 68, 39 52 Z" fill="${skin}"/>
    <path d="M39 52 C 39 32, 49 24, 60 24 C 50 30, 44 42, 45 60 C 46 70, 50 76, 55 81 C 46 78, 39 67, 39 52 Z" fill="${skinD}" opacity="0.45"/>
    ${nodes}
    ${seam}
    <g class="rp-eyes">
      <ellipse cx="51" cy="54" rx="4.2" ry="3" fill="#e8e0b0"/><circle cx="51" cy="54" r="1.6" fill="#3a2c10"/>
      <g class="rp-lid"><path d="M46.5 54 C 47 50.5, 55 50.5, 55.5 54 L55.5 50 L46.5 50 Z" fill="${skinD}"/></g>
    </g>
    <circle cx="69" cy="54" r="5.2" fill="#0b1510" stroke="#6b7a70" stroke-width="1.2"/>
    <circle cx="69" cy="54" r="2.4" fill="${glow}" class="rp-glow"/>
    <rect x="49" y="62" width="22" height="13" rx="5" fill="#2a332c" stroke="#4a5a4e" stroke-width="0.8"/>
    <path d="M52 66 L68 66 M52 68.5 L68 68.5 M52 71 L68 71" stroke="#141a16" stroke-width="0.8"/>
    <circle cx="46" cy="70" r="4" fill="#3a463d" stroke="#4a5a4e" stroke-width="0.8"/><circle cx="74" cy="70" r="4" fill="#3a463d" stroke="#4a5a4e" stroke-width="0.8"/>
    <circle cx="46" cy="70" r="1.5" fill="${glow}" opacity="0.6"/><circle cx="74" cy="70" r="1.5" fill="${glow}" opacity="0.6"/>
    ${hood}`;
  },

  // ----------------------------------------------------------
  wykonawcy(id, c, r, faction) {
    const steel = jitter('#c3cdd8', r, 10), steelD = mix(steel, '#1a2230', 0.65), glow = mix(c, '#e8f4ff', 0.4);
    let lines = '';
    for (let row = 0; row < 4; row++) {
      let x = 45; const y = 30 + row * 3.2;
      while (x < 75) {
        const w = 1.5 + r() * 5;
        if (x + w > 75) break;
        lines += `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="1.1" fill="${steelD}" opacity="0.85"/>`;
        x += w + 1 + r() * 1.5;
      }
      if (faction === 'coalition' && r() < 0.6) {
        lines += `<path d="M45 ${y + 0.6} L75 ${y + 0.6}" stroke="#c0483a" stroke-width="0.8" opacity="0.8"/>`; // Rewizjoniści: klauzule skreślone
      }
    }
    return `
    <defs><linearGradient id="${id}-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${steel}"/><stop offset="1" stop-color="${steelD}"/></linearGradient></defs>
    ${shoulders(id, '#1c232d', c)}
    <rect x="50" y="76" width="20" height="18" fill="${steelD}"/>
    <path d="M52 80 L68 80 M52 84 L68 84 M52 88 L68 88" stroke="#0c1118" stroke-width="1"/>
    <path d="M84 30 L90 14" stroke="${steelD}" stroke-width="1.6"/><circle cx="90" cy="13" r="1.8" fill="${glow}" class="rp-glow"/>
    <path d="M40 34 C 40 24, 49 20, 60 20 C 71 20, 80 24, 80 34 L80 60 L72 78 L48 78 L40 60 Z" fill="url(#${id}-plate)"/>
    <path d="M40 34 C 40 24, 49 20, 60 20 C 71 20, 80 24, 80 34 L80 60 L72 78 L48 78 L40 60 Z" fill="none" stroke="#e8eef4" stroke-width="0.6" opacity="0.5"/>
    ${lines}
    <rect x="41" y="47" width="38" height="8" rx="2" fill="#070b10"/>
    <rect x="43" y="50.2" width="34" height="1.6" fill="${glow}" opacity="${faction === 'trade' ? 0.45 : 0.75}"/>
    <circle cx="48" cy="51" r="2.2" fill="#ffffff" class="rp-scan"/>
    <path d="M50 64 L70 64 M51 67.5 L69 67.5 M52 71 L68 71" stroke="${steelD}" stroke-width="1.3"/>
    <circle cx="43" cy="38" r="0.9" fill="${steelD}"/><circle cx="77" cy="38" r="0.9" fill="${steelD}"/>
    <circle cx="43" cy="59" r="0.9" fill="${steelD}"/><circle cx="77" cy="59" r="0.9" fill="${steelD}"/>`;
  },

  // ----------------------------------------------------------
  heliotropi(id, c, r, faction) {
    const petal = faction === 'hawk' ? '#ff5a2a' : faction === 'trade' ? '#ffe7a8' : jitter(c, r, 14);
    const petalTip = faction === 'hawk' ? '#ffd26a' : faction === 'trade' ? '#fff8e6' : '#ffe07a';
    const skin = jitter('#c98a55', r, 14), skinD = mix(skin, '#2a140a', 0.6);
    const n = 12 + Math.floor(r() * 5);
    const folded = faction === 'coalition';
    let petals = '';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 360 + r() * 6;
      const L = (folded ? 20 : 30) + r() * 5;
      petals += `<ellipse cx="60" cy="${(52 - L / 2 - 14).toFixed(1)}" rx="${folded ? 4 : 5.5}" ry="${(L / 2).toFixed(1)}" fill="url(#${id}-pet)" transform="rotate(${a.toFixed(1)} 60 52)"/>`;
    }
    return `
    <defs>
      <linearGradient id="${id}-pet" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${petal}"/><stop offset="1" stop-color="${petalTip}"/></linearGradient>
      <pattern id="${id}-scale" width="4" height="3" patternUnits="userSpaceOnUse"><path d="M0 3 Q 2 0.4 4 3" fill="none" stroke="${skinD}" stroke-width="0.45" opacity="0.6"/></pattern>
    </defs>
    ${shoulders(id, '#2a160c', c)}
    <g class="rp-sway">${petals}</g>
    <circle cx="60" cy="52" r="24" fill="${mix(petal, '#000', 0.55)}" opacity="0.6"/>
    <path d="M52 76 L68 76 L68 94 L52 94 Z" fill="${skinD}"/>
    <ellipse cx="60" cy="55" rx="17" ry="22" fill="${skin}"/>
    <ellipse cx="60" cy="55" rx="17" ry="22" fill="url(#${id}-scale)"/>
    <g class="rp-eyes">
      <ellipse cx="52.5" cy="51" rx="4.3" ry="3.4" fill="#ffb13d"/><ellipse cx="67.5" cy="51" rx="4.3" ry="3.4" fill="#ffb13d"/>
      <ellipse cx="52.5" cy="51" rx="0.9" ry="3" fill="#1a0c04"/><ellipse cx="67.5" cy="51" rx="0.9" ry="3" fill="#1a0c04"/>
      <g class="rp-lid"><path d="M48 51 C 49 47, 56 47, 57 51 L57 47 L48 47 Z" fill="${skinD}"/><path d="M63 51 C 64 47, 71 47, 72 51 L72 47 L63 47 Z" fill="${skinD}"/></g>
    </g>
    <path d="M57.5 61 L58.5 63 M62.5 61 L61.5 63" stroke="${skinD}" stroke-width="1" stroke-linecap="round"/>
    <path d="M51 69 C 56 71.5, 64 71.5, 69 69" fill="none" stroke="${skinD}" stroke-width="1.2" stroke-linecap="round"/>`;
  },

  // ----------------------------------------------------------
  swietlisci(id, c, r, faction) {
    const glow = jitter(c, r, 10), deep = '#0b1c2c';
    // bioluminescencyjne wzory - inny układ u każdego
    let lines = '';
    for (let i = 0; i < 5; i++) {
      const x = 44 + r() * 32, y = 30 + r() * 44, dx = (r() - 0.5) * 16, dy = 6 + r() * 10;
      lines += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q ${dx.toFixed(1)} ${(dy / 2).toFixed(1)} ${(dx * 0.4).toFixed(1)} ${dy.toFixed(1)}" fill="none" stroke="${glow}" stroke-width="0.9" stroke-linecap="round" class="rp-glow${i % 2 ? ' rp-d2' : ''}"/>`;
    }
    let mask = '';
    if (faction === 'hawk') {
      mask = `<path d="M40 44 C 44 38, 54 38, 60 42 C 66 38, 76 38, 80 44 L78 56 C 72 60, 64 58, 60 55 C 56 58, 48 60, 42 56 Z" fill="#b8202c"/>
        <path d="M40 44 C 44 38, 54 38, 60 42 C 66 38, 76 38, 80 44" fill="none" stroke="#ff6a6a" stroke-width="0.8"/>
        <path d="M46 50 C 48 47.5, 53 47.5, 55 50 C 53 52, 48 52, 46 50 Z M74 50 C 72 47.5, 67 47.5, 65 50 C 67 52, 72 52, 74 50 Z" fill="#12050a"/>
        <path d="M47.5 50 C 49 48.6, 52 48.6, 53.5 50 C 52 51.2, 49 51.2, 47.5 50 Z M72.5 50 C 71 48.6, 68 48.6, 66.5 50 C 68 51.2, 71 51.2, 72.5 50 Z" fill="${glow}" class="rp-glow"/>`;
    } else if (faction === 'coalition') {
      mask = `<path d="M42 60 C 48 58, 54 60, 60 58 C 66 60, 72 58, 78 60 L74 74 C 68 80, 52 80, 46 74 Z" fill="#d6a93e"/>
        <path d="M50 66 L70 66 M52 70 L68 70" stroke="#8a6a1e" stroke-width="0.9"/><circle cx="60" cy="63" r="1.8" fill="#fff3c0"/>`;
    }
    return `
    <defs><radialGradient id="${id}-skin" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="${mix(glow, deep, 0.5)}"/><stop offset="1" stop-color="${deep}"/></radialGradient></defs>
    ${shoulders(id, '#0a1a24', c)}
    <path d="M53 78 L67 78 L66 95 L54 95 Z" fill="${deep}"/>
    <path d="M42 50 C 42 28, 51 18, 60 18 C 69 18, 78 28, 78 50 C 78 68, 70 82, 60 84 C 50 82, 42 68, 42 50 Z" fill="url(#${id}-skin)"/>
    <path d="M42 50 C 42 28, 51 18, 60 18 C 69 18, 78 28, 78 50 C 78 68, 70 82, 60 84 C 50 82, 42 68, 42 50 Z" fill="none" stroke="${glow}" stroke-width="0.7" opacity="0.6"/>
    ${lines}
    <g class="rp-eyes">
      <path d="M45 50 C 48 46, 54 46, 56 50 C 54 53, 48 53, 45 50 Z" fill="${glow}" class="rp-glow"/>
      <path d="M75 50 C 72 46, 66 46, 64 50 C 66 53, 72 53, 75 50 Z" fill="${glow}" class="rp-glow"/>
    </g>
    <path d="M55 70 C 58 71, 62 71, 65 70" fill="none" stroke="${glow}" stroke-width="0.9" opacity="0.7"/>
    ${mask}`;
  },
};

// animacje wspólne dla wszystkich portretów (dołączane raz na dokument)
const STYLE = `
.rp-portrait .rp-lid { transform-box: fill-box; transform-origin: 50% 0; animation: rp-blink 5.2s infinite; transform: scaleY(0.35); }
.rp-portrait .rp-glow { animation: rp-glow 3.4s ease-in-out infinite; }
.rp-portrait .rp-d2 { animation-delay: -1.7s; }
.rp-portrait .rp-ripple { transform-box: fill-box; transform-origin: center; animation: rp-ripple 2.4s ease-out infinite; }
.rp-portrait .rp-sac { transform-box: fill-box; transform-origin: center; animation: rp-sac 2.8s ease-in-out infinite; }
.rp-portrait .rp-scan { animation: rp-scan 2.6s ease-in-out infinite alternate; }
.rp-portrait .rp-sway { transform-box: view-box; transform-origin: 60px 52px; animation: rp-sway 9s ease-in-out infinite alternate; }
@keyframes rp-blink { 0%, 92%, 100% { transform: scaleY(0.35); } 95% { transform: scaleY(1.9); } }
@keyframes rp-glow { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }
@keyframes rp-ripple { from { transform: scale(0.8); opacity: 0.9; } to { transform: scale(3.2); opacity: 0; } }
@keyframes rp-sac { 0%, 100% { transform: scale(0.85); } 50% { transform: scale(1.12); } }
@keyframes rp-scan { from { transform: translateX(0); } to { transform: translateX(24px); } }
@keyframes rp-sway { from { transform: rotate(-4deg); } to { transform: rotate(4deg); } }
@media (prefers-reduced-motion: reduce) { .rp-portrait * { animation: none !important; } }
`;

/**
 * Portret przedstawiciela rasy jako tekst SVG.
 * @param {string} raceId   klucz z RACES (races.js)
 * @param {object} [o]
 * @param {number} [o.seed=0]            ten sam seed = ten sam osobnik
 * @param {string} [o.faction='trade']   hawk | trade | coalition (klucze stronnictw z races.js)
 * @param {string} [o.color]             kolor rasy (domyślnie z tabeli poniżej)
 * @param {number} [o.size=64]           rozmiar w pikselach
 * @param {boolean} [o.frame=true]       tło "ekranu komunikatora" (skanlinie, winieta)
 */
export function racePortrait(raceId, { seed = 0, faction = 'trade', color, size = 64, frame = true } = {}) {
  const draw = DRAW[raceId] ?? DRAW.wybudzeni;
  const c = color ?? RACE_COLOR[raceId] ?? '#9fd8ff';
  const id = `rp${++uidCounter}`;
  const r = rng(seed + raceId.length * 17.3);
  const bg = frame ? `
    <defs>
      <radialGradient id="${id}-bg" cx="0.5" cy="0.38" r="0.75"><stop offset="0" stop-color="${mix(c, '#070b14', 0.62)}"/><stop offset="1" stop-color="#05080e"/></radialGradient>
      <pattern id="${id}-scan" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="1" fill="#000" opacity="0.28"/></pattern>
      <radialGradient id="${id}-vig" cx="0.5" cy="0.5" r="0.72"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.65"/></radialGradient>
    </defs>
    <rect width="120" height="120" fill="url(#${id}-bg)"/>` : '';
  const overlay = frame ? `<rect width="120" height="120" fill="url(#${id}-scan)"/><rect width="120" height="120" fill="url(#${id}-vig)"/>` : '';
  return `<svg class="rp-portrait" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${RACE_LABEL[raceId] ?? raceId}">
    <style>${STYLE}</style>${bg}<g transform="translate(60 64) scale(1.16) translate(-60 -64)">${draw(id, c, r, faction)}</g>${overlay}</svg>`;
}

// kolory i nazwy ras powielone tu, żeby moduł nie zależał od races.js
// (można go użyć np. na stronie z opisem ras bez ładowania danych gry)
const RACE_COLOR = {
  wybudzeni: '#e0b15a', rezonanci: '#7fd1ff', piesniarze: '#c39bff', szczepieni: '#7ee08a',
  wykonawcy: '#9fb4c8', heliotropi: '#ff9d5c', swietlisci: '#5ff0e0',
};
const RACE_LABEL = {
  wybudzeni: 'Przedstawiciel rasy Wybudzonych', rezonanci: 'Przedstawiciel rasy Rezonantów', piesniarze: 'Przedstawiciel rasy Pieśniarzy',
  szczepieni: 'Przedstawiciel rasy Szczepionych', wykonawcy: 'Przedstawiciel rasy Wykonawców', heliotropi: 'Przedstawiciel rasy Heliotropów',
  swietlisci: 'Przedstawiciel rasy Świetlistych',
};
export const PORTRAIT_RACES = Object.keys(RACE_COLOR);
