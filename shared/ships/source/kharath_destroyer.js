/**
 * buildKharathDestroyer() — proceduralnie buduje model statku "kharath_destroyer" jako THREE.Group.
 * Wyekstrahowane z pliku warbird-destroyer.html (bez zależności od <three-d-stage>).
 * Wymaga: npm install three
 */
import * as THREE from 'three';
const { Shape, ExtrudeGeometry, LatheGeometry, CylinderGeometry, BoxGeometry, SphereGeometry, ConeGeometry, TorusGeometry, Vector2, MeshStandardMaterial, Mesh, Group } = THREE;

function groundToOrigin(ship) {
  const box = new THREE.Box3().setFromObject(ship);
  ship.position.y -= box.min.y;
  return ship;
}

// Cache: geometria i materiały budowane są tylko raz, kolejne wywołania
// zwracają Object3D.clone() (patrz komentarz w warbird_light.js po więcej detali).
let _template = null;

function buildTemplate() {


const mat = {
  hull:   new MeshStandardMaterial({ name:'hull_green',  color:0x5c7a55, roughness:0.45, metalness:0.35 }),
  plate:  new MeshStandardMaterial({ name:'hull_plate',  color:0x3d5039, roughness:0.55, metalness:0.3 }),
  dark:   new MeshStandardMaterial({ name:'graphite',    color:0x23261f, roughness:0.7,  metalness:0.25 }),
  trim:   new MeshStandardMaterial({ name:'bronze_trim', color:0xb08a46, roughness:0.35, metalness:0.4 }),
  glass:  new MeshStandardMaterial({ name:'canopy_glass',color:0x1b2b2a, roughness:0.12, metalness:0.3, transparent:true, opacity:0.65 }),
  glow:   new MeshStandardMaterial({ name:'plasma_glow', color:0x0b1a18, roughness:0.4, metalness:0.1, emissive:0x35e0c4, emissiveIntensity:1.6 }),
  ion:    new MeshStandardMaterial({ name:'ion_edge',    color:0x0a1430, roughness:0.3, metalness:0.1, emissive:0x3d86ff, emissiveIntensity:2.4 }),
};

function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i+2]; a[i+2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const { array, itemSize } = attr;
      for (let i = 0; i < array.length; i += itemSize * 3) {
        for (let k = 0; k < itemSize; k++) {
          const t = array[i + k];
          array[i + k] = array[i + itemSize * 2 + k];
          array[i + itemSize * 2 + k] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}
// Bake a mirrored copy: geometry is flattened into the group's space, mirrored
// in x and re-wound, so every world matrix keeps a positive determinant and the
// OBJ/GLB exports carry correct face winding.
function bakeMirror(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const g2 = m.geometry.clone();
    g2.applyMatrix4(rel);
    g2.scale(-1, 1, 1);
    flipWinding(g2);
    g2.computeVertexNormals();
    m.geometry = g2;
    root.add(m);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    m.updateMatrix();
  }
}

const ship = new Group();
ship.name = 'kharath_destroyer';
const add = (m, name, parent) => { m.name = name; m.castShadow = true; m.receiveShadow = true; (parent||ship).add(m); return m; };



/* ---------- mantle (squid-like body) ---------- */
const prof = [
  [0.00, 15.4],[0.55, 14.8],[1.25, 13.6],[2.10, 11.8],[2.90, 9.4],[3.40, 6.6],
  [3.55, 3.6],[3.40, 0.6],[3.05, -2.4],[2.60, -5.2],[2.15, -7.6],[1.85, -9.4],
  [1.70, -10.8],[1.55, -12.0],[0.80, -12.6],[0.00, -12.8]
].map(([r, z]) => new Vector2(r, z));
const mantle = add(new Mesh(new LatheGeometry(prof, 48), mat.hull), 'mantle_hull');
mantle.rotation.x = Math.PI/2;
mantle.scale.set(1.0, 1, 0.80);

// segmented chitin ribs over the mantle
for (let i = 0; i < 11; i++) {
  const t = i / 10;
  const z = 12.6 - t * 23.5;
  const r = 0.55 + 3.0 * Math.sin(Math.PI * Math.min(Math.max((z + 12.8) / 28.2, 0), 1)) ** 0.7;
  const rib = add(new Mesh(new TorusGeometry(Math.max(r, 0.6), 0.16 - t * 0.05, 10, 34), i % 2 ? mat.plate : mat.dark), `mantle_rib_${i+1}`);
  rib.position.set(0, 0, z);
  rib.scale.set(1.04, 0.84, 1);
}
for (let i = 0; i < 4; i++) {
  const band = add(new Mesh(new TorusGeometry(3.3 - i * 0.35, 0.07, 10, 40), mat.trim), `trim_band_${i+1}`);
  band.position.set(0, 0, 6.0 - i * 3.6);
  band.scale.set(1.02, 0.82, 1);
}

// mantle apex spike
const apex = add(new Mesh(new ConeGeometry(0.55, 4.2, 24), mat.plate), 'mantle_apex');
apex.rotation.x = Math.PI/2; apex.position.set(0, 0, 16.6);
const apexGlow = add(new Mesh(new SphereGeometry(0.26, 20, 14), mat.glow), 'apex_emitter');
apexGlow.position.set(0, 0, 18.6);

/* ---------- swimming fins on the mantle ---------- */
function mantleFin(sign) {
  const s = new Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(3.4, 1.2, 6.2, 4.4);
  s.lineTo(5.4, 5.6);
  s.quadraticCurveTo(3.0, 2.6, 0, -1.4);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.14, bevelSegments: 2, curveSegments: 24 });
  geo.translate(0, 0, -0.175);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const m = add(new Mesh(geo, mat.hull), sign > 0 ? 'mantle_fin_starboard' : 'mantle_fin_port');
  m.rotation.x = Math.PI/2;
  m.rotation.z = -sign * 0.18;
  m.position.set(sign * 2.6, 0.2, 4.2);
}
mantleFin(1); mantleFin(-1);

