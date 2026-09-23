import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createTripleStarSystem } from '../shared/systems/triple-star-system.js';
import { createFlightInput } from '../shared/input/flight-controls.js';
import { createSpaceBackground } from '../shared/systems/space-background.js';
import { createDebrisField } from '../shared/systems/debris-field.js';
import { resolveCollisions, collectSolidBodies } from '../shared/systems/collision.js';
import { createDashboard, CREW } from '../shared/systems/dashboard.js';
import { SHIPS, visualYawFor, deriveCameraRig } from '../shared/ships/fleet.js';
import { createCombat } from '../shared/systems/combat.js';
import { createNpcManager } from '../shared/systems/npc-ships.js';
import { createComms } from '../shared/systems/comms.js';
import { createEncounters } from '../shared/systems/encounters.js';
import { createTargetLabels } from '../shared/systems/target-labels.js';
import { RACES, raceForShip, deriveStats } from '../shared/data/races.js';
import { setupAndroidLandscape } from '../shared/input/android-landscape.js';
import { createWarpDrive, createPlayerWarp, WARP_SIGNATURES } from '../shared/systems/warp-drive.js';

// ============================================================
// KROK 6: NAPĘD FAŁDOWY (skok) dla wszystkich statków - patrz sekcja
// "KROK 6" niżej i shared/systems/warp-drive.js. Reszta pliku = krok 5.
// ============================================================
// KROK 5: Układ potrójny (prawdziwa fizyka N-ciał) + sztuczne
// oświetlenie statku gracza + sterowanie dotykowe (Android) i VR (WebXR)
// Nowe pojęcia: integracja leapfrog, hierarchiczny układ potrójny,
// cząstka testowa (planeta pod wpływem grawitacji, bez wpływu zwrotnego),
// zunifikowany input (klawiatura/dotyk/XR), rig kamery pod WebXR,
// tło "w nieskończoności" (gwiazdy + mgławice), kolizje, gruz/meteoryty
// i dashboard gracza (telemetria + komunikaty załogi)
// ============================================================

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1, // near=1 (nie 0.1) - przy far=500000 zbyt mały near psuje precyzję z-bufora (z-fighting)
  500000 // układ potrójny ma teraz skalę rzędu dziesiątek tysięcy jednostek
  // (orbita zewnętrzna czerwonego olbrzyma ~23000, orbita planety ~39000,
  // start statku ~48000) - far plane z dużym zapasem, żeby nic się nie ucinało
);

// cameraRig: POZYCJA/ROTACJA W ŚWIECIE steruje TYM obiektem, nie samą
// kamerą. Poza VR to różnica bez znaczenia (kamera siedzi w (0,0,0)
// względem rig-a, więc rig.position === efektywna pozycja kamery). W VR
// jest to konieczne: WebXR sam nadpisuje lokalną pozycję/rotację `camera`
// na podstawie śledzenia headsetu - gdybyśmy sterowali kamerą
// bezpośrednio, każda nasza zmiana zostałaby nadpisana przez headset.
// Zamiast tego poruszamy/obracamy RODZICA (rig = "gdzie w statku siedzi
// gracz"), a headset dokłada swobodny look w jego wnętrzu.
const cameraRig = new THREE.Group();
cameraRig.add(camera);
camera.position.set(0, 0, 0);
camera.rotation.set(0, 0, 0);
scene.add(cameraRig);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Android: pełny ekran + blokada poziomu + podpowiedź "obróć telefon"
// (patrz shared/input/android-landscape.js). Poza Androidem nic nie robi.
setupAndroidLandscape({ isSuspended: () => renderer.xr.isPresenting });

// Przycisk "Enter VR" - three.js sam sprawdza navigator.xr i chowa/
// wyłącza się, jeśli przeglądarka/urządzenie nie wspiera WebXR (np. na
// zwykłym desktopie bez headsetu, albo w Safari bez flagi eksperymentalnej).
document.body.appendChild(VRButton.createButton(renderer));

// ============================================================
// TŁO: gwiazdy + mgławice "w nieskończoności" (patrz
// shared/systems/space-background.js). Stary starfield z kroków 1-3
// (Points w promieniu 200000 j.) tu nie działał: rozmiar punktów w
// jednostkach świata kurczył się do ułamka piksela, a statek lecący
// kilkadziesiąt tysięcy jednostek widział paralaksę tła.
// ============================================================
const background = createSpaceBackground(renderer, scene);

// Oświetlenie bazowe: bardzo słaby ambient, żeby ciemna strona statku
// nigdy nie była całkowicie czarna (w kroku 1/2/3 to samo światło "dorabiał"
// pojedynczy, nieruchomy PointLight gwiazdy - teraz mamy 3 ruchome gwiazdy,
// które same dają właściwe, kierunkowe oświetlenie, patrz triple-star-system.js)
scene.add(new THREE.AmbientLight(0x223344, 0.25));

// ============================================================
// UKŁAD POTRÓJNY: prawdziwa fizyka grawitacyjna (N-ciał, leapfrog)
// zamiast wcześniejszej sztywnej orbity kołowej planety wokół stałego
// punktu. Szczegóły doboru mas/odległości/G - patrz
// shared/systems/triple-star-system.js (obszerny komentarz) oraz
// shared/physics/n-body.js (sam silnik integracji).
// ============================================================
const starSystem = createTripleStarSystem(scene);

// ============================================================
// FLOTA DO WYBORU
// ============================================================
// Definicje statków (plik, nazwa, orientacja dziobu) i kadrowanie kamery
// siedzą we WSPÓLNYM pliku shared/ships/fleet.js - ten sam dla kroków 3 i 4,
// żeby poprawka jednego statku nie musiała być powielana ręcznie.
// Modele generowane są proceduralnie (kod w shared/ships/source/), tu
// wczytujemy gotowe .glb (LOD0 - przełączanie LOD wg dystansu wciąż czeka,
// patrz README).
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder); // LOD1/LOD2 są skompresowane (meshopt) - LOD0 też można, patrz README

// Kontener na aktualnie pilotowany statek. Fizyka/kamera operują na TYM
// obiekcie, nigdy bezpośrednio na wczytanym modelu - dzięki temu zamiana
// statku (zaokrętowanie) nie wymaga przepisywania reszty gry.
const shipGroup = new THREE.Group();
// Origin (0,0,0) to barycentrum WEWNĘTRZNEJ PARY gwiazd - dosłownie
// wnętrze gwiazdy A! Statek MUSI startować gdzieś bezpiecznie z dala od
// układu. Pozycja liczona z constants zwróconych przez starSystem (nie
// na sztywno) - dzięki temu, jeśli kiedyś znów zmienimy skalę układu
// (RADIUS/SEPARATION w triple-star-system.js), spawn statku "sam się"
// dostosuje zamiast znowu lądować w środku gwiazdy.
const spawnRadius = starSystem.constants.PLANET_ORBIT_RADIUS * 1.25; // wyraźnie poza orbitą planety
shipGroup.position.set(0, spawnRadius * 0.08, spawnRadius);
scene.add(shipGroup);

