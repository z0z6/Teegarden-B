import * as THREE from 'three';
import { createDroneRenderer, createSparks } from './economy-visuals.js';
import { surfacePoint, hashString, seededRng } from './asteroid-belt.js';
import { DRONE_TYPES, EXPEDITION } from '../data/command.js';
import { VISIBLE_PHASES } from './command.js';

/**
 * WIDOK Z MOSTKA (krok 12): kamera na mostku siedziby, drony wypraw w 3D
 * i okienko podglądu ("skrót" lotu), a do tego podgląd zdalny bitwy.
 *
 *  - MOSTEK: kamera tuż przed szybą wieży siedziby (command.js HQ.bridge),
 *    patrzy nad pokładem hangaru na pas. Delikatny ruch i paralaksa myszy.
 *    Na wejściu (intro) - najazd z zewnątrz stacji na mostek.
 *  - DRONY WYPRAW: szyk wokół środka grupy (command.pose), przy skale drony
 *    siedzą na powierzchni i sypią iskrami.
 *  - OKIENKO (PiP): drugi render sceny do prostokąta #pip-view. Wylot:
 *    ujęcie z zewnątrz stacji (drony-"duchy" ponownie wylatują z hangaru),
 *    potem ujęcie przy skale (prawdziwe drony dolatują). Powrót: odlot od
 *    skały, potem przylot do huty z daleka. Duchy są na warstwie 1, której
 *    kamera mostka nie rysuje.
 *  - PODGLĄD ZDALNY: kamera krąży nad punktem (bitwa floty) - gracz ogląda
 *    starcie zamiast siadać za sterami.
 */

const GHOST_LAYER = 1;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _Y = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);

