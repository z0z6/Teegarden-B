import * as THREE from 'three';
import { NBodySystem, circularOrbitSpeed } from '../physics/n-body.js';
import { createStarVisual, createAccretionFlow } from './star-surface.js';
import { createPlanetVisual } from './planet-surface.js';

/**
 * UKŁADY CIAŁ NIEBIESKICH - pięć gotowych układów na wspólnym silniku N-ciał
 * (shared/physics/n-body.js) i wspólnym, ogólnym interfejsie, z którego
 * korzysta gra (main.js), kolizje (collision.js) i plan skoku (warp-drive.js):
 *
 *   bodies            [{ name, R, position, star, kind }] - na żywo
 *   solidBodies(near) ciała stałe do kolizji (z planetoidami w pobliżu `near`)
 *   spawn             bezpieczny punkt startowy statku + punkt, w który patrzy
 *   warpDistance      zasięg skoku fałdowego dopasowany do skali układu
 *   update(dt, camera), dispose()
 *
 * SKALA. Gwiazdy są celowo DUŻO większe względem statków i orbit niż w
 * kroku 4 (Słońce-podobna: 500 -> 1600 j., czerwony olbrzym 4200 -> 15000 j.,
 * nadolbrzym 30 000 j. = 155 długości Kharatha). Odległości są dobrane tak,
 * żeby układy pozostały fizycznie spójne:
 *   - pary gwiazd: separacja >= ~2,6 x suma promieni (poza układem
 *     symbiotycznym, gdzie olbrzym CELOWO wypełnia swoją powierzchnię Roche'a),
 *   - planety okołopodwójne: > ~3,5 x separacja pary (granica stabilności
 *     orbit wokół układu podwójnego - bliżej orbity byłyby chaotyczne),
 *   - układy hierarchiczne: stosunek orbit ~9x (jak w kroku 4).
 *
 * G każdego układu liczymy z trzeciego prawa Keplera dla "orbity odniesienia"
 * i docelowego okresu (np. para gwiazd obiega się w 40 s), tak jak w kroku 4
 * - dzięki temu wszystko się rusza w skali sesji gry, a proporcje okresów
 * między orbitami są prawdziwe.
 *
 * ŚWIATŁO: natężenie PointLight (decay = 2, prawo odwrotnych kwadratów)
 * podajemy jako "oświetlenie w odległości odniesienia" - lightAt(E, d) = E·d²
 * - bo przy tak różnych skalach (od 11 tys. do 150 tys. j.) jedna stała
 * jasności nie ma sensu.
 */

const TAU = Math.PI * 2;
const lightAt = (illum, dist) => illum * dist * dist;
const keplerG = (a, period, mass) => (4 * Math.PI ** 2 * a ** 3) / (period ** 2 * mass);

