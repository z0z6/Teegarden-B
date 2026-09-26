import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { createStarSystem, SYSTEMS, SYSTEM_ORDER, spawnOf } from '../shared/systems/star-systems.js';
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
import { RACES, raceForShip, shipForRace, deriveStats } from '../shared/data/races.js';
import { setupAndroidLandscape } from '../shared/input/android-landscape.js';
import { createWarpDrive, createPlayerWarp, WARP_SIGNATURES } from '../shared/systems/warp-drive.js';
import { createWeapons, createPlayerArsenal, WEAPONS, RACE_WEAPON } from '../shared/systems/weapons.js';
import { combatRules, loadoutFor } from '../shared/systems/combat-rules.js';
import { createFlares } from '../shared/systems/flares.js';
import { createTactics, DIFFICULTY } from '../shared/systems/tactical-ai.js';
import { createWolfpack, PACK_ORDERS } from '../shared/systems/wolfpack.js';
import { createMissions, MISSIONS, MISSION_ORDER } from '../shared/systems/missions.js';
import { getAudio } from '../shared/audio/audio.js';
import { createGameAudio } from '../shared/audio/game-audio.js';
import { mountAudioControls } from '../shared/audio/audio-controls.js';
import { createEconomy } from '../shared/systems/economy.js';
import { createEconomyPanel } from '../shared/systems/economy-panel.js';
import { createRaids } from '../shared/systems/raids.js';
import { generateFields, fieldValue, ARCHETYPES } from '../shared/systems/fields.js';
import { createStrategy, PLAYER, rulingFaction } from '../shared/systems/strategy.js';
import { createRivalPresence } from '../shared/systems/rival-presence.js';
import { createArmy } from '../shared/systems/army.js';
import { createArmyTab, warshipModel } from '../shared/systems/army-panel.js';
import { createStrategicMap } from '../shared/systems/strategic-map.js';
import { racePortrait } from '../shared/data/race-portraits.js';
import { STATION_ORDER } from '../shared/data/economy.js';
import { METALS, METAL_ORDER, PLAYER_MINING } from '../shared/data/economy.js';
import { createCommand } from '../shared/systems/command.js';
import { createCommandView } from '../shared/systems/command-view.js';
import { createCommandPanel } from '../shared/systems/command-panel.js';
import { createDecisions } from '../shared/systems/decisions.js';
import { setSurfaceQuality } from '../shared/systems/surface-detail.js';

// ============================================================
// KROK 12: DOWÓDZTWO - gra zaczyna się na MOSTKU SIEDZIBY rasy (tryb
// 'mostek'): panel gracza, wyprawy dronów z okienkiem podglądu, huta,
// reaktory, nauka i ulepszenia (shared/systems/command*.js, decisions.js).
// Lot myśliwcem ('lot') to wybór: "Za sterami" albo decyzja przy ataku;
// "Poślij flotę" przełącza na podgląd zdalny bitwy ('podglad'). Tab wraca
// na mostek. Patrz sekcja "KROK 12" niżej i README kroku.
// ============================================================
// KROK 11: DOMINACJA - gospodarka jako główna płaszczyzna gry. Kilka pól
// surowcowych w każdym układzie (odkrywanych czujnikami), rasy jako gracze
// ekonomiczni rywalizujący o pola (strategy.js), ich placówki i roje widoczne
// w układzie (rival-presence.js), stocznia i flota gracza (army.js), mapa
// strategiczna z dyplomacją (M). Walka wynika z rywalizacji o przestrzeń
// surowcową. Patrz sekcja "KROK 11" niżej i README kroku.
// ============================================================
// KROK 10: EKONOMIA - pas planetoid przy każdym układzie, promień wydobywczy
// (T), stacje orbitalne (magazyn, stacja przeładunkowa, dok roju) stawiane z
// panelu przemysłu (P), rozładunek w stacjach i na placach budowy (Y), roje
// autonomicznych dronów kopiących na powierzchni planetoid. Logika w
// shared/systems/economy.js, patrz sekcja "KROK 10" niżej i README kroku.
// ============================================================
// KROK 9: MISJE, TRYB WATAHY I TAKTYCZNE AI - patrz sekcja "KROK 9" niżej,
// shared/systems/tactical-ai.js (mózg NPC), wolfpack.js (wataha) i
// missions.js (scenariusze). Tablica misji to osobna strona (missions.html):
// gra dostaje ?misja=&statek=&trudnosc=&wataha=&uklad= i startuje od razu.
// Warstwa audio: shared/audio/ (sekcja "AUDIO" niżej). Reszta pliku = krok 8.
// ============================================================
// ============================================================
// KROK 8: UKŁADY GWIEZDNE - pięć układów (shared/systems/star-systems.js),
// proceduralne powierzchnie gwiazd (star-surface.js) i planet
// (planet-surface.js), skok międzygwiezdny (U / mapa M). Patrz sekcja
// "KROK 8" niżej.
// ============================================================
// KROK 7: UZBROJENIE - pięć rodzajów broni, Ciepło, broń rasowa NPC.
// Patrz sekcja "KROK 7" niżej i shared/systems/weapons.js.
// ============================================================

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
// UKŁAD GWIEZDNY (krok 8): jeden z pięciu gotowych układów, wymienny w locie.
// Wszystko, co gra wie o ciałach niebieskich, idzie przez ogólny interfejs
// układu (bodies, solidBodies, spawn, warpDistance) - patrz star-systems.js.
// Początkowy układ: ?uklad=teegarden (itd.) w adresie, domyślnie potrójny.
// ============================================================
const urlSystem = new URLSearchParams(location.search).get('uklad');
// krok 9: parametry z tablicy misji (missions.html)
const URLQ = new URLSearchParams(location.search);
const urlMission = MISSIONS[URLQ.get('misja')] ? URLQ.get('misja') : null;
const urlShipIndex = Math.max(0, SHIPS.findIndex((s) => s.id === URLQ.get('statek')));
const urlPack = URLQ.get('wataha') === '1';
// krok 12: tryb gry - 'mostek' (dowodzenie z siedziby), 'lot' (za sterami), 'podglad' (bitwa zdalnie).
// Misja z tablicy startuje od razu w locie.
let mode = urlMission ? 'lot' : 'mostek';
const initialSystem = SYSTEMS[urlSystem] ? urlSystem : 'potrojny';
const QUALITY = matchMedia('(pointer: coarse)').matches ? 0.6 : 1; // telefony: mniej protuberancji i planetoid
setSurfaceQuality(QUALITY); // krok 12: szczegół powierzchni (surface-detail.js) - mniej oktaw na telefonach
let starSystem = createStarSystem(scene, initialSystem, { quality: QUALITY });

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
const _spawnM = new THREE.Matrix4();
/** Ustawia statek w punkcie startowym układu, dziobem do jego środka. */
function placeAtSpawn() {
  shipGroup.position.copy(starSystem.spawn.position);
  _spawnM.lookAt(shipGroup.position, starSystem.spawn.lookAt, new THREE.Vector3(0, 1, 0));
  shipGroup.quaternion.setFromRotationMatrix(_spawnM);
}
placeAtSpawn();
scene.add(shipGroup);

// Gruz i meteoryty wokół punktu startowego: prawdziwe ciała stałe (dryfują,
// kolidują ze statkiem) i jednocześnie źródło realnych alertów dla
// dashboardu ("zbliżające się obiekty"). Więcej i bliżej niż domyślne
// ustawienia modułu (70 szt./4000-60000 j.), bo statek startuje w
// pustce daleko od układu i przy domyślnych wartościach niemal nic by
// się nie zdarzało.
const DEBRIS_OPTS = { count: 90, innerRadius: 3000, outerRadius: 30000 };
let debrisField = createDebrisField(scene, shipGroup.position.clone(), DEBRIS_OPTS);

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
// krok 9: gameAudio powstaje niżej (potrzebuje misji i komunikatora); haki wołają go leniwie
let gameAudio = null;
const warp = createWarpDrive(scene, { onSlam: (p, sig) => gameAudio?.slam(p, sig) });
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
  if (typeof applyCrewPortraits === 'function') applyCrewPortraits(playerState.raceId); // krok 11: twarze załogi
  warp.setRace(playerWarpHandle, playerState.raceId); // sygnatura fałdy = rasa kapitana
  // KROK 7: Ciepło z karty rasy + mnożnik Taktyki; na start - broń rasowa
  arsenal.setRace(playerState.raceId, RACES[playerState.raceId].ship.thermal, playerStats.damageMult);
  // KROK 9 (combat-rules.js): uzbrojenie rasy + zasady poziomu trudności
  const diffKey = DIFFICULTY[urlDifficulty] ? urlDifficulty : 'normalna';
  arsenal.configure(loadoutFor(playerState.raceId, diffKey), combatRules(diffKey));
  arsenal.select(arsenal.state.order.includes(RACE_WEAPON[playerState.raceId]) ? RACE_WEAPON[playerState.raceId] : arsenal.state.order[0]);
  flares.configure(combatRules(diffKey));
  buildWeaponBar();
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
  // KROK 9: zamiast dema - misje. Nowa rasa = nowi przeciwnicy i nowa wataha.
  if (missions.active) missions.start(missions.state.id);
  if (wolfpack.active) wolfpack.spawn();
  if (!firstShipLoaded) {
    firstShipLoaded = true;
    // start z tablicy misji: wataha i misja od razu po zaokrętowaniu
    if (urlPack && !wolfpack.active) wolfpack.spawn();
    if (urlMission) startMission(urlMission);
  }

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

// Statek wybiera się na tablicy misji (missions.html) i leci nim całą misję,
// aż do sukcesu albo porażki. Zmiana statku (= rasy kapitana) tylko przez
// powrót na tablicę (N). Dlatego bez onShipSwitch: klawisze 1-4 w tym kroku
// nic nie robią (starsze kroki 3-8 nadal przełączają statki po staremu).
const flightInput = createFlightInput();

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

const PITCH_RATE = 0.9; // rad/s przy maksymalnym wychyleniu (myszy/joysticka/drążka XR)
const YAW_RATE = 0.9;
const ROLL_RATE = 1.6;

