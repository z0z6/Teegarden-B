import { WARSHIPS, WARSHIP_ORDER, METALS, METAL_ORDER } from '../data/economy.js';
import { SHIPS } from '../ships/fleet.js';
import { raceForShip, RACES } from '../data/races.js';
import { warshipIcon, metalIcon, creditsIcon, stationIcon, fieldIcon } from '../ui/icons.js';
import { PLAYER } from './strategy.js';

/**
 * ZAKŁADKA "FLOTA" panelu przemysłu (krok 11): stocznia (klasy okrętów z
 * miniaturą modelu rasy gracza, koszt z ikonami metali, kolejka), lista
 * okrętów z rozkazami (eskorta / obrona pola / atak na pole) i bilans
 * (siła, utrzymanie, straty). Wpinana przez `extraTabs` w economy-panel.js.
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString('pl-PL');

/** Model statku dla klasy okrętu: kolejne modele rasy gracza (mały -> duży). */
export function warshipModel(raceId, cls) {
  const own = SHIPS.filter((s) => raceForShip(s.id) === raceId);
  const list = own.length ? own : SHIPS;
  return list[WARSHIP_ORDER.indexOf(cls) % list.length];
}
const thumbUrl = (s) => s.file.replace(/\/models\/([^/]+)-lod0\.glb$/, '/models/thumbs/$1.png');

function costHtml(cost) {
  const parts = [];
  if (cost.credits) parts.push(`<span>${creditsIcon(14)}${fmt(cost.credits)}</span>`);
  for (const m of METAL_ORDER) if (cost[m]) parts.push(`<span title="${METALS[m].name}">${metalIcon(m, 14)}${cost[m]}</span>`);
  return `<span class="fp-cost">${parts.join('')}</span>`;
}

