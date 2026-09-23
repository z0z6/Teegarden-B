/**
 * PRZEPISY DŹWIĘKÓW (synteza Web Audio). Każdy przepis to
 *   { bus: 'sfx' | 'ui', ref, verb, critical, play(T, at, out, o) }
 * gdzie T to zestaw narzędzi z audio.js (oscylatory, filtry, szum,
 * obwiednie), `at` - czas startu, `out` - wejście toru (głośność,
 * odległość, panorama są już za nim), `o` - opcje wywołania.
 * Dźwięki ciągłe (ładowanie i tunel fałdy) zwracają uchwyt { stop(fade) }.
 *
 * Zasada brzmienia: interfejs i ostrzeżenia to czyste, krótkie tony
 * (czytelne przez muzykę i wybuchy), a świat - szum, niskie pasmo i
 * pogłos (masa, odległość). Im groźniejszy komunikat, tym ostrzejsza
 * barwa: sinus (informacja) -> trójkąt (uwaga) -> piła (zagrożenie).
 */

/**
 * Głos fałdy każdej rasy - ta sama idea co wizualna sygnatura skoku
 * (warp-drive.js: pieczęć, okno, harmoniczna, szczep, klauzula, korona,
 * pryzmat). base = ton podstawowy (Hz), interval = drugi ton (półtony),
 * shimmer = szklisty górny alikwot, grit = ile "piachu" (szumu).
 */
export const WARP_VOICE = {
  wybudzeni:  { base: 55.0, shape: 'sawtooth', interval: 7,  shimmer: 0.0,  grit: 0.30 }, // pieczęć: nisko, ciężko, czysta kwinta
  rezonanci:  { base: 73.4, shape: 'square',   interval: 12, shimmer: 0.25, grit: 0.15 }, // okno: oktawy, "kworum"
  piesniarze: { base: 65.4, shape: 'triangle', interval: 7,  shimmer: 0.55, grit: 0.10 }, // harmoniczna: miękko, śpiewnie
  szczepieni: { base: 49.0, shape: 'sawtooth', interval: 6,  shimmer: 0.0,  grit: 0.70 }, // szczep: tryton i chropowatość
  wykonawcy:  { base: 58.3, shape: 'square',   interval: 5,  shimmer: 0.10, grit: 0.25 }, // klauzula: sucha kwarta
  heliotropi: { base: 82.4, shape: 'sawtooth', interval: 7,  shimmer: 0.35, grit: 0.45 }, // korona: jasno, gorąco
  swietlisci: { base: 98.0, shape: 'sine',     interval: 12, shimmer: 0.85, grit: 0.05 }, // pryzmat: szkło
};
const voiceOf = (o) => WARP_VOICE[o.race] ?? WARP_VOICE.wybudzeni;
const semis = (f, s) => f * 2 ** (s / 12);
const jitter = (f, p = 0.04) => f * (1 + (Math.random() * 2 - 1) * p);

// ------------------------------------------------------------
// Klocki
// ------------------------------------------------------------
function tone(T, at, out, { type = 'sine', f, f2 = null, dur, peak, attack = 0.004, lp = null, sweepDur = null }) {
  const o = T.osc(type, f, at);
  if (f2) T.sweep(o.frequency, at, f, f2, sweepDur ?? dur);
  const g = T.gain();
  const end = T.perc(g.gain, at, peak, attack, dur);
  let n = o;
  if (lp) { const fl = T.filter('lowpass', lp, 0.7, at); n.connect(fl); n = fl; }
  n.connect(g).connect(out);
  T.run(o, at, end);
  return end;
}

function hiss(T, at, out, { type = 'bandpass', f, f2 = null, q = 1, dur, peak, attack = 0.002, sweepDur = null }) {
  const n = T.noise(at);
  const fl = T.filter(type, f, q, at);
  if (f2) T.sweep(fl.frequency, at, f, f2, sweepDur ?? dur);
  const g = T.gain();
  const end = T.perc(g.gain, at, peak, attack, dur);
  n.connect(fl).connect(g).connect(out);
  T.run(n, at, end);
  return end;
}

