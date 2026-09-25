import * as THREE from 'three';

/**
 * FLARY GRACZA (krok 9) - wystrzeliwane AUTOMATYCZNIE.
 *
 * Gdy wroga rakieta, której głowica trzyma statek gracza, jest już w locie
 * i doleci w ciągu `TRIGGER_TCA` s, statek wyrzuca pakiet flar (jeden ładunek
 * z zapasu). Każdy nadlatujący wtedy pocisk jest losowany RAZ: z szansą
 * `flareChance` (poziom trudności, combat-rules.js) przestawia się na
 * najbliższego wabika i goni go zamiast statku; inaczej leci dalej.
 * Zapas i szansa zależą od poziomu trudności; zapas wraca na starcie misji
 * i po odrodzeniu (refill).
 */
const TRIGGER_TCA = 1.5;    // s do celu, przy których pakiet wylatuje
const BURST_COOLDOWN = 0.8; // s między pakietami
const PER_BURST = 3;        // wabików w pakiecie

export function createFlares({ combat, weapons, ship, getVelocity, isActive = () => true }) {
  const state = { count: 0, max: 0, chance: 0.65, cooldown: 0, decoyed: 0, through: 0 };
  const listeners = { burst: [], empty: [] };
  const emit = (t, p) => listeners[t].forEach((fn) => fn(p));
  const _v = new THREE.Vector3(), _f = new THREE.Vector3();
  let emptyWarned = false;

  function configure(rules) {
    state.max = rules.flares;
    state.chance = rules.flareChance;
    refill();
  }
  function refill() {
    state.count = state.max;
    state.cooldown = 0;
    emptyWarned = false;
  }

  function update(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    if (!isActive()) return;
    const fresh = combat.threats(ship.position, 'player', TRIGGER_TCA).filter((t) => !t.bolt._flareRolled);
    if (!fresh.length) return;
    if (state.count <= 0) {
      if (!emptyWarned) { emptyWarned = true; emit('empty'); }
      return;
    }
    if (state.cooldown > 0) return;

    state.count--;
    state.cooldown = BURST_COOLDOWN;
    getVelocity(_v);
    _f.set(0, 0, -1).applyQuaternion(ship.quaternion);
    const decoys = weapons.flareBurst(ship.position.clone(), _v, _f, PER_BURST);
    let fooled = 0;
    for (const { bolt } of fresh) {
      bolt._flareRolled = true;
      if (Math.random() >= state.chance) { state.through++; continue; }
      // przekierowanie na najbliższego wabika; bez zapalnika zbliżeniowego
      // (żeby nie wybuchł obok statku po drodze) i z samozniszczeniem przy wabiku
      let best = decoys[0], bd = Infinity;
      for (const d of decoys) { const x = d.position.distanceTo(bolt.mesh.position); if (x < bd) { bd = x; best = d; } }
      bolt.homing.target = best;
      bolt.proximity = 0;
      const prev = bolt.onUpdate;
      bolt.onUpdate = (b, dt2) => {
        prev?.(b, dt2);
        if (best.isAlive() && b.mesh.position.distanceTo(best.position) < 30) b.life = 0;
      };
      fooled++;
      state.decoyed++;
    }
    emit('burst', { fooled, total: fresh.length, left: state.count });
  }

  return {
    update, configure, refill, state,
    on(t, fn) { listeners[t].push(fn); },
  };
}
