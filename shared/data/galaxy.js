import { RACES, relation as baseRelation } from './races.js';

/**
 * ZNANY WSZECHŚWIAT - galaktyka jako policzalny katalog układów, podzielony na
 * sektory, z domenami ras, gradientem militaryzacji i zasadami dostępu.
 *
 * Moduł jest czystą logiką (bez three.js), więc działa w przeglądarce i w
 * Node (testy: tools/galaxy-map/check.mjs). Stan to zwykłe obiekty/tablice -
 * da się go zapisać (exportState) i odtworzyć (createGalaxy + importState).
 *
 * SKALA. Domyślnie 12 000 układów w 96 sektorach, dysk o promieniu 1000 lat
 * świetlnych. Każdy układ ma numer, pozycję, gwiazdę, sektor i przynależność -
 * wszechświat jest "ogromny, ale policzalny": można go wyliczyć, zliczyć i
 * zapisać, a ta sama liczba ziarna daje zawsze tę samą galaktykę.
 *
 * WARSTWY (tier), od najgęściej bronionej:
 *   capital  stolica rasy (siedziba władzy; może się przenieść po odwrocie)
 *   core     układy core'owe: stolica + kilkanaście najbliższych układów
 *   domain   reszta sektorów domeny rasy
 *   march    pogranicze: niczyje sektory przylegające do domen
 *   wild     dzicz: reszta galaktyki (w tym Jądro galaktyki)
 * Planeta macierzysta (homeworld) to osobne pole rasy: na starcie = stolica,
 * po odwrocie zostaje w starym miejscu jako utracona.
 *
 * NIEZMIENNIKI (pilnuje ich check.mjs):
 *   1. Pojedyncza siła (jedna rasa, jeden gracz) nie prowadzi działań
 *      zbrojnych w układach core'owych ani w stolicy obcej rasy.
 *   2. Odwrót z domeny wymusza tylko skoordynowana koalicja co najmniej
 *      dwóch ras (RULES), wroga celowi i zgodna między sobą.
 *   3. Odwrót nie niszczy rasy: rasa zawsze ma stolicę, rdzeń i flotę,
 *      przenosi się i odbudowuje siłę.
 */

// ============================================================
// PARAMETRY (jedno miejsce do strojenia, jak races.js)
// ============================================================
export const GALAXY_DEFAULTS = {
  seed: 20260923,
  systemCount: 12000,
  sectorCount: 96,
  radius: 1000,          // lata świetlne
  bulgeRadius: 170,      // Jądro: nikt go nie zajmuje
  domainSectors: 5,      // sektory domeny na rasę na starcie
  coreSize: 12,          // stolica + 11 układów
};

export const RULES = {
  coalitionMin: 2,             // minimum ras w koalicji
  partnerMinRelation: 10,      // partnerzy: co najmniej handel (+10)
  targetMaxRelation: -15,      // każdy partner co najmniej w napięciu z celem
  minReadiness: 0.6,           // gotowość (siła/maks.) potrzebna, by ruszyć na kampanię
  commit: 0.6,                 // część floty rzucona do kampanii (reszta broni domu)
  coreDefenseBonus: 1.8,       // przewaga obrońcy w rdzeniu (umocnienia)
  targetAttrition: 0.06,       // straty celu na cykl = P x to
  attackerAttrition: 0.035,    // straty napastników na cykl = D x to (dzielone)
  breakPoint: 0.35,            // gotowość celu, przy której się wycofuje
  attackerAbort: 0.4,          // gotowość napastnika, przy której koalicja się sypie
  maxCampaignCycles: 30,
  retreatReadiness: 0.3,       // z czym rasa wychodzi z odwrotu (flota ocalała)
  rebuildPerCycle: 0.05,       // odbudowa po odwrocie (część maks./cykl)
  regenPerCycle: 0.02,         // zwykła regeneracja
  graceCycles: 12,             // okres ochronny nowego rdzenia
  grudge: -60,                 // relacja z napastnikami po odwrocie
  allyRelation: 15,            // od tej wartości: sojusznik (przelot, eskorta w rdzeniu)
};

export const TIERS = {
  capital: { name: 'Stolica' },
  core: { name: 'Układ core\'owy' },
  domain: { name: 'Domena' },
  march: { name: 'Pogranicze' },
  wild: { name: 'Dzicz' },
};

