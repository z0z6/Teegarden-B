/**
 * buildWarbirdLight() — proceduralnie buduje model statku "warbird_light" jako THREE.Group.
 * Wyekstrahowane z pliku warbird-light.html (bez zależności od <three-d-stage>).
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
// wywołaniu buildWarbirdLight()). Kolejne wywołania zwracają Object3D.clone()
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
ship.name = 'warbird_light';
const add = (m, name, parent) => { m.name = name; m.castShadow = true; m.receiveShadow = true; (parent||ship).add(m); return m; };


/* ---------- slim hull ---------- */
const prof = [[0.02,9.0],[0.14,8.2],[0.30,7.0],[0.46,5.2],[0.58,3.0],[0.62,0.6],[0.58,-1.8],[0.48,-3.4],[0.36,-4.4],[0.12,-4.8],[0,-4.85]]
  .map(([r,z]) => new Vector2(r, z));
const body = add(new Mesh(new LatheGeometry(prof, 48), mat.hull), 'fuselage');
body.rotation.x = Math.PI/2;
body.scale.set(1.0, 1, 0.85);

const needle = add(new Mesh(new CylinderGeometry(0.02, 0.10, 3.2, 20), mat.trim), 'pitot_needle');
needle.rotation.x = Math.PI/2; needle.position.set(0, 0, 10.2);

const spine = add(new Mesh(new BoxGeometry(0.30, 0.26, 8.0), mat.plate), 'dorsal_spine');
spine.position.set(0, 0.42, 0.4);

const canopy = add(new Mesh(new SphereGeometry(1, 32, 20, 0, Math.PI*2, 0, Math.PI/2), mat.glass), 'canopy');
canopy.scale.set(0.52, 0.48, 2.4);
canopy.position.set(0, 0.24, 4.2);
const canopyFrame = add(new Mesh(new BoxGeometry(0.08, 0.14, 4.6), mat.dark), 'canopy_frame');
canopyFrame.position.set(0, 0.68, 4.2);

/* ---------- long-range lance ---------- */
const lance = add(new Mesh(new CylinderGeometry(0.13, 0.20, 7.0, 24), mat.dark), 'lance_barrel');
lance.rotation.x = Math.PI/2; lance.position.set(0, -0.48, 4.6);
for (let i = 0; i < 4; i++) {
  const r = add(new Mesh(new TorusGeometry(0.22, 0.045, 10, 26), mat.trim), `lance_coil_${i+1}`);
  r.position.set(0, -0.48, 3.2 + i * 1.2);
}
const lanceTip = add(new Mesh(new CylinderGeometry(0.10, 0.10, 0.3, 18), mat.glow), 'lance_emitter');
lanceTip.rotation.x = Math.PI/2; lanceTip.position.set(0, -0.48, 8.1);

/* ---------- forward-swept wings ---------- */
function wingShape() {
  const s = new Shape();
  s.moveTo(0.6, 0.6);
  s.quadraticCurveTo(3.6, 1.8, 6.9, 3.2);   // forward-swept leading edge
  s.lineTo(7.3, 2.3);
  s.quadraticCurveTo(4.4, 0.2, 2.0, -2.6);
  s.lineTo(0.6, -2.8);
  s.closePath();
  return s;
}
function buildWing(sign) {
  const g = new Group();
  g.name = sign > 0 ? 'wing_starboard' : 'wing_port';
  const geo = new ExtrudeGeometry(wingShape(), { depth: 0.20, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.09, bevelSegments: 2, curveSegments: 24 });
  geo.translate(0, 0, -0.1);
  const w = add(new Mesh(geo, mat.hull), 'wing_panel', g);
  w.rotation.x = Math.PI/2;

  const strake = add(new Mesh(new BoxGeometry(6.4, 0.10, 0.22), mat.trim), 'wing_strake', g);
  strake.position.set(3.7, 0.05, 1.9);
  strake.rotation.y = -0.40;

  // upswept tip blade
  const bladeGeo = new ExtrudeGeometry((() => {
    const t = new Shape();
    t.moveTo(-0.1, -0.1);
    t.quadraticCurveTo(0.55, 0.6, 0.75, 2.2);
    t.lineTo(0.35, 2.25);
    t.quadraticCurveTo(0.25, 0.8, -0.25, 0.25);
    t.closePath(); return t;
  })(), { depth: 1.2, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.06, bevelSegments: 2, curveSegments: 20 });
  bladeGeo.translate(0, 0, -0.6);
  add(new Mesh(bladeGeo, mat.plate), 'wing_blade', g).position.set(7.05, 0, 2.2);

  // single slim outrigger engine
  const nac = new Group(); nac.name = 'nacelle';
  const shell = add(new Mesh(new CylinderGeometry(0.34, 0.28, 5.0, 28), mat.plate), 'nacelle_shell', nac);
  shell.rotation.x = Math.PI/2;
  const intake = add(new Mesh(new CylinderGeometry(0.38, 0.34, 0.4, 28, 1, true), mat.dark), 'nacelle_intake', nac);
  intake.rotation.x = Math.PI/2; intake.position.z = 2.6;
  const ring = add(new Mesh(new TorusGeometry(0.37, 0.05, 10, 28), mat.trim), 'nacelle_ring', nac);
  ring.position.z = 2.4;
  const glow = add(new Mesh(new CylinderGeometry(0.22, 0.25, 0.5, 26), mat.glow), 'plasma_exhaust', nac);
  glow.rotation.x = Math.PI/2; glow.position.z = -2.55;
  const pylon = add(new Mesh(new BoxGeometry(0.18, 0.7, 1.8), mat.dark), 'nacelle_pylon', nac);
  pylon.position.set(0, 0.42, -0.4);
  nac.position.set(4.2, -0.52, -0.9);
  g.add(nac);

  if (sign < 0) bakeMirror(g);
  g.position.set(sign * 0.35, -0.05, 0.0);
  g.rotation.z = sign * 0.10;  // slight dihedral
  ship.add(g);
}
buildWing(1); buildWing(-1);

