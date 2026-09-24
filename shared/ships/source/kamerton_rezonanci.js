/**
 * kamerton_rezonanci.js — „Kamerton", fregata Rezonantów (Teegarden-B)
 *
 *   import { buildKamertonRezonanci } from './kamerton_rezonanci.js';
 *   const ship = buildKamertonRezonanci({ seed: 5, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * KONCEPCJA: kamerton (widełki stroikowe). Rezonanci są krystaliczni, mówią
 * komorą rezonansową, a ich fałda to „Okno rezonansu" (warp-drive.js:
 * pierścień z najsilniejszymi prążkami interferencji, fringe 1.0). Kadłub to
 * sześciokątny pryzmat, który z przodu rozwidla się na dwa ramiona. Między
 * ramionami biegnie szyna Grota (weapons.js: dart, jeden strzał w chwili
 * otwarcia okna), a fałda otwiera się dokładnie w ramie widełek. W połowie
 * kadłuba siedzi sześciokątny pierścień „Okno" z prążkami — komora rezonansowa.
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z tyłu — sześciokąt pierścienia wokół sześciokątnego trzonu, trójkąt dysz.
 *           Szczyt Okna: korona 5 kryształów nad pierścieniem;
 *           Kworum: trzy pylony co 120°; Przesypiający: goła rama, opuszczone płetwy.
 *  z góry — widelec: trzon, pierścień, dwa równoległe ramiona z przerwą.
 *  z boku — płaski pryzmat, pierścień jak tarcza, ramiona zakończone kryształem.
 *
 * ZAKAZY rasy: żadnych krzywych. Wszystko z graniastosłupów sześciokątnych,
 * bipiramid (kryształów) i płaskich płyt. Wysoka symetria (dyscyplina 0.9).
 */
import * as THREE from 'three';

export const KAMERTON_META = {
  id: 'kamerton-rezonanci',
  race: 'rezonanci',
  shipClass: 'fregata',
  name: 'Kamerton',
  card: { hull: 110, armor: 6, thermal: 50, energy: 100, signature: 50, cargo: 16, slots: 3, hullRegenPct: 0 },
  lengthRange: [28, 34],
  triBudget: 30000,
  raceColor: '#7fd1ff',
  factions: { hawk: 'Szczyt Okna', trade: 'Kworum Pośrednie', coalition: 'Przesypiający' },
  defaultAsymmetry: { hawk: 0.03, trade: 0.03, coalition: 0.15 },
};
const CARD = KAMERTON_META.card;
export const MAT_SLOTS = [
  'mat_hull_primary', 'mat_hull_secondary', 'mat_trim_race', 'mat_emissive_race',
  'mat_glass', 'mat_engine', 'mat_dark',
];

// ------------------------------------------------------------------ RNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(seed, salt) {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const r3 = (v) => Math.round(v * 1000) / 1000;
const snap = (v, s = 0.05) => Math.round(v / s) * s;

// ------------------------------------------------------------ geometrie
const _templates = new Map();
const _geo = new Map();
function cached(key, make) {
  let g = _geo.get(key);
  if (!g) { g = make(); _geo.set(key, g); }
  return g;
}

