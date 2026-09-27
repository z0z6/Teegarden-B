import * as THREE from 'three';
import { SHIPS } from '../ships/fleet.js';
import { raceForShip } from '../data/races.js';

/**
 * ROZGRZEWKA SHADERÓW (krok 12c): koniec przycięć przy pierwszym ataku.
 *
 * three.js kompiluje program GPU przy PIERWSZYM rysowaniu danego rodzaju
 * materiału. W walce naraz pojawia się dużo rzeczy, których wcześniej nie
 * było w scenie: modele statków wrogiej rasy, brama / fala / blizna fałdy,
 * pociski każdej broni, błyski i wybuchy. Każda to kompilacja w środku
 * klatki (na zwykłym GPU 50-500 ms) - gra "przycina" dokładnie wtedy, gdy
 * zaczyna się atak.
 *
 * Tu robimy "próbę generalną" daleko poza kadrem, zanim gracz cokolwiek
 * zobaczy (pod animacją wejścia na mostek): po jednym statku z każdego
 * modelu floty wychodzi z fałdy, strzela każdą bronią, pojawiają się błyski.
 * W trakcie co chwilę renderer.compile(scene, camera) kompiluje
 * materiały całej sceny BEZ względu na kadr. Na końcu statki znikają, a programy
 * zostają w pamięci renderera na całą sesję.
 *
 * Programy zależą też od liczby świateł w scenie, dlatego próba odbywa się
 * w prawdziwej scenie gry (te same światła co w walce).
 *
 * KOTWICE. three.js ZWALNIA program, gdy ostatni używający go materiał
 * dostanie dispose(). Efekty (brama fałdy, fala, błysk, wybuch, smugi)
 * tworzą materiał na chwilę i go niszczą - po ciszy program znika i następny
 * efekt kompiluje go OD NOWA (przycięcie w każdej walce, nie tylko pierwszej).
 * Dlatego dla każdego programu z próby zostaje jedna kotwica: kopia
 * materiału na maleńkiej, zawsze odciętej kadrem siatce daleko od gry.
 * Kotwica nigdy nie jest rysowana ani niszczona, więc program żyje całą sesję.
 */
