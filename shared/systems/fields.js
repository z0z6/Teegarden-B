import * as THREE from 'three';
import { seededRng, hashString } from './asteroid-belt.js';
import { beltCenterFor } from './economy.js';

/**
 * POLA SUROWCOWE (krok 11): kilka złóż w każdym układzie gwiezdnym.
 *
 * Pola leżą na pierścieniu na OBRZEŻACH układu, na wysokości punktu startu:
 * poza orbitami planet, bo pas planetoid w tej grze stoi w miejscu, a
 * planeta przelatująca przez kopalnię zmiotłaby stacje. Odstęp między
 * sąsiednimi polami to ok. 15 tys. j. (ok. 25 s lotu z dopalaczem), niezależnie
 * od skali układu, więc eksploracja zajmuje tyle samo w małym układzie
 * Teegardena co przy nadolbrzymie.
 *
 * Pole 0 to "pole macierzyste" przy punkcie startu - to samo miejsce i ten sam
 * pas co w kroku 10 (id planetoid bez prefiksu). Kolejne pola mają własny
 * charakter (ARCHETYPES): ubogie pyłowe, krzemianowe, metaliczne
 * "cmentarzysko protoplanety" z platyną - o nie rasy walczą najchętniej.
 *
 * Czyste dane, deterministyczne z id układu (Node i przeglądarka).
 */

export const ARCHETYPES = {
  pas:        { label: 'pas mieszany',        shares: null,                          richness: 1.0, count: 22, radius: 3400 },
  pylowe:     { label: 'pole pyłowe (ubogie)', shares: { C: 0.7, S: 0.28, M: 0.02 }, richness: 0.75, count: 26, radius: 3800 },
  krzemowe:   { label: 'pas krzemianowy',     shares: { C: 0.2, S: 0.68, M: 0.12 },  richness: 1.1, count: 20, radius: 3000 },
  metaliczne: { label: 'cmentarzysko protoplanety', shares: { C: 0.1, S: 0.35, M: 0.55 }, richness: 1.45, count: 16, radius: 2600 },
};

const NAMES = [
  'Żelazna Rafa', 'Pas Pyłowy', 'Mielizna Kobaltowa', 'Rój Odłamków', 'Rafa Szronu', 'Szczerba',
  'Pas Latarni', 'Kopiec', 'Wrota Pyłu', 'Kamienny Chór', 'Rozdroże', 'Kowadło', 'Ciche Żwirowisko',
  'Zatoka Odłamków', 'Grzbiet Harfy', 'Srebrna Mgła', 'Stare Jądro', 'Kuźnia Wiatru', 'Ślepy Zaułek',
  'Zęby Olbrzyma', 'Popielisko', 'Warkocz', 'Przełęcz Rudy', 'Pierścień Wdowy',
];

/**
 * @param {string} systemId
 * @param {{position, lookAt}} spawn - punkt startowy układu (star-systems.js)
 * @returns {Array<object>} definicje pól (pole 0 = macierzyste przy spawnie)
 */
export function generateFields(systemId, spawn, { count = 5 } = {}) {
  const rng = seededRng(hashString(`pola:${systemId}`));
  const sp = new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z);
  const R = Math.hypot(sp.x, sp.z);
  const theta0 = Math.atan2(sp.x, sp.z);
  const step = Math.min(15000 / R, 0.62); // ~15 tys. j. po łuku, w każdej skali układu
  // kolejne nazwy z listy od miejsca zależnego od układu (krok 7 - względnie
  // pierwszy z 24): w jednym układzie bez powtórzeń, między układami rzadko
  let nameIdx = hashString(`nazwy:${systemId}`) % NAMES.length;
  const pickName = () => { const n = NAMES[nameIdx]; nameIdx = (nameIdx + 7) % NAMES.length; return n; };
  const fields = [];
  const home = beltCenterFor(spawn.position, spawn.lookAt);
  fields.push({
    id: `${systemId}:0`, index: 0, systemId, name: pickName(), kind: 'pas', ...ARCHETYPES.pas,
    center: { x: home.x, y: home.y, z: home.z }, seed: hashString(`pas:${systemId}`), idPrefix: '', home: true,
  });
  // pozostałe: na przemian po obu stronach spawnu, coraz dalej
  const kinds = ['metaliczne', 'krzemowe', 'pylowe', 'pas', 'krzemowe', 'metaliczne'];
  for (let i = 1; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const k = Math.ceil(i / 2);
    const th = theta0 + side * step * (k + 0.15 + rng() * 0.35);
    const r = R + (rng() - 0.3) * 6000; // tuż za orbitami, bez skalowania rozmiarem układu
    const c = new THREE.Vector3(Math.sin(th) * r, sp.y + (rng() - 0.5) * R * 0.05, Math.cos(th) * r);
    const kind = kinds[(i - 1 + Math.floor(rng() * 2)) % kinds.length];
    const a = ARCHETYPES[kind];
    fields.push({
      id: `${systemId}:${i}`, index: i, systemId, name: pickName(), kind, ...a,
      richness: a.richness * (0.85 + rng() * 0.3),
      center: { x: c.x, y: c.y, z: c.z }, seed: hashString(`pas:${systemId}:${i}`), idPrefix: `f${i}-`, home: false,
    });
  }
  // sygnał dla nieodkrytego pola: przybliżony kierunek (czujniki dalekiego zasięgu)
  for (const f of fields) {
    const a = rng() * Math.PI * 2;
    f.signal = { x: f.center.x + Math.cos(a) * 2600, y: f.center.y, z: f.center.z + Math.sin(a) * 2600 };
  }
  return fields;
}

/** Szacunkowa wartość pola (do wyceny przez AI i na mapie): 1 = zwykły pas. */
export function fieldValue(f) {
  const sh = f.shares ?? { C: 0.42, S: 0.42, M: 0.16 };
  const tot = sh.C + sh.S + sh.M;
  return f.richness * (0.35 * sh.C + 0.75 * sh.S + 2.4 * sh.M) / tot / 0.846;
}
