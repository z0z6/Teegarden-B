import * as THREE from 'three';

/**
 * Generyczny, reużywalny silnik grawitacji N-ciał (prawo powszechnego
 * ciążenia Newtona: F = G·m1·m2/r²), z integracją metodą "leapfrog"
 * (velocity Verlet w wersji kick-drift-kick).
 *
 * DLACZEGO LEAPFROG, A NIE ZWYKŁY EULER?
 * Naiwna integracja Eulera (x += v*dt; v += a*dt, w tej kolejności, na
 * podstawie przyspieszenia z POPRZEDNIEJ klatki) systematycznie dodaje
 * energię do układu — orbity powoli, ale nieuchronnie się rozkręcają
 * (ciała z czasem uciekają po spirali). Leapfrog jest symplektyczny:
 * błąd energii oscyluje wokół zera zamiast rosnąć w nieskończoność,
 * więc orbity pozostają ograniczone (nie "wystrzelą" ani nie zapadną
 * się w gwiazdę) nawet po bardzo długim czasie symulacji. To STANDARDOWA
 * metoda w symulacjach orbitalnych (używana np. w prawdziwych kodach
 * N-body w astrofizyce).
 *
 * SOFTENING: gdy dwa ciała zbliżą się bardzo blisko siebie, 1/r² dąży do
 * nieskończoności i symulacja "wybucha" (jeden krok czasowy może dać
 * absurdalnie dużą prędkość). Dodajemy stałą `softening` do r², co
 * ogranicza maksymalne przyspieszenie - kosztem odrobiny fizycznej
 * dokładności przy bardzo małych odległościach, których i tak nie chcemy
 * oglądać z bliska (ciała by się "zderzyły").
 */
export class NBodySystem {
  /**
   * @param {number} G - stała grawitacji w jednostkach gry (NIE 6.674e-11 -
   *   to by dało ruch niezauważalny gołym okiem przy rozsądnych masach/
   *   odległościach; dobieramy G tak, żeby okresy orbit były "grywalne",
   *   patrz stellar-system.js po konkretne wyliczenia).
   * @param {number} softening - promień "zmiękczenia" potencjału (jednostki gry)
   */
  constructor({ G = 1, softening = 1 } = {}) {
    this.G = G;
    this.softening = softening;
    this.bodies = []; // { mass, position: Vector3, velocity: Vector3, acceleration: Vector3, name? }
  }

  addBody(body) {
    if (!body.acceleration) body.acceleration = new THREE.Vector3();
    this.bodies.push(body);
    return body;
  }

  /** Przyspieszenie grawitacyjne w danym punkcie od wszystkich ciał układu
   * (opcjonalnie pomijając jedno, żeby ciało nie grawitowało samo do siebie). */
  accelerationAt(position, exclude = null) {
    const acc = new THREE.Vector3();
    const diff = new THREE.Vector3();
    for (const b of this.bodies) {
      if (b === exclude) continue;
      diff.subVectors(b.position, position);
      const distSq = diff.lengthSq() + this.softening * this.softening;
      const invDist = 1 / Math.sqrt(distSq);
      const strength = (this.G * b.mass) * invDist * invDist * invDist; // G*m / dist^3, bo diff jeszcze nie jest znormalizowane
      acc.addScaledVector(diff, strength);
    }
    return acc;
  }

  _recomputeAccelerations() {
    for (const b of this.bodies) {
      b.acceleration.copy(this.accelerationAt(b.position, b));
    }
  }

  /** Jeden krok integracji leapfrog (kick-drift-kick) dla wszystkich ciał w układzie. */
  step(dt) {
    const half = dt * 0.5;
    // kick: v(t+dt/2) = v(t) + a(t)*dt/2
    for (const b of this.bodies) b.velocity.addScaledVector(b.acceleration, half);
    // drift: x(t+dt) = x(t) + v(t+dt/2)*dt
    for (const b of this.bodies) b.position.addScaledVector(b.velocity, dt);
    // przelicz przyspieszenia w nowych pozycjach
    this._recomputeAccelerations();
    // kick: v(t+dt) = v(t+dt/2) + a(t+dt)*dt/2
    for (const b of this.bodies) b.velocity.addScaledVector(b.acceleration, half);
  }

  /** Wywołaj raz po dodaniu wszystkich ciał i USTAWIENIU pozycji/prędkości
   * początkowych, przed pierwszym step() - inicjalizuje a(t=0). */
  init() {
    this._recomputeAccelerations();
  }

  /** Aktualizuje pozycję "cząstki testowej" (np. planety) pod wpływem
   * grawitacji wszystkich ciał układu, ale BEZ wpływu zwrotnego na te ciała
   * (przybliżenie: masa planety << masy gwiazd, więc jej wpływ na nie jest
   * pomijalny - tzw. "ograniczony problem N ciał"). Też leapfrog, dla spójności. */
  stepTestParticle(particle, dt) {
    const half = dt * 0.5;
    particle.velocity.addScaledVector(particle.acceleration, half);
    particle.position.addScaledVector(particle.velocity, dt);
    particle.acceleration.copy(this.accelerationAt(particle.position));
    particle.velocity.addScaledVector(particle.acceleration, half);
  }
}

/** Prędkość orbity kołowej wokół masy centralnej w odległości `separation`. */
export function circularOrbitSpeed(G, centralMass, separation) {
  return Math.sqrt((G * centralMass) / separation);
}
