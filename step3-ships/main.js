import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createTripleStarSystem } from '../shared/systems/triple-star-system.js';
import { createFlightInput } from '../shared/input/flight-controls.js';

// ============================================================
// KROK 4: Układ potrójny (prawdziwa fizyka N-ciał) + sztuczne
// oświetlenie statku gracza + sterowanie dotykowe (Android) i VR (WebXR)
// Nowe pojęcia: integracja leapfrog, hierarchiczny układ potrójny,
// cząstka testowa (planeta pod wpływem grawitacji, bez wpływu zwrotnego),
// zunifikowany input (klawiatura/dotyk/XR), rig kamery pod WebXR
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

// Przycisk "Enter VR" - three.js sam sprawdza navigator.xr i chowa/
// wyłącza się, jeśli przeglądarka/urządzenie nie wspiera WebXR (np. na
// zwykłym desktopie bez headsetu, albo w Safari bez flagi eksperymentalnej).
document.body.appendChild(VRButton.createButton(renderer));

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
scene.add(createStarfield(6000, 200000)); // tło dalej niż cały układ (skala ~48000) - żeby gwiazdy w tle faktycznie wyglądały na odległe

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
// Modele generowane są proceduralnie (kod w shared/ships/source/),
// tu wczytujemy gotowe, wyeksportowane .glb (LOD0 - najwyższy detal;
// przełączanie LOD w zależności od dystansu wciąż czeka - dobry temat
// na krok 5, patrz README).
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
    // WYJĄTEK od reguły "dziób w +Z": Kharath jest modelowany dziobem w
    // lokalnym -Z (głowa z ramionami przy z=-12.8, napęd/syfony w +Z - patrz
    // shared/ships/source/kharath_destroyer.js). Silnik gry oczekuje przodu
    // w -Z, więc ten model NIE wymaga korekty 180° (z korektą leciał tyłem).
    bowAxis: '-Z',
  },
];

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

let currentShipIndex = -1;
let currentModel = null;
let flightProfile = null;
let cameraOffset = new THREE.Vector3(0, 4, 11);
let cameraLookOffset = new THREE.Vector3(0, 1, -6);
// Pozycja "kokpitu" w VR - bliżej niż kamera pogoniowa (patrz updateCamera).
// Przeliczana per-statek w loadShip(), tak jak cameraOffset.
let cockpitOffsetY = 1.5;
let cockpitOffsetZ = 1.5;

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

function deriveCameraRig(boundingSize) {
  const diag = boundingSize.length();
  return {
    offset: new THREE.Vector3(0, boundingSize.y * 0.5 + diag * 0.12, diag * 0.85),
    lookOffset: new THREE.Vector3(0, boundingSize.y * 0.15, -diag * 0.35),
    // Kokpit (VR): znacznie bliżej niż kamera pogoniowa - "miejsce
    // pilota" z przodu/góry kadłuba, nie za statkiem.
    cockpitY: boundingSize.y * 0.55,
    cockpitZ: diag * 0.08,
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

  visualGroup.add(model);
  currentModel = model;
  currentShipIndex = index;

  flightProfile = deriveFlightProfile(size);
  const rig = deriveCameraRig(size);
  cameraOffset = rig.offset;
  cameraLookOffset = rig.lookOffset;
  cockpitOffsetY = rig.cockpitY;
  cockpitOffsetZ = rig.cockpitZ;

  // Przeskaluj sztuczne światło statku pod nowy rozmiar (patrz komentarz
  // przy tworzeniu shipLight wyżej) - większy statek = szerszy zasięg.
  const diag = size.length();
  shipLight.distance = diag * 6;
  shipLight.intensity = 400;
  shipLight.position.set(0, diag * 0.2, diag * 0.15);

  // Stała korekta "180° dziobu" (patrz komentarz przy SHIPS) - ustawiana
  // RAZ tutaj, nie co klatkę, bo teraz visualGroup nie dźwiga już żadnej
  // rotacji zależnej od sterowania (to całe pełne 3D - patrz updateShip).
  // Modele z dziobem w -Z (bowAxis: '-Z', np. Kharath) są już zgodne z
  // silnikiem - dla nich rotacja zostaje zerowa.
  visualGroup.rotation.set(0, def.bowAxis === '-Z' ? 0 : Math.PI, 0);

  nameEl.textContent = def.name;
  loadingEl.classList.remove('visible');
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
  if (!flightProfile) return; // jeszcze nic nie wczytane

  const input = flightInput.update(renderer);
  const boosting = input.boost;
  const braking = input.brake;

  const P = flightProfile;
  // Boost skaluje RÓWNIEŻ przyspieszenie, nie tylko pułap prędkości -
  // inaczej rozpędzenie się do dużo wyższego pułapu (×14) trwałoby
  // kilkanaście razy dłużej niż normalnie (bo ciągle to samo, niskie
  // przyspieszenie bazowe). Dzięki skalowaniu obu razem, CZAS rozpędzania
  // do pełnej prędkości zostaje taki sam z boostem i bez (się skraca
  // proporcjonalnie tylko dystans-do-pełnej-prędkości, bo jedziemy szybciej).
  const maxSpeed = P.maxSpeed * (boosting ? P.boostMultiplier : 1);
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

  const followLerp = 1 - Math.pow(0.0001, delta);
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

function animate() {
  const delta = Math.min(clock.getDelta(), 0.05);

  starSystem.update(delta);
  updateShip(delta);
  updateCamera(delta);

  renderer.render(scene, camera);
}

loadShip(0)
  .then(() => {
    cameraRig.position.copy(shipGroup.position).add(cameraOffset); // start bez "najazdu" kamery
  })
  .catch((err) => {
    // WAŻNE: nie zostawiamy sceny czarnej bez wyjaśnienia. Najczęstsza
    // przyczyna: serwer deweloperski odpalony z WNĘTRZA
    // step4-stellar-physics/ zamiast z korzenia repo - wtedy ścieżka
    // względna "../shared/..." próbuje wyjść poza katalog serwowany przez
    // `npx serve`/`http.server` i dostaje 404 dla WSZYSTKICH 4 statków naraz.
    console.error('Nie udało się wczytać pierwszego statku:', err);
    loadingEl.textContent =
      `Błąd wczytywania modelu (${SHIPS[0]?.file}): ${err?.message || err}. ` +
      'Sprawdź, czy serwer działa z KATALOGU GŁÓWNEGO repo, nie z tego podfolderu.';
    loadingEl.classList.add('visible');
  })
  .finally(() => renderer.setAnimationLoop(animate)); // scena (gwiazdy/kamera/układ potrójny) renderuje się ZAWSZE, nawet gdy statek padnie
