// Bezgłowa symulacja kroku 9 (Node, bez przeglądarki i bez renderu):
//   npm i three@0.184.0   (raz, np. katalog wyżej - repo nie ma package.json)
//   node step9-missions/check.mjs
//
// Prawdziwe moduły: combat, weapons, npc-ships, tactical-ai, wolfpack, missions.
// Gracza zastępuje prosty BOT (autopilot + działko). Modele .glb się nie
// wczytują (brak sieci/DOM) - NPC mają wtedy promień domyślny, jak w grze
// zanim model dojdzie. Fałdy nie ma (NPC pojawiają się i znikają od razu).
import * as THREE from 'three';

// --- minimalne DOM dla tekstur z canvasa ---
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, style: {} }) };
globalThis.window = { innerWidth: 1280, innerHeight: 720 };
const origErr = console.error;
console.error = (...a) => { if (String(a[0]).includes('NPC: nie udało się wczytać modelu')) return; origErr(...a); };

const { createCombat } = await import('../shared/systems/combat.js');
const { createWeapons, PLAYER_SHOOTER } = await import('../shared/systems/weapons.js');
const { createNpcManager } = await import('../shared/systems/npc-ships.js');
const { createTactics } = await import('../shared/systems/tactical-ai.js');
const { createWolfpack } = await import('../shared/systems/wolfpack.js');
const { createMissions, MISSION_ORDER } = await import('../shared/systems/missions.js');
const { deriveStats } = await import('../shared/data/races.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };

// deterministyczny rng (ten sam wynik przy każdym uruchomieniu)
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function makeWorld({ seed = 1, raceId = 'piesniarze', invulnerable = false, obstacles = [], difficulty = 'normalna' } = {}) {
  const rng = mulberry(seed);
  Math.random = mulberry(seed * 7 + 3); // losowość w walce/broni też powtarzalna
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const combat = createCombat(scene);
  const weapons = createWeapons({ scene, combat, camera });
  const ship = new THREE.Object3D();
  ship.position.set(0, 0, 0);
  const stats = deriveStats(raceId);
  const ps = { raceId, hull: stats.hull, maxHull: stats.hull, armor: stats.armor, cargo: 10, alive: true };
  let speed = 0, speedCap = 1, warpJam = false;
  const events = [];
  const player = {
    position: ship.position, quaternion: ship.quaternion,
    getVelocity: (out) => out.set(0, 0, -1).applyQuaternion(ship.quaternion).multiplyScalar(speed),
    isAlive: () => ps.alive, getHullFrac: () => ps.hull / ps.maxHull, getRadius: () => 8,
  };
  let npcs = null;
  const hitsOnPlayer = { n: 0, dmg: 0 };
  combat.register({
    side: 'player', get position() { return ship.position; }, radius: 8, isAlive: () => ps.alive,
    takeDamage: (a, shooter) => {
      if (!ps.alive) return;
      npcs.reportPlayerHit(shooter);
      hitsOnPlayer.n++; hitsOnPlayer.dmg += a;
      if (invulnerable) return;
      ps.hull -= Math.max(1, a - ps.armor * 0.5);
      if (ps.hull <= 0) ps.alive = false;
    },
  });
  const tactics = createTactics({ combat, rng, difficulty, onEvent: (e) => { events.push(e); missions?.onTacticEvent(e); } });
  npcs = createNpcManager(scene, combat, player, { weapons, tactics, getObstacles: () => obstacles });
  const dash = [];
  const dashboard = { show: (k, o) => dash.push(o.text) };
  const CREW = { navigator: {}, sensors: {}, engineer: {}, tactical: {} };
  const comms = { say: (o) => dash.push(`[${o.sender}] ${o.text}`), open() {}, close() {}, isOpen: () => false };
  const wolfpack = createWolfpack({ npcs, tactics, player, playerState: ps, dashboard, CREW });
  let boosting = false;
  const missions = createMissions({
    npcs, tactics, wolfpack, comms, dashboard, CREW, player, playerState: ps, rng,
    getStats: () => stats, getSignature: () => 50 * (boosting ? 1.6 : 1),
    setSpeedCap: (v) => { speedCap = v; }, setWarpJam: (v) => { warpJam = v; },
  });

  // ------------------ BOT GRACZA ------------------
  const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
  let fireCd = 0, t = 0;
  function steerTo(point, wantSpeed, dt) {
    _m.lookAt(ship.position, point, UP);
    _q.setFromRotationMatrix(_m);
    ship.quaternion.rotateTowards(_q, 1.3 * dt);
    const cap = 644 * speedCap;
    boosting = wantSpeed > 46;
    speed += THREE.MathUtils.clamp(Math.min(wantSpeed, cap) - speed, -400 * dt, 400 * dt);
    ship.position.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion), speed * dt);
  }
  function shootAt(npc, dt) {
    fireCd -= dt;
    if (!npc || fireCd > 0) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    const to = npc.group.position.clone().sub(ship.position);
    const d = to.length();
    if (d > 1600 || to.normalize().dot(f) < 0.97) return;
    const origin = ship.position.clone().addScaledVector(f, 14);
    const aim = npc.group.position.clone().addScaledVector(npc.velocity, d / 1500).sub(origin).normalize();
    weapons.fire('pulse', { origin, dir: aim, side: 'player', shooter: PLAYER_SHOOTER });
    fireCd = 0.22;
  }
  function nearest(list, from = ship.position) {
    let b = null, bd = Infinity;
    for (const n of list) { const d = n.group.position.distanceTo(from); if (d < bd) { bd = d; b = n; } }
    return b;
  }
  // bot w pościgu za celem: zajdź od tyłu na ~400 j. i strzelaj
  function dogfight(target, dt) {
    const d = target.group.position.distanceTo(ship.position);
    const lead = target.group.position.clone().addScaledVector(target.velocity, Math.min(d / 1500, 1));
    steerTo(lead, d > 900 ? 644 : Math.max(target.speed, 200), dt);
    shootAt(target, dt);
  }

  function step(dt, brainFn) {
    t += dt;
    if (ps.alive) brainFn(dt);
    npcs.update(dt);
    combat.update(dt);
    weapons.update(dt);
    missions.update(dt);
    wolfpack.update();
  }

  return { scene, combat, weapons, npcs, tactics, wolfpack, missions, ps, player, ship, events, dash, hitsOnPlayer, step, steerTo, dogfight, nearest, shootAt, get t() { return t; }, get speed() { return speed; }, set speed(v) { speed = v; }, get warpJam() { return warpJam; }, get speedCap() { return speedCap; } };
}

