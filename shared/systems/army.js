import * as THREE from 'three';
import { WARSHIPS, STRATEGY } from '../data/economy.js';
import { RACES } from '../data/races.js';
import { PLAYER } from './strategy.js';

/**
 * ARMIA GRACZA (krok 11): "bogać się i buduj armię, która cię obroni albo
 * zagarnie cudze bogactwa".
 *
 * Stocznia wojenna (stacja z economy.js) buduje okręty trzech klas
 * (WARSHIPS: eskortowiec, fregata, krążownik) z metalu zgromadzonego w
 * układzie i za kredyty; każdy okręt kosztuje też utrzymanie. Okręt należy
 * do układu, w którym stoi, i ma rozkaz:
 *   eskorta  leci z graczem (także przez skoki międzygwiezdne),
 *   obrona   pilnuje wskazanego pola gracza,
 *   atak     zdobywa wskazane pole rasy (wymaga wojny z właścicielem).
 *
 * W układzie gracza okręty są prawdziwymi NPC sojuszniczymi z taktycznym AI
 * (npc-ships.js), z modelem statku rasy gracza. Walczą z rabusiami, flotami
 * ras i placówkami (rival-presence.js). W innych układach liczą się jako SIŁA:
 * wzmacniają obronę pól gracza (strategy: playerFieldDefense) i co
 * STRATEGY.siegeTime oblegają pole z rozkazem "atak" (starcie zaoczne:
 * siła floty kontra obrona pola).
 *
 * Stan (economy.state.army) jest w zapisie gry; kadłuby okrętów też.
 */

