import { RACES, relation as baseRelation } from '../data/races.js';
import { STRATEGY as S } from '../data/economy.js';
import { TEMPERAMENT } from './tactical-ai.js';
import { generateFields, fieldValue } from './fields.js';
import { seededRng } from './asteroid-belt.js';

/**
 * WARSTWA STRATEGICZNA (krok 11): rasy rywalizują o pola surowcowe.
 *
 * Gra toczy się o PRZESTRZEŃ EKONOMICZNĄ. Każde pole surowcowe (fields.js)
 * ma właściciela: rasę, gracza albo nikogo. Rasy (wszystkie poza rasą gracza)
 * to gracze ekonomiczni jak w RTS-ie: zarabiają na swoich polach, zakładają
 * placówki na wolnych, rozbudowują je i budują flotę. Walka jest KONSEKWENCJĄ
 * gospodarki:
 *   - kto dzieli z kimś układ, ten z nim rywalizuje (relacja powoli spada,
 *     szybciej u chciwych ras) - napięcie rośnie samo z ekspansji,
 *   - kopanie na cudzym polu i atak na cudze aktywa to prowokacja,
 *   - gdy relacja spadnie poniżej STRATEGY.war, agresywna i dość silna rasa
 *     wypowiada wojnę i zaczyna atakować pola wroga (najbogatsze i najsłabiej
 *     bronione); słabsza strona prosi o pokój,
 *   - wspólny wróg zbliża, pakt i sojusz (dyplomacja gracza) chronią i
 *     wciągają sojusznika w wojny.
 *
 * Gracz ma pole, gdy stoi na nim jego gotowa stacja (economy.js). Pola gracza
 * nie da się "przejąć" - można je złupić (naloty: raids.js, a zaocznie
 * economy.resolveRaidOffline). Pole rasy zdobywa się, niszcząc jej placówkę
 * (rival-presence.js w układzie gracza, armia zaocznie - army.js).
 *
 * Stan jest częścią zapisu gospodarki (economy.state.strategy). Czysta logika
 * z ziarnem (Node i przeglądarka); kontakt ze światem przez `hooks`:
 *   playerFieldIds()             pola, na których gracz ma gotową stację
 *   playerPower() / playerFieldDefense(fid)   siła armii i obrony gracza
 *   attackPlayer({ faction, field, power })   atak rasy na pole gracza
 *   playerSystemId()             układ, w którym jest gracz
 * Zdarzenia (onEvent): { type: 'news'|'war'|'peace'|'proposal'|'field'|'victory', ... }
 */

export const PLAYER = 'player';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Stronnictwo, które rządzi rasą: agresywne rasy - "jastrzębie", reszta - handlowe. */
export function rulingFaction(raceId) {
  return (TEMPERAMENT[raceId]?.aggression ?? 0.5) > 0.62 ? 'hawk' : 'trade';
}

