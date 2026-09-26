// Dymny test w prawdziwej przeglądarce (headless Chromium przez Playwright):
// okładka -> tablica misji -> gra z misją (krok 10, z ekonomią), bez błędów w konsoli, z działającą
// warstwą audio. Zapisuje zrzuty ekranu do tools/browser-check/out/.
//
//   npm i playwright@1.56.0   (+ przeglądarka: npx playwright install chromium)
//   node tools/browser-check/check.mjs
//
// three.js w stronach idzie z unpkg (importmap); test podmienia te żądania na
// lokalne node_modules/three, więc działa też bez internetu.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'tools/browser-check/out');
const req = createRequire(join(process.cwd(), '/'));
let chromium, threeDir;
try { ({ chromium } = req('playwright')); } catch { console.log('Brak playwright - pomijam (npm i playwright).'); process.exit(0); }
try { threeDir = dirname(dirname(req.resolve('three'))); } catch { console.log('Brak three w node_modules - pomijam.'); process.exit(0); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer(async (rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(ROOT, p));
    rs.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
    rs.end(body);
  } catch { rs.writeHead(404); rs.end('404'); }
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required', '--mute-audio'],
});
await mkdir(OUT, { recursive: true });

async function open(path, { width = 1440, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|WebGL|GPU stall|GL_|swiftshader/i.test(m.text())) errors.push(m.text()); });
  await page.route(/unpkg\.com\/three@[^/]+\/(.*)$/, async (route) => {
    const rel = route.request().url().replace(/^.*unpkg\.com\/three@[^/]+\//, '');
    try { route.fulfill({ status: 200, contentType: 'text/javascript', body: await readFile(join(threeDir, rel)) }); }
    catch { route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  return { page, errors };
}

// ------------------------------------------------------------
console.log('\n1. Okładka (intro)');
{
  const { page, errors } = await open('/index.html');
  await page.waitForTimeout(2500);
  const href = await page.getAttribute('#play', 'href');
  ok(/^\.\/step12-dowodztwo\/\?uklad=teegarden&statek=/.test(href), `„Graj” prowadzi na mostek siedziby w wybranym układzie (${href})`);
  ok(/missions\.html\?uklad=/.test(await page.getAttribute('#board', 'href')), 'link „Misje i wybór statku” prowadzi na tablicę');
  ok(await page.locator('.au-btn').count() === 1, 'przycisk dźwięku jest');
  const locked = await page.getAttribute('.au', 'data-locked');
  ok(locked === 'true', 'przed gestem dźwięk czeka (wymóg przeglądarek)');
  await page.mouse.click(700, 450);
  await page.waitForTimeout(600);
  ok(await page.getAttribute('.au', 'data-locked') === 'false', 'po kliknięciu kontekst audio działa');
  await page.screenshot({ path: join(OUT, '1-intro.png') });
  await Promise.all([page.waitForURL(/step12-dowodztwo/, { waitUntil: 'domcontentloaded' }), page.click('#play')]);
  ok(true, 'klik „Graj” przechodzi na mostek (krok 12)');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n2. Tablica misji');
{
  const { page, errors } = await open('/missions.html?uklad=blizniaki');
  await page.waitForTimeout(1500);
  ok(await page.locator('.m').count() === 10, 'kampania + 8 misji + wolny lot');
  ok(await page.inputValue('#system') === 'blizniaki', 'układ z intro przeszedł w adresie');
  for (const id of ['kampania', 'capture', 'blockade', 'waves', 'escort', 'ambush', 'pursuit', 'wolfhunt', 'obrona', 'wolny']) {
    await page.click(`.m[data-id="${id}"]`);
    const n = await page.locator('#d-schema > *').count();
    const brief = await page.textContent('#d-brief');
    ok(n > 3 && brief.length > 40, `${id.padEnd(9)} odprawa (${brief.length} zn.) i schemat (${n} elementów)`);
    if (id === 'ambush') await page.screenshot({ path: join(OUT, '2-board-ambush.png') });
  }
  await page.click('.m[data-id="wolfhunt"]');
  ok(await page.isDisabled('#pack .opt'), 'Łowy watahy: wataha obowiązkowa (przełącznik zablokowany)');
  await page.click('.m[data-id="waves"]');
  await page.click('#races .race[data-race="wybudzeni"]');
  await page.click('#hulls .model[data-id="goniec-wybudzeni-trade-11"]');
  await page.keyboard.press('3'); // cyfry już nie zmieniają statku
  await page.keyboard.press('t');
  await page.keyboard.press('w');
  const url = await page.evaluate(() => window.__missions.gameUrl());
  ok(/misja=waves/.test(url) && /statek=goniec-wybudzeni-trade-11/.test(url) && /trudnosc=trudna/.test(url) && /wataha=1/.test(url) && /uklad=blizniaki/.test(url),
    `klik statku / T / W ustawiają statek, trudność, watahę (cyfra 3 ignorowana): ${url}`);
  await page.screenshot({ path: join(OUT, '2-board-waves.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.querySelector('main').scrollWidth > innerWidth + 1);
  ok(!overflow, 'telefon w pionie: bez przewijania w bok');
  await page.screenshot({ path: join(OUT, '2-board-phone.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await Promise.all([page.waitForURL(/step12-dowodztwo\/.*misja=waves/, { waitUntil: 'domcontentloaded' }), page.keyboard.press('Enter')]);
  ok(true, 'Enter uruchamia misję (krok 12, od razu w locie)');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n3. Gra: start z tablicy, audio, koniec misji, powrót');
{
  const { page, errors } = await open('/step11-dominacja/?misja=waves&statek=goniec-wybudzeni-hawk-7&trudnosc=trudna&wataha=1&uklad=teegarden&debug');
  await page.waitForFunction(() => window.__game?.missions?.active, null, { timeout: 60000 }).catch(() => {});
  const st = await page.evaluate(() => ({
    mission: __game.missions.state.id, active: __game.missions.active, pack: __game.wolfpack.active,
    race: __game.playerState.raceId, system: __game.starSystem.id,
  }));
  ok(st.active && st.mission === 'waves', `misja z adresu wystartowała (${st.mission})`);
  ok(st.pack, 'wataha z adresu');
  ok(st.race === 'wybudzeni', `statek z adresu (rasa ${st.race})`);
  ok(st.system === 'teegarden', 'układ z adresu');
  ok(await page.locator('#mission-board').count() === 0, 'w grze nie ma już nakładki tablicy');

  await page.mouse.click(720, 450); // gest: odblokowanie dźwięku
  await page.waitForTimeout(800);
  const a1 = await page.evaluate(() => ({ ready: __game.audio.ready, mood: __game.audio.mood, state: __game.audio.context?.state }));
  ok(a1.ready && a1.mood === 'flight', `audio działa po kliknięciu (kontekst: ${a1.state}, nastrój: ${a1.mood})`);

  // intensywność rośnie w walce (przewijamy symulację do pierwszej fali)
  const I0 = await page.evaluate(() => __game.audio.intensity);
  await page.evaluate(() => __game.damagePlayer(12, null)); // trafienie = walka (5 s)
  await page.waitForTimeout(2500);
  const I = await page.evaluate(() => __game.audio.intensity);
  ok(I > 0.4 && I > I0, `muzyka lotu gęstnieje po trafieniu (intensywność ${I0.toFixed(2)} -> ${I.toFixed(2)})`);

  // fałda: fazy przechodzą, a dźwięki ciągłe gasną po wyjściu
  await page.evaluate(() => { __game.playerState.hull = __game.playerState.maxHull; __game.missions.abort(); for (const n of [...__game.npcs.list]) if (n.side === 'hostile') __game.npcs.remove(n); });
  const warpRes = await page.evaluate(async () => {
    __game.engageWarp();
    const phases = new Set();
    for (let i = 0; i < 300 && (phases.size === 0 || __game.playerWarp.active); i++) {
      __game.tick(1 / 30); phases.add(__game.playerWarp.phase);
      await new Promise((r) => setTimeout(r, 5));
    }
    return { phases: [...phases], voices: __game.audio.voices };
  });
  ok(['charge', 'dive', 'transit', 'emerge'].every((p) => warpRes.phases.includes(p)), `skok: ${warpRes.phases.join(' → ')}`);

  // alarm kadłuba + śmierć + R = odrodzenie
  await page.evaluate(() => { __game.playerState.hull = __game.playerState.maxHull * 0.2; __game.tick(1 / 30); });
  await page.evaluate(() => { __game.damagePlayer(9999, null); });
  ok(await page.isVisible('#death'), 'śmierć: ekran');
  ok(await page.evaluate(() => __game.audio.mood) === 'aftermath', 'po śmierci muzyka zmienia nastrój');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  const dbg = await page.evaluate(() => ({ alive: __game.playerState.alive, mood: __game.audio.mood }));
  if (!(dbg.alive && dbg.mood === 'flight')) console.log('    (stan po R:', JSON.stringify(dbg), ')');
  ok(await page.evaluate(() => __game.playerState.alive && __game.audio.mood === 'flight'), 'R: odrodzenie, muzyka lotu wraca');

  // zakończenie misji -> Enter powtarza
  await page.evaluate(() => { __game.missions.start('waves'); });
  await page.evaluate(() => { __game.missions.abort(); });
  await page.evaluate(() => { __game.missions.start('capture'); __game.missions.state.status = 'success'; });
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => __game.missions.active && __game.missions.state.id === 'capture'), 'Enter po zakończonej misji: ta sama misja od nowa');
  await page.screenshot({ path: join(OUT, '3-game.png') });

  // N w trakcie misji: pierwsze N tylko ostrzega, drugie wraca na tablicę
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(300);
  ok(/step11-dominacja/.test(page.url()), 'pierwsze N w trakcie misji nie wychodzi (ostrzeżenie)');
  await Promise.all([page.waitForURL(/missions\.html/, { timeout: 8000, waitUntil: 'domcontentloaded' }), page.keyboard.press('KeyN')]);
  const back = new URL(page.url());
  ok(back.searchParams.get('misja') === 'capture' && back.searchParams.get('statek') === 'goniec-wybudzeni-hawk-7',
    `drugie N: tablica misji z tymi samymi ustawieniami (${back.search})`);
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n3b. Ekonomia (krok 10): kopanie, budowa, panel, roje, rabusie');
{
  const { page, errors } = await open('/step10-economy/?uklad=teegarden&debug');
  await page.waitForFunction(() => window.__game?.playerState?.alive && window.__game.economy, null, { timeout: 60000 });
  await page.evaluate(() => { __game.economy.reset(); });
  ok(await page.isVisible('#eco-hud'), 'HUD przemysłu widoczny');
  // statek przy planetoidzie, dziobem do niej, T wciśnięte
  const hold = await page.evaluate(() => {
    const g = __game, a = [...g.economy.asteroids()].sort((x, y) => y.radius - x.radius)[0];
    const V = g.shipGroup.position.constructor;
    g.shipGroup.position.copy(a.position).addScaledVector(new V(0.3, 0.2, 1).normalize(), a.radius + 250);
    g.shipGroup.lookAt(a.position); g.shipGroup.rotateY(Math.PI);
    g.mining.held = true;
    for (let i = 0; i < 30 * 20; i++) g.tick(1 / 30);
    g.mining.held = false;
    return Object.values(g.economy.state.hold).reduce((x, y) => x + y, 0);
  });
  ok(hold > 20, `promień wydobywczy napełnia ładownię (${Math.round(hold)} t)`);
  await page.evaluate(() => { __game.shipGroup.translateZ(800); __game.tick(1 / 30); });
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  ok(await page.isVisible('#industry'), 'P otwiera panel przemysłu');
  await page.click('[data-act="place"][data-type="magazyn"]');
  const placed = await page.evaluate(() => __game.economy.stations().map((s) => s.type));
  ok(placed.includes('magazyn'), 'z panelu: plac budowy magazynu przed dziobem');
  await page.keyboard.press('KeyP');
  const built = await page.evaluate(() => {
    const g = __game, st = g.economy.stations()[0];
    g.shipGroup.position.set(st.pos.x + 250, st.pos.y, st.pos.z);
    g.tick(1 / 30);
    g.unloadNearby();
    for (let i = 0; i < 30 * 25; i++) g.economy.update(1 / 30);
    return st.status;
  });
  ok(built === 'gotowa', 'Y przy placu + montaż: magazyn gotowy');
  const drones = await page.evaluate(() => {
    const e = __game.economy, P = __game.shipGroup.position.constructor;
    const mag = e.stations()[0];
    Object.assign(mag.storage, { zelazo: 1500, nikiel: 400, kobalt: 80, platyna: 0 });
    e.state.credits += 5000;
    const c = e.state.systems.teegarden.beltCenter;
    let spot = null;
    for (let k = 0; k < 40 && !spot; k++) {
      const p = new P(c.x + Math.cos(k) * 1500, c.y + 900 + k * 60, c.z + Math.sin(k) * 1500);
      if (e.canPlace('dok', p).ok) spot = p;
    }
    const dok = e.placeStation('dok', spot);
    for (let i = 0; i < 30 * 80; i++) e.update(1 / 30); // holowniki ~25 s + montaż 40 s
    const w = e.createSwarm(dok.id); e.orderDrones(w.id, 6);
    for (let i = 0; i < 30 * 70; i++) e.update(1 / 30);
    return { n: e.runtime.drones.length, drilling: e.runtime.drones.filter((d) => d.state === 'wiercenie').length, mined: e.state.stats.minedDrones };
  });
  ok(drones.n === 6 && drones.mined > 5, `rój 6 dronów kopie (${drones.drilling} wierci, wydobyto ${Math.round(drones.mined)} t)`);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(400);
  ok(await page.locator('.ip-sw').count() === 1, 'panel pokazuje rój');
  await page.screenshot({ path: join(OUT, '3b-industry.png') });
  await page.keyboard.press('KeyP');
  // rabusie: nalot z ostrzeżeniem, ewakuacja rojów, walka, raport
  const raid = await page.evaluate(() => {
    const g = __game, e = g.economy;
    g.raids.trigger();
    for (let i = 0; i < 30 * 2; i++) g.tick(1 / 30);
    const warn = g.raids.status?.phase;
    for (let i = 0; i < 30 * 16; i++) g.tick(1 / 30);
    const docked = e.runtime.drones.filter((d) => d.state === 'dok').length;
    const st = g.raids.status;
    const raiders = g.npcs.byTag('raider').length;
    for (let i = 0; i < 30 * 240 && g.raids.status; i++) g.tick(1 / 30);
    return { warn, docked, total: e.runtime.drones.length, phase: st?.phase, n: st?.n, raiders, over: !g.raids.status };
  });
  ok(raid.warn === 'warning', 'nalot: najpierw ostrzeżenie');
  ok(raid.phase === 'active' && raid.raiders === raid.n, `rabusie z fałdy (${raid.n})`);
  ok(raid.docked === raid.total, `ewakuacja: ${raid.docked}/${raid.total} dronów w doku`);
  ok(raid.over, 'nalot się kończy (zestrzeleni albo odlecieli)');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.evaluate(() => __game.economy.reset());
  await page.close();
}

// ------------------------------------------------------------
console.log('\n3c. Kampania (krok 11): pola, rasy, mapa strategiczna, dyplomacja, flota');
{
  const { page, errors } = await open('/missions.html');
  await page.waitForTimeout(800);
  ok(await page.getAttribute('.m.campaign', 'aria-selected') === 'true', 'tablica: kampania jest pierwsza i domyślna');
  const url = await page.evaluate(() => window.__missions.gameUrl());
  ok(/step12-dowodztwo/.test(url) && !/misja=/.test(url), `„Graj” prowadzi do kampanii (mostek, krok 12): ${url}`);
  await page.close();
}
{
  const { page, errors } = await open('/step11-dominacja/?uklad=teegarden&debug');
  await page.waitForFunction(() => window.__game?.playerState?.alive && window.__game.strategy, null, { timeout: 60000 });
  const s0 = await page.evaluate(() => {
    const g = __game; g.economy.reset(); g.strategy.ensure('teegarden');
    return { fields: g.strategy.allFields.length, rivals: g.strategy.bySystem.get('teegarden').filter((f) => g.strategy.foreignOwner(f)).length };
  });
  ok(s0.fields === 25 && s0.rivals >= 1, `sektor: 25 pól, rywale w układzie startowym (${s0.rivals})`);
  const disc = await page.evaluate(() => {
    const g = __game, d = g.economy.fieldDefs('teegarden')[2];
    g.shipGroup.position.set(d.center.x, d.center.y + 2000, d.center.z + 5000);
    for (let i = 0; i < 30; i++) g.tick(1 / 30);
    return g.economy.isDiscovered('teegarden', d.id);
  });
  ok(disc, 'podlot do sygnału odkrywa nowe pole');
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(500);
  ok(await page.isVisible('#strat-map .sm-svg'), 'M: mapa strategiczna z mapą układu');
  ok(await page.locator('.sm-rank').count() === 7, 'ranking dominacji: gracz + 6 ras');
  await page.click('[data-act="tab"][data-tab="dyplomacja"]');
  await page.waitForTimeout(300);
  ok(await page.locator('.sm-race .rp-portrait').count() === 6, 'dyplomacja: 6 kart ras z portretami');
  await page.screenshot({ path: join(OUT, '3c-diplomacy.png') });
  await page.keyboard.press('KeyM');
  const war = await page.evaluate(() => {
    const g = __game, S = g.strategy;
    const fid = S.bySystem.get('teegarden').find((f) => S.foreignOwner(f));
    const owner = S.foreignOwner(fid);
    g.economy.discoverField(fid, { silent: true });
    S.playerAction('war', owner);
    for (let i = 0; i < 40; i++) g.tick(1 / 30);
    const o = g.rival.outposts.get(fid);
    const hostile = o?.stations.every((s) => s.actor.side === 'hostile');
    for (const st of o?.stations ?? []) st.actor.takeDamage(1e6);
    for (let i = 0; i < 40; i++) g.tick(1 / 30);
    return { hostile, free: !S.foreignOwner(fid) };
  });
  ok(war.hostile && war.free, 'wojna: placówka rasy wroga, po rozbiciu pole wolne');
  const fleet = await page.evaluate(() => {
    const g = __game, E = g.economy, P = g.shipGroup.position.constructor;
    E.state.credits = 99999;
    const c = E.fieldDefs('teegarden')[0].center; const base = new P(c.x, c.y + 1500, c.z);
    const ready = (st) => { for (const k in st.need) st.need[k] = 0; st.progress = 1; st.status = 'gotowa'; };
    const y = E.placeStation('stocznia', base); ready(y);
    const m = E.placeStation('magazyn', base.clone().add(new P(900, 0, 0))); ready(m);
    Object.assign(m.storage, { zelazo: 1900, nikiel: 600, kobalt: 150, platyna: 30 });
    for (let i = 0; i < 5; i++) g.tick(1 / 30);
    g.army.order('eskorta');
    for (let i = 0; i < 30 * 25; i++) g.tick(1 / 30);
    return { ships: g.army.ships.length, npc: g.npcs.byTag('fleet').length };
  });
  ok(fleet.ships === 1 && fleet.npc === 1, 'stocznia: okręt zwodowany i w układzie jako NPC');
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-tab="flota"]');
  await page.waitForTimeout(300);
  ok(await page.locator('.fp-ship').count() === 1 && await page.locator('.fp-class img').count() === 3, 'panel P → Flota: okręt i trzy klasy z miniaturami');
  await page.screenshot({ path: join(OUT, '3c-fleet.png') });
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.evaluate(() => __game.economy.reset());
  await page.close();
}

// ------------------------------------------------------------
console.log('\n3d. Dowództwo (krok 12): mostek, wyprawy, okienko, decyzje, tryby');
{
  const { page, errors } = await open('/step12-dowodztwo/?uklad=teegarden&debug');
  await page.waitForFunction(() => window.__game?.command?.hq() && document.body.classList.contains('mode-mostek') && !document.body.classList.contains('intro'), null, { timeout: 90000 });
  const s0 = await page.evaluate(() => ({
    mode: __game.mode, hq: __game.command.hq().type, hudHidden: getComputedStyle(document.getElementById('telemetry')).display === 'none',
    orders: document.querySelectorAll('.cp-order').length, tabs: document.querySelectorAll('.cp-tabs button').length, alive: __game.playerState.alive,
  }));
  ok(s0.mode === 'mostek' && s0.hq === 'siedziba' && s0.hudHidden, 'start na mostku siedziby, HUD lotu schowany');
  ok(s0.orders === 4 && s0.tabs === 5, 'panel: 4 rozkazy wypraw, 5 zakładek (hangar, moduły, ulepszenia, nauka, flota)');
  await page.click('.cp-order[data-type="zwiadowca"]');
  ok(await page.locator('.cp-target').count() >= 4, 'wybór celu: nieznane złoża i niezbadane skały');
  await page.click('.cp-send button.primary');
  await page.waitForFunction(() => __game.command.expeditions().some((e) => e.phase === 'przelot'), null, { timeout: 60000 });
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => document.getElementById('pip').classList.contains('open') && !!__game.commandView.cinematic), 'przelot: otwiera się okienko podglądu (skrót lotu)');
  await page.screenshot({ path: join(OUT, '3d-pip.png') });
  await page.evaluate(() => { for (let i = 0; i < 20 * 30 && !__game.decisions.items.some((d) => d.kind === 'survey'); i++) __game.tick(1 / 20); });
  ok(await page.locator('.dc-k-survey').count() === 1, 'raport zwiadu w karcie decyzji');
  await page.click('.dc-k-survey .dc-btn.primary');
  ok(await page.evaluate(() => __game.command.expeditions().some((e) => e.type === 'gornik')), '„Tak” wysyła górników');
  await page.evaluate(() => { for (let i = 0; i < 20 * 60 && !__game.decisions.items.some((d) => d.kind === 'return'); i++) __game.tick(1 / 20); });
  ok(await page.locator('.dc-k-return .dc-btn[data-manage]').count() === 1, 'pełne ładownie: karta z „Zarządzaj”');
  await page.click('.dc-k-return .dc-btn[data-manage]');
  const sub = await page.locator('.dc-k-return .dc-sub button').allTextContents();
  ok(['Odwołaj', 'Przywołaj ochronę', 'Zaalarmuj pozostałych'].every((t) => sub.includes(t)), `Zarządzaj: ${sub.join(', ')}`);
  await page.click('.dc-k-return .dc-btn.primary');
  const back = await page.evaluate(() => { for (let i = 0; i < 20 * 40 && __game.command.expeditions().length; i++) __game.tick(1 / 20); for (let i = 0; i < 20 * 30; i++) __game.tick(1 / 20); return { exps: __game.command.expeditions().length, fe: __game.command.hq().storage.zelazo, smelted: __game.command.state.stats.smelted.zelazo }; });
  ok(back.exps === 0 && back.smelted > 5, `powrót, huta: +${Math.round(back.smelted)} t Fe`);
  await page.click('.cp-tabs button[data-tab="nauka"]');
  await page.click('.cp-tech button[data-act="research"]');
  ok(await page.evaluate(() => !!__game.command.state.research), 'Nauka: badanie ruszyło');
  await page.evaluate(() => __game.raids.trigger());
  await page.waitForFunction(() => __game.decisions.items.some((d) => d.id === 'raid'), null, { timeout: 60000 });
  await page.screenshot({ path: join(OUT, '3d-raid.png') });
  await page.click('.dc-danger .dc-btn[data-act="watch"]');
  ok(await page.evaluate(() => __game.mode === 'podglad' && getComputedStyle(document.getElementById('spectate-bar')).display !== 'none'), 'nalot → „Obserwuj”: podgląd zdalny');
  await page.click('#spectate-pilot');
  await page.waitForFunction(() => __game.mode === 'lot', null, { timeout: 20000 });
  await page.waitForTimeout(600);
  const fly = await page.evaluate(() => ({ vis: __game.shipGroup.visible, d: __game.shipGroup.position.distanceTo(__game.command.hangarPos()) }));
  ok(fly.vis && fly.d < 1500, `„Za stery”: myśliwiec wylatuje z hangaru (${Math.round(fly.d)} j. od wylotu)`);
  await page.screenshot({ path: join(OUT, '3d-flight.png') });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => __game.mode === 'mostek', null, { timeout: 20000 });
  ok(await page.evaluate(() => !__game.shipGroup.visible), 'Tab: powrót na mostek, statek w hangarze');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n4. Audio lab: każdy przycisk gra bez błędu');
{
  const { page, errors } = await open('/tools/audio-lab/');
  await page.waitForTimeout(500);
  const buttons = page.locator('#groups button');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) { await buttons.nth(i).click(); await page.waitForTimeout(60); }
  await page.click('#warp');
  await page.click('#moods button:nth-child(3)');
  await page.fill('#intensity', '100');
  await page.dispatchEvent('#intensity', 'input');
  await page.click('#hull');
  await page.waitForTimeout(4200);
  const st = await page.evaluate(async () => {
    const { getAudio } = await import('/shared/audio/audio.js');
    const a = getAudio();
    return { ready: a.ready, voices: a.voices, mood: a.mood };
  });
  ok(n > 25 && st.ready, `${n} dźwięków + skok + nastrój + alarm (kontekst działa, głosów teraz: ${st.voices})`);
  ok(st.voices < 60, 'głosy są zwalniane (brak wycieku)');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n5. Kroki 5–10 po zmianach we wspólnych modułach (wczytanie, ogień, skok)');
for (const step of ['step5-encounters', 'step6-warp', 'step7-weapons', 'step8-star-systems', 'step9-missions', 'step10-economy']) {
  const { page, errors } = await open(`/${step}/`);
  await page.waitForTimeout(5000);
  await page.keyboard.down('KeyF'); await page.waitForTimeout(800); await page.keyboard.up('KeyF');
  await page.keyboard.press('KeyJ'); await page.waitForTimeout(2500);
  ok(errors.length === 0, `${step}${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`);
  await page.close();
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} niezaliczonych.` : '\nWszystko zaliczone.');
process.exit(fails ? 1 : 0);
