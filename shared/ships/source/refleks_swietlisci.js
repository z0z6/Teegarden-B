/**
 * refleks_swietlisci.js — „Refleks", zwiadowca Świetlistych (Teegarden-B)
 *
 *   import { buildRefleksSwietlisci } from './refleks_swietlisci.js';
 *   const ship = buildRefleksSwietlisci({ seed: 5, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * KONCEPCJA: półprzezroczysta istota z portretu rasy (race-portraits.js:
 * skóra przezroczysta, bioluminescencyjne wzory, maska zależna od
 * stronnictwa). Kadłub to ciemny rdzeń w przezroczystej powłoce, a po
 * powłoce biegną świecące żyły (inny układ dla każdego seeda). Na dziobie jest
 * trójgraniasty pryzmat, czyli emiter fałdy „Pryzmat" (warp-drive.js:
 * chroma 1.0, twist 0.6). Bronią są rzutki (weapons.js: swietlisci → 'dart'):
 * cztery igły, dwie na końcach skrzydeł i dwie pod brzuchem (4 sloty z karty).
 * Mało ciepła do oddania (thermal 40), więc dysze są małe.
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z góry — wrzeciono ze skośnymi skrzydłami i igłami, pryzmat przed dziobem.
 *  z boku — smukła kropla, maska na czole (Czerwone Maski) albo na brodzie (Dziedzice).
 *  z tyłu — płaski owal ze skrzydłami, trójkąt pryzmatu w środku.
 *
 * Stronnictwa: Czerwone Maski (hawk) — czerwona maska na górnej połowie
 * dziobu z otworami na oczy. Prawdziwe Skóry (trade) — bez maski, najwięcej
 * żył, najjaśniejszy blask. Dziedzice (coalition) — złota maska na dolnej
 * połowie dziobu, złote krawędzie skrzydeł, mniej żył.
 */
import * as THREE from 'three';

export const REFLEKS_META = {
  id: 'refleks-swietlisci',
  race: 'swietlisci',
  shipClass: 'zwiadowca',
  name: 'Refleks',
  card: { hull: 90, armor: 4, thermal: 40, energy: 100, signature: 50, cargo: 14, slots: 4, hullRegenPct: 0 },
  lengthRange: [16, 19],
  triBudget: 20000,
  raceColor: '#5ff0e0',
  factions: { hawk: 'Czerwone Maski', trade: 'Prawdziwe Skóry', coalition: 'Dziedzice' },
  defaultAsymmetry: { hawk: 0.05, trade: 0.05, coalition: 0.08 },
};
const CARD = REFLEKS_META.card;
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
const Y_UP = new THREE.Vector3(0, 1, 0);

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
/** Stożek z czubkiem w +Z. */
function coneZ(r, h, seg = 8) {
  const k = [r, h, seg].map(r3).join('|');
  return cached(`cz|${k}`, () => {
    const g = new THREE.ConeGeometry(r, h, seg, 1);
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
/** Bryła z toczenia wzdłuż Z, przekrój eliptyczny; phi = wycinek obwodu (góra: π/2..3π/2). */
function body(prof, sx, sy, seg = 16, phiStart = 0, phiLength = Math.PI * 2) {
  const k = prof.map(([z, r]) => `${r3(z)},${r3(r)}`).join(';') + `|${r3(sx)}|${r3(sy)}|${seg}|${r3(phiStart)}|${r3(phiLength)}`;
  return cached(`bd|${k}`, () => {
    const g = new THREE.LatheGeometry(prof.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z)), seg, phiStart, phiLength);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    g.computeVertexNormals();
    return g;
  });
}
/** Rura po krzywej Béziera. */
function quill(p0, p1, p2, r, seg = 10) {
  const k = [...p0, ...p1, ...p2, r, seg].map(r3).join('|');
  return cached(`ql|${k}`, () => {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...p0), new THREE.Vector3(...p1), new THREE.Vector3(...p2));
    return new THREE.TubeGeometry(c, seg, r, 5, false);
  });
}
/** Skrzydło: kształt w (u na zewnątrz, v wzdłuż Z), grubość t w Y. */
function wingGeo(pts, t) {
  const k = pts.map(([u, v]) => `${r3(u)},${r3(v)}`).join(';') + `|${r3(t)}`;
  return cached(`wg|${k}`, () => {
    const s = new THREE.Shape();
    pts.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(Math.PI / 2);
    g.translate(0, t / 2, 0);
    g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------ materiały
function makeMaterials(o, rng) {
  const race = new THREE.Color(o.raceColor);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const prim = new THREE.Color({ hawk: 0x0a1420, trade: 0x10283a, coalition: 0x14202a }[F]);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.2), 0, 1));
  const glow = race.clone();
  glow.getHSL(hsl); glow.setHSL(hsl.h + (rng() - 0.5) * 0.03, hsl.s, hsl.l);
  const trim = hawk ? new THREE.Color(0xb8202c) : coal ? new THREE.Color(0xd6a93e) : race.clone().multiplyScalar(0.7);
  const b = o.emissiveBoost;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }),
    secondary: M('mat_hull_secondary', {
      color: new THREE.Color({ hawk: 0x1a2a38, trade: 0x21465a, coalition: 0x2b3440 }[F]), metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide,
    }),
    trim: M('mat_trim_race', { color: trim, metalness: coal ? 0.9 : 0.4, roughness: coal ? 0.25 : 0.45, side: THREE.DoubleSide }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x03100e), emissive: glow, emissiveIntensity: (hawk ? 1.8 : trade ? 2.4 : 1.4) * b, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: race.clone().lerp(new THREE.Color(0x0b1c2c), 0.7), metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.42,
      depthWrite: false, side: THREE.DoubleSide, emissive: glow, emissiveIntensity: 0.12 * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x0a1016), emissive: new THREE.Color(0xffffff),
      emissiveIntensity: (hawk ? 2.6 : trade ? 3.0 : 2.2) * b, metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x05101a), metalness: 0.25, roughness: 0.85, side: THREE.DoubleSide }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0x5ff0e0;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.4), 0, 1),
    asymmetry: opts.asymmetry == null ? REFLEKS_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
