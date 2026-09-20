import * as THREE from 'three';
import { NBodySystem, circularOrbitSpeed } from '../physics/n-body.js';

/**
 * Hierarchiczny układ potrójny: ciasna para wewnętrzna (gwiazda typu
 * Słońca + biały karzeł) orbitująca wspólny barycentrum + czerwony
 * olbrzym na dużo szerszej orbicie wokół całej pary.
 *
 * DLACZEGO HIERARCHICZNIE, A NIE "TRÓJKĄT" TRZECH RÓWNORZĘDNYCH ORBIT?
 * "Płaski" układ trzech ciał o porównywalnych odległościach jest
 * notorycznie chaotyczny (problem trzech ciał). Realne, DŁUGO stabilne
 * układy potrójne w naturze są (niemal) zawsze hierarchiczne: ciasna
 * para + daleki towarzysz, z dużym stosunkiem odległości zewnętrznej
 * do wewnętrznej (tu ~9x) - to samo robimy tutaj.
 *
 * SKALA (v2 - poprawiona). Poprzednia wersja miała promień czerwonego
 * olbrzyma (42 j.) MNIEJSZY niż długość największego statku floty
 * (Kharath, ~193 j.) - gwiazda była wizualnie mniejsza niż statek, co
 * jest oczywiście fizycznym absurdem. Teraz każde ciało niebieskie,
 * WŁĄCZNIE z najmniejszym (biały karzeł), jest wyraźnie większe niż
 * jakikolwiek statek floty, a odległości między ciałami są duże na tyle,
 * żeby powierzchnie orbitujących ciał nigdy się wizualnie nie stykały
 * (separacja wewnętrzna to teraz ~4x suma promieni obu gwiazd, nie
 * ledwie 1.03x jak poprzednio - poprzednio gwiazdy PRAWIE się stykały
 * w peryhelium!).
 *
 * REALISTYCZNY SZCZEGÓŁ #1: biały karzeł ma promień dużo mniejszy niż
 * gwiazda typu Słońca (bo to zapadnięty rdzeń wielkości Ziemi), ale
 * MASĘ tego samego rzędu wielkości - białe karły są ekstremalnie gęste.
 *
 * REALISTYCZNY SZCZEGÓŁ #2 (jasność): biały karzeł ma gorętszą
 * powierzchnię niż Słońce (stąd niebieskawy kolor) - ale jest tak MAŁY,
 * że jego CAŁKOWITA jasność (luminosity = temperatura^4 × powierzchnia)
 * jest mimo to dużo NIŻSZA niż gwiazdy typu Słońca. Odwrotnie: czerwony
 * olbrzym ma CHŁODNIEJSZĄ powierzchnię (stąd pomarańczowy kolor), ale
 * jego ogromna powierzchnia sprawia, że jest o rzędy wielkości
 * JAŚNIEJSZY niż obie pozostałe gwiazdy razem wzięte. "Gorący ≠
 * jasny, chłodny ≠ ciemny" - to nieintuicyjne, ale prawdziwe, i tutaj
 * celowo odwzorowane w relatywnych mnożnikach LUMINOSITY poniżej.
 */

// ---- Promienie (jednostki gry). Dla porównania: największy statek floty
// (Kharath) ma ~193 jednostki długości - każde ciało niebieskie poniżej
// jest od niego WYRAŹNIE większe. ----
const RADIUS = {
  starA: 500,         // gwiazda typu Słońca (G) - ~2.6x długości Kharatha
  whiteDwarf: 140,     // celowo MAŁY względem starA, ale wciąż > niż każdy statek
  redGiant: 4200,      // ~8.4x starA - typowy rząd wielkości dla czerwonego olbrzyma
};

// ---- Masy (jednostki gry, nie SI - ale zachowane proporcje jak poprzednio) ----
const MASS = {
  starA: 1.0,
  whiteDwarf: 0.7,
  redGiant: 3.0,
};

// ---- Względna jasność (LUMINOSITY), NIE to samo co "intensity" światła
// w kodzie niżej wprost - to mnożnik względem BASE_INTENSITY. Wartości
// dobrane tak, żeby zachować realny, nieintuicyjny kontrast: mały+gorący
// biały karzeł jest znacznie CIEMNIEJSZY niż średnia gwiazda, a
// ogromny+chłodniejszy czerwony olbrzym jest znacznie JAŚNIEJSZY. ----
const LUMINOSITY = {
  starA: 1,
  whiteDwarf: 0.05,   // gorący, ale mikroskopijny -> mało światła całkowitego
  redGiant: 350,       // chłodniejszy, ale ogromna powierzchnia -> zalewa układ światłem
};

