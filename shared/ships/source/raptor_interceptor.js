/**
 * buildRaptorInterceptor() — proceduralnie buduje model statku "raptor_interceptor" jako THREE.Group.
 * Wyekstrahowane z pliku warbird.html (bez zależności od <three-d-stage>).
 * Wymaga: npm install three
 */
import * as THREE from 'three';
const { Shape, ExtrudeGeometry, LatheGeometry, CylinderGeometry, BoxGeometry, SphereGeometry, ConeGeometry, TorusGeometry, Vector2, MeshStandardMaterial, Mesh, Group } = THREE;

// Grounding: opcjonalne podniesienie modelu tak, by najniższy punkt dotykał y=0.
// Usuń to wywołanie, jeśli w silniku gry wolisz pozycjonować statek względem jego środka.
function groundToOrigin(ship) {
  const box = new THREE.Box3().setFromObject(ship);
  ship.position.y -= box.min.y;
  return ship;
}

// Cache: geometria i materiały budowane są tylko raz (przy pierwszym
// wywołaniu buildRaptorInterceptor()). Kolejne wywołania zwracają Object3D.clone()
// szablonu — three.js kopiuje wtedy tylko hierarchię/transformy, a geometrię
// i materiały przekazuje przez referencję (patrz Mesh.copy() w three.js).
// Dzięki temu N instancji tego samego statku to N tanich kopii, a nie N razy
// przeliczana LatheGeometry/ExtrudeGeometry i N razy tworzone te same materiały
// (co wcześniej uniemożliwiało silnikowi batchowanie draw calls między nimi).
let _template = null;

