import { WARSHIPS } from '../data/economy.js';

/**
 * RAPORT Z POTYCZKI (krok 12c): co się stało, gdy wróg zaatakował nasze stacje.
 *
 * Czysta funkcja: dostaje fakty z raids.js (ilu przyleciało, kto kogo
 * zestrzelił, kto uciekł, łup) i migawki "przed / po" (okręty w układzie,
 * stacje, flota rasy), a zwraca werdykt i wiersze do karty decyzji.
 *
 * Werdykt odpowiada na pytanie gracza "czy flota przegoniła wroga?":
 *   rozbity     - zestrzeleni wszyscy,
 *   przegoniony - uciekli bez łupu (albo z drobnym) i stracili część okrętów,
 *   łup         - odlecieli, bo zabrali, po co przylecieli,
 *   porażka     - odlecieli z łupem, a my straciliśmy większość floty w układzie.
 */

export const VERDICTS = {
  rozbity:     { title: 'Wróg rozbity', tone: 'info' },
  przegoniony: { title: 'Wróg przegoniony', tone: 'info' },
  wycofal:     { title: 'Wróg się wycofał', tone: 'warning' },
  lup:         { title: 'Wróg odleciał z łupem', tone: 'warning' },
  porazka:     { title: 'Obrona złamana', tone: 'danger' },
};

const KILLER_NAME = { flota: 'flota', gracz: 'ty', wataha: 'wataha', obrona: 'wieże i platformy', inne: 'inne' };
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

/**
 * @param {object} r
 *   n, kills, fled, killsBy {flota, gracz, ...}, sated, pirate, raceName, faction,
 *   dronesLost, stolen, bounty, offline, repelled (zaocznie), systemName,
 *   before / after: { ships: [{id, callsign, cls, hull}], stations: [{id, name, hull, max}] },
 *   race: { name, shipsBefore, shipsAfter, ourPower, theirPower, atWar } | null
 */