// ============================================================
// DEFINICJE UKŁADÓW
// ============================================================
export const SYSTEMS = {
  // ------------------------------------------------------------------
  potrojny: {
    name: 'Teegarden-B: układ potrójny',
    desc: 'Żółta gwiazda i biały karzeł w ciasnej parze, czerwony olbrzym na orbicie zewnętrznej. Układ z kroków 4-7, powiększony.',
    skySeed: 7, warpDistance: 30000,
    build(k) {
      const R = { A: 1600, W: 320, RG: 15000 };
      const M = { A: 1.0, W: 0.7, RG: 3.0 };
      const sepIn = (R.A + R.W) * 3.2;          // 6144
      const sepOut = sepIn * 9;                 // 55 296 - hierarchia ~9x
      k.setG(keplerG(sepIn, 40, M.A + M.W));
      const inner = k.binary(M.A, M.W, sepIn, new THREE.Vector3(), new THREE.Vector3());
      // zewnętrzna orbita: para (jako całość) + olbrzym wokół wspólnego barycentrum
      const outer = k.binary(M.A + M.W, M.RG, sepOut, new THREE.Vector3(), new THREE.Vector3(), 0);
      k.star({ name: 'gwiazda G', type: 'yellowDwarf', radius: R.A, mass: M.A,
        position: inner.p1.add(outer.p1), velocity: inner.v1.add(outer.v1), light: lightAt(4, 8000) });
      k.star({ name: 'biały karzeł', type: 'whiteDwarf', radius: R.W, mass: M.W,
        position: inner.p2.add(outer.p1), velocity: inner.v2.add(outer.v1), light: lightAt(1.2, 3000) });
      k.star({ name: 'czerwony olbrzym', type: 'redGiant', radius: R.RG, mass: M.RG,
        position: outer.p2, velocity: outer.v2, light: lightAt(3, 45000) });
      const pr = sepOut * 1.7;
      k.planet({ name: 'planeta', kind: 'ocean', radius: 700, orbitRadius: pr, phase: Math.PI / 2,
        moons: [{ name: 'księżyc', kind: 'rock', radius: 180, dist: 2600, period: 30 }] });
      return { spawnRadius: pr * 1.25 };
    },
  },

  // ------------------------------------------------------------------
  teegarden: {
    name: 'Gwiazda Teegardena',
    desc: 'Prawdziwy układ, od którego gra ma nazwę: chłodny czerwony karzeł (M7) i ciasne orbity planet b, c, d. Karzeł często rozbłyskuje.',
    skySeed: 42, warpDistance: 15000,
    build(k) {
      const RS = 2600, MS = 1.0;
      // orbity b, c, d zachowują proporcje okresów z rzeczywistości (~1 : 2,3 : 4,5)
      const orbits = { b: 11000, c: 19000, d: 30000 };
      k.setG(keplerG(orbits.b, 50, MS));
      k.star({ name: 'Gwiazda Teegardena', type: 'redDwarf', radius: RS, mass: MS,
        position: new THREE.Vector3(), velocity: new THREE.Vector3(), light: lightAt(3.2, 11000) });
      k.planet({ name: 'Teegarden b', kind: 'ocean', radius: 560, orbitRadius: orbits.b, phase: 0.4, seed: 11 });
      k.planet({ name: 'Teegarden c', kind: 'ice', radius: 520, orbitRadius: orbits.c, phase: 2.4, seed: 23 });
      k.planet({ name: 'Teegarden d', kind: 'rock', radius: 340, orbitRadius: orbits.d, phase: 4.1, seed: 37 });
      return { spawnRadius: 42000 };
    },
  },

  // ------------------------------------------------------------------
  blizniaki: {
    name: 'Bliźnięta',
    desc: 'Dwa słońca (G i K) w ciasnej parze. Wokół nich - pas planetoid, gazowy olbrzym z pierścieniami i dwoma księżycami oraz lodowa planeta.',
    skySeed: 91, warpDistance: 30000,
    build(k) {
      const R = { A: 1800, B: 1400 }, M = { A: 1.0, B: 0.75 };
      const sep = (R.A + R.B) * 2.6;           // 8320
      k.setG(keplerG(sep, 36, M.A + M.B));
      const bin = k.binary(M.A, M.B, sep, new THREE.Vector3(), new THREE.Vector3());
      k.star({ name: 'Kastor', type: 'yellowDwarf', radius: R.A, mass: M.A, position: bin.p1, velocity: bin.v1, light: lightAt(3, 26000), seed: 3 });
      k.star({ name: 'Polluks', type: 'orangeDwarf', radius: R.B, mass: M.B, position: bin.p2, velocity: bin.v2, light: lightAt(2, 26000), seed: 8 });
      // wszystko okołopodwójne leży dalej niż ~3,5 x separacja (granica stabilności)
      k.belt({ inner: sep * 3.6, outer: sep * 4.4, count: 1400, rock: [25, 140] });
      k.planet({ name: 'Tyndar', kind: 'gas', radius: 3200, orbitRadius: sep * 5.8, phase: 1.2, seed: 5,
        palette: [0xd8b98c, 0x9a6a44, 0xf0e4cf], rings: { inner: 1.35, outer: 2.3, color: 0xcdb89a },
        moons: [
          { name: 'Ognik', kind: 'lava', radius: 280, dist: 5400, period: 24 },
          { name: 'Szadź', kind: 'ice', radius: 360, dist: 8200, period: 45 },
        ] });
      k.planet({ name: 'Szron', kind: 'ice', radius: 820, orbitRadius: sep * 8.4, phase: 3.9, seed: 19 });
      return { spawnRadius: sep * 10.2 };
    },
  },

  // ------------------------------------------------------------------
  symbiotyczny: {
    name: 'Oddech olbrzyma',
    desc: 'Układ symbiotyczny: czerwony olbrzym wypełnia swoją powierzchnię Roche\'a i przelewa materię na białego karła, wokół którego wiruje dysk akrecyjny.',
    skySeed: 133, warpDistance: 30000,
    build(k) {
      const R = { G: 12000, W: 450 }, M = { G: 1.4, W: 0.7 };
      // Eggleton: promień płata Roche'a olbrzyma (q = 2) to ~0,44 separacji -
      // separację dobieramy tak, żeby olbrzym swój płat WYPEŁNIAŁ
      const a = R.G / 0.44;                     // ~27 300
      k.setG(keplerG(a, 70, M.G + M.W));
      const bin = k.binary(M.G, M.W, a, new THREE.Vector3(), new THREE.Vector3());
      const giant = k.star({ name: 'olbrzym dawca', type: 'redGiant', radius: R.G, mass: M.G, position: bin.p1, velocity: bin.v1, light: lightAt(3, 42000), seed: 13 });
      const dwarf = k.star({ name: 'biały karzeł', type: 'whiteDwarf', radius: R.W, mass: M.W, position: bin.p2, velocity: bin.v2, light: lightAt(1.5, 12000), seed: 17 });
      // punkt L1 (od strony masywniejszej gwiazdy): x/a ≈ 0,5 - 0,227·log10(M2/M1)
      const l1FromGiant = a * (0.5 - 0.227 * Math.log10(M.W / M.G));
      k.tide(giant, dwarf, (l1FromGiant - R.G) / R.G);        // "łza" sięga L1
      k.accretion(dwarf, giant, { diskRadius: 5200, streamLength: a - l1FromGiant });
      k.planet({ name: 'Popiół', kind: 'lava', radius: 950, orbitRadius: a * 3.2, phase: 2.0, seed: 29 });
      k.planet({ name: 'Rdza', kind: 'desert', radius: 760, orbitRadius: a * 4.6, phase: 5.1, seed: 31 });
      return { spawnRadius: a * 2.4 };
    },
  },

  // ------------------------------------------------------------------
  nadolbrzym: {
    name: 'Błękitny nadolbrzym',
    desc: 'Jedna gwiazda o promieniu 30 000 j. - ponad 150 długości Kharatha. Spalona lawowa planeta blisko i gazowy olbrzym z pierścieniami daleko.',
    skySeed: 211, warpDistance: 50000,
    build(k) {
      const RS = 30000, MS = 20;
      k.setG(keplerG(85000, 120, MS));
      k.star({ name: 'nadolbrzym', type: 'blueSupergiant', radius: RS, mass: MS,
        position: new THREE.Vector3(), velocity: new THREE.Vector3(), light: lightAt(5, 85000), seed: 21 });
      k.planet({ name: 'Żar', kind: 'lava', radius: 1100, orbitRadius: 85000, phase: 0.9, seed: 41 });
      k.planet({ name: 'Lazur', kind: 'gas', radius: 4200, orbitRadius: 160000, phase: 3.3, seed: 43,
        palette: [0x8fb4d8, 0x3f6a9a, 0xdfeaf5], rings: { inner: 1.4, outer: 2.6, color: 0xb8c8dc },
        moons: [{ name: 'Szkliwo', kind: 'ice', radius: 500, dist: 9000, period: 40 }] });
      return { spawnRadius: 200000 };
    },
  },
};
export const SYSTEM_ORDER = ['potrojny', 'teegarden', 'blizniaki', 'symbiotyczny', 'nadolbrzym'];


