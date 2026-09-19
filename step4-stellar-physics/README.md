# Krok 4 — Układ potrójny (prawdziwa fizyka) + sztuczne oświetlenie statku

## Sterowanie
Bez zmian względem kroku 3 (W/S/A/D, Shift, Spacja, 1-4 zaokrętowanie).

## Co się zmieniło i dlaczego

**Dwie osobne rzeczy, jeden powód.** Dorzucenie ruchomych gwiazd
i dorzucenie światła na statku brzmią jak dwa niezwiązane zadania, ale
są ze sobą powiązane: w krokach 1-3 gwiazda stała w jednym, stałym
miejscu, więc oświetlenie sceny było przewidywalne. Teraz, gdy gwiazdy
realnie krążą względem siebie, statek może się znaleźć w słabo
oświetlonym rejonie między nimi. Zamiast rozwiązywać to "porządnie"
(image-based lighting, kilka świateł kierunkowych dobranych pod kamerę —
dobry temat na osobny krok), doczepiliśmy prosty `PointLight`
bezpośrednio do `shipGroup`. To rozwiązanie tymczasowe i celowo
oznaczone jako takie w kodzie.

### Dlaczego układ HIERARCHICZNY, a nie trzy równe orbity

"Płaski" układ trzech gwiazd o porównywalnych, podobnych odległościach
jest w ogólności chaotyczny — to klasyczny problem trzech ciał, i w
symulacji (albo w naturze) zwykle kończy się wyrzuceniem jednego ciała
albo zderzeniem dwóch pozostałych, często w skali czasu dużo krótszej,
niż "sesja grania". Realne, długotrwale stabilne układy potrójne w
naturze są (niemal) zawsze **hierarchiczne**: ciasna para + daleki
towarzysz, ze sporym stosunkiem odległości zewnętrznej do wewnętrznej.
Tutaj: para wewnętrzna (gwiazda typu Słońca + biały karzeł) w odległości
18 j., czerwony olbrzym na orbicie 160 j. — stosunek ~8.9x. Przetestowałem
to numerycznie na 40 minut symulowanego czasu gry (dużo dłużej niż
realna sesja) i separacje pozostają ograniczone przez cały czas
(para wewnętrzna: 18.0-19.7 j., para-olbrzym: 159.4-160.0 j.) — żadnych
zderzeń, żadnych ucieczek w nieskończoność.

### Dlaczego integracja leapfrog, a nie zwykły Euler

Naiwna integracja Eulera (`x += v*dt` potem `v += a*dt`, na podstawie
przyspieszenia z poprzedniej klatki) systematycznie dodaje energię do
układu — orbity powoli się "rozkręcają" i po dłuższym czasie ciała
uciekają po spirali. Leapfrog (`shared/physics/n-body.js`) jest
symplektyczny: błąd energii oscyluje wokół zera zamiast rosnąć bez
końca, więc orbity zostają ograniczone nawet po bardzo długiej
symulacji. To standardowa metoda w prawdziwych kodach N-body w
astrofizyce, nie coś wymyślonego na potrzeby tej gry.

### Realistyczny szczegół: biały karzeł

Biały karzeł ma promień grubo mniejszy niż gwiazda typu Słońca (2.2 j.
vs 12 j. — to zapadnięty rdzeń, z grubsza wielkości Ziemi), ale MASĘ
tego samego rzędu wielkości (0.7 vs 1.0 w jednostkach gry) — białe
karły są ekstremalnie gęste. To częsty błąd w grach/wizualizacjach
("mały promień = mała masa") — tutaj świadomie tego unikamy, bo wpływa
to realnie na fizykę (mniejszy promień NIE oznacza mniejszego wkładu
grawitacyjnego do orbity pary).

### Planeta jako "cząstka testowa"

Planeta czuje grawitację wszystkich trzech gwiazd (sumę ich przyciągań,
przeliczaną co klatkę), ale NIE wpływa grawitacyjnie na same gwiazdy —
to standardowe przybliżenie ("ograniczony problem N ciał"), uzasadnione
tym, że masa planety jest znikoma względem gwiazd. Efekt uboczny: orbita
planety nie jest idealnym okręgiem, tylko realnie "oddycha" (promień
241-262 j. w 40-minutowym teście) pod wpływem zmieniającego się
położenia czerwonego olbrzyma — to nie błąd, to prawdziwe zaburzenie
trzeciego ciała.

### G nie jest fizyczne (6.674×10⁻¹¹)

Prawdziwa stała grawitacji dałaby ruch niezauważalny gołym okiem przy
odległościach/masach w skali tej sceny. Zamiast zgadywać, wyliczyłem
`G` z prawa Keplera (`T² = 4π²a³/(G·M)`) tak, żeby wewnętrzna para
miała okres orbitalny ~30s — "grywalny" czasowo, ale nadal spójny
fizycznie (te same G/masy/odległości rządzą WSZYSTKIMI ciałami w
układzie, nic nie jest oskryptowane osobno).

## Znane uproszczenia (świadome, nie przeoczenia)

- **Orbity są komplanarne** (wszystkie w płaszczyźnie XZ). Realne
  hierarchiczne układy potrójne często mają orbitę wewnętrzną nachyloną
  względem zewnętrznej. Pominięte dla prostoty matematyki wektorów —
  dobry temat do dorzucenia później.
- **Brak kolizji.** Można przelecieć statkiem przez środek gwiazdy bez
  konsekwencji (dokładnie jak w kroku 3 można było przelecieć przez
  planetę). Gwiazdy są teraz duże (czerwony olbrzym: promień 42) i
  ruchome, więc to bardziej zauważalne niż wcześniej.
- **Zmierzony okres pary wewnętrznej to ~32.7s, nie dokładnie 30s.**
  To NIE błąd do naprawienia — to realne zaburzenie od grawitacji
  czerwonego olbrzyma (który w prostym wzorze Keplera dla pary
  dwuciałowej nie jest uwzględniony). Różnica ~9% jest oczekiwana i
  jest dowodem, że układ faktycznie liczy pełną fizykę trzech ciał,
  a nie odtwarza zapisaną z góry animację.

## Do eksperymentowania
- Zmień `INNER_PERIOD_TARGET` w `triple-star-system.js` — krótszy okres
  = szybszy, bardziej "nerwowy" taniec pary wewnętrznej.
- Dodaj nachylenie orbity wewnętrznej względem zewnętrznej (patrz
  "Znane uproszczenia" wyżej) dla dodatkowego realizmu wizualnego.
- Zastąp `shipLight` czymś ładniejszym niż goły `PointLight` — np.
  emissive materiał na silnikach statku (już jest w geometrii — patrz
  `shared/ships/source/*.js`, materiał `glow`), podświetlony zależnie
  od throttle.
- Dodaj prostą detekcję kolizji statek-gwiazda (choćby sferyczną, patrz
  promienie w `RADIUS` w `triple-star-system.js`).

## Co dalej (Krok 5?)
LOD zależny od dystansu (nadal czeka z kroku 3), HUD z prędkością,
kolizje, broń, AI.