// Gruz i meteoryty wokół punktu startowego: prawdziwe ciała stałe (dryfują,
// kolidują ze statkiem) i jednocześnie źródło realnych alertów dla
// dashboardu ("zbliżające się obiekty"). Więcej i bliżej niż domyślne
// ustawienia modułu (70 szt./4000-60000 j.), bo statek startuje w
// pustce daleko od układu i przy domyślnych wartościach niemal nic by
// się nie zdarzało.
const debrisField = createDebrisField(scene, shipGroup.position.clone(), {
  count: 90,
  innerRadius: 3000,
  outerRadius: 30000,
});

// visualGroup trzyma stały obrót "180° korekty dziobu" (patrz wyżej),
// a na to nakładamy jeszcze kosmetyczny bank (przechył) przy skręcie -
// rozdzielenie tych dwóch rotacji unika konfliktu między nimi.
const visualGroup = new THREE.Group();
shipGroup.add(visualGroup);

// ------------------------------------------------------------
// TYMCZASOWE sztuczne oświetlenie statku gracza.
// Od kroku 4 gwiazdy realnie świecą wg prawa odwrotnych kwadratów
// (patrz triple-star-system.js) - fizycznie poprawne, ale oznacza, że
// na typowych dystansach lotu (dziesiątki tysięcy jednostek) same
// gwiazdy już praktycznie NIE doświetlają statku (dokładnie jak w
// realu: światło gwiazd widać, ale nie oświetla ono niczego z daleka
// na tyle, żeby czytać przy nim). Zamiast dorabiać porządne oświetlenie
// sceny (IBL / kilka świateł kierunkowych dobranych pod kamerę - dobry
// temat na osobny krok), doczepiamy PointLight bezpośrednio do statku:
// zawsze dobrze widoczny, niezależnie od odległości do najbliższej
// gwiazdy. Intensity=400 (nie fizycznie "realistyczne" - to celowo
// umowna, gameplayowa wartość) dobrane empirycznie tak, żeby dawało
// wyraźny, czytelny akcent świetlny na kadłubie nawet w scenariuszu
// "pod światło" (patrz README, sekcja o kalibracji).
// Zasięg/intensywność są przeliczane w loadShip() pod rozmiar
// aktualnego statku (ten sam wzorzec co deriveFlightProfile/deriveCameraRig).
const shipLight = new THREE.PointLight(0xbfe4ff, 400, 100, 2);
shipLight.position.set(0, 3, 4);
shipGroup.add(shipLight);

// KROK 6: napęd fałdowy. Jeden menedżer dla wszystkich statków (gracz + NPC);
// uchwyt gracza dostaje model przy każdym zaokrętowaniu (loadShip).
const warp = createWarpDrive(scene);
const playerWarpHandle = warp.createHandle(shipGroup, 'wybudzeni');

let currentShipIndex = -1;
let currentModel = null;
let flightProfile = null;
let cameraOffset = new THREE.Vector3(0, 4, 11);
let cameraLookOffset = new THREE.Vector3(0, 1, -6);
// Pozycja "kokpitu" w VR - bliżej niż kamera pogoniowa (patrz updateCamera).
// Przeliczana per-statek w loadShip(), tak jak cameraOffset.
let cockpitOffsetY = 1.5;
let cockpitOffsetZ = 1.5;
// Promień kolizji statku (sfera) - przeliczany per-statek w loadShip().
let collisionRadius = 8;

/**
 * Wyprowadza "czułość" fizyki z fizycznego rozmiaru modelu (przekątna
 * bounding boxa). To świadomy skrót zamiast ręcznie wpisywanych stałych
 * per-statek: większy statek = trudniej rozpędzić i skręcić (proxy masy),
 * mniejszy = zwinniejszy. `refLength` to długość "wzorcowego" myśliwca
 * (warbird-light), względem której skalujemy resztę floty.
 *
 * BOOST = "napęd przelotowy" (×14, nie ×2.2 jak w kroku 3). Po
 * powiększeniu układu (patrz README, "Aktualizacja skali i światła")
 * dystanse urosły ~140× (separacja wewnętrzna 18→2560 j.), a prędkość
 * statku - nie. Przy starym mnożniku 2.2 dolot z punktu startowego
 * (~48000 j.) do układu trwałby kilkanaście minut. ×14 dobrane tak, żeby
 * ten sam dystans zajął ~60-90s dla warbird-light (46×14≈644 j./s,
 * 48000/644≈75s) - "przelotowo szybko", ale wciąż wymaga świadomego
 * przytrzymania Shift, nie jest to prędkość domyślna do walki z bliska.
 * Cięższe statki (Kharath) są proporcjonalnie wolniejsze nawet z
 * boostem - to zamierzone, zgodne z ich "ociężałym kolosem" charakterem
 * (patrz deriveFlightProfile - ten sam wzór co przed boostem).
 */
