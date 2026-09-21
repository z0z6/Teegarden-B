import * as THREE from 'three';

/**
 * ŻELAZNA ZASADA: żadne ciało poruszające się (statek, w przyszłości
 * NPC) nie może geometrycznie zagłębić się w inne ciało stałe (gwiazdę,
 * planetę, gruz/meteoryt). To NIE jest realistyczna fizyka zderzeń
 * (brak odbić, momentu pędu, deformacji) - to twarda bariera
 * bezpieczeństwa: pozycja jest odpychana na powierzchnię, prędkość
 * tłumiona, koniec historii.
 *
 * Współrzędne "ciał stałych" (`solids`) są czytane ŚWIEŻO co klatkę
 * (przez wywołującego), bo gwiazdy/planeta/gruz naprawdę się poruszają
 * (fizyka N-ciał, dryf gruzu) - nie ma tu cache'owania pozycji.
 */

/**
 * @param {THREE.Vector3} position - pozycja poruszającego się ciała (MUTOWANA w miejscu)
 * @param {number} radius - promień kolizji poruszającego się ciała
 * @param {Array<{position: THREE.Vector3, radius: number, name?: string}>} solids
 * @returns {{collided: boolean, body: object|null, normal: THREE.Vector3|null, penetration: number}}
 */
export function resolveCollisions(position, radius, solids) {
  let result = { collided: false, body: null, normal: null, penetration: 0 };
  const diff = new THREE.Vector3();

  for (const body of solids) {
    diff.copy(position).sub(body.position);
    const dist = diff.length();
    const minDist = radius + body.radius;

    if (dist < minDist) {
      const penetration = minDist - dist;
      // Ciało DOKŁADNIE w centrum innego (dist≈0) - matematycznie
      // zdegenerowany przypadek (brak kierunku odepchnięcia). W praktyce
      // niemożliwe przy rozsądnym kroku czasowym, ale nie ufamy temu -
      // odpychamy w dowolnym, stałym kierunku zamiast dzielić przez zero.
      const normal = dist > 1e-6 ? diff.normalize() : new THREE.Vector3(0, 1, 0);
      position.copy(body.position).addScaledVector(normal, minDist);

      // Jeśli ciało koliduje z WIELOMA solidami naraz (rzadkie, ale
      // możliwe przy gęstym gruzie), zachowujemy INFORMACJĘ o
      // największej penetracji - to ta kolizja "ważniejsza" do
      // zgłoszenia graczowi, nawet jeśli pozycja została skorygowana
      // względem tej ostatniej w pętli.
      if (penetration > result.penetration) {
        result = { collided: true, body, normal, penetration };
      } else {
        result.collided = true;
      }
    }
  }

  return result;
}

/**
 * Buduje listę "ciał stałych" z aktualnego stanu układu gwiezdnego +
 * pola gruzu, w formacie oczekiwanym przez resolveCollisions(). Wołane
 * co klatkę (pozycje gwiazd/gruzu się zmieniają), więc nie cache'ujemy
 * wyniku między klatkami.
 */
export function collectSolidBodies(starSystem, debrisField) {
  const solids = [
    { position: starSystem.bodies.starA.position, radius: starSystem.constants.RADIUS.starA, name: 'gwiazda G' },
    { position: starSystem.bodies.whiteDwarf.position, radius: starSystem.constants.RADIUS.whiteDwarf, name: 'biały karzeł' },
    { position: starSystem.bodies.redGiant.position, radius: starSystem.constants.RADIUS.redGiant, name: 'czerwony olbrzym' },
    { position: starSystem.planet.position, radius: starSystem.constants.RADIUS.planet, name: 'planeta' },
  ];
  if (debrisField) {
    for (const item of debrisField.items) {
      solids.push({ position: item.mesh.position, radius: item.radius, name: item.isMeteor ? 'meteoryt' : 'gruz' });
    }
  }
  return solids;
}
