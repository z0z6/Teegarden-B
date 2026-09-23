/**
 * Przycisk głośnika + panel z trzema suwakami (Muzyka, Efekty, Komunikaty)
 * i wyciszeniem. Ten sam element na okładce, tablicy misji i w grze -
 * ustawienia są wspólne (localStorage), więc gracz ustawia je raz.
 *
 * Wygląd bierze się ze zmiennych CSS strony, jeśli są (--hud, --ink,
 * --glass, --line), inaczej z bezpiecznych wartości domyślnych.
 */

const CSS = `
.au { position: fixed; z-index: 1500; font-family: var(--body, 'Segoe UI', system-ui, sans-serif); color: var(--ink, #eaf4ff); }
.au-btn {
  position: relative; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; cursor: pointer;
  color: var(--hud, #9fd8ff); background: var(--glass, rgba(6, 14, 24, 0.66));
  border: 1px solid var(--line, rgba(159, 216, 255, 0.28)); border-radius: 50%;
  transition: border-color 0.15s, color 0.15s;
}
.au-btn:hover { border-color: var(--hud, #9fd8ff); }
.au-btn:focus-visible, .au input:focus-visible { outline: 2px solid var(--ember, #ff7a45); outline-offset: 2px; }
.au-btn svg { width: 20px; height: 20px; }
.au[data-muted="true"] .au-btn { color: var(--ink-dim, #9fb3c6); }
.au[data-locked="true"] .au-btn::after {
  content: ''; position: absolute; top: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%;
  background: var(--ember, #ff7a45); box-shadow: 0 0 8px var(--ember, #ff7a45);
}
.au-panel {
  position: absolute; width: 230px; padding: 12px 14px 10px; display: none;
  background: rgba(6, 14, 24, 0.94); border: 1px solid var(--line, rgba(159, 216, 255, 0.28)); border-radius: 8px;
  box-shadow: 0 12px 40px -12px rgba(0, 0, 0, 0.8); backdrop-filter: blur(6px);
}
.au.open .au-panel { display: block; }
.au-panel h3 { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--hud, #9fd8ff); }
.au-row { display: grid; grid-template-columns: 86px 1fr 30px; align-items: center; gap: 8px; margin: 7px 0; font-size: 13px; }
.au-row output { font-size: 11px; text-align: right; color: var(--ink-dim, #9fb3c6); font-variant-numeric: tabular-nums; }
.au input[type=range] { width: 100%; accent-color: var(--hud, #9fd8ff); }
.au-mute { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; cursor: pointer; }
.au-note { margin: 8px 0 0; font-size: 11px; line-height: 1.4; color: var(--ink-dim, #9fb3c6); }
`;

const ICON_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" fill-opacity="0.2"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
const ICON_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" fill-opacity="0.2"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>';

const BUSES = [['music', 'Muzyka'], ['sfx', 'Efekty'], ['ui', 'Komunikaty']];

/**
 * @param {ReturnType<import('./audio.js').createAudio>} audio
 * @param {object} [o]
 *   corner: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left'
 *   offset: [x, y] px od krawędzi
 *   note: dodatkowa linijka pod suwakami (np. skrót klawiszowy)
 */
export function mountAudioControls(audio, { corner = 'top-right', offset = [16, 16], note = '' } = {}) {
  if (!document.getElementById('au-style')) {
    const st = document.createElement('style');
    st.id = 'au-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'au';
  const [v, h] = corner.split('-');
  root.style[v] = `max(${offset[1]}px, env(safe-area-inset-${v}))`;
  root.style[h] = `max(${offset[0]}px, env(safe-area-inset-${h}))`;
  root.innerHTML = `
    <button class="au-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Dźwięk"></button>
    <div class="au-panel" role="group" aria-label="Ustawienia dźwięku">
      <h3>Dźwięk</h3>
      ${BUSES.map(([k, label]) => `
        <label class="au-row"><span>${label}</span><input type="range" min="0" max="100" step="1" data-bus="${k}" aria-label="${label}"><output data-out="${k}"></output></label>`).join('')}
      <label class="au-mute"><input type="checkbox" data-mute> Wycisz wszystko</label>
      <p class="au-note" data-note></p>
    </div>`;
  const panel = root.querySelector('.au-panel');
  panel.style[v === 'top' ? 'top' : 'bottom'] = '46px';
  panel.style[h] = '0';
  const btn = root.querySelector('.au-btn');
  document.body.appendChild(root);

  // klik w panel nie może strzelać ani obracać statku w grze
  for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus(); }
    e.stopPropagation(); // strzałki na suwaku nie sterują statkiem
  });

  function open() { root.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  function close() { root.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
  btn.addEventListener('click', () => {
    audio.unlock();
    if (root.classList.contains('open')) close(); else { open(); audio.play('ui-click'); }
  });
  document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) close(); });

  for (const input of root.querySelectorAll('input[type=range]')) {
    input.addEventListener('input', () => audio.setVolume(input.dataset.bus, input.value / 100));
    // próbka przy puszczeniu suwaka: słychać, jak głośna jest ta szyna
    input.addEventListener('change', () => audio.play(input.dataset.bus === 'ui' ? 'notify-info' : input.dataset.bus === 'sfx' ? 'blast' : 'ui-confirm', { force: true }));
  }
  root.querySelector('[data-mute]').addEventListener('change', (e) => audio.setMuted(e.target.checked));

  const noteEl = root.querySelector('[data-note]');
  audio.subscribe((a) => {
    const s = a.settings;
    root.dataset.muted = String(s.muted);
    root.dataset.locked = String(a.locked);
    btn.innerHTML = s.muted ? ICON_OFF : ICON_ON;
    btn.title = s.muted ? 'Dźwięk wyciszony' : a.locked ? 'Dźwięk ruszy po pierwszym kliknięciu' : 'Dźwięk';
    for (const [k] of BUSES) {
      const input = root.querySelector(`[data-bus="${k}"]`);
      if (document.activeElement !== input) input.value = Math.round(s[k] * 100);
      root.querySelector(`[data-out="${k}"]`).textContent = `${Math.round(s[k] * 100)}`;
    }
    root.querySelector('[data-mute]').checked = s.muted;
    noteEl.textContent = a.locked ? 'Przeglądarka wstrzymuje dźwięk do pierwszego kliknięcia albo klawisza.' : note;
    noteEl.style.display = noteEl.textContent ? '' : 'none';
  });
  return { root, open, close };
}
