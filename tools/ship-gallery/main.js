import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// Galeria statków: narzędzie deweloperskie, nie krok gry.
// Cel: pokazać wszystkie 4 statki z floty z tej samej, spójnej
// perspektywy (nieco za plecami, z góry) - I zdiagnozować, czy któryś
// się nie ładuje (błąd wyświetlony wprost w panelu, nie tylko w konsoli).
// ============================================================

// Ścieżki względne z tools/ship-gallery/ (dwa poziomy od korzenia repo) -
// stąd "../../", nie "../" jak w step3-ships/step4-stellar-physics.
const SHIPS = [
  { id: 'warbird-light', name: 'Warbird — Light Skirmisher', file: '../../shared/ships/models/warbird-light-lod0.glb' },
  { id: 'raptor-interceptor', name: 'Raptor-class Interceptor', file: '../../shared/ships/models/raptor-interceptor-lod0.glb' },
  { id: 'warbird-heavy', name: 'Warbird — Heavy Siege Interceptor', file: '../../shared/ships/models/warbird-heavy-lod0.glb' },
  { id: 'kharath-destroyer', name: 'Kharath — Heavy Destroyer', file: '../../shared/ships/models/kharath-destroyer-lod0.glb' },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const grid = document.getElementById('grid');

function buildPanel(def) {
  const panel = document.createElement('div');
  panel.className = 'panel';

  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  loadingEl.textContent = 'Ładowanie…';
  panel.appendChild(loadingEl);

  const label = document.createElement('div');
  label.className = 'label';
  label.innerHTML = `<div class="name">${def.name}</div><div class="meta">${def.id}</div>`;
  panel.appendChild(label);

  grid.appendChild(panel);

  // --- Każdy panel to NIEZALEŻNA scena/kamera/renderer. Prostsze niż
  // jeden wspólny canvas z ręcznym scissor testem, kosztem trochę większego
  // zużycia zasobów - dla narzędzia dev/QA (nie dla właściwej gry) to
  // akceptowalny kompromis. ---
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 20000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
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

  function resize() {
    const w = panel.clientWidth, h = panel.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(panel);
  resize();

  let pivotGroup = new THREE.Group(); // obrót "turntable", niezależny od kamery
  scene.add(pivotGroup);

  loader.load(
    def.file,
    (gltf) => {
      loadingEl.remove();
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      model.position.set(-center.x, -box.min.y, -center.z);
      pivotGroup.add(model);

      // TA SAMA perspektywa dla każdego statku = te same PROPORCJE
      // względem rozmiaru (nie ten sam dosłowny offset w jednostkach
      // świata - przy 10x różnicy skali między myśliwcem a Kharathem to
      // by nie miało sensu). Dokładnie te same mnożniki co
      // deriveCameraRig() w step3-ships/step4-stellar-physics/main.js.
      // pivotGroup ma taki sam układ odniesienia jak shipGroup w grze
      // (model wyśrodkowany w X/Z, spód w Y=0) - offset liczymy więc
      // od (0,0,0) pivotGroup, bez dodatkowych przesunięć.
      const diag = size.length();
      const camOffset = new THREE.Vector3(0, size.y * 0.5 + diag * 0.12, diag * 0.85);
      const lookAt = new THREE.Vector3(0, size.y * 0.15, 0);
      camera.position.copy(camOffset);
      camera.lookAt(lookAt);
    },
    undefined,
    (err) => {
      loadingEl.remove();
      const errEl = document.createElement('div');
      errEl.className = 'error';
      errEl.textContent = `Błąd wczytywania (${def.file}): ${err?.message || err}`;
      panel.appendChild(errEl);
      console.error(`[galeria] ${def.id} nie wczytał się:`, err);
    }
  );

  function animate() {
    pivotGroup.rotation.y += 0.006; // powolny obrót "na wystawie"
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}

for (const def of SHIPS) buildPanel(def);
