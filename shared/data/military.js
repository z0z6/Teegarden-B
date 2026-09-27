/**
 * DOKTRYNA WOJSKOWA (krok 12c): liczby dla grup bojowych, szyków i misji.
 * Jedno miejsce do strojenia - logika w shared/systems/fleet-ops.js,
 * zachowanie w walce w shared/systems/tactical-ai.js (baza 'fleet').
 *
 * Szyk działa dwojako:
 *   - NA ŻYWO (układ gracza): wyznacza sloty okrętów względem "ramy" grupy
 *     (punkt + kierunek), a postawa mówi mózgowi, jak walczyć,
 *   - ZAOCZNIE (inne układy): mnoży siłę natarcia i obrony w rozstrzygnięciu.
 *
 * Współrzędne slotu: x - w prawo, y - w górę, z - DO PRZODU (kierunek ramy),
 * w jednostkach `spacing`.
 */

export const FORMATIONS = {
  klin: {
    name: 'Klin', posture: 'offensive', atk: 1.15, def: 0.95, spacing: 260,
    desc: 'Szyk natarcia: lider na czele, reszta w V. Przełamuje obronę, rozwija się w walkę przy kontakcie.',
  },
  linia: {
    name: 'Linia', posture: 'offensive', atk: 1.1, def: 1.0, spacing: 300, vsStations: 1.25,
    desc: 'Wszystkie lufy do przodu. Najlepsza do ostrzału stacji i wież.',
  },
  kleszcze: {
    name: 'Kleszcze', posture: 'offensive', atk: 1.2, def: 0.9, spacing: 320, minShips: 4,
    desc: 'Dwa skrzydła wychodzą na flanki celu i uderzają z dwóch stron. Od 4 okrętów.',
  },
  kolumna: {
    name: 'Kolumna', posture: 'transit', atk: 0.9, def: 0.85, spacing: 220, travel: 1.25,
    desc: 'Szybki przelot gęsiego. Słaba w zasadzce, ale skraca drogę o 20%.',
  },
  jez: {
    name: 'Jeż', posture: 'defensive', atk: 0.8, def: 1.3, spacing: 280,
    desc: 'Kula wokół chronionego punktu, lufy na zewnątrz. Trudna do przełamania.',
  },
  sciana: {
    name: 'Ściana', posture: 'defensive', atk: 0.95, def: 1.2, spacing: 260,
    desc: 'Płaszczyzna między zagrożeniem a polem. Obraca się frontem do wroga.',
  },
};
export const FORMATION_ORDER = ['klin', 'linia', 'kleszcze', 'kolumna', 'jez', 'sciana'];

/**
 * Zasady użycia siły: kiedy grupa się wycofa i jak mocno naciska.
 * roundCap - najwyżej taka część kadłubów grupy może paść w jednej rundzie
 * starcia zaocznego (ostrożni zrywają kontakt, zanim zginą).
 */
export const ROE = {
  agresywna:    { name: 'Agresywna', atk: 1.1, loss: 1.15, withdrawAt: 0.85, retreatHull: 0, roundCap: 1, desc: 'Walczą do wykonania zadania.' },
  zrownowazona: { name: 'Zrównoważona', atk: 1.0, loss: 1.0, withdrawAt: 0.5, retreatHull: 0.25, roundCap: 0.7, desc: 'Odwrót po utracie połowy siły.' },
  ostrozna:     { name: 'Ostrożna', atk: 0.9, loss: 0.7, withdrawAt: 0.25, retreatHull: 0.5, roundCap: 0.4, desc: 'Chronią okręty; wycofują się wcześnie.' },
};
export const ROE_ORDER = ['agresywna', 'zrownowazona', 'ostrozna'];

/**
 * Misje grup bojowych. `target`: 'own' - pole gracza, 'foreign' - pole rasy
 * (wymaga wojny, chyba że `peaceOk`), 'any' - dowolne pole.
 */