/* ---------- single tall fin ---------- */
const finShape = new Shape();
finShape.moveTo(0, 0); finShape.lineTo(0.3, 3.2); finShape.quadraticCurveTo(-1.3, 3.5, -2.4, 2.6);
finShape.lineTo(-2.6, 0.05); finShape.closePath();
const finGeo = new ExtrudeGeometry(finShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.05, bevelSegments: 1, curveSegments: 16 });
finGeo.translate(0, 0, -0.07);
const tailfin = add(new Mesh(finGeo, mat.hull), 'tailfin');
tailfin.rotation.y = Math.PI/2;
tailfin.position.set(0, 0.28, -3.1);

function ventral(sign) {
  const s = new Shape();
  s.moveTo(0, 0); s.lineTo(0.2, -1.6); s.lineTo(-1.5, -1.2); s.lineTo(-1.7, 0.05); s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1 });
  geo.translate(0, 0, -0.06);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const m = add(new Mesh(geo, mat.plate), sign > 0 ? 'ventral_fin_starboard' : 'ventral_fin_port');
  m.rotation.y = Math.PI/2;
  m.rotation.z = -sign * 0.5;
  m.position.set(sign * 0.35, -0.35, -3.0);
}
ventral(1); ventral(-1);

/* ---------- sprint drive ---------- */
const housing = add(new Mesh(new CylinderGeometry(0.62, 0.68, 1.1, 32), mat.dark), 'engine_housing');
housing.rotation.x = Math.PI/2; housing.position.set(0, 0, -4.5);
const core = add(new Mesh(new CylinderGeometry(0.46, 0.52, 0.45, 30), mat.glow), 'main_thruster');
core.rotation.x = Math.PI/2; core.position.set(0, 0, -5.05);
const ering = add(new Mesh(new TorusGeometry(0.64, 0.06, 12, 36), mat.trim), 'engine_ring');
ering.position.set(0, 0, -4.9);

for (let i = 0; i < 3; i++) {
  const band = add(new Mesh(new TorusGeometry(0.60 - i*0.04, 0.035, 10, 36), mat.trim), `hull_band_${i+1}`);
  band.position.set(0, 0, 1.6 - i*2.1);
  band.scale.set(1.0, 0.86, 1);
}
const sensor = add(new Mesh(new SphereGeometry(0.22, 24, 16), mat.dark), 'sensor_pod');
sensor.position.set(0, 0.5, 6.4);
sensor.scale.set(1, 0.9, 2.2);

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
export function buildWarbirdLight({ ground = true, uniqueMaterials = false } = {}) {
  if (!_template) _template = buildTemplate();
  const ship = _template.clone();
  if (uniqueMaterials) {
    ship.traverse((o) => {
      if (o.isMesh) o.material = o.material.clone();
    });
  }
  return ground ? groundToOrigin(ship) : ship;
}
