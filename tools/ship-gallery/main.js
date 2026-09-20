import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// Galeria statków: narzędzie deweloperskie, nie krok gry.
// Cel: pokazać wszystkie 4 statki z floty z tej samej, spójnej
// perspektywy (nieco za plecami, z góry), każdy zajmujący DOKŁADNIE
// tę samą proporcję kadru (dopasowanie kuli otaczającej do FOV kamery,
// patrz komentarz przy `sphere` niżej) - I zdiagnozować, czy któryś
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
    if (w === 0 || h === 0) return; // layout jeszcze nie policzony - poczekaj na kolejne wywołanie ResizeObserver
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(panel);
  // Wywołanie na starcie bywa za wczesne (panel.clientWidth może być
  // jeszcze 0, zanim CSS grid policzy layout) - rAF daje przeglądarce
  // jedną klatkę na policzenie rozmiarów. ResizeObserver i tak złapie
  // każdą kolejną zmianę, to tylko na pierwszą klatkę.
  requestAnimationFrame(resize);

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

      // DOPASOWANIE KULI OTACZAJĄCEJ DO POLA WIDZENIA - w przeciwieństwie
      // do poprzedniej wersji (dystans liczony z przekątnej bounding boxa,
      // co dla wydłużonych kształtów jak Kharath nie gwarantowało realnego
      // zmieszczenia się w kadrze - przekątna "po skosie" to nie to samo,
      // co kątowy rozmiar widziany z danego kierunku patrzenia), liczymy
      // dystans wprost z geometrii: promień kuli otaczającej / sin(FOV/2).
      // To JEST matematyczna gwarancja, że cały statek zmieści się w kadrze,
      // niezależnie od proporcji/kształtu - i że każdy statek zajmie
      // DOKŁADNIE tę samą proporcję ekranu (ten sam margines), więc są
      // ze sobą realnie porównywalne.
      const recentered = new THREE.Box3().setFromObject(model);
      const sphere = recentered.getBoundingSphere(new THREE.Sphere());

      const margin = 1.35; // odrobina oddechu wokół statku (35% zapasu)
      const fovRad = THREE.MathUtils.degToRad(camera.fov);
      const distance = (sphere.radius / Math.sin(fovRad / 2)) * margin;

      // Kierunek "nieco za plecami, z góry" - stały, znormalizowany wektor,
      // przeskalowany do WYLICZONEGO dystansu (a nie odwrotnie).
      const viewDir = new THREE.Vector3(0, 0.35, 1).normalize();
      camera.position.copy(sphere.center).addScaledVector(viewDir, distance);
      camera.lookAt(sphere.center);
      camera.near = Math.max(distance - sphere.radius * 3, 0.05);
      camera.far = distance + sphere.radius * 6;
      camera.updateProjectionMatrix();
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
