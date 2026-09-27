import { METALS, METAL_ORDER, MARKET } from '../data/economy.js';
import { EXCHANGE } from '../data/command.js';

/**
 * GIEŁDA (krok 12b): wymiana jednego zasobu na drugi po kursie rynku.
 *
 * Towary: kredyty, cztery metale (ze składu siedziby i magazynów układu)
 * oraz urobek (z magazynów i kolejki huty - tylko na sprzedaż). Każda
 * wymiana idzie przez kredyty:
 *
 *   sprzedaż A: ilość × kurs A × (1 − prowizja)   -> kredyty
 *   kupno B:    kredyty / (kurs B × marża)         -> ilość B
 *
 * Kurs to ten sam rynek co w kroku 10 (economy.price: bazowa cena × mnożnik
 * rynku × powolne wahania). Sprzedaż metalu obniża jego mnożnik, kupno
 * podnosi - wielkie wymiany same psują sobie kurs. Stacja przeładunkowa
 * w układzie siedziby to własny terminal: niższa prowizja.
 *
 * Czysta logika (działa w Node), bez DOM.
 */

export const GOODS = ['kredyty', ...METAL_ORDER, 'urobek'];
export const GOOD_NAME = { kredyty: 'Kredyty', urobek: 'Urobek', ...Object.fromEntries(METAL_ORDER.map((m) => [m, METALS[m].name])) };
const zero = () => Object.fromEntries(METAL_ORDER.map((m) => [m, 0]));
const sum = (o) => METAL_ORDER.reduce((a, m) => a + (o[m] || 0), 0);

export function createExchange({ economy, command }) {
  const home = () => command.state.home;
  const isMetal = (g) => METAL_ORDER.includes(g);
  const port = () => !!home() && economy.stationsIn(home()).some((x) => x.type === 'przeladunek' && x.status === 'gotowa');
  const fee = () => (port() ? EXCHANGE.feePort : EXCHANGE.fee);

  function pool() {
    const t = zero();
    for (const st of economy.poolOf(home())) for (const m of METAL_ORDER) t[m] += st.storage[m];
    return t;
  }
  const freeSpace = () => economy.poolOf(home()).reduce((a, st) => a + Math.max(0, economy.freeSpace(st)), 0);
  /** Skład urobku (średni) - do wyceny 1 t. */
  function oreMix() {
    const s = command.state;
    const mix = { ...s.ore };
    for (const st of command.stores()) for (const m of METAL_ORDER) mix[m] += st.ore?.[m] ?? 0;
    return mix;
  }
  function available(g) {
    if (g === 'kredyty') return Math.max(0, economy.state.credits);
    if (isMetal(g)) return pool()[g];
    if (g === 'urobek') { const o = command.oreStock(); return o.huta + o.magazyn; }
    return 0;
  }
  /** Kredyty za 1 jednostkę (sprzedaż, przed prowizją). */
  function sellUnit(g) {
    if (g === 'kredyty') return 1;
    if (isMetal(g)) return economy.price(g);
    const mix = oreMix(), t = sum(mix);
    return t > 1e-6 ? (command.oreValue(mix) / t) * EXCHANGE.oreValue : 0;
  }
  /** Kredyty za 1 jednostkę (kupno). */
  const buyUnit = (g) => (g === 'kredyty' ? 1 : isMetal(g) ? economy.price(g) * EXCHANGE.markup : Infinity);

  /**
   * Wycena wymiany. Zwraca { ok, why, from, to, amount, out, credits, fee, rate }.
   * amount jest przycinane do tego, co masz, i do miejsca w składzie.
   */
  function quote(from, to, amount) {
    const r = { ok: false, why: '', from, to, amount: 0, out: 0, credits: 0, fee: 0, rate: 0 };
    if (!home()) { r.why = 'Brak siedziby.'; return r; }
    if (!GOODS.includes(from) || !GOODS.includes(to)) { r.why = 'Nieznany towar.'; return r; }
    if (from === to) { r.why = 'Wybierz dwa różne towary.'; return r; }
    if (to === 'urobek') { r.why = 'Urobku się nie kupuje — to surowiec z własnych wypraw.'; return r; }
    let amt = Math.max(0, Math.min(amount, available(from)));
    const f = from === 'kredyty' ? 0 : fee();
    const unitIn = sellUnit(from) * (1 - f);
    const rate = unitIn / buyUnit(to); // ile "to" za 1 "from"
    if (isMetal(to)) {
      const room = freeSpace() + (isMetal(from) ? amt : 0); // sprzedany metal zwalnia miejsce
      if (amt * rate > room) amt = room / rate;
    }
    r.amount = amt;
    r.rate = rate;
    r.credits = amt * unitIn;
    r.fee = amt * sellUnit(from) * f;
    r.out = amt * rate;
    if (amt <= 1e-6) { r.why = available(from) <= 1e-6 ? `Nie masz: ${GOOD_NAME[from].toLowerCase()}.` : 'Skład pełny — brak miejsca na metal.'; return r; }
    r.ok = true;
    return r;
  }

  /** Wymiana. Zwraca { ok, text, quote }. */
  function trade(from, to, amount) {
    const q = quote(from, to, amount);
    if (!q.ok) return { ok: false, text: q.why, quote: q };
    const st = economy.state;
    // oddajemy "from"
    if (from === 'kredyty') st.credits -= q.amount;
    else if (isMetal(from)) {
      economy.payIn(home(), { [from]: q.amount });
      st.market[from] = Math.max(MARKET.floor, st.market[from] - q.amount * MARKET.impact);
      st.stats.sold[from] += q.amount;
    } else command.takeOre(q.amount);
    // dostajemy "to"
    if (to === 'kredyty') { st.credits += q.out; st.stats.earned += q.out; }
    else {
      const give = { ...zero(), [to]: q.out };
      for (const s of economy.poolOf(home())) { if (give[to] <= 1e-9) break; economy.deposit(s, give); }
      st.market[to] = Math.min(EXCHANGE.ceiling, st.market[to] + q.out * EXCHANGE.impactBuy);
      if (give[to] > 1e-6) st.credits += give[to] * buyUnit(to); // nie weszło (zaokrąglenia) - zwrot
    }
    const ex = (st.exchange ??= { trades: 0, fees: 0 });
    ex.trades++; ex.fees += q.fee;
    economy.save();
    const fmt = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString('pl-PL');
    const unit = (g) => (g === 'kredyty' ? 'kr' : 't');
    return { ok: true, quote: q, text: `Giełda: ${fmt(q.amount)} ${unit(from)} ${GOOD_NAME[from].toLowerCase()} → ${fmt(q.out)} ${unit(to)} ${GOOD_NAME[to].toLowerCase()}.` };
  }

  /** Kursy do tabelki: sprzedaż / kupno 1 t i mnożnik rynku (trend). */
  function rates() {
    const f = fee();
    return METAL_ORDER.map((m) => ({ id: m, sell: economy.price(m) * (1 - f), buy: buyUnit(m), market: economy.state.market[m], have: pool()[m] }))
      .concat([{ id: 'urobek', sell: sellUnit('urobek') * (1 - f), buy: null, market: null, have: available('urobek') }]);
  }

  return { quote, trade, rates, available, fee, port, freeSpace, GOODS, GOOD_NAME };
}