export const MISSIONS = {
  obrona: {
    name: 'Obrona pola', target: 'own', formation: 'jez', answersCalls: true,
    desc: 'Grupa trzyma szyk przy polu i odpowiada na wezwania wsparcia.',
  },
  patrol: {
    name: 'Patrol', target: 'own', formation: 'klin', answersCalls: true, multiField: true,
    desc: 'Krąży między polami gracza w układzie, przechwytuje intruzów, odpowiada na wezwania.',
  },
  zwiad: {
    name: 'Zwiad', target: 'any', formation: 'kolumna', peaceOk: true, evasive: true,
    desc: 'Przelot, obserwacja i powrót. Odkrywa pola, liczy wieże i okręty. Unika walki.',
  },
  uderzenie: {
    name: 'Uderzenie na infrastrukturę', target: 'foreign', formation: 'linia',
    desc: 'Rajd na wybrane stacje placówki rasy. Po wykonaniu zadania grupa wraca.',
  },
  zdobycie: {
    name: 'Zdobycie pola', target: 'foreign', formation: 'klin',
    desc: 'Rozbicie całej placówki. Pole staje się wolne.',
  },
};
export const MISSION_ORDER = ['obrona', 'patrol', 'zwiad', 'uderzenie', 'zdobycie'];

/**
 * Cele uderzenia na infrastrukturę: typy stacji placówki i skutek zaoczny.
 * minDevelop - od jakiego poziomu placówka ma takie stacje (rival-presence.js
 * LEVEL_TYPES: dok, magazyn, wieża, przeładunek, wieża).
 */
export const STRIKE_TARGETS = {
  obrona:     { name: 'Wieże obronne', stations: ['wieza'], minDevelop: 3, desc: 'Obrona pola słabnie o 60% na 4 min — łatwiejsze zdobycie.' },
  gospodarka: { name: 'Doki i przeładunek', stations: ['dok', 'przeladunek', 'magazyn'], drones: true, desc: 'Rasa traci kredyty, pole daje połowę dochodu przez 5 min.' },
  drony:      { name: 'Roje dronów', stations: [], drones: true, desc: 'Szybki rajd na drony górnicze. Mało ryzyka, mały zysk.' },
};
export const STRIKE_ORDER = ['obrona', 'gospodarka', 'drony'];

export const OPS = {
  travelBase: 26,        // s przelotu między układami (× 1/prędkość najwolniejszego okrętu)
  stageTimeout: 45,      // s czekania na pozostałe grupy operacji (godzina "H")
  roundEvery: 12,        // s między rundami starcia zaocznego
  scoutDwell: 14,        // s obserwacji przy polu
  intelBonus: 1.12,      // świeży zwiad (< intelFresh s) = lepsze rozstrzygnięcie
  intelFresh: 300,
  suppressTime: 240,     // s osłabionej obrony po zniszczeniu wież
  suppressMul: 0.4,
  disruptTime: 300,      // s połowy dochodu po uderzeniu na gospodarkę
  supportCooldown: 20,   // s między wezwaniami wsparcia tej samej grupy
  contactRange: 2600,    // j. - szyk natarcia rozwija się w walkę przy takim dystansie
  frameSpeed: 360,       // j/s ramy szyku w przelocie w układzie
  maxLog: 40,            // wpisów w dzienniku łączności
};

/** Nazwy grup (kolejne grupy dostają kolejne nazwy). */
export const GROUP_NAMES = ['Alfa', 'Bravo', 'Czarny Kruk', 'Delta', 'Echo', 'Żuraw', 'Grot', 'Halny', 'Iskra', 'Jastrząb'];

/**
 * NAPRAWY (krok 12c). Okręty naprawiają się tylko w układzie z zapleczem
 * i tylko poza walką (combatPause s od ostatniego trafienia):
 *   stocznia  - yardRate kadłuba na sekundę, darmowo,
 *   siedziba  - hqRate (naprawa polowa: wolniej, też darmowo),
 *   remont przyspieszony - rushRate/s, płatny z góry za brakujący kadłub
 *              (rushCredits kr i rushMetal t za punkt kadłuba); wymaga zaplecza.
 * Stacje: odrastają same (economy.js, 1%/s); remont przyspieszony stacji
 * przywraca je od razu do pracy (splądrowana / wyłączona wieża) i dokańcza
 * kadłub w stationRushRate/s.
 */
export const REPAIR = {
  yardRate: 0.01,
  hqRate: 0.003,
  rushRate: 0.05,
  rushCredits: 1.1,
  rushMetal: { zelazo: 0.07, nikiel: 0.02 },
  combatPause: 8,
  stationCredits: 0.5,
  stationMetal: { zelazo: 0.05 },
  stationRushRate: 0.08,
  stationDisabledFee: 120, // kr za przywrócenie do pracy splądrowanej / wyłączonej stacji
};