function deriveFlightProfile(boundingSize) {
  const refLength = 20; // w przybliżeniu długość warbird-light
  const scale = Math.max(boundingSize.length() / refLength, 0.3);
  return {
    acceleration: 24 / scale,
    maxSpeed: 46 / Math.sqrt(scale),
    boostMultiplier: 14,
    drag: 0.7,
    maxYawSpeed: 2.2 / Math.sqrt(scale), // używane jako proxy "zwinności" do skalowania czułości myszy/rolla, patrz updateShip
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
  playerWarp?.abort(); // zaokrętowanie w trakcie skoku = skok przerwany
  warp.unbind(playerWarpHandle);

  const model = gltf.scene;

  // WAŻNE — kolejność ma znaczenie: liczymy bounding box PRZED dodaniem
  // modelu do drzewa sceny (visualGroup.add), nie po. Box3().setFromObject()
  // liczy w przestrzeni ŚWIATA, uwzględniając transformy WSZYSTKICH
  // przodków (shipGroup, visualGroup) - a shipGroup w tym kroku NIE stoi
  // w (0,0,0)! Jeśli model jest już dodany do sceny w momencie liczenia
  // box3, wynik "wciąga" pozycję shipGroup, a poniższy kod błędnie
  // potraktowałby to jako współrzędne LOKALNE względem visualGroup -
  // wysyłając model dziesiątki tysięcy jednostek od właściwego miejsca.
  // Licząc box3 na modelu, który nie ma jeszcze rodzica, mamy gwarancję
  // "czystych" współrzędnych. (Ten błąd bywał niewidoczny dla PIERWSZEGO
  // wczytanego statku - w tej jednej chwili scena jeszcze nie przeliczyła
  // matrixWorld shipGroup, więc przypadkiem wychodziło poprawnie - i
  // ujawniał się dopiero przy KOLEJNYCH zaokrętowaniach.)
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  // Wyśrodkuj model względem pivotu (środek masy w XZ, spód w Y),
  // żeby rotacje shipGroup nie kręciły statkiem "mimośrodowo".
  model.position.set(-center.x, -box.min.y, -center.z);
  // Kamera dobiera dystans tak, żeby KAŻDY statek zajmował na ekranie tyle
  // samo miejsca (patrz shared/ships/fleet.js, TARGET_SCREEN_SIZE). Pomiar
  // renderuje model, więc też MUSI być przed visualGroup.add(model).
  const yaw = visualYawFor(def);
  const rig = deriveCameraRig({ renderer, model, size, yaw, fov: camera.fov, aspect: camera.aspect });

  visualGroup.add(model);
  currentModel = model;
  currentShipIndex = index;

  flightProfile = deriveFlightProfile(size);
  cameraOffset = rig.offset;
  cameraLookOffset = rig.lookOffset;
  cockpitOffsetY = rig.cockpitY;
  cockpitOffsetZ = rig.cockpitZ;

  // Przeskaluj sztuczne światło statku pod nowy rozmiar (patrz komentarz
  // przy tworzeniu shipLight wyżej) - większy statek = szerszy zasięg.
  const diag = size.length();
  shipLight.distance = diag * 6;
  // Natężenie rośnie z KWADRATEM rozmiaru (decay=2): to samo światło 400
  // dla 25-jednostkowego myśliwca daje czytelny kadłub, ale dla 193-
  // jednostkowego Kharatha spadało ~60× (kadłub odległy o ~100 j. od
  // lampy) i statek był prawie czarny. Skalowanie utrzymuje tę samą
  // jasność kadłuba niezależnie od rozmiaru statku.
  const REF_DIAG = 25; // przekątna myśliwców, dla których dobrano 400
  shipLight.intensity = 400 * (diag / REF_DIAG) ** 2;
  shipLight.position.set(0, diag * 0.2, diag * 0.15);
  collisionRadius = diag * 0.3; // sfera kolizji ~ "ciało" statku (Kharath jest wydłużony - to przybliżenie)

  // Korekta orientacji dziobu (patrz fleet.js: większość modeli ma dziób
  // w +Z i wymaga obrotu o 180°, Kharath ma dziób w -Z i obrotu NIE
  // wymaga) - ustawiana RAZ tutaj, nie co klatkę, bo visualGroup nie
  // dźwiga żadnej rotacji zależnej od sterowania (patrz updateShip).
  visualGroup.rotation.set(0, yaw, 0);

  // KROK 6: materiały statku dostają patch fałdy (klon - oryginał z glb nietknięty)
  warp.bindModel(playerWarpHandle, model, size);

  nameEl.textContent = def.name;
  loadingEl.classList.remove('visible');

  // KROK 5: statek wyznacza rasę kapitana (przydział w shared/data/races.js),
  // a rasa - statystyki (kadłub, pancerz, czujniki, horyzont, wpływ...).
  playerState.raceId = raceForShip(def.id);
  warp.setRace(playerWarpHandle, playerState.raceId); // sygnatura fałdy = rasa kapitana
  playerStats = deriveStats(playerState.raceId);
  playerState.maxHull = playerStats.hull;
  playerState.hull = playerStats.hull;
  playerState.armor = playerStats.armor;
  playerState.alive = true;
  shipGroup.visible = true;
  document.getElementById('death')?.classList.remove('visible');
  dashboard.show('race', {
    crew: CREW.navigator,
    text: `Kapitan: ${RACES[playerState.raceId].name} · ${RACES[playerState.raceId].factions.trade}.`,
    urgency: 'info',
    ttl: 4500,
  });
  encounters.startDemo(); // sceny fabularne od początku (nowa rasa = nowi rozmówcy)

  dashboard.show('ship-switch', {
    crew: CREW.navigator,
    text: `Zaokrętowano: ${def.name}. Systemy statku w gotowości.`,
    urgency: 'info',
    ttl: 3500,
  });
}

// ============================================================
// FIZYKA RUCHU: mysz = celowanie (pitch/yaw), A/D = roll, W/S = ciąg.
// To zmiana względem kroku 2/3 (tam A/D robiło skręt/yaw z bezwładnością
// i klawiatury). Teraz statek ma PEŁNE 3D (może pochylić nos w górę/dół,
// nie tylko skręcać w poziomie) - dlatego to już nie jest jeden `yawVelocity`,
// tylko trzy niezależne osie rotacji nakładane bezpośrednio na shipGroup.
// ============================================================
// ============================================================
// FIZYKA RUCHU: mysz/dotyk/kontroler XR = celowanie (pitch/yaw) +
// przechył (roll) + ciąg, przez zunifikowany moduł wejścia (patrz
// shared/input/flight-controls.js - jedno źródło prawdy dla trzech
// różnych metod sterowania, żeby fizyka poniżej nie musiała wiedzieć,
// skąd input pochodzi).
// ============================================================
const shipState = {
  speed: 0,
};
// Ostatni odczyt sterowania i ostatnia kolizja - czytane przez dashboard
// (updateDashboard), zapisywane w updateShip().
let lastInput = null;
let lastHit = { collided: false, body: null, normal: null, penetration: 0 };

const flightInput = createFlightInput({
  onShipSwitch: (digit) => {
    if (digit < SHIPS.length) {
      loadShip(digit).catch((err) => {
        console.error('Nie udało się wczytać statku:', err);
        loadingEl.textContent = `Błąd wczytywania: ${err?.message || err}`;
        loadingEl.classList.add('visible');
      });
    }
  },
});

// Podłącz UI dotykowe (patrz index.html, sekcja #touch-controls) - jeśli
// elementów nie ma w DOM (np. inna wersja strony), attachTouchUI po
// prostu nic nie podłączy, bez błędu.
flightInput.attachTouchUI({
  leftZone: document.getElementById('touch-left-zone'),
  leftKnob: document.getElementById('touch-left-knob'),
  rightZone: document.getElementById('touch-right-zone'),
  rightKnob: document.getElementById('touch-right-knob'),
  boostBtn: document.getElementById('touch-boost'),
  brakeBtn: document.getElementById('touch-brake'),
});

// Przycisk zmiany statku dla dotyku (brak klawiszy 1-4 na telefonie) -
// cyklicznie przełącza na kolejny statek z floty.
const shipSwitchBtn = document.getElementById('touch-ship-switch');
shipSwitchBtn?.addEventListener('click', () => {
  const next = (currentShipIndex + 1) % SHIPS.length;
  loadShip(next).catch((err) => console.error('Nie udało się wczytać statku:', err));
});

const PITCH_RATE = 0.9; // rad/s przy maksymalnym wychyleniu (myszy/joysticka/drążka XR)
const YAW_RATE = 0.9;
const ROLL_RATE = 1.6;

function updateShip(delta) {
  if (!flightProfile || !playerState.alive) return; // jeszcze nic nie wczytane / statek zniszczony

  const input = flightInput.update(renderer);
  lastInput = input;

  // KROK 6: w fałdzie pozycję statku prowadzi napęd (playerWarp.update), nie
  // model lotu - i nie ma kolizji (kurs sprawdzono przy planowaniu skoku).
  if (playerWarp.controlsLocked) {
    lastHit = { collided: false, body: null, normal: null, penetration: 0 };
    return;
  }
  const boosting = input.boost;
  const braking = input.brake;

  const P = flightProfile;
  // Boost skaluje RÓWNIEŻ przyspieszenie, nie tylko pułap prędkości -
  // inaczej rozpędzenie się do dużo wyższego pułapu (×14) trwałoby
  // kilkanaście razy dłużej niż normalnie (bo ciągle to samo, niskie
  // przyspieszenie bazowe). Dzięki skalowaniu obu razem, CZAS rozpędzania
  // do pełnej prędkości zostaje taki sam z boostem i bez (się skraca
  // proporcjonalnie tylko dystans-do-pełnej-prędkości, bo jedziemy szybciej).
  // speedCap < 1 = zakłócenie napędu przez wrogi statek (scena przechwycenia)
  const maxSpeed = P.maxSpeed * (boosting ? P.boostMultiplier : 1) * speedCap;
  const acceleration = P.acceleration * (boosting ? P.boostMultiplier : 1);

  // WAŻNE: pułap prędkości stosujemy TYLKO gdy jesteśmy POD nim -
  // jeśli aktualna prędkość już go przekracza (np. bo przed chwilą był
  // boost, a teraz go puszczono - nowy, niższy pułap obowiązuje od razu,
  // ale sama prędkość NIE), spadek do nowego pułapu odbywa się przez
  // naturalny opór (drag), nie przez twarde obcięcie w jednej klatce.
  // Przy ×14 boost bezwarunkowe klamrowanie wyglądałoby jak zderzenie
  // ze ścianą przy puszczeniu Shift.
  if (braking) {
    shipState.speed *= Math.max(0, 1 - P.drag * 2 * delta);
  } else if (input.throttle > 0) {
    shipState.speed = shipState.speed < maxSpeed
      ? Math.min(shipState.speed + acceleration * input.throttle * delta, maxSpeed)
      : shipState.speed * Math.max(0, 1 - P.drag * delta);
  } else if (input.throttle < 0) {
    const minSpeed = -maxSpeed * 0.4;
    shipState.speed = shipState.speed > minSpeed
      ? Math.max(shipState.speed + acceleration * input.throttle * delta, minSpeed)
      : shipState.speed * Math.max(0, 1 - P.drag * delta);
  } else {
    shipState.speed *= Math.max(0, 1 - P.drag * delta);
  }

  // Celowanie: im większy statek (proxy masy z flightProfile - patrz
  // deriveFlightProfile), tym wolniej reaguje na sterowanie - ten sam
  // "bezwładnościowy" duch co reszta silnika, tylko przeniesiony na
  // 3 osie zamiast jednej.
  const rateScale = Math.sqrt(P.maxYawSpeed / 2.2); // 1.0 dla warbird-light, mniej dla cięższych
  const targetPitch = input.pitch * PITCH_RATE * rateScale;
  const targetYaw = input.yaw * YAW_RATE * rateScale;
  const roll = input.roll * ROLL_RATE * rateScale;

  shipGroup.rotateY(targetYaw * delta);
  shipGroup.rotateX(targetPitch * delta);
  shipGroup.rotateZ(roll * delta);

  const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  shipGroup.position.addScaledVector(forwardDir, shipState.speed * delta);

  // ŻELAZNA ZASADA (patrz collision.js): statek nigdy nie zagłębia się w
  // gwiazdę/planetę/gruz - jest odpychany na powierzchnię, a prędkość
  // tłumiona. Stały spadek prędkości w kontakcie (nie natychmiastowe
  // zero) - statek "zsuwa się" po powierzchni zamiast stawać jak wryty.
  lastHit = resolveCollisions(
    shipGroup.position,
    collisionRadius,
    collectSolidBodies(starSystem, debrisField)
  );
  if (lastHit.collided) {
    shipState.speed *= Math.max(0, 1 - 6 * delta);
  }
}

// ============================================================
// KAMERA TRZECIOOSOBOWA "NA SPRĘŻYNIE" (desktop/dotyk) LUB KOKPIT
// SZTYWNO PRZYPIĘTY DO STATKU (VR) - operujemy na cameraRig, NIE na
// samej `camera` (patrz komentarz przy tworzeniu cameraRig na górze
// pliku - w VR to WebXR rusza kamerą wewnątrz rig-a, nie my).
//
// DLACZEGO ROZDZIELAMY TRYBY: poza VR chcemy płynnej, "sprężystej"
// kamery pogoniowej (lerp - patrz krok 2). W VR lerp/opóźnienie kamery
// względem ruchu gracza to prosta droga do choroby lokomocyjnej (mózg
// czuje ruch przez błędnik, ale oczy widzą go z doganiającym
// opóźnieniem - klasyczny trigger VR sickness). W VR rig musi być
// SZTYWNO przypięty do statku, klatka po klatce, bez wygładzania.
// ============================================================
const desiredCamPos = new THREE.Vector3();
const desiredLookAt = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();

function updateCamera(delta) {
  if (renderer.xr.isPresenting) {
    // Kokpit: rig siedzi w konkretnym punkcie statku (lekko z przodu/
    // góry, jak miejsce pilota), sztywno obracany razem z shipGroup.
    // Headset dokłada swobodny look w tym punkcie - to WebXR robi
    // automatycznie, nadpisując lokalną pozycję/rotację `camera`.
    const cockpitOffset = new THREE.Vector3(0, cockpitOffsetY, cockpitOffsetZ);
    cameraRig.position.copy(shipGroup.position)
      .add(cockpitOffset.applyQuaternion(shipGroup.quaternion));
    cameraRig.quaternion.copy(shipGroup.quaternion);
    return;
  }

  desiredCamPos.copy(cameraOffset).applyQuaternion(shipGroup.quaternion);
  desiredCamPos.add(shipGroup.position);

  desiredLookAt.copy(cameraLookOffset).applyQuaternion(shipGroup.quaternion);
  desiredLookAt.add(shipGroup.position);

  // KROK 6: w fałdzie statek leci tysiące j./s - kamera "na sprężynie" zostałaby
  // setki jednostek z tyłu, więc na czas przelotu przypinamy ją sztywno.
  const followLerp = THREE.MathUtils.lerp(1 - Math.pow(0.0001, delta), 1, playerWarp.cameraStiffness);
  cameraRig.position.lerp(desiredCamPos, followLerp);

  // Statek ma teraz pełne 3D (pitch/roll, nie tylko yaw) - kamera musi
  // dziedziczyć jego "up", inaczej przy przechyle horyzont statku i kamery
  // się rozjadą (statek się przechyla, kamera zostaje "pozioma").
  const desiredUp = new THREE.Vector3(0, 1, 0).applyQuaternion(shipGroup.quaternion);
  cameraRig.up.lerp(desiredUp, followLerp);

  const currentLookAt = cameraRig.position.clone().add(
    new THREE.Vector3(0, 0, -1).applyQuaternion(cameraRig.quaternion).multiplyScalar(10)
  );
  currentLookAt.lerp(desiredLookAt, followLerp);

  // UWAGA: NIE używamy tu cameraRig.lookAt(currentLookAt)! Object3D.lookAt()
  // ma DWIE różne konwencje: dla Camera/Light kieruje lokalne -Z na cel,
  // ale dla zwykłego obiektu (a cameraRig to zwykła THREE.Group) kieruje
  // na cel lokalne +Z. Kamera wewnątrz rig-a patrzy w -Z rig-a, więc
  // cameraRig.lookAt() odwracał ją tyłem do statku. Gorzej: powyżej
  // currentLookAt jest liczony z kierunku -Z rig-a (z poprzedniej klatki),
  // więc odwrócenie zamieniało się w sprzężenie zwrotne - kamera
  // przeskakiwała o 180° CO KLATKĘ (obraz drga, czerwony olbrzym mruga,
  // statku nie widać). Rozwiązanie: Matrix4.lookAt() zawsze używa konwencji
  // kamery (-Z na cel), niezależnie od typu obiektu.
  lookMatrix.lookAt(cameraRig.position, currentLookAt, cameraRig.up);
  cameraRig.quaternion.setFromRotationMatrix(lookMatrix);
}

// ============================================================
// DASHBOARD GRACZA
// ============================================================
// Dwie części (HTML/CSS w index.html):
//  1) TELEMETRIA (lewy dolny róg): prędkość, tryb napędu, najbliższe ciało
//     i odległość od barycentrum układu - to, co pilot chce widzieć cały czas.
//  2) KOMUNIKATY ZAŁOGI (prawy górny róg, moduł shared/systems/dashboard.js):
//     zdarzenia, na które trzeba zareagować, wypowiadane przez role załogi.
//     Tryb "kanałów": warunek jest sprawdzany cyklicznie i wołamy show() dla
//     kanału, dopóki jest prawdziwy - karta sama gaśnie po ttl, gdy przestaje.
//
// KTÓRE ALERTY SĄ "ŻYWE" (wołane z prawdziwych warunków w grze):
//   - Nawigator:   zbliżanie do gwiazdy/planety, zaokrętowanie
//   - Inżynier:    przegrzanie przy gwieździe, kontakt (kolizja)
//   - Czujniki:    kurs kolizyjny / zbliżające się gruz i meteoryty
// "Podłączony, ale bez zawartości": Oficer Taktyczny - w grze nie ma jeszcze
// wrogów ani sojuszników, więc nie ma czego zgłaszać (patrz README).
const dashboard = createDashboard(document.getElementById('crew-alerts'));

const tm = {
  speed: document.getElementById('tm-speed'),
  bar: document.getElementById('tm-speed-bar'),
  cruiseMark: document.getElementById('tm-cruise-mark'),
  mode: document.getElementById('tm-mode'),
  body: document.getElementById('tm-body'),
  bodyDist: document.getElementById('tm-body-dist'),
  origin: document.getElementById('tm-origin'),
  warp: document.getElementById('tm-warp'),
};

const fmtDist = (d) => (d >= 10000 ? `${(d / 1000).toFixed(1)} tys.` : Math.round(d).toString());

const _rel = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _fwd = new THREE.Vector3();
let dashboardTimer = 0; // alerty/telemetria ~10 Hz (nie co klatkę - mniej pracy dla DOM)

/** Zwraca [{ name, R, position }] dla ciał niebieskich (bez gruzu). */
function celestialBodies() {
  const { RADIUS } = starSystem.constants;
  return [
    { name: 'gwiazda G', R: RADIUS.starA, position: starSystem.bodies.starA.position, star: true },
    { name: 'biały karzeł', R: RADIUS.whiteDwarf, position: starSystem.bodies.whiteDwarf.position, star: true },
    { name: 'czerwony olbrzym', R: RADIUS.redGiant, position: starSystem.bodies.redGiant.position, star: true },
    { name: 'planeta', R: RADIUS.planet, position: starSystem.planet.position, star: false },
  ];
}

function updateDashboard(delta) {
  dashboard.tick(); // co klatkę: wygaszanie kart po ttl

  dashboardTimer -= delta;
  if (dashboardTimer > 0 || !flightProfile) return;
  dashboardTimer = 0.1;

  const shipPos = shipGroup.position;
  _fwd.set(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  _vel.copy(_fwd).multiplyScalar(shipState.speed);

  // --- najbliższe ciało niebieskie (odległość od POWIERZCHNI) ---
  let nearest = null;
  for (const b of celestialBodies()) {
    const surf = shipPos.distanceTo(b.position) - b.R - collisionRadius;
    if (!nearest || surf < nearest.surf) nearest = { ...b, surf };
  }

  // --- Nawigator/Inżynier: gwiazdy ---
  // Progi względem promienia gwiazdy (z dolnym limitem dla białego karła,
  // którego promień 140 j. dałby śmiesznie krótkie ostrzeżenie).
  let nearestStar = null;
  for (const b of celestialBodies()) {
    if (!b.star) continue;
    const surf = shipPos.distanceTo(b.position) - b.R - collisionRadius;
    if (!nearestStar || surf < nearestStar.surf) nearestStar = { ...b, surf };
  }
  const warnDist = Math.max(nearestStar.R * 2, 1500);
  const dangerDist = Math.max(nearestStar.R * 0.6, 500);
  if (nearestStar.surf < dangerDist) {
    dashboard.show('star-danger', {
      crew: CREW.engineer, urgency: 'danger',
      text: `Przegrzanie kadłuba! ${nearestStar.name}: ${fmtDist(Math.max(nearestStar.surf, 0))} j. od powierzchni — odlatuj!`,
    });
  } else if (nearestStar.surf < warnDist) {
    dashboard.show('star-danger', {
      crew: CREW.navigator, urgency: 'warning',
      text: `Zbliżamy się do: ${nearestStar.name} (${fmtDist(nearestStar.surf)} j. od powierzchni).`,
    });
  }

  // --- Nawigator: planeta ---
  const planetSurf = shipPos.distanceTo(starSystem.planet.position) - starSystem.constants.RADIUS.planet - collisionRadius;
  if (planetSurf < 3500) {
    dashboard.show('planet-near', {
      crew: CREW.navigator, urgency: 'info',
      text: `Planeta na kursie: ${fmtDist(Math.max(planetSurf, 0))} j. od powierzchni.`,
    });
  }

  // --- Czujniki: gruz i meteoryty ---
  // Karta pojawia się tylko, gdy jest o czym ostrzegać (inaczej lista
  // "wykryto: ..." wisiałaby na ekranie przez cały czas, bo w zasięgu
  // czujników prawie zawsze coś dryfuje):
  //   danger  - KURS KOLIZYJNY (obiekt zbliża się i minie nas o mniej niż
  //             ~sumę promieni z zapasem, w ciągu `horizon` s = 5 s x Nawigacja rasy)
  //   warning - obiekt bardzo blisko (<1500 j.)
  //   info    - obiekt zbliża się i w ciągu 90 s minie nas o mniej niż 1500 j.
  const SENSOR_RANGE = playerStats.sensorRange; // Czujniki rasy (wzór z karty)
  const URGENCY_RANK = { danger: 0, warning: 1, info: 2 };
  const contacts = [];
  for (const it of debrisField.items) {
    const dist = it.mesh.position.distanceTo(shipPos);
    if (dist > SENSOR_RANGE) continue;
    // Punkt największego zbliżenia przy stałych prędkościach (statku i obiektu):
    // r(t) = r0 + v·t, minimum dla t* = -(r0·v)/|v|². t* > 0 = zbliżamy się.
    _rel.copy(it.mesh.position).sub(shipPos);
    const v = it.velocity.clone().sub(_vel);
    const vv = v.lengthSq();
    const tca = vv > 1e-6 ? -_rel.dot(v) / vv : Infinity;
    const approaching = Number.isFinite(tca) && tca > 0;
    const miss = approaching ? _rel.clone().addScaledVector(v, tca).length() : Infinity;
    const hitRadius = (it.radius + collisionRadius) * 1.6;

    let urgency = null, text = '';
    if (approaching && tca < playerStats.horizon && miss < hitRadius) {
      urgency = 'danger';
      text = `KURS KOLIZYJNY: ${it.label} za ${tca.toFixed(0)} s (${fmtDist(dist)} j.)!`;
    } else if (dist < 1500) {
      urgency = 'warning';
      text = `Blisko: ${it.label} — ${fmtDist(dist)} j.`;
    } else if (approaching && tca < 90 && miss < 1500) {
      // tylko obiekty, które w ciągu 90 s naprawdę przejdą w pobliżu -
      // "zbliża się", ale minie nas o 10 tys. j. za 5 minut, to nie alert
      urgency = 'info';
      text = `Zbliża się: ${it.label} — ${fmtDist(dist)} j.`;
    }
    if (urgency) contacts.push({ it, dist, urgency, text });
  }
  contacts.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.dist - b.dist);
  for (const c of contacts.slice(0, 3)) {
    dashboard.show(`debris-${c.it.id}`, { crew: CREW.sensors, urgency: c.urgency, text: c.text });
  }

  // --- Inżynier: kontakt z ciałem stałym ---
  if (lastHit.collided) {
    dashboard.show('collision', {
      crew: CREW.engineer, urgency: 'danger', ttl: 2000,
      text: `Kontakt z: ${lastHit.body?.name ?? 'obiekt'}! Wytracamy prędkość.`,
    });
  }

  // --- Telemetria ---
  const P = flightProfile;
  const topSpeed = P.maxSpeed * P.boostMultiplier;
  const sp = playerWarp.controlsLocked ? warpSpeed : shipState.speed;
  tm.speed.textContent = Math.round(Math.abs(sp)).toString() + (sp < -0.5 ? ' ↩' : '');
  tm.bar.style.width = `${Math.min(100, (Math.abs(sp) / topSpeed) * 100)}%`;
  tm.cruiseMark.style.left = `${(P.maxSpeed / topSpeed) * 100}%`;
  tm.bar.classList.toggle('over-cruise', Math.abs(sp) > P.maxSpeed * 1.02);

  const inp = lastInput;
  let mode = 'DRYF';
  if (inp?.brake) mode = 'HAMULEC';
  else if (inp?.boost && inp.throttle > 0) mode = 'BOOST';
  else if (inp?.throttle > 0) mode = 'CIĄG';
  else if (inp?.throttle < 0) mode = 'WSTECZ';
  if (lastHit.collided) mode = 'KONTAKT';
  if (playerWarp.phase === 'charge') mode = 'ŁADOWANIE';
  else if (playerWarp.active) mode = 'FAŁDA';
  tm.warp.textContent = playerWarp.active ? (playerWarp.phase === 'charge' ? `ładowanie ${Math.round(playerWarp.chargeProgress * 100)}%` : 'w fałdzie')
    : speedCap < 1 ? 'zakłócony'
      : playerWarp.cooldown > 0 ? `chłodzenie ${Math.ceil(playerWarp.cooldown)} s` : 'gotowy (J)';
  tm.mode.textContent = mode;
  tm.mode.dataset.mode = mode;

  tm.body.textContent = nearest.name;
  tm.bodyDist.textContent = `${fmtDist(Math.max(nearest.surf, 0))} j.`;
  tm.origin.textContent = `${fmtDist(shipPos.length())} j.`;
}

// ============================================================
// KROK 5: RASY, WALKA I SCENY FABULARNE (+ krok 6: NPC wchodzą/odlatują przez fałdę)
// ============================================================
// Złożone z modułów w shared/ (dane ras, walka, NPC, komunikator, reżyser
// scen). Tu tylko "klej": stan gracza, ogień, śmierć/odrodzenie, etykiety
// celów i telemetria kadłuba.
let speedCap = 1; // mnożnik pułapu prędkości; <1 gdy wróg zakłóca napęd
const playerState = {
  raceId: 'wybudzeni', hull: 100, maxHull: 100, armor: 5,
  cargo: 10, alive: true, damageFlash: 0, sinceHit: 99,
};
let playerStats = deriveStats('wybudzeni');

const combat = createCombat(scene);
const playerProxy = {
  position: shipGroup.position,     // wektor "na żywo" - NPC czytają go co klatkę
  quaternion: shipGroup.quaternion,
  getVelocity: (out) => out.set(0, 0, -1).applyQuaternion(shipGroup.quaternion).multiplyScalar(shipState.speed),
  isAlive: () => playerState.alive,
};
combat.register({
  side: 'player',
  get position() { return shipGroup.position; },
  get radius() { return collisionRadius; },
  isAlive: () => playerState.alive,
  takeDamage: (amount, shooter) => damagePlayer(amount, shooter),
});

const npcs = createNpcManager(scene, combat, playerProxy, { warp });
const comms = createComms(document.getElementById('comms'));
const labels = createTargetLabels(document.getElementById('targets'), camera);
const encounters = createEncounters({
  npcs, comms, dashboard, CREW,
  player: playerProxy, playerState,
  getStats: () => playerStats,
  setSpeedCap: (v) => { speedCap = v; },
});

const startPosition = shipGroup.position.clone();
const deathEl = document.getElementById('death');
const damageEl = document.getElementById('damage');

function damagePlayer(amount, shooter) {
  if (!playerState.alive) return;
  if (playerWarp.ghost) return; // w fałdzie pociski przelatują przez "pustą" przestrzeń
  // Pancerz = płaska redukcja (połowa wartości), minimum 1 obrażenia
  const dealt = Math.max(1, amount - playerState.armor * 0.5);
  playerState.hull = Math.max(0, playerState.hull - dealt);
  playerState.damageFlash = 1;
  playerState.sinceHit = 0;
  dashboard.show('hit', {
    crew: CREW.tactical,
    urgency: playerState.hull < playerState.maxHull * 0.3 ? 'danger' : 'warning',
    text: `Trafienie${shooter?.callsign ? ` od ${shooter.callsign}` : ''}! Kadłub ${Math.round(playerState.hull)}/${playerState.maxHull}`,
    ttl: 1800,
  });
  if (playerState.hull <= 0) killPlayer();
}

function killPlayer() {
  playerWarp.abort();
  playerState.alive = false;
  shipState.speed = 0;
  speedCap = 1;
  combat.flash(shipGroup.position, collisionRadius * 3 + 30, 0xffa640, 0.9);
  shipGroup.visible = false;
  deathEl.classList.add('visible');
}

function respawn() {
  playerWarp.abort();
  playerState.hull = playerState.maxHull;
  playerState.alive = true;
  shipGroup.visible = true;
  shipGroup.position.copy(startPosition);
  shipGroup.quaternion.identity();
  shipState.speed = 0;
  cameraRig.position.copy(shipGroup.position).add(cameraOffset);
  deathEl.classList.remove('visible');
  combat.clear();
  encounters.startDemo();
}

// --- Ogień gracza: F / lewy przycisk myszy / przycisk OGIEŃ (dotyk) ---
const fireInput = { held: false, cooldown: 0 };
const BOLT_SPEED_PLAYER = 1500;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3(), _pvel = new THREE.Vector3();
let fireSide = 1;

function firePlayer() {
  _f.set(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  _r.set(1, 0, 0).applyQuaternion(shipGroup.quaternion);
  const origin = shipGroup.position.clone()
    .addScaledVector(_f, collisionRadius * 1.1 + 6)
    .addScaledVector(_r, (fireSide *= -1) * Math.max(3, collisionRadius * 0.15));

  // Asysta celowania: sterowanie myszą jest niedokładne, więc pocisk
  // koryguje kierunek na wroga w stożku 12° (z wyprzedzeniem ruchu).
  let dir = _f.clone();
  let bestCos = Math.cos(THREE.MathUtils.degToRad(12));
  for (const n of npcs.hostiles()) {
    _d.copy(n.group.position).sub(shipGroup.position);
    const dist = _d.length();
    if (dist > 3500) continue;
    const c = _d.normalize().dot(_f);
    if (c > bestCos) {
      bestCos = c;
      const t = dist / BOLT_SPEED_PLAYER;
      dir = n.group.position.clone().addScaledVector(n.velocity, t).sub(origin).normalize();
    }
  }
  combat.fire({
    origin, direction: dir, side: 'player', speed: BOLT_SPEED_PLAYER,
    damage: 14 * playerStats.damageMult, color: 0x6cf5ff, life: 2, hitScale: 2, shooter: { callsign: 'gracz' },
  });
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') fireInput.held = true;
  if (e.code === 'KeyR' && !playerState.alive) respawn();
  const scene5 = { Digit7: 'ally', Digit8: 'intercept', Digit9: 'attack' }[e.code];
  if (scene5 && playerState.alive) { paradeQueue = []; encounters.trigger(scene5); }
  if (e.code === 'Digit0' && playerState.alive) { paradeQueue = []; encounters.startDemo(); }
  if (e.code === 'KeyJ' && !e.repeat) engageWarp();
  if (e.code === 'KeyK' && !e.repeat && playerState.alive) warpParade();
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyF') fireInput.held = false; });
window.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !e.target.closest('#comms')) fireInput.held = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) fireInput.held = false; });
const fireBtn = document.getElementById('touch-fire');
if (fireBtn) {
  const on = (v) => (e) => { e.preventDefault(); fireInput.held = v; };
  fireBtn.addEventListener('touchstart', on(true), { passive: false });
  fireBtn.addEventListener('touchend', on(false), { passive: false });
  fireBtn.addEventListener('touchcancel', on(false), { passive: false });
}

