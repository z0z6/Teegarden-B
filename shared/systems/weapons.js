import * as THREE from 'three';

/**
 * UZBROJENIE - pięć rodzajów broni zbudowanych na combat.js, wspólnych dla
 * gracza i NPC. Każda broń różni się MECHANIKĄ, nie tylko kolorem pocisku:
 *
 *   pulse    Działko impulsowe  - szybkie bolty, uniwersalne (to, co było w kroku 5)
 *   flak     Śrutownica         - wachlarz śrutu, zabójcza z bliska, bezużyteczna z daleka
 *   beam     Lanca              - ciągły promień, trafienie natychmiastowe, szybko grzeje
 *   missile  Rój rakiet         - para rakiet samonaprowadzających; wymaga NAMIERZENIA
 *   torpedo  Torpeda fałdowa    - wolna, ciężka; imploduje fałdą i rani wszystko w promieniu
 *
 * CIEPŁO (pierwszy podpięty system z kart ras, pole ship.thermal): każdy
 * strzał grzeje statek, ciepło uchodzi z czasem. 100% = PRZEGRZANIE: broń
 * milknie, aż temperatura spadnie do 30%. Rasy z dużym `thermal`
 * (Heliotropi 90) mogą strzelać dłużej, rasy z małym (Świetliści 40) -
 * krócej. To zamienia wybór broni w decyzję: Lanca jest najsilniejsza, ale
 * przegrzewa statek w kilka sekund.
 *
 * SPECJALNOŚĆ RASY: każda rasa ma "swoją" broń (RACE_WEAPON) - gracz grzeje
 * nią 30% mniej, a NPC tej rasy właśnie nią strzelają. Walka z Pieśniarzami
 * (rakiety) wygląda i gra się inaczej niż z Rezonantami (lanca).
 */

// ============================================================
// DEFINICJE BRONI - wszystkie liczby do strojenia w jednym miejscu
// ============================================================
export const WEAPONS = {
  pulse: {
    name: 'Działko impulsowe', short: 'Impuls', color: 0x6cf5ff,
    desc: 'szybkie bolty, uniwersalne',
    cooldown: 0.22, heat: 3, damage: 14, speed: 1500, life: 2, assistDeg: 12,
  },
  flak: {
    name: 'Śrutownica', short: 'Śrut', color: 0xffc14d,
    desc: 'wachlarz śrutu, zabójcza z bliska',
    cooldown: 0.75, heat: 9, pellets: 10, damage: 7, spreadDeg: 4.5, speed: 1400, life: 0.55, assistDeg: 8,
  },
  beam: {
    name: 'Lanca', short: 'Lanca', color: 0xb58cff,
    desc: 'ciągły promień, szybko grzeje',
    heatPerSec: 24, dps: 46, range: 1600, tick: 0.25, assistDeg: 4,
  },
  missile: {
    name: 'Rój rakiet', short: 'Rakiety', color: 0xff7a45,
    desc: 'para rakiet, wymaga namierzenia',
    cooldown: 1.5, heat: 10, damage: 30, aoeRadius: 60, aoeDamage: 16,
    speed: 180, accel: 950, maxSpeed: 1150, turnRate: 3.0, life: 4.5,
    lockTime: 0.7, lockRange: 3200, lockConeDeg: 18, keepConeDeg: 32,
  },
  torpedo: {
    name: 'Torpeda fałdowa', short: 'Torpeda', color: 0x5ff0e0,
    desc: 'wolna, implozja w promieniu 300 j.',
    cooldown: 3.5, heat: 24, aoeRadius: 300, aoeDamage: 115, proximity: 110,
    speed: 140, accel: 260, maxSpeed: 650, turnRate: 0.9, life: 7,
  },
};
export const WEAPON_ORDER = ['pulse', 'flak', 'beam', 'missile', 'torpedo'];

/** Broń-specjalność każdej rasy (NPC tej rasy nią strzelają, gracz grzeje nią mniej). */
export const RACE_WEAPON = {
  wybudzeni: 'torpedo',   // ciężkie niszczyciele, "wpis do manifestu" jednym strzałem
  rezonanci: 'beam',      // rezonans = ciągła fala
  piesniarze: 'missile',  // "widzieliśmy twój tor trzy pieśni temu" - pociski, które znają kurs
  szczepieni: 'flak',     // rój zarodników
  wykonawcy: 'pulse',     // precyzja klauzuli
  heliotropi: 'flak',     // wyrzuty plazmy
  swietlisci: 'beam',     // światło
};

