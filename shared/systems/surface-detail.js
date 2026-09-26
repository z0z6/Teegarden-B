/**
 * SZCZEGÓŁ POWIERZCHNI (krok 12): realizm bez tekstur z plików.
 *
 * Wszystko liczy się w shaderze z pozycji w układzie obiektu (patch
 * onBeforeCompile materiałów MeshStandardMaterial), więc nie ma szwów UV,
 * nie ma pobierania obrazków, a każdy obiekt ma inny wzór:
 *
 *   rock  - planetoidy i gruz: spękania, drobne kratery, pył w zagłębieniach,
 *           zmienna szorstkość i relief (normalna z pochodnych wysokości)
 *   panel - stacje: płyty poszycia ze szczelinami, nity, zabrudzenia,
 *           zacieki spływające "w dół" płyty, zarysowania, przypalenia
 *   wear  - kadłuby statków: delikatne przybrudzenia, zadrapania i ślady
 *           po dyszach (wstrzykiwane do shadera fałdy w warp-drive.js)
 *
 * Koszt: 3-4 oktawy szumu wartości na piksel tylko na tych obiektach; w
 * trybie oszczędnym (setSurfaceQuality < 0.8, telefony) - 2 oktawy i bez
 * nitów. Program GPU jest jeden na tryb (customProgramCacheKey).
 */

let LOW = false;
/** Telefony / słaby sprzęt: mniej oktaw szumu. Wołać przed tworzeniem materiałów. */
export function setSurfaceQuality(q) { LOW = q < 0.8; }

export const NOISE_GLSL = /* glsl */ `
float sdHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
float sdNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( sdHash( i ), sdHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( sdHash( i + vec3( 0, 1, 0 ) ), sdHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( sdHash( i + vec3( 0, 0, 1 ) ), sdHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( sdHash( i + vec3( 0, 1, 1 ) ), sdHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float sdFbm( vec3 p ) {
  float a = 0.5, s = 0.0;
  for ( int i = 0; i < SD_OCTAVES; i++ ) { s += a * sdNoise( p ); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// relief: normalna zaburzona gradientem wysokości w przestrzeni ekranu (jak bumpMap, ale bez tekstury)
// (nachylenie ograniczone: ostre przejścia wysokości nie odwracają normalnej - bez czarnych kropek)
vec3 sdBump( vec3 n, vec3 viewPos, float h, float k ) {
  vec3 dpdx = dFdx( -viewPos ), dpdy = dFdy( -viewPos );
  float dhx = dFdx( h ) * k, dhy = dFdy( h ) * k;
  vec3 r1 = cross( dpdy, n ), r2 = cross( n, dpdx );
  float det = dot( dpdx, r1 );
  if ( abs( det ) < 1e-10 ) return n;
  vec3 g = sign( det ) * ( dhx * r1 + dhy * r2 ) / abs( det );
  float gl = length( g );
  if ( gl > 0.6 ) g *= 0.6 / gl;
  return normalize( n - g );
}
`;

const VERT_PARS = /* glsl */ `varying vec3 vSdPos;\nvarying vec3 vSdNrm;\nuniform float uSdScale;\n`;
const VERT_MAIN = /* glsl */ `vSdPos = position * uSdScale;\nvSdNrm = normal;\n`;