/**
 * Punkt startowy układu BEZ budowania sceny (krok 11: mapa strategiczna i
 * pola surowcowe w układach, których gracz jeszcze nie odwiedził). Definicja
 * układu jest uruchamiana na atrapie budowniczego - liczy się tylko
 * spawnRadius, który build() zwraca. Ten sam wzór co w createStarSystem.
 */
export function spawnOf(id) {
  const def = SYSTEMS[id];
  const V = () => new THREE.Vector3();
  const k = {
    setG() {}, star() {}, planet() {}, belt() {}, tide() {}, accretion() {},
    binary: (m1, m2, sep, baryPos) => ({ p1: baryPos.clone(), v1: V(), p2: baryPos.clone(), v2: V() }),
  };
  const spawnR = def.build(k).spawnRadius;
  return { position: new THREE.Vector3(0, spawnR * 0.08, spawnR), lookAt: new THREE.Vector3() };
}
// ============================================================
// BUDOWA UKŁADU
// ============================================================
/**
 * @param {THREE.Scene} scene
 * @param {string} id  klucz SYSTEMS
 * @param {object} [o]
 * @param {number} [o.quality=1]  <1 = mniej protuberancji i planetoid (telefony)
 */
export function createStarSystem(scene, id = 'potrojny', { quality = 1 } = {}) {
  const def = SYSTEMS[id] ?? SYSTEMS.potrojny;
  const root = new THREE.Group();
  root.name = `uklad-${id}`;
  scene.add(root);

  const nbody = new NBodySystem({ G: 1, softening: 100 });
  const stars = [], planets = [], moons = [], belts = [], flows = [], tides = [];
  let minStarR = Infinity;

  // ---------------- API budowniczego (k) ----------------
  const k = {
    setG(G) { nbody.G = G; },
    /**
     * Para ciał na orbicie kołowej wokół wspólnego barycentrum (w płaszczyźnie XZ).
     * @returns {{ p1, v1, p2, v2 }} pozycje/prędkości do dodania do bary*
     */
    binary(m1, m2, sep, baryPos, baryVel, phase = Math.PI / 2) {
      const v = circularOrbitSpeed(nbody.G, m1 + m2, sep);
      const r1 = sep * m2 / (m1 + m2), r2 = sep * m1 / (m1 + m2);
      const d = new THREE.Vector3(Math.cos(phase), 0, Math.sin(phase));   // kierunek 1 -> 2 = -d
      const t = new THREE.Vector3(-d.z, 0, d.x);                           // styczna (orbita przeciwna do wskazówek zegara w XZ)
      return {
        p1: baryPos.clone().addScaledVector(d, r1), v1: baryVel.clone().addScaledVector(t, v * m2 / (m1 + m2)),
        p2: baryPos.clone().addScaledVector(d, -r2), v2: baryVel.clone().addScaledVector(t, -v * m1 / (m1 + m2)),
      };
    },
    star({ name, type, radius, mass, position, velocity, light, seed }) {
      const body = nbody.addBody({ name, mass, position: position.clone(), velocity: velocity.clone() });
      const visual = createStarVisual({ radius, type, seed: seed ?? stars.length * 7.3 + 1, quality });
      root.add(visual.group);
      const pl = new THREE.PointLight(0xffffff, light, 0, 2);
      pl.color.copy(starLightColor(visual.type.temp));
      root.add(pl);
      const s = { name, radius, body, visual, light: pl, baseLight: light };
      stars.push(s);
      minStarR = Math.min(minStarR, radius);
      return s;
    },
    /** Planeta = cząstka testowa na orbicie kołowej wokół barycentrum WSZYSTKICH gwiazd. */
    planet({ name, kind, radius, orbitRadius, phase = 0, seed, palette, rings, clouds, moons: moonDefs = [] }) {
      const visual = createPlanetVisual({ radius, kind, seed: seed ?? planets.length * 5.1 + 2, palette, rings, clouds });
      root.add(visual.group);
      const p = { name, radius, visual, orbitRadius, phase, particle: null, moonDefs };
      planets.push(p);
      return p;
    },
    belt(opts) { belts.push(opts); },
    tide(star, toward, amount) { tides.push({ star, toward, amount }); },
    accretion(compact, donor, opts) {
      const flow = createAccretionFlow(opts);
      root.add(flow.group);
      flows.push({ flow, compact, donor });
    },
  };

  const built = def.build(k);
  nbody.softening = minStarR * 0.5;
  nbody.init();

  // --- planety: prędkość kołowa wokół barycentrum gwiazd (dopiero teraz znamy całość) ---
  let mTot = 0;
  const bary = new THREE.Vector3(), baryV = new THREE.Vector3();
  for (const s of stars) { mTot += s.body.mass; bary.addScaledVector(s.body.position, s.body.mass); baryV.addScaledVector(s.body.velocity, s.body.mass); }
  bary.divideScalar(mTot); baryV.divideScalar(mTot);
  for (const p of planets) {
    const dir = new THREE.Vector3(Math.cos(p.phase), 0, Math.sin(p.phase));
    const tan = new THREE.Vector3(-dir.z, 0, dir.x);
    const v = circularOrbitSpeed(nbody.G, mTot, p.orbitRadius);
    p.particle = {
      position: bary.clone().addScaledVector(dir, p.orbitRadius),
      velocity: baryV.clone().addScaledVector(tan, v),
      acceleration: new THREE.Vector3(),
    };
    p.particle.acceleration.copy(nbody.accelerationAt(p.particle.position));
    // księżyce: KINEMATYCZNIE po okręgu wokół planety (planeta jest cząstką testową
    // bez masy, więc nie może ich przyciągać - uproszczenie opisane w README)
    for (const m of p.moonDefs) {
      const visual = createPlanetVisual({ radius: m.radius, kind: m.kind, seed: moons.length * 3.7 + 9, tilt: 0 });
      root.add(visual.group);
      moons.push({ ...m, planet: p, visual, angle: Math.random() * TAU, position: visual.group.position });
    }
  }

  // --- pas planetoid: jedna siatka instancjonowana, obracana jak ciało sztywne ---
  const beltRuntime = belts.map((b) => {
    const count = Math.round(b.count * quality);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      v.multiplyScalar(0.75 + Math.random() * 0.5);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x6e645a, roughness: 0.95, flatShading: true }), count);
    const local = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const r = b.inner + Math.random() ** 0.8 * (b.outer - b.inner);
      const a = Math.random() * TAU;
      const p = new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * (b.outer - b.inner) * 0.08, Math.sin(a) * r);
      const size = b.rock[0] + Math.random() ** 3 * (b.rock[1] - b.rock[0]);
      q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      sc.set(size, size * (0.6 + Math.random() * 0.5), size * (0.7 + Math.random() * 0.4));
      mesh.setMatrixAt(i, m4.compose(p, q, sc));
      local.push({ p, r: size * 0.85 });
    }
    mesh.frustumCulled = false;
    root.add(mesh);
    // obrót całego pasa z prędkością kątową orbity środka pasa (ciało sztywne -
    // uproszczenie; prawdziwy pas ścinałby się, bo wewnętrzne skały są szybsze)
    const mid = (b.inner + b.outer) / 2;
    const omega = circularOrbitSpeed(nbody.G, mTot, mid) / mid;
    return { mesh, local, omega, angle: 0, inner: b.inner, outer: b.outer };
  });

  // ---------------- lista ciał (dashboard, plan skoku, kolizje) ----------------
  const bodies = [
    ...stars.map((s) => ({ name: s.name, R: s.radius, position: s.body.position, star: true, kind: 'star' })),
    ...planets.map((p) => ({ name: p.name, R: p.radius, position: p.particle.position, star: false, kind: 'planet' })),
    ...moons.map((m) => ({ name: m.name, R: m.radius, position: m.position, star: false, kind: 'moon' })),
  ];
  const celestialSolids = bodies.map((b) => ({ position: b.position, radius: b.R, name: b.name }));

  const _l = new THREE.Vector3(), _w = new THREE.Vector3();
  /** Ciała stałe do kolizji; planetoidy tylko w promieniu 3000 j. od `near`. */
  function solidBodies(near = null) {
    if (!near || beltRuntime.length === 0) return celestialSolids;
    const out = celestialSolids.slice();
    for (const b of beltRuntime) {
      const rr = Math.hypot(near.x, near.z);
      if (rr < b.inner - 3000 || rr > b.outer + 3000) continue;
      // pozycja statku w obracającym się układzie pasa
      const c = Math.cos(-b.angle), s = Math.sin(-b.angle);
      _l.set(c * near.x - s * near.z, near.y, s * near.x + c * near.z);
      const cc = Math.cos(b.angle), ss = Math.sin(b.angle);
      for (const rock of b.local) {
        if (rock.p.distanceToSquared(_l) > 9e6) continue;
        _w.set(cc * rock.p.x - ss * rock.p.z, rock.p.y, ss * rock.p.x + cc * rock.p.z);
        out.push({ position: _w.clone(), radius: rock.r, name: 'planetoida' });
      }
    }
    return out;
  }

  // ---------------- pętla ----------------
  const _to = new THREE.Vector3();
  function sync(dt, camera) {
    for (const s of stars) {
      s.visual.group.position.copy(s.body.position);
      s.light.position.copy(s.body.position);
      s.visual.update(dt, camera);
      s.light.intensity = s.baseLight * (1 + 3 * s.visual.flareBoost); // rozbłysk naprawdę rozświetla okolicę
    }
    for (const t of tides) t.star.visual.setTide(t.toward.body.position, t.amount);
    for (const f of flows) f.flow.update(dt, f.compact.body.position, f.donor.body.position);
    for (const p of planets) { p.visual.group.position.copy(p.particle.position); p.visual.update(dt); }
    for (const m of moons) {
      m.angle += (TAU / m.period) * dt;
      m.visual.group.position.copy(m.planet.particle.position).add(_to.set(Math.cos(m.angle) * m.dist, 0, Math.sin(m.angle) * m.dist));
      m.visual.update(dt);
    }
    for (const b of beltRuntime) { b.angle += b.omega * dt; b.mesh.rotation.y = -b.angle; }
  }

  function update(dt, camera) {
    nbody.step(dt);
    for (const p of planets) nbody.stepTestParticle(p.particle, dt);
    sync(dt, camera);
  }
  sync(0, null);

  function dispose() {
    for (const s of stars) s.visual.dispose();
    for (const p of planets) p.visual.dispose();
    for (const m of moons) m.visual.dispose();
    for (const f of flows) f.flow.dispose();
    for (const b of beltRuntime) { b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    scene.remove(root);
  }

  const spawnR = built.spawnRadius;
  return {
    id, name: def.name, desc: def.desc, skySeed: def.skySeed, warpDistance: def.warpDistance,
    nbody, stars, planets, moons, bodies, solidBodies, update, dispose, root,
    spawn: { position: new THREE.Vector3(0, spawnR * 0.08, spawnR), lookAt: new THREE.Vector3() },
    extent: spawnR,
  };
}

/** Kolor światła gwiazdy (jaśniejszy, mniej nasycony niż jej tarcza). */
function starLightColor(temp) {
  const t = Math.min(Math.max(temp, 1000), 40000) / 100;
  const r = t <= 66 ? 1 : Math.min(1, 1.292936 * (t - 60) ** -0.1332047);
  const g = t <= 66 ? Math.min(1, Math.max(0, 0.39008158 * Math.log(t) - 0.63184144)) : Math.min(1, 1.1298909 * (t - 60) ** -0.0755148);
  const b = t >= 66 ? 1 : t <= 19 ? 0 : Math.min(1, Math.max(0, 0.54320679 * Math.log(t - 10) - 1.19625409));
  return new THREE.Color(r, g, b).lerp(new THREE.Color(1, 1, 1), 0.35);
}