export function createArmyTab({ army, strategy, economy, playerRace, systemName }) {
  const shipOptions = (s) => {
    const opts = [`<option value="eskorta|"${s.order === 'eskorta' ? ' selected' : ''}>Eskorta (leci z tobą)</option>`];
    for (const fid of strategy.fieldsOf(PLAYER)) {
      const d = strategy.defs.get(fid);
      opts.push(`<option value="obrona|${fid}"${s.order === 'obrona' && s.field === fid ? ' selected' : ''}>Obrona: ${esc(d.name)} (${esc(systemName(d.systemId))})</option>`);
    }
    for (const fid of strategy.allFields) {
      const o = strategy.foreignOwner(fid);
      if (!o || !strategy.atWar(PLAYER, o)) continue;
      const d = strategy.defs.get(fid);
      opts.push(`<option value="atak|${fid}"${s.order === 'atak' && s.field === fid ? ' selected' : ''}>Atak: ${esc(d.name)} — ${esc(RACES[o].name)} (${esc(systemName(d.systemId))})</option>`);
    }
    return opts.join('');
  };

  return {
    id: 'flota', label: 'Flota',
    version: () => `${army.ships.length}|${army.queue.length}|${army.ships.map((s) => s.order + s.field + s.sysId).join()}|${!!army.yardHere()}|${strategy.fieldsOf(PLAYER).length}`,
    render() {
      const yard = army.yardHere();
      const race = playerRace();
      const classes = WARSHIP_ORDER.map((cls) => {
        const d = WARSHIPS[cls];
        const model = warshipModel(race, cls);
        return `<div class="fp-class">
          <div class="fp-thumb"><img src="${thumbUrl(model)}" alt="" onerror="this.parentElement.classList.add('none')"/><span class="fp-badge">${warshipIcon(cls, 20, RACES[race].color)}</span></div>
          <div class="fp-class-b"><b>${d.name}</b><small>${esc(d.role)}</small>
            <div class="fp-stats"><span>siła <b>${d.power}</b></span><span>kadłub <b>${d.hull}</b></span><span>budowa <b>${d.buildTime} s</b></span><span>utrzymanie <b>${d.upkeep * 6} kr/min</b></span></div>
            ${costHtml(d.cost)}
            <button class="ip-btn" data-act="build-ship" data-cls="${cls}" ${yard ? '' : 'disabled'}>Zbuduj</button><span class="fp-why" data-live="fp-why-${cls}"></span></div>
        </div>`;
      }).join('');
      const queue = army.queue.length ? army.queue.map((q, i) => `<div class="fp-q">${warshipIcon(q.cls, 18)}<span>${WARSHIPS[q.cls].name}</span><span class="fp-qbar"><i data-live="fp-q-${i}"></i></span><small data-live="fp-qt-${i}"></small></div>`).join('') : '<p class="ip-empty">Kolejka pusta.</p>';
      const bySys = new Map();
      for (const s of army.ships) (bySys.get(s.sysId) ?? bySys.set(s.sysId, []).get(s.sysId)).push(s);
      const ships = army.ships.length ? [...bySys].map(([sys, list]) => `<h4>${esc(systemName(sys))} · siła ${army.power(sys).toFixed(1)}</h4>` + list.map((s) => `
        <div class="fp-ship">${warshipIcon(s.cls, 22, RACES[race].color)}
          <div class="fp-ship-b"><b>„${esc(s.callsign)}”</b><small>${WARSHIPS[s.cls].name}</small><span class="fp-hull"><i data-live="fp-h-${s.id}"></i></span></div>
          <select data-act="ship-order" data-ship="${s.id}">${shipOptions(s)}</select>
        </div>`).join('')).join('') : '<p class="ip-empty">Nie masz jeszcze okrętów. Armia broni pól przed nalotami ras i zdobywa cudze pola (wymaga wojny: mapa M → Dyplomacja).</p>';
      return `<div class="fp">
        <section class="fp-yard"><h3>${stationIcon('stocznia', 20, '#c39bff')} Stocznia wojenna ${yard ? `<small>${esc(yard.name)}</small>` : ''}</h3>
          ${yard ? '' : '<p class="ip-note">W tym układzie nie ma gotowej stoczni. Postaw ją w zakładce Gospodarka (koszt jak dok roju razy dwa). Metal na okręty idzie z magazynów tego układu.</p>'}
          <div class="fp-classes">${classes}</div>
          <h3>Kolejka</h3>${queue}
        </section>
        <section class="fp-fleet"><h3>${fieldIcon(18, '#ffd36b')} Flota <small data-live="fp-summary"></small></h3>${ships}</section>
        <div class="fp-msg" data-live="fp-msg"></div>
      </div>`;
    },
    refresh(root) {
      const setText = (k, v) => { const el = root.querySelector(`[data-live="${k}"]`); if (el && el.textContent !== v) el.textContent = v; };
      army.queue.forEach((q, i) => {
        const el = root.querySelector(`[data-live="fp-q-${i}"]`);
        if (el) el.style.width = `${(1 - q.t / WARSHIPS[q.cls].buildTime) * 100}%`;
        setText(`fp-qt-${i}`, `${Math.ceil(q.t)} s`);
      });
      for (const s of army.ships) {
        const el = root.querySelector(`[data-live="fp-h-${s.id}"]`);
        if (el) el.style.width = `${(s.hull / WARSHIPS[s.cls].hull) * 100}%`;
      }
      for (const cls of WARSHIP_ORDER) setText(`fp-why-${cls}`, army.yardHere() && !economy.canPayCost(WARSHIPS[cls].cost) ? 'za mało zasobów' : '');
      setText('fp-summary', `${army.ships.length} okr. · siła ${army.power().toFixed(1)} · utrzymanie ${fmt(army.upkeepPerMin())} kr/min · straty ${army.lost}`);
      if (this._msg) setText('fp-msg', this._msg);
    },
    onAction(act, b) {
      if (act === 'build-ship') { this._msg = army.order(b.dataset.cls).text; }
    },
    onChange(e) {
      const sel = e.target.closest('select[data-act="ship-order"]');
      if (!sel) return false;
      const [kind, field] = sel.value.split('|');
      this._msg = army.setOrder([sel.dataset.ship], kind, field || null).text;
      return true;
    },
  };
}
