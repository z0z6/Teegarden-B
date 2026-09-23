import { SFX } from './sfx.js';
import { createMusic } from './music.js';

/**
 * WARSTWA AUDIO (krok 9): jeden silnik dla okładki, tablicy misji i gry.
 *
 * Dlaczego wszystko jest SYNTEZOWANE (Web Audio), a nie z plików:
 *  - repo nie ma żadnych nagrań i nie trzeba pilnować ich licencji;
 *  - dźwięk może zależeć od stanu gry: fałda brzmi inaczej dla każdej rasy,
 *    muzyka gęstnieje z liczbą wrogów w pobliżu, alarm przyspiesza, gdy
 *    rakieta jest bliżej;
 *  - zero ładowania - silnik waży kilkadziesiąt kB kodu.
 *
 * Miks (szyny):
 *   music ─┐
 *   sfx   ─┼─> master ─> limiter ─> głośniki
 *   ui    ─┘      ^
 *   pogłos (wspólny splot) ─┘
 * Trzy suwaki gracza: Muzyka, Efekty (fałda, broń, wybuchy), Komunikaty
 * (powiadomienia i ostrzeżenia). Ostrzeżenia chodzą po szynie `ui`, żeby
 * gracz, który ściszy muzykę i efekty, nadal słyszał alarm kadłuba.
 *
 * Przeglądarki nie pozwalają grać dźwięku przed pierwszym gestem gracza,
 * więc kontekst audio powstaje dopiero przy pierwszym kliknięciu/klawiszu.
 * Do tego czasu wszystkie wywołania są bezpieczne (nic nie robią), a
 * wybrany nastrój muzyki jest zapamiętywany i rusza po odblokowaniu.
 */

const STORE_KEY = 'teegarden-b:audio';
const DEFAULTS = { music: 0.55, sfx: 0.8, ui: 0.8, muted: false };

// Minimalny odstęp między kolejnymi odtworzeniami tego samego dźwięku (s).
// Chroni przed "karabinem" z powiadomień wywoływanych co klatkę i przed
// dziesiątkami identycznych trafień w jednej chwili.
const MIN_GAP = {
  'ui-hover': 0.05, 'notify-info': 0.25, 'notify-warning': 0.3, 'notify-danger': 0.4,
  comms: 0.9, 'pack-ack': 0.35, objective: 0.6, lock: 0.3, 'lock-lost': 0.4,
  hit: 0.07, impact: 0.05, explosion: 0.08, blast: 0.08, implosion: 0.2,
  'fire-pulse': 0.045, 'fire-missile': 0.12, 'fire-dart': 0.15, 'fire-salvo': 0.2, 'fire-torpedo': 0.25,
  'warp-slam': 0.15, 'warp-denied': 0.6, 'alarm-heat': 1.5, ambush: 2,
};
const MAX_VOICES = 40; // powyżej - pomijamy dźwięki niekrytyczne (szyny sfx)

export function loadAudioSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

/**
 * @param {object} [o]
 * @param {BaseAudioContext} [o.context]  gotowy kontekst (testy: OfflineAudioContext) - wtedy bez odblokowania i bez zegara
 * @param {boolean} [o.autoUnlock=true]   nasłuch pierwszego gestu gracza
 */
