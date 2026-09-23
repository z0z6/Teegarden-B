import * as THREE from 'three';

/**
 * Tło kosmosu: gwiazdy + mgławice, "w nieskończoności".
 *
 * DLACZEGO NIE TAK JAK W KROKU 2: tam gwiazdy to zwykłe `Points` w
 * promieniu 450-1500 j. wokół (0,0,0), a kamera lata w obrębie kilkuset
 * jednostek - więc tło wygląda na odległe. W kroku 4 statek startuje
 * ~49000 j. od środka i lata po całym układzie. Gwiazdy rozsypane
 * wokół (0,0,0) byłyby albo mikroskopijne (rozmiar w jednostkach świata
 * kurczy się z odległością do ułamka piksela), albo statek by "przelatywał
 * przez sferę gwiazd" i widziałby paralaksę. Tło musi być zawsze
 * nieskończenie daleko - dlatego:
 *
 *  - MGŁAWICE: raz przy starcie "wypiekamy" proceduralną mgławicę (szum
 *    fbm w shaderze) do cube mapy i ustawiamy ją jako `scene.background`.
 *    Three.js rysuje takie tło bez translacji kamery (tylko rotacja), więc
 *    jest ono z definicji w nieskończoności, niezależnie od tego, jak
 *    daleko poleci statek, i nic nie kosztuje w każdej klatce.
 *  - GWIAZDY: `Points` o stałym rozmiarze w PIKSELACH (nie w jednostkach
 *    świata), doczepione do kamery - też zero paralaksy. Ta sama paleta
 *    kolorów i liczba (6000) co w kroku 2, tylko z różnicowaniem
 *    jasności/rozmiaru dla głębi.
 *
 * Nie ma żadnych plików tekstur do pobrania - wszystko jest generowane
 * kodem, więc nic nie może się nie załadować.
 */