/* ---------- heavy forward-swept wings ---------- */
function forwardWing(sign) {
  const s = new Shape();            // x = outboard, -y = forward
  s.moveTo(0, 1.8);
  s.lineTo(2.2, 1.2);
  s.quadraticCurveTo(6.4, -6.0, 10.6, -17.5);
  s.lineTo(9.0, -20.2);
  s.quadraticCurveTo(6.2, -13.0, 2.6, -6.2);
  s.quadraticCurveTo(1.0, -3.0, 0, -1.0);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.45, bevelSegments: 3, curveSegments: 28 });
  geo.translate(0, 0, -0.95);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const w = add(new Mesh(geo, mat.hull), sign > 0 ? 'wing_starboard' : 'wing_port');
  w.rotation.x = Math.PI/2;
  w.rotation.z = -sign * 0.10;
  w.position.set(sign * 2.3, -0.3, -3.2);

  // root fairing where the wing meets the mantle
  const fair = add(new Mesh(new SphereGeometry(1.5, 22, 16), mat.plate), sign > 0 ? 'wing_root_starboard' : 'wing_root_port');
  fair.position.set(sign * 2.5, -0.3, -4.6);
  fair.scale.set(1.0, 0.7, 3.0);

  // leading-edge trim strake
  const strake = add(new Mesh(new BoxGeometry(0.45, 0.5, 13.0), mat.trim), sign > 0 ? 'wing_strake_starboard' : 'wing_strake_port');
  strake.position.set(sign * 7.4, -0.3, -11.4);
  strake.rotation.y = -sign * 0.52;
}
forwardWing(1); forwardWing(-1);

