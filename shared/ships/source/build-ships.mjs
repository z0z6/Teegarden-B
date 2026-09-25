#!/usr/bin/env node
/**
 * build-ships.mjs — generuje .glb statków z ships.manifest.js.
 *
 *   npm install three@0.184.0 gltfpack
 *   node shared/ships/source/build-ships.mjs            # wszystkie pozycje
 *   node shared/ships/source/build-ships.mjs --only goniec-wybudzeni-hawk-7,goniec-wybudzeni-trade-11
 *   node shared/ships/source/build-ships.mjs --patch    # dopisz brakujące wpisy do fleet.js i races.js
 *
 * Flagi:
 *   --only a,b    tylko wskazane id
 *   --no-lod      tylko LOD0 (bez LOD1/LOD2)
 *   --keep-raw    zostaw surowe *-raw.glb w models/raw/
 *   --patch       dopisz nowe id do SHIPS (fleet.js) i SHIP_RACE (races.js)
 *   --dry         nic nie zapisuj, tylko zbuduj i wypisz statystyki
 *
 * Kroki dla każdej pozycji: builder(opts) → scalenie meshy po materiale
 * (hardpointy hp_* zostają jako puste węzły) → GLTFExporter (binary) →
 * gltfpack: LOD0 -cc, LOD1 -si 0.35 -sp -cc, LOD2 -si 0.08 -sp -sa -cc
 * (te same flagi co w README.md). Do tego miniatura models/thumbs/<id>.png
 * (thumb-raster.mjs) - obrazek statku do wyboru na tablicy misji.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderThumbPNG } from './thumb-raster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------ CLI
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const ONLY = arg('--only') ? new Set(arg('--only').split(',').map((s) => s.trim())) : null;
const NO_LOD = flag('--no-lod'), KEEP_RAW = flag('--keep-raw'), PATCH = flag('--patch'), DRY = flag('--dry');

// GLTFExporter w Node.js potrzebuje FileReader
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

// ------------------------------------------------------------ scalanie
/** Jeden Mesh na materiał + puste węzły hp_*. Atrybuty ujednolicone do position+normal. */
function mergeByMaterial(group, id) {
  group.updateMatrixWorld(true);
  const byMat = new Map();
  const hardpoints = [];
  group.traverse((o) => {
    if (o.isMesh) {
      let g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.clearGroups();
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    } else if (o.name?.startsWith('hp_')) {
      hardpoints.push(o);
    }
  });

  const out = new THREE.Group();
  out.name = id;
  let tris = 0;
  for (const [material, geoms] of byMat) {
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error(`${id}: mergeGeometries nie powiódł się dla ${material.name}`);
    tris += merged.attributes.position.count / 3;
    const m = new THREE.Mesh(merged, material);
    m.name = `${id}__${material.name || 'mat'}`;
    out.add(m);
    geoms.forEach((g) => g.dispose());
  }
  for (const h of hardpoints) {
    const n = new THREE.Object3D();
    n.name = h.name;
    h.matrixWorld.decompose(n.position, n.quaternion, n.scale);
    n.scale.set(1, 1, 1);
    out.add(n);
  }
  out.userData = { ...group.userData };
  return { root: out, tris: Math.round(tris), materials: byMat.size, hardpoints: hardpoints.length };
}

async function exportGLB(obj) {
  const res = await new GLTFExporter().parseAsync(obj, { binary: true });
  return Buffer.from(res);
}

// ------------------------------------------------------------ gltfpack
function gltfpack(args) {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'gltfpack', ...args], { stdio: 'pipe' });
}
function haveGltfpack() {
  try { gltfpack(['-h']); return true; } catch (e) { return e.status != null && e.status !== 127 && !/not found|ENOENT/i.test(String(e.message)); }
}

// ------------------------------------------------------------ patchowanie
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

async function patchFleet(file, entries) {
  let src = await readFile(file, 'utf8');
  const start = src.indexOf('export const SHIPS = [');
  if (start < 0) throw new Error(`${file}: nie znaleziono "export const SHIPS = ["`);
  const end = src.indexOf('\n];', start);
  const block = src.slice(start, end);
  const add = entries.filter((e) => !block.includes(`id: ${q(e.id)}`));
  if (!add.length) return 0;
  const text = add.map((e) =>
    `  {\n    id: ${q(e.id)},\n    name: ${q(e.name)},\n    file: ${q(e.file)},\n    bowAxis: ${q(e.bowAxis)},\n  },`).join('\n');
  src = src.slice(0, end) + '\n' + text + src.slice(end);
  await writeFile(file, src);
  return add.length;
}