// ------------------------------------------------------------------
// Shader mgławicy (wypiekany raz do cube mapy)
// ------------------------------------------------------------------
const NEBULA_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEBULA_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform float uSeed;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
          mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
          mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) {
      s += a * vnoise(p);
      p = p * 2.03 + vec3(11.7, 3.1, 7.3);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 sd = vec3(uSeed, uSeed * 0.37, uSeed * 1.91);

    // "domain warp" - lekko zniekształca współrzędne szumu, dzięki czemu
    // chmury mają wijące się, organiczne kształty zamiast równych plam
    float warp = fbm(d * 1.7 + sd);
    vec3 p = d * 2.1 + vec3(warp * 0.9) + sd;

    float n1 = fbm(p);                       // główna struktura chmur
    float n2 = fbm(p * 1.6 + vec3(13.0));    // druga, niezależna warstwa
    float n3 = fbm(p * 0.8 + vec3(-7.0));    // duże, rzadkie obłoki

    // progi ustawione wysoko: mgławice zajmują tylko część nieba, reszta
    // to prawie czarna pustka z gwiazdami (jak w realnym niebie)
    float m1 = smoothstep(0.54, 0.84, n1);
    float m2 = smoothstep(0.56, 0.88, n2);
    float m3 = smoothstep(0.58, 0.87, n3);

    // paleta: fiolet, morski błękit, karmazyn - jak na zdjęciach mgławic
    vec3 violet  = vec3(0.30, 0.10, 0.52);
    vec3 teal    = vec3(0.04, 0.26, 0.40);
    vec3 crimson = vec3(0.55, 0.10, 0.18);

    vec3 col = violet * m1 * 0.55 + teal * m2 * 0.50 + crimson * m3 * 0.45;
    // jasne jądra tam, gdzie chmury się nakładają
    col += vec3(0.35, 0.22, 0.45) * pow(m1 * m2, 2.0) * 0.6;

    // pasy pyłu - przyciemniają część mgławic (głębia)
    float dust = fbm(d * 4.3 + sd + vec3(3.0));
    col *= 1.0 - 0.65 * smoothstep(0.52, 0.78, dust);

    // ogólna jasność mgławic - celowo niska, żeby tło NIE konkurowało ze
    // statkiem i gwiazdami układu (najważniejsze rzeczy w kadrze)
    col *= 0.38;

    // bardzo słaba, wąska "droga mleczna" wzdłuż jednej płaszczyzny
    float b = dot(d, normalize(vec3(0.35, 1.0, 0.2)));
    float band = exp(-b * b * 14.0);
    col += vec3(0.012, 0.013, 0.02) * band * (0.4 + n1);

    // prawie czarne tło zamiast idealnej czerni (unika "dziury" w obrazie)
    col += vec3(0.002, 0.003, 0.006);

    // delikatny dithering - zapobiega pasmom na ciemnych gradientach
    float dith = (hash13(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
    gl_FragColor = vec4(max(col + dith, 0.0), 1.0);
  }
`;

// ------------------------------------------------------------------
// Shader gwiazd: stały rozmiar w pikselach, miękki okrągły punkt
// ------------------------------------------------------------------
const STAR_VERT = /* glsl */ `
  attribute float aSize;
  varying vec3 vColor;
  uniform float uPixelRatio;
  // NAPĘD FAŁDOWY (shared/systems/warp-drive.js): relatywistyczna aberracja.
  // uBeta = v/c obserwatora, uWarpDir = kierunek lotu (świat). Dla uBeta = 0
  // gwiazdy są dokładnie tam, gdzie były (kroki 4-5 nie widzą różnicy).
  uniform float uBeta;
  uniform vec3 uWarpDir;
  void main() {
    vec3 d = normalize(position);
    vec3 col = color;
    float size = aSize;
    if (abs(uBeta) > 1e-4) {
      // cos(theta') = (cos(theta) + beta) / (1 + beta cos(theta)): przy dużej
      // prędkości kierunki gwiazd "zbiegają się" przed dziobem
      float c = dot(d, uWarpDir);
      vec3 perp = d - uWarpDir * c;
      float pl = length(perp);
      perp = pl > 1e-5 ? perp / pl : vec3(0.0);
      float c2 = (c + uBeta) / (1.0 + uBeta * c);
      d = uWarpDir * c2 + perp * sqrt(max(0.0, 1.0 - c2 * c2));
      // czynnik Dopplera D: >1 przed dziobem (jaśniej, ku fioletowi),
      // <1 za rufą (ciemniej, ku czerwieni)
      float g = inversesqrt(max(1e-4, 1.0 - uBeta * uBeta));
      float D = clamp(1.0 / (g * (1.0 - uBeta * c2)), 0.15, 6.0);
      float sh = clamp(log2(D) / 2.0, -1.0, 1.0);
      col = sh > 0.0 ? mix(col, vec3(0.45, 0.66, 1.0), sh * 0.9) : mix(col, vec3(1.0, 0.32, 0.18) * 0.8, -sh * 0.85);
      // jasność rośnie z D, ale z twardym sufitem: tysiące gwiazd zbitych w
      // stożek przed dziobem inaczej zlewają się w białą plamę, na tle
      // której ginie statek
      col *= min(pow(D, 0.7), 1.8);
      size *= clamp(pow(D, 0.3), 0.6, 1.5);
    }
    vColor = col;
    gl_PointSize = size * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(d * 1000.0, 1.0);
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.25, 1.0, r);
    if (a <= 0.01) discard;
    gl_FragColor = vec4(vColor * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Deterministyczny generator liczb losowych (mulberry32) - to samo niebo
// przy każdym uruchomieniu, zamiast za każdym razem innego Math.random().
function makeRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function fillStars(positions, colors, sizes, count, rng) {
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // jednostajny rozkład na sferze (jak w kroku 2), stała odległość
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const R = 1000;
    positions.set(
      [R * Math.sin(phi) * Math.cos(theta), R * Math.sin(phi) * Math.sin(theta), R * Math.cos(phi)],
      i * 3
    );

    // paleta 1:1 z kroku 2: 70% chłodna biel, 20% żółtawe, 10% czerwonawe
    const tint = rng();
    if (tint < 0.7) color.setHSL(0.6, 0.2, 0.85 + rng() * 0.15);
    else if (tint < 0.9) color.setHSL(0.15, 0.3, 0.8);
    else color.setHSL(0.02, 0.5, 0.75);

    // większość gwiazd słaba i drobna, nieliczne jasne i większe (głębia)
    const bright = Math.pow(rng(), 3.0); // 0..1, skośnie ku małym wartościom
    const dim = 0.5 + 0.5 * bright;
    colors.set([color.r * dim, color.g * dim, color.b * dim], i * 3);
    sizes[i] = 1.6 + bright * 2.8;
  }
}

function createStars({ count, rng, pixelRatio }) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  fillStars(positions, colors, sizes, count, rng);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uPixelRatio: { value: pixelRatio },
      uBeta: { value: 0 },
      uWarpDir: { value: new THREE.Vector3(0, 0, -1) },
    },
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false, // lista "opaque" => rysowane PRZED wszystkim z renderOrder > -1
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // punkty wokół kamery - zawsze "widoczne"
  points.renderOrder = -10;     // za wszystkim innym (planety/gwiazdy/statek rysują się na wierzchu)
  return points;
}

