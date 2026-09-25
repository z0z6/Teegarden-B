import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SHIPS, visualYawFor } from '../ships/fleet.js';
import { RACES, shipForRace } from '../data/races.js';
import { RACE_WEAPON, WEAPONS } from './weapons.js';
import { resolveCollisions } from './collision.js';

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
 * Rezonanci Grotem, Szczepieni salwą Trójzęba itd. - z zasięgiem i rytmem tej broni.
 * Bez `weapons` - bolty jak w kroku 5.
 *
 * TAKTYCZNE AI (opcjonalnie, od kroku 9): z `{ tactics }`
 * (shared/systems/tactical-ai.js) NPC dostają "głowę". Nowy tryb:
 *   tactical   decyzje podejmuje mózg (polowanie, posterunek, osłona,
 *              zasadzka, ucieczka, trasa handlowca, wataha) - patrz tactical-ai.js.
 * Tryby 'attack' i 'escort' z kroku 5 same przechodzą pod mózg, więc sceny
 * z encounters.js też walczą mądrzej. Ciało (ten plik) wykonuje intencję:
 * lot do punktu z OMIJANIEM przeszkód (`getObstacles`: gwiazdy, planety,
 * gruz) i SEPARACJĄ od innych NPC, plus twarda bariera kolizji (collision.js,
 * "żelazna zasada" - od teraz dotyczy też NPC). Wrogowie mogą też atakować
 * sojuszników i eskortowane statki, nie tylko gracza.
 * Bez `tactics` wszystko działa jak w krokach 5-8.
 *
 * DODATKOWE KONTAKTY (opcjonalnie, od kroku 10): `getContacts()` zwraca cele
 * spoza listy NPC w tym samym formacie co npc.contact (drony, stacje) -
 * rabusie mogą na nie polować. Pociski trafiają je jako aktorzy combat.js.
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
export function createNpcManager(scene, combat, player, { warp = null, weapons = null, tactics = null, getObstacles = null, getContacts = null } = {}) {
  const list = [];
  const listeners = { killed: [], left: [], retreat: [], disabled: [], hit: [] };
  const emit = (t, p) => listeners[t].forEach((fn) => fn(p));

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // OPTYMALIZACJA (krok 8): trzy poziomy detalu z shared/ships/models
  // (-lod0/-lod1/-lod2). NPC oglądamy zwykle z setek/tysięcy jednostek -
  // Kharath w LOD0 ma 372 tys. trójkątów, w LOD2 22 tys., a z daleka
  // wyglądają tak samo. Brak pliku LOD1/2 = zostaje sam LOD0.
  const modelCache = new Map();
  const loadLevel = (file) => {
    if (!modelCache.has(file)) modelCache.set(file, loader.loadAsync(file).then((g) => g.scene).catch(() => null));
    return modelCache.get(file);
  };
  const LOD_SWITCH = [0, 2.5, 9]; // progi w przekątnych modelu (odległość kamery / rozmiar statku)
  const loadModel = (file) => Promise.all([
    loadLevel(file),
    loadLevel(file.replace('-lod0', '-lod1')),
    loadLevel(file.replace('-lod0', '-lod2')),
  ]).then(([l0, l1, l2]) => {
    if (!l0) throw new Error(`brak modelu ${file}`);
    const levels = [l0, l1, l2].filter(Boolean).map((sc) => sc.clone(true));
    if (levels.length === 1) return levels[0];
    const lod = new THREE.LOD();
    const diag = new THREE.Box3().setFromObject(levels[0]).getSize(new THREE.Vector3()).length();
    levels.forEach((m, i) => lod.addLevel(m, LOD_SWITCH[i] * diag));
    return lod;
  });

  // OPTYMALIZACJA: stała pula świateł doświetlających NPC zamiast światła
  // w KAŻDYM statku. Zmiana liczby świateł w scenie zmusza three.js do
  // rekompilacji shaderów wszystkich oświetlonych materiałów (przycięcie
  // przy każdym pojawieniu się NPC), a każde światło kosztuje w każdym
  // pikselu każdego oświetlonego obiektu. Pula 2 świateł zawsze jest w
  // scenie; co klatkę dostają ją 2 najbliższe gotowe statki.
  const FILL = [0, 1].map(() => {
    const l = new THREE.PointLight(0xbfe4ff, 0, 1, 2);
    scene.add(l);
    return l;
  });
  function updateFillLights() {
    const near = list.filter((n) => n.alive && n.ready && !n.hidden && n.group.visible)
      .map((n) => ({ n, d: n.group.position.distanceToSquared(player.position) }))
      .sort((a, b) => a.d - b.d);
    FILL.forEach((l, i) => {
      const e = near[i];
      if (!e) { l.intensity = 0; return; }
      const diag = e.n.diag;
      l.position.copy(e.n.group.position).add(_fillOff.set(0, diag * 0.2, diag * 0.15));
      l.intensity = 400 * (diag / 25) ** 2;
      l.distance = diag * 6;
    });
  }
  const _fillOff = new THREE.Vector3();

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

  function spawn({
    raceId, factionKey = 'hawk', side, position, shipId, mode = 'idle', offset, maxSpeed, callsign, arrival, facing,
    // krok 9 (wszystko opcjonalne):
    hull = null, combatSpeed = null, turnRate = null, ai = null, stealth = false, role = null, label = null,
    disableAt = 0, noFlee = false, value = 1, tag = null,
  }) {
    const race = RACES[raceId];
    // model losujemy RAZ (shipForRace dla ras bez własnego modelu losuje przy
    // każdym wywołaniu - wołany wewnątrz find() dawał co ~3. raz brak statku)
    const wantId = shipId ?? shipForRace(raceId);
    const def = SHIPS.find((s) => s.id === wantId);

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

    const maxHull = hull ?? (side === 'ally' ? 160 : 140) * (race.ship.hull / 100);
    // krok 9: pilotaż rasy (atrybut z karty) = szybkość i zwrotność
    const pilotMul = tactics ? 1 + 0.04 * (race.attrs.pilot - 5) : 1;
    const npc = {
      id: `npc-${nextId++}`,
      raceId, raceName: race.name, factionKey, factionName: race.factions[factionKey],
      side, def, shipName: def.name,
      callsign: `${callsign ?? CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)]}-${1 + Math.floor(Math.random() * 9)}`,
      group, velocity: new THREE.Vector3(), speed: 0,
      maxSpeed: (maxSpeed ?? (side === 'ally' ? 700 : 220)) * pilotMul, accel: 260, turnRate: (turnRate ?? 1.7) * pilotMul,
      combatSpeed: (combatSpeed ?? (side === 'ally' ? 280 : 220)) * pilotMul,
      hull: maxHull, maxHull, armor: race.ship.armor, radius: 14,
      alive: true, mode, offset: (offset ?? new THREE.Vector3(200, 20, -250)).clone(), offsetScale: 1,
      ai: { phase: 'run', timer: 0, breakPoint: new THREE.Vector3() },
      fireCooldown: rand(0.8, 1.6), canFlee: side === 'hostile' && !noFlee, fleeT: 0, ready: false,
      // krok 9: rola w misji (np. 'trader'), ukrycie (zasadzka), unieruchomienie (abordaż)
      role, label, stealth, disableAt, disabled: false, tag, brain: null,
      regen: race.hullRegenPct ?? 0, sinceHit: 99,
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
      takeDamage: (amount, shooter) => damage(npc, amount, shooter),
    };
    combat.register(npc.actor);

    // KONTAKT (krok 9): to, jak ten statek widzą inni - wspólny format dla
    // gracza i NPC. Pola "na żywo" (te same wektory), więc może też służyć
    // za cel naprowadzania rakiet (position / velocity / isAlive).
    npc.forward = new THREE.Vector3(0, 0, -1).applyQuaternion(group.quaternion);
    npc.contact = {
      id: npc.id, kind: 'npc', npc, value,
      get side() { return npc.side === 'neutral' ? 'neutral' : npc.actor.side; },
      position: group.position, velocity: npc.velocity, forward: npc.forward,
      get hullFrac() { return npc.hull / npc.maxHull; },
      get radius() { return npc.radius; },
      recentAttackers: new Map(),
      isAlive: () => npc.alive && !npc.hidden,
    };
    if (tactics && ai) tactics.attach(npc, ai);
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
      npc.diag = diag; // światło doświetlające przydziela pula (updateFillLights)
      npc.ready = true;
      if (npc.warp) warp.bindModel(npc.warp, model, size);
    }).catch((err) => console.error('NPC: nie udało się wczytać modelu', def.file, err));

    return npc;
  }

  /** Kontakt strzelca (NPC albo gracz) - kto nas trafił. */
  function shooterContact(shooter) {
    if (!shooter) return null;
    if (shooter.contact) return shooter.contact;
    if (shooter.isPlayer) return playerContact;
    return null;
  }

  function damage(npc, amount, shooter = null) {
    if (!npc.alive) return;
    const dealt = Math.max(1, amount - npc.armor * 0.5);
    npc.hull -= dealt;
    npc.sinceHit = 0;
    const sc = shooterContact(shooter);
    if (sc) npc.contact.recentAttackers.set(sc, tactics?.time ?? 0);
    if (tactics && npc.brain) tactics.reportHit(npc, sc, dealt);
    emit('hit', { npc, amount: dealt, shooter: sc });
    if (npc.hull <= 0) { kill(npc); return; }
    // krok 9: unieruchomienie (misja przechwycenia) - napęd pada, statek dryfuje
    if (npc.disableAt > 0 && !npc.disabled && npc.hull < npc.maxHull * npc.disableAt) {
      npc.disabled = true;
      emit('disabled', npc);
    }
    // z mózgiem o odwrocie decyduje ocena ryzyka (tactical-ai.js), nie sztywny próg
    if (!npc.brain && npc.canFlee && npc.mode !== 'flee' && npc.hull < npc.maxHull * 0.25) {
      npc.mode = 'flee';
      emit('retreat', npc);
    }
  }

  /** Odwrót (decyzja mózgu albo misji): flee + zdarzenie 'retreat'. */
  function retreat(npc) {
    if (!npc.alive || npc.mode === 'flee') return;
    npc.mode = 'flee';
    npc.fleeT = 0;
    emit('retreat', npc);
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
    if (tactics && npc.brain) tactics.detach(npc);
    if (npc.warp) warp.release(npc.warp);
    scene.remove(npc.group);
    combat.unregister(npc.actor);
    const i = list.indexOf(npc);
    if (i >= 0) list.splice(i, 1);
  }

  // ------------------------------------------------------------
  // OMIJANIE PRZESZKÓD I SEPARACJA (krok 9)
  // ------------------------------------------------------------
  // Przeszkody (gwiazdy, planety, gruz) czytane RAZ na klatkę. Każdy NPC
  // "patrzy" wzdłuż kursu na ~2,5 s do przodu: jeśli tor przechodzi przez
  // ciało (z marginesem), kierunek jest odpychany w bok od niego. Do tego
  // miękkie odpychanie od innych NPC - eskadra nie zlewa się w jeden punkt.
  let obstacles = [];
  const _av = new THREE.Vector3(), _ao = new THREE.Vector3(), _ap = new THREE.Vector3(), _want = new THREE.Vector3();
  function avoid(npc, targetPoint, out) {
    const pos = npc.group.position;
    _want.copy(targetPoint).sub(pos);
    const wd = _want.length();
    if (wd < 1e-3) return out.copy(targetPoint);
    _want.divideScalar(wd);
    _fwd.copy(FWD).applyQuaternion(npc.group.quaternion);
    const look = Math.max(npc.speed, 120) * 2.5 + npc.radius * 4;
    let pushed = false;
    for (const o of obstacles) {
      _ao.copy(o.position).sub(pos);
      const clearance = o.radius + npc.radius + Math.max(60, o.radius * 0.15);
      const dist = _ao.length();
      if (dist - o.radius > look + 200) continue;
      if (dist < clearance * 1.05) { // już przy powierzchni: prosto od środka
        _want.addScaledVector(_ao, -2.5 / Math.max(dist, 1e-3));
        pushed = true;
        continue;
      }
      const t = _ao.dot(_fwd);
      if (t <= 0 || t > look + o.radius) continue;
      _ap.copy(_fwd).multiplyScalar(t).sub(_ao); // od środka przeszkody do punktu na kursie
      const miss = _ap.length();
      if (miss >= clearance) continue;
      if (miss < 1e-3) _ap.set(0, 1, 0).cross(_fwd); // dokładnie w środek: w bok
      const w = (1 - miss / clearance) * (1 - Math.min(t / (look + o.radius), 1)) * 4;
      _want.addScaledVector(_ap.normalize(), w);
      pushed = true;
    }
    for (const other of list) {
      if (other === npc || !other.alive || other.hidden) continue;
      _ao.copy(pos).sub(other.group.position);
      const minD = (npc.radius + other.radius) * 2.5 + 40;
      const d2 = _ao.lengthSq();
      if (d2 > minD * minD || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      _want.addScaledVector(_ao, (1 - d / minD) * 1.5 / d);
      pushed = true;
    }
    if (!pushed) return out.copy(targetPoint);
    return out.copy(pos).addScaledVector(_want.normalize(), Math.max(wd, 400));
  }

  function steer(npc, targetPoint, desiredSpeed, dt) {
    const pos = npc.group.position;
    const dist = pos.distanceTo(targetPoint);
    if (getObstacles) targetPoint = avoid(npc, targetPoint, _av);
    if (dist > 1e-3) {
      lookQuat(pos, targetPoint, _q);
      npc.group.quaternion.rotateTowards(_q, npc.turnRate * dt);
    }
    npc.speed += THREE.MathUtils.clamp(desiredSpeed - npc.speed, -npc.accel * dt, npc.accel * dt);
    _fwd.copy(FWD).applyQuaternion(npc.group.quaternion);
    npc.velocity.copy(_fwd).multiplyScalar(npc.speed);
    pos.addScaledVector(npc.velocity, dt);
    // żelazna zasada (collision.js): NPC też nigdy nie wchodzi w ciało stałe
    if (getObstacles && resolveCollisions(pos, npc.radius, obstacles).collided) npc.speed *= Math.max(0, 1 - 6 * dt);
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

  // ------------------------------------------------------------
  // KROK 9: kontakty i wykonanie intencji mózgu
  // ------------------------------------------------------------
  const playerContact = {
    id: 'player', kind: 'player', side: 'player', value: 1,
    position: player.position, velocity: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1),
    get hullFrac() { return player.getHullFrac?.() ?? 1; },
    get radius() { return player.getRadius?.() ?? 10; },
    recentAttackers: new Map(),
    isAlive: () => player.isAlive(),
  };
  const world = { contacts: [], player: playerContact, time: 0 };

  function buildWorld() {
    player.getVelocity(playerContact.velocity);
    playerContact.forward.set(0, 0, -1).applyQuaternion(player.quaternion);
    world.contacts.length = 0;
    world.contacts.push(playerContact);
    for (const n of list) {
      n.forward.set(0, 0, -1).applyQuaternion(n.group.quaternion);
      if (n.alive && !n.hidden && !n.stealth && !n.arriving) world.contacts.push(n.contact);
    }
    // krok 10: cele spoza listy NPC (drony górnicze, stacje) - widzą je mózgi
    // wrogów; bez `getContacts` wszystko jak w krokach 5-9
    if (getContacts) for (const c of getContacts()) world.contacts.push(c);
    world.time = tactics?.time ?? 0;
  }

  /** Gracz oberwał od NPC - dla osłony watahy ("kto bije lidera"). */
  function reportPlayerHit(shooter) {
    const sc = shooterContact(shooter);
    if (sc) playerContact.recentAttackers.set(sc, tactics?.time ?? 0);
  }

  function tryFire(npc, t) {
    const pos = npc.group.position;
    const dist = pos.distanceTo(t.position);
    _fwd.copy(FWD).applyQuaternion(npc.group.quaternion);
    _dir.copy(t.position).sub(pos).normalize();
    if (weapons) {
      if (npc.fireCooldown > 0) return;
      const cd = weapons.npcFire(npc, {
        weaponId: npc.weaponId, targetPos: t.position, targetVel: t.velocity, targetRef: t,
        dist, alignCos: _fwd.dot(_dir), color: BOLT_COLOR[npc.side],
      });
      if (cd != null) npc.fireCooldown = cd;
    } else if (dist < 1500 && _fwd.dot(_dir) > 0.985 && npc.fireCooldown <= 0) {
      fireAt(npc, t.position, t.velocity);
      npc.fireCooldown = rand(0.6, 0.95);
    }
  }

  function runBrain(npc, dt) {
    npc.fireCooldown -= dt;
    const I = tactics.decide(npc, dt, world);
    if (I.retreat) { retreat(npc); return; }
    if (I.warpOut) { depart(npc); return; }
    if (I.formation) { updateFormation(npc, I.formation, dt); if (I.fire) tryFire(npc, I.fire); return; }
    if (I.drift) {
      npc.speed = Math.max(0, npc.speed - npc.accel * 0.4 * dt);
      _fwd.copy(FWD).applyQuaternion(npc.group.quaternion);
      npc.velocity.copy(_fwd).multiplyScalar(npc.speed);
      npc.group.position.addScaledVector(npc.velocity, dt);
      return;
    }
    if (I.hold) {
      npc.speed = Math.max(0, npc.speed - npc.accel * dt);
      lookQuat(npc.group.position, I.point, _q);
      npc.group.quaternion.rotateTowards(_q, npc.turnRate * 0.3 * dt);
      npc.velocity.set(0, 0, 0);
      return;
    }
    steer(npc, I.point, Math.min(I.speed, npc.maxSpeed), dt);
    if (I.fire && !npc.disabled) tryFire(npc, I.fire);
  }

  function update(dt) {
    updateFillLights();
    if (getObstacles) obstacles = getObstacles() ?? [];
    if (tactics) {
      buildWorld();
      tactics.update(dt, world);
    }
    let landing = 0;
    for (const npc of [...list]) {
      if (!npc.alive) continue;
      if (npc.jumpState === 'arrive-now') { landAfterJump(npc, landing++); continue; }
      if (npc.warping) continue; // w trakcie sekwencji fałdy pozycję prowadzi napęd, nie AI
      // regeneracja kadłuba ras, które ją mają (Szczepieni) - 5 s po trafieniu
      npc.sinceHit += dt;
      if (npc.regen > 0 && npc.sinceHit > 5 && npc.hull < npc.maxHull) {
        npc.hull = Math.min(npc.maxHull, npc.hull + npc.maxHull * (npc.regen / 100) * 4 * dt);
      }
      // stare tryby walki przechodzą pod mózg, jeśli jest taktyka
      if (tactics && !npc.brain && (npc.mode === 'attack' || npc.mode === 'escort')) {
        tactics.attach(npc, npc.mode === 'attack'
          ? { base: 'hunt' }
          : { base: 'guard', protect: playerContact, guardR: 3500 });
      }
      if (tactics && npc.brain && (npc.mode === 'tactical' || npc.mode === 'attack' || npc.mode === 'escort')) {
        if (npc.mode === 'attack' && !player.isAlive() && npc.brain.base === 'hunt') { npc.mode = 'idle'; continue; }
        runBrain(npc, dt);
        continue;
      }
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
          // sojusznik ucieka od najbliższego wroga, wróg - od gracza
          const from = npc.side === 'hostile' ? player.position : (nearestHostile(npc.group.position, 6000)?.group.position ?? player.position);
          _tp.copy(npc.group.position).sub(from);
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

  /** Usuwa NPC; `keep(npc)` = true oszczędza (krok 9: wataha przeżywa reset scen). */
  function clear(keep = null) {
    for (const n of [...list]) { if (keep?.(n)) continue; n.alive = false; remove(n); }
    playerContact.recentAttackers.clear();
  }

  return {
    spawn, update, remove, clear, depart, followJump, arriveJump, retreat, reportPlayerHit,
    setMode(npc, mode) { npc.mode = mode; if (mode === 'flee') npc.fleeT = 0; },
    // ukryci (zasadzka) nie są "widoczni" dla namierzania gracza
    hostiles: () => list.filter((n) => n.side === 'hostile' && n.alive && !n.stealth),
    allies: () => list.filter((n) => n.side === 'ally' && n.alive),
    byTag: (tag) => list.filter((n) => n.tag === tag && n.alive),
    playerContact, world,
    list,
    on(type, fn) { listeners[type].push(fn); },
  };
}
