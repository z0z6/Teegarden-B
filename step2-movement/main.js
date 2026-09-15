import * as THREE from 'three';

// ============================================================
// KROK 2: Ruch statku + kamera trzecioosobowa
// Nowe pojęcia: input handling, bezwładność, follow camera
// ============================================================

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.appendChild(renderer.domElement);

// ============================================================
// GWIAZDY W TLE (bez zmian względem kroku 1)
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

// Oświetlenie
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

// Planeta (orbituje jak w kroku 1)
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(8, 64, 64),
  new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.85, metalness: 0.05 })
);
scene.add(planet);
let planetAngle = 0;
const planetOrbitRadius = 60;

// ============================================================
// STATEK GRACZA
// ============================================================
const shipGroup = new THREE.Group();

const shipBody = new THREE.Mesh(
  new THREE.ConeGeometry(1, 3, 8),
  new THREE.MeshStandardMaterial({ color: 0x88ccff, metalness: 0.6, roughness: 0.3 })
);
shipBody.rotation.x = Math.PI / 2;
shipGroup.add(shipBody);

const engineGlow = new THREE.PointLight(0x66aaff, 1.5, 10);
engineGlow.position.set(0, 0, 1.8);
shipGroup.add(engineGlow);

// Mały stożek światła silnika — wizualny "ogon" (na razie prosty, w kroku
// z postprocessingiem zamienimy to na ładniejszy efekt smugi/bloom)
const engineTrail = new THREE.Mesh(
  new THREE.ConeGeometry(0.3, 1.2, 8),
  new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.6 })
);
engineTrail.rotation.x = -Math.PI / 2;
engineTrail.position.set(0, 0, 1.8);
shipGroup.add(engineTrail);

shipGroup.position.set(0, 0, 10);
scene.add(shipGroup);

// ============================================================
// FIZYKA RUCHU (uproszczona — bezwładność bez pełnej symulacji Newtona)
// ============================================================
// W kosmosie nie ma tarcia, więc "prawdziwy" statek nigdy by nie zwalniał
// sam z siebie. Dla wygody grania dodajemy niewielkie tłumienie (damping) —
// to świadomy kompromis: fizycznie nieprecyzyjny, ale przyjemniejszy w grze.
const shipState = {
  velocity: new THREE.Vector3(), // aktualna prędkość (jednostki/s)
  speed: 0,                       // prędkość "do przodu" wzdłuż nosa statku
  yawVelocity: 0,                 // prędkość obrotu (skręt lewo/prawo)
};

const SHIP = {
  acceleration: 18,      // jak szybko przyspiesza do przodu
  maxSpeed: 30,
  boostMultiplier: 2.2,
  drag: 0.6,             // tłumienie prędkości (0 = brak, 1 = natychmiastowy stop)
  turnAcceleration: 4.5,
  maxYawSpeed: 1.8,
  turnDrag: 3.0,
};

// --- Input ---
const keys = new Set();
window.addEventListener('keydown', (e) => keys.add(e.code));
window.addEventListener('keyup', (e) => keys.delete(e.code));

function updateShip(delta) {
  const forwardInput = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
    - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const turnInput = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
    - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const boosting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const braking = keys.has('Space');

  const maxSpeed = SHIP.maxSpeed * (boosting ? SHIP.boostMultiplier : 1);

  // Przyspieszanie / hamowanie do przodu
  if (braking) {
    shipState.speed *= Math.max(0, 1 - SHIP.drag * 2 * delta);
  } else if (forwardInput !== 0) {
    shipState.speed += forwardInput * SHIP.acceleration * delta;
  } else {
    // Naturalne tłumienie, gdy nic nie wciśnięte
    shipState.speed *= Math.max(0, 1 - SHIP.drag * delta);
  }
  shipState.speed = THREE.MathUtils.clamp(shipState.speed, -maxSpeed * 0.4, maxSpeed);

  // Skręt (yaw) — też z bezwładnością, żeby nie było "sztywno"
  shipState.yawVelocity += turnInput * SHIP.turnAcceleration * delta;
  shipState.yawVelocity *= Math.max(0, 1 - SHIP.turnDrag * delta);
  shipState.yawVelocity = THREE.MathUtils.clamp(
    shipState.yawVelocity, -SHIP.maxYawSpeed, SHIP.maxYawSpeed
  );
  shipGroup.rotation.y += shipState.yawVelocity * delta;

  // Ruch statku wzdłuż kierunku, w który patrzy (lokalna oś -Z)
  const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  shipGroup.position.addScaledVector(forwardDir, shipState.speed * delta);

  // Lekki "bank" (przechył) przy skręcie — czysto kosmetyczny efekt,
  // ale bardzo dużo dodaje do odczucia ruchu
  const targetRoll = -shipState.yawVelocity * 0.6;
  shipBody.rotation.z = THREE.MathUtils.lerp(shipBody.rotation.z, targetRoll, delta * 5);

  // Silnik świeci mocniej przy przyspieszaniu/boostie
  const throttle = Math.abs(shipState.speed) / maxSpeed;
  engineGlow.intensity = 1.0 + throttle * (boosting ? 3 : 1.5);
  engineTrail.scale.set(1, 0.6 + throttle * 1.4, 1);
  engineTrail.material.opacity = 0.35 + throttle * 0.5;
}

// ============================================================
// KAMERA TRZECIOOSOBOWA "NA SPRĘŻYNIE"
// ============================================================
// Zamiast sztywno przypinać kamerę do statku, obliczamy pozycję docelową
// (offset za i nad statkiem) i płynnie do niej dążymy każdą klatkę (lerp).
// To standardowa technika w grach akcji — daje wrażenie "wagi" kamery.
const cameraOffset = new THREE.Vector3(0, 4, 11); // za i nad statkiem
const cameraLookOffset = new THREE.Vector3(0, 1, -6); // punkt patrzenia lekko przed statkiem

const desiredCamPos = new THREE.Vector3();
const desiredLookAt = new THREE.Vector3();

function updateCamera(delta) {
  desiredCamPos.copy(cameraOffset).applyQuaternion(shipGroup.quaternion);
  desiredCamPos.add(shipGroup.position);

  desiredLookAt.copy(cameraLookOffset).applyQuaternion(shipGroup.quaternion);
  desiredLookAt.add(shipGroup.position);

  // Współczynnik "sprężystości" — im większy mnożnik, tym szybciej kamera
  // dogania statek. Niezależny od FPS dzięki użyciu delta.
  const followLerp = 1 - Math.pow(0.0001, delta);
  camera.position.lerp(desiredCamPos, followLerp);

  // Do "patrzenia" też stosujemy wygładzanie, inaczej przy szybkich
  // skrętach kamera "szarpałaby" obrazem
  const currentLookAt = camera.position.clone().add(
    new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(10)
  );
  currentLookAt.lerp(desiredLookAt, followLerp);
  camera.lookAt(currentLookAt);
}

// Ustaw kamerę w sensownej pozycji startowej (żeby nie "leciała" od (0,0,0))
camera.position.copy(shipGroup.position).add(cameraOffset);

// ============================================================
// RESIZE
// ============================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// PĘTLA ANIMACJI
// ============================================================
const clock = new THREE.Clock();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05); // ochrona przed "skokami" po zmianie karty

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

animate();
