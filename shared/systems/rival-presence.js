import * as THREE from 'three';
import { RACES } from '../data/races.js';
import { STATIONS } from '../data/economy.js';
import { buildStationModel, setStationProgress, animateStation, disposeObject, createDroneRenderer } from './economy-visuals.js';
import { surfacePoint, seededRng, hashString } from './asteroid-belt.js';
import { PLAYER } from './strategy.js';

/**
 * PLACÓWKI RAS W UKŁADZIE GRACZA (krok 11).
 *
 * Strategia (strategy.js) mówi, która rasa ma które pole i jak rozbudowane.
 * Tu to widać: na każdym polu rasy w bieżącym układzie stoi placówka - tyle
 * stacji, ile poziomów rozwoju (dok, magazyn, wieża, przeładunek, druga
 * wieża), w kolorze rasy, z własnym rojem dronów kopiących na tamtejszych
 * skałach. Rywale są widoczni, zanim dojdzie do walki.
 *
 * POKÓJ: stacje i drony są neutralne (pociski gracza ich nie trafiają, combat.js).
 * WOJNA: te same obiekty stają się wrogie - wieże strzelają do gracza, jego
 * dronów i floty, przy placówce krążą okręty patrolowe rasy (NPC z
 * taktycznym AI), a zniszczenie stacji obniża poziom pola
 * (strategy.damageOutpost). Poziom 0 = pole wolne, można tam budować.
 *
 * Drony rasy są czysto wizualne (nie wydobywają z gospodarki gracza), ale
 * można je zestrzelić w czasie wojny.
 */

const LEVEL_TYPES = ['dok', 'magazyn', 'wieza', 'przeladunek', 'wieza'];
const TOWER = { range: 2000, every: 0.45, damage: 11, speed: 1400 };