// Typy gwiazd = klucze STAR_TYPES z shared/systems/star-surface.js, żeby
// każdy układ z katalogu dało się kiedyś zbudować tym samym kodem co krok 8.
const STAR_WEIGHTS = [
  ['redDwarf', 0.62], ['orangeDwarf', 0.15], ['yellowDwarf', 0.1],
  ['whiteDwarf', 0.07], ['redGiant', 0.045], ['blueSupergiant', 0.015],
];
export const STAR_NAMES = {
  redDwarf: 'czerwony karzeł', orangeDwarf: 'pomarańczowy karzeł', yellowDwarf: 'żółta gwiazda',
  whiteDwarf: 'biały karzeł', redGiant: 'czerwony olbrzym', blueSupergiant: 'błękitny nadolbrzym',
};

// Gdzie rasy lubią mieć stolicę (propozycja z lore kart, jak wizerunki ras)
// i jak się ta stolica nazywa. Kolejne stolice po odwrocie dostają numer.
const RACE_HOME = {
  wybudzeni: { prefers: ['redDwarf', 'orangeDwarf'], capital: 'Pierwszy Rejestr' },
  rezonanci: { prefers: ['whiteDwarf', 'yellowDwarf'], capital: 'Dolina Rezonansu' },
  piesniarze: { prefers: ['redGiant', 'yellowDwarf'], capital: 'Pierwsza Pieśń' },
  szczepieni: { prefers: ['orangeDwarf', 'yellowDwarf'], capital: 'Ul Macierzysty' },
  wykonawcy: { prefers: ['whiteDwarf', 'redDwarf'], capital: 'Archiwum Klauzul' },
  heliotropi: { prefers: ['blueSupergiant', 'yellowDwarf'], capital: 'Zenit' },
  swietlisci: { prefers: ['yellowDwarf', 'blueSupergiant'], capital: 'Źródło Blasku' },
};

// Ręcznie zrobione układy z kroku 8 (klucze SYSTEMS w star-systems.js) -
// leżą w jednym neutralnym sektorze na styku domen: Rubieży Teegardena.
export const ANCHORS = [
  { id: 'teegarden', name: 'Gwiazda Teegardena', star: 'redDwarf' },
  { id: 'potrojny', name: 'Teegarden-B: układ potrójny', star: 'yellowDwarf' },
  { id: 'blizniaki', name: 'Bliźnięta', star: 'yellowDwarf' },
  { id: 'symbiotyczny', name: 'Oddech olbrzyma', star: 'redGiant' },
  { id: 'nadolbrzym', name: 'Błękitny nadolbrzym', star: 'blueSupergiant' },
];
export const ANCHOR_SECTOR_NAME = 'Rubież Teegardena';

const GREEK = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Jota', 'Kappa'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

// ============================================================
// NARZĘDZIA
// ============================================================
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const relKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const SYL_A = ['ka', 'ro', 've', 'ta', 'mi', 'o', 'a', 'dra', 'ze', 'lu', 'se', 'ko', 'i', 'na', 'vo', 're', 'ga', 'ty', 'ne', 'sa', 'u', 'be', 'kra', 'ra', 'we', 'de', 'ha', 'jo', 'ma', 'pe', 'szo', 'ce'];
const SYL_B = ['l', 'n', 'r', 's', 'th', 'm', 'k', 'rn', 'st', 'sz', 'w', 'x', 'd', 'ld', 'nt', ''];
function makeName(rng, parts) {
  let s = '';
  for (let i = 0; i < parts; i++) s += SYL_A[Math.floor(rng() * SYL_A.length)] + (i === parts - 1 || rng() < 0.4 ? SYL_B[Math.floor(rng() * SYL_B.length)] : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pickWeighted(rng, table) {
  let r = rng();
  for (const [v, w] of table) { if ((r -= w) <= 0) return v; }
  return table[table.length - 1][0];
}

// Siatka przestrzenna do szybkich zapytań "kto jest blisko".
function makeGrid(cell) {
  const map = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  return {
    add(p) { const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell)); (map.get(k) ?? map.set(k, []).get(k)).push(p); },
    near(x, y, r, fn) {
      const c0x = Math.floor((x - r) / cell), c1x = Math.floor((x + r) / cell);
      const c0y = Math.floor((y - r) / cell), c1y = Math.floor((y + r) / cell);
      for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) {
        const arr = map.get(key(cx, cy));
        if (arr) for (const p of arr) fn(p);
      }
    },
  };
}

// ============================================================
// GENEROWANIE
// ============================================================
/**
 * Buduje galaktykę. Ten sam `seed` = ta sama galaktyka (pozycje, nazwy,
 * domeny). Stan zmienny (relacje, kampanie, przeniesienia) można potem
 * nałożyć przez importState.
 */
