# Krok 4 — Układ potrójny (prawdziwa fizyka) + sztuczne oświetlenie statku

## Sterowanie

**Desktop:** mysz — celowanie (pitch/yaw), W/S — ciąg, A/D — przechył
(roll), Shift — boost, Spacja — hamulec, 1-4 — zaokrętowanie. Szczegóły
schematu sterowania (dlaczego mysz, nie tylko A/D jak w kroku 2) —
patrz `step3-ships/README.md`.

**Dotyk (Android/mobile):** dwa wirtualne joysticki ("twin-stick",
typowy schemat mobilnych symulatorów lotu) — lewy celuje (pitch/yaw),
prawy steruje przechyłem (X) i ciągiem (Y, w górę = do przodu).
Przyciski BOOST i STOP obok prawego joysticka, "Zmień statek" w rogu
(brak klawiszy 1-4 na telefonie, więc cykliczne przełączanie). UI
dotykowe pokazuje się automatycznie na urządzeniach z `pointer: coarse`
(czyli w praktyce: ekranach dotykowych) — na desktopie z myszą jest
całkowicie ukryte przez CSS, nie przeszkadza.

**VR (WebXR):** przycisk "ENTER VR" w dolnym rogu ekranu (widoczny
tylko gdy przeglądarka/urządzenie faktycznie wspiera WebXR — biblioteka
`VRButton` z three.js sama to wykrywa i w przeciwnym razie pokazuje
wyszarzone "VR NOT SUPPORTED"). W VR: lewy kontroler = celowanie +
hamulec (spust), prawy kontroler = przechył/ciąg + spust (dodatkowy
ciąg) + chwyt boczny (boost). Mapowanie wg profilu `xr-standard`
WebXR Input Profiles — **nieprzetestowane na realnym headsecie**, patrz
zastrzeżenie niżej.

## Zunifikowany input (`shared/input/flight-controls.js`)

Trzy zupełnie różne metody sterowania (klawiatura+mysz, dotyk, kontrolery
XR) zasilają JEDEN wspólny stan (`pitch/yaw/roll/throttle/boost/brake`,
każde w zakresie -1..1) — `updateShip()` w `main.js` czyta tylko ten
stan i nie wie (ani nie musi wiedzieć), skąd input pochodzi. Moduł sam
wybiera, które źródło jest "aktywne" w danej klatce: kontrolery XR mają
pierwszeństwo (jeśli trwa sesja VR), potem dotyk (jeśli ktoś aktualnie
trzyma joystick/przycisk), na końcu klawiatura+mysz jako domyślne.

Dzięki tej separacji dodanie NOWEGO sposobu sterowania (np. gamepad USB,
głosowe komendy) wymagałoby tylko dopisania czwartego "źródła" w
`flight-controls.js` - reszta silnika lotu zostaje nietknięta.

## Kokpit w VR: `cameraRig`, nie bezpośrednio `camera`

To był największy refaktor pod VR. Poza sesją WebXR kamera i tak
zachowuje się jak wcześniej (kamera pogoniowa "na sprężynie"), ale
technicznie steruje teraz obiektem `cameraRig` (pusty `THREE.Group`),
a nie samą `camera` — bo w VR **WebXR samo nadpisuje lokalną
pozycję/rotację `camera`** na podstawie śledzenia headsetu. Gdybyśmy
nadal sterowali `camera` bezpośrednio, każda nasza zmiana byłaby co
klatkę nadpisywana przez silnik VR. Zamiast tego poruszamy/obracamy
RODZICA (`cameraRig` = "gdzie w statku siedzi gracz"), a headset dokłada
swobodny look w jego wnętrzu.

**W VR kamera jest SZTYWNO przypięta do statku (bez lerp/opóźnienia)**,
inaczej niż poza VR. To świadoma decyzja: opóźnienie kamery względem
ruchu gracza w VR to prosta droga do choroby lokomocyjnej (mózg czuje
ruch przez błędnik, ale oczy widzą go z doganiającym opóźnieniem —
klasyczny trigger VR sickness). Pozycja "kokpitu" (`cockpitOffsetY/Z`)
jest bliżej kadłuba niż kamera pogoniowa i przeliczana per-statek w
`loadShip()`, tym samym wzorcem co `cameraOffset`.

## `renderer.setAnimationLoop()`, nie `requestAnimationFrame()`

Wymóg WebXR — poza sesją VR zachowuje się identycznie jak zwykłe rAF,
ale gdy gracz wejdzie w VR, ten sam callback zaczyna być zsynchronizowany
z odświeżaniem HEADSETU (zwykle 90 Hz), nie monitora (60 Hz). Zwykły
`requestAnimationFrame` by tego nie obsłużył poprawnie.

## Zastrzeżenie: VR nieprzetestowane na realnym sprzęcie

Zbudowałem WebXR zgodnie ze specyfikacją (VRButton, cameraRig,
setAnimationLoop, odczyt gamepadów kontrolerów wg `xr-standard`) i
zweryfikowałem, co dało się zweryfikować bez headsetu: przycisk VR
poprawnie wykrywa brak/obecność wsparcia WebXR, nie ma błędów JS przy
starcie, kod przechodzi przez wszystkie dotychczasowe testy regresji
(desktop, dotyk). **Nie mam fizycznego headsetu w tym środowisku**, więc
faktyczne renderowanie stereo, komfort kokpitu i dokładne mapowanie osi/
przycisków kontrolerów wymagają testu na prawdziwym sprzęcie (Quest i
podobne). Jeśli Twój kontroler reaguje odwrotnie/nie reaguje wcale,
pierwsze miejsce do poprawki to `updateXR()` w `flight-controls.js`.

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