/* ---------- outer wing pair: mounted on pylons, standing off the hull ---------- */
function outerWing(sign) {
  const s = new Shape();
  s.moveTo(0, 3.2);
  s.lineTo(2.6, 2.4);
  s.quadraticCurveTo(7.8, -5.0, 13.4, -18.0);
  s.lineTo(11.4, -21.6);
  s.quadraticCurveTo(7.4, -12.0, 3.0, -5.0);
  s.quadraticCurveTo(1.2, -1.8, 0, 0.4);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.5, bevelSegments: 3, curveSegments: 28 });
  geo.translate(0, 0, -1.1);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const w = add(new Mesh(geo, mat.plate), sign > 0 ? 'outer_wing_starboard' : 'outer_wing_port');
  w.rotation.x = Math.PI/2;
  w.rotation.z = -sign * 0.06;
  w.position.set(sign * 7.6, 2.6, 2.6);

  const pylon = add(new Mesh(new BoxGeometry(6.2, 1.2, 3.4), mat.dark), sign > 0 ? 'outer_pylon_starboard' : 'outer_pylon_port');
  pylon.position.set(sign * 5.2, 2.2, 2.8);
  pylon.rotation.z = -sign * 0.22;

  const strut = add(new Mesh(new CylinderGeometry(0.42, 0.42, 6.0, 16), mat.trim), sign > 0 ? 'outer_strut_starboard' : 'outer_strut_port');
  strut.position.set(sign * 5.0, 1.0, -1.6);
  strut.rotation.z = Math.PI/2 - sign * 0.5;
  strut.rotation.x = 0.5;
}
outerWing(1); outerWing(-1);

/* ---------- lower wing pair: largest, slung below the hull ---------- */
function lowerWing(sign) {
  const s = new Shape();
  s.moveTo(0, 4.0);
  s.lineTo(3.2, 3.0);
  s.quadraticCurveTo(9.6, -6.0, 16.8, -21.0);
  s.lineTo(14.2, -25.4);
  s.quadraticCurveTo(9.2, -14.5, 3.6, -6.0);
  s.quadraticCurveTo(1.4, -2.2, 0, 0.6);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 2.6, bevelEnabled: true, bevelThickness: 0.45, bevelSize: 0.55, bevelSegments: 3, curveSegments: 28 });
  geo.translate(0, 0, -1.3);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const w = add(new Mesh(geo, mat.hull), sign > 0 ? 'lower_wing_starboard' : 'lower_wing_port');
  w.rotation.x = Math.PI/2;
  w.rotation.z = sign * 0.12;
  w.position.set(sign * 8.6, -3.4, 1.4);

  const pylon = add(new Mesh(new BoxGeometry(7.0, 1.3, 3.8), mat.dark), sign > 0 ? 'lower_pylon_starboard' : 'lower_pylon_port');
  pylon.position.set(sign * 5.6, -2.7, 1.6);
  pylon.rotation.z = sign * 0.24;

  const strut = add(new Mesh(new CylinderGeometry(0.46, 0.46, 6.6, 16), mat.trim), sign > 0 ? 'lower_strut_starboard' : 'lower_strut_port');
  strut.position.set(sign * 5.4, -1.6, -2.6);
  strut.rotation.z = Math.PI/2 + sign * 0.5;
  strut.rotation.x = -0.5;
}
lowerWing(1); lowerWing(-1);

/* ---------- ventral finlets: small, right off the belly ---------- */
function bellyFin(sign) {
  const s = new Shape();
  s.moveTo(0, 2.0);
  s.lineTo(1.4, 1.6);
  s.quadraticCurveTo(3.6, -2.6, 6.2, -9.2);
  s.lineTo(5.0, -11.0);
  s.quadraticCurveTo(3.4, -6.4, 1.6, -3.0);
  s.quadraticCurveTo(0.7, -1.2, 0, 0.2);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.3, bevelSegments: 3, curveSegments: 24 });
  geo.translate(0, 0, -0.6);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const w = add(new Mesh(geo, mat.plate), sign > 0 ? 'belly_fin_starboard' : 'belly_fin_port');
  w.rotation.x = Math.PI/2;
  w.rotation.z = sign * 0.30;
  w.position.set(sign * 1.5, -2.5, -2.0);
}
bellyFin(1); bellyFin(-1);