export function createAudio({ context = null, autoUnlock = true } = {}) {
  const settings = context ? { ...DEFAULTS } : loadAudioSettings();
  const subs = new Set();
  let ctx = null, B = null, T = null, music = null, timer = null;
  let pendingMood = 'cover';
  let voices = 0;
  const last = new Map();
  const loops = new Map();   // alarmy cykliczne: name -> { next }
  const holds = new Set();   // dźwięki ciągłe (np. tunel fałdy)

  const notify = () => subs.forEach((fn) => fn(api));
  const save = () => { if (!context) try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch { /* bez zapisu */ } };
  // suwak liniowy -> głośność bliższa temu, jak słyszymy; TRIM wyrównuje szyny
// między sobą (krótkie komunikaty muszą przebić się przez ciągłą muzykę)
const TRIM = { music: 0.8, sfx: 1, ui: 1.8 };
const vol = (v, bus = 'sfx') => v * v * TRIM[bus];

  // ------------------------------------------------------------
  // Graf
  // ------------------------------------------------------------
  function build(c) {
    ctx = c;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9; limiter.knee.value = 6; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.2;
    const master = g(settings.muted ? 0 : 0.9);
    master.connect(limiter).connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx, 3.2, 2.6);
    const reverbOut = g(0.55);
    reverb.connect(reverbOut).connect(master);

    const music = g(vol(settings.music, 'music')), duck = g(1);
    music.connect(duck).connect(master);
    const sfx = g(vol(settings.sfx)); sfx.connect(master);
    const ui = g(vol(settings.ui, 'ui')); ui.connect(master);
    // Wysyłki na pogłos mają własne wzmacniacze, które śledzą suwak szyny -
    // inaczej ściszona muzyka nadal "brzmiałaby" samym ogonem pogłosu.
    const verbSend = { music: g(vol(settings.music, 'music')), sfx: g(vol(settings.sfx)), ui: g(vol(settings.ui, 'ui')) };
    const duckVerb = g(1); // przyciszenie muzyki obejmuje też jej pogłos
    verbSend.music.connect(duckVerb).connect(reverb);
    verbSend.sfx.connect(reverb);
    verbSend.ui.connect(reverb);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    B = { master, limiter, reverb, music, duck, duckVerb, sfx, ui, verbSend, noise };
    T = toolkit(ctx, B);
    applyVolumes();
  }

  function toolkit(c, b) {
    const t = {
      ctx: c,
      osc(type, f, at) { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at); return o; },
      gain(v = 0) { const n = c.createGain(); n.gain.value = v; return n; },
      filter(type, f, q = 0.7, at = c.currentTime) {
        const n = c.createBiquadFilter(); n.type = type; n.frequency.setValueAtTime(f, at); n.Q.setValueAtTime(q, at); return n;
      },
      noise(at) {
        const s = c.createBufferSource(); s.buffer = b.noise; s.loop = true;
        s.playbackRate.setValueAtTime(1, at);
        s._offset = Math.random() * 1.8;
        return s;
      },
      /** perkusyjna obwiednia: 0 -> szczyt (atak) -> ~0 (zanik). Zwraca czas końca. */
      perc(param, at, peak, attack, decay) {
        param.setValueAtTime(0, at);
        param.linearRampToValueAtTime(peak, at + attack);
        param.exponentialRampToValueAtTime(Math.max(1e-4, peak * 1e-3), at + attack + decay);
        param.setValueAtTime(0, at + attack + decay + 0.01);
        return at + attack + decay + 0.02;
      },
      /** obwiednia z podtrzymaniem: atak, trwanie, zwolnienie */
      swell(param, at, peak, attack, hold, release) {
        param.setValueAtTime(0, at);
        param.linearRampToValueAtTime(peak, at + attack);
        param.setValueAtTime(peak, at + attack + hold);
        param.linearRampToValueAtTime(0, at + attack + hold + release);
        return at + attack + hold + release + 0.02;
      },
      sweep(param, at, from, to, dur) {
        param.setValueAtTime(from, at);
        param.exponentialRampToValueAtTime(Math.max(1e-3, to), at + dur);
      },
      run(src, at, end) {
        if (src._offset != null) src.start(at, src._offset); else src.start(at);
        src.stop(end);
        voices++;
        src.onended = () => { voices = Math.max(0, voices - 1); };
      },
      /** wysyłka na pogłos (ilość 0..1) */
      send(node, amount, bus = 'sfx') {
        if (amount <= 0) return;
        const s = t.gain(amount);
        node.connect(s).connect(b.verbSend[bus] ?? b.verbSend.sfx);
      },
      buses: b,
    };
    return t;
  }

  function applyVolumes() {
    if (!B) return;
    const now = ctx.currentTime;
    B.master.gain.setTargetAtTime(settings.muted ? 0 : 0.9, now, 0.015);
    B.music.gain.setTargetAtTime(vol(settings.music, 'music'), now, 0.05);
    B.sfx.gain.setTargetAtTime(vol(settings.sfx), now, 0.05);
    B.ui.gain.setTargetAtTime(vol(settings.ui, 'ui'), now, 0.05);
    for (const k of ['music', 'sfx', 'ui']) B.verbSend[k].gain.setTargetAtTime(vol(settings[k], k), now, 0.05);
  }

  // ------------------------------------------------------------
  // Odblokowanie (pierwszy gest), karta w tle
  // ------------------------------------------------------------
  function start(c) {
    build(c);
    // muzyka ma własny licznik: limit głosów dotyczy efektów, a gęsta muzyka
    // walki nie może "zjadać" miejsca na wystrzały i trafienia
    music = createMusic({ ...T, run(src, at, end) { if (src._offset != null) src.start(at, src._offset); else src.start(at); src.stop(end); } });
    music.setMood(pendingMood);
    if (!context) {
      // zegar planisty: co 25 ms planujemy nuty ~0,2 s naprzód (bez przycięć przy skokach klatek)
      timer = setInterval(() => { if (ctx.state === 'running') music.pump(ctx.currentTime + 0.2); }, 25);
    }
    notify();
  }

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      start(new AC({ latencyHint: 'interactive' }));
      ctx.resume?.();
      ctx.onstatechange = notify;
    } catch (err) { console.warn('Audio: brak Web Audio.', err); }
  }

  if (context) start(context);
  else if (autoUnlock && typeof window !== 'undefined' && window.addEventListener) {
    const opts = { capture: true, passive: true };
    const once = () => {
      unlock();
      if (ctx?.state === 'running' || ctx) for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, once, opts);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, once, opts);
    document.addEventListener?.('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
  }

  // ------------------------------------------------------------
  // Odtwarzanie
  // ------------------------------------------------------------
  /**
   * @param {string} name  klucz z SFX
   * @param {object} [o]
   *   distance  - odległość źródła (j. świata); głośność 1/(1+(d/ref)²), dalekie źródła głuchną
   *   ref       - zasięg "pełnej" głośności (domyślnie z przepisu)
   *   pan       - -1 (lewo) .. 1 (prawo)
   *   gain      - mnożnik
   *   when      - opóźnienie (s)
   *   ...reszta trafia do przepisu (np. race, size, base)
   * @returns uchwyt { stop(fade) } dla dźwięków ciągłych, inaczej null
   */
  function play(name, o = {}) {
    if (!ctx || !B || ctx.state === 'closed') return null;
    const recipe = SFX[name];
    if (!recipe) return null;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap && !o.force) {
      if (now - (last.get(name) ?? -1e9) < gap) return null;
      last.set(name, now);
    }
    const bus = recipe.bus ?? 'sfx';
    if (bus === 'sfx' && voices > MAX_VOICES && !recipe.critical) return null;

    let att = 1;
    if (o.distance != null) {
      const ref = o.ref ?? recipe.ref ?? 900;
      att = 1 / (1 + (o.distance / ref) ** 2);
      if (att < 0.015) return null;
    }
    const at = now + (o.when ?? 0) + 0.005;
    const out = T.gain((o.gain ?? 1) * att);
    let tail = out;
    if (o.distance != null && att < 0.9) {
      // dalekie = ciemniejsze (umowna "akustyka" - w próżni nie ma dźwięku, ale gra potrzebuje odległości)
      const lp = T.filter('lowpass', Math.max(700, 16000 * Math.sqrt(att)), 0.5, at);
      tail.connect(lp); tail = lp;
    }
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(Math.max(-1, Math.min(1, o.pan)), at);
      tail.connect(p); tail = p;
    }
    tail.connect(B[bus]);
    // pogłos po torze przestrzennym: dalekie źródła mają go względnie więcej
    const verb = o.verb ?? recipe.verb ?? 0;
    if (verb) T.send(tail, verb * (o.distance != null ? 0.7 + 0.6 * (1 - att) : 1), bus);
    const h = recipe.play(T, at, out, o);
    if (h && typeof h.stop === 'function') { holds.add(h); const s = h.stop; h.stop = (f, when) => { holds.delete(h); s(f, when); }; return h; }
    return null;
  }

  /**
   * Alarm cykliczny: wołany CO KLATKĘ z `active`; gra `name` co `interval` s,
   * dopóki warunek trwa. Pierwsze odtworzenie od razu, gdy alarm się włącza.
   */
  function alarm(name, active, interval = 2, o = {}) {
    const L = loops.get(name);
    if (!active) { if (L) loops.delete(name); return; }
    if (!ctx) return;
    const now = ctx.currentTime;
    if (!L) { loops.set(name, { next: now + interval }); play(name, { ...o, force: true }); return; }
    if (now >= L.next) { L.next = now + interval; play(name, { ...o, force: true }); }
    else if (L.next - now > interval) L.next = now + interval; // interwał skrócił się (rakieta bliżej)
  }

  /** Przyciszenie muzyki (fałda, śmierć): 0..1, czas narastania (s) */
  function duck(level = 1, time = 0.3) {
    if (!B) return;
    B.duck.gain.setTargetAtTime(level, ctx.currentTime, time / 3);
    B.duckVerb.gain.setTargetAtTime(level, ctx.currentTime, time / 3);
  }

  function setVolume(bus, v) {
    if (!(bus in DEFAULTS) || bus === 'muted') return;
    settings[bus] = Math.max(0, Math.min(1, v));
    applyVolumes(); save(); notify();
  }
  function setMuted(m) {
    settings.muted = !!m;
    applyVolumes(); save(); notify();
  }

  function setMood(name) {
    pendingMood = name;
    music?.setMood(name);
  }

  /** Wyciszenie całości przed przejściem na inną stronę (link "Graj" itd.) */
  function fadeOut(time = 0.35) {
    if (!B) return Promise.resolve();
    B.master.gain.setTargetAtTime(0, ctx.currentTime, time / 4);
    return new Promise((r) => setTimeout(r, time * 1000));
  }

  const api = {
    play, alarm, duck, setMood, setVolume, setMuted, fadeOut, unlock,
    toggleMute() { setMuted(!settings.muted); },
    setIntensity(x) { music?.setIntensity(x); },
    stinger(kind) { music?.stinger(kind); },
    subscribe(fn) { subs.add(fn); fn(api); return () => subs.delete(fn); },
    get settings() { return { ...settings }; },
    get ready() { return !!ctx && ctx.state === 'running'; },
    get locked() { return !ctx || ctx.state !== 'running'; },
    get context() { return ctx; },
    get mood() { return music?.mood ?? pendingMood; },
    get intensity() { return music?.intensity ?? 0; },
    get voices() { return voices; },
    /** testy offline: zaplanuj muzykę do czasu `t` */
    _pump(t) { music?.pump(t); },
    _stopAll() { for (const h of [...holds]) h.stop(0.05); clearInterval(timer); },
  };
  return api;
}

/** Odpowiedź impulsowa pogłosu: szum stereo z wykładniczym zanikiem */
function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // krótki "przedpogłos" (pierwsze odbicia) i gładki, ciemniejący ogon
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay) * (i < ctx.sampleRate * 0.012 ? 0.3 : 1);
    }
  }
  return buf;
}

// Jeden silnik na stronę (moduły gry, HUD i przyciski dzielą ten sam miks).
let shared = null;
export function getAudio() {
  if (!shared) shared = createAudio();
  return shared;
}