const hullEls = {
  bar: document.getElementById('tm-hull-bar'), text: document.getElementById('tm-hull-text'),
  cargo: document.getElementById('tm-cargo'), race: document.getElementById('tm-race'),
};

function updateStory(delta) {
  fireInput.cooldown -= delta;
  if (fireInput.held && playerState.alive && flightProfile && fireInput.cooldown <= 0) {
    firePlayer();
    fireInput.cooldown = 0.22;
  }

  npcs.update(delta);
  combat.update(delta);
  encounters.update(delta);

  // regeneracja kadłuba (rasy z pasywną regeneracją - np. Szczepieni), 5 s po ostatnim trafieniu
  playerState.sinceHit += delta;
  if (playerState.alive && playerStats.hullRegenPct > 0 && playerState.sinceHit > 5) {
    playerState.hull = Math.min(playerState.maxHull, playerState.hull + playerState.maxHull * (playerStats.hullRegenPct / 100) * delta);
  }
  playerState.damageFlash = Math.max(0, playerState.damageFlash - delta * 2.5);

  // HUD: kadłub, ładunek, rasa, błysk po trafieniu, etykiety celów
  const hp = playerState.hull / playerState.maxHull;
  hullEls.bar.style.width = `${hp * 100}%`;
  hullEls.bar.classList.toggle('low', hp < 0.3);
  hullEls.text.textContent = `${Math.round(playerState.hull)} / ${playerState.maxHull}`;
  hullEls.cargo.textContent = playerState.cargo.toString();
  hullEls.race.textContent = RACES[playerState.raceId].name;
  damageEl.style.opacity = playerState.damageFlash.toFixed(2);

  labels.update(npcs.list.filter((n) => n.alive && !n.hidden && !n.arriving).map((n) => ({
    id: n.id,
    position: n.group.position,
    title: `${n.callsign} · ${n.raceName}`,
    sub: n.side === 'neutral' ? `fałda: ${n.warpName}` : n.side === 'ally' ? 'sojusznik' : 'wróg',
    color: n.side === 'neutral' ? RACES[n.raceId].color : n.side === 'ally' ? '#4dd6a0' : '#ff5a4a',
  })));
}