/**
 * @param {THREE.WebGLRenderer} renderer - potrzebny do jednorazowego wypieczenia mgławicy
 * @param {THREE.Scene} scene
 * @param {object} [opts]
 * @param {number} [opts.starCount=6000] - jak w kroku 2
 * @param {number} [opts.seed=7] - zmiana daje inne rozmieszczenie gwiazd i mgławic
 * @param {number} [opts.cubeSize=1024] - rozdzielczość ściany cube mapy mgławicy
 * @returns {{ update(camera: THREE.Camera): void, setWarp(beta: number, dir: THREE.Vector3): void, stars: THREE.Points }}
 */
export function createSpaceBackground(renderer, scene, {
  starCount = 6000,
  seed = 7,
  cubeSize = 1024,
} = {}) {
  const rng = makeRng(seed);

  // --- Mgławice: jednorazowy render do cube mapy ---
  const size = Math.min(cubeSize, renderer.capabilities.maxCubemapSize || cubeSize);
  // Half-float unika pasm na ciemnych gradientach; gdy GPU nie umie
  // renderować do half-float (część starych telefonów), wracamy do 8 bit
  // (dithering w shaderze łagodzi wtedy pasma).
  const halfOk = renderer.extensions.has('EXT_color_buffer_float')
    || renderer.extensions.has('EXT_color_buffer_half_float');
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, {
    type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const bakeMaterial = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    uniforms: { uSeed: { value: 0 } },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRT);
  /** Wypieka mgławicę dla danego ziarna do tej samej cube mapy (bez nowych alokacji GPU). */
  function bake(nebulaSeed) {
    const bakeScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 48, 24);
    bakeMaterial.uniforms.uSeed.value = nebulaSeed;
    bakeScene.add(new THREE.Mesh(geo, bakeMaterial));
    cubeCamera.update(renderer, bakeScene);
    geo.dispose();
  }
  bake(3.0 + rng() * 40.0);
  scene.background = cubeRT.texture;

  // --- Gwiazdy ---
  const stars = createStars({ count: starCount, rng, pixelRatio: renderer.getPixelRatio() });
  scene.add(stars);

  const camPos = new THREE.Vector3();
  /** Wołać co klatkę PO ustawieniu kamery: gwiazdy podążają za kamerą (zero paralaksy). */
  function update(camera) {
    camera.getWorldPosition(camPos);
    stars.position.copy(camPos);
  }

  /**
   * Aberracja gwiazd przy skoku fałdowym (patrz warp-drive.js). beta = v/c
   * (0 = brak efektu, ujemne = chwilowe "odbicie" nieba po wyjściu z fałdy),
   * dir = kierunek lotu w świecie (znormalizowany).
   */
  function setWarp(beta, dir) {
    stars.material.uniforms.uBeta.value = beta;
    if (dir) stars.material.uniforms.uWarpDir.value.copy(dir);
  }

  /**
   * Nowe niebo (inny układ gwiezdny = inna mgławica i inne gwiazdy tła).
   * Ta sama cube mapa i ten sam obiekt Points - bez nowych obiektów w scenie.
   */
  function reseed(newSeed) {
    const r = makeRng(newSeed);
    bake(3.0 + r() * 40.0);
    const g = stars.geometry;
    fillStars(g.attributes.position.array, g.attributes.color.array, g.attributes.aSize.array, starCount, r);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.aSize.needsUpdate = true;
  }

  return { update, setWarp, reseed, stars };
}
