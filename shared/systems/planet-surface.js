import * as THREE from 'three';

/**
 * PLANETY I KSIĘŻYCE - proceduralne powierzchnie na MeshStandardMaterial
 * (patch onBeforeCompile), więc planety są NORMALNIE OŚWIETLONE przez gwiazdy
 * układu: mają dzień, noc i terminator - w przeciwieństwie do gwiazd, które
 * same świecą (star-surface.js).
 *
 * Rodzaje (kind):
 *   ocean  oceany, kontynenty, czapy lodowe + osobna warstwa chmur
 *   rock   szara, kraterowana skała (księżyce, planety bez atmosfery)
 *   desert rdzawa pustynia z wydmami
 *   ice    lód z pęknięciami
 *   lava   czarna skorupa ze świecącymi szczelinami (widać je też po nocnej stronie)
 *   gas    gazowy olbrzym: pasy, turbulencje, wielka burza; opcjonalnie pierścienie
 */

const NOISE = /* glsl */ `
float pHash( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float pNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( pHash( i ), pHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( pHash( i + vec3( 0, 1, 0 ) ), pHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( pHash( i + vec3( 0, 0, 1 ) ), pHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( pHash( i + vec3( 0, 1, 1 ) ), pHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float pFbm( vec3 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 5; i++ ) { s += a * pNoise( p ); p = p * 2.02 + 17.1; a *= 0.5; } return s / 0.96875; }
vec2 pCells( vec3 p ) {
  vec3 i = floor( p ), f = fract( p ); float d1 = 8.0, d2 = 8.0;
  for ( int z = -1; z <= 1; z++ ) for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    vec3 g = vec3( x, y, z ); vec3 o = vec3( pHash( i + g ), pHash( i + g + 7.1 ), pHash( i + g + 3.3 ) );
    vec3 r = g + o - f; float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
  }
  return vec2( sqrt( d1 ), sqrt( d2 ) );
}
`;

// kolor powierzchni (liniowy) + szorstkość + emisja, zależnie od rodzaju
const SURFACE = /* glsl */ `
vec3 pSurf( vec3 n, out float rough, out vec3 emit ) {
  vec3 p = n + uSeed;
  float lat = n.y;
  rough = 0.85; emit = vec3( 0.0 );
  if ( uKind == 0 ) {            // ocean
    float h = pFbm( p * 2.2 ) + 0.25 * pFbm( p * 9.0 );
    float land = smoothstep( 0.6, 0.63, h );
    vec3 sea = mix( vec3( 0.005, 0.03, 0.09 ), vec3( 0.02, 0.12, 0.2 ), smoothstep( 0.45, 0.6, h ) );
    vec3 ground = mix( vec3( 0.06, 0.12, 0.03 ), vec3( 0.22, 0.17, 0.09 ), smoothstep( 0.66, 0.85, h ) );
    vec3 c = mix( sea, ground, land );
    float cap = smoothstep( 0.72, 0.8, abs( lat ) + 0.08 * pFbm( p * 5.0 ) );
    c = mix( c, vec3( 0.8, 0.85, 0.9 ), cap );
    rough = mix( 0.35, 0.9, max( land, cap ) );
    return c;
  } else if ( uKind == 1 ) {     // rock (kratery)
    vec2 cr = pCells( p * 5.0 );
    float crater = smoothstep( 0.35, 0.05, cr.x ) - 0.6 * smoothstep( 0.5, 0.33, cr.x ) * smoothstep( 0.2, 0.33, cr.x );
    float g = pFbm( p * 4.0 );
    return vec3( 0.18, 0.17, 0.16 ) * ( 0.7 + 0.6 * g ) * ( 1.0 - 0.35 * crater );
  } else if ( uKind == 2 ) {     // desert
    float dunes = 0.5 + 0.5 * sin( ( p.x * 30.0 + pFbm( p * 3.0 ) * 12.0 ) );
    float g = pFbm( p * 3.0 );
    return mix( vec3( 0.35, 0.13, 0.05 ), vec3( 0.6, 0.35, 0.16 ), g ) * ( 0.85 + 0.15 * dunes );
  } else if ( uKind == 3 ) {     // ice
    vec2 cr = pCells( p * 6.0 );
    float crack = smoothstep( 0.05, 0.0, cr.y - cr.x );
    rough = 0.3;
    return mix( vec3( 0.7, 0.8, 0.9 ), vec3( 0.2, 0.35, 0.5 ), crack * 0.8 + 0.2 * pFbm( p * 3.0 ) );
  } else if ( uKind == 4 ) {     // lava
    vec2 cr = pCells( p * 4.0 + vec3( 0.0, uTime * 0.01, 0.0 ) );
    float crack = smoothstep( 0.09, 0.0, cr.y - cr.x );
    float pool = smoothstep( 0.62, 0.7, pFbm( p * 2.0 ) );
    float heat = max( crack, pool ) * ( 0.75 + 0.25 * sin( uTime * 1.3 + pFbm( p * 8.0 ) * 6.0 ) );
    emit = vec3( 1.6, 0.35, 0.05 ) * heat;
    return vec3( 0.04, 0.035, 0.03 ) * ( 0.6 + 0.8 * pFbm( p * 6.0 ) );
  }
  // gas: pasy wzdłuż szerokości, zakrzywione turbulencją; wielka burza (owal)
  float turb = pFbm( vec3( n.x * 3.0, lat * 1.5, n.z * 3.0 ) + uSeed + vec3( uTime * 0.01, 0.0, 0.0 ) );
  float b = lat * 9.0 + turb * 1.6;
  float bands = 0.5 + 0.5 * sin( b * 2.3 ) * cos( b * 0.9 + 1.3 );
  vec3 c = mix( uPalA, uPalB, bands );
  c = mix( c, uPalC, smoothstep( 0.6, 0.9, pFbm( vec3( lat * 20.0, n.x * 2.0, n.z * 2.0 ) + uSeed ) ) * 0.6 );
  vec3 sc = normalize( vec3( 0.8, -0.35, 0.5 ) );
  float storm = smoothstep( 0.2, 0.0, length( ( n - sc ) * vec3( 1.0, 2.2, 1.0 ) ) - 0.04 * pFbm( n * 20.0 ) );
  c = mix( c, uPalC * 1.3, storm );
  rough = 0.95;
  return c;
}
`;

