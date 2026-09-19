import * as THREE from 'three';
import { NBodySystem, circularOrbitSpeed } from '../physics/n-body.js';

/**
 * Hierarchiczny układ potrójny: ciasna para wewnętrzna (gwiazda typu
 * Słońca + biały karzeł) orbitująca wspólny barycentrum + czerwony
 * olbrzym na dużo szerszej orbicie wokół całej pary.
 *
 * DLACZEGO HIERARCHICZNIE, A NIE "TRÓJKĄT" TRZECH RÓWNORZĘDNYCH ORBIT?
 * "Płaski" układ trzech ciał o porównywalnych odległościach jest
 * notorycznie chaotyczny (problem trzech ciał) - w praktyce po chwili
 * jedno ciało zostaje wyrzucone albo dwa się zderzają. Realne, DŁUGO
 * stabilne układy potrójne w naturze są (niemal) zawsze hierarchiczne:
 * ciasna para + daleki towarzysz, z dużym stosunkiem odległości
 * zewnętrznej do wewnętrznej (tu ~8.9x) - to samo robimy tutaj.
 *
 * REALISTYCZNY SZCZEGÓŁ: biały karzeł ma promień dużo mniejszy niż
 * gwiazda typu Słońca (bo to zapadnięty rdzeń wielkości Ziemi), ale
 * MASĘ tego samego rzędu wielkości - białe karły są ekstremalnie gęste.
 * To częsty błąd w grach/wizualizacjach (mały promień = mała masa) -
 * tutaj świadomie tego unikamy.
 */

// ---- Masy i promienie (jednostki gry, nie SI) ----
const MASS = {
  starA: 1.0,       // gwiazda typu Słońca (G) - kotwica wewnętrznej pary
  whiteDwarf: 0.7,   // mały promień, ale masa porównywalna do starA
  redGiant: 3.0,     // ewoluowana gwiazda, największa masa w układzie
};
const RADIUS = {
  starA: 12,
  whiteDwarf: 2.2,   // celowo MAŁY mimo sporej masy - patrz komentarz wyżej
  redGiant: 42,      // celowo OGROMNY - typowe dla czerwonych olbrzymów
};
const COLOR = {
  starA: 0xfff2d0,      // żółto-biały, G-type
  whiteDwarf: 0xcfe8ff, // niebiesko-biały, bardzo gorąca powierzchnia
  redGiant: 0xff6a3d,   // pomarańczowo-czerwony, chłodna powierzchnia
};

const SEPARATION_INNER = 18;   // odległość starA <-> whiteDwarf
const SEPARATION_OUTER = 160;  // odległość redGiant <-> barycentrum pary wewnętrznej
const PLANET_ORBIT_RADIUS = 260; // planeta krąży wokół barycentrum CAŁEGO układu

/**
 * G dobrane tak, żeby wewnętrzna para miała okres ~30s (żywe, widoczne
 * "tańczenie" w skali sesji grania), a odległości/masy zostały wyliczone
 * z prawa Keplera (T² = 4π²a³/(G·M)) - nie zgadywane na oko.
 */
const INNER_PERIOD_TARGET = 30; // sekundy
const G = (4 * Math.PI ** 2 * SEPARATION_INNER ** 3)
  / (INNER_PERIOD_TARGET ** 2 * (MASS.starA + MASS.whiteDwarf));

function makeStarMesh(radius, color) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 32),
    new THREE.MeshBasicMaterial({ color })
  );
  group.add(mesh);
  const light = new THREE.PointLight(color, 4, 0, 0.4);
  group.add(light);
  return { group, mesh, light };
}

export function createTripleStarSystem(scene) {
  const nbody = new NBodySystem({ G, softening: 3 });

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
    starA: makeStarMesh(RADIUS.starA, COLOR.starA),
    whiteDwarf: makeStarMesh(RADIUS.whiteDwarf, COLOR.whiteDwarf),
    redGiant: makeStarMesh(RADIUS.redGiant, COLOR.redGiant),
  };
  for (const v of Object.values(visuals)) scene.add(v.group);

  const planetMesh = new THREE.Mesh(
    new THREE.SphereGeometry(8, 64, 64),
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

  return { nbody, bodies: { starA, whiteDwarf, redGiant }, planet, planetMesh, visuals, update, G };
}