// ------------------------------------------------------------
// SKAŁA
// ------------------------------------------------------------
const ROCK_COLOR = /* glsl */ `
float sdH = sdFbm( vSdPos * 5.0 );
float sdFine = sdNoise( vSdPos * 38.0 ) * ( 1.0 - smoothstep( 0.5, 2.0, fwidth( vSdPos.x * 38.0 ) ) ); // gaśnie z daleka
float sdMid = sdNoise( vSdPos * 17.0 + 5.0 );
// spękania: doliny w polu szumu o zaburzonej dziedzinie (nie układają się w siatkę komórek)
float sdCrack = 1.0 - smoothstep( 0.0, 0.1, abs( sdNoise( vSdPos * 7.0 + sdH * 2.5 + 3.7 ) - 0.5 ) );
sdCrack *= smoothstep( 0.3, 0.6, sdNoise( vSdPos * 2.2 + 21.0 ) ); // tylko miejscami
// drobne kratery: ciemne, miękkie zagłębienia
float sdCr = sdNoise( vSdPos * 13.0 + sdH * 1.5 + 11.0 );
float sdPit = smoothstep( 0.7, 0.95, sdCr );
float sdDust = smoothstep( 0.35, 0.75, sdH );
diffuseColor.rgb *= 0.55 + 0.55 * sdH + 0.14 * sdFine + 0.12 * sdMid;
// mineralne przebarwienia: rdzawe i szare plamy
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.15, 0.92, 0.78 ), smoothstep( 0.55, 0.8, sdNoise( vSdPos * 3.1 + 40.0 ) ) * 0.5 );
diffuseColor.rgb *= 1.0 - 0.3 * sdCrack - 0.3 * sdPit;
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.08, 1.02, 0.94 ) + 0.035, sdDust * 0.35 );
`;
const ROCK_ROUGH = /* glsl */ `roughnessFactor = clamp( roughnessFactor * ( 0.85 + 0.3 * sdFine ) + sdDust * 0.15, 0.0, 1.0 );\n`;
const ROCK_NORMAL = /* glsl */ `normal = sdBump( normal, vViewPosition, sdH * 0.9 + sdMid * 0.25 + sdFine * 0.08 - sdCrack * 0.2 - sdPit * 0.3, uSdBump );\n`;

// ------------------------------------------------------------
// POSZYCIE STACJI
// ------------------------------------------------------------
const PANEL_COLOR = /* glsl */ `
// dwie osie prostopadłe do dominującej osi normalnej (triplanar "na skróty")
vec3 sdA = abs( vSdNrm );
vec2 sdUV = sdA.x > sdA.y && sdA.x > sdA.z ? vSdPos.zy : ( sdA.y > sdA.z ? vSdPos.xz : vSdPos.xy );
vec2 sdCell = floor( sdUV / vec2( 1.0, 0.6 ) );
vec2 sdF = fract( sdUV / vec2( 1.0, 0.6 ) );
float sdSeam = 1.0 - smoothstep( 0.0, 0.025, min( min( sdF.x, 1.0 - sdF.x ), min( sdF.y, 1.0 - sdF.y ) * 1.6 ) );
float sdPanelTone = sdHash( vec3( sdCell, 7.0 ) );
// antyaliasing: drobne wzory gasną, gdy piksel obejmuje ich kilka (z daleka bez "śniegu")
float sdFar = smoothstep( 0.025, 0.12, fwidth( sdUV.x ) + fwidth( sdUV.y ) );
sdSeam *= 1.0 - sdFar * 0.85;
float sdRivet = 0.0;
#ifndef SD_LOW
  vec2 sdR = abs( fract( sdUV * vec2( 8.0, 4.8 ) ) - 0.5 );
  sdRivet = ( 1.0 - smoothstep( 0.08, 0.14, length( sdR ) ) ) * step( min( sdF.x, 1.0 - sdF.x ), 0.08 ) * ( 1.0 - smoothstep( 0.008, 0.02, fwidth( sdUV.x ) ) );
#endif
float sdGrime = sdFbm( vSdPos * 1.7 );
// zacieki: szum rozciągnięty w pionie (lokalne Y)
float sdStreak = smoothstep( 0.55, 0.85, sdNoise( vec3( vSdPos.x * 7.0, vSdPos.y * 0.6, vSdPos.z * 7.0 ) ) ) * ( 1.0 - sdA.y );
float sdScratch = smoothstep( 0.965, 1.0, sdNoise( vec3( sdUV.x * 60.0, sdUV.y * 3.0, 0.0 ) ) ) * ( 1.0 - smoothstep( 0.004, 0.012, fwidth( sdUV.x ) ) );
float sdBurn = smoothstep( 0.62, 0.9, sdFbm( vSdPos * 0.45 + 5.0 ) );
diffuseColor.rgb *= 0.86 + 0.18 * sdPanelTone;
diffuseColor.rgb *= 1.0 - 0.55 * sdSeam;
diffuseColor.rgb *= 1.0 - 0.42 * smoothstep( 0.45, 0.8, sdGrime ) - 0.25 * sdStreak;
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.09, 0.07, 0.06 ), sdBurn * 0.45 );
diffuseColor.rgb += sdScratch * 0.12 + sdRivet * 0.08;
`;
const PANEL_ROUGH = /* glsl */ `roughnessFactor = clamp( roughnessFactor + 0.25 * smoothstep( 0.4, 0.8, sdGrime ) + 0.15 * sdStreak - 0.2 * sdScratch, 0.05, 1.0 );\n`;
const PANEL_METAL = /* glsl */ `metalnessFactor *= 1.0 - 0.35 * sdBurn;\n`;
const PANEL_NORMAL = /* glsl */ `normal = sdBump( normal, vViewPosition, -sdSeam * 0.35 + sdRivet * 0.25 + sdGrime * 0.08, uSdBump );\n`;

