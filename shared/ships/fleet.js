import * as THREE from 'three';

/**
 * Flota gracza - JEDNO źródło prawdy dla kroków 3 i 4 (i każdego
 * kolejnego): które statki są dostępne, w którą stronę "patrzy" każdy
 * model i jak kamera ma go kadrować.
 *
 * DLACZEGO WSPÓLNY PLIK: kroki 3 i 4 miały każdy własną kopię tablicy
 * SHIPS, własny obrót modeli i własną matematykę kamery. Poprawka w
 * jednym kroku (np. odwrócenie Kharatha) nie trafiała do drugiego i
 * kroki zaczynały się rozjeżdżać. Teraz wszystko, co dotyczy "jak statek
 * wygląda i jak jest kadrowany", żyje tutaj.
 */

// ============================================================
// FLOTA + ORIENTACJA DZIOBU
// ============================================================
// Silnik gry (kroki 2-4) zakłada, że przód statku to lokalne -Z.
// Większość modeli jest zbudowana dziobem w +Z, więc obracamy je o 180°.
// WYJĄTEK: Kharath jest zbudowany dziobem w -Z (głowa z oczami i
// paszczą przy z ≈ -11..-14, dysze syfonów w +Z - patrz
// source/kharath_destroyer.js: eye_port, maw_core, siphon_core_*), więc
// dla niego korekta 180° oznaczałaby lot tyłem. Pole `bowAxis` mówi,
// gdzie model ma dziób w swoim WŁASNYM układzie współrzędnych.
export const SHIPS = [
  {
    id: 'warbird-light',
    name: 'Warbird — Light Skirmisher',
    file: '../shared/ships/models/warbird-light-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'raptor-interceptor',
    name: 'Raptor-class Interceptor',
    file: '../shared/ships/models/raptor-interceptor-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'warbird-heavy',
    name: 'Warbird — Heavy Siege Interceptor',
    file: '../shared/ships/models/warbird-heavy-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'kharath-destroyer',
    name: 'Kharath — Heavy Destroyer',
    file: '../shared/ships/models/kharath-destroyer-lod0.glb',
    bowAxis: '-Z',
  },
  {
    id: 'goniec-wybudzeni-hawk-7',
    name: 'Goniec — Kwartał Spisowy',
    file: '../shared/ships/models/goniec-wybudzeni-hawk-7-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'goniec-wybudzeni-trade-11',
    name: 'Goniec — Cech Rzeczników',
    file: '../shared/ships/models/goniec-wybudzeni-trade-11-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'goniec-wybudzeni-coalition-13',
    name: 'Goniec — Bez Numeru',
    file: '../shared/ships/models/goniec-wybudzeni-coalition-13-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'goniec-wybudzeni-hawk-21',
    name: 'Goniec — Weteran Kwartału',
    file: '../shared/ships/models/goniec-wybudzeni-hawk-21-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'goniec-wybudzeni-trade-34',
    name: 'Goniec — Rzecznik Dalekiego Szlaku',
    file: '../shared/ships/models/goniec-wybudzeni-trade-34-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'goniec-wybudzeni-coalition-58',
    name: 'Goniec — Odrzut Spisu',
    file: '../shared/ships/models/goniec-wybudzeni-coalition-58-lod0.glb',
    bowAxis: '+Z',
  },
  {
    id: 'goniec-wybudzeni-hawk-90',
    name: 'Goniec — Paradny Kwartału',
    file: '../shared/ships/models/goniec-wybudzeni-hawk-90-lod0.glb',
    bowAxis: '+Z',
  },
];

/** Obrót wokół Y (radiany), który ustawia dziób modelu w lokalne -Z silnika. */
export function visualYawFor(def) {
  return def.bowAxis === '-Z' ? 0 : Math.PI;
}

