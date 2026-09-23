import * as THREE from 'three';
import { NOISE_TEX_GLSL, noiseUniforms } from './noise-textures.js';

/**
 * POWIERZCHNIA GWIAZDY - proceduralna, żywa, bez żadnych tekstur z pliku.
 *
 * Warstwy (od środka):
 *   1. FOTOSFERA  - shader na kuli: GRANULACJA (komórki konwekcyjne, szum
 *                   Worleya: jasne środki, ciemne szczeliny), supergranule,
 *                   OLBRZYMIE KOMÓRKI KONWEKCJI (czerwone olbrzymy mają ich
 *                   kilka na całą tarczę - jak Betelgeza), włókna PLAZMY
 *                   (pole przepływu: szum z zawirowaną domeną), plamy z
 *                   półcieniem, pochodnie przy brzegu, pociemnienie brzegowe
 *                   i ROTACJA RÓŻNICOWA (równik obraca się szybciej niż bieguny).
 *                   Kolor liczony z TEMPERATURY (ciało doskonale czarne), a
 *                   ciemniejsze szczeliny są chłodniejsze - czerwieńsze.
 *   2. KORONA     - billboard z promieniowymi smugami (streamery), cienką
 *                   chromosferą przy brzegu i - dla olbrzymów - OBŁOKAMI
 *                   MATERII (pyłowa otoczka tracona przez gwiazdę).
 *   3. PROTUBERANCJE - pętle plazmy zakotwiczone w powierzchni: rosną, żyją,
 *                   gasną albo są WYRZUCANE (erupcja) w przestrzeń.
 *   4. ROZBŁYSKI  - nagłe rozjaśnienie łaty powierzchni, korony i światła
 *                   gwiazdy (czerwone karły rozbłyskują często - naprawdę).
 *   5. DEFORMACJA PŁYWOWA - gwiazda wypełniająca swoją powierzchnię Roche'a
 *                   wyciąga się w "łzę" w stronę towarzysza (setTide()).
 *
 * Wszystko jest budowane w jednostkach PROMIENIA (kula o promieniu 1), a
 * cała grupa jest skalowana promieniem gwiazdy - więc detal granulacji
 * podajemy w "komórkach na promień", a nie w jednostkach świata.
 *
 * ANTYALIASING: granule na odległej gwieździe byłyby mniejsze niż piksel
 * i migotałyby. Shader mierzy ich rozmiar na ekranie (fwidth) i płynnie
 * wygasza drobny detal - z daleka widać duże struktury, z bliska granule.
 */

