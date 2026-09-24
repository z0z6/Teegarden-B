/**
 * kryza_heliotropi.js — „Kryza", niszczyciel Heliotropów (Teegarden-B)
 *
 *   import { buildKryzaHeliotropi } from './kryza_heliotropi.js';
 *   const ship = buildKryzaHeliotropi({ seed: 7, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * KONCEPCJA: słonecznik z gadzią głową. Kadłub to łodyga (wydłużony,
 * spłaszczony trzon z łuskami i grzebieniem), na szyi kryza 13 płatków-
 * radiatorów (thermal 90), dwie pary liści-radiatorów po bokach trzonu.
 * 13 płatków = 13 płatków fałdy „Korona" (warp-drive.js).
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z tyłu — 13-płatkowa rozeta wokół owalnego trzonu i trójki dysz.
 *           Żar: rozeta otwarta; Chłodni: płatki odchylone do tyłu;
 *           Hibernatorzy: zamknięty pąk (mniejsza, kolczasta rozeta).
 *  z góry — długa łodyga, dwie pary liści odchylonych do tyłu, kryza przy
 *           głowie, głowa wystająca przed kryzę.
 *  z boku — smukły trzon z grzebieniem kolców malejącym ku głowie,
 *           tarcza kryzy, klinowata głowa z oczami.
 *
 * ZAKAZY rasy: brak kątów prostych w obrysie głównym (trzon z toczenia,
 * płatki i liście z krzywych); prostopadłościany tylko jako detal.
 */
import * as THREE from 'three';

export const KRYZA_META = {
  id: 'kryza-heliotropi',
  race: 'heliotropi',
  shipClass: 'niszczyciel',
  name: 'Kryza',
  card: { hull: 100, armor: 5, thermal: 90, energy: 95, signature: 55, cargo: 16, slots: 3, hullRegenPct: 0 },
  lengthRange: [42, 50],
  triBudget: 60000,
  raceColor: '#ff9d5c',
  factions: { hawk: 'Żar', trade: 'Chłodni', coalition: 'Hibernatorzy Szlaku' },
  defaultAsymmetry: { hawk: 0.05, trade: 0.05, coalition: 0.3 },
};
const CARD = KRYZA_META.card;
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

