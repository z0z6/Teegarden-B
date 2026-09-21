/**
 * Rasy, stronnictwa, relacje i wyliczanie statystyk - wersja 0.1 z kart
 * ras (rozmowa o warstwie fabularnej). Wszystkie liczby siedzą TUTAJ, w
 * jednym miejscu do strojenia; reszta gry tylko je czyta.
 *
 * Cztery rasy mają pełne karty statystyk (wybudzeni, rezonanci, piesniarze,
 * szczepieni). Trzy pozostałe (wykonawcy, heliotropi, swietlisci) mają na
 * razie tylko tożsamość (nazwa, stronnictwa, głos), żeby mogły występować
 * jako sojusznicy/wrogowie w scenach - statystyki dopiszemy później.
 */

// Losowy przydział modeli statków do rasy (wylosowany raz i zapisany, żeby
// był powtarzalny). Kiedy powstaną własne modele ras - podmień tutaj.
export const SHIP_RACE = {
  'warbird-light': 'piesniarze',
  'raptor-interceptor': 'rezonanci',
  'warbird-heavy': 'szczepieni',
  'kharath-destroyer': 'wybudzeni',
};

export const RACES = {
  wybudzeni: {
    name: 'Wybudzeni', color: '#e0b15a', developed: true,
    attrs: { pilot: 5, nav: 6, sensors: 6, eng: 7, tact: 3, infl: 7 }, // kapitan Cechu Rzeczników (karta)
    ship: { hull: 100, armor: 5 }, hullRegenPct: 0,
    factions: { hawk: 'Kwartał Spisowy', trade: 'Cech Rzeczników', coalition: 'Bez Numeru' },
    voice: {
      hail: 'Tu {faction}. Widzimy cię w rejestrze jako nieznany, ale nie wrogi. Możemy się wzajemnie kryć — za uczciwy udział w łupach.',
      reply: 'Wpisane do manifestu. Trzymamy się blisko.',
      toll: 'Ten sektor jest wpisany do naszego spisu. Wszystko, co przelatuje, płaci: cztery jednostki ładunku, albo rozmowa się kończy.',
      attack: 'Odmowa odnotowana. Twój wrak też pójdzie do manifestu.',
      retreat: 'Wycofujemy się. Ten wpis jeszcze poprawimy.',
    },
  },
  rezonanci: {
    name: 'Rezonanci', color: '#7fd1ff', developed: true,
    attrs: { pilot: 5, nav: 6, sensors: 7, eng: 5, tact: 4, infl: 7 }, // kapitan Kworum Pośredniego
    ship: { hull: 110, armor: 6 }, hullRegenPct: 0,
    factions: { hawk: 'Szczyt Okna', trade: 'Kworum Pośrednie', coalition: 'Przesypiający' },
    voice: {
      hail: 'Tu {faction}. Okno się zbliża — pozwól nam lecieć obok. Kworum uznaje cię za sojusznika.',
      reply: 'Kworum przyjęło. Lecimy razem, do zamknięcia okna.',
      toll: 'Kworum zatwierdziło opłatę za przelot: cztery jednostki ładunku. Głosowanie zamknięte.',
      attack: 'Kworum uznaje odmowę. Okno otwarte — ogień.',
      retreat: 'Okno się zamyka. Cofamy się do doliny.',
    },
  },
  piesniarze: {
    name: 'Pieśniarze', color: '#c39bff', developed: true,
    attrs: { pilot: 4, nav: 7, sensors: 7, eng: 5, tact: 4, infl: 7 }, // kapitan Chórów Map
    ship: { hull: 85, armor: 3 }, hullRegenPct: 0,
    factions: { hawk: 'Szpony', trade: 'Chóry Map', coalition: 'Kukułki' },
    voice: {
      hail: 'Tu {faction}. Widzieliśmy twój tor już trzy pieśni temu. Chodź w moją stronę — bezpieczniej razem.',
      reply: 'Dobra pieśń. Lecimy w jednym chórze.',
      toll: 'Twoja trajektoria jest nam znana. Cztery jednostki ładunku za bezpieczny przelot, albo zaśpiewamy wyrok.',
      attack: 'Pieśń skończona. Ogień.',
      retreat: 'Zmieniamy tor. To nie była nasza pieśń.',
    },
  },
  szczepieni: {
    name: 'Szczepieni', color: '#7ee08a', developed: true,
    attrs: { pilot: 5, nav: 5, sensors: 6, eng: 8, tact: 3, infl: 7 }, // kapitan Izby Kwarantanny
    ship: { hull: 95, armor: 4 }, hullRegenPct: 0.2,
    factions: { hawk: 'Pełny Szczep', trade: 'Izba Kwarantanny', coalition: 'Odporni' },
    voice: {
      hail: 'Tu {faction}. Przechodzimy przez kwarantannę — jeśli jesteś czysty, lećmy razem.',
      reply: 'Skan czysty. Trzymamy dystans, ale lecimy razem.',
      toll: 'Sektor pod kwarantanną. Skan i opłata: cztery jednostki ładunku. Bez tego nie przejdziesz.',
      attack: 'Odmowa skanu oznacza zagrożenie. Rozpoczynamy oczyszczanie.',
      retreat: 'Przerywamy oczyszczanie. Wracamy do ula.',
    },
  },
  wykonawcy: {
    name: 'Wykonawcy', color: '#9fb4c8', developed: false,
    attrs: { pilot: 5, nav: 5, sensors: 5, eng: 5, tact: 5, infl: 5 },
    ship: { hull: 100, armor: 5 }, hullRegenPct: 0,
    factions: { hawk: 'Literaliści', trade: 'Duchowi', coalition: 'Rewizjoniści' },
    voice: {
      hail: 'Tu {faction}. Klauzula 17 nakazuje pomoc sojusznikom. Zgłoś zamiar.',
      reply: 'Klauzula przyjęta. Wykonanie wspólne.',
      toll: 'Klauzula 4: przelot przez strefę dziedzictwa wymaga opłaty — cztery jednostki ładunku.',
      attack: 'Klauzula 9: naruszenie. Wykonanie.',
      retreat: 'Klauzula wykonana częściowo. Wycofanie.',
    },
  },
  heliotropi: {
    name: 'Heliotropi', color: '#ff9d5c', developed: false,
    attrs: { pilot: 5, nav: 5, sensors: 5, eng: 5, tact: 5, infl: 5 },
    ship: { hull: 100, armor: 5 }, hullRegenPct: 0,
    factions: { hawk: 'Żar', trade: 'Chłodni', coalition: 'Hibernatorzy Szlaku' },
    voice: {
      hail: 'Tu {faction}. Zwykle trzymamy się blisko gwiazdy, ale dla sojusznika zwolnimy. Lećmy razem.',
      reply: 'Ciepło we dwoje. Lecimy.',
      toll: 'Ciepło kosztuje. Cztery jednostki ładunku za przejście, albo zrobi się gorąco.',
      attack: 'Frenzja! Ogień!',
      retreat: 'Za zimno tutaj. Odchodzimy.',
    },
  },
  swietlisci: {
    name: 'Świetliści', color: '#5ff0e0', developed: false,
    attrs: { pilot: 5, nav: 5, sensors: 5, eng: 5, tact: 5, infl: 5 },
    ship: { hull: 100, armor: 5 }, hullRegenPct: 0,
    factions: { hawk: 'Czerwone Maski', trade: 'Prawdziwe Skóry', coalition: 'Dziedzice' },
    voice: {
      hail: 'Tu {faction}. Nasze maski są zdjęte — mówimy prawdę. Chcemy się sprzymierzyć.',
      reply: 'Światło nie kłamie. Lecimy razem.',
      toll: 'Płacisz opłatę: cztery jednostki ładunku. Nasze światło nie kłamie.',
      attack: 'Maski zerwane. Ogień.',
      retreat: 'Światło przygasa. Odchodzimy.',
    },
  },
};

