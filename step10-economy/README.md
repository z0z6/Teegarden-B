# Krok 10 — Ekonomia, stacje orbitalne i roje dronów

Krok 9 + **warstwa ekonomiczna**: pas planetoid przy każdym układzie,
wydobycie metali promieniem statku, stacje orbitalne (magazyn, stacja
przeładunkowa, dok roju), logistyka między stacjami, rynek i **roje
autonomicznych dronów górniczych**, które same lądują na planetoidach, wiercą
i zwożą urobek. Misje, wataha, AI i audio działają jak w kroku 9 (tablica
misji prowadzi teraz tutaj).

```
step10-economy/?uklad=teegarden          wolny lot w układzie Teegardena
step10-economy/?misja=waves&...          misja z tablicy, ekonomia działa w tle
```

## Pętla gospodarcza

1. **Kopiesz sam.** Leć do pasa planetoid (jest po prawej od punktu startu,
   etykieta skały w celowniku pokazuje klasę i zasoby). Przytrzymaj **T**:
   promień wydobywczy topi skałę i napełnia ładownię (statystyka „ładunek”
   rasy × 5 t, np. 100 t dla Wybudzonych).
2. **Stawiasz pierwszą stację.** **P** otwiera panel przemysłu; „Postaw przed
   dziobem” zakłada plac budowy. Kredyty płacisz od razu, metal trzeba
   dowieźć: podleć do placu i naciśnij **Y**.
3. **Sprzedajesz.** Stacja przeładunkowa przyjmuje metal i wysyła go
   frachtowcami poza układ, 5 t/s, po kursie rynkowym. Zalanie rynku jednym
   metalem obniża jego kurs, który potem powoli wraca do normy.
4. **Automatyzujesz.** Dok roju produkuje drony z metalu zgromadzonego w
   układzie. Rój sam wybiera złoże albo kopie wskazane i oddaje urobek do
   najbliższej stacji z miejscem albo do wybranej.
5. **Rośniesz.** Każdy układ ma własny pas i własne stacje. Gdy lecisz gdzie
   indziej, stare kopalnie pracują dalej.

## Sterowanie (dodatki do kroku 9)

| Klawisz | Akcja |
|---|---|
| **T** (przytrzymaj) | promień wydobywczy w planetoidę przed dziobem (stożek ~20°, zasięg 950 j. od powierzchni) |
| **Y** | rozładunek ładowni w najbliższej stacji albo na placu budowy (zasięg 380 j. od powierzchni stacji) |
| **P** | panel przemysłu: budowa, stacje, roje, rynek, ewakuacja rojów (Esc zamyka) |

Na dotyku: przycisk **KOP** obok OGNIA, a panel przemysłu na dole ekranu
(dotknięcie podpowiedzi rozładowuje, „panel” otwiera przemysł).

## Stacje

| Stacja | Koszt | Rola |
|---|---|---|
| **Magazyn** | 300 kr · 40 t Fe | 2000 t składu; z magazynów holowniki zaopatrują budowy i produkcję dronów |
| **Stacja przeładunkowa** | 500 kr · 90 t Fe · 20 t Ni | bufor 500 t, sprzedaż 5 t/s po kursie rynkowym |
| **Dok roju** | 900 kr · 140 t Fe · 45 t Ni · 6 t Co | stocznia dronów (1 dron / 4 s), baza rojów, limit 48 dronów na dok |

Dron górniczy kosztuje 45 kr, 10 t Fe, 3 t Ni i 1 t Co. Wszystkie liczby
są w jednym pliku: `shared/data/economy.js`.