// ============================================================
// KROK 6: NAPĘD FAŁDOWY GRACZA
// ============================================================
// J / przycisk SKOK: 1,4 s ładowania (sterowanie działa, fałda podąża za
// dziobem), potem wślizg w fałdę, ~2 s przelotu i wyjście ~12 tys. j. dalej.
// Kurs jest skracany przed gwiazdami/planetą. Zakłócenie napędu wroga
// (scena przechwycenia) blokuje skok - to nie jest "przycisk ucieczki"
// od myta. Sojusznicy w eskorcie skaczą razem z graczem.
const WARP_DISTANCE = 12000;
let warpSpeed = 0;          // prędkość "przez fałdę" - tylko do telemetrii
const _warpPrev = new THREE.Vector3();

const playerWarp = createPlayerWarp({
  drive: warp,
  handle: playerWarpHandle,
  ship: shipGroup,
  camera,
  renderer,
  scene,
  background,
  flashEl: document.getElementById('warp-flash'),
});

function celestialSolids() {
  return collectSolidBodies(starSystem, null); // bez gruzu - planujemy tylko względem mas
}

function engageWarp() {
  if (!playerState.alive || !flightProfile) return;
  if (playerWarp.active) return;
  if (speedCap < 1) {
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'danger', ttl: 3000, text: 'Zakłócenie napędu! Fałda nie domknie się — skok niemożliwy.' });
    return;
  }
  if (playerWarp.cooldown > 0) {
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'warning', ttl: 2200, text: `Napęd fałdowy stygnie: ${Math.ceil(playerWarp.cooldown)} s.` });
    return;
  }
  const res = playerWarp.engage({
    distance: WARP_DISTANCE,
    bodies: celestialSolids(),
    onDiveCb: () => npcs.followJump(),
    onArriveCb: () => {
      // wyjście z fałdy z prędkością przelotową (nie z zerem - to by "hamowało" o ścianę)
      shipState.speed = Math.max(shipState.speed, flightProfile.maxSpeed * 1.5);
      npcs.arriveJump();
      dashboard.show('warp', { crew: CREW.navigator, urgency: 'info', ttl: 3500, text: `Wyjście z fałdy. Przebyto ${fmtDist(res.distance)} j.` });
    },
  });
  if (!res.ok) {
    if (res.reason === 'blocked') {
      dashboard.show('warp', { crew: CREW.navigator, urgency: 'warning', ttl: 3500, text: `Masa na kursie (${res.blockedBy}) — za blisko na skok. Zmień kurs.` });
    }
    return;
  }
  const sig = WARP_SIGNATURES[playerState.raceId];
  dashboard.show('warp', {
    crew: CREW.engineer, urgency: 'info', ttl: 3000,
    text: `Ładowanie napędu fałdowego (${sig.name})…${res.blockedBy ? ` Kurs skrócony przed: ${res.blockedBy}.` : ''}`,
  });
}