export function createStrategy({ economy, playerRace, systems, spawnOf, onEvent = () => {}, hooks = {}, seed = 1 }) {
  const rng = seededRng(seed + 7);
  const defs = new Map();       // fieldId -> definicja pola
  const bySystem = new Map();   // systemId -> [fieldId]
  for (const sysId of systems) {
    const list = generateFields(sysId, spawnOf(sysId));
    bySystem.set(sysId, list.map((f) => f.id));
    for (const f of list) defs.set(f.id, f);
  }
  const allFields = [...defs.keys()];
  const totalValue = allFields.reduce((a, id) => a + fieldValue(defs.get(id)), 0);
  let acc = 0;

  const say = (e) => onEvent(e);
  const race = (id) => RACES[id];
  const factionName = (id) => race(id).factions[rulingFaction(id)];

  // ------------------------------------------------------------
  // STAN
  // ------------------------------------------------------------
  function newGame(startSystem) {
    const ais = Object.keys(RACES).filter((r) => r !== playerRace);
    const st = {
      version: 1, time: 0, startSystem, playerRace,
      factions: {}, fields: {}, rel: {}, stance: {}, proposals: [], log: [], won: false,
    };
    for (const id of ais) {
      const t = TEMPERAMENT[id] ?? TEMPERAMENT.wybudzeni;
      const a = race(id).attrs;
      st.factions[id] = {
        id, credits: S.startCredits, ships: S.startShips,
        aggression: t.aggression, caution: t.caution,
        greed: clamp(0.35 + 0.08 * (a.infl - 5) + 0.25 * t.aggression, 0.15, 1),
        expansion: clamp(0.5 + 0.08 * (a.nav - 5), 0.2, 1),
        lastAttack: -999, warSince: {}, settling: null, lastDemand: -999, lastOffer: -999, gifts: 0,
      };
    }
    for (const id of allFields) st.fields[id] = { owner: null, develop: 0, siege: null };
    // relacje: wartości startowe z races.js (skala x1.2), wszyscy ze wszystkimi
    const who = [PLAYER, ...ais];
    for (const a of who) {
      st.rel[a] = {}; st.stance[a] = {};
      for (const b of who) {
        if (a === b) continue;
        const ra = a === PLAYER ? playerRace : a, rb = b === PLAYER ? playerRace : b;
        st.rel[a][b] = ra === rb ? 30 : baseRelation(ra, rb) * 1.2;
        st.stance[a][b] = 'pokoj';
      }
    }
    // rozstawienie ras: po 2 pola, przemieszane po układach; pole macierzyste
    // gracza (pole 0 w układzie startowym) zawsze wolne, a obok - rywal
    const free = allFields.filter((id) => id !== `${startSystem}:0`);
    const shuffled = free.map((id) => ({ id, k: rng() })).sort((x, y) => x.k - y.k).map((x) => x.id);
    const near = shuffled.filter((id) => id.startsWith(`${startSystem}:`));
    const others = shuffled.filter((id) => !id.startsWith(`${startSystem}:`));
    const order = [...near.slice(0, 2), ...others];
    let i = 0;
    for (const f of ais) {
      for (let k = 0; k < 2 && i < order.length; k++, i++) {
        st.fields[order[i]] = { owner: f, develop: 1 + Math.floor(rng() * 2), siege: null };
      }
    }
    return st;
  }

  const state = () => economy.state.strategy;
  function ensure(startSystem) {
    if (!economy.state.strategy) economy.state.strategy = newGame(startSystem);
    return state();
  }

  // ------------------------------------------------------------
  // ODCZYT
  // ------------------------------------------------------------
  // pola gracza liczone raz na krok/klatkę (pytanie o stacje gospodarki jest drogie)
  let pfCache = null;
  const playerFields = () => (pfCache ??= new Set(hooks.playerFieldIds?.() ?? []));
  function ownerOf(fid) {
    if (playerFields().has(fid)) return PLAYER;
    return state().fields[fid]?.owner ?? null;
  }
  const rel = (a, b) => state().rel[a]?.[b] ?? 0;
  const stance = (a, b) => state().stance[a]?.[b] ?? 'pokoj';
  const atWar = (a, b) => stance(a, b) === 'wojna';
  function setRel(a, b, v) {
    const st = state();
    st.rel[a][b] = st.rel[b][a] = clamp(v, -100, 100);
  }
  function addRel(a, b, d) { setRel(a, b, rel(a, b) + d); }
  function setStance(a, b, s) { const st = state(); st.stance[a][b] = st.stance[b][a] = s; }

  function fieldsOf(who) { return allFields.filter((id) => ownerOf(id) === who); }
  function valueOf(who) { return fieldsOf(who).reduce((a, id) => a + fieldValue(defs.get(id)) * Math.max(1, state().fields[id].develop || 1), 0); }
  /** Siła (okręty + obrona placówek) - do decyzji o wojnie i pokoju. */
  function power(who) {
    if (who === PLAYER) return hooks.playerPower?.() ?? 1;
    const f = state().factions[who];
    return f.ships + fieldsOf(who).reduce((a, id) => a + state().fields[id].develop * 0.5, 0);
  }
  function fieldDefense(fid) {
    const owner = ownerOf(fid);
    if (owner === PLAYER) return hooks.playerFieldDefense?.(fid) ?? 1;
    if (!owner) return 0;
    const f = state().factions[owner];
    const n = Math.max(1, fieldsOf(owner).length);
    return state().fields[fid].develop * 1.5 + f.ships * 0.35 / n;
  }
  /** Udział w wartości wszystkich pól (0..1) - ranking dominacji. */
  function share(who) {
    return fieldsOf(who).reduce((a, id) => a + fieldValue(defs.get(id)), 0) / totalValue;
  }
  const systemOf = (fid) => defs.get(fid).systemId;
  const presentIn = (who, sysId) => (bySystem.get(sysId) ?? []).some((id) => ownerOf(id) === who);

  function log(text, extra = {}) {
    const st = state();
    st.log.unshift({ t: st.time, text, ...extra });
    st.log.length = Math.min(st.log.length, 40);
    say({ type: 'news', text, ...extra });
  }

  // ------------------------------------------------------------
  // DYPLOMACJA
  // ------------------------------------------------------------
  function declareWar(a, b, why = '') {
    if (atWar(a, b)) return;
    setStance(a, b, 'wojna');
    addRel(a, b, -15);
    const st = state();
    (st.factions[a]?.warSince ?? {})[b] = st.time;
    if (st.factions[b]) st.factions[b].warSince[a] = st.time;
    const an = a === PLAYER ? 'Ty' : race(a).name, bn = b === PLAYER ? 'tobie' : race(b).name;
    const text = a === PLAYER ? `Wypowiadasz wojnę rasie ${race(b).name}.` : `${an} wypowiadają wojnę ${b === PLAYER ? 'tobie' : `rasie ${bn}`}${why ? `: ${why}` : ''}.`;
    say({ type: 'war', a, b, text, faction: a === PLAYER ? b : a });
    st.log.unshift({ t: st.time, text, faction: a === PLAYER ? b : a, kind: 'war' });
    // sojusznicy obu stron dołączają (tylko sojusz, nie pakt)
    for (const [side, other] of [[a, b], [b, a]]) {
      for (const ally of Object.keys(st.rel[side])) {
        if (ally === other || stance(side, ally) !== 'sojusz' || atWar(ally, other)) continue;
        setStance(ally, other, 'wojna');
        const txt = ally === PLAYER ? `Sojusz z rasą ${race(side).name} wciąga cię w wojnę z rasą ${race(other).name}.`
          : `${race(ally).name} dotrzymują sojuszu: wojna z ${other === PLAYER ? 'tobą' : `rasą ${race(other).name}`}.`;
        say({ type: 'war', a: ally, b: other, text: txt, faction: ally === PLAYER ? other : ally });
      }
    }
  }
  function makePeace(a, b) {
    if (!atWar(a, b)) return;
    setStance(a, b, 'pokoj');
    setRel(a, b, Math.max(rel(a, b), S.peaceBack));
    const other = a === PLAYER ? b : b === PLAYER ? a : null;
    const text = other ? `Pokój z rasą ${race(other).name}.` : `${race(a).name} i ${race(b).name} zawierają pokój.`;
    say({ type: 'peace', a, b, text, faction: other ?? a });
    state().log.unshift({ t: state().time, text, faction: other ?? a, kind: 'peace' });
  }

  /**
   * Akcje gracza (panel dyplomacji). Zwraca { ok, text }.
   *   war | peace | pact | alliance | gift | tribute
   */
  function playerAction(kind, fid) {
    const f = state().factions[fid];
    if (!f) return { ok: false, text: 'Nie ma takiej rasy.' };
    const r = rel(PLAYER, fid), name = race(fid).name;
    const mine = power(PLAYER), theirs = power(fid);
    switch (kind) {
      case 'war':
        declareWar(PLAYER, fid);
        return { ok: true, text: `Wojna z rasą ${name}. Ich placówki i drony są teraz celami.` };
      case 'peace': {
        if (!atWar(PLAYER, fid)) return { ok: false, text: 'Nie jesteście w stanie wojny.' };
        const losing = theirs < mine * 0.75;
        const tired = state().time - (f.warSince[PLAYER] ?? 0) > 240;
        if (r > -70 && (losing || tired || r > -40)) { makePeace(PLAYER, fid); return { ok: true, text: `${name} przyjmują pokój.` }; }
        return { ok: false, text: `${name} odrzucają pokój: czują się silniejsi (${theirs.toFixed(0)} vs ${mine.toFixed(0)}).` };
      }
      case 'pact':
        if (atWar(PLAYER, fid)) return { ok: false, text: 'Najpierw pokój.' };
        if (r < S.pact) return { ok: false, text: `${name} nie ufają ci na tyle (relacja ${Math.round(r)}, potrzeba ${S.pact}).` };
        setStance(PLAYER, fid, 'pakt'); addRel(PLAYER, fid, 5);
        log(`Pakt o nieagresji z rasą ${name}.`, { faction: fid, kind: 'pact' });
        return { ok: true, text: `Pakt z rasą ${name}: nie atakują twoich pól.` };
      case 'alliance':
        if (stance(PLAYER, fid) !== 'pakt' && stance(PLAYER, fid) !== 'sojusz') return { ok: false, text: 'Sojusz wymaga wcześniejszego paktu.' };
        if (r < S.alliance) return { ok: false, text: `Za mało zaufania (relacja ${Math.round(r)}, potrzeba ${S.alliance}).` };
        setStance(PLAYER, fid, 'sojusz');
        log(`Sojusz z rasą ${name}. Ich wrogowie są twoimi wrogami.`, { faction: fid, kind: 'alliance' });
        return { ok: true, text: `Sojusz z rasą ${name}.` };
      case 'gift': {
        const amount = 1000;
        if (economy.state.credits < amount) return { ok: false, text: 'Za mało kredytów (1000 kr).' };
        economy.state.credits -= amount;
        f.credits += amount;
        const gain = 12 / (1 + f.gifts * 0.5);
        f.gifts++;
        addRel(PLAYER, fid, gain);
        return { ok: true, text: `Dar przyjęty. Relacja z rasą ${name} +${gain.toFixed(0)}.` };
      }
      case 'tribute': {
        if (mine < theirs * 1.5) return { ok: false, text: `${name} śmieją się z żądania: nie jesteś od nich dość silny.` };
        const amount = Math.min(f.credits, 1500);
        f.credits -= amount; economy.state.credits += amount;
        addRel(PLAYER, fid, -18);
        return { ok: true, text: `${name} płacą haracz: +${Math.round(amount)} kr. Nie zapomną tego.` };
      }
    }
    return { ok: false, text: '?' };
  }

  /** Odpowiedź gracza na propozycję rasy (komunikator). */
  function answer(proposalId, accept) {
    const st = state();
    const p = st.proposals.find((x) => x.id === proposalId);
    if (!p) return;
    st.proposals.splice(st.proposals.indexOf(p), 1);
    const f = p.faction, name = race(f).name;
    if (p.kind === 'demand') {
      if (accept && economy.state.credits >= p.amount) {
        economy.state.credits -= p.amount; st.factions[f].credits += p.amount; addRel(PLAYER, f, 15);
        log(`Płacisz rasie ${name} ${p.amount} kr za spokój na polu ${defs.get(p.field)?.name ?? ''}.`, { faction: f });
      } else {
        addRel(PLAYER, f, -22);
        if (rel(PLAYER, f) < S.war + 10 && st.factions[f].aggression > 0.45) declareWar(f, PLAYER, 'odmowa haraczu');
        else log(`${name} zapamiętają odmowę.`, { faction: f });
      }
    } else if (p.kind === 'pact') {
      if (accept) { setStance(PLAYER, f, 'pakt'); addRel(PLAYER, f, 8); log(`Pakt o nieagresji z rasą ${name}.`, { faction: f, kind: 'pact' }); }
      else addRel(PLAYER, f, -5);
    } else if (p.kind === 'peace') {
      if (accept) makePeace(f, PLAYER); else addRel(PLAYER, f, -5);
    } else if (p.kind === 'alliance') {
      if (accept) { setStance(PLAYER, f, 'sojusz'); log(`Sojusz z rasą ${name} przeciw rasie ${race(p.against).name}.`, { faction: f, kind: 'alliance' }); if (!atWar(PLAYER, p.against)) declareWar(PLAYER, p.against); }
      else addRel(PLAYER, f, -4);
    }
  }

  function propose(p) {
    const st = state();
    if (st.proposals.some((x) => x.faction === p.faction)) return;
    p.id = `p${Math.floor(st.time)}-${p.faction}`;
    p.t = st.time;
    st.proposals.push(p);
    say({ type: 'proposal', proposal: p, faction: p.faction, text: p.text });
  }

  // ------------------------------------------------------------
  // WYDARZENIA NA POLACH (z gry)
  // ------------------------------------------------------------
  /** Gracz zniszczył część placówki rasy (rival-presence.js): -1 poziom, 0 = pole wolne. */
  function damageOutpost(fid, levels = 1, by = PLAYER) {
    const fs = state().fields[fid];
    if (!fs?.owner) return;
    const owner = fs.owner;
    if (by === PLAYER && !atWar(PLAYER, owner)) declareWar(owner, PLAYER, 'atak na placówkę');
    fs.develop = Math.max(0, fs.develop - levels);
    if (fs.develop === 0) {
      fs.owner = null;
      log(`${race(owner).name} tracą pole ${defs.get(fid).name} (${systemName(fid)}). Pole jest wolne.`, { faction: owner, kind: 'field', field: fid });
    }
  }
  function shipLost(fid, n = 1) {
    const f = state().factions[fid];
    if (f) f.ships = Math.max(0, f.ships - n);
  }
  const systemName = (fid) => hooks.systemName?.(systemOf(fid)) ?? systemOf(fid);
  /** Gracz kopie na cudzym polu - prowokacja. */
  function poached(fid, tons) {
    const owner = state().fields[fid]?.owner;
    if (!owner || playerFields().has(fid)) return;
    addRel(PLAYER, owner, -tons * S.poachPerTon);
  }
  /** Pole zajęte przez rasę? (do blokady budowy i kopania dronami) */
  function foreignOwner(fid) {
    const o = state()?.fields[fid]?.owner;
    return o && !playerFields().has(fid) ? o : null;
  }

  // ------------------------------------------------------------
  // KROK STRATEGICZNY
  // ------------------------------------------------------------
  function step() {
    pfCache = null;
    const st = state();
    st.time += S.tick;
    const ais = Object.keys(st.factions);
    const order = ais.map((id) => ({ id, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.id);

    // --- tarcie: wspólne układy, wspólny wróg, powrót do bazowych relacji ---
    const who = [PLAYER, ...ais];
    for (let i = 0; i < who.length; i++) {
      for (let j = i + 1; j < who.length; j++) {
        const a = who[i], b = who[j];
        let d = 0;
        const shared = systems.filter((s) => presentIn(a, s) && presentIn(b, s)).length;
        const greed = Math.max(st.factions[a]?.greed ?? 0.5, st.factions[b]?.greed ?? 0.5);
        const friendly = ['pakt', 'sojusz'].includes(stance(a, b));
        if (!friendly) d -= shared * S.contactFriction * greed;
        for (const c of ais) if (c !== a && c !== b && atWar(a, c) && atWar(b, c)) d += 0.35; // wspólny wróg
        if (friendly) d += 0.12;
        const ra = a === PLAYER ? playerRace : a, rb = b === PLAYER ? playerRace : b;
        d += (baseRelation(ra, rb) * 1.2 - rel(a, b)) * 0.004; // powolny powrót do "natury" ras
        addRel(a, b, d);
      }
    }

    for (const id of order) {
      const f = st.factions[id];
      const mine = fieldsOf(id);
      // --- dochód i utrzymanie ---
      f.credits += mine.reduce((a, fid) => a + S.income * fieldValue(defs.get(fid)) * st.fields[fid].develop, 0);
      f.credits -= f.ships * S.shipUpkeep;
      if (f.credits < 0) { f.ships = Math.max(0, f.ships - 1); f.credits = 0; }

      // --- zakładanie placówki (w toku) ---
      if (f.settling) {
        f.settling.t -= S.tick;
        const fs = st.fields[f.settling.field];
        if (ownerOf(f.settling.field) !== null) f.settling = null; // ktoś był szybszy
        else if (f.settling.t <= 0) {
          fs.owner = id; fs.develop = 1;
          log(`${race(id).name} zakładają placówkę: ${defs.get(f.settling.field).name} (${systemName(f.settling.field)}).`, { faction: id, kind: 'field', field: f.settling.field });
          f.settling = null;
        }
      }

      // --- wydatki: flota, gdy zagrożeni albo agresywni; rozbudowa; ekspansja ---
      const enemies = who.filter((o) => o !== id && atWar(id, o));
      const threat = enemies.reduce((a, o) => a + power(o), 0);
      const wantShips = Math.min(S.maxShips, Math.round(2 + mine.length * (0.8 + f.aggression) + threat * 0.6));
      if (f.ships < wantShips && f.credits > S.shipCost * (enemies.length ? 1 : 1.6)) { f.ships++; f.credits -= S.shipCost; }
      const cap = S.fieldsCapBase + Math.floor(st.time / S.fieldsCapEvery);
      if (!f.settling && mine.length < cap && f.credits > S.settleCost * (1.3 - f.expansion * 0.5)) {
        const target = allFields
          .filter((fid) => ownerOf(fid) === null && !Object.values(st.factions).some((o) => o.settling?.field === fid))
          .map((fid) => ({ fid, score: fieldValue(defs.get(fid)) * (presentIn(id, systemOf(fid)) ? 1.6 : 1) + rng() * 0.3 }))
          .sort((a, b) => b.score - a.score)[0];
        if (target) { f.credits -= S.settleCost; f.settling = { field: target.fid, t: S.settleTime }; }
      }
      const up = mine.map((fid) => ({ fid, lvl: st.fields[fid].develop })).filter((x) => x.lvl < S.maxDevelop)
        .sort((a, b) => fieldValue(defs.get(b.fid)) - fieldValue(defs.get(a.fid)) || a.lvl - b.lvl)[0];
      if (up && f.credits > S.developCost * (up.lvl + 1) * 1.2) { f.credits -= S.developCost * (up.lvl + 1); st.fields[up.fid].develop++; }

      // --- wojna: wypowiedzenie ---
      for (const o of who) {
        if (o === id || atWar(id, o) || ['pakt', 'sojusz'].includes(stance(id, o))) continue;
        if (o === PLAYER && (st.time < S.grace || !fieldsOf(PLAYER).length)) continue; // okres ochronny / nic do zdobycia
        const ratio = power(id) / Math.max(0.5, power(o));
        if (rel(id, o) < S.war && ratio > 1.3 - f.aggression * 0.6 && rng() < 0.25 + f.aggression * 0.3) {
          declareWar(id, o, 'spór o przestrzeń surowcową');
        }
      }
      // --- wojna: pokój, gdy przegrywają albo są zmęczeni ---
      for (const o of enemies) {
        const since = st.time - (f.warSince[o] ?? st.time);
        const losing = power(id) < power(o) * 0.6;
        if ((losing && rng() < 0.2) || (since > 420 && rel(id, o) > -60 && rng() < 0.08)) {
          if (o === PLAYER) propose({ kind: 'peace', faction: id, text: `${race(id).name}: dość tej wojny. Proponujemy pokój.` });
          else makePeace(id, o);
        }
      }

      // --- atak na pole wroga ---
      if (enemies.length && f.ships >= 2 && st.time - f.lastAttack > S.attackEvery * (1.4 - f.aggression)) {
        const targets = [];
        for (const o of enemies) for (const fid of fieldsOf(o)) {
          if (st.fields[fid].siege) continue;
          const def = fieldDefense(fid);
          targets.push({ fid, o, def, score: fieldValue(defs.get(fid)) / (1 + def) + rng() * 0.2 });
        }
        targets.sort((a, b) => b.score - a.score);
        const t = targets[0];
        const commit = Math.max(1, Math.round(f.ships * (0.35 + f.aggression * 0.35)));
        if (t && commit > t.def * (0.6 + f.caution * 0.6)) {
          f.lastAttack = st.time;
          if (t.o === PLAYER) {
            hooks.attackPlayer?.({ faction: id, field: t.fid, power: commit });
          } else {
            st.fields[t.fid].siege = { attacker: id, power: commit, t: S.siegeTime };
            log(`${race(id).name} atakują pole ${defs.get(t.fid).name} rasy ${race(t.o).name} (${systemName(t.fid)}).`, { faction: id, kind: 'war', field: t.fid });
          }
        }
      }

      // --- dyplomacja wobec gracza ---
      const rp = rel(id, PLAYER);
      if (!atWar(id, PLAYER) && stance(id, PLAYER) === 'pokoj') {
        // żądanie: silniejsza, chciwa rasa i gracz na polu w "jej" układzie
        const contested = fieldsOf(PLAYER).find((fid) => presentIn(id, systemOf(fid)));
        if (contested && st.time > S.grace * 0.5 && rp < 0 && f.greed > 0.45 && power(id) > power(PLAYER) * 1.1 && st.time - f.lastDemand > 300 && rng() < 0.15) {
          f.lastDemand = st.time;
          const amount = Math.round(400 + 300 * fieldValue(defs.get(contested)) + f.greed * 500);
          propose({ kind: 'demand', faction: id, field: contested, amount,
            text: `${race(id).name}: ${defs.get(contested).name} leży w naszej strefie. Zapłać ${amount} kr za prawo wydobycia albo pożałujesz.` });
        } else if (rp > S.pact + 5 && st.time - f.lastOffer > 240 && rng() < 0.12) {
          f.lastOffer = st.time;
          const common = ais.find((c) => c !== id && atWar(id, c) && !atWar(PLAYER, c) && rel(PLAYER, c) < 10);
          if (common && rp > S.alliance - 5) propose({ kind: 'alliance', faction: id, against: common, text: `${race(id).name}: ${race(common).name} zagrażają nam obu. Sojusz?` });
          else propose({ kind: 'pact', faction: id, text: `${race(id).name}: proponujemy pakt o nieagresji. Wasze drony nie ucierpią od naszych dział.` });
        }
      }
    }

    // --- propozycje bez odpowiedzi wygasają (milczenie = odmowa) ---
    for (const p of [...st.proposals]) if (st.time - p.t > 60) answer(p.id, false);

    // --- oblężenia zaoczne (rasa vs rasa) ---
    for (const fid of allFields) {
      const fs = st.fields[fid];
      if (!fs.siege) continue;
      fs.siege.t -= S.tick;
      if (fs.siege.t > 0) continue;
      const { attacker, power: p } = fs.siege;
      fs.siege = null;
      const owner = fs.owner;
      if (!owner || !st.factions[attacker]) continue;
      const def = fieldDefense(fid);
      const atk = p * (0.75 + rng() * 0.5), dfn = def * (0.75 + rng() * 0.5);
      const fa = st.factions[attacker], fo = st.factions[owner];
      if (atk > dfn) {
        fa.ships = Math.max(0, fa.ships - Math.round(p * 0.3));
        fo.ships = Math.max(0, fo.ships - Math.round(def * 0.25));
        fs.develop -= 2;
        const loot = Math.min(fo.credits, 400 * fieldValue(defs.get(fid)));
        fo.credits -= loot; fa.credits += loot;
        if (fs.develop <= 0) {
          fs.owner = attacker; fs.develop = 1;
          log(`${race(attacker).name} zdobywają ${defs.get(fid).name} od rasy ${race(owner).name}.`, { faction: attacker, kind: 'field', field: fid });
        } else log(`${race(attacker).name} łupią ${defs.get(fid).name} rasy ${race(owner).name}.`, { faction: attacker, field: fid });
      } else {
        fa.ships = Math.max(0, fa.ships - Math.round(p * 0.6));
        log(`${race(owner).name} odpierają atak rasy ${race(attacker).name} na ${defs.get(fid).name}.`, { faction: owner, field: fid });
      }
    }

    // --- zwycięstwo ---
    if (!st.won && share(PLAYER) >= S.dominance) {
      st.won = true;
      say({ type: 'victory', text: `Dominacja! Kontrolujesz ${Math.round(share(PLAYER) * 100)}% przestrzeni surowcowej znanego sektora.` });
    }
  }

  function update(dt) {
    if (!state()) return;
    pfCache = null;
    acc += dt;
    while (acc >= S.tick) { acc -= S.tick; step(); }
  }

  /** Ranking (mapa strategiczna): gracz i rasy wg udziału w polach. */
  function standings() {
    const st = state();
    return [PLAYER, ...Object.keys(st.factions)].map((id) => ({
      id, fields: fieldsOf(id).length, share: share(id), power: power(id), value: valueOf(id),
      rel: id === PLAYER ? 100 : rel(PLAYER, id), stance: id === PLAYER ? '' : stance(PLAYER, id),
      credits: id === PLAYER ? economy.state.credits : st.factions[id].credits, ships: id === PLAYER ? null : st.factions[id].ships,
    })).sort((a, b) => b.share - a.share || b.power - a.power);
  }

  return {
    ensure, update, step, get state() { return state(); },
    defs, bySystem, allFields, totalValue,
    ownerOf, foreignOwner, rel, stance, atWar, power, fieldDefense, share, standings, fieldsOf,
    playerAction, answer, damageOutpost, shipLost, poached, declareWar, makePeace,
    factionName, rulingFaction, systemOf,
  };
}
