// Dymny test w prawdziwej przeglądarce (headless Chromium przez Playwright):
// okładka -> tablica misji -> gra z misją, bez błędów w konsoli, z działającą
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
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
  ok(/^\.\/missions\.html\?uklad=/.test(href), `„Graj” prowadzi do tablicy misji (${href})`);
  ok(await page.locator('.au-btn').count() === 1, 'przycisk dźwięku jest');
  const locked = await page.getAttribute('.au', 'data-locked');
  ok(locked === 'true', 'przed gestem dźwięk czeka (wymóg przeglądarek)');
  await page.mouse.click(700, 450);
  await page.waitForTimeout(600);
  ok(await page.getAttribute('.au', 'data-locked') === 'false', 'po kliknięciu kontekst audio działa');
  await page.screenshot({ path: join(OUT, '1-intro.png') });
  await Promise.all([page.waitForURL(/missions\.html/, { waitUntil: 'domcontentloaded' }), page.click('#play')]);
  ok(true, 'klik „Graj” przechodzi na tablicę misji');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n2. Tablica misji');
{
  const { page, errors } = await open('/missions.html?uklad=blizniaki');
  await page.waitForTimeout(1500);
  ok(await page.locator('.m').count() === 8, '7 misji + wolny lot');
  ok(await page.inputValue('#system') === 'blizniaki', 'układ z intro przeszedł w adresie');
  for (const id of ['capture', 'blockade', 'waves', 'escort', 'ambush', 'pursuit', 'wolfhunt', 'wolny']) {
    await page.click(`.m[data-id="${id}"]`);
    const n = await page.locator('#d-schema > *').count();
    const brief = await page.textContent('#d-brief');
    ok(n > 3 && brief.length > 40, `${id.padEnd(9)} odprawa (${brief.length} zn.) i schemat (${n} elementów)`);
    if (id === 'ambush') await page.screenshot({ path: join(OUT, '2-board-ambush.png') });
  }
  await page.click('.m[data-id="wolfhunt"]');
  ok(await page.isDisabled('#pack .opt'), 'Łowy watahy: wataha obowiązkowa (przełącznik zablokowany)');
  await page.click('.m[data-id="waves"]');
  await page.click('#ships .opt[data-id="goniec-wybudzeni-trade-11"]');
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
  await Promise.all([page.waitForURL(/step9-missions/, { waitUntil: 'domcontentloaded' }), page.keyboard.press('Enter')]);
  ok(true, 'Enter uruchamia grę');
  ok(errors.length === 0, `bez błędów w konsoli${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await page.close();
}

// ------------------------------------------------------------
console.log('\n3. Gra: start z tablicy, audio, koniec misji, powrót');
{
  const { page, errors } = await open('/step9-missions/?misja=waves&statek=goniec-wybudzeni-hawk-7&trudnosc=trudna&wataha=1&uklad=teegarden&debug');
  await page.waitForFunction(() => window.__game?.missions?.active, null, { timeout: 60000 }).catch(() => {});
  const st = await page.evaluate(() => ({
    mission: __game.missions.state.id, active: __game.missions.active, pack: __game.wolfpack.active,
    race: __game.playerState.raceId, system: __game.starSystem.id,
  }));
  ok(st.active && st.mission === 'waves', `misja z adresu wystartowała (${st.mission})`);
  ok(st.pack, 'wataha z adresu');
  ok(st.race === 'rezonanci', `statek z adresu (rasa ${st.race})`);
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
  ok(/step9-missions/.test(page.url()), 'pierwsze N w trakcie misji nie wychodzi (ostrzeżenie)');
  await Promise.all([page.waitForURL(/missions\.html/, { timeout: 8000, waitUntil: 'domcontentloaded' }), page.keyboard.press('KeyN')]);
  const back = new URL(page.url());
  ok(back.searchParams.get('misja') === 'capture' && back.searchParams.get('statek') === 'goniec-wybudzeni-hawk-7',
    `drugie N: tablica misji z tymi samymi ustawieniami (${back.search})`);
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
console.log('\n5. Kroki 5–8 po zmianach we wspólnych modułach (wczytanie, ogień, skok)');
for (const step of ['step5-encounters', 'step6-warp', 'step7-weapons', 'step8-star-systems']) {
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