function buildTemplate() {


const mat = {
  hull:   new MeshStandardMaterial({ name:'hull_green',  color:0x5c7a55, roughness:0.45, metalness:0.35 }),
  plate:  new MeshStandardMaterial({ name:'hull_plate',  color:0x3d5039, roughness:0.55, metalness:0.3 }),
  dark:   new MeshStandardMaterial({ name:'graphite',    color:0x23261f, roughness:0.7,  metalness:0.25 }),
  trim:   new MeshStandardMaterial({ name:'bronze_trim', color:0xb08a46, roughness:0.35, metalness:0.4 }),
  glass:  new MeshStandardMaterial({ name:'canopy_glass',color:0x1b2b2a, roughness:0.12, metalness:0.3, transparent:true, opacity:0.65 }),
  glow:   new MeshStandardMaterial({ name:'plasma_glow', color:0x0b1a18, roughness:0.4, metalness:0.1, emissive:0x35e0c4, emissiveIntensity:1.6 }),
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
ship.name = 'raptor_interceptor';
const add = (m, name, parent) => { m.name = name; m.castShadow = true; m.receiveShadow = true; (parent||ship).add(m); return m; };

/* ---------- fuselage ---------- */
const prof = [[0.02,7.4],[0.22,6.7],[0.45,5.8],[0.70,4.4],[0.90,2.8],[1.00,1.0],[1.00,-1.2],[0.88,-3.0],[0.72,-4.2],[0.55,-5.0],[0.18,-5.3],[0.0,-5.35]]
  .map(([r,z]) => new Vector2(r, z));
const body = add(new Mesh(new LatheGeometry(prof, 48), mat.hull), 'fuselage');
body.rotation.x = Math.PI/2;
body.scale.set(1.18, 1, 0.62);

// dorsal spine
const spine = add(new Mesh(new BoxGeometry(0.5, 0.34, 7.2), mat.plate), 'dorsal_spine');
spine.position.set(0, 0.52, -1.0);

// belly keel
const keel = add(new Mesh(new BoxGeometry(0.7, 0.3, 8.4), mat.plate), 'ventral_keel');
keel.position.set(0, -0.56, -0.4);

// nose beak
const beak = add(new Mesh(new ConeGeometry(0.3, 2.2, 24), mat.dark), 'nose_beak');
beak.rotation.x = Math.PI/2;
beak.position.set(0, -0.08, 8.0);
const beakTrim = add(new Mesh(new TorusGeometry(0.30, 0.06, 12, 32), mat.trim), 'nose_collar');
beakTrim.position.set(0, -0.05, 7.05);

/* ---------- canopy ---------- */
const canopy = add(new Mesh(new SphereGeometry(1, 32, 20, 0, Math.PI*2, 0, Math.PI/2), mat.glass), 'canopy');
canopy.scale.set(0.82, 0.72, 2.2);
canopy.position.set(0, 0.34, 3.4);
const canopyFrame = add(new Mesh(new BoxGeometry(0.10, 0.18, 4.2), mat.dark), 'canopy_frame');
canopyFrame.position.set(0, 0.96, 3.4);

/* ---------- wings ---------- */
function wingShape() {
  const s = new Shape();
  s.moveTo(0.9, 2.6);                 // root leading
  s.quadraticCurveTo(4.2, 2.4, 7.6, -0.4);  // swept leading edge
  s.lineTo(8.1, -1.4);                // tip
  s.quadraticCurveTo(5.0, -1.9, 2.6, -3.4); // trailing edge
  s.lineTo(0.9, -3.6);
  s.closePath();
  return s;
}
function buildWing(sign) {
  const g = new Group();
  g.name = sign > 0 ? 'wing_starboard' : 'wing_port';
  const geo = new ExtrudeGeometry(wingShape(), { depth: 0.30, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.12, bevelSegments: 2, curveSegments: 24 });
  geo.translate(0, 0, -0.15);
  const w = add(new Mesh(geo, mat.hull), 'wing_panel', g);
  w.rotation.x = Math.PI/2;

  // leading-edge bronze strake
  const strake = add(new Mesh(new BoxGeometry(5.6, 0.14, 0.34), mat.trim), 'wing_strake', g);
  strake.position.set(3.9, 0.06, 1.3);
  strake.rotation.y = 0.62;

  // downturned talon at the wing tip
  const talonGeo = new ExtrudeGeometry((() => {
    const t = new Shape();
    t.moveTo(-0.15, 0.15);
    t.quadraticCurveTo(0.95, -0.35, 1.25, -2.05);
    t.lineTo(0.80, -2.10);
    t.quadraticCurveTo(0.62, -0.65, -0.20, -0.30);
    t.closePath(); return t;
  })(), { depth: 1.5, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.08, bevelSegments: 2, curveSegments: 24 });
  talonGeo.translate(0, 0, -0.75);
  const talon = add(new Mesh(talonGeo, mat.plate), 'wing_talon', g);
  talon.position.set(7.85, 0, -0.85);

  // nacelle slung under the wing
  const nac = new Group(); nac.name = 'nacelle';
  const shell = add(new Mesh(new CylinderGeometry(0.62, 0.52, 5.6, 32), mat.plate), 'nacelle_shell', nac);
  shell.rotation.x = Math.PI/2;
  const intake = add(new Mesh(new CylinderGeometry(0.68, 0.62, 0.5, 32, 1, true), mat.dark), 'nacelle_intake', nac);
  intake.rotation.x = Math.PI/2; intake.position.z = 2.9;
  const ring = add(new Mesh(new TorusGeometry(0.66, 0.07, 12, 32), mat.trim), 'nacelle_ring', nac);
  ring.position.z = 2.62;
  const glowRing = add(new Mesh(new CylinderGeometry(0.44, 0.48, 0.5, 32), mat.glow), 'plasma_exhaust', nac);
  glowRing.rotation.x = Math.PI/2; glowRing.position.z = -2.95;
  const pylon = add(new Mesh(new BoxGeometry(0.3, 0.9, 2.4), mat.dark), 'nacelle_pylon', nac);
  pylon.position.set(0, 0.62, 0.2);
  nac.position.set(4.9, -0.78, -0.15);
  nac.rotation.y = -0.06;
  g.add(nac);

  if (sign < 0) bakeMirror(g);
  g.position.set(sign * 0.2, -0.12, 0.2);
  g.rotation.z = -sign * 0.20;   // anhedral droop
  ship.add(g);
}
buildWing(1); buildWing(-1);

/* ---------- canards ---------- */
function canard(sign) {
  const s = new Shape();
  s.moveTo(0, 0.8); s.lineTo(2.6, -0.5); s.lineTo(2.5, -1.0); s.lineTo(0, -0.9); s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 1 });
  geo.translate(0, 0, -0.08);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const m = add(new Mesh(geo, mat.plate), sign > 0 ? 'canard_starboard' : 'canard_port');
  m.rotation.x = Math.PI/2;
  m.position.set(sign * 0.8, 0.12, 4.9);
  m.rotation.z = -sign * 0.12;
}
canard(1); canard(-1);

