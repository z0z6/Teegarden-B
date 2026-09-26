import { scienceIcon, scanIcon, droneTypeIcon, pilotIcon, upgradeIcon } from '../ui/icons.js';

/**
 * OKIENKA DECYZJI (krok 12): wyskakujące karty z prostym wyborem zamiast
 * klawiszologii. Każda karta ma 1-3 przyciski ("Tak", "Nie", "Poślij
 * flotę"...), opcjonalnie "Zarządzaj", które rozwija drugi rząd ("Odwołaj",
 * "Poślij", "Przywołaj ochronę", "Zaalarmuj pozostałych"), i pasek czasu:
 * brak odpowiedzi = wybór domyślny (gra toczy się sama). Najechanie myszą
 * wstrzymuje odliczanie.
 *
 * ask({ id, kind, title, text, urgency, choices: [{label, act, primary}],
 *       manage: [{label, act, disabled}], timeout, defaultAct, onChoose(act),
 *       portrait })
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND_ICON = {
  science: () => scienceIcon(26),
  survey: () => scanIcon(26),
  return: () => droneTypeIcon('gornik', 26, '#4dd6a0'),
  threat: () => pilotIcon(26, '#ff5a4d'),
  fleet: () => pilotIcon(26, '#ff7a45'),
  info: () => upgradeIcon(26),
};

export function createDecisions(root, { onShow = () => {}, onPick = () => {}, max = 3 } = {}) {
  const items = []; // { d, el, left, hover }

  function remove(it) {
    const i = items.indexOf(it);
    if (i >= 0) items.splice(i, 1);
    it.el.classList.add('gone');
    setTimeout(() => it.el.remove(), 260);
    layout();
  }
  function choose(it, act) {
    if (!items.includes(it)) return;
    remove(it);
    onPick(it.d, act);
    try { it.d.onChoose?.(act); } catch (err) { console.error('Decyzja:', err); }
  }
  function layout() {
    items.forEach((it, i) => { it.el.hidden = i >= max; });
    root.dataset.more = items.length > max ? `+${items.length - max}` : '';
  }

  function ask(d) {
    const old = items.find((it) => it.d.id === d.id);
    if (old) { old.el.remove(); items.splice(items.indexOf(old), 1); }
    const el = document.createElement('article');
    el.className = `dc dc-${d.urgency ?? 'info'} dc-k-${d.kind ?? 'info'}`;
    const buttons = (d.choices ?? []).map((c) => `<button class="dc-btn${c.primary ? ' primary' : ''}" data-act="${esc(c.act)}">${esc(c.label)}</button>`).join('');
    const manage = d.manage?.length ? `<button class="dc-btn manage" data-manage="1" aria-expanded="false">Zarządzaj ▾</button>` : '';
    el.innerHTML = `
      <div class="dc-ico">${d.portrait ?? (KIND_ICON[d.kind] ?? KIND_ICON.info)()}</div>
      <div class="dc-body">
        <b class="dc-title">${esc(d.title)}</b>
        <p class="dc-text">${esc(d.text)}</p>
        <div class="dc-row">${buttons}${manage}</div>
        ${d.manage?.length ? `<div class="dc-row dc-sub" hidden>${d.manage.map((m) => `<button class="dc-btn sub" data-act="${esc(m.act)}" ${m.disabled ? 'disabled' : ''}>${esc(m.label)}</button>`).join('')}</div>` : ''}
      </div>
      ${d.timeout ? '<i class="dc-time"><i></i></i>' : ''}`;
    const it = { d, el, left: d.timeout ?? 0, hover: false };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.manage) {
        const sub = el.querySelector('.dc-sub');
        sub.hidden = !sub.hidden;
        b.setAttribute('aria-expanded', String(!sub.hidden));
        b.textContent = sub.hidden ? 'Zarządzaj ▾' : 'Zarządzaj ▴';
        it.hover = true;
        return;
      }
      choose(it, b.dataset.act);
    });
    el.addEventListener('pointerenter', () => { it.hover = true; });
    el.addEventListener('pointerleave', () => { it.hover = !el.querySelector('.dc-sub:not([hidden])') ? false : it.hover; });
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    root.prepend(el);
    items.unshift(it);
    layout();
    onShow(d);
    return it;
  }

  function update(dt) {
    for (const it of items.slice()) {
      if (!it.d.timeout || it.hover || it.el.hidden) continue;
      it.left -= dt;
      const bar = it.el.querySelector('.dc-time > i');
      if (bar) bar.style.transform = `scaleX(${Math.max(0, it.left / it.d.timeout)})`;
      if (it.left <= 0) choose(it, it.d.defaultAct ?? 'ok');
    }
  }

  return {
    ask, update,
    get items() { return items.map((it) => it.d); },
    /** Test / skrót: wybór w karcie o danym id. */
    choose(id, act) { const it = items.find((x) => x.d.id === id); if (it) choose(it, act); return !!it; },
    dismiss(id) { const it = items.find((x) => x.d.id === id); if (it) remove(it); },
  };
}