async function patchRaces(file, entries) {
  let src = await readFile(file, 'utf8');
  const start = src.indexOf('export const SHIP_RACE = {');
  if (start < 0) throw new Error(`${file}: nie znaleziono "export const SHIP_RACE = {"`);
  const end = src.indexOf('\n};', start);
  const block = src.slice(start, end);
  const add = entries.filter((e) => !block.includes(`${q(e.id)}:`));
  if (!add.length) return 0;
  src = src.slice(0, end) + '\n' + add.map((e) => `  ${q(e.id)}: ${q(e.race)},`).join('\n') + src.slice(end);
  await writeFile(file, src);
  return add.length;
}

// ------------------------------------------------------------ main
const manifest = (await import(pathToFileURL(resolve(HERE, 'ships.manifest.js')).href)).default;
const modelsDir = resolve(HERE, manifest.modelsDir ?? '../models');
const rawDir = resolve(modelsDir, 'raw');
const ships = manifest.ships.filter((s) => !ONLY || ONLY.has(s.id));
if (!ships.length) { console.error('Brak pozycji do zbudowania (sprawdź --only).'); process.exit(1); }

const ids = new Set();
for (const s of manifest.ships) {
  if (ids.has(s.id)) { console.error(`Zduplikowane id w manifeście: ${s.id}`); process.exit(1); }
  ids.add(s.id);
}

const packOK = DRY || haveGltfpack();
if (!packOK) console.warn('! gltfpack niedostępny (npm install gltfpack) — zapisuję nieskompresowany LOD0.');
if (!DRY) { await mkdir(modelsDir, { recursive: true }); await mkdir(rawDir, { recursive: true }); }

const built = [];
let failed = 0;
for (const s of ships) {
  const t0 = Date.now();
  try {
    const mod = await import(pathToFileURL(resolve(HERE, s.module)).href);
    const build = mod[s.builder];
    if (typeof build !== 'function') throw new Error(`${s.module} nie eksportuje ${s.builder}()`);
    const group = build(s.opts ?? {});
    const bowAxis = s.bowAxis ?? group.userData?.bowAxis ?? '+Z';
    const { root, tris, materials, hardpoints } = mergeByMaterial(group, s.id);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());

    const lod0 = resolve(modelsDir, `${s.id}-lod0.glb`);
    const thumb = renderThumbPNG(root, { bowAxis }); // liczona też przy --dry: błąd wyjdzie w teście
    if (!DRY) {
      await mkdir(resolve(modelsDir, 'thumbs'), { recursive: true });
      await writeFile(resolve(modelsDir, 'thumbs', `${s.id}.png`), thumb);
      const raw = resolve(rawDir, `${s.id}-raw.glb`);
      await writeFile(raw, await exportGLB(root));
      if (packOK) {
        gltfpack(['-i', raw, '-o', lod0, '-cc']);
        if (!NO_LOD) {
          gltfpack(['-i', raw, '-o', resolve(modelsDir, `${s.id}-lod1.glb`), '-si', '0.35', '-sp', '-cc']);
          gltfpack(['-i', raw, '-o', resolve(modelsDir, `${s.id}-lod2.glb`), '-si', '0.08', '-sp', '-sa', '-cc']);
        }
        if (!KEEP_RAW) await rm(raw);
      } else {
        await writeFile(lod0, await readFile(raw));
      }
    }

    const fileRel = '../' + relative(resolve(HERE, '../../..'), lod0).split('\\').join('/');
    built.push({ id: s.id, name: s.name ?? s.id, race: s.race, bowAxis, file: fileRel });
    console.log(`✓ ${s.id.padEnd(34)} ${String(tris).padStart(7)} tri  ${materials} mat  ${hardpoints} hp  ` +
      `${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} j.  ${Date.now() - t0} ms`);
  } catch (e) {
    failed++;
    console.error(`✗ ${s.id}: ${e.message}`);
  }
}
if (!KEEP_RAW && !DRY && existsSync(rawDir)) await rm(rawDir, { recursive: true, force: true }).catch(() => {});

if (built.length) {
  const withRace = built.filter((b) => b.race);
  if (PATCH && !DRY) {
    const nf = await patchFleet(resolve(HERE, manifest.fleetFile ?? '../fleet.js'), built);
    const nr = await patchRaces(resolve(HERE, manifest.racesFile ?? '../../data/races.js'), withRace);
    console.log(`\nfleet.js: +${nf} wpisów, races.js: +${nr} wpisów (istniejące id pominięte).`);
  } else {
    console.log('\n// shared/ships/fleet.js → SHIPS');
    for (const b of built) console.log(`  {\n    id: ${q(b.id)},\n    name: ${q(b.name)},\n    file: ${q(b.file)},\n    bowAxis: ${q(b.bowAxis)},\n  },`);
    console.log('\n// shared/data/races.js → SHIP_RACE');
    for (const b of withRace) console.log(`  ${q(b.id)}: ${q(b.race)},`);
  }
}
process.exit(failed ? 1 : 0);
