/**
 * Android: gra w poziomie, na pełnym ekranie, z zablokowaną orientacją.
 *
 * CO ROBI (tylko na urządzeniach z Androidem i ekranem dotykowym):
 *  1. Pierwsze dotknięcie ekranu wchodzi w pełny ekran (Fullscreen API) i
 *     blokuje orientację na poziomą (screen.orientation.lock('landscape')).
 *     Przeglądarki pozwalają na to WYŁĄCZNIE po geście użytkownika, dlatego
 *     nie da się tego zrobić samo z siebie przy wczytaniu strony.
 *  2. Dopóki telefon jest w pionie, cały ekran zakrywa podpowiedź "Obróć
 *     telefon w poziom" - dotknięcie jej uruchamia krok 1, więc zwykle
 *     wystarczy jedno dotknięcie, a obraz sam się obraca.
 *  3. Mały przycisk "Pełny ekran" (u góry, na środku), gdy gra nie jest na
 *     pełnym ekranie - do ponownego wejścia po wyjściu (gest "wstecz").
 *  4. Wyłącza "pull-to-refresh" (przeciągnięcie w dół przeładowywało grę).
 *
 * DLACZEGO PEŁNY EKRAN: w Chrome dla Androida blokada orientacji działa
 * tylko w pełnym ekranie (albo w zainstalowanej aplikacji PWA). Poza nim
 * lock() jest odrzucane - wtedy zostaje samo "obróć telefon".
 *
 * Renderer sam się dostosuje: przy zmianie orientacji przeglądarka wysyła
 * `resize`, a każdy krok ma już jego obsługę (kamera + setSize).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] włącz także poza Androidem (do testów)
 * @param {() => boolean} [opts.isSuspended] np. () => renderer.xr.isPresenting -
 *        w sesji VR nie pokazujemy podpowiedzi ani przycisków
 */
export function setupAndroidLandscape({ force = false, isSuspended = () => false } = {}) {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  const noop = { active: false, enter: async () => {}, exit: async () => {} };
  if (!force && !(isAndroid && isTouch)) return noop;

  const style = document.createElement('style');
  style.textContent = `
    html, body { overscroll-behavior: none; }
    #tg-rotate {
      position: fixed; inset: 0; z-index: 2000; display: none;
      flex-direction: column; align-items: center; justify-content: center; gap: 14px;
      padding: 24px; box-sizing: border-box; text-align: center;
      background: rgba(2, 6, 12, 0.95); color: #d9f3ff;
      font-family: 'Segoe UI', sans-serif; touch-action: manipulation;
    }
    #tg-rotate.visible { display: flex; }
    #tg-rotate .tg-phone {
      width: 46px; height: 78px; border: 3px solid #9fd8ff; border-radius: 9px; box-sizing: border-box;
      animation: tg-turn 2.4s ease-in-out infinite;
    }
    @keyframes tg-turn { 0%, 30% { transform: rotate(0); } 65%, 100% { transform: rotate(-90deg); } }
    @media (prefers-reduced-motion: reduce) { #tg-rotate .tg-phone { animation: none; transform: rotate(-90deg); } }
    #tg-rotate .tg-title { font-size: 21px; font-weight: 600; }
    #tg-rotate .tg-sub { font-size: 13px; opacity: 0.75; max-width: 30ch; line-height: 1.5; }
    #tg-fs {
      position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 60;
      padding: 6px 12px; font: 600 12px 'Segoe UI', sans-serif; color: #d9f3ff; cursor: pointer;
      background: rgba(6, 14, 24, 0.7); border: 1px solid rgba(159, 216, 255, 0.4); border-radius: 999px;
      touch-action: manipulation;
    }
    #tg-fs.hidden { display: none; }
  `;
  document.head.appendChild(style);

  const rotateEl = document.createElement('div');
  rotateEl.id = 'tg-rotate';
  rotateEl.innerHTML = '<div class="tg-phone"></div><div class="tg-title">Obróć telefon w poziom</div><div class="tg-sub"></div>';
  const subEl = rotateEl.querySelector('.tg-sub');
  document.body.appendChild(rotateEl);

  const fsBtn = document.createElement('button');
  fsBtn.id = 'tg-fs';
  fsBtn.type = 'button';
  fsBtn.textContent = '⛶ Pełny ekran';
  document.body.appendChild(fsBtn);

  const portraitMQ = window.matchMedia('(orientation: portrait)');
  const fsActive = () => !!document.fullscreenElement;
  let lockFailed = false;

  function update() {
    const suspended = isSuspended();
    const showHint = portraitMQ.matches && !suspended;
    subEl.textContent = lockFailed
      ? 'Ta przeglądarka nie pozwala zablokować orientacji — obróć telefon ręcznie (i wyłącz blokadę autoobrotu, jeśli jest włączona).'
      : 'Albo dotknij ekranu: przejdziemy w pełny ekran i zablokujemy poziom.';
    rotateEl.classList.toggle('visible', showHint);
    fsBtn.classList.toggle('hidden', fsActive() || suspended || showHint);
  }

  let lastEnter = -1e9;
  async function enter() {
    // Jedno dotknięcie generuje kilka zdarzeń (pointerup, potem click) - bez
    // tego wejście w pełny ekran i lock() odpalałyby się po kilka razy. Okno
    // czasowe, a nie flaga "w trakcie": pierwsze wejście kończy się, zanim
    // dotrze click, więc flaga byłaby już zdjęta.
    const now = performance.now();
    if (now - lastEnter < 600) return;
    lastEnter = now;
    try {
      if (!fsActive() && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch (e) { /* pełny ekran odmówiony - próbujemy blokady mimo to */ }
    try {
      await screen.orientation.lock('landscape');
      lockFailed = false;
    } catch (e) {
      lockFailed = true; // brak API albo poza pełnym ekranem - zostaje ręczne obracanie
    }
    update();
  }

  async function exit() {
    try { screen.orientation.unlock(); } catch (e) { /* ignoruj */ }
    try { if (fsActive()) await document.exitFullscreen(); } catch (e) { /* ignoruj */ }
    update();
  }

  rotateEl.addEventListener('click', enter);
  fsBtn.addEventListener('click', enter);
  // pierwszy gest gdziekolwiek = wejście w pełny ekran + blokada (pointerup, bo
  // dla dotyku to on liczy się jako "gest użytkownika"; touchstart nie)
  window.addEventListener('pointerup', () => { if (!fsActive()) enter(); }, { once: true });

  portraitMQ.addEventListener?.('change', update);
  document.addEventListener('fullscreenchange', () => {
    update();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); // dopasuj renderer do nowego rozmiaru
  });
  setInterval(update, 1000); // np. koniec sesji VR, zmiana isSuspended()
  update();

  return { active: true, enter, exit };
}
