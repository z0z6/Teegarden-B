import * as THREE from 'three';
import { RACES } from '../data/races.js';

/**
 * NAPĘD FAŁDOWY - efekt skoku ("warp") dla KAŻDEGO statku: gracza (4 modele)
 * i NPC (wejście do sceny, odlot, skok razem z graczem).
 *
 * POMYSŁ: zamiast klasycznych "gwiazd rozciągniętych w kreski" statek NIE
 * przyspiesza w pustce - on WCHODZI W FAŁDĘ. Przed dziobem otwiera się
 * pierścień (fałda) i statek dosłownie "wsuwa się" w płaszczyznę pierścienia:
 * wszystko, co przeszło za płaszczyznę, znika, a linia cięcia żarzy się na
 * kadłubie. Po drugiej stronie fałda wypluwa statek, zatrzaskuje się i
 * zostawia za sobą świecący SZEW (ścieg), który zaszywa się od początku.
 *
 * Pięć warstw, każda tania i niezależna:
 *   1. KADŁUB  - patch shadera materiałów statku (onBeforeCompile): rozciąganie
 *                wzdłuż osi lotu (dziób bardziej niż rufa - "spaghettyfikacja"),
 *                ściśnięcie w poprzek, pasma interferencji wędrujące od rufy do
 *                dziobu, żar krawędzi (Fresnel) i przycinanie płaszczyzną fałdy.
 *   2. FAŁDA   - płaski pierścień (shader) z SYGNATURĄ RASY (niżej).
 *   3. ECHO    - fala uderzeniowa w płaszczyźnie fałdy + błysk + chwilowe
 *                światło (pula stałych świateł - zero rekompilacji shaderów).
 *   4. SZEW    - ścieg po przejściu, zaszywa się od punktu startu do fałdy.
 *   5. (gracz) - relatywistyczna ABERRACJA gwiazd tła (patrz space-background.js):
 *                przy prędkości ~c gwiazdy zbiegają się przed dziobem w jasny
 *                pęk (przesunięcie ku fioletowi), za rufą rzedną i czerwienieją.
 *                To prawdziwa fizyka (wzór aberracji + czynnik Dopplera), nie
 *                tekstura. Do tego tunel smug, kick FOV i sprężyste "odbicie"
 *                nieba przy wyjściu (chwilowo ujemne beta).
 *
 * Wszystkie efekty żyją w czasie SYMULACJI (update(dt)), jak reżyser scen -
 * działają tak samo przy 10 i 60 fps i można je przewijać w testach.
 */

// ============================================================
// SYGNATURY RAS - każda rasa "szyje" przestrzeń inaczej.
// Kolor krawędzi = kolor rasy z races.js; tu tylko parametry kształtu.
//   petals  płatki/fala stojąca na obwodzie (0 = gładki okrąg)
//   segs    przerwy w pierścieniu (0 = ciągły); hard=1 -> wielokąt o `segs` bokach
//   noise   organiczna, żywa deformacja obwodu
//   chroma  rozszczepienie pryzmatyczne (RGB na różnych promieniach)
//   fringe  prążki interferencyjne na zewnątrz pierścienia
//   twist   skręt spirali we wnętrzu fałdy
//   band    gęstość pasm interferencji na kadłubie
// ============================================================
export const WARP_SIGNATURES = {
  wybudzeni:  { name: 'Pieczęć spisu',   core: '#fff3d6', petals: 0,  segs: 16, hard: 0, noise: 0.05, chroma: 0,   fringe: 0.15, twist: 0.25, band: 18 },
  rezonanci:  { name: 'Okno rezonansu',  core: '#eaf8ff', petals: 0,  segs: 0,  hard: 0, noise: 0,    chroma: 0,   fringe: 1.0,  twist: 0.5,  band: 26 },
  piesniarze: { name: 'Harmoniczna',     core: '#f4ecff', petals: 7,  segs: 0,  hard: 0, noise: 0,    chroma: 0.25, fringe: 0.45, twist: 1.0, band: 14 },
  szczepieni: { name: 'Szczep',          core: '#efffe3', petals: 0,  segs: 0,  hard: 0, noise: 1.0,  chroma: 0,   fringe: 0.1,  twist: 0.8,  band: 10 },
  wykonawcy:  { name: 'Klauzula',        core: '#ffffff', petals: 0,  segs: 6,  hard: 1, noise: 0,    chroma: 0,   fringe: 0.3,  twist: 0.0,  band: 30 },
  heliotropi: { name: 'Korona',          core: '#fff0c8', petals: 13, segs: 0,  hard: 0, noise: 0.6,  chroma: 0,   fringe: 0.2,  twist: 0.4,  band: 12 },
  swietlisci: { name: 'Pryzmat',         core: '#ffffff', petals: 0,  segs: 0,  hard: 0, noise: 0,    chroma: 1.0, fringe: 0.5,  twist: 0.6,  band: 20 },
};

/** Pełna sygnatura rasy (z kolorami THREE.Color). Nieznana rasa -> Wybudzeni. */
export function warpSignature(raceId) {
  const id = WARP_SIGNATURES[raceId] ? raceId : 'wybudzeni';
  const s = WARP_SIGNATURES[id];
  return { ...s, raceId: id, edge: new THREE.Color(RACES[id]?.color ?? '#9fd8ff'), coreColor: new THREE.Color(s.core) };
}

// ------------------------------------------------------------
// Małe narzędzia
// ------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeIn = (t) => t * t;
const easeOut = (t) => 1 - (1 - t) * (1 - t);
const smooth = (t) => t * t * (3 - 2 * t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const Z_POS = new THREE.Vector3(0, 0, 1);
const Z_NEG = new THREE.Vector3(0, 0, -1);
const Y_POS = new THREE.Vector3(0, 1, 0);

let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 1, 64, 64, 63);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

