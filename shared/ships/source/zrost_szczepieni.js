/**
 * zrost_szczepieni.js — „Zrost", krążownik Szczepionych (Teegarden-B)
 *
 *   import { buildZrostSzczepieni } from './zrost_szczepieni.js';
 *   const ship = buildZrostSzczepieni({ seed: 4, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * KONCEPCJA: organizm z przeszczepów (race-portraits.js: szwy, świecące guzki
 * kolonii, maska filtrująca, jedno oko wszczepione). Kadłub to trzy segmenty
 * z różnych statków, zszyte klamrami: fasetowany dziób, gładki środek i rufa
 * obrócona względem osi (przeszczep nie trafił idealnie). Na dziobie maska
 * filtrująca z kratą i dwoma pochłaniaczami, z prawej burty wszczepiony skaner.
 * Na grzbiecie dwa zasobniki zarodników (weapons.js: szczepieni → 'salvo',
 * 2 sloty z karty), pod brzuchem nieregularny worek fałdy „Szczep"
 * (warp-drive.js: petals 0, noise 1.0, twist 0.8) na skręconych ścięgnach.
 * Na rufie skrzela-radiatory (thermal 60). Łaty tkanki na szwach to
 * regeneracja kadłuba (hullRegenPct 0.2).
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z boku — trzy segmenty ze schodkami na szwach, garby zasobników, worek pod brzuchem.
 *  z góry — wrzeciono z maską, wystający skaner z prawej, skrzela na rufie.
 *  z tyłu — rufa przekręcona względem dzioba, worek na ścięgnach pod spodem.
 *
 * Stronnictwa: Pełny Szczep (hawk) — zarośnięty: dużo guzków kolonii i tkanki,
 * 9 komór na zasobnik, 5 porów, czułki zarodnikowe za rufą. Izba Kwarantanny
 * (trade) — jasny, kliniczny kadłub, klatka kwarantanny nad dziobem, trzecia
 * para ładowni. Odporni (coalition) — prawie bez guzków, szwy wypalone,
 * grubszy pancerz, obcy moduł przeszczepiony do burty, asymetria 0.22.
 */
import * as THREE from 'three';

export const ZROST_META = {
  id: 'zrost-szczepieni',
  race: 'szczepieni',
  shipClass: 'krazownik',
  name: 'Zrost',
  card: { hull: 95, armor: 4, thermal: 60, energy: 90, signature: 55, cargo: 18, slots: 2, hullRegenPct: 0.2 },
  lengthRange: [64, 76],
  triBudget: 60000,
  raceColor: '#7ee08a',
  factions: { hawk: 'Pełny Szczep', trade: 'Izba Kwarantanny', coalition: 'Odporni' },
  defaultAsymmetry: { hawk: 0.1, trade: 0.06, coalition: 0.22 },
};
const CARD = ZROST_META.card;
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
const Z_AX = new THREE.Vector3(0, 0, 1);

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
/** Pierścień n-kąta wzdłuż Z. */
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
/** Segment kadłuba z toczenia: przekrój eliptyczny (sx, sy). */
function body(prof, sx, sy, seg = 16) {
  const k = prof.map(([z, r]) => `${r3(z)},${r3(r)}`).join(';') + `|${r3(sx)}|${r3(sy)}|${seg}`;
  return cached(`bd|${k}`, () => {
    const g = new THREE.LatheGeometry(prof.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z)), seg);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    g.computeVertexNormals();
    return g;
  });
}
/** Rura po krzywej Béziera. */
function quill(p0, p1, p2, r, seg = 12) {
  const k = [...p0, ...p1, ...p2, r, seg].map(r3).join('|');
  return cached(`ql|${k}`, () => {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...p0), new THREE.Vector3(...p1), new THREE.Vector3(...p2));
    return new THREE.TubeGeometry(c, seg, r, 6, false);
  });
}
/** Łuk torusa w płaszczyźnie XY (od kąta -over do π+over). */
function arch(R, tube, over = 0.2) {
  const k = [R, tube, over].map(r3).join('|');
  return cached(`ar|${k}`, () => {
    const g = new THREE.TorusGeometry(R, tube, 6, 20, Math.PI + 2 * over);
    g.rotateZ(-over);
    return g;
  });
}
/** Nieregularna bryła (szum sinusowy na ikosaedrze), zależna od ziarna. */
function blob(detail, seed, amp) {
  return cached(`bl|${detail}|${seed}|${r3(amp)}`, () => {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const r = mulberry32(hash(seed, 77));
    const W = Array.from({ length: 4 }, () => {
      const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(2 + r() * 3);
      return { v, ph: r() * 6.28 };
    });
    const p = g.attributes.position, q = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      q.fromBufferAttribute(p, i).normalize();
      let n = 0;
      for (const w of W) n += Math.sin(q.dot(w.v) + w.ph);
      q.multiplyScalar(1 + (n / W.length) * amp);
      p.setXYZ(i, q.x, q.y, q.z);
    }
    g.computeVertexNormals();
    return g;
  });
}

