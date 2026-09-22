import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SHIPS, visualYawFor } from '../ships/fleet.js';
import { RACES, shipForRace } from '../data/races.js';
import { RACE_WEAPON, WEAPONS } from './weapons.js';

/**
 * Statki NPC (sojusznicy i wrogowie) do dema fabularnego.
 *
 * Model używa tych samych .glb i tej samej orientacji dziobu co statek
 * gracza (fleet.js: visualYawFor). Fizyka jest KINEMATYCZNA (bez pełnego
 * modelu lotu gracza): prędkość i skręt są ograniczone, kierunek ruchu to
 * zawsze "przód" statku (lokalne -Z, jak u gracza).
 *
 * Tryby AI (npc.mode):
 *   formation  utrzymuje pozycję względem gracza (offset w układzie gracza):
 *              dolatuje, potem dopasowuje prędkość i kierunek. Do "kontaktu"
 *              sojusznika i do przechwycenia (wróg "wisi" obok gracza).
 *   escort     (sojusznik) formacja z tyłu-obok gracza; gdy w pobliżu jest
 *              wróg - sam go atakuje (przeloty z ostrzałem).
 *   attack     (wróg) przeloty na gracza z ostrzałem, naprzemiennie faza
 *              'run' (atak) i 'break' (zawrotka).
 *   flee       ucieczka od gracza, potem zniknięcie.
 *   idle       dryf prosto.
 *
 * NAPĘD FAŁDOWY (opcjonalnie, od kroku 6): gdy do managera przekazano
 * `{ warp }` (shared/systems/warp-drive.js), każdy NPC:
 *   - WCHODZI do sceny przez fałdę (zamiast pojawiać się znikąd),
 *   - ODLATUJE przez fałdę (flee -> depart), zamiast znikać po 14 s,
 *   - sojusznicy w eskorcie SKACZĄ RAZEM z graczem (followJump/arriveJump).
 * Bez `warp` zachowanie jest identyczne jak w kroku 5.
 *
 * UZBROJENIE (opcjonalnie, od kroku 7): z `{ weapons }` (shared/systems/weapons.js)
 * każdy NPC strzela bronią SWOJEJ RASY (RACE_WEAPON): Pieśniarze rakietami,
 * Rezonanci lancą, Szczepieni śrutem itd. - z zasięgiem i rytmem tej broni.
 * Bez `weapons` - bolty jak w kroku 5.
 */

const CALLSIGNS = ['Iskra', 'Wrona', 'Kwant', 'Mgła', 'Kolec', 'Zegar', 'Bursztyn', 'Cień', 'Lis', 'Otchłań'];
const BOLT_SPEED = 900;
const SIDE_COLOR = { ally: '#4dd6a0', hostile: '#ff5a4a', neutral: '#9fd8ff' };
const BOLT_COLOR = { ally: 0x6cff9a, hostile: 0xff5a4a, neutral: 0x9fd8ff };

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);

let beaconTexture = null;
function getBeaconTexture() {
  if (beaconTexture) return beaconTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  beaconTexture = new THREE.CanvasTexture(c);
  return beaconTexture;
}

/**
 * @param {THREE.Scene} scene
 * @param {ReturnType<import('./combat.js').createCombat>} combat
 * @param {object} player - { position, quaternion, getVelocity(out), isAlive() }
 */