function updateShip(delta) {
  if (!flightProfile || !playerState.alive || mode !== 'lot') return; // nic nie wczytane / statek zniszczony / w hangarze (krok 12)

  const input = flightInput.update(renderer);
  // krok 10: przy otwartym panelu przemysłu mysz obsługuje panel, a statek
  // trzyma kurs (inaczej każdy ruch do przycisku skręcałby okrętem)
  if (industryPanel?.open && input.source === 'keyboard') { input.pitch = 0; input.yaw = 0; }
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
    collectSolidBodies(starSystem, debrisField, shipGroup.position) // krok 8: z planetoidami w pobliżu
      .concat(economy.solids()) // krok 10: pas planetoid i stacje
      .concat(rival.solids()) // krok 11: placówki ras
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
  if (mode !== 'lot') return; // krok 12: na mostku i w podglądzie kamerę prowadzi command-view.js
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
  return starSystem.bodies; // krok 8: lista ciał bieżącego układu (gwiazdy, planety, księżyce)
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

  // --- Nawigator: najbliższa planeta / księżyc ---
  let nearestRock = null;
  for (const b of celestialBodies()) {
    if (b.star) continue;
    const surf = shipPos.distanceTo(b.position) - b.R - collisionRadius;
    if (!nearestRock || surf < nearestRock.surf) nearestRock = { ...b, surf };
  }
  if (nearestRock && nearestRock.surf < Math.max(3500, nearestRock.R * 2)) {
    dashboard.show('planet-near', {
      crew: CREW.navigator, urgency: 'info',
      text: `${nearestRock.kind === 'moon' ? 'Księżyc' : 'Planeta'} ${nearestRock.name}: ${fmtDist(Math.max(nearestRock.surf, 0))} j. od powierzchni.`,
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
    : speedCap < 1 || warpJam ? 'zakłócony'
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
let warpJam = false; // krok 9: zagłuszacz w pobliżu - fałda zablokowana, choć lot normalny
const playerState = {
  raceId: 'wybudzeni', hull: 100, maxHull: 100, armor: 5,
  cargo: 10, alive: true, damageFlash: 0, sinceHit: 99,
};
let playerStats = deriveStats('wybudzeni');

const combat = createCombat(scene);
// KROK 7: wspólny menedżer broni (gracz + NPC): pociski, promienie, cząstki
const weapons = createWeapons({
  scene, combat, camera,
  onFire: (id, origin, side) => gameAudio?.fire(id, origin, side),   // krok 9: dźwięk wystrzałów
  onBlast: (kind, p, size) => gameAudio?.blast(kind, p, size),
});
const playerProxy = {
  position: shipGroup.position,     // wektor "na żywo" - NPC czytają go co klatkę
  quaternion: shipGroup.quaternion,
  getVelocity: (out) => out.set(0, 0, -1).applyQuaternion(shipGroup.quaternion).multiplyScalar(shipState.speed),
  isAlive: () => playerState.alive && mode === 'lot', // krok 12: na mostku statek stoi w hangarze
  // krok 9: taktyczne AI ocenia, jak bardzo gracz jest ranny i jak duży
  getHullFrac: () => playerState.hull / playerState.maxHull,
  getRadius: () => collisionRadius,
};
combat.register({
  side: 'player',
  get position() { return shipGroup.position; },
  get radius() { return collisionRadius; },
  isAlive: () => playerState.alive && mode === 'lot',
  takeDamage: (amount, shooter) => damagePlayer(amount, shooter),
});

// KROK 9: mózg NPC (tactical-ai.js). ?trudnosc=latwa|normalna|trudna
const urlDifficulty = new URLSearchParams(location.search).get('trudnosc');
const tactics = createTactics({
  combat,
  difficulty: DIFFICULTY[urlDifficulty] ? urlDifficulty : 'normalna',
  onEvent: (e) => onTacticEvent(e),
});
const npcs = createNpcManager(scene, combat, playerProxy, {
  warp, weapons, tactics,
  // przeszkody do omijania: gwiazdy, planety, księżyce, planetoidy i gruz w pobliżu gracza
  getObstacles: () => collectSolidBodies(starSystem, debrisField, shipGroup.position)
    .concat(economy.solids()).concat(rival.solids()), // krok 10-11: NPC omijają planetoidy, stacje i placówki
  getContacts: () => economy.contacts().concat(rival.contacts()), // krok 10-11: drony, stacje, placówki ras w wojnie
});
const comms = createComms(document.getElementById('comms'));
const labels = createTargetLabels(document.getElementById('targets'), camera);
const encounters = createEncounters({
  // krok 9: reset scen nie zabiera watahy (skrzydłowi to NPC z tagiem 'pack')
  npcs: { ...npcs, clear: () => npcs.clear((n) => n.tag === 'pack') }, comms, dashboard, CREW,
  player: playerProxy, playerState,
  getStats: () => playerStats,
  setSpeedCap: (v) => { speedCap = v; },
});

const deathEl = document.getElementById('death');
const deathSubEl = document.querySelector('#death .death-sub');
let lastMissionAtDeath = null;
const damageEl = document.getElementById('damage');

function damagePlayer(amount, shooter) {
  if (!playerState.alive) return;
  if (playerWarp.ghost) return; // w fałdzie pociski przelatują przez "pustą" przestrzeń
  npcs.reportPlayerHit(shooter); // krok 9: osłona watahy wie, kto bije lidera
  // Pancerz = płaska redukcja (połowa wartości), minimum 1 obrażenia
  const dealt = Math.max(1, amount - playerState.armor * 0.5);
  playerState.hull = Math.max(0, playerState.hull - dealt);
  playerState.damageFlash = 1;
  playerState.sinceHit = 0;
  gameAudio?.playerHit(dealt);
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
  // krok 9: R = misja od nowa (jeśli była), N = tablica misji
  lastMissionAtDeath = missions.active ? missions.state.id : null;
  deathSubEl.textContent = lastMissionAtDeath ? 'R — misja od nowa · N — tablica misji' : 'R — odrodzenie · Tab — powrót na mostek';
  deathEl.classList.add('visible');
  gameAudio?.death();
}

function respawn() {
  playerWarp.abort();
  playerState.hull = playerState.maxHull;
  playerState.alive = true;
  shipGroup.visible = true;
  placeAtSpawn();
  if (typeof launchPose === 'function') launchPose(); // krok 12: nowy statek wylatuje z hangaru siedziby
  shipState.speed = 0;
  cameraRig.position.copy(shipGroup.position).add(cameraOffset);
  deathEl.classList.remove('visible');
  combat.clear();
  weapons.clear();
  arsenal.refill(); // pełny zapas rakiet, flar i zimne działka
  flares.refill();
  // krok 9: śmierć kończy misję; odrodzenie = ta sama misja od nowa (i wataha, jeśli była)
  const again = lastMissionAtDeath;
  const hadPack = wolfpack.active;
  missions.abort();
  encounters.reset();
  wolfpack.dismiss(true);
  npcs.clear();
  gameAudio?.respawn();
  if (again) startMission(again);
  if (hadPack && !wolfpack.active) wolfpack.spawn();
}

// ============================================================
// KROK 7: ARSENAŁ GRACZA
// ============================================================
// F / LPM / OGIEŃ (dotyk) - spust (trzymany). Q/E albo kółko myszy - zmiana
// broni, 5 - wybór bezpośredni po kolei (przycisk BROŃ na dotyku).
// KROK 9 (combat-rules.js): każda rasa ma własny zestaw broni; działka grzeją
// się (zależnie od poziomu trudności), rakiety/miny/impulsy mają zapas.
// Sokół i torpeda czekają na namiar (0,7 s), Grot i Salwa łapią cel przed
// dziobem od ręki. Flary wylatują same, gdy leci na nas wroga rakieta.
const fireInput = { held: false };
const arsenal = createPlayerArsenal({
  weapons,
  ship: shipGroup,
  getRadius: () => collisionRadius,
  getSpeed: () => shipState.speed,
  getTargets: () => npcs.hostiles(),
});
arsenal.on('overheat', () => dashboard.show('heat', {
  crew: CREW.engineer, urgency: 'danger', ttl: 3000,
  text: 'PRZEGRZANIE! Broń wstrzymana do schłodzenia (30%).',
}));
arsenal.on('cooled', () => dashboard.show('heat', {
  crew: CREW.engineer, urgency: 'info', ttl: 1800, text: 'Radiatory schłodzone. Broń gotowa.',
}));
arsenal.on('locked', (t) => dashboard.show('lock', {
  crew: CREW.tactical, urgency: 'info', ttl: 1600, text: `Namierzono: ${t.callsign}.`,
}));
arsenal.on('lost', ({ weapon }) => dashboard.show('lock', {
  crew: CREW.tactical, urgency: 'warning', ttl: 1800, text: `${WEAPONS[weapon]?.short ?? 'Rakieta'} zgubił cel.`,
}));
arsenal.on('salvo', ({ hits, total }) => dashboard.show('lock', {
  crew: CREW.tactical, urgency: hits ? 'info' : 'warning', ttl: 2000,
  text: hits ? `Salwa: ${hits} z ${total} w celu.` : 'Salwa chybiona.',
}));
arsenal.on('empty', (id) => dashboard.show('ammo', {
  crew: CREW.tactical, urgency: 'warning', ttl: 2200, text: `${WEAPONS[id].short}: zapas wyczerpany. Zmień broń (Q/E).`,
}));
arsenal.on('emp', ({ jammed = 0, broken = 0 }) => dashboard.show('ammo', {
  crew: CREW.tactical, urgency: 'info', ttl: 2400,
  text: jammed || broken ? `Impuls: zagłuszone działa ${jammed}, zerwany namiar ${broken} rakiet.` : 'Impuls w próżnię - nikogo w stożku.',
}));

// FLARY: wylatują same, gdy leci na nas wroga rakieta (zapas i skuteczność
// zależą od poziomu trudności, combat-rules.js)
const flares = createFlares({
  combat, weapons, ship: shipGroup, getVelocity: playerProxy.getVelocity,
  isActive: () => playerState.alive && !playerWarp.ghost,
});
flares.on('burst', ({ fooled, total, left }) => dashboard.show('flare', {
  crew: CREW.tactical, urgency: fooled === total ? 'info' : 'danger', ttl: 2000,
  text: `Rakieta na nas! Flary: ${fooled === total ? 'zmylona' : total > 1 ? `zmylone ${fooled} z ${total}` : 'nie dała się zmylić'}. Zostało ${left}.`,
}));
flares.on('empty', () => dashboard.show('flare', {
  crew: CREW.tactical, urgency: 'danger', ttl: 3000, text: 'Brak flar! Rakiety trzeba zgubić manewrem.',
}));

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') fireInput.held = true;
  if (e.code === 'KeyR' && !playerState.alive) respawn();
  const scene5 = { Digit7: 'ally', Digit8: 'intercept', Digit9: 'attack' }[e.code];
  if (scene5 && playerState.alive) { paradeQueue = []; missions.abort(); encounters.trigger(scene5); }
  if (e.code === 'Digit0' && playerState.alive) { paradeQueue = []; missions.abort(); encounters.startDemo(); }
  if (e.code === 'KeyJ' && !e.repeat) engageWarp();
  if (e.code === 'KeyK' && !e.repeat && playerState.alive) { missions.abort(); warpParade(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyF') fireInput.held = false; });
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyQ') arsenal.cycle(-1);
  if (e.code === 'KeyE') arsenal.cycle(1);
  if (e.code === 'Digit5') arsenal.cycle(1);
});
window.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > 4) arsenal.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
document.getElementById('touch-weapon')?.addEventListener('touchstart', (e) => { e.preventDefault(); arsenal.cycle(1); }, { passive: false });
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
  // w fałdzie nie strzelamy (statek jest "poza przestrzenią")
  arsenal.update(delta, fireInput.held, playerState.alive && !!flightProfile && !playerWarp.ghost);
  flares.update(delta);

  npcs.update(delta);
  combat.update(delta);
  weapons.update(delta);
  updateWeaponHud();
  encounters.update(delta);
  missions.update(delta);
  wolfpack.update();
  updateMissionHud();

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

  // krok 9: ukryci (zasadzka) nie mają etykiet; znaczniki misji dołączają do listy
  labels.update(npcs.list.filter((n) => n.alive && !n.hidden && !n.arriving && !n.stealth).map((n) => ({
    id: n.id,
    position: n.group.position,
    title: `${n.callsign} · ${n.raceName}`,
    sub: n.side === 'neutral' ? `fałda: ${n.warpName}`
      : `${n.label ?? (n.tag === 'pack' ? 'wataha' : n.side === 'ally' ? 'sojusznik' : 'wróg')} · ${n.disabled ? 'UNIERUCHOMIONY' : `${Math.round(n.hull / n.maxHull * 100)}%`}`,
    color: n.side === 'neutral' ? RACES[n.raceId].color : n.role === 'trader' && n.side === 'ally' ? '#ffd36b' : n.side === 'ally' ? '#4dd6a0' : '#ff5a4a',
  })).concat(missions.markers().map((m) => ({ id: `mk-${m.id}`, position: m.position, title: m.title, sub: m.sub, color: m.color })))
    .concat(economy.labelItems(shipGroup.position, _ecoFwd.set(0, 0, -1).applyQuaternion(shipGroup.quaternion))) // krok 10: stacje, złoże w celowniku
    .concat(rival.labelItems()).concat(fieldLabels())); // krok 11: placówki ras, nieznane sygnały, cel kursu
}

// ============================================================
// KROK 6: NAPĘD FAŁDOWY GRACZA
// ============================================================
// J / przycisk SKOK: 1,4 s ładowania (sterowanie działa, fałda podąża za
// dziobem), potem wślizg w fałdę, ~2 s przelotu i wyjście ~12 tys. j. dalej.
// Kurs jest skracany przed gwiazdami/planetą. Zakłócenie napędu wroga
// (scena przechwycenia) blokuje skok - to nie jest "przycisk ucieczki"
// od myta. Sojusznicy w eskorcie skaczą razem z graczem.
const WARP_DISTANCE = () => starSystem.warpDistance; // krok 8: zasięg skoku zależy od skali układu
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
  if (!playerState.alive || !flightProfile || mode !== 'lot') return;
  if (playerWarp.active) return;
  if (speedCap < 1 || warpJam) {
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'danger', ttl: 3000, text: 'Zakłócenie napędu! Fałda nie domknie się — skok niemożliwy.' });
    return;
  }
  if (playerWarp.cooldown > 0) {
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'warning', ttl: 2200, text: `Napęd fałdowy stygnie: ${Math.ceil(playerWarp.cooldown)} s.` });
    return;
  }
  const res = playerWarp.engage({
    distance: WARP_DISTANCE(),
    bodies: celestialSolids(),
    onDiveCb: () => { npcs.followJump(); missions.notePlayerWarp(); },
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
        shipId: shipForRace(raceId), mode: 'formation', offset,
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
  const key = playerWarp.active ? 'active' : cd > 0 ? `cd${cd}` : speedCap < 1 || warpJam ? 'jam' : 'ready';
  if (key === warpBtnKey) return;
  warpBtnKey = key;
  warpTouchBtn.classList.toggle('charging', playerWarp.active);
  warpTouchBtn.classList.toggle('cooling', cd > 0 || speedCap < 1 || warpJam);
  warpTouchBtn.textContent = playerWarp.active ? '···' : cd > 0 ? `${cd} s` : speedCap < 1 || warpJam ? 'BLOK' : 'SKOK';
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
// KROK 8: SKOK MIĘDZYGWIEZDNY I MAPA UKŁADÓW
// ============================================================
// U - skok do następnego układu, M - mapa (lista układów do kliknięcia),
// UKŁAD (dotyk) - następny układ. Skok idzie przez zwykłą sekwencję fałdy
// (dłuższy przelot), a świat jest podmieniany w połowie tunelu - niebo jest
// wtedy przygaszone, a obraz zalewają smugi, więc podmiana jest niewidoczna.
// Zakłócenie napędu blokuje również ten skok.
const systemNameEl = document.getElementById('system-name');
const mapEl = document.getElementById('system-map');

function swapSystem(id) {
  const old = starSystem;
  starSystem = createStarSystem(scene, id, { quality: QUALITY });
  old.dispose();
  background.reseed(starSystem.skySeed);
  debrisField.dispose();
  debrisField = createDebrisField(scene, starSystem.spawn.position.clone(), DEBRIS_OPTS);
  rival.clear(); // krok 11: placówki starego układu znikają (strategia pamięta stan)
  economy.enterSystem(id, starSystem.spawn); // krok 10: pas i stacje tego układu; poprzedni pracuje dalej "zaocznie"
  industryPanel.setOpen(false);
  waypoint = null;
  // wrogowie zostają w starym układzie (reżyser scen uzna to za ucieczkę)
  // krok 9: misja zostaje w starym układzie (poza pościgiem - tam skok = sukces)
  if (missions.active) {
    missions.abort();
    dashboard.show('mission-end', { crew: CREW.navigator, urgency: 'warning', ttl: 5000, text: 'Misja przerwana: opuściliśmy układ.' });
  }
  for (const n of [...npcs.list]) if (n.side === 'hostile' || n.stealth) npcs.remove(n);
  renderSystemUi();
}

function jumpToSystem(id) {
  if (!SYSTEMS[id] || id === starSystem.id) return;
  if (mode !== 'lot') { dashboard.show('warp', { crew: CREW.navigator, urgency: 'info', ttl: 3000, text: 'Skok międzygwiezdny — najpierw za stery (Tab).' }); return; }
  if (!playerState.alive || !flightProfile || playerWarp.active) return;
  if (speedCap < 1 || warpJam) {
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'danger', ttl: 3000, text: 'Zakłócenie napędu! Skok międzygwiezdny niemożliwy.' });
    return;
  }
  if (playerWarp.cooldown > 0) {
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'warning', ttl: 2200, text: `Napęd fałdowy stygnie: ${Math.ceil(playerWarp.cooldown)} s.` });
    return;
  }
  const res = playerWarp.engage({
    distance: 40000, bodies: [], transit: 3.4,
    onDiveCb: () => { npcs.followJump(); missions.notePlayerWarp(); },
    relocateCb: () => {
      army.beforeJump(id); // krok 11: eskorta leci z graczem, reszta floty zostaje
      swapSystem(id);
      const dir = starSystem.spawn.lookAt.clone().sub(starSystem.spawn.position).normalize();
      _spawnM.lookAt(starSystem.spawn.position, starSystem.spawn.lookAt, new THREE.Vector3(0, 1, 0));
      shipGroup.quaternion.setFromRotationMatrix(_spawnM);
      return { exit: starSystem.spawn.position, dir };
    },
    onArriveCb: () => {
      shipState.speed = Math.max(shipState.speed, flightProfile.maxSpeed * 1.5);
      npcs.arriveJump();
      dashboard.show('system', { crew: CREW.navigator, urgency: 'info', ttl: 6000, text: `Wejście do układu: ${starSystem.name}.` });
    },
  });
  if (res.ok) {
    mapEl.classList.remove('visible');
    stratMap.setOpen(false);
    dashboard.show('warp', { crew: CREW.engineer, urgency: 'info', ttl: 3000, text: `Kurs międzygwiezdny: ${SYSTEMS[id].name}. Ładowanie napędu…` });
  }
}

