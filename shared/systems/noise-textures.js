import * as THREE from 'three';

/**
 * TEKSTURY SZUMU (optymalizacja, krok 8): gwiazdy, korony, protuberancje,
 * dyski akrecyjne i planety liczyły szum PROCEDURALNIE w każdym pikselu -
 * jedna próbka szumu wartości to 8 haszy + interpolacja, fbm to 4-5 takich
 * próbek, a komórki Worleya to pętla po 27 sąsiadach. Gwiazda wypełniająca
 * ekran wykonywała setki takich operacji na piksel.
 *
 * Teraz szum jest policzony RAZ (przy starcie, na CPU) do dwóch
 * powtarzalnych (kafelkowalnych) tekstur 3D, a shadery robią z nich jedną
 * próbkę tam, gdzie wcześniej liczyły wszystko od zera:
 *
 *   noise3D   32³, losowe wartości w węzłach siatki. Próbka z "wygładzonym"
 *             adresem (sztuczka z przesunięciem współrzędnej o smoothstep)
 *             daje DOKŁADNIE szum wartości z interpolacją smoothstep - ten
 *             sam charakter co wcześniej, ale 1 odczyt tekstury zamiast 8 haszy.
 *   worley3D  64³, (F1, F2) dla 8 komórek na oś. Zamiast pętli 27 sąsiadów -
 *             1 odczyt. "Oddychanie" granul: mieszanie dwóch próbek z
 *             przesuniętych miejsc (patrz star-surface.js).
 *
 * Obie tekstury są współdzielone przez wszystkie materiały (jedna kopia w GPU).
 */

const N = 32;       // rozmiar tekstury szumu wartości
const W = 64;       // rozmiar tekstury Worleya
const CELLS = 8;    // komórek Worleya na oś (W / CELLS = 8 tekseli na komórkę)

let noiseTex = null, worleyTex = null;

// deterministyczny generator (te same tekstury przy każdym uruchomieniu)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function getNoise3D() {
  if (noiseTex) return noiseTex;
  const r = rng(1337);
  const data = new Uint8Array(N * N * N);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(r() * 256);
  noiseTex = new THREE.Data3DTexture(data, N, N, N);
  noiseTex.format = THREE.RedFormat;
  noiseTex.type = THREE.UnsignedByteType;
  noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping;
  noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.unpackAlignment = 1;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

export function getWorley3D() {
  if (worleyTex) return worleyTex;
  const r = rng(4242);
  // punkty cech: jeden losowy punkt w każdej komórce (siatka CELLS³, periodyczna)
  const pts = new Float32Array(CELLS ** 3 * 3);
  for (let i = 0; i < CELLS ** 3; i++) { pts[i * 3] = r(); pts[i * 3 + 1] = r(); pts[i * 3 + 2] = r(); }
  const data = new Uint16Array(W * W * W * 2);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const step = CELLS / W;
  for (let z = 0; z < W; z++) for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const px = (x + 0.5) * step, py = (y + 0.5) * step, pz = (z + 0.5) * step;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let d1 = 9, d2 = 9;
    for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy, gz = cz + oz;
      const wx = ((gx % CELLS) + CELLS) % CELLS, wy = ((gy % CELLS) + CELLS) % CELLS, wz = ((gz % CELLS) + CELLS) % CELLS;
      const k = (wx + wy * CELLS + wz * CELLS * CELLS) * 3;
      const dx = gx + pts[k] - px, dy = gy + pts[k + 1] - py, dz = gz + pts[k + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const i = (x + y * W + z * W * W) * 2;
    data[i] = toHalf(Math.sqrt(d1));
    data[i + 1] = toHalf(Math.sqrt(d2));
  }
  worleyTex = new THREE.Data3DTexture(data, W, W, W);
  worleyTex.format = THREE.RGFormat;
  worleyTex.type = THREE.HalfFloatType;
  worleyTex.wrapS = worleyTex.wrapT = worleyTex.wrapR = THREE.RepeatWrapping;
  worleyTex.minFilter = worleyTex.magFilter = THREE.LinearFilter;
  worleyTex.unpackAlignment = 1;
  worleyTex.needsUpdate = true;
  return worleyTex;
}

/** Uniformy do dołożenia do każdego materiału, który używa NOISE_TEX_GLSL. */
export function noiseUniforms() {
  return { uNoise3D: { value: getNoise3D() }, uWorley3D: { value: getWorley3D() } };
}

/**
 * GLSL: te same nazwy funkcji co wcześniej (vnoise, fbm, worley), więc
 * shadery gwiazd i planet nie musiały zmieniać logiki - tylko źródło szumu.
 */
export const NOISE_TEX_GLSL = /* glsl */ `
uniform highp sampler3D uNoise3D;
uniform highp sampler3D uWorley3D;
float vnoise( vec3 x ) {
  // smoothstep w adresie = interpolacja smoothstep z jednego odczytu liniowego
  vec3 i = floor( x ), f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return texture( uNoise3D, ( i + f + 0.5 ) / ${N}.0 ).r;
}
float fbm( vec3 p ) {
  float a = 0.5, s = 0.0;
  for ( int i = 0; i < 4; i++ ) { s += a * vnoise( p ); p = p * 2.03 + vec3( 11.7, 3.1, 7.3 ); a *= 0.5; }
  return s / 0.9375;
}
// F1, F2 z tekstury; p w jednostkach komórek. "Oddychanie": dwie próbki
// z przesuniętych miejsc mieszane w czasie - granule powoli się przestawiają
vec2 worley( vec3 p, float t ) {
  vec2 a = texture( uWorley3D, p / ${CELLS}.0 ).rg;
  vec2 b = texture( uWorley3D, ( p + vec3( 3.7, 1.9, 5.3 ) ) / ${CELLS}.0 ).rg;
  float m = 0.5 + 0.5 * sin( t * 0.35 );
  return mix( a, b, m * 0.35 );
}
`;