// ============================================================
// TYPY GWIAZD - parametry wyglądu (fizyka: masa/promień - w star-systems.js)
// ============================================================
// temp       - prawdziwa temperatura powierzchni typu (K), do opisu i korony
// colorTemp  - temperatura, z której liczymy BARWĘ tarczy. Fizycznie Słońce
//              (5800 K) jest niemal białe; gra potrzebuje, żeby na pierwszy
//              rzut oka "żółta = G, pomarańczowa = K, czerwona = M", więc
//              barwę liczymy z nieco niższej temperatury. Kolejność typów
//              i kontrasty między nimi zostają prawdziwe.
export const STAR_TYPES = {
  blueSupergiant: {
    label: 'Błękitny nadolbrzym (B)', temp: 21000, gran: 90, granContrast: 0.35, conv: 0, plasma: 0.9, spots: 0,
    limb: 0.35, brightness: 0.85, corona: 1.4, coronaFall: 2.2, streamers: 1.0, dust: 0,
    promColor: 0x9fb8ff, promCount: 7, eruptChance: 0.4, flareEvery: 0, rotation: 0.05, sat: 2.3,
    colorTemp: 12500,
  },
  whiteDwarf: {
    label: 'Biały karzeł', temp: 24000, gran: 0, granContrast: 0, conv: 0, plasma: 0.25, spots: 0,
    limb: 0.25, brightness: 0.9, corona: 0.9, coronaFall: 6, streamers: 0.2, dust: 0,
    promColor: 0xc8dcff, promCount: 0, eruptChance: 0, flareEvery: 0, rotation: 0.6, sat: 1.3,
    colorTemp: 15000,
  },
  yellowDwarf: {
    label: 'Żółty karzeł (G)', temp: 5800, gran: 60, granContrast: 0.55, conv: 0, plasma: 0.55, spots: 0.55,
    limb: 0.55, brightness: 0.7, corona: 1.0, coronaFall: 3.2, streamers: 0.8, dust: 0,
    promColor: 0xff5a6e, promCount: 6, eruptChance: 0.3, flareEvery: 40, rotation: 0.08, sat: 2.1,
    colorTemp: 4500,
  },
  orangeDwarf: {
    label: 'Pomarańczowy karzeł (K)', temp: 4600, gran: 55, granContrast: 0.6, conv: 0, plasma: 0.5, spots: 0.75,
    limb: 0.6, brightness: 0.68, corona: 0.85, coronaFall: 3.5, streamers: 0.7, dust: 0,
    promColor: 0xff4a55, promCount: 5, eruptChance: 0.3, flareEvery: 30, rotation: 0.1, sat: 1.8,
    colorTemp: 3700,
  },
  redDwarf: {
    label: 'Czerwony karzeł (M)', temp: 2900, gran: 40, granContrast: 0.6, conv: 0.35, plasma: 0.6, spots: 1.0,
    limb: 0.65, brightness: 0.72, corona: 0.8, coronaFall: 3.0, streamers: 0.6, dust: 0,
    promColor: 0xff3a3a, promCount: 6, eruptChance: 0.45, flareEvery: 9, rotation: 0.15, sat: 1.8,
    colorTemp: 2150,
  },
  redGiant: {
    label: 'Czerwony olbrzym', temp: 3400, gran: 220, granContrast: 0.35, conv: 1.0, plasma: 0.35, spots: 0,
    limb: 0.7, brightness: 0.58, corona: 0.55, coronaFall: 1.6, streamers: 0.35, dust: 1.0,
    promColor: 0xff6a3a, promCount: 4, eruptChance: 0.5, flareEvery: 0, rotation: 0.02, sat: 1.7,
    colorTemp: 2750,
  },
};

// ============================================================
// Wspólne funkcje GLSL
// ============================================================
// Szum z tekstur 3D (noise-textures.js) - dawniej liczony proceduralnie
// w każdym pikselu (8 haszy na próbkę, 27 sąsiadów na komórkę Worleya).
const NOISE_GLSL = NOISE_TEX_GLSL + /* glsl */ `
// kolor ciała doskonale czarnego (przybliżenie T. Hellanda), wynik w sRGB 0..1
vec3 blackbody( float t ) {
  t = clamp( t, 1000.0, 40000.0 ) / 100.0;
  float r = t <= 66.0 ? 1.0 : clamp( 1.292936 * pow( t - 60.0, -0.1332047 ), 0.0, 1.0 );
  float g = t <= 66.0 ? clamp( 0.39008158 * log( t ) - 0.63184144, 0.0, 1.0 ) : clamp( 1.1298909 * pow( t - 60.0, -0.0755148 ), 0.0, 1.0 );
  float b = t >= 66.0 ? 1.0 : ( t <= 19.0 ? 0.0 : clamp( 0.54320679 * log( t - 10.0 ) - 1.19625409, 0.0, 1.0 ) );
  return pow( vec3( r, g, b ), vec3( 2.2 ) ); // do liniowego (potok three.js)
}
`;