// ------------------------------------------------------------ materiały
function makeMaterials(o, rng) {
  const race = new THREE.Color(o.raceColor);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const prim = new THREE.Color({ hawk: 0x2c3a2c, trade: 0x8c988a, coalition: 0x3b3f37 }[F]);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.16), 0, 1));
  const trim = hawk ? race.clone().multiplyScalar(0.8) : trade ? new THREE.Color(0xcfd8cc) : race.clone().lerp(new THREE.Color(0x6b5a44), 0.6);
  const b = o.emissiveBoost;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.3, roughness: coal ? 0.75 : trade ? 0.4 : 0.6, side: THREE.DoubleSide }),
    secondary: M('mat_hull_secondary', {
      color: new THREE.Color({ hawk: 0x56654a, trade: 0xe3e8df, coalition: 0x6a5647 }[F]), metalness: 0.1, roughness: 0.7, side: THREE.DoubleSide,
    }),
    trim: M('mat_trim_race', { color: trim, metalness: 0.5, roughness: coal ? 0.65 : 0.35, side: THREE.DoubleSide }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x07120a), emissive: race, emissiveIntensity: (hawk ? 2.4 : trade ? 1.4 : 0.8) * b, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: new THREE.Color(0x0a1a10), metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.82,
      emissive: race, emissiveIntensity: (coal ? 0.2 : 0.4) * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x08100a), emissive: new THREE.Color(0xefffe3),
      emissiveIntensity: (hawk ? 3.2 : trade ? 2.6 : 2.0) * b, metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x0a0f0b), metalness: 0.25, roughness: 0.88, side: THREE.DoubleSide }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0x7ee08a;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.4), 0, 1),
    asymmetry: opts.asymmetry == null ? ZROST_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