// "Parada fałdy": po jednym statku każdej z 7 ras (modele po kolei z floty)
// wychodzi z fałdy przed graczem, a po chwili wszystkie odlatują - pokaz
// wszystkich sygnatur i wszystkich modeli naraz. Sceny fabularne są na ten
// czas zerowane. Harmonogram liczony w czasie SYMULACJI (jak reżyser scen).
let paradeQueue = [];
function warpParade() {
  encounters.reset();
  paradeQueue = [];
  const raceIds = Object.keys(RACES);
  const spawned = [];
  raceIds.forEach((raceId, i) => {
    paradeQueue.push({ t: 0.2 + i * 0.45, fn: () => {
      if (!playerState.alive) return;
      const side = i % 2 ? -1 : 1;
      const row = Math.floor((i + 1) / 2);
      const offset = new THREE.Vector3(side * (55 + row * 80), (i % 3 - 1) * 26, -210 - row * 110);
      const pos = offset.clone().applyQuaternion(shipGroup.quaternion).add(shipGroup.position);
      spawned.push(npcs.spawn({
        raceId, factionKey: 'trade', side: 'neutral', position: pos,
        shipId: SHIPS[i % SHIPS.length].id, mode: 'formation', offset,
      }));
    } });
  });
  const leaveAt = 0.2 + raceIds.length * 0.45 + 7;
  raceIds.forEach((_, i) => paradeQueue.push({ t: leaveAt + i * 0.4, fn: () => { const n = spawned[i]; if (n?.alive) npcs.depart(n); } }));
  comms.say({
    sender: 'Parada fałdy', sub: 'wszystkie rasy', color: '#9fd8ff', ttl: 7,
    text: 'Każda rasa szyje przestrzeń inaczej: pieczęć, okno, harmoniczna, szczep, klauzula, korona, pryzmat. J — twój własny skok.',
  });
}
function updateParade(delta) {
  for (const e of [...paradeQueue]) {
    e.t -= delta;
    if (e.t <= 0) { paradeQueue.splice(paradeQueue.indexOf(e), 1); e.fn(); }
  }
}