const COLOR = {
  starA: 0xfff2d0,      // żółto-biały, G-type
  whiteDwarf: 0xcfe8ff, // niebiesko-biały, bardzo gorąca powierzchnia
  redGiant: 0xff6a3d,   // pomarańczowo-czerwony, chłodniejsza powierzchnia
};

// Separacja wewnętrzna to ~4x suma promieni obu gwiazd (wyraźny odstęp
// między powierzchniami przez cały cykl orbity, nawet przy niewielkiej
// mimośrodowości, jaką daje symulacja N-ciał - patrz README, poprzednio
// był to ledwie ~1.03x, gwiazdy PRAWIE się stykały).
const SEPARATION_INNER = (RADIUS.starA + RADIUS.whiteDwarf) * 4; // = 2560
const SEPARATION_OUTER = SEPARATION_INNER * 9; // hierarchia ~9x, jak poprzednio = 23040
const PLANET_ORBIT_RADIUS = SEPARATION_OUTER * 1.7; // wyraźnie poza orbitą czerwonego olbrzyma

/**
 * G dobrane tak, żeby wewnętrzna para miała okres ~30s (żywe, widoczne
 * "tańczenie" w skali sesji grania) - z prawa Keplera (T²=4π²a³/(G·M)),
 * nie zgadywane na oko. Ta sama metoda co poprzednio; ponieważ G nie ma
 * tu znaczenia fizycznego (SI), przeskalowanie odległości nie psuje
 * niczego - po prostu przeliczamy G na nowo dla nowej separacji.
 */
const INNER_PERIOD_TARGET = 30; // sekundy
const G = (4 * Math.PI ** 2 * SEPARATION_INNER ** 3)
  / (INNER_PERIOD_TARGET ** 2 * (MASS.starA + MASS.whiteDwarf));

/**
 * BASE_INTENSITY: mnożnik, który przekłada LUMINOSITY (wartości ~0.05-350)
 * na rzeczywisty parametr `intensity` THREE.PointLight, w jednostkach,
 * które przy fizycznie poprawnym opadaniu (decay=2, prawo odwrotnych
 * kwadratów) dają sensowną jasność na dystansach rzędu tysięcy jednostek
 * gry. Skalibrowane EMPIRYCZNIE (renderowanie testowej sceny + wizualna
 * ocena przy 500 / 2000 / 5000 / 10000 / 20000 jednostek od powierzchni
 * gwiazdy - patrz historia zmian/PR) tak, żeby:
 * - z bardzo bliska (<1000 j. od powierzchni, ~2x promień gwiazdy) obraz
 *   był świadomie prześwietlony na biało - to REALISTYCZNE, prawdziwej
 *   gwieździe z tej odległości też nie dałoby się patrzeć bezpośrednio;
 * - w zakresie ~2000-10000 j. był wyraźny gradient cieniowania (statek
 *   czytelny, nie płaska biel ani czerń);
 * - powyżej ~20000 j. gwiazda przestawała realnie doświetlać (zgodnie
 *   z prawem odwrotnych kwadratów) - stąd shipLight (patrz main.js) jako
 *   niezawodne źródło światła na duże dystanse, gdzie żadna gwiazda już
 *   nie dosięga.
 */
const BASE_INTENSITY = 6e7;

// decay=2 to FIZYCZNIE POPRAWNE prawo odwrotnych kwadratów (intensity
// spada z kwadratem odległości) - poprzednia wersja używała decay=0.4,
// czyli światło gasło DUŻO wolniej niż w rzeczywistości (stąd "nasilenie
// światła" było nierealne - ciała świeciły z tą samą siłą niezależnie
// od dystansu w dużo większym stopniu niż być powinny).
const LIGHT_DECAY = 2;

function makeStarMesh(radius, color, luminosity) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 48),
    new THREE.MeshBasicMaterial({ color })
  );
  group.add(mesh);
  const light = new THREE.PointLight(color, luminosity * BASE_INTENSITY, 0, LIGHT_DECAY);
  group.add(light);
  return { group, mesh, light };
}