export function createCommandView({ scene, renderer, camera, cameraRig, command, economy, background, quality = 1, pipEl = null, pipLabel = null }) {
  const drones = createDroneRenderer(scene, 400);
  const ghosts = createDroneRenderer(scene, 60, { scale: 2.4 });
  for (const o of scene.children.slice(-2)) o.layers.set(GHOST_LAYER); // instancje + świetliki duchów
  const sparks = createSparks(scene, quality < 0.8 ? 200 : 500);
  const pipCam = new THREE.PerspectiveCamera(42, 16 / 9, 2, 500000);
  pipCam.layers.enable(GHOST_LAYER);
  // światła siedziby: reflektory pokładu hangaru (bez nich z mostka widać czarną bryłę pod szybą)
  const deckLight = new THREE.PointLight(0xffe6c0, 60000, 1400, 2);
  const mouthLight = new THREE.PointLight(0x9fd8ff, 40000, 900, 2);
  scene.add(deckLight, mouthLight);
  const colors = Object.fromEntries(Object.entries(DRONE_TYPES).map(([k, d]) => [k, new THREE.Color(d.color)]));

  // ------------------------------------------------------------
  // KAMERA MOSTKA
  // ------------------------------------------------------------
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; });
  let t = 0;
  let intro = null; // { t, dur, from: {pos, quat} }
  const bridge = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };

  function bridgePose(out = bridge) {
    const f = command.frame();
    if (!f) return null;
    out.pos.copy(command.bridgePos());
    // patrz nad pokładem hangaru w stronę pasa, lekko w dół
    _v.copy(out.pos).addScaledVector(f.fwd, 1000).addScaledVector(_Y, -115);
    _m.lookAt(out.pos, _v, _Y);
    out.quat.setFromRotationMatrix(_m);
    return out;
  }
  /** Najazd z zewnątrz stacji na mostek (start gry, powrót zza sterów). */
  function startIntro({ dur = 5.5, from = null } = {}) {
    const f = command.frame();
    if (!f) return;
    const pos = from?.pos?.clone() ?? f.pos.clone().addScaledVector(f.fwd, 1900).addScaledVector(f.side, -900).addScaledVector(_Y, 420);
    let quat = from?.quat?.clone();
    if (!quat) { _m.lookAt(pos, f.pos.clone().addScaledVector(_Y, 60), _Y); quat = new THREE.Quaternion().setFromRotationMatrix(_m); }
    intro = { t: 0, dur, pos, quat };
  }
  function updateBridge(dt) {
    if (!bridgePose()) return;
    mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 2.5);
    mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 2.5);
    // oddech stacji + paralaksa myszy (rozglądanie się po mostku)
    _q.setFromEuler(new THREE.Euler(-mouse.sy * 0.09 + Math.sin(t * 0.21) * 0.006, -mouse.sx * 0.16 + Math.sin(t * 0.13) * 0.01, 0, 'YXZ'));
    const pos = _w.copy(bridge.pos).add(_u.set(Math.sin(t * 0.3) * 1.2, Math.sin(t * 0.47) * 0.8, 0));
    const quat = bridge.quat.clone().multiply(_q);
    if (intro) {
      intro.t += dt;
      const k = smooth(Math.min(1, intro.t / intro.dur));
      cameraRig.position.copy(intro.pos).lerp(pos, k);
      cameraRig.quaternion.copy(intro.quat).slerp(quat, k);
      if (intro.t >= intro.dur) intro = null;
    } else {
      cameraRig.position.copy(pos);
      cameraRig.quaternion.copy(quat);
    }
    cameraRig.up.set(0, 1, 0);
  }

  // ------------------------------------------------------------
  // PODGLĄD ZDALNY (bitwa floty)
  // ------------------------------------------------------------
  let spectate = null; // { point(): Vector3, ang, r, label }
  const _sp = new THREE.Vector3();
  function updateSpectate(dt) {
    const p = spectate.point?.() ?? null;
    if (p) spectate.at.lerp(p, Math.min(1, dt * 1.2));
    spectate.ang += dt * 0.07;
    const r = spectate.r;
    _sp.set(Math.cos(spectate.ang) * r, r * 0.42, Math.sin(spectate.ang) * r).add(spectate.at);
    cameraRig.position.lerp(_sp, Math.min(1, dt * 1.5));
    _m.lookAt(cameraRig.position, spectate.at, _Y);
    _q.setFromRotationMatrix(_m);
    cameraRig.quaternion.slerp(_q, Math.min(1, dt * 3));
  }

  // ------------------------------------------------------------
  // DRONY WYPRAW
  // ------------------------------------------------------------
  const _c = new THREE.Vector3(), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _loc = new THREE.Vector3(), _iq = new THREE.Quaternion();
  const jitter = new Map(); // expId -> [ {x,y,z} ] (stałe losowe przesunięcia w szyku)
  function offsets(e) {
    let j = jitter.get(e.id);
    if (!j || j.length < e.n0) {
      const r = seededRng(hashString(e.id));
      j = [];
      for (let i = 0; i < Math.max(e.n0, 1); i++) {
        const a = i * 2.39996, rad = 16 * Math.sqrt(i + 0.5);
        j.push({ x: Math.cos(a) * rad, y: (r() - 0.5) * 14, z: Math.sin(a) * rad, s: r(), d: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5) });
      }
      jitter.set(e.id, j);
    }
    return j;
  }
  /** Położenie drona `i` wyprawy `e` (null = poza przestrzenią). */
  function dronePos(e, i, out, dirOut) {
    if (!command.pose(e, _c, _dir)) return null;
    const j = offsets(e)[i];
    const info = command.targetInfo(e);
    if ((e.phase === 'praca' || e.phase === 'pelne') && info.ast && DRONE_TYPES[e.type].hold > 0) {
      // na powierzchni: kierunek od skały do grupy + rozrzut, w lokalnym układzie skały
      const a = info.ast;
      _v.copy(_c).sub(a.position).normalize().addScaledVector(j.d, 1.3).normalize();
      if (a.mesh) { _iq.copy(a.mesh.quaternion).invert(); _loc.copy(_v).applyQuaternion(_iq); } else _loc.copy(_v);
      surfacePoint(a, _loc, e.phase === 'pelne' ? 40 : 6, out);
      if (dirOut) dirOut.copy(_v).negate();
      return out;
    }
    // szyk: płaski dysk prostopadły do kierunku lotu
    _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _dir.lengthSq() > 0 ? _dir : _Y);
    out.set(j.x, j.y, j.z * 0.5).applyQuaternion(_q).add(_c);
    if (e.phase === 'straz') out.addScaledVector(_v.set(Math.sin(t * 0.8 + i), Math.cos(t * 0.6 + i * 2), Math.sin(t * 0.5 + i * 3)), 60);
    if (dirOut) dirOut.copy(_dir);
    return out;
  }
  function drawDrones(dt) {
    drones.begin();
    for (const e of command.expeditions()) {
      if (!VISIBLE_PHASES.has(e.phase)) continue;
      const col = colors[e.type];
      const mining = e.phase === 'praca' && DRONE_TYPES[e.type].hold > 0;
      for (let i = 0; i < e.n; i++) {
        if (!dronePos(e, i, _p, _w)) break;
        const pulse = mining ? 0.7 + 0.5 * Math.sin(t * 9 + i) : 1;
        drones.push(_p, _w.lengthSq() > 0 ? _w.normalize() : _Y, mining ? 'wiercenie' : 'lot', pulse, mining ? null : col);
        if (mining && Math.random() < dt * 3) sparks.emit(_p, _w.clone().negate(), '#ffb13d', 3, 24, 0.9, 0.5, 3);
      }
    }
    drones.end();
  }

  // ------------------------------------------------------------
  // OKIENKO PODGLĄDU (PiP)
  // ------------------------------------------------------------
  let cine = null; // { e, kind: 'out'|'back', label }
  const queue = [];
  function onPhase(e, phase) {
    if (phase === 'przelot' || phase === 'odlot') {
      if (cine) { if (cine.e !== e && queue.length < 3) queue.push({ e, phase }); return; }
      cine = { e, kind: phase === 'przelot' ? 'out' : 'back', t: 0 };
      open(true);
    }
    if (cine?.e === e && (phase === 'praca' || phase === 'straz' || phase === 'podejscie' || phase === 'koniec' || phase === 'pelne')) close();
  }
  function close() {
    cine = null;
    open(false);
    // zaległe (inna wyprawa w tym samym czasie): pokaż tylko, jeśli wciąż w fazie skrótu
    while (queue.length) {
      const q = queue.shift();
      if (command.expedition(q.e.id) && (q.e.phase === 'przelot' || q.e.phase === 'odlot')) { cine = { e: q.e, kind: q.e.phase === 'przelot' ? 'out' : 'back', t: 0 }; open(true); break; }
    }
  }
  function open(v) {
    if (!pipEl) return;
    pipEl.classList.toggle('open', v);
    if (v && pipLabel) pipLabel.textContent = cine ? `${cine.e.name} · ${cine.kind === 'out' ? 'wylot' : 'powrót'}` : '';
  }

  /** Ustawia pipCam i duchy dla bieżącego ujęcia. */
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _look = new THREE.Vector3(), _gp = new THREE.Vector3(), _gd = new THREE.Vector3();
  function shot() {
    const e = cine.e;
    const f = command.frame();
    const info = command.targetInfo(e);
    if (!f || !info.pos) return false;
    const hang = command.hangarPos();
    ghosts.begin();
    let sub = '';
    if (e.phase === 'przelot') {
      // ujęcie 1: z zewnątrz stacji - drony wylatują z hangaru i mkną w dal
      const k = e.t;
      // kamera z boku przed wylotem, patrzy na hangar: drony wylatują na nią i mijają ją
      pipCam.position.copy(hang).addScaledVector(f.side, 430).addScaledVector(_Y, 95).addScaledVector(f.fwd, 560);
      _look.copy(hang).addScaledVector(f.fwd, 60 + k * 90).addScaledVector(_Y, 30);
      const col = colors[e.type];
      for (let i = 0; i < e.n; i++) {
        const j = offsets(e)[i];
        const s = Math.max(0, k - j.s * 0.5);
        _a.copy(hang).addScaledVector(f.fwd, s ** 1.8 * 260 + 8).add(_b.set(j.x * 0.8, j.y * 0.6, 0).applyQuaternion(f.quat));
        ghosts.push(_a, f.fwd, 'lot', 1.2, col);
      }
      sub = 'wylot z hangaru siedziby';
    } else if (e.phase === 'dolot' || e.phase === 'odlot') {
      // ujęcie 2: przy skale - dolot albo odlot z urobkiem (prawdziwe drony)
      _a.copy(hang).sub(info.pos).normalize();
      // z boku toru lotu: w kadrze skała i cały dolot (albo odlot) grupy
      pipCam.position.copy(info.pos).addScaledVector(_a, info.radius + 1300).addScaledVector(f.side, 950).addScaledVector(_Y, 320);
      _look.copy(info.pos).addScaledVector(_a, info.radius + 450);
      // prawdziwe drony są tu za małe na okienko - większe "duchy" w ich miejscu
      for (let i = 0; i < e.n; i++) if (dronePos(e, i, _gp, _gd)) ghosts.push(_gp, _gd.lengthSq() ? _gd.normalize() : _Y, 'lot', 1.2, colors[e.type]);
      sub = e.phase === 'dolot' ? `dolot: ${info.name}` : `odlot z urobkiem: ${info.name}`;
    } else if (e.phase === 'powrot') {
      // ujęcie 3: przylot pod hutę / siedzibę z daleka
      const h = command.huta();
      const dock = h && DRONE_TYPES[e.type].hold > 0 ? _b.set(h.pos.x, h.pos.y, h.pos.z) : _b.copy(hang);
      _a.copy(info.pos).sub(dock).normalize();
      const k = Math.min(1, e.t / EXPEDITION.transit);
      // zza huty: huta na pierwszym planie, drony nadlatują z głębi
      pipCam.position.copy(dock).addScaledVector(_a, -380).addScaledVector(f.side, 300).addScaledVector(_Y, 150);
      _look.copy(dock).addScaledVector(_a, 2400);
      const col = colors[e.type];
      for (let i = 0; i < e.n; i++) {
        const j = offsets(e)[i];
        _v.copy(dock).addScaledVector(_a, 4300 - smooth(k) * 1700 + j.s * 60).add(_w.set(j.x, j.y, j.z * 0.5));
        ghosts.push(_v, _u.copy(_a).negate(), 'powrot', 1.2, col);
      }
      sub = h ? 'powrót do huty' : 'powrót do siedziby';
    } else { ghosts.end(); return false; }
    ghosts.end();
    _m.lookAt(pipCam.position, _look, _Y);
    pipCam.quaternion.setFromRotationMatrix(_m);
    if (pipLabel) pipLabel.textContent = `${e.name} · ${sub}`;
    return true;
  }

  function renderPip() {
    if (!cine || !pipEl) return;
    if (!command.expedition(cine.e.id)) { close(); return; }
    if (!shot()) return;
    const r = pipEl.querySelector('.pip-screen')?.getBoundingClientRect() ?? pipEl.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    pipCam.aspect = r.width / r.height;
    pipCam.updateProjectionMatrix();
    pipCam.updateMatrixWorld();
    const H = renderer.domElement.clientHeight;
    background.update(pipCam);
    renderer.setScissorTest(true);
    renderer.setViewport(r.left, H - r.bottom, r.width, r.height);
    renderer.setScissor(r.left, H - r.bottom, r.width, r.height);
    renderer.render(scene, pipCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, renderer.domElement.clientWidth, H);
    background.update(camera);
  }

  // ------------------------------------------------------------
  // PĘTLA
  // ------------------------------------------------------------
  let mode = 'mostek';
  function update(dt, m) {
    mode = m;
    t += dt;
    const f = command.frame();
    const home = economy.systemId === command.state.home;
    deckLight.visible = mouthLight.visible = !!f && home;
    if (f && home) {
      deckLight.position.copy(command.local({ x: 0, y: 150, z: 240 }));
      mouthLight.position.copy(command.local({ x: 0, y: 40, z: 360 }));
    }
    if (mode === 'mostek') updateBridge(dt);
    else if (mode === 'podglad' && spectate) updateSpectate(dt);
    if (economy.systemId === command.state.home) drawDrones(dt);
    else { drones.begin(); drones.end(); }
    if (!cine) { ghosts.begin(); ghosts.end(); }
    sparks.update(dt);
  }

  command.hooks.phase = onPhase;

  return {
    update, renderPip, startIntro, bridgePose, pipCam,
    get introActive() { return !!intro; },
    get cinematic() { return cine; },
    closePip: close,
    /** Podgląd zdalny: point() - środek bitwy (co klatkę), r - promień orbity kamery. */
    spectate(point, { r = 2600, at = null } = {}) {
      const p0 = at ?? point?.() ?? cameraRig.position.clone();
      spectate = { point, r, ang: Math.random() * 6, at: p0.clone() };
    },
    stopSpectate() { spectate = null; },
    dronePos,
    dispose() { drones.dispose(); ghosts.dispose(); sparks.dispose?.(); },
  };
}