**Dlaczego metal na budowę trzeba dowieźć, a kredyty nie.** Kredyty to
abstrakcja, a stacja z czegoś musi powstać. Pierwszy magazyn jest celowo tani
(40 t żelaza to niecała ładownia), żeby gracz od razu miał gdzie zrzucać
urobek. Później plac budowy sam „ściąga” metal z magazynów i doków (holowniki,
8 t/s, widoczne jako złote świetliki na torze magazyn → plac). Plac przyjmuje
też nadwyżkę, np. nikiel, gdy chce tylko żelaza. Trafia ona do zapasów
przyszłej stacji. Bez tego gracz przed pierwszą stacją nie miałby gdzie
zrzucić ładowni pełnej niepotrzebnego metalu. Ten błąd wyłapał test
`check.mjs`.

## Planetoidy (`shared/systems/asteroid-belt.js`)

Trzy klasy wg prawdziwej taksonomii: **C** (węglowe, ciemne, ubogie),
**S** (krzemianowe, najczęstsze) i **M** (metaliczne, czyli odsłonięte jądra
rozbitych protoplanet: rzadkie, bogate w nikiel, kobalt i platynę).

- **Deterministyczne.** Pas jest generowany z ziarna układu, więc ten sam
  układ ma przy każdej wizycie ten sam pas. Zapis gry trzyma tylko to, co już
  wykopano, a nie cały pas.
- **Kształt i powierzchnia z jednej funkcji.** Ikosaedr zniekształcony
  szumem 3D, z kraterami i rozciągnięciem. Ta sama funkcja daje wierzchołki
  siatki i punkt lądowania drona, więc dron siada na skale, a nie na sferze
  zastępczej.
- **Ślady wydobycia.** W miejscu wiercenia skała się zapada i ciemnieje.
  Wyczerpana planetoida robi się szarą, matową hałdą.

## Roje dronów

Rój to grupa dronów z jednym dokiem bazowym i wspólnymi rozkazami:
**złoże** (automatycznie albo konkretna planetoida), **czego szukać**
(np. głównie platyna — cztery razy większa waga przy wyborze złoża),
**dokąd oddawać urobek** i tryb: **wydobycie** albo **do doku**. W panelu:
+1 / +5 dronów (produkcja w doku), −1 (rozbiórka, połowa metalu wraca),
„Rozwiąż”.

Automat stanów drona:

```
dok -> lot (nad miejsce wiercenia) -> ladowanie -> wiercenie (12 t, 0,8 t/s)
    -> powrot -> rozladunek -> lot ...        czeka: wszystkie stacje pełne
```

**Dlaczego dron „jedzie” razem ze skałą.** Planetoidy się obracają, a punkt
nad powierzchnią dużej skały przesuwa się z prędkością do ~20 j./s. Pierwsza
wersja sterowała dronem jak do nieruchomego celu: zwalniał przy podejściu i
nigdy nie doganiał uciekającego punktu. Drony wisiały w stanie „lądowanie”
i przez 80% czasu nie wierciły. Teraz dron najpierw przejmuje ruch
powierzchni (dopasowanie prędkości jak przy dokowaniu), a dopiero potem się
zbliża. Czas wiercenia wzrósł z 8% do ~40%, a urobek pięciokrotnie. Miejsce
wiercenia jest trzymane we współrzędnych **lokalnych** bryły, więc dron siedzi
na obracającej się skale, a nie w punkcie, gdzie skała była chwilę temu.

**Wygląd.** Kadłuby dronów to jedna `InstancedMesh` (jedno wywołanie
rysowania dla setek dronów). Z daleka rój widać po świetlikach silników:
punkty z minimalnym rozmiarem w pikselach, w kolorze stanu (niebieski lot,
bursztynowy wiercenie, zielony powrót, czerwony czeka).

## Rabusie (`shared/systems/raids.js`)

Kopalnia, którą widać z daleka, przyciąga rabusiów. Każdy układ z choć
jedną gotową stacją ma **licznik zagrożenia**. Rośnie z liczbą dronów i z
obrotem stacji przeładunkowej (`RAIDS` w `shared/data/economy.js`). Przy
pierwszym doku z kilkunastoma dronami nalot przychodzi po 3–5 minutach, a po
każdym nalocie są 4 minuty spokoju. Pasek zagrożenia jest w HUD przemysłu i
w nagłówku panelu.

