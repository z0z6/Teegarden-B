import * as THREE from 'three';
import { RACES, pickRaceByRelation } from '../data/races.js';
import { racePortrait, seedFrom } from '../data/race-portraits.js';

/**
 * MISJE (krok 9) - reżyser scenariuszy. Każda misja to cel, warunki
 * zwycięstwa i porażki oraz obsada NPC z mózgami z tactical-ai.js
 * (bazy: hunt / hold / guard / lurk / runner / trader).
 *
 *   capture    Przechwycenie statku    unieruchom kuriera (nie zniszcz!) i dokonaj abordażu,
 *                                       zanim naładuje fałdę; osłaniają go dwa myśliwce
 *   blockade   Przedarcie przez blokadę  dolecieć do punktu przejścia za linią wroga;
 *                                       pikiety wykrywają wg SYGNATURY statku (boost ją podbija),
 *                                       interdyktor zagłusza fałdę i spowalnia
 *   waves      Odeprzyj atak (10)      trzy fale z różnych stron; liczy się zniszczony ALBO przegoniony
 *   escort     Eskorta handlowca       handlowiec leci trasą do punktu skoku; rabusie wolą jego niż ciebie
 *   ambush     Zasadzka                sygnał SOS to pułapka; Czujniki rasy dają szansę wykryć ją wcześniej
 *   pursuit    Ucieczka przed pościgiem łowcy ze sprintem, "Sieć" zagłusza fałdę, posiłki odcinają drogę
 *   wolfhunt   Łowy watahy             z watahą rozbij konwój, zanim frachtowiec skoczy
 *
 * Wzorzec jak w encounters.js: czas symulacji (update(dt)), token unieważnia
 * zdarzenia poprzedniej misji, a świat widzi misję tylko przez NPC,
 * komunikator, dashboard, blokadę napędu i znaczniki celów.
 */

export const MISSIONS = {
  capture: { name: 'Przechwycenie statku', desc: 'Kurier z ładunkiem. Unieruchom go (nie niszcz) i dokonaj abordażu, zanim skoczy.' },
  blockade: { name: 'Przedarcie się przez blokadę', desc: 'Dolecieć do punktu przejścia za linią wroga. Boost podbija sygnaturę — pikiety widzą dalej.' },
  waves: { name: 'Odeprzyj atak', desc: 'Dziesięciu przeciwników w trzech falach z różnych stron. Zniszcz albo przegoń.' },
  escort: { name: 'Eskorta handlowca', desc: 'Doprowadź statek handlowy do punktu skoku. Rabusie celują w niego, nie w ciebie.' },
  ambush: { name: 'Zasadzka', desc: 'Sygnał SOS przy wraku. Coś tu nie gra — dobre czujniki mogą to wykryć wcześniej.' },
  pursuit: { name: 'Ucieczka przed pościgiem', desc: 'Łowcy na ogonie, ich „Sieć” zagłusza fałdę. Zgub ich albo skocz, gdy napęd jest wolny.' },
  wolfhunt: { name: 'Łowy watahy', desc: 'Z watahą rozbij konwój. Frachtowiec nie może dolecieć do punktu skoku.' },
};
export const MISSION_ORDER = ['capture', 'blockade', 'waves', 'escort', 'ambush', 'pursuit', 'wolfhunt'];

let ringTex = null;
function ringTexture() {
  if (ringTex) return ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(32, 32, 12, 0, Math.PI * 2); g.stroke();
  ringTex = new THREE.CanvasTexture(c);
  return ringTex;
}

/**
 * @param {object} o
 *   npcs, tactics, wolfpack, comms, dashboard, CREW, player (proxy), playerState,
 *   getStats() (Czujniki, zasięg), getSignature() (sygnatura statku teraz),
 *   setSpeedCap(v), setWarpJam(bool), scene (znaczniki 3D, opcjonalnie), rng
 */