export function createRivalPresence({ scene, economy, strategy, combat, npcs, player, onEvent = () => {}, quality = 1 }) {
  const outposts = new Map(); // fieldId -> { owner, develop, stations[], drones[], patrols[] }
  const droneGfx = scene ? createDroneRenderer(scene, 400) : null;
  const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();
  let syncT = 0, time = 0;
  const territoryWarned = new Map();

  const hostileTo = (owner) => strategy.atWar(PLAYER, owner);

  function build(fid) {
    const fs = strategy.state.fields[fid];
    const def = strategy.defs.get(fid);
    const owner = fs.owner, color = RACES[owner].color;
    const rng = seededRng(hashString(`placowka:${fid}`));
    const c = new THREE.Vector3(def.center.x, def.center.y, def.center.z);
    // placówka po zewnętrznej stronie pasa, stacje w łuku
    const a0 = rng() * Math.PI * 2;
    const o = { fid, owner, develop: fs.develop, stations: [], drones: [], patrols: [], center: c };
    for (let i = 0; i < fs.develop; i++) {
      const type = LEVEL_TYPES[i];
      const a = a0 + (i - (fs.develop - 1) / 2) * 0.16;
      const pos = c.clone().add(_v.set(Math.cos(a) * (def.radius + 700), 260 + (i % 2) * 140, Math.sin(a) * (def.radius + 700)));
      const st = { type, pos, hull: STATIONS[type].hull * 1.2, maxHull: STATIONS[type].hull * 1.2, alive: true, fireCd: rng(), muzzle: 0, model: null };
      if (scene) {
        st.model = buildStationModel(type, color);
        st.model.group.position.copy(pos);
        st.model.group.rotation.y = rng() * 6.28;
        setStationProgress(st.model, 1, true);
        scene.add(st.model.group);
      }
      st.actor = {
        get side() { return hostileTo(owner) ? 'hostile' : 'neutral'; },
        position: pos, radius: STATIONS[type].radius * 0.7,
        isAlive: () => st.alive, takeDamage: (amt) => damageStation(o, st, amt),
      };
      st.contact = {
        id: `rs-${fid}-${i}`, kind: 'station', station: { type, rival: owner }, npc: null,
        get side() { return hostileTo(owner) ? 'hostile' : 'neutral'; },
        position: pos, velocity: new THREE.Vector3(), get hullFrac() { return st.hull / st.maxHull; },
        radius: STATIONS[type].radius * 0.7, recentAttackers: new Map(), isAlive: () => st.alive, value: 0.8,
      };
      combat?.register(st.actor);
      o.stations.push(st);
    }
    // rój rasy: 4 drony na poziom, lata między placówką a skałami pola
    const rocks = economy.asteroidsIn(economy.systemId).filter((a) => a.fieldId === fid);
    const nd = Math.min(20, fs.develop * 4);
    for (let i = 0; i < nd && rocks.length; i++) {
      const d = {
        pos: o.stations[0].pos.clone(), dir: new THREE.Vector3(0, 0, 1), state: 'lot', t: rng() * 8, alive: true, hull: 30,
        ast: rocks[Math.floor(rng() * rocks.length)], site: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        home: o.stations[Math.floor(rng() * o.stations.length)].pos,
      };
      d.actor = {
        get side() { return hostileTo(owner) ? 'hostile' : 'neutral'; }, position: d.pos, radius: 7,
        isAlive: () => d.alive, takeDamage: (amt) => { d.hull -= amt; if (d.hull <= 0 && d.alive) { d.alive = false; combat?.flash(d.pos, 30, 0xffa640, 0.5); combat?.unregister(d.actor); } },
      };
      d.contact = {
        id: `rd-${fid}-${i}`, kind: 'drone', get side() { return hostileTo(owner) ? 'hostile' : 'neutral'; },
        position: d.pos, velocity: new THREE.Vector3(), hullFrac: 1, radius: 7, recentAttackers: new Map(), isAlive: () => d.alive, value: 0.3,
      };
      combat?.register(d.actor);
      o.drones.push(d);
    }
    outposts.set(fid, o);
    return o;
  }

  function teardown(o) {
    for (const st of o.stations) { combat?.unregister(st.actor); if (st.model) { scene.remove(st.model.group); disposeObject(st.model.group); } }
    for (const d of o.drones) combat?.unregister(d.actor);
    for (const n of o.patrols) if (n.alive) npcs.remove(n);
    outposts.delete(o.fid);
  }

  function damageStation(o, st, amt) {
    if (!st.alive || !hostileTo(o.owner)) return;
    st.hull -= amt * 0.6;
    if (st.hull > 0) return;
    st.alive = false;
    combat?.unregister(st.actor);
    combat?.flash(st.pos, STATIONS[st.type].radius * 2.2, 0xffa640, 1.1);
    combat?.flash(st.pos, STATIONS[st.type].radius * 1.2, 0xffffff, 0.5);
    if (st.model) { scene.remove(st.model.group); disposeObject(st.model.group); st.model = null; }
    const name = RACES[o.owner].name, def = strategy.defs.get(o.fid);
    strategy.damageOutpost(o.fid, 1, PLAYER);
    const left = strategy.state.fields[o.fid].develop;
    onEvent({ key: `outpost-${o.fid}`, faction: o.owner, urgency: left ? 'info' : 'warning',
      text: left ? `Zniszczona stacja placówki rasy ${name} na polu ${def.name}. Zostało poziomów: ${left}.`
        : `Placówka rasy ${name} na polu ${def.name} rozbita! Pole jest wolne — możesz tu budować.` });
  }

  /** Zgodność z mapą strategiczną: nowe/zmienione/utracone placówki. */
  function sync() {
    const sysId = economy.systemId;
    const want = new Map();
    for (const fid of strategy.bySystem.get(sysId) ?? []) {
      const fs = strategy.state.fields[fid];
      if (fs.owner && fs.develop > 0 && economy.isDiscovered(sysId, fid)) want.set(fid, fs);
    }
    for (const o of [...outposts.values()]) {
      const fs = want.get(o.fid);
      const aliveN = o.stations.filter((s) => s.alive).length;
      if (!fs || fs.owner !== o.owner || fs.develop !== aliveN) teardown(o);
    }
    for (const [fid] of want) if (!outposts.has(fid)) build(fid);
    // patrole wojenne: część floty rasy krąży przy placówce
    for (const o of outposts.values()) {
      o.patrols = o.patrols.filter((n) => n.alive && npcs.list.includes(n));
      const war = hostileTo(o.owner);
      if (!war) { for (const n of o.patrols) npcs.depart(n); o.patrols = []; continue; }
      const f = strategy.state.factions[o.owner];
      const want = Math.min(3, Math.floor((f?.ships ?? 0) * 0.35), 1 + o.stations.length);
      while (o.patrols.length < want) {
        const pos = o.stations[0].pos.clone().add(_v.set((Math.random() - 0.5) * 900, 200, (Math.random() - 0.5) * 900));
        const npc = npcs.spawn({
          raceId: o.owner, factionKey: strategy.rulingFaction(o.owner), side: 'hostile', position: pos,
          mode: 'tactical', hull: 180, label: `patrol: ${RACES[o.owner].name}`, tag: 'patrol',
          ai: { base: 'hold', anchor: o.center, leash: 4500 },
        });
        npc.rivalOwner = o.owner;
        o.patrols.push(npc);
      }
    }
  }

  npcs.on('killed', (npc) => { if (npc.tag === 'patrol' && npc.rivalOwner) strategy.shipLost(npc.rivalOwner, 1); });

  // --- wieże placówek w czasie wojny ---
  function towerTargets() {
    const out = [];
    if (player.isAlive()) out.push({ position: player.position, velocity: player.getVelocity(new THREE.Vector3()) });
    for (const c of economy.contacts()) if (c.kind === 'drone') out.push(c);
    for (const n of npcs.allies()) out.push({ position: n.group.position, velocity: n.velocity });
    return out;
  }
  function updateTowers(dt, o) {
    if (!hostileTo(o.owner) || !combat) return;
    let targets = null;
    for (const st of o.stations) {
      if (!st.alive || st.type !== 'wieza') continue;
      st.fireCd -= dt;
      if (st.fireCd > 0) continue;
      targets ??= towerTargets();
      let best = null, bd = TOWER.range;
      for (const t of targets) { const d = t.position.distanceTo(st.pos); if (d < bd) { bd = d; best = t; } }
      if (!best) { st.fireCd = 0.5; continue; }
      st.fireCd = TOWER.every;
      _m.copy(st.pos); _m.y += 60;
      _v.copy(best.position).addScaledVector(best.velocity ?? _d.set(0, 0, 0), bd / TOWER.speed);
      if (st.model?.turret) { st.model.group.updateMatrixWorld(); st.model.turret.lookAt(_v); st.model.turret.updateMatrixWorld(); if (st.model.muzzles.length) { _m.copy(st.model.muzzles[st.muzzle++ % st.model.muzzles.length]); st.model.turret.localToWorld(_m); } }
      _d.copy(_v).sub(_m).normalize();
      combat.fire({ origin: _m.clone(), direction: _d.clone(), side: 'hostile', speed: TOWER.speed, damage: TOWER.damage,
        color: new THREE.Color(RACES[o.owner].color).getHex(), life: TOWER.range / TOWER.speed + 0.3, hitScale: 1.8, shooter: { contact: st.contact } });
    }
  }

  // --- drony rasy: lot do skały, "wiercenie", powrót ---
  function updateDrones(dt, o) {
    for (const d of o.drones) {
      if (!d.alive) continue;
      d.t -= dt;
      if (d.state === 'lot') {
        surfacePoint(d.ast, d.site, 6, _v);
        _d.copy(_v).sub(d.pos);
        const dist = _d.length();
        if (dist < 8) { d.state = 'wiercenie'; d.t = 10 + Math.random() * 8; }
        else d.pos.addScaledVector(_d, Math.min(1, (260 * dt) / dist));
        d.dir.copy(_d).normalize();
      } else if (d.state === 'wiercenie') {
        surfacePoint(d.ast, d.site, 6, _v);
        d.pos.copy(_v);
        if (d.t <= 0) d.state = 'powrot';
      } else {
        _d.copy(d.home).sub(d.pos);
        const dist = _d.length();
        if (dist < 60) { d.state = 'lot'; d.site.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); }
        else d.pos.addScaledVector(_d, Math.min(1, (260 * dt) / dist));
        d.dir.copy(_d).normalize();
      }
    }
  }

  const _col = new THREE.Color();
  function update(dt) {
    time += dt;
    syncT -= dt;
    if (syncT <= 0) { syncT = 1; sync(); }
    droneGfx?.begin();
    for (const o of outposts.values()) {
      for (const st of o.stations) if (st.alive && st.model) animateStation(st.model, dt, time, true);
      updateDrones(dt, o);
      updateTowers(dt, o);
      if (droneGfx) {
        _col.set(RACES[o.owner].color);
        for (const d of o.drones) if (d.alive) droneGfx.push(d.pos, d.dir, d.state, d.state === 'wiercenie' ? 0.8 : 1, _col);
      }
      // wkraczanie na cudze pole: rasa daje znać (raz na 90 s na pole)
      const dist = player.position.distanceTo(o.center) - strategy.defs.get(o.fid).radius;
      if (dist < 1500 && time - (territoryWarned.get(o.fid) ?? -999) > 90) {
        territoryWarned.set(o.fid, time);
        onEvent({ key: `territory-${o.fid}`, type: 'territory', faction: o.owner, fid: o.fid });
      }
    }
    droneGfx?.end();
  }

  return {
    update, sync,
    /** Kontakty dla mózgów NPC (flota gracza atakuje placówki na wojnie). */
    contacts() {
      const out = [];
      for (const o of outposts.values()) {
        if (!hostileTo(o.owner)) continue;
        for (const st of o.stations) if (st.alive) out.push(st.contact);
        for (const d of o.drones) if (d.alive) out.push(d.contact);
      }
      return out;
    },
    solids() {
      const out = [];
      for (const o of outposts.values()) for (const st of o.stations) if (st.alive) out.push({ position: st.pos, radius: STATIONS[st.type].radius * 0.55, name: 'placówka' });
      return out;
    },
    labelItems() {
      const out = [];
      for (const o of outposts.values()) {
        const alive = o.stations.filter((s) => s.alive);
        if (!alive.length) continue;
        const war = hostileTo(o.owner);
        const def = strategy.defs.get(o.fid);
        out.push({ id: `rival-${o.fid}`, position: alive[0].pos.clone().add(_v.set(0, 160, 0)), color: war ? '#ff5a4a' : RACES[o.owner].color,
          title: `${RACES[o.owner].name} · ${def.name}`, sub: `${war ? 'WOJNA · ' : ''}placówka poz. ${alive.length}` });
      }
      return out;
    },
    outposts,
    /** Zmiana układu: wszystko z poprzedniego znika (strategia pamięta stan). */
    clear() { for (const o of [...outposts.values()]) teardown(o); },
    dispose() { this.clear(); droneGfx?.dispose(); },
  };
}