// ============================================================
// 1. KADŁUB - patch materiałów statku
// ============================================================
// Liczymy w PRZESTRZENI ŚWIATA (modelMatrix * pozycja), bo modele glTF
// mają dowolną hierarchię węzłów (Kharath ma kwantyzację pozycji i skalę w
// węźle) - oś lotu statku w świecie jest za to zawsze ta sama dla całego
// kadłuba. Gdy efekt jest wyłączony (uWStretch + uWGlow == 0), idziemy
// ORYGINALNĄ ścieżką modelViewMatrix, więc statek w spoczynku renderuje się
// bit w bit jak wcześniej (i bez utraty precyzji float32 na dużych
// współrzędnych - statek lata ~50 tys. j. od środka układu).
const HULL_VERT_PARS = /* glsl */ `
uniform vec3 uWOrigin;
uniform vec3 uWDir;
uniform float uWHalf;
uniform float uWStretch;
uniform float uWReach;
uniform float uWGlow;
uniform float uWTime;
varying float vWU;
varying vec3 vWW;
`;

const HULL_PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 wwPos = modelMatrix * mvPosition;
vec3 wRel = wwPos.xyz - uWOrigin;
float wS = dot( wRel, uWDir );
vWU = wS / max( uWHalf, 1e-3 );
if ( uWStretch + uWGlow > 0.0 ) {
  vec3 wLat = wRel - uWDir * wS;
  float wK = clamp( vWU * 0.5 + 0.5, 0.0, 1.0 );         // 0 rufa .. 1 dziób
  wLat *= max( 0.04, 1.0 - uWStretch * ( 0.3 + 0.62 * wK ) ); // ściśnięcie w igłę ku dziobowi
  wLat *= 1.0 + uWGlow * 0.035 * sin( vWU * 9.0 - uWTime * 22.0 ); // drżenie kadłuba
  float wPull = uWStretch * uWReach * ( 0.08 + wK * wK * 1.4 ); // dziób wyciągany mocniej niż rufa
  wwPos.xyz = uWOrigin + uWDir * ( wS + wPull ) + wLat;
  mvPosition = viewMatrix * wwPos;
} else {
  mvPosition = modelViewMatrix * mvPosition;
}
vWW = wwPos.xyz;
gl_Position = projectionMatrix * mvPosition;
`;

const HULL_FRAG_PARS = /* glsl */ `
uniform vec3 uWDir;
uniform vec3 uWGate;
uniform vec3 uWCore;
uniform vec3 uWEdge;
uniform float uWHalf;
uniform float uWStretch;
uniform float uWGlow;
uniform float uWTime;
uniform float uWGateSide;
uniform float uWBand;
varying float vWU;
varying vec3 vWW;
`;

// Po stronie "za płaszczyzną fałdy" fragmenty znikają (+1: znika to, co
// przeszło dalej; -1: znika to, co jeszcze nie wyszło). 0 = brak cięcia.
const HULL_CLIP = /* glsl */ `
float wGateD = dot( vWW - uWGate, uWDir );
if ( uWGateSide * wGateD > 0.0 ) discard;
`;

const HULL_EMISSIVE = /* glsl */ `
if ( uWGlow + uWStretch > 0.0 ) {
  vec3 wV = normalize( vViewPosition );
  float wRim = pow( 1.0 - abs( dot( normal, wV ) ), 2.2 );
  // pasma interferencji: wędrują od rufy ku dziobowi
  float wBand = pow( 0.5 + 0.5 * sin( vWU * uWBand - uWTime * 10.0 ), 8.0 );
  vec3 wHot = mix( uWEdge, uWCore, clamp( uWStretch * 1.3, 0.0, 1.0 ) );
  diffuseColor.rgb *= 1.0 - 0.6 * clamp( uWStretch, 0.0, 1.0 );
  totalEmissiveRadiance += uWEdge * ( wRim * 2.2 + wBand * 1.3 ) * uWGlow + wHot * uWStretch * 3.0;
  if ( uWGateSide != 0.0 ) {
    // żarząca się linia cięcia tam, gdzie kadłub przechodzi przez fałdę
    totalEmissiveRadiance += uWCore * 7.0 * exp( -abs( wGateD ) / ( uWHalf * 0.07 ) );
  }
}
`;

function patchHullMaterial(src, U) {
  const m = src.clone();
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${HULL_VERT_PARS}`)
      .replace('#include <project_vertex>', HULL_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${HULL_FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${HULL_CLIP}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${HULL_EMISSIVE}`);
  };
  // wszystkie statki dzielą ten sam program GPU (inne są tylko wartości uniformów)
  m.customProgramCacheKey = () => 'warp-hull-v1';
  return m;
}

// ============================================================
// 2. FAŁDA - pierścień z sygnaturą rasy
// ============================================================
const PLANE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const GATE_FRAG = /* glsl */ `
uniform float uOpen, uTime, uAlpha, uPetals, uSegs, uHard, uNoise, uChroma, uFringe, uTwist;
uniform vec3 uCore, uEdge;
varying vec2 vUv;
float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float n21( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h21( i ), h21( i + vec2( 1, 0 ) ), f.x ), mix( h21( i + vec2( 0, 1 ) ), h21( i + vec2( 1, 1 ) ), f.x ), f.y );
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length( p );
  float a = atan( p.y, p.x );
  // Klauzula (Wykonawcy): wielokąt zamiast okręgu
  if ( uHard > 0.0 && uSegs > 2.0 ) {
    float seg = 6.2831853 / uSegs;
    float rh = r * cos( mod( a, seg ) - 0.5 * seg ) / cos( 0.5 * seg );
    r = mix( r, rh, uHard );
  }
  float R = 0.55 * uOpen;
  float wob = 0.0;
  if ( uPetals > 0.0 ) wob += 0.035 * sin( a * uPetals + uTime * 2.5 );                   // fala stojąca
  wob += uNoise * 0.12 * ( n21( vec2( cos( a ), sin( a ) ) * 3.0 + uTime * 0.9 ) - 0.5 ); // żywy brzeg
  float rr = R * ( 1.0 + wob );
  float d = r - rr;
  float w = 0.006 + 0.012 * uOpen;
  float cs = uChroma * 0.03;
  vec3 ring = vec3(
    exp( -pow( ( d - cs ) / w, 2.0 ) ),
    exp( -pow( d / w, 2.0 ) ),
    exp( -pow( ( d + cs ) / w, 2.0 ) ) );
  if ( uSegs > 0.0 ) {
    float f = fract( a / 6.2831853 * uSegs + uTime * 0.05 * ( 1.0 - uHard ) );
    ring *= smoothstep( 0.04, 0.1, f ) * smoothstep( 0.96, 0.9, f );
  }
  float halo = exp( -abs( d ) * ( 7.0 + 10.0 * ( 1.0 - uOpen ) ) );
  float fr = uFringe * pow( 0.5 + 0.5 * cos( d * 70.0 - uTime * 9.0 ), 6.0 ) * exp( -max( d, 0.0 ) * 5.0 ) * step( 0.0, d ) * uOpen;
  float inside = 1.0 - smoothstep( rr - 0.03, rr + 0.005, r );
  float q = clamp( r / max( rr, 1e-3 ), 0.0, 1.0 );
  float spiral = 0.5 + 0.5 * sin( a * 3.0 + log( max( q, 1e-3 ) ) * ( 2.0 + uTwist * 8.0 ) + uTime * 5.0 );
  vec2 cell = p * 70.0 + vec2( 0.0, uTime * 6.0 );
  float sparkle = step( 0.992, h21( floor( cell ) ) ) * smoothstep( 0.4, 0.0, length( fract( cell ) - 0.5 ) ) * q;
  vec3 interior = uEdge * 0.28 * spiral * pow( q, 2.5 ) + uCore * 0.7 * pow( q, 12.0 ) + uCore * sparkle * 0.8;
  vec3 col = interior * inside + mix( uEdge, uCore, 0.55 ) * ring * 2.2 + uEdge * halo * 0.55 + uEdge * fr * 0.9;
  float alpha = clamp( inside * 0.93 + max( max( ring.r, ring.g ), ring.b ) + halo * 0.6 + fr, 0.0, 1.0 );
  alpha *= smoothstep( 1.0, 0.75, length( p ) ) * uAlpha;
  gl_FragColor = vec4( col, alpha );
}
`;

// ============================================================
// 3. ECHO - fala uderzeniowa w płaszczyźnie fałdy
// ============================================================
const SHOCK_FRAG = /* glsl */ `
uniform float uT;
uniform vec3 uCore, uEdge;
varying vec2 vUv;
void main() {
  float r = length( vUv * 2.0 - 1.0 );
  float w = 0.015 + 0.09 * uT;
  float d = r - uT;
  float ring = exp( -d * d / ( w * w ) );
  float trail = exp( -max( -d, 0.0 ) * 14.0 ) * step( d, 0.0 ) * 0.35;
  vec3 col = mix( uCore, uEdge, uT ) * ( ring * 1.8 + trail );
  gl_FragColor = vec4( col, ( ring + trail ) * ( 1.0 - uT ) );
}
`;

// ============================================================
// 4. SZEW - ścieg zaszywający się po przejściu statku
// ============================================================
const SCAR_FRAG = /* glsl */ `
uniform float uLife, uTime, uStitches;
uniform vec3 uCore, uEdge;
varying vec2 vUv;
void main() {
  float y = vUv.y;                                         // 0 = start, 1 = fałda
  float vis = smoothstep( uLife - 0.03, uLife + 0.03, y );  // zaszywa się od startu
  float st = abs( fract( y * uStitches - uTime * 1.5 ) - 0.5 ) * 2.0;
  float stitch = smoothstep( 0.45, 0.75, st );
  float head = exp( -abs( y - uLife ) * 40.0 );             // jasny "igłowy" punkt szycia
  vec3 col = mix( uEdge, uCore, stitch ) * ( 0.5 + stitch ) + uCore * head * 3.0;
  float a = vis * pow( 1.0 - uLife, 0.6 ) * ( 0.35 + 0.65 * stitch ) + head * ( 1.0 - uLife );
  gl_FragColor = vec4( col, a );
}
`;

// ============================================================
// 5. TUNEL - smugi wokół kamery gracza podczas przelotu przez fałdę
// ============================================================
const TUNNEL_VERT = /* glsl */ `
attribute vec4 aStreak;   // kąt, promień (0..1), faza, prędkość (0..1)
attribute vec2 aCorner;   // x: -1/+1 w poprzek, y: 0 ogon .. 1 głowa
uniform float uTime, uScale, uSpan, uIntensity;
varying float vFade, vAlong, vHue;
void main() {
  float ang = aStreak.x;
  float rad = mix( 0.7, 2.8, aStreak.y ) * uScale;
  float span = uSpan * uScale;
  float z = mod( aStreak.z * span + uTime * span * ( 0.9 + aStreak.w * 1.6 ), span ) - span * 0.7;
  float len = span * ( 0.05 + 0.14 * aStreak.w ) * ( 0.3 + 0.7 * uIntensity );
  vec3 radial = vec3( cos( ang ), sin( ang ), 0.0 );
  vec3 tang = vec3( -sin( ang ), cos( ang ), 0.0 );
  float width = uScale * 0.008 * ( 0.5 + aStreak.y );
  vec3 p = radial * rad + tang * aCorner.x * width + vec3( 0.0, 0.0, z - aCorner.y * len );
  vFade = ( 1.0 - smoothstep( 0.15 * span, 0.3 * span, z ) ) * smoothstep( -0.7 * span, -0.45 * span, z );
  vAlong = aCorner.y;
  vHue = aStreak.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}
