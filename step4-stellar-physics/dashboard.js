/**
 * Dashboard gracza: komunikaty przypisane do ról załogi, każdy z prostym
 * avatarem (kolorowe kółko + inicjał - "proste avatary", bez grafik).
 *
 * MODEL DZIAŁANIA: "kanały" (channel = string, np. 'star-danger',
 * 'debris-42'). Wywołujący (main.js) woła show(channel, {...}) W KAŻDEJ
 * klatce, w której dany warunek jest prawdziwy (np. "za blisko gwiazdy")
 * - dashboard sam odświeża TTL (czas życia) tej karty, więc trwający
 * warunek daje JEDNĄ, stabilną kartę (nie zalew nowych powiadomień co
 * klatkę). Gdy wywołujący PRZESTAJE wołać show() dla danego kanału
 * (warunek przestał być prawdziwy), karta gaśnie sama po `ttl`
 * milisekund - naturalne, płynne zniknięcie bez potrzeby jawnego clear().
 *
 * KTÓRE ALERTY SĄ "ŻYWE" (main.js faktycznie je wywołuje z prawdziwych
 * warunków w grze) A KTÓRE TYLKO "PODŁĄCZONE" (API istnieje, ale nic w
 * grze jeszcze go nie wywołuje, bo brak odpowiedniej zawartości) -
 * patrz README kroku 4, sekcja "Dashboard załogi".
 */

export const CREW = {
  navigator: { role: 'Nawigator', initial: 'N', color: '#3d86ff' },
  sensors: { role: 'Oficer Czujników', initial: 'S', color: '#35e0c4' },
  engineer: { role: 'Główny Inżynier', initial: 'I', color: '#ff9d3d' },
  tactical: { role: 'Oficer Taktyczny', initial: 'T', color: '#ff4d4d' },
};

const URGENCY_ORDER = { danger: 0, warning: 1, info: 2 };

export function createDashboard(container) {
  const channels = new Map(); // key -> { el, expiresAt, urgency }

  function show(key, { crew, text, urgency = 'info', ttl = 1200 }) {
    let entry = channels.get(key);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'crew-alert';
      el.innerHTML = `
        <div class="crew-avatar"></div>
        <div class="crew-body">
          <div class="crew-role"></div>
          <div class="crew-text"></div>
        </div>
      `;
      container.appendChild(el);
      entry = { el };
      channels.set(key, entry);
    }
    entry.el.className = `crew-alert urgency-${urgency}`;
    entry.el.querySelector('.crew-avatar').textContent = crew.initial;
    entry.el.querySelector('.crew-avatar').style.background = crew.color;
    entry.el.querySelector('.crew-role').textContent = crew.role;
    entry.el.querySelector('.crew-text').textContent = text;
    entry.expiresAt = performance.now() + ttl;
    entry.urgency = urgency;
  }

  function clear(key) {
    const entry = channels.get(key);
    if (entry) {
      entry.el.remove();
      channels.delete(key);
    }
  }

  /** Wołane raz na klatkę - usuwa karty, których czas minął, i sortuje
   * widoczne wg pilności (danger na górze), ograniczając liczbę naraz
   * widocznych kart do MAX_VISIBLE (żeby nie zasypać ekranu). */
  const MAX_VISIBLE = 5;
  function tick() {
    const now = performance.now();
    for (const [key, entry] of channels) {
      if (now > entry.expiresAt) {
        entry.el.remove();
        channels.delete(key);
      }
    }
    const sorted = [...channels.values()].sort(
      (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    );
    sorted.forEach((entry, i) => {
      entry.el.style.display = i < MAX_VISIBLE ? '' : 'none';
      entry.el.style.order = i;
    });
  }

  return { show, clear, tick, CREW };
}