// ------------------------------------------------------------
// KADŁUBY STATKÓW (do shadera fałdy w warp-drive.js)
// ------------------------------------------------------------
export const WEAR_VERT_PARS = VERT_PARS;
export const WEAR_VERT_MAIN = VERT_MAIN;
export const WEAR_FRAG = /* glsl */ `
{
  float wg = sdFbm( vSdPos * 1.3 );
  float ws = smoothstep( 0.97, 1.0, sdNoise( vec3( vSdPos.x * 40.0, vSdPos.y * 2.0, vSdPos.z * 3.0 ) ) );
  float wsoot = smoothstep( 0.6, 0.95, sdFbm( vSdPos * 0.5 + 9.0 ) );
  diffuseColor.rgb *= 1.0 - 0.28 * smoothstep( 0.45, 0.85, wg ) - 0.3 * wsoot;
  diffuseColor.rgb += ws * 0.08;
}
`;

// ------------------------------------------------------------
// PATCH MATERIAŁU
// ------------------------------------------------------------
const MODES = {
  rock: { color: ROCK_COLOR, rough: ROCK_ROUGH, metal: '', normal: ROCK_NORMAL, scale: 1, bump: 2.4 },
  panel: { color: PANEL_COLOR, rough: PANEL_ROUGH, metal: PANEL_METAL, normal: PANEL_NORMAL, scale: 1 / 12, bump: 0.9 },
};

/** Defines trybu jakości (oktawy szumu) - wspólne dla wszystkich patchy. */
export const sdDefines = () => `#define SD_OCTAVES ${LOW ? 2 : 4}\n${LOW ? '#define SD_LOW\n' : ''}`;

/**
 * Dokłada szczegół powierzchni do materiału MeshStandardMaterial.
 * @param {'rock'|'panel'} mode
 * @param {{ scale?: number, bump?: number }} opts scale - ile jednostek obiektu na "komórkę" wzoru
 */
export function applySurfaceDetail(mat, mode, { scale = null, bump = null } = {}) {
  const M = MODES[mode];
  if (!M || !mat?.isMeshStandardMaterial) return mat;
  const uScale = { value: scale ?? M.scale }, uBump = { value: bump ?? M.bump };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.uniforms.uSdScale = uScale;
    shader.uniforms.uSdBump = uBump;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${sdDefines()}varying vec3 vSdPos;\nvarying vec3 vSdNrm;\nuniform float uSdBump;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${M.color}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${M.rough}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${M.metal}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${M.normal}`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `sd-${mode}-${LOW ? 'lo' : 'hi'}|${prevKey ? prevKey() : ''}`;
  mat.userData.surfaceScale = uScale;
  mat.needsUpdate = true;
  return mat;
}
