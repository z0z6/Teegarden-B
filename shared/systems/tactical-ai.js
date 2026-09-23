import * as THREE from 'three';
import { RACES } from '../data/races.js';
import { NPC_PROFILE } from './weapons.js';

/**
 * TAKTYCZNE AI (krok 9) - "mózg" NPC i dowódca eskadry.
 *
 * Krok 5 miał jeden odruch: przelot na gracza, zawrotka, przelot. Ten moduł
 * zastępuje go decyzjami. Podział pracy:
 *
 *   npc-ships.js   CIAŁO: kinematyka, omijanie przeszkód, strzał, fałda
 *   tactical-ai.js GŁOWA: co robić, na kogo polować, kiedy odpuścić
 *
 * Głowa co ~0,3-0,7 s (czas reakcji zależy od trudności i dyscypliny rasy)
 * "myśli": ocenia sytuację i wybiera PLAN. Co klatkę tylko go WYKONUJE i
 * oddaje ciału INTENCJĘ { point, speed, fire, ... }. Dzięki temu decyzje są
 * tanie (kilkanaście NPC = ułamek ms), a ruch płynny.
 *
 * DECYZJE - ocena użyteczności zamiast drzewa ifów. Każdy cel dostaje wynik:
 *   wartość (misja: handlowiec x2,6 dla rabusiów), ranny cel = łatwy łup,
 *   odległość, "kto mnie trafił" (odwet), "kto bije mojego skrzydłowego"
 *   (obrona), wspólny cel eskadry (dyscyplina), histereza (bez migotania
 *   między celami) i KARA ZA TŁOK: cel, na który leci już komplet
 *   napastników, traci na atrakcyjności - ogień rozkłada się sam.
 *
 * KREATYWNOŚĆ - chytrość rasy (cunning) daje: wybór drugiego najlepszego
 * celu, żeby rozciągnąć obronę; wejście od rufy celu zamiast czołowo;
 * zróżnicowane zwroty (nie dwa razy w tę samą stronę); PRZYNĘTĘ (jeden
 * statek kręci się przed dziobem gracza, reszta zachodzi od tyłu);
 * ODCINANIE DROGI w pościgu (lot w punkt, w którym gracz BĘDZIE).
 *
 * RYZYKO / NAGRODA - ryzyko = uszkodzenia, tempo obrywania, ile luf patrzy
 * na mnie, czy zostałem sam. Nagroda = najlepszy dostępny cel. Ostrożność i
 * agresja rasy ważą jedno z drugim. Wynik: walka, odskok na regenerację
 * (rasy z regeneracją kadłuba), przegrupowanie albo odwrót. Eskadra liczy
 * też bilans sił: przegrana potyczka = odwrót, ale nie wszyscy naraz.
 *
 * NIETRAGICZNOŚĆ - rzeczy, których dobry pilot nie robi, a stare AI robiło:
 *   - nie wlatuje w gwiazdę, planetę ani gruz (ciało omija przeszkody),
 *   - nie zderza się ze skrzydłowym (separacja),
 *   - nie wisi w celowniku gracza (uniki "nożycowe", gdy lufa patrzy na nas),
 *   - robi unik przed rakietą/torpedą (od torpedy - poza promień implozji),
 *   - nie szarżuje całą eskadrą naraz (żetony natarcia: 1-3 w ataku, reszta
 *     krąży na flankach i zmienia się z atakującymi - "karuzela"),
 *   - nie goni w nieskończoność (obrońcy mają smycz i wracają na posterunek),
 *   - nie walczy do ostatniej śruby, gdy nie ma szans (chyba że to Żar),
 *   - okręt z torpedami nie wchodzi w kołowanie z myśliwcem (trzyma dystans),
 *   - ranny skrzydłowy odchodzi, a kolega bierze na siebie jego prześladowcę.
 *
 * STRONY: 'player' i 'ally' walczą z 'hostile'; 'neutral' z nikim.
 */

// ============================================================
// TEMPERAMENT RAS - wyprowadzony z kart ras (voice, broń rasowa, atrybuty)
// ============================================================
//   aggression  chęć ataku (0 = unika walki, 1 = frenzja)
//   caution     waga ryzyka (1 = ucieka przy pierwszym trafieniu)
//   discipline  jak mocno słucha dowódcy eskadry (wspólny cel, żetony)
//   cunning     "kreatywność": wejścia od rufy, przynęty, rozproszenie celów
//   burst       ataki w "oknach" - cała eskadra uderza naraz, potem krąży
export const TEMPERAMENT = {
  wybudzeni:  { aggression: 0.50, caution: 0.60, discipline: 0.85, cunning: 0.50 }, // metodyczni: "wpis do manifestu"
  rezonanci:  { aggression: 0.55, caution: 0.50, discipline: 0.90, cunning: 0.60, burst: true }, // kworum, "okno się otwiera"
  piesniarze: { aggression: 0.45, caution: 0.55, discipline: 0.60, cunning: 0.90 }, // znają twój tor: przewidywanie, flanki
  szczepieni: { aggression: 0.70, caution: 0.35, discipline: 0.75, cunning: 0.40 }, // rój: masa i nacisk
  wykonawcy:  { aggression: 0.50, caution: 0.60, discipline: 1.00, cunning: 0.30 }, // klauzula: doktryna co do litery
  heliotropi: { aggression: 0.92, caution: 0.22, discipline: 0.35, cunning: 0.40 }, // "Frenzja!"
  swietlisci: { aggression: 0.60, caution: 0.50, discipline: 0.60, cunning: 0.70 }, // szybkie i proste światło
};
const FACTION_MOD = {
  hawk: { aggression: 0.15, caution: -0.10 },
  trade: { aggression: -0.15, caution: 0.15, discipline: 0.05 },
  coalition: { cunning: 0.10 },
};

