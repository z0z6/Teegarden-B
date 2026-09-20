# Krok 3 — Prawdziwe modele statków (glTF) + zaokrętowanie

## Sterowanie
- **Mysz** — celowanie: pitch/yaw zależne od pozycji kursora względem
  środka ekranu (bez pointer lock — działa od razu, bez klikania w canvas)
- **W / ↑** — przyspiesz do przodu
- **S / ↓** — cofaj / hamuj
- **A / ←**, **D / →** — przechył (roll)
- **Shift** — boost
- **Spacja** — aktywne hamowanie
- **1 / 2 / 3 / 4** — zaokrętuj na inny statek z floty

Uruchamianie tak samo jak w krokach 1-2 (`npx serve .` z katalogu **głównego
repo**, nie z `step3-ships/` — bo `main.js` odwołuje się do modeli w
`../shared/ships/models/` względną ścieżką).

## Co się zmieniło i dlaczego

**Prawdziwe modele zamiast stożka.** Wczytujemy `.glb` przez `GLTFLoader`
zamiast budować geometrię ręcznie w kodzie. To bardziej "produkcyjne"
podejście — modele mogą być robione w Blenderze, kupione, albo (jak w tym
projekcie) wygenerowane proceduralnie i wyeksportowane raz, a potem tylko
wczytywane. Ładowanie jest asynchroniczne (`await loader.load(...)`), więc
pojawia się krótki moment "Cumowanie…" w rogu ekranu.

**Cztery statki, różna skala.** Warbird-light ma ~17 jednostek długości,
Kharath (ciężki niszczyciel) — ~180. To dosłownie 10× różnica. Kamera i
fizyka NIE mają osobnych, ręcznie wpisanych ustawień per statek — zamiast
tego `deriveFlightProfile()` i `deriveCameraRig()` liczą je z bounding boxa
wczytanego modelu (patrz sekcja niżej). Spróbuj przelecieć się Kharathem
zaraz po zwinnym Warbirdzie — różnica w "czuciu" jest natychmiastowa mimo
że kod fizyki jest dokładnie ten sam co w kroku 2.

**Zaokrętowanie (`loadShip()`).** Klawisze 1-4 wywołują `loadShip(index)`,
które: (1) wczytuje nowy model, (2) dopiero PO sukcesie usuwa stary
(żeby błąd sieci nie zostawił gracza bez statku), (3) przelicza
`flightProfile` i offsety kamery dla nowego modelu. Prędkość/pozycja
(`shipState`, `shipGroup.position`) NIE resetują się przy zmianie statku —
"zaokrętowanie" dzieje się w locie, w tym samym miejscu w przestrzeni.

**Korekta "180° dziobu".** Wszystkie 4 modele mają dziób w lokalnym `+Z`
(tak wyszły z narzędzia, którym były projektowane), a silnik z kroku 2
zakłada przód statku w lokalnym `-Z`. Zamiast przerabiać fizykę, po prostu
obracamy `visualGroup` (kontener na wczytany model) o stałe `Math.PI`
wokół Y, ustawiane raz w `loadShip()`. Wcześniej `visualGroup` dźwigał
też kosmetyczny "bank" przy skręcie — po przejściu na mysz+pełne 3D (patrz
niżej) prawdziwy przechył liczy się już bezpośrednio na `shipGroup`, więc
ten hack zniknął.

**Mysz zamiast samego A/D do skrętu.** Krok 2 miał tylko skręt w poziomie
(`yawVelocity`, jedna oś). Teraz statek ma pełne 3D: mysz steruje
pitch+yaw proporcjonalnie do odległości kursora od środka ekranu (bez
pointer lock — prościej, działa bez klikania w canvas), A/D dają realny
przechył (roll), nie tylko kosmetyczny. To wymagało zmiany kamery
(`updateCamera()` musi teraz dziedziczyć `up` statku, inaczej przy
przechyle horyzont kamery i statku by się rozjechały) i uproszczenia
`deriveFlightProfile()` (zniknęły `turnAcceleration`/`turnDrag` — czułość
sterowania skaluje się teraz przez `rateScale` w `updateShip()`, jeden
parametr zamiast trzech).

**`deriveFlightProfile()` — fizyka z geometrii.** Zamiast ręcznie tuningować
4 zestawy stałych (`acceleration`, `maxSpeed`, ...), liczymy jeden
"współczynnik skali" z przekątnej bounding boxa (`boundingSize.length()`)
względem statku-wzorca (`warbird-light`, ~20 jednostek). Większy statek =
trudniej go rozpędzić i skręcić — to naiwny, ale sensowny substytut
"bezwładności proporcjonalnej do masy", bez symulowania prawdziwej fizyki
brył sztywnych. Dzięki temu dodanie piątego statku do floty (patrz niżej)
NIE wymaga strojenia parametrów ruchu — wystarczy dorzucić go do `SHIPS`.

**LOD0, nie LOD1/LOD2.** Na razie zawsze ładujemy najwyższy poziom detalu
(`*-lod0.glb`). Przełączanie na LOD1/LOD2 w zależności od dystansu kamery
(np. gdy oglądasz sojuszniczy statek z daleka) to naturalny temat na krok 4
— `shared/ships/lod_helper.js` ma już gotowy `THREE.LOD` do tego, trzeba
go tylko podłączyć zamiast bezpośredniego `GLTFLoader.load()`.

## Skąd wzięły się modele

Modele w `shared/ships/models/*.glb` NIE są ręcznie modelowane — to eksport
z proceduralnych generatorów w `shared/ships/source/*.js` (czysty three.js:
`LatheGeometry`, `ExtrudeGeometry` itd., bez zewnętrznych plików assetów).
Jeśli chcesz zmienić wygląd statku (kolor, kształt skrzydła, cokolwiek),
edytujesz `.js` w `source/`, a potem regenerujesz `.glb` — pełna instrukcja
w `shared/ships/source/README.md`.

## Do eksperymentowania
- Dodaj piąty statek: dorzuć wpis do `SHIPS` w `main.js`, wskaż na nowy
  `.glb` w `shared/ships/models/` — fizyka i kamera "same się" dostosują.
- Zmień `refLength` w `deriveFlightProfile()` — wpływa na to, jak mocno
  rozjeżdżają się osiągi małych i dużych statków.
- Dodaj płynne przejście (lerp) `cameraOffset`/`cameraLookOffset` przy
  zaokrętowaniu, zamiast natychmiastowego skoku kamery — obecnie kamera
  "doskakuje" do nowej pozycji w tej samej klatce, w której zmienia się
  offset (ruch `lerp` w `updateCamera()` złagodzi tylko POZYCJĘ, nie sam
  offset docelowy).
- Zamień celowanie myszą "względem środka ekranu" na `pointer lock`
  (prawdziwe sterowanie w stylu FPS, ruch względny kursora zamiast
  pozycji bezwzględnej) — kosztem konieczności kliknięcia w canvas, żeby
  zablokować kursor.

## Co dalej (Krok 4?)
Pomysły: LOD zależny od dystansu (patrz `lod_helper.js`), HUD z prędkością/
throttle (mamy to już w standalone podglądzie Kharatha - `kharath_flight_preview.html`
w historii projektu, można przenieść), broń/strzelanie, albo przeciwnicy AI
pilotujący jeden z pozostałych 3 statków z floty.
