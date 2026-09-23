// Sprawdzenie niezmienników galaktyki (Node, bez przeglądarki):
//   node tools/galaxy-map/check.mjs
import {
  createGalaxy, galaxyStats, canOperate, accessFor, validCoalition, startCampaign, advance,
  relation, adjustRelation, readiness, militarization, exportState, importState, RULES, ANCHORS,
} from '../../shared/data/galaxy.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
const t0 = Date.now();
const g = createGalaxy();
const ms = Date.now() - t0;
const st = galaxyStats(g);
const ids = Object.keys(g.races);

console.log(`Galaktyka: ${st.systems} układów, ${st.sectors} sektorów, wygenerowana w ${ms} ms`);
console.log('Warstwy:', st.byTier);
console.log('Układy ras:', st.byRace);

console.log('\n1. Struktura');
ok(st.systems === g.options.systemCount, 'pełna liczba układów');
ok(createGalaxy().systems[1234].name === g.systems[1234].name, 'ten sam seed = ta sama galaktyka');
ok(createGalaxy({ seed: 7 }).systems[1234].name !== g.systems[1234].name, 'inny seed = inna galaktyka');
for (const r of Object.values(g.races)) {
  ok(r.core.length === g.options.coreSize && r.core.includes(r.capital), `${r.name}: rdzeń ${r.core.length} układów ze stolicą ${r.capitalName} (${g.systems[r.capital].star})`);
}
ok(ANCHORS.every((a) => g.systems.some((s) => s.anchor === a.id)), 'wszystkie 5 układów z kroku 8 ma miejsce w katalogu');
ok(g.systems.filter((s) => s.anchor).every((s) => !s.owner), 'Rubież Teegardena jest niczyja');
const wildShare = (st.byTier.march + st.byTier.wild) / st.systems;
ok(wildShare > 0.4, `większość galaktyki poza domenami (${Math.round(wildShare * 100)}% to pogranicze i dzicz)`);

console.log('\n2. Militaryzacja: rdzeń > domena > pogranicze > dzicz');
const avg = (tier) => { const a = g.systems.filter((s) => s.tier === tier); return a.reduce((s, x) => s + militarization(g, x.id), 0) / a.length; };
const m = { capital: avg('capital'), core: avg('core'), domain: avg('domain'), march: avg('march'), wild: avg('wild') };
console.log('   średnio:', Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)])));
ok(m.capital > m.core && m.core > m.domain && m.domain > m.march && m.march > m.wild, 'gradient zachowany');

console.log('\n3. Pojedyncza siła nie działa w rdzeniu');
let soloBlocked = true, soloReason = '';
for (const t of ids) for (const x of ids) {
  if (x === t) continue;
  const cap = g.races[t].capital;
  const r = canOperate(g, cap, [x]);
  if (r.ok) soloBlocked = false; else soloReason ||= r.reasons[0];
  const acc = accessFor(g, cap, x);
  if (acc.militaryOps) soloBlocked = false;
}
ok(soloBlocked, 'żadna rasa sama nie może walczyć w cudzym rdzeniu/stolicy');
console.log(`   powód: ${soloReason}`);

console.log('\n4. Koalicje możliwe przy startowych relacjach');
const possible = [];
for (const t of ids) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  if (ids[i] === t || ids[j] === t) continue;
  if (validCoalition(g, [ids[i], ids[j]], t).ok) possible.push(`${ids[i]} + ${ids[j]} -> ${t}`);
}
console.log('   ' + (possible.join('\n   ') || '(żadna)'));

