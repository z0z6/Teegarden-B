import * as THREE from 'three';

/**
 * Minimalna walka do dema: pociski (bolty), trafienia i efekty.
 *
 * "Aktor" to dowolny obiekt z polami:
 *   side        'player' | 'ally' | 'hostile'
 *   position    THREE.Vector3 (na żywo - odczytywany co klatkę)
 *   radius      promień trafienia
 *   isAlive()   czy jeszcze żyje
 *   takeDamage(amount, shooter)
 * Pociski strony 'player'/'ally' trafiają tylko 'hostile' i odwrotnie.
 *
 * ROZSZERZENIA (krok 7, uzbrojenie - shared/systems/weapons.js), wszystkie
 * opcjonalne, więc kroki 5-6 działają bez zmian:
 *   fire({ size, mesh, homing, accel, maxSpeed, aoe, proximity, onUpdate, onEnd })
 *     - naprowadzanie (rakiety, torpedy), przyspieszanie, wybuch obszarowy,
 *       zapalnik zbliżeniowy i własny wygląd pocisku
 *   raycast(origin, dir, maxDist, side)   - trafienie natychmiastowe na promieniu
 *   explode(pos, radius, damage, side)    - obrażenia obszarowe ze spadkiem z odległością
 *
 * GŁOWICA, KTÓRA GUBI CEL (torpedy Grot i Trójząb): opcjonalne pola `homing`:
 *   seekerConeDeg  pole widzenia głowicy - cel poza nim = zgubiony na dobre
 *   lossPerSec     bazowa szansa zgubienia na sekundę (szum, zakłócenia)
 *   lossPerRad     dodatkowa szansa za każdy rad/s obrotu linii celowania -
 *                  cel, który ostro manewruje blisko pocisku, łatwiej zgubić
 *   lostDeflectDeg o ile stopni pocisk zbacza w chwili zgubienia celu
 *   commitRange    bliżej celu głowica już nie gubi (pocisk i tak jest na kursie)
 *   lossMult       mnożnik szansy zgubienia (zmienny w locie - np. łącze salwy)
 *   onLost(b, why) wołane raz, gdy głowica zgubi cel ('cone' | 'noise')
 * Zgubiony pocisk leci dalej prosto; zapalnik zbliżeniowy nadal działa, więc
 * czasem trafi przypadkiem. Bez tych pól naprowadzanie działa jak w kroku 7.
 *
 * TRAFIENIA SĄ "OMIATANE" (segment poprzednia->nowa pozycja vs sfera), nie
 * punktowe: pocisk leci ~1500 j./s, więc w jednej klatce (50 ms) pokonuje
 * 75 j. - dłużej niż średnica myśliwca. Sprawdzanie samej pozycji
 * przeskakiwałoby przez cel bez trafienia.
 */

const BOLT_GEO = new THREE.BoxGeometry(2.2, 2.2, 36);
const FLASH_GEO = new THREE.SphereGeometry(1, 14, 10);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Sam pocisk (2 x 36 j.) jest na dystansie walki (setki-tysiące j.) mniejszy
// niż piksel, więc walka wyglądałaby jak niewidzialna wymiana ognia. Każdy
// pocisk dostaje więc świecący punkt o STAŁYM rozmiarze na ekranie
// (sizeAttenuation: false) - widoczny z każdej odległości.
let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(c);
  return glowTexture;
}
const glowMaterials = new Map();
function glowMaterial(color) {
  if (!glowMaterials.has(color)) {
    glowMaterials.set(color, new THREE.SpriteMaterial({
      map: getGlowTexture(), color, transparent: true, depthWrite: false,
      sizeAttenuation: false, toneMapped: false, blending: THREE.AdditiveBlending,
    }));
  }
  return glowMaterials.get(color);
}

