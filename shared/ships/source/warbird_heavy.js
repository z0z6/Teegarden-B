/**
 * buildWarbirdHeavy() — proceduralnie buduje model statku "warbird_heavy" jako THREE.Group.
 * Wyekstrahowane z pliku warbird-heavy.html (bez zależności od <three-d-stage>).
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
// wywołaniu buildWarbirdHeavy()). Kolejne wywołania zwracają Object3D.clone()
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
ship.name = 'warbird_heavy';
const add = (m, name, parent) => { m.name = name; m.castShadow = true; m.receiveShadow = true; (parent||ship).add(m); return m; };


/* ---------- hull ---------- */
const prof = [[0.05,7.0],[0.40,6.2],[0.85,5.0],[1.25,3.4],[1.50,1.4],[1.55,-0.8],[1.45,-2.8],[1.20,-4.6],[0.95,-5.8],[0.40,-6.3],[0,-6.4]]
  .map(([r,z]) => new Vector2(r, z));
const body = add(new Mesh(new LatheGeometry(prof, 48), mat.hull), 'fuselage');
body.rotation.x = Math.PI/2;
body.scale.set(1.30, 1, 0.80);

const armorSpine = add(new Mesh(new BoxGeometry(1.5, 0.7, 9.0), mat.plate), 'dorsal_armor');
armorSpine.position.set(0, 1.05, -0.8);
const belly = add(new Mesh(new BoxGeometry(2.0, 0.6, 9.6), mat.plate), 'ventral_armor');
belly.position.set(0, -1.05, -0.6);

const prow = add(new Mesh(new ConeGeometry(0.75, 3.2, 28), mat.plate), 'armored_prow');
prow.rotation.x = Math.PI/2; prow.position.set(0, 0, 8.0);
const prowRing = add(new Mesh(new TorusGeometry(0.78, 0.10, 12, 36), mat.trim), 'prow_collar');
prowRing.position.set(0, 0, 6.6);

const canopy = add(new Mesh(new SphereGeometry(1, 32, 20, 0, Math.PI*2, 0, Math.PI/2), mat.glass), 'canopy');
canopy.scale.set(0.95, 0.75, 2.0);
canopy.position.set(0, 0.95, 3.2);
const canopyFrame = add(new Mesh(new BoxGeometry(0.14, 0.2, 4.0), mat.dark), 'canopy_frame');
canopyFrame.position.set(0, 1.62, 3.2);

/* ---------- heavy forward cannons ---------- */
function cannon(sign) {
  const grp = new Group(); grp.name = sign > 0 ? 'cannon_starboard' : 'cannon_port';
  const barrel = add(new Mesh(new CylinderGeometry(0.22, 0.30, 6.4, 24), mat.dark), 'cannon_barrel', grp);
  barrel.rotation.x = Math.PI/2;
  const sleeve = add(new Mesh(new CylinderGeometry(0.42, 0.46, 2.2, 24), mat.plate), 'cannon_sleeve', grp);
  sleeve.rotation.x = Math.PI/2; sleeve.position.z = -1.6;
  for (let i = 0; i < 3; i++) {
    const r = add(new Mesh(new TorusGeometry(0.30, 0.06, 10, 28), mat.trim), `cannon_ring_${i+1}`, grp);
    r.position.z = 1.0 + i * 1.0;
  }
  const muzzle = add(new Mesh(new CylinderGeometry(0.16, 0.16, 0.3, 20), mat.glow), 'cannon_muzzle', grp);
  muzzle.rotation.x = Math.PI/2; muzzle.position.z = 3.3;
  grp.position.set(sign * 2.6, -0.55, 3.2);
  ship.add(grp);
}
cannon(1); cannon(-1);

