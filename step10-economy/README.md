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
| **P** | panel przemysłu: budowa, stacje, roje, rynek (Esc zamyka) |

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
zapis i odczyt → praca zaoczna w innym układzie → nowa gra.

Test w przeglądarce (`tools/browser-check/check.mjs`, sekcja 3b) sprawdza
to samo w prawdziwej grze: HUD, promień, panel P, budowę z panelu, Y i rój.

## Co dalej

- Rabusie polujący na drony i konwoje holowników (misja „obrona kopalni”).
- Rafineria: stop z metali (drożej niż surowiec) jako czwarta stacja.
- Frachtowce jako prawdziwe statki NPC przylatujące przez fałdę po towar.
- Handel między układami: różne kursy w różnych układach.