/* ---------- keel vanes: hanging straight down off the underside ---------- */
function keelVane(sign) {
  const s = new Shape();                 // x = span, -y = forward
  s.moveTo(0, 1.6);
  s.lineTo(1.2, 1.3);
  s.quadraticCurveTo(2.6, -2.0, 4.4, -7.4);
  s.lineTo(3.3, -8.8);
  s.quadraticCurveTo(2.3, -4.8, 1.2, -2.4);
  s.quadraticCurveTo(0.6, -1.0, 0, 0.2);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.24, bevelSegments: 3, curveSegments: 24 });
  geo.translate(0, 0, -0.45);
  // bake the orientation into the geometry: span hangs down (-y), sweep forward (-z)
  geo.rotateX(Math.PI/2);
  geo.rotateZ(-Math.PI/2);
  geo.computeVertexNormals();
  const w = add(new Mesh(geo, mat.hull), sign > 0 ? 'keel_vane_starboard' : 'keel_vane_port');
  w.rotation.z = sign * 0.26;            // slight outward splay
  w.position.set(sign * 1.1, -2.6, 0.4);

  const root = add(new Mesh(new BoxGeometry(1.0, 1.0, 4.2), mat.dark), sign > 0 ? 'keel_root_starboard' : 'keel_root_port');
  root.position.set(sign * 1.1, -2.6, -0.6);
}
keelVane(1); keelVane(-1);

/* ---------- drive winglets: two small pairs raked back toward the siphons ---------- */
function driveWinglet(sign, tier) {
  const k = tier === 0 ? 1.0 : 0.78;
  const s = new Shape();                 // x = span, +y = aft (toward the drive)
  s.moveTo(0, -1.4 * k);
  s.lineTo(1.1 * k, -1.0 * k);
  s.quadraticCurveTo(2.8 * k, 2.2 * k, 4.6 * k, 6.6 * k);
  s.lineTo(3.4 * k, 7.8 * k);
  s.quadraticCurveTo(2.2 * k, 4.2 * k, 1.0 * k, 1.8 * k);
  s.quadraticCurveTo(0.5 * k, 0.6 * k, 0, 0.0);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.8 * k, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.22, bevelSegments: 3, curveSegments: 22 });
  geo.translate(0, 0, -0.4 * k);
  geo.rotateX(Math.PI/2);                // span in x, sweep toward +z (the drive)
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); }
  geo.computeVertexNormals();
  const name = `drive_winglet_${tier === 0 ? 'upper' : 'lower'}_${sign > 0 ? 'starboard' : 'port'}`;
  const w = add(new Mesh(geo, tier === 0 ? mat.plate : mat.hull), name);
  w.rotation.z = tier === 0 ? sign * 0.55 : -sign * 0.62;   // upper pair cants up, lower pair down
  w.position.set(sign * 2.2, tier === 0 ? 1.6 : -1.4, tier === 0 ? 3.4 : 4.6);

  // ion-emitting trailing edge, facing the siphon drive
  const th = Math.atan2(3.4, 7.8), L = k * Math.hypot(3.4, 7.8);
  const bar = new BoxGeometry(0.34 * k, L, 0.3 * k);
  bar.rotateZ(-th);
  bar.translate(1.7 * k, 3.9 * k, 0);
  bar.rotateX(Math.PI/2);
  if (sign < 0) { bar.scale(-1, 1, 1); flipWinding(bar); }
  bar.computeVertexNormals();
  const edge = add(new Mesh(bar, mat.ion), `ion_edge_${name}`);
  edge.rotation.copy(w.rotation);
  edge.position.copy(w.position);

  const rib = add(new Mesh(new BoxGeometry(0.4, 0.4, 3.0 * k), mat.trim), `${name}_rib`);
  rib.position.set(sign * 2.4, tier === 0 ? 1.9 : -1.7, (tier === 0 ? 3.4 : 4.6) + 1.4);
}
[0, 1].forEach(tier => { driveWinglet(1, tier); driveWinglet(-1, tier); });

