import * as THREE from 'three';
import { createSpaceBackground } from '../shared/systems/space-background.js';
import { createStarVisual } from '../shared/systems/star-surface.js';
import { createPlanetVisual } from '../shared/systems/planet-surface.js';
import { SYSTEMS, SYSTEM_ORDER } from '../shared/systems/star-systems.js';

/**
 * OKŁADKA GRY: żywa Gwiazda Teegardena (ten sam shader co w grze -
 * granulacja, plamy, protuberancje, rozbłyski) i przechodząca przed nią
 * planeta b. Wybór układu startowego podmienia gwiazdę na gwiazdę danego
 * układu i ustawia link "Graj" na ?uklad=...
 *
 * Strona działa także bez WebGL - wtedy zostaje statyczne tło z CSS.
 */

// gwiazda, którą okładka pokazuje dla każdego układu (najbardziej charakterystyczna)
const PREVIEW = {
  potrojny: { type: 'redGiant', color: '#ff7a45', seed: 4 },
  teegarden: { type: 'redDwarf', color: '#ff5a3a', seed: 11 },
  blizniaki: { type: 'yellowDwarf', color: '#ffc861', seed: 3 },
  symbiotyczny: { type: 'redGiant', color: '#ff9a55', seed: 13, tide: 0.28 },
  nadolbrzym: { type: 'blueSupergiant', color: '#9fc4ff', seed: 21 },
};
const CAPTION_DEFAULT = document.getElementById('caption').textContent;

// ------------------------------------------------------------
// Wybór układu (działa niezależnie od WebGL)
// ------------------------------------------------------------
const STORE_KEY = 'teegarden-b:uklad';
let selected = 'teegarden';
try { const s = localStorage.getItem(STORE_KEY); if (SYSTEMS[s]) selected = s; } catch { /* prywatny tryb przeglądarki */ }

const play = document.getElementById('play');
const playSystem = document.getElementById('play-system');
const caption = document.getElementById('caption');
const list = document.getElementById('system-list');
const panel = document.getElementById('systems');
const chooseBtn = document.getElementById('choose');

function applySelection(id, { preview = true } = {}) {
  selected = id;
  try { localStorage.setItem(STORE_KEY, id); } catch { /* bez zapisu */ }
  play.href = `./step9-missions/?uklad=${id}`;
  playSystem.textContent = SYSTEMS[id].name;
  caption.textContent = id === 'teegarden' ? CAPTION_DEFAULT : SYSTEMS[id].desc;
  list.querySelectorAll('.system').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
  if (preview) showStar(id);
}

for (const id of SYSTEM_ORDER) {
  const b = document.createElement('button');
  b.className = 'system';
  b.dataset.id = id;
  b.style.setProperty('--c', PREVIEW[id].color);
  b.innerHTML = `<i></i><b>${SYSTEMS[id].name}</b><span>${SYSTEMS[id].desc}</span>`;
  b.addEventListener('click', () => applySelection(id));
  // podgląd na najechanie; po zjechaniu wraca wybrany
  b.addEventListener('pointerenter', () => showStar(id));
  b.addEventListener('pointerleave', () => showStar(selected));
  list.appendChild(b);
}
chooseBtn.addEventListener('click', () => {
  const open = panel.classList.toggle('open');
  chooseBtn.setAttribute('aria-expanded', String(open));
});

