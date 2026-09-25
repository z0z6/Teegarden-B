/**
 * paragraf_wykonawcy.js — „Paragraf", korweta Wykonawców (Teegarden-B)
 *
 *   import { buildParagrafWykonawcy } from './paragraf_wykonawcy.js';
 *   const ship = buildParagrafWykonawcy({ seed: 9, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * KONCEPCJA: maszyna z portretu rasy (race-portraits.js: płyta twarzowa
 * z wygrawerowanymi wierszami klauzul, wizjer ze skanującym punktem, jedna
 * antena, kratka pod szyją). Kadłub to stalowa tablica o ośmiokątnym
 * przekroju. Grzbiet i burty pokrywają grawerowane wiersze klauzul.
 * Na czole jest wizjer z białym punktem skanującym (visor_scan_dot,
 * zakres ruchu w userData.scanRange). Emiter fałdy „Klauzula" to twarda
 * sześciokątna obręcz wokół kadłuba (warp-drive.js: segs 6, hard 1, twist 0).
 * Broń to impulsowe emitery (weapons.js: wykonawcy → 'pulse'): dwa przy
 * wizjerze i wieżyczka na grzbiecie, razem 3 sloty z karty.
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z tyłu — ośmiokąt kadłuba w sześciokątnej obręczy, dwie kwadratowe dysze.
 *  z góry — prostokątna tablica, obręcz jak pas, lufy przy dziobie, antena z prawej.
 *  z boku — płaski klin z wieżyczką i żebrami radiatorów pod rufą.
 *
 * Stronnictwa: Literaliści (hawk) — gęste, pełne wiersze klauzul, idealna
 * symetria, trzecia dysza, dodatkowe płyty pancerza. Duchowi (trade) — jasna
 * stal, wiersze rzadkie, przygaszony wizjer, cieńsza obręcz. Rewizjoniści
 * (coalition) — ciemna stal, klauzule przekreślone na czerwono (jak na
 * portrecie), obręcz i wieżyczka przekręcone, asymetria 0.15.
 */
import * as THREE from 'three';