/* ---------- outboard drive wings: same roots, twice the span ---------- */
function driveWing(sign, tier) {
  const k = tier === 0 ? 2.0 : 1.7;
  const s = new Shape();
  s.moveTo(0, -1.4 * k);
  s.lineTo(1.1 * k, -1.0 * k);
  s.quadraticCurveTo(2.9 * k, 2.4 * k, 4.8 * k, 7.0 * k);
  s.lineTo(3.5 * k, 8.4 * k);
  s.quadraticCurveTo(2.3 * k, 4.4 * k, 1.0 * k, 1.8 * k);
  s.quadraticCurveTo(0.5 * k, 0.6 * k, 0, 0.0);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.55 * k, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.28, bevelSegments: 3, curveSegments: 22 });
  geo.translate(0, 0, -0.28 * k);
  geo.rotateX(Math.PI/2);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); }
  geo.computeVertexNormals();
  const name = `drive_wing_${tier === 0 ? 'upper' : 'lower'}_${sign > 0 ? 'starboard' : 'port'}`;
  const w = add(new Mesh(geo, tier === 0 ? mat.hull : mat.plate), name);
  w.rotation.z = tier === 0 ? sign * 0.30 : -sign * 0.38;   // shallower cant, outboard of the winglets
  w.position.set(sign * 2.2, tier === 0 ? 1.6 : -1.4, tier === 0 ? 3.4 : 4.6);
}
[0, 1].forEach(tier => { driveWing(1, tier); driveWing(-1, tier); });

/* ---------- axial drive wings: dorsal + ventral, ion-lit trailing edges ---------- */
function axialDriveWing(dir, tier) {
  const k = tier === 0 ? 2.0 : 1.7;
  const s = new Shape();
  s.moveTo(0, -1.4 * k);
  s.lineTo(1.1 * k, -1.0 * k);
  s.quadraticCurveTo(2.9 * k, 2.4 * k, 4.8 * k, 7.0 * k);
  s.lineTo(3.5 * k, 8.4 * k);
  s.quadraticCurveTo(2.3 * k, 4.4 * k, 1.0 * k, 1.8 * k);
  s.quadraticCurveTo(0.5 * k, 0.6 * k, 0, 0.0);
  s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.55 * k, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.28, bevelSegments: 3, curveSegments: 22 });
  geo.translate(0, 0, -0.28 * k);
  const orient = g => { g.rotateX(Math.PI/2); g.rotateZ(dir * Math.PI/2); g.computeVertexNormals(); return g; };
  orient(geo);
  const tag = `${tier === 0 ? 'inner' : 'outer'}_${dir > 0 ? 'dorsal' : 'ventral'}`;
  const z0 = tier === 0 ? 3.4 : 4.6;
  const w = add(new Mesh(geo, tier === 0 ? mat.hull : mat.plate), `axial_drive_wing_${tag}`);
  w.position.set(0, dir > 0 ? 2.2 : -2.0, z0);

  // ion-emitting trailing edge, facing the siphon drive
  const th = Math.atan2(3.5, 8.4), L = k * Math.hypot(3.5, 8.4);
  const bar = new BoxGeometry(0.5 * k, L, 0.42 * k);
  bar.rotateZ(-th);
  bar.translate(1.75 * k, 4.2 * k, 0);
  orient(bar);
  const edge = add(new Mesh(bar, mat.ion), `ion_edge_${tag}`);
  edge.position.copy(w.position);

  const pylon = add(new Mesh(new BoxGeometry(1.0, 1.6, 2.6), mat.dark), `axial_wing_root_${tag}`);
  pylon.position.set(0, dir > 0 ? 2.0 : -1.8, z0 - 0.4);
}
[0, 1].forEach(tier => { axialDriveWing(1, tier); axialDriveWing(-1, tier); });