/* ---------- wings: short, thick, armored ---------- */
function wingShape() {
  const s = new Shape();
  s.moveTo(1.3, 3.0);
  s.quadraticCurveTo(4.0, 2.2, 6.4, -1.0);
  s.lineTo(6.8, -2.4);
  s.quadraticCurveTo(4.4, -3.2, 2.2, -4.4);
  s.lineTo(1.3, -4.6);
  s.closePath();
  return s;
}
function buildWing(sign) {
  const g = new Group();
  g.name = sign > 0 ? 'wing_starboard' : 'wing_port';
  const geo = new ExtrudeGeometry(wingShape(), { depth: 0.55, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.16, bevelSegments: 2, curveSegments: 24 });
  geo.translate(0, 0, -0.275);
  const w = add(new Mesh(geo, mat.hull), 'wing_panel', g);
  w.rotation.x = Math.PI/2;

  const strake = add(new Mesh(new BoxGeometry(5.0, 0.2, 0.5), mat.trim), 'wing_strake', g);
  strake.position.set(3.7, 0.12, 1.3);
  strake.rotation.y = 0.72;

  const talonGeo = new ExtrudeGeometry((() => {
    const t = new Shape();
    t.moveTo(-0.2, 0.2);
    t.quadraticCurveTo(1.2, -0.4, 1.7, -2.6);
    t.lineTo(1.0, -2.7);
    t.quadraticCurveTo(0.8, -0.8, -0.3, -0.4);
    t.closePath(); return t;
  })(), { depth: 2.2, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.1, bevelSegments: 2, curveSegments: 24 });
  talonGeo.translate(0, 0, -1.1);
  add(new Mesh(talonGeo, mat.plate), 'wing_talon', g).position.set(6.5, 0, -1.6);

  // twin stacked nacelles per wing
  [[-1.25, 0.6], [-2.35, -0.6]].forEach(([y, zoff], i) => {
    const nac = new Group(); nac.name = `nacelle_${i+1}`;
    const shell = add(new Mesh(new CylinderGeometry(0.72, 0.62, 6.4, 32), mat.plate), `nacelle_shell_${i+1}`, nac);
    shell.rotation.x = Math.PI/2;
    const intake = add(new Mesh(new CylinderGeometry(0.80, 0.72, 0.6, 32, 1, true), mat.dark), `nacelle_intake_${i+1}`, nac);
    intake.rotation.x = Math.PI/2; intake.position.z = 3.3;
    const ring = add(new Mesh(new TorusGeometry(0.78, 0.09, 12, 32), mat.trim), `nacelle_ring_${i+1}`, nac);
    ring.position.z = 3.0;
    const glow = add(new Mesh(new CylinderGeometry(0.52, 0.56, 0.5, 32), mat.glow), `plasma_exhaust_${i+1}`, nac);
    glow.rotation.x = Math.PI/2; glow.position.z = -3.4;
    const pylon = add(new Mesh(new BoxGeometry(0.4, 1.3, 3.0), mat.dark), `nacelle_pylon_${i+1}`, nac);
    pylon.position.set(0, 0.8, 0.2);
    nac.position.set(3.9, y, zoff);
    g.add(nac);
  });

  if (sign < 0) bakeMirror(g);
  g.position.set(sign * 0.6, -0.1, 0.4);
  g.rotation.z = -sign * 0.14;
  ship.add(g);
}
buildWing(1); buildWing(-1);

/* ---------- tail ---------- */
function fin(sign) {
  const s = new Shape();
  s.moveTo(0, 0); s.lineTo(0.3, 3.4); s.quadraticCurveTo(-1.6, 3.7, -2.8, 2.9);
  s.lineTo(-3.0, 0.1); s.closePath();
  const geo = new ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.08, bevelSegments: 1, curveSegments: 16 });
  geo.translate(0, 0, -0.12);
  if (sign < 0) { geo.scale(-1, 1, 1); flipWinding(geo); geo.computeVertexNormals(); }
  const m = add(new Mesh(geo, mat.hull), sign > 0 ? 'tailfin_starboard' : 'tailfin_port');
  m.rotation.y = Math.PI/2;
  m.rotation.z = sign * 0.26;
  m.position.set(sign * 0.9, 0.7, -4.2);
}
fin(1); fin(-1);

/* ---------- main drive cluster ---------- */
const housing = add(new Mesh(new CylinderGeometry(1.5, 1.6, 1.8, 36), mat.dark), 'engine_housing');
housing.rotation.x = Math.PI/2; housing.position.set(0, 0, -5.8);
housing.scale.set(1.2, 1, 1);
[[-0.72, 0], [0.72, 0]].forEach(([x], i) => {
  const core = add(new Mesh(new CylinderGeometry(0.62, 0.7, 0.5, 28), mat.glow), `main_thruster_${i+1}`);
  core.rotation.x = Math.PI/2; core.position.set(x, 0, -6.65);
  const r = add(new Mesh(new TorusGeometry(0.76, 0.08, 12, 32), mat.trim), `thruster_ring_${i+1}`);
  r.position.set(x, 0, -6.5);
});

/* ---------- plating bands ---------- */
for (let i = 0; i < 4; i++) {
  const band = add(new Mesh(new TorusGeometry(1.52 - i*0.06, 0.06, 10, 44), mat.trim), `hull_band_${i+1}`);
  band.position.set(0, 0, 1.4 - i*1.9);
  band.scale.set(1.30, 0.80, 1);
}
const sensor = add(new Mesh(new SphereGeometry(0.5, 28, 18), mat.dark), 'sensor_dome');
sensor.position.set(0, -1.15, 5.0);
sensor.scale.set(1, 0.8, 1.5);

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
export function buildWarbirdHeavy({ ground = true, uniqueMaterials = false } = {}) {
  if (!_template) _template = buildTemplate();
  const ship = _template.clone();
  if (uniqueMaterials) {
    ship.traverse((o) => {
      if (o.isMesh) o.material = o.material.clone();
    });
  }
  return ground ? groundToOrigin(ship) : ship;
}