export function createCombat(scene) {
  const actors = new Set();
  const bolts = [];
  const effects = [];
  const listeners = { hit: [], kill: [] };
  const boltMaterials = new Map();

  const _prev = new THREE.Vector3();
  const _seg = new THREE.Vector3();
  const _toActor = new THREE.Vector3();
  const _closest = new THREE.Vector3();

  const emit = (type, payload) => listeners[type].forEach((fn) => fn(payload));

  function boltMaterial(color) {
    if (!boltMaterials.has(color)) {
      boltMaterials.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    }
    return boltMaterials.get(color);
  }

  function register(actor) { actors.add(actor); return actor; }
  function unregister(actor) { actors.delete(actor); }

  /**
   * @param {object} p
   * @param {THREE.Vector3} p.origin
   * @param {THREE.Vector3} p.direction znormalizowany
   * @param {'player'|'ally'|'hostile'} p.side
   * @param {number} [p.hitScale=1] mnożnik promienia trafienia (asysta celowania gracza)
   */
  function fire({
    origin, direction, side, speed = 1500, damage = 12, color = 0x66ffee, life = 2, hitScale = 1, shooter = null,
    size = 1, mesh = null, homing = null, accel = 0, maxSpeed = null, aoe = null, proximity = 0,
    onUpdate = null, onEnd = null,
  }) {
    if (!mesh) {
      mesh = new THREE.Mesh(BOLT_GEO, boltMaterial(color));
      mesh.scale.setScalar(size);
      const glow = new THREE.Sprite(glowMaterial(color));
      glow.scale.set(0.024 * Math.sqrt(size), 0.024 * Math.sqrt(size), 1);
      glow.scale.divideScalar(size); // sprite dziedziczy skalę rodzica - kompensujemy
      mesh.add(glow);
    }
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(Z_AXIS, direction);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const bolt = {
      mesh, vel: direction.clone().multiplyScalar(speed), speed, side, damage, life, age: 0, hitScale, shooter,
      homing, accel, maxSpeed: maxSpeed ?? speed, aoe, proximity, onUpdate, onEnd,
    };
    bolts.push(bolt);
    return bolt;
  }

  const _dirNow = new THREE.Vector3(), _want = new THREE.Vector3(), _axis = new THREE.Vector3();
  /**
   * Czy głowica właśnie zgubiła cel (wołane z _want = kierunek na cel,
   * _dirNow = kurs pocisku). Zgubienie jest trwałe.
   */
  function seekerLoses(b, dt) {
    const h = b.homing;
    if (h.seekerConeDeg == null && !h.lossPerSec && !h.lossPerRad) return false;
    // "martwa strefa": z bliska pocisk jest już na kursie i nic nie steruje -
    // tu zgubienia by nie zmieniły wyniku, więc ich nie liczymy
    if (h.commitRange && h.target.position.distanceTo(b.mesh.position) < h.commitRange) return false;
    let why = null;
    if (h.seekerConeDeg != null && _dirNow.dot(_want) < Math.cos(h.seekerConeDeg * Math.PI / 180)) why = 'cone';
    else {
      // prędkość obrotu linii celowania (rad/s) z poprzedniej klatki
      let los = 0;
      if (h._prevWant && dt > 0) los = h._prevWant.angleTo(_want) / dt;
      (h._prevWant ??= new THREE.Vector3()).copy(_want);
      const rate = ((h.lossPerSec ?? 0) + (h.lossPerRad ?? 0) * los) * (h.lossMult ?? 1);
      if (rate > 0 && (h.rng ?? Math.random)() < 1 - Math.exp(-rate * dt)) why = 'noise';
    }
    if (!why) return false;
    h.lost = why;
    // głowica bez celu "szarpie" pociskiem - zbacza o kilka stopni, więc
    // pocisk, który był na kursie kolizyjnym, zwykle już nie trafi
    if (h.lostDeflectDeg) {
      const r = h.rng ?? Math.random;
      _axis.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(_dirNow).normalize();
      _dirNow.applyAxisAngle(_axis, (h.lostDeflectDeg * (0.5 + r() * 0.5)) * Math.PI / 180);
      b.mesh.quaternion.setFromUnitVectors(Z_AXIS, _dirNow);
    }
    h.onLost?.(b, why);
    return true;
  }

  /** Skręt prędkości pocisku w stronę celu z ograniczoną prędkością kątową. */
  function steerBolt(b, dt) {
    const tgt = b.homing?.target;
    if (b.accel) b.speed = Math.min(b.maxSpeed, b.speed + b.accel * dt);
    _dirNow.copy(b.vel).normalize();
    if (tgt && !b.homing.lost && tgt.isAlive() && b.age > (b.homing.delay ?? 0)) {
      // prosty "pure pursuit" z wyprzedzeniem, jeśli cel zna swoją prędkość
      _want.copy(tgt.position);
      if (tgt.velocity) _want.addScaledVector(tgt.velocity, Math.min(tgt.position.distanceTo(b.mesh.position) / Math.max(b.speed, 1), 1.5));
      _want.sub(b.mesh.position).normalize();
      if (seekerLoses(b, dt)) { b.vel.copy(_dirNow).multiplyScalar(b.speed); return; }
      // Obrót KIERUNKU po łuku wielkim (oś = kurs × cel), najwyżej o turnRate·dt.
      // Wcześniej był tu rotateTowards między kwaternionami z setFromUnitVectors:
      // dla kursu bliskiego −Z te kwaterniony mają przypadkowy "przechył", więc
      // interpolacja szła okrężną drogą i pocisk skręcał źle albo wcale.
      const ang = _dirNow.angleTo(_want);
      if (ang > 1e-6) {
        _axis.crossVectors(_dirNow, _want);
        if (_axis.lengthSq() < 1e-12) _axis.set(1, 0, 0).cross(_dirNow); // cel dokładnie z tyłu
        _dirNow.applyAxisAngle(_axis.normalize(), Math.min(ang, b.homing.turnRate * dt));
      }
    }
    b.vel.copy(_dirNow).multiplyScalar(b.speed);
    b.mesh.quaternion.setFromUnitVectors(Z_AXIS, _dirNow);
  }

  /** Pierwszy wróg strony `side` na promieniu (sfera = promień aktora × hitScale). */
  function raycast(origin, dir, maxDist, side, hitScale = 1) {
    let best = null;
    for (const actor of actors) {
      if (!actor.isAlive() || !isEnemy(side, actor.side)) continue;
      _toActor.copy(actor.position).sub(origin);
      const t = _toActor.dot(dir);
      if (t < 0 || t > maxDist) continue;
      const r = actor.radius * hitScale;
      const d2 = _toActor.lengthSq() - t * t;
      if (d2 > r * r) continue;
      const tHit = t - Math.sqrt(r * r - d2);
      if (!best || tHit < best.dist) best = { actor, dist: Math.max(0, tHit) };
    }
    if (best) best.point = origin.clone().addScaledVector(dir, best.dist);
    return best;
  }

  /**
   * Wybuch: obrażenia dla wrogów strony `side` w promieniu (spadek z odległością
   * od KRAWĘDZI aktora - duży okręt obrywa, gdy wybuch liźnie jego burtę).
   */
  function explode(position, radius, damage, side, shooter = null, { exclude = null } = {}) {
    for (const actor of [...actors]) {
      if (actor === exclude || !actor.isAlive() || !isEnemy(side, actor.side)) continue;
      const d = Math.max(0, actor.position.distanceTo(position) - actor.radius);
      if (d > radius) continue;
      const dmg = damage * (1 - 0.6 * (d / radius));
      actor.takeDamage(dmg, shooter);
      emit('hit', { target: actor, damage: dmg, shooter, aoe: true });
    }
  }

  function endBolt(i, reason, point) {
    const b = bolts[i];
    b.onEnd?.(b, reason, point);
    scene.remove(b.mesh);
    bolts.splice(i, 1);
  }

  function flash(position, size, color = 0xffc36b, duration = 0.45) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false });
    const mesh = new THREE.Mesh(FLASH_GEO, mat);
    mesh.position.copy(position);
    mesh.scale.setScalar(size * 0.3);
    mesh.frustumCulled = false;
    scene.add(mesh);
    effects.push({ mesh, mat, age: 0, duration, size });
  }

  const isEnemy = (boltSide, actorSide) =>
    (boltSide === 'hostile') !== (actorSide === 'hostile');

  function update(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      _prev.copy(b.mesh.position);
      b.age += dt;
      if (b.homing || b.accel) steerBolt(b, dt);
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      b.onUpdate?.(b, dt);

      let hitActor = null, hitPoint = null;
      _seg.copy(b.mesh.position).sub(_prev);
      const segLenSq = _seg.lengthSq();
      for (const actor of actors) {
        if (!actor.isAlive() || !isEnemy(b.side, actor.side)) continue;
        // najbliższy punkt odcinka do środka aktora
        _toActor.copy(actor.position).sub(_prev);
        const t = segLenSq > 1e-9 ? THREE.MathUtils.clamp(_toActor.dot(_seg) / segLenSq, 0, 1) : 0;
        _closest.copy(_prev).addScaledVector(_seg, t);
        const r = actor.radius * b.hitScale;
        if (_closest.distanceToSquared(actor.position) <= r * r) { hitActor = actor; hitPoint = _closest.clone(); break; }
      }

      // zapalnik zbliżeniowy (torpedy): detonacja, gdy wróg jest w zasięgu
      if (!hitActor && b.proximity > 0) {
        for (const actor of actors) {
          if (!actor.isAlive() || !isEnemy(b.side, actor.side)) continue;
          if (actor.position.distanceTo(b.mesh.position) < b.proximity + actor.radius) {
            // zapalnik zbliżeniowy = trafienie: pełne obrażenia bezpośrednie dla
            // celu, który go wyzwolił (Grot/Trójząb), wybuch dla reszty
            if (b.damage > 0) {
              actor.takeDamage(b.damage, b.shooter);
              emit('hit', { target: actor, damage: b.damage, shooter: b.shooter });
            }
            if (b.aoe) explode(b.mesh.position, b.aoe.radius, b.aoe.damage, b.side, b.shooter, { exclude: b.damage > 0 ? actor : null });
            endBolt(i, 'proximity', b.mesh.position.clone());
            hitActor = 'done';
            break;
          }
        }
        if (hitActor === 'done') continue;
      }

      if (hitActor) {
        if (b.damage > 0) {
          hitActor.takeDamage(b.damage, b.shooter);
          emit('hit', { target: hitActor, damage: b.damage, shooter: b.shooter });
        }
        if (b.aoe) explode(hitPoint, b.aoe.radius, b.aoe.damage, b.side, b.shooter, { exclude: b.damage > 0 ? hitActor : null });
        if (!b.onEnd) flash(hitPoint, 14 * Math.sqrt(b.mesh.scale.x), 0xfff0b0, 0.25);
        endBolt(i, 'hit', hitPoint);
      } else if (b.life <= 0) {
        if (b.aoe?.onExpire) explode(b.mesh.position, b.aoe.radius, b.aoe.damage, b.side, b.shooter);
        endBolt(i, 'expire', b.mesh.position.clone());
      }
    }

    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const k = e.age / e.duration;
      if (k >= 1) { scene.remove(e.mesh); e.mat.dispose(); effects.splice(i, 1); continue; }
      e.mesh.scale.setScalar(e.size * (0.3 + 0.7 * k));
      e.mat.opacity = 0.95 * (1 - k);
    }
  }

  function clear() {
    for (const b of bolts) scene.remove(b.mesh);
    bolts.length = 0;
    for (const e of effects) { scene.remove(e.mesh); e.mat.dispose(); }
    effects.length = 0;
  }

  return {
    register, unregister, fire, flash, update, clear, raycast, explode,
    on(type, fn) { listeners[type].push(fn); },
    get boltCount() { return bolts.length; },
  };
}