export function createArmy({ economy, strategy, npcs, playerRace, player, onEvent = () => {}, rng = Math.random, modelFor = null,
  // krok 12: ulepszenia floty (command.js) - mnożniki siły ognia i wytrzymałości
  mods = () => ({ power: 1, hull: 1 }) }) {
  const spawned = new Map(); // shipId -> npc
  let upkeepAcc = 0, siegeAcc = 0, syncT = 0;

  const state = () => (economy.state.army ??= { ships: [], queue: [], nextId: 1, lost: 0, built: 0 });
  const name = (cls) => WARSHIPS[cls].name;

  // ------------------------------------------------------------
  // STOCZNIA
  // ------------------------------------------------------------
  const yardHere = () => economy.stations().find((s) => s.type === 'stocznia' && s.status === 'gotowa') ?? null;
  function order(cls) {
    const yard = yardHere();
    if (!yard) return { ok: false, text: 'Potrzebna gotowa stocznia wojenna w tym układzie.' };
    const def = WARSHIPS[cls];
    if (!economy.canPayCost(def.cost)) return { ok: false, text: `Za mało zasobów na: ${def.name}.` };
    economy.payCost(def.cost);
    state().queue.push({ cls, t: def.buildTime, sysId: economy.systemId, yard: yard.id, model: modelFor?.(cls) ?? null });
    economy.save();
    return { ok: true, text: `${def.name}: stępka położona (${def.buildTime} s).` };
  }

  // ------------------------------------------------------------
  // SIŁA (dla strategii)
  // ------------------------------------------------------------
  const shipsIn = (sysId) => state().ships.filter((s) => s.sysId === sysId);
  function power(sysId = null) {
    return state().ships.filter((s) => !sysId || s.sysId === sysId).reduce((a, s) => a + WARSHIPS[s.cls].power * (s.hull / WARSHIPS[s.cls].hull), 0) * mods().power;
  }
  /** Obrona pola gracza: okręty z rozkazem obrony tego pola + połowa pozostałych w układzie. */
  function fieldDefense(fid) {
    const sysId = strategy.systemOf(fid);
    return shipsIn(sysId).reduce((a, s) => a + WARSHIPS[s.cls].power * (s.order === 'obrona' && s.field === fid ? 1 : 0.5), 0) * mods().power;
  }

  // ------------------------------------------------------------
  // ROZKAZY
  // ------------------------------------------------------------
  function setOrder(shipIds, orderKind, field = null) {
    for (const s of state().ships) {
      if (!shipIds.includes(s.id)) continue;
      if (orderKind === 'atak') {
        const owner = strategy.foreignOwner(field);
        if (!owner) return { ok: false, text: 'To pole nie należy do żadnej rasy.' };
        if (!strategy.atWar(PLAYER, owner)) return { ok: false, text: `Atak na pole rasy ${RACES[owner].name} wymaga wojny (dyplomacja na mapie, M).` };
      }
      s.order = orderKind;
      s.field = field;
      if (field && orderKind !== 'eskorta') s.sysId = strategy.systemOf(field); // okręt przelatuje do układu pola
      const npc = spawned.get(s.id);
      if (npc) { npcs.remove(npc); spawned.delete(s.id); } // nowy mózg przy następnej synchronizacji
    }
    syncT = 0;
    economy.save();
    return { ok: true, text: 'Rozkaz przyjęty.' };
  }

  // ------------------------------------------------------------
  // NPC W UKŁADZIE GRACZA
  // ------------------------------------------------------------
  function fieldAnchor(fid) {
    const d = strategy.defs.get(fid);
    return new THREE.Vector3(d.center.x, d.center.y + 300, d.center.z);
  }
  function aiFor(s) {
    if (s.order === 'obrona' && s.field) return { base: 'hold', anchor: fieldAnchor(s.field), leash: 4500, squad: `obr-${s.field}` };
    if (s.order === 'atak' && s.field) {
      return { base: 'hunt', anchor: fieldAnchor(s.field), leash: 9000, squad: `atak-${s.field}`,
        prio: (c) => (c.kind === 'station' ? 3 : c.kind === 'drone' ? 0.6 : 1) };
    }
    return { base: 'guard', protect: npcs.playerContact, guardR: 3000, squad: 'eskorta' };
  }
  function spawnShip(s, near = null) {
    const def = WARSHIPS[s.cls];
    const at = near ?? (s.field ? fieldAnchor(s.field) : player.position.clone());
    const pos = at.clone().add(new THREE.Vector3((rng() - 0.5) * 600, (rng() - 0.5) * 200, (rng() - 0.5) * 600));
    const npc = npcs.spawn({
      raceId: playerRace(), factionKey: 'hawk', side: 'ally', position: pos, arrival: 'none', shipId: s.model ?? undefined,
      mode: 'tactical', hull: def.hull * mods().hull, label: `${def.name} · ${s.order}`, tag: 'fleet', callsign: s.callsign,
      maxSpeed: 700 * def.speed, combatSpeed: 300 * def.speed, ai: aiFor(s), noFlee: true,
    });
    npc.hull = s.hull * mods().hull; // stan zapisu w jednostkach bazowych, NPC z ulepszonym kadłubem
    npc.fleetShip = s;
    spawned.set(s.id, npc);
    return npc;
  }
  function sync() {
    const here = economy.systemId;
    for (const s of state().ships) {
      const npc = spawned.get(s.id);
      if (s.sysId === here && !npc) spawnShip(s);
      if (s.sysId !== here && npc) { npcs.remove(npc); spawned.delete(s.id); }
      if (npc) s.hull = Math.max(1, npc.hull / mods().hull);
    }
  }
  npcs.on('killed', (npc) => {
    const s = npc.fleetShip;
    if (!s) return;
    const st = state();
    st.ships.splice(st.ships.indexOf(s), 1);
    st.lost++;
    spawned.delete(s.id);
    onEvent({ key: 'fleet-lost', urgency: 'danger', text: `Straciliśmy okręt: ${name(s.cls)} „${s.callsign}”.` });
  });

  /** Przed skokiem: eskorta leci z graczem, reszta zostaje (zaocznie). */
  function beforeJump(toSys) {
    for (const s of state().ships) if (s.order === 'eskorta') s.sysId = toSys;
    for (const [id, npc] of spawned) { if (npc.alive) { const s = npc.fleetShip; s.hull = Math.max(1, npc.hull / mods().hull); } npcs.remove(npc); spawned.delete(id); }
  }

  // ------------------------------------------------------------
  // PĘTLA
  // ------------------------------------------------------------
  function update(dt) {
    const st = state();
    // produkcja
    for (const q of [...st.queue]) {
      q.t -= dt;
      if (q.t > 0) continue;
      st.queue.splice(st.queue.indexOf(q), 1);
      const callsigns = ['Grom', 'Tarcza', 'Włócznia', 'Sokół', 'Kowal', 'Burza', 'Kotwica', 'Iskra', 'Topór', 'Latarnia', 'Cierń', 'Dzwon'];
      const s = { id: `ok${st.nextId++}`, cls: q.cls, hull: WARSHIPS[q.cls].hull, sysId: q.sysId, order: 'eskorta', field: null, model: q.model,
        callsign: `${callsigns[st.nextId % callsigns.length]}-${st.nextId}` };
      st.ships.push(s);
      st.built++;
      onEvent({ key: 'fleet-built', urgency: 'info', text: `Stocznia: ${name(q.cls)} „${s.callsign}” gotowy do służby. Rozkazy: panel P → Flota.` });
      economy.save();
    }
    // utrzymanie (kr/min)
    upkeepAcc += dt;
    if (upkeepAcc >= 10) {
      const cost = st.ships.reduce((a, s) => a + WARSHIPS[s.cls].upkeep, 0) * (upkeepAcc / 60) * 6;
      economy.state.credits -= cost;
      upkeepAcc = 0;
    }
    // naprawa kadłubów w układzie ze stocznią (zaocznie i na miejscu), 1%/s
    for (const s of st.ships) {
      const max = WARSHIPS[s.cls].hull;
      if (s.hull < max && economy.stationsIn(s.sysId).some((x) => x.type === 'stocznia' && x.status === 'gotowa')) {
        s.hull = Math.min(max, s.hull + max * 0.01 * dt);
        const npc = spawned.get(s.id);
        if (npc) npc.hull = Math.max(npc.hull, s.hull * mods().hull);
      }
    }
    syncT -= dt;
    if (syncT <= 0) { syncT = 1; sync(); }

    // oblężenia zaoczne: okręty z rozkazem "atak" w układzie, w którym nie ma gracza
    siegeAcc += dt;
    if (siegeAcc >= STRATEGY.siegeTime) {
      siegeAcc = 0;
      const groups = new Map();
      for (const s of st.ships) if (s.order === 'atak' && s.field && s.sysId !== economy.systemId) (groups.get(s.field) ?? groups.set(s.field, []).get(s.field)).push(s);
      for (const [fid, ships] of groups) resolveSiege(fid, ships);
    }
  }

  function resolveSiege(fid, ships) {
    const owner = strategy.foreignOwner(fid);
    const def = strategy.defs.get(fid);
    if (!owner || !strategy.atWar(PLAYER, owner)) {
      for (const s of ships) { s.order = 'obrona'; }
      return;
    }
    const atk = ships.reduce((a, s) => a + WARSHIPS[s.cls].power * (s.hull / WARSHIPS[s.cls].hull), 0) * mods().power * (0.8 + rng() * 0.4);
    const dfn = strategy.fieldDefense(fid) * (0.8 + rng() * 0.4);
    // straty obu stron proporcjonalne do siły przeciwnika
    let dmg = dfn * 90;
    for (const s of ships) { const k = Math.min(s.hull - 1, dmg / ships.length); s.hull -= k; }
    const dead = ships.filter((s) => s.hull < WARSHIPS[s.cls].hull * 0.12);
    for (const s of dead) { state().ships.splice(state().ships.indexOf(s), 1); state().lost++; }
    strategy.shipLost(owner, Math.round(atk * 0.25));
    if (atk > dfn) {
      strategy.damageOutpost(fid, 2, PLAYER);
      const free = !strategy.foreignOwner(fid);
      onEvent({ key: `siege-${fid}`, urgency: 'info', faction: owner,
        text: free ? `Flota zdobyła ${def.name}: placówka rasy ${RACES[owner].name} rozbita, pole wolne.`
          : `Flota niszczy część placówki rasy ${RACES[owner].name} na polu ${def.name}.${dead.length ? ` Straty: ${dead.length}.` : ''}` });
      if (free) for (const s of ships) { s.order = 'obrona'; }
    } else {
      onEvent({ key: `siege-${fid}`, urgency: 'warning', faction: owner,
        text: `Oblężenie pola ${def.name} odparte przez rasę ${RACES[owner].name}.${dead.length ? ` Straciliśmy ${dead.length} okr.` : ''}` });
    }
  }

  return {
    update, order, setOrder, beforeJump, power, fieldDefense, sync,
    get ships() { return state().ships; }, get queue() { return state().queue; },
    get lost() { return state().lost; }, yardHere, spawned,
    upkeepPerMin: () => state().ships.reduce((a, s) => a + WARSHIPS[s.cls].upkeep, 0) * 6,
  };
}