export function createWarmup({ renderer, scene, camera, npcs, combat, weapons = null, weaponIds = [], onDone = () => {} }) {
  const FAR = new THREE.Vector3(0, -250000, 0); // daleko pod ekliptyką, poza zasięgiem AI i czujników
  let spawned = [], t = 0, compileT = 0, running = false, done = false, fired = false, fired2 = false, busy = false;
  const stats = { before: 0, after: 0, ms: 0, anchors: 0 };
  const anchors = new THREE.Group();
  anchors.name = 'shader-anchors';
  anchors.position.set(0, -900000, 0);
  anchors.visible = false; // widoczne tylko na czas renderer.compile (compile przechodzi traverseVisible)
  const kept = new Set();
  const TRI = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const PT = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));

  /** Kotwice dla programów materiałów, które właśnie są w scenie. */
  function anchorAll() {
    const found = [];
    scene.traverse((o) => {
      if (o === anchors || !o.material || o.parent === anchors) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) found.push([o, m]);
    });
    for (const [o, m] of found) {
      const prog = renderer.properties.get(m)?.currentProgram;
      if (!prog || kept.has(prog.cacheKey)) continue;
      kept.add(prog.cacheKey);
      let a;
      const mat = m.clone();
      if (o.isSprite) a = new THREE.Sprite(mat);
      else if (o.isPoints) a = new THREE.Points(o.geometry ?? PT, mat);
      else if (o.isLine) a = new THREE.Line(o.geometry ?? TRI, mat);
      else a = new THREE.Mesh(o.geometry ?? TRI, mat); // geometria oryginału: te same atrybuty (np. aSize, aStreak)
      a.matrixAutoUpdate = false;
      anchors.add(a);
    }
    stats.anchors = anchors.children.length;
  }

  function start() {
    if (running || done) return;
    running = true;
    scene.add(anchors);
    stats.before = renderer.info.programs?.length ?? 0;
    stats.t0 = performance.now();
    // po jednym statku z każdego modelu (rasa z modelu), z wejściem przez fałdę
    SHIPS.forEach((s, i) => {
      const raceId = raceForShip(s.id);
      if (!raceId) return;
      const pos = FAR.clone().add(new THREE.Vector3((i % 6) * 900, Math.floor(i / 6) * 700, 0));
      const npc = npcs.spawn({ raceId, side: 'neutral', shipId: s.id, mode: 'idle', position: pos, arrival: 'warp', tag: 'warmup', label: '' });
      npc.warmup = true;
      spawned.push(npc);
    });
  }

  function fireAll() {
    fired = true;
    const dir = new THREE.Vector3(1, 0, 0);
    weaponIds.forEach((id, i) => {
      try { weapons?.fire(id, { origin: FAR.clone().add(new THREE.Vector3(-2000, i * 300, 0)), dir, side: 'neutral', color: 0xffa640 }); } catch { /* broń wymagająca celu - pomijamy */ }
    });
    weapons?.demoEffects?.(FAR.clone().add(new THREE.Vector3(-4000, 0, 0))); // wybuch, implozja torpedy, pierścień
    combat.flash(FAR.clone().add(new THREE.Vector3(-3000, 0, 0)), 60, 0xffa640, 0.9);
    combat.flash(FAR.clone().add(new THREE.Vector3(-3200, 0, 0)), 30, 0xffffff, 0.35);
  }

  function compileNow() {
    if (busy) return;
    busy = true;
    // renderer.compile (synchronicznie): compileAsync z three r184 potrafi rzucić
    // błędem poza obietnicą (isReady) i zawiesić próbę. Blokada i tak trwa pod
    // animacją wejścia, kiedy gracz nic nie steruje.
    try { anchors.visible = true; renderer.compile(scene, camera); anchorAll(); } catch { /* kontekst WebGL mógł się zgubić - gra działa dalej */ }
    anchors.visible = false;
    busy = false;
  }

  function finish() {
    compileNow(); // ostatnie kotwice, zanim statki próby znikną
    for (const n of spawned) if (npcs.list.includes(n)) npcs.remove(n);
    spawned = [];
    running = false;
    done = true;
    try { anchors.visible = true; renderer.compile(scene, camera); } catch { /* jw. */ } // kotwice przejmują programy
    anchors.visible = false;
    stats.after = renderer.info.programs?.length ?? 0;
    stats.ms = Math.round(performance.now() - stats.t0);
    onDone(stats);
  }

  function update(dt) {
    maintain(dt);
    if (!running) return;
    t += dt;
    compileT -= dt;
    if (!fired && t > 1.2) fireAll();
    const loaded = spawned.every((n) => n.ready || !n.alive);
    if (compileT <= 0) { compileT = fired && t < 3.5 ? 0.1 : 0.35; compileNow(); } // efekty trafień żyją ułamek sekundy
    // koniec: modele wczytane, sekwencja fałdy za nami, pociski wystrzelone
    if (fired && t > 2.4 && !fired2) { fired2 = true; weapons?.demoEffects?.(FAR.clone().add(new THREE.Vector3(-6000, 400, 0))); } // drugi raz: pierścień po implozji
    if ((loaded && t > 5) || t > 12) finish();
  }

  /** Kotwice dla programów, które pojawiły się później (np. rzadki efekt) - wołane co jakiś czas. */
  let lateT = 0;
  function maintain(dt) {
    if (!done) return;
    lateT -= dt;
    if (lateT > 0) return;
    lateT = 0.25; // efekty żyją 0,3-0,7 s - łapiemy je, póki są w scenie
    const before = anchors.children.length;
    anchorAll();
    if (anchors.children.length > before) {
      anchors.visible = true;
      try { renderer.compile(anchors, camera, scene); } catch { /* jw. */ }
      anchors.visible = false;
    }
  }

  return { start, update, maintain, get t() { return t; }, get running() { return running; }, get done() { return done; }, stats, isWarmup: (npc) => !!npc?.warmup };
}