// ============================================================
// KADROWANIE KAMERY WG ROZMIARU NA EKRANIE
// ============================================================
// Poprzednio kamera stała w odległości ~0.85 × przekątna bounding boxa.
// To działa dla zwartych myśliwców, ale Kharath (~180 j. długości, wąski,
// z długimi ramionami) ma ogromną przekątną przy niewielkiej sylwetce -
// wychodził na ekranie dużo mniejszy niż reszta floty. Teraz odległość
// dobieramy tak, żeby SYLWETKA każdego statku zajmowała na ekranie tyle
// samo miejsca (TARGET_SCREEN_SIZE), niezależnie od jego prawdziwych
// rozmiarów. Rozmiary w świecie gry (i wynikająca z nich fizyka lotu)
// pozostają bez zmian - to zmiana wyłącznie KAMERY.
//
// SYLWETKĘ MIERZYMY Z RENDERU, nie z geometrii. Próbowałem liczyć ją z
// wierzchołków, potem z pola trójkątów - żadne z tych przybliżeń nie
// zgadzało się z tym, co faktycznie zapełnia piksele (Kharath ma ukryte
// żebra/pierścienie i gęste, cienkie ramiona, które zawyżają albo
// zaniżają każdą miarę geometryczną). Render statku białym, nieoświetlonym
// materiałem do małego bufora i policzenie zajętych pikseli to dokładnie
// ta sama rzecz, którą widzi gracz - i kosztuje kilka milisekund przy
// zaokrętowaniu (nie w każdej klatce).

/**
 * Docelowy rozmiar sylwetki na ekranie, w jednostkach wysokości ekranu:
 * sqrt(szerokość × wysokość) obwiedni sylwetki. Wartość odpowiada
 * Kharathowi przy dotychczasowej kamerze (to był wzorzec: "zbliżone do
 * statku 4"). Chcesz wszystkie statki większe/mniejsze na ekranie -
 * zmień TYLKO tę stałą.
 */
export const TARGET_SCREEN_SIZE = 0.26;

/** Sylwetka nie może zajmować więcej niż ta część SZEROKOŚCI ekranu
 * (ochrona przed portretowym ekranem telefonu, gdzie samo pole by
 * "wypchnęło" szeroki myśliwiec poza ekran). */
const MAX_WIDTH_FRACTION = 0.5;

const MEASURE_HEIGHT = 288; // px bufora pomiarowego (szerokość wg aspektu)

let measureTarget = null;
let measureMaterial = null;
const scratchColor = new THREE.Color();

function percentileFromHistogram(hist, total, p) {
  const goal = total * p;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= goal) return i;
  }
  return hist.length - 1;
}

/**
 * Renderuje `model` (ustawiony obrotem `yaw`) białym materiałem bez
 * oświetlenia z pozycji kamery `camPos` patrzącej na `lookAt` i mierzy,
 * ile miejsca sylwetka zajmuje na ekranie.
 *
 * Zwraca { size, widthFraction }: size = sqrt(W×H) w jednostkach wysokości
 * ekranu, widthFraction = część SZEROKOŚCI ekranu. Ekstrema to percentyle
 * 3-97% zajętych pikseli, żeby pojedyncze cienkie czułki nie "rozdymały"
 * sylwetki - liczy się masa statku.
 *
 * WAŻNE: `model` musi być bez rodzica (jak przy Box3 w loadShip()) i ma
 * już ustawioną pozycję wyśrodkowania. Po pomiarze znów jest bez rodzica.
 */