/* ---------- head / mouth hub ---------- */
const head = add(new Mesh(new SphereGeometry(2.4, 32, 22), mat.plate), 'head_bulb');
head.scale.set(1.0, 0.85, 1.15);
head.position.set(0, 0, -11.4);
const eyeL = add(new Mesh(new SphereGeometry(0.85, 24, 18), mat.glass), 'eye_port');
eyeL.position.set(-2.0, 0.55, -10.9); eyeL.scale.set(0.7, 1, 1);
const eyeR = add(new Mesh(new SphereGeometry(0.85, 24, 18), mat.glass), 'eye_starboard');
eyeR.position.set(2.0, 0.55, -10.9); eyeR.scale.set(0.7, 1, 1);
const maw = add(new Mesh(new CylinderGeometry(1.25, 0.95, 1.1, 28), mat.dark), 'maw_housing');
maw.rotation.x = Math.PI/2; maw.position.set(0, 0, -13.4);
const mawGlow = add(new Mesh(new SphereGeometry(0.7, 24, 16), mat.glow), 'maw_core');
mawGlow.position.set(0, 0, -13.7); mawGlow.scale.set(1, 1, 0.6);
const mawRing = add(new Mesh(new TorusGeometry(1.15, 0.10, 12, 34), mat.trim), 'maw_ring');
mawRing.position.set(0, 0, -13.7);

/* ---------- tentacle arms: cradling an unseen bottle ---------- */
// The bottle lies on the ship's axis ahead of the head, its cork touching the
// hull tip; every arm follows that silhouette — out over the shoulder, along
// the body, then curling in under the base.
const BOTTLE = [
  [0.00, 0.95], [0.08, 1.50], [0.18, 2.10], [0.30, 3.40], [0.45, 3.85],
  [0.62, 3.90], [0.78, 3.55], [0.90, 2.40], [1.00, 1.00],
];
function bottleRadius(t) {
  t = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < BOTTLE.length; i++) {
    if (t <= BOTTLE[i][0]) {
      const [t0, r0] = BOTTLE[i-1], [t1, r1] = BOTTLE[i];
      const k = (t - t0) / (t1 - t0);
      return r0 + (r1 - r0) * k;
    }
  }
  return BOTTLE[BOTTLE.length - 1][1];
}

// Chain of tapering segments laid along an explicit polyline (ship space).
function buildArmPath(id, pts, thick, tip) {
  const arm = new Group();
  arm.name = id;
  ship.add(arm);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 2);
    const a = pts[i], b = pts[i+1];
    const L = a.distanceTo(b);
    const r0 = Math.max(thick * (1 - t * 0.78), 0.07);
    const r1 = Math.max(thick * (1 - Math.min(t + 1 / (pts.length - 1), 1) * 0.78), 0.06);
    const seg = add(new Mesh(new CylinderGeometry(r1, r0, L * 1.06, 14), i % 2 ? mat.hull : mat.plate), `${id}_seg_${i+1}`, arm);
    seg.position.copy(a).lerp(b, 0.5);
    seg.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    seg.scale.set(1.85, 1, 0.55);   // thick but flattened, ribbon-like
    const collar = add(new Mesh(new TorusGeometry(r0 * 1.16, 0.045 + 0.035 * (1 - t), 8, 18), mat.trim), `${id}_collar_${i+1}`, arm);
    collar.position.copy(a);
    collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
    collar.scale.set(1.9, 0.58, 1);
  }
  if (tip) {
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dir = last.clone().sub(prev).normalize();
    const club = add(new Mesh(new CylinderGeometry(0.30, 0.14, 1.5, 14), mat.plate), `${id}_club`, arm);
    club.position.copy(last).add(dir.clone().multiplyScalar(0.5));
    club.quaternion.setFromUnitVectors(up, dir);
    club.scale.set(1.9, 1, 0.56);
    const spark = add(new Mesh(new SphereGeometry(0.16, 16, 12), mat.glow), `${id}_emitter`, arm);
    spark.position.copy(last).add(dir.clone().multiplyScalar(1.25));
  }
}