export function createGalaxy(options = {}) {
  const o = { ...GALAXY_DEFAULTS, ...options };
  const rng = mulberry32(o.seed);
  const raceIds = Object.keys(RACES);

  // ---------------- układy: zgrubienie + ramiona spiralne + dysk ----------------
  const systems = [];
  const minSep = Math.sqrt((Math.PI * o.radius * o.radius) / o.systemCount) * 0.35;
  const grid = makeGrid(minSep * 2);
  const arms = 4, twist = 2.6;
  let tries = 0;
  while (systems.length < o.systemCount && tries < o.systemCount * 40) {
    tries++;
    const u = rng();
    let r, a;
    if (u < 0.22) {                        // zgrubienie centralne
      r = o.bulgeRadius * 1.6 * Math.sqrt(-Math.log(1 - rng() * 0.98)) * 0.55;
      a = rng() * Math.PI * 2;
    } else if (u < 0.85) {                 // ramiona
      r = o.bulgeRadius * 0.6 + rng() ** 0.8 * (o.radius - o.bulgeRadius * 0.6);
      const arm = Math.floor(rng() * arms);
      const spread = 0.28 + 0.25 * (1 - r / o.radius);
      a = arm * (Math.PI * 2 / arms) + twist * Math.log(1 + r / o.bulgeRadius) + (rng() + rng() + rng() - 1.5) * spread;
    } else {                               // rozproszony dysk między ramionami
      r = Math.sqrt(rng()) * o.radius;
      a = rng() * Math.PI * 2;
    }
    if (r > o.radius) continue;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    let ok = true;
    grid.near(x, y, minSep, (p) => { if (ok && Math.hypot(p.x - x, p.y - y) < minSep) ok = false; });
    if (!ok) continue;
    const s = { id: systems.length, x, y, star: pickWeighted(rng, STAR_WEIGHTS), sector: -1, owner: null, tier: 'wild' };
    systems.push(s);
    grid.add(s);
  }

  // nazwy (unikalne w katalogu)
  const used = new Set();
  for (const s of systems) {
    const base = makeName(rng, rng() < 0.7 ? 2 : 3);
    let n = base;
    for (let k = 0; used.has(n); k++) n = `${base} ${GREEK[k % GREEK.length]}${k >= GREEK.length ? ` ${Math.floor(k / GREEK.length) + 1}` : ''}`;
    used.add(n);
    s.name = n;
  }

  // ---------------- sektory: rozkład najdalszego punktu + kilka kroków k-średnich ----------------
  let centers = [{ x: systems[0].x, y: systems[0].y }];
  const minD = new Float64Array(systems.length).fill(Infinity);
  while (centers.length < o.sectorCount) {
    const c = centers[centers.length - 1];
    let best = 0;
    for (let i = 0; i < systems.length; i++) {
      minD[i] = Math.min(minD[i], dist(systems[i], c));
      if (minD[i] > minD[best]) best = i;
    }
    centers.push({ x: systems[best].x, y: systems[best].y });
  }
  for (let iter = 0; iter < 8; iter++) {
    const acc = centers.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const s of systems) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < centers.length; i++) { const d = dist(s, centers[i]); if (d < bd) { bd = d; bi = i; } }
      s.sector = bi;
      acc[bi].x += s.x; acc[bi].y += s.y; acc[bi].n++;
    }
    centers = centers.map((c, i) => (acc[i].n ? { x: acc[i].x / acc[i].n, y: acc[i].y / acc[i].n } : c));
  }
  const sectors = centers.map((c, i) => ({
    id: i, x: c.x, y: c.y, systems: [], neighbors: [], owner: null,
    bulge: Math.hypot(c.x, c.y) < o.bulgeRadius, anchor: false, name: '',
  }));
  for (const s of systems) sectors[s.sector].systems.push(s.id);
  for (const sec of sectors) sec.name = sec.bulge ? `Jądro ${ROMAN[(sec.id % 9) + 1]}` : `Sektor ${makeName(rng, 2)}`;

  // sąsiedztwo sektorów: dwa sektory są sąsiadami, jeśli ich układy stykają się
  const linkR = minSep * 4;
  const adj = sectors.map(() => new Set());
  for (const s of systems) {
    grid.near(s.x, s.y, linkR, (p) => {
      if (p.sector !== s.sector && Math.hypot(p.x - s.x, p.y - s.y) < linkR) { adj[s.sector].add(p.sector); adj[p.sector].add(s.sector); }
    });
  }
  sectors.forEach((sec, i) => { sec.neighbors = [...adj[i]].sort((a, b) => a - b); });

  // ---------------- rasy: sektory macierzyste daleko od siebie ----------------
  const candidates = sectors.filter((s) => !s.bulge && s.systems.length >= o.coreSize * 2)
    .filter((s) => { const r = Math.hypot(s.x, s.y); return r > o.radius * 0.35 && r < o.radius * 0.85; });
  let bestSet = null, bestScore = -1;
  for (let t = 0; t < 40; t++) {
    const chosen = [candidates[Math.floor(rng() * candidates.length)]];
    while (chosen.length < raceIds.length) {
      let pick = null, pd = -1;
      for (const c of candidates) {
        if (chosen.includes(c)) continue;
        const d = Math.min(...chosen.map((h) => dist(h, c))) * (0.85 + rng() * 0.3);
        if (d > pd) { pd = d; pick = c; }
      }
      chosen.push(pick);
    }
    let score = Infinity;
    for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) score = Math.min(score, dist(chosen[i], chosen[j]));
    if (score > bestScore) { bestScore = score; bestSet = chosen; }
  }

  const races = {};
  raceIds.forEach((rid, i) => {
    const sec = bestSet[i];
    const cap = chooseCapital(systems, sec.systems, rid, sec);
    const maxStrength = Math.round(1000 * (1 + 0.05 * ((RACES[rid].baseAttrs?.tact ?? 5) - 5)));
    races[rid] = {
      id: rid, name: RACES[rid].name, color: RACES[rid].color,
      homeworld: cap, homeworldLost: false,
      capital: cap, capitalName: RACE_HOME[rid].capital, capitals: [cap], seats: 1,
      core: [], domainSectors: [sec.id],
      maxStrength, strength: maxStrength,
      rebuilding: false, graceUntil: 0,
    };
    sec.owner = rid;
  });

  // domeny rosną po kolei (runda po rundzie), w najbliższe wolne sektory
  for (let round = 1; round < o.domainSectors; round++) {
    for (const rid of raceIds) {
      const r = races[rid];
      let pick = null, pd = Infinity;
      for (const sid of r.domainSectors) for (const nid of sectors[sid].neighbors) {
        const n = sectors[nid];
        if (n.owner || n.bulge) continue;
        const d = dist(n, systems[r.capital]);
        if (d < pd) { pd = d; pick = n; }
      }
      if (pick) { pick.owner = rid; r.domainSectors.push(pick.id); }
    }
  }

  // Rubież Teegardena: wolny sektor na styku jak największej liczby domen
  let anchorSec = null, anchorScore = -1;
  for (const sec of sectors) {
    if (sec.owner || sec.bulge || sec.systems.length < ANCHORS.length * 3) continue;
    const touching = new Set(sec.neighbors.map((n) => sectors[n].owner).filter(Boolean));
    const score = touching.size * 1000 - Math.abs(Math.hypot(sec.x, sec.y) - o.radius * 0.55);
    if (score > anchorScore) { anchorScore = score; anchorSec = sec; }
  }
  if (anchorSec) {
    anchorSec.anchor = true;
    anchorSec.name = ANCHOR_SECTOR_NAME;
    const pts = [...anchorSec.systems].sort((a, b) => dist(systems[a], anchorSec) - dist(systems[b], anchorSec));
    const chosen = [pts[0]];
    while (chosen.length < ANCHORS.length) {
      let pick = -1, pd = -1;
      for (const id of pts) {
        if (chosen.includes(id)) continue;
        const d = Math.min(...chosen.map((c) => dist(systems[c], systems[id])));
        if (d > pd && dist(systems[id], anchorSec) < 60) { pd = d; pick = id; }
      }
      chosen.push(pick >= 0 ? pick : pts.find((p) => !chosen.includes(p)));
    }
    ANCHORS.forEach((a, i) => {
      const s = systems[chosen[i]];
      s.anchor = a.id; s.name = a.name; s.star = a.star;
    });
  }

  // relacje: kopia startowych z races.js - w galaktyce się zmieniają
  const relations = {};
  for (let i = 0; i < raceIds.length; i++) for (let j = i + 1; j < raceIds.length; j++) {
    relations[relKey(raceIds[i], raceIds[j])] = baseRelation(raceIds[i], raceIds[j]);
  }

  const g = {
    options: o, systems, sectors, races, relations,
    campaigns: [], cycle: 0, log: [], nextCampaignId: 1,
  };
  for (const rid of raceIds) races[rid].core = computeCore(g, rid);
  recomputeTiers(g);
  return g;
}