// Relacje między rasami (skala -100..+100, z mapy relacji). Symetryczne.
// sojusz +25..30, handel +10..20, neutralność 0, napięcie -15..-20, wojna -40
const REL_PAIRS = [
  ['wybudzeni', 'rezonanci', 15], ['wybudzeni', 'wykonawcy', -40], ['wybudzeni', 'szczepieni', -15],
  ['wybudzeni', 'heliotropi', 10], ['wybudzeni', 'piesniarze', 15], ['wybudzeni', 'swietlisci', 0],
  ['rezonanci', 'wykonawcy', 25], ['rezonanci', 'szczepieni', -15], ['rezonanci', 'heliotropi', 25],
  ['rezonanci', 'piesniarze', -40], ['rezonanci', 'swietlisci', 0],
  ['wykonawcy', 'szczepieni', -20], ['wykonawcy', 'heliotropi', 0], ['wykonawcy', 'piesniarze', 0],
  ['wykonawcy', 'swietlisci', 25],
  ['szczepieni', 'heliotropi', 30], ['szczepieni', 'piesniarze', -20], ['szczepieni', 'swietlisci', 15],
  ['heliotropi', 'piesniarze', 20], ['heliotropi', 'swietlisci', -15],
  ['piesniarze', 'swietlisci', 0],
];
const REL = {};
for (const [a, b, v] of REL_PAIRS) {
  (REL[a] ??= {})[b] = v;
  (REL[b] ??= {})[a] = v;
}

