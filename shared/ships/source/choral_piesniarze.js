/**
 * choral_piesniarze.js — „Chorał", pancernik Pieśniarzy (Teegarden-B)
 *
 *   import { buildChoralPiesniarze } from './choral_piesniarze.js';
 *   const ship = buildChoralPiesniarze({ seed: 2, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * KONCEPCJA: ptak śpiewający (race-portraits.js: ptasia głowa, grzebień piór,
 * czworo oczu, świecący worek krtaniowy). Kadłub to tułów ptaka z szyją
 * i głową na dziobie. Grzebień piór na głowie to wyrzutnie rakiet
 * (weapons.js: piesniarze → 'missile'), odgięte do tyłu nad grzbietem.
 * Czworo oczu to czujniki (sensors 7, „widzą tor trzy pieśni wcześniej").
 * Pod szyją wisi worek krtaniowy: emiter fałdy „Harmoniczna"
 * (warp-drive.js: 7 płatków, twist 1.0) z siedmiokątnym kołnierzem.
 * Skrzydła skośne z lotkami na krawędzi spływu, ogon z wachlarza sterówek.
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z boku — głowa z dziobem, grzebień odgięty nad grzbiet, worek pod szyją.
 *  z góry — ptak w locie: skośne skrzydła z postrzępioną krawędzią, wachlarz ogona.
 *  z tyłu — skrzydła w „V" (Szpony: opuszczone), wachlarz piór nad dyszami.
 *
 * Stronnictwa: Szpony (hawk) — czerwone końcówki piór, szpony pod brzuchem,
 * 7 piór i 7 sterówek, skrzydła opuszczone. Chóry Map (trade) — jasny kadłub,
 * większy worek, rząd anten „chóru", szersze skrzydła. Kukułki (coalition) —
 * cętkowany kadłub, obce „jajo" przyczepione do lewej burty, asymetria 0.25.
 */
import * as THREE from 'three';

export const CHORAL_META = {
  id: 'choral-piesniarze',
  race: 'piesniarze',
  shipClass: 'pancernik',
  name: 'Chorał',
  card: { hull: 85, armor: 3, thermal: 45, energy: 100, signature: 40, cargo: 14, slots: 3, hullRegenPct: 0 },
  lengthRange: [88, 104],
  triBudget: 80000,
  raceColor: '#c39bff',
  factions: { hawk: 'Szpony', trade: 'Chóry Map', coalition: 'Kukułki' },
  defaultAsymmetry: { hawk: 0.04, trade: 0.04, coalition: 0.25 },
};
const CARD = CHORAL_META.card;
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
/** Klin: tył (wB×hB, z=-d/2) → przód (wF×hF, z=+d/2). */
function taperBox(wB, hB, wF, hF, d) {
  const k = [wB, hB, wF, hF, d].map(r3).join('|');
  return cached(`tb|${k}`, () => {
    const P = [
      [-wB / 2, -hB / 2, -d / 2], [wB / 2, -hB / 2, -d / 2], [wB / 2, hB / 2, -d / 2], [-wB / 2, hB / 2, -d / 2],
      [-wF / 2, -hF / 2, d / 2], [wF / 2, -hF / 2, d / 2], [wF / 2, hF / 2, d / 2], [-wF / 2, hF / 2, d / 2],
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
/** Stożek z czubkiem w +Y (do orientowania kwaternionem). */
function coneY(r, h, seg = 6) {
  const k = [r, h, seg].map(r3).join('|');
  return cached(`cy|${k}`, () => new THREE.ConeGeometry(r, h, seg, 1));
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
/** Tułów z toczenia: przekrój eliptyczny (sx, sy). */
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
/** Rura po krzywej Béziera (punkty w układzie kadłuba). */
function quill(p0, p1, p2, r, seg = 12) {
  const k = [...p0, ...p1, ...p2, r, seg].map(r3).join('|');
  return cached(`ql|${k}`, () => {
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...p0), new THREE.Vector3(...p1), new THREE.Vector3(...p2));
    return new THREE.TubeGeometry(c, seg, r, 6, false);
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
  const prim = new THREE.Color({ hawk: 0x221a2e, trade: 0x5d5470, coalition: 0x2b2630 }[F]);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.16), 0, 1));
  const trim = hawk ? race.clone().lerp(new THREE.Color(0xff5a6e), 0.75) : race.clone().multiplyScalar(trade ? 0.75 : 0.45);
  const b = o.emissiveBoost;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.35, roughness: coal ? 0.7 : 0.45, side: THREE.DoubleSide }),
    secondary: M('mat_hull_secondary', {
      color: new THREE.Color(trade ? 0xd9c9b0 : hawk ? 0x16111f : 0x3a3340), metalness: 0.2, roughness: 0.55, side: THREE.DoubleSide,
    }),
    trim: M('mat_trim_race', { color: trim, metalness: 0.55, roughness: coal ? 0.6 : 0.3, side: THREE.DoubleSide }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x0d0718), emissive: race, emissiveIntensity: (hawk ? 2.2 : trade ? 1.8 : 0.9) * b, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: new THREE.Color(0x120a1e), metalness: 0.3, roughness: 0.08, transparent: true, opacity: 0.82,
      emissive: race, emissiveIntensity: (coal ? 0.2 : 0.4) * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x100a18), emissive: new THREE.Color(0xf4ecff),
      emissiveIntensity: (hawk ? 3.4 : trade ? 2.8 : 2.0) * b, metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x0b0910), metalness: 0.25, roughness: 0.88, side: THREE.DoubleSide }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0xc39bff;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.4), 0, 1),
    asymmetry: opts.asymmetry == null ? CHORAL_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
