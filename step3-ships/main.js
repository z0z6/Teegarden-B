import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ============================================================
// KROK 3: Prawdziwe modele statków (glTF) + wybór statku
// Nowe pojęcia: GLTFLoader, async loading, "zaokrętowanie",
// fizyka wyprowadzona z rozmiaru modelu zamiast ręcznie wpisana
// ============================================================

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  20000 // statki bywają duże (Kharath ma ~180 jednostek długości) - dalekie far plane
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// ============================================================
// GWIAZDY W TLE (bez zmian względem kroku 1/2)
// ============================================================
function createStarfield(count = 6000, radius = 1500) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const r = radius * (0.3 + 0.7 * Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    positions.set(
      [
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ],
      i * 3
    );

    const tint = Math.random();
    const color = new THREE.Color();
    if (tint < 0.7) color.setHSL(0.6, 0.2, 0.85 + Math.random() * 0.15);
    else if (tint < 0.9) color.setHSL(0.15, 0.3, 0.8);
    else color.setHSL(0.02, 0.5, 0.75);
    colors.set([color.r, color.g, color.b], i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 2,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });

  return new THREE.Points(geometry, material);
}
scene.add(createStarfield());

// Oświetlenie (bez zmian)
scene.add(new THREE.AmbientLight(0x223344, 0.4));
const starLight = new THREE.PointLight(0xfff2d0, 3.5, 0, 0.5);
starLight.position.set(200, 80, -100);
scene.add(starLight);
const starMesh = new THREE.Mesh(
  new THREE.SphereGeometry(12, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff2d0 })
);
starMesh.position.copy(starLight.position);
scene.add(starMesh);

// Planeta (bez zmian)
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(8, 64, 64),
  new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.85, metalness: 0.05 })
);
scene.add(planet);
let planetAngle = 0;
const planetOrbitRadius = 60;

// ============================================================
// FLOTA DO WYBORU
// ============================================================
// Modele generowane są proceduralnie (kod w shared/ships/source/),
// tu wczytujemy gotowe, wyeksportowane .glb (LOD0 - najwyższy detal;
// przełączanie LOD w zależności od dystansu to dobry temat na krok 4).
//
// WAŻNE — konwencja "przodu": wszystkie 4 modele mają dziób w lokalnym
// +Z, a ten silnik (patrz krok 2) zakłada, że przód statku to lokalne
// -Z. Dlatego każdy wczytany model obracamy o 180° (patrz loadShip()).
const SHIPS = [
  {
    id: 'warbird-light',
    name: 'Warbird — Light Skirmisher',
    file: '../shared/ships/models/warbird-light-lod0.glb',
  },
  {
    id: 'raptor-interceptor',
    name: 'Raptor-class Interceptor',
    file: '../shared/ships/models/raptor-interceptor-lod0.glb',
  },
  {
    id: 'warbird-heavy',
    name: 'Warbird — Heavy Siege Interceptor',
    file: '../shared/ships/models/warbird-heavy-lod0.glb',
  },
  {
    id: 'kharath-destroyer',
    name: 'Kharath — Heavy Destroyer',
    file: '../shared/ships/models/kharath-destroyer-lod0.glb',
  },
];

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder); // LOD1/LOD2 są skompresowane (meshopt) - LOD0 też można, patrz README

// Kontener na aktualnie pilotowany statek. Fizyka/kamera operują na TYM
// obiekcie, nigdy bezpośrednio na wczytanym modelu - dzięki temu zamiana
// statku (zaokrętowanie) nie wymaga przepisywania reszty gry.
const shipGroup = new THREE.Group();
scene.add(shipGroup);

// visualGroup trzyma stały obrót "180° korekty dziobu" (patrz wyżej),
// a na to nakładamy jeszcze kosmetyczny bank (przechył) przy skręcie -
// rozdzielenie tych dwóch rotacji unika konfliktu między nimi.
const visualGroup = new THREE.Group();
shipGroup.add(visualGroup);

let currentShipIndex = -1;
let currentModel = null;
let flightProfile = null;
let cameraOffset = new THREE.Vector3(0, 4, 11);
let cameraLookOffset = new THREE.Vector3(0, 1, -6);

/**
 * Wyprowadza "czułość" fizyki z fizycznego rozmiaru modelu (przekątna
 * bounding boxa). To świadomy skrót zamiast ręcznie wpisywanych stałych
 * per-statek: większy statek = trudniej rozpędzić i skręcić (proxy masy),
 * mniejszy = zwinniejszy. `refLength` to długość "wzorcowego" myśliwca
 * (warbird-light), względem której skalujemy resztę floty.
 */
function deriveFlightProfile(boundingSize) {
  const refLength = 20; // w przybliżeniu długość warbird-light
  const scale = Math.max(boundingSize.length() / refLength, 0.3);
  return {
    acceleration: 24 / scale,
    maxSpeed: 46 / Math.sqrt(scale),
    boostMultiplier: 2.2,
    drag: 0.7,
    turnAcceleration: 6.0 / scale,
    maxYawSpeed: 2.2 / Math.sqrt(scale),
    turnDrag: 3.2,
  };
}

function deriveCameraRig(boundingSize) {
  const diag = boundingSize.length();
  return {
    offset: new THREE.Vector3(0, boundingSize.y * 0.5 + diag * 0.12, diag * 0.85),
    lookOffset: new THREE.Vector3(0, boundingSize.y * 0.15, -diag * 0.35),
  };
}

