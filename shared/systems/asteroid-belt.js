import * as THREE from 'three';
import { ASTEROID_CLASSES, BELT, METAL_ORDER } from '../data/economy.js';

/**
 * PAS PLANETOID (krok 10): złoża metali dla warstwy ekonomicznej.
 *
 * Dwie warstwy, celowo rozdzielone:
 *   generateBelt(seed, center)  - czyste dane (klasa, promień, zasoby, kształt),
 *                                 deterministyczne z ziarna układu: ten sam
 *                                 układ = ten sam pas przy każdej wizycie, więc
 *                                 zapis gry trzyma tylko to, co już wykopano.
 *                                 Bez DOM i bez renderu - działa w Node (testy)
 *                                 i w symulacji "zaocznej" innych układów.
 *   createAsteroidBelt(scene, data) - siatki, obrót, kolizje, ślady wydobycia.
 *
 * KSZTAŁT. Planetoida to ikosaedr zniekształcony szumem 3D (kilka oktaw) i
 * kraterami. Ta sama funkcja kształtu (shapeAt) daje wierzchołki siatki i
 * punkt na powierzchni dla drona - dron ląduje dokładnie na skale, a nie na
 * sferze zastępczej. Planetoidy obracają się, więc miejsca wydobycia trzymamy
 * we współrzędnych LOKALNYCH bryły (dron "jedzie" na obracającej się skale).
 */

// ------------------------------------------------------------
// losowość z ziarnem (mulberry32) - powtarzalny pas
// ------------------------------------------------------------
export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// szum wartości 3D (gładki, z ziarnem) - wystarczy do kształtu skały
function makeNoise(rng) {
  const P = new Uint8Array(512);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const V = new Float32Array(256).map(() => rng() * 2 - 1);
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const h = (x, y, z) => V[P[P[P[x & 255] + (y & 255)] + (z & 255)]];
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    return lerp(
      lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
      w);
  };
}

function pickClass(r) {
  let acc = 0;
  for (const [id, c] of Object.entries(ASTEROID_CLASSES)) { acc += c.share; if (r < acc) return id; }
  return 'S';
}

/**
 * Dane pasa. `center` - środek pasa (THREE.Vector3 albo {x,y,z}).
 * @returns {{ seed, center, asteroids: Array }}
 */
export function generateBelt(seed, center, { quality = 1 } = {}) {
  const rng = seededRng(seed);
  const count = Math.max(8, Math.round(BELT.count * quality));
  const asteroids = [];
  const c = new THREE.Vector3(center.x, center.y, center.z);
  for (let i = 0; i < count; i++) {
    const cls = pickClass(rng());
    // rozkład promieni: dużo małych, mało dużych (potęga)
    const radius = BELT.minR + (BELT.maxR - BELT.minR) * rng() ** 2.2;
    // spłaszczony dysk wokół środka pasa, bez nakładania się
    let pos;
    for (let tries = 0; tries < 30; tries++) {
      const a = rng() * Math.PI * 2, d = BELT.radius * Math.sqrt(0.08 + 0.92 * rng());
      pos = new THREE.Vector3(Math.cos(a) * d, (rng() - 0.5) * BELT.thickness, Math.sin(a) * d).add(c);
      if (asteroids.every((o) => o.position.distanceTo(pos) > (o.radius + radius) * 1.6)) break;
    }
    const k = ASTEROID_CLASSES[cls];
    const total = Math.round(k.richness * (radius / 10) ** 2 * (0.8 + rng() * 0.4));
    const reserves = {};
    for (const m of METAL_ORDER) reserves[m] = Math.round(total * k.mix[m] * 10) / 10;
    asteroids.push({
      id: `a${i}`, index: i, cls, radius, position: pos,
      name: `${cls}-${String(100 + i * 7 + Math.floor(rng() * 7)).padStart(3, '0')}`,
      spinAxis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      spinRate: (0.02 + rng() * 0.06) * (rng() < 0.5 ? -1 : 1) * (120 / radius) ** 0.5,
      shapeSeed: Math.floor(rng() * 1e9),
      stretch: new THREE.Vector3(1 + rng() * 0.5, 0.75 + rng() * 0.25, 0.85 + rng() * 0.3),
      reserves, initial: { ...reserves }, total0: Object.values(reserves).reduce((a, b) => a + b, 0),
    });
  }
  return { seed, center: c, asteroids };
}

