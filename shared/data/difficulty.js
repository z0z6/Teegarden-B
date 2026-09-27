/**
 * POZIOMY TRUDNOŚCI KAMPANII (krok 12c) - jedno miejsce do strojenia.
 *
 * Klucze zostają te same co w walce myśliwcem (tactical-ai.js DIFFICULTY,
 * combat-rules.js), więc ?trudnosc=latwa|normalna|trudna i stare zapisy
 * działają dalej. Poziom "normalna" (Średni) to wartości bazowe z
 * shared/data/economy.js i military.js - mnożniki 1.
 *
 * Każdy poziom stroi całą kampanię (shared/systems/difficulty.js nakłada to
 * na stałe gry przy starcie i przy zmianie w menu pauzy):
 *   rasy     - okres ochronny, jak często i jak dużymi siłami atakują,
 *              bogactwo i ekspansja, skłonność do wojny i do pokoju,
 *              obrona ich pól (rajdy i szturmy grup bojowych),
 *   naloty   - jak często, ilu rabusiów, jak wytrzymali, ile zabierają,
 *   ekonomia - kredyty na start, koszt / utrzymanie / czas budowy okrętów,
 *   naprawy  - tempo i koszt remontu,
 *   myśliwiec - istniejące ustawienia walki (reakcja wrogów, trafność
 *              rakiet, amunicja, flary).
 */
export const CAMPAIGN_DIFFICULTY = {
  latwa: {
    name: 'Łatwy', tagline: 'Lekko i przyjemnie',
    desc: 'Dużo czasu na rozbudowę, rzadkie i słabe ataki, tanie okręty i naprawy. Rasy chętnie zawierają pokój.',
    strategy: {
      grace: 1200, attackEvery: 260, startCredits: 2600, startShips: 3, income: 42, maxShips: 14, fieldsCapEvery: 640,
      attackMul: 0.7, defenseMul: 0.8, warMul: 0.5, peaceMul: 1.8,
    },
    raids: {
      threatMul: 0.55, cooldown: 380, warning: 25, minRaiders: 2, maxRaiders: 4, raiderHull: 90,
      lootDrones: 6, lootTons: 180, stationLoot: 0.25, stationImmune: 15, bounty: 320, towerKills: 3,
    },
    startCredits: 2500,
    warships: { cost: 0.8, upkeep: 0.6, buildTime: 0.75 },
    repair: { rate: 1.6, cost: 0.6, combatPause: 6 },
  },
  normalna: {
    name: 'Średni', tagline: 'Ambitnie, ale do ogarnięcia',
    desc: 'Rasy rosną i walczą o pola, naloty wymagają obrony, ale dobrze prowadzona kopalnia i flota dają radę.',
    strategy: { attackMul: 1, defenseMul: 1, warMul: 1, peaceMul: 1 },
    raids: { threatMul: 1 },
    warships: { cost: 1, upkeep: 1, buildTime: 1 },
    repair: { rate: 1, cost: 1 },
  },
  trudna: {
    name: 'Trudny', tagline: 'Ambitnie',
    desc: 'Krótki okres ochronny, częste i silne ataki, bogate rasy z dobrze bronionymi polami. Każdy okręt i każda tona się liczą.',
    strategy: {
      grace: 420, attackEvery: 115, startCredits: 4500, startShips: 5, income: 66, maxShips: 30, fieldsCapEvery: 400,
      attackMul: 1.25, defenseMul: 1.2, warMul: 1.3, peaceMul: 0.6,
    },
    raids: {
      threatMul: 1.3, cooldown: 180, warning: 12, minRaiders: 3, maxRaiders: 7, raiderHull: 150,
      lootDrones: 14, lootTons: 420, stationLoot: 0.5, stationImmune: 35, bounty: 200, towerKills: 1.6,
    },
    startCredits: 1200,
    warships: { cost: 1.15, upkeep: 1.25, buildTime: 1.1 },
    repair: { rate: 0.75, cost: 1.3, combatPause: 10 },
  },
};
export const DIFFICULTY_ORDER = ['latwa', 'normalna', 'trudna'];