/** dzwonek FM: nośna + modulator 3,5× (metaliczny, "szklany" komunikat) */
function bell(T, at, out, f, peak, decay = 0.7) {
  const car = T.osc('sine', f, at), mod = T.osc('sine', f * 3.5, at), mg = T.gain();
  T.perc(mg.gain, at, f * 1.1, 0.002, decay * 0.45);
  mod.connect(mg).connect(car.frequency);
  const g = T.gain();
  const end = T.perc(g.gain, at, peak, 0.003, decay);
  car.connect(g).connect(out);
  T.run(car, at, end); T.run(mod, at, end);
  return end;
}

/** podtrzymany dźwięk z uchwytem stop(fade); maxDur - bezpiecznik */
function held(T, at, out, peak, attack, maxDur, build) {
  const g = T.gain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.connect(out);
  const srcs = build(g) ?? [];
  for (const s of srcs) T.run(s, at, at + maxDur);
  let stopped = false;
  return {
    /** fade - czas wygaszenia; at - kiedy (domyślnie teraz; testy offline planują z góry) */
    stop(fade = 0.25, at = null) {
      if (stopped) return;
      stopped = true;
      const now = Math.max(T.ctx.currentTime, at ?? 0);
      g.gain.cancelScheduledValues(now);
      if (at == null) g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + Math.max(0.02, fade));
      for (const s of srcs) { try { s.stop(now + fade + 0.05); } catch { /* już zatrzymany */ } }
    },
  };
}

function explosionBody(T, at, out, size = 1, peak = 0.5) {
  const s = Math.max(0.4, Math.min(3, size));
  const len = 1.1 * Math.sqrt(s);
  hiss(T, at, out, { type: 'lowpass', f: 2600 / s ** 0.3, f2: 110, q: 0.6, dur: len, peak, attack: 0.004 });
  tone(T, at, out, { f: 80 / s ** 0.2, f2: 26, dur: 0.9 * Math.sqrt(s), peak: peak * 1.2, attack: 0.006 });
  hiss(T, at + 0.04, out, { type: 'highpass', f: 3200, dur: 0.28 * s, peak: peak * 0.16 });
  return at + len;
}