function nextSystemId() {
  return SYSTEM_ORDER[(SYSTEM_ORDER.indexOf(starSystem.id) + 1) % SYSTEM_ORDER.length];
}

function renderSystemUi() {
  systemNameEl.textContent = `Układ: ${starSystem.name}`;
  mapEl.innerHTML = '<div class="map-title">Mapa układów</div>';
  for (const id of SYSTEM_ORDER) {
    const b = document.createElement('button');
    b.className = 'map-item' + (id === starSystem.id ? ' here' : '');
    b.innerHTML = `<span class="map-name">${SYSTEMS[id].name}${id === starSystem.id ? ' — tu jesteś' : ''}</span><span class="map-desc">${SYSTEMS[id].desc}</span>`;
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', () => jumpToSystem(id));
    mapEl.appendChild(b);
  }
}
renderSystemUi();

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyU') jumpToSystem(nextSystemId());
  if (e.code === 'KeyM') stratMap.toggle(); // krok 11: mapa strategiczna zamiast listy układów
});
document.getElementById('touch-system')?.addEventListener('touchstart', (e) => { e.preventDefault(); jumpToSystem(nextSystemId()); }, { passive: false });

// ============================================================
// KROK 7: HUD UZBROJENIA
// ============================================================
// Pasek broni (dół ekranu), ciepło w telemetrii i znacznik namiaru
// rzutowany na cel. DOM aktualizowany tylko przy zmianie (nie co klatkę).
const weaponBar = document.getElementById('weapon-bar');
const heatEls = { bar: document.getElementById('tm-heat-bar'), text: document.getElementById('tm-heat-text') };
const lockEl = document.getElementById('lock-reticle');
const touchWeaponBtn = document.getElementById('touch-weapon');
const flareEl = document.getElementById('tm-flares');
let slotEls = {};
/** Pasek broni z zestawu rasy (krok 9) - budowany przy wczytaniu statku. */
function buildWeaponBar() {
  weaponBar.replaceChildren();
  slotEls = {};
  for (const id of arsenal.state.order) {
    const el = document.createElement('button');
    el.className = 'wslot';
    el.style.setProperty('--wc', `#${WEAPONS[id].color.toString(16).padStart(6, '0')}`);
    el.innerHTML = '<span class="wname"></span><span class="wdesc"></span><span class="wammo"></span>';
    el.querySelector('.wname').textContent = WEAPONS[id].name;
    el.querySelector('.wdesc').textContent = WEAPONS[id].desc;
    el.title = `${WEAPONS[id].name} — ${WEAPONS[id].desc}`; // pełna nazwa, gdy wąski slot ją ucina
    el.addEventListener('mousedown', (e) => e.stopPropagation()); // klik w pasek to nie strzał
    el.addEventListener('click', () => arsenal.select(id));
    weaponBar.appendChild(el);
    slotEls[id] = el;
  }
  hudKey = '';
}
let hudKey = '';
const _lockV = new THREE.Vector3();
function updateWeaponHud() {
  const st = arsenal.state;
  const ammoKey = st.ammo ? Object.values(st.ammo).join(',') : '';
  const key = `${st.weapon}|${st.raceId}|${st.overheated}|${ammoKey}|${flares.state.count}`;
  if (key !== hudKey) {
    hudKey = key;
    for (const id of Object.keys(slotEls)) {
      const el = slotEls[id];
      el.classList.toggle('active', id === st.weapon);
      el.classList.toggle('special', arsenal.isSpecial(id));
      const n = st.ammo?.[id];
      el.querySelector('.wammo').textContent = n == null ? '' : `${n}`;
      el.classList.toggle('empty', n === 0);
    }
    weaponBar.classList.toggle('overheated', st.overheated);
    const n = st.ammo?.[st.weapon];
    if (touchWeaponBtn) touchWeaponBtn.textContent = WEAPONS[st.weapon].short.toUpperCase() + (n == null ? '' : ` ${n}`);
    if (flareEl) {
      flareEl.textContent = `${flares.state.count} / ${flares.state.max}`;
      flareEl.classList.toggle('low', flares.state.count <= 2);
    }
  }
  heatEls.bar.style.width = `${st.heat.toFixed(1)}%`;
  heatEls.bar.classList.toggle('hot', st.heat > 70 || st.overheated);
  heatEls.text.textContent = st.overheated ? 'PRZEGRZANIE' : `${Math.round(st.heat)}%`;

  // znacznik namiaru: obracający się romb na celu, domyka się z postępem
  const L = st.lock;
  if (L.target && !renderer.xr.isPresenting) {
    _lockV.copy(L.target.group.position).project(camera);
    const onScreen = _lockV.z < 1 && Math.abs(_lockV.x) < 1.1 && Math.abs(_lockV.y) < 1.1;
    lockEl.style.display = onScreen ? 'block' : 'none';
    if (onScreen) {
      const x = (_lockV.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-_lockV.y * 0.5 + 0.5) * window.innerHeight;
      const size = 70 - 34 * L.progress;
      lockEl.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${45 + (1 - L.progress) * 90}deg)`;
      lockEl.style.width = lockEl.style.height = `${size}px`;
      lockEl.classList.toggle('locked', L.locked);
    }
  } else {
    lockEl.style.display = 'none';
  }
}

// ============================================================
// KROK 9: MISJE, WATAHA, TAKTYCZNE AI
// ============================================================
// N - tablica misji (klik = start), L - wataha (przyzwij/odpraw),
// G/H/V/B - rozkazy dla watahy. Mózgi NPC (tactical-ai.js) "szczekają"
// zdarzeniami (onTacticEvent): skrzydłowi watahy meldują przez dashboard,
// a misje dostają te same zdarzenia (np. wezwanie pomocy handlowca).
const wolfpack = createWolfpack({ npcs, tactics, player: playerProxy, playerState, dashboard, CREW });
const missions = createMissions({
  npcs, tactics, wolfpack, comms, dashboard, CREW, player: playerProxy, playerState, scene,
  getEconomy: () => economy, // misja "Obrona kopalni" (gospodarka powstaje niżej - odczyt leniwy)
  getStats: () => playerStats,
  // sygnatura z karty rasy; boost i ogień ją podbijają (blokada: zasięg wykrycia pikiet)
  getSignature: () => RACES[playerState.raceId].ship.signature * (lastInput?.boost ? 1.6 : 1) * (fireInput.held ? 1.25 : 1),
  setSpeedCap: (v) => { speedCap = v; },
  setWarpJam: (v) => { warpJam = v; },
});

const PACK_CREW = { role: 'Wataha', initial: 'W', color: '#4dd6a0' };
const barkCooldown = new Map();
const PACK_BARKS = {
  engage: (e) => e.npc.brain?.role === 'strike' && `${e.npc.callsign}: biorę ${e.target?.npc?.callsign ?? 'cel'}.`,
  cover: (e) => `${e.npc.callsign}: zdejmuję ${e.target?.npc?.callsign ?? 'go'} z ogona ${e.mate?.callsign ?? 'kolegi'}!`,
  shelter: (e) => `${e.npc.callsign}: ciężko trafiony, chowam się za tobą.`,
  evade: (e) => e.torpedo && `${e.npc.callsign}: torpeda! Rozchodzimy się!`,
  'pincer-in': (e) => `${e.npc.callsign}: na flance, wchodzę!`,
};
function onTacticEvent(e) {
  missions?.onTacticEvent(e);
  if (e.npc?.tag !== 'pack') return;
  const text = PACK_BARKS[e.type]?.(e);
  if (!text) return;
  const k = `${e.npc.id}-${e.type}`;
  const now = tactics.time;
  if (now - (barkCooldown.get(k) ?? -99) < 8) return;
  barkCooldown.set(k, now);
  dashboard.show(`bark-${e.npc.id}`, { crew: PACK_CREW, text, urgency: e.type === 'shelter' ? 'warning' : 'info', ttl: 2600 });
}

/** Cel dla rozkazu "atak na mój cel": namierzony, a bez namiaru - najbliższy przed dziobem. */
function playerFocusTarget() {
  const lockT = arsenal.state.lock.target;
  if (lockT?.alive) return lockT.contact;
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  let best = null, bestS = -Infinity;
  for (const n of npcs.hostiles()) {
    const d = n.group.position.clone().sub(shipGroup.position);
    const dist = d.length();
    const s = d.normalize().dot(f) * 2 - dist / 3000;
    if (s > bestS) { bestS = s; best = n; }
  }
  return best?.contact ?? null;
}

function packCommand(kind) {
  if (!playerState.alive) return;
  wolfpack.command(kind, kind === 'focus' ? playerFocusTarget() : null);
}

// Tablica misji jest osobną stroną (missions.html). N w grze wraca na nią z
// bieżącymi ustawieniami; w trakcie misji trzeba nacisnąć N dwa razy (żeby
// przypadkowe N nie przerwało walki).
let firstShipLoaded = false;
let leaveArmedUntil = 0;
function boardUrl() {
  const p = new URLSearchParams({ uklad: starSystem.id, trudnosc: DIFFICULTY[urlDifficulty] ? urlDifficulty : 'normalna', statek: SHIPS[Math.max(0, currentShipIndex)].id });
  const last = missions.state.id ?? urlMission;
  if (last) p.set('misja', last);
  if (wolfpack.active) p.set('wataha', '1');
  return `../missions.html?${p}`;
}
async function goToBoard() {
  if (missions.active && performance.now() > leaveArmedUntil) {
    leaveArmedUntil = performance.now() + 3000;
    dashboard.show('leave', { crew: CREW.navigator, urgency: 'warning', ttl: 3000, text: 'Misja trwa. N jeszcze raz — przerwij i wróć do tablicy misji.' });
    return;
  }
  getAudio().play('ui-back', { force: true });
  await getAudio().fadeOut(0.4);
  location.href = boardUrl();
}
/** Enter po zakończeniu misji: ta sama misja jeszcze raz */
function replayMission() {
  const st = missions.state;
  if (!st.id || st.status === 'active' || !playerState.alive) return;
  startMission(st.id);
}
function startMission(id) {
  if (!playerState.alive || !flightProfile || playerWarp.active) return;
  paradeQueue = [];
  encounters.reset();
  arsenal.refill();
  flares.refill();
  missions.start(id);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyN') goToBoard();
  if (e.code === 'Enter' || e.code === 'NumpadEnter') replayMission();
  if (e.code === 'KeyO') getAudio().toggleMute();
  if (e.code === 'KeyL' && playerState.alive) wolfpack.toggle();
  const ord = { KeyG: 'focus', KeyH: 'pincer', KeyV: 'cover', KeyB: 'regroup' }[e.code];
  if (ord) packCommand(ord);
});
document.getElementById('touch-missions')?.addEventListener('touchstart', (e) => {
  e.preventDefault();
  goToBoard(); // w trakcie misji - dwa dotknięcia (jak N)
}, { passive: false });
const ORDER_CYCLE = ['focus', 'pincer', 'cover', 'regroup'];
document.getElementById('touch-order')?.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const i = ORDER_CYCLE.indexOf(wolfpack.order);
  packCommand(ORDER_CYCLE[(i + 1) % ORDER_CYCLE.length]);
}, { passive: false });

// --- HUD misji i watahy (DOM zmieniany tylko przy zmianie treści) ---
const mEls = {
  root: document.getElementById('mission'), name: document.getElementById('mission-name'),
  obj: document.getElementById('mission-objective'), detail: document.getElementById('mission-detail'),
  bar: document.getElementById('mission-bar'), fill: document.getElementById('mission-fill'),
  pack: document.getElementById('pack'), orderBtn: document.getElementById('touch-order'),
};
let mKey = '', pKey = '';
function updateMissionHud() {
  const st = missions.state;
  const show = st.status !== 'idle';
  const key = `${show}|${st.status}|${st.name}|${st.objective}|${st.detail}|${st.result}|${st.progress == null ? '-' : st.progress.toFixed(2)}`;
  if (key !== mKey) {
    mKey = key;
    mEls.root.classList.toggle('visible', show);
    mEls.root.dataset.status = st.status;
    mEls.name.textContent = st.status === 'active' ? st.name : `${st.name} — ${st.status === 'success' ? 'ZALICZONA' : 'NIEUDANA'}`;
    mEls.obj.textContent = st.status === 'active' ? st.objective : st.result;
    mEls.detail.textContent = st.status === 'active' ? st.detail : 'Enter — jeszcze raz · N — tablica misji';
    mEls.bar.style.display = st.progress == null ? 'none' : '';
    mEls.fill.style.width = `${Math.round((st.progress ?? 0) * 100)}%`;
  }
  const members = wolfpack.members;
  const pk = wolfpack.active ? `${wolfpack.order}|${members.map((m) => `${m.callsign}:${Math.round(m.hull / m.maxHull * 20)}:${m.brain?.plan}:${m.brain?.role}`).join(',')}` : '';
  if (pk !== pKey) {
    pKey = pk;
    mEls.pack.classList.toggle('visible', wolfpack.active);
    if (mEls.orderBtn) mEls.orderBtn.style.display = wolfpack.active ? '' : 'none';
    if (wolfpack.active) {
      const PLAN = { engage: 'walczy', formation: 'w szyku', escortPos: 'osłania', evade: 'unik', search: 'szuka', disengage: 'odskok' };
      mEls.pack.innerHTML = `<div class="pk-title">WATAHA · ${PACK_ORDERS[wolfpack.order].name}</div>` + members.map((m) => {
        const hp = m.hull / m.maxHull;
        const what = m.brain?.plan === 'engage' && m.brain.role === 'flank' ? 'flanka' : (PLAN[m.brain?.plan] ?? '');
        return `<div class="pk-row"><span>${m.callsign}</span><span class="pk-plan">${what}</span><span class="pk-bar"><i style="width:${Math.round(hp * 100)}%;background:${hp < 0.3 ? '#ff4d4d' : '#4dd6a0'}"></i></span></div>`;
      }).join('') + '<div class="pk-keys">G atak · H kleszcze · V osłona · B szyk</div>';
    }
  }
}

// ============================================================
// KROK 10: EKONOMIA - wydobycie, stacje, roje dronów
// ============================================================
// Cała gospodarka (stan, rynek, budowy, logistyka, drony, zapis) siedzi w
// shared/systems/economy.js; tu tylko klej ze statkiem gracza:
//   T (przytrzymaj) - promień wydobywczy w planetoidę przed dziobem
//   Y               - rozładunek w najbliższej stacji / na placu budowy
//   P               - panel przemysłu (budowa, stacje, roje, rynek)
// Ładownia = statystyka "ładunek" rasy x 5 t (races.js). "Ładunek" z misji
// (myto, nagrody) to osobna rzecz i zostaje w telemetrii jak w kroku 9.
// Stan zapisuje się w przeglądarce (localStorage) co 10 s i przy zmianach.
const safeStorage = (() => {
  try { const k = '__tb'; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; } catch { return null; }
})();
// krok 11: rasa gracza znana z adresu (statek z tablicy misji) - osobna
// kampania (zapis) dla każdej rasy
const PLAYER_RACE0 = raceForShip(SHIPS[urlShipIndex].id);
const economy = createEconomy({
  scene, storage: safeStorage, quality: QUALITY,
  fieldsFor: (id, sp) => generateFields(id, sp), saveKey: `teegarden-b.dowodztwo.v1.${PLAYER_RACE0}`, // krok 12: osobna kampania (z siedzibą)
  combat, getHostiles: () => npcs.hostiles(), // drony/stacje w walce, platformy strzelają do wrogów
  onEvent: (e) => dashboard.show(`eco-${e.key}`, {
    crew: CREW.quartermaster, urgency: e.urgency, ttl: e.urgency === 'info' ? 5500 : 7000, text: e.text,
  }),
});
economy.enterSystem(starSystem.id, starSystem.spawn);

// RABUSIE (shared/systems/raids.js): zagrożenie rośnie z liczbą dronów i
// obrotem; nalot w układzie gracza = ostrzeżenie, potem prawdziwe wrogie NPC
// polujące na drony i stacje. W trakcie misji nalot czeka.
const raids = createRaids({
  economy, npcs, rng: Math.random, pirateScale: 0.35, // krok 11: głównym zagrożeniem są rasy
  canRaid: () => !missions.active && playerState.alive && !playerWarp.active,
  systemName: (id) => SYSTEMS[id]?.name ?? id,
  playerRaceId: () => playerState.raceId,
  onEvent: (e) => dashboard.show(`raid-${e.key}`, {
    crew: e.key.startsWith('raid-off') || e.key === 'raid-end' ? CREW.quartermaster : CREW.tactical,
    urgency: e.urgency, ttl: e.ttl ?? 7000, text: e.text,
  }),
});
economy.hooks.towerFire = (st, p) => gameAudio?.fire('pulse', p.clone(), 'ally');

// ŚWIATŁO GWIAZDY NAD PASEM. Punktowe światła gwiazd gasną z kwadratem
// odległości (patrz README kroku 4) i na dystansie pasa planetoid (dziesiątki
// tysięcy j.) nie oświetlają już prawie niczego - skały i stacje byłyby czarnymi
// sylwetkami. Kierunkowe światło "z najbliższej gwiazdy" daje im dzień i noc
// po właściwej stronie, a statkowi gracza tę samą, spójną stronę dzienną.
const starlight = new THREE.DirectionalLight(0xffeedd, 1.6);
scene.add(starlight, starlight.target);
const _sl = new THREE.Vector3();
function updateStarlight() {
  let star = null, best = Infinity;
  for (const b of starSystem.bodies) {
    if (!b.star) continue;
    const d = b.position.distanceToSquared(shipGroup.position) / (b.R * b.R);
    if (d < best) { best = d; star = b; }
  }
  if (!star) return;
  _sl.copy(shipGroup.position).sub(star.position).normalize();
  starlight.target.position.copy(shipGroup.position);
  starlight.position.copy(shipGroup.position).addScaledVector(_sl, -3000);
}

const _ecoFwd = new THREE.Vector3();
const _ahead = new THREE.Vector3();
/** Punkt przed dziobem, w którym stawiamy stację (i kierunek dziobu). */
function shipAhead() {
  _ecoFwd.set(0, 0, -1).applyQuaternion(shipGroup.quaternion);
  _ahead.copy(shipGroup.position).addScaledVector(_ecoFwd, PLAYER_MINING.placeAhead + collisionRadius);
  return { position: shipGroup.position, forward: _ecoFwd, ahead: _ahead };
}
const holdCapacity = () => RACES[playerState.raceId].ship.cargo * PLAYER_MINING.holdPerCargo;
// krok 12: na mostku panel Przemysł stawia stacje w wolnym miejscu przy siedzibie, nie "przed dziobem" statku w hangarze
let spotCache = { t: -99, p: null };
function panelShip() {
  const home = economy.state.command?.home;
  if (mode === 'lot' || !home || economy.systemId !== home) return shipAhead();
  if (economy.state.time - spotCache.t > 1.5 || !spotCache.p) spotCache = { t: economy.state.time, p: economy.findSpot('stocznia', command.frame().pos, { from: 1300, to: 5200 }) };
  const sh = shipAhead();
  return { position: sh.position, forward: sh.forward, ahead: spotCache.p ?? sh.ahead };
}

// ============================================================
// KROK 11: DOMINACJA - strategia ras, placówki, armia, mapa, dyplomacja
// ============================================================
const sysName = (id) => SYSTEMS[id]?.name ?? id;
const fieldCenter = (fid) => { const c = strategy.defs.get(fid).center; return new THREE.Vector3(c.x, c.y, c.z); };

/** Pola, na których gracz ma gotową stację (we wszystkich odwiedzonych układach). */
function playerFieldIds() {
  const out = new Set();
  for (const sys of economy.systemIds()) {
    for (const st of economy.stationsIn(sys)) {
      if (st.status !== 'gotowa') continue;
      const f = economy.fieldAt(sys, st.pos);
      if (f) out.add(f.id);
    }
  }
  // krok 12: pole macierzyste należy do siedziby (stoi przed pasem, poza jego obrysem)
  const home = economy.state.command?.home;
  if (home) out.add(economy.fieldDefs(home)[0].id);
  return [...out];
}
const towersIn = (sysId, pos = null, r = Infinity) => economy.stationsIn(sysId)
  .filter((s) => s.type === 'wieza' && s.status === 'gotowa' && (!pos || Math.hypot(s.pos.x - pos.x, s.pos.y - pos.y, s.pos.z - pos.z) < r)).length;

const strategy = createStrategy({
  economy, playerRace: PLAYER_RACE0, systems: SYSTEM_ORDER, spawnOf,
  seed: 1 + SYSTEM_ORDER.indexOf(initialSystem) * 13 + PLAYER_RACE0.length,
  hooks: {
    playerFieldIds,
    playerPower: () => army.power() + economy.systemIds().reduce((a, s) => a + towersIn(s) * 1.5, 0) + playerFieldIds().length * 0.5,
    playerFieldDefense: (fid) => 1 + army.fieldDefense(fid) + towersIn(strategy.systemOf(fid), strategy.defs.get(fid).center, strategy.defs.get(fid).radius + 3000) * 2,
    attackPlayer: ({ faction, field, power }) => raids.launch({
      sysId: strategy.systemOf(field), raceId: faction, factionKey: rulingFaction(faction), n: Math.max(2, Math.min(8, power)),
      target: strategy.defs.get(field).center, defense: army.fieldDefense(field),
      onEnd: (res) => {
        strategy.shipLost(faction, res.kills);
        strategy.state.log.unshift({ t: strategy.state.time, faction, kind: 'war',
          text: `${RACES[faction].name} atakowali ${strategy.defs.get(field).name}: zniszczone ich okręty ${res.kills}/${res.n}, nasze straty: drony ${res.dronesLost}, metal ${Math.round(res.stolen)} t.` });
      },
    }),
    systemName: sysName,
  },
  onEvent: onStrategyEvent,
});
strategy.ensure(initialSystem);

// gospodarka pyta strategię: cudze pole = nie budujemy; drony nie kopią u sąsiada w czasie pokoju
economy.hooks.canBuildAt = (pos) => {
  const f = economy.fieldAt(economy.systemId, pos);
  const o = f && strategy.foreignOwner(f.id);
  return o ? { ok: false, why: `${f.name} należy do rasy ${RACES[o].name}. Zdobądź pole (wojna, flota) albo buduj gdzie indziej.` } : { ok: true };
};
economy.hooks.canMineField = (fid) => { const o = strategy.foreignOwner(fid); return !o || strategy.atWar(PLAYER, o); };
economy.hooks.minedInField = (fid, t) => strategy.poached(fid, t);
economy.hooks.discovered = (def) => {
  const o = strategy.ownerOf(def.id);
  const stars = '★'.repeat(Math.max(1, Math.min(5, Math.round(fieldValue(def) * 2))));
  dashboard.show(`found-${def.id}`, { crew: CREW.sensors, urgency: 'info', ttl: 8000,
    text: `Nowe pole surowcowe: ${def.name} — ${ARCHETYPES[def.kind].label}, wartość ${stars}. ${o && o !== PLAYER ? `Należy do rasy ${RACES[o].name}.` : 'Wolne — można budować.'}` });
  getAudio().play?.('ui-confirm');
};

const rival = createRivalPresence({ scene, economy, strategy, combat, npcs, player: playerProxy, onEvent: onRivalEvent, quality: QUALITY });
const army = createArmy({
  economy, strategy, npcs, player: playerProxy, playerRace: () => playerState.raceId,
  modelFor: (cls) => warshipModel(playerState.raceId, cls).id,
  mods: () => ({ power: command.mult('flota-dziala'), hull: command.mult('flota-kadlub') }), // krok 12: ulepszenia floty
  onEvent: (e) => dashboard.show(`army-${e.key}`, { crew: e.faction ? factionCrew(e.faction) : CREW.tactical, urgency: e.urgency, ttl: 7000, text: e.text }),
});
const armyTab = createArmyTab({ army, strategy, economy, playerRace: () => playerState.raceId, systemName: sysName });

const industryPanel = createEconomyPanel(document.getElementById('industry'), {
  economy, raids, getShip: () => panelShip(), getSystemName: () => starSystem.name,
  stationTypes: STATION_ORDER, extraTabs: [armyTab],
});

let waypoint = null; // pole wybrane na mapie (znacznik celu na ekranie)
const stratMap = createStrategicMap(document.getElementById('strat-map'), {
  strategy, economy, army, systems: SYSTEM_ORDER, systemName: sysName,
  currentSystem: () => starSystem.id, shipPos: () => shipGroup.position, playerRace: () => playerState.raceId,
  onJump: (id) => jumpToSystem(id),
  onWaypoint: (fid) => { waypoint = fid; },
});

// --- portrety: załoga gracza (jego rasa) i rozmówcy z innych ras ---
const portraitCache = new Map();
function portraitOf(raceId, seed, size = 34, faction = 'trade') {
  const k = `${raceId}|${seed}|${size}|${faction}`;
  if (!portraitCache.has(k)) portraitCache.set(k, racePortrait(raceId, { seed, faction, size, frame: true }));
  return portraitCache.get(k);
}
function applyCrewPortraits(raceId) {
  const seeds = { navigator: 11, sensors: 23, engineer: 37, tactical: 51, quartermaster: 67 };
  for (const [role, seed] of Object.entries(seeds)) { CREW[role].portrait = portraitOf(raceId, seed); CREW[role].key = raceId; }
}
applyCrewPortraits(PLAYER_RACE0);
const factionCrews = new Map();
function factionCrew(raceId) {
  if (!factionCrews.has(raceId)) factionCrews.set(raceId, {
    role: `${RACES[raceId].name} · ${strategy.factionName(raceId)}`, initial: RACES[raceId].name[0], color: RACES[raceId].color,
    portrait: portraitOf(raceId, 5, 34, rulingFaction(raceId)), key: raceId,
  });
  return factionCrews.get(raceId);
}

// --- wydarzenia strategii: wieści, wojny, propozycje, zwycięstwo ---
function onStrategyEvent(e) {
  if (e.type === 'news') {
    // w alertach tylko to, co dzieje się tutaj; reszta sektora - Kronika na mapie (M)
    if (!e.field || strategy.systemOf(e.field) !== starSystem.id) return;
    dashboard.show(`news-${strategy.state?.time ?? 0}-${e.faction ?? ''}`, { crew: e.faction ? factionCrew(e.faction) : CREW.navigator, urgency: 'info', ttl: 6500, text: e.text });
  } else if (e.type === 'war' || e.type === 'peace') {
    const f = e.faction;
    const mine = e.a === PLAYER || e.b === PLAYER;
    const near = [e.a, e.b].some((r) => r !== PLAYER && strategy.bySystem.get(starSystem.id).some((fid) => strategy.ownerOf(fid) === r));
    if (!mine && !near) return; // odległe spory ras: Kronika
    dashboard.show(`dip-${e.type}-${f}`, { crew: factionCrew(f), urgency: e.type === 'war' ? 'danger' : 'info', ttl: 9000, text: e.text });
    if (e.a === PLAYER || e.b === PLAYER) {
      comms.say({ sender: `${RACES[f].name} · ${strategy.factionName(f)}`, sub: e.type === 'war' ? 'WOJNA' : 'POKÓJ', color: RACES[f].color,
        portrait: portraitOf(f, 5, 56, rulingFaction(f)), ttl: 7,
        text: e.type === 'war' ? (RACES[f].voice?.attack ?? e.text) : (RACES[f].voice?.retreat ?? e.text) });
      getAudio().play?.(e.type === 'war' ? 'alarm-hull' : 'ui-confirm');
    }
  } else if (e.type === 'proposal') {
    const p = e.proposal, f = p.faction;
    const yes = p.kind === 'demand' ? `Zapłać ${p.amount} kr` : p.kind === 'peace' ? 'Przyjmij pokój' : p.kind === 'alliance' ? 'Zawrzyj sojusz' : 'Zawrzyj pakt';
    comms.open({
      sender: `${RACES[f].name} · ${strategy.factionName(f)}`, sub: p.kind === 'demand' ? 'żądanie' : 'propozycja', color: RACES[f].color,
      portrait: portraitOf(f, 5, 56, rulingFaction(f)), text: p.text,
      choices: [
        { label: yes, hint: `relacja ${Math.round(strategy.rel(PLAYER, f))}`, onChoose: () => strategy.answer(p.id, true) },
        { label: p.kind === 'demand' ? 'Odmów' : 'Odrzuć', hint: p.kind === 'demand' ? 'ryzyko wojny' : '', onChoose: () => strategy.answer(p.id, false) },
      ],
    });
  } else if (e.type === 'victory') {
    const v = document.getElementById('victory');
    v.querySelector('.v-sub').textContent = e.text;
    v.classList.add('visible');
    getAudio().play?.('ui-confirm');
  }
}
function onRivalEvent(e) {
  if (e.type === 'territory') {
    const f = e.faction, def = strategy.defs.get(e.fid), st = strategy.stance(PLAYER, f), r = strategy.rel(PLAYER, f);
    const text = st === 'wojna' ? `Wleciałeś na ${def.name}. Nasze wieże już cię widzą.`
      : ['pakt', 'sojusz'].includes(st) ? `Witaj na polu ${def.name}, partnerze. Kopanie tutaj zostawiamy nam, ale przelot wolny.`
      : r < 0 ? `${def.name} to nasza strefa. Każda tona wykopana tutaj to kradzież — i tak ją policzymy.`
      : `Pole ${def.name} należy do nas. Przelot wolny, wydobycie — nie.`;
    comms.say({ sender: `${RACES[f].name} · placówka ${def.name}`, sub: st === 'wojna' ? 'WOJNA' : 'terytorium', color: RACES[f].color,
      portrait: portraitOf(f, 9, 56, rulingFaction(f)), text, ttl: 6 });
    return;
  }
  dashboard.show(`rival-${e.key}`, { crew: e.faction ? factionCrew(e.faction) : CREW.tactical, urgency: e.urgency ?? 'info', ttl: 7000, text: e.text });
}

/** Etykiety: sygnały nieodkrytych pól (kierunek dla eksploracji) i cel kursu z mapy. */
const _fl = new THREE.Vector3();
function fieldLabels() {
  const out = [];
  for (const def of economy.fieldDefs(starSystem.id)) {
    const known = economy.isDiscovered(starSystem.id, def.id);
    if (!known) out.push({ id: `sig-${def.id}`, position: _fl.set(def.signal.x, def.signal.y, def.signal.z).clone(), title: 'Sygnał: nieznane złoże', sub: 'podleć bliżej', color: '#8fd3ff' });
    if (waypoint === def.id) out.push({ id: 'waypoint', position: fieldCenter(def.id).add(_fl.set(0, def.radius * 0.4, 0)), title: `◎ CEL: ${known ? def.name : 'nieznane złoże'}`, sub: 'kurs z mapy', color: '#ffd36b' });
  }
  return out;
}

const SENSOR_RANGE = 9000;
let scanT = 0;
function updateDominion(delta) {
  strategy.update(delta);
  rival.update(delta);
  army.update(delta);
  stratMap.update(delta);
  scanT -= delta;
  if (scanT <= 0) {
    scanT = 0.5;
    if (playerState.alive && mode === 'lot') economy.scan(shipGroup.position, SENSOR_RANGE * (1 + 0.08 * (playerStats.attrs.sensors - 5)));
    if (waypoint && fieldCenter(waypoint).distanceTo(shipGroup.position) < strategy.defs.get(waypoint).radius + 800) waypoint = null; // cel osiągnięty
  }
}


const mining = { held: false, touch: false, last: null };
function unloadNearby() {
  const st = economy.nearestStation(shipGroup.position);
  if (!st) {
    dashboard.show('eco-unload', { crew: CREW.quartermaster, urgency: 'info', ttl: 2500, text: 'Brak stacji w zasięgu dokowania. Podleć bliżej (etykiety stacji na ekranie).' });
    return null;
  }
  return economy.unloadAt(st);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyT') mining.held = true;
  if (e.repeat) return;
  if (e.code === 'KeyY' && playerState.alive) unloadNearby();
  if (e.code === 'KeyP') industryPanel.toggle();
  if (e.code === 'Escape' && industryPanel.open) industryPanel.setOpen(false);
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyT') mining.held = false; });
const touchMine = document.getElementById('touch-mine');
if (touchMine) {
  const on = (v) => (e) => { e.preventDefault(); mining.touch = v; };
  touchMine.addEventListener('touchstart', on(true), { passive: false });
  touchMine.addEventListener('touchend', on(false), { passive: false });
  touchMine.addEventListener('touchcancel', on(false), { passive: false });
}

// --- HUD przemysłu (prawy dolny róg) ---
const ecoEls = {
  root: document.getElementById('eco-hud'), credits: document.getElementById('eco-credits'), income: document.getElementById('eco-income'),
  holdBar: document.getElementById('eco-hold-bar'), holdText: document.getElementById('eco-hold-text'),
  drones: document.getElementById('eco-drones'), prompt: document.getElementById('eco-prompt'),
  raid: document.getElementById('eco-raid'), raidText: document.getElementById('eco-raid-text'), threat: document.getElementById('eco-threat'),
};
ecoEls.holdBar.innerHTML = METAL_ORDER.map((m) => `<i data-m="${m}" style="background:${METALS[m].color}"></i>`).join('');
ecoEls.prompt.addEventListener('click', () => { if (ecoEls.prompt.dataset.act === 'unload') unloadNearby(); });
document.getElementById('eco-open')?.addEventListener('click', () => industryPanel.toggle());
for (const el of [ecoEls.root]) el.addEventListener('mousedown', (e) => e.stopPropagation());
let ecoHudTimer = 0;
const TOUCH = matchMedia('(pointer: coarse)').matches; // podpowiedzi: przyciski zamiast klawiszy
const _beamFrom = new THREE.Vector3();
const fmtKr = (n) => Math.round(n).toLocaleString('pl-PL');

function updateEconomy(delta) {
  updateStarlight();
  updateDominion(delta);
  economy.update(delta, camera);
  command.update(delta); // krok 12: hangar, wyprawy, huta, badania
  raids.update(delta);
  updateRaidDecision();
  const alive = playerState.alive && !!flightProfile && !playerWarp.controlsLocked;
  const cap = holdCapacity();
  const sh = shipAhead();
  // promień wychodzi spod dziobu, nie ze środka statku - z kamery pościgowej
  // promień dokładnie na osi celowania chowałby się za kadłubem
  _beamFrom.set(0, -collisionRadius * 0.45, -collisionRadius * 0.8).applyQuaternion(shipGroup.quaternion).add(shipGroup.position);
  mining.last = economy.playerMine(delta, shipGroup.position, sh.forward, cap, alive && mode === 'lot' && (mining.held || mining.touch), _beamFrom);
  industryPanel.update(delta);

  ecoHudTimer -= delta;
  if (ecoHudTimer > 0) return;
  ecoHudTimer = 0.15;
  const s = economy.summary();
  ecoEls.credits.textContent = fmtKr(s.credits);
  ecoEls.income.textContent = s.income > 0 ? `+${fmtKr(s.income)} kr/min` : '';
  const held = METAL_ORDER.reduce((a, m) => a + s.hold[m], 0);
  for (const i of ecoEls.holdBar.children) i.style.width = `${(s.hold[i.dataset.m] / cap) * 100}%`;
  ecoEls.holdText.textContent = `${Math.round(held)} / ${cap} t`;
  const d = s.drones;
  ecoEls.drones.textContent = d.total
    ? `Drony: ${d.total} · wierci ${d.wiercenie} · w drodze ${d.lot + d.powrot}${d.czeka ? ` · czeka ${d.czeka}` : ''}`
    : (s.offlineDrones ? `Drony w innych układach: ${s.offlineDrones}` : 'Brak dronów — dok roju w panelu P');

  // podpowiedź kontekstowa: rozładunek > kopanie > co dalej
  const near = economy.nearestStation(shipGroup.position);
  let prompt = '', act = '';
  if (near && held > 0.5) { prompt = `${TOUCH ? 'Dotknij, by rozładować' : 'Y — rozładuj'}: ${near.name}${near.status === 'budowa' ? ' (plac budowy)' : ''}`; act = 'unload'; }
  else if (mining.last?.full) prompt = 'Ładownia pełna — leć do stacji albo placu budowy';
  else if (mining.last) prompt = `Wydobycie: ${mining.last.asteroid.name}`;
  else {
    const a = economy.aimedAsteroid(shipGroup.position, sh.forward, PLAYER_MINING.range);
    if (a && !a.depleted) prompt = `${TOUCH ? 'KOP' : 'T'} — kop: ${a.name}`;
    else if (!economy.stations().length && held >= 20) prompt = TOUCH ? 'Panel — postaw magazyn, potem rozładuj przy placu' : 'P — postaw magazyn, potem Y przy placu budowy';
    else if (!economy.stations().length) prompt = `Leć do pasa planetoid i wceluj w skałę (${TOUCH ? 'KOP' : 'T'})`;
  }
  ecoEls.prompt.textContent = prompt;
  ecoEls.prompt.dataset.act = act;
  ecoEls.prompt.hidden = !prompt;
  ecoEls.root.classList.toggle('mining', !!mining.last && !mining.last.full);

  // krok 11: dominacja w sektorze i flota
  const dom = document.getElementById('eco-dom');
  if (dom) dom.innerHTML = `Sektor: <b>${strategy.fieldsOf(PLAYER).length}</b> pól · <b>${Math.round(strategy.share(PLAYER) * 100)}%</b> · flota <b>${army.ships.length}</b>${Object.keys(strategy.state.factions).some((f) => strategy.atWar(PLAYER, f)) ? ' · <span style="color:#ff8a7a">WOJNA</span>' : ''}`;

  // nalot: pasek zagrożenia, a w trakcie - stan walki
  const r = raids.status;
  const threat = raids.threat();
  ecoEls.raid.dataset.phase = r ? r.phase : threat > 0.66 ? 'high' : 'calm';
  ecoEls.raid.hidden = !r && !economy.stations().length;
  ecoEls.threat.style.width = `${Math.round((r ? 1 : threat) * 100)}%`;
  ecoEls.raidText.textContent = !r
    ? `Zagrożenie nalotem: ${Math.round(threat * 100)}%`
    : r.phase === 'warning'
      ? `NALOT za ${Math.ceil(r.t)} s · ${r.n} rabusiów`
      : `${r.attacker ? `ATAK: ${RACES[r.attacker].name}` : 'NALOT'}: ${r.alive}/${r.n} · zestrzeleni ${r.kills} · stracone drony ${r.dronesLost}${r.stolen > 0.5 ? ` · zrabowano ${Math.round(r.stolen)} t` : ''}`;
}

// ============================================================
// KROK 12: DOWÓDZTWO - mostek siedziby, wyprawy, decyzje, tryby gry
// ============================================================
// Siedziba rasy (command.js) stoi przed polem macierzystym układu startowego.
// Na mostku gracz tylko klika: rozkazy wypraw, hangar, moduły, nauka,
// ulepszenia (command-panel.js). Decyzje wyskakują w kartach (decisions.js)
// i same wybierają domyślną odpowiedź, gdy gracz jej nie da. Walka to wybór:
// "Poślij flotę" (podgląd zdalny) albo "Za stery" (lot myśliwcem z hangaru).
const decisions = createDecisions(document.getElementById('decisions'), {
  onShow: (d) => getAudio().play?.(d.urgency === 'danger' ? 'ui-confirm' : 'ui-hover', { force: true }),
  onPick: () => getAudio().play?.('ui-click'),
});
const command = createCommand({
  economy, combat, getHostiles: () => npcs.hostiles(), hqName: 'Siedziba',
  onEvent: (e) => dashboard.show(`cmd-${e.key}`, { crew: CREW.quartermaster, urgency: e.urgency, ttl: e.urgency === 'info' ? 5000 : 7000, text: e.text }),
  onDecision: (d) => decisions.ask(d),
});
// kampania bez siedziby: zakładamy ją w układzie startowym; z zapisem - wracamy do jej układu
if (!command.state.home) command.found();
else if (command.state.home !== starSystem.id && !urlMission) { swapSystem(command.state.home); placeAtSpawn(); }
command.hooks.guardFire = (e, p) => gameAudio?.fire('pulse', p.clone(), 'ally');
command.hooks.fleet = (fid) => sendFleet(fid);
command.hooks.result = (r) => commandPanel.result(r);

const commandView = createCommandView({
  scene, renderer, camera, cameraRig, command, economy, background, quality: QUALITY,
  pipEl: document.getElementById('pip'), pipLabel: document.querySelector('#pip .pip-label'),
});
const commandPanel = createCommandPanel(document.getElementById('command'), {
  command, economy, strategy, army, raids, playerRace: () => playerState.raceId, systemName: sysName,
  onPilot: () => takeHelm(),
  onMap: () => stratMap.toggle(),
  onIndustry: (tab) => industryPanel.show(tab),
  onFleet: (fid, o) => sendFleet(fid, o),
  onWatch: (e) => watchExpedition(e),
  onHover: (id) => { hoverTarget = id; },
});

// cel z listy wyprawy (najechany albo wybrany) - pierścień nad skałą / złożem w widoku z mostka
let hoverTarget = null;
const aimEl = document.getElementById('aim-mark');
const _aim = new THREE.Vector3();
function updateAimMark() {
  const id = hoverTarget ?? commandPanel.picker?.target;
  const home = command.state.home;
  if (mode !== 'mostek' || !id || economy.systemId !== home) { aimEl.hidden = true; return; }
  const a = economy.asteroidsIn(home).find((x) => x.id === id);
  const f = !a && economy.fieldDefs(home).find((d) => d.id === id);
  if (!a && !f) { aimEl.hidden = true; return; }
  _aim.copy(a ? a.position : f.center);
  const dist = _aim.distanceTo(camera.getWorldPosition(_bp));
  _aim.project(camera);
  if (_aim.z > 1 || Math.abs(_aim.x) > 1.2 || Math.abs(_aim.y) > 1.2) { aimEl.hidden = true; return; }
  aimEl.hidden = false;
  aimEl.style.transform = `translate(${(_aim.x * 0.5 + 0.5) * innerWidth}px, ${(0.5 - _aim.y * 0.5) * innerHeight}px)`;
  const px = ((a ? a.radius * 1.5 : 1600) / dist) * (innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  aimEl.style.setProperty('--s', `${Math.max(26, Math.min(220, px * 2))}px`);
  const label = a ? `${a.name}${command.surveyed(a.id) ? ` · kl. ${a.cls}` : ' · niezbadana'}` : 'nieznane złoże';
  if (aimEl.lastChild.textContent !== label) aimEl.lastChild.textContent = label;
}

// --- tryby gry ---
const homeFieldId = () => (command.state.home ? economy.fieldDefs(command.state.home)[0].id : null);
const inHome = () => economy.systemId === command.state.home;
const UP = new THREE.Vector3(0, 1, 0);
/** Statek przed wylotem hangaru siedziby, dziobem w stronę pasa. */
function launchPose() {
  const f = command.frame();
  if (!f || !inHome()) return false;
  shipGroup.position.copy(command.launchPos()).addScaledVector(f.fwd, collisionRadius * 3);
  _spawnM.lookAt(shipGroup.position, shipGroup.position.clone().add(f.fwd), UP);
  shipGroup.quaternion.setFromRotationMatrix(_spawnM);
  return true;
}
function setMode(m, { intro = false } = {}) {
  const prev = mode;
  mode = m;
  for (const k of ['mostek', 'lot', 'podglad']) document.body.classList.toggle(`mode-${k}`, m === k);
  if (m === 'lot') {
    if (prev !== 'lot' || intro) {
      if (!playerState.alive) respawn();
      launchPose();
      // hangar naprawia i dozbraja; ulepszenia myśliwca z siedziby
      playerState.maxHull = Math.round(playerStats.hull * command.mult('mysliwiec-oslony'));
      playerState.hull = playerState.maxHull;
      arsenal.state.damageMult = playerStats.damageMult * command.mult('mysliwiec-dziala');
      shipState.speed = flightProfile ? flightProfile.maxSpeed * 0.6 : 0;
      desiredCamPos.copy(cameraOffset).applyQuaternion(shipGroup.quaternion).add(shipGroup.position);
      cameraRig.position.copy(desiredCamPos);
      cameraRig.quaternion.copy(shipGroup.quaternion);
    }
    shipGroup.visible = playerState.alive;
  } else {
    // w hangarze: statek schowany, nieruchomy, poza walką (playerProxy.isAlive)
    if (inHome()) shipGroup.position.copy(command.hangarPos());
    shipGroup.visible = false;
    shipState.speed = 0;
    industryPanel.setOpen(false);
  }
  if (m !== 'podglad') commandView.stopSpectate();
  if (m === 'mostek' && (prev !== 'mostek' || intro)) {
    commandView.startIntro(intro ? { dur: 6 } : { dur: 2.4, from: { pos: cameraRig.position.clone(), quat: cameraRig.quaternion.clone() } });
    if (intro) showIntroTitle();
  }
}
for (const k of ['mostek', 'lot', 'podglad']) document.body.classList.toggle(`mode-${k}`, mode === k); // od razu, zanim wczyta się statek
if (mode === 'mostek') document.body.classList.add('intro');
const fadeEl = document.getElementById('fade');
function fadeThen(fn, hold = 450) {
  fadeEl.classList.add('on');
  setTimeout(() => { fn(); setTimeout(() => fadeEl.classList.remove('on'), 60); }, hold);
}
/** Za sterami: wylot myśliwcem z hangaru siedziby. */
function takeHelm() {
  if (mode === 'lot') return;
  getAudio().play?.('ui-confirm', { force: true });
  fadeThen(() => {
    setMode('lot');
    dashboard.show('helm', { crew: CREW.navigator, urgency: 'info', ttl: 5000, text: 'Wylot z hangaru. Tab — powrót na mostek.' });
  }, 350);
}
/** Powrót na mostek (z lotu lub podglądu): statek wraca do hangaru, także z innego układu. */
function toBridge() {
  if (mode === 'mostek') return;
  if (mode === 'podglad') { setMode('mostek'); return; }
  if (playerWarp.active) return;
  fadeThen(() => {
    if (!playerState.alive) {
      playerState.alive = true;
      playerState.hull = playerState.maxHull;
      deathEl.classList.remove('visible');
      missions.abort();
    }
    if (!inHome()) {
      army.beforeJump(command.state.home);
      swapSystem(command.state.home);
      dashboard.show('system', { crew: CREW.navigator, urgency: 'info', ttl: 5000, text: `Powrót do siedziby: ${starSystem.name}.` });
    }
    setMode('mostek');
  });
}
document.getElementById('to-bridge').addEventListener('click', toBridge);
document.getElementById('spectate-back').addEventListener('click', () => setMode('mostek'));
document.getElementById('spectate-pilot').addEventListener('click', () => takeHelm());
for (const id of ['to-bridge', 'spectate-bar', 'decisions']) document.getElementById(id).addEventListener('mousedown', (e) => e.stopPropagation());
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  if (e.repeat) return;
  if (mode === 'mostek') takeHelm(); else toBridge();
});

// --- podgląd zdalny: flota w bitwie, wyprawa ---
const spectateLabel = document.getElementById('spectate-label');
const _bp = new THREE.Vector3();
function battlePoint(fid) {
  const c = fid ? fieldCenter(fid) : command.frame()?.pos ?? shipGroup.position;
  const pts = npcs.hostiles().filter((h) => h.alive && !h.hidden && h.group.position.distanceTo(c) < 16000).map((h) => h.group.position);
  if (!pts.length) for (const n of army.spawned.values()) if (n.alive) pts.push(n.group.position);
  if (!pts.length) return c;
  _bp.set(0, 0, 0);
  for (const p of pts) _bp.add(p);
  return _bp.multiplyScalar(1 / pts.length);
}
/** Flota broni pola (rozkaz "obrona") i - jeśli watch - podgląd zdalny starcia. */
function sendFleet(fieldId = null, { watch = true, watchOnly = false } = {}) {
  const fid = fieldId && strategy.defs.has(fieldId) && !strategy.foreignOwner(fieldId) ? fieldId : homeFieldId();
  const here = army.ships.filter((x) => x.sysId === economy.systemId);
  if (!watchOnly) {
    if (here.length) commandPanel.result(army.setOrder(here.map((x) => x.id), 'obrona', fid) ?? { ok: true, text: `Flota (${here.length}) broni: ${strategy.defs.get(fid).name}.` });
    else commandPanel.toast('W tym układzie nie ma naszych okrętów — zbuduj stocznię i flotę. Pokazuję pole.', true);
  }
  if (!watch) return;
  spectateLabel.textContent = `Podgląd zdalny: ${strategy.defs.get(fid)?.name ?? 'pole'}${here.length ? ` · flota ${here.length} okr.` : ''}`;
  commandView.spectate(() => battlePoint(fid), { r: 2900 });
  setMode('podglad');
}
function watchExpedition(e) {
  const last = new THREE.Vector3();
  spectateLabel.textContent = `Podgląd: ${e.name}`;
  commandView.spectate(() => {
    const x = command.expedition(e.id);
    if (x && command.pose(x, _bp)) last.copy(_bp);
    else if (x && !last.lengthSq()) last.copy(command.targetInfo(x).pos ?? command.frame().pos);
    return last.lengthSq() ? last : command.frame().pos;
  }, { r: 700 });
  setMode('podglad');
}

// --- nalot / atak rasy: decyzja zamiast klawiszy ---
let raidOpen = false;
function updateRaidDecision() {
  const r = raids.status;
  if (!r) { raidOpen = false; return; }
  if (raidOpen) return;
  raidOpen = true;
  const here = army.ships.filter((x) => x.sysId === economy.systemId).length;
  const who = r.attacker ? `okręty rasy ${RACES[r.attacker].name}` : 'rabusie';
  decisions.ask({
    id: 'raid', kind: 'threat', urgency: 'danger',
    title: r.attacker ? `Atak: ${RACES[r.attacker].name}` : 'Nalot rabusiów',
    text: `${r.n} × ${who} wychodzi z fałdy przy naszych stacjach${r.phase === 'warning' ? ` (za ${Math.ceil(r.t)} s)` : ''}. ${here ? `W układzie mamy ${here} okr. floty.` : 'Nie mamy tu floty.'}`,
    portrait: r.attacker ? portraitOf(r.attacker, 3, 34, rulingFaction(r.attacker)) : undefined,
    choices: [
      here ? { label: 'Poślij flotę', act: 'fleet', primary: true } : { label: 'Obserwuj', act: 'watch' },
      { label: 'Za stery', act: 'pilot', primary: !here },
    ],
    manage: [
      { label: 'Odwołaj drony', act: 'recall' },
      { label: 'Przywołaj ochronę', act: 'guard', disabled: !command.state.hangar.straznik },
      { label: 'Zaalarmuj pozostałych', act: 'alarm' },
    ],
    timeout: 15, defaultAct: here ? 'fleet-quiet' : 'recall',
    onChoose: (act) => {
      if (act === 'fleet') sendFleet(homeFieldId());
      if (act === 'fleet-quiet') sendFleet(homeFieldId(), { watch: false });
      if (act === 'watch') sendFleet(homeFieldId(), { watchOnly: true });
      if (act === 'pilot') takeHelm();
      if (act === 'recall') commandPanel.result(command.alarmAll());
      if (act === 'guard') commandPanel.result(command.sendGuards(homeFieldId()));
      if (act === 'alarm') { economy.setAlert(true); commandPanel.toast('Alarm: roje w dokach, wieże w gotowości.'); }
    },
  });
}

// --- wejście na mostek (start gry) ---
const introEl = document.getElementById('intro-title');
function showIntroTitle() {
  document.getElementById('intro-name').textContent = command.hq()?.name ?? 'Siedziba';
  document.getElementById('intro-sub').textContent = `${RACES[playerState.raceId].name} · ${starSystem.name}`;
  document.body.classList.add('intro');
  introEl.classList.add('on');
  setTimeout(() => introEl.classList.remove('on'), 3600);
  setTimeout(() => document.body.classList.remove('intro'), 4400);
  setTimeout(() => comms.say({
    sender: 'Dowództwo', sub: 'mostek siedziby', color: '#ffd36b',
    text: 'Jesteś na mostku siedziby. Rozkazy po lewej wysyłają drony na wyprawy, panel po prawej to hangar, moduły, nauka i ulepszenia. Decyzje wyskakują same — wystarczy kliknąć. „Za sterami” — lot myśliwcem.',
    ttl: 14,
  }), 4800);
}

// ============================================================
// KROK 9: AUDIO (shared/audio/) - muzyka, fałda, walka, ostrzeżenia
// ============================================================
// Jeden silnik na stronę (getAudio). createGameAudio podpina się pod
// dashboard i komunikator (dźwięk przy nowej karcie/wiadomości), czyta fazy
// fałdy i stan statku (alarmy), a muzyce podaje intensywność walki.
// O - wyciszenie; przycisk głośnika w prawym górnym rogu - suwaki.
gameAudio = createGameAudio({
  audio: getAudio(), camera, ship: shipGroup, playerState, playerWarp, npcs, combat,
  dashboard, comms, missions, getRadius: () => collisionRadius,
});
mountAudioControls(getAudio(), { corner: 'top-right', offset: [12, 12], note: 'O — wycisz / włącz' });

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
  starSystem.update(delta, camera); // kamera: rozmiar korony gwiazd (sylwetka z bliska)
  debrisField.update(delta);
  updateShip(delta);
  updateWarp(delta);
  updateCamera(delta);
  commandView.update(delta, mode); // krok 12: kamera mostka / podglądu, drony wypraw
  if (mode !== 'lot') { fireInput.held = false; mining.held = false; }
  decisions.update(delta);
  if (mode === 'mostek') commandPanel.update(delta);
  updateAimMark();
  background.update(camera); // tło "w nieskończoności": gwiazdy podążają za kamerą (zero paralaksy)
  updateStory(delta);
  updateDashboard(delta);
  updateEconomy(delta);
  gameAudio?.update(delta);
}

// Hak do testów automatycznych (?debug w adresie): przewijanie symulacji
// bez renderowania i podgląd stanu. W normalnej grze nic nie wystawia.
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = {
    tick, npcs, encounters, playerWarp, warp, shipGroup, arsenal, weapons, combat, fireInput, playerState,
    tactics, missions, wolfpack, get warpJam() { return warpJam; }, get speedCap() { return speedCap; },
    get starSystem() { return starSystem; }, jumpToSystem, swapSystem, camera, renderer, scene, warpParade,
    get speed() { return shipState.speed; },
    audio: getAudio(), gameAudio, goToBoard, replayMission, boardUrl, respawn, killPlayer, damagePlayer, engageWarp,
    economy, industryPanel, mining, holdCapacity, unloadNearby, shipAhead, raids,
    strategy, rival, army, stratMap, get waypoint() { return waypoint; },
    command, commandView, commandPanel, decisions, setMode, get mode() { return mode; }, toBridge, takeHelm, sendFleet,
  };
}

// ============================================================
// OPTYMALIZACJA: ADAPTACYJNA ROZDZIELCZOŚĆ
// ============================================================
// Koszt klatki rośnie z liczbą pikseli (gwiazda wypełniająca ekran, korony,
// efekty addytywne). Gdy średni czas klatki przekracza ~21 ms (poniżej ~48 fps)
// przez sekundę, obniżamy rozdzielczość renderu o 15%; gdy przez 5 s mieścimy
// się w ~57 fps, podnosimy ją o 8% (histereza - bez "pompowania" obrazu).
// Najniżej 50% natywnej. HUD (DOM) zostaje ostry - skaluje się tylko scena 3D.
// ?jakosc=pelna w adresie wyłącza mechanizm. W VR nie ruszamy (WebXR sam
// zarządza rozdzielczością gogli).
const MAX_PR = Math.min(window.devicePixelRatio, 2);
const MIN_PR = Math.max(0.5, MAX_PR * 0.5);
const ADAPTIVE = new URLSearchParams(location.search).get('jakosc') !== 'pelna';
let pixelRatio = MAX_PR, frameAvg = 1 / 60, slowFor = 0, fastFor = 0;
const resEl = document.getElementById('tm-res');
function adaptResolution(raw) {
  if (!ADAPTIVE || renderer.xr.isPresenting || raw <= 0 || raw > 0.25) return; // 0,25 s+ = karta w tle / pauza
  frameAvg += (raw - frameAvg) * 0.05;
  if (frameAvg > 1 / 48) { slowFor += raw; fastFor = 0; } else if (frameAvg < 1 / 57) { fastFor += raw; slowFor = 0; } else { slowFor = fastFor = 0; }
  let changed = false;
  if (slowFor > 1 && pixelRatio > MIN_PR) { pixelRatio = Math.max(MIN_PR, pixelRatio * 0.85); changed = true; frameAvg = 1 / 55; }
  else if (fastFor > 5 && pixelRatio < MAX_PR) { pixelRatio = Math.min(MAX_PR, pixelRatio * 1.08); changed = true; }
  if (changed) {
    slowFor = fastFor = 0;
    renderer.setPixelRatio(pixelRatio);
    if (resEl) resEl.textContent = `${Math.round((pixelRatio / MAX_PR) * 100)}%`;
  }
}

function animate() {
  const raw = clock.getDelta();
  adaptResolution(raw);
  tick(Math.min(raw, 0.05));
  renderer.render(scene, camera);
  if (mode === 'mostek') commandView.renderPip(); // krok 12: okienko podglądu wyprawy
}

loadShip(urlShipIndex)
  .then(() => {
    cameraRig.position.copy(shipGroup.position).add(cameraOffset); // start bez "najazdu" kamery
    setMode(mode, { intro: mode === 'mostek' }); // krok 12: statek w hangarze, najazd kamery na mostek
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