function run(W, brainFn, maxT = 300, dt = 1 / 30) {
  while (W.t < maxT && W.missions.state.status === 'active') W.step(dt, brainFn);
  return W.missions.state;
}

const results = {};

// ============================================================
console.log('\n1. Misje - czy da się je wygrać (bot nieśmiertelny = test logiki misji)');
// ============================================================
{
  const W = makeWorld({ seed: 11, invulnerable: true });
  W.missions.start('waves');
  const st = run(W, (dt) => { const e = W.nearest(W.npcs.hostiles().filter((n) => n.mode !== 'flee')); if (e) W.dogfight(e, dt); else W.steerTo(W.ship.position.clone().add(new THREE.Vector3(0, 0, -100)), 0, dt); }, 420);
  ok(st.status === 'success', `Odeprzyj atak: ${st.status} po ${W.t.toFixed(0)} s (${st.objective})`);
  const retreats = W.events.filter((e) => e.type === 'retreat' || e.type === 'squad-retreat').length;
  ok(retreats > 0, `część wrogów wycofała się zamiast ginąć (odwroty: ${retreats})`);
  results.waves = W;
}
{
  const W = makeWorld({ seed: 12, invulnerable: true });
  W.missions.start('capture');
  let courier = null;
  const st = run(W, (dt) => {
    courier ??= W.npcs.list.find((n) => n.callsign.startsWith('Kurier'));
    if (!courier?.alive) return;
    if (!courier.disabled) { W.dogfight(courier, dt); return; }
    // abordaż: dolot i zrównanie prędkości
    const d = courier.group.position.distanceTo(W.ship.position);
    W.steerTo(courier.group.position, d > 250 ? Math.min(400, d) : courier.speed, dt);
  }, 300);
  ok(st.status === 'success', `Przechwycenie: ${st.status} (${st.result || st.objective})`);
  ok(W.events.some((e) => e.type === 'engage' && e.npc.brain?.base === 'guard'), 'eskorta kuriera weszła do walki w jego obronie');
}
{
  const W = makeWorld({ seed: 13, invulnerable: true });
  W.missions.start('capture');
  const st = run(W, (dt) => W.steerTo(W.ship.position.clone().add(new THREE.Vector3(0, 0, 100)), 0, dt), 120); // bot stoi
  ok(st.status === 'fail' && /fałdę/.test(st.result), `Przechwycenie bez pogoni: kurier ucieka w fałdę (${st.result})`);
}
{
  const W = makeWorld({ seed: 14, invulnerable: true });
  W.missions.start('blockade');
  const gate = W.missions.markers()[0].position;
  let jammedSeen = false, slowSeen = false;
  const st = run(W, (dt) => { W.steerTo(gate, 644, dt); jammedSeen ||= W.warpJam; slowSeen ||= W.speedCap < 1; }, 200);
  ok(st.status === 'success', `Blokada (przelot na boost): ${st.status} (${st.result})`);
  ok(jammedSeen && slowSeen, 'interdyktor zagłuszył fałdę i spowolnił statek w swoim polu');
  const alerts = W.dash.filter((t) => /Wykryli nas/.test(t)).length;
  ok(alerts === 1, 'boost zdradził statek pikietom (jeden alarm dla całej blokady)');
}
{
  const W = makeWorld({ seed: 15, invulnerable: true });
  W.missions.start('blockade');
  const gate = W.missions.markers()[0].position;
  // cicho: bez boosta (sygnatura 50 -> wykrycie z 3000 j.), szerokim łukiem ponad linią
  const wp = [W.ship.position.clone().add(new THREE.Vector3(0, 5200, -6000)), W.ship.position.clone().add(new THREE.Vector3(0, 5200, -12000)), gate];
  let i = 0;
  const st = run(W, (dt) => { if (W.ship.position.distanceTo(wp[i]) < 400 && i < wp.length - 1) i++; W.steerTo(wp[i], 46, dt); }, 600);
  ok(st.status === 'success' && /niezauważeni/.test(st.result), `Blokada po cichu, łukiem: ${st.result}`);
}
{
  const W = makeWorld({ seed: 16, invulnerable: true });
  W.missions.start('escort');
  const trader = W.npcs.list.find((n) => n.role === 'trader');
  const st = run(W, (dt) => {
    const foes = W.npcs.hostiles().filter((n) => n.mode !== 'flee' && n.group.position.distanceTo(trader.group.position) < 3500);
    const e = W.nearest(foes, trader.group.position);
    if (e) W.dogfight(e, dt);
    else if (trader.alive) W.steerTo(trader.group.position.clone().add(new THREE.Vector3(200, 100, 0)), Math.min(644, W.ship.position.distanceTo(trader.group.position) * 0.8 + 60), dt);
  }, 400);
  ok(st.status === 'success', `Eskorta: ${st.status} (${st.result})`);
  const hitsOnTrader = W.events.filter((e) => e.type === 'distress').length;
  ok(hitsOnTrader > 0, `rabusie celowali w handlowca (wezwania pomocy: ${hitsOnTrader})`);
}
{
  const W = makeWorld({ seed: 17, invulnerable: true });
  W.missions.start('escort');
  const st = run(W, (dt) => W.steerTo(W.ship.position.clone().add(new THREE.Vector3(0, 0, 100)), 0, dt), 400);
  ok(st.status === 'fail', `Eskorta bez gracza: handlowiec ginie (${st.result})`);
}
{
  const W = makeWorld({ seed: 18, invulnerable: true, raceId: 'rezonanci' }); // Czujniki 7: szansa na wczesne wykrycie
  W.missions.start('ambush');
  const wreck = W.missions.markers()[0].position;
  const st = run(W, (dt) => {
    const e = W.nearest(W.npcs.hostiles().filter((n) => n.mode !== 'flee'));
    if (e && e.brain?.sprung) W.dogfight(e, dt); else W.steerTo(wreck, 300, dt);
  }, 400);
  ok(st.status === 'success', `Zasadzka: ${st.status} (${st.result})`);
  ok(W.events.some((e) => e.type === 'spring'), 'napastnicy wyszli z ukrycia naraz');
}
{
  const W = makeWorld({ seed: 19, invulnerable: true });
  W.missions.start('pursuit');
  // ucieczka prosto na boost; łowcy mają sprint 780 j./s na 7 s, potem 5 s stygnięcia
  let minD = Infinity;
  const st = run(W, (dt) => { W.steerTo(W.ship.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(W.ship.quaternion).multiplyScalar(1000)), 644, dt); const n = W.nearest(W.npcs.hostiles()); if (n) minD = Math.min(minD, n.group.position.distanceTo(W.ship.position)); }, 300);
  ok(st.status === 'success' || st.status === 'active', `Pościg (sama ucieczka): ${st.status} ${st.result || st.detail}`);
  ok(minD < 1500, `łowcy dogonili uciekającego na boost (najbliżej: ${Math.round(minD)} j.) - sprint działa`);
  ok(W.events.some((e) => e.type === 'sprint-cool'), 'sprint łowców się przegrzewa (okna na ucieczkę)');
}
{
  const W = makeWorld({ seed: 20, invulnerable: true });
  W.missions.start('wolfhunt');
  const fr = W.npcs.list.find((n) => n.role === 'trader');
  let ordered = false;
  const st = run(W, (dt) => {
    if (!ordered && W.t > 2) { ordered = W.wolfpack.command('pincer'); }
    if (W.t > 25 && W.wolfpack.order !== 'focus' && fr.alive) W.wolfpack.command('focus', fr.contact);
    if (fr.alive) W.dogfight(fr, dt);
  }, 300);
  ok(st.status === 'success', `Łowy watahy: ${st.status} (${st.result})`);
  ok(W.events.some((e) => e.type === 'pincer-in' && e.npc.tag === 'pack'), 'wataha wykonała kleszcze (skrzydła weszły z flank)');
  const packHits = W.events.filter((e) => e.type === 'engage' && e.npc.tag === 'pack').length;
  ok(packHits > 0, `skrzydłowi watahy walczyli (${packHits} decyzji o celu)`);
}

