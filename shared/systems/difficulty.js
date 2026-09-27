import { STRATEGY, RAIDS, START, WARSHIPS } from '../data/economy.js';
import { REPAIR } from '../data/military.js';
import { CAMPAIGN_DIFFICULTY } from '../data/difficulty.js';

/**
 * NAKŁADANIE POZIOMU TRUDNOŚCI (krok 12c).
 *
 * Stałe gry (STRATEGY, RAIDS, START, WARSHIPS, REPAIR) są importowane przez
 * wiele modułów i czytane na bieżąco - dlatego poziom zmienia je W MIEJSCU.
 * Przy pierwszym wywołaniu zapamiętujemy wartości bazowe (poziom Średni),
 * a każde applyDifficulty zaczyna od nich, więc poziomy można przełączać
 * w trakcie gry bez kumulowania mnożników.
 *
 * Wartości ze strategii i nalotów w presecie to liczby bezwzględne (np.
 * grace: 1200), mnożniki mają sufiks Mul albo są w grupach warships/repair.
 */
let base = null;
let current = 'normalna';

const clone = (o) => JSON.parse(JSON.stringify(o));
function snapshot() {
  base = {
    STRATEGY: clone(STRATEGY), RAIDS: clone(RAIDS), START: clone(START), REPAIR: clone(REPAIR),
    WARSHIPS: Object.fromEntries(Object.entries(WARSHIPS).map(([k, v]) => [k, { cost: { ...v.cost }, upkeep: v.upkeep, buildTime: v.buildTime }])),
  };
}
function restore(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  Object.assign(target, clone(src));
}

export function applyDifficulty(key) {
  if (!base) snapshot();
  const D = CAMPAIGN_DIFFICULTY[key] ?? CAMPAIGN_DIFFICULTY.normalna;
  current = CAMPAIGN_DIFFICULTY[key] ? key : 'normalna';
  restore(STRATEGY, base.STRATEGY);
  restore(RAIDS, base.RAIDS);
  restore(START, base.START);
  restore(REPAIR, base.REPAIR);

  // rasy: wartości bezwzględne + mnożniki zachowań (czytane w strategy.js)
  Object.assign(STRATEGY, D.strategy ?? {});

  // naloty: skala zagrożenia + wartości bezwzględne
  const { threatMul = 1, ...raids } = D.raids ?? {};
  RAIDS.base = base.RAIDS.base * threatMul;
  RAIDS.perDrone = base.RAIDS.perDrone * threatMul;
  RAIDS.perKrMin = base.RAIDS.perKrMin * threatMul;
  Object.assign(RAIDS, raids);

  if (D.startCredits != null) START.credits = D.startCredits;

  // okręty gracza: koszt (zaokrąglony), utrzymanie, czas budowy
  const w = D.warships ?? {};
  for (const [cls, b] of Object.entries(base.WARSHIPS)) {
    const s = WARSHIPS[cls];
    s.cost = Object.fromEntries(Object.entries(b.cost).map(([m, v]) => [m, m === 'credits' ? Math.round(v * (w.cost ?? 1) / 50) * 50 : Math.round(v * (w.cost ?? 1))]));
    s.upkeep = Math.round(b.upkeep * (w.upkeep ?? 1) * 10) / 10;
    s.buildTime = Math.round(b.buildTime * (w.buildTime ?? 1));
  }

  // naprawy: tempo i koszt
  const r = D.repair ?? {};
  REPAIR.yardRate = base.REPAIR.yardRate * (r.rate ?? 1);
  REPAIR.hqRate = base.REPAIR.hqRate * (r.rate ?? 1);
  REPAIR.rushCredits = base.REPAIR.rushCredits * (r.cost ?? 1);
  REPAIR.rushMetal = Object.fromEntries(Object.entries(base.REPAIR.rushMetal).map(([m, v]) => [m, v * (r.cost ?? 1)]));
  REPAIR.stationCredits = base.REPAIR.stationCredits * (r.cost ?? 1);
  REPAIR.stationMetal = Object.fromEntries(Object.entries(base.REPAIR.stationMetal).map(([m, v]) => [m, v * (r.cost ?? 1)]));
  REPAIR.stationDisabledFee = Math.round(base.REPAIR.stationDisabledFee * (r.cost ?? 1));
  if (r.combatPause != null) REPAIR.combatPause = r.combatPause;
  return D;
}

export const difficultyKey = () => current;
export const difficultyInfo = (key = current) => CAMPAIGN_DIFFICULTY[key] ?? CAMPAIGN_DIFFICULTY.normalna;
