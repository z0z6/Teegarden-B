/**
 * Rasy, stronnictwa, relacje i wyliczanie statystyk - wersja 0.1 z kart
 * ras (rozmowa o warstwie fabularnej). Wszystkie liczby siedzą TUTAJ, w
 * jednym miejscu do strojenia; reszta gry tylko je czyta.
 *
 * Wszystkie siedem ras ma pełne karty. Pola opisujące rasę:
 *   attrs        atrybuty przykładowego kapitana (baza + modyfikatory
 *                stronnictwa + wolne punkty = 34) - z tego liczy się gra
 *   baseAttrs    baza rasy (suma 32), freePoints = wolne punkty do rozdania
 *   factionMods  modyfikatory atrybutów każdego stronnictwa (+2 / -2)
 *   ship         szablon statku (lekki myśliwiec)
 *   resource     nazwa zasobu podpisowego rasy
 *
 * UWAGA: gra używa dziś tylko: attrs, ship.hull, ship.armor, hullRegenPct,
 * factions i voice. Pozostałe pola (thermal, energy, signature, cargo,
 * slots, baseAttrs, freePoints, factionMods, resource) to dane czekające na
 * systemy, które ich użyją (Energia, Ciepło, Sygnatura, wybór stronnictwa,
 * zasoby podpisowe) - są już w kartach, żeby nie trzeba ich było potem
 * wpisywać drugi raz.
 *
 * Trzy rasy dopisane później (wykonawcy, heliotropi, swietlisci) nie mają
 * jeszcze własnych modeli statków: shipForRace() losuje dla nich model.
 */

// Losowy przydział modeli statków do rasy (wylosowany raz i zapisany, żeby
// był powtarzalny). Kiedy powstaną własne modele ras - podmień tutaj.
export const SHIP_RACE = {
  'goniec-wybudzeni-hawk-7': 'wybudzeni',
  'goniec-wybudzeni-trade-11': 'wybudzeni',
  'goniec-wybudzeni-coalition-13': 'wybudzeni',
  'goniec-wybudzeni-hawk-21': 'wybudzeni',
  'goniec-wybudzeni-trade-34': 'wybudzeni',
  'goniec-wybudzeni-coalition-58': 'wybudzeni',
  'goniec-wybudzeni-hawk-90': 'wybudzeni',
  'kryza-heliotropi-hawk-3': 'heliotropi',
  'kryza-heliotropi-trade-17': 'heliotropi',
  'kryza-heliotropi-coalition-29': 'heliotropi',
  'kryza-heliotropi-hawk-44': 'heliotropi',
};

export const RACES = {
  wybudzeni: {
    name: 'Wybudzeni', color: '#e0b15a', developed: true,
    attrs: { pilot: 5, nav: 6, sensors: 6, eng: 7, tact: 3, infl: 7 }, // kapitan Cechu Rzeczników (karta)
    ship: { hull: 100, armor: 5, thermal: 60, energy: 100, signature: 50, cargo: 20, slots: 3 }, hullRegenPct: 0,
    baseAttrs: { pilot: 5, nav: 5, sensors: 5, eng: 5, tact: 5, infl: 5 }, freePoints: 4,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, tact: -2 }, coalition: { pilot: 2, eng: -2 } },
    resource: 'Manifest',
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
    ship: { hull: 110, armor: 6, thermal: 50, energy: 100, signature: 50, cargo: 16, slots: 3 }, hullRegenPct: 0,
    baseAttrs: { pilot: 4, nav: 6, sensors: 7, eng: 5, tact: 6, infl: 4 }, freePoints: 2,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, tact: -2 }, coalition: { eng: 2, pilot: -2 } },
    resource: 'Rezonans',
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
    ship: { hull: 85, armor: 3, thermal: 45, energy: 100, signature: 40, cargo: 14, slots: 3 }, hullRegenPct: 0,
    baseAttrs: { pilot: 6, nav: 7, sensors: 7, eng: 4, tact: 4, infl: 4 }, freePoints: 2,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, pilot: -2 }, coalition: { eng: 2, tact: -2 } },
    resource: 'Horyzont',
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
    ship: { hull: 95, armor: 4, thermal: 60, energy: 90, signature: 55, cargo: 18, slots: 2 }, hullRegenPct: 0.2,
    baseAttrs: { pilot: 5, nav: 4, sensors: 5, eng: 8, tact: 5, infl: 5 }, freePoints: 2,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, tact: -2 }, coalition: { eng: 2, pilot: -2 } },
    resource: 'Szczepy',
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
    name: 'Wykonawcy', color: '#9fb4c8', developed: true,
    attrs: { pilot: 5, nav: 5, sensors: 7, eng: 7, tact: 3, infl: 7 }, // kapitan Duchowych
    ship: { hull: 105, armor: 6, thermal: 55, energy: 105, signature: 50, cargo: 15, slots: 3 }, hullRegenPct: 0,
    baseAttrs: { pilot: 5, nav: 4, sensors: 7, eng: 7, tact: 5, infl: 4 }, freePoints: 2,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, tact: -2 }, coalition: { pilot: 2, eng: -2 } },
    resource: 'Pamięć',
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
    name: 'Heliotropi', color: '#ff9d5c', developed: true,
    attrs: { pilot: 5, nav: 5, sensors: 5, eng: 6, tact: 6, infl: 7 }, // kapitan Chłodnych
    ship: { hull: 100, armor: 5, thermal: 90, energy: 95, signature: 55, cargo: 16, slots: 3 }, hullRegenPct: 0,
    baseAttrs: { pilot: 7, nav: 5, sensors: 4, eng: 5, tact: 6, infl: 5 }, freePoints: 2,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, pilot: -2 }, coalition: { nav: 2, tact: -2 } },
    resource: 'Temperatura ciała',
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
    name: 'Świetliści', color: '#5ff0e0', developed: true,
    attrs: { pilot: 5, nav: 6, sensors: 7, eng: 6, tact: 2, infl: 8 }, // kapitan Prawdziwych Skór
    ship: { hull: 90, armor: 4, thermal: 40, energy: 100, signature: 50, cargo: 14, slots: 4 }, hullRegenPct: 0,
    baseAttrs: { pilot: 5, nav: 5, sensors: 7, eng: 5, tact: 4, infl: 6 }, freePoints: 2,
    factionMods: { hawk: { tact: 2, infl: -2 }, trade: { infl: 2, tact: -2 }, coalition: { nav: 2, pilot: -2 } },
    resource: 'Blask',
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

/**
 * Statek (id modelu) dla danej rasy: losowy spośród WSZYSTKICH jej modeli
 * (rasa z kilkoma statkami pokazuje je na zmianę); dla ras bez własnego
 * modelu - losowy z całej floty.
 */
export function shipForRace(raceId, rng = Math.random) {
  const all = Object.keys(SHIP_RACE);
  const own = all.filter((s) => SHIP_RACE[s] === raceId);
  const pool = own.length ? own : all;
  return pool[Math.floor(rng() * pool.length)];
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
