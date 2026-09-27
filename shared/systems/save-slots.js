/**
 * ZAPISY GRY (krok 12): nazwane stany kampanii obok autozapisu.
 *
 * Autozapis (economy.save, co kilka sekund) trzyma JEDEN bieżący stan
 * kampanii rasy pod `liveKey`. Sloty to kopie tego stanu zrobione na
 * życzenie gracza: każdy leży pod osobnym kluczem w localStorage, a spis
 * (nazwa, data, opis) pod `<prefix>.sloty`, żeby lista wczytywała się bez
 * parsowania wszystkich stanów.
 *
 * Wczytanie = podmiana autozapisu na stan ze slotu i przeładowanie strony
 * z adresem tego zapisu (układ siedziby, statek = rasa). Cała gra buduje
 * się wtedy od zera z tego stanu, tak jak przy zwykłym powrocie do gry,
 * więc nie trzeba umieć "przewijać" żywych obiektów sceny.
 *
 * Eksport / import pliku .json: przeniesienie zapisu na inne urządzenie
 * (np. z komputera na telefon) albo kopia poza przeglądarką.
 *
 * Działa w Node (testy): storage to dowolny obiekt z getItem/setItem/removeItem.
 */

const FORMAT = 'teegarden-b.zapis';
const VERSION = 1;
/** Maksymalny rozmiar pliku importu (znaki). Prawdziwe zapisy mają kilkadziesiąt-kilkaset KB. */
export const MAX_IMPORT_CHARS = 5_000_000;

/**
 * BEZPIECZEŃSTWO: `liveKey` i `meta` przychodzą z pliku od gracza (import) albo
 * z localStorage. Klucz autozapisu musi pasować do wzorca gry - inaczej
 * spreparowany plik mógłby przy „Wczytaj” nadpisać dowolny wpis localStorage
 * tej domeny (np. spis slotów albo dane innej strony na tym samym origin).
 */
const LIVE_KEY_RE = /^teegarden-b\.dowodztwo\.v1\.[a-z0-9_-]{1,32}$/;
export const isLiveKey = (k) => typeof k === 'string' && LIVE_KEY_RE.test(k);

const str = (v, max = 60) => (v == null ? undefined : String(v).slice(0, max));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
/** Opis slotu przepisany tylko ze znanych pól, o znanych typach. */
export function cleanMeta(m) {
  if (!m || typeof m !== 'object') return {};
  const out = {
    race: str(m.race, 32), raceName: str(m.raceName), home: str(m.home, 32), homeName: str(m.homeName),
    ship: str(m.ship, 64), diff: str(m.diff, 16),
    credits: num(m.credits), fleet: num(m.fleet), share: num(m.share), time: num(m.time),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export function createSaveSlots({ storage, prefix = 'teegarden-b.dowodztwo', now = () => Date.now() }) {
  const indexKey = `${prefix}.sloty`;
  const slotKey = (id) => `${prefix}.slot.${id}`;

  function list() {
    try {
      const raw = storage?.getItem(indexKey);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((e) => e && typeof e.id === 'string' && /^[\w-]{1,48}$/.test(e.id)).sort((a, b) => b.savedAt - a.savedAt) : [];
    } catch { return []; }
  }
  function writeIndex(arr) { storage.setItem(indexKey, JSON.stringify(arr)); }

  /**
   * Zapisuje stan jako slot. `data` to gotowy JSON stanu (tekst z autozapisu),
   * `meta` - opis do listy (rasa, układ, kredyty...), `liveKey` - pod jaki
   * klucz autozapisu wraca przy wczytaniu. `id` = nadpisanie istniejącego.
   */
  function save({ name, data, meta = {}, liveKey, id = null }) {
    if (!storage) return { ok: false, text: 'Przeglądarka nie pozwala zapisywać (tryb prywatny?).' };
    if (!data) return { ok: false, text: 'Brak stanu do zapisania.' };
    if (!isLiveKey(liveKey)) return { ok: false, text: 'Nieprawidłowy klucz zapisu.' };
    const slots = list();
    const sid = id ?? `z${now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const entry = { id: sid, name: String(name || 'Zapis').slice(0, 40), savedAt: now(), meta: cleanMeta(meta), liveKey };
    try {
      storage.setItem(slotKey(sid), JSON.stringify({ format: FORMAT, version: VERSION, ...entry, data }));
      writeIndex([entry, ...slots.filter((s) => s.id !== sid)]);
    } catch {
      try { storage.removeItem(slotKey(sid)); } catch { /* jw. */ }
      return { ok: false, text: 'Brak miejsca w pamięci przeglądarki — usuń stare zapisy albo wyeksportuj je do pliku.' };
    }
    return { ok: true, id: sid, text: `Zapisano: ${entry.name}.` };
  }

  function read(id) {
    try {
      const raw = storage?.getItem(slotKey(id));
      const s = raw ? JSON.parse(raw) : null;
      return s?.format === FORMAT && typeof s.data === 'string' && isLiveKey(s.liveKey) ? { ...s, meta: cleanMeta(s.meta) } : null;
    } catch { return null; }
  }

  function remove(id) {
    try {
      storage.removeItem(slotKey(id));
      writeIndex(list().filter((s) => s.id !== id));
      return { ok: true, text: 'Zapis usunięty.' };
    } catch { return { ok: false, text: 'Nie udało się usunąć zapisu.' }; }
  }

  /** Podmienia autozapis na stan ze slotu. Zwraca slot (meta: adres gry) albo null. */
  function restore(id) {
    const s = read(id);
    if (!s || !isLiveKey(s.liveKey)) return null;
    try { JSON.parse(s.data); storage.setItem(s.liveKey, s.data); } catch { return null; }
    return s;
  }

  /** Tekst pliku eksportu (ten sam format co slot). */
  function exportText(id) {
    const s = read(id);
    return s ? JSON.stringify(s) : null;
  }

  /** Import z pliku: sprawdza format i zapisuje jako nowy slot. */
  function importText(text) {
    if (typeof text !== 'string' || text.length > MAX_IMPORT_CHARS) return { ok: false, text: 'Plik jest za duży jak na zapis gry.' };
    let s;
    try { s = JSON.parse(text); } catch { return { ok: false, text: 'To nie jest plik zapisu (błędny JSON).' }; }
    if (s?.format !== FORMAT || typeof s.data !== 'string' || !isLiveKey(s.liveKey)) return { ok: false, text: 'To nie jest plik zapisu Teegarden-B.' };
    try { if (JSON.parse(s.data)?.version !== 1) throw new Error(); } catch { return { ok: false, text: 'Zapis w nieznanej wersji gry.' }; }
    return save({ name: s.name, data: s.data, meta: cleanMeta(s.meta), liveKey: s.liveKey });
  }

  return { list, save, read, remove, restore, exportText, importText };
}