const PROFILE = [
  [-46, 0.01], [-45, 5], [-40, 8], [-26, 10], [-10, 10.5], [0, 9.6], [12, 7], [22, 4.6],
  [28, 3.8], [32, 4.3], [36, 5], [40, 4.8], [43, 3.8], [45, 2.4], [46, 0.01],
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
  root.name = 'choral_root';
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

  // ---------- tułów, szyja, głowa
  const rK = v(0.04);
  const prof = PROFILE.map(([z, r]) => [z, r * rK]);
  const sx = 1.25 * (trade ? 1.05 : 1), sy = 0.8;
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
  const hw = (z) => rAt(z) * sx;
  const hh = (z) => rAt(z) * sy;
  const topY = (z, x) => hh(z) * Math.sqrt(Math.max(0, 1 - (x / Math.max(hw(z), 0.01)) ** 2));
  add(body(prof, sx, sy), mat.primary, 'hull_body');

  // dziób (górna i dolna szczęka)
  const beakL = (hawk ? 13 : 11) * v(0.05);
  add(coneZ(2.6 * rK, beakL, 8), mat.secondary, 'beak_upper', 0, 0.2, 44 + beakL / 2).scale.set(1, 0.55, 1);
  add(coneZ(2.0 * rK, beakL * 0.65, 8), mat.secondary, 'beak_lower', 0, -1.3, 43.5 + beakL * 0.33).scale.set(0.9, 0.45, 1);
  add(box(0.08, 0.5, beakL * 0.6), mat.dark, 'beak_seam', 0, -0.7, 44 + beakL * 0.3);
  hp(root, 'hp_weapon_0', 0, -0.4, 44.5 + beakL);

  // czworo oczu (sensors 7)
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p';
    add(ico(1.35, 1), mat.glass, `eye_main_${tag}`, s * hw(38) * 0.82, 0.9, 38.2);
    add(ico(0.6, 1), mat.emissive, `eye_main_${tag}_pupil`, s * (hw(38) * 0.82 + 0.85), 1.1, 38.6);
    add(ico(0.65, 1), mat.glass, `eye_small_${tag}`, s * 1.8, topY(40.5, 1.8) - 0.1, 40.5);
    add(ico(0.3, 0), mat.emissive, `eye_small_${tag}_pupil`, s * 1.95, topY(40.5, 1.8) + 0.35, 40.9);
  }
  add(chamferBox(2.6, 0.6, 3.4, 0.2), mat.glass, 'bridge_glass', 0, hh(34) - 0.05, 34);
  hp(root, 'hp_cockpit', 0, hh(34) + 0.4, 34);

  // ---------- grzebień piór = wyrzutnie rakiet
  const nQ = hawk ? 7 : trade ? 5 : 6;
  const Lbase = { hawk: 30, trade: 24, coalition: 26 }[F] * v(0.06);
  const spread = hawk ? 0.2 : trade ? 0.26 : 0.23;
  const R0 = [0, hh(36) * 0.75, 36];
  const mid = (nQ - 1) / 2;
  for (let i = 0; i < nQ; i++) {
    const off = i - mid, ang = off * spread * (1 + (off < 0 ? (rA() - 0.5) * a * 0.6 : 0));
    let Lq = Lbase * (1 - 0.28 * Math.abs(off) / Math.max(mid, 1)) * v(0.05);
    const broken = rW() < o.wear * (coal ? 0.5 : 0.25) && Math.abs(off) > 0;
    if (broken) Lq *= 0.55;
    const P1 = [R0[0] + Math.sin(ang) * Lq * 0.12, R0[1] + Lq * 0.3, R0[2] - Lq * 0.22];
    const P2 = [R0[0] + Math.sin(ang) * Lq * 0.5, R0[1] + Math.cos(ang) * Lq * 0.36 + 2.5, R0[2] - Lq * 0.88];
    const rq = 0.7 - Math.abs(off) * 0.04;
    add(quill(R0, P1, P2, rq), mat.primary, `crest_quill_${i}${broken ? '_broken' : ''}`);
    const tan = new THREE.Vector3(P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2]).normalize();
    const tl = broken ? 0.9 : 3.6;
    const tip = add(coneY(rq * 1.35, tl, 6), broken ? mat.dark : mat.trim, `crest_quill_${i}_tip`,
      P2[0] + tan.x * tl / 2, P2[1] + tan.y * tl / 2, P2[2] + tan.z * tl / 2);
    alignY(tip, tan);
    // 2 komory rakiet na piórze
    for (const t of [0.45, 0.72]) {
      const u = 1 - t, p = [0, 1, 2].map((k) => u * u * R0[k] + 2 * u * t * P1[k] + t * t * P2[k]);
      add(box(rq * 1.9, rq * 1.9, 1.4), mat.dark, `crest_quill_${i}_cell_${t}`, ...p, 0, ang * 0.5, 0);
    }
    const u = 0.5, pm = [0, 1, 2].map((k) => u * u * R0[k] + 2 * u * u * P1[k] + u * u * P2[k]);
    hp(root, `hp_vls_quill_${i}`, pm[0], pm[1] + rq, pm[2], '+Y');
  }
  add(chamferBox(3.2, 1.6, 4.5, 0.3), mat.trim, 'crest_root', 0, R0[1] + 0.3, R0[2] - 0.8);

  // ---------- worek krtaniowy = emiter fałdy „Harmoniczna"
  const Rs = (trade ? 4.4 : 3.4) * (CARD.energy / 100) * v(0.05);
  const zS = 24, yS = -hh(zS) - Rs * 0.55;
  add(ico(1, 2), mat.glass, 'throat_sac', 0, yS, zS).scale.set(Rs * 1.1, Rs * 0.8, Rs * 1.45);
  add(ico(1, 1), mat.emissive, 'throat_sac_core', 0, yS, zS).scale.set(Rs * 0.55, Rs * 0.4, Rs * 0.8);
  const col = node(root, 'throat_collar_node', 0, yS, zS);
  col.scale.set(Rs * 1.1, Rs * 0.8, 1);
  addTo(col, polyRing(1.06, 0.96, 0.6, 7), mat.trim, 'throat_collar_7');
  for (let k = 0; k < 7; k++) {
    const an = Math.PI / 2 + (k * 2 * Math.PI) / 7;
    addTo(col, box(0.06, 0.06, 0.8), mat.emissive, `throat_petal_${k}`, Math.cos(an) * 1.08, Math.sin(an) * 1.08, 0);
  }
  add(chamferBox(2.2, Math.abs(yS) - hh(zS) + 0.6, 3, 0.2), mat.dark, 'throat_neck', 0, (yS + (-hh(zS))) / 2 + 0.3, zS);
  hp(root, 'hp_warp_emitter', 0, yS - Rs * 0.4, zS + Rs * 1.2);

  // ---------- skrzydła
  const S = { hawk: 26, trade: 30, coalition: 27 }[F] * v(0.05);
  const dih = hawk ? -0.13 : trade ? 0.08 : 0.02;
  const nF = hawk ? 7 : 6;
  const zW = -6, yW = -1.2;
  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p';
    let Sw = S, d = dih;
    if (s < 0) { Sw *= 1 + (rA() - 0.5) * a * 0.3; if (coal) { Sw *= 1 - a * 0.5; d -= a * 0.35; } }
    const pts = [[0, 10], [Sw * 0.55, -1], [Sw, -15], [Sw * 1.03, -20]];
    for (let k = 0; k < nF; k++) {
      const uT = Sw * (1 - (k + 0.5) / nF), uN = Sw * (1 - (k + 1) / nF);
      pts.push([uT, -23 - 5 * (1 - k / nF)], [Math.max(uN, 0), -18.5 + (k / nF) * 1.5]);
    }
    pts.push([0, -19]);
    const wn = node(root, `wing_pivot_${tag}`, s * hw(zW) * 0.8, yW, zW, 0, 0, s * d);
    wn.scale.x = s;
    addTo(wn, wingGeo(pts, 0.8), mat.primary, `wing_${tag}`);
    addTo(wn, box(Sw * 0.5, 0.2, 0.5), mat.trim, `wing_${tag}_leadedge`, Sw * 0.3, 0.45, 4.2, 0, Math.atan2(11, Sw * 0.55), 0);
    // lotki = radiatory (thermal 45)
    for (let k = 0; k < nF; k++) {
      if (rW() < o.wear * 0.3) continue;
      const uT = Sw * (1 - (k + 0.5) / nF);
      addTo(wn, box(0.18, 0.12, 4.5 * (CARD.thermal / 45)), mat.emissive, `wing_${tag}_vein_${k}`, uT, 0.46, -19 - 2.5 * (1 - k / nF));
    }
    addTo(wn, ico(0.4, 0), mat.emissive, `nav_light_${tag}`, Sw * 1.03, 0, -20);
    // zasobnik rakiet pod skrzydłem
    const uP = Sw * 0.42;
    addTo(wn, rod(0.9, 1.1, 8, 8), mat.secondary, `wing_${tag}_pod`, uP, -1.5, -4);
    addTo(wn, coneZ(0.9, 2.2, 8), mat.trim, `wing_${tag}_pod_nose`, uP, -1.5, 1.1);
    addTo(wn, box(0.4, 0.9, 1.5), mat.dark, `wing_${tag}_pod_pylon`, uP, -0.7, -4);
    hp(wn, `hp_weapon_${s < 0 ? 1 : 2}`, uP, -1.5, 2.3);
  }

  // ---------- Szpony: szpony pod brzuchem
  if (hawk) {
    [2, -9].forEach((z, j) => {
      for (const s of [-1, 1]) {
        const tag = `${j}_${s > 0 ? 's' : 'p'}`, x = s * hw(z) * 0.35, y0 = -hh(z) + 0.6;
        const P0 = [x, y0, z], P1 = [x * 1.4, y0 - 5, z + 1], P2 = [x * 1.3, y0 - 6.2, z + 5];
        add(quill(P0, P1, P2, 0.55, 10), mat.primary, `talon_${tag}`);
        const tan = new THREE.Vector3(0, 0.25, 1).normalize();
        alignY(add(coneY(0.75, 2.4, 6), mat.trim, `talon_${tag}_claw`, P2[0], P2[1] + 0.3, P2[2] + 1.1), tan);
      }
    });
  }

  // ---------- Chóry Map: rząd anten chóru
  if (trade) {
    for (let k = 0; k < 7; k++) {
      const z = -30 + k * 2.6, h = (3 + Math.sin((k / 6) * Math.PI) * 3.5) * v(0.08);
      add(rod(0.12, 0.22, h, 5), mat.secondary, `choir_antenna_${k}`, 0, topY(z, 0) + h / 2, z, -Math.PI / 2, 0, 0);
      add(ico(0.3, 0), mat.emissive, `choir_antenna_${k}_tip`, 0, topY(z, 0) + h, z);
    }
  }

  // ---------- pionowe wyrzutnie na grzbiecie
  const nV = hawk ? 6 : trade ? 3 : 4;
  for (let k = 0; k < nV; k++) {
    const z = -34 + k * 3.4;
    for (const s of [-1, 1]) {
      if (rW() < o.wear * 0.15) continue;
      const x = s * 1.8, y = topY(z, x), rz = Math.atan(-(hh(z) ** 2 * x) / (hw(z) ** 2 * Math.max(y, 0.1)));
      add(box(2, 0.3, 2.6), mat.secondary, `vls_${k}_${s > 0 ? 's' : 'p'}`, x, y, z, 0, 0, rz);
      add(box(2.05, 0.1, 0.14), mat.emissive, `vls_${k}_${s > 0 ? 's' : 'p'}_seam`, x, y + 0.12, z + 1.2, 0, 0, rz);
    }
    hp(root, `hp_vls_${k}`, 0, topY(z, 0) + 0.3, z, '+Y');
  }

  // ---------- pancerz (armor 3) i ładownie (cargo 14)
  for (let i = 0; i < CARD.armor; i++) {
    const z = -20 + i * 10;
    for (const s of [-1, 1]) add(chamferBox(0.35, hh(z) * 0.8, 7.5, 0.12), mat.secondary, `armor_${s > 0 ? 's' : 'p'}_${i}`, s * (hw(z) - 0.05), 0.2, z);
  }
  const bays = trade ? [-18, -30] : [-18];
  bays.forEach((z, j) => {
    for (const s of [-1, 1]) {
      const tag = `${j}_${s > 0 ? 's' : 'p'}`;
      add(chamferBox(3, 1.3, 6 * (CARD.cargo / 14), 0.25), mat.secondary, `cargo_${tag}`, s * 3.2, -hh(z) * 0.88, z);
      add(box(3.1, 0.08, 0.1), mat.dark, `cargo_${tag}_seam`, s * 3.2, -hh(z) * 0.88 - 0.62, z);
    }
  });

  // ---------- Kukułki: cętki i obce „jajo"
  if (coal) {
    const n = 10 + Math.round(o.wear * 10);
    for (let i = 0; i < n; i++) {
      const z = lerp(-40, 30, rA()), th = lerp(-0.3, Math.PI + 0.3, rA());
      const pos = new THREE.Vector3(Math.cos(th) * hw(z), Math.sin(th) * hh(z), z);
      const nrm = new THREE.Vector3(Math.cos(th) / sx, Math.sin(th) / sy, 0).normalize();
      alignY(add(disc(0.6 + rA() * 1.1, 0.12, 8), mat.dark, `mottle_${i}`, pos.x, pos.y, pos.z), nrm);
    }
    const s = rA() < 0.5 + a ? -1 : 1, zE = -14, xE = s * (hw(zE) + 2.6);
    add(ico(1, 1), mat.secondary, 'cuckoo_egg', xE, -1.2, zE).scale.set(2.6, 2.4, 4.4);
    add(box(0.25, 0.25, 0.25), mat.emissive, 'cuckoo_egg_light', xE + s * 2.5, -1.2, zE + 1);
    for (const dz of [-2, 2]) add(box(2.6, 0.8, 0.9), mat.dark, `cuckoo_clamp_${dz > 0 ? 'f' : 'a'}`, s * (hw(zE) + 0.9), -1.2, zE + dz);
  }

  // ---------- napęd i ogon
  const zN = -45.2;
  const eng = [[-3.6, 0.2, 1.6], [0, 0.4, 1.8], [3.6, 0.2, 1.6], [-5.8, -1.6, 1], [5.8, -1.6, 1]];
  if (hawk) eng.push([-2, 2.6, 0.9], [2, 2.6, 0.9]);
  eng.forEach(([x, y, r], i) => {
    r *= rK * v(0.03);
    add(rod(r * 0.75, r, 3, 12), mat.dark, `nozzle_${i}_bell`, x * rK, y * rK, zN - 1.5);
    add(disc(r * 0.68, 0.08, 12), mat.engine, `nozzle_${i}_glow`, x * rK, y * rK, zN - 0.6).rotation.x = Math.PI / 2;
    add(rod(r * 1.08, r * 1.08, 0.35, 12), mat.trim, `nozzle_${i}_collar`, x * rK, y * rK, zN - 2.9);
    hp(root, `hp_engine_${i}`, x * rK, y * rK, zN - 3.1, '-Z');
  });
  const nT = hawk ? 7 : 5, Lt = (hawk ? 16 : 13) * v(0.06);
  for (let k = 0; k < nT; k++) {
    const off = k - (nT - 1) / 2, ang = off * 0.2;
    const tn = node(root, `tail_pivot_${k}`, off * 0.8, 3.2 * rK, zN + 3, -0.12, Math.PI + ang, 0);
    const L = Lt * (1 - Math.abs(off) * 0.06);
    addTo(tn, taperBox(1.4, 0.35, 3.2, 0.25, L), mat.primary, `tail_feather_${k}`, 0, 0, L / 2);
    addTo(tn, box(0.1, 0.1, L * 0.7), mat.emissive, `tail_feather_${k}_vein`, 0, 0.2, L * 0.5);
  }

  // ---------- greeble na grzbiecie (signature 40: oszczędnie)
  const nG = Math.round(8 + 42 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.3 + rD() * 0.8), h = snap(0.12 + rD() * 0.2, 0.02), d = snap(0.6 + rD() * 2);
    const z = snap(lerp(-40, 20, rD())), s = rD() < 0.5 ? -1 : 1, x = s * (2.8 + rD() * 0.55 * hw(z));
    if (Math.abs(x) > hw(z) * 0.85) continue;
    const y = topY(z, x), rz = Math.atan(-(hh(z) ** 2 * x) / (hw(z) ** 2 * Math.max(y, 0.1)));
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, y, z, 0, 0, rz);
  }

  // ---------- zużycie
  const nScorch = Math.round(o.wear * 14);
  for (let i = 0; i < nScorch; i++) {
    const z = lerp(-44, 20, rW()), s = rW() < 0.5 ? -1 : 1;
    add(box(0.05, 0.6 + rW() * 1.4, 1 + rW() * 3), mat.dark, `scorch_${i}`, s * (hw(z) + 0.02), (rW() - 0.5) * hh(z), z);
  }

  // ---------- skala + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = CHORAL_META.lengthRange;
  const L = clamp(96 * (1 + (rS() - 0.5) * 0.1) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `choral_piesniarze_${F}_${o.seed}`;
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
    race: 'piesniarze',
    faction: F,
    factionName: CHORAL_META.factions[F],
    shipClass: 'pancernik',
    name: 'Chorał',
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

export function buildChoralPiesniarze(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'piesniarze', 'pancernik', o.faction, o.seed,
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

export function clearChoralCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