export function createMissions({
  npcs, tactics, wolfpack = null, comms, dashboard, CREW, player, playerState,
  getStats, getSignature = () => 50, setSpeedCap, setWarpJam = () => {}, scene = null, rng = Math.random,
}) {
  let token = 0;
  let cur = null;               // aktywna misja (obiekt z hookami)
  const state = { id: null, name: '', status: 'idle', objective: '', detail: '', progress: null, time: 0, result: '' };
  let markers = [];
  let jammers = [];
  let timers = [];
  let resultT = 0;
  const handlers = { killed: [], retreat: [], left: [], disabled: [] };

  const alert = (key, crew, text, urgency = 'info', ttl = 4500) => dashboard.show(key, { crew, text, urgency, ttl });

  // ------------------------------------------------------------
  // pomocnicze
  // ------------------------------------------------------------
  function frameNow() {
    const q = player.quaternion.clone();
    return {
      origin: player.position.clone(),
      f: new THREE.Vector3(0, 0, -1).applyQuaternion(q),
      r: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
      u: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
      q,
    };
  }
  function ptIn(fr, f, r, u) {
    return fr.origin.clone().addScaledVector(fr.f, f).addScaledVector(fr.r, r).addScaledVector(fr.u, u);
  }
  function facingFrom(pos, dir) {
    const m = new THREE.Matrix4().lookAt(pos, pos.clone().add(dir), new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  function portraitOf(npc) {
    return racePortrait(npc.raceId, { seed: seedFrom(npc.id), faction: npc.factionKey, color: RACES[npc.raceId].color, size: 56 });
  }
  function say(npc, text, ttl = 3.6) {
    if (!npc) return;
    comms.say({
      sender: `${npc.callsign} · ${npc.factionName}`, sub: npc.raceName, color: RACES[npc.raceId].color, text, ttl,
      portrait: portraitOf(npc),
    });
  }

  function makeMarker(id, position, title, sub, color = '#ffd36b') {
    let sprite = null;
    if (scene) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: ringTexture(), color, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: false, toneMapped: false,
      }));
      sprite.scale.set(0.045, 0.045, 1);
      sprite.position.copy(position);
      scene.add(sprite);
    }
    const m = { id, position: position.clone(), title, sub, color, sprite };
    markers.push(m);
    return m;
  }
  function clearMarkers() {
    for (const m of markers) if (m.sprite) { scene.remove(m.sprite); m.sprite.material.dispose(); }
    markers = [];
  }

  // ------------------------------------------------------------
  // cykl życia misji
  // ------------------------------------------------------------
  function cleanupWorld() {
    for (const n of [...npcs.list]) if (n.tag !== 'pack') npcs.remove(n);
    clearMarkers();
    jammers = [];
    timers = [];
    setSpeedCap(1);
    setWarpJam(false);
  }

  function abort() {
    if (!cur && state.status === 'idle') return;
    token++;
    cur = null;
    cleanupWorld();
    Object.assign(state, { id: null, status: 'idle', objective: '', detail: '', progress: null, result: '' });
  }

  function end(success, text, cargo = 0) {
    if (!cur || state.status !== 'active') return;
    state.status = success ? 'success' : 'fail';
    state.result = text;
    state.progress = success ? 1 : state.progress;
    if (cargo) playerState.cargo += cargo;
    comms.say({
      sender: success ? 'MISJA ZALICZONA' : 'MISJA NIEUDANA', sub: state.name,
      color: success ? '#4dd6a0' : '#ff5a4a', ttl: 7,
      text: `${text}${cargo ? ` Nagroda: +${cargo} ładunku.` : ''} N — tablica misji.`,
    });
    alert('mission-end', CREW.navigator, `${state.name}: ${success ? 'zaliczona' : 'nieudana'}.`, success ? 'info' : 'danger', 6000);
    // po sukcesie niedobitki się wycofują (nie ma sensu ginąć za przegraną sprawę)
    if (success) for (const n of npcs.hostiles()) npcs.retreat(n);
    for (const m of markers) m.sub = success ? 'zaliczone' : 'niezaliczone';
    setSpeedCap(1);
    setWarpJam(false);
    jammers = [];
    cur.onEnd?.(success);
    cur = null;
    resultT = 10;
  }

  function start(id) {
    const def = MISSIONS[id];
    if (!def) return false;
    abort();
    token++;
    const tk = token;
    const fr = frameNow();
    const enemyRace = pickRaceByRelation(playerState.raceId, 'hostile', rng);
    const allyRace = pickRaceByRelation(playerState.raceId, 'ally', rng);
    Object.assign(state, { id, name: def.name, status: 'active', objective: '', detail: '', progress: null, time: 0, result: '' });

    const ctx = {
      fr, enemyRace, allyRace, tk,
      pt: (f, r, u) => ptIn(fr, f, r, u),
      S: (name) => `m${tk}-${name}`,
      spawn: (o) => npcs.spawn({ tag: 'mission', ...o }),
      objective: (t) => { state.objective = t; },
      detail: (t) => { state.detail = t; },
      progress: (v) => { state.progress = v; },
      after: (sec, fn) => timers.push({ t: sec, fn, tk }),
      jam: (j) => { jammers.push(j); return j; },
      marker: makeMarker,
      succeed: (t, c) => end(true, t, c),
      fail: (t) => end(false, t),
      say, alert, facingFrom,
      on: (type, fn) => handlers[type].push({ tk, fn }),
    };
    cur = BUILD[id](ctx) ?? {};
    cur.tk = tk;
    alert('mission-start', CREW.navigator, `Misja: ${def.name}. ${state.objective}`, 'info', 7000);
    return true;
  }

  // zdarzenia NPC -> aktywna misja
  for (const type of Object.keys(handlers)) {
    npcs.on(type, (npc) => {
      for (const h of [...handlers[type]]) {
        if (h.tk !== token) { handlers[type].splice(handlers[type].indexOf(h), 1); continue; }
        if (cur) h.fn(npc);
      }
    });
  }

  /** Zdarzenia z mózgów (tactical-ai onEvent) - linie dialogowe misji. */
  function onTacticEvent(e) { cur?.onTactic?.(e); }
  /** Gracz wszedł w fałdę (skok udany). */
  function notePlayerWarp() { cur?.onPlayerWarp?.(); }

  function update(dt) {
    if (resultT > 0) {
      resultT -= dt;
      if (resultT <= 0 && state.status !== 'active') clearMarkers();
    }
    for (const t of [...timers]) {
      if (t.tk !== token) { timers.splice(timers.indexOf(t), 1); continue; }
      t.t -= dt;
      if (t.t <= 0) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    }
    if (!cur || state.status !== 'active') return;
    state.time += dt;
    if (!player.isAlive()) { end(false, 'Statek zniszczony.'); return; }

    // zagłuszanie: spowolnienie w polu interdyktora, blokada fałdy w szerszym
    let cap = 1, jam = false;
    for (const j of jammers) {
      if (j.npc && !j.npc.alive) continue;
      if (j.active && !j.active()) continue;
      const pos = j.npc ? j.npc.group.position : j.position;
      const d = pos.distanceTo(player.position);
      if (j.jamR && d < j.jamR) jam = true;
      if (j.slowR && d < j.slowR) cap = Math.min(cap, j.cap ?? 0.5);
    }
    setSpeedCap(cap);
    setWarpJam(jam);
    state.jammed = jam;
    state.slowed = cap < 1;

    cur.update?.(dt);
  }

  // ============================================================
  // MISJE
  // ============================================================
  const BUILD = {
    // ----------------------------------------------------------
    capture(ctx) {
      const race = ctx.enemyRace;
      const start = ctx.pt(4200, 650, 150);
      const heading = ctx.fr.f.clone().addScaledVector(ctx.fr.r, 0.25).normalize();
      const courier = ctx.spawn({
        raceId: race, factionKey: 'trade', side: 'hostile', mode: 'tactical', position: start,
        facing: ctx.facingFrom(start, heading), shipId: 'warbird-heavy', callsign: 'Kurier',
        hull: 320, maxSpeed: 250, combatSpeed: 210, disableAt: 0.35, noFlee: true, label: 'kurier · ładunek',
        value: 0.3, // wataha woli eskortę: kuriera chcemy CAŁEGO
        ai: { base: 'runner', squad: ctx.S('courier'), heading },
      });
      const guards = [-1, 1].map((s) => ctx.spawn({
        raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical',
        position: start.clone().addScaledVector(ctx.fr.r, s * 320).addScaledVector(ctx.fr.f, -200),
        facing: ctx.facingFrom(start, heading),
        ai: { base: 'guard', squad: ctx.S('guard'), protect: courier.contact, guardR: 2600 },
      }));
      let charge = 0, board = 0, warned = false;
      ctx.objective('Unieruchom kuriera (kadłub < 35%) — nie zniszcz go!');
      ctx.alert('m-cap', CREW.tactical, `Kurier ${RACES[race].name} z eskortą dwóch myśliwców. Słabsza broń = mniejsze ryzyko zniszczenia ładunku.`, 'warning', 7000);

      ctx.on('killed', (n) => { if (n === courier) ctx.fail('Kurier zniszczony — ładunek przepadł.'); });
      ctx.on('left', (n) => { if (n === courier) ctx.fail('Kurier naładował fałdę i uciekł.'); });
      ctx.on('disabled', (n) => {
        if (n !== courier) return;
        ctx.say(courier, 'Napęd padł! Eskorta, do mnie — nie dajcie im wejść na pokład!');
        ctx.objective('Abordaż: podejdź na < 320 j. i zrównaj prędkość (różnica < 90 j./s) na 5 s.');
        for (const g of guards) if (g.alive && g.brain) { g.brain.temper.aggression = 0.95; g.brain.noRetreat = true; g.brain.guardR = 3200; }
      });

      return {
        update(dt) {
          if (!courier.alive) return;
          const d = courier.group.position.distanceTo(player.position);
          if (!courier.disabled) {
            // fałda kuriera: ładuje się, gdy gracz jest daleko; z bliska ją zakłócamy
            charge = d > 1600 ? charge + dt / 30 : Math.max(0, charge - dt / 9);
            ctx.progress(charge);
            ctx.detail(`Fałda kuriera: ${Math.round(charge * 100)}% · ${Math.round(d)} j. ${d <= 1600 ? '(zakłócasz)' : '(< 1600 j. = zakłócenie)'} · kadłub ${Math.round(courier.hull / courier.maxHull * 100)}%`);
            if (charge > 0.6 && !warned) { warned = true; ctx.alert('m-cap-w', CREW.engineer, 'Kurier ładuje fałdę! Bliżej niż 1600 j. — zakłócimy ją.', 'danger', 5000); }
            if (charge >= 1) { npcs.depart(courier); charge = 0; }
          } else {
            const pv = player.getVelocity(new THREE.Vector3());
            const rel = pv.sub(courier.velocity).length();
            const ok = d < 320 + courier.radius && rel < 90;
            board = ok ? board + dt / 5 : Math.max(0, board - dt / 10);
            ctx.progress(board);
            ctx.detail(`Abordaż: ${Math.round(board * 100)}% · ${Math.round(d)} j. · różnica prędkości ${Math.round(rel)} j./s`);
            if (board >= 1) {
              npcs.remove(courier);
              ctx.succeed('Abordaż udany — ładunek i załoga kuriera przejęte.', 12);
            }
          }
        },
      };
    },

    // ----------------------------------------------------------
    blockade(ctx) {
      const race = ctx.enemyRace;
      const S = ctx.S('blk');
      const gate = ctx.pt(15500, 0, 0);
      const center = ctx.pt(8500, 0, 0);
      ctx.marker('gate', gate, 'Punkt przejścia', 'cel misji');
      const posts = [];
      const inter = ctx.spawn({
        raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: center,
        facing: ctx.facingFrom(center, ctx.fr.f.clone().negate()), shipId: 'kharath-destroyer', callsign: 'Zapora',
        hull: 520, maxSpeed: 150, combatSpeed: 110, arrival: 'none', label: 'interdyktor',
        ai: { base: 'hold', squad: S, anchor: center, leash: 3400, alert: false, noRetreat: true },
      });
      posts.push(inter);
      for (const x of [-2700, -1350, 1350, 2700]) {
        const p = ctx.pt(8200 + (Math.abs(x) > 2000 ? 400 : 0), x, (x > 0 ? 1 : -1) * 120);
        posts.push(ctx.spawn({
          raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: p, arrival: 'none',
          facing: ctx.facingFrom(p, ctx.fr.f.clone().negate()),
          ai: { base: 'hold', squad: S, anchor: p, leash: 2800, alert: false },
        }));
      }
      for (const x of [-1900, 1900]) {
        const p = ctx.pt(5200, x, 150);
        posts.push(ctx.spawn({
          raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: p, arrival: 'none', label: 'pikieta',
          facing: ctx.facingFrom(p, ctx.fr.f.clone().negate()),
          ai: { base: 'hold', squad: S, anchor: p, leash: 3600, alert: false },
        }));
      }
      ctx.jam({ npc: inter, jamR: 5000, slowR: 2600, cap: 0.5 });
      const dist0 = player.position.distanceTo(gate);
      let alerted = false, hintT = 0;
      ctx.objective('Dolecieć do punktu przejścia za linią blokady.');
      ctx.alert('m-blk', CREW.sensors, `Blokada ${RACES[race].name}: 7 okrętów, interdyktor w środku linii. Mniejsza sygnatura = później nas zobaczą.`, 'warning', 8000);

      return {
        onTactic(e) { if (e.type === 'squad-retreat' && posts.includes(e.npc)) ctx.say(e.npc, RACES[race].voice.retreat); },
        update(dt) {
          const sig = getSignature();
          const detectR = 3000 * (sig / 50);
          if (!alerted) {
            hintT -= dt;
            for (const n of posts) {
              if (!n.alive) continue;
              if (n.group.position.distanceTo(player.position) < detectR || n.hull < n.maxHull) {
                alerted = true;
                tactics.alertSquad(S);
                ctx.say(n, 'Kontakt na podejściu! Zamknąć sektor, interdyktor — pole na pełną moc!');
                ctx.alert('m-blk-d', CREW.sensors, 'Wykryli nas! Cała linia rusza.', 'danger', 5000);
                break;
              }
            }
            if (hintT <= 0) { hintT = 12; ctx.alert('m-blk-s', CREW.sensors, `Pikiety wykryją nas z ~${Math.round(detectR)} j.${sig > 60 ? ' Boost nas zdradza.' : ''}`, 'info', 4000); }
          }
          const d = player.position.distanceTo(gate);
          ctx.progress(THREE.MathUtils.clamp(1 - d / dist0, 0, 1));
          ctx.detail(`Do punktu: ${Math.round(d)} j. · ${alerted ? 'WYKRYCI' : `niewykryci (zasięg pikiet ${Math.round(detectR)} j.)`}${inter.alive ? '' : ' · interdyktor zniszczony'}`);
          if (d < 800) ctx.succeed(alerted ? 'Przebiliśmy się przez blokadę.' : 'Prześlizgnęliśmy się niezauważeni.', alerted ? 8 : 12);
        },
      };
    },

    // ----------------------------------------------------------
    waves(ctx) {
      const TOTAL = 10;
      const sizes = [3, 3, 4];
      const repelled = new Set();
      const mine = new Set();
      let wave = 0, waveT = 0, waveNpcs = [];
      ctx.objective(`Odeprzyj atak: 0/${TOTAL}.`);

      function spawnWave(i) {
        const fr = frameNow();
        const bearing = [[3800, 0, 0], [-1600, -3400, 400], [1200, 3200, -600]][i];
        const center = ptIn(fr, ...bearing);
        const race = i === 2 ? pickRaceByRelation(playerState.raceId, 'hostile', rng) : ctx.enemyRace;
        waveNpcs = [];
        for (let k = 0; k < sizes[i]; k++) {
          const heavy = i === 2 && k === sizes[i] - 1;
          const p = center.clone().addScaledVector(fr.r, (k - (sizes[i] - 1) / 2) * 260).addScaledVector(fr.u, (k % 2) * 120);
          const n = ctx.spawn({
            raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: p,
            ...(heavy ? { shipId: 'kharath-destroyer', hull: 380, combatSpeed: 150, maxSpeed: 200, label: 'ciężki' } : {}),
            ai: { base: 'hunt', squad: ctx.S(`w${i}`) },
          });
          mine.add(n); waveNpcs.push(n);
        }
        wave = i + 1; waveT = 0;
        ctx.alert(`m-wave${i}`, CREW.tactical, `Fala ${wave}/3: ${sizes[i]} × ${RACES[race].name}${i === 2 ? ' (z ciężkim okrętem)' : ''}.`, 'danger', 5000);
      }
      const count = (n) => { if (mine.has(n)) repelled.add(n); };
      ctx.on('killed', count); ctx.on('retreat', count); ctx.on('left', count);
      spawnWave(0);

      return {
        onTactic(e) { if (e.type === 'squad-retreat' && mine.has(e.npc)) ctx.say(e.npc, RACES[e.npc.raceId].voice.retreat); },
        update(dt) {
          waveT += dt;
          const alive = waveNpcs.filter((n) => n.alive && n.mode !== 'flee').length;
          if (wave < 3 && ((alive <= 1 && waveT > 12) || waveT > 55)) spawnWave(wave);
          ctx.progress(repelled.size / TOTAL);
          ctx.objective(`Odeprzyj atak: ${repelled.size}/${TOTAL}.`);
          ctx.detail(`Fala ${wave}/3 · w walce: ${[...mine].filter((n) => n.alive && n.mode !== 'flee').length}`);
          if (wave === 3 && repelled.size >= TOTAL) ctx.succeed('Wszystkie trzy fale odparte.', 10);
        },
      };
    },

    // ----------------------------------------------------------
    escort(ctx) {
      const route = [ctx.pt(1800, 200, 0), ctx.pt(5200, 1400, 200), ctx.pt(8800, -600, -150), ctx.pt(12500, 0, 0)];
      const start = ctx.pt(260, 380, 40);
      const trader = ctx.spawn({
        raceId: ctx.allyRace, factionKey: 'trade', side: 'ally', mode: 'tactical', position: start,
        facing: ctx.fr.q, shipId: 'kharath-destroyer', callsign: 'Karawana',
        hull: 650, maxSpeed: 130, combatSpeed: 80, role: 'trader', label: 'handlowiec (chroń)', value: 2.6,
        ai: { base: 'trader', squad: ctx.S('trader'), route },
      });
      ctx.marker('jump', route[route.length - 1], 'Punkt skoku konwoju', 'cel handlowca', '#4dd6a0');
      let raid = 0;
      const raidProgress = [1, 3];
      ctx.objective('Doprowadź handlowca do punktu skoku.');
      ctx.after(1.2, () => ctx.say(trader, `Tu Karawana. Prowadzimy ładunek dla ${RACES[playerState.raceId].name}. Trzymaj się blisko — na tej trasie grasują rabusie.`, 5));

      function spawnRaid(i) {
        const tf = trader.forward.clone();
        const side = new THREE.Vector3().crossVectors(tf, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(i ? -1 : 1);
        const center = trader.group.position.clone().addScaledVector(tf, i ? -2200 : 2600).addScaledVector(side, 1600);
        const n = i ? 4 : 3;
        for (let k = 0; k < n; k++) {
          const heavy = i === 1 && k === n - 1;
          ctx.spawn({
            raceId: ctx.enemyRace, factionKey: 'hawk', side: 'hostile', mode: 'tactical',
            position: center.clone().addScaledVector(side, k * 230).add(new THREE.Vector3(0, (k % 2) * 140, 0)),
            ...(heavy ? { shipId: 'kharath-destroyer', hull: 360, combatSpeed: 150, maxSpeed: 200, label: 'ciężki' } : {}),
            // rabusie: handlowiec wart więcej (value 2,6), ale na ogon gracza też odpowiedzą
            ai: { base: 'hunt', squad: ctx.S(`raid${i}`) },
          });
        }
        ctx.alert(`m-raid${i}`, CREW.sensors, `Rabusie ${RACES[ctx.enemyRace].name} (${n}) — idą na handlowca!`, 'danger', 5000);
      }

      ctx.on('killed', (n) => { if (n === trader) ctx.fail('Handlowiec zniszczony.'); });
      ctx.on('left', (n) => { if (n === trader) ctx.succeed(`Karawana skoczyła bezpiecznie. Kadłub: ${Math.round(trader.hull / trader.maxHull * 100)}%.`, 8 + Math.round(4 * trader.hull / trader.maxHull)); });

      return {
        onTactic(e) {
          if (e.type === 'distress' && e.npc === trader) ctx.say(trader, rng() < 0.5 ? 'Jesteśmy pod ostrzałem! Zdejmij ich z nas!' : 'Kadłub trzeszczy — potrzebujemy osłony, natychmiast!', 3.2);
        },
        onPlayerWarp() { ctx.after(4, () => { if (trader.alive && trader.group.position.distanceTo(player.position) > 12000) ctx.fail('Porzuciliśmy konwój.'); }); },
        update(dt) {
          if (!trader.alive) return;
          const idx = trader.brain?.routeIdx ?? 0;
          if (raid < 2 && (idx >= raidProgress[raid] || state.time > [30, 85][raid])) spawnRaid(raid++);
          const seg = route[Math.min(idx, route.length - 1)];
          const prev = idx > 0 ? route[idx - 1] : start;
          const segLen = prev.distanceTo(seg) || 1;
          const part = THREE.MathUtils.clamp(1 - trader.group.position.distanceTo(seg) / segLen, 0, 1);
          ctx.progress(Math.min(1, (idx + part) / route.length));
          ctx.detail(`Kadłub handlowca: ${Math.round(trader.hull / trader.maxHull * 100)}% · odcinek ${Math.min(idx + 1, route.length)}/${route.length} · od ciebie ${Math.round(trader.group.position.distanceTo(player.position))} j.`);
        },
      };
    },

    // ----------------------------------------------------------
    ambush(ctx) {
      const wreck = ctx.pt(6500, 700, 0);
      ctx.marker('sos', wreck, 'Sygnał SOS', 'frachtowiec „Wierna”', '#ffb13d');
      const S = ctx.S('amb');
      const race = ctx.enemyRace;
      const lurkers = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        const p = wreck.clone().addScaledVector(ctx.fr.r, Math.cos(a) * 1600).addScaledVector(ctx.fr.u, Math.sin(a) * 900).addScaledVector(ctx.fr.f, Math.sin(a * 2) * 700 + 300);
        lurkers.push(ctx.spawn({
          raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: p, arrival: 'none', stealth: true,
          facing: ctx.facingFrom(p, wreck.clone().sub(p).normalize()),
          ...(i === 0 ? { shipId: 'warbird-heavy', label: 'zagłuszacz', callsign: 'Sidło' } : {}),
          ai: { base: 'lurk', squad: S, anchor: wreck },
        }));
      }
      const net = lurkers[0];
      let sprung = false, revealed = 0, detectT = 0, escapeT = 0;
      ctx.jam({ npc: net, jamR: 4200, slowR: 1800, cap: 0.55, active: () => sprung });
      ctx.objective('Zbadaj źródło sygnału SOS.');
      comms.say({
        sender: 'Frachtowiec „Wierna”', sub: 'sygnał automatyczny', color: '#ffb13d', ttl: 6,
        text: '…napęd martwy… załoga ranna… ktokolwiek odbiera, prosimy o pomoc… powtarzam…',
      });

      function doSpring(why) {
        if (sprung) return;
        sprung = true;
        tactics.spring(S, why);
        for (const n of lurkers) n.stealth = false;
        ctx.say(lurkers.find((n) => n.alive) ?? net, 'Teraz! Zamknąć klatkę, Sidło — pole!');
        ctx.alert('m-amb', CREW.tactical, 'ZASADZKA! Kontakty ze wszystkich stron, fałda zagłuszona!', 'danger', 6000);
        ctx.objective('Przetrwaj: pokonaj napastników albo wyrwij się z pułapki (> 8000 j.).');
      }

      return {
        onTactic(e) { if (e.type === 'spring' && lurkers.includes(e.npc)) doSpring(e.why); },
        update(dt) {
          const alive = lurkers.filter((n) => n.alive && n.mode !== 'flee');
          const dW = player.position.distanceTo(wreck);
          if (!sprung) {
            // CZUJNIKI: szansa wykrycia czających się (atrybut rasy gracza)
            detectT -= dt;
            if (detectT <= 0) {
              detectT = 1;
              const st = getStats();
              const range = st.sensorRange * 0.42;
              for (const n of lurkers) {
                if (!n.alive || !n.stealth) continue;
                if (n.group.position.distanceTo(player.position) > range) continue;
                if (rng() < 0.05 + 0.035 * (st.attrs.sensors - 5)) {
                  n.stealth = false;
                  revealed++;
                  ctx.alert('m-amb-s', CREW.sensors, revealed === 1 ? 'Słabe echo przy wraku… ktoś tam czeka z wygaszonym napędem. To pułapka.' : `Kolejne echo: ${revealed} ukrytych.`, 'warning', 6000);
                  if (revealed === 1) ctx.objective('To pułapka. Uderz pierwszy, omiń ją (> 12000 j. od wraku) albo wejdź i przetrwaj.');
                }
              }
            }
            if (dW < 1500) doSpring('close');
            if (revealed >= 3 && dW < 3000) doSpring('spotted');
            if (revealed > 0 && dW > 12000) ctx.succeed('Pułapka ominięta — nikt dziś na nas nie zarobi.', 4);
            ctx.detail(`Do wraku: ${Math.round(dW)} j.${revealed ? ` · wykryte echa: ${revealed}` : ''}`);
            ctx.progress(null);
            return;
          }
          const nearest = alive.reduce((m, n) => Math.min(m, n.group.position.distanceTo(player.position)), Infinity);
          escapeT = nearest > 8000 ? escapeT + dt : 0;
          ctx.progress(1 - alive.length / lurkers.length);
          ctx.detail(`Napastnicy: ${alive.length}/5 · najbliższy ${Number.isFinite(nearest) ? Math.round(nearest) : '—'} j.${state.jammed ? ' · FAŁDA ZAGŁUSZONA' : ''}`);
          if (!alive.length) ctx.succeed('Zasadzka rozbita.', 10);
          else if (escapeT > 2) ctx.succeed('Wyrwaliśmy się z pułapki.', 3);
        },
      };
    },

    // ----------------------------------------------------------
    pursuit(ctx) {
      const S = ctx.S('hunt');
      const race = ctx.enemyRace;
      const hunters = [];
      const sprint = { speed: 780, dur: 7, cool: 5 };
      function hunter(p, extra = {}) {
        const n = ctx.spawn({
          raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: p,
          combatSpeed: 300, maxSpeed: 800,
          ai: { base: 'hunt', squad: S, sprint },
          ...extra,
        });
        hunters.push(n);
        ctx.jam({ npc: n, jamR: 1400 }); // kotwice fałdowe łowców (z bliska)
        return n;
      }
      for (const x of [-500, 0, 500]) hunter(ctx.pt(-3300, x, 100 + Math.abs(x) * 0.2));
      const net = hunter(ctx.pt(-4300, 0, 350), { shipId: 'warbird-heavy', callsign: 'Sieć', label: 'zagłuszacz', maxSpeed: 360, combatSpeed: 270, hull: 300, ai: { base: 'hunt', squad: S } });
      ctx.jam({ npc: net, jamR: 4500, slowR: 2000, cap: 0.6 });
      tactics.squadOf(S).pursuit = true;
      let reinf = 0, reinfT = 0, escapeT = 0;
      ctx.objective('Zgub pościg (> 7500 j. od wszystkich) albo skocz, gdy fałda jest wolna.');
      ctx.alert('m-pur', CREW.tactical, `Łowcy ${RACES[race].name} na ogonie! „Sieć” zagłusza fałdę w promieniu 4500 j.`, 'danger', 7000);

      return {
        onTactic(e) {
          if (!hunters.includes(e.npc)) return;
          if (e.type === 'sprint-cool' && rng() < 0.4) ctx.alert('m-pur-c', CREW.sensors, `${e.npc.callsign} przegrzał napęd — okno na ucieczkę!`, 'info', 3000);
        },
        onPlayerWarp() { ctx.succeed('Skok! Pościg został w tyle.', 7); },
        update(dt) {
          reinfT += dt;
          if (reinf < 2 && reinfT > 45) {
            reinfT = 0; reinf++;
            const fr = frameNow();
            for (const s of [-1, 1]) hunter(ptIn(fr, 4200, s * 1600, 200));
            ctx.alert('m-pur-r', CREW.sensors, 'Drugi zespół łowców PRZED nami — odcinają drogę!', 'danger', 5000);
          }
          const alive = hunters.filter((n) => n.alive && n.mode !== 'flee');
          const nearest = alive.reduce((m, n) => Math.min(m, n.group.position.distanceTo(player.position)), Infinity);
          escapeT = nearest > 7500 ? escapeT + dt : 0;
          ctx.progress(Number.isFinite(nearest) ? THREE.MathUtils.clamp(nearest / 7500, 0, 1) : 1);
          ctx.detail(`Najbliższy łowca: ${Number.isFinite(nearest) ? Math.round(nearest) : '—'} j. · fałda: ${state.jammed ? 'ZAGŁUSZONA' : 'wolna (J)'}${net.alive ? '' : ' · Sieć zniszczona'}`);
          if (!alive.length) ctx.succeed('Wszyscy łowcy rozbici albo przegonieni.', 9);
          else if (escapeT > 3) ctx.succeed('Zgubiliśmy pościg.', 7);
        },
      };
    },

    // ----------------------------------------------------------
    wolfhunt(ctx) {
      if (wolfpack && !wolfpack.active) wolfpack.spawn();
      const race = ctx.enemyRace;
      const start = ctx.pt(5400, 1900, 200);
      const route = [ctx.pt(8000, 2700, 200), ctx.pt(11500, 1500, 0), ctx.pt(15500, 0, 0)];
      const freighter = ctx.spawn({
        raceId: race, factionKey: 'trade', side: 'hostile', mode: 'tactical', position: start, arrival: 'none',
        facing: ctx.facingFrom(start, route[0].clone().sub(start).normalize()), shipId: 'kharath-destroyer', callsign: 'Brzemię',
        hull: 720, maxSpeed: 120, combatSpeed: 72, role: 'trader', label: 'frachtowiec (cel)', noFlee: true, value: 2.2,
        ai: { base: 'trader', squad: ctx.S('conv'), route },
      });
      const escorts = [];
      for (const [x, y] of [[-380, 60], [380, 60], [0, -260]]) {
        escorts.push(ctx.spawn({
          raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', arrival: 'none',
          position: start.clone().addScaledVector(ctx.fr.r, x).addScaledVector(ctx.fr.u, y).addScaledVector(ctx.fr.f, -250),
          facing: freighter.group.quaternion.clone(),
          ai: { base: 'guard', squad: ctx.S('esc'), protect: freighter.contact, guardR: 2600 },
        }));
      }
      ctx.marker('cjump', route[route.length - 1], 'Punkt skoku konwoju', 'nie dopuść', '#ff5a4a');
      let reinfDone = false;
      ctx.objective('Zniszcz frachtowiec, zanim skoczy. Wataha: G atak · H kleszcze · V osłona · B szyk.');
      ctx.alert('m-wolf', CREW.tactical, `Konwój ${RACES[race].name}: frachtowiec + 3 eskorty. Kleszcze (H) rozciągną eskortę.`, 'warning', 7000);

      ctx.on('killed', (n) => { if (n === freighter) ctx.succeed('Frachtowiec rozbity — łup watahy.', 14); });
      ctx.on('left', (n) => { if (n === freighter) ctx.fail('Frachtowiec skoczył z ładunkiem.'); });

      return {
        onTactic(e) {
          if (e.type === 'distress' && e.npc === freighter) ctx.say(freighter, 'Wataha na konwoju! Eskorta — trzymać się kadłuba!', 3.2);
        },
        update(dt) {
          if (!reinfDone && state.time > 45) {
            reinfDone = true;
            const fr = frameNow();
            for (const s of [-1, 1]) {
              ctx.spawn({ raceId: race, factionKey: 'hawk', side: 'hostile', mode: 'tactical', position: ptIn(fr, -3000, s * 1200, 300), ai: { base: 'hunt', squad: ctx.S('reinf') } });
            }
            ctx.alert('m-wolf-r', CREW.sensors, 'Patrol konwoju zawraca — dwa myśliwce od rufy!', 'danger', 5000);
          }
          if (!freighter.alive) return;
          const idx = freighter.brain?.routeIdx ?? 0;
          ctx.progress(1 - freighter.hull / freighter.maxHull);
          const pack = wolfpack?.members.filter((m) => m.alive).length ?? 0;
          ctx.detail(`Frachtowiec: kadłub ${Math.round(freighter.hull / freighter.maxHull * 100)}% · trasa ${Math.min(idx + 1, route.length)}/${route.length} · wataha: ${pack}`);
        },
        onEnd() {
          const lost = wolfpack ? 3 - wolfpack.members.filter((m) => m.alive).length : 0;
          if (lost > 0) ctx.alert('m-wolf-l', CREW.tactical, `Straty watahy: ${lost}.`, 'warning', 5000);
        },
      };
    },
  };

  return {
    start, abort, update, onTacticEvent, notePlayerWarp,
    state,
    markers: () => markers,
    get active() { return state.status === 'active'; },
  };
}
