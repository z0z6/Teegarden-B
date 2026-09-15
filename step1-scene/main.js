import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================
// KROK 1: Podstawowa scena kosmiczna
// Cel: zrozumieć trzy filary three.js — Scene, Camera, Renderer
// ============================================================

// --- 1. SCENA ---
// Scena to "kontener" na wszystkie obiekty 3D, światła itd.
const scene = new THREE.Scene();

// --- 2. KAMERA ---
// PerspectiveCamera(fov, aspect, near, far)
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);
camera.position.set(0, 15, 40);

// --- 3. RENDERER ---
// To on rysuje scenę z perspektywy kamery na <canvas>
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Tone mapping — sprawia, że jasne światła (np. gwiazda) wyglądają
// bardziej filmowo, zamiast po prostu robić się białe.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// --- 4. KONTROLA KAMERĄ MYSZKĄ (do testów, później zastąpimy sterowaniem statkiem) ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // płynne "hamowanie" ruchu kamery
controls.dampingFactor = 0.05;
controls.minDistance = 5;
controls.maxDistance = 400;

// ============================================================
// GWIAZDY W TLE (particle field)
// ============================================================
function createStarfield(count = 6000, radius = 1500) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Losowy punkt na sferze (rozkład w przestrzeni 3D, nie w płaszczyźnie)
    const r = radius * (0.3 + 0.7 * Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions.set([x, y, z], i * 3);

    // Delikatne zróżnicowanie kolorów: białe, błękitne, lekko żółte gwiazdy
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

// ============================================================
// OŚWIETLENIE
// ============================================================
// Ambient — bardzo słabe, żeby ciemna strona obiektów nie była całkiem czarna
const ambient = new THREE.AmbientLight(0x223344, 0.4);
scene.add(ambient);

// Point light — nasza "gwiazda" oświetlająca układ
const starLight = new THREE.PointLight(0xfff2d0, 3.5, 0, 0.5);
starLight.position.set(200, 80, -100);
scene.add(starLight);

// Wizualna reprezentacja gwiazdy (świecąca kula)
const starMesh = new THREE.Mesh(
  new THREE.SphereGeometry(12, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff2d0 })
);
starMesh.position.copy(starLight.position);
scene.add(starMesh);

// ============================================================
// PLACEHOLDER: PLANETA
// ============================================================
const planet = new THREE.Mesh(
  new THREE.SphereGeometry(8, 64, 64),
  new THREE.MeshStandardMaterial({
    color: 0x3a6ea5,
    roughness: 0.85,
    metalness: 0.05,
  })
);
planet.position.set(-10, 0, -20);
scene.add(planet);

// Prosta orbita — planeta krąży wokół punktu (0,0,0) po okręgu
let planetAngle = 0;
const planetOrbitRadius = 30;
const planetOrbitSpeed = 0.05; // rad/s

// ============================================================
// PLACEHOLDER: STATEK GRACZA
// (na razie prosta bryła — w kolejnym kroku podmienimy na model
// i dodamy realne sterowanie)
// ============================================================
const shipGroup = new THREE.Group();

const shipBody = new THREE.Mesh(
  new THREE.ConeGeometry(1, 3, 8),
  new THREE.MeshStandardMaterial({ color: 0x88ccff, metalness: 0.6, roughness: 0.3 })
);
shipBody.rotation.x = Math.PI / 2; // "nos" skierowany do przodu (oś -Z)
shipGroup.add(shipBody);

const engineGlow = new THREE.PointLight(0x66aaff, 1.5, 8);
engineGlow.position.set(0, 0, 1.8);
shipGroup.add(engineGlow);

shipGroup.position.set(0, 0, 10);
scene.add(shipGroup);

// ============================================================
// OBSŁUGA ZMIANY ROZMIARU OKNA
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
  const delta = clock.getDelta(); // czas od ostatniej klatki (w sekundach)

  // Obrót planety wokół własnej osi
  planet.rotation.y += delta * 0.15;

  // Orbita planety wokół gwiazdy
  planetAngle += delta * planetOrbitSpeed;
  planet.position.x = Math.cos(planetAngle) * planetOrbitRadius - 5;
  planet.position.z = Math.sin(planetAngle) * planetOrbitRadius - 20;

  // Delikatne pulsowanie silnika statku (efekt "żywej" sceny)
  engineGlow.intensity = 1.2 + Math.sin(clock.elapsedTime * 6) * 0.3;

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

animate();