const KINDS = { ocean: 0, rock: 1, desert: 2, ice: 3, lava: 4, gas: 5 };

function planetMaterial({ kind, seed, palette }) {
  const U = {
    uKind: { value: KINDS[kind] ?? 1 },
    uSeed: { value: seed },
    uTime: { value: 0 },
    uPalA: { value: new THREE.Color(palette?.[0] ?? 0xd9b98a) },
    uPalB: { value: new THREE.Color(palette?.[1] ?? 0x9c6a3e) },
    uPalC: { value: new THREE.Color(palette?.[2] ?? 0xe8e0d0) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normalize( position );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjN;
uniform int uKind;
uniform float uSeed, uTime;
uniform vec3 uPalA, uPalB, uPalC;
${NOISE}
${SURFACE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float pRough; vec3 pEmit;
diffuseColor.rgb = pSurf( normalize( vObjN ), pRough, pEmit );`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += pEmit;');
  };
  mat.customProgramCacheKey = () => 'planet-surface-v1';
  return { mat, U };
}

const CLOUD_FRAG_PATCH = /* glsl */ `
float cl = pFbm( normalize( vObjN ) * 3.0 + uSeed + vec3( uTime * 0.004, 0.0, 0.0 ) );
float cl2 = pFbm( normalize( vObjN ) * 9.0 + uSeed * 2.0 );
diffuseColor.a = smoothstep( 0.52, 0.72, cl * 0.75 + cl2 * 0.35 ) * 0.9;
diffuseColor.rgb = vec3( 0.95 );
`;

function cloudMaterial(seed) {
  const U = { uSeed: { value: seed + 3 }, uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjN = normalize( position );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObjN;\nuniform float uSeed, uTime;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${CLOUD_FRAG_PATCH}`);
  };
  mat.customProgramCacheKey = () => 'planet-clouds-v1';
  return { mat, U };
}

const RING_FRAG = /* glsl */ `
uniform vec3 uCol;
uniform float uIn;
varying vec2 vP;
float h( float x ) { return fract( sin( x * 127.1 ) * 43758.5453 ); }
void main() {
  float r = length( vP );
  if ( r < uIn || r > 1.0 ) discard;
  float t = ( r - uIn ) / ( 1.0 - uIn );
  // setki cienkich pierścieni o różnej gęstości + przerwa (jak przerwa Cassiniego)
  float k = floor( t * 160.0 );
  float dens = 0.35 + 0.65 * h( k ) * h( floor( t * 23.0 ) + 3.0 );
  dens *= 1.0 - smoothstep( 0.55, 0.57, t ) * smoothstep( 0.63, 0.61, t );
  dens *= smoothstep( 0.0, 0.05, t ) * smoothstep( 1.0, 0.93, t );
  gl_FragColor = vec4( uCol * ( 0.6 + 0.4 * h( k + 9.0 ) ), dens * 0.75 );
  #include <colorspace_fragment>
}
`;

/**
 * @param {object} o
 * @param {number} o.radius
 * @param {string} o.kind       ocean | rock | desert | ice | lava | gas
 * @param {number} [o.seed]
 * @param {number[]} [o.palette] 3 kolory dla gazowego olbrzyma
 * @param {boolean} [o.clouds]  warstwa chmur (domyślnie dla ocean)
 * @param {object} [o.rings]    { inner, outer, color } w promieniach planety
 * @param {number} [o.tilt]     nachylenie osi (radiany)
 */
export function createPlanetVisual({ radius, kind = 'rock', seed = Math.random() * 50, palette, clouds, rings, tilt = 0.25 }) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.z = tilt;
  group.add(body);
  const { mat, U } = planetMaterial({ kind, seed, palette });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat);
  body.add(mesh);
  let cloud = null;
  if (clouds ?? kind === 'ocean') {
    cloud = cloudMaterial(seed);
    const cm = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.015, 96, 64), cloud.mat);
    body.add(cm);
  }
  if (rings) {
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: RING_FRAG,
      uniforms: { uCol: { value: new THREE.Color(rings.color ?? 0xcdb89a) }, uIn: { value: rings.inner / rings.outer } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.CircleGeometry(1, 160), ringMat);
    ring.scale.setScalar(radius * rings.outer);
    ring.rotation.x = -Math.PI / 2;
    body.add(ring);
  }
  let time = 0;
  function update(dt) {
    time += dt;
    U.uTime.value = time;
    if (cloud) cloud.U.uTime.value = time;
    mesh.rotation.y += dt * (kind === 'gas' ? 0.03 : 0.01);
  }
  function dispose() {
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
  return { group, mesh, update, dispose };
}