// ============================================================
console.log('\n2. Zachowanie AI (nietragiczność)');
// ============================================================
{
  // przeszkoda: "planeta" R=1500 dokładnie między wrogami a graczem
  const planet = { position: new THREE.Vector3(0, 0, -4000), radius: 1500, name: 'test' };
  const W = makeWorld({ seed: 21, invulnerable: true, obstacles: [planet] });
  for (let i = 0; i < 6; i++) {
    W.npcs.spawn({ raceId: 'heliotropi', side: 'hostile', mode: 'tactical', position: new THREE.Vector3((i - 2.5) * 150, 0, -8000), ai: { base: 'hunt', squad: 'x' } });
  }
  let inside = 0, minSep = Infinity, maxAttackers = 0, samples = 0, attackSum = 0;
  for (let k = 0; k < 30 * 90; k++) {
    W.step(1 / 30, (dt) => W.steerTo(W.ship.position.clone().add(new THREE.Vector3(Math.sin(W.t * 0.3) * 500, 0, 300)), 60, dt));
    const hs = W.npcs.hostiles();
    for (const n of hs) if (n.group.position.distanceTo(planet.position) < planet.radius + n.radius - 1) inside++;
    for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) minSep = Math.min(minSep, hs[a].group.position.distanceTo(hs[b].group.position));
    const att = hs.filter((n) => n.brain?.plan === 'engage' && n.brain.role === 'strike' && (n.brain.phase === 'run' || n.brain.phase === 'approach')).length;
    if (W.t > 15) { maxAttackers = Math.max(maxAttackers, att); attackSum += att; samples++; }
  }
  ok(inside === 0, 'żaden NPC nie wszedł w planetę (omijanie + twarda bariera)');
  ok(minSep > 20, `NPC nie zlewają się w jeden punkt (min. odstęp ${Math.round(minSep)} j.)`);
  ok(maxAttackers <= 2, `żetony: naraz w natarciu na gracza najwyżej 2 z 6 (maks. ${maxAttackers}, średnio ${(attackSum / Math.max(samples, 1)).toFixed(2)})`);
  const roles = new Set(W.npcs.hostiles().map((n) => n.brain?.role));
  ok(roles.has('flank'), `reszta krąży na flankach (role: ${[...roles].join(', ')})`);
  ok(W.hitsOnPlayer.n > 0, `mimo to presja trwa: ${W.hitsOnPlayer.n} trafień w gracza w 90 s`);
}
{
  // uniki: gracz strzela rakietami w NPC; ile razy mózg robi unik
  const W = makeWorld({ seed: 22, invulnerable: true });
  const n = W.npcs.spawn({ raceId: 'swietlisci', side: 'hostile', mode: 'tactical', position: new THREE.Vector3(0, 0, -2500), ai: { base: 'hunt' } });
  let shots = 0;
  for (let k = 0; k < 30 * 40; k++) {
    W.step(1 / 30, (dt) => {
      W.steerTo(n.group.position, 80, dt);
      if (k % 60 === 0 && n.alive) {
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(W.ship.quaternion);
        W.weapons.fire('missile', { origin: W.ship.position.clone().addScaledVector(f, 15), dir: f, side: 'player', shooter: PLAYER_SHOOTER, target: n.contact, baseSpeed: 80 });
        shots++;
      }
    });
  }
  const ev = W.events.filter((e) => e.type === 'evade' && e.guided).length;
  ok(ev > 0, `uniki przed rakietami: ${ev} na ${shots} salw`);
}
{
  // ocena ryzyka: samotny, ranny, ostrożny NPC wycofuje się; frenzja (Żar) walczy dłużej
  const count = (raceId, factionKey) => {
    const W = makeWorld({ seed: 23, invulnerable: true });
    const n = W.npcs.spawn({ raceId, factionKey, side: 'hostile', mode: 'tactical', position: new THREE.Vector3(0, 0, -1500), ai: { base: 'hunt' } });
    let tRet = null;
    W.npcs.on('retreat', () => { tRet ??= W.t; });
    for (let k = 0; k < 30 * 60 && n.alive && tRet == null; k++) {
      W.step(1 / 30, (dt) => W.dogfight(n, dt));
    }
    return { hull: Math.round(n.hull / n.maxHull * 100), retreated: tRet != null, alive: n.alive };
  };
  const cautious = count('wykonawcy', 'trade');
  const frenzy = count('heliotropi', 'hawk');
  ok(cautious.retreated && cautious.alive, `ostrożni (Wykonawcy, Duchowi): odwrót przy ${cautious.hull}% kadłuba`);
  ok(!frenzy.retreated || frenzy.hull < cautious.hull, `frenzja (Heliotropi, Żar): ${frenzy.retreated ? `odwrót dopiero przy ${frenzy.hull}%` : 'walczy do końca'}`);
}
{
  // regeneracja: Szczepieni odskakują, żeby się naprawić, zamiast uciekać
  const W = makeWorld({ seed: 24, invulnerable: true });
  const n = W.npcs.spawn({ raceId: 'szczepieni', factionKey: 'trade', side: 'hostile', mode: 'tactical', position: new THREE.Vector3(0, 0, -1500), ai: { base: 'hunt' } });
  for (let k = 0; k < 30 * 60 && n.alive; k++) W.step(1 / 30, (dt) => (k < 30 * 25 ? W.dogfight(n, dt) : W.steerTo(W.ship.position.clone().add(new THREE.Vector3(0, 0, 50)), 0, dt)));
  ok(W.events.some((e) => e.type === 'disengage'), `Szczepieni: odskok na regenerację (kadłub teraz ${Math.round(n.hull / n.maxHull * 100)}%)`);
}

