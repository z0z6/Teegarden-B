import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// Galeria statków: narzędzie deweloperskie, nie krok gry.
// Cel: pokazać wszystkie 4 statki z floty z tej samej, spójnej
// perspektywy, każdy zajmujący DOKŁADNIE tę samą proporcję kadru
// (dopasowanie kuli otaczającej do FOV kamery).
//
// KAŻDY PANEL POKAZUJE NA STAŁE, W JAKIM JEST STANIE (status w lewym
// górnym rogu) - "inicjalizacja", "ładowanie", "gotowe" albo "BŁĄD: ...".
// To nie jest kosmetyka: poprzednia wersja pokazywała błąd tylko przy
// nieudanym ŁADOWANIU MODELU, ale nie łapała błędów przy tworzeniu samego
// renderera (np. limit jednoczesnych kontekstów WebGL w przeglądarce) -
// taki błąd w zwykłej pętli `for` potrafi po cichu przerwać budowanie
// KOLEJNYCH paneli, więc widać tylko pierwszy. Teraz każdy panel jest
// budowany w try/catch, niezależnie od pozostałych.
// ============================================================

const SHIPS = [
  { id: 'warbird-light', name: 'Warbird — Light Skirmisher', file: '../../shared/ships/models/warbird-light-lod0.glb' },
  { id: 'raptor-interceptor', name: 'Raptor-class Interceptor', file: '../../shared/ships/models/raptor-interceptor-lod0.glb' },
  { id: 'warbird-heavy', name: 'Warbird — Heavy Siege Interceptor', file: '../../shared/ships/models/warbird-heavy-lod0.glb' },
  { id: 'kharath-destroyer', name: 'Kharath — Heavy Destroyer', file: '../../shared/ships/models/kharath-destroyer-lod0.glb' },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const grid = document.getElementById('grid');

function setStatus(statusEl, text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('status-error', isError);
}

function createPanelShell(def) {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const statusEl = document.createElement('div');
  statusEl.className = 'status';
  panel.appendChild(statusEl);

  const label = document.createElement('div');
  label.className = 'label';
  label.innerHTML = `<div class="name">${def.name}</div><div class="meta">${def.id}</div>`;
  panel.appendChild(label);

  grid.appendChild(panel);
  return { panel, statusEl };
}

function buildPanel(def) {
  const { panel, statusEl } = createPanelShell(def);
  setStatus(statusEl, 'inicjalizacja renderera…');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch (err) {
    // Najbardziej prawdopodobna przyczyna: limit jednoczesnych kontekstów
    // WebGL w przeglądarce (zwykle 8-16, ale bywa niżej na słabszym GPU/
    // starszej przeglądarce) - 4 osobne <canvas> w tym narzędziu to i tak
    // niedużo, ale jeśli w tej samej karcie jest otwarte coś jeszcze...
    setStatus(statusEl, `BŁĄD renderera: ${err?.message || err}`, true);
    console.error(`[galeria] ${def.id}: WebGLRenderer się nie utworzył:`, err);
    return;
  }
  if (!renderer.getContext()) {
    setStatus(statusEl, 'BŁĄD: przeglądarka nie dała kontekstu WebGL (limit kontekstów?)', true);
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 20000);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  panel.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x223344, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 1.2, 0.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 0.8);
  rim.position.set(-1, 0.4, -0.8);
  scene.add(rim);

  // Sześcian-placeholder widoczny OD RAZU, zanim statek się wczyta - jeśli
  // widzisz obracający się sześcian, ale nigdy statku, to renderer/scena
  // działają poprawnie i problem jest w samym ładowaniu modelu (patrz
  // status w panelu). Jeśli NIE widzisz nawet sześcianu - problem jest
  // w samym renderowaniu/canvasie, nie w modelu.
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 4),
    new THREE.MeshStandardMaterial({ color: 0x88ccff, wireframe: true })
  );
  scene.add(placeholder);
  camera.position.set(6, 6, 10);
  camera.lookAt(0, 0, 0);

  function resize() {
    const w = panel.clientWidth, h = panel.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(panel);
  requestAnimationFrame(resize);

  const pivotGroup = new THREE.Group();
  scene.add(pivotGroup);

  setStatus(statusEl, 'ładowanie modelu…');

  loader.load(
    def.file,
    (gltf) => {
      let triCount = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          const g = o.geometry;
          triCount += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        }
      });

      scene.remove(placeholder);
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      model.position.set(-center.x, -box.min.y, -center.z);
      pivotGroup.add(model);

      // Dopasowanie kuli otaczającej do FOV - patrz README/komentarz
      // w poprzedniej wersji tego pliku po pełne wyjaśnienie; w skrócie:
      // dystans = promień / sin(FOV/2), więc każdy statek zajmuje
      // dokładnie ten sam kątowy rozmiar w kadrze, niezależnie od kształtu.
      const recentered = new THREE.Box3().setFromObject(model);
      const sphere = recentered.getBoundingSphere(new THREE.Sphere());
      const margin = 1.35;
      const fovRad = THREE.MathUtils.degToRad(camera.fov);
      const distance = (sphere.radius / Math.sin(fovRad / 2)) * margin;
      const viewDir = new THREE.Vector3(0, 0.35, 1).normalize();
      camera.position.copy(sphere.center).addScaledVector(viewDir, distance);
      camera.lookAt(sphere.center);
      camera.near = Math.max(distance - sphere.radius * 3, 0.05);
      camera.far = distance + sphere.radius * 6;
      camera.updateProjectionMatrix();

      setStatus(statusEl, `gotowe (${Math.round(triCount)} trójkątów)`);
    },
    (progress) => {
      if (progress.total) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        setStatus(statusEl, `ładowanie modelu… ${pct}%`);
      }
    },
    (err) => {
      setStatus(statusEl, `BŁĄD ładowania (${def.file}): ${err?.message || err}`, true);
      console.error(`[galeria] ${def.id} nie wczytał się:`, err);
    }
  );

  function animate() {
    pivotGroup.rotation.y += 0.006;
    placeholder.rotation.y += 0.01;
    placeholder.rotation.x += 0.006;
    try {
      renderer.render(scene, camera);
    } catch (err) {
      // Błąd renderowania (np. utrata kontekstu WebGL w trakcie działania)
      // - zatrzymaj pętlę TEGO panelu, nie zabijaj reszty strony.
      setStatus(statusEl, `BŁĄD renderowania: ${err?.message || err}`, true);
      console.error(`[galeria] ${def.id}: błąd w renderer.render():`, err);
      return;
    }
    requestAnimationFrame(animate);
  }
  animate();
}

// Każdy panel budowany NIEZALEŻNIE - błąd przy jednym (np. wyczerpany
// limit kontekstów WebGL) nie może ubić budowy pozostałych trzech.
for (const def of SHIPS) {
  try {
    buildPanel(def);
  } catch (err) {
    console.error(`[galeria] Krytyczny błąd przy budowie panelu ${def.id}:`, err);
    const { statusEl } = createPanelShell(def);
    setStatus(statusEl, `BŁĄD KRYTYCZNY: ${err?.message || err}`, true);
  }
}
