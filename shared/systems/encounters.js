import * as THREE from 'three';
import { RACES, relation, pickRaceByRelation } from '../data/races.js';

/**
 * Reżyser scen fabularnych (demo): trzy spotkania i sekwencja, która je łączy.
 *
 *   ally       kontakt sojusznika: wywołanie radiowe, wybór (przyjmij eskortę /
 *              zignoruj). Przyjęty sojusznik leci z tyłu i pomaga w walce.
 *   intercept  przechwycenie: wrogi statek dogania i "przytrzymuje" gracza
 *              (zakłócenie napędu = limit prędkości), żąda myta. Wybory:
 *              zapłać / negocjuj (szansa zależy od Wpływu i reputacji) / odmów.
 *   attack     atak: wróg ostrzeliwuje gracza w przelotach; kończy się
 *              zniszczeniem wroga, jego odwrotem albo ucieczką gracza.
 *
 * Sceny to zwykłe funkcje z callbackami; czas liczony w czasie SYMULACJI
 * (update(dt)), nie zegara ściany - dzięki temu działają tak samo przy 10 i
 * przy 60 klatkach na sekundę i można je "przewinąć" w testach.
 */
export function createEncounters({
  npcs, comms, dashboard, CREW, player, playerState, getStats, setSpeedCap, rng = Math.random,
}) {
  let token = 0;               // unieważnia zaległe zdarzenia poprzedniej sceny
  let timers = [];
  let waits = [];
  let pending = null;          // { npc, onKilled, onRetreat }
  let allyNpc = null;
  let rep = {};

  const _q = new THREE.Vector3();
  const alert = (key, crew, text, urgency = 'info', ttl = 4500) => dashboard.show(key, { crew, text, urgency, ttl });

  const after = (seconds, fn) => { const tk = token; timers.push({ t: seconds, fn: () => { if (tk === token) fn(); } }); };
  const waitFor = (cond, fn) => { waits.push({ tk: token, cond, fn }); };

  function basisPoint(fwdDist, rightDist, upDist) {
    const q = player.quaternion;
    const f = _q.set(0, 0, -1).applyQuaternion(q).clone().multiplyScalar(fwdDist);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(rightDist);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(upDist);
    return player.position.clone().add(f).add(r).add(u);
  }
  const distTo = (npc) => npc.group.position.distanceTo(player.position);
  // Odległość, w jakiej NPC "wisi" obok gracza (offset skaluje się z rozmiarem
  // statku - duży okręt zatrzymuje się dalej). Progi wywołań muszą to uwzględniać,
  // inaczej duży NPC nigdy nie znalazłby się "wystarczająco blisko".
  const formationDist = (npc) => npc.offset.length() * npc.offsetScale;
  // "done" ze sceny może być wołane z kilku miejsc (wybór, bezpiecznik czasowy,
  // odwrót i zniszczenie wroga) - następna scena ma ruszyć tylko RAZ.
  const once = (fn) => { let called = false; return (...a) => { if (called) return; called = true; fn?.(...a); }; };
  const fill = (text, npc) => text.replace('{faction}', npc.factionName);

  function getRep(raceId) { return rep[raceId] ?? relation(playerState.raceId, raceId); }
  function changeRep(raceId, delta) {
    rep[raceId] = getRep(raceId) + delta;
    const v = Math.round(rep[raceId]);
    alert(`rep-${raceId}`, CREW.navigator,
      `Reputacja u ${RACES[raceId].name}: ${v > 0 ? '+' : ''}${v} (${delta > 0 ? '+' : ''}${delta})`, 'info', 4000);
  }

  function say(npc, text, onDone, ttl = 3.4) {
    comms.say({
      sender: `${npc.callsign} · ${npc.factionName}`, sub: npc.raceName, color: RACES[npc.raceId].color, text, ttl, onDone,
    });
  }

  // ------------------------------------------------------------------
  // SCENA: kontakt sojusznika
  // ------------------------------------------------------------------
  function sceneAlly(doneCb) {
    const done = once(doneCb);
    const raceId = pickRaceByRelation(playerState.raceId, 'ally', rng);
    const factionKey = rng() < 0.5 ? 'trade' : 'coalition';
    const npc = allyNpc = npcs.spawn({
      raceId, factionKey, side: 'ally', position: basisPoint(1500, 350, 90),
      mode: 'formation', offset: new THREE.Vector3(300, 40, -420),
    });
    const voice = RACES[raceId].voice;

    alert('c-ally-seen', CREW.sensors, `Nowy kontakt przed nami: nieznany okręt, ${Math.round(distTo(npc))} j.`, 'info', 5000);

    waitFor(() => !npc.alive || distTo(npc) < Math.max(750, formationDist(npc) * 1.15), () => {
      if (!npc.alive) return done?.();
      alert('c-ally-id', CREW.navigator, `Identyfikacja: ${npc.raceName} — ${npc.factionName}. Nadaje wywołanie.`, 'info', 6000);
      comms.open({
        sender: `${npc.callsign} · ${npc.factionName}`, sub: npc.raceName, color: RACES[raceId].color,
        text: fill(voice.hail, npc),
        choices: [
          {
            label: 'Przyjmij pomoc — lećmy razem', hint: 'sojusznik eskortuje i pomaga w walce',
            onChoose: () => {
              npcs.setMode(npc, 'escort');
              changeRep(raceId, +10);
              alert('c-escort', CREW.navigator, `Eskorta dołączyła: ${npc.callsign}.`, 'info', 5000);
              say(npc, voice.reply, done);
            },
          },
          {
            label: 'Podziękuj i leć dalej', hint: 'sojusznik odchodzi',
            onChoose: () => {
              npcs.setMode(npc, 'flee');
              allyNpc = null;
              say(npc, 'Rozumiemy. Trzymaj się.', done, 2.6);
            },
          },
        ],
      });
    });

    after(45, () => { if (npc.alive && !comms.isOpen() && distTo(npc) >= Math.max(750, formationDist(npc) * 1.15)) done?.(); }); // gracz odleciał
  }

  // ------------------------------------------------------------------
  // SCENA: przechwycenie
  // ------------------------------------------------------------------
  function sceneIntercept(doneCb) {
    const done = once(doneCb);
    const raceId = pickRaceByRelation(playerState.raceId, 'hostile', rng);
    const npc = npcs.spawn({
      raceId, factionKey: 'hawk', side: 'hostile', position: basisPoint(-2200, 500, 60),
      mode: 'formation', offset: new THREE.Vector3(260, 25, -220),
    });
    const voice = RACES[raceId].voice;

    alert('c-icpt-seen', CREW.sensors, 'Szybki okręt zbliża się od rufy!', 'warning', 6000);
    alert('c-icpt-id', CREW.tactical, `Sygnatura: ${npc.raceName} — ${npc.factionName}. Namierza nas.`, 'warning', 6000);

    waitFor(() => !npc.alive || distTo(npc) < Math.max(450, formationDist(npc) * 1.15), () => {
      if (!npc.alive) {
        // gracz zestrzelił przechwytywacza w drodze, zanim doszło do rozmowy
        alert('c-win', CREW.tactical, `Przechwytywacz zestrzelony: ${npc.callsign}.`, 'info', 4500);
        changeRep(raceId, -10);
        return done?.();
      }
      setSpeedCap(0.25);
      alert('c-interdict', CREW.engineer, 'Zakłócenie napędu! Prędkość ograniczona.', 'danger', 8000);

      const cost = 4;
      const p = THREE.MathUtils.clamp(0.3 + 0.06 * (getStats().influence - 5) + getRep(raceId) / 300, 0.1, 0.9);
      const pct = Math.round(p * 100);

      const startFight = (line) => {
        setSpeedCap(1);
        say(npc, line ?? voice.attack, () => {}, 2.6);
        beginAttack(npc, done);
      };

      comms.open({
        sender: `${npc.callsign} · ${npc.factionName}`, sub: npc.raceName, color: RACES[raceId].color,
        text: voice.toll,
        choices: [
          {
            label: `Zapłać myto (−${cost} ładunku)`, hint: `masz ${playerState.cargo}`,
            onChoose: () => {
              if (playerState.cargo >= cost) {
                playerState.cargo -= cost;
                setSpeedCap(1);
                npcs.setMode(npc, 'flee');
                say(npc, 'Opłata przyjęta. Możecie lecieć.', done, 3);
              } else {
                startFight('Nie masz czym zapłacić. To błąd.');
              }
            },
          },
          {
            label: `Negocjuj (szansa ${pct}%)`, hint: 'zależy od Wpływu i reputacji',
            onChoose: () => {
              if (rng() < p) {
                setSpeedCap(1);
                npcs.setMode(npc, 'flee');
                changeRep(raceId, +5);
                say(npc, 'Hm. Niech będzie — tym razem. Nie zapominaj, komu to zawdzięczasz.', done, 3.4);
              } else {
                startFight('Za dużo gadasz. Koniec rozmowy.');
              }
            },
          },
          { label: 'Odmów — walczymy albo uciekamy', hint: 'atak natychmiast', onChoose: () => startFight() },
        ],
      });
    });

    // gracz uciekł przechwytywaczowi, zanim ten go dogonił
    waitFor(() => npc.alive && !comms.isOpen() && distTo(npc) > 5500 && npc.mode === 'formation', () => {
      npcs.remove(npc);
      alert('c-escaped', CREW.navigator, 'Zgubiliśmy przechwytywacza.', 'info', 5000);
      done?.();
    });
  }

  // ------------------------------------------------------------------
  // SCENA: atak
  // ------------------------------------------------------------------
  function beginAttack(npc, doneCb) {
    const done = once(doneCb);
    npcs.setMode(npc, 'attack');
    alert('c-attack', CREW.tactical, `Wróg otwiera ogień: ${npc.raceName}!`, 'danger', 5000);
    const voice = RACES[npc.raceId].voice;

    pending = {
      npc,
      onKilled: () => {
        pending = null;
        alert('c-win', CREW.tactical, `Cel zniszczony: ${npc.callsign}.`, 'info', 4500);
        playerState.cargo += 3;
        alert('c-loot', CREW.engineer, 'Odzysk z wraku: +3 ładunku.', 'info', 4500);
        changeRep(npc.raceId, -10);
        if (allyNpc?.alive) changeRep(allyNpc.raceId, +5);
        after(2.5, () => done?.());
      },
      onRetreat: () => {
        alert('c-retreat', CREW.tactical, `${npc.callsign} wycofuje się.`, 'info', 4500);
        say(npc, voice.retreat, null, 3);
        changeRep(npc.raceId, -5);
        after(4, () => { pending = null; done?.(); });
      },
    };

    // gracz zerwał kontakt (uciekł na boost)
    waitFor(() => npc.alive && npc.mode === 'attack' && distTo(npc) > 6000, () => {
      pending = null;
      npcs.remove(npc);
      alert('c-escaped', CREW.navigator, 'Uciekliśmy. Wróg został w tyle.', 'info', 5000);
      done?.();
    });
  }

  function sceneAttack(doneCb) {
    const done = once(doneCb);
    const raceId = pickRaceByRelation(playerState.raceId, 'hostile', rng);
    const npc = npcs.spawn({
      raceId, factionKey: 'hawk', side: 'hostile', position: basisPoint(1600, 250, 80), mode: 'attack',
    });
    alert('c-icpt-id', CREW.tactical, `Kontakt bojowy: ${npc.raceName} — ${npc.factionName}.`, 'warning', 5000);
    say(npc, RACES[raceId].voice.attack, null, 2.6);
    beginAttack(npc, done);
  }

  // ------------------------------------------------------------------
  // SEKWENCJA DEMA + sterowanie
  // ------------------------------------------------------------------
  function epilogue() {
    comms.say({
      sender: 'Koniec dema', sub: 'sceny fabularne', color: '#9fd8ff', ttl: 9,
      text: 'Klawisze 7/8/9 uruchamiają sceny osobno (kontakt / przechwycenie / atak), 0 — sekwencja od nowa. Zmiana statku (1-4) zmienia rasę i losuje nowych rozmówców.',
    });
  }

  function reset() {
    token++;
    timers = []; waits = []; pending = null;
    comms.close();
    setSpeedCap(1);
    npcs.clear();
    allyNpc = null;
    rep = {};
    playerState.cargo = 10;
  }

  function startDemo() {
    reset();
    after(6, () => sceneAlly(() => after(4, () => sceneIntercept(() => after(2, epilogue)))));
  }

  function trigger(name) {
    reset();
    const scenes = { ally: sceneAlly, intercept: sceneIntercept, attack: sceneAttack };
    scenes[name]?.(() => {});
  }

  npcs.on('killed', (n) => { if (pending && pending.npc === n) pending.onKilled(); });
  npcs.on('retreat', (n) => { if (pending && pending.npc === n) pending.onRetreat(); });

  function update(dt) {
    for (const t of [...timers]) {
      t.t -= dt;
      if (t.t <= 0) { timers.splice(timers.indexOf(t), 1); t.fn(); }
    }
    for (const w of [...waits]) {
      if (w.tk !== token) { waits.splice(waits.indexOf(w), 1); continue; }
      if (w.cond()) { waits.splice(waits.indexOf(w), 1); w.fn(); }
    }
  }

  return {
    startDemo, trigger, reset, update, getRep,
    debug: () => ({ token, timers: timers.length, waits: waits.length, allyAlive: !!allyNpc?.alive, pending: !!pending, rep: { ...rep } }),
  };
}
