# Krok 4 — Układ potrójny (prawdziwa fizyka) + sztuczne oświetlenie statku

## Sterowanie
Bez zmian względem kroku 3: mysz — celowanie (pitch/yaw), W/S — ciąg,
A/D — przechył (roll), Shift — boost, Spacja — hamulec, 1-4 —
zaokrętowanie. Szczegóły schematu sterowania (dlaczego mysz, nie tylko
A/D jak w kroku 2) — patrz `step3-ships/README.md`.

## Aktualizacja skali i światła (v2)

Pierwsza wersja układu miała dwa realne problemy, które ujawniły się
dopiero przy oglądaniu: **czerwony olbrzym (promień 42 j.) był
MNIEJSZY niż długość największego statku floty** (Kharath, ~193 j.) —
gwiazda wizualnie mniejsza od statku to oczywisty absurd. Do tego
separacja wewnętrznej pary (18 j.) była ledwie ~1.03× sumą ich promieni
— gwiazdy PRAWIE się stykały powierzchniami w peryhelium.

Poprawka (`shared/systems/triple-star-system.js`):

| | v1 | v2 |
|---|---|---|
| promień starA | 12 | **500** |
| promień whiteDwarf | 2.2 | **140** |
| promień redGiant | 42 | **4200** |
| separacja wewnętrzna | 18 | **2560** (4× suma promieni, nie 1.03×) |
| separacja zewnętrzna | 160 | **23040** |
| orbita planety | 260 | **~39000** |

Fizyka N-ciał **nie wymagała żadnych zmian** poza przeliczeniem `G` —
skoro `G` i tak jest wyliczane z prawa Keplera dla nowej separacji
(`INNER_PERIOD_TARGET` zostało to samo, ~30s), przeskalowanie
odległości "samo się" uwzględniło. Przetestowałem stabilność ponownie
na nowej skali: 40 minut symulowanego czasu, separacje ograniczone
(2556-2687 j. / 22955-23040 j.), zero NaN.

**Światło: `decay=0.4` → `decay=2`.** Poprzednia wersja używała
sztucznie wolnego opadania jasności z odległością (`decay=0.4` zamiast
fizycznego `2`) - to było "urealnienie" na pokaz, nie naprawdę zgodne
z prawem odwrotnych kwadratów. Teraz `decay=2` wszędzie, a względne
jasności gwiazd (`LUMINOSITY` w kodzie) odzwierciedlają realną
astrofizykę: biały karzeł, mimo gorącej powierzchni, ma jasność
**0.05×** gwiazdy referencyjnej (bo jest mikroskopijny), a czerwony
olbrzym, mimo chłodniejszej powierzchni, ma jasność **350×** (bo ma
ogromną powierzchnię). "Gorący ≠ jasny" — nieintuicyjne, ale prawdziwe.

**Konsekwencja fizycznie poprawnego opadania: blisko oślepia, daleko
jest ciemno.** Skalibrowałem `BASE_INTENSITY` (mnożnik między
`LUMINOSITY` a rzeczywistym `intensity` w kodzie) empirycznie,
renderując testową scenę na kilku dystansach i oceniając wizualnie:
poniżej ~1000 j. od powierzchni gwiazdy obraz jest świadomie
prześwietlony na biało (realistyczne - z tej bliskości żadnej gwieździe
nie da się patrzeć prosto w "oczy"), w zakresie ~2000-10000 j. jest
wyraźny, czytelny gradient cieniowania, a powyżej ~20000 j. gwiazda
praktycznie przestaje coś doświetlać. Statek startuje ~48000 j. od
układu - w tej strefie same gwiazdy już nic nie dają, i to jest
**świadoma konsekwencja realizmu**, nie błąd kalibracji.

**Dlatego `shipLight` musiał zostać wzmocniony (×250, z 1.6 do 400).**
Skoro realne światło gwiazd zawodzi na typowych dystansach lotu, cały
ciężar "widoczności statku" spadł na sztuczne światło przypisane do
statku. To jest dokładnie ten sam kompromis co poprzednio (patrz sekcja
niżej), tylko z dużo wyższą stawką - bez wzmocnienia `shipLight`,
statek na starcie gry byłby praktycznie niewidoczny.

**I dlatego boost musiał urosnąć z ×2.2 do ×14.** Większe odległości
bez zmiany prędkości statku oznaczałyby kilkunastominutowy dolot do
układu. ×14 dobrane tak, żeby warbird-light pokonał dystans startowy
(~48000 j.) w ~75s pod boostem (46×14≈644 j./s). Boost skaluje teraz
RÓWNIEŻ przyspieszenie, nie tylko pułap prędkości - inaczej rozpędzenie
się do dużo wyższego pułapu trwałoby kilkanaście razy dłużej niż
zwykle. Przy okazji złapałem i naprawiłem subtelny błąd: pułap prędkości
był wcześniej stosowany BEZWARUNKOWO co klatkę, więc puszczenie Shift
przy dużej prędkości natychmiast "ucinało" ją do nowego, niższego
pułapu w jednej klatce - przy mnożniku ×2.2 to było ledwie zauważalne,
ale przy ×14 wyglądałoby jak zderzenie ze ścianą. Teraz prędkość nabyta
pod boostem opada naturalnie przez opór (drag), nie przez twardy reset
(zweryfikowane: 511.9→257.8 j./s w ciągu 1s po puszczeniu Shift, płynny
spadek, nie skok).

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
2560 j., czerwony olbrzym na orbicie 23040 j. — stosunek ~9x. Przetestowałem
to numerycznie na 40 minut symulowanego czasu gry (dużo dłużej niż
realna sesja) i separacje pozostają ograniczone przez cały czas
(para wewnętrzna: 2556-2687 j., para-olbrzym: 22955-23040 j.) — żadnych
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

Biały karzeł ma promień grubo mniejszy niż gwiazda typu Słońca (140 j.
vs 500 j. — to zapadnięty rdzeń, z grubsza wielkości Ziemi w skali
realnej), ale MASĘ tego samego rzędu wielkości (0.7 vs 1.0 w jednostkach
gry) — białe karły są ekstremalnie gęste. To częsty błąd w grach/
wizualizacjach ("mały promień = mała masa") — tutaj świadomie tego
unikamy, bo wpływa to realnie na fizykę (mniejszy promień NIE oznacza
mniejszego wkładu grawitacyjnego do orbity pary) ORAZ na jasność (patrz
sekcja "Aktualizacja skali i światła" wyżej — mały promień oznacza też
mniejszą CAŁKOWITĄ jasność, mimo gorętszej powierzchni).

### Planeta jako "cząstka testowa"

Planeta czuje grawitację wszystkich trzech gwiazd (sumę ich przyciągań,
przeliczaną co klatkę), ale NIE wpływa grawitacyjnie na same gwiazdy —
to standardowe przybliżenie ("ograniczony problem N ciał"), uzasadnione
tym, że masa planety jest znikoma względem gwiazd. Efekt uboczny: orbita
planety nie jest idealnym okręgiem, tylko realnie "oddycha" (promień
36497-39523 j. w 40-minutowym teście) pod wpływem zmieniającego się
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
  planetę). Gwiazdy są teraz OGROMNE (czerwony olbrzym: promień 4200 j.)
  i ruchome, więc to dużo bardziej zauważalne niż wcześniej.
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
