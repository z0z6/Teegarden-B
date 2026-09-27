/**
 * OKNO ZAPISU GRY (krok 12): lista zapisów (save-slots.js) z przyciskami
 * Wczytaj / Nadpisz / Pobierz / Usuń, nowy zapis z nazwą, wczytanie z pliku
 * i nowa gra. Działania nieodwracalne (nadpisanie, usunięcie, wczytanie,
 * nowa gra) wymagają drugiego dotknięcia ("Na pewno?") - bez okien confirm(),
 * które na telefonie wyrzucają z pełnego ekranu.
 *
 * createSavePanel(root, {
 *   slots,                 // createSaveSlots(...)
 *   capture(),             // -> { data, meta, liveKey, name } bieżący stan (po economy.save())
 *   describe(meta),        // -> tekst opisu zapisu na liście
 *   onLoad(slot),          // wczytanie (przeładowanie gry)
 *   onNewGame(),           // nowa kampania
 * })
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const when = (t) => new Date(t).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fileName = (s) => `teegarden-b-${String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zapis'}.json`;

export function createSavePanel(root, { slots, capture, describe = () => '', onLoad = () => {}, onNewGame = () => {} }) {
  let open = false;
  let armed = null, armedT = 0; // { key } - drugie dotknięcie potwierdza
  let msg = '', msgBad = false;

  root.innerHTML = `
    <div class="sv-box" role="document">
      <header class="sv-head"><div><div class="sv-kicker">Kampania</div><div class="sv-title">Zapis gry</div></div><button class="sv-close" data-act="close" aria-label="Zamknij">×</button></header>
      <p class="sv-note">Gra sama zapisuje bieżący stan co kilka sekund (autozapis). Tu robisz własne punkty powrotu — możesz do nich wrócić w dowolnej chwili.</p>
      <form class="sv-new" data-r="form"><input type="text" maxlength="40" data-r="name" aria-label="Nazwa zapisu" /><button type="submit" class="sv-btn primary">Zapisz</button></form>
      <div class="sv-list" data-r="list"></div>
      <footer class="sv-foot">
        <button class="sv-btn ghost" data-act="import">Wczytaj z pliku…</button>
        <input type="file" accept=".json,application/json" data-r="file" hidden />
        <span class="sv-msg" data-r="msg" aria-live="polite"></span>
        <button class="sv-btn ghost danger" data-act="new">Nowa gra</button>
      </footer>
    </div>`;
  const R = Object.fromEntries([...root.querySelectorAll('[data-r]')].map((el) => [el.dataset.r, el]));

  function say(text, bad = false) { msg = text ?? ''; msgBad = bad; R.msg.textContent = msg; R.msg.classList.toggle('bad', bad); }
  const confirmLabel = (key, label) => (armed === key ? 'Na pewno?' : label);

  function render() {
    const list = slots.list();
    R.list.innerHTML = list.length ? list.map((s) => `
      <article class="sv-slot">
        <div class="sv-slot-b"><b>${esc(s.name)}</b><small>${esc(when(s.savedAt))}${describe(s.meta) ? ` · ${esc(describe(s.meta))}` : ''}</small></div>
        <div class="sv-slot-a">
          <button class="sv-btn primary${armed === `load:${s.id}` ? ' armed' : ''}" data-act="load" data-id="${s.id}">${confirmLabel(`load:${s.id}`, 'Wczytaj')}</button>
          <button class="sv-btn ghost${armed === `over:${s.id}` ? ' armed' : ''}" data-act="over" data-id="${s.id}">${confirmLabel(`over:${s.id}`, 'Nadpisz')}</button>
          <button class="sv-btn ghost" data-act="export" data-id="${s.id}" title="Pobierz plik zapisu">Pobierz</button>
          <button class="sv-btn ghost danger${armed === `del:${s.id}` ? ' armed' : ''}" data-act="del" data-id="${s.id}">${confirmLabel(`del:${s.id}`, 'Usuń')}</button>
        </div>
      </article>`).join('') : '<p class="sv-empty">Brak zapisów. Nadaj nazwę i kliknij „Zapisz”.</p>';
    const nb = root.querySelector('[data-act="new"]');
    nb.textContent = confirmLabel('new', 'Nowa gra');
    nb.classList.toggle('armed', armed === 'new');
  }

  /** Pierwsze dotknięcie uzbraja, drugie (w ciągu 4 s) wykonuje. */
  function twoStep(key, fn) {
    if (armed === key && performance.now() - armedT < 4000) { armed = null; fn(); }
    else { armed = key; armedT = performance.now(); }
    render();
  }

  function saveNew(id = null, name = null) {
    const c = capture();
    const r = slots.save({ name: name ?? (R.name.value.trim() || c.name), data: c.data, meta: c.meta, liveKey: c.liveKey, id });
    say(r.text, !r.ok);
    if (r.ok && !id) R.name.value = capture().name;
    render();
    return r;
  }

  function download(id) {
    const text = slots.exportText(id);
    if (!text) { say('Nie udało się odczytać zapisu.', true); return; }
    const s = slots.read(id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = fileName(s?.name ?? 'zapis');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    say('Plik zapisu pobrany.');
  }

  R.form.addEventListener('submit', (e) => { e.preventDefault(); saveNew(); });
  R.file.addEventListener('change', async () => {
    const f = R.file.files?.[0];
    R.file.value = '';
    if (!f) return;
    const r = slots.importText(await f.text());
    say(r.ok ? `Wczytano plik jako nowy zapis. ${r.text}` : r.text, !r.ok);
    render();
  });
  root.addEventListener('click', (e) => {
    if (e.target === root) { hide(); return; } // klik w tło zamyka
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.act) {
      case 'close': hide(); break;
      case 'load': twoStep(`load:${id}`, () => { const s = slots.read(id); if (s) onLoad(s); else say('Zapis uszkodzony.', true); }); break;
      case 'over': twoStep(`over:${id}`, () => saveNew(id, slots.list().find((s) => s.id === id)?.name)); break;
      case 'del': twoStep(`del:${id}`, () => { const r = slots.remove(id); say(r.text, !r.ok); }); break;
      case 'export': download(id); break;
      case 'import': R.file.click(); break;
      case 'new': twoStep('new', () => onNewGame()); break;
      default: break;
    }
  });
  for (const ev of ['mousedown', 'pointerdown', 'keydown']) root.addEventListener(ev, (e) => e.stopPropagation());
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); hide(); } });

  function show() {
    open = true;
    armed = null;
    say('');
    R.name.value = capture().name;
    render();
    root.classList.add('visible');
  }
  function hide() { open = false; armed = null; root.classList.remove('visible'); }

  return {
    show, hide, toggle: () => (open ? hide() : show()),
    get open() { return open; },
    /** Szybki zapis (Ctrl+S): nadpisuje slot „Szybki zapis” albo go zakłada. */
    quickSave() {
      const q = slots.list().find((s) => s.name === 'Szybki zapis');
      const r = saveNew(q?.id ?? null, 'Szybki zapis');
      return r;
    },
  };
}