export const PARAGRAF_META = {
  id: 'paragraf-wykonawcy',
  race: 'wykonawcy',
  shipClass: 'korweta',
  name: 'Paragraf',
  card: { hull: 105, armor: 6, thermal: 55, energy: 105, signature: 50, cargo: 15, slots: 3, hullRegenPct: 0 },
  lengthRange: [20, 24],
  triBudget: 25000,
  raceColor: '#9fb4c8',
  factions: { hawk: 'Literaliści', trade: 'Duchowi', coalition: 'Rewizjoniści' },
  defaultAsymmetry: { hawk: 0, trade: 0.03, coalition: 0.15 },
};
const CARD = PARAGRAF_META.card;
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
function chamferBox(w, h, d, c = 0.12) {
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
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: c, bevelSize: c, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}
/** Walec/stożek ścięty wzdłuż Z: rt = przód (+Z), rb = tył. */
function rod(rt, rb, len, seg = 12) {
  const k = [rt, rb, len, seg].map(r3).join('|');
  return cached(`rd|${k}`, () => {
    const g = new THREE.CylinderGeometry(rt, rb, len, seg, 1);
    g.rotateX(Math.PI / 2);
    return g;
  });
}
function disc(r, t, seg = 8) {
  const k = [r, t, seg].map(r3).join('|');
  return cached(`dc|${k}`, () => new THREE.CylinderGeometry(r, r, t, seg, 1));
}
function ico(r, detail = 1) {
  return cached(`ic|${r3(r)}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
}
/** Pierścień n-kąta wzdłuż Z (pierwszy wierzchołek u góry). */
function polyRing(rOut, rIn, depth, n) {
  const k = [rOut, rIn, depth, n].map(r3).join('|');
  return cached(`pr|${k}`, () => {
    const s = new THREE.Shape(), hole = new THREE.Path();
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / n, fn = i ? 'lineTo' : 'moveTo';
      s[fn](Math.cos(a) * rOut, Math.sin(a) * rOut);
      hole[fn](Math.cos(a) * rIn, Math.sin(a) * rIn);
    }
    s.closePath(); hole.closePath(); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}
/** Loft ośmiokątnych przekrojów [z, półszer., półwys., fazka], ścianki płaskie, zamknięte końce. */
function loft(secs) {
  const k = secs.map((s) => s.map(r3).join(',')).join(';');
  return cached(`lf|${k}`, () => {
    const ring = ([z, w, h, c]) => [
      [-w + c, -h], [w - c, -h], [w, -h + c], [w, h - c], [w - c, h], [-w + c, h], [-w, h - c], [-w, -h + c],
    ].map(([x, y]) => [x, y, z]);
    const R = secs.map(ring), pos = [];
    const tri = (a, b, c) => pos.push(...a, ...b, ...c);
    for (let i = 0; i < R.length - 1; i++) {
      for (let j = 0; j < 8; j++) {
        const a = R[i][j], b = R[i][(j + 1) % 8], c = R[i + 1][(j + 1) % 8], d = R[i + 1][j];
        tri(a, b, c); tri(a, c, d);
      }
    }
    const cap = (r, flip) => {
      const c = [0, 0, r[0][2]];
      for (let j = 0; j < 8; j++) flip ? tri(c, r[(j + 1) % 8], r[j]) : tri(c, r[j], r[(j + 1) % 8]);
    };
    cap(R[0], false); cap(R[R.length - 1], true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------ materiały
function makeMaterials(o, rng) {
  const race = new THREE.Color(o.raceColor);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const prim = new THREE.Color({ hawk: 0x8e9aa8, trade: 0xb9c3cd, coalition: 0x5d6773 }[F]);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.12), 0, 1));
  const trim = coal ? new THREE.Color(0xc0483a) : race.clone().multiplyScalar(hawk ? 0.85 : 1.05);
  const glow = race.clone().lerp(new THREE.Color(0xe8f4ff), 0.4);
  const b = o.emissiveBoost;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.75, roughness: coal ? 0.5 : 0.32, side: THREE.DoubleSide }),
    secondary: M('mat_hull_secondary', {
      color: new THREE.Color({ hawk: 0x2e3a4a, trade: 0x4a5868, coalition: 0x262d36 }[F]), metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide,
    }),
    trim: M('mat_trim_race', { color: trim, metalness: coal ? 0.2 : 0.7, roughness: coal ? 0.6 : 0.3, side: THREE.DoubleSide }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x070b10), emissive: glow, emissiveIntensity: (hawk ? 2.0 : trade ? 0.9 : 1.6) * b, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: new THREE.Color(0x05080c), metalness: 0.4, roughness: 0.06, transparent: true, opacity: 0.7,
      emissive: glow, emissiveIntensity: 0.15 * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x0b0e12), emissive: new THREE.Color(0xffffff),
      emissiveIntensity: (hawk ? 3.0 : trade ? 2.2 : 2.6) * b, metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x070b10), metalness: 0.3, roughness: 0.85, side: THREE.DoubleSide }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0x9fb4c8;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.4), 0, 1),
    asymmetry: opts.asymmetry == null ? PARAGRAF_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
const SECS = [
  [-12, 4.2, 2.6, 0.6], [-9, 5.0, 3.0, 0.7], [2, 5.2, 3.2, 0.8], [8, 4.6, 2.8, 0.8], [11, 3.4, 2.0, 0.6], [12, 2.7, 1.5, 0.4],
];

function buildTemplate(o) {
  const rS = mulberry32(hash(o.seed, 1));
  const rD = mulberry32(hash(o.seed, 2));
  const rW = mulberry32(hash(o.seed, 3));
  const rA = mulberry32(hash(o.seed, 4));
  const rM = mulberry32(hash(o.seed, 5));
  const rE = mulberry32(hash(o.seed, 6));
  const mat = makeMaterials(o, rM);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const a = o.asymmetry;
  const v = (amt) => 1 + (rS() - 0.5) * 2 * amt;

  const root = new THREE.Group();
  root.name = 'paragraf_root';
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
  const node = (parent, name, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const n = new THREE.Group();
    n.name = name; n.position.set(x, y, z); n.rotation.set(rx, ry, rz);
    parent.add(n);
    return n;
  };
  const hp = (parent, name, x, y, z, axis = '+Z') => {
    const h = new THREE.Object3D();
    h.name = name; h.position.set(x, y, z); h.userData.axis = axis;
    if (axis === '-Z') h.rotation.y = Math.PI;
    parent.add(h);
    return h;
  };

  // ---------- kadłub-tablica
  const kw = v(0.04), kh = v(0.04);
  const secs = SECS.map(([z, w, h, c]) => [z, w * kw, h * kh, c]);
  const at = (z, i) => {
    if (z <= secs[0][0]) return secs[0][i];
    for (let j = 1; j < secs.length; j++) {
      if (z <= secs[j][0]) return lerp(secs[j - 1][i], secs[j][i], (z - secs[j - 1][0]) / (secs[j][0] - secs[j - 1][0]));
    }
    return secs[secs.length - 1][i];
  };
  const hw = (z) => at(z, 1), hh = (z) => at(z, 2);
  add(loft(secs), mat.primary, 'hull_tablet');

  // nity w narożnikach grzbietu (jak na portrecie)
  for (const [x, z] of [[-1, -10], [1, -10], [-1, 9.5], [1, 9.5]]) {
    add(disc(0.2, 0.08, 6), mat.dark, `rivet_${z > 0 ? 'f' : 'a'}${x > 0 ? 's' : 'p'}`, x * (hw(z) - 0.9), hh(z) + 0.02, z);
  }

  // ---------- wizjer ze skanującym punktem
  const zF = 12.05;
  add(box(hw(12) * 2 - 0.4, 0.75, 0.25), mat.dark, 'visor_slot', 0, 0.25, zF + 0.05);
  add(box(hw(12) * 2 - 0.7, 0.16, 0.06), mat.emissive, 'visor_line', 0, 0.25, zF + 0.2);
  add(box(hw(12) * 2 - 0.4, 0.75, 0.08), mat.glass, 'visor_glass', 0, 0.25, zF + 0.22);
  const scanR = hw(12) - 0.7, scanX = lerp(-scanR, scanR, rS());
  add(ico(0.28, 1), mat.engine, 'visor_scan_dot', scanX, 0.25, zF + 0.24);
  for (const s of [-1, 1]) add(box(0.1, 0.5, 2.2), mat.dark, `visor_wrap_${s > 0 ? 's' : 'p'}`, s * (hw(11) + 0.02), 0.25, 11);
  hp(root, 'hp_cockpit', 0, 0.25, 10.5);
  // kratka pod szyją = radiatory (thermal 55)
  const nFin = Math.round(5 * CARD.thermal / 55);
  for (let k = 0; k < nFin; k++) {
    const z = -10.2 + k * 1.2;
    if (rW() < o.wear * 0.2) continue;
    add(box(hw(z) * 1.3, 0.6, 0.22), mat.secondary, `radiator_fin_${k}`, 0, -hh(z) - 0.25, z);
    add(box(hw(z) * 1.1, 0.08, 0.5), mat.emissive, `radiator_fin_${k}_glow`, 0, -hh(z) - 0.02, z + 0.6);
  }

  // ---------- wiersze klauzul (grawer)
  const dense = hawk ? [0.25, 0.4] : trade ? [0.9, 1.4] : [0.3, 0.6];
  const engrave = (tag, place, zs, ze, avoid) => {
    let z = zs, n = 0;
    while (z < ze) {
      const len = 0.4 + rE() * 2.0, gap = dense[0] + rE() * dense[1];
      if (z + len > ze) break;
      const zc = z + len / 2;
      if (!(avoid && avoid(z, z + len)) && rW() > o.wear * 0.15) place(`clause_${tag}_${n++}`, zc, len);
      z += len + gap;
    }
    if (coal && rA() < 0.6) place(`clause_${tag}_struck`, (zs + ze) / 2, ze - zs, true);
  };
  const topXs = [-1.9, -0.65, 0.65, 1.9].map((x) => x * kw);
  topXs.forEach((x, r) => {
    const avoid = Math.abs(x) < 1.4 ? (z0, z1) => z1 > -3.6 && z0 < -0.4 : null;
    engrave(`top_${r}`, (name, zc, len, struck) => {
      add(box(struck ? 0.1 : 0.18, struck ? 0.1 : 0.06, len), struck ? mat.trim : mat.dark, name, x, hh(zc) + (struck ? 0.05 : 0.01), zc);
    }, -5.8, 7.6, avoid);
  });
  for (const s of [-1, 1]) {
    [0.4, 1.0, 1.6].forEach((y, r) => {
      engrave(`flank_${s > 0 ? 's' : 'p'}_${r}`, (name, zc, len, struck) => {
        add(box(struck ? 0.1 : 0.06, struck ? 0.08 : 0.16, len), struck ? mat.trim : mat.dark, name, s * (hw(zc) + (struck ? 0.05 : 0.01)), y * kh, zc);
      }, -5.6, 6.8);
    });
  }

  // ---------- impulsowe emitery przy wizjerze (hp_weapon_0/1)
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p', x = s * (hw(8) + 0.45), y = -0.5, z = 8;
    add(chamferBox(0.9, 0.9, 3, 0.15), mat.secondary, `pulse_${tag}_mount`, s * (hw(8) + 0.15), y, z - 0.5);
    add(rod(0.3, 0.36, 4.2, 10), mat.primary, `pulse_${tag}_barrel`, x, y, z + 1.6);
    for (let k = 0; k < 3; k++) add(disc(0.48, 0.18, 10), mat.trim, `pulse_${tag}_coil_${k}`, x, y, z + 0.6 + k * 0.9, Math.PI / 2);
    add(disc(0.26, 0.05, 10), mat.emissive, `pulse_${tag}_muzzle`, x, y, z + 3.72, Math.PI / 2);
    hp(root, `hp_weapon_${s < 0 ? 0 : 1}`, x, y, z + 3.9);
  }

  // ---------- wieżyczka impulsowa na grzbiecie (hp_weapon_2)
  const zT = -2, yT = hh(zT);
  const tur = node(root, 'turret_pivot', 0, yT, zT, 0, coal ? (rA() - 0.5) * a * 2.4 : 0, 0);
  addTo(tur, disc(1.15, 0.4, 6), mat.secondary, 'turret_base', 0, 0.2, 0);
  addTo(tur, chamferBox(1.5, 0.75, 1.9, 0.2), mat.primary, 'turret_body', 0, 0.75, 0);
  for (const s of [-1, 1]) {
    addTo(tur, rod(0.13, 0.16, 2.6, 8), mat.secondary, `turret_barrel_${s > 0 ? 's' : 'p'}`, s * 0.38, 0.75, 2.1);
    addTo(tur, disc(0.12, 0.05, 8), mat.emissive, `turret_barrel_${s > 0 ? 's' : 'p'}_tip`, s * 0.38, 0.75, 3.42, Math.PI / 2);
  }
  addTo(tur, box(1.2, 0.08, 0.1), mat.emissive, 'turret_slit', 0, 0.9, 0.96);
  hp(tur, 'hp_weapon_2', 0, 0.75, 3.6);

  // ---------- antena (czujniki 7)
  const zA = -6.5, xA = hw(zA) - 1.0;
  const Lm = 3.6 * v(0.08) * (coal ? 1 - a * 0.8 : 1);
  add(box(0.6, 0.3, 0.6), mat.secondary, 'mast_base', xA, hh(zA) + 0.15, zA);
  add(rod(0.06, 0.1, Lm, 5), mat.secondary, 'mast', xA + Math.sin(0.35) * Lm / 2, hh(zA) + Math.cos(0.35) * Lm / 2, zA, -Math.PI / 2, 0, -0.35);
  const tipX = xA + Math.sin(0.35) * Lm, tipY = hh(zA) + Math.cos(0.35) * Lm;
  add(ico(0.22, 1), mat.emissive, 'mast_tip', tipX, tipY, zA);
  hp(root, 'hp_sensor_mast', tipX, tipY + 0.2, zA, '+Y');

  // ---------- obręcz fałdy „Klauzula" (sześciokąt, twarda)
  const zH = -7.2, R = 7.0 * kw, sq = 0.72 * kh / kw;
  const hoopRoll = coal ? (rA() - 0.5) * 2 * a * 0.35 : 0;
  const hoop = node(root, 'warp_hoop', 0, 0, zH, 0, 0, hoopRoll);
  const ring = node(hoop, 'warp_hoop_ring', 0, 0, 0);
  ring.scale.set(1, sq, 1);
  const tH = trade ? 0.55 : 0.8;
  addTo(ring, polyRing(R, R - tH, 1.3, 6), mat.secondary, 'warp_hoop_frame');
  addTo(ring, polyRing(R - tH + 0.02, R - tH - 0.14, 0.9, 6), mat.emissive, 'warp_hoop_edge');
  const flat = R * Math.cos(Math.PI / 6);
  for (const s of [-1, 1]) {
    const x0 = hw(zH), x1 = flat - tH * 0.5;
    addTo(hoop, box(x1 - x0 + 0.2, 0.7, 0.9), mat.secondary, `warp_pylon_${s > 0 ? 's' : 'p'}`, s * (x0 + x1) / 2, 0, 0);
  }
  for (const s of [-1, 1]) {
    const y0 = hh(zH), y1 = (R - tH * 0.6) * sq;
    addTo(hoop, box(0.7, y1 - y0 + 0.2, 0.9), mat.secondary, `warp_pylon_${s > 0 ? 'd' : 'v'}`, 0, s * (y0 + y1) / 2, 0);
  }
  hp(hoop, 'hp_warp_emitter', 0, 0, 0.8);

  // ---------- pancerz (armor 6) i ładownia (cargo 15)
  const plates = hawk ? [-4.8, -0.6, 3.6, 6.9] : [-4.2, 0, 4.2];
  plates.forEach((z, i) => {
    for (const s of [-1, 1]) add(chamferBox(0.32, 1.6 * kh, 3.6, 0.1), mat.secondary, `armor_${s > 0 ? 's' : 'p'}_${i}`, s * (hw(z) + 0.14), -1.2 * kh, z);
  });
  const Lc = 4 * (CARD.cargo / 15);
  add(chamferBox(3.2, 0.7, Lc, 0.2), mat.secondary, 'cargo_bay', 0, -hh(4) - 0.3, 3);
  add(box(3.3, 0.06, 0.1), mat.dark, 'cargo_bay_seam', 0, -hh(4) - 0.66, 3);

  // ---------- napęd: kwadratowe dysze
  const zN = -12;
  const eng = [[-1.9, 0, 1], [1.9, 0, 1]];
  if (hawk) eng.push([0, 1.3, 0.55]);
  eng.forEach(([x, y, s], i) => {
    x *= kw; y *= kh;
    add(chamferBox(2.4 * s, 1.8 * s, 1.4, 0.15), mat.dark, `nozzle_${i}_housing`, x, y, zN - 0.6);
    add(box(2.0 * s, 1.4 * s, 0.05), mat.engine, `nozzle_${i}_glow`, x, y, zN - 1.1);
    add(polyRing(1.45 * s, 1.15 * s, 0.3, 4), mat.trim, `nozzle_${i}_frame`, x, y, zN - 1.3, 0, 0, Math.PI / 4);
    hp(root, `hp_engine_${i}`, x, y, zN - 1.5, '-Z');
  });

  // ---------- greeble (signature 50): panele serwisowe na tyle grzbietu i spodzie
  const nG = Math.round(6 + 26 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.3 + rD() * 0.9), h = snap(0.08 + rD() * 0.16, 0.02), d = snap(0.4 + rD() * 1.4);
    const top = rD() < 0.55;
    const z = top ? snap(lerp(-11, -8.2, rD())) : snap(lerp(-6, 9, rD()));
    const x = snap((rD() - 0.5) * 2 * (hw(z) - 1.2));
    if (!top && z > 0.5 && z < 5.5 && Math.abs(x) < 2) continue;
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, top ? hh(z) + h / 2 : -hh(z) - h / 2, z);
  }

  // ---------- zużycie
  const nScorch = Math.round(o.wear * 12);
  for (let i = 0; i < nScorch; i++) {
    const z = lerp(-11, 10, rW()), s = rW() < 0.5 ? -1 : 1;
    add(box(0.04, 0.4 + rW() * 1.0, 0.6 + rW() * 2), mat.dark, `scorch_${i}`, s * (hw(z) + 0.02), (rW() - 0.5) * hh(z), z);
  }

  // ---------- skala + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = PARAGRAF_META.lengthRange;
  const L = clamp(22 * (1 + (rS() - 0.5) * 0.1) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `paragraf_wykonawcy_${F}_${o.seed}`;
  group.add(root);
  group.updateMatrixWorld(true);

  const hardpoints = [];
  const wp = new THREE.Vector3();
  group.traverse((n) => {
    if (!n.isMesh && n.name.startsWith('hp_')) {
      n.getWorldPosition(wp);
      hardpoints.push({ name: n.name, position: [r3(wp.x), r3(wp.y), r3(wp.z)], axis: n.userData.axis || '+Z' });
    }
  });
  hardpoints.sort((p, q) => p.name.localeCompare(q.name, 'en', { numeric: true }));

  group.userData = {
    race: 'wykonawcy',
    faction: F,
    factionName: PARAGRAF_META.factions[F],
    shipClass: 'korweta',
    name: 'Paragraf',
    seed: o.seed,
    lengthU: r3(L),
    bowAxis: '+Z',
    materialSlots: MAT_SLOTS.slice(),
    hardpoints,
    triangles: countTriangles(group),
    asymmetry: a,
    scanRange: [r3(-scanR), r3(scanR)],
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

export function buildParagrafWykonawcy(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'wykonawcy', 'korweta', o.faction, o.seed,
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

export function clearParagrafCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