`;

const TUNNEL_FRAG = /* glsl */ `
uniform float uIntensity;
uniform vec3 uCore, uEdge;
varying float vFade, vAlong, vHue;
void main() {
  // głównie kolor rasy; tylko sama "głowa" smugi rozjaśnia się ku bieli
  vec3 col = mix( uEdge, uCore, pow( vAlong, 4.0 ) * 0.6 ) * ( 0.9 + 0.3 * vHue );
  gl_FragColor = vec4( col, vFade * uIntensity * 0.75 * ( 0.1 + 0.9 * vAlong * vAlong ) );
}
`;

function createTunnel(count = 260) {
  const pos = new Float32Array(count * 4 * 3); // atrapa - pozycję liczy vertex shader
  const streak = new Float32Array(count * 4 * 4);
  const corner = new Float32Array(count * 4 * 2);
  const index = [];
  const CORNERS = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
  for (let i = 0; i < count; i++) {
    const s = [Math.random() * Math.PI * 2, Math.random(), Math.random(), Math.random()];
    for (let c = 0; c < 4; c++) {
      streak.set(s, (i * 4 + c) * 4);
      corner.set(CORNERS[c], (i * 4 + c) * 2);
    }
    const b = i * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aStreak', new THREE.BufferAttribute(streak, 4));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setIndex(index);
  const mat = new THREE.ShaderMaterial({
    vertexShader: TUNNEL_VERT,
    fragmentShader: TUNNEL_FRAG,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 40 }, uSpan: { value: 14 }, uIntensity: { value: 0 },
      uCore: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 5;
  return mesh;
}

// ============================================================
// MENEDŻER NAPĘDU
// ============================================================
/**
 * @param {THREE.Scene} scene
 * @returns menedżer: createHandle / bindModel / warpIn / warpOut / cancel / update
 *          + prymitywy efektów (openGate, shock, flash, scar) używane przez
 *          sterownik skoku gracza (createPlayerWarp).
 */
/**
 * @param {THREE.Scene} scene
 * @param {object} [o]
 * @param {(position: THREE.Vector3, sig: object) => void} [o.onSlam]  krok 9: zatrzaśnięcie
 *   fałdy (dowolny statek) - warstwa audio gra wtedy "tąpnięcie" z odległości
 */
export function createWarpDrive(scene, { onSlam = null } = {}) {
  const handles = new Set();
  const effects = [];       // krótkie efekty (echo, błysk, szew, zamykanie fałdy)
  let time = 0;

  const planeGeo = new THREE.PlaneGeometry(2, 2);
  const scarGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  scarGeo.translate(0, 0.5, 0); // oś od 0 do 1 wzdłuż +Y (łatwe skalowanie od punktu startu)

  // Pula świateł o STAŁEJ liczbie - dodawanie/usuwanie świateł w trakcie gry
  // wymusza w three.js rekompilację shaderów wszystkich oświetlonych
  // materiałów (klatka "przycięcia" dokładnie w momencie efektu). Światła są
  // zawsze w scenie, a nieużywane mają natężenie 0.
  const lightPool = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 1, 2);
    l.userData.busy = false;
    scene.add(l);
    lightPool.push(l);
  }
  function takeLight() {
    const l = lightPool.find((x) => !x.userData.busy) ?? lightPool[0];
    l.userData.busy = true;
    return l;
  }
  function releaseLight(l) { if (!l) return; l.intensity = 0; l.userData.busy = false; }

  // ---------------- uchwyt statku ----------------
  /**
   * Uchwyt = stan efektu jednego statku. Grupę `group` porusza gra; tutaj
   * tylko ją czytamy (chyba że trwa sekwencja warpIn/warpOut - wtedy
   * napęd sam przesuwa grupę, a AI/fizyka ma ją zostawić w spokoju).
   */
  function createHandle(group, raceId) {
    const sig = warpSignature(raceId);
    const U = {
      uWOrigin: { value: new THREE.Vector3() },
      uWDir: { value: new THREE.Vector3(0, 0, -1) },
      uWHalf: { value: 10 },
      uWStretch: { value: 0 },
      uWReach: { value: 30 },
      uWGlow: { value: 0 },
      uWTime: { value: 0 },
      uWGate: { value: new THREE.Vector3() },
      uWGateSide: { value: 0 },
      uWCore: { value: sig.coreColor.clone() },
      uWEdge: { value: sig.edge.clone() },
      uWBand: { value: sig.band },
    };
    const h = {
      group, sig, U,
      ready: false,
      centerLocal: new THREE.Vector3(),
      halfLen: 10, gateR: 12, radius: 12,
      seq: null,
    };
    handles.add(h);
    return h;
  }

  function setRace(h, raceId) {
    h.sig = warpSignature(raceId);
    h.U.uWCore.value.copy(h.sig.coreColor);
    h.U.uWEdge.value.copy(h.sig.edge);
    h.U.uWBand.value = h.sig.band;
  }

  /**
   * Podpina model (już dodany do `h.group`) - klonuje jego materiały i
   * dokłada patch fałdy. Klon jest konieczny: NPC-e współdzielą materiały
   * (model z cache + clone(true)), a każdy statek ma mieć własne uniformy.
   * @param {THREE.Vector3} size bounding box modelu (lokalnie)
   */
  function bindModel(h, model, size) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => patchHullMaterial(m, h.U))
        : patchHullMaterial(o.material, h.U);
    });
    h.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    h.centerLocal.copy(h.group.worldToLocal(box.getCenter(new THREE.Vector3())));
    h.halfLen = Math.max(size.z, 4) / 2;
    h.radius = size.length() * 0.3;
    // pierścień musi objąć przekrój statku z zapasem (Kharath ma długie ramiona)
    h.gateR = Math.max(size.x, size.y) * 0.85 + 4;
    h.U.uWHalf.value = h.halfLen;
    h.U.uWReach.value = h.halfLen * 3;
    h.ready = true;
  }

  function unbind(h) { h.ready = false; }

  const _q = new THREE.Quaternion();
  function forwardOf(h, out) { return out.copy(Z_NEG).applyQuaternion(h.group.getWorldQuaternion(_q)).normalize(); }
  function centerOf(h, out) { return h.group.localToWorld(out.copy(h.centerLocal)); }

  function resetHull(h) {
    h.U.uWStretch.value = 0;
    h.U.uWGlow.value = 0;
    h.U.uWGateSide.value = 0;
  }

  // ---------------- prymitywy efektów ----------------
  /** Otwiera fałdę (pierścień). Stopień otwarcia steruje wołający: gate.open = 0..1. */
  function openGate(position, dir, radius, sig) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERT, fragmentShader: GATE_FRAG,
      uniforms: {
        uOpen: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 1 },
        uPetals: { value: sig.petals }, uSegs: { value: sig.segs }, uHard: { value: sig.hard },
        uNoise: { value: sig.noise }, uChroma: { value: sig.chroma }, uFringe: { value: sig.fringe },
        uTwist: { value: sig.twist },
        uCore: { value: sig.coreColor.clone() }, uEdge: { value: sig.edge.clone() },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    scene.add(mesh);
    const light = takeLight();
    light.color.copy(sig.edge);
    const gate = {
      mesh, mat, light, radius, sig,
      position: mesh.position,
      dir: new THREE.Vector3(),
      open: 0,
      closing: false,
      place(pos, d) {
        mesh.position.copy(pos);
        this.dir.copy(d);
        mesh.quaternion.setFromUnitVectors(Z_POS, d);
        light.position.copy(pos);
      },
      sync() {
        mat.uniforms.uOpen.value = Math.max(this.open, 0.001);
        mat.uniforms.uTime.value = time;
        mesh.scale.setScalar(radius / 0.55);
        // światło fałdy doświetla kadłub w kolorze rasy, gdy statek się zbliża
        light.distance = radius * 14;
        light.intensity = 900 * (radius / 12) ** 2 * this.open;
      },
      /** zatrzaśnięcie: pierścień zapada się do punktu z błyskiem */
      collapse(duration = 0.28) {
        if (this.closing) return;
        this.closing = true;
        const start = this.open;
        effects.push({
          age: 0, duration,
          step: (k) => { this.open = start * (1 - easeIn(k)); mat.uniforms.uAlpha.value = 1 - k * 0.3; this.sync(); },
          done: () => this.dispose(),
        });
      },
      dispose() {
        if (!mesh.parent) return;
        scene.remove(mesh);
        mat.dispose();
        releaseLight(light);
      },
    };
    gate.place(position, dir);
    gate.sync();
    return gate;
  }

  function shock(position, dir, radius, sig, duration = 0.9) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERT, fragmentShader: SHOCK_FRAG,
      uniforms: { uT: { value: 0 }, uCore: { value: sig.coreColor.clone() }, uEdge: { value: sig.edge.clone() } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.copy(position);
    mesh.quaternion.setFromUnitVectors(Z_POS, dir);
    mesh.scale.setScalar(radius * 4);
    mesh.frustumCulled = false;
    scene.add(mesh);
    effects.push({
      age: 0, duration,
      step: (k) => { mat.uniforms.uT.value = easeOut(k); },
      done: () => { scene.remove(mesh); mat.dispose(); },
    });
  }

  function flash(position, size, color, duration = 0.45) {
    const mat = new THREE.SpriteMaterial({
      map: getGlowTexture(), color, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.frustumCulled = false;
    sprite.renderOrder = 6;
    scene.add(sprite);
    const light = takeLight();
    light.color.copy(color);
    light.position.copy(position);
    light.distance = size * 8;
    effects.push({
      age: 0, duration,
      step: (k) => {
        sprite.scale.setScalar(size * (0.6 + 1.6 * easeOut(k)));
        mat.opacity = (1 - k) ** 1.5;
        light.intensity = 2500 * (size / 30) ** 2 * (1 - k) ** 2;
      },
      done: () => { scene.remove(sprite); mat.dispose(); releaseLight(light); },
    });
  }

  function scar(from, to, width, sig, duration = 3.2) {
    const len = from.distanceTo(to);
    if (len < 1) return;
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERT, fragmentShader: SCAR_FRAG,
      uniforms: {
        uLife: { value: 0 }, uTime: { value: 0 }, uStitches: { value: Math.max(6, Math.round(len / (width * 14))) },
        uCore: { value: sig.coreColor.clone() }, uEdge: { value: sig.edge.clone() },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(scarGeo, mat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(Y_POS, to.clone().sub(from).normalize());
    mesh.scale.set(width, len, width);
    mesh.frustumCulled = false;
    scene.add(mesh);
    effects.push({
      age: 0, duration,
      step: (k) => { mat.uniforms.uLife.value = smooth(k); mat.uniforms.uTime.value = time; },
      done: () => { scene.remove(mesh); mat.dispose(); },
    });
  }

  /** Pełne "zatrzaśnięcie" fałdy: zapadnięcie + echo + błysk (+ opcjonalny szew). */
  function slam(gate, { scarFrom = null } = {}) {
    const p = gate.position.clone();
    onSlam?.(p, gate.sig);
    shock(p, gate.dir, gate.radius, gate.sig);
    flash(p, gate.radius * 2.2, gate.sig.coreColor);
    if (scarFrom) scar(scarFrom, p, Math.max(0.6, gate.radius * 0.05), gate.sig);
    gate.collapse();
  }

  // ---------------- sekwencje NPC ----------------
  const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _p = new THREE.Vector3();

  /**
   * WEJŚCIE: statek pojawia się na aktualnej pozycji/orientacji grupy -
   * fałda otwiera się za jego rufą i "wypluwa" go (rozciągniętego) do przodu.
   * Czeka na model (NPC ładują .glb asynchronicznie), ale najwyżej 4 s.
   */
  function warpIn(h, { onDone } = {}) {
    cancel(h);
    const dir = forwardOf(h, new THREE.Vector3());
    const rest = h.group.position.clone();
    h.seq = { kind: 'in', t: 0, phase: 'open', dir, rest, gate: null, onDone, shocked: false };
    h.group.visible = true;
    // ukryj statek od razu (przed pierwszą klatką), zanim fałda się otworzy
    h.U.uWGateSide.value = -1;
    h.U.uWGate.value.copy(rest).addScaledVector(dir, 1e5);
  }

  /**
   * WYJŚCIE: rozbieg, otwarcie fałdy przed dziobem, wślizg z rozciągnięciem, zatrzaśnięcie.
   * `alignTo` (kwaternion): w trakcie rozbiegu statek obraca się na ten kurs -
   * eskorta skacząca z graczem wchodzi w fałdę równolegle do niego, a nie
   * w kierunku, w którym akurat leciała (np. pod prąd, dolatując do szyku).
   */
  function warpOut(h, { speed = 80, onDone, alignTo = null } = {}) {
    cancel(h);
    h.seq = {
      kind: 'out', t: 0, phase: 'charge', dir: forwardOf(h, new THREE.Vector3()), speed: Math.max(speed, 60),
      gate: null, onDone, start: null, alignTo: alignTo ? alignTo.clone() : null,
    };
  }

  function cancel(h) {
    const s = h.seq;
    if (!s) return;
    s.gate?.dispose();
    h.seq = null;
    resetHull(h);
  }

  function release(h) { cancel(h); handles.delete(h); }

  const IN_OPEN = 0.75, IN_EMERGE = 0.8, IN_SETTLE = 0.9;
  const OUT_CHARGE = 1.0, OUT_DIVE = 0.55;

  function stepIn(h, s, dt) {
    s.t += dt;
    const back = h.halfLen * 1.3;
    const gatePos = _p.copy(s.rest).addScaledVector(s.dir, -back);
    if (!s.gate) {
      s.gate = openGate(gatePos, s.dir, h.gateR, h.sig);
      flash(gatePos, h.gateR * 1.2, h.sig.edge, 0.5);
    }
    h.U.uWGate.value.copy(gatePos);
    h.U.uWGateSide.value = -1;
    const startPos = _c.copy(gatePos).addScaledVector(s.dir, -h.halfLen * 1.6);

    if (s.phase === 'open') {
      s.gate.open = easeOut(clamp01(s.t / IN_OPEN));
      h.group.position.copy(startPos);
      h.U.uWGlow.value = 1;
      h.U.uWStretch.value = 0.8;
      if (s.t >= IN_OPEN && (h.ready || s.t > 4)) { s.phase = 'emerge'; s.t = 0; }
    } else if (s.phase === 'emerge') {
      const k = clamp01(s.t / IN_EMERGE);
      if (!s.shocked) { s.shocked = true; shock(gatePos, s.dir, h.gateR, h.sig); }
      h.group.position.lerpVectors(startPos, s.rest, easeOut(k));
      h.U.uWStretch.value = 0.8 * (1 - smooth(k));
      h.U.uWGlow.value = 1;
      if (k >= 1) { s.phase = 'settle'; s.t = 0; slam(s.gate); s.gate = null; }
    } else {
      const k = clamp01(s.t / IN_SETTLE);
      h.group.position.copy(s.rest);
      h.U.uWGateSide.value = 0;
      h.U.uWStretch.value = 0;
      h.U.uWGlow.value = 1 - k;
      if (k >= 1) { h.seq = null; resetHull(h); s.onDone?.(); }
    }
    s.gate?.sync();
  }

  function stepOut(h, s, dt) {
    s.t += dt;
    const lead = h.halfLen * 2.2 + h.gateR * 0.3;
    if (s.phase === 'charge') {
      const k = clamp01(s.t / OUT_CHARGE);
      if (s.alignTo) {
        h.group.quaternion.rotateTowards(s.alignTo, 3.2 * dt);
        forwardOf(h, s.dir);
      }
      h.group.position.addScaledVector(s.dir, s.speed * dt);
      const gatePos = centerOf(h, _p).addScaledVector(s.dir, lead);
      if (!s.gate) s.gate = openGate(gatePos, s.dir, h.gateR, h.sig);
      s.gate.place(gatePos, s.dir);
      s.gate.open = easeOut(k);
      h.U.uWGlow.value = easeIn(k);
      h.U.uWStretch.value = 0.06 * k;
      if (k >= 1) { s.phase = 'dive'; s.t = 0; s.start = h.group.position.clone(); }
    } else {
      const k = clamp01(s.t / OUT_DIVE);
      h.group.position.copy(s.start).addScaledVector(s.dir, (lead + h.halfLen * 2.6) * easeIn(k) + s.speed * s.t);
      h.U.uWGate.value.copy(s.gate.position);
      h.U.uWGateSide.value = 1;
      h.U.uWGlow.value = 1;
      h.U.uWStretch.value = 0.06 + 0.8 * easeIn(k);
      if (k >= 1) {
        slam(s.gate, { scarFrom: s.start });
        s.gate = null;
        h.group.visible = false;
        h.seq = null;
        resetHull(h);
        s.onDone?.();
        return;
      }
    }
    s.gate?.sync();
  }

  // ---------------- pętla ----------------
  function update(dt) {
    time += dt;
    for (const h of handles) {
      if (h.seq?.kind === 'in') stepIn(h, h.seq, dt);
      else if (h.seq?.kind === 'out') stepOut(h, h.seq, dt);
      // uniformy osi statku - co klatkę, bo statek się rusza
      if (h.group.parent) {
        centerOf(h, h.U.uWOrigin.value);
        forwardOf(h, h.U.uWDir.value);
      }
      h.U.uWTime.value = time;
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      const k = clamp01(e.age / e.duration);
      e.step(k);
      if (k >= 1) { e.done(); effects.splice(i, 1); }
    }
  }

  return {
    createHandle, bindModel, unbind, setRace, release,
    warpIn, warpOut, cancel,
    isBusy: (h) => !!h?.seq,
    update,
    // prymitywy dla sterownika gracza
    openGate, shock, flash, scar, slam, forwardOf, centerOf,
    get time() { return time; },
    get effectCount() { return effects.length; },
  };
}

// ============================================================
// SKOK GRACZA
// ============================================================
/**
 * Plan skoku: prosto przed dziób, skrócony przed pierwszym ciałem niebieskim
 * na kursie (fałda nie przechodzi przez masę - i tak statek nie może
 * wejść w gwiazdę, patrz collision.js). Gruz jest pomijany (drobnica -
 * po wyjściu i tak rozwiąże go kolizja).
 * @returns {{ distance: number, blockedBy: string|null }}
 */
export function planJump(from, dir, distance, bodies, margin = 900) {
  let best = distance, blockedBy = null;
  const oc = new THREE.Vector3();
  for (const b of bodies) {
    const R = b.radius * 1.15 + margin;
    oc.copy(from).sub(b.position);
    const bq = oc.dot(dir);
    const c = oc.lengthSq() - R * R;
    const disc = bq * bq - c;
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);   // wejście w strefę ochronną
    if (c < 0) continue;               // już jesteśmy w strefie - nie blokuj (inaczej nie dałoby się uciec)
    if (t > 0 && t < best) { best = t; blockedBy = b.name ?? 'obiekt'; }
  }
  return { distance: best, blockedBy };
}

/**
 * Sterownik skoku gracza. Fazy:
 *   charge  (1,4 s) kadłub się żarzy, fałda otwiera się przed dziobem (podąża
 *           za statkiem - sterowanie wciąż działa), niebo lekko "napina się"
 *   dive    (0,5 s) sterowanie zablokowane, statek wsuwa się w fałdę, rozciąga
 *   transit (2,1 s) wewnątrz fałdy: tunel smug, aberracja gwiazd (beta ~0,93),
 *           FOV 60->92, kamera sztywno przy statku
 *   emerge  (0,9 s) przejście przez fałdę wyjściową, echo, niebo "odbija"
 *           (chwilowo ujemne beta), FOV z przestrzeleniem
 *
 * Gra (main.js) ma: nie ruszać statkiem, gdy `controlsLocked`, pominąć
 * kolizje, gdy `ghost`, i usztywnić kamerę wg `cameraStiffness` (0..1).
 */
export function createPlayerWarp({ drive, handle, ship, camera, renderer, scene, background, flashEl = null, tunnelHost = null }) {
  const tunnel = createTunnel();
  (tunnelHost ?? scene).add(tunnel);

  const T = { charge: 1.4, dive: 0.5, transit: 2.1, emerge: 0.9 };
  const COOLDOWN = 6;
  const BASE_FOV = camera.fov;

  let phase = 'idle';
  let t = 0;
  let cooldown = 0;
  let plan = null;
  const dir = new THREE.Vector3();
  const p0 = new THREE.Vector3(), pDive = new THREE.Vector3(), pExit = new THREE.Vector3(), pEnd = new THREE.Vector3();
  let gateA = null, gateB = null, crossedB = false;
  let onArrive = null, onDive = null;
  let relocate = null, relocated = false, transitTime = T.transit;
  let beta = 0, betaVel = 0, betaTarget = 0;
  let fov = BASE_FOV, fovVel = 0, fovTarget = BASE_FOV;
  let bgDim = 1;
  const baseBgIntensity = scene.backgroundIntensity ?? 1;
  const _v = new THREE.Vector3();

  const inXR = () => !!renderer?.xr?.isPresenting;
  const lead = () => handle.halfLen * 2.2 + handle.gateR * 0.3;

  function domFlash(strength) {
    if (!flashEl) return;
    const c = handle.sig.edge.getStyle();
    flashEl.style.background = `radial-gradient(circle at 50% 50%, rgba(255,255,255,0.9) 0%, ${c} 22%, transparent 70%)`;
    flashEl.style.transition = 'none';
    flashEl.style.opacity = String(strength);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flashEl.style.transition = 'opacity 0.6s ease-out';
      flashEl.style.opacity = '0';
    }));
  }

  /**
   * @param {object} o
   * @param {number} o.distance docelowy dystans skoku
   * @param {Array} o.bodies ciała niebieskie ({position, radius, name}) do planu kursu
   * @returns {{ ok: boolean, reason?: string, distance?: number, blockedBy?: string|null }}
   */
  /**
   * relocateCb (krok 8, skok MIĘDZYGWIEZDNY): wołane w połowie przelotu; zwraca
   * { exit, dir } - punkt wyjścia i kierunek w NOWYM miejscu (np. innym
   * układzie). Statek jest wtedy w tunelu (przygaszone niebo, smugi), więc
   * podmiana świata jest niewidoczna.
   */
  function engage({ distance = 12000, bodies = [], minDistance = 2500, onArriveCb = null, onDiveCb = null, relocateCb = null, transit = T.transit } = {}) {
    if (phase !== 'idle') return { ok: false, reason: 'busy' };
    if (cooldown > 0) return { ok: false, reason: 'cooldown' };
    if (!handle.ready) return { ok: false, reason: 'no-ship' };
    drive.forwardOf(handle, dir);
    plan = planJump(ship.position, dir, distance, bodies);
    if (plan.distance < minDistance) return { ok: false, reason: 'blocked', blockedBy: plan.blockedBy };
    onArrive = onArriveCb; onDive = onDiveCb;
    relocate = relocateCb; relocated = false; transitTime = transit;
    phase = 'charge'; t = 0;
    return { ok: true, distance: plan.distance, blockedBy: plan.blockedBy };
  }

  function finishGates() {
    gateA?.dispose(); gateB?.dispose();
    gateA = gateB = null;
  }

  function abort() {
    finishGates();
    phase = 'idle'; t = 0;
    handle.U.uWStretch.value = 0; handle.U.uWGlow.value = 0; handle.U.uWGateSide.value = 0;
    betaTarget = 0; fovTarget = BASE_FOV; bgDim = 1;
    tunnel.visible = false;
  }

  function update(dt) {
    cooldown = Math.max(0, cooldown - dt);
    const U = handle.U;

    if (phase === 'charge') {
      t += dt;
      const k = clamp01(t / T.charge);
      drive.forwardOf(handle, dir); // fałda podąża za dziobem, sterowanie działa
      const gp = drive.centerOf(handle, _v).addScaledVector(dir, lead());
      if (!gateA) gateA = drive.openGate(gp, dir, handle.gateR, handle.sig);
      gateA.place(gp, dir);
      gateA.open = easeOut(k);
      U.uWGlow.value = easeIn(k) * 1.1;
      U.uWStretch.value = 0.05 * k;
      betaTarget = 0.12 * k;
      if (k >= 1) {
        phase = 'dive'; t = 0;
        p0.copy(ship.position);
        onDive?.({ from: p0.clone(), dir: dir.clone(), distance: plan.distance });
      }
    } else if (phase === 'dive') {
      t += dt;
      const k = clamp01(t / T.dive);
      const travel = (lead() + handle.halfLen * 2.6) * easeIn(k);
      ship.position.copy(p0).addScaledVector(dir, travel);
      U.uWGate.value.copy(gateA.position);
      U.uWGateSide.value = 1;
      U.uWGlow.value = 1.2;
      U.uWStretch.value = 0.05 + 0.75 * easeIn(k);
      betaTarget = 0.12 + 0.4 * k;
      if (k >= 1) {
        pDive.copy(ship.position);
        drive.slam(gateA, { scarFrom: p0.clone() });
        gateA = null;
        domFlash(0.85);
        fovVel += inXR() ? 0 : 120; // kopnięcie FOV
        phase = 'transit'; t = 0;
        pExit.copy(p0).addScaledVector(dir, plan.distance - handle.halfLen * 4);
      }
    } else if (phase === 'transit') {
      t += dt;
      const k = clamp01(t / transitTime);
      if (relocate && !relocated && k >= 0.45) {
        relocated = true;
        const r = relocate();
        if (r) {
          // nowa prosta: ten sam pozostały dystans, ale do nowego punktu wyjścia
          const s = smoother(k);
          const remaining = pExit.distanceTo(ship.position);
          dir.copy(r.dir).normalize();
          pExit.copy(r.exit).addScaledVector(dir, -(handle.halfLen * 5 + handle.gateR));
          const cur = pExit.clone().addScaledVector(dir, -remaining);
          pDive.copy(cur).addScaledVector(pExit, -s).divideScalar(Math.max(1 - s, 1e-3));
          domFlash(0.9);
        }
      }
      ship.position.lerpVectors(pDive, pExit, smoother(k));
      U.uWGateSide.value = 0;
      U.uWGlow.value = 1.2;
      U.uWStretch.value = 0.32 + 0.05 * Math.sin(t * 17);
      betaTarget = 0.93;
      fovTarget = inXR() ? BASE_FOV : 92;
      bgDim = 0.22;
      if (k > 0.72 && !gateB) {
        const gp = _v.copy(pExit).addScaledVector(dir, handle.halfLen * 1.5);
        gateB = drive.openGate(gp, dir, handle.gateR * 1.15, handle.sig);
      }
      if (gateB) { gateB.open = easeOut(clamp01((k - 0.72) / 0.28)); gateB.sync(); }
      if (k >= 1) {
        phase = 'emerge'; t = 0; crossedB = false;
        pEnd.copy(pExit).addScaledVector(dir, handle.halfLen * 5 + handle.gateR);
      }
    } else if (phase === 'emerge') {
      t += dt;
      const k = clamp01(t / T.emerge);
      ship.position.lerpVectors(pExit, pEnd, easeOut(k));
      if (!crossedB && gateB && _v.copy(drive.centerOf(handle, _v)).sub(gateB.position).dot(dir) > 0) {
        crossedB = true;
        drive.slam(gateB);
        gateB = null;
        betaTarget = 0; betaVel -= 9;     // niebo "odbija" (chwilowo ujemne beta)
        fovTarget = BASE_FOV; fovVel -= inXR() ? 0 : 140;
        bgDim = 1;
        domFlash(0.45);
      }
      U.uWStretch.value = 0.32 * (1 - smooth(k));
      U.uWGlow.value = 1.2 * (1 - k);
      if (k >= 1) {
        phase = 'idle'; t = 0;
        cooldown = COOLDOWN;
        U.uWStretch.value = 0; U.uWGlow.value = 0; U.uWGateSide.value = 0;
        gateB?.dispose(); gateB = null;
        betaTarget = 0; fovTarget = BASE_FOV; bgDim = 1;
        onArrive?.({ position: ship.position.clone(), dir: dir.clone() });
      }
    }
    gateA?.sync();

    // --- sprężyny nieba i FOV (przestrzelenie przy wyjściu = "odbicie") ---
    const kB = 38, cB = 7.5;
    betaVel += ((betaTarget - beta) * kB - betaVel * cB) * dt;
    beta = THREE.MathUtils.clamp(beta + betaVel * dt, -0.6, 0.965);
    const kF = 30, cF = 7;
    fovVel += ((fovTarget - fov) * kF - fovVel * cF) * dt;
    fov = THREE.MathUtils.clamp(fov + fovVel * dt, 35, 110);
    if (inXR()) fov = BASE_FOV;
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }

    drive.forwardOf(handle, _v);
    background?.setWarp?.(Math.abs(beta) < 1e-4 ? 0 : beta, phase === 'idle' ? _v : dir);
    const curBg = scene.backgroundIntensity ?? 1;
    scene.backgroundIntensity = THREE.MathUtils.lerp(curBg, baseBgIntensity * bgDim, 1 - Math.exp(-6 * dt));

    // --- drżenie kamery przy ładowaniu (poza VR - tam to przepis na chorobę lokomocyjną) ---
    if (!inXR()) {
      const amp = phase === 'charge' ? 0.006 * easeIn(clamp01(t / T.charge)) : phase === 'dive' ? 0.008 : 0;
      camera.rotation.set((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp, 0);
    }

    // --- tunel smug (przestrzeń wewnątrz fałdy) ---
    const tunnelOn = phase === 'transit' ? 1 : phase === 'emerge' && !crossedB ? 1 : 0;
    const tu = tunnel.material.uniforms;
    tu.uIntensity.value = THREE.MathUtils.lerp(tu.uIntensity.value, tunnelOn, 1 - Math.exp(-(tunnelOn ? 5 : 9) * dt));
    tunnel.visible = tu.uIntensity.value > 0.01;
    if (tunnel.visible) {
      tu.uTime.value += dt * (0.35 + 0.65 * tu.uIntensity.value);
      tu.uCore.value.copy(handle.sig.coreColor);
      tu.uEdge.value.copy(handle.sig.edge);
      camera.getWorldPosition(tunnel.position);
      const camDist = tunnel.position.distanceTo(ship.position);
      tu.uScale.value = Math.max(20, camDist * 0.9);
      tunnel.quaternion.setFromUnitVectors(Z_NEG, dir);
    }
  }

  return {
    engage, update, abort,
    get phase() { return phase; },
    get active() { return phase !== 'idle'; },
    get controlsLocked() { return phase === 'dive' || phase === 'transit' || phase === 'emerge'; },
    get ghost() { return phase === 'dive' || phase === 'transit' || (phase === 'emerge' && !crossedB); },
    get cameraStiffness() {
      if (phase === 'transit') return 1;
      if (phase === 'emerge') return 1 - smooth(clamp01(t / T.emerge));
      return 0;
    },
    get cooldown() { return cooldown; },
    get chargeProgress() { return phase === 'charge' ? clamp01(t / T.charge) : 0; },
    debug: () => ({ phase, t, beta, fov, cooldown, plan }),
  };
}