/** Poziomy trudności: czas reakcji, ilu NPC naraz atakuje gracza, skuteczność uników. */
export const DIFFICULTY = {
  latwa:    { name: 'łatwa',    reaction: 0.75, tokensVsPlayer: 1, evadeSkill: 0.45, jink: 0.6 },
  normalna: { name: 'normalna', reaction: 0.45, tokensVsPlayer: 2, evadeSkill: 0.80, jink: 1.0 },
  trudna:   { name: 'trudna',   reaction: 0.28, tokensVsPlayer: 3, evadeSkill: 1.00, jink: 1.25 },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function temperamentFor(raceId, factionKey) {
  const t = { ...(TEMPERAMENT[raceId] ?? TEMPERAMENT.wybudzeni) };
  for (const [k, v] of Object.entries(FACTION_MOD[factionKey] ?? {})) t[k] = clamp01(t[k] + v);
  return t;
}

/** Czy strony walczą ze sobą. */
export function isFoe(a, b) {
  if (a === 'neutral' || b === 'neutral') return false;
  return (a === 'hostile') !== (b === 'hostile');
}

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);

/**
 * @param {object} o
 * @param {object} [o.combat]      combat.js (combat.incoming - wykrywanie pocisków)
 * @param {Function} [o.rng]
 * @param {string} [o.difficulty]  'latwa' | 'normalna' | 'trudna'
 * @param {Function} [o.onEvent]   ({ type, npc, ... }) - "szczekanie" do HUD
 */