function box(w, h, d) {
  w = r3(w); h = r3(h); d = r3(d);
  return cached(`b|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function chamferBox(w, h, d, c = 0.08) {
  w = r3(w); h = r3(h); d = r3(d);
  c = r3(Math.min(c, w * 0.22, h * 0.22, d * 0.22));
  if (c < 0.005) return box(w, h, d);
  return cached(`cb|${w}|${h}|${d}|${c}`, () => {
    const hw = w / 2 - c, hh = h / 2 - c;
    const k = Math.min(c, hw * 0.45, hh * 0.45);
    const s = new THREE.Shape();
    s.moveTo(-hw + k, -hh); s.lineTo(hw - k, -hh); s.lineTo(hw, -hh + k); s.lineTo(hw, hh - k);
    s.lineTo(hw - k, hh); s.lineTo(-hw + k, hh); s.lineTo(-hw, hh - k); s.lineTo(-hw, -hh + k);
    s.closePath();
    const depth = Math.max(d - 2 * c, 0.001);
    const g = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Klin: tył (wB×hB, środek y=0, z=-d/2) → przód (wF×hF, środek y=yF, z=+d/2). */
function taperBox(wB, hB, wF, hF, d, yF = 0) {
  const k = [wB, hB, wF, hF, d, yF].map(r3).join('|');
  return cached(`tb|${k}`, () => {
    const P = [
      [-wB / 2, -hB / 2, -d / 2], [wB / 2, -hB / 2, -d / 2], [wB / 2, hB / 2, -d / 2], [-wB / 2, hB / 2, -d / 2],
      [-wF / 2, yF - hF / 2, d / 2], [wF / 2, yF - hF / 2, d / 2], [wF / 2, yF + hF / 2, d / 2], [-wF / 2, yF + hF / 2, d / 2],
    ];
    const quads = [[4, 5, 6, 7], [1, 0, 3, 2], [1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4]];
    const pos = [];
    for (const [a, b, c, e] of quads) for (const i of [a, b, c, a, c, e]) pos.push(...P[i]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

/** Pierścień n-kąta (wierzchołek u góry), oś wzdłuż Z. */
function polyRing(rOut, rIn, depth, n = 6) {
  const k = [rOut, rIn, depth, n].map(r3).join('|');
  return cached(`pr|${k}`, () => {
    const ph = Math.PI / 2;
    const s = new THREE.Shape(), hole = new THREE.Path();
    for (let i = 0; i < n; i++) {
      const a = ph + (i * 2 * Math.PI) / n;
      const fn = i ? 'lineTo' : 'moveTo';
      s[fn](Math.cos(a) * rOut, Math.sin(a) * rOut);
      hole[fn](Math.cos(a) * rIn, Math.sin(a) * rIn);
    }
    s.closePath(); hole.closePath();
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Tarcza n-kąta, oś wzdłuż Z. */
function polyDisc(r, depth, n = 6) {
  const k = [r, depth, n].map(r3).join('|');
  return cached(`pd|${k}`, () => {
    const g = new THREE.CylinderGeometry(r, r, depth, n, 1);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Graniastosłup sześciokątny wzdłuż Z: rt = przód (+Z), rb = tył. Wierzchołek u dołu i u góry. */
function hexRod(rt, rb, len) {
  const k = [rt, rb, len].map(r3).join('|');
  return cached(`hx|${k}`, () => {
    const g = new THREE.CylinderGeometry(rt, rb, len, 6, 1);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Kryształ: bipiramida sześciokątna wzdłuż Y (czubek w +Y na wysokości up, spód -down). */
function crystal(r, up, down) {
  const k = [r, up, down].map(r3).join('|');
  return cached(`cr|${k}`, () => {
    const g = new THREE.LatheGeometry([
      new THREE.Vector2(0.001, -down), new THREE.Vector2(r, 0), new THREE.Vector2(0.001, up),
    ], 6);
    g.computeVertexNormals();
    return g;
  });
}

/** Trzon z toczenia, 6 segmentów = sześciokątny przekrój (wierzchołek u góry i u dołu). */
function spine(prof, sx, sy) {
  const k = prof.map(([z, r]) => `${r3(z)},${r3(r)}`).join(';') + `|${r3(sx)}|${r3(sy)}`;
  return cached(`sp|${k}`, () => {
    const g = new THREE.LatheGeometry(prof.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z)), 6);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------ materiały
function makeMaterials(o, rng) {
  const race = new THREE.Color(o.raceColor);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const prim = new THREE.Color({ hawk: 0x1d2833, trade: 0x59636d, coalition: 0x2a2f35 }[F]);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.16), 0, 1));
  const trim = race.clone().multiplyScalar(coal ? 0.45 : trade ? 0.7 : 0.8);
  const b = o.emissiveBoost;
  const eI = (hawk ? 2.4 : trade ? 1.5 : 0.55) * b;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, flatShading: true, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.45, roughness: coal ? 0.7 : 0.45, side: THREE.DoubleSide }),
    secondary: M('mat_hull_secondary', {
      color: new THREE.Color(trade ? 0x9aa8b6 : 0x1a232c), metalness: trade ? 0.8 : 0.5, roughness: trade ? 0.25 : 0.55,
      side: THREE.DoubleSide,
    }),
    trim: M('mat_trim_race', { color: trim, metalness: 0.7, roughness: coal ? 0.55 : 0.2, side: THREE.DoubleSide }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x04101a), emissive: race, emissiveIntensity: eI, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: new THREE.Color(0x0b1d2b), metalness: 0.3, roughness: coal ? 0.5 : 0.06, transparent: true,
      opacity: coal ? 0.9 : 0.78, emissive: race, emissiveIntensity: (coal ? 0.1 : 0.3) * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x0a1420), emissive: new THREE.Color(0xdff4ff),
      emissiveIntensity: (hawk ? 3.4 : trade ? 2.8 : 1.6) * b, metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x0a0d10), metalness: 0.25, roughness: 0.88, side: THREE.DoubleSide }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0x7fd1ff;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.5), 0, 1),
    asymmetry: opts.asymmetry == null ? KAMERTON_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
const PROFILE = [
  [-15.2, 0.01], [-15, 1.7], [-14.3, 2.3], [-9, 2.45], [-3, 2.25], [2, 1.95], [4.6, 1.5], [5.4, 0.01],
];
const SIN60 = Math.sin(Math.PI / 3);

function buildTemplate(o) {
  const rS = mulberry32(hash(o.seed, 1));
  const rD = mulberry32(hash(o.seed, 2));
  const rW = mulberry32(hash(o.seed, 3));
  const rA = mulberry32(hash(o.seed, 4));
  const rM = mulberry32(hash(o.seed, 5));
  const mat = makeMaterials(o, rM);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const a = o.asymmetry;
  const v = (amt) => 1 + (rS() - 0.5) * 2 * amt;

  const root = new THREE.Group();
  root.name = 'kamerton_root';
  const addTo = (parent, geo, m, name, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const add = (...args) => addTo(root, ...args);
  const node = (parent, name, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, order = 'XYZ') => {
    const n = new THREE.Group();
    n.name = name; n.position.set(x, y, z); n.rotation.set(rx, ry, rz, order);
    parent.add(n);
    return n;
  };
  const hp = (parent, name, x, y, z, ry = 0) => {
    const h = new THREE.Object3D();
    h.name = name; h.position.set(x, y, z); h.rotation.y = ry;
    parent.add(h);
    return h;
  };

  // ---------- trzon: sześciokątny pryzmat
  const rK = v(0.05);
  const prof = PROFILE.map(([z, r]) => [z, r * rK]);
  const sx = 1.35 * (trade ? 1.08 : 1), sy = 0.95;
  const rAt = (z) => {
    if (z <= prof[0][0]) return prof[0][1];
    for (let i = 1; i < prof.length; i++) {
      if (z <= prof[i][0]) {
        const [z0, r0] = prof[i - 1], [z1, r1] = prof[i];
        return lerp(r0, r1, (z - z0) / (z1 - z0));
      }
    }
    return 0;
  };
  const hw = (z) => rAt(z) * sx * SIN60; // pionowa ściana boczna
  const hh = (z) => rAt(z) * sy;          // grzbiet (wierzchołek)
  const side = (z) => rAt(z) * sy * 0.5;  // pół-wysokość ściany bocznej
  const facetA = Math.atan2(0.5 * sy, SIN60 * sx); // nachylenie górnej ściany
  const zR = -15.2;
  add(spine(prof, sx, sy), mat.primary, 'hull_spine');

  // płyty pancerza na ścianach bocznych (armor 6)
  const nPl = CARD.armor;
  for (let i = 0; i < nPl; i++) {
    const z = lerp(-13, 1, i / (nPl - 1));
    for (const s of [-1, 1]) {
      if (rW() < o.wear * 0.25) continue;
      add(chamferBox(0.1, side(z) * 1.7, 1.8, 0.04), mat.secondary, `armor_${s > 0 ? 's' : 'p'}_${i}`, s * (hw(z) + 0.04), 0, z);
    }
  }
  // kryształy grzbietu
  for (let i = 0; i < 3; i++) {
    const z = -13 + i * 1.6, h = (0.9 - i * 0.18) * v(0.1);
    add(crystal(0.28, h, 0.2), mat.glass, `ridge_crystal_${i}`, 0, hh(z) - 0.05, z, -0.35, 0, 0);
  }

  // ---------- widełki
  const zY = 3.6;
  const g = { hawk: 1.95, trade: 1.75, coalition: 1.25 }[F] * v(0.04);
  const Lt = { hawk: 13, trade: 11, coalition: 11.5 }[F] * v(0.05);
  const zTip = zY + Lt;
  add(hexRod(0.85, 0.85, 2 * g + 0.4), mat.primary, 'fork_yoke', 0, 0, zY + 0.3, 0, Math.PI / 2, 0);
  add(polyRing(1.05, 0.8, 0.3, 6), mat.trim, 'fork_yoke_band', 0, 0, zY + 0.3);
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p', x = s * g * (1 + (s < 0 ? (rA() - 0.5) * a * 0.2 : 0));
    add(hexRod(0.55, 0.8, Lt), mat.trim, `tine_${tag}`, x, 0, zY + Lt / 2);
    const chipped = rW() < o.wear * 0.35;
    add(crystal(0.55, chipped ? 0.6 : 1.6, 0.25), mat.emissive, `tine_${tag}_tip${chipped ? '_chipped' : ''}`, x, 0, zTip, Math.PI / 2, 0, 0);
    for (const t of [0.3, 0.72]) add(polyRing(1.0 - t * 0.3, 0.6 - t * 0.12, 0.28, 6), mat.dark, `tine_${tag}_collar_${t}`, x, 0, zY + Lt * t);
    const nD = hawk ? 8 : 6;
    for (let k = 0; k < nD; k++) {
      const z = zY + 1 + (k + 0.5) * ((Lt - 1.6) / nD), rr = lerp(0.8, 0.55, (z - zY) / Lt);
      add(box(0.06, 0.24, (Lt / nD) * 0.45), mat.emissive, `tine_${tag}_fringe_${k}`, x - s * rr * SIN60 - s * 0.02, 0, z);
    }
    hp(root, `hp_weapon_${s < 0 ? 1 : 2}`, x, 0, zTip + (chipped ? 0.65 : 1.65));
  }
  // czujniki na jarzmie (signature 50, sensors 7)
  for (const s of [-1, 1]) add(crystal(0.2, 0.9 * v(0.1), 0.1), mat.glass, `sensor_${s > 0 ? 's' : 'p'}`, s * 0.55, 0.8, zY + 0.3, 0, 0, -s * 0.25);

  // szyna Grota (dart) między ramionami
  const rail0 = zY + 0.9, railL = Lt * 0.62;
  add(hexRod(0.28, 0.36, railL), mat.secondary, 'grot_rail', 0, 0, rail0 + railL / 2);
  const nCoil = hawk ? 5 : 4;
  for (let k = 0; k < nCoil; k++) {
    add(polyRing(0.75, 0.52, 0.16, 6), mat.emissive, `grot_coil_${k}`, 0, 0, rail0 + 0.8 + k * ((railL - 1.2) / (nCoil - 1)));
  }
  add(crystal(0.38, 1.4, 0.4), mat.emissive, 'grot_dart', 0, 0, rail0 + railL + 0.4, Math.PI / 2, 0, 0);
  hp(root, 'hp_weapon_0', 0, 0, rail0 + railL + 1.8);
  hp(root, 'hp_warp_emitter', 0, 0, zTip + 0.3);

  // kokpit: fasetowana kopuła
  {
    const z = -0.8;
    const m = add(crystal(0.8, 0.5, 0.05), mat.glass, 'cockpit_canopy', 0, hh(z) - 0.12, z);
    m.scale.set(1, 1, 2.2);
    add(box(0.9, 0.06, 0.12), mat.trim, 'cockpit_brow', 0, hh(z + 1.6) + 0.05, z + 1.6);
    hp(root, 'hp_cockpit', 0, hh(z) + 0.2, z);
  }

  // ---------- pierścień „Okno" (komora rezonansowa)
  const zO = -6, rH = rAt(zO), rOut = rH * 1.75, rIn = rOut - 0.45;
  const ringG = node(root, 'window_ring', 0, 0, zO);
  ringG.scale.x = sx * 0.9;
  addTo(ringG, polyRing(rOut, rIn, 1.0, 6), mat.trim, 'window_ring_frame');
  addTo(ringG, polyRing(rIn + 0.02, rIn - 0.1, 0.08, 6), mat.emissive, 'window_fringe_0', 0, 0, 0.55);
  addTo(ringG, polyRing(rIn * 0.9, rIn * 0.9 - 0.08, 0.08, 6), mat.emissive, 'window_fringe_1', 0, 0, 0.62);
  addTo(ringG, polyRing(rIn + 0.02, rIn - 0.1, 0.08, 6), mat.emissive, 'window_fringe_2', 0, 0, -0.55);
  for (let k = 0; k < 6; k++) {
    const ang = Math.PI / 2 + (k * Math.PI) / 3, r0 = rH * 0.85, len = rIn - r0 + 0.1;
    const sp = node(ringG, `window_spoke_pivot_${k}`, 0, 0, 0, 0, 0, ang - Math.PI / 2);
    addTo(sp, box(0.3, len, 0.6), mat.dark, `window_spoke_${k}`, 0, r0 + len / 2, 0);
  }
  if (hawk) {
    // Szczyt Okna: korona 5 kryształów
    [-1.6, -0.8, 0, 0.8, 1.6].forEach((x, k) => {
      const h = [1.2, 1.8, 2.6, 1.8, 1.2][k] * v(0.08);
      addTo(ringG, crystal(0.3, h, 0.2), mat.glass, `crown_${k}`, x, rOut - 0.577 * Math.abs(x) - 0.12, 0, 0, 0, -x * 0.15);
    });
  }
  if (trade) {
    // Kworum Pośrednie: trzy pylony co 120°
    [90, 210, 330].forEach((deg, k) => {
      const ang = (deg * Math.PI) / 180;
      const pv = node(ringG, `quorum_pivot_${k}`, 0, 0, 0, 0, 0, ang - Math.PI / 2);
      addTo(pv, crystal(0.26, 2.2 * v(0.06), 0.2), mat.secondary, `quorum_pylon_${k}`, 0, rOut - 0.1, 0);
      addTo(pv, box(0.14, 0.14, 0.14), mat.emissive, `quorum_light_${k}`, 0, rOut + 1.6, 0);
    });
  }

  // rdzeń (energy 100): kryształ pod pierścieniem
  add(crystal(0.8, 0.4, 1.6 * (CARD.energy / 100)), mat.emissive, 'reactor_core', 0, -hh(zO) + 0.15, zO);

  // ---------- płetwy-radiatory (thermal 50: małe)
  const dih = hawk ? 0.25 : trade ? 0.05 : -0.18;
  [{ z: -12, k: 1 }, { z: -9.2, k: 0.72 }].forEach((fn, j) => {
    for (const s of [-1, 1]) {
      const tag = `${j}_${s > 0 ? 's' : 'p'}`;
      let L = 2.3 * (CARD.thermal / 50) * fn.k * v(0.1);
      let d = dih;
      if (coal && s < 0 && j === 0) { L *= 1 - a * 1.5; d -= a; }
      const pv = node(root, `fin_pivot_${tag}`, s * hw(fn.z), 0, fn.z, 0, s * (Math.PI / 2 + 0.35), s * d, 'ZYX');
      addTo(pv, taperBox(1.8, 0.1, 0.6, 0.06, L, 0), mat.secondary, `fin_${tag}`, 0, 0, L / 2);
      addTo(pv, box(0.07, 0.04, L * 0.7), mat.emissive, `fin_${tag}_vein`, 0, 0.06, L * 0.45);
    }
  });

  // ---------- ładownie (cargo 16)
  const pods = [-10.5].concat(trade ? [-2.5] : []);
  pods.forEach((z, j) => {
    for (const s of [-1, 1]) {
      const tag = `${j}_${s > 0 ? 's' : 'p'}`, x = s * 0.8, y = -hh(z) * 0.72;
      add(hexRod(0.55, 0.55, 3.2), mat.primary, `cargo_${tag}`, x, y, z);
      add(polyRing(0.62, 0.5, 0.1, 6), mat.dark, `cargo_${tag}_seam`, x, y, z + 0.6);
      add(box(0.08, 0.08, 0.05), mat.emissive, `nav_light_${tag}`, x, y - 0.3, z + 1.62);
    }
  });

  // ---------- Przesypiający: narosty kryształów (z asymetrią)
  if (coal) {
    const n = 5 + Math.round(o.wear * 6);
    for (let i = 0; i < n; i++) {
      const s = rA() < 0.5 + a ? -1 : 1, z = lerp(-13.5, 1.5, rA()), t = 0.3 + rA() * 0.6;
      const x = s * t * hw(z), y = hh(z) * (1 - 0.5 * t);
      add(crystal(0.18 + rA() * 0.15, 0.5 + rA() * 0.7, 0.1), mat.glass, `drift_crystal_${i}`, x, y, z, (rA() - 0.5) * 0.6, 0, -s * (facetA + rA() * 0.5));
    }
  }

  // ---------- napęd: sześciokątne dysze
  const eng = [[0, 0.95, 1], [-1.35, -0.55, 1], [1.35, -0.55, 1]].map(([x, y, e]) => [x * rK, y * rK, e * v(0.04)]);
  if (hawk) eng.push([-2.35 * rK, 0.3 * rK, 0.55], [2.35 * rK, 0.3 * rK, 0.55]);
  eng.forEach(([x, y, es], i) => {
    const z0 = zR + 0.3;
    add(hexRod(0.75 * es, 1.0 * es, 1.4 * es), mat.dark, `nozzle_${i}_bell`, x, y, z0 - 0.7 * es);
    add(polyDisc(0.66 * es, 0.05, 6), mat.engine, `nozzle_${i}_glow`, x, y, z0 - 0.35 * es);
    add(polyRing(1.12 * es, 0.97 * es, 0.14, 6), mat.trim, `nozzle_${i}_collar`, x, y, z0 - 1.35 * es);
    hp(root, `hp_engine_${i}`, x, y, z0 - 1.4 * es, Math.PI);
  });
  {
    const rr = rAt(-14.6), m = add(polyRing(rr * 1.02, rr * 0.86, 0.3, 6), mat.trim, 'stern_rim', 0, 0, -14.6);
    m.scale.set(sx, sy, 1);
  }

  // ---------- greeble na górnych ścianach
  const nG = Math.round(6 + 44 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.12 + rD() * 0.3), h = snap(0.04 + rD() * 0.08, 0.01), d = snap(0.2 + rD() * 0.8);
    const s = rD() < 0.5 ? -1 : 1, z = snap(lerp(-14, 2, rD())), t = 0.25 + rD() * 0.6;
    if (Math.abs(z - zO) < 1) continue;
    if (Math.abs(z + 0.8) < 1.3 && t < 0.5) continue;
    const x = s * t * hw(z), y = hh(z) * (1 - 0.5 * t);
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, y, z, 0, 0, -s * facetA);
  }

  // ---------- zużycie
  const nPatch = Math.round(o.wear * 8);
  for (let i = 0; i < nPatch; i++) {
    const s = rW() < 0.5 ? -1 : 1, z = lerp(-13, 2, rW());
    add(box(0.04, 0.2 + rW() * 0.4, 0.3 + rW() * 0.6), mat.dark, `scorch_side_${i}`, s * (hw(z) + 0.1), (rW() - 0.5) * side(z), z);
  }
  const nScorch = Math.round(o.wear * 10);
  for (let i = 0; i < nScorch; i++) {
    const z = lerp(-14.8, -12, rW()), s = rW() < 0.5 ? -1 : 1;
    add(box(0.02, 0.3 + rW() * 0.6, 0.4 + rW() * 1), mat.dark, `scorch_${i}`, s * hw(z) * 1.01, (rW() - 0.5) * side(z), z);
  }

  // ---------- skala do widełek klasy + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = KAMERTON_META.lengthRange;
  const L = clamp(31 * (1 + (rS() - 0.5) * 0.1) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `kamerton_rezonanci_${F}_${o.seed}`;
  group.add(root);
  group.updateMatrixWorld(true);

  const hardpoints = [];
  const wp = new THREE.Vector3();
  group.traverse((n) => {
    if (!n.isMesh && n.name.startsWith('hp_')) {
      n.getWorldPosition(wp);
      hardpoints.push({
        name: n.name,
        position: [r3(wp.x), r3(wp.y), r3(wp.z)],
        axis: n.name.startsWith('hp_engine') ? '-Z' : '+Z',
      });
    }
  });
  hardpoints.sort((p, q) => p.name.localeCompare(q.name));

  group.userData = {
    race: 'rezonanci',
    faction: F,
    factionName: KAMERTON_META.factions[F],
    shipClass: 'fregata',
    name: 'Kamerton',
    seed: o.seed,
    lengthU: r3(L),
    bowAxis: '+Z',
    materialSlots: MAT_SLOTS.slice(),
    hardpoints,
    triangles: countTriangles(group),
    asymmetry: a,
    size: [r3(size.x * k), r3(size.y * k), r3(L)],
  };
  return group;
}

// ------------------------------------------------------------- publiczne
export function countTriangles(obj) {
  let n = 0;
  obj.traverse((m) => {
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}

export function buildKamertonRezonanci(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'rezonanci', 'fregata', o.faction, o.seed,
    r3(o.wear), r3(o.greebleDensity), r3(o.asymmetry), r3(o.lengthScale), o.raceColor, r3(o.emissiveBoost),
  ].join('|');
  let t = _templates.get(key);
  if (!t) { t = buildTemplate(o); _templates.set(key, t); }
  const ship = t.clone();
  if (o.uniqueMaterials) {
    const map = new Map();
    ship.traverse((m) => {
      if (!m.isMesh) return;
      if (!map.has(m.material)) map.set(m.material, m.material.clone());
      m.material = map.get(m.material);
    });
  }
  return ship;
}

export function clearKamertonCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
