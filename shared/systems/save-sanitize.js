/**
 * SANITYZACJA WCZYTANEGO ZAPISU (krok 12, bezpieczeństwo / odporność).
 *
 * Stan kampanii przychodzi z localStorage, a ten - z pliku .json od gracza
 * (import w oknie zapisu). Kod gry ufa, że identyfikatory w stanie istnieją
 * w stałych tabelach: `TECHS[rs.id].name`, `WARSHIPS[s.cls].hull`,
 * `STATIONS[st.type]`, `DRONE_TYPES[e.type]`, `RACES[owner]`... Nieznany id
 * (literówka, zapis z innej wersji, spreparowany plik) rzucał TypeError przy
 * każdym renderze panelu - gra stawała, dopóki gracz nie wyczyścił pamięci.
 *
 * Zasady:
 *  - poprawny zapis przechodzi BEZ ŻADNEJ ZMIANY (test: check-save.mjs),
 *  - wpis, który wskazuje na nieistniejący id, jest usuwany (okręt, dron,
 *    badanie) albo zerowany (research -> null, właściciel pola -> null),
 *  - liczby, które muszą być liczbami, a nie są -> wartość domyślna,
 *  - całe poddrzewo o złym typie (np. `command: "x"`) jest usuwane; moduły
 *    zakładają je od nowa (`??= fresh...()`), jak w nowej grze.
 *
 * Funkcja modyfikuje przekazany obiekt i zwraca go (albo null, gdy to w ogóle
 * nie jest stan gry). Drugi wynik: lista poprawek (do konsoli, do testów).
 */
import { METAL_ORDER, STATIONS, WARSHIPS } from '../data/economy.js';
import { DRONE_TYPES, TECHS, UPGRADES } from '../data/command.js';
import { RACES } from '../data/races.js';
import { DIFFICULTY_ORDER } from '../data/difficulty.js';

