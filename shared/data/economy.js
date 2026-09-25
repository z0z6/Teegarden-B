/**
 * EKONOMIA (krok 10) - wszystkie liczby do strojenia w jednym miejscu,
 * tak jak rasy w races.js. Logika siedzi w shared/systems/economy.js,
 * pas planetoid w shared/systems/asteroid-belt.js.
 *
 * PĘTLA GOSPODARCZA:
 *   1. gracz kopie metal promieniem wydobywczym (ładownia statku),
 *   2. wiezie go na plac budowy / do magazynu / na stację przeładunkową,
 *   3. przeładunek sprzedaje metal frachtowcami poza układ -> kredyty,
 *   4. za kredyty i metal stawia dok roju, a dok produkuje drony,
 *   5. roje dronów same kopią na powierzchni planetoid i zwożą urobek
 *      do wskazanej stacji - gracz przechodzi od kilofa do logistyki.
 *
 * Jednostki: metal w tonach (t), pieniądze w kredytach (kr), czas w sekundach,
 * odległości w jednostkach świata (j.), jak w reszcie gry.
 */

export const METALS = {
  zelazo:  { name: 'Żelazo',  symbol: 'Fe', color: '#c3ccd6', price: 4 },
  nikiel:  { name: 'Nikiel',  symbol: 'Ni', color: '#6fd6b4', price: 9 },
  kobalt:  { name: 'Kobalt',  symbol: 'Co', color: '#7c98ff', price: 22 },
  platyna: { name: 'Platyna', symbol: 'Pt', color: '#ffd36b', price: 64 },
};
export const METAL_ORDER = ['zelazo', 'nikiel', 'kobalt', 'platyna'];

/**
 * Klasy planetoid wg prawdziwej taksonomii (Tholen/SMASS, uproszczonej):
 * C - węglowe, ciemne i ubogie w metal; S - krzemianowe, najczęstsze w
 * wewnętrznym pasie; M - metaliczne (odsłonięte jądra rozbitych protoplanet),
 * rzadkie, ale bogate w nikiel, kobalt i platynowce.
 * richness mnoży zasoby (t na (promień/10)^2), mix = udział metali w urobku.
 */
export const ASTEROID_CLASSES = {
  C: { name: 'węglowa', share: 0.42, richness: 0.35, rock: '#3f3b37', vein: '#6c665e', metalness: 0.05,
       mix: { zelazo: 0.72, nikiel: 0.24, kobalt: 0.04, platyna: 0 } },
  S: { name: 'krzemianowa', share: 0.42, richness: 0.75, rock: '#7a6a58', vein: '#b9a58a', metalness: 0.2,
       mix: { zelazo: 0.62, nikiel: 0.29, kobalt: 0.08, platyna: 0.01 } },
  M: { name: 'metaliczna', share: 0.16, richness: 1.6, rock: '#6e737a', vein: '#e3e9f0', metalness: 0.45,
       mix: { zelazo: 0.5, nikiel: 0.31, kobalt: 0.13, platyna: 0.06 } },
};

/** Pas planetoid przy punkcie startowym każdego układu. */
export const BELT = {
  count: 26,           // planetoid w pasie (telefony: mniej, patrz quality)
  radius: 3600,        // promień rozrzutu wokół środka pasa
  thickness: 700,      // grubość (pas jest spłaszczony)
  minR: 70, maxR: 340, // promienie planetoid
  offset: { side: 5200, up: 400, forward: -2600 }, // środek pasa względem spawnu (w prawo, w stronę układu)
};

/**
 * Stacje. cost: kredyty (płatne przy założeniu placu budowy) + metal
 * (dowożony na plac przez gracza albo automatycznie z magazynów i doków).
 * buildTime liczy się dopiero, gdy cały metal jest na miejscu.
 */
export const STATIONS = {
  magazyn: {
    name: 'Magazyn', short: 'MAG', accent: '#ffb45c',
    role: 'Składuje metal. Z magazynów i doków holowniki same zaopatrują budowy i produkcję dronów.',
    cost: { credits: 300, zelazo: 40 }, buildTime: 20, capacity: 2000, radius: 120,
  },
  przeladunek: {
    name: 'Stacja przeładunkowa', short: 'PRZ', accent: '#4dd6a0',
    role: 'Skupuje metal i wysyła go frachtowcami poza układ. Sprzedaż po kursie rynkowym.',
    cost: { credits: 500, zelazo: 90, nikiel: 20 }, buildTime: 30, capacity: 500, radius: 150,
    throughput: 5, // t/s wysyłki (sprzedaży) z bufora stacji
  },
  dok: {
    name: 'Dok roju', short: 'DOK', accent: '#9fd8ff',
    role: 'Orbitalna stocznia dronów górniczych i baza rojów. Drony budowane z metalu w układzie.',
    cost: { credits: 900, zelazo: 140, nikiel: 45, kobalt: 6 }, buildTime: 40, capacity: 400, radius: 140,
    droneSlots: 48, // tyle dronów może mieć baza w jednym doku
  },
};
export const STATION_ORDER = ['magazyn', 'przeladunek', 'dok'];

/** Autonomiczny dron górniczy: ląduje na powierzchni, wierci, wraca z urobkiem. */
export const DRONE = {
  name: 'Dron górniczy',
  cost: { credits: 45, zelazo: 10, nikiel: 3, kobalt: 1 },
  buildTime: 4,     // s na jednego drona (dok buduje po jednym)
  speed: 320,       // j./s przelotowo
  accel: 200,
  hold: 12,         // t urobku na kurs
  mineRate: 0.8,    // t/s wiercenia na powierzchni
  unloadTime: 1.5,  // s rozładunku w stacji
  hover: 5,         // j. nad powierzchnią w trakcie wiercenia
};

/** Statek gracza. */
export const PLAYER_MINING = {
  range: 950,        // j. zasięgu promienia (od powierzchni planetoidy)
  rate: 5,           // t/s urobku
  holdPerCargo: 5,   // ładownia = statystyka "ładunek" rasy x 5 t
  dockRange: 380,    // j. od powierzchni stacji, z których da się rozładować (Y)
  placeAhead: 520,   // j. przed dziobem, gdzie stawiamy nową stację
  minSpacing: 450,   // j. minimalnego odstępu między stacjami
};

/** Rynek: kurs spada, gdy zalewamy go metalem, i wraca do bazowego z czasem. */
export const MARKET = {
  impact: 0.0009,    // spadek mnożnika kursu na tonę sprzedaną
  recovery: 0.015,   // /s powrotu mnożnika do 1
  floor: 0.35,       // najniższy mnożnik
  drift: 0.04,       // amplituda powolnych wahań kursu
};

export const LOGISTICS = {
  rate: 8,           // t/s holowników między magazynami a budowami/dokami (w obrębie układu)
};

export const START = { credits: 1500 };

/** Nazwy rojów (kolejne litery greckie). */
export const SWARM_NAMES = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Jota', 'Kappa', 'Lambda', 'Mi'];

/** Koszt jako czytelny tekst: "300 kr · 60 t Fe". */
export function costText(cost) {
  const parts = [];
  if (cost.credits) parts.push(`${cost.credits} kr`);
  for (const m of METAL_ORDER) if (cost[m]) parts.push(`${cost[m]} t ${METALS[m].symbol}`);
  return parts.join(' · ');
}
