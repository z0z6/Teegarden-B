/**
 * MUZYKA GENERATYWNA. Nie ma nagrania: planista co 1/16 taktu decyduje, co
 * zagrać, z parametrów NASTROJU (tempo, akordy, gęstość) i INTENSYWNOŚCI
 * walki (0..1, podawanej przez grę). Dzięki temu:
 *  - muzyka nigdy się nie zapętla słyszalnie (dzwonki są losowane ze skali),
 *  - walka narasta płynnie: bas -> stopa -> hi-hat -> werbel -> arpeggio ->
 *    przejścia na kotłach, każda warstwa wchodzi przy innym progu,
 *  - zmiana nastroju (okładka -> tablica misji -> lot) następuje na granicy
 *    taktu, więc nie gubi rytmu.
 *
 * Tonacja: d-moll (eolski) we wszystkich nastrojach - przejście między
 * ekranami nie "zmienia piosenki", tylko jej gęstość i barwę. Tablica
 * misji ma akord A-dur (dominanta), który ciągnie do d-moll lotu.
 */

const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// akordy: bass (MIDI) + dźwięki padu (MIDI)
const CH = {
  Dm9: { bass: 38, pad: [57, 60, 64, 65] },
  Bbmaj7: { bass: 34, pad: [50, 53, 57, 62] },
  Fmaj9: { bass: 41, pad: [55, 57, 60, 64] },
  Cadd9: { bass: 36, pad: [55, 60, 62, 64] },
  Dm: { bass: 38, pad: [50, 57, 62, 65] },
  Bb: { bass: 34, pad: [50, 53, 58, 62] },
  Gm: { bass: 31, pad: [50, 55, 58, 62] },
  A: { bass: 33, pad: [49, 52, 57, 61] },
  C: { bass: 36, pad: [55, 60, 64, 67] },
  Am: { bass: 33, pad: [57, 60, 64, 69] },
  Dm11: { bass: 38, pad: [53, 57, 60, 67] },
};
const PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81]; // d-moll pentatonika (D4..A5)

/**
 * Nastroje:
 *  bpm, barsPerChord, chords, pad (głośność), padCut (filtr), bells
 *  (prawdopodobieństwo dzwonka na ósemkę), pulse (ósemkowy bas tablicy
 *  misji), ticks (tykanie), combat (czy warstwy walki słuchają intensywności)
 */
export const MOODS = {
  cover: { bpm: 60, barsPerChord: 2, chords: ['Dm9', 'Bbmaj7', 'Fmaj9', 'Cadd9'], pad: 0.10, padCut: 1200, bells: 0.2, sub: 0.14 },
  briefing: { bpm: 92, barsPerChord: 1, chords: ['Dm', 'Bb', 'Gm', 'A'], pad: 0.07, padCut: 900, bells: 0.06, pulse: 0.16, ticks: 0.03, sub: 0.1, boomEvery: 4 },
  flight: { bpm: 84, barsPerChord: 2, chords: ['Dm9', 'Bbmaj7', 'C', 'Am'], pad: 0.085, padCut: 1000, bells: 0.1, sub: 0.12, combat: true },
  aftermath: { bpm: 50, barsPerChord: 2, chords: ['Dm11', 'Bbmaj7'], pad: 0.06, padCut: 600, bells: 0.04, sub: 0.08 },
};