const PLAYER = 'player'; // = strategy.PLAYER (bez importu strategy.js - to ciężki moduł)
const ID_RE = /^[\w:.-]{1,64}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const has = (table, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(table, k);
const isOwner = (o) => o === null || o === PLAYER || has(RACES, o);

export function sanitizeState(s) {
  const fixes = [];
  const fix = (msg) => fixes.push(msg);
  if (!isObj(s) || s.version !== 1) return { state: null, fixes: ['to nie jest stan gry'] };

  // --- liczby na wierzchu
  for (const k of ['credits', 'time']) if (!isNum(s[k])) { fix(`${k}: nie liczba`); s[k] = 0; }

  // --- metale: tylko znane klucze, same liczby
  const metals = (obj, name, def) => {
    if (!isObj(obj)) { fix(`${name}: zły typ`); return Object.fromEntries(METAL_ORDER.map((m) => [m, def])); }
    for (const k of Object.keys(obj)) if (!METAL_ORDER.includes(k)) { fix(`${name}.${k}: nieznany metal`); delete obj[k]; }
    for (const m of METAL_ORDER) if (obj[m] !== undefined && !isNum(obj[m])) { fix(`${name}.${m}: nie liczba`); obj[m] = def; }
    return obj;
  };
  s.market = metals(s.market, 'market', 1);
  s.hold = metals(s.hold, 'hold', 0);

  // --- układy i stacje
  if (!isObj(s.systems)) { fix('systems: zły typ'); s.systems = {}; }
  for (const [id, sys] of Object.entries(s.systems)) {
    if (!ID_RE.test(id) || !isObj(sys)) { fix(`systems.${id}: usunięty`); delete s.systems[id]; continue; }
    if (sys.stations !== undefined) {
      if (!Array.isArray(sys.stations)) { fix(`systems.${id}.stations: zły typ`); sys.stations = []; }
      sys.stations = sys.stations.filter((st) => {
        const good = isObj(st) && typeof st.id === 'string' && has(STATIONS, st.type) && (st.hull === undefined || isNum(st.hull));
        if (!good) fix(`stacja ${st?.id ?? '?'} (${st?.type}): usunięta`);
        return good;
      });
    }
    if (sys.swarms !== undefined && !Array.isArray(sys.swarms)) { fix(`systems.${id}.swarms: zły typ`); sys.swarms = []; }
    if (Array.isArray(sys.swarms)) sys.swarms = sys.swarms.filter((w) => isObj(w) || (fix('rój: usunięty'), false));
  }

  // --- dowództwo
  if (s.command !== undefined) {
    const c = s.command;
    if (!isObj(c)) { fix('command: zły typ'); delete s.command; }
    else {
      if (c.home !== null && c.home !== undefined && !(typeof c.home === 'string' && ID_RE.test(c.home))) { fix('command.home: zły'); c.home = null; }
      if (isObj(c.hangar)) {
        for (const k of Object.keys(c.hangar)) {
          if (!has(DRONE_TYPES, k)) { fix(`hangar.${k}: nieznany typ`); delete c.hangar[k]; }
          else if (!isNum(c.hangar[k]) || c.hangar[k] < 0) { fix(`hangar.${k}: nie liczba`); c.hangar[k] = 0; }
        }
      } else if (c.hangar !== undefined) { fix('hangar: zły typ'); delete c.hangar; }
      if (Array.isArray(c.queue)) c.queue = c.queue.filter((t) => has(DRONE_TYPES, t) || (fix(`kolejka dronów: ${t}`), false));
      else if (c.queue !== undefined) { fix('command.queue: zły typ'); c.queue = []; }
      if (Array.isArray(c.techs)) c.techs = c.techs.filter((t) => has(TECHS, t) || (fix(`badanie ${t}: nieznane`), false));
      else if (c.techs !== undefined) { fix('techs: zły typ'); c.techs = []; }
      if (c.research !== null && c.research !== undefined && !(isObj(c.research) && has(TECHS, c.research.id))) { fix('research: nieznane badanie'); c.research = null; }
      if (isObj(c.upgrades)) {
        for (const k of Object.keys(c.upgrades)) if (!has(UPGRADES, k) || !isNum(c.upgrades[k])) { fix(`ulepszenie ${k}: usunięte`); delete c.upgrades[k]; }
      } else if (c.upgrades !== undefined) { fix('upgrades: zły typ'); c.upgrades = {}; }
      if (Array.isArray(c.expeditions)) {
        c.expeditions = c.expeditions.filter((e) => {
          const good = isObj(e) && typeof e.id === 'string' && has(DRONE_TYPES, e.type) && isNum(e.n) && isObj(e.target);
          if (!good) fix(`wyprawa ${e?.id ?? '?'}: usunięta`);
          return good;
        });
      } else if (c.expeditions !== undefined) { fix('expeditions: zły typ'); c.expeditions = []; }
      if (Array.isArray(c.sentries)) {
        c.sentries = c.sentries.filter((x) => {
          const good = isObj(x) && typeof x.id === 'string' && isObj(x.pos) && isNum(x.pos.x) && isNum(x.pos.z);
          if (!good) fix(`wieża ${x?.id ?? '?'}: usunięta`);
          return good;
        });
      } else if (c.sentries !== undefined) { fix('sentries: zły typ'); c.sentries = []; }
      if (c.nextId !== undefined && !isNum(c.nextId)) { fix('command.nextId'); c.nextId = 1000; }
    }
  }

  // --- flota
  if (s.army !== undefined) {
    const a = s.army;
    if (!isObj(a)) { fix('army: zły typ'); delete s.army; }
    else {
      if (Array.isArray(a.ships)) {
        a.ships = a.ships.filter((x) => {
          const good = isObj(x) && typeof x.id === 'string' && has(WARSHIPS, x.cls) && isNum(x.hull);
          if (!good) fix(`okręt ${x?.id ?? '?'} (${x?.cls}): usunięty`);
          return good;
        });
        for (const x of a.ships) if (x.callsign !== undefined && typeof x.callsign !== 'string') { fix(`okręt ${x.id}: callsign`); x.callsign = String(x.callsign); }
      } else { if (a.ships !== undefined) fix('army.ships: zły typ'); a.ships = []; }
      if (Array.isArray(a.queue)) a.queue = a.queue.filter((q) => (isObj(q) && has(WARSHIPS, q.cls)) || (fix('stocznia: pozycja usunięta'), false));
      else { if (a.queue !== undefined) fix('army.queue: zły typ'); a.queue = []; }
      if (!isNum(a.nextId)) { if (a.nextId !== undefined) fix('army.nextId'); a.nextId = a.ships.length + 1; }
    }
  }

  // --- strategia (rasy, pola). Coś zupełnie nie tak -> nowa mapa sektora.
  if (s.strategy !== undefined) {
    const g = s.strategy;
    if (!isObj(g) || !isObj(g.fields) || !isObj(g.factions)) { fix('strategy: zła struktura - nowa mapa'); delete s.strategy; }
    else {
      for (const k of Object.keys(g.factions)) if (!has(RACES, k) || !isObj(g.factions[k])) { fix(`frakcja ${k}: usunięta`); delete g.factions[k]; }
      for (const [fid, f] of Object.entries(g.fields)) {
        if (!isObj(f)) { fix(`pole ${fid}: usunięte`); delete g.fields[fid]; continue; }
        if (!isOwner(f.owner ?? null)) { fix(`pole ${fid}: nieznany właściciel`); f.owner = null; }
        if (f.develop !== undefined && !isNum(f.develop)) { fix(`pole ${fid}: develop`); f.develop = 1; }
      }
      for (const k of ['rel', 'stance']) {
        if (g[k] === undefined) continue;
        if (!isObj(g[k])) { fix(`strategy.${k}: zły typ`); g[k] = {}; continue; }
        for (const a of Object.keys(g[k])) if (!isOwner(a) || !isObj(g[k][a])) { fix(`strategy.${k}.${a}: usunięte`); delete g[k][a]; }
      }
      if (g.proposals !== undefined && !Array.isArray(g.proposals)) { fix('proposals: zły typ'); g.proposals = []; }
      if (Array.isArray(g.proposals)) g.proposals = g.proposals.filter((p) => (isObj(p) && (p.faction === undefined || has(RACES, p.faction))) || (fix('propozycja: usunięta'), false));
      if (g.log !== undefined && !Array.isArray(g.log)) { fix('strategy.log: zły typ'); g.log = []; }
    }
  }

  // --- operacje floty (grupy)
  if (s.ops !== undefined) {
    if (!isObj(s.ops)) { fix('ops: zły typ'); delete s.ops; }
    else if (s.ops.groups !== undefined) {
      if (!Array.isArray(s.ops.groups)) { fix('ops.groups: zły typ'); s.ops.groups = []; }
      s.ops.groups = s.ops.groups.filter((gr) => (isObj(gr) && typeof gr.id === 'string' && Array.isArray(gr.ships)) || (fix('grupa: usunięta'), false));
    }
  }

  if (s.difficulty !== undefined && !DIFFICULTY_ORDER.includes(s.difficulty)) { fix(`difficulty ${s.difficulty}: nieznany`); delete s.difficulty; }

  return { state: s, fixes };
}
