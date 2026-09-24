/**
 * goniec_wybudzeni.js — „Goniec", przechwytywacz Wybudzonych (Teegarden-B)
 *
 *   import { buildGoniecWybudzeni } from './goniec_wybudzeni.js';
 *   const ship = buildGoniecWybudzeni({ seed: 7, faction: 'hawk' });
 *
 * Zwraca THREE.Group, dziób w lokalnym +Z (userData.bowAxis = '+Z').
 * Czysta geometria three.js, zero tekstur. Szablon budowany raz na klucz
 * (rasa|klasa|stronnictwo|seed|parametry kształtu), kolejne wywołania = clone().
 *
 * TEST SYLWETKI (czarny kształt na białym tle):
 *  z tyłu — prostokątny blok napędu z dwiema prostokątnymi dyszami wpisany w
 *           16-kątny pierścień-pieczęć z 16 kreskami (4 dłuższe na osiach
 *           głównych). Żadna inna rasa nie ma kwadratu w szesnastokącie.
 *  z góry — schodkowy „regał": szeroki blok silnika, poprzeczna belka
 *           pieczęci, dwie prostokątne szuflady po bokach, fazowany klin
 *           dziobu. hawk: rogi bastionu na zewnątrz szuflad; trade: szerszy
 *           kadłub i piętrowe szuflady; coalition: lewa szuflada krótsza,
 *           sześciokątny moduł-trofeum.
 *  z boku — trzy kondygnacje schodzące ku dziobowi, kabina z powieką,
 *           kreski pieczęci wystające nad i pod kadłub, anteny rejestru.
 *
 * ZAKAZY rasy: brak krzywizn swobodnych (tylko prostopadłościany, kliny,
 * wielokąty foremne 16/6), detal wyrównany do siatki 0.05 j. i osi.
 */
import * as THREE from 'three';

export const GONIEC_META = {
  id: 'goniec-wybudzeni',
  race: 'wybudzeni',
  shipClass: 'przechwytywacz',
  name: 'Goniec',
  card: { hull: 100, armor: 5, thermal: 60, energy: 100, signature: 50, cargo: 20, slots: 3, hullRegenPct: 0 },
  lengthRange: [13, 16],
  triBudget: 25000,
  raceColor: '#e0b15a',
  factions: { hawk: 'Kwartał Spisowy', trade: 'Cech Rzeczników', coalition: 'Bez Numeru' },
  defaultAsymmetry: { hawk: 0.05, trade: 0.05, coalition: 0.3 },
};
const CARD = GONIEC_META.card;
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

/** Prostopadłościan z ciężkim fazowaniem wszystkich 12 krawędzi. */
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