const HEAD_Z = -12.8;       // arms leave the head here
const BOTTLE_LEN = 92.0;    // hull is ~33 m, so the arms run ~3x its length
const SPREAD = 3.4;         // how far the arms bow away from the axis
function armPath(angle, segs, reach, curlIn, lift) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const r = (bottleRadius(t * reach) * SPREAD) * (1 - curlIn * Math.pow(t, 3.2)) + 0.6 * (1 - t);
    const z = HEAD_Z - BOTTLE_LEN * reach * t;
    pts.push(new THREE.Vector3(
      Math.cos(angle) * r,
      Math.sin(angle) * r + lift * Math.pow(t, 1.5) * SPREAD,
      z
    ));
  }
  return pts;
}

const CROWN = 12;
for (let i = 0; i < CROWN; i++) {
  const a = (i / CROWN) * Math.PI * 2 + Math.PI / CROWN;
  // upper arms sit shorter than the lower ones
  const upper = Math.sin(a) > 0;
  const topPair = i === 2 || i === 3;          // the two uppermost arms
  const reach = topPair ? 1.10 : (upper ? 0.62 : 0.94);   // top pair and the ventral arms run longest
  const thick = topPair ? 2.35 : (upper ? 1.45 : 2.15);   // heaviest cross-section top and bottom
  buildArmPath(`arm_${i+1}`, armPath(a, topPair ? 24 : (upper ? 15 : 20), reach, 0.20, 0.30), thick, false);
}
// the two ventral tentacles run longer than the rest
[[-1, 'port'], [1, 'starboard']].forEach(([s, label]) => {
  const a = -Math.PI/2 + s * 0.42;
  buildArmPath(`tentacle_${label}`, armPath(a, 28, 1.42, 0.34, 0.18), 2.30, true);
});

/* ---------- fine cirri trailing aft of the drive ---------- */
// A bundle of small tentacles ringing the siphon cluster, streaming the
// opposite way from the main arms.
const CIRRI = 12;
const CIRRUS_LEN = 22.0;
for (let i = 0; i < CIRRI; i++) {
  const a = (i / CIRRI) * Math.PI * 2;
  const wob = (i % 3) * 0.12;
  const pts = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    const r = 2.6 + 1.9 * Math.sin(Math.PI * t * 0.8) - 1.4 * Math.pow(t, 3);
    pts.push(new THREE.Vector3(
      Math.cos(a) * r,
      Math.sin(a) * r * 0.9 - 0.2,
      11.2 + CIRRUS_LEN * t * (0.8 + wob)
    ));
  }
  buildArmPath(`cirrus_${i+1}`, pts, 0.42, false);
}

/* ---------- second aft wreath: shorter, wider splay ---------- */
const CIRRI2 = 12;
for (let i = 0; i < CIRRI2; i++) {
  const a = (i / CIRRI2) * Math.PI * 2 + Math.PI / CIRRI2;
  const pts = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const r = 2.6 + 5.2 * Math.sin(Math.PI * t * 0.55);
    pts.push(new THREE.Vector3(
      Math.cos(a) * r,
      Math.sin(a) * r * 0.9 - 0.2,
      11.2 + 11.0 * t
    ));
  }
  buildArmPath(`cirrus_flare_${i+1}`, pts, 0.36, false);
}