/** Startowa reputacja/relacja rasy a względem rasy b (0 dla tej samej rasy). */
export function relation(a, b) {
  return a === b ? 0 : (REL[a]?.[b] ?? 0);
}

export function raceForShip(shipId) {
  return SHIP_RACE[shipId] ?? 'wybudzeni';
}

/** Statek (id modelu) używany przez daną rasę; dla ras bez własnego - losowy. */
export function shipForRace(raceId, rng = Math.random) {
  const own = Object.keys(SHIP_RACE).find((s) => SHIP_RACE[s] === raceId);
  if (own) return own;
  const all = Object.keys(SHIP_RACE);
  return all[Math.floor(rng() * all.length)];
}

/**
 * Losuje rasę w danej relacji do rasy gracza.
 * kind: 'ally' (relacja >= 15) albo 'hostile' (relacja <= -15).
 */
export function pickRaceByRelation(playerRace, kind, rng = Math.random) {
  const ids = Object.keys(RACES).filter((r) => r !== playerRace);
  let pool = ids.filter((r) => (kind === 'ally' ? relation(playerRace, r) >= 15 : relation(playerRace, r) <= -15));
  if (pool.length === 0) pool = ids; // awaryjnie: dowolna inna rasa
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Wzory z kart (kroki 3.5 rozmowy o statystykach):
 *  Nawigacja -> horyzont predykcji = 5 s x N (N=5 to dotychczasowe 25 s)
 *  Czujniki  -> zasięg = 6000 x (1 + 0.08 x (C-5))
 *  Taktyka   -> obrażenia x (1 + 0.04 x (T-5))
 *  Wpływ     -> szansa negocjacji (patrz encounters.js) i limit zobowiązań
 */
export function deriveStats(raceId) {
  const r = RACES[raceId] ?? RACES.wybudzeni;
  const a = r.attrs;
  return {
    raceId,
    attrs: { ...a },
    hull: r.ship.hull,
    armor: r.ship.armor,
    hullRegenPct: r.hullRegenPct,
    horizon: 5 * a.nav,
    sensorRange: 6000 * (1 + 0.08 * (a.sensors - 5)),
    damageMult: 1 + 0.04 * (a.tact - 5),
    influence: a.infl,
  };
}