const CORE = [[-8.5, 0.01], [-8, 0.7], [-5, 1.3], [0, 1.6], [5, 1.4], [8, 0.9], [9.5, 0.4], [9.8, 0.01]];
const SKIN = [[-10.5, 0.01], [-10, 0.9], [-7, 1.9], [-2, 2.4], [3, 2.3], [7, 1.8], [9.5, 1.1], [10.6, 0.5], [10.9, 0.01]];
const SK = { sx: 1.3, sy: 0.78 }, CK = { sx: 1.1, sy: 0.85 };

function buildTemplate(o) {
  const rS = mulberry32(hash(o.seed, 1));
  const rD = mulberry32(hash(o.seed, 2));
  const rW = mulberry32(hash(o.seed, 3));
  const rA = mulberry32(hash(o.seed, 4));
  const rM = mulberry32(hash(o.seed, 5));
  const rV = mulberry32(hash(o.seed, 6));
  const mat = makeMaterials(o, rM);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const a = o.asymmetry;
  const v = (amt) => 1 + (rS() - 0.5) * 2 * amt;

  const root = new THREE.Group();
  root.name = 'refleks_root';
  const addTo = (parent, geo, m, name, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = m !== mat.glass;
    mesh.receiveShadow = true;
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
  const alignY = (mesh, dir) => { mesh.quaternion.setFromUnitVectors(Y_UP, dir.clone().normalize()); return mesh; };

  // ---------- rdzeń i przezroczysta powłoka
  const rK = v(0.04);
  const skin = SKIN.map(([z, r]) => [z, r * rK]);
  const core = CORE.map(([z, r]) => [z, r * rK]);
  const rAt = (z) => {
    if (z <= skin[0][0]) return 0;
    for (let i = 1; i < skin.length; i++) {
      if (z <= skin[i][0]) { const [z0, r0] = skin[i - 1], [z1, r1] = skin[i]; return lerp(r0, r1, (z - z0) / (z1 - z0)); }
    }
    return 0;
  };
  const hw = (z) => rAt(z) * SK.sx, hh = (z) => rAt(z) * SK.sy;
  const surf = (z, th, out = 0) => {
    const A = hw(z), B = hh(z);
    const n = new THREE.Vector3(Math.cos(th) * B, Math.sin(th) * A, 0).normalize();
    return { p: new THREE.Vector3(Math.cos(th) * A + n.x * out, Math.sin(th) * B + n.y * out, z), n };
  };
  add(body(core, CK.sx, CK.sy, 14), mat.primary, 'hull_core');
  add(body(skin, SK.sx, SK.sy, 20), mat.glass, 'hull_skin');
  // organy świetlne w rdzeniu (widoczne przez powłokę)
  [-4, 0.5, 5].forEach((z, i) => {
    const r = [0.45, 0.6, 0.4][i] * rK;
    add(ico(r, 1), mat.emissive, `core_organ_${i}`, 0, lerp(core[3][1], core[5][1], 0.3) * CK.sy * 0.95, z);
  });

  // ---------- bioluminescencyjne żyły na powłoce
  const nV = hawk ? 7 : trade ? 12 : 6;
  for (let i = 0; i < nV; i++) {
    const z0 = lerp(-8, 8, rV()), th0 = rV() * Math.PI * 2;
    const z2 = clamp(z0 + (rV() - 0.5) * 8, -9, 9.5), th2 = th0 + (rV() - 0.5) * 1.2;
    const zm = (z0 + z2) / 2, thm = (th0 + th2) / 2 + (rV() - 0.5) * 0.8;
    const P0 = surf(z0, th0, -0.02).p, P2 = surf(z2, th2, -0.02).p, P1 = surf(zm, thm, 0.25).p;
    add(quill(P0.toArray(), P1.toArray(), P2.toArray(), 0.05 * rK, 10), mat.emissive, `vein_${i}`);
  }

  // ---------- maska stronnictwa i oczy
  const maskProf = skin.filter(([z]) => z >= 3 && z <= 9.6).map(([z, r]) => [z, r * 1.06 + 0.05]);
  const zEye = 7, xEye = 0.95 * rK;
  if (hawk) {
    add(body(maskProf, SK.sx, SK.sy, 12, Math.PI / 2, Math.PI), mat.trim, 'mask_red');
  } else if (coal) {
    add(body(maskProf, SK.sx, SK.sy, 12, -Math.PI / 2, Math.PI), mat.trim, 'mask_gold');
    for (let k = 0; k < 2; k++) add(box(1.6 * rK, 0.08, 0.1), mat.dark, `mask_gold_groove_${k}`, 0, -hh(5.5 + k * 1.3) * 1.06 - 0.06, 5.5 + k * 1.3);
    add(ico(0.18, 0), mat.engine, 'mask_gold_jewel', 0, -hh(8.3) * 1.06 - 0.1, 8.3);
  }
  const yEye = hh(zEye) * (hawk ? 1.06 : 1) + (hawk ? 0.08 : 0.02);
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p';
    if (hawk) add(ico(0.5, 1), mat.dark, `eye_${tag}_hole`, s * xEye, yEye - 0.08, zEye).scale.set(1.3, 0.3, 0.75);
    add(ico(0.42, 1), mat.emissive, `eye_${tag}`, s * xEye, yEye, zEye, 0, s * 0.25, 0).scale.set(1.3, 0.28, 0.7);
  }
  hp(root, 'hp_cockpit', 0, core[5][1] * CK.sy, 6);
  hp(root, 'hp_sensor_eyes', 0, yEye, zEye + 0.6);

  // ---------- pryzmat = emiter fałdy „Pryzmat"
  const Rp = 0.85 * v(0.05), Lp = 2.8 * v(0.05), zP = 10.5 + Lp / 2;
  add(disc(0.62, 0.3, 12), mat.trim, 'prism_collar', 0, 0, 10.55, Math.PI / 2);
  add(rod(Rp, Rp, Lp, 3), mat.glass, 'prism', 0, 0, zP, 0, 0, Math.PI);
  add(rod(0.22, 0.22, Lp + 0.3, 3), mat.engine, 'prism_core', 0, 0, zP, 0, 0, Math.PI);
  hp(root, 'hp_warp_emitter', 0, 0, zP + Lp / 2 + 0.2);

  // ---------- skrzydła z igłami (hp_weapon_0/1)
  const S = 4.0 * v(0.06);
  const zW = -1, yW = -0.3;
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p';
    const Sw = S * (s < 0 ? 1 + (rA() - 0.5) * a * 0.6 : 1);
    const pts = [[0, 2.5], [Sw * 0.95, -3], [Sw * 1.05, -5.2], [Sw * 0.8, -4.6], [0, -4.5]];
    const wn = node(root, `wing_pivot_${tag}`, s * hw(zW) * 0.72, yW, zW, 0, 0, s * -0.06);
    wn.scale.x = s;
    addTo(wn, wingGeo(pts, 0.12), mat.glass, `wing_${tag}`);
    const eL = Math.hypot(Sw * 0.95, 5.5), eA = Math.atan2(Sw * 0.95, 5.5);
    addTo(wn, box(0.07, 0.1, eL), coal ? mat.trim : mat.emissive, `wing_${tag}_edge`, Sw * 0.475, 0, -0.25, 0, eA, 0);
    addTo(wn, box(0.05, 0.08, 3.6), mat.emissive, `wing_${tag}_vein`, Sw * 0.5, 0.03, -3, 0, 0.15, 0);
    const uT = Sw * 1.0, vT = -3.8;
    addTo(wn, rod(0.07, 0.16, 3.4, 6), mat.secondary, `dart_${tag}_needle`, uT, 0, vT + 1.5);
    addTo(wn, coneZ(0.08, 0.5, 6), mat.emissive, `dart_${tag}_tip`, uT, 0, vT + 3.45);
    addTo(wn, disc(0.24, 0.16, 8), mat.trim, `dart_${tag}_collar`, uT, 0, vT + 0.2, Math.PI / 2);
    hp(wn, `hp_weapon_${s < 0 ? 0 : 1}`, uT, 0, vT + 3.8);
  }

  // ---------- igły pod brzuchem (hp_weapon_2/3)
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p', x = s * 0.9 * rK, z = 4, y = -hh(z) * Math.sqrt(1 - (x / hw(z)) ** 2) - 0.2;
    add(box(0.18, 0.35, 2.2), mat.secondary, `dart_belly_${tag}_pylon`, x, y + 0.15, z - 0.6);
    add(rod(0.06, 0.14, 3.6, 6), mat.secondary, `dart_belly_${tag}_needle`, x, y, z + 0.4);
    add(coneZ(0.07, 0.45, 6), mat.emissive, `dart_belly_${tag}_tip`, x, y, z + 2.4);
    hp(root, `hp_weapon_${s < 0 ? 2 : 3}`, x, y, z + 2.7);
  }

  // ---------- łuski pancerza (armor 4) i zasobnik (cargo 14)
  for (let i = 0; i < CARD.armor; i++) {
    const s = i % 2 ? 1 : -1, z = i < 2 ? -3 : 1.5, th = s > 0 ? -0.55 : Math.PI + 0.55;
    const { p, n } = surf(z, th, 0.04);
    alignY(add(chamferBox(1.2, 0.12, 2.4, 0.04), mat.secondary, `armor_scale_${s > 0 ? 's' : 'p'}_${i >> 1}`, p.x, p.y, p.z), n);
  }
  const Lc = 2.8 * (CARD.cargo / 14);
  add(chamferBox(1.3, 0.55, Lc, 0.15), mat.secondary, 'cargo_pod', 0, -hh(-4) - 0.2, -4);

  // ---------- napęd (thermal 40: małe dysze)
  const zN = -10.2;
  const eng = [[0, 0, 0.62], [-1.3, -0.15, 0.32], [1.3, -0.15, 0.32]];
  eng.forEach(([x, y, r], i) => {
    r *= rK * v(0.04); x *= rK;
    add(rod(r * 0.8, r, 1.3, 12), mat.dark, `nozzle_${i}_bell`, x, y, zN - 0.5);
    add(disc(r * 0.72, 0.06, 12), mat.engine, `nozzle_${i}_glow`, x, y, zN - 0.15, Math.PI / 2);
    add(disc(r * 1.12, 0.12, 12), mat.trim, `nozzle_${i}_ring`, x, y, zN - 1.15, Math.PI / 2);
    hp(root, `hp_engine_${i}`, x, y, zN - 1.3, '-Z');
  });

  // ---------- greeble na rdzeniu (widoczne przez powłokę)
  const nG = Math.round(4 + 14 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.15 + rD() * 0.35), h = snap(0.06 + rD() * 0.1, 0.02), d = snap(0.3 + rD() * 0.8);
    const z = snap(lerp(-7, -1.5, rD())), x = snap((rD() - 0.5) * 1.6);
    const cr = lerp(core[1][1], core[3][1], (z + 8) / 8) ;
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, cr * CK.sy * Math.sqrt(Math.max(0, 1 - (x / (cr * CK.sx)) ** 2)), z);
  }

  // ---------- zużycie: przygasłe fragmenty żył, rysy powłoki
  const nScorch = Math.round(o.wear * 8);
  for (let i = 0; i < nScorch; i++) {
    const z = lerp(-8, 8, rW()), th = rW() * Math.PI * 2, { p, n } = surf(z, th, 0.01);
    alignY(add(box(0.05, 0.02, 0.6 + rW() * 1.5), mat.dark, `scratch_${i}`, p.x, p.y, p.z), n);
  }

  // ---------- skala + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = REFLEKS_META.lengthRange;
  const L = clamp(17.5 * (1 + (rS() - 0.5) * 0.1) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `refleks_swietlisci_${F}_${o.seed}`;
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
    race: 'swietlisci',
    faction: F,
    factionName: REFLEKS_META.factions[F],
    shipClass: 'zwiadowca',
    name: 'Refleks',
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

export function buildRefleksSwietlisci(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'swietlisci', 'zwiadowca', o.faction, o.seed,
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

export function clearRefleksCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