export function remaining(ast) {
  let s = 0;
  for (const m of METAL_ORDER) s += ast.reserves[m];
  return s;
}

/**
 * Kształt skały: promień (w jednostkach bryły) w kierunku `dir` (jednostkowy,
 * lokalny). Szum 3 oktawy + kratery + rozciągnięcie. Wynik w przybliżeniu 0.75-1.15.
 */
function makeShape(ast) {
  const rng = seededRng(ast.shapeSeed);
  const noise = makeNoise(rng);
  const craters = [];
  const nc = 3 + Math.floor(rng() * 5);
  for (let i = 0; i < nc; i++) {
    const d = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    craters.push({ d, size: 0.18 + rng() * 0.3, depth: 0.05 + rng() * 0.08 });
  }
  return (dir) => {
    let n = 0, amp = 0.5, f = 1.6;
    for (let o = 0; o < 3; o++) { n += noise(dir.x * f + 11, dir.y * f + 23, dir.z * f + 37) * amp; amp *= 0.5; f *= 2.1; }
    let r = 1 + n * 0.28;
    for (const c of craters) {
      const cosA = dir.dot(c.d);
      const t = (1 - cosA) / (c.size * c.size * 0.5); // 0 w środku krateru
      if (t < 1) r -= c.depth * (1 - t * t);           // misa
      else if (t < 1.6) r += c.depth * 0.35 * Math.sin((t - 1) / 0.6 * Math.PI); // wał
    }
    return r;
  };
}

// ------------------------------------------------------------
// siatki
// ------------------------------------------------------------
const _v = new THREE.Vector3();
const _c = new THREE.Color();

export function createAsteroidBelt(scene, data, { quality = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'asteroid-belt';
  const detail = quality < 0.8 ? 2 : 3;

  for (const ast of data.asteroids) {
    const k = ASTEROID_CLASSES[ast.cls];
    const shape = makeShape(ast);
    const veinNoise = makeNoise(seededRng(ast.shapeSeed ^ 0x5bd1e995));
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const rock = new THREE.Color(k.rock), vein = new THREE.Color(k.vein);
    const dirs = new Float32Array(pos.count * 3); // kierunek wierzchołka (do śladów wydobycia)
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).normalize();
      dirs[i * 3] = _v.x; dirs[i * 3 + 1] = _v.y; dirs[i * 3 + 2] = _v.z;
      const r = shape(_v);
      pos.setXYZ(i, _v.x * r * ast.stretch.x, _v.y * r * ast.stretch.y, _v.z * r * ast.stretch.z);
      // żyły metalu: pasma szumu o wysokiej częstotliwości; w dołach ciemniej
      const vn = Math.abs(veinNoise(_v.x * 5.3, _v.y * 5.3, _v.z * 5.3));
      const veinAmt = THREE.MathUtils.smoothstep(0.12, 0.0, vn) * (ast.cls === 'C' ? 0.35 : 0.85);
      _c.copy(rock).lerp(vein, veinAmt).multiplyScalar(0.8 + (r - 0.85) * 1.2);
      colors[i * 3] = _c.r; colors[i * 3 + 1] = _c.g; colors[i * 3 + 2] = _c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: ast.cls === 'M' ? 0.45 : 0.92, metalness: k.metalness, flatShading: detail < 3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(ast.position);
    mesh.scale.setScalar(ast.radius);
    mesh.quaternion.setFromAxisAngle(ast.spinAxis, ast.index * 1.7);
    mesh.userData.asteroidId = ast.id;
    group.add(mesh);
    mesh.updateMatrixWorld();
    ast.mesh = mesh;
    ast.shape = shape;
    ast.baseColors = colors.slice();
    ast.dirs = dirs;
    ast.solid = { position: mesh.position, radius: ast.radius * 0.9, name: `planetoida ${ast.name}` };
    if (remaining(ast) < ast.total0 * 0.02) markDepleted(ast);
  }
  scene.add(group);

  const _q = new THREE.Quaternion();
  function update(dt) {
    for (const ast of data.asteroids) {
      _q.setFromAxisAngle(ast.spinAxis, ast.spinRate * dt);
      ast.mesh.quaternion.premultiply(_q);
      // od razu, nie dopiero przy renderze: drony liczą punkt lądowania z tej
      // macierzy w tej samej klatce (inaczej siedziałyby klatkę "za skałą")
      ast.mesh.updateMatrixWorld();
    }
  }

  function dispose() {
    scene.remove(group);
    for (const ast of data.asteroids) {
      ast.mesh?.geometry.dispose(); ast.mesh?.material.dispose();
      ast.mesh = null; ast.solid = null;
    }
  }

  return { group, data, update, dispose };
}

