/**
 * Komunikator: okno rozmowy z NPC (nadawca, tekst, wybory).
 *
 * Dwa tryby:
 *   open({...choices})  - rozmowa z wyborami; odpowiedź: klawisze Z/X/C albo klik/dotyk
 *   say({...})          - jednokierunkowy komunikat (znika sam po ttl)
 *
 * Klawisze Z/X/C zamiast cyfr, bo 1-4 to zaokrętowanie na inny statek, a
 * mysz jest cały czas zajęta celowaniem (sterowanie "mouse flight") - klikanie
 * w przyciski jest możliwe, ale klawisze są wygodniejsze w trakcie lotu.
 */
const KEYS = ['KeyZ', 'KeyX', 'KeyC'];
const KEY_LABEL = ['Z', 'X', 'C'];

export function createComms(root) {
  // Portret rozmówcy (opcjonalny, od wizerunków ras): pływa po lewej, a treść
  // obok niego (overflow: hidden = osobny kontekst blokowy). Style inline,
  // żeby działało we wszystkich krokach bez zmian w ich CSS.
  root.innerHTML = `
    <div class="comms-portrait" style="display:none;float:left;width:56px;height:56px;margin:2px 10px 4px 0;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px rgba(159,216,255,0.25)"></div>
    <div class="comms-body" style="overflow:hidden">
      <div class="comms-head"><span class="comms-dot"></span><span class="comms-sender"></span><span class="comms-sub"></span></div>
      <div class="comms-text"></div>
      <div class="comms-choices"></div>
    </div>`;
  const $ = (sel) => root.querySelector(sel);
  const el = { portrait: $('.comms-portrait'), dot: $('.comms-dot'), sender: $('.comms-sender'), sub: $('.comms-sub'), text: $('.comms-text'), choices: $('.comms-choices') };

  let current = null;   // { choices }
  let sayTimer = null;

  let lastPortrait = null;
  function render({ sender, sub, color, text, portrait }) {
    // portret to SVG z generatora (race-portraits.js) - nasz kod, nie dane od gracza
    if (portrait !== lastPortrait) {
      el.portrait.innerHTML = portrait ?? '';
      el.portrait.style.display = portrait ? 'block' : 'none';
      el.portrait.style.boxShadow = `0 0 0 1px ${color ?? '#9fd8ff'}66`;
      lastPortrait = portrait ?? null;
    }
    el.dot.style.display = portrait ? 'none' : '';
    el.sender.textContent = sender;
    el.sub.textContent = sub ?? '';
    el.dot.style.background = color ?? '#9fd8ff';
    el.text.textContent = text;
    root.classList.add('visible');
  }

  function close() {
    current = null;
    clearTimeout(sayTimer);
    root.classList.remove('visible');
    el.choices.innerHTML = '';
  }

  function open({ sender, sub, color, text, portrait, choices = [] }) {
    clearTimeout(sayTimer);
    current = { choices };
    render({ sender, sub, color, text, portrait });
    el.choices.innerHTML = '';
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'comms-choice';
      b.innerHTML = `<kbd>${KEY_LABEL[i]}</kbd><span class="lbl"></span><span class="hint"></span>`;
      b.querySelector('.lbl').textContent = c.label;
      b.querySelector('.hint').textContent = c.hint ?? '';
      b.addEventListener('click', () => choose(i));
      el.choices.appendChild(b);
    });
  }

  /** Komunikat bez wyboru. `onDone` po zamknięciu (ttl w sekundach czasu rzeczywistego). */
  function say({ sender, sub, color, text, portrait, ttl = 3.5, onDone }) {
    clearTimeout(sayTimer);
    current = null;
    el.choices.innerHTML = '';
    render({ sender, sub, color, text, portrait });
    sayTimer = setTimeout(() => { close(); onDone?.(); }, ttl * 1000);
  }

  function choose(i) {
    if (!current || !current.choices[i]) return false;
    const choice = current.choices[i];
    current = null;
    el.choices.innerHTML = '';
    choice.onChoose?.();
    return true;
  }

  window.addEventListener('keydown', (e) => {
    const i = KEYS.indexOf(e.code);
    if (i >= 0 && current) { e.preventDefault(); choose(i); }
  });

  return { open, say, close, choose, isOpen: () => current !== null };
}