const loadingEl = document.getElementById('loading-model');
const nameEl = document.getElementById('ship-name');

async function loadShip(index) {
  if (index === currentShipIndex) return;
  const def = SHIPS[index];
  loadingEl.classList.add('visible');

  const gltf = await new Promise((resolve, reject) => {
    loader.load(def.file, resolve, undefined, reject);
  });

  // Usuń poprzedni model (jeśli jakiś był) - dopiero PO udanym wczytaniu
  // nowego, żeby w razie błędu sieci nie zostać bez statku.
  if (currentModel) visualGroup.remove(currentModel);

  const model = gltf.scene;
  visualGroup.add(model);
  currentModel = model;
  currentShipIndex = index;

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  // Wyśrodkuj model względem pivotu (środek masy w XZ, spód w Y),
  // żeby rotacje shipGroup nie kręciły statkiem "mimośrodowo".
  model.position.set(-center.x, -box.min.y, -center.z);

  flightProfile = deriveFlightProfile(size);
  const rig = deriveCameraRig(size);
  cameraOffset = rig.offset;
  cameraLookOffset = rig.lookOffset;

  nameEl.textContent = def.name;
  loadingEl.classList.remove('visible');
}

// ============================================================
// FIZYKA RUCHU (identyczna zasada co w kroku 2, tylko parametry
// pochodzą teraz z flightProfile aktualnego statku)
// ============================================================
const shipState = {
  speed: 0,
  yawVelocity: 0,
};

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  // Cyfry 1-4 = zaokrętowanie na inny statek z floty
  const digit = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
  if (digit !== undefined && digit < SHIPS.length) {
    loadShip(digit).catch((err) => console.error('Nie udało się wczytać statku:', err));
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function updateShip(delta) {
  if (!flightProfile) return; // jeszcze nic nie wczytane

  const forwardInput = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
    - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const turnInput = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
    - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const braking = keys.has('Space');

  const P = flightProfile;
  const maxSpeed = P.maxSpeed * (boosting ? P.boostMultiplier : 1);

  if (braking) {
    shipState.speed *= Math.max(0, 1 - P.drag * 2 * delta);
  } else if (forwardInput !== 0) {
    shipState.speed += forwardInput * P.acceleration * delta;
  } else {
    shipState.speed *= Math.max(0, 1 - P.drag * delta);
  }
  shipState.speed = THREE.MathUtils.clamp(shipState.speed, -maxSpeed * 0.4, maxSpeed);

  shipState.yawVelocity += turnInput * P.turnAcceleration * delta;
  shipState.yawVelocity *= Math.max(0, 1 - P.turnDrag * delta);
  shipState.yawVelocity = THREE.MathUtils.clamp(shipState.yawVelocity, -P.maxYawSpeed, P.maxYawSpeed);
  shipGroup.rotation.y += shipState.yawVelocity * delta;

  const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  shipGroup.position.addScaledVector(forwardDir, shipState.speed * delta);

  // Bank (przechył) - nakładany na visualGroup, NIE na shipGroup, żeby
  // nie mieszał się z korektą "180° dziobu" (patrz komentarz przy SHIPS).
  const targetRoll = -shipState.yawVelocity * 0.6;
  visualGroup.rotation.y = Math.PI; // stała korekta dziobu (+Z modelu -> -Z gry)
  visualGroup.rotation.z = THREE.MathUtils.lerp(visualGroup.rotation.z, targetRoll, delta * 5);
}

// ============================================================
// KAMERA TRZECIOOSOBOWA "NA SPRĘŻYNIE" (bez zmian koncepcyjnych
// względem kroku 2 - offsety są teraz per-statek, patrz deriveCameraRig)
// ============================================================
const desiredCamPos = new THREE.Vector3();
const desiredLookAt = new THREE.Vector3();

function updateCamera(delta) {
  desiredCamPos.copy(cameraOffset).applyQuaternion(shipGroup.quaternion);
  desiredCamPos.add(shipGroup.position);

  desiredLookAt.copy(cameraLookOffset).applyQuaternion(shipGroup.quaternion);
  desiredLookAt.add(shipGroup.position);

  const followLerp = 1 - Math.pow(0.0001, delta);
  camera.position.lerp(desiredCamPos, followLerp);

  const currentLookAt = camera.position.clone().add(
    new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(10)
  );
  currentLookAt.lerp(desiredLookAt, followLerp);
  camera.lookAt(currentLookAt);
}

// ============================================================
// RESIZE
// ============================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// START + PĘTLA ANIMACJI
// ============================================================
const clock = new THREE.Clock();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);

  planet.rotation.y += delta * 0.15;
  planetAngle += delta * 0.03;
  planet.position.set(
    Math.cos(planetAngle) * planetOrbitRadius,
    0,
    Math.sin(planetAngle) * planetOrbitRadius - 40
  );

  updateShip(delta);
  updateCamera(delta);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

loadShip(0)
  .then(() => {
    camera.position.copy(shipGroup.position).add(cameraOffset); // start bez "najazdu" kamery
    animate();
  })
  .catch((err) => {
    console.error('Nie udało się wczytać pierwszego statku:', err);
    loadingEl.textContent = 'Błąd wczytywania modelu — sprawdź konsolę.';
    loadingEl.classList.add('visible');
  });