/**
 * Punkt na powierzchni planetoidy (świat) w lokalnym kierunku `dirLocal`,
 * `lift` j. nad skałą. Wynik zapisany do `out`.
 */
export function surfacePoint(ast, dirLocal, lift, out) {
  const r = ast.shape ? ast.shape(dirLocal) : 1;
  out.set(dirLocal.x * r * ast.stretch.x, dirLocal.y * r * ast.stretch.y, dirLocal.z * r * ast.stretch.z);
  const len = out.length();
  out.multiplyScalar((len * ast.radius + lift) / (len * ast.radius)); // lift wzdłuż promienia
  if (!ast.mesh) return out.multiplyScalar(ast.radius).add(ast.position); // bez siatki (Node): bez obrotu
  return ast.mesh.localToWorld(out);
}

/**
 * Ślad wydobycia: skała wokół miejsca wiercenia ciemnieje i lekko się zapada
 * (wykop). `amount` - ile ton wydobyto w tym miejscu od ostatniego wywołania.
 */
export function markMined(ast, dirLocal, amount) {
  const mesh = ast.mesh;
  if (!mesh) return;
  const pos = mesh.geometry.attributes.position, col = mesh.geometry.attributes.color;
  const dirs = ast.dirs;
  const reach = 0.985 - Math.min(0.02, 8 / ast.radius); // mniejsza skała = większa plama
  const dig = Math.min(0.004, amount * 0.0006 * (100 / ast.radius));
  let touched = false;
  for (let i = 0; i < pos.count; i++) {
    const d = dirs[i * 3] * dirLocal.x + dirs[i * 3 + 1] * dirLocal.y + dirs[i * 3 + 2] * dirLocal.z;
    if (d < reach) continue;
    const w = (d - reach) / (1 - reach);
    const s = 1 - dig * w;
    // wykop nie głębszy niż ~12% promienia względem kształtu wyjściowego
    _v.fromBufferAttribute(pos, i);
    if (_v.length() > 0.7) pos.setXYZ(i, _v.x * s, _v.y * s, _v.z * s);
    // świeży urobek: ciepły, jaśniejszy odcień metalu, potem ciemna hałda
    col.setXYZ(i, col.getX(i) * (1 - 0.03 * w) + 0.02 * w, col.getY(i) * (1 - 0.035 * w) + 0.012 * w, col.getZ(i) * (1 - 0.04 * w));
    touched = true;
  }
  if (touched) { pos.needsUpdate = true; col.needsUpdate = true; }
}

/** Wyczerpana planetoida: szara, matowa hałda. */
export function markDepleted(ast) {
  const mat = ast.mesh?.material;
  if (!mat) return;
  mat.color.setRGB(0.55, 0.55, 0.58);
  mat.metalness = 0.02;
  mat.roughness = 1;
}