Nalot w układzie gracza:

1. **Ostrzeżenie (15 s).** Oficer taktyczny melduje sygnatury fałdy. Roje z
   włączoną **ewakuacją** wracają do doków. Dron w doku jest schowany: nie da
   się go trafić ani wybrać na cel.
2. **Walka.** 2–6 rabusiów wychodzi z fałdy po drugiej stronie pasa niż
   stacje, z jednej losowej rasy innej niż gracza, z frakcji koalicyjnej
   (np. Bez Numeru, Kukułki). To zwykłe wrogie NPC z mózgiem z
   `tactical-ai.js` (uniki, flankowanie, odwet, odwrót rannych), tylko z
   innym priorytetem celów: **drony (×3) > stacje (×2) > gracz**. Bronią się
   gracz, wataha (L) i **platformy obronne**.
3. **Koniec.** Rabusie odlatują, gdy mają dość łupu (10 dronów albo 300 t
   metalu) albo po 3 minutach. Kwatermistrz raportuje wynik, a kupcy płacą
   **250 kr za każdego zestrzelonego**.

**Co mogą zabrać.** Dron ma 30 pkt kadłuba (2–3 trafienia). Stacji się nie
niszczy, tylko łupi: gdy jej kadłub spadnie do zera, rabusie zabierają 40%
zapasów, a stacja przez 25 s nie jest już celem. Platforma zostaje wtedy
wyłączona. Kadłuby stacji same się naprawiają, gdy nikt ich nie ostrzeliwuje.

**Platforma obronna** (4. stacja, 700 kr · 110 t Fe · 35 t Ni · 12 t Co):
obrotowa głowica z podwójnym działem, zasięg 2200 j. Sama wybiera
najbliższego wroga, strzela z wyprzedzeniem i jest zwykłym celem dla
rabusiów. Strzela też do wrogów z misji.

**Ewakuacja albo nie** (przełącznik przy każdym roju, domyślnie włączony).
Z ewakuacją rój przerywa pracę na cały nalot. Bez niej kopie dalej i ginie.
Z platformą obronną przy doku da się wyłączyć ewakuację i zaryzykować.

**Nalot bez gracza.** W układzie, w którym gracza nie ma, nalot rozstrzyga
się zaocznie (`economy.resolveRaidOffline`): każda platforma zatrzymuje
dwóch rabusiów, reszta niszczy drony (roje z ewakuacją tracą połowę mniej) i
łupi stacje. Tak samo kończy się nalot, gdy gracz odleci w trakcie. W czasie
misji nalot czeka, bo misje mają własny balans.

**Jak rabusie widzą drony.** Mózg NPC wybiera cele z `world.contacts`, a
pociski trafiają „aktorów” z `combat.js`. Drony i stacje dostały oba
interfejsy (`economy.contacts()`, `combat.register`). Do `createNpcManager`
doszła opcjonalna `getContacts`, dopisywana do świata mózgów. Kroki 5–9 jej
nie przekazują, więc działają bez zmian. Drony mają niską „wartość” (0,35),
więc wrogowie z misji wolą gracza, a tylko rabusie mają priorytet na drony.

**Błąd znaleziony testem:** odlot przez fałdę (`npcs.remove`) zdejmuje statek
z listy, ale nie gasi mu flagi `alive`. Reżyser liczył odlecianych rabusiów
jako obecnych i nalot nigdy się nie kończył. Teraz obecność = `alive` i
obecność na liście.

## Dwa poziomy symulacji