## Tło, kolizje i dashboard gracza

**Tło (`shared/systems/space-background.js`).** Gwiazdy z kroku 2 (te same
6000 sztuk i paleta) plus mgławice — w kroku 2 mgławic nie było, tu są nowe.
Stary `starfield` (Points w promieniu 200 000 j.) w tej skali nie działa:
rozmiar punktów w jednostkach świata kurczy się do ułamka piksela, a
statek lecący dziesiątki tysięcy jednostek widzi paralaksę. Dlatego mgławica
jest generowana proceduralnie w shaderze RAZ przy starcie, "wypiekana" do
cube mapy i ustawiona jako `scene.background` (three.js rysuje takie tło
bez translacji kamery — z definicji w nieskończoności, zero kosztu na
klatkę), a gwiazdy to `Points` o stałym rozmiarze w PIKSELACH doczepione do
kamery. Zmierzone: ta sama rotacja kamery przesuniętej o 50 000 j. daje
identyczny obraz (różnica 0.0).

**Kadrowanie kamery i orientacja** pochodzą z `shared/ships/fleet.js` (patrz
`shared/ships/README.md`): wszystkie 4 statki zajmują na ekranie tyle samo
miejsca, a Kharath leci dziobem do przodu. Światło statku (`shipLight`)
rośnie teraz z KWADRATEM rozmiaru statku — stałe 400 dawało Kharathowi
(przekątna ~193 j.) ~60× mniej oświetlony kadłub niż myśliwcom.

**Gruz i meteoryty** (`shared/systems/debris-field.js`): prawdziwe ciała
stałe (dryfują, kolidują ze statkiem), rozsiane wokół punktu startu.

**Dashboard gracza** — dwie części:
- *Telemetria* (lewy dolny róg; na telefonie u góry): prędkość, pasek
  prędkości ze znacznikiem prędkości przelotowej (powyżej = boost), tryb
  napędu (DRYF/CIĄG/WSTECZ/BOOST/HAMULEC/KONTAKT), najbliższe ciało i
  odległość od jego powierzchni, odległość od barycentrum układu.
- *Komunikaty załogi* (prawy górny róg, `shared/systems/dashboard.js`):
  kanały odświeżane ~10 razy na sekundę; karta sama gaśnie po `ttl`, gdy
  warunek przestaje być prawdziwy.

| Rola | Alert (żywy = wołany z prawdziwych warunków w grze) |
|---|---|
| Nawigator | zbliżanie do gwiazdy (warning), planeta blisko (info), zaokrętowanie |
| Główny Inżynier | przegrzanie przy gwieździe (danger), kontakt/kolizja (danger) |
| Oficer Czujników | KURS KOLIZYJNY z gruzem (danger), gruz <1500 j. (warning), obiekt zbliżający się i mijający nas <1500 j. w 90 s (info) |
| Oficer Taktyczny | podłączony, ale bez zawartości — w grze nie ma jeszcze wrogów ani sojuszników |

Kurs kolizyjny liczymy z czasu najbliższego zbliżenia dwóch ciał o stałej
prędkości względnej (`t* = -(r·v)/|v|²`), a nie z samej odległości —
obiekt oddalający się o 500 j. nie jest zagrożeniem, a szybki meteoryt w
odległości 2000 j. lecący prosto na nas — jest.

## Znane uproszczenia (świadome, nie przeoczenia)

- **Orbity są komplanarne** (wszystkie w płaszczyźnie XZ). Realne
  hierarchiczne układy potrójne często mają orbitę wewnętrzną nachyloną
  względem zewnętrznej. Pominięte dla prostoty matematyki wektorów —
  dobry temat do dorzucenia później.
- **Kolizje są sferyczne i "twarde"** (`shared/systems/collision.js`):
  statek jest odpychany na powierzchnię gwiazdy/planety/gruzu, a prędkość
  tłumiona — bez odbić, uszkodzeń i momentu pędu. Promień kolizji statku to
  ~0.3 przekątnej modelu, co dla wydłużonego Kharatha (~180 j.) jest
  przybliżeniem. Test jest chwilowy (bez "sweep"), więc przy ekstremalnej
  prędkości wobec bardzo małego gruzu w teorii można przeskoczyć obiekt w
  jednej klatce.
- **Dashboard nie działa w VR** — telemetria i karty załogi to elementy DOM,
  niewidoczne w sesji WebXR. Potrzebny byłby panel w scenie 3D.
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
- Dodaj uszkodzenia kadłuba/tarcze (kolizje już są, ale niczego nie
  niszczą) albo przegrzewanie przy gwieździe — alert "Przegrzanie kadłuba"
  jest na razie tylko komunikatem.
- **Przetestuj VR na realnym headsecie** i popraw mapowanie osi/
  przycisków w `updateXR()` (`shared/input/flight-controls.js`), jeśli
  Twój kontroler różni się od zakładanego profilu `xr-standard`.
- Ukryj/przezrocz kadłub statku w widoku kokpitowym VR (obecnie kamera
  siedzi tuż przy kadłubie, ale wnętrze statku nie ma modelowanej
  kabiny — możesz zobaczyć fragmenty geometrii kadłuba od środka).

## Co dalej (Krok 5?)
LOD zależny od dystansu (nadal czeka z kroku 3), broń, AI (wtedy
Oficer Taktyczny w dashboardzie będzie miał co zgłaszać). Ewentualnie: dodanie tego samego sterowania dotyk/VR
do step3-ships (obecnie tylko step4 je ma).