const warpBtn = document.getElementById('touch-warp');
warpBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); engageWarp(); }, { passive: false });

// Stan przycisku SKOK na dotyku: ładowanie / sekundy chłodzenia / gotowy -
// bez tego dotknięcie w czasie chłodzenia wyglądało, jakby nic nie zadziałało.
const warpTouchBtn = document.getElementById('touch-warp');
let warpBtnKey = '';
function updateWarpButton() {
  if (!warpTouchBtn) return;
  const cd = Math.ceil(playerWarp.cooldown);
  const key = playerWarp.active ? 'active' : cd > 0 ? `cd${cd}` : speedCap < 1 ? 'jam' : 'ready';
  if (key === warpBtnKey) return;
  warpBtnKey = key;
  warpTouchBtn.classList.toggle('charging', playerWarp.active);
  warpTouchBtn.classList.toggle('cooling', cd > 0 || speedCap < 1);
  warpTouchBtn.textContent = playerWarp.active ? '···' : cd > 0 ? `${cd} s` : speedCap < 1 ? 'BLOK' : 'SKOK';
}

function updateWarp(delta) {
  updateParade(delta);
  _warpPrev.copy(shipGroup.position);
  playerWarp.update(delta);
  warp.update(delta); // wszystkie statki: uniformy kadłubów, sekwencje NPC, echa i szwy
  warpSpeed = delta > 0 ? shipGroup.position.distanceTo(_warpPrev) / delta : 0;
  updateWarpButton();
}