/** Pierścień foremnego n-kąta (pieczęć spisu), oś wzdłuż Z. */
function polyRing(rOut, rIn, depth, n = 16) {
  const k = [rOut, rIn, depth, n].map(r3).join('|');
  return cached(`pr|${k}`, () => {
    const ph = Math.PI / n;
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

/** Tarcza foremnego n-kąta, oś wzdłuż Z. */
function polyDisc(r, depth, n = 16) {
  const k = [r, depth, n].map(r3).join('|');
  return cached(`pd|${k}`, () => {
    const g = new THREE.CylinderGeometry(r, r, depth, n, 1);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / n);
    return g;
  });
}

function hexPrism(r, len) {
  const k = [r, len].map(r3).join('|');
  return cached(`hx|${k}`, () => {
    const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

function rod(r, h) {
  const k = [r, h].map(r3).join('|');
  return cached(`rd|${k}`, () => new THREE.CylinderGeometry(r, r, h, 4, 1));
}

// ------------------------------------------------------------ materiały
function makeMaterials(o, rng) {
  const race = new THREE.Color(o.raceColor);
  const baseHex = { hawk: 0x2f2822, trade: 0x45372a, coalition: 0x3a322b }[o.faction];
  const prim = new THREE.Color(baseHex);
  const hsl = {}; prim.getHSL(hsl);
  prim.setHSL(hsl.h, hsl.s, clamp(hsl.l * (1 + (rng() - 0.5) * 0.16), 0, 1)); // ±8% jasności
  const coal = o.faction === 'coalition';
  const trim = race.clone().multiplyScalar(coal ? 0.62 : 0.82);
  const b = o.emissiveBoost;
  const M = (name, p) => new THREE.MeshStandardMaterial({ name, ...p });
  return {
    primary: M('mat_hull_primary', { color: prim, metalness: 0.45, roughness: coal ? 0.72 : 0.55 }),
    secondary: M('mat_hull_secondary', { color: new THREE.Color(0x2a2927), metalness: 0.5, roughness: 0.6 }),
    trim: M('mat_trim_race', { color: trim, metalness: 0.85, roughness: coal ? 0.6 : 0.32 }),
    emissive: M('mat_emissive_race', {
      color: new THREE.Color(0x140d04), emissive: race, emissiveIntensity: 2.2 * b, metalness: 0, roughness: 0.5,
    }),
    glass: M('mat_glass', {
      color: new THREE.Color(0x1a120a), metalness: 0.3, roughness: 0.08, transparent: true, opacity: 0.78,
      emissive: race, emissiveIntensity: 0.18 * b,
    }),
    engine: M('mat_engine', {
      color: new THREE.Color(0x1c1208), emissive: new THREE.Color(0xffd6a0), emissiveIntensity: 3.2 * b,
      metalness: 0, roughness: 0.4,
    }),
    dark: M('mat_dark', { color: new THREE.Color(0x0e0d0c), metalness: 0.25, roughness: 0.88 }),
  };
}

// --------------------------------------------------------------- opcje
function normalizeOpts(opts) {
  const faction = ['hawk', 'trade', 'coalition'].includes(opts.faction) ? opts.faction : 'trade';
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  let raceColor = 0xe0b15a;
  if (typeof opts.raceColor === 'number') raceColor = opts.raceColor >>> 0;
  else if (typeof opts.raceColor === 'string' && opts.raceColor) raceColor = new THREE.Color(opts.raceColor).getHex();
  return {
    seed: Math.floor(num(opts.seed, 1)) >>> 0,
    faction,
    wear: clamp(num(opts.wear, 0.15), 0, 1),
    greebleDensity: clamp(num(opts.greebleDensity, 0.5), 0, 1),
    asymmetry: opts.asymmetry == null ? GONIEC_META.defaultAsymmetry[faction] : clamp(num(opts.asymmetry, 0), 0, 1),
    lengthScale: clamp(num(opts.lengthScale, 1), 0.85, 1.15),
    raceColor,
    emissiveBoost: clamp(num(opts.emissiveBoost, 1), 0, 5),
    uniqueMaterials: !!opts.uniqueMaterials,
  };
}

// -------------------------------------------------------------- budowa
function buildTemplate(o) {
  const rS = mulberry32(hash(o.seed, 1)); // proporcje i rozkład elementów rasowych
  const rD = mulberry32(hash(o.seed, 2)); // greeble
  const rW = mulberry32(hash(o.seed, 3)); // zużycie
  const rA = mulberry32(hash(o.seed, 4)); // asymetria
  const rM = mulberry32(hash(o.seed, 5)); // odcienie
  const mat = makeMaterials(o, rM);
  const F = o.faction, hawk = F === 'hawk', trade = F === 'trade', coal = F === 'coalition';
  const a = o.asymmetry;
  const v = (amt) => 1 + (rS() - 0.5) * 2 * amt;

  const root = new THREE.Group();
  root.name = 'goniec_root';
  const add = (geo, m, name, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  const hp = (name, x, y, z, ry = 0) => {
    const h = new THREE.Object3D();
    h.name = name; h.position.set(x, y, z); h.rotation.y = ry;
    root.add(h);
    return h;
  };

  // ---------- proporcje (seed ±8..15%, klasa/rasa stałe)
  const th = 0.7 * v(0.1);
  const hullW = 3.1 * v(0.08) * (trade ? 1.18 : 1);
  const t1W = hullW * 0.66, t2W = hullW * 0.36, t2H = th * 0.62;
  const engW = Math.max(3.5 * v(0.08), hullW + 0.35);
  const engH = 2.0 * v(0.1) * (hawk ? 1.05 : 1);
  const engD = 3.4 * v(0.12);
  const zR = -6.9;
  const zE = zR + engD / 2, yE = th * 0.25;
  const noseLen = 2.7 * v(0.15) * (hawk ? 0.9 : 1);
  const zNoseB = 3.7, zT0F = 4.0, zT1F = 5.1;
  const zT2B = zR + engD - 0.4, zT2F = 2.0 * v(0.2);

  // ---------- kondygnacje kadłuba (szafa katalogowa)
  const d0 = zT0F - zE, d1 = zT1F - zE, d2 = zT2F - zT2B;
  add(chamferBox(hullW, th, d0, 0.14), mat.primary, 'tier0_cargo', 0, -th / 2, (zT0F + zE) / 2);
  add(chamferBox(t1W, th, d1, 0.14), mat.primary, 'tier1', 0, th / 2, (zT1F + zE) / 2);
  add(chamferBox(t2W, t2H, d2, 0.1), mat.primary, 'tier2_register', 0, th + t2H / 2, (zT2F + zT2B) / 2);
  if (hawk) {
    add(chamferBox(t2W * 0.7, th * 0.42, 2.2, 0.08), mat.secondary, 'tier3_bastion', 0, th + t2H + th * 0.21, zT2B + 1.3);
  }

  // podziałka 16 kresek na grzbiecie rejestru
  for (let i = 0; i < 16; i++) {
    const z = zT2B + 0.3 + (i * (d2 - 0.6)) / 15;
    const w = i % 4 === 0 ? t2W * 0.92 : t2W * 0.5;
    add(box(w, 0.05, 0.06), mat.trim, `census_tick_${i}`, 0, th + t2H + 0.02, z);
  }

  // ---------- dziób: ciężki fazowany klin
  const noseD = zT1F + noseLen - zNoseB;
  const wB = hullW * 0.7, hB = th * 1.9, wF = 0.75, hF = 0.38, yF = -th * 0.1;
  const noseAt = (t) => ({ w: lerp(wB, wF, t), h: lerp(hB, hF, t), y: lerp(0, yF, t), z: zNoseB + noseD * t });
  add(taperBox(wB, hB, wF, hF, noseD, yF), mat.primary, 'nose_wedge', 0, 0, zNoseB + noseD / 2);
  const noseLayer = (t0, t1, sc, m, name) => {
    const A = noseAt(t0), B = noseAt(t1);
    add(taperBox(A.w * sc + 0.04, A.h * sc + 0.04, B.w * sc + 0.04, B.h * sc + 0.04, B.z - A.z, B.y - A.y),
      m, name, 0, A.y, (A.z + B.z) / 2);
  };
  noseLayer(0.38, 0.7, 1.04, mat.secondary, 'nose_armor_0');
  if (hawk) {
    noseLayer(0.46, 0.66, 1.12, mat.secondary, 'nose_armor_1');
    noseLayer(0.72, 0.95, 1.1, mat.secondary, 'nose_armor_2');
  }
  { const T = noseAt(0.985); add(box(T.w + 0.08, 0.07, 0.1), mat.trim, 'nose_brass_edge', 0, T.y, T.z); }

  // oczy-okna boczne: długie, wąskie, pod powiekami z płyt
  {
    const T = noseAt(0.17);
    const ang = Math.atan2((wB - wF) / 2, noseD);
    for (const s of [-1, 1]) {
      add(box(0.03, 0.07, 1.0), mat.glass, `eye_slit_${s > 0 ? 'stbd' : 'port'}`, s * (T.w / 2 + 0.012), T.y + 0.08, T.z, 0, -s * ang, 0);
      add(box(0.06, 0.035, 1.1), mat.secondary, `eye_lid_${s > 0 ? 'stbd' : 'port'}`, s * (T.w / 2 + 0.03), T.y + 0.14, T.z, 0, -s * ang, -s * 0.35);
    }
  }

  // kabina pilota: szczelina pod ciężką powieką
  const cabW = t2W * 1.1, zc = zT1F - 0.9;
  add(chamferBox(cabW, 0.34, 1.7, 0.08), mat.primary, 'cockpit_cab', 0, th + 0.17, zc);
  add(box(cabW * 0.82, 0.07, 0.04), mat.glass, 'cockpit_slit', 0, th + 0.2, zc + 0.865);
  add(box(cabW * 1.08, 0.05, 0.45), mat.secondary, 'cockpit_lid', 0, th + 0.33, zc + 0.8, 0.32, 0, 0);
  hp('hp_cockpit', 0, th + 0.25, zc + 0.3);

  // ---------- blok napędu (dominuje)
  add(chamferBox(engW, engH, engD, 0.22), mat.primary, 'engine_block', 0, yE, zE);
  // radiatory (thermal 60): stos poziomych lamel jak przegródki kartoteki
  const nFin = Math.round(CARD.thermal / 10), finW = 0.5 * (CARD.thermal / 60), finD = engD * 0.72;
  for (const s of [-1, 1]) {
    for (let i = 0; i < nFin; i++) {
      const y = yE - engH * 0.38 + (i * engH * 0.76) / (nFin - 1);
      add(box(finW, 0.05, finD), mat.secondary, `radiator_${s > 0 ? 's' : 'p'}_${i}`, s * (engW / 2 + finW / 2 - 0.02), y, zE);
    }
    for (const e of [-1, 1]) {
      add(box(finW + 0.02, engH * 0.82, 0.08), mat.dark, `radiator_cap_${s > 0 ? 's' : 'p'}_${e > 0 ? 'f' : 'a'}`,
        s * (engW / 2 + finW / 2 - 0.01), yE, zE + e * finD / 2);
    }
  }
  // reaktor (energy 100): szczelina emissive w ramie na grzbiecie
  add(box(engW * 0.56, 0.06, engD * 0.3), mat.dark, 'reactor_frame', 0, yE + engH / 2 + 0.02, zE);
  add(box(engW * 0.46 * (CARD.energy / 100), 0.08, engD * 0.12), mat.emissive, 'reactor_core', 0, yE + engH / 2 + 0.03, zE);
  add(box(0.14, engH * 0.45 * (CARD.energy / 100), 0.05), mat.emissive, 'reactor_rear_strip', 0, yE, zR - 0.02);

  // dwie prostokątne dysze z wnękami i łopatkami
  const nozW = engW * 0.36, nozH = engH * 0.6, nozD = 0.8, nx = engW * 0.235;
  [-1, 1].forEach((s, i) => {
    const x = s * nx, zc2 = zR - nozD / 2 + 0.1, tag = s > 0 ? 's' : 'p';
    add(box(nozW, 0.1, nozD), mat.dark, `nozzle_${tag}_top`, x, yE + nozH / 2 - 0.05, zc2);
    add(box(nozW, 0.1, nozD), mat.dark, `nozzle_${tag}_bot`, x, yE - nozH / 2 + 0.05, zc2);
    add(box(0.1, nozH, nozD), mat.dark, `nozzle_${tag}_in`, x - s * (nozW / 2 - 0.05), yE, zc2);
    add(box(0.1, nozH, nozD), mat.dark, `nozzle_${tag}_out`, x + s * (nozW / 2 - 0.05), yE, zc2);
    add(box(nozW - 0.2, nozH - 0.2, 0.05), mat.engine, `nozzle_${tag}_glow`, x, yE, zR - 0.12);
    for (let k = -1; k <= 1; k++) {
      add(box(nozW - 0.2, 0.04, 0.3), mat.secondary, `nozzle_${tag}_vane_${k + 1}`, x, yE + k * nozH * 0.24, zR - 0.4);
    }
    add(box(nozW + 0.06, nozH + 0.06, 0.08), mat.trim, `nozzle_${tag}_collar`, x, yE, zR - nozD + 0.14);
    hp(`hp_engine_${i}`, x, yE, zR - nozD + 0.1, Math.PI); // lokalne +Z hardpointu patrzy w -Z statku
  });

  // ---------- pierścień-pieczęć spisu (emiter fałdy)
  const zRing = zR + engD + 0.75, yRing = th * 0.2;
  const cornerDist = Math.max(
    Math.hypot(hullW / 2, th + yRing), Math.hypot(t1W / 2, th - yRing),
    Math.hypot(t2W / 2, th + t2H - yRing),
  );
  const engDiag = Math.hypot(engW / 2, engH / 2 + Math.abs(yE - yRing));
  const ringR = Math.max(2.2 * v(0.08), cornerDist + 0.3, engDiag * 1.02);
  add(polyRing(ringR + 0.13, ringR - 0.13, 0.32), mat.trim, 'seal_ring', 0, yRing, zRing);
  add(polyRing(ringR - 0.14, ringR - 0.22, 0.12), mat.emissive, 'seal_ring_glow', 0, yRing, zRing);
  for (let i = 0; i < 16; i++) {
    if (coal && rS() < 0.45) continue; // Bez Numeru: kreski zeszlifowane
    const ang = (i * Math.PI) / 8, len = i % 4 === 0 ? 0.6 : 0.32, r = ringR + 0.13 + len / 2 - 0.02;
    add(box(0.08, len, 0.22), mat.trim, `seal_tick_${i}`, Math.cos(ang) * r, yRing + Math.sin(ang) * r, zRing, 0, 0, ang - Math.PI / 2);
  }
  for (let k = 0; k < 4; k++) {
    const ang = Math.PI / 4 + (k * Math.PI) / 2, r0 = ringR * 0.45, len = ringR - 0.13 - r0, rc = r0 + len / 2;
    add(box(0.14, len, 0.2), mat.dark, `seal_strut_${k}`, Math.cos(ang) * rc, yRing + Math.sin(ang) * rc, zRing, 0, 0, ang - Math.PI / 2);
  }
  hp('hp_warp_emitter', 0, yRing, zRing);

  // ---------- szuflady-ładownie (cargo 20), wyrzutnie torped, kody
  const drawerW0 = 1.25 * v(0.12) * (trade ? 1.3 : 1);
  const drawerD0 = 4.2 * v(0.12);
  const drawerH = th * 0.9, yD = -th / 2;
  const zD0 = 0.9 * v(0.2);
  const ls = trade ? 0.72 : 1;
  const lw = 0.42 * ls, lh = 0.34 * ls, ld = 1.5 * ls * (hawk ? 1.15 : 1);
  const barBits = hash(o.seed, 99) ^ (o.seed * 2654435761);
  let wIdx = 0;
  const drawers = {};

  for (const s of [-1, 1]) {
    const tag = s > 0 ? 's' : 'p';
    let dw = drawerW0, dd = drawerD0 * (1 + (rA() - 0.5) * a * 0.5), zD = zD0 + (rA() - 0.5) * a * 1.6;
    if (coal && s < 0) { dd *= 0.78; zD -= 0.4; }
    zD = Math.max(zD, zRing + 0.35 + dd / 2); // szuflada nie wchodzi w pieczęć
    const xD = s * (hullW / 2 + dw / 2 - 0.02);
    drawers[tag] = { xD, zD, dd, dw };
    add(chamferBox(dw, drawerH, dd, 0.1), mat.primary, `drawer_${tag}`, xD, yD, zD);
    for (let k = 1; k <= 3; k++) {
      add(box(dw + 0.02, drawerH + 0.02, 0.035), mat.dark, `drawer_${tag}_seam_${k}`, xD, yD, zD - dd / 2 + (k * dd) / 4);
    }
    add(box(dw * 0.42, 0.06, 0.06), mat.trim, `drawer_${tag}_handle`, xD, yD + drawerH * 0.32, zD + dd / 2 + 0.02);
    add(box(0.07, 0.07, 0.04), mat.emissive, `nav_light_${tag}`, xD + s * (dw / 2 - 0.05), yD + drawerH * 0.32, zD + dd / 2 + 0.02);

    // wyrzutnia torpedy fałdowej
    const yL = yD - drawerH * 0.1, zL = zD + dd / 2 + ld / 2 - 0.25;
    const tubes = hawk ? [-lw * 0.52, lw * 0.52] : [0];
    tubes.forEach((tx, j) => {
      add(chamferBox(lw, lh, ld, 0.06), mat.secondary, `launcher_${tag}_${j}`, xD + tx, yL, zL);
      add(box(lw * 0.6, lh * 0.55, 0.04), mat.dark, `launcher_${tag}_${j}_bore`, xD + tx, yL, zL + ld / 2 + 0.005);
      add(box(lw + 0.05, lh + 0.05, 0.12), mat.trim, `launcher_${tag}_${j}_band`, xD + tx, yL, zL + ld / 2 - 0.22);
    });
    hp(`hp_weapon_${wIdx++}`, xD, yL, zL + ld / 2 + 0.02);

    // kod ewidencyjny (seed) wytłoczony na burcie szuflady
    const xF = xD + s * (dw / 2 + 0.01);
    const zStart = zD - dd / 2 + 0.25, zEnd = trade ? zD - 0.05 : zD + dd / 2 - 0.25;
    if (!coal) {
      let zc3 = zStart, i = 0;
      while (zc3 < zEnd - 0.12) {
        const guard = i < 2 || zc3 > zEnd - 0.35;
        const bit = (barBits >>> (i % 32)) & 1;
        const w = guard ? 0.045 : bit ? 0.1 : 0.045;
        add(box(0.02, drawerH * (guard ? 0.7 : 0.58), w), mat.trim, `code_${tag}_${i}`, xF, yD, zc3 + w / 2);
        zc3 += w + 0.05; i++;
      }
    } else {
      // Bez Numeru: kody wypalone — blizny w miejscu kodu
      const n = 5 + Math.floor(rS() * 4);
      for (let i = 0; i < n; i++) {
        const w = 0.08 + rS() * 0.27, z = lerp(zStart, zEnd - w, rS());
        add(box(0.025, drawerH * (0.3 + rS() * 0.55), w), mat.dark, `code_scar_${tag}_${i}`, xF, yD + (rS() - 0.5) * 0.1, z + w / 2, (rS() - 0.5) * 0.6, 0, 0);
      }
      for (let i = 0; i < 3; i++) {
        add(box(0.02, drawerH * 0.5, 0.045), mat.trim, `code_stub_${tag}_${i}`, xF, yD, zStart + i * 0.1);
      }
    }

    if (hawk) {
      // bastion: rogi na zewnątrz szuflad + kraty kartoteki na wieku
      add(chamferBox(0.32, drawerH * 0.8, 1.9, 0.07), mat.secondary, `bastion_horn_${tag}`, xD + s * (dw / 2 + 0.12), yD, zD + dd / 2 + 0.75);
      const yTop = yD + drawerH / 2 + 0.03;
      for (const fx of [-0.33, 0, 0.33]) add(box(0.05, 0.05, dd * 0.9), mat.dark, `lattice_${tag}_l${fx}`, xD + fx * dw, yTop, zD);
      const nx2 = Math.floor((dd * 0.9) / 0.4);
      for (let k = 0; k <= nx2; k++) add(box(dw * 0.8, 0.05, 0.05), mat.dark, `lattice_${tag}_c${k}`, xD, yTop, zD - dd * 0.45 + k * 0.4);
    }

    if (trade) {
      // Cech Rzeczników: pieczęć cechowa + piętro szuflad
      const sr = 0.36 * v(0.1);
      const zs = zD + dd * 0.25;
      add(polyDisc(sr, 0.06), mat.trim, `guild_seal_${tag}`, xF + s * 0.02, yD, zs, 0, Math.PI / 2, 0);
      add(polyDisc(sr * 0.68, 0.07), mat.secondary, `guild_seal_${tag}_in`, xF + s * 0.03, yD, zs, 0, Math.PI / 2, 0);
      add(polyRing(sr * 0.6, sr * 0.5, 0.08), mat.emissive, `guild_seal_${tag}_glow`, xF + s * 0.04, yD, zs, 0, Math.PI / 2, 0);
      const uw = dw * 0.8, ud = dd * 0.72, uh = th * 0.7, xU = s * (t1W / 2 + uw / 2 - 0.02), zU = zD - dd * 0.1;
      add(chamferBox(uw, uh, ud, 0.08), mat.primary, `drawer_upper_${tag}`, xU, uh / 2 + 0.02, zU);
      for (let k = 1; k <= 2; k++) add(box(uw + 0.02, uh + 0.02, 0.035), mat.dark, `drawer_upper_${tag}_seam_${k}`, xU, uh / 2 + 0.02, zU - ud / 2 + (k * ud) / 3);
      add(box(uw * 0.42, 0.06, 0.06), mat.trim, `drawer_upper_${tag}_handle`, xU, uh * 0.7, zU + ud / 2 + 0.02);
    }
  }

  // trzecia wyrzutnia: brzuszna, w osi
  {
    const yV = -th - lh / 2 - 0.1, zV = 2.2, ldV = ld * 0.9;
    add(box(lw * 0.6, 0.14, ldV * 0.8), mat.dark, 'launcher_v_pylon', 0, -th - 0.05, zV);
    add(chamferBox(lw, lh, ldV, 0.06), mat.secondary, 'launcher_v', 0, yV, zV);
    add(box(lw * 0.6, lh * 0.55, 0.04), mat.dark, 'launcher_v_bore', 0, yV, zV + ldV / 2 + 0.005);
    add(box(lw + 0.05, lh + 0.05, 0.12), mat.trim, 'launcher_v_band', 0, yV, zV + ldV / 2 - 0.22);
    hp(`hp_weapon_${wIdx++}`, 0, yV, zV + ldV / 2 + 0.02);
  }

  // coalition: zdobyczny moduł Wykonawców (wróg, -40) — trofeum < 15% bryły
  if (coal) {
    const P = drawers.p, yT = yD + drawerH / 2 + 0.34;
    add(box(0.18, 0.2, 1.2), mat.dark, 'trophy_pylon', P.xD, yD + drawerH / 2 + 0.08, P.zD);
    add(hexPrism(0.3, 1.9), mat.secondary, 'trophy_executor_pod', P.xD, yT, P.zD);
    for (let k = 0; k < 4; k++) add(hexPrism(0.315, 0.05), mat.dark, `trophy_clause_${k}`, P.xD, yT, P.zD - 0.6 + k * 0.4);
    add(box(0.3, 0.04, 0.03), mat.emissive, 'trophy_visor', P.xD, yT, P.zD + 0.96);
  }

  // ---------- pancerz nakładkowy (armor 5) na burtach tier1
  const tA = 0.03 + 0.012 * CARD.armor * (hawk ? 1.4 : 1), pl = 1.1;
  for (const s of [-1, 1]) {
    for (let z = zE + engD / 2 + 0.1; z + pl < zT1F - 0.15; z += pl + 0.08) {
      const zc4 = z + pl / 2;
      if (trade) {
        const U = drawers[s > 0 ? 's' : 'p'], zU = U.zD - U.dd * 0.1, ud = U.dd * 0.72;
        if (Math.abs(zc4 - zU) < ud / 2 + pl / 2) continue;
      }
      const tag = `${s > 0 ? 's' : 'p'}_${Math.round(z * 10)}`;
      if (rW() < o.wear * 0.5) {
        add(box(0.012, th * 0.6, pl * 0.9), mat.dark, `armor_missing_${tag}`, s * (t1W / 2 + 0.006), th / 2, zc4);
        continue;
      }
      const loose = rW() < o.wear * 0.4 ? (rW() - 0.5) * 0.25 : 0;
      add(chamferBox(tA, th * 0.72, pl, 0.03), mat.secondary, `armor_${tag}`, s * (t1W / 2 + tA / 2), th / 2, zc4, loose, 0, 0);
    }
  }

  // ---------- anteny rejestru (signature 50: dwie)
  for (const s of [-1, 1]) {
    const x = s * t2W * 0.3 + (rA() - 0.5) * a * 0.4, h = 0.9 * v(0.15);
    const bent = coal && s < 0 ? 0.5 : 0;
    add(rod(0.025, h), mat.dark, `antenna_${s > 0 ? 's' : 'p'}`, x, th + t2H + h / 2, zT2B + 0.3, 0, 0, bent);
    const tipX = x - Math.sin(bent) * h / 2, tipY = th + t2H + h / 2 + Math.cos(bent) * h / 2;
    add(box(0.06, 0.06, 0.06), mat.emissive, `antenna_tip_${s > 0 ? 's' : 'p'}`, tipX, tipY, zT2B + 0.3);
  }

  // ---------- greeble: prostopadłe, na siatce 0.05 (porządek)
  const nG = Math.round(4 + 36 * o.greebleDensity);
  for (let i = 0; i < nG; i++) {
    const w = snap(0.08 + rD() * 0.22), h = snap(0.03 + rD() * 0.07, 0.01), d = snap(0.1 + rD() * 0.5);
    const region = rD();
    let x, y, z;
    if (region < 0.45) {
      const side = rD() < 0.5 ? -1 : 1;
      x = side * snap(lerp(t2W / 2 + w / 2 + 0.03, t1W / 2 - w / 2 - 0.03, rD()));
      y = th + h / 2; z = snap(lerp(zE + engD / 2 + 0.3, zT1F - 1.9, rD()));
    } else if (region < 0.75) {
      const side = rD() < 0.5 ? -1 : 1;
      x = side * snap(lerp(engW * 0.3, engW * 0.45, rD()));
      y = yE + engH / 2 + h / 2 - 0.01; z = snap(lerp(zE - engD * 0.35, zE + engD * 0.35, rD()));
    } else {
      x = snap((rD() - 0.5) * hullW * 0.8);
      y = -th - h / 2; z = snap(lerp(zE + engD / 2 + 0.2, zT0F - 0.4, rD()));
      if (Math.abs(x) < lw && Math.abs(z - 2.2) < ld) continue; // nie zasłaniaj wyrzutni brzusznej
    }
    add(box(w, h, d), rD() < 0.6 ? mat.secondary : mat.dark, `greeble_${i}`, x, y, z);
  }

  // ---------- zużycie: osmalenia i łaty (geometria)
  const nScorch = Math.round(o.wear * 16);
  for (let i = 0; i < nScorch; i++) {
    const w = 0.2 + rW() * 0.6, d = 0.1 + rW() * 0.35;
    if (rW() < 0.55) {
      add(box(w, 0.012, d), mat.dark, `scorch_${i}`, (rW() - 0.5) * engW * 0.8, yE + engH / 2 + 0.006, zE - engD * 0.1 - rW() * engD * 0.35);
    } else {
      add(box(w * 0.7, d, 0.012), mat.dark, `scorch_${i}`, (rW() - 0.5) * engW * 0.85, yE + (rW() - 0.5) * engH * 0.8, zR - 0.01);
    }
  }
  const nPatch = Math.round(o.wear * 8) + (coal ? 3 : 0);
  for (let i = 0; i < nPatch; i++) {
    const pw = 0.2 + rW() * 0.3, pd = 0.3 + rW() * 0.4, rot = (rW() - 0.5) * 0.3;
    if (rW() < 0.5) {
      const tag = rW() < 0.5 ? 'p' : 's', D = drawers[tag], sgn = tag === 's' ? 1 : -1;
      add(chamferBox(0.03, pw, pd, 0.01), mat.secondary, `patch_${i}`, D.xD + sgn * (D.dw / 2 + 0.02), yD + (rW() - 0.5) * 0.2,
        D.zD + (rW() - 0.5) * D.dd * 0.7, rot, 0, 0);
    } else {
      add(chamferBox(pw, 0.03, pd, 0.01), mat.secondary, `patch_${i}`, (rW() - 0.5) * t1W * 0.8, th + 0.015,
        lerp(zE + engD / 2 + 0.3, zT1F - 1.9, rW()), 0, rot, 0);
    }
  }

  // ---------- skala do widełek klasy + wyśrodkowanie
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  const size = bb.getSize(new THREE.Vector3()), center = bb.getCenter(new THREE.Vector3());
  const [Lmin, Lmax] = GONIEC_META.lengthRange;
  const L = clamp(14.5 * (1 + (rS() - 0.5) * 0.12) * o.lengthScale, Lmin, Lmax);
  const k = L / size.z;
  root.scale.setScalar(k);
  root.position.set(-center.x * k, -center.y * k, -center.z * k);

  const group = new THREE.Group();
  group.name = `goniec_wybudzeni_${F}_${o.seed}`;
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
    race: 'wybudzeni',
    faction: F,
    factionName: GONIEC_META.factions[F],
    shipClass: 'przechwytywacz',
    name: 'Goniec',
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

export function buildGoniecWybudzeni(opts = {}) {
  const o = normalizeOpts(opts);
  const key = [
    'wybudzeni', 'przechwytywacz', o.faction, o.seed,
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

/** Zwalnia cache szablonów i geometrii (np. po sesji w edytorze). */
export function clearGoniecCache() {
  const mats = new Set();
  for (const t of _templates.values()) t.traverse((m) => { if (m.isMesh) mats.add(m.material); });
  mats.forEach((m) => m.dispose());
  _geo.forEach((g) => g.dispose());
  _templates.clear();
  _geo.clear();
}