console.log('\n5. Kampania: koalicja wymusza odwrót, rasa przeżywa i się odbudowuje');
const target = 'szczepieni';
const before = { ...g.races[target], core: [...g.races[target].core] };
const oldCoreSector = g.systems[before.capital].sector;
const res = startCampaign(g, ['wybudzeni', 'rezonanci'], target);
ok(res.ok, 'wybudzeni + rezonanci ruszają na szczepionych');
ok(canOperate(g, before.capital, ['wybudzeni']).ok, 'uczestnik kampanii może walczyć na froncie');
ok(accessFor(g, before.capital, 'wybudzeni').level === 'front', 'dla uczestnika rdzeń jest frontem');
ok(!canOperate(g, before.capital, ['piesniarze']).ok, 'obca rasa spoza koalicji nadal nie wejdzie');
let n = 0;
while (g.campaigns[0].status === 'active' && n < 60) { advance(g, 1); n++; }
ok(g.campaigns[0].status === 'won', `odwrót po ${n} cyklach`);
const after = g.races[target];
ok(after.capital !== before.capital, `nowa stolica: ${after.capitalName}`);
ok(g.systems[after.capital].sector !== oldCoreSector, 'stolica w innym sektorze');
ok(after.core.length === g.options.coreSize, 'nowy rdzeń pełnej wielkości');
ok(after.homeworldLost && after.homeworld === before.homeworld, 'planeta macierzysta zapamiętana jako utracona');
ok(['wybudzeni', 'rezonanci'].includes(g.systems[before.capital].owner), 'stary rdzeń zajęty przez koalicję');
ok(g.systems[before.capital].tier === 'domain', 'zajęty rdzeń jest dla okupanta zwykłą domeną');
ok(after.strength >= after.maxStrength * RULES.retreatReadiness, `flota ocalała (${Math.round(readiness(g, target) * 100)}%)`);
ok(validCoalition(g, ['wybudzeni', 'piesniarze'], target).reasons.some((r) => r.includes('ochronn')), 'okres ochronny chroni nowy rdzeń');
advance(g, RULES.graceCycles + 10);
ok(readiness(g, target) > 0.9 && !after.rebuilding, `odbudowa po ${RULES.graceCycles + 10} cyklach: ${Math.round(readiness(g, target) * 100)}%`);
ok(!canOperate(g, after.capital, ['rezonanci']).ok, 'nowy rdzeń znów zamknięty dla pojedynczej siły');

console.log('\n6. Rasy nie da się zniszczyć: 6 kolejnych kampanii na tę samą rasę');
const g2 = createGalaxy();
const victim = 'rezonanci';
for (const x of ids) if (x !== victim) { g2.relations[[x, victim].sort().join('|')] = -80; for (const y of ids) if (y !== victim && y !== x) g2.relations[[x, y].sort().join('|')] = 40; }
let wins = 0;
for (let k = 0; k < 6; k++) {
  // koalicja z dwóch najbliższych gotowych ras (krótsze zaopatrzenie)
  const vc = g2.systems[g2.races[victim].capital];
  const dcap = (x) => Math.hypot(g2.systems[g2.races[x].capital].x - vc.x, g2.systems[g2.races[x].capital].y - vc.y);
  const free = ids.filter((x) => x !== victim && readiness(g2, x) >= RULES.minReadiness).sort((a, b) => dcap(a) - dcap(b));
  const r = startCampaign(g2, free.slice(0, 2), victim);
  if (!r.ok) { advance(g2, 5); k--; if (g2.cycle > 800) break; continue; }
  while (r.campaign.status === 'active') advance(g2, 1);
  if (r.campaign.status === 'won') wins++;
  advance(g2, RULES.graceCycles + 1);
}
const v = g2.races[victim];
ok(wins >= 3, `${wins}/6 kampanii zakończonych odwrotem w ${g2.cycle} cyklach`);
ok(v.core.length === g2.options.coreSize && g2.systems[v.capital].owner === victim, `nadal ma stolicę (${v.capitalName}) i rdzeń`);
ok(v.domainSectors.length >= 1, `ma ${v.domainSectors.length} sektor(y) domeny`);
console.log(`   kolejne stolice: ${v.capitals.map((id) => g2.systems[id].name).join(' → ')}`);

console.log('\n7. Słaba koalicja nie wystarcza');
const g3 = createGalaxy();
g3.races.wybudzeni.strength = g3.races.wybudzeni.maxStrength * 0.62;
g3.races.rezonanci.strength = g3.races.rezonanci.maxStrength * 0.62;
const r3 = startCampaign(g3, ['wybudzeni', 'rezonanci'], 'szczepieni');
while (r3.campaign.status === 'active') advance(g3, 1);
ok(r3.campaign.status === 'failed', `osłabiona koalicja odparta (${g3.log.at(-1).text})`);

console.log('\n8. Rozpad koalicji w trakcie');
const g4 = createGalaxy();
const r4 = startCampaign(g4, ['wybudzeni', 'rezonanci'], 'szczepieni');
advance(g4, 3);
adjustRelation(g4, 'wybudzeni', 'rezonanci', -30);
advance(g4, 1);
ok(r4.campaign.status === 'failed', 'skłóceni partnerzy przerywają oblężenie');

console.log('\n9. Zapis i odczyt');
const saved = JSON.stringify(exportState(g));
const g5 = importState(createGalaxy(), JSON.parse(saved));
ok(g5.races[target].capital === g.races[target].capital && g5.cycle === g.cycle, `stan odtworzony (${(saved.length / 1024).toFixed(1)} kB)`);
ok(g5.systems.every((s, i) => s.tier === g.systems[i].tier && s.owner === g.systems[i].owner), 'warstwy i właściciele zgodni');

console.log(fails ? `\n${fails} błędów` : '\nWszystko w porządku.');
process.exit(fails ? 1 : 0);