// ============================================================
// 1. FOTOSFERA
// ============================================================
const PHOTO_VERT = /* glsl */ `
uniform vec3 uTideDir;
uniform float uTide;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec3 n = normalize( position );
  vObj = n;
  // deformacja pływowa: "łza" wyciągnięta w stronę towarzysza (wypełniony płat Roche'a)
  float k = max( dot( n, uTideDir ), 0.0 );
  vec3 p = position + uTideDir * uTide * pow( k, 6.0 ) + n * uTide * 0.08 * k * k;
  vec4 w = modelMatrix * vec4( p, 1.0 );
  vWorld = w.xyz;
  vNormalW = normalize( mat3( modelMatrix ) * n );
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const PHOTO_FRAG = /* glsl */ `
uniform float uTime, uTemp, uGran, uGranContrast, uConv, uPlasma, uSpots, uLimb, uBright, uRot, uSeed, uSat;
uniform float uFlare;
uniform vec3 uFlareDir;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNormalW;
${NOISE_GLSL}
vec3 rotY( vec3 p, float a ) { float c = cos( a ), s = sin( a ); return vec3( c * p.x + s * p.z, p.y, -s * p.x + c * p.z ); }
void main() {
  vec3 p0 = normalize( vObj );
  // ROTACJA RÓŻNICOWA: równik szybciej niż bieguny (jak na Słońcu: ~25 vs ~35 dni)
  float lat = p0.y;
  vec3 p = rotY( p0, uTime * uRot * ( 1.0 - 0.35 * lat * lat ) );
  vec3 sd = vec3( uSeed, uSeed * 1.7, uSeed * 0.3 );
  float t = uTime;

  // PLAZMA: pole przepływu (zawirowana domena) - wszystkie dalsze warstwy płyną po nim
  vec3 q = p * 2.6 + sd;
  vec3 warp = vec3( fbm( q + t * 0.03 ), fbm( q + vec3( 5.2, 1.3, 2.8 ) - t * 0.025 ), fbm( q + vec3( 1.7, 9.2, 3.3 ) + t * 0.02 ) ) - 0.5;
  vec3 pw = p + warp * 0.09 * uPlasma;

  float I = 1.0;

  // OLBRZYMIE KOMÓRKI KONWEKCJI (kilka na tarczę - czerwone olbrzymy)
  if ( uConv > 0.0 ) {
    vec2 gc = worley( pw * 2.4 + sd, t * 0.05 );
    float cell = smoothstep( 0.0, 0.55, gc.y - gc.x );
    float core = 1.0 - smoothstep( 0.0, 0.9, gc.x );
    I *= mix( 1.0, 0.35 + 0.55 * cell + 0.45 * core, uConv );
  }

  // GRANULACJA + antyaliasing: z daleka granule gasną płynnie zamiast migotać
  if ( uGran > 0.0 ) {
    vec3 gp = pw * uGran;
    float px = length( fwidth( gp ) );
    float aa = 1.0 - smoothstep( 0.35, 0.9, px );
    if ( aa > 0.0 ) {
      vec2 g = worley( gp + sd * 3.0, t * 0.9 );
      float lane = smoothstep( 0.02, 0.22, g.y - g.x );       // ciemne szczeliny między komórkami
      float bright = 1.0 - smoothstep( 0.0, 0.75, g.x );       // gorący środek komórki
      I *= mix( 1.0, 0.45 + 0.35 * lane + 0.4 * bright, uGranContrast * aa );
    }
    // supergranule - większa, słabsza siatka, widoczna też z dalszej odległości
    vec3 sp = pw * uGran * 0.16;
    float aa2 = 1.0 - smoothstep( 0.35, 0.9, length( fwidth( sp ) ) );
    if ( aa2 > 0.0 ) {
      vec2 s2 = worley( sp + sd, t * 0.15 );
      I *= mix( 1.0, 0.82 + 0.25 * smoothstep( 0.0, 0.35, s2.y - s2.x ), 0.5 * aa2 * uGranContrast );
    }
  }

  // WŁÓKNA PLAZMY: grzbiety szumu na zawirowanej domenie - jasne, płynące nitki
  float ridge = 1.0 - abs( fbm( pw * 7.0 + warp * 3.0 + sd + t * 0.04 ) * 2.0 - 1.0 );
  I += pow( ridge, 7.0 ) * 0.55 * uPlasma;

  // PLAMY: cień (umbra) i półcień (penumbra), pojawiają się w pasie niskich szerokości
  if ( uSpots > 0.0 ) {
    float s = fbm( p * 3.1 + sd * 2.0 + vec3( 0.0, 0.0, t * 0.004 ) );
    float band = 1.0 - smoothstep( 0.35, 0.7, abs( lat ) );
    float pen = smoothstep( 0.6, 0.66, s ) * band;
    float umb = smoothstep( 0.67, 0.71, s ) * band;
    I *= 1.0 - uSpots * ( 0.35 * pen + 0.5 * umb );
  }

  // pociemnienie brzegowe + pochodnie (jasne plamki widoczne głównie przy brzegu)
  vec3 V = normalize( cameraPosition - vWorld );
  float mu = clamp( dot( normalize( vNormalW ), V ), 0.0, 1.0 );
  float fac = smoothstep( 0.6, 0.72, fbm( p * 11.0 + sd + t * 0.02 ) ) * pow( 1.0 - mu, 1.5 );
  I += fac * 0.45 * uGranContrast;
  I *= 1.0 - uLimb * ( 1.0 - pow( mu, 0.55 ) );

  // ROZBŁYSK: łata powierzchni rozgrzewa się do bieli
  float fl = exp( -pow( acos( clamp( dot( p0, uFlareDir ), -1.0, 1.0 ) ) / 0.09, 2.0 ) ) * uFlare;

  // kolor z temperatury: ciemniejsze (chłodniejsze) obszary są czerwieńsze
  float tLocal = uTemp * ( 0.8 + 0.2 * clamp( I, 0.0, 1.5 ) ) * ( 0.92 + 0.08 * mu );
  vec3 bb = blackbody( tLocal );
  // barwa ciała doskonale czarnego jest fizycznie prawie biała dla Słońca;
  // gra potrzebuje czytelnego "żółte = G, czerwone = M" - podbijamy nasycenie
  float luma = dot( bb, vec3( 0.2126, 0.7152, 0.0722 ) );
  bb = max( mix( vec3( luma ), bb, uSat ), 0.0 );
  vec3 col = bb * I * uBright * 1.35;
  col += vec3( 1.0, 0.96, 0.9 ) * fl * 3.0;
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ============================================================
// 2. KORONA (billboard w środku gwiazdy - wnętrze zasłania sama kula)
// ============================================================
const CORONA_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vP;
void main() {
  vP = position.xy;
  vec4 mvC = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
  gl_Position = projectionMatrix * ( mvC + vec4( position.xy * uSize, 0.0, 0.0 ) );
}
`;
const CORONA_FRAG = /* glsl */ `
uniform float uTime, uExtent, uCorona, uFall, uStreamers, uDust, uFlare, uSeed, uTemp;
uniform vec3 uChromo;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float r = length( vP ) * uExtent;     // w promieniach sylwetki gwiazdy
  if ( r < 0.97 ) discard;
  float a = atan( vP.y, vP.x );
  vec2 dir = vec2( cos( a ), sin( a ) );
  float h = max( r - 1.0, 0.0 );
  vec3 sd = vec3( uSeed );
  vec3 cCol = mix( blackbody( uTemp * 1.4 + 3000.0 ), vec3( 1.0 ), 0.25 );

  float glow = exp( -h * uFall ) * 0.9;
  // STREAMERY: szum po kącie, rozciągnięty promieniowo, powoli płynący na zewnątrz
  float n = fbm( vec3( dir * 3.5, h * 0.7 - uTime * 0.03 ) + sd );
  float n2 = fbm( vec3( dir * 9.0, h * 1.5 - uTime * 0.05 ) + sd * 1.3 );
  float streamers = pow( n, 2.2 ) * ( 0.6 + 0.8 * n2 ) * exp( -h * uFall * 0.32 ) * uStreamers;
  // CHROMOSFERA: cienki, gorący pierścień tuż nad brzegiem (z "włoskami" spikul)
  float spic = 0.7 + 0.6 * vnoise( vec3( dir * 60.0, uTime * 0.5 ) + sd );
  float chromo = exp( -pow( ( r - 1.0 ) / ( 0.018 * spic ), 2.0 ) );
  // OBŁOKI MATERII: grudkowata otoczka pyłu i gazu tracona przez olbrzyma
  float dust = 0.0;
  if ( uDust > 0.0 ) {
    float cl = fbm( vec3( vP * uExtent * 1.6, uTime * 0.01 ) + sd * 2.0 );
    float cl2 = fbm( vec3( vP * uExtent * 4.0, uTime * 0.015 ) + sd );
    dust = smoothstep( 0.45, 0.85, cl * 0.7 + cl2 * 0.45 ) * exp( -pow( ( r - 1.6 ) / 0.8, 2.0 ) ) * uDust;
  }
  vec3 col = cCol * ( glow + streamers * 1.3 ) * uCorona * ( 1.0 + uFlare * 2.0 )
           + uChromo * chromo * 1.4
           + vec3( 0.9, 0.42, 0.2 ) * dust * 0.55;
  float edge = 1.0 - smoothstep( 0.8, 1.0, length( vP ) );
  gl_FragColor = vec4( col * edge, 1.0 );
}
`;

// ============================================================
// 3. PROTUBERANCJE (rurki wzdłuż łuku, animowane w shaderze)
// ============================================================
const PROM_VERT = /* glsl */ `
uniform float uLift, uErupt;
uniform vec3 uMid;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  float L = length( position );
  vec3 n = position / L;
  // wzrost pętli (0..1) i erupcja: pętla odrywa się i pędzi w przestrzeń, puchnąc
  float hgt = ( L - 1.0 ) * uLift * ( 1.0 + uErupt * 3.0 );
  vec3 p = n * ( 1.0 + hgt ) + uMid * uErupt * 0.9;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  vN = normalize( normalMatrix * normal );
  vV = normalize( -mv.xyz );
  gl_Position = projectionMatrix * mv;
}
`;
const PROM_FRAG = /* glsl */ `
uniform float uTime, uAlpha, uSeed;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
${NOISE_GLSL}
void main() {
  // rdzeń rurki jaśniejszy niż jej brzeg - wygląda jak świecący gaz, nie jak rura
  float core = pow( abs( dot( normalize( vN ), normalize( vV ) ) ), 2.5 );
  // materia spływa wzdłuż pętli z obu stron (plazma "deszczem" wraca na powierzchnię)
  float flow = fbm( vec3( vUv.x * 14.0 - uTime * 0.6, vUv.y * 3.0, uSeed ) );
  float flow2 = fbm( vec3( vUv.x * 30.0 + uTime * 0.9, vUv.y * 6.0, uSeed + 4.0 ) );
  float strands = smoothstep( 0.35, 0.8, flow * 0.7 + flow2 * 0.5 );
  float ends = smoothstep( 0.0, 0.08, vUv.x ) * smoothstep( 1.0, 0.92, vUv.x );
  float a = core * ( 0.25 + 0.75 * strands ) * ends * uAlpha * 0.8;
  gl_FragColor = vec4( mix( uColor, vec3( 1.0, 0.85, 0.8 ), strands * 0.2 ) * a, a );
}
`;

// ============================================================
// Budowa gwiazdy
// ============================================================
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const rand = (a, b) => a + Math.random() * (b - a);

function randomSurfaceDir(maxLat = 0.8) {
  const lat = Math.asin(rand(-maxLat, maxLat));
  const lon = rand(0, Math.PI * 2);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}

function prominenceGeometry() {
  // łuk między dwoma punktami powierzchni, lekko skręcony (plazma podąża za polem magnetycznym)
  const a = randomSurfaceDir(0.75);
  const axis = new THREE.Vector3().randomDirection().cross(a).normalize();
  const span = rand(0.06, 0.2);
  const b = a.clone().applyAxisAngle(axis, span);
  const h = rand(0.05, 0.2) * (0.6 + span * 3);
  const side = new THREE.Vector3().crossVectors(a, b).normalize();
  const twist = rand(-0.4, 0.4) * h;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    const base = new THREE.Vector3().copy(a).lerp(b, s).normalize();
    const lift = Math.sin(Math.PI * s);
    pts.push(base.multiplyScalar(0.985 + h * lift).addScaledVector(side, twist * Math.sin(Math.PI * 2 * s) * lift));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 48, rand(0.012, 0.024) * (0.7 + h * 3), 10, false);
  const mid = a.clone().add(b).normalize();
  return { geo, mid };
}

/**
 * @param {object} o
 * @param {number} o.radius       promień w jednostkach świata
 * @param {string|object} o.type  klucz STAR_TYPES albo własny obiekt parametrów
 * @param {number} [o.seed]
 * @param {number} [o.quality=1]  <1 = mniej protuberancji (np. telefony)
 * @returns {{ group, update(dt, camera), setTide(dirWorld, amount), flare(), get flareBoost() }}
 */
export function createStarVisual({ radius, type = 'yellowDwarf', seed = Math.random() * 100, quality = 1 }) {
  const T = typeof type === 'string' ? STAR_TYPES[type] : type;
  const group = new THREE.Group();
  group.scale.setScalar(radius);

  // --- fotosfera ---
  const photoMat = new THREE.ShaderMaterial({
    vertexShader: PHOTO_VERT,
    fragmentShader: PHOTO_FRAG,
    uniforms: {

      ...noiseUniforms(),      uTime: { value: rand(0, 100) }, uTemp: { value: T.colorTemp ?? T.temp }, uGran: { value: T.gran },
      uGranContrast: { value: T.granContrast }, uConv: { value: T.conv }, uPlasma: { value: T.plasma },
      uSpots: { value: T.spots }, uLimb: { value: T.limb }, uBright: { value: T.brightness },
      uRot: { value: T.rotation }, uSeed: { value: seed }, uSat: { value: T.sat ?? 1.4 },
      uFlare: { value: 0 }, uFlareDir: { value: new THREE.Vector3(1, 0, 0) },
      uTideDir: { value: new THREE.Vector3(1, 0, 0) }, uTide: { value: 0 },
    },
  });
  // pochodne ekranowe (fwidth) do antyaliasingu granulacji - w WebGL2 są w standardzie
  const photo = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), photoMat);
  group.add(photo);

  // --- korona ---
  const EXTENT = T.dust > 0 ? 3.4 : 2.8; // ile promieni sylwetki obejmuje billboard
  const coronaMat = new THREE.ShaderMaterial({
    vertexShader: CORONA_VERT,
    fragmentShader: CORONA_FRAG,
    uniforms: {

      ...noiseUniforms(),      uTime: { value: 0 }, uSize: { value: 1 }, uExtent: { value: EXTENT }, uCorona: { value: T.corona },
      uFall: { value: T.coronaFall }, uStreamers: { value: T.streamers }, uDust: { value: T.dust },
      uFlare: { value: 0 }, uSeed: { value: seed }, uTemp: { value: T.temp },
      uChromo: { value: new THREE.Color(T.promColor) },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMat);
  corona.frustumCulled = false;
  corona.renderOrder = 2;
  group.add(corona);

  // --- protuberancje ---
  const proms = [];
  const promCount = Math.round(T.promCount * quality);
  function spawnProm(p, initialAge = 0) {
    const { geo, mid } = prominenceGeometry();
    if (p.mesh) { p.mesh.geometry.dispose(); p.mesh.geometry = geo; } else {
      const mat = new THREE.ShaderMaterial({
        vertexShader: PROM_VERT, fragmentShader: PROM_FRAG,
        uniforms: {

      ...noiseUniforms(),          uTime: { value: 0 }, uAlpha: { value: 0 }, uLift: { value: 0 }, uErupt: { value: 0 },
          uMid: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(T.promColor) }, uSeed: { value: rand(0, 50) },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
      });
      p.mesh = new THREE.Mesh(geo, mat);
      p.mesh.frustumCulled = false;
      p.mesh.renderOrder = 3;
      group.add(p.mesh);
    }
    p.mesh.material.uniforms.uMid.value.copy(mid);
    p.age = initialAge;
    p.life = rand(14, 30);
    p.erupts = Math.random() < T.eruptChance;
  }
  for (let i = 0; i < promCount; i++) { const p = {}; spawnProm(p, rand(0, 20)); proms.push(p); }

  function updateProm(p, dt, time) {
    p.age += dt;
    const u = p.mesh.material.uniforms;
    u.uTime.value = time;
    const rise = Math.min(1, p.age / 4);
    const tail = p.age - (p.life - 5);            // ostatnie 5 s
    let alpha = rise, erupt = 0;
    if (tail > 0) {
      if (p.erupts) { erupt = (tail / 5) ** 1.6; alpha = 1 - tail / 5; } else alpha = 1 - tail / 5;
    }
    u.uLift.value = Math.sqrt(rise) * (1 + 0.06 * Math.sin(time * 0.7 + p.life));
    u.uErupt.value = erupt;
    u.uAlpha.value = Math.max(0, alpha) * (1 + flareLevel);
    if (p.age > p.life) spawnProm(p);
  }

  // --- rozbłyski ---
  let flareLevel = 0, flareT = -1, nextFlare = T.flareEvery ? rand(3, T.flareEvery) : Infinity;
  function flare() {
    flareT = 0;
    photoMat.uniforms.uFlareDir.value.copy(randomSurfaceDir(0.6));
  }

  let time = 0;
  const camPos = new THREE.Vector3(), center = new THREE.Vector3();
  function update(dt, camera) {
    time += dt;
    photoMat.uniforms.uTime.value += dt;
    coronaMat.uniforms.uTime.value = time;

    // rozbłysk: szybki wzrost (0,4 s), powolne gaśnięcie (~4 s)
    if (T.flareEvery) {
      nextFlare -= dt;
      if (nextFlare <= 0) { flare(); nextFlare = rand(0.5, 1.5) * T.flareEvery; }
    }
    if (flareT >= 0) {
      flareT += dt;
      flareLevel = flareT < 0.4 ? flareT / 0.4 : Math.exp(-(flareT - 0.4) / 1.4);
      if (flareT > 8) { flareT = -1; flareLevel = 0; }
    }
    photoMat.uniforms.uFlare.value = flareLevel;
    coronaMat.uniforms.uFlare.value = flareLevel;

    // rozmiar korony: sylwetka kuli widziana z bliska jest WIĘKSZA niż jej
    // promień (styczne z oka) - billboard w środku musi to uwzględnić
    if (camera) {
      camera.getWorldPosition(camPos);
      group.getWorldPosition(center);
      const d = Math.max(camPos.distanceTo(center), radius * 1.0005);
      const rs = d / Math.sqrt(d * d - radius * radius); // w promieniach gwiazdy
      coronaMat.uniforms.uSize.value = rs * EXTENT * radius;
    }
    for (const p of proms) updateProm(p, dt, time);
  }

  /** Deformacja pływowa w stronę punktu świata (np. towarzysza); amount w promieniach. */
  function setTide(targetWorld, amount) {
    group.getWorldPosition(center);
    _v.copy(targetWorld).sub(center).normalize();
    group.getWorldQuaternion(_q).invert();
    photoMat.uniforms.uTideDir.value.copy(_v.applyQuaternion(_q));
    photoMat.uniforms.uTide.value = amount;
  }

  function dispose() {
    photo.geometry.dispose(); photoMat.dispose();
    corona.geometry.dispose(); coronaMat.dispose();
    for (const p of proms) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
  }

  return {
    group, photo, update, setTide, flare, dispose, type: T,
    get flareBoost() { return flareLevel; },
  };
}

// ============================================================
// DYSK AKRECYJNY + STRUMIEŃ MATERII (układy z przepływem masy)
// ============================================================
const DISK_VERT = /* glsl */ `
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;
const DISK_FRAG = /* glsl */ `
uniform float uTime, uInner, uHotSpot;
varying vec2 vP;
${NOISE_GLSL}
void main() {
  float r = length( vP );               // 0..1 (1 = brzeg dysku)
  if ( r < uInner ) discard;
  float a = atan( vP.y, vP.x );
  // ROTACJA KEPLEROWSKA: omega ~ r^-1.5 -> wewnętrzne pasma wyprzedzają zewnętrzne,
  // turbulencje same rozciągają się w spiralne włókna
  float om = 1.6 * pow( r, -1.5 );
  float ang = a + uTime * om;
  vec2 c = vec2( cos( ang ), sin( ang ) );
  float n = fbm( vec3( c * 2.0, log( r ) * 7.0 ) );
  float n2 = fbm( vec3( c * 6.0, log( r ) * 20.0 + 3.0 ) );
  float fil = smoothstep( 0.3, 0.85, n * 0.6 + n2 * 0.55 );
  // temperatura rośnie ku środkowi (T ~ r^-3/4): biało-niebieski rdzeń, czerwony brzeg
  float temp = 4200.0 * pow( r, -0.75 );
  vec3 col = blackbody( temp ) * ( 0.35 + 1.3 * fil ) * ( 1.2 * pow( r, -0.8 ) );
  // GORĄCA PLAMA: tam, gdzie strumień z olbrzyma uderza w brzeg dysku
  float hs = exp( -pow( ( r - 0.95 ) / 0.07, 2.0 ) ) * exp( -pow( sin( ( a - uHotSpot ) * 0.5 ), 2.0 ) / 0.02 );
  col += vec3( 1.0, 0.9, 0.75 ) * hs * 2.2;
  float alpha = smoothstep( uInner, uInner + 0.06, r ) * smoothstep( 1.0, 0.8, r ) * ( 0.4 + 0.6 * fil );
  gl_FragColor = vec4( col * alpha, alpha );
}
`;