/* ---------- tail fins ---------- */
function fin(sign) {
  const s = new Shape();
  s.moveTo(0, 0); s.lineTo(0.2, 2.6); s.quadraticCurveTo(-1.2, 2.9, -2.2, 2.3);
  s.lineTo(-2.4, 0.1); s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 1, curveSegments: 16 });
  geo.translate(0, 0, -0.09);
  const m = add(new Mesh(geo, mat.hull), sign > 0 ? 'tailfin_starboard' : 'tailfin_port');
  m.rotation.y = Math.PI/2;
  m.rotation.z = sign * 0.30;
  m.position.set(sign * 0.55, 0.3, -3.4);
}
fin(1); fin(-1);

/* ---------- main engine cluster ---------- */
const engHousing = add(new Mesh(new CylinderGeometry(0.95, 1.05, 1.4, 32), mat.dark), 'engine_housing');
engHousing.rotation.x = Math.PI/2; engHousing.position.set(0, 0, -4.9);
const engCore = add(new Mesh(new CylinderGeometry(0.72, 0.8, 0.45, 32), mat.glow), 'main_thruster');
engCore.rotation.x = Math.PI/2; engCore.position.set(0, 0, -5.55);
const engRing = add(new Mesh(new TorusGeometry(0.98, 0.08, 12, 40), mat.trim), 'engine_ring');
engRing.position.set(0, 0, -5.35);

/* ---------- hull plating accents ---------- */
for (let i = 0; i < 3; i++) {
  const band = add(new Mesh(new TorusGeometry(0.98 - i*0.05, 0.045, 10, 40), mat.trim), `hull_band_${i+1}`);
  band.position.set(0, 0, 1.2 - i*1.9);
  band.scale.set(1.18, 0.62, 1);
}
const sensorPod = add(new Mesh(new SphereGeometry(0.34, 24, 16), mat.dark), 'sensor_pod');
sensorPod.position.set(0, -0.62, 5.2);
sensorPod.scale.set(1, 0.8, 1.6);

/* ---------- ground the model ---------- */

  return ship;
}

/**
 * @param {boolean} ground - podnieś model tak, by dotykał y=0 (domyślnie tak)
 * @param {boolean} uniqueMaterials - sklonuj materiały tylko dla tej instancji
 *   (geometria nadal współdzielona). Włącz, gdy chcesz przefarbować pojedynczy
 *   statek (np. kolor frakcji) bez wpływu na resztę floty — bez tej flagi
 *   zmiana `ship.children[0].material.color` zmieniłaby kolor WSZYSTKICH
 *   instancji, bo domyślnie dzielą ten sam obiekt materiału.
 */
export function buildRaptorInterceptor({ ground = true, uniqueMaterials = false } = {}) {
  if (!_template) _template = buildTemplate();
  const ship = _template.clone();
  if (uniqueMaterials) {
    ship.traverse((o) => {
      if (o.isMesh) o.material = o.material.clone();
    });
  }
  return ground ? groundToOrigin(ship) : ship;
}
