/**
 * ZASADY WALKI GRACZA (krok 9) - wszystkie liczby do strojenia w jednym miejscu.
 *
 *  - poziom trudności: skuteczność rakiet gracza, zapas amunicji,
 *    przegrzewanie działek, flary (liczba i skuteczność);
 *  - uzbrojenie ras: które działka i które rakiety ma dana rasa, ile sztuk.
 *
 * Działka (pulse / photon / phase) nie mają amunicji - ogranicza je ciepło.
 * Rakiety, miny i impuls zakłócający nie grzeją - ogranicza je zapas.
 * Zapas uzupełnia się na starcie misji i po odrodzeniu.
 *
 * Starsze kroki (5-8) tego pliku nie używają: tam arsenał działa po staremu
 * (wszystkie bronie, ciepło z każdej, bez limitu).
 */

export const COMBAT_DIFFICULTY = {
  latwa: {
    hitChance: 0.95,     // szansa, że rakieta gracza (z celem) trafi
    ammoMult: 1.5,       // mnożnik zapasu rakiet, min i impulsów
    gunOverheatSec: null, // działko się nie przegrzewa
    flares: 24, flareChance: 0.85,
  },
  normalna: {
    hitChance: 0.75,
    ammoMult: 1,
    gunOverheatSec: 8,   // ciągły ogień działkiem impulsowym do przegrzania (rasa o thermal 60)
    flares: 14, flareChance: 0.65,
  },
  trudna: {
    hitChance: 0.5,
    ammoMult: 0.6,
    gunOverheatSec: 5,
    flares: 8, flareChance: 0.4,
  },
};

/**
 * Uzbrojenie ras. `guns` - działka (bez limitu, grzeją), `ammo` - reszta
 * z zapasem na poziomie normalnym (salvo liczone w SALWACH po 5 rakiet).
 * Kolejność = kolejność na pasku broni. Sokół (missile) - jedyna prawdziwie
 * samonaprowadzająca rakieta - każda rasa ma go najmniej.
 */
export const RACE_LOADOUT = {
  wybudzeni:  { guns: ['pulse', 'photon', 'phase'], ammo: { missile: 4, torpedo: 2, mine: 5 } },
  rezonanci:  { guns: ['phase'],  ammo: { dart: 10, salvo: 5, missile: 4, emp: 3 } },
  piesniarze: { guns: ['pulse'],  ammo: { salvo: 8, dart: 8, missile: 6, emp: 3 } },
  szczepieni: { guns: ['pulse'],  ammo: { salvo: 8, dart: 6, missile: 4, mine: 4 } },
  wykonawcy:  { guns: ['photon'], ammo: { dart: 8, salvo: 6, missile: 4, mine: 5 } },
  heliotropi: { guns: ['pulse'],  ammo: { salvo: 10, dart: 6, missile: 4, mine: 4 } },
  swietlisci: { guns: ['photon'], ammo: { dart: 10, salvo: 5, missile: 4, emp: 3 } },
};

export const GUNS = new Set(['pulse', 'photon', 'phase']);

/** Reguły dla poziomu trudności (nieznany klucz -> normalna). */
export function combatRules(difficulty) {
  return COMBAT_DIFFICULTY[difficulty] ?? COMBAT_DIFFICULTY.normalna;
}

/** Uzbrojenie rasy na danym poziomie: { order: [id...], ammo: { id: n } }. */
export function loadoutFor(raceId, difficulty) {
  const L = RACE_LOADOUT[raceId] ?? RACE_LOADOUT.wybudzeni;
  const mult = combatRules(difficulty).ammoMult;
  const ammo = {};
  for (const [id, n] of Object.entries(L.ammo)) ammo[id] = Math.max(1, Math.round(n * mult));
  return { order: [...L.guns, ...Object.keys(L.ammo)], ammo };
}