/* ---------- forward wreath: short, widely splayed ---------- */
const FORE = 12;
for (let i = 0; i < FORE; i++) {
  const a = (i / FORE) * Math.PI * 2 + Math.PI / FORE;
  const low = Math.sin(a) < -0.5, top = Math.sin(a) > 0.5;
  const len = low ? 96.0 : (top ? 88.0 : (i % 2 ? 72.0 : 52.0));
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const r = 2.4 + 22.0 * Math.sin(Math.PI * t * 0.52);
    pts.push(new THREE.Vector3(
      Math.cos(a) * r,
      Math.sin(a) * r * 0.9,
      -13.2 - len * t
    ));
  }
  buildArmPath(`cirrus_fore_${i+1}`, pts, low ? 1.75 : (top ? 1.55 : 0.95), false);
}

/* ---------- mid forward wreath: between the crown and the outer wreath ---------- */
const MID = 12;
for (let i = 0; i < MID; i++) {
  const a = (i / MID) * Math.PI * 2;
  const low = Math.sin(a) < -0.5, top = Math.sin(a) > 0.5;
  const len = low ? 108.0 : (top ? 94.0 : (i % 2 ? 78.0 : 60.0));
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const r = 2.4 + 15.0 * Math.sin(Math.PI * t * 0.52);
    pts.push(new THREE.Vector3(
      Math.cos(a) * r,
      Math.sin(a) * r * 0.9,
      -13.0 - len * t
    ));
  }
  buildArmPath(`cirrus_mid_${i+1}`, pts, low ? 1.70 : (top ? 1.50 : 0.95), false);
}

/* ---------- dorsal spine rail ---------- */
const spar = add(new Mesh(new BoxGeometry(0.8, 0.6, 17.0), mat.plate), 'dorsal_rail');
spar.position.set(0, 2.9, 2.0);
for (let i = 0; i < 6; i++) {
  const stud = add(new Mesh(new BoxGeometry(1.6, 0.4, 0.9), mat.dark), `dorsal_stud_${i+1}`);
  stud.position.set(0, 3.25, 9.0 - i * 3.4);
}

/* ---------- siphon drives (forward-set, like a squid's funnel) ---------- */
const hub = add(new Mesh(new CylinderGeometry(2.5, 2.9, 2.6, 36), mat.dark), 'siphon_hub');
hub.rotation.x = Math.PI/2; hub.position.set(0, -0.2, 9.9);
hub.scale.set(1.15, 0.9, 1);
[[0, -0.2, 0.95], [1.45, 0.75, 0.55], [-1.45, 0.75, 0.55], [1.45, -1.15, 0.55], [-1.45, -1.15, 0.55]].forEach(([x, y, r], i) => {
  const bell = add(new Mesh(new CylinderGeometry(r * 1.2, r * 0.9, 1.6, 26, 1, true), mat.plate), `siphon_bell_${i+1}`);
  bell.rotation.x = Math.PI/2; bell.position.set(x, y - 0.2, 10.8);
  const core = add(new Mesh(new CylinderGeometry(r * 0.8, r * 0.88, 0.5, 24), mat.glow), `siphon_core_${i+1}`);
  core.rotation.x = Math.PI/2; core.position.set(x, y - 0.2, 11.4);
  const ring = add(new Mesh(new TorusGeometry(r * 1.08, 0.07, 10, 28), mat.trim), `siphon_ring_${i+1}`);
  ring.position.set(x, y - 0.2, 11.6);
});

/* ---------- ventral hangar throat ---------- */
const throat = add(new Mesh(new BoxGeometry(2.8, 0.5, 5.6), mat.dark), 'hangar_throat');
throat.position.set(0, -2.75, 1.0);
const throatGlow = add(new Mesh(new BoxGeometry(2.0, 0.08, 4.4), mat.glow), 'hangar_glow');
throatGlow.position.set(0, -2.96, 1.0);


  return ship;
}

/**
 * @param {boolean} ground
 * @param {boolean} uniqueMaterials - sklonuj materiały tylko dla tej instancji
 */
export function buildKharathDestroyer({ ground = true, uniqueMaterials = false } = {}) {
  if (!_template) _template = buildTemplate();
  const ship = _template.clone();
  if (uniqueMaterials) {
    ship.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  }
  return ground ? groundToOrigin(ship) : ship;
}
