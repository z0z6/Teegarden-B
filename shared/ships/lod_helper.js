/**
 * loadShipLOD() — ładuje 3 warianty jakościowe modelu (LOD0/1/2) i pakuje je
 * w THREE.LOD, który silnik sam przełącza w zależności od odległości kamery.
 *
 * Oczekiwana struktura plików (tak jak w paczce z modelami):
 *   /models/warbird-light-lod0.glb
 *   /models/warbird-light-lod1.glb
 *   /models/warbird-light-lod2.glb
 *
 * Użycie:
 *   import { loadShipLOD, LOD_PRESETS } from './lod_helper.js';
 *   const ship = await loadShipLOD('/models', 'warbird-light', LOD_PRESETS.desktop);
 *   scene.add(ship);
 *
 * Wymaga: npm install three
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

// Progi przełączania LOD (jednostki świata = zwykle metry).
// Dostosuj do skali swojej sceny i typu rozgrywki (space sim z dużymi
// dystansami będzie chciał większych progów niż arena-shooter).
export const LOD_PRESETS = {
  // Mocny desktop: długo pokazujemy pełny detal
  desktop: { lod0: 0, lod1: 60, lod2: 160 },
  // Mobile / słabszy sprzęt: szybciej schodzimy na niższe poziomy
  mobile: { lod0: 0, lod1: 25, lod2: 70 },
  // VR: NIE polecam pełnego LOD0 na statkach, którymi steruje gracz
  // z bliska (patrz uwaga w README o "popowaniu" modeli w VR) —
  // ten preset od razu zaczyna od LOD1 i szybciej wchodzi w LOD2,
  // żeby utrzymać stabilne 90 FPS na oko.
  vr: { lod0: 0, lod1: 15, lod2: 50 },
};

/**
 * @param {string} basePath - katalog z plikami .glb (bez ukośnika na końcu)
 * @param {string} shipName - np. "warbird-light", "warbird-heavy", "raptor-interceptor"
 * @param {{lod0:number, lod1:number, lod2:number}} distances - progi przełączania
 * @param {boolean} skipLod0 - pomiń najwyższy poziom detalu (przydatne w VR
 *   / na słabym mobile, gdzie i tak nigdy go nie zobaczysz, a szkoda ładować dane)
 */
export async function loadShipLOD(basePath, shipName, distances = LOD_PRESETS.desktop, { skipLod0 = false } = {}) {
  const lod = new THREE.LOD();
  lod.name = `${shipName}_lod`;

  const tiers = skipLod0
    ? [['lod1', distances.lod0], ['lod2', distances.lod2]]
    : [['lod0', distances.lod0], ['lod1', distances.lod1], ['lod2', distances.lod2]];

  for (const [tag, distance] of tiers) {
    const url = `${basePath}/${shipName}-${tag}.glb`;
    const model = await loadGLB(url);
    lod.addLevel(model, distance);
  }

  return lod;
}

/**
 * Wariant do masowego spawnowania (np. flota NPC) — ładuje geometrię raz
 * i współdzieli ją między instancjami przez klonowanie na poziomie THREE
 * (materiały są współdzielone automatycznie, geometrie też, bo GLTFLoader
 * ich nie kopiuje przy .clone() na scenie — to tylko klon hierarchii/transformów).
 */
export async function loadShipLODFactory(basePath, shipName, distances = LOD_PRESETS.desktop, opts) {
  const template = await loadShipLOD(basePath, shipName, distances, opts);
  return () => template.clone();
}
