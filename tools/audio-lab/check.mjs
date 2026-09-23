// Test warstwy audio BEZ przeglądarki i BEZ słuchania: każdy dźwięk i każdy
// nastrój muzyki jest renderowany do bufora (OfflineAudioContext z pakietu
// node-web-audio-api), a potem mierzony: czy w ogóle coś gra, czy nie ma
// NaN, czy nie przesteruje, czy dźwięki ciągłe dają się zatrzymać, czy
// warstwy walki naprawdę rosną z intensywnością.
//
//   npm i node-web-audio-api   (w katalogu nadrzędnym albo globalnie)
//   node tools/audio-lab/check.mjs
//
// Nie zastępuje odsłuchu - mówi tylko, że sygnał jest poprawny technicznie.
// Do odsłuchu: tools/audio-lab/ w przeglądarce.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let WA;
try { WA = require('node-web-audio-api'); } catch {
  try { WA = createRequire(process.cwd() + '/')('node-web-audio-api'); } catch {
    console.log('Brak node-web-audio-api - pomijam test audio (npm i node-web-audio-api).');
    process.exit(0);
  }
}
const { OfflineAudioContext } = WA;
const { createAudio } = await import('../../shared/audio/audio.js');
const { SFX_NAMES, WARP_VOICE } = await import('../../shared/audio/sfx.js');
const { MOODS } = await import('../../shared/audio/music.js');

const SR = 22050;
let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };

function measure(buf, from = 0, to = buf.length) {
  let peak = 0, sum = 0, nan = false;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = from; i < to; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan = true; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, (to - from) * buf.numberOfChannels)), nan };
}
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

// deterministyczny los (dzwonki muzyki są losowane) - te same nuty w każdym porównaniu
let seed = 1;
Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

async function render(seconds, fn) {
  seed = 12345;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR);
  const audio = createAudio({ context: ctx });
  audio.setMood('silent-test'); // nieznany nastrój -> 'cover', ale nic nie pompujemy
  await fn(audio, ctx);
  return ctx.startRendering();
}

console.log('\n1. Każdy dźwięk gra, bez NaN i bez przesterowania');
for (const name of SFX_NAMES) {
  const buf = await render(3.5, (a) => {
    const h = a.play(name, { race: 'rezonanci', size: 1.2, amount: 30 });
    h?.stop(0.2, 1.5); // dźwięki ciągłe: zatrzymanie po 1,5 s (sprawdzamy, że gasną)
  });
  const m = measure(buf);
  const tail = measure(buf, Math.floor(SR * 3.3));
  ok(!m.nan && m.peak > 0.005 && m.peak <= 1.0 && tail.peak < 0.02,
    `${name.padEnd(15)} szczyt ${db(m.peak)} dBFS, RMS ${db(m.rms)} dBFS${tail.peak >= 0.02 ? ' (NIE GAŚNIE)' : ''}`);
}

console.log('\n2. Dźwięki ciągłe (fałda) trwają, dopóki gra ich nie zatrzyma');
{
  const buf = await render(4, (a, ctx) => { a.play('warp-transit', { race: 'swietlisci' }); });
  const late = measure(buf, SR * 3, SR * 4);
  ok(late.rms > 0.005, `tunel fałdy po 3 s nadal gra (RMS ${db(late.rms)} dBFS)`);
}

console.log('\n3. Głos fałdy różni się między rasami');
{
  const spectra = [];
  for (const race of Object.keys(WARP_VOICE)) {
    const buf = await render(1.2, (a) => { a.play('warp-transit', { race }); });
    // prosty "odcisk": liczba przejść przez zero (~ jasność barwy) w 0,6..1,2 s
    const d = buf.getChannelData(0);
    let zc = 0;
    for (let i = Math.floor(SR * 0.6) + 1; i < d.length; i++) if ((d[i] >= 0) !== (d[i - 1] >= 0)) zc++;
    spectra.push([race, zc]);
  }
  const vals = spectra.map((s) => s[1]);
  ok(new Set(vals).size >= 5, `różne barwy: ${spectra.map(([r, z]) => `${r} ${z}`).join(', ')}`);
}

console.log('\n4. Muzyka: każdy nastrój gra i mieści się w miksie');
for (const mood of Object.keys(MOODS)) {
  const buf = await render(16, (a) => { a.setMood(mood); a._pump(15.5); });
  const m = measure(buf, SR * 4);
  ok(!m.nan && m.rms > 0.003 && m.peak <= 1, `${mood.padEnd(10)} RMS ${db(m.rms)} dBFS, szczyt ${db(m.peak)} dBFS`);
}

console.log('\n5. Intensywność walki zagęszcza muzykę lotu');
{
  const levels = [];
  for (const I of [0, 0.5, 1]) {
    const buf = await render(14, (a) => { a.setMood('flight'); a.setIntensity(I); a._pump(13.5); });
    levels.push(measure(buf, SR * 6).rms);
  }
  ok(levels[2] > levels[0] * 1.3 && levels[1] > levels[0], `RMS przy I=0 / 0,5 / 1: ${levels.map(db).join(' / ')} dBFS`);
}

console.log('\n6. Suwaki i wyciszenie');
{
  const loud = measure(await render(2, (a) => { a.play('explosion', { when: 0.3 }); }));
  const quiet = measure(await render(2, (a) => { a.setVolume('sfx', 0.3); a.play('explosion', { when: 0.3 }); }));
  const muted = measure(await render(2, (a) => { a.setMuted(true); a.play('explosion', { when: 0.3 }); }));
  const uiOnly = measure(await render(2, (a) => { a.setVolume('sfx', 0); a.setVolume('music', 0); a.play('alarm-hull', { when: 0.3 }); }));
  ok(quiet.peak < loud.peak * 0.5, `suwak Efekty 30% ścisza wybuch (${db(loud.peak)} -> ${db(quiet.peak)} dBFS)`);
  ok(muted.peak < 1e-3, 'wyciszenie = cisza');
  ok(uiOnly.peak > 0.01, 'alarm kadłuba słychać przy wyzerowanej muzyce i efektach (szyna Komunikaty)');
}

console.log('\n7. Odległość i ogranicznik powtórzeń');
{
  const near = measure(await render(2, (a) => { a.play('explosion', { distance: 100 }); }));
  const far = measure(await render(2, (a) => { a.play('explosion', { distance: 6000 }); }));
  const none = measure(await render(2, (a) => { a.play('explosion', { distance: 60000 }); }));
  ok(far.peak < near.peak * 0.3 && none.peak < 1e-4, `wybuch 100 / 6000 / 60000 j.: ${db(near.peak)} / ${db(far.peak)} / ${db(none.peak)} dBFS`);
  const spam = measure(await render(1.5, (a) => { for (let i = 0; i < 30; i++) a.play('notify-info'); }));
  const once = measure(await render(1.5, (a) => { a.play('notify-info'); }));
  ok(spam.peak < once.peak * 1.5, '30 powiadomień w tej samej chwili brzmi jak jedno (nie sumuje się w przester)');
}

console.log(fails ? `\n${fails} niezaliczonych.` : '\nWszystko zaliczone.');
process.exit(fails ? 1 : 0);