function polyRing(rOut, rIn, depth, n = 13) {
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
function polyDisc(r, depth, n = 13) {
  const k = [r, depth, n].map(r3).join('|');
  return cached(`pd|${k}`, () => {
    const g = new THREE.CylinderGeometry(r, r, depth, n, 1);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** Walec wzdłuż Y. */
function cyl(rt, rb, h, n = 10) {
  const k = [rt, rb, h, n].map(r3).join('|');
  return cached(`cy|${k}`, () => new THREE.CylinderGeometry(rt, rb, h, n, 1));
}

function rod(r, h) {
  const k = [r, h].map(r3).join('|');
  return cached(`rd|${k}`, () => new THREE.CylinderGeometry(r, r, h, 4, 1));
}

/** Liść / płatek: kształt w XY (nasada w 0, czubek w +Y), grubość wzdłuż Z. */
function leaf(w, L, depth) {
  const k = [w, L, depth].map(r3).join('|');
  return cached(`lf|${k}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w * 0.16, 0);
    s.quadraticCurveTo(-w * 0.85, L * 0.42, 0, L);
    s.quadraticCurveTo(w * 0.85, L * 0.42, w * 0.16, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Trzon z toczenia: profil [z, r], przekrój owalny sx × sy. */
function spine(prof, segs, sx, sy) {
  const k = prof.map(([z, r]) => `${r3(z)},${r3(r)}`).join(';') + `|${segs}|${r3(sx)}|${r3(sy)}`;
  return cached(`sp|${k}`, () => {
    const g = new THREE.LatheGeometry(prof.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z)), segs);
    g.rotateX(Math.PI / 2); // oś toczenia Y → Z
    g.scale(sx, sy, 1);
    g.computeVertexNormals();
    return g;
  });
}

/** Dzwon dyszy wzdłuż -Z od z=0. */
function bell(es) {
  return cached(`bl|${r3(es)}`, () => {
    const pts = [[0.72, 0], [0.8, 0.45], [0.98, 1.05], [1.22, 1.6]].map(([r, y]) => new THREE.Vector2(r * es, y * es));
    const g = new THREE.LatheGeometry(pts, 14);
    g.rotateX(-Math.PI / 2);
    return g;
  });
}

// ------------------------------------------------------------ materiały
function makeMaterials(o, rng) {
  const race = new THREE.Color(o.raceColor);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const prim = new THREE.Color({ hawk: 0x3b2a20, trade: 0x6a625a, coalition: 0x33373b }[F]);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.16), 0, 1));
  const trim = race.clone().multiplyScalar(coal ? 0.5 : trade ? 0.62 : 0.78);
  const b = o.emissiveBoost;
  const eI = (hawk ? 2.6 : trade ? 1.4 : 1.1) * b;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.4, roughness: coal ? 0.7 : 0.5, side: THREE.DoubleSide }),
    secondary: M('mat_hull_secondary', {
      color: new THREE.Color(trade ? 0x8a8680 : 0x2b2622), metalness: trade ? 0.8 : 0.5, roughness: trade ? 0.25 : 0.6,
      side: THREE.DoubleSide,
    }),
    trim: M('mat_trim_race', { color: trim, metalness: 0.85, roughness: coal ? 0.6 : 0.3, side: THREE.DoubleSide }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x160804), emissive: race, emissiveIntensity: eI, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: new THREE.Color(0x1a0e08), metalness: 0.3, roughness: 0.08, transparent: true, opacity: 0.8,
      emissive: race, emissiveIntensity: 0.22 * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x1c1208), emissive: new THREE.Color(0xfff0c8),
      emissiveIntensity: (hawk ? 3.6 : trade ? 3.0 : 2.0) * b, metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x0e0c0b), metalness: 0.25, roughness: 0.88, side: THREE.DoubleSide }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0xff9d5c;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.5), 0, 1),
    asymmetry: opts.asymmetry == null ? KRYZA_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
const PROFILE = [
  [-21.2, 0.01], [-21, 2.1], [-20.4, 2.9], [-17, 3.3], [-11, 3.05], [-4, 2.65], [2, 2.4], [7, 2.05],
  [10.5, 1.6], [12.5, 1.75], [15.5, 2.05], [18.5, 1.7], [20.8, 1.05], [22, 0.45], [22.4, 0.01],
];

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
  root.name = 'kryza_root';
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

  // ---------- trzon (łodyga)
  const rK = v(0.06), headK = v(0.1);
  const prof = PROFILE.map(([z, r]) => [z, r * rK * (z > 9 ? headK : 1)]);
  const sx = 1.3 * (trade ? 1.12 : 1), sy = 0.85;
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
  const hw = (z) => rAt(z) * sx, hh = (z) => rAt(z) * sy;
  const zR = -21.2, zTip = 22.4;
  add(spine(prof, 16, sx, sy), mat.primary, 'hull_spine');

  // łuski grzbietu (armor 5)
  const tS = 0.08 + 0.012 * CARD.armor * (hawk ? 1.3 : 1);
  for (let z = -19, i = 0; z < 9.6; z += 1.35, i++) {
    if (rW() < o.wear * 0.3) continue;
    add(chamferBox(hw(z) * 0.95, tS, 1.55, 0.05), mat.secondary, `scale_${i}`, 0, hh(z) - 0.02, z, -0.07, 0, 0);
  }

  // grzebień kolców
  const nCrest = hawk ? 11 : 9, zC0 = -17, zC1 = 4.5;
  for (let i = 0; i < nCrest; i++) {
    const t = i / (nCrest - 1), z = lerp(zC0, zC1, t);
    const h = lerp(1.7, 0.7, t) * v(0.08) * (hawk ? 1.2 : coal ? 0.8 : 1);
    const yb = hh(z) + tS * 0.5;
    add(taperBox(0.2, h, 0.06, h * 0.25, 1.5, -h * 0.37), mat.secondary, `crest_${i}`, 0, yb + h / 2, z);
    if (hawk) add(box(0.1, 0.14, 0.24), mat.emissive, `crest_ember_${i}`, 0, yb + h - 0.08, z - 0.6);
  }

  // ---------- głowa
  const zCab = 16.4;
  add(chamferBox(1.2 * headK, 0.4, 2.3, 0.1), mat.glass, 'cockpit_canopy', 0, hh(zCab) - 0.02, zCab, -0.1, 0, 0);
  add(box(1.35 * headK, 0.08, 0.5), mat.trim, 'cockpit_brow', 0, hh(zCab + 1.2) + 0.08, zCab + 1.15, 0.25, 0, 0);
  hp(root, 'hp_cockpit', 0, hh(zCab) + 0.1, zCab);
  {
    const ze = 18.3, ang = Math.atan2(hw(ze - 0.5) - hw(ze + 0.5), 1);
    for (const s of [-1, 1]) {
      const tag = s > 0 ? 'stbd' : 'port', x = s * hw(ze) * 0.93;
      add(box(0.07, 0.42, 0.95), mat.glass, `eye_${tag}`, x, hh(ze) * 0.25, ze, 0, -s * ang, 0);
      add(box(0.08, 0.34, 0.09), mat.emissive, `eye_pupil_${tag}`, x + s * 0.01, hh(ze) * 0.25, ze + 0.05, 0, -s * ang, 0);
      add(box(0.06, 0.08, 1.2), mat.secondary, `eye_ridge_${tag}`, s * hw(ze - 0.1) * 0.95, hh(ze) * 0.25 + 0.3, ze - 0.1, 0, -s * ang, -s * 0.3);
      const zj = 20.2, aj = Math.atan2(hw(zj - 1) - hw(zj + 1), 2);
      add(box(0.05, 0.05, 2.6), mat.dark, `jaw_seam_${tag}`, s * hw(zj) * 0.97, -hh(zj) * 0.28, zj, 0, -s * aj, 0);
    }
  }
  add(polyDisc(0.36 * headK, 0.1, 13), mat.emissive, 'snout_iris', 0, 0, zTip - 0.3);
  hp(root, 'hp_warp_emitter', 0, 0, zTip + 0.1);

  // anteny (signature 55): dwie, odchylone do tyłu
  for (const s of [-1, 1]) {
    const h = 1.2 * v(0.15), z = zCab - 1.6, x = s * 0.35 + (rA() - 0.5) * a * 0.3;
    const tilt = -0.45, y0 = hh(z);
    add(rod(0.03, h), mat.dark, `antenna_${s > 0 ? 's' : 'p'}`, x, y0 + Math.cos(tilt) * h / 2, z + Math.sin(tilt) * h / 2, tilt, 0, 0);
    add(box(0.08, 0.08, 0.08), mat.emissive, `antenna_tip_${s > 0 ? 's' : 'p'}`, x, y0 + Math.cos(tilt) * h, z + Math.sin(tilt) * h);
  }

  // ---------- kryza: 13 płatków-radiatorów
  const N = 13, zN = 11.2, rC = hw(zN) + 0.45;
  add(polyDisc(rC, 0.7, N), mat.primary, 'ruff_collar', 0, 0, zN);
  add(polyRing(rC + 0.16, rC - 0.06, 0.5, N), mat.trim, 'ruff_collar_rim', 0, 0, zN + 0.12);
  add(polyRing(rC - 0.25, rC - 0.42, 0.2, N), mat.emissive, 'ruff_collar_glow', 0, 0, zN + 0.38);
  const tilt0 = { hawk: 0.3, trade: -0.55, coalition: 1.15 }[F] + (rS() - 0.5) * 0.1;
  const Lp = 7.2 * (CARD.thermal / 90) * v(0.08) * (coal ? 0.82 : 1);
  const Wp = 2.9 * v(0.08) * (trade ? 1.08 : 1);
  const r0 = rC - 0.3, a0 = Math.PI / N;
  for (let i = 0; i < N; i++) {
    const ang = a0 + (i * 2 * Math.PI) / N;
    let t = tilt0, L = Lp * (1 + (rS() - 0.5) * 0.08);
    if (a > 0) t += (rA() - 0.5) * a * 0.9;
    const broken = rW() < o.wear * (coal ? 0.3 : 0.15);
    if (broken) L *= 0.38;
    const pv = node(root, `petal_pivot_${i}`, 0, 0, zN, 0, 0, ang);
    const pc = node(pv, `petal_hinge_${i}`, 0, r0, 0, t, 0, 0);
    addTo(pc, leaf(Wp, L, 0.16), mat.trim, `petal_${i}`);
    addTo(pc, box(Wp * 0.4, 0.35, 0.34), mat.dark, `petal_${i}_knuckle`, 0, 0.1, 0);
    if (!broken) addTo(pc, box(0.12, L * 0.78, 0.05), mat.emissive, `petal_${i}_vein`, 0, L * 0.42, 0.1);
    for (let k = 1; k <= 3; k++) {
      if (k * 0.22 * L > L * 0.9) break;
      addTo(pc, box(Wp * 0.55 * (1 - k * 0.18), 0.07, 0.06), mat.dark, `petal_${i}_rib_${k}`, 0, L * k * 0.22, -0.1);
    }
    if (hawk && !broken) addTo(pc, leaf(Wp * 1.1, L * 1.06, 0.08), mat.emissive, `petal_${i}_ember_rim`, 0, -L * 0.02, -0.07);
    if (trade && !broken) addTo(pc, leaf(Wp * 0.6, L * 0.6, 0.04), mat.secondary, `petal_${i}_mirror`, 0, L * 0.15, 0.1);
    if (coal && !broken) {
      addTo(pc, box(Wp * 0.62, 0.05, 0.03), mat.dark, `petal_${i}_quilt_a`, 0, L * 0.35, 0.095);
      addTo(pc, box(Wp * 0.42, 0.05, 0.03), mat.dark, `petal_${i}_quilt_b`, 0, L * 0.6, 0.095);
    }
    if (rW() < o.wear * 0.6) {
      addTo(pc, box(Wp * (0.15 + rW() * 0.25), L * (0.1 + rW() * 0.2), 0.02), mat.dark, `petal_${i}_scorch`,
        (rW() - 0.5) * Wp * 0.3, L * (0.2 + rW() * 0.5), -0.09);
    }
  }

  // ---------- liście-radiatory na łodydze
  const leaves = [{ z: -6.5, L: 8.2, W: 3.3 }, { z: -15, L: 5.8, W: 2.5 }];
  leaves.forEach((lf, j) => {
    for (const s of [-1, 1]) {
      const tag = `${j}_${s > 0 ? 's' : 'p'}`;
      let L = lf.L * (CARD.thermal / 90) * v(0.1) * (1 + (rA() - 0.5) * a * 0.3), W = lf.W * v(0.08);
      let dih = hawk ? 0.18 : 0.1, sweep = 0.5 + (rS() - 0.5) * 0.2 + (trade ? 0.15 : 0);
      if (coal && s < 0 && j === 1) { L *= 1 - a * 1.2; dih = -0.25; }
      const pv = node(root, `leaf_pivot_${tag}`, s * hw(lf.z) * 0.85, -hh(lf.z) * 0.1, lf.z, 0, s * sweep, s * dih);
      const inner = node(pv, `leaf_plane_${tag}`, 0, 0, 0, -Math.PI / 2, -s * Math.PI / 2, 0, 'YXZ');
      addTo(inner, leaf(W, L, 0.14), mat.secondary, `leaf_${tag}`);
      addTo(inner, box(0.1, L * 0.75, 0.04), mat.emissive, `leaf_${tag}_vein`, 0, L * 0.4, 0.09);
      for (let k = 1; k <= 3; k++) addTo(inner, box(W * 0.5 * (1 - k * 0.2), 0.06, 0.05), mat.dark, `leaf_${tag}_rib_${k}`, 0, L * k * 0.2, -0.09);
      addTo(inner, chamferBox(W * 0.38, 0.5, 0.3, 0.06), mat.trim, `leaf_${tag}_root`, 0, 0.2, 0);
    }
  });

  // ---------- baterie salwowe (slots 3)
  const ws = hawk ? 1.12 : trade ? 0.8 : 1;
  const [gc, gr] = hawk ? [4, 3] : trade ? [2, 2] : [3, 2];
  const grid = (cx, cy, zf, w, h, cols, rows, name) => {
    const cw = (w * 0.8) / cols, rh = (h * 0.72) / rows, bs = Math.min(cw, rh) * 0.62;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      add(box(bs, bs, 0.05), mat.dark, `${name}_bore_${c}_${r}`, cx + (c - (cols - 1) / 2) * cw, cy + (r - (rows - 1) / 2) * rh, zf + 0.02);
    }
  };
  let wIdx = 0;
  const zW = 3.8, pw = 1.5 * ws, ph = 1.25 * ws, pd = 3.8 * ws;
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p', x = s * (hw(zW) + pw / 2 - 0.25), y = 0.15, zf = zW + pd / 2;
    add(chamferBox(pw, ph, pd, 0.14), mat.primary, `battery_${tag}`, x, y, zW);
    add(box(pw + 0.06, ph + 0.06, 0.16), mat.trim, `battery_${tag}_band`, x, y, zf - 0.4);
    for (let k = 0; k < 3; k++) add(box(pw * 0.7, 0.05, 0.1), mat.dark, `battery_${tag}_vent_${k}`, x, y + ph / 2 + 0.01, zW - pd * 0.2 + k * 0.3);
    grid(x, y, zf, pw, ph, gc, gr, `battery_${tag}`);
    hp(root, `hp_weapon_${wIdx++}`, x, y, zf + 0.05);
  }
  {
    const zT = 7.4, yT = hh(zT), bw = 1.7 * ws, bh = 0.75 * ws, bd = 2.0 * ws, yB = yT + 0.3 + bh / 2;
    add(cyl(0.95 * ws, 1.15 * ws, 0.4, 10), mat.dark, 'turret_base', 0, yT + 0.1, zT);
    add(chamferBox(bw, bh, bd, 0.1), mat.secondary, 'turret_body', 0, yB, zT);
    add(box(bw + 0.05, 0.08, 0.14), mat.trim, 'turret_band', 0, yB + bh / 2, zT + bd / 2 - 0.3);
    grid(0, yB, zT + bd / 2, bw, bh, hawk ? 4 : 3, 2, 'turret');
    hp(root, `hp_weapon_${wIdx++}`, 0, yB, zT + bd / 2 + 0.05);
  }

  // ---------- ładownie brzuszne (cargo 16)
  const cs = trade ? 1.3 : 1;
  const pods = [{ z: -3 }].concat(trade ? [{ z: -10.5 }] : []);
  pods.forEach((p, j) => {
    for (const s of [-1, 1]) {
      const tag = `${j}_${s > 0 ? 's' : 'p'}`, w = 1.3 * cs, h = 0.9 * cs, d = 5.2 * cs;
      const x = s * hw(p.z) * 0.45, y = -hh(p.z) - h * 0.35;
      add(chamferBox(w, h, d, 0.2), mat.primary, `cargo_${tag}`, x, y, p.z);
      for (let k = 1; k <= 2; k++) add(box(w + 0.02, h + 0.02, 0.04), mat.dark, `cargo_${tag}_seam_${k}`, x, y, p.z - d / 2 + (k * d) / 3);
      add(box(0.08, 0.08, 0.05), mat.emissive, `nav_light_${tag}`, x + s * (w / 2 - 0.1), y, p.z + d / 2 + 0.01);
    }
  });

  // reaktor (energy 95): szczelina na brzuchu
  {
    const z = -12.5, y = -hh(z);
    add(box(1.7, 0.1, 3.4), mat.dark, 'reactor_frame', 0, y - 0.02, z);
    add(box(1.3 * (CARD.energy / 100), 0.12, 2.6), mat.emissive, 'reactor_core', 0, y - 0.03, z);
  }

  // ---------- napęd
  const eng = [[0, 0.95, 1], [-1.55, -0.55, 1], [1.55, -0.55, 1]].map(([x, y, e]) => [x * rK, y * rK, e * v(0.05)]);
  if (hawk) eng.push([-2.75 * rK, 0.55 * rK, 0.6], [2.75 * rK, 0.55 * rK, 0.6]);
  eng.forEach(([x, y, es], i) => {
    const z0 = zR + 0.35;
    add(bell(es), mat.dark, `nozzle_${i}_bell`, x, y, z0);
    add(polyDisc(0.72 * es, 0.05, 14), mat.engine, `nozzle_${i}_glow`, x, y, z0 - 0.1);
    add(polyRing(1.3 * es, 1.16 * es, 0.14, 14), mat.trim, `nozzle_${i}_collar`, x, y, z0 - 1.6 * es + 0.05);
    hp(root, `hp_engine_${i}`, x, y, z0 - 1.6 * es, Math.PI);
  });
  add(polyRing(hw(-20.6) * 0.95, hw(-20.6) * 0.8, 0.3, 13), mat.trim, 'stern_rim', 0, 0, -20.6);

  // ---------- Hibernatorzy: kapsuły snu na burtach
  if (coal) {
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
      const z = -9 + k * 2.6 + (s < 0 ? (rA() - 0.5) * a * 2 : 0), tag = `${s > 0 ? 's' : 'p'}_${k}`;
      const x = s * hw(z) * 0.93, y = hh(z) * 0.3;
      add(chamferBox(0.55, 0.65, 1.4, 0.12), mat.primary, `sleep_pod_${tag}`, x, y, z);
      add(box(0.05, 0.3, 0.85), mat.glass, `sleep_pod_${tag}_window`, x + s * 0.28, y, z);
    }
  }

  // ---------- greeble
  const nG = Math.round(8 + 60 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.1 + rD() * 0.3), h = snap(0.05 + rD() * 0.12, 0.01), d = snap(0.2 + rD() * 0.8);
    let x, y, z;
    if (rD() < 0.7) {
      const s = rD() < 0.5 ? -1 : 1, th = (rD() - 0.5) * 1.1;
      z = snap(lerp(-19, 9, rD()));
      if (Math.abs(z - zW) < pd / 2 + 0.4 || (coal && z > -10 && z < 0)) continue;
      if (leaves.some((lf) => Math.abs(z - lf.z) < 1)) continue;
      x = s * hw(z) * Math.cos(th); y = hh(z) * Math.sin(th);
    } else {
      z = snap(lerp(-19, -8, rD()));
      if (Math.abs(z + 12.5) < 2) continue;
      x = snap((rD() - 0.5) * hw(z) * 0.6); y = -hh(z) - h / 2 + 0.03;
    }
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, y, z);
  }

  // ---------- zużycie: łaty i osmalenia
  const nPatch = Math.round(o.wear * 10) + (coal ? 3 : 0);
  for (let i = 0; i < nPatch; i++) {
    const s = rW() < 0.5 ? -1 : 1, z = lerp(-18, 8, rW()), th = (rW() - 0.5) * 0.8;
    add(chamferBox(0.05, 0.3 + rW() * 0.4, 0.4 + rW() * 0.6, 0.015), mat.secondary, `patch_${i}`,
      s * hw(z) * Math.cos(th) * 1.0, hh(z) * Math.sin(th), z, (rW() - 0.5) * 0.3, 0, 0);
  }
  const nScorch = Math.round(o.wear * 12);
  for (let i = 0; i < nScorch; i++) {
    const z = lerp(-20.5, -14, rW()), s = rW() < 0.5 ? -1 : 1;
    add(box(0.02, 0.3 + rW() * 0.8, 0.5 + rW() * 1.2), mat.dark, `scorch_${i}`, s * hw(z) * 1.005, (rW() - 0.5) * hh(z), z);
  }

  // ---------- skala do widełek klasy + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = KRYZA_META.lengthRange;
  const L = clamp(46 * (1 + (rS() - 0.5) * 0.1) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `kryza_heliotropi_${F}_${o.seed}`;
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
    race: 'heliotropi',
    faction: F,
    factionName: KRYZA_META.factions[F],
    shipClass: 'niszczyciel',
    name: 'Kryza',
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

export function buildKryzaHeliotropi(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'heliotropi', 'niszczyciel', o.faction, o.seed,
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

export function clearKryzaCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