export function buildBattleReport(r) {
  const before = r.before ?? { ships: [], stations: [] };
  const after = r.after ?? { ships: [], stations: [] };
  const afterIds = new Set(after.ships.map((s) => s.id));
  const lostShips = before.ships.filter((s) => !afterIds.has(s.id));
  const hull0 = before.ships.reduce((a, s) => a + s.hull, 0);
  const hull1 = after.ships.filter((s) => before.ships.some((b) => b.id === s.id)).reduce((a, s) => a + s.hull, 0);
  const fleetLoss = hull0 > 0 ? 1 - hull1 / hull0 : 0;
  const hadFleet = before.ships.length > 0;
  const stHit = after.stations.filter((s) => { const b = before.stations.find((x) => x.id === s.id); return b && s.hull < b.hull - 1; });
  const looted = after.stations.filter((s) => { const b = before.stations.find((x) => x.id === s.id); return b && b.hull > s.max * 0.36 && s.hull <= s.max * 0.36; });
  const n = r.n ?? 0, kills = r.kills ?? 0;
  const fled = r.fled ?? Math.max(0, n - kills);
  const heavyLoot = r.sated || (r.stolen ?? 0) > 120 || (r.dronesLost ?? 0) > 4;

  let verdict;
  if (r.offline) verdict = r.repelled ? (kills >= n ? 'rozbity' : 'przegoniony') : 'lup';
  else if (n > 0 && kills >= n) verdict = 'rozbity';
  else if (heavyLoot && hadFleet && fleetLoss > 0.5) verdict = 'porazka';
  else if (heavyLoot) verdict = 'lup';
  else if (kills > 0) verdict = 'przegoniony';
  else verdict = 'wycofal';
  const V = VERDICTS[verdict];

  const who = r.pirate ? 'rabusiów' : `okrętów rasy ${r.raceName}`;
  // --- zdanie główne: odpowiedź "czy flota przegoniła wroga" ---
  let lead;
  if (r.offline) lead = r.repelled ? `Obrona ${r.systemName ?? 'kopalni'} odparła atak ${who} bez nas.` : `Atak ${who} na ${r.systemName ?? 'kopalnię'} rozegrał się bez nas — obrona nie wystarczyła.`;
  else if (!hadFleet) lead = `Floty nie było w układzie. ${verdict === 'rozbity' ? 'Wszystkich zestrzeliła obrona stacji' : verdict === 'przegoniony' ? 'Obrona stacji zestrzeliła część i reszta uciekła' : 'Stacje broniły się same'}.`;
  else if (verdict === 'rozbity') lead = `Flota rozbiła atak: zestrzelono wszystkie ${n} ${plural(n, 'okręt', 'okręty', 'okrętów')}.`;
  else if (verdict === 'przegoniony') lead = `Flota przegoniła wroga: ${kills} z ${n} zestrzelonych, ${fled} ${plural(fled, 'uciekł', 'uciekło', 'uciekło')} bez większego łupu.`;
  else if (verdict === 'porazka') lead = `Flota nie powstrzymała ataku: wróg zabrał łup, a my straciliśmy ${pct(fleetLoss)} siły w układzie.`;
  else if (verdict === 'lup') lead = `Flota nie zdążyła: wróg zabrał łup i odleciał (${kills} z ${n} zestrzelonych).`;
  else lead = `Wróg wycofał się bez strat po obu stronach.`;

  // --- skutek (strategiczny albo nagroda) ---
  let effect = '';
  const race = r.race;
  if (race && !r.pirate) {
    const ratio = race.theirPower > 0 ? race.ourPower / race.theirPower : 9;
    effect = ratio > 1.3 ? ` Przewaga po naszej stronie (${race.ourPower.toFixed(0)} vs ${race.theirPower.toFixed(0)}) — dobry moment na kontratak.`
      : ratio < 0.8 ? ` Ich flota wciąż silniejsza (${race.theirPower.toFixed(0)} vs ${race.ourPower.toFixed(0)}) — wzmocnij obronę.`
        : ` Siły wyrównane (${race.ourPower.toFixed(0)} vs ${race.theirPower.toFixed(0)}).`;
  } else if (r.bounty) effect = ` Nagroda kupców: +${r.bounty} kr.`;

  // --- wiersze szczegółów ---
  const rows = [];
  rows.push({ label: 'Wróg', value: `${n} × ${r.pirate ? 'rabusie' : r.raceName}${r.faction ? ` (${r.faction})` : ''}` });
  rows.push({ label: 'Zestrzeleni', value: `${kills} / ${n}${fled ? ` · uciekło ${fled}` : ''}`, tone: kills >= n ? 'good' : kills ? '' : 'bad' });
  const by = Object.entries(r.killsBy ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${KILLER_NAME[k] ?? k} ${v}`);
  if (by.length) rows.push({ label: 'Kto strzelał', value: by.join(' · ') });
  if (hadFleet) {
    rows.push({
      label: 'Nasza flota',
      value: `${before.ships.length} okr.${lostShips.length ? ` · stracone ${lostShips.length}: ${lostShips.map((s) => `„${s.callsign}” (${WARSHIPS[s.cls]?.name.toLowerCase() ?? s.cls})`).join(', ')}` : ' · bez strat'}${fleetLoss > 0.03 ? ` · uszkodzenia ${pct(fleetLoss)}` : ''}`,
      tone: lostShips.length ? 'bad' : fleetLoss > 0.3 ? '' : 'good',
    });
  }
  const eco = [];
  if (r.dronesLost) eco.push(`drony −${r.dronesLost}`);
  if (r.stolen >= 1) eco.push(`zrabowano ${Math.round(r.stolen)} t`);
  if (looted.length) eco.push(`złupione stacje: ${looted.map((s) => s.name).join(', ')}`);
  else if (stHit.length) eco.push(`uszkodzone stacje: ${stHit.length}`);
  rows.push({ label: 'Gospodarka', value: eco.length ? eco.join(' · ') : 'bez strat', tone: eco.length ? 'bad' : 'good' });
  if (race && !r.pirate) {
    rows.push({ label: `Flota rasy ${race.name}`, value: `${race.shipsBefore} → ${race.shipsAfter} okr.${race.atWar ? ' · wojna trwa' : ''}` });
  }
  if (r.bounty) rows.push({ label: 'Nagroda', value: `+${r.bounty} kr`, tone: 'good' });

  const advantage = !!(race && !r.pirate && race.atWar && race.ourPower > race.theirPower * 1.3);
  return {
    verdict, title: V.title, tone: V.tone, text: `${lead}${effect}`, rows,
    lostShips: lostShips.map((s) => s.id), fleetLoss, advantage, weak: !!(race && race.theirPower > race.ourPower * 1.25),
  };
}