const PROF = {
  bow: [[14, 6.4], [20, 6.2], [26, 5.6], [30, 4.6], [32.5, 3.2], [34, 1.2], [34.3, 0.01]],
  mid: [[-12.5, 7.4], [-6, 8.2], [2, 8.0], [10, 7.0], [15, 6.3]],
  aft: [[-34.3, 0.01], [-34, 4.2], [-32, 5.6], [-26, 6.7], [-18, 7.3], [-11, 7.4]],
};
const SEG = { bow: { sx: 1.0, sy: 0.86, n: 7 }, mid: { sx: 1.15, sy: 0.9, n: 16 }, aft: { sx: 1.22, sy: 0.95, n: 9 } };
const J_BOW = 14.5, J_AFT = -11.8;
const segOf = (z) => (z > J_BOW ? 'bow' : z < J_AFT ? 'aft' : 'mid');

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
  root.name = 'zrost_root';
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
  const alignY = (mesh, dir) => { mesh.quaternion.setFromUnitVectors(Y_UP, dir.clone().normalize()); return mesh; };
  const alignZ = (mesh, dir) => { mesh.quaternion.setFromUnitVectors(Z_AX, dir.clone().normalize()); return mesh; };

  // ---------- kadłub z trzech przeszczepionych segmentów
  const rK = v(0.04);
  const prof = {};
  for (const k in PROF) prof[k] = PROF[k].map(([z, r]) => [z, r * rK]);
  const rAt = (z) => {
    const p = prof[segOf(z)];
    if (z <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (z <= p[i][0]) {
        const [z0, r0] = p[i - 1], [z1, r1] = p[i];
        return lerp(r0, r1, (z - z0) / (z1 - z0));
      }
    }
    return p[p.length - 1][1];
  };
  const hw = (z) => rAt(z) * SEG[segOf(z)].sx;
  const hh = (z) => rAt(z) * SEG[segOf(z)].sy;
  const topY = (z, x) => hh(z) * Math.sqrt(Math.max(0, 1 - (x / Math.max(hw(z), 0.01)) ** 2));
  const surf = (z, th, out = 0) => {
    const A = hw(z), B = hh(z);
    const n = new THREE.Vector3(Math.cos(th) * B, Math.sin(th) * A, 0).normalize();
    return { p: new THREE.Vector3(Math.cos(th) * A + n.x * out, Math.sin(th) * B + n.y * out, z), n };
  };

  const roll = ((0.05 + rS() * 0.05) * (rS() < 0.5 ? -1 : 1)) + (coal ? a * 0.3 : 0);
  const aft = node(root, 'graft_aft', 0, 0.25, 0, 0, 0, roll);
  const par = (z) => (segOf(z) === 'aft' ? aft : root);

  add(body(prof.bow, SEG.bow.sx, SEG.bow.sy, SEG.bow.n), mat.primary, 'hull_bow');
  add(body(prof.mid, SEG.mid.sx, SEG.mid.sy, SEG.mid.n), mat.primary, 'hull_mid');
  addTo(aft, body(prof.aft, SEG.aft.sx, SEG.aft.sy, SEG.aft.n), mat.primary, 'hull_aft');

  // szwy przeszczepów: pierścień + klamry
  [[J_BOW, 'bow_mid', root], [J_AFT, 'mid_aft', aft]].forEach(([zJ, tag, parent]) => {
    const A = Math.max(hw(zJ + 0.4), hw(zJ - 0.4)), B = Math.max(hh(zJ + 0.4), hh(zJ - 0.4));
    const ring = node(parent, `seam_${tag}`, 0, 0, zJ);
    ring.scale.set(A, B, 1);
    addTo(ring, polyRing(1.04, 0.9, 0.9, 18), coal ? mat.dark : mat.trim, `seam_${tag}_ring`);
    const n = 18;
    for (let k = 0; k < n; k++) {
      if (rW() < o.wear * 0.35) continue;
      const th = (k + 0.5) / n * Math.PI * 2;
      addTo(parent, box(0.3, 0.4, 2.4), mat.dark, `seam_${tag}_staple_${k}`, Math.cos(th) * A * 1.05, Math.sin(th) * B * 1.05, zJ, 0, 0, th);
    }
  });

  // ---------- maska filtrująca (dziób)
  const zM = 31.2;
  add(chamferBox(6.4 * rK, 3.6 * rK, 2.2, 0.35), mat.secondary, 'mask_plate', 0, -1.0, zM);
  for (let k = 0; k < 4; k++) add(box(5.2 * rK, 0.22, 0.3), mat.dark, `mask_grille_${k}`, 0, -2.1 * rK + k * 0.72 * rK, zM + 1.12);
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p', x = s * 3.9 * rK;
    add(rod(1.25, 1.25, 3.2, 10), mat.secondary, `mask_filter_${tag}`, x, -1.6, zM - 0.4);
    add(disc(1.35, 0.25, 10), mat.trim, `mask_filter_${tag}_rim`, x, -1.6, zM + 1.2, Math.PI / 2);
    add(disc(0.85, 0.1, 10), mat.emissive, `mask_filter_${tag}_glow`, x, -1.6, zM + 1.35, Math.PI / 2);
  }
  hp(root, 'hp_weapon_0', 0, -1.0, zM + 1.5);

  // ---------- oczy: naturalne (lewa burta) i wszczepiony skaner (prawa)
  const zE = 25;
  add(ico(1.1, 1), mat.glass, 'eye_natural_p', -hw(zE) * 0.8, 1.6, zE + 0.6);
  add(chamferBox(2.4, 0.5, 2.2, 0.15), mat.secondary, 'eye_natural_p_lid', -hw(zE) * 0.8, 2.55, zE + 0.4, 0.25);
  const xS = hw(zE) * 0.86;
  add(rod(1.9, 2.1, 1.4, 12), mat.dark, 'scanner_socket', xS + 0.2, 1.6, zE, 0, Math.PI / 2);
  add(polyRing(2.4, 1.9, 0.5, 10), mat.trim, 'scanner_collar', xS + 0.8, 1.6, zE, 0, Math.PI / 2);
  add(ico(1.7, 1), mat.glass, 'scanner_lens', xS + 1.1, 1.6, zE);
  add(ico(0.75, 1), mat.emissive, 'scanner_core', xS + 1.6, 1.6, zE);
  add(rod(0.08, 0.14, 4, 5), mat.secondary, 'scanner_antenna', xS + 0.4, 3.8, zE - 1.5, -Math.PI / 2 + 0.5);
  hp(root, 'hp_sensor_scanner', xS + 2.9, 1.6, zE, '+X');
  add(chamferBox(2.4, 0.7, 4, 0.2), mat.glass, 'bridge_glass', 0, hh(21) - 0.1, 21);
  hp(root, 'hp_cockpit', 0, hh(21) + 0.4, 21);

  // ---------- Izba Kwarantanny: klatka nad dziobem
  if (trade) {
    const zs = [16.5, 19.5, 22.5, 25.5, 28.5];
    zs.forEach((z, k) => {
      const A = hw(z) + 1.1, B = hh(z) + 1.1;
      const m = add(arch(A, 0.28, 0.25), mat.trim, `quarantine_rib_${k}`, 0, 0, z);
      m.scale.y = B / A;
      for (const s of [-1, 1]) {
        const th = s > 0 ? -0.25 : Math.PI + 0.25;
        add(ico(0.35, 0), mat.emissive, `quarantine_rib_${k}_light_${s > 0 ? 's' : 'p'}`, Math.cos(th) * A, Math.sin(th) * B, z);
      }
    });
    const y0 = hh(zs[0]) + 1.1, y1 = hh(zs[4]) + 1.1, dz = zs[4] - zs[0];
    add(rod(0.22, 0.22, Math.hypot(dz, y1 - y0), 6), mat.trim, 'quarantine_spine', 0, (y0 + y1) / 2, (zs[0] + zs[4]) / 2, -Math.atan2(y1 - y0, dz));
  }

  // ---------- zasobniki zarodników = wyrzutnie salwowe (2 sloty)
  const nC = hawk ? 9 : 6;
  const zP = -1, thP = 0.56;
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p';
    const th = Math.PI / 2 - s * thP;
    const { p, n } = surf(zP, th);
    const sc = new THREE.Vector3(3.0, 2.4, 6.0).multiplyScalar(v(0.05) * (s < 0 ? 1 + (rA() - 0.5) * a * 0.4 : 1));
    const c = p.clone().addScaledVector(n, sc.y * 0.55);
    add(chamferBox(2.2, 1.8, 6, 0.3), mat.dark, `spore_pod_${tag}_stalk`, p.x - n.x * 0.3, p.y - n.y * 0.3 + 0.4, zP, 0, 0, Math.atan2(n.y, n.x) - Math.PI / 2);
    add(blob(2, o.seed + (s > 0 ? 11 : 12), 0.12), mat.primary, `spore_pod_${tag}`, c.x, c.y, c.z).scale.copy(sc);
    const cols = Math.ceil(nC / 3);
    for (let i = 0; i < nC; i++) {
      const row = i % 3, col = Math.floor(i / 3);
      const u = cols > 1 ? lerp(-0.5, 0.5, col / (cols - 1)) : 0, phi = Math.PI / 2 + (row - 1) * 0.5 * s;
      const cp = Math.sqrt(1 - u * u);
      const lp = new THREE.Vector3(Math.cos(phi) * cp, Math.sin(phi) * cp, u);
      const pos = c.clone().add(lp.clone().multiply(sc));
      const nrm = new THREE.Vector3(lp.x / sc.x, lp.y / sc.y, lp.z / sc.z).normalize();
      const dead = rW() < o.wear * 0.3;
      alignY(add(disc(0.7, 0.25, 8), mat.dark, `spore_pod_${tag}_cell_${i}_rim`, pos.x, pos.y, pos.z), nrm);
      alignY(add(disc(0.45, 0.3, 8), dead ? mat.dark : mat.emissive, `spore_pod_${tag}_cell_${i}${dead ? '_spent' : ''}`, pos.x + nrm.x * 0.05, pos.y + nrm.y * 0.05, pos.z + nrm.z * 0.05), nrm);
    }
    hp(root, `hp_weapon_${s < 0 ? 1 : 2}`, c.x, c.y, c.z + sc.z + 0.3);
  }

  // ---------- pory zarodnikowe na grzbiecie (VLS)
  const nV = hawk ? 5 : 3;
  for (let k = 0; k < nV; k++) {
    const z = -8.5 - k * 3.6, parent = par(z);
    const { p, n } = surf(z, Math.PI / 2, 0.05);
    alignZ(addTo(parent, polyRing(0.95, 0.5, 0.45, 9), mat.trim, `pore_${k}_ring`, p.x, p.y, p.z), n);
    alignY(addTo(parent, disc(0.5, 0.1, 9), mat.emissive, `pore_${k}_glow`, p.x, p.y - 0.1, p.z), n);
    hp(parent, `hp_vls_${k}`, p.x, p.y + 0.3, p.z, '+Y');
  }

  // ---------- worek fałdy „Szczep" na ścięgnach
  const Rs = 3.6 * (CARD.energy / 90) * v(0.05);
  const zS = 3, yS = -hh(zS) - Rs * 0.75 - 0.5;
  add(blob(2, o.seed, 0.22), mat.glass, 'warp_sac', 0, yS, zS).scale.set(Rs * 1.2, Rs * 0.9, Rs * 1.5);
  add(blob(1, o.seed + 7, 0.3), mat.emissive, 'warp_sac_core', 0, yS, zS).scale.set(Rs * 0.6, Rs * 0.45, Rs * 0.8);
  for (let k = 0; k < 6; k++) {
    const xo = (k - 2.5) * 1.1, dz = (k % 2 ? 1 : -1) * (1 + (k % 3));
    const bx = xo * 1.4, by = -topY(zS + dz, bx) + 0.3;
    const P0 = [bx, by, zS + dz], P2 = [xo * 0.7, yS + Rs * 0.55, zS + dz * 0.6];
    const P1 = [(P0[0] + P2[0]) / 2 + 0.8 * 1.6 * (k % 2 ? 1 : -1), (P0[1] + P2[1]) / 2, (P0[2] + P2[2]) / 2];
    add(quill(P0, P1, P2, 0.38, 8), mat.secondary, `warp_tendon_${k}`);
  }
  hp(root, 'hp_warp_emitter', 0, yS, zS + Rs * 1.5 + 0.3);

  // ---------- skrzela-radiatory na rufie (thermal 60)
  const nGill = Math.round(6 * CARD.thermal / 60);
  for (let k = 0; k < nGill; k++) {
    const z = -27.5 + k * 2.3;
    for (const s of [-1, 1]) {
      if (rW() < o.wear * 0.2) continue;
      const tag = `${k}_${s > 0 ? 's' : 'p'}`, x = s * hw(z);
      addTo(aft, box(0.3, hh(z) * 1.1, 2.2), mat.secondary, `gill_${tag}`, x + s * 0.25, 0.2, z, 0, s * 0.45, 0);
      addTo(aft, box(0.12, hh(z) * 0.85, 0.35), mat.emissive, `gill_${tag}_slit`, x - s * 0.02, 0.2, z - 1.15);
    }
  }

  // ---------- pancerz (armor 4) i ładownie (cargo 18)
  const armorT = coal ? 0.8 : 0.45;
  const plates = [-8, -2.5, 3, 8.5];
  if (coal) plates.push(18, 23);
  plates.forEach((z, i) => {
    for (const s of [-1, 1]) add(chamferBox(armorT, hh(z) * 0.75, 4.6, 0.14), mat.secondary, `armor_${s > 0 ? 's' : 'p'}_${i}`, s * (hw(z) + armorT * 0.2), -0.4, z);
  });
  const bays = trade ? [-7, -19, 12] : [-7, -19];
  bays.forEach((z, j) => {
    const parent = par(z);
    for (const s of [-1, 1]) {
      const tag = `${j}_${s > 0 ? 's' : 'p'}`, x = s * 3.4, y = -topY(z, x) + 0.35;
      addTo(parent, chamferBox(3.2, 1.4, 5.2 * (CARD.cargo / 18), 0.25), mat.secondary, `cargo_${tag}`, x, y, z);
      addTo(parent, box(3.3, 0.08, 0.1), mat.dark, `cargo_${tag}_seam`, x, y - 0.66, z);
    }
  });

  // ---------- guzki kolonii (szczepy)
  const nN = hawk ? 26 : trade ? 12 : 5;
  for (let i = 0, made = 0; i < nN * 3 && made < nN; i++) {
    const z = lerp(-30, 28, rA()), th = lerp(-0.4, Math.PI + 0.4, rA());
    if (z > -8 && z < 6 && th > 0.5 && th < 2.6) continue;
    if (z > 22 && z < 28 && Math.abs(Math.cos(th)) > 0.6) continue;
    if (Math.abs(z - J_BOW) < 1.4 || Math.abs(z - J_AFT) < 1.4) continue;
    const r = 0.5 + rA() * (hawk ? 0.9 : 0.6), parent = par(z), { p, n } = surf(z, th);
    const dead = rW() < o.wear * 0.2;
    addTo(parent, ico(r * 1.35, 1), mat.dark, `colony_${made}_rim`, p.x, p.y, p.z);
    addTo(parent, ico(r, 1), dead ? mat.dark : mat.emissive, `colony_${made}${dead ? '_dead' : ''}`, p.x + n.x * r * 0.55, p.y + n.y * r * 0.55, p.z);
    made++;
  }

  // ---------- łaty tkanki na szwach (hullRegenPct 0.2)
  const nT = hawk ? 9 : trade ? 2 : 4;
  for (let i = 0; i < nT; i++) {
    const zJ = rA() < 0.5 ? J_BOW : J_AFT, z = zJ + (rA() - 0.5) * 3, th = lerp(-0.3, Math.PI + 0.3, rA());
    const parent = zJ === J_AFT ? aft : root, { p, n } = surf(z, th);
    const m = addTo(parent, blob(1, o.seed + 13 + i, 0.25), coal ? mat.dark : mat.secondary, `tissue_${i}`, p.x, p.y, p.z);
    alignY(m, n).scale.set(1.3 + rA() * 1.2, 0.55, 1.8 + rA() * 1.4);
  }

  // ---------- Odporni: obcy moduł przeszczepiony do burty
  if (coal) {
    const s = rA() < 0.5 + a ? -1 : 1, zG = -19, xG = s * (hw(zG) + 1.3);
    addTo(aft, chamferBox(2.8, 3.6, 11, 0.4), mat.secondary, 'foreign_graft', xG, -0.6, zG);
    addTo(aft, rod(0.9, 1.4, 2.2, 8), mat.secondary, 'foreign_graft_nose', xG, -0.6, zG + 6.6);
    addTo(aft, rod(0.8, 1, 1.6, 10), mat.dark, 'foreign_graft_nozzle', xG, -0.6, zG - 6.2);
    addTo(aft, disc(0.65, 0.1, 10), mat.engine, 'foreign_graft_nozzle_glow', xG, -0.6, zG - 5.8, Math.PI / 2);
    for (const dz of [-3.5, 3.5]) addTo(aft, box(2.2, 1, 1), mat.dark, `foreign_graft_clamp_${dz > 0 ? 'f' : 'a'}`, s * (hw(zG) + 0.1), -0.6, zG + dz);
    for (let k = 0; k < 6; k++) addTo(aft, box(1.4, 0.2, 0.3), mat.dark, `foreign_graft_staple_${k}`, s * (hw(zG) - 0.1), 1.0, zG - 4.5 + k * 1.8);
    hp(aft, 'hp_engine_graft', xG, -0.6, zG - 7.2, '-Z');
  }

  // ---------- Pełny Szczep: czułki zarodnikowe za rufą
  if (hawk) {
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([s, t], k) => {
      const x0 = s * hw(-30) * 0.7, y0 = t * hh(-30) * 0.5;
      const P0 = [x0, y0, -30], P1 = [s * (hw(-30) + 3), y0 * 1.3, -38], P2 = [s * hw(-30) * 0.4, y0 * 1.6, -43 - rA() * 3];
      addTo(aft, quill(P0, P1, P2, 0.32, 12), mat.secondary, `tendril_${k}`);
      addTo(aft, ico(0.5, 1), mat.emissive, `tendril_${k}_tip`, ...P2);
    });
  }

  // ---------- napęd
  const zN = -34.2;
  const eng = [[-3.0, 0.3, 1.5], [0, 0.6, 1.7], [3.0, 0.3, 1.5], [-4.6, -2.1, 0.9], [4.6, -2.1, 0.9]];
  if (hawk) eng.push([-1.6, 2.9, 0.7], [1.6, 2.9, 0.7]);
  eng.forEach(([x, y, r], i) => {
    r *= rK * v(0.04); x *= rK; y *= rK;
    addTo(aft, rod(r * 0.8, r, 2.6, 12), mat.dark, `nozzle_${i}_bell`, x, y, zN - 1.3);
    addTo(aft, disc(r * 0.7, 0.08, 12), mat.engine, `nozzle_${i}_glow`, x, y, zN - 0.6, Math.PI / 2);
    addTo(aft, polyRing(r * 1.22, r * 0.95, 0.45, 9), mat.trim, `nozzle_${i}_sphincter`, x, y, zN - 2.6);
    hp(aft, `hp_engine_${i}`, x, y, zN - 2.9, '-Z');
  });

  // ---------- greeble (signature 55)
  const nG = Math.round(10 + 40 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.3 + rD() * 0.8), h = snap(0.12 + rD() * 0.22, 0.02), d = snap(0.6 + rD() * 2);
    const z = snap(lerp(-10.5, 27, rD())), s = rD() < 0.5 ? -1 : 1, x = s * (1.8 + rD() * 0.55 * hw(z));
    if (Math.abs(x) > hw(z) * 0.8 || Math.abs(z - J_BOW) < 1.5) continue;
    if (z > -8 && z < 6 && Math.abs(x) > 2.2) continue;
    const y = topY(z, x), rz = Math.atan(-(hh(z) ** 2 * x) / (hw(z) ** 2 * Math.max(y, 0.1)));
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, y, z, 0, 0, rz);
  }

  // ---------- zużycie
  const nScorch = Math.round(o.wear * 14 + (coal ? 4 : 0));
  for (let i = 0; i < nScorch; i++) {
    const z = lerp(-32, 28, rW()), s = rW() < 0.5 ? -1 : 1;
    addTo(par(z), box(0.05, 0.6 + rW() * 1.4, 1 + rW() * 3), mat.dark, `scorch_${i}`, s * (hw(z) + 0.02), (rW() - 0.5) * hh(z), z);
  }

  // ---------- skala + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = ZROST_META.lengthRange;
  const L = clamp(70 * (1 + (rS() - 0.5) * 0.1) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `zrost_szczepieni_${F}_${o.seed}`;
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
    race: 'szczepieni',
    faction: F,
    factionName: ZROST_META.factions[F],
    shipClass: 'krazownik',
    name: 'Zrost',
    seed: o.seed,
    lengthU: r3(L),
    bowAxis: '+Z',
    materialSlots: MAT_SLOTS.slice(),
    hardpoints,
    triangles: countTriangles(group),
    asymmetry: a,
    graftRoll: r3(roll),
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

export function buildZrostSzczepieni(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'szczepieni', 'krazownik', o.faction, o.seed,
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

export function clearZrostCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