/**
 * Profile NPC: zasięg otwarcia ognia, wymagane wycelowanie (cos kąta),
 * przerwa między strzałami i obrażenia. NPC zadają mniej niż gracz - ten sam
 * "budżet" DPS co bolty z kroku 5 (~12/s), inaczej rozłożony w czasie.
 */
const NPC_PROFILE = {
  pulse:   { range: 1500, align: 0.985, cd: [0.6, 0.95], damage: 10 },
  flak:    { range: 750,  align: 0.97,  cd: [1.2, 1.6],  damage: 6 },
  beam:    { range: 1300, align: 0.99,  cd: [2.2, 2.8],  dps: 24, burst: 0.9 },
  missile: { range: 2600, align: 0.9,   cd: [2.4, 3.0],  damage: 16, aoeDamage: 8 },
  torpedo: { range: 2200, align: 0.95,  cd: [5.0, 6.0],  aoeDamage: 40 },
};

const Z = new THREE.Vector3(0, 0, 1);
const rand = (a, b) => a + Math.random() * (b - a);

// ============================================================
// Grafika pomocnicza
// ============================================================
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
function glowSprite(color, screenSize, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, depthWrite: false,
    sizeAttenuation: false, toneMapped: false, blending: THREE.AdditiveBlending,
  }));
  s.scale.set(screenSize, screenSize, 1);
  return s;
}

// ------------------------------------------------------------
// Cząstki (smugi rakiet, iskry wybuchów): jeden obiekt Points z buforem
// cyklicznym - 1 draw call na wszystkie cząstki w grze, zero alokacji w locie.
// ------------------------------------------------------------
const PART_VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec4 aData;     // czas narodzin, życie, rozmiar (j. świata), opór
attribute vec3 aColor;
uniform float uTime, uPx;
varying vec3 vColor;
varying float vA;
void main() {
  float age = uTime - aData.x;
  float k = age / aData.y;
  vA = ( k >= 0.0 && k < 1.0 ) ? ( 1.0 - k ) : 0.0;
  // przemieszczenie z oporem: v * (1 - e^(-c t)) / c
  float c = max( aData.w, 1e-3 );
  vec3 p = position + aVel * ( 1.0 - exp( -c * age ) ) / c;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  float size = aData.z * ( 0.6 + 0.8 * k );
  gl_PointSize = vA > 0.0 ? clamp( size * uPx / -mv.z, 1.0, 64.0 ) : 0.0;
  vColor = aColor;
}
`;
const PART_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  float r = length( gl_PointCoord - 0.5 ) * 2.0;
  float a = ( 1.0 - smoothstep( 0.2, 1.0, r ) ) * vA;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( vColor * a, a );
}
`;