// ============================================================
// RESIZE
// ============================================================
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return; // WebXR zarządza rozmiarem framebuffera samo w trakcie sesji VR
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// START + PĘTLA ANIMACJI
// ============================================================
// WAŻNE: renderer.setAnimationLoop(), NIE requestAnimationFrame() -
// to wymóg WebXR. Trzyma się tego samego API poza sesją VR (przeglądarka
// wywołuje callback jak zwykły rAF), ale gdy gracz wejdzie w VR, ten sam
// callback zaczyna być synchronizowany z odświeżaniem headsetu (zwykle
// 90 Hz, nie 60 Hz jak typowy monitor) - requestAnimationFrame by tego
// nie obsłużył poprawnie.
const clock = new THREE.Clock();

// Cała symulacja w jednej funkcji tick(delta): animate() woła ją co klatkę,
// a testy mogą ją "przewijać" bez renderowania.
function tick(delta) {
  starSystem.update(delta);
  debrisField.update(delta);
  updateShip(delta);
  updateWarp(delta);
  updateCamera(delta);
  background.update(camera); // tło "w nieskończoności": gwiazdy podążają za kamerą (zero paralaksy)
  updateStory(delta);
  updateDashboard(delta);
}

// Hak do testów automatycznych (?debug w adresie): przewijanie symulacji
// bez renderowania i podgląd stanu. W normalnej grze nic nie wystawia.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = { tick, npcs, encounters, playerWarp, warp, shipGroup, get speed() { return shipState.speed; } };
}

function animate() {
  tick(Math.min(clock.getDelta(), 0.05));
  renderer.render(scene, camera);
}

loadShip(0)
  .then(() => {
    cameraRig.position.copy(shipGroup.position).add(cameraOffset); // start bez "najazdu" kamery
  })
  .catch((err) => {
    // WAŻNE: nie zostawiamy sceny czarnej bez wyjaśnienia. Najczęstsza
    // przyczyna: serwer deweloperski odpalony z WNĘTRZA
    // step5-encounters/ zamiast z korzenia repo - wtedy ścieżka
    // względna "../shared/..." próbuje wyjść poza katalog serwowany przez
    // `npx serve`/`http.server` i dostaje 404 dla WSZYSTKICH 4 statków naraz.
    console.error('Nie udało się wczytać pierwszego statku:', err);
    loadingEl.textContent =
      `Błąd wczytywania modelu (${SHIPS[0]?.file}): ${err?.message || err}. ` +
      'Sprawdź, czy serwer działa z KATALOGU GŁÓWNEGO repo, nie z tego podfolderu.';
    loadingEl.classList.add('visible');
  })
  .finally(() => renderer.setAnimationLoop(animate)); // scena (gwiazdy/kamera/układ potrójny) renderuje się ZAWSZE, nawet gdy statek padnie