// ============================================================
console.log('\n3. Uczciwa walka (bot śmiertelny, trudność normalna) - tylko raport');
// ============================================================
for (const id of MISSION_ORDER) {
  let wins = 0; const notes = [];
  for (const seed of [31, 32, 33]) {
    const W = makeWorld({ seed, raceId: 'szczepieni' });
    W.missions.start(id);
    const special = W.npcs.list.find((n) => n.role === 'trader' || n.callsign.startsWith('Kurier'));
    const gate = W.missions.markers()[0]?.position;
    const st = run(W, (dt) => {
      if (id === 'blockade') return W.steerTo(gate, 644, dt);
      if (id === 'pursuit') return W.steerTo(W.ship.position.clone().add(new THREE.Vector3(0, 0, -1000).applyQuaternion(W.ship.quaternion)), 644, dt);
      if (id === 'capture' && special?.alive && special.disabled) return W.steerTo(special.group.position, Math.min(300, W.ship.position.distanceTo(special.group.position)), dt);
      if (id === 'capture' && special?.alive) return W.dogfight(special, dt);
      if (id === 'wolfhunt' && special?.alive) return W.dogfight(special, dt);
      if (id === 'ambush') { const e = W.nearest(W.npcs.hostiles().filter((n) => n.brain?.sprung && n.mode !== 'flee')); return e ? W.dogfight(e, dt) : W.steerTo(gate, 300, dt); }
      const e = W.nearest(W.npcs.hostiles().filter((n) => n.mode !== 'flee'), special?.alive ? special.group.position : W.ship.position);
      if (e) W.dogfight(e, dt); else if (special?.alive) W.steerTo(special.group.position, 200, dt);
    }, 420);
    if (st.status === 'success') wins++;
    notes.push(st.status === 'active' ? 'limit czasu' : st.result);
  }
  console.log(`  --   ${id.padEnd(9)} bot wygrał ${wins}/3  · ${notes.join(' | ')}`);
}

console.log(fails ? `\n${fails} niezaliczonych` : '\nWszystko zaliczone.');
process.exit(fails ? 1 : 0);
