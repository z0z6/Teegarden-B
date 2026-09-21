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
  function fire({ origin, direction, side, speed = 1500, damage = 12, color = 0x66ffee, life = 2, hitScale = 1, shooter = null }) {
    const mesh = new THREE.Mesh(BOLT_GEO, boltMaterial(color));
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(Z_AXIS, direction);
    mesh.frustumCulled = false;
    const glow = new THREE.Sprite(glowMaterial(color));
    glow.scale.set(0.024, 0.024, 1);
    mesh.add(glow);
    scene.add(mesh);
    bolts.push({ mesh, vel: direction.clone().multiplyScalar(speed), side, damage, life, hitScale, shooter });
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
      b.mesh.position.addScaledVector(b.vel, dt);
      b.life -= dt;

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

      if (hitActor) {
        hitActor.takeDamage(b.damage, b.shooter);
        flash(hitPoint, 14, 0xfff0b0, 0.25);
        emit('hit', { target: hitActor, damage: b.damage, shooter: b.shooter });
        scene.remove(b.mesh); bolts.splice(i, 1);
      } else if (b.life <= 0) {
        scene.remove(b.mesh); bolts.splice(i, 1);
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
    register, unregister, fire, flash, update, clear,
    on(type, fn) { listeners[type].push(fn); },
    get boltCount() { return bolts.length; },
  };
}