export function createTactics({ combat = null, rng = Math.random, difficulty = 'normalna', onEvent = null } = {}) {
  let DIFF = DIFFICULTY[difficulty] ?? DIFFICULTY.normalna;
  const squads = new Map();
  const load = new Map(); // kontakt -> ilu napastników jest w natarciu na niego
  let time = 0;
  const emit = (type, npc, extra = {}) => onEvent?.({ type, npc, ...extra });

  // wektory robocze (bez alokacji w pętli)
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();

  function squadOf(id) {
    let s = squads.get(id);
    if (!s) {
      s = {
        id, members: new Set(), focus: null, t: 0, order: 'free', orderTarget: null,
        window: null, slotSpin: rng() * Math.PI * 2, retreating: false, alerted: true,
        attackedBy: new Map(), bait: null, baitT: 0, pursuit: false,
      };
      squads.set(id, s);
    }
    return s;
  }

  /**
   * Podpina mózg do NPC. cfg (wszystko opcjonalne):
   *   base      'hunt' | 'hold' | 'guard' | 'lurk' | 'runner' | 'trader' | 'pack'
   *   squad     id eskadry (wspólny cel, role, żetony)
   *   anchor    posterunek (hold/lurk), leash - jak daleko wolno od niego odejść
   *   protect   kontakt do ochrony (guard), guardR
   *   route     [Vector3] trasa (trader)
   *   prio      (kontakt) => mnożnik wartości celu (np. rabusie -> handlowiec)
   *   alert     false = nie widzi wroga, dopóki eskadra nie zostanie zaalarmowana
   *   noRetreat, sprint { speed, dur, cool }, formation (offset w szyku), temper
   */
  function attach(npc, cfg = {}) {
    const race = RACES[npc.raceId] ?? RACES.wybudzeni;
    const temper = { ...temperamentFor(npc.raceId, npc.factionKey), ...(cfg.temper ?? {}) };
    const prof = NPC_PROFILE[npc.weaponId] ?? NPC_PROFILE.pulse;
    const b = {
      base: cfg.base ?? 'hunt', squadId: cfg.squad ?? npc.id, temper,
      style: cfg.style ?? (npc.weaponId === 'missile' || npc.weaponId === 'torpedo' ? 'standoff' : 'dogfight'),
      range: prof.range,
      skill: THREE.MathUtils.clamp(0.8 + 0.06 * (race.attrs.pilot - 5), 0.55, 1.1),
      sensorRange: 6000 * (1 + 0.08 * (race.attrs.sensors - 5)),
      regen: race.hullRegenPct ?? 0,
      plan: 'idle', phase: 'approach', phaseT: 0, sub: 'move', subT: 0,
      target: null, targetScore: 0, enemies: [],
      thinkIn: rng() * 0.4, role: 'free', slot: 0, slotN: 1, coverTarget: null,
      breakDir: new THREE.Vector3(), lastBreak: new THREE.Vector3(), evadeDir: new THREE.Vector3(), evadeT: 0,
      seed: rng() * 100, gunsight: null,
      attackers: new Map(), dmgRecent: 0, lastHitT: -99,
      alert: cfg.alert ?? true, sprung: (cfg.base ?? 'hunt') !== 'lurk',
      anchor: cfg.anchor ? cfg.anchor.clone() : null, leash: cfg.leash ?? 2600,
      protect: cfg.protect ?? null, guardR: cfg.guardR ?? 1800,
      route: cfg.route ?? null, routeIdx: 0, heading: cfg.heading ? cfg.heading.clone() : null,
      prio: cfg.prio ?? null, noRetreat: !!cfg.noRetreat,
      sprint: cfg.sprint ?? null, sprintLeft: cfg.sprint?.dur ?? 0, sprintCool: 0,
      formation: cfg.formation ? cfg.formation.clone() : null,
      pincerSide: 1, distressCd: 0, lastEvent: {},
      combatSpeed: cfg.combatSpeed ?? npc.combatSpeed ?? npc.maxSpeed,
      intent: { point: new THREE.Vector3(), speed: 0, fire: null, retreat: false, drift: false, formation: null, warpOut: false, hold: false },
    };
    npc.brain = b;
    squadOf(b.squadId).members.add(npc);
    return b;
  }

  function detach(npc) {
    if (!npc.brain) return;
    squads.get(npc.brain.squadId)?.members.delete(npc);
    npc.brain = null;
  }

  /** Trafienie: pamięć "kto mnie bije" (odwet) i "kto bije moich" (obrona). */
  function reportHit(victimNpc, shooterContact, amount = 0) {
    if (!shooterContact) return;
    const b = victimNpc?.brain;
    if (!b) return;
    b.attackers.set(shooterContact, time);
    b.dmgRecent += amount;
    b.lastHitT = time;
    squadOf(b.squadId).attackedBy.set(shooterContact, time);
    if (b.base === 'lurk' && !b.sprung) spring(b.squadId, 'hit');
  }

  /** Zasadzka: cała eskadra wychodzi z ukrycia naraz. */
  function spring(squadId, why = 'trigger') {
    const s = squads.get(squadId);
    if (!s) return;
    let any = false;
    for (const n of s.members) {
      if (!n.brain || n.brain.sprung) continue;
      n.brain.sprung = true;
      n.brain.base = 'hunt';
      n.brain.thinkIn = 0.05 + rng() * 0.25;
      n.stealth = false;
      any = true;
    }
    if (any) emit('spring', [...s.members][0], { squadId, why });
  }

  /** Alarm dla eskadry, która dotąd "nie widziała" gracza (blokada, patrole). */
  function alertSquad(squadId) {
    const s = squads.get(squadId);
    if (!s) return;
    for (const n of s.members) if (n.brain && !n.brain.alert) { n.brain.alert = true; n.brain.thinkIn = rng() * 0.3; }
  }

  /** Rozkaz dla eskadry (wataha): free | focus | pincer | cover | regroup. */
  function setOrder(squadId, order, target = null) {
    const s = squadOf(squadId);
    s.order = order;
    s.orderTarget = target;
    s.t = 0;
    let i = 0;
    for (const n of s.members) {
      if (!n.brain) continue;
      n.brain.thinkIn = 0.05 + 0.1 * i;
      n.brain.pincerSide = i % 2 ? -1 : 1;
      n.brain.phase = 'approach';
      n.brain.sub = 'swing';
      n.brain.subT = 0;
      i++;
    }
  }

  function setDifficulty(name) { DIFF = DIFFICULTY[name] ?? DIFF; }

  // ------------------------------------------------------------
  // DOWÓDCA ESKADRY (co 0,5 s): wspólny cel, role, żetony, okna, odwrót
  // ------------------------------------------------------------
  function tokensFor(target, s) {
    if (!target) return 2;
    let n = target.kind === 'player' ? DIFF.tokensVsPlayer : 2;
    if (s.order === 'focus') n += 1;
    return n;
  }

  function direct(s, world) {
    for (const n of s.members) if (!n.alive) s.members.delete(n);
    const members = [...s.members].filter((n) => n.brain && !n.hidden && !n.warping);
    if (!members.length) return;

    // --- wspólny cel ---
    let focus = null;
    if (s.orderTarget && s.orderTarget.isAlive() && (s.order === 'focus')) focus = s.orderTarget;
    else {
      const tally = new Map();
      for (const m of members) {
        const t = m.brain.target;
        if (!t || !t.isAlive()) continue;
        tally.set(t, (tally.get(t) ?? 0) + 1 + m.brain.targetScore);
      }
      if (s.focus && tally.has(s.focus)) tally.set(s.focus, tally.get(s.focus) + 0.6); // histereza
      let best = -1;
      for (const [t, v] of tally) if (v > best) { best = v; focus = t; }
    }
    s.focus = focus;

    // --- okno (burst): cała eskadra uderza naraz, potem krąży ---
    const burst = members.length >= 2 && members.every((m) => m.brain.temper.burst);
    if (burst) {
      s.window ??= { open: false, t: 0 };
      s.window.t += 0.5;
      if (s.window.t > (s.window.open ? 2.6 : 3.6)) {
        s.window.open = !s.window.open;
        s.window.t = 0;
        if (s.window.open) emit('window', members[0], { squadId: s.id });
      }
    } else s.window = null;

    // przynęta wygasa (albo zginęła) - wraca do zwykłych ról
    s.baitT -= 0.5;
    if (s.bait && (!s.bait.alive || s.baitT <= 0)) { if (s.bait.brain) s.bait.brain.role = 'flank'; s.bait = null; }

    // --- role: żetony natarcia, flanki, dystans ---
    const engaged = members.filter((m) => m.brain.plan === 'engage' && m.brain.target === focus && m.brain.role !== 'cover' && m !== s.bait);
    let tokens = tokensFor(focus, s);
    if (s.window) tokens = s.window.open ? engaged.length : 0;
    const dog = engaged.filter((m) => m.brain.style === 'dogfight');
    // zatrzymujemy żetony tym, którzy są w trakcie natarcia (bez szarpania w pół przelotu)
    const keep = dog.filter((m) => m.brain.role === 'strike' && (m.brain.phase === 'run' || m.brain.phase === 'approach'));
    const strikers = new Set(keep.slice(0, tokens));
    if (focus && strikers.size < tokens) {
      // kandydaci: kto jest bliżej rufy celu i jest zdrowszy - wchodzi pierwszy
      const cand = dog.filter((m) => !strikers.has(m) && m.brain.phase !== 'break').map((m) => {
        _a.copy(m.group.position).sub(focus.position);
        const d = _a.length();
        const rear = focus.forward ? -_a.normalize().dot(focus.forward) : 0;
        return { m, score: rear * 0.8 + m.hull / m.maxHull - d / 3000 };
      }).sort((x, y) => y.score - x.score);
      for (const c of cand) { if (strikers.size >= tokens) break; strikers.add(c.m); }
    }
    let slot = 0;
    const flankers = [];
    for (const m of engaged) {
      const b = m.brain;
      if (b.style === 'standoff') { b.role = 'standoff'; continue; }
      if (strikers.has(m)) { if (b.role !== 'strike') { b.role = 'strike'; b.phase = 'approach'; b.phaseT = 0; } continue; }
      if (b.role !== 'flank') { b.role = 'flank'; b.sub = 'move'; b.subT = rng() * 2; }
      flankers.push(m);
    }
    for (const m of flankers) { m.brain.slot = slot++; m.brain.slotN = Math.max(2, flankers.length); }
    s.slotSpin += 0.12;

    // --- przynęta (chytre rasy, cel = gracz, eskadra >= 3) ---
    const cunning = members.reduce((a, m) => a + m.brain.temper.cunning, 0) / members.length;
    if (!s.bait && focus?.kind === 'player' && flankers.length >= 1 && members.length >= 3 && cunning > 0.55 && rng() < 0.06 * cunning) {
      const bait = flankers.sort((x, y) => y.hull / y.maxHull - x.hull / x.maxHull)[0];
      if (bait.hull / bait.maxHull > 0.6) {
        s.bait = bait; s.baitT = 6 + rng() * 3;
        bait.brain.role = 'bait';
        emit('bait', bait, { target: focus });
      }
    }

    // --- pościg: jeden odcina drogę ---
    if (s.pursuit && focus && members.length >= 2) {
      const cut = members.filter((m) => m.brain.role !== 'strike' && m.brain.style === 'dogfight' && m.brain.plan === 'engage')
        .sort((x, y) => x.group.position.distanceTo(focus.position) - y.group.position.distanceTo(focus.position))[0];
      if (cut) { cut.brain.role = 'cutoff'; }
    }

    // --- ranny kolega: ktoś bierze jego prześladowcę ---
    for (const m of members) {
      const b = m.brain;
      if (m.hull / m.maxHull > 0.35) continue;
      let hunter = null, ht = -1;
      for (const [c, t] of b.attackers) if (c.isAlive() && t > ht && time - t < 5) { ht = t; hunter = c; }
      if (!hunter) continue;
      const buddy = members.filter((o) => o !== m && o.hull / o.maxHull > 0.6 && o.brain.role !== 'cover' && o.brain.plan === 'engage')
        .sort((x, y) => x.group.position.distanceTo(m.group.position) - y.group.position.distanceTo(m.group.position))[0];
      if (buddy) {
        buddy.brain.role = 'cover';
        buddy.brain.coverTarget = hunter;
        buddy.brain.target = hunter;
        buddy.brain.phase = 'approach';
        emit('cover', buddy, { mate: m, target: hunter });
      }
    }

    // --- bilans sił: przegrana potyczka = odwrót (rozłożony w czasie) ---
    if (!s.retreating && world && members.length) {
      let mine = 0, theirs = 0, aggr = 0, noRet = false;
      for (const m of members) { mine += m.hull / m.maxHull; aggr += m.brain.temper.aggression; noRet ||= m.brain.noRetreat || m.brain.base === 'pack' || m.brain.base === 'trader'; }
      aggr /= members.length;
      const seen = new Set();
      for (const m of members) for (const e of m.brain.enemies) if (!seen.has(e.c) && e.d < 3500) { seen.add(e.c); theirs += e.c.hullFrac * (e.c.kind === 'player' ? 1.6 : 1); }
      if (!noRet && theirs > 0 && mine / theirs < 0.3 && aggr < 0.85 && members.every((m) => m.hull / m.maxHull < 0.6)) {
        s.retreating = true;
        emit('squad-retreat', members[0], { squadId: s.id });
      }
    }
  }

  // ------------------------------------------------------------
  // PERCEPCJA + DECYZJA (co "czas reakcji")
  // ------------------------------------------------------------
  function scoreTarget(npc, c, d, s) {
    const b = npc.brain;
    const pos = npc.group.position;
    if (c.npc?.disabled) return 0; // unieruchomiony wrak nie jest zagrożeniem - szkoda ognia
    let v = (c.value ?? 1) * (b.prio ? b.prio(c) : 1);
    v *= 0.7 + 0.7 * (1 - c.hullFrac);                 // ranny cel = łatwy łup
    v *= 1 / (1 + d / 1600);                           // bliżej = taniej dolecieć
    const hitMe = b.attackers.get(c);
    if (hitMe != null && time - hitMe < 6) v *= 1.6;   // odwet
    const hitMates = s.attackedBy.get(c);
    if (hitMates != null && time - hitMates < 6) v *= 1.25; // bije moich
    if (s.focus === c) v *= 1 + 0.6 * b.temper.discipline;
    if (b.target === c) v *= 1.35;                     // histereza
    const ld = load.get(c) ?? 0;
    if (ld >= tokensFor(c, s) && b.target !== c) v *= 0.7; // tłok: rozłóż ogień
    // groźny cel (patrzy na mnie) - ostrożny i ranny pilot woli innego
    if (c.forward) {
      _a.copy(pos).sub(c.position).normalize();
      const facing = Math.max(0, c.forward.dot(_a));
      v *= 1 - 0.4 * b.temper.caution * facing * (1.2 - npc.hull / npc.maxHull);
    }
    return v;
  }

  function pickTarget(npc, cands, s) {
    const b = npc.brain;
    let best = null, bestV = 0, second = null, secondV = 0;
    for (const e of cands) {
      const v = scoreTarget(npc, e.c, e.d, s);
      if (v > bestV) { second = best; secondV = bestV; best = e.c; bestV = v; } else if (v > secondV) { second = e.c; secondV = v; }
    }
    // kreatywność: czasem drugi cel, żeby rozciągnąć obronę (nie przy rozkazie)
    if (second && s.order !== 'focus' && b.target !== best && secondV > bestV * 0.75 && rng() < b.temper.cunning * 0.25) {
      b.targetScore = secondV; return second;
    }
    b.targetScore = bestV;
    return best;
  }

  function newTarget(b, t) {
    if (b.target !== t) { b.target = t; b.phase = 'approach'; b.phaseT = 0; }
  }

  function think(npc, world) {
    const b = npc.brain;
    const s = squadOf(b.squadId);
    const pos = npc.group.position;
    const hullFrac = npc.hull / npc.maxHull;

    // --- percepcja: wrogowie w zasięgu czujników ---
    b.enemies.length = 0;
    b.gunsight = null;
    let exposure = 0, nearest = null;
    for (const c of world.contacts) {
      if (c.npc === npc || !c.isAlive() || !isFoe(npc.side, c.side)) continue;
      const d = c.position.distanceTo(pos);
      if (d > b.sensorRange) continue;
      b.enemies.push({ c, d });
      if (!nearest || d < nearest.d) nearest = { c, d };
      if (c.forward && d < 1800) {
        _a.copy(pos).sub(c.position).normalize();
        const dot = c.forward.dot(_a);
        if (dot > 0.9) exposure += dot;
        if (dot > 0.965 && (!b.gunsight || d < b.gunsight.d)) b.gunsight = { c, d };
      }
    }
    // czujniki eskadry: kolega widzi = ja wiem (cel wspólny poza moim zasięgiem)
    if (s.focus && s.focus.isAlive() && !b.enemies.some((e) => e.c === s.focus) && isFoe(npc.side, s.focus.side)) {
      b.enemies.push({ c: s.focus, d: s.focus.position.distanceTo(pos) });
    }

    // --- zasadzka: czekamy ---
    if (b.base === 'lurk' && !b.sprung) {
      b.plan = 'lurk';
      if (nearest && nearest.d < 650) spring(b.squadId, 'close');
      return;
    }
    // --- handlowiec / uciekinier: własne plany ---
    if (b.base === 'trader') { b.plan = 'route'; return; }
    if (b.base === 'runner') { b.plan = npc.disabled ? 'drift' : 'runner'; b.target = nearest?.c ?? null; return; }
    if (!b.alert) { b.plan = b.anchor ? 'patrol' : 'idle'; return; }

    // --- ryzyko ---
    const isolated = s.members.size > 1 && [...s.members].every((m) => m === npc || m.group.position.distanceTo(pos) > 2800);
    const risk = (1 - hullFrac) * 1.1 + (b.dmgRecent / npc.maxHull) * 2.5 + exposure * 0.2 + (isolated ? 0.25 : 0);
    const T = b.temper;

    // --- odwrót / odskok ---
    if (b.plan === 'retreat') return;
    if (!b.noRetreat) {
      const hopeless = hullFrac < 0.4 && risk * T.caution * 1.7 > 0.3 + T.aggression * 0.9;
      const ordered = s.retreating && rng() < 0.45; // odwrót eskadry - rozłożony w czasie
      if (b.base === 'pack' && hopeless) {
        // skrzydłowy watahy nie ucieka z pola - chowa się w szyku za graczem
        if (b.plan !== 'formation') emit('shelter', npc);
        b.plan = 'formation'; b.target = null;
        return;
      }
      if (hopeless || ordered) {
        if (b.regen > 0 && !ordered && hullFrac > 0.2) {
          if (b.plan !== 'disengage') { b.plan = 'disengage'; emit('disengage', npc); }
          return;
        }
        b.plan = 'retreat';
        emit('retreat', npc);
        return;
      }
    }
    if (b.plan === 'disengage') {
      if (hullFrac < 0.75 && !(nearest && nearest.d < 600)) return; // regeneracja w spokoju
      b.plan = 'engage';
    }

    // --- unik przed pociskiem ---
    const threat = combat?.incoming(pos, npc.radius, npc.actor?.side ?? npc.side, 3);
    if (b.plan === 'evade' && b.evadeT > 0) return;
    if (threat && threat.tca < (threat.guided ? 2.6 : 0.9) && rng() < DIFF.evadeSkill * b.skill) {
      // prostopadle do toru pocisku, w stronę, w którą i tak skręcamy
      _a.copy(FWD).applyQuaternion(npc.group.quaternion);
      _b.crossVectors(threat.dir, _a);
      if (_b.lengthSq() < 1e-4) _b.crossVectors(threat.dir, UP);
      _b.normalize().cross(threat.dir).normalize();
      if (_b.dot(_a) < 0) _b.negate();
      if (threat.aoe > 100) _b.addScaledVector(_c.copy(pos).sub(threat.from).normalize(), 0.8).normalize(); // torpeda: dalej od punktu implozji
      b.evadeDir.copy(_b);
      b.evadeT = threat.aoe > 100 ? 2.4 : 1.5;
      b.plan = 'evade';
      emit('evade', npc, { guided: threat.guided, torpedo: threat.aoe > 100 });
      return;
    }

    // --- szyk / osłona (wataha) ---
    if (b.base === 'pack' && s.order === 'regroup') {
      const threatNear = b.enemies.find((e) => e.d < 700 && b.attackers.has(e.c) && time - b.attackers.get(e.c) < 3);
      if (!threatNear) { b.plan = 'formation'; b.target = null; return; }
    }

    // --- kandydaci na cel wg bazy ---
    let cands = b.enemies;
    if (b.base === 'hold' && b.anchor) {
      cands = b.enemies.filter((e) => e.c.position.distanceTo(b.anchor) < b.leash);
      if (!cands.length) { b.target = null; b.plan = 'patrol'; b.role = 'free'; return; }
    }
    const guarding = b.base === 'guard' || (b.base === 'pack' && s.order === 'cover');
    const protect = b.base === 'guard' ? b.protect : (guarding ? world.player : null);
    if (guarding && protect) {
      const r = b.guardR;
      cands = b.enemies.filter((e) => e.c.position.distanceTo(protect.position) < r);
      // najpierw ci, którzy biją podopiecznego
      const hitters = cands.filter((e) => protect.recentAttackers?.has(e.c) && time - protect.recentAttackers.get(e.c) < 6);
      if (hitters.length) cands = hitters;
      if (!cands.length) { b.target = null; b.plan = 'escortPos'; b.role = 'free'; return; }
    }
    if (b.role === 'cover' && b.coverTarget?.isAlive()) {
      newTarget(b, b.coverTarget); b.plan = 'engage'; return;
    }
    if (b.role === 'cover') { b.role = 'free'; b.coverTarget = null; }
    if (b.base === 'pack' && s.order === 'focus' && s.orderTarget?.isAlive()) {
      newTarget(b, s.orderTarget); b.plan = 'engage'; return;
    }

    if (!cands.length) {
      b.target = null;
      b.plan = b.base === 'pack' ? 'formation' : b.anchor ? 'patrol' : 'search';
      return;
    }
    const t = pickTarget(npc, cands, s);
    newTarget(b, t);
    b.plan = 'engage';
    if (b.lastEvent.engage !== t) { b.lastEvent.engage = t; emit('engage', npc, { target: t }); }
  }

  // ------------------------------------------------------------
  // WYKONANIE PLANU (co klatkę) -> intencja dla ciała
  // ------------------------------------------------------------
  const clampSpeed = (npc, v) => Math.min(npc.maxSpeed, Math.max(0, v));

  /** Unik "nożycowy", gdy lufa wroga patrzy prosto na nas. */
  function addJink(npc, point, amp) {
    const b = npc.brain;
    if (!b.gunsight) return;
    _d.copy(npc.group.position).sub(b.gunsight.c.position).normalize();
    _e.crossVectors(_d, UP);
    if (_e.lengthSq() < 1e-4) _e.set(1, 0, 0);
    _e.normalize();
    _f.crossVectors(_e, _d).normalize();
    const k = amp * b.skill * DIFF.jink;
    point.addScaledVector(_e, Math.sin(time * 2.7 + b.seed) * k).addScaledVector(_f, Math.cos(time * 1.9 + b.seed * 1.7) * k * 0.6);
  }

  /** Punkt wyprzedzenia celu (Pieśniarze "znają twój tor" - dłuższe wyprzedzenie). */
  function leadPoint(npc, t, out) {
    const d = npc.group.position.distanceTo(t.position);
    const lead = Math.min(d / 700, 1.6) * (0.8 + 0.5 * npc.brain.temper.cunning);
    return out.copy(t.position).addScaledVector(t.velocity, lead);
  }

  function inRange(b, d) { return d < b.range; }

  function sprintSpeed(npc, dt, want) {
    const b = npc.brain;
    if (!b.sprint) return want;
    if (b.sprintCool > 0) { b.sprintCool -= dt; return want; }
    if (want > b.combatSpeed * 1.05) {
      b.sprintLeft -= dt;
      if (b.sprintLeft <= 0) { b.sprintCool = b.sprint.cool; b.sprintLeft = b.sprint.dur; emit('sprint-cool', npc); }
      return Math.max(want, b.sprint.speed);
    }
    b.sprintLeft = Math.min(b.sprint.dur, b.sprintLeft + dt * 0.5);
    return want;
  }

  function execEngage(npc, dt, world, I) {
    const b = npc.brain;
    const s = squadOf(b.squadId);
    const t = b.target;
    const pos = npc.group.position;
    if (!t || !t.isAlive()) { b.thinkIn = 0; b.plan = 'search'; I.point.copy(pos).addScaledVector(_a.copy(FWD).applyQuaternion(npc.group.quaternion), 800); I.speed = b.combatSpeed * 0.6; return; }
    const d = pos.distanceTo(t.position);
    const cs = b.combatSpeed;
    const tf = t.forward;
    const holdFire = s.window && !s.window.open && !(time - b.lastHitT < 2);
    b.phaseT += dt;

    // ----- przynęta: kręci się przed dziobem celu -----
    if (b.role === 'bait' && tf) {
      _a.crossVectors(tf, UP); if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0); _a.normalize();
      I.point.copy(t.position).addScaledVector(tf, 1400).addScaledVector(_a, Math.sin(time * 0.9 + b.seed) * 650);
      I.speed = cs * 0.9;
      addJink(npc, I.point, 260);
      I.fire = holdFire ? null : t;
      return;
    }

    // ----- odcinanie drogi (pościg) -----
    if (b.role === 'cutoff' && d > 900) {
      I.point.copy(t.position).addScaledVector(t.velocity, 4);
      I.speed = sprintSpeed(npc, dt, npc.maxSpeed);
      I.fire = inRange(b, d) ? t : null;
      return;
    }

    // ----- dystans (rakiety/torpedy): orbita na ~65% zasięgu -----
    if (b.role === 'standoff' || b.style === 'standoff') {
      const R = b.range * 0.65;
      _a.copy(pos).sub(t.position);
      if (_a.lengthSq() < 1) _a.set(0, 0, 1);
      _a.normalize();
      b.subT += dt;
      if (d < b.range * 0.35) {
        // za blisko na ciężki okręt: odejdź, nie kołuj z myśliwcem
        I.point.copy(t.position).addScaledVector(_a, R * 1.3);
        I.speed = npc.maxSpeed;
        addJink(npc, I.point, 200);
        I.fire = null;
        return;
      }
      if (b.sub === 'aim' && b.subT < 1.8) {
        leadPoint(npc, t, I.point);
        I.speed = cs * 0.55;
        I.fire = holdFire ? null : t;
      } else {
        if (b.sub === 'aim') { b.sub = 'move'; b.subT = 0; }
        _b.crossVectors(_a, UP); if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
        _a.applyAxisAngle(_b.normalize(), 0.12).applyAxisAngle(UP, 0.55 * (b.seed > 50 ? 1 : -1));
        I.point.copy(t.position).addScaledVector(_a, R);
        I.speed = cs;
        I.fire = null;
        if (b.subT > 2.2 && d < b.range) { b.sub = 'aim'; b.subT = 0; }
      }
      addJink(npc, I.point, 160);
      return;
    }

    // ----- flanka: krąży w swoim "slocie" wokół celu, czeka na żeton -----
    if (b.role === 'flank') {
      const Rf = 1150 + 180 * (b.slot % 2);
      const ang = s.slotSpin + (b.slot / b.slotN) * Math.PI * 2;
      const axis = tf ?? UP;
      _a.crossVectors(axis, UP); if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0); _a.normalize();
      _b.crossVectors(axis, _a).normalize();
      I.point.copy(t.position).addScaledVector(_a, Math.cos(ang) * Rf).addScaledVector(_b, Math.sin(ang) * Rf * 0.7);
      if (tf) I.point.addScaledVector(tf, -300);
      I.speed = cs;
      // broń dalekiego zasięgu: co jakiś czas zwrot i strzał z flanki
      b.subT += dt;
      if (b.range > 2000 && d < b.range) {
        if (b.sub === 'snap' && b.subT < 1.1) { leadPoint(npc, t, I.point); I.speed = cs * 0.7; }
        else if (b.subT > 3 + (b.seed % 2)) { b.sub = b.sub === 'snap' ? 'move' : 'snap'; b.subT = 0; }
      }
      I.fire = holdFire ? null : (d < b.range ? t : null);
      addJink(npc, I.point, 220);
      return;
    }

    // ----- natarcie (strike / cover / free): podejście - przelot - zwrot - odejście -----
    const minR = 170 + npc.radius + (t.radius ?? 10);
    switch (b.phase) {
      case 'approach': {
        leadPoint(npc, t, I.point);
        // chytrzy wchodzą od rufy celu zamiast czołowo
        if (tf && d > 900) I.point.addScaledVector(tf, -700 * b.temper.cunning);
        I.speed = sprintSpeed(npc, dt, d > 1800 ? npc.maxSpeed : cs);
        // czołowe starcie z lufą celu: nożyce, chyba że to frenzja
        if (b.temper.aggression < 0.8) addJink(npc, I.point, 240);
        I.fire = holdFire ? null : (inRange(b, d) ? t : null);
        if (d < 1100 || b.phaseT > 12) { b.phase = 'run'; b.phaseT = 0; }
        break;
      }
      case 'run': {
        leadPoint(npc, t, I.point);
        I.speed = d > 700 ? cs : cs * 0.65; // z bliska zwolnij - dłużej na celu
        I.fire = holdFire ? null : t;
        const hurt = npc.hull / npc.maxHull < 0.5;
        const tooLong = b.phaseT > 4 + 3 * b.temper.aggression;
        if (d < minR || tooLong || (b.gunsight && hurt && b.phaseT > 1.2)) {
          // zwrot: w bok od linii celu, z dala od jego dziobu, nie tam gdzie ostatnio
          _a.copy(pos).sub(t.position).normalize();
          _b.set(rng() - 0.5, (rng() - 0.5) * 0.6, rng() - 0.5).normalize();
          _b.addScaledVector(_a, -_b.dot(_a)).normalize();
          if (tf) _b.addScaledVector(tf, -0.5);
          if (_b.dot(b.lastBreak) > 0.3) _b.negate();
          b.breakDir.copy(_b.addScaledVector(_a, 0.4).normalize());
          b.lastBreak.copy(b.breakDir);
          b.phase = 'break'; b.phaseT = 0;
        }
        break;
      }
      case 'break': {
        I.point.copy(pos).addScaledVector(b.breakDir, 1000);
        I.speed = Math.min(npc.maxSpeed, cs * 1.2);
        addJink(npc, I.point, 200);
        I.fire = null;
        if (b.phaseT > 2.2 + b.seed % 1 || d > 1400) { b.phase = 'extend'; b.phaseT = 0; }
        break;
      }
      default: { // extend
        _a.copy(pos).sub(t.position).normalize();
        I.point.copy(t.position).addScaledVector(_a, 1400);
        I.speed = cs;
        I.fire = null;
        if (d > 1150 || b.phaseT > 3) { b.phase = 'approach'; b.phaseT = 0; }
      }
    }
  }

  /**
   * Główne wejście: wołane co klatkę dla każdego NPC z mózgiem.
   * @returns intencja { point, speed, fire, retreat, drift, formation, warpOut, hold }
   */
  function decide(npc, dt, world) {
    const b = npc.brain;
    const I = b.intent;
    I.fire = null; I.retreat = false; I.drift = false; I.formation = null; I.warpOut = false; I.hold = false;
    b.dmgRecent *= Math.exp(-dt / 3);
    b.distressCd -= dt;
    b.thinkIn -= dt;
    if (b.thinkIn <= 0) {
      think(npc, world);
      b.thinkIn = DIFF.reaction * (0.75 + 0.5 * rng()) * (1.25 - 0.5 * b.temper.discipline);
    }
    const pos = npc.group.position;
    const s = squadOf(b.squadId);

    switch (b.plan) {
      case 'lurk':
        I.hold = true;
        I.point.copy(b.anchor ?? pos).add(_a.copy(FWD).applyQuaternion(npc.group.quaternion).multiplyScalar(500));
        I.speed = 0;
        break;
      case 'drift':
        I.drift = true;
        break;
      case 'route': {
        const r = b.route;
        if (!r || b.routeIdx >= r.length) { I.warpOut = true; I.point.copy(pos).addScaledVector(_a.copy(FWD).applyQuaternion(npc.group.quaternion), 800); I.speed = b.combatSpeed; break; }
        const wp = r[b.routeIdx];
        if (pos.distanceTo(wp) < 320) b.routeIdx++;
        I.point.copy(wp);
        I.speed = b.combatSpeed;
        if (time - b.lastHitT < 3) {
          // pod ostrzałem: szarpany kurs i pełna moc
          _a.copy(wp).sub(pos).normalize();
          _b.crossVectors(_a, UP).normalize();
          I.point.addScaledVector(_b, Math.sin(time * 1.6 + b.seed) * 350);
          I.speed = npc.maxSpeed;
          if (b.distressCd <= 0) { b.distressCd = 14; emit('distress', npc); }
        }
        if (b.route && b.routeIdx >= b.route.length) I.warpOut = true;
        break;
      }
      case 'runner': {
        // ucieczka: od najbliższego wroga + własny kurs ucieczki, zygzakiem
        const th = b.target;
        _a.copy(b.heading ?? _b.copy(FWD).applyQuaternion(npc.group.quaternion));
        if (th && th.isAlive()) {
          _c.copy(pos).sub(th.position);
          const d = _c.length();
          _c.normalize().multiplyScalar(THREE.MathUtils.clamp(2200 / Math.max(d, 1), 0.3, 2));
          _a.add(_c);
        }
        _a.normalize();
        I.point.copy(pos).addScaledVector(_a, 1200);
        _b.crossVectors(_a, UP).normalize();
        I.point.addScaledVector(_b, Math.sin(time * 1.3 + b.seed) * 380).addScaledVector(UP, Math.cos(time * 0.9 + b.seed) * 200);
        I.speed = npc.maxSpeed;
        break;
      }
      case 'patrol': {
        const a = b.anchor ?? pos;
        const ang = time * 0.12 + b.seed;
        I.point.set(Math.cos(ang) * 380, Math.sin(ang * 0.7) * 60, Math.sin(ang) * 380).add(a);
        I.speed = pos.distanceTo(a) > 900 ? b.combatSpeed : b.combatSpeed * 0.4;
        break;
      }
      case 'idle':
        I.point.copy(pos).addScaledVector(_a.copy(FWD).applyQuaternion(npc.group.quaternion), 800);
        I.speed = npc.speed * 0.98;
        break;
      case 'search': {
        // nikogo w zasięgu: do wspólnego celu eskadry, do posterunku, albo prosto
        const f = s.focus?.isAlive() ? s.focus.position : (world.player?.isAlive() && isFoe(npc.side, 'player') ? world.player.position : null);
        if (f) { I.point.copy(f); I.speed = b.combatSpeed; } else { I.point.copy(pos).addScaledVector(_a.copy(FWD).applyQuaternion(npc.group.quaternion), 800); I.speed = b.combatSpeed * 0.5; }
        break;
      }
      case 'formation':
        I.formation = b.formation ?? _a.set(180, 20, 260);
        break;
      case 'escortPos': {
        const p = b.base === 'guard' ? b.protect : world.player;
        if (!p || !p.isAlive()) { I.point.copy(pos); I.speed = 0; b.plan = 'search'; break; }
        const pf = p.forward ?? FWD;
        _a.crossVectors(pf, UP); if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0); _a.normalize();
        const side = (b.seed > 50 ? 1 : -1);
        I.point.copy(p.position).addScaledVector(pf, -260 - 60 * (b.slot % 3)).addScaledVector(_a, side * (220 + (p.radius ?? 20) * 2));
        const d = pos.distanceTo(I.point);
        I.speed = clampSpeed(npc, (p.velocity?.length() ?? 0) + d * 0.8);
        break;
      }
      case 'disengage': {
        // odskok na regenerację (rasy z regeneracją kadłuba): z dala od wrogów
        _a.set(0, 0, 0);
        for (const e of b.enemies) _a.add(_c.copy(pos).sub(e.c.position).normalize().divideScalar(Math.max(e.d / 1000, 0.3)));
        if (_a.lengthSq() < 1e-6) _a.copy(FWD).applyQuaternion(npc.group.quaternion);
        I.point.copy(pos).addScaledVector(_a.normalize(), 1500);
        const near = b.enemies.reduce((m, e) => Math.min(m, e.d), Infinity);
        I.speed = near < 2600 ? npc.maxSpeed : b.combatSpeed * 0.3;
        addJink(npc, I.point, 220);
        break;
      }
      case 'evade':
        b.evadeT -= dt;
        I.point.copy(pos).addScaledVector(b.evadeDir, 900);
        I.speed = npc.maxSpeed;
        if (b.evadeT <= 0) { b.plan = 'engage'; b.thinkIn = 0; }
        break;
      case 'retreat':
        I.retreat = true;
        break;
      case 'engage':
        execEngage(npc, dt, world, I);
        break;
      default:
        I.point.copy(pos); I.speed = 0;
    }
    // "pincer" watahy: skrzydło najpierw wychodzi na swoją flankę celu
    if (b.plan === 'engage' && b.base === 'pack' && s.order === 'pincer' && b.sub === 'swing' && b.target) {
      b.subT += dt;
      const t = b.target;
      _a.copy(t.position).sub(world.player?.position ?? pos).normalize();
      _b.crossVectors(_a, UP); if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
      I.point.copy(t.position).addScaledVector(_b.normalize(), b.pincerSide * 1300).addScaledVector(_a, 200);
      I.speed = npc.maxSpeed;
      I.fire = null;
      if (pos.distanceTo(I.point) < 350 || b.subT > 9) { b.sub = 'move'; b.subT = 0; b.phase = 'approach'; emit('pincer-in', npc, { target: t }); }
    }
    return I;
  }

  /** Co klatkę, przed decide(): obciążenie celów i dowódcy eskadr. */
  function update(dt, world) {
    time += dt;
    load.clear();
    for (const s of squads.values()) {
      for (const n of s.members) {
        const b = n.brain;
        if (!n.alive || !b) continue;
        if (b.plan === 'engage' && b.target && (b.phase === 'approach' || b.phase === 'run') && b.role !== 'flank' && b.role !== 'standoff') {
          load.set(b.target, (load.get(b.target) ?? 0) + 1);
        }
      }
      s.t -= dt;
      if (s.t <= 0) { s.t = 0.5; direct(s, world); }
      if (!s.members.size) squads.delete(s.id);
    }
  }

  function clear() { squads.clear(); load.clear(); }

  return {
    attach, detach, decide, update, reportHit, spring, alertSquad, setOrder, setDifficulty, clear,
    squad: (id) => squads.get(id) ?? null,
    squadOf,
    get difficulty() { return DIFF; },
    get time() { return time; },
  };
}
