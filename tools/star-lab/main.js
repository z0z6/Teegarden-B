import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createStarVisual, STAR_TYPES } from '../../shared/systems/star-surface.js';
import { createSpaceBackground } from '../../shared/systems/space-background.js';

// Laboratorium gwiazd: jedna gwiazda na raz, wybór typu i odległości.
// Promień 1000 j. - odległości podawane w promieniach gwiazdy.
const R = 1000;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 1, 1e6);
const background = createSpaceBackground(renderer, scene, { cubeSize: 512 });
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = R * 1.02;
controls.maxDistance = R * 40;

let star = null, typeId = new URLSearchParams(location.search).get('typ') ?? 'yellowDwarf', tideOn = false;
const companion = new THREE.Vector3(R * 4, 0, 0);

function setType(id) {
  if (star) { scene.remove(star.group); star.dispose(); }
  typeId = id;
  star = createStarVisual({ radius: R, type: id, seed: 7 });
  scene.add(star.group);
  star.setTide(companion, tideOn ? 0.45 : 0);
  document.querySelectorAll('#types button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
}
const DISTS = { daleko: 12, średnio: 3.2, blisko: 1.35, powierzchnia: 1.05 };
function setDist(k) {
  const dir = camera.position.clone().normalize();
  if (dir.lengthSq() < 0.5) dir.set(0.35, 0.25, 1).normalize();
  camera.position.copy(dir.multiplyScalar(R * k));
  // tuż nad powierzchnią patrzymy wzdłuż niej (na horyzont), a nie w środek
  const tgt = k < 1.2 ? camera.position.clone().normalize().multiplyScalar(R * 0.2).add(new THREE.Vector3(0, R * 0.6, 0)) : new THREE.Vector3();
  controls.target.copy(tgt);
  controls.update();
}

const typesEl = document.getElementById('types');
for (const [id, t] of Object.entries(STAR_TYPES)) {
  const b = document.createElement('button');
  b.textContent = t.label; b.dataset.id = id;
  b.onclick = () => setType(id);
  typesEl.appendChild(b);
}
const distEl = document.getElementById('dists');
for (const k of Object.keys(DISTS)) {
  const b = document.createElement('button');
  b.textContent = k; b.onclick = () => setDist(DISTS[k]);
  distEl.appendChild(b);
}
document.getElementById('flare').onclick = () => star.flare();
document.getElementById('tide').onclick = (e) => {
  tideOn = !tideOn; star.setTide(companion, tideOn ? 0.45 : 0);
  e.target.textContent = `Deformacja pływowa: ${tideOn ? 'wł.' : 'wył.'}`;
};

setType(typeId);
setDist(DISTS[new URLSearchParams(location.search).get('dist') ?? 'średnio']);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Timer();
renderer.setAnimationLoop((t) => {
  clock.update(t);
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  star.update(dt, camera);
  background.update(camera);
  renderer.render(scene, camera);
});
window.__lab = { setType, setDist, get star() { return star; }, camera, controls, DISTS };