export function createTripleStarSystem(scene) {
  const nbody = new NBodySystem({ G, softening: RADIUS.whiteDwarf * 2 });

  // --- Wewnętrzna para: starA + whiteDwarf, barycentrum w (0,0,0) ---
  const rA = SEPARATION_INNER * MASS.whiteDwarf / (MASS.starA + MASS.whiteDwarf);
  const rW = SEPARATION_INNER * MASS.starA / (MASS.starA + MASS.whiteDwarf);
  const vInnerRel = circularOrbitSpeed(G, MASS.starA + MASS.whiteDwarf, SEPARATION_INNER);
  const vA = vInnerRel * MASS.whiteDwarf / (MASS.starA + MASS.whiteDwarf);
  const vW = vInnerRel * MASS.starA / (MASS.starA + MASS.whiteDwarf);

  // --- Zewnętrzna orbita: redGiant wokół barycentrum pary wewnętrznej ---
  const massInner = MASS.starA + MASS.whiteDwarf;
  const massTotal = massInner + MASS.redGiant;
  const rRG = SEPARATION_OUTER * massInner / massTotal;
  const rInnerBary = SEPARATION_OUTER * MASS.redGiant / massTotal;
  const vOuterRel = circularOrbitSpeed(G, massTotal, SEPARATION_OUTER);
  const vRG = vOuterRel * massInner / massTotal;
  const vInnerBary = vOuterRel * MASS.redGiant / massTotal;

  // Barycentrum pary wewnętrznej: pozycja i prędkość jako całość (potem
  // dodajemy do niej lokalne przesunięcie starA/whiteDwarf względem siebie)
  const innerBaryPos = new THREE.Vector3(-rInnerBary, 0, 0);
  const innerBaryVel = new THREE.Vector3(0, 0, -vInnerBary);

  const starA = nbody.addBody({
    name: 'starA',
    mass: MASS.starA,
    position: innerBaryPos.clone().add(new THREE.Vector3(0, 0, rA)),
    velocity: innerBaryVel.clone().add(new THREE.Vector3(vA, 0, 0)),
  });
  const whiteDwarf = nbody.addBody({
    name: 'whiteDwarf',
    mass: MASS.whiteDwarf,
    position: innerBaryPos.clone().add(new THREE.Vector3(0, 0, -rW)),
    velocity: innerBaryVel.clone().add(new THREE.Vector3(-vW, 0, 0)),
  });
  const redGiant = nbody.addBody({
    name: 'redGiant',
    mass: MASS.redGiant,
    position: new THREE.Vector3(rRG, 0, 0),
    velocity: new THREE.Vector3(0, 0, vRG),
  });

  nbody.init(); // przelicz a(t=0) dla wszystkich ciał przed pierwszym step()

  // --- Planeta: cząstka testowa (nie wpływa grawitacyjnie na gwiazdy) ---
  const vPlanet = circularOrbitSpeed(G, massTotal, PLANET_ORBIT_RADIUS);
  const planet = {
    position: new THREE.Vector3(0, 0, PLANET_ORBIT_RADIUS),
    velocity: new THREE.Vector3(vPlanet, 0, 0),
    acceleration: new THREE.Vector3(),
  };
  planet.acceleration.copy(nbody.accelerationAt(planet.position));

  // --- Wizualizacja (meshe + światła) ---
  const visuals = {
    starA: makeStarMesh(RADIUS.starA, COLOR.starA, LUMINOSITY.starA),
    whiteDwarf: makeStarMesh(RADIUS.whiteDwarf, COLOR.whiteDwarf, LUMINOSITY.whiteDwarf),
    redGiant: makeStarMesh(RADIUS.redGiant, COLOR.redGiant, LUMINOSITY.redGiant),
  };
  for (const v of Object.values(visuals)) scene.add(v.group);

  const planetMesh = new THREE.Mesh(
    new THREE.SphereGeometry(220, 64, 64), // też powiększona (była 8 j. - mniejsza niż niejeden silnik statku)
    new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.85, metalness: 0.05 })
  );
  scene.add(planetMesh);

  function syncVisuals() {
    visuals.starA.group.position.copy(starA.position);
    visuals.whiteDwarf.group.position.copy(whiteDwarf.position);
    visuals.redGiant.group.position.copy(redGiant.position);
    planetMesh.position.copy(planet.position);
    planetMesh.rotation.y += 0.004; // czysto kosmetyczny obrót wokół własnej osi
  }
  syncVisuals();

  function update(dt) {
    nbody.step(dt);
    nbody.stepTestParticle(planet, dt);
    syncVisuals();
  }

  return {
    nbody, bodies: { starA, whiteDwarf, redGiant }, planet, planetMesh, visuals, update, G,
    // Wystawione na zewnątrz, żeby step4/main.js mógł ustawić bezpieczny
    // punkt startowy statku i dystans kamery bez przepisywania stałych
    // na sztywno w dwóch miejscach (patrz komentarz w main.js).
    constants: { RADIUS, SEPARATION_INNER, SEPARATION_OUTER, PLANET_ORBIT_RADIUS },
  };
}