function createParticles(scene, capacity = 2400) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(capacity * 3);
  const vel = new Float32Array(capacity * 3);
  const data = new Float32Array(capacity * 4).fill(-1000);
  const col = new Float32Array(capacity * 3);
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3),
    aVel: new THREE.BufferAttribute(vel, 3),
    aData: new THREE.BufferAttribute(data, 4),
    aColor: new THREE.BufferAttribute(col, 3),
  };
  for (const [k, a] of Object.entries(attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
  const mat = new THREE.ShaderMaterial({
    vertexShader: PART_VERT, fragmentShader: PART_FRAG,
    uniforms: { uTime: { value: 0 }, uPx: { value: 500 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  // OPTYMALIZACJA: do GPU idzie tylko zmieniony fragment bufora cyklicznego
  // (nowe cząstki od ostatniej klatki), a nie całe 2400 x 13 liczb co klatkę
  let head = 0, dirty = false, firstDirty = 0, emitted = 0;
  const tmpC = new THREE.Color();
  function emit(p, v, color, size, life, drag = 2) {
    if (!dirty) { firstDirty = head; emitted = 0; }
    emitted++;
    const i = head;
    head = (head + 1) % capacity;
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    data[i * 4] = mat.uniforms.uTime.value; data[i * 4 + 1] = life; data[i * 4 + 2] = size; data[i * 4 + 3] = drag;
    tmpC.set(color);
    col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
    dirty = true;
  }
  const _v = new THREE.Vector3();
  function burst(p, count, speed, color, size, life) {
    for (let i = 0; i < count; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      emit(p, _v, color, size * rand(0.6, 1.3), life * rand(0.6, 1.2), 3);
    }
  }
  function update(dt, camera) {
    mat.uniforms.uTime.value += dt;
    // piksele na jednostkę świata w odległości 1 (rozmiar cząstki w j. świata)
    const h = camera.isPerspectiveCamera ? (window.innerHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) : 500;
    mat.uniforms.uPx.value = h * Math.min(window.devicePixelRatio, 2);
    if (dirty) {
      for (const a of Object.values(attrs)) {
        const n = a.itemSize;
        a.clearUpdateRanges();
        if (emitted >= capacity) a.addUpdateRange(0, capacity * n);
        else if (firstDirty + emitted <= capacity) a.addUpdateRange(firstDirty * n, emitted * n);
        else {
          a.addUpdateRange(firstDirty * n, (capacity - firstDirty) * n);
          a.addUpdateRange(0, (firstDirty + emitted - capacity) * n);
        }
        a.needsUpdate = true;
      }
      dirty = false;
    }
  }
  return { emit, burst, update };
}

// ------------------------------------------------------------
// Promień (Lanca): dwie skrzyżowane wstęgi wzdłuż +Z, shader z migotaniem
// ------------------------------------------------------------
function beamGeometry() {
  const g = new THREE.BufferGeometry();
  const P = [
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1,   // wstęga pozioma
    0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1,   // wstęga pionowa
  ];
  const UV = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}
const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;
const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uLen, uPower;
varying vec2 vUv;
void main() {
  float x = abs( vUv.x - 0.5 ) * 2.0;
  float core = exp( -x * x * 60.0 );
  float halo = exp( -x * x * 5.0 );
  float along = vUv.y * uLen;
  // "zwoje" płynące wzdłuż promienia - widać kierunek strzału
  float coil = 0.65 + 0.35 * sin( along * 0.08 - uTime * 60.0 + x * 6.0 );
  float flick = 0.85 + 0.15 * sin( uTime * 91.0 ) * sin( uTime * 37.0 );
  float tip = smoothstep( 1.0, 0.97, vUv.y ) * smoothstep( 0.0, 0.02, vUv.y );
  vec3 col = uColor * halo * coil * 0.9 + vec3( 1.0 ) * core * 1.4;
  float a = ( core + halo * 0.6 * coil ) * flick * tip * uPower;
  gl_FragColor = vec4( col * a, a );
}
`;

// ------------------------------------------------------------
// Implozja torpedy: kula zapadająca się do punktu + pierścień "zaszycia"
// ------------------------------------------------------------
const IMPLODE_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vN = normalize( normalMatrix * normal ); vV = normalize( -mv.xyz );
  gl_Position = projectionMatrix * mv;
}
`;
const IMPLODE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uK;
varying vec3 vN; varying vec3 vV;
void main() {
  float rim = pow( 1.0 - abs( dot( vN, vV ) ), 3.0 );
  float a = rim * ( 1.0 - uK * 0.3 ) + 0.08;
  gl_FragColor = vec4( mix( uColor, vec3( 1.0 ), uK ) * a * 1.6, a );
}
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uT;
varying vec2 vUv;
void main() {
  float r = length( vUv * 2.0 - 1.0 );
  float d = r - uT;
  float ring = exp( -d * d / ( 0.0015 + 0.02 * uT ) );
  gl_FragColor = vec4( mix( vec3( 1.0 ), uColor, uT ) * ring * ( 1.0 - uT ) * 1.5, ring * ( 1.0 - uT ) );
}
`;

// ============================================================
// MENEDŻER UZBROJENIA (wspólny: gracz + NPC)
// ============================================================
/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {ReturnType<import('./combat.js').createCombat>} o.combat
 * @param {THREE.Camera} o.camera   do rozmiaru cząstek i pierścieni zwróconych do kamery
 */
export function createWeapons({ scene, combat, camera }) {
  const particles = createParticles(scene);
  const effects = [];
  const beams = new Map();   // klucz właściciela -> stan promienia
  let time = 0;

  const beamGeo = beamGeometry();
  const sphereGeo = new THREE.SphereGeometry(1, 24, 16);
  const planeGeo = new THREE.PlaneGeometry(2, 2);
  const missileGeo = new THREE.CylinderGeometry(0.35, 0.55, 5, 8).rotateX(Math.PI / 2);
  const missileMat = new THREE.MeshBasicMaterial({ color: 0x2b2f36 });

  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

  // ---------------- pociski ----------------
  function missileMesh(color) {
    const m = new THREE.Mesh(missileGeo, missileMat);
    const flame = glowSprite(color, 0.028);
    flame.position.z = -3;
    m.add(flame);
    return m;
  }
  function torpedoMesh(color) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    core.scale.setScalar(3.2);
    g.add(core);
    g.add(glowSprite(color, 0.07, 0.9));
    g.add(glowSprite(0xffffff, 0.025));
    return g;
  }

  function missileTrail(color) {
    let acc = 0;
    return (b, dt) => {
      acc += dt;
      while (acc > 0.012) {
        acc -= 0.012;
        _a.copy(b.vel).multiplyScalar(-0.08).add(_b.set(rand(-6, 6), rand(-6, 6), rand(-6, 6)));
        particles.emit(b.mesh.position, _a, b.age < 0.15 ? 0xffffff : color, 5, 0.55, 2.5);
        if (Math.random() < 0.35) particles.emit(b.mesh.position, _a.multiplyScalar(0.3), 0x5a5a66, 9, 1.4, 1.2); // dym
      }
    };
  }
  function torpedoTrail(color) {
    let acc = 0;
    return (b, dt) => {
      acc += dt;
      // spirala iskier wokół torpedy - wyraźnie inna niż prosta smuga rakiety
      while (acc > 0.02) {
        acc -= 0.02;
        const ang = b.age * 18;
        _c.copy(b.vel).normalize();
        _a.set(1, 0, 0);
        if (Math.abs(_c.x) > 0.9) _a.set(0, 1, 0);
        _a.cross(_c).normalize();
        _b.copy(_a).cross(_c);
        const off = _a.multiplyScalar(Math.cos(ang) * 7).add(_b.multiplyScalar(Math.sin(ang) * 7));
        particles.emit(_c.copy(b.mesh.position).add(off), off.multiplyScalar(1.5), color, 7, 0.9, 1.5);
      }
    };
  }

  function explosion(p, size, color) {
    combat.flash(p, size, color, 0.5);
    combat.flash(p, size * 0.45, 0xffffff, 0.22);
    particles.burst(p, Math.round(18 + size * 0.3), size * 4, color, Math.max(4, size * 0.12), 0.7);
  }

  function implosion(p, radius, color) {
    const c3 = new THREE.Color(color);
    const sMat = new THREE.ShaderMaterial({
      vertexShader: IMPLODE_VERT, fragmentShader: IMPLODE_FRAG,
      uniforms: { uColor: { value: c3 }, uK: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const sphere = new THREE.Mesh(sphereGeo, sMat);
    sphere.position.copy(p);
    sphere.frustumCulled = false;
    scene.add(sphere);
    // iskry ZASYSANE do środka (ujemna "prędkość" z oporem = ruch do centrum)
    for (let i = 0; i < 70; i++) {
      _a.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
      _b.copy(p).addScaledVector(_a, radius * rand(0.6, 1.1));
      particles.emit(_b, _a.multiplyScalar(-radius * 3.2), color, 8, 0.4, 3);
    }
    const IMPLODE = 0.32;
    effects.push({
      age: 0, duration: IMPLODE,
      step: (k) => { sphere.scale.setScalar(radius * (1 - k * k) + 1); sMat.uniforms.uK.value = k; },
      done: () => {
        scene.remove(sphere); sMat.dispose();
        // po zapadnięciu: błysk + pierścień "zaszycia" zwrócony do kamery
        combat.flash(p, radius * 0.5, 0xffffff, 0.3);
        combat.flash(p, radius * 0.9, color, 0.6);
        particles.burst(p, 40, radius * 2.5, color, 10, 0.9);
        const rMat = new THREE.ShaderMaterial({
          vertexShader: BEAM_VERT, fragmentShader: RING_FRAG,
          uniforms: { uColor: { value: c3 }, uT: { value: 0 } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(planeGeo, rMat);
        ring.position.copy(p);
        ring.scale.setScalar(radius * 1.4);
        ring.frustumCulled = false;
        scene.add(ring);
        effects.push({
          age: 0, duration: 0.7,
          step: (k) => { rMat.uniforms.uT.value = 1 - (1 - k) ** 2; camera.getWorldQuaternion(ring.quaternion); },
          done: () => { scene.remove(ring); rMat.dispose(); },
        });
      },
    });
  }

  /**
   * Strzał bronią pociskową.
   * @param {string} id  klucz z WEAPONS (pulse/flak/missile/torpedo)
   * @param {object} o   origin, dir, side, shooter, target (dla rakiet/torped),
   *                     damageMult, color (NPC: kolor strony), baseSpeed (prędkość strzelca), npc
   */
  function fire(id, { origin, dir, side, shooter = null, target = null, damageMult = 1, color = null, baseSpeed = 0, npc = null, right = null }) {
    const W = WEAPONS[id];
    const P = npc ? NPC_PROFILE[id] : null;
    const col = color ?? W.color;
    if (id === 'pulse') {
      combat.fire({
        origin, direction: dir, side, speed: W.speed, damage: (P?.damage ?? W.damage) * damageMult,
        color: col, life: npc ? 2.4 : W.life, hitScale: npc ? 2.2 : 2, shooter,
      });
    } else if (id === 'flak') {
      // wachlarz: losowe odchylenia w stożku; pierwszy śrut zawsze prosto
      const spread = THREE.MathUtils.degToRad(W.spreadDeg);
      _a.set(1, 0, 0); if (Math.abs(dir.x) > 0.9) _a.set(0, 1, 0);
      const u = _a.cross(dir).normalize().clone(), v = u.clone().cross(dir);
      for (let i = 0; i < W.pellets; i++) {
        const r = i === 0 ? 0 : Math.sqrt(Math.random()) * spread, t = Math.random() * Math.PI * 2;
        const d = dir.clone().addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r).normalize();
        combat.fire({
          origin, direction: d, side, speed: W.speed * rand(0.92, 1.08), damage: (P?.damage ?? W.damage) * damageMult,
          color: col, life: W.life * rand(0.85, 1.1), hitScale: 1.6, shooter, size: 0.35,
        });
      }
      particles.burst(origin, 8, 160, col, 4, 0.25); // błysk wylotu
    } else if (id === 'missile') {
      const d = dir.clone();
      if (right) d.addScaledVector(right, 0.35).normalize(); // wylot na boki, rakiety "zakręcają" do celu
      combat.fire({
        origin, direction: d, side, speed: baseSpeed + W.speed, accel: W.accel, maxSpeed: baseSpeed + W.maxSpeed,
        damage: (P?.damage ?? W.damage) * damageMult,
        aoe: { radius: W.aoeRadius, damage: (P?.aoeDamage ?? W.aoeDamage) * damageMult },
        homing: target ? { target, turnRate: W.turnRate, delay: 0.12 } : null,
        life: W.life, hitScale: 1.4, shooter, mesh: missileMesh(col),
        onUpdate: missileTrail(col),
        onEnd: (b, reason, p) => { if (reason !== 'expire') explosion(p, 40, col); else particles.burst(p, 10, 80, 0x888888, 6, 0.6); },
      });
    } else if (id === 'torpedo') {
      combat.fire({
        origin, direction: dir, side, speed: baseSpeed + W.speed, accel: W.accel, maxSpeed: baseSpeed + W.maxSpeed,
        damage: 0,
        aoe: { radius: W.aoeRadius, damage: (P?.aoeDamage ?? W.aoeDamage) * damageMult, onExpire: true },
        proximity: W.proximity,
        homing: target ? { target, turnRate: W.turnRate, delay: 0.4 } : null,
        life: W.life, hitScale: 2, shooter, mesh: torpedoMesh(col),
        onUpdate: torpedoTrail(col),
        onEnd: (b, reason, p) => implosion(p, W.aoeRadius * 0.55, col),
      });
    }
  }

  // ---------------- promienie ----------------
  /**
   * Utrzymuje promień właściciela `key` w tej klatce (wołać co klatkę, póki
   * strzela). Promień, którego nikt nie odświeżył, gaśnie w ~0,1 s.
   * @returns {object|null} ostatnie trafienie ({ actor, point, dist }) lub null
   */
  function beam(key, { origin, dir, side, shooter = null, dps, range, color, width = 3, damageMult = 1 }) {
    let b = beams.get(key);
    if (!b) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
        uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uLen: { value: 1 }, uPower: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      const impact = glowSprite(color, 0.06);
      const muzzle = glowSprite(color, 0.035);
      scene.add(mesh, impact, muzzle);
      b = { mesh, mat, impact, muzzle, power: 0, live: false, tickAcc: 0, hit: null, origin: new THREE.Vector3(), dir: new THREE.Vector3(), params: null };
      beams.set(key, b);
    }
    b.live = true;
    b.origin.copy(origin);
    b.dir.copy(dir).normalize();
    b.params = { side, shooter, dps, range, width, damageMult, color };
    return b.hit;
  }

  function updateBeams(dt) {
    for (const [key, b] of beams) {
      b.power = THREE.MathUtils.clamp(b.power + (b.live ? 14 : -10) * dt, 0, 1);
      if (b.power <= 0 && !b.live) {
        scene.remove(b.mesh, b.impact, b.muzzle);
        b.mat.dispose(); b.impact.material.dispose(); b.muzzle.material.dispose();
        beams.delete(key);
        continue;
      }
      const P = b.params;
      const hit = combat.raycast(b.origin, b.dir, P.range, P.side, 1.3);
      const len = hit ? hit.dist : P.range;
      b.hit = hit;
      b.mesh.position.copy(b.origin);
      b.mesh.quaternion.setFromUnitVectors(Z, b.dir);
      b.mesh.scale.set(P.width * (0.7 + 0.3 * b.power), P.width * (0.7 + 0.3 * b.power), len);
      b.mat.uniforms.uTime.value = time;
      b.mat.uniforms.uLen.value = len;
      b.mat.uniforms.uPower.value = b.power;
      b.muzzle.position.copy(b.origin);
      b.muzzle.material.opacity = b.power;
      b.impact.visible = !!hit;
      if (hit) {
        b.impact.position.copy(hit.point);
        b.impact.material.opacity = b.power * (0.7 + 0.3 * Math.random());
        if (b.live && Math.random() < 0.6) {
          _a.copy(b.dir).multiplyScalar(-60).add(_b.set(rand(-80, 80), rand(-80, 80), rand(-80, 80)));
          particles.emit(hit.point, _a, Math.random() < 0.5 ? 0xffffff : P.color, 4, 0.35, 3);
        }
      }
      // obrażenia w "paczkach" co `tick` s, nie co klatkę: pancerz odejmuje
      // stałą wartość od KAŻDEGO trafienia (patrz damagePlayer / npc damage),
      // więc drobne porcje co klatkę zostałyby zjedzone przez pancerz w całości
      if (b.live && hit) {
        b.tickAcc += dt;
        const tick = WEAPONS.beam.tick;
        while (b.tickAcc >= tick) {
          b.tickAcc -= tick;
          const dmg = P.dps * tick * P.damageMult;
          hit.actor.takeDamage(dmg, P.shooter);
        }
      } else {
        b.tickAcc = Math.min(b.tickAcc, WEAPONS.beam.tick * 0.5);
      }
      b.live = false; // musi być odświeżony w następnej klatce
    }
  }

  // ---------------- NPC ----------------
  const npcBursts = new Map();   // npc -> { until }
  /**
   * Strzał NPC jego bronią rasową. Zwraca czas do następnego strzału (s),
   * albo null, jeśli z tej odległości/kąta ta broń nie ma sensu (NPC czeka).
   */
  function npcFire(npc, { weaponId, targetPos, targetVel, targetRef, dist, alignCos, color }) {
    const P = NPC_PROFILE[weaponId];
    if (!P || dist > P.range || alignCos < P.align) return null;
    const pos = npc.group.position;
    const fwd = _c.set(0, 0, -1).applyQuaternion(npc.group.quaternion).clone();
    const origin = pos.clone().addScaledVector(fwd, npc.radius * 1.1 + 6);
    const side = npc.side === 'ally' ? 'ally' : npc.side === 'neutral' ? 'ally' : 'hostile';
    if (weaponId === 'beam') {
      npcBursts.set(npc, { until: time + P.burst, color });
    } else {
      // wyprzedzenie celu dla broni balistycznych
      const W = WEAPONS[weaponId];
      const sp = weaponId === 'pulse' ? 900 : W.speed;
      const aim = targetPos.clone().addScaledVector(targetVel, Math.min(dist / Math.max(sp, 1), 2)).sub(origin).normalize();
      aim.x += rand(-0.02, 0.02); aim.y += rand(-0.02, 0.02); aim.z += rand(-0.02, 0.02);
      aim.normalize();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(npc.group.quaternion).multiplyScalar(Math.random() < 0.5 ? -1 : 1);
      fire(weaponId, {
        origin, dir: weaponId === 'pulse' || weaponId === 'flak' ? aim : fwd, side, shooter: npc, target: targetRef,
        color, baseSpeed: npc.speed, npc: true, right,
      });
    }
    return rand(P.cd[0], P.cd[1]);
  }

  function updateNpcBursts() {
    for (const [npc, st] of npcBursts) {
      if (!npc.alive || npc.hidden || npc.warping || time > st.until) { npcBursts.delete(npc); continue; }
      const fwd = _c.set(0, 0, -1).applyQuaternion(npc.group.quaternion);
      const origin = _b.copy(npc.group.position).addScaledVector(fwd, npc.radius * 1.1 + 4);
      beam(`npc-${npc.id}`, {
        origin, dir: fwd, side: npc.side === 'hostile' ? 'hostile' : 'ally', shooter: npc,
        dps: NPC_PROFILE.beam.dps, range: NPC_PROFILE.beam.range, color: st.color, width: Math.max(5, npc.radius * 0.4),
      });
    }
  }

  function update(dt) {
    time += dt;
    updateNpcBursts();
    updateBeams(dt);
    particles.update(dt, camera);
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const k = Math.min(1, e.age / e.duration);
      e.step(k);
      if (k >= 1) { effects.splice(i, 1); e.done(); }
    }
  }

  function clear() {
    for (const k of [...beams.keys()]) { const b = beams.get(k); b.live = false; b.power = 0; }
    npcBursts.clear();
  }

  return { fire, beam, npcFire, update, clear, particles, get time() { return time; } };
}

// ============================================================
// ARSENAŁ GRACZA: wybór broni, ciepło, namierzanie, strzał
// ============================================================
/**
 * @param {object} o
 * @param {ReturnType<typeof createWeapons>} o.weapons
 * @param {THREE.Object3D} o.ship        grupa statku gracza (pozycja/kwaternion)
 * @param {() => number} o.getRadius     promień kolizji statku (wylot luf)
 * @param {() => number} o.getSpeed      prędkość statku (rakiety startują z nią)
 * @param {() => Array} o.getTargets     wrodzy NPC: [{ group, velocity, actor, alive, hidden, callsign }]
 */
export function createPlayerArsenal({ weapons, ship, getRadius, getSpeed, getTargets }) {
  const state = {
    weapon: 'pulse',
    heat: 0,             // 0..100
    overheated: false,
    cooldown: 0,
    thermal: 60,         // z karty rasy (ship.thermal)
    raceId: 'wybudzeni',
    damageMult: 1,
    lock: { target: null, progress: 0, locked: false },
    firing: false,
  };
  let side = 1;
  const listeners = { overheat: [], cooled: [], locked: [], switched: [] };
  const emit = (t, p) => listeners[t].forEach((fn) => fn(p));

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3();

  function setRace(raceId, thermal, damageMult) {
    state.raceId = raceId;
    state.thermal = thermal;
    state.damageMult = damageMult;
    state.heat = 0;
    state.overheated = false;
  }
  const special = () => RACE_WEAPON[state.raceId];
  // grzanie skalowane pojemnością cieplną rasy (60 = wzorzec) i specjalnością (-30%)
  const heatScale = (id) => (60 / state.thermal) * (id === special() ? 0.7 : 1);

  function select(id) {
    if (!WEAPONS[id] || id === state.weapon) return;
    state.weapon = id;
    state.cooldown = Math.max(state.cooldown, 0.25); // przezbrojenie trwa chwilę
    emit('switched', id);
  }
  function cycle(step) {
    const i = WEAPON_ORDER.indexOf(state.weapon);
    select(WEAPON_ORDER[(i + step + WEAPON_ORDER.length) % WEAPON_ORDER.length]);
  }

  function addHeat(amount) {
    state.heat = Math.min(100, state.heat + amount);
    if (state.heat >= 100 && !state.overheated) { state.overheated = true; emit('overheat'); }
  }

  /** Asysta celowania: kierunek na najlepszego wroga w stożku (z wyprzedzeniem) albo prosto. */
  function assistedDir(origin, coneDeg, projSpeed) {
    let dir = _f.clone();
    let bestCos = Math.cos(THREE.MathUtils.degToRad(coneDeg));
    for (const n of getTargets()) {
      _d.copy(n.group.position).sub(ship.position);
      const dist = _d.length();
      if (dist > 3500) continue;
      const c = _d.normalize().dot(_f);
      if (c > bestCos) {
        bestCos = c;
        const t = projSpeed ? dist / projSpeed : 0;
        dir = n.group.position.clone().addScaledVector(n.velocity, t).sub(origin).normalize();
      }
    }
    return dir;
  }

  function updateLock(dt) {
    const W = WEAPONS.missile;
    const L = state.lock;
    if (state.weapon !== 'missile' && state.weapon !== 'torpedo') { L.target = null; L.progress = 0; L.locked = false; return; }
    const inCone = (n, deg) => {
      if (!n.alive || n.hidden) return -2;
      _d.copy(n.group.position).sub(ship.position);
      if (_d.length() > W.lockRange) return -2;
      const c = _d.normalize().dot(_f);
      return c >= Math.cos(THREE.MathUtils.degToRad(deg)) ? c : -2;
    };
    // namiar trzymamy w SZERSZYM stożku, niż go łapiemy - inaczej gubiłby się przy każdym manewrze
    if (L.target && inCone(L.target, W.keepConeDeg) < -1) { L.target = null; L.progress = 0; L.locked = false; }
    if (!L.target) {
      let best = null, bestC = -1;
      for (const n of getTargets()) { const c = inCone(n, W.lockConeDeg); if (c > bestC) { bestC = c; best = n; } }
      L.target = best;
      L.progress = 0;
      L.locked = false;
    }
    if (L.target) {
      L.progress = Math.min(1, L.progress + dt / W.lockTime);
      if (L.progress >= 1 && !L.locked) { L.locked = true; emit('locked', L.target); }
    }
  }

  /**
   * Wołać co klatkę.
   * @param {number} dt
   * @param {boolean} triggerHeld  czy spust jest wciśnięty
   * @param {boolean} canFire      np. false w fałdzie / po śmierci
   */
  function update(dt, triggerHeld, canFire = true) {
    _f.set(0, 0, -1).applyQuaternion(ship.quaternion);
    _r.set(1, 0, 0).applyQuaternion(ship.quaternion);
    state.cooldown = Math.max(0, state.cooldown - dt);

    // chłodzenie: szybsze, gdy nie strzelamy; rasy o dużym `thermal` oddają ciepło szybciej
    const firingBeam = triggerHeld && canFire && state.weapon === 'beam' && !state.overheated;
    const cool = (firingBeam ? 6 : 20) * (state.thermal / 60);
    state.heat = Math.max(0, state.heat - cool * dt);
    if (state.overheated && state.heat <= 30) { state.overheated = false; emit('cooled'); }

    updateLock(dt);
    state.firing = false;
    if (!triggerHeld || !canFire || state.overheated) return;

    const id = state.weapon;
    const W = WEAPONS[id];
    const radius = getRadius();
    const origin = ship.position.clone().addScaledVector(_f, radius * 1.1 + 6);

    if (id === 'beam') {
      state.firing = true;
      addHeat(W.heatPerSec * heatScale(id) * dt);
      weapons.beam('player', {
        origin, dir: assistedDir(origin, W.assistDeg, 0), side: 'player', shooter: { callsign: 'gracz' },
        dps: W.dps, range: W.range, color: W.color, width: Math.max(6, radius * 0.45), damageMult: state.damageMult,
      });
      return;
    }
    if (state.cooldown > 0) return;
    state.firing = true;
    const lockT = state.lock.locked ? state.lock.target : null;
    const targetRef = lockT ? { position: lockT.group.position, velocity: lockT.velocity, isAlive: () => lockT.alive && !lockT.hidden } : null;

    if (id === 'missile') {
      // salwa dwóch rakiet z obu burt
      for (const s of [-1, 1]) {
        const o = origin.clone().addScaledVector(_r, s * Math.max(3, radius * 0.25));
        weapons.fire('missile', {
          origin: o, dir: _f.clone(), side: 'player', shooter: { callsign: 'gracz' }, target: targetRef,
          damageMult: state.damageMult, baseSpeed: Math.max(0, getSpeed()), right: _r.clone().multiplyScalar(s),
        });
      }
    } else if (id === 'torpedo') {
      weapons.fire('torpedo', {
        origin, dir: _f.clone(), side: 'player', shooter: { callsign: 'gracz' }, target: targetRef,
        damageMult: state.damageMult, baseSpeed: Math.max(0, getSpeed()),
      });
    } else {
      const o = origin.clone().addScaledVector(_r, (side *= -1) * Math.max(3, radius * 0.15));
      weapons.fire(id, {
        origin: o, dir: assistedDir(o, W.assistDeg, W.speed), side: 'player', shooter: { callsign: 'gracz' },
        damageMult: state.damageMult,
      });
    }
    state.cooldown = W.cooldown;
    addHeat(W.heat * heatScale(id));
  }

  return {
    update, select, cycle, setRace, state,
    isSpecial: (id) => id === special(),
    on(t, fn) { listeners[t].push(fn); },
  };
}
