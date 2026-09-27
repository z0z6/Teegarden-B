import { WARSHIPS } from '../data/economy.js';
import { RACES } from '../data/races.js';
import { FORMATIONS, FORMATION_ORDER, ROE, ROE_ORDER, MISSIONS, MISSION_ORDER, STRIKE_TARGETS, STRIKE_ORDER, OPS } from '../data/military.js';
import { warshipIcon } from '../ui/icons.js';
import { PLAYER } from './strategy.js';

/**
 * ZAKŁADKA "OPERACJE" panelu mostka (krok 12c): grupy bojowe i rozkazy
 * "daj i zapomnij". Wpinana w command-panel.js przez `extraTabs`.
 *
 *   Nowa operacja  - misja, cel (z wywiadem), cel uderzenia, szyk, ROE,
 *                    skład (okręty bez grupy + istniejące grupy; kilka grup =
 *                    operacja skoordynowana z godziną H), "Dobierz skład"
 *   Grupy          - faza, miejsce, siła i straty, szyk / ROE w locie,
 *                    Obserwuj (podgląd zdalny), Odwołaj, Rozwiąż
 *   Łączność       - ostatnie meldunki grup (wezwania wsparcia, kontakt, raporty)
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ago = (sec) => (sec < 60 ? `${Math.round(sec)} s temu` : `${Math.round(sec / 60)} min temu`);

export function createOpsTab({ ops, army, strategy, economy, playerRace, systemName = (s) => s, homeSystem, onWatch = () => {} }) {
  // formularz nowej operacji (stan UI, poza zapisem)
  const f = { kind: 'uderzenie', field: null, strike: 'obrona', formation: null, roe: 'zrownowazona', ships: new Set(), groups: new Set(), armWar: false, open: true };

  function fieldChoices() {
    const def = MISSIONS[f.kind];
    const out = [];
    for (const fid of strategy.allFields) {
      const owner = strategy.foreignOwner(fid);
      const mine = strategy.ownerOf(fid) === PLAYER;
      if (def.target === 'own' && !mine) continue;
      if (def.target === 'foreign' && !owner) continue;
      if (def.target === 'any' && mine) continue;
      const d = strategy.defs.get(fid);
      const intel = ops.intel(fid);
      const fresh = ops.intelFresh(fid);
      out.push({ fid, d, owner, intel, fresh, war: owner ? strategy.atWar(PLAYER, owner) : false });
    }
    // najpierw układ siedziby, potem wojna, potem reszta
    const home = homeSystem();
    return out.sort((a, b) => (b.d.systemId === home) - (a.d.systemId === home) || b.war - a.war || a.d.name.localeCompare(b.d.name));
  }
  const freeShips = () => army.ships.filter((s) => !s.group && !s.transit && s.sysId === homeSystem());

  function ensureField(choices) {
    if (!choices.some((c) => c.fid === f.field)) f.field = choices[0]?.fid ?? null;
  }

  function render() {
    const choices = fieldChoices();
    ensureField(choices);
    const groups = ops.groups();
    const free = freeShips();
    const key = JSON.stringify([f.kind, f.field, f.strike, f.formation, f.roe, [...f.ships], [...f.groups], f.armWar, f.open,
      groups.map((g) => [g.id, g.phase, g.where, g.formation, g.roe, g.ships.length, g.what, Math.round(g.hull * 20), g.repairing, g.autoRush, g.repairOnReturn]),
      free.map((s) => `${s.id}${Math.round(s.hull / WARSHIPS[s.cls].hull * 10)}`), ops.log.length,
      choices.map((c) => `${c.fid}${c.war}${c.fresh ? 1 : 0}`).join()]);
    return [key, () => html(choices, groups, free)];
  }

  function html(choices, groups, free) {
    const race = RACES[playerRace()];
    const def = MISSIONS[f.kind];
    const sel = choices.find((c) => c.fid === f.field);
    const formation = f.formation ?? (def.formation === 'kleszcze' && f.ships.size < 4 ? 'klin' : def.formation);
    const needWar = def.target === 'foreign' && sel && !sel.war;
    const nSel = f.ships.size + f.groups.size;
    const powerSel = [...f.ships].reduce((a, id) => { const s = army.byId(id); return a + (s ? WARSHIPS[s.cls].power : 0); }, 0)
      + [...f.groups].reduce((a, gid) => a + (groups.find((g) => g.id === gid)?.power ?? 0), 0);
    const dfn = sel?.owner ? (sel.fresh?.defense ?? strategy.fieldDefense(sel.fid)) : 0;

    const missionBtns = MISSION_ORDER.map((k) => `<button data-act="op-kind" data-k="${k}" class="${f.kind === k ? 'on' : ''}"><b>${esc(MISSIONS[k].name)}</b><small>${esc(MISSIONS[k].desc)}</small></button>`).join('');
    const fieldOpts = choices.length ? choices.map((c) => {
      const tag = c.owner ? `${RACES[c.owner].name}${c.war ? ' · wojna' : ''}` : (strategy.ownerOf(c.fid) === PLAYER ? 'twoje' : 'wolne');
      const intel = c.intel ? ` · zwiad ${ago(ops.clock - c.intel.t)}` : '';
      return `<option value="${c.fid}"${c.fid === f.field ? ' selected' : ''}>${esc(c.d.name)} (${esc(systemName(c.d.systemId))}) — ${esc(tag)}${intel}</option>`;
    }).join('') : '<option value="">brak celów</option>';
    const intelBox = sel?.owner ? (sel.intel
      ? `<p class="cp-note">Wywiad (${ago(ops.clock - sel.intel.t)}${sel.fresh ? ', świeży: premia w starciu' : ', nieaktualny'}): poziom <b>${sel.intel.develop}</b>, obrona ≈<b>${sel.intel.defense.toFixed(1)}</b>, flota rasy <b>${sel.intel.ships}</b>${sel.intel.byType ? `, wieże <b>${sel.intel.byType.wieza ?? 0}</b>, stacje <b>${Object.values(sel.intel.byType).reduce((a, x) => a + x, 0)}</b>` : ''}.</p>`
      : `<p class="cp-note">Brak zwiadu. Szacunek obrony ≈${dfn.toFixed(1)} (niepewny). Zwiad daje dokładne dane i premię ×${OPS.intelBonus}.</p>`) : '';
    const lvl = sel?.owner ? (strategy.state.fields[sel.fid]?.develop ?? 0) : 0;
    const strikeOk = (k) => !STRIKE_TARGETS[k].minDevelop || lvl >= STRIKE_TARGETS[k].minDevelop;
    if (f.kind === 'uderzenie' && !strikeOk(f.strike)) f.strike = STRIKE_ORDER.find(strikeOk);
    const strikeBtns = f.kind === 'uderzenie' ? `<h4>Cel uderzenia</h4><div class="cp-routes op-grid">${STRIKE_ORDER.map((k) => `<button data-act="op-strike" data-k="${k}" class="${f.strike === k ? 'on' : ''}" ${strikeOk(k) ? '' : 'disabled'}><b>${esc(STRIKE_TARGETS[k].name)}</b><small>${esc(strikeOk(k) ? STRIKE_TARGETS[k].desc : `Placówka nie ma wież (poziom ${lvl}, wieże od ${STRIKE_TARGETS[k].minDevelop}).`)}</small></button>`).join('')}</div>` : '';
    const formBtns = FORMATION_ORDER.map((k) => `<button data-act="op-form" data-k="${k}" class="${formation === k ? 'on' : ''}" title="${esc(FORMATIONS[k].desc)}">${esc(FORMATIONS[k].name)}<small>${FORMATIONS[k].posture === 'defensive' ? 'obronny' : FORMATIONS[k].posture === 'transit' ? 'przelot' : 'natarcie'}</small></button>`).join('');
    const roeBtns = ROE_ORDER.map((k) => `<button data-act="op-roe" data-k="${k}" class="${f.roe === k ? 'on' : ''}" title="${esc(ROE[k].desc)}">${esc(ROE[k].name)}</button>`).join('');
    const shipRows = free.length ? free.map((s) => `<label class="cp-toggle op-pick"><input type="checkbox" data-act="op-ship" data-id="${s.id}"${f.ships.has(s.id) ? ' checked' : ''}/>${warshipIcon(s.cls, 18, race.color)}<span>„${esc(s.callsign)}” <small>${esc(WARSHIPS[s.cls].name)} · siła ${WARSHIPS[s.cls].power}${s.hull < WARSHIPS[s.cls].hull * 0.95 ? ` · <span class="cp-rep ${s.hull < WARSHIPS[s.cls].hull * 0.6 ? 'bad' : ''}">kadłub ${Math.round(s.hull / WARSHIPS[s.cls].hull * 100)}%</span>` : ''}</small></span></label>`).join('')
      : '<p class="cp-note">Wszystkie okręty przy siedzibie są w grupach albo poza bazą.</p>';
    const groupPick = groups.filter((g) => !g.transit).map((g) => `<label class="cp-toggle op-pick"><input type="checkbox" data-act="op-grp" data-id="${g.id}"${f.groups.has(g.id) ? ' checked' : ''}/><span>Grupa <b>${esc(g.name)}</b> <small>${g.ships.length} okr. · ${esc(g.what)} · ${esc(g.where)}</small></span></label>`).join('');
    const ratio = dfn > 0 ? powerSel / dfn : null;
    const verdict = ratio == null ? '' : ratio > 1.4 ? 'przewaga' : ratio > 0.9 ? 'wyrównane' : 'za słabo';
    const goLabel = needWar ? (f.armWar ? 'Na pewno? Wypowiedz wojnę i atakuj' : `Wypowiedz wojnę rasie ${RACES[sel.owner].name}…`) : nSel > 1 && f.groups.size + (f.ships.size ? 1 : 0) > 1 ? 'Operacja skoordynowana (godzina H)' : 'Wykonaj — i zapomnij';

    const form = `
      <section class="op-new"><h4 class="op-h"><button data-act="op-toggle" class="op-fold">${f.open ? '▾' : '▸'}</button>Nowa operacja</h4>
      ${f.open ? `
        <div class="cp-routes op-grid">${missionBtns}</div>
        <h4>Cel</h4><select class="op-sel" data-act="op-field">${fieldOpts}</select>
        ${intelBox}
        ${strikeBtns}
        <h4>Szyk</h4><div class="op-seg">${formBtns}</div>
        <p class="cp-note">${esc(FORMATIONS[formation].desc)}</p>
        <h4>Zasady użycia siły</h4><div class="op-seg">${roeBtns}</div>
        <p class="cp-note">${esc(ROE[f.roe].desc)}</p>
        <h4>Skład <button data-act="op-suggest" class="op-mini">Dobierz skład</button></h4>
        ${shipRows}
        ${groupPick ? `<h4>…albo istniejące grupy</h4>${groupPick}` : ''}
        <p class="cp-note">Wybrano: <b>${nSel}</b> · siła <b>${powerSel.toFixed(1)}</b>${dfn ? ` vs obrona ≈${dfn.toFixed(1)} — <b class="op-v op-v-${verdict.replace(' ', '-')}">${verdict}</b>` : ''}. Grupa sama poleci, wykona zadanie, wróci i złoży raport.</p>
        <div class="cp-row"><button class="primary" data-act="op-go" ${nSel && f.field ? '' : 'disabled'}>${esc(goLabel)}</button></div>` : ''}
      </section>`;

    const groupCards = groups.length ? groups.map((g) => {
      const alive = g.ships.length;
      return `<div class="cp-card op-grp" style="--c:${g.phase === 'w akcji' || g.phase === 'wsparcie' ? '#ff7a45' : g.phase === 'w fałdzie' ? '#9fd8ff' : '#4dd6a0'}">
        <div class="cp-card-h">${warshipIcon(g.ships[0]?.cls ?? 'fregata', 26, race.color)}<div><b>${esc(g.name)}</b> <span class="op-phase">${esc(g.phase)}</span>
          <small>${esc(g.what)}${g.fieldName ? ` — ${esc(g.fieldName)}` : ''} · ${esc(g.where)}${g.op ? ` · operacja ${esc(g.op.toUpperCase())}` : ''}</small></div></div>
        <small class="op-line">${alive} okr. · siła ${g.power.toFixed(1)} · kadłuby <b class="${g.hull < 0.6 ? 'op-v-za-słabo' : g.hull < 0.9 ? 'op-v-wyrównane' : ''}">${Math.round(g.hull * 100)}%</b>${g.repairing ? ` · ${g.repairing === 'remont' ? 'remont przyspieszony' : g.repairing === 'stocznia' ? 'naprawa w stoczni' : 'naprawa polowa'}` : g.repairOnReturn ? ' · naprawa po powrocie' : ''} · ${g.ships.map((s) => `„${esc(s.callsign)}”`).join(', ')}</small>
        <span class="cp-hullbar"><i style="width:${Math.round(g.hull * 100)}%"></i></span>
        <div class="cp-card-b op-ctl">
          <select data-act="op-gform" data-id="${g.id}" aria-label="Szyk">${FORMATION_ORDER.map((k) => `<option value="${k}"${g.formation === k ? ' selected' : ''}>${esc(FORMATIONS[k].name)}</option>`).join('')}</select>
          <select data-act="op-groe" data-id="${g.id}" aria-label="ROE">${ROE_ORDER.map((k) => `<option value="${k}"${g.roe === k ? ' selected' : ''}>${esc(ROE[k].name)}</option>`).join('')}</select>
          <button data-act="op-watch" data-id="${g.id}" ${g.live ? '' : 'disabled'} title="Podgląd zdalny">Obserwuj</button>
          <button data-act="op-recall" data-id="${g.id}" ${g.phase === 'powrót' ? 'disabled' : ''}>Odwołaj</button>
          <button data-act="op-disband" data-id="${g.id}">Rozwiąż</button>
          <button data-act="op-repair" data-id="${g.id}" ${g.hull < 0.99 && g.repairing !== 'remont' ? '' : 'disabled'} title="W bazie: płatny remont przyspieszony. Z daleka: powrót i remont.">Na naprawę</button>
        </div>
        <label class="cp-toggle op-auto"><input type="checkbox" data-act="op-autorush" data-id="${g.id}"${g.autoRush ? ' checked' : ''}/>Po misji: remont przyspieszony (płatny)</label></div>`;
    }).join('') : '<p class="cp-note">Brak grup bojowych. Zaznacz okręty w „Nowej operacji” — grupa powstanie przy wydaniu rozkazu.</p>';

    const log = ops.log.slice(0, 10).map((e) => `<li class="op-log-${e.urgency}"><b>${esc(e.who)}</b> ${esc(e.text)}<small>${ago(ops.clock - e.t)}</small></li>`).join('');
    return `${form}
      <h4>Grupy bojowe</h4>${groupCards}
      <h4>Łączność floty</h4>${log ? `<ul class="op-log">${log}</ul>` : '<p class="cp-note">Cisza w eterze.</p>'}`;
  }

  function go() {
    const def = MISSIONS[f.kind];
    const sel = fieldChoices().find((c) => c.fid === f.field);
    if (!sel) return { ok: false, text: 'Wybierz cel.' };
    const needWar = def.target === 'foreign' && !sel.war;
    if (needWar && !f.armWar) { f.armWar = true; return { ok: true, text: `Uderzenie oznacza wojnę z rasą ${RACES[sel.owner].name}. Kliknij jeszcze raz, by potwierdzić.` }; }
    const gids = [...f.groups];
    if (f.ships.size) {
      const r = ops.createGroup([...f.ships], { roe: f.roe });
      if (!r.ok) return r;
      gids.push(r.group.id);
    }
    const m = { kind: f.kind, field: f.field, strike: f.strike, roe: f.roe, formation: f.formation ?? undefined, declareWar: needWar };
    const r = gids.length > 1 ? ops.launchOperation(gids, m) : ops.assign(gids[0], m);
    if (r.ok) { f.ships.clear(); f.groups.clear(); f.armWar = false; f.formation = null; }
    return r;
  }

  return {
    /** Krok 12c: gotowy formularz (np. kontratak z raportu potyczki), z doborem składu. */
    preset({ kind, field, strike = 'obrona' }) {
      f.kind = kind; f.field = field; f.strike = strike; f.formation = null; f.armWar = false; f.open = true;
      f.groups.clear();
      f.ships = new Set(ops.suggestShips({ kind, field, strike }));
    },
    id: 'operacje', label: 'Operacje',
    badge: () => { const n = ops.groups().filter((g) => g.phase !== 'postój' && g.what !== 'obrona pola').length; return n || ''; },
    render,
    refresh() {},
    onAction(act, b) {
      const k = b.dataset.k, id = b.dataset.id;
      switch (act) {
        case 'op-toggle': f.open = !f.open; return null;
        case 'op-kind': f.kind = k; f.formation = null; f.armWar = false; if (k === 'zwiad') f.roe = 'ostrozna'; return null;
        case 'op-strike': f.strike = k; return null;
        case 'op-form': f.formation = k; return null;
        case 'op-roe': f.roe = k; return null;
        case 'op-suggest': {
          if (!f.field) return { ok: false, text: 'Najpierw wybierz cel.' };
          const ids = ops.suggestShips({ kind: f.kind, field: f.field, strike: f.strike });
          f.ships = new Set(ids);
          return { ok: !!ids.length, text: ids.length ? `Dobrano ${ids.length} okr.` : 'Brak wolnych okrętów przy siedzibie.' };
        }
        case 'op-go': return go();
        case 'op-watch': onWatch(id); return null;
        case 'op-recall': return ops.recall(id);
        case 'op-disband': return ops.disband(id);
        case 'op-repair': return ops.repair(id);
        default: return null;
      }
    },
    onChange(e) {
      const t = e.target, act = t.dataset.act, id = t.dataset.id;
      switch (act) {
        case 'op-field': f.field = t.value; f.armWar = false; return null;
        case 'op-ship': if (t.checked) f.ships.add(id); else f.ships.delete(id); return null;
        case 'op-grp': if (t.checked) f.groups.add(id); else f.groups.delete(id); return null;
        case 'op-gform': return ops.setFormation(id, t.value);
        case 'op-groe': return ops.setRoe(id, t.value);
        case 'op-autorush': return ops.setAutoRush(id, t.checked);
        default: return null;
      }
    },
  };
}
