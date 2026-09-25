/**
 * thumb-raster.mjs — miniatura statku (PNG) liczona na procesorze, bez WebGL.
 *
 * Używa jej build-ships.mjs: każdy zbudowany statek dostaje obrazek
 * shared/ships/models/thumbs/<id>.png, który tablica misji pokazuje w wyborze
 * statku. Dzięki temu menu nie musi wczytywać modeli 3D ani rysować ich
 * w przeglądarce (na słabym telefonie to byłyby sekundy przycięć).
 *
 * Metoda: zwykły z-bufor z nadpróbkowaniem (SS×SS próbek na piksel, potem
 * uśrednienie = wygładzone krawędzie), płaskie cieniowanie per trójkąt
 * (światło główne + kontra + otoczenie) z kolorem i świeceniem materiału.
 * Kadr: dziób w lewo-do-przodu, lekko z góry - ten sam dla każdego statku,
 * każdy wypełnia kadr tak samo (dopasowanie kuli otaczającej).
 */
import * as THREE from 'three';
import { deflateSync } from 'node:zlib';

const KEY = new THREE.Vector3(-1, 1.4, -0.8).normalize();
const RIM = new THREE.Vector3(1.2, 0.3, 1).normalize();
const VIEW_DIR = new THREE.Vector3(-1, 0.55, -0.75).normalize(); // od środka statku do kamery

/**
 * @param {THREE.Object3D} root   statek (np. wynik mergeByMaterial)
 * @param {object} o
 * @param {string} [o.bowAxis='+Z'] gdzie model ma dziób (jak we fleet.js)
 * @returns {Buffer} plik PNG (RGBA, przezroczyste tło)
 */
export function renderThumbPNG(root, { bowAxis = '+Z', width = 200, height = 120, ss = 3, fov = 30 } = {}) {
  const W = width * ss, H = height * ss;

  // dziób w -Z, tak jak w grze (visualYawFor)
  const turn = new THREE.Matrix4().makeRotationY(bowAxis === '-Z' ? 0 : Math.PI);
  root.updateMatrixWorld(true);

  // zebrane trójkąty w układzie świata (po obrocie)
  const tris = []; // [ax,ay,az,bx,by,bz,cx,cy,cz, r,g,b(liniowe), er,eg,eb]
  const box = new THREE.Box3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(turn, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const col = mat?.color ?? new THREE.Color(0.6, 0.6, 0.6);
    const em = mat?.emissive ? mat.emissive.clone().multiplyScalar(mat.emissiveIntensity ?? 1) : new THREE.Color(0, 0, 0);
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m);
      box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      tris.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, col.r, col.g, col.b, em.r, em.g, em.b]);
    }
  });
  if (!tris.length) throw new Error('miniatura: model nie ma trójkątów');

  // kamera: kula otaczająca wypełnia kadr
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.01, 1e6);
  const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(fov / 2))) * 0.82;
  camera.position.copy(sphere.center).addScaledVector(VIEW_DIR, dist);
  camera.lookAt(sphere.center);
  camera.near = Math.max(0.01, dist - sphere.radius * 2);
  camera.far = dist + sphere.radius * 2;
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  // przycięcie kadru do samego statku: rzut wszystkich wierzchołków -> prostokąt
  // (z marginesem, w proporcjach obrazka) -> setViewOffset. Długi, wąski
  // statek wypełnia wtedy kadr, zamiast pływać w środku pustej kuli.
  {
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const q = new THREE.Vector4();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tris) {
      for (let k = 0; k < 9; k += 3) {
        q.set(t[k], t[k + 1], t[k + 2], 1).applyMatrix4(vp);
        const x = (q.x / q.w * 0.5 + 0.5) * width, y = (-q.y / q.w * 0.5 + 0.5) * height;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const pad = 1.08, aspect = width / height;
    let w = (x1 - x0) * pad, h = (y1 - y0) * pad;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    camera.setViewOffset(width, height, cx - w / 2, cy - h / 2, w, h);
    camera.updateProjectionMatrix();
  }
  const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  const zbuf = new Float32Array(W * H).fill(Infinity);
  const cbuf = new Float32Array(W * H * 3);
  const cov = new Uint8Array(W * H);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3(), toCam = new THREE.Vector3();
  const P = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

  for (const t of tris) {
    a.set(t[0], t[1], t[2]); b.set(t[3], t[4], t[5]); c.set(t[6], t[7], t[8]);
    // normalna ściany, zwrócona do kamery (rysujemy obie strony)
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (nrm.lengthSq() < 1e-20) continue;
    nrm.normalize();
    toCam.subVectors(camera.position, a);
    if (nrm.dot(toCam) < 0) nrm.negate();
    const lk = Math.max(0, nrm.dot(KEY)), lr = Math.max(0, nrm.dot(RIM));
    const up = 0.5 + 0.5 * nrm.y; // odrobina światła z góry (niebo) zamiast płaskiego otoczenia
    const shade = (base, rimTint, e) => base * (0.24 + 0.2 * up + 1.2 * lk + 0.42 * lr * rimTint) + e;
    const r = shade(t[9], 0.75, t[12]), g = shade(t[10], 0.9, t[13]), bl = shade(t[11], 1.25, t[14]);

    // rzut do pikseli
    let ok = true;
    const v = [a, b, c];
    for (let k = 0; k < 3; k++) {
      P[k].set(v[k].x, v[k].y, v[k].z, 1).applyMatrix4(viewProj);
      if (P[k].w <= 0) { ok = false; break; }
      P[k].x = ((P[k].x / P[k].w) * 0.5 + 0.5) * W;
      P[k].y = ((-P[k].y / P[k].w) * 0.5 + 0.5) * H;
      P[k].z = P[k].z / P[k].w;
    }
    if (!ok) continue;
    const [p0, p1, p2] = P;
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    if (Math.abs(area) < 1e-9) continue;
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = ((p1.x - px) * (p2.y - py) - (p1.y - py) * (p2.x - px)) / area;
        const w1 = ((p2.x - px) * (p0.y - py) - (p2.y - py) * (p0.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * p0.z + w1 * p1.z + w2 * p2.z;
        const i = y * W + x;
        if (z >= zbuf[i]) continue;
        zbuf[i] = z;
        cov[i] = 1;
        cbuf[i * 3] = r; cbuf[i * 3 + 1] = g; cbuf[i * 3 + 2] = bl;
      }
    }
  }

  // nadpróbkowanie -> piksele; tonemapping (Reinhard) + sRGB
  const tone = (x) => {
    const m = x / (1 + x * 0.55);
    return Math.round(255 * Math.min(1, m <= 0.0031308 ? m * 12.92 : 1.055 * Math.pow(m, 1 / 2.4) - 0.055));
  };
  const rgba = Buffer.alloc(width * height * 4);
  const n = ss * ss;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, bl = 0, hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = (y * ss + sy) * W + (x * ss + sx);
          if (!cov[i]) continue;
          hit++; r += cbuf[i * 3]; g += cbuf[i * 3 + 1]; bl += cbuf[i * 3 + 2];
        }
      }
      const o = (y * width + x) * 4;
      if (!hit) continue;
      rgba[o] = tone(r / hit); rgba[o + 1] = tone(g / hit); rgba[o + 2] = tone(bl / hit);
      rgba[o + 3] = Math.round((255 * hit) / n);
    }
  }
  return encodePNG(rgba, width, height);
}

// ------------------------------------------------------------ PNG
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const x of buf) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 bit, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtr: brak
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