// ------------------------------------------------------------
// Przepisy
// ------------------------------------------------------------
export const SFX = {
  // ---------------- interfejs ----------------
  'ui-hover': { bus: 'ui', play: (T, at, out) => tone(T, at, out, { f: 1900, f2: 1500, dur: 0.04, peak: 0.035 }) },
  'ui-click': {
    bus: 'ui',
    play: (T, at, out) => {
      tone(T, at, out, { type: 'triangle', f: 880, f2: 640, dur: 0.06, peak: 0.1 });
      hiss(T, at, out, { type: 'highpass', f: 4000, dur: 0.015, peak: 0.05 });
    },
  },
  'ui-confirm': {
    bus: 'ui', verb: 0.25,
    play: (T, at, out) => { bell(T, at, out, 880, 0.11); bell(T, at + 0.07, out, 1318.5, 0.11, 0.9); },
  },
  'ui-back': {
    bus: 'ui', verb: 0.2,
    play: (T, at, out) => { bell(T, at, out, 1318.5, 0.08, 0.4); bell(T, at + 0.06, out, 880, 0.08, 0.6); },
  },

  // ---------------- powiadomienia ----------------
  'notify-info': {
    bus: 'ui', verb: 0.25,
    play: (T, at, out) => { bell(T, at, out, 1174.7, 0.08, 0.55); bell(T, at + 0.08, out, 1568, 0.065, 0.7); },
  },
  'notify-warning': {
    bus: 'ui', verb: 0.1,
    play: (T, at, out) => {
      tone(T, at, out, { type: 'triangle', f: 740, dur: 0.09, peak: 0.12, lp: 3000 });
      tone(T, at + 0.15, out, { type: 'triangle', f: 740, dur: 0.09, peak: 0.12, lp: 3000 });
    },
  },
  'notify-danger': {
    bus: 'ui', critical: true,
    play: (T, at, out) => {
      [880, 698.5, 880].forEach((f, i) => {
        const bp = T.filter('bandpass', 1600, 1.2, at);
        bp.connect(out);
        tone(T, at + i * 0.11, bp, { type: 'sawtooth', f, dur: 0.075, peak: 0.16 });
      });
    },
  },
  comms: {
    bus: 'ui', verb: 0.15,
    // "otwarcie kanału": trzask radiowy, dwa tony wywołania i ogon blokady szumów
    play: (T, at, out) => {
      hiss(T, at, out, { f: 2200, q: 2, dur: 0.08, peak: 0.08 });
      tone(T, at + 0.06, out, { f: 1320, dur: 0.05, peak: 0.07 });
      tone(T, at + 0.12, out, { f: 1760, dur: 0.07, peak: 0.07 });
      hiss(T, at + 0.19, out, { f: 3000, f2: 1100, q: 1.5, dur: 0.16, peak: 0.03 });
    },
  },
  'pack-ack': {
    bus: 'ui',
    play: (T, at, out) => {
      hiss(T, at, out, { type: 'highpass', f: 2500, dur: 0.02, peak: 0.06 });
      tone(T, at + 0.03, out, { type: 'square', f: 1046.5, dur: 0.04, peak: 0.03, lp: 2500 });
    },
  },
  objective: {
    bus: 'ui', verb: 0.3,
    play: (T, at, out) => { [587.3, 740, 880].forEach((f, i) => bell(T, at + i * 0.09, out, f, 0.075, 0.6)); },
  },
  'mission-start': {
    bus: 'ui', verb: 0.45,
    // róg: kwinta D-A otwierająca filtr + niski puls
    play: (T, at, out) => {
      const lp = T.filter('lowpass', 300, 1, at);
      T.sweep(lp.frequency, at, 300, 2400, 0.9);
      const g = T.gain();
      const end = T.swell(g.gain, at, 0.1, 0.45, 0.35, 0.9);
      lp.connect(g).connect(out);
      for (const [f, d] of [[146.8, -6], [146.8, 6], [220, 0], [293.7, 4]]) {
        const o = T.osc('sawtooth', f, at); o.detune.value = d; o.connect(lp); T.run(o, at, end);
      }
      tone(T, at, out, { f: 73.4, f2: 55, dur: 0.8, peak: 0.25, attack: 0.02 });
    },
  },
  lock: {
    bus: 'ui',
    play: (T, at, out) => {
      tone(T, at, out, { f: 1480, dur: 0.08, peak: 0.07 });
      tone(T, at + 0.11, out, { f: 1480, dur: 0.12, peak: 0.07 });
    },
  },
  'lock-lost': { bus: 'ui', play: (T, at, out) => tone(T, at, out, { f: 1200, f2: 480, dur: 0.25, peak: 0.07 }) },
  'warp-ready': {
    bus: 'ui', verb: 0.3,
    play: (T, at, out) => { bell(T, at, out, 784, 0.055, 0.5); bell(T, at + 0.1, out, 1174.7, 0.055, 0.8); },
  },

  // ---------------- ostrzeżenia ----------------
  'alarm-hull': {
    bus: 'ui', critical: true,
    // klakson "łuuu-łuuu": dwie rozstrojone piły opadające o tercję
    play: (T, at, out) => {
      for (const k of [0, 0.62]) {
        const bp = T.filter('bandpass', 1100, 0.8, at + k);
        const g = T.gain();
        const end = T.swell(g.gain, at + k, 0.13, 0.02, 0.36, 0.12);
        bp.connect(g).connect(out);
        for (const f of [440, 446]) {
          const o = T.osc('sawtooth', f, at + k);
          T.sweep(o.frequency, at + k, f, f * 0.8, 0.5);
          o.connect(bp); T.run(o, at + k, end);
        }
      }
    },
  },
  'alarm-missile': {
    bus: 'ui', critical: true,
    play: (T, at, out) => tone(T, at, out, { type: 'square', f: 1760, dur: 0.05, peak: 0.05, lp: 4000 }),
  },
  'alarm-heat': {
    bus: 'ui', critical: true,
    // brzęczyk: niskie piły z tremolo 14 Hz
    play: (T, at, out) => {
      const lp = T.filter('lowpass', 1000, 0.8, at);
      const g = T.gain();
      const end = T.swell(g.gain, at, 0.14, 0.01, 0.55, 0.1);
      const trem = T.gain(0.5), lfo = T.osc('square', 14, at), lg = T.gain(0.5);
      lfo.connect(lg).connect(trem.gain);
      lp.connect(trem).connect(g).connect(out);
      for (const f of [98, 101]) { const o = T.osc('sawtooth', f, at); o.connect(lp); T.run(o, at, end); }
      T.run(lfo, at, end);
    },
  },
  'warp-denied': {
    bus: 'ui', critical: true,
    play: (T, at, out) => {
      tone(T, at, out, { type: 'sawtooth', f: 320, f2: 80, dur: 0.35, peak: 0.1, lp: 1500 });
      hiss(T, at, out, { f: 1200, q: 0.8, dur: 0.25, peak: 0.06 });
    },
  },
  ambush: {
    bus: 'ui', verb: 0.5, critical: true,
    // uderzenie: tryton D-As w dole + ciężki szum - "coś wyszło z cienia"
    play: (T, at, out) => {
      const lp = T.filter('lowpass', 1600, 1, at);
      T.sweep(lp.frequency, at, 1600, 380, 0.9);
      const g = T.gain();
      const end = T.swell(g.gain, at, 0.13, 0.01, 0.25, 0.9);
      lp.connect(g).connect(out);
      for (const m of [38, 44, 50]) { const o = T.osc('sawtooth', 440 * 2 ** ((m - 69) / 12), at); o.connect(lp); T.run(o, at, end); }
      hiss(T, at, out, { f: 400, q: 0.7, dur: 0.45, peak: 0.16 });
    },
  },

  // ---------------- walka ----------------
  hit: {
    bus: 'sfx', critical: true,
    // trafienie w NASZ kadłub: głuche uderzenie + metaliczny rezonans
    play: (T, at, out, o) => {
      const k = Math.min(1.4, 0.6 + (o.amount ?? 20) / 50);
      hiss(T, at, out, { type: 'lowpass', f: 900, f2: 200, dur: 0.12, peak: 0.32 * k });
      tone(T, at, out, { f: 110, f2: 45, dur: 0.18, peak: 0.4 * k });
      tone(T, at, out, { f: jitter(233), dur: 0.35, peak: 0.05 * k });
      tone(T, at, out, { f: jitter(367), dur: 0.3, peak: 0.035 * k });
    },
  },
  impact: {
    bus: 'sfx', ref: 600,
    play: (T, at, out) => {
      hiss(T, at, out, { f: 1800, f2: 700, q: 0.8, dur: 0.07, peak: 0.12 });
      tone(T, at, out, { type: 'triangle', f: 300, f2: 120, dur: 0.06, peak: 0.06 });
    },
  },
  explosion: { bus: 'sfx', ref: 2200, verb: 0.35, play: (T, at, out, o) => explosionBody(T, at, out, o.size ?? 1, 0.38) },
  blast: {
    bus: 'sfx', ref: 1800, verb: 0.3,
    play: (T, at, out) => {
      hiss(T, at, out, { type: 'lowpass', f: 3500, f2: 200, dur: 0.6, peak: 0.34 });
      tone(T, at, out, { f: 110, f2: 40, dur: 0.4, peak: 0.34 });
    },
  },
  implosion: {
    bus: 'sfx', ref: 2500, verb: 0.5,
    // zassanie (szum rośnie i wspina się w górę), potem ciężkie tąpnięcie
    play: (T, at, out) => {
      const n = T.noise(at), bp = T.filter('bandpass', 200, 1.2, at), g = T.gain();
      T.sweep(bp.frequency, at, 200, 4000, 0.5);
      const end = T.swell(g.gain, at, 0.28, 0.45, 0, 0.06);
      n.connect(bp).connect(g).connect(out); T.run(n, at, end);
      tone(T, at, out, { f: 220, f2: 55, dur: 0.5, peak: 0.08, attack: 0.3 });
      tone(T, at + 0.46, out, { f: 60, f2: 24, dur: 0.8, peak: 0.45 });
      hiss(T, at + 0.46, out, { type: 'lowpass', f: 1800, f2: 120, dur: 0.7, peak: 0.3 });
    },
  },
  'fire-pulse': {
    bus: 'sfx', ref: 900,
    play: (T, at, out) => {
      tone(T, at, out, { type: 'square', f: jitter(1300), f2: 260, dur: 0.09, peak: 0.055, lp: 3500 });
      hiss(T, at, out, { type: 'highpass', f: 5000, dur: 0.02, peak: 0.03 });
    },
  },
  'fire-missile': {
    bus: 'sfx', ref: 1000, verb: 0.1,
    play: (T, at, out) => {
      hiss(T, at, out, { f: 900, f2: 2400, q: 1.5, dur: 0.45, peak: 0.12, attack: 0.03 });
      tone(T, at, out, { type: 'sawtooth', f: 180, f2: 120, dur: 0.3, peak: 0.03, lp: 800 });
    },
  },
  'fire-dart': {
    bus: 'sfx', ref: 1100, verb: 0.15,
    play: (T, at, out) => {
      tone(T, at, out, { f: 140, f2: 60, dur: 0.2, peak: 0.24 });
      hiss(T, at, out, { f: 600, f2: 1800, q: 1.2, dur: 0.6, peak: 0.1, attack: 0.05 });
    },
  },
  'fire-salvo': {
    bus: 'sfx', ref: 1100, verb: 0.15,
    play: (T, at, out) => {
      for (const k of [0, 0.07, 0.14]) {
        tone(T, at + k, out, { f: jitter(170), f2: 70, dur: 0.14, peak: 0.14 });
        hiss(T, at + k, out, { f: 700, f2: 2000, q: 1.2, dur: 0.4, peak: 0.06, attack: 0.03 });
      }
    },
  },
  'fire-torpedo': {
    bus: 'sfx', ref: 1300, verb: 0.3,
    play: (T, at, out) => {
      tone(T, at, out, { f: 90, f2: 35, dur: 0.5, peak: 0.4 });
      hiss(T, at, out, { type: 'lowpass', f: 500, f2: 1500, dur: 0.9, peak: 0.12, attack: 0.1 });
    },
  },

  // ---------------- fałda ----------------
  'warp-charge': {
    bus: 'sfx', verb: 0.25, critical: true,
    // ładowanie: dwa tony głosu rasy wspinają się o dwie oktawy, tremolo
    // przyspiesza 4 -> 22 Hz, syk rośnie. Trwa tyle co faza "charge".
    play: (T, at, out, o) => {
      const v = voiceOf(o), dur = o.dur ?? 1.4;
      return held(T, at, out, 0.24, dur, dur + 4, (g) => {
        const trem = T.gain(0.6), lfo = T.osc('sine', 4, at), lg = T.gain(0.4);
        T.sweep(lfo.frequency, at, 4, 22, dur);
        lfo.connect(lg).connect(trem.gain);
        const lp = T.filter('lowpass', 600, 2, at);
        T.sweep(lp.frequency, at, 600, 5000, dur);
        lp.connect(trem).connect(g);
        const a = T.osc(v.shape, v.base * 2, at), b = T.osc(v.shape, semis(v.base * 2, v.interval), at);
        T.sweep(a.frequency, at, v.base * 2, v.base * 8, dur);
        T.sweep(b.frequency, at, semis(v.base * 2, v.interval), semis(v.base * 8, v.interval), dur);
        a.connect(lp); b.connect(lp);
        const n = T.noise(at), hp = T.filter('highpass', 2000, 0.7, at), ng = T.gain(0);
        T.sweep(hp.frequency, at, 2000, 6000, dur);
        ng.gain.setValueAtTime(0, at); ng.gain.linearRampToValueAtTime(0.25 + v.grit * 0.4, at + dur);
        n.connect(hp).connect(ng).connect(g);
        const srcs = [a, b, lfo, n];
        if (v.shimmer > 0) {
          const s = T.osc('sine', v.base * 16, at), sg = T.gain(0.05 * v.shimmer);
          T.sweep(s.frequency, at, v.base * 16, v.base * 32, dur);
          s.connect(sg).connect(g); srcs.push(s);
        }
        return srcs;
      });
    },
  },
  'warp-dive': {
    bus: 'sfx', verb: 0.4, critical: true,
    play: (T, at, out, o) => {
      const v = voiceOf(o);
      hiss(T, at, out, { f: 300, f2: 7000, q: 1.2, dur: 0.55, peak: 0.34, attack: 0.25 });
      tone(T, at, out, { f: v.base * 2, f2: v.base * 0.5, dur: 0.6, peak: 0.5, attack: 0.02 });
      if (v.shimmer > 0) tone(T, at, out, { f: v.base * 16, f2: v.base * 32, dur: 0.4, peak: 0.05 * v.shimmer });
    },
  },
  'warp-transit': {
    bus: 'sfx', verb: 0.3, critical: true,
    // tunel: rozstrojony dron głosu rasy za "oddychającym" filtrem + wiatr
    play: (T, at, out, o) => {
      const v = voiceOf(o);
      return held(T, at, out, 0.16, 0.4, o.maxDur ?? 10, (g) => {
        const lp = T.filter('lowpass', 420, 1.5, at);
        const lfo = T.osc('sine', 0.35, at), lg = T.gain(260);
        lfo.connect(lg).connect(lp.frequency);
        lp.connect(g);
        const srcs = [lfo];
        for (const [f, d] of [[v.base, -8], [v.base, 8], [semis(v.base, v.interval), 0], [v.base * 2, 3]]) {
          const s = T.osc(v.shape === 'sine' ? 'triangle' : v.shape, f, at); s.detune.value = d; s.connect(lp); srcs.push(s);
        }
        const n = T.noise(at), bp = T.filter('bandpass', 800, 0.7, at), ng = T.gain(0.18 + v.grit * 0.3);
        const wl = T.osc('sine', 0.21, at), wg = T.gain(450);
        wl.connect(wg).connect(bp.frequency);
        n.connect(bp).connect(ng).connect(g);
        srcs.push(n, wl);
        if (v.shimmer > 0) {
          const s = T.osc('sine', v.base * 8, at), sg = T.gain(0.08 * v.shimmer);
          const vib = T.osc('sine', 5, at), vg = T.gain(v.base * 0.05);
          vib.connect(vg).connect(s.frequency);
          s.connect(sg).connect(g); srcs.push(s, vib);
        }
        return srcs;
      });
    },
  },
  'warp-slam': {
    bus: 'sfx', ref: 3000, verb: 0.55, critical: true,
    // zatrzaśnięcie fałdy (wyjście gracza albo przylot/odlot NPC w pobliżu)
    play: (T, at, out, o) => {
      const v = voiceOf(o);
      tone(T, at, out, { f: v.base * 1.6, f2: 24, dur: 1.1, peak: 0.45, attack: 0.004 });
      hiss(T, at, out, { type: 'lowpass', f: 4000, f2: 150, dur: 0.9, peak: 0.3 });
      hiss(T, at, out, { type: 'highpass', f: 2500, dur: 0.08, peak: 0.2 });
      bell(T, at, out, v.base * 8, 0.04 * (1 + v.shimmer * 2), 1.4);
    },
  },

  // ---------------- śmierć ----------------
  death: {
    bus: 'sfx', verb: 0.6, critical: true,
    play: (T, at, out) => {
      explosionBody(T, at, out, 2.6, 0.45);
      tone(T, at, out, { type: 'sawtooth', f: 55, f2: 30, dur: 2.5, peak: 0.22, lp: 300 });
      // "piszczenie w uszach" po wybuchu, bardzo ciche
      const g = T.gain(), s = T.osc('sine', 3800, at + 0.2);
      const end = T.swell(g.gain, at + 0.2, 0.012, 0.3, 1.2, 1.5);
      s.connect(g).connect(out); T.run(s, at + 0.2, end);
    },
  },
};

export const SFX_NAMES = Object.keys(SFX);