function chooseCapital(systems, ids, rid, near) {
  const prefs = RACE_HOME[rid]?.prefers ?? [];
  let best = ids[0], bestScore = Infinity;
  for (const id of ids) {
    const s = systems[id];
    const rank = prefs.indexOf(s.star);
    const score = (rank < 0 ? 3 : rank) * 10000 + dist(s, near);
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

function computeCore(g, rid) {
  const r = g.races[rid];
  const cap = g.systems[r.capital];
  const pool = [];
  for (const sid of r.domainSectors) for (const id of g.sectors[sid].systems) pool.push(id);
  pool.sort((a, b) => dist(g.systems[a], cap) - dist(g.systems[b], cap));
  return pool.slice(0, g.options.coreSize);
}

/** Przelicza owner/tier każdego układu z danych ras i sektorów. */
export function recomputeTiers(g) {
  for (const sec of g.sectors) {
    for (const id of sec.systems) {
      const s = g.systems[id];
      s.owner = sec.owner;
      if (sec.owner) s.tier = 'domain';
      else if (!sec.bulge && sec.neighbors.some((n) => g.sectors[n].owner)) s.tier = 'march';
      else s.tier = 'wild';
      s.marchOf = s.tier === 'march' ? [...new Set(sec.neighbors.map((n) => g.sectors[n].owner).filter(Boolean))] : null;
    }
  }
  for (const r of Object.values(g.races)) {
    for (const id of r.core) { g.systems[id].tier = 'core'; g.systems[id].owner = r.id; }
    g.systems[r.capital].tier = 'capital';
    g.systems[r.capital].owner = r.id;
  }
}

// ============================================================
// ZAPYTANIA
// ============================================================
export function relation(g, a, b) {
  if (!a || !b || a === b) return 0;
  return g.relations[relKey(a, b)] ?? 0;
}
export function adjustRelation(g, a, b, delta) {
  if (a === b) return 0;
  const k = relKey(a, b);
  g.relations[k] = clamp((g.relations[k] ?? 0) + delta, -100, 100);
  return g.relations[k];
}
export function readiness(g, rid) {
  const r = g.races[rid];
  return r ? r.strength / r.maxStrength : 0;
}
export function activeCampaignAgainst(g, rid) {
  return g.campaigns.find((c) => c.status === 'active' && c.target === rid) ?? null;
}
function activeCampaignOf(g, rid) {
  return g.campaigns.find((c) => c.status === 'active' && (c.target === rid || c.attackers.includes(rid))) ?? null;
}

/**
 * Militaryzacja układu 0..100: jak gęsto jest broniony. Rdzeń i stolica są
 * zawsze najsilniejsze w domenie; gotowość rasy (siła/maks.) ją skaluje,
 * więc nowy rdzeń po odwrocie jest słabszy i rośnie w miarę odbudowy.
 */
export function militarization(g, systemId) {
  const s = g.systems[systemId];
  if (s.tier === 'wild') return g.sectors[s.sector].bulge ? 18 : 4;
  if (s.tier === 'march') return Math.min(32, 12 + 7 * (s.marchOf?.length ?? 1));
  const r = g.races[s.owner];
  const ready = 0.55 + 0.45 * readiness(g, s.owner);
  const cap = g.systems[r.capital];
  if (s.tier === 'capital') return Math.round(100 * ready);
  if (s.tier === 'core') {
    const far = Math.max(...r.core.map((id) => dist(g.systems[id], cap))) || 1;
    return Math.round((80 + 15 * (1 - dist(s, cap) / far)) * ready);
  }
  const falloff = clamp(1 - dist(s, cap) / (g.options.radius * 0.5), 0, 1);
  return Math.round((35 + 25 * falloff) * ready);
}

/**
 * Czy koalicja `attackers` może zaatakować rdzeń rasy `target`.
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function validCoalition(g, attackers, target) {
  const reasons = [];
  const a = [...new Set(attackers)];
  const tName = g.races[target]?.name ?? target;
  if (!g.races[target]) reasons.push('Nieznana rasa celu.');
  if (a.includes(target)) reasons.push('Rasa nie może atakować samej siebie.');
  if (a.length < RULES.coalitionMin) reasons.push(`Do ataku na rdzeń potrzeba co najmniej ${RULES.coalitionMin} ras — pojedyncza siła nie przebije obrony.`);
  for (const x of a) {
    if (!g.races[x]) { reasons.push(`Nieznana rasa: ${x}.`); continue; }
    const rel = relation(g, x, target);
    if (rel > RULES.targetMaxRelation) reasons.push(`${g.races[x].name}: relacja z ${tName} to ${rel} — za mało wrogości (potrzeba ≤ ${RULES.targetMaxRelation}).`);
    if (readiness(g, x) < RULES.minReadiness) reasons.push(`${g.races[x].name}: gotowość ${Math.round(readiness(g, x) * 100)}% — za słaba flota (potrzeba ${RULES.minReadiness * 100}%).`);
    if (activeCampaignOf(g, x)) reasons.push(`${g.races[x].name}: jest już w innej kampanii.`);
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    const rel = relation(g, a[i], a[j]);
    if (rel < RULES.partnerMinRelation) reasons.push(`${g.races[a[i]]?.name} i ${g.races[a[j]]?.name}: relacja ${rel} — nie skoordynują ataku (potrzeba ≥ ${RULES.partnerMinRelation}).`);
  }
  if (g.races[target]) {
    if (g.races[target].graceUntil > g.cycle) reasons.push(`${tName}: nowy rdzeń w okresie ochronnym jeszcze ${g.races[target].graceUntil - g.cycle} cykli.`);
    if (activeCampaignOf(g, target)) reasons.push(`${tName}: toczy już kampanię.`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Czy siła złożona z `forces` (lista ras; gracz liczy się jako swoja rasa)
 * może prowadzić DZIAŁANIA ZBROJNE w układzie.
 */
export function canOperate(g, systemId, forces) {
  const s = g.systems[systemId];
  const f = [...new Set(forces)];
  if (s.tier === 'capital' || s.tier === 'core') {
    if (f.includes(s.owner)) return { ok: true, reasons: [] };
    const c = activeCampaignAgainst(g, s.owner);
    if (c && f.every((x) => c.attackers.includes(x))) return { ok: true, reasons: [], campaign: c.id };
    return validCoalition(g, f, s.owner);
  }
  return { ok: true, reasons: [] };
}

/**
 * Co spotka pojedynczy statek rasy `raceId` (np. gracza) w układzie.
 * level: free | toll | patrol | escort | closed | front
 * `militaryOps` - czy może tam walczyć sam.
 */
export function accessFor(g, systemId, raceId) {
  const s = g.systems[systemId];
  if (s.tier === 'wild') {
    return g.sectors[s.sector].bulge
      ? { level: 'free', militaryOps: true, text: 'Jądro galaktyki: niczyje, niebezpieczne (promieniowanie, piraci).' }
      : { level: 'free', militaryOps: true, text: 'Dzicz: nikt tu nie rządzi.' };
  }
  if (s.tier === 'march') {
    const names = s.marchOf.map((r) => g.races[r].name).join(', ');
    return { level: 'patrol', militaryOps: true, text: `Pogranicze (${names}): rzadkie patrole, potyczki możliwe.` };
  }
  if (s.owner === raceId) return { level: 'free', militaryOps: true, text: 'Własna domena.' };
  const owner = g.races[s.owner];
  const rel = relation(g, raceId, s.owner);
  if (s.tier === 'domain') {
    if (rel >= RULES.allyRelation) return { level: 'free', militaryOps: false, text: `Domena sojusznika (${owner.name}): swobodny przelot.` };
    if (rel > RULES.targetMaxRelation) return { level: 'toll', militaryOps: false, text: `Domena ${owner.name}: przelot za myto.` };
    return { level: 'patrol', militaryOps: true, text: `Wroga domena ${owner.name}: gęste patrole, możliwe rajdy — ale bez utrzymania terenu.` };
  }
  // rdzeń / stolica
  const c = activeCampaignAgainst(g, s.owner);
  if (c && c.attackers.includes(raceId)) return { level: 'front', militaryOps: true, text: `Front kampanii przeciw ${owner.name}: wejście w szyku koalicji.` };
  if (rel >= RULES.allyRelation) return { level: 'escort', militaryOps: false, text: `Rdzeń sojusznika (${owner.name}): wejście tylko pod eskortą, bez broni.` };
  return { level: 'closed', militaryOps: false, text: `Rdzeń ${owner.name}: strefa zamknięta. Zakłócenie fałdy na granicy, pojedynczy statek nie przejdzie.` };
}

// ============================================================
// KAMPANIE I CYKLE
// ============================================================
function logEvent(g, text, kind = 'info') {
  const e = { cycle: g.cycle, text, kind };
  g.log.push(e);
  return e;
}

/** Rozpoczyna kampanię koalicji przeciw rdzeniowi rasy `target`. */
export function startCampaign(g, attackers, target) {
  const a = [...new Set(attackers)];
  const v = validCoalition(g, a, target);
  if (!v.ok) return { ok: false, reasons: v.reasons };
  const c = { id: g.nextCampaignId++, attackers: a, target, startCycle: g.cycle, status: 'active', cycles: 0, startReadiness: readiness(g, target) };
  g.campaigns.push(c);
  logEvent(g, `Koalicja ${a.map((x) => g.races[x].name).join(' + ')} rusza na rdzeń ${g.races[target].name}.`, 'war');
  return { ok: true, campaign: c };
}

function logistics(g, from, to) {
  const d = dist(g.systems[g.races[from].capital], g.systems[g.races[to].capital]);
  // zaopatrzenie z dalekiej stolicy słabnie, ale nie zeruje się: 0,6..1
  return clamp(1.2 - d / (g.options.radius * 3), 0.6, 1);
}

/**
 * Posuwa strategiczny czas o `n` cykli. Zwraca zdarzenia z tych cykli.
 * Cykl to jednostka strategiczna (np. jedna sesja / jeden skok gracza) -
 * celowo odklejona od czasu lotu.
 */
export function advance(g, n = 1) {
  const events = [];
  for (let step = 0; step < n; step++) {
    g.cycle++;
    const busy = new Set();
    for (const c of g.campaigns) {
      if (c.status !== 'active') continue;
      c.cycles++;
      const t = g.races[c.target];
      c.attackers.forEach((x) => busy.add(x));
      busy.add(c.target);

      // koalicja trzyma się tylko, dopóki partnerzy się dogadują
      const broken = [];
      for (let i = 0; i < c.attackers.length; i++) for (let j = i + 1; j < c.attackers.length; j++) {
        if (relation(g, c.attackers[i], c.attackers[j]) < RULES.partnerMinRelation) broken.push([c.attackers[i], c.attackers[j]]);
      }
      if (broken.length) { endCampaign(g, c, 'failed', events, 'koalicja rozpadła się (partnerzy skłócili się)'); continue; }

      const contrib = c.attackers.map((x) => g.races[x].strength * RULES.commit * logistics(g, x, c.target));
      const P = contrib.reduce((s, v) => s + v, 0);
      const D = t.strength * RULES.coreDefenseBonus;
      t.strength = Math.max(0, t.strength - P * RULES.targetAttrition);
      c.attackers.forEach((x, i) => {
        const r = g.races[x];
        r.strength = Math.max(0, r.strength - D * RULES.attackerAttrition * (contrib[i] / P));
      });
      c.pressure = P / D;

      if (readiness(g, c.target) <= RULES.breakPoint) { retreat(g, c, events); continue; }
      const weak = c.attackers.find((x) => readiness(g, x) < RULES.attackerAbort);
      if (weak) { endCampaign(g, c, 'failed', events, `${g.races[weak].name} nie utrzyma frontu`); continue; }
      if (c.cycles >= RULES.maxCampaignCycles) { endCampaign(g, c, 'failed', events, 'oblężenie przeciągnęło się'); continue; }
    }
    // regeneracja / odbudowa ras, które nie walczą
    for (const r of Object.values(g.races)) {
      if (busy.has(r.id)) continue;
      const rate = r.rebuilding ? RULES.rebuildPerCycle : RULES.regenPerCycle;
      r.strength = Math.min(r.maxStrength, r.strength + r.maxStrength * rate);
      if (r.rebuilding && readiness(g, r.id) >= 0.9) {
        r.rebuilding = false;
        events.push(logEvent(g, `${r.name}: flota odbudowana w nowym rdzeniu (${r.capitalName}).`, 'info'));
      }
    }
  }
  return events;
}

function endCampaign(g, c, status, events, why) {
  c.status = status;
  c.endCycle = g.cycle;
  const names = c.attackers.map((x) => g.races[x].name).join(' + ');
  events.push(logEvent(g, `Kampania ${names} przeciw ${g.races[c.target].name} przerwana: ${why}. Rdzeń utrzymany.`, 'fail'));
}

/**
 * Odwrót: rasa oddaje sektory swojego rdzenia napastnikom, przenosi stolicę
 * w inny rejon i zaczyna odbudowę. Nigdy nie znika.
 */
function retreat(g, c, events) {
  const t = g.races[c.target];
  const oldCap = g.systems[t.capital];
  c.status = 'won';
  c.endCycle = g.cycle;

  // 1. sektory z układami rdzenia przechodzą na napastników (najbliższa stolica)
  const lost = [...new Set(t.core.map((id) => g.systems[id].sector))];
  for (const sid of lost) {
    const sec = g.sectors[sid];
    let taker = c.attackers[0], td = Infinity;
    for (const x of c.attackers) { const d = dist(sec, g.systems[g.races[x].capital]); if (d < td) { td = d; taker = x; } }
    sec.owner = taker;
    sec.occupiedFrom = t.id;
    g.races[taker].domainSectors.push(sid);
  }
  t.domainSectors = t.domainSectors.filter((sid) => !lost.includes(sid));
  if (t.homeworld === t.capital) t.homeworldLost = true;

  // 2. nowy rejon: jak najdalej od napastników, ale nie na drugim końcu galaktyki
  const enemyCaps = c.attackers.map((x) => g.systems[g.races[x].capital]);
  const scoreSector = (sec) => Math.min(...enemyCaps.map((e) => dist(sec, e))) - 0.35 * dist(sec, oldCap);
  // nie osiada w sektorze, w którym leży czyjś rdzeń (w tym stary własny)
  const coreSectors = new Set();
  for (const r of Object.values(g.races)) for (const id of r.core) coreSectors.add(g.systems[id].sector);
  const usable = (sec) => !sec.bulge && !sec.anchor && !coreSectors.has(sec.id) && sec.systems.length >= g.options.coreSize;
  let options = t.domainSectors.map((sid) => g.sectors[sid]).filter(usable);
  const frontier = new Set();
  for (const sid of [...t.domainSectors, ...lost]) for (const n of g.sectors[sid].neighbors) if (!g.sectors[n].owner) frontier.add(n);
  options = options.concat([...frontier].map((sid) => g.sectors[sid]).filter(usable));
  if (!options.length) options = g.sectors.filter((s) => !s.owner && usable(s));
  if (!options.length) options = g.sectors.filter((s) => usable(s) && !c.attackers.includes(s.owner));
  const dest = options.reduce((best, s) => (scoreSector(s) > scoreSector(best) ? s : best));
  if (dest.owner !== t.id) {
    if (dest.owner) g.races[dest.owner].domainSectors = g.races[dest.owner].domainSectors.filter((s) => s !== dest.id);
    dest.owner = t.id;
    t.domainSectors.push(dest.id);
  }

  // 3. nowa stolica i rdzeń, flota ocalała, okres ochronny
  t.seats++;
  t.capital = chooseCapital(g.systems, dest.systems, t.id, dest);
  t.capitals.push(t.capital);
  t.capitalName = `${RACE_HOME[t.id].capital} ${ROMAN[t.seats] ?? t.seats}`;
  t.core = computeCore(g, t.id);
  t.strength = Math.max(t.strength, t.maxStrength * RULES.retreatReadiness);
  t.rebuilding = true;
  t.graceUntil = g.cycle + RULES.graceCycles;
  for (const x of c.attackers) {
    const k = relKey(x, t.id);
    g.relations[k] = Math.min(g.relations[k], RULES.grudge);
  }
  for (let i = 0; i < c.attackers.length; i++) for (let j = i + 1; j < c.attackers.length; j++) adjustRelation(g, c.attackers[i], c.attackers[j], 5);
  recomputeTiers(g);

  const names = c.attackers.map((x) => g.races[x].name).join(' + ');
  events.push(logEvent(g, `${t.name} wycofują się z rdzenia pod naporem koalicji ${names}. Utracone sektory: ${lost.map((s) => g.sectors[s].name).join(', ')}.`, 'war'));
  events.push(logEvent(g, `${t.name}: nowa stolica ${t.capitalName} w sektorze ${dest.name}. Odbudowa floty, okres ochronny ${RULES.graceCycles} cykli.`, 'info'));
}

// ============================================================
// STATYSTYKI I ZAPIS
// ============================================================
export function galaxyStats(g) {
  const byTier = { capital: 0, core: 0, domain: 0, march: 0, wild: 0 };
  const byRace = {};
  for (const s of g.systems) {
    byTier[s.tier]++;
    if (s.owner) byRace[s.owner] = (byRace[s.owner] ?? 0) + 1;
  }
  return { systems: g.systems.length, sectors: g.sectors.length, byTier, byRace, cycle: g.cycle };
}

export function findSystem(g, query) {
  const q = String(query).toLowerCase();
  return g.systems.find((s) => s.anchor === query || s.name.toLowerCase() === q) ?? null;
}

/** Zmienna część stanu (do zapisu gry). Część statyczną odtwarza seed. */
export function exportState(g) {
  return JSON.parse(JSON.stringify({
    seed: g.options.seed, cycle: g.cycle, relations: g.relations, campaigns: g.campaigns,
    nextCampaignId: g.nextCampaignId, log: g.log.slice(-200),
    sectors: g.sectors.map((s) => [s.owner, s.occupiedFrom ?? null]),
    races: Object.fromEntries(Object.values(g.races).map((r) => [r.id, {
      homeworldLost: r.homeworldLost, capital: r.capital, capitalName: r.capitalName, capitals: r.capitals, seats: r.seats,
      core: r.core, domainSectors: r.domainSectors, strength: r.strength, rebuilding: r.rebuilding, graceUntil: r.graceUntil,
    }])),
  }));
}

export function importState(g, state) {
  if (state.seed !== g.options.seed) throw new Error('Stan zapisany dla innej galaktyki (inny seed).');
  Object.assign(g, { cycle: state.cycle, relations: { ...state.relations }, campaigns: state.campaigns, nextCampaignId: state.nextCampaignId, log: state.log });
  state.sectors.forEach(([owner, from], i) => { g.sectors[i].owner = owner; if (from) g.sectors[i].occupiedFrom = from; });
  for (const [rid, r] of Object.entries(state.races)) Object.assign(g.races[rid], r);
  recomputeTiers(g);
  return g;
}