const dialog = document.getElementById('controls');
document.getElementById('controls-open').addEventListener('click', () => dialog.showModal());
document.getElementById('controls-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

// ------------------------------------------------------------
// Scena 3D
// ------------------------------------------------------------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sky = document.getElementById('sky');
let showStar = () => {};

try {
  const R = 1000;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  sky.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 1, 1e6);
  const background = createSpaceBackground(renderer, scene, { seed: 42, cubeSize: 512 });

  const starRoot = new THREE.Group();
  scene.add(starRoot);
  const light = new THREE.PointLight(0xffd2b0, 3 * (R * 3) ** 2, 0, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x223344, 0.08));

  let star = null, starId = null;
  showStar = (id) => {
    if (id === starId) return;
    starId = id;
    const p = PREVIEW[id];
    if (star) { starRoot.remove(star.group); star.dispose(); }
    // ten sam program GPU dla wszystkich typów - podmiana nie kompiluje shaderów
    star = createStarVisual({ radius: R, type: p.type, seed: p.seed });
    starRoot.add(star.group);
    star.setTide(new THREE.Vector3(R * 5, R * 0.4, R * 1.5), p.tide ?? 0);
    light.color.set(p.color).lerp(new THREE.Color(1, 1, 1), 0.5);
  };

  // planeta b: tranzyt przed tarczą, widoczna głównie jako sylwetka z cienkim sierpem
  const planet = createPlanetVisual({ radius: R * 0.065, kind: 'ocean', seed: 11, tilt: 0.3 });
  scene.add(planet.group);

  // kadr: gwiazda po prawej (desktop) albo u góry (telefon w pionie)
  const target = new THREE.Vector3();
  function frame() {
    const aspect = innerWidth / innerHeight;
    camera.aspect = aspect;
    camera.fov = aspect < 0.8 ? 52 : 38;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    if (aspect < 0.8) { camera.position.set(0, -R * 0.5, R * 4.4); target.set(0, -R * 1.35, 0); }
    else { camera.position.set(0, 0, R * 4.2); target.set(-R * 1.55 * Math.min(aspect / 1.6, 1.2), -R * 0.35, 0); }
  }
  frame();
  addEventListener('resize', frame);

  applySelection(selected, { preview: false });
  showStar(selected);

  const clock = new THREE.Timer();
  const camBase = new THREE.Vector3();
  let frames = 0, slowFrames = 0, t = 50; // start w trakcie tranzytu (planeta od razu na tarczy)
  renderer.setAnimationLoop((now) => {
    clock.update(now);
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05) * (reduceMotion ? 0.3 : 1);
    t += dt;

    // bardzo powolny dryf kamery - scena żyje, ale nic nie "skacze" w oczy
    camBase.copy(camera.position);
    if (!reduceMotion) {
      camera.position.x += Math.sin(t * 0.05) * R * 0.08;
      camera.position.y += Math.sin(t * 0.037) * R * 0.04;
    }
    camera.lookAt(target);

    // tranzyt: planeta przesuwa się PRZED tarczą (między kamerą a gwiazdą) -
    // ciemna sylwetka z cienkim sierpem, jak prawdziwy tranzyt planety.
    // Jedno przejście ~90 s, potem od nowa. Proporcje prawdziwe: Teegarden b
    // ma ~1/11 średnicy swojej gwiazdy (planeta jest bliżej kamery, więc jej
    // promień jest odpowiednio mniejszy, żeby na ekranie wyszło ~1/11).
    const u = ((t / 90) % 1) * 2 - 1;
    planet.group.position.set(u * R * 1.3, -R * 0.12 + u * R * 0.1, R * 1.2);
    planet.update(dt);

    star.update(dt, camera);
    background.update(camera);
    renderer.render(scene, camera);
    camera.position.copy(camBase);

    // słabszy sprzęt: jeśli pierwsze 2 s klatki są wolne, zmniejsz rozdzielczość sceny
    if (frames < 120 && raw > 0 && raw < 0.5) {
      frames++;
      if (raw > 1 / 40) slowFrames++;
      if (frames === 120 && slowFrames > 60 && pixelRatio > 0.75) {
        pixelRatio = Math.max(0.75, pixelRatio * 0.66);
        renderer.setPixelRatio(pixelRatio);
      }
    }
    if (!sky.classList.contains('live')) sky.classList.add('live');
  });
} catch (err) {
  console.warn('Okładka: brak WebGL, zostaje statyczne tło.', err);
  applySelection(selected, { preview: false });
}

// testy automatyczne
window.__cover = { applySelection: (id) => applySelection(id), get selected() { return selected; } };