export function createNpcManager(scene, combat, player, { warp = null, weapons = null } = {}) {
  const list = [];
  const listeners = { killed: [], left: [], retreat: [] };
  const emit = (t, p) => listeners[t].forEach((fn) => fn(p));

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const modelCache = new Map();
  const loadModel = (file) => {
    if (!modelCache.has(file)) modelCache.set(file, loader.loadAsync(file));
    return modelCache.get(file).then((g) => g.scene.clone(true));
  };

  let nextId = 1;
  const rand = (a, b) => a + Math.random() * (b - a);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3(), _tp = new THREE.Vector3(), _pv = new THREE.Vector3();
  const _fwd = new THREE.Vector3(), _aim = new THREE.Vector3(), _dir = new THREE.Vector3();

  function lookQuat(from, to, out) {
    _m.lookAt(from, to, UP); // konwencja kamery: -Z wskazuje cel (tak samo jak przód statku)
    return out.setFromRotationMatrix(_m);
  }

  function spawn({ raceId, factionKey = 'hawk', side, position, shipId, mode = 'idle', offset, maxSpeed, callsign, arrival, facing }) {
    const race = RACES[raceId];
    const def = SHIPS.find((s) => s.id === (shipId ?? shipForRace(raceId)));

    const group = new THREE.Group();
    group.position.copy(position);
    if (facing) group.quaternion.copy(facing);
    else lookQuat(position, player.position, group.quaternion); // startowo dziobem do gracza
    scene.add(group);

    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getBeaconTexture(), color: SIDE_COLOR[side], transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: false, toneMapped: false,
    }));
    beacon.scale.set(0.05, 0.05, 1);
    group.add(beacon);

    const maxHull = (side === 'ally' ? 160 : 140) * (race.ship.hull / 100);
    const npc = {
      id: `npc-${nextId++}`,
      raceId, raceName: race.name, factionKey, factionName: race.factions[factionKey],
      side, def, shipName: def.name,
      callsign: `${callsign ?? CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${1 + Math.floor(Math.random() * 9)}`,
      group, velocity: new THREE.Vector3(), speed: 0,
      maxSpeed: maxSpeed ?? (side === 'ally' ? 700 : 220), accel: 260, turnRate: 1.7,
      hull: maxHull, maxHull, armor: race.ship.armor, radius: 14,
      alive: true, mode, offset: (offset ?? new THREE.Vector3(200, 20, -250)).clone(), offsetScale: 1,
      ai: { phase: 'run', timer: 0, breakPoint: new THREE.Vector3() },
      fireCooldown: rand(0.8, 1.6), canFlee: side === 'hostile', fleeT: 0, ready: false,
      beacon, light: null,
      // napęd fałdowy: warping = sekwencja w toku (AI stoi), hidden = "w fałdzie" (niewidoczny, nietrafialny)
      warp: null, warping: false, arriving: false, hidden: false, jumpState: null,
      weaponId: weapons ? (RACE_WEAPON[raceId] ?? 'pulse') : 'pulse',
    };
    npc.weaponName = WEAPONS[npc.weaponId].name;

    if (warp) {
      npc.warp = warp.createHandle(group, raceId);
      npc.warpName = npc.warp.sig.name;
      if ((arrival ?? 'warp') === 'warp') {
        npc.warping = npc.arriving = true;
        beacon.visible = false;
        warp.warpIn(npc.warp, { onDone: () => finishArrival(npc) });
      }
    }

    npc.actor = {
      side: side === 'ally' ? 'ally' : 'hostile',
      get position() { return group.position; },
      get radius() { return npc.radius; },
      isAlive: () => npc.alive && !npc.hidden,
      takeDamage: (amount) => damage(npc, amount),
    };
    combat.register(npc.actor);
    list.push(npc);

    // model wczytywany asynchronicznie - NPC działa (i jest widoczny jako
    // beacon) zanim model dojdzie
    loadModel(def.file).then((model) => {
      if (!npc.alive || !group.parent) return;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -center.y, -center.z);
      const inner = new THREE.Group();
      inner.rotation.y = visualYawFor(def);
      inner.add(model);
      group.add(inner);

      const diag = size.length();
      npc.radius = diag * 0.3;
      npc.offsetScale = THREE.MathUtils.clamp(npc.radius / 25, 1, 1.6);
      const light = new THREE.PointLight(0xbfe4ff, 400 * (diag / 25) ** 2, diag * 6, 2);
      light.position.set(0, diag * 0.2, diag * 0.15);
      group.add(light);
      npc.light = light;
      npc.ready = true;
      if (npc.warp) warp.bindModel(npc.warp, model, size);
    }).catch((err) => console.error('NPC: nie udało się wczytać modelu', def.file, err));

    return npc;
  }

  function damage(npc, amount) {
    if (!npc.alive) return;
    npc.hull -= Math.max(1, amount - npc.armor * 0.5);
    if (npc.hull <= 0) { kill(npc); return; }
    if (npc.canFlee && npc.mode !== 'flee' && npc.hull < npc.maxHull * 0.25) {
      npc.mode = 'flee';
      emit('retreat', npc);
    }
  }

  function kill(npc) {
    npc.alive = false;
    combat.flash(npc.group.position, npc.radius * 3 + 30, 0xffa640, 0.9);
    combat.flash(npc.group.position, npc.radius * 1.4 + 12, 0xffffff, 0.35);
    remove(npc);
    emit('killed', npc);
  }

  function finishArrival(npc) {
    npc.warping = npc.arriving = npc.hidden = false;
    npc.beacon.visible = true;
    npc.group.visible = true;
    npc.speed = Math.min(npc.maxSpeed, 160);
  }

  /** Odlot przez fałdę (albo zwykłe zniknięcie bez napędu). */
  function depart(npc) {
    if (!npc.alive || (npc.warping && !npc.arriving)) return;
    if (!warp) { remove(npc); emit('left', npc); return; }
    npc.warping = true;
    warp.warpOut(npc.warp, { speed: npc.speed, onDone: () => { remove(npc); emit('left', npc); } });
  }

  /**
   * Gracz wszedł w fałdę: sojusznicy w eskorcie/formacji skaczą za nim.
   * Wychodzą z fałdy dopiero, gdy gracz jest już po drugiej stronie
   * (arriveJump), na swoich miejscach w szyku.
   */
  function followJump() {
    if (!warp) return;
    for (const n of list) {
      if (!n.alive || n.side === 'hostile' || n.warping) continue;
      if (n.mode !== 'escort' && n.mode !== 'formation') continue;
      n.warping = true;
      n.jumpState = 'out';
      warp.warpOut(n.warp, {
        speed: Math.max(n.speed, 120),
        alignTo: player.quaternion, // w fałdę równolegle do gracza, nie pod prąd
        onDone: () => { n.hidden = true; n.jumpState = n.jumpState === 'arrive' ? 'arrive-now' : 'waiting'; },
      });
    }
  }
  function arriveJump() {
    for (const n of list) {
      if (!n.jumpState) continue;
      if (n.jumpState === 'waiting') n.jumpState = 'arrive-now';
      else if (n.jumpState === 'out') n.jumpState = 'arrive';
    }
  }
  const _slot = new THREE.Vector3();
  function landAfterJump(npc, index) {
    const off = npc.mode === 'escort' ? _v.set(160, 30, 280) : npc.offset;
    // sojusznik wychodzi z fałdy lekko przed swoim miejscem w szyku i z opóźnieniem
    _slot.copy(off).multiplyScalar(npc.offsetScale).add(_tp.set(0, 0, -260 - 90 * index))
      .applyQuaternion(player.quaternion).add(player.position);
    npc.group.position.copy(_slot);
    npc.group.quaternion.copy(player.quaternion);
    npc.jumpState = null;
    npc.arriving = true;
    warp.warpIn(npc.warp, { onDone: () => finishArrival(npc) });
  }

  function remove(npc) {
    if (npc.warp) warp.release(npc.warp);
    scene.remove(npc.group);
    combat.unregister(npc.actor);
    const i = list.indexOf(npc);
    if (i >= 0) list.splice(i, 1);
  }

  function steer(npc, targetPoint, desiredSpeed, dt) {
    const pos = npc.group.position;
    const dist = pos.distanceTo(targetPoint);
    if (dist > 1e-3) {
      lookQuat(pos, targetPoint, _q);
      npc.group.quaternion.rotateTowards(_q, npc.turnRate * dt);
    }
    npc.speed += THREE.MathUtils.clamp(desiredSpeed - npc.speed, -npc.accel * dt, npc.accel * dt);
    _fwd.copy(FWD).applyQuaternion(npc.group.quaternion);
    npc.velocity.copy(_fwd).multiplyScalar(npc.speed);
    pos.addScaledVector(npc.velocity, dt);
    return dist;
  }

  function fireAt(npc, targetPos, targetVel) {
    const pos = npc.group.position;
    const dist = pos.distanceTo(targetPos);
    _aim.copy(targetPos).addScaledVector(targetVel, dist / BOLT_SPEED);
    _dir.copy(_aim).sub(pos).normalize();
    _dir.x += rand(-0.02, 0.02); _dir.y += rand(-0.02, 0.02); _dir.z += rand(-0.02, 0.02);
    _dir.normalize();
    const origin = pos.clone().addScaledVector(_dir, npc.radius * 1.1 + 6);
    combat.fire({
      origin, direction: _dir.clone(), side: npc.side === 'ally' ? 'ally' : 'hostile',
      speed: BOLT_SPEED, damage: npc.side === 'ally' ? 9 : 10, color: BOLT_COLOR[npc.side], life: 2.4, shooter: npc,
      hitScale: 2.2, // pociski NPC mają szerszy "kanał trafienia" (mały myśliwiec gracza ma promień ~7 j.)
    });
  }

  function updateFormation(npc, offset, dt) {
    player.getVelocity(_pv);
    const ps = _pv.length();
    _tp.copy(offset).multiplyScalar(npc.offsetScale).applyQuaternion(player.quaternion).add(player.position);
    const d = npc.group.position.distanceTo(_tp);
    if (d < 80 * npc.offsetScale) {
      // blisko punktu formacji: dopasuj kierunek i prędkość do gracza
      npc.group.quaternion.rotateTowards(player.quaternion, npc.turnRate * dt * 2);
      npc.group.position.lerp(_tp, Math.min(1, 2.5 * dt));
      npc.speed = ps;
      npc.velocity.copy(_pv);
    } else {
      steer(npc, _tp, Math.min(npc.maxSpeed, ps + d * 0.8), dt);
    }
  }

  function updateAttackRun(npc, targetPos, getTargetVel, dt, targetRef = null) {
    const ai = npc.ai;
    const pos = npc.group.position;
    const dist = pos.distanceTo(targetPos);
    ai.timer += dt;
    npc.fireCooldown -= dt;

    if (ai.phase === 'run') {
      getTargetVel(_pv);
      _aim.copy(targetPos).addScaledVector(_pv, Math.min(dist / npc.maxSpeed, 2));
      steer(npc, _aim, dist > 700 ? npc.maxSpeed : npc.maxSpeed * 0.6, dt);

      _fwd.copy(FWD).applyQuaternion(npc.group.quaternion);
      _dir.copy(targetPos).sub(pos).normalize();
      if (weapons) {
        if (npc.fireCooldown <= 0) {
          const cd = weapons.npcFire(npc, {
            weaponId: npc.weaponId, targetPos, targetVel: _pv, targetRef,
            dist, alignCos: _fwd.dot(_dir), color: BOLT_COLOR[npc.side],
          });
          if (cd != null) npc.fireCooldown = cd;
        }
      } else if (dist < 1500 && _fwd.dot(_dir) > 0.985 && npc.fireCooldown <= 0) {
        fireAt(npc, targetPos, _pv);
        npc.fireCooldown = rand(0.6, 0.95);
      }
      if (dist < 240 || ai.timer > 9) {
        ai.phase = 'break'; ai.timer = 0;
        _dir.set(rand(-1, 1), rand(-0.4, 0.4), rand(-1, 1)).normalize();
        ai.breakPoint.copy(targetPos).addScaledVector(_dir, rand(1000, 1400));
      }
    } else {
      steer(npc, ai.breakPoint, npc.maxSpeed, dt);
      if (ai.timer > 3.2 || pos.distanceTo(ai.breakPoint) < 80) { ai.phase = 'run'; ai.timer = 0; }
    }
  }

  function nearestHostile(from, maxDist) {
    let best = null, bestD = maxDist;
    for (const n of list) {
      if (n.side !== 'hostile' || !n.alive) continue;
      const d = n.group.position.distanceTo(from);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  // cel dla rakiet/torped NPC lecących w gracza (prędkość czytana na żywo)
  const _plVel = new THREE.Vector3();
  const playerTarget = {
    position: player.position,
    get velocity() { return player.getVelocity(_plVel); },
    isAlive: () => player.isAlive(),
  };

  function update(dt) {
    let landing = 0;
    for (const npc of [...list]) {
      if (!npc.alive) continue;
      if (npc.jumpState === 'arrive-now') { landAfterJump(npc, landing++); continue; }
      if (npc.warping) continue; // w trakcie sekwencji fałdy pozycję prowadzi napęd, nie AI
      switch (npc.mode) {
        case 'formation':
          updateFormation(npc, npc.offset, dt);
          break;
        case 'escort': {
          const foe = nearestHostile(npc.group.position, 3500);
          if (foe) {
            updateAttackRun(npc, foe.group.position, (out) => out.copy(foe.velocity), dt,
              { position: foe.group.position, velocity: foe.velocity, isAlive: () => foe.alive && !foe.hidden });
          } else {
            updateFormation(npc, _v.set(160, 30, 280), dt); // za graczem, po prawej
          }
          break;
        }
        case 'attack':
          if (player.isAlive()) {
            updateAttackRun(npc, player.position, (out) => player.getVelocity(out), dt, playerTarget);
          } else {
            npc.mode = 'idle';
          }
          break;
        case 'flee': {
          npc.fleeT += dt;
          _tp.copy(npc.group.position).sub(player.position);
          if (_tp.lengthSq() < 1) _tp.set(0, 0, 1);
          _tp.normalize().multiplyScalar(4000).add(npc.group.position);
          steer(npc, _tp, npc.maxSpeed, dt);
          if (warp && npc.fleeT > 2.2) {
            depart(npc); // odlot przez fałdę: krótki rozbieg i skok
          } else if (npc.fleeT > 14 || npc.group.position.distanceTo(player.position) > 6500) {
            remove(npc);
            emit('left', npc);
          }
          break;
        }
        default: // idle: dryf prosto
          _tp.copy(FWD).applyQuaternion(npc.group.quaternion).multiplyScalar(1000).add(npc.group.position);
          steer(npc, _tp, npc.speed * 0.99, dt);
      }
    }
  }

  function clear() {
    for (const n of [...list]) { n.alive = false; remove(n); }
  }

  return {
    spawn, update, remove, clear, depart, followJump, arriveJump,
    setMode(npc, mode) { npc.mode = mode; if (mode === 'flee') npc.fleeT = 0; },
    hostiles: () => list.filter((n) => n.side === 'hostile' && n.alive),
    list,
    on(type, fn) { listeners[type].push(fn); },
  };
}