export function measureScreenSize(renderer, model, yaw, camPos, lookAt, fov, aspect) {
  const w = Math.max(64, Math.round(MEASURE_HEIGHT * aspect));
  const h = MEASURE_HEIGHT;

  if (!measureTarget || measureTarget.width !== w || measureTarget.height !== h) {
    measureTarget?.dispose();
    measureTarget = new THREE.WebGLRenderTarget(w, h);
  }
  measureMaterial ??= new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide });

  const holder = new THREE.Group();
  holder.rotation.y = yaw;
  holder.add(model);
  const scene = new THREE.Scene();
  scene.add(holder);
  scene.overrideMaterial = measureMaterial;

  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.5, 20000);
  cam.position.copy(camPos);
  cam.lookAt(lookAt);
  cam.updateMatrixWorld(true);

  // zapisz i przywróć stan renderera - to ma być niewidoczne dla reszty gry
  const prevTarget = renderer.getRenderTarget();
  const prevXR = renderer.xr.enabled;
  const prevAlpha = renderer.getClearAlpha();
  renderer.getClearColor(scratchColor);
  const prevColor = scratchColor.getHex();
  renderer.xr.enabled = false; // inaczej w sesji VR render przejąłby pozę headsetu

  const buf = new Uint8Array(w * h * 4);
  try {
    renderer.setRenderTarget(measureTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(measureTarget, 0, 0, w, h, buf);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.xr.enabled = prevXR;
    holder.remove(model); // model wraca do stanu "bez rodzica"
  }

  const cols = new Uint32Array(w), rows = new Uint32Array(h);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (buf[(y * w + x) * 4] > 127) { cols[x]++; rows[y]++; total++; }
    }
  }
  if (total < 20) return { size: Infinity, widthFraction: Infinity };

  const pxW = percentileFromHistogram(cols, total, 0.97) - percentileFromHistogram(cols, total, 0.03);
  const pxH = percentileFromHistogram(rows, total, 0.97) - percentileFromHistogram(rows, total, 0.03);
  return {
    size: Math.sqrt((pxW / h) * (pxH / h)), // obie miary w jednostkach WYSOKOŚCI ekranu
    widthFraction: pxW / w,
  };
}

/**
 * Wyprowadza pozycję kamery pogoniowej (offset względem statku,
 * lookOffset = punkt, na który kamera patrzy) tak, żeby sylwetka
 * statku miała na ekranie rozmiar TARGET_SCREEN_SIZE.
 *
 * Kształt kadru (proporcje offsetu i lookOffset) zostaje jak dawniej
 * (wysokość i wyprzedzenie proporcjonalne do rozmiaru), zmienia się tylko
 * wspólna skala tych dwóch wektorów - szukana iteracyjnie.
 *
 * @param {object} p
 * @param {THREE.WebGLRenderer} p.renderer do pomiaru sylwetki (patrz measureScreenSize)
 * @param {THREE.Object3D} p.model  wyśrodkowany model, BEZ rodzica
 * @param {THREE.Vector3}  p.size   bounding box modelu (x,y,z)
 * @param {number}         p.yaw    wynik visualYawFor()
 * @param {number}         p.fov    pionowy FOV kamery (stopnie)
 * @param {number}         p.aspect proporcje ekranu (szer/wys)
 */
export function deriveCameraRig({ renderer, model, size, yaw, fov, aspect }) {
  const diag = size.length();
  const base = {
    offset: new THREE.Vector3(0, size.y * 0.5 + diag * 0.12, diag * 0.85),
    look: new THREE.Vector3(0, size.y * 0.15, -diag * 0.35),
  };

  let k = 1;
  try {
    const cam = new THREE.Vector3(), look = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      cam.copy(base.offset).multiplyScalar(k);
      look.copy(base.look).multiplyScalar(k);
      const m = measureScreenSize(renderer, model, yaw, cam, look, fov, aspect);
      if (!Number.isFinite(m.size)) { k *= 1.5; continue; } // statek poza kadrem - odsuń
      const ratio = Math.max(m.size / TARGET_SCREEN_SIZE, m.widthFraction / MAX_WIDTH_FRACTION);
      k = Math.min(Math.max(k * ratio, 0.4), 12);
      if (Math.abs(ratio - 1) < 0.015) break;
    }
  } catch (err) {
    // Pomiar nie może zablokować gry (np. kontekst WebGL w dziwnym stanie) -
    // wracamy do dawnego kadrowania po przekątnej.
    console.warn('fleet.js: pomiar sylwetki nie powiódł się, kadrowanie domyślne:', err);
    k = 1;
  }

  return {
    offset: base.offset.clone().multiplyScalar(k),
    lookOffset: base.look.clone().multiplyScalar(k),
    // Kokpit (VR): "miejsce pilota" - bliżej kadłuba, NIE skalowane kadrowaniem
    cockpitY: size.y * 0.55,
    cockpitZ: diag * 0.08,
    framingScale: k,
  };
}