export function createMusic(T) {
  const { ctx } = T;
  const bus = T.buses.music;
  let mood = null, pending = null;
  let step = 0, bar = 0, nextT = 0, chordIdx = 0, barInChord = 0;
  let intensity = 0, target = 0;
  let started = false;

  // echo dla dzwonków i arpeggio (ósemka z kropką przy tempie lotu)
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.53;
  const fb = T.gain(0.32), dLp = T.filter('lowpass', 2600, 0.5);
  const dOut = T.gain(0.5);
  delay.connect(dLp).connect(fb).connect(delay);
  dLp.connect(dOut).connect(bus);

  const combatBus = T.gain(1);
  combatBus.connect(bus);

  function setMood(name) {
    const m = MOODS[name] ? name : 'cover';
    if (!mood) { mood = m; return; }
    // powrót do bieżącego nastroju anuluje zaplanowaną zmianę (śmierć -> szybkie odrodzenie)
    pending = m === mood ? null : m;
  }
  function setIntensity(x) { target = Math.max(0, Math.min(1, x)); }

  // ------------------------------------------------------------
  // Instrumenty
  // ------------------------------------------------------------
  function pad(at, dur, M, notes) {
    const lp = T.filter('lowpass', M.padCut, 0.9, at);
    // powolne "oddychanie" filtra - akord żyje, choć nuty stoją
    const lfo = T.osc('sine', 0.05 + Math.random() * 0.05, at), lg = T.gain(M.padCut * 0.3);
    lfo.connect(lg).connect(lp.frequency);
    const g = T.gain();
    const attack = Math.min(2.4, dur * 0.35), release = Math.min(3, dur * 0.5);
    const end = T.swell(g.gain, at, M.pad / notes.length * 2.2, attack, dur - attack, release);
    lp.connect(g).connect(bus);
    T.send(g, 0.6, 'music');
    for (const m of notes) {
      for (const d of [-7, 7]) {
        const o = T.osc('sawtooth', hz(m), at);
        o.detune.value = d;
        o.connect(lp);
        T.run(o, at, end);
      }
    }
    T.run(lfo, at, end);
  }

  function sub(at, dur, midi, level) {
    const o = T.osc('sine', hz(midi), at), g = T.gain();
    const end = T.swell(g.gain, at, level, 0.8, Math.max(0.1, dur - 0.8), 1.5);
    o.connect(g).connect(bus);
    T.run(o, at, end);
  }

  function bellNote(at, midi, level) {
    const f = hz(midi);
    const car = T.osc('sine', f, at), mod = T.osc('sine', f * 2, at), mg = T.gain();
    T.perc(mg.gain, at, f * 0.8, 0.002, 0.9);
    mod.connect(mg).connect(car.frequency);
    const g = T.gain();
    const end = T.perc(g.gain, at, level, 0.004, 2.2);
    car.connect(g);
    g.connect(bus); g.connect(delay);
    T.send(g, 0.7, 'music');
    T.run(car, at, end); T.run(mod, at, end);
  }

  function pulseBass(at, midi, level, len) {
    const o = T.osc('sawtooth', hz(midi), at), lp = T.filter('lowpass', 180, 6, at), g = T.gain();
    T.sweep(lp.frequency, at, 900, 160, len * 0.9);
    const end = T.perc(g.gain, at, level, 0.005, len);
    o.connect(lp).connect(g).connect(bus);
    T.run(o, at, end);
  }

  function combatBass(at, midi, level, len, cut) {
    const o = T.osc('square', hz(midi), at), lp = T.filter('lowpass', cut, 4, at), g = T.gain();
    T.sweep(lp.frequency, at, cut * 2.2, cut, len * 0.8);
    const end = T.perc(g.gain, at, level, 0.004, len);
    o.connect(lp).connect(g).connect(combatBus);
    T.run(o, at, end);
  }

  function kick(at, level) {
    const o = T.osc('sine', 150, at), g = T.gain();
    T.sweep(o.frequency, at, 150, 42, 0.12);
    const end = T.perc(g.gain, at, level, 0.002, 0.34);
    o.connect(g).connect(combatBus);
    T.run(o, at, end);
  }
  function hat(at, level, open = false) {
    const n = T.noise(at), hp = T.filter('highpass', 7200, 0.7, at), g = T.gain();
    const end = T.perc(g.gain, at, level, 0.001, open ? 0.16 : 0.035);
    n.connect(hp).connect(g).connect(combatBus);
    T.run(n, at, end);
  }
  function snare(at, level) {
    const n = T.noise(at), bp = T.filter('bandpass', 1900, 0.9, at), g = T.gain();
    const end = T.perc(g.gain, at, level, 0.002, 0.16);
    n.connect(bp).connect(g).connect(combatBus);
    T.send(g, 0.35, 'music');
    T.run(n, at, end);
    const o = T.osc('triangle', 190, at), og = T.gain();
    o.connect(og).connect(combatBus);
    T.run(o, at, T.perc(og.gain, at, level * 0.6, 0.002, 0.08));
  }
  function tom(at, f, level) {
    const o = T.osc('sine', f, at), g = T.gain();
    T.sweep(o.frequency, at, f, f * 0.62, 0.35);
    const end = T.perc(g.gain, at, level, 0.003, 0.42);
    o.connect(g).connect(combatBus);
    T.send(g, 0.4, 'music');
    T.run(o, at, end);
  }
  function arp(at, midi, level) {
    const o = T.osc('triangle', hz(midi), at), g = T.gain();
    const end = T.perc(g.gain, at, level, 0.003, 0.18);
    o.connect(g); g.connect(combatBus); g.connect(delay);
    T.run(o, at, end);
  }
  function tick(at, level) {
    const n = T.noise(at), bp = T.filter('bandpass', 5200, 4, at), g = T.gain();
    const end = T.perc(g.gain, at, level, 0.001, 0.025);
    n.connect(bp).connect(g).connect(bus);
    T.run(n, at, end);
  }
  function boom(at, level) {
    const o = T.osc('sine', 70, at), g = T.gain();
    T.sweep(o.frequency, at, 70, 30, 1.2);
    const end = T.perc(g.gain, at, level, 0.01, 2.2);
    o.connect(g).connect(bus);
    T.send(g, 0.8, 'music');
    T.run(o, at, end);
  }

  // ------------------------------------------------------------
  // Planista
  // ------------------------------------------------------------
  function scheduleStep(at) {
    const M = MOODS[mood];
    const spb = 60 / M.bpm;          // sekundy na ćwierćnutę
    const s16 = spb / 4;
    const sInBar = step % 16;
    const chord = CH[M.chords[chordIdx % M.chords.length]];

    // początek taktu: akordy, bas, zmiana nastroju
    if (sInBar === 0) {
      if (barInChord === 0) {
        const chordDur = spb * 4 * M.barsPerChord;
        pad(at, chordDur + 0.4, M, chord.pad);
        sub(at, chordDur, chord.bass, M.sub);
      }
      if (M.boomEvery && bar % M.boomEvery === 0) boom(at, 0.22);
    }

    // intensywność wygładzana: narasta w ~1 s, opada wolniej (walka "wybrzmiewa")
    const k = target > intensity ? 0.12 : 0.03;
    intensity += (target - intensity) * k;
    const I = M.combat ? intensity : 0;

    // dzwonki na ósemkach, rzadsze w walce (robią miejsce perkusji)
    if (sInBar % 2 === 0 && Math.random() < M.bells * (1 - I * 0.7)) {
      bellNote(at, PENTA[Math.floor(Math.random() * PENTA.length)] + (Math.random() < 0.2 ? 12 : 0), 0.035);
    }

    if (M.pulse && sInBar % 2 === 0) pulseBass(at, chord.bass + 12, M.pulse * (sInBar % 8 === 0 ? 1 : 0.7), s16 * 1.8);
    if (M.ticks && sInBar % 2 === 1) tick(at, M.ticks * (sInBar % 4 === 3 ? 1 : 0.5));

    if (I > 0.12 && sInBar % 2 === 0) {
      const PAT = [0, 0, 12, 0, 7, 0, 12, 10];
      combatBass(at, chord.bass + 12 + PAT[(sInBar / 2) % 8], 0.24 * Math.min(1, I * 1.6), s16 * 1.6, 260 + I * 1400);
    }
    if (I > 0.3 && (sInBar === 0 || sInBar === 8 || (I > 0.7 && (sInBar === 6 || sInBar === 11)))) kick(at, 0.7 * Math.min(1, I * 1.3));
    if (I > 0.22) hat(at, (sInBar % 4 === 2 ? 0.05 : 0.025) * I, sInBar === 14 && I > 0.6);
    if (I > 0.55 && (sInBar === 4 || sInBar === 12)) snare(at, 0.28 * I);
    if (I > 0.45) arp(at, chord.pad[(step) % chord.pad.length] + 12, 0.035 * I);
    if (I > 0.8 && bar % 4 === 3 && sInBar >= 12) tom(at, [196, 165, 147, 110][sInBar - 12], 0.3 * I);

    // następny krok
    step++;
    if (step % 16 === 0) {
      bar++;
      barInChord++;
      if (barInChord >= M.barsPerChord) { barInChord = 0; chordIdx++; }
      if (pending) {
        mood = pending; pending = null;
        barInChord = 0; chordIdx = 0; // nowy nastrój zaczyna od swojego pierwszego akordu
      }
    }
    return s16;
  }

  function pump(until) {
    if (!mood) return;
    if (!started) { started = true; nextT = Math.max(ctx.currentTime + 0.05, nextT); }
    // po uśpieniu karty nie nadrabiamy zaległych nut - zaczynamy od "teraz"
    if (nextT < ctx.currentTime - 0.1) nextT = ctx.currentTime + 0.05;
    while (nextT < until) nextT += scheduleStep(nextT);
  }

  // ------------------------------------------------------------
  // Przerywniki (od razu, poza siatką rytmu)
  // ------------------------------------------------------------
  function stinger(kind) {
    const at = ctx.currentTime + 0.02;
    if (kind === 'success') {
      // D-dur (pikardyjska tercja po całym d-moll) - rozjaśnienie, nie fanfara
      [62, 66, 69, 74, 78].forEach((m, i) => bellNote(at + i * 0.09, m, 0.07));
      pad(at, 2.2, { pad: 0.12, padCut: 2200 }, [50, 57, 62, 66]);
      sub(at, 1.8, 38, 0.16);
    } else if (kind === 'fail') {
      [62, 60, 57, 53].forEach((m, i) => bellNote(at + i * 0.16, m, 0.05));
      pad(at, 2.6, { pad: 0.1, padCut: 700 }, [50, 53, 56, 60]);
      boom(at, 0.3);
    } else if (kind === 'death') {
      pad(at, 3.2, { pad: 0.1, padCut: 450 }, [38, 45, 50, 51]);
    }
  }

  return {
    setMood, setIntensity, pump, stinger,
    get mood() { return pending ?? mood; },
    get intensity() { return intensity; },
  };
}