/**
 * Dysk akrecyjny wokół zwartej gwiazdy i strumień materii z towarzysza,
 * który przelał się przez swoją powierzchnię Roche'a. Grupa leży w środku
 * zwartej gwiazdy; update() obraca ją tak, żeby strumień zawsze celował
 * w dawcę (w układzie współobrotowym kształt strumienia się nie zmienia).
 */
export function createAccretionFlow({ diskRadius, innerFraction = 0.12, streamLength, color = 0xff8a4a }) {
  const group = new THREE.Group();
  const diskMat = new THREE.ShaderMaterial({
    vertexShader: DISK_VERT, fragmentShader: DISK_FRAG,
    uniforms: { ...noiseUniforms(), uTime: { value: 0 }, uInner: { value: innerFraction }, uHotSpot: { value: 0.35 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 128), diskMat);
  disk.rotation.x = -Math.PI / 2;  // w płaszczyźnie orbity (XZ)
  disk.scale.setScalar(diskRadius);
  disk.frustumCulled = false;
  group.add(disk);

  // strumień: od punktu L1 (lokalnie +X) zakrzywiony siłą Coriolisa do brzegu dysku
  const pts = [];
  const L = streamLength;
  for (let i = 0; i <= 24; i++) {
    const s = i / 24;
    const x = L * (1 - s) + diskRadius * 0.9 * Math.cos(0.35 + s * 1.4) * s;
    const z = -Math.sin(s * Math.PI * 0.9) * L * 0.18 - diskRadius * 0.9 * Math.sin(0.35 + s * 1.4) * s * 0.9;
    pts.push(new THREE.Vector3(x, 0, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const streamGeo = new THREE.TubeGeometry(curve, 96, diskRadius * 0.05, 10, false);
  // skala: rurka zbudowana w jednostkach świata; ten sam shader co protuberancje, bez podnoszenia
  const streamMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4( position, 1.0 ); vN = normalize( normalMatrix * normal ); vV = normalize( -mv.xyz ); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: PROM_FRAG,
    uniforms: { ...noiseUniforms(), uTime: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: 3 }, uColor: { value: new THREE.Color(color) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
  const stream = new THREE.Mesh(streamGeo, streamMat);
  stream.frustumCulled = false;
  group.add(stream);

  let time = 0;
  const _to = new THREE.Vector3();
  function update(dt, compactPos, donorPos) {
    time += dt;
    diskMat.uniforms.uTime.value = time;
    streamMat.uniforms.uTime.value = time * 1.5;
    group.position.copy(compactPos);
    _to.copy(donorPos).sub(compactPos);
    group.rotation.set(0, Math.atan2(-_to.z, _to.x), 0); // +X lokalnie -> w stronę dawcy (orbita w XZ)
  }
  function dispose() { disk.geometry.dispose(); diskMat.dispose(); streamGeo.dispose(); streamMat.dispose(); }
  return { group, update, dispose };
}