Układ, w którym jest gracz, liczymy dokładnie: każdy dron leci, ląduje i
wierci. Pozostałe układy liczymy **zaocznie**: rój kopie średnią wydajnością
(wiercenie ~45% czasu, reszta to przeloty). Logistyka, sprzedaż, budowy i
produkcja dronów idą tą samą ścieżką kodu co w układzie gracza
(`tickSystem`), więc zasady się nie rozjeżdżają. Po powrocie do układu
drony startują z doku.

## Zapis

Stan gospodarki (kredyty, rynek, ładownia, stacje, roje, wykopane zasoby)
zapisuje się w `localStorage` co 10 s i przy każdej zmianie struktury:
budowa, rozładunek, rozkazy. Klucz: `teegarden-b.ekonomia.v1`. Poszczególne
drony nie są zapisywane, tylko liczność roju. „Nowa gra ekonomiczna” jest na
dole panelu (dwa kliknięcia). W prywatnym oknie zapis może być niedostępny.
Gra działa wtedy normalnie, tylko bez pamięci między sesjami.

## Światło nad pasem

Punktowe światła gwiazd gasną z kwadratem odległości (patrz krok 4), a pas
leży dziesiątki tysięcy jednostek od gwiazd. Bez dodatkowego światła skały i
stacje byłyby czarnymi sylwetkami. Krok dodaje **kierunkowe światło z
najbliższej gwiazdy**, więc strona dzienna i nocna planetoid zgadzają się z
położeniem gwiazdy na niebie. Przy okazji statek gracza dostaje tę samą,
spójną stronę dzienną.

## Pliki

```
shared/data/economy.js            liczby: metale, klasy planetoid, stacje, dron, rynek
shared/systems/asteroid-belt.js   pas planetoid: dane (Node) + siatki, powierzchnia, ślady wydobycia
shared/systems/economy.js         stan, rynek, budowy, logistyka, drony, zapis, symulacja zaoczna
shared/systems/economy-visuals.js stacje (z animacją montażu), drony, iskry, promień, holowniki
shared/systems/economy-panel.js   panel przemysłu (P)
shared/systems/raids.js           rabusie: zagrożenie, ostrzeżenie, nalot NPC, raport, naloty zaoczne
step10-economy/main.js            klej: sterowanie T/Y/P, HUD, światło gwiazdy, kolizje
step10-economy/check.mjs          bezgłowy test całej pętli (Node)
```

## Testy

```bash
npm i three@0.184.0          # raz, katalog wyżej (repo nie ma package.json)
node step10-economy/check.mjs
```

Test przechodzi całą pętlę: deterministyczny pas → kopanie do pełnej
ładowni → magazyn (Y + montaż) → holowniki zaopatrują przeładunek → sprzedaż
i spadek kursu → powrót kursu → dok i 12 dronów → drony lądują na obracających
się skałach (sprawdzana odległość od powierzchni) → rozkazy (złoże,
powrót, wydobycie, rozbiórka) → pełne magazyny (drony czekają, alert) →
zapis i odczyt → praca zaoczna w innym układzie → **rabusie** (prawdziwe
combat, weapons, taktyczne AI): nalot bez ewakuacji niszczy drony i kończy
się raportem; z ewakuacją i platformą rój chowa się przed wejściem rabusiów,
platforma zestrzeliwuje napastników, kupcy płacą nagrodę; nalot zaoczny →
nowa gra.

Test w przeglądarce (`tools/browser-check/check.mjs`, sekcja 3b) sprawdza
to samo w prawdziwej grze: HUD, promień, panel P, budowę z panelu, Y, rój i
nalot (ostrzeżenie, ewakuacja, rabusie z fałdy, koniec nalotu).

## Co dalej

- Misja „obrona kopalni” na tablicy misji (nalot z fabułą i nagrodą).
- Rabusie polujący też na holowniki między stacjami.
- Rafineria: stop z metali (drożej niż surowiec) jako czwarta stacja.
- Frachtowce jako prawdziwe statki NPC przylatujące przez fałdę po towar.
- Handel między układami: różne kursy w różnych układach.
