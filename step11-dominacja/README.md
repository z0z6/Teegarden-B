# Krok 11 — Dominacja: gospodarka jako główna płaszczyzna gry

Od tego kroku gra to **strategia ekonomiczna w duchu RTS-ów**: zbierasz
zasoby, rozbudowujesz infrastrukturę, bogacisz się i budujesz armię, która
obroni twoje kopalnie albo zagarnie cudze. Lot i walka zostają, ale są
**konsekwencją gospodarki**. Siedem ras rywalizuje o przestrzeń surowcową,
a z tej rywalizacji rodzą się żądania, pakty, sojusze i wojny.

Tablica misji otwiera się teraz na **„Dominacji — kampanii”**. Misje z kroku
9 zostają niżej na liście (też uruchamiają krok 11), a „Wolny lot” to
piaskownica gospodarki z kroku 10.

```
step11-dominacja/?uklad=teegarden&statek=goniec-wybudzeni-hawk-7
```

## Pętla gry

1. **Eksploracja.** Każdy układ ma 5 pól surowcowych (`shared/systems/fields.js`),
   w sumie 25 w sektorze. Na starcie znasz tylko pole macierzyste przy punkcie
   startu. Resztę widać jako sygnały „nieznane złoże”, które odkrywasz,
   podlatując na zasięg czujników (ok. 9 tys. j., zależnie od rasy). Pola się
   różnią: pyłowe są ubogie, krzemianowe średnie, a „cmentarzysko
   protoplanety” jest pełne platyny i najbardziej sporne.
2. **Gospodarka** jak w kroku 10: kopanie (T), stacje (P), roje dronów,
   sprzedaż na stacji przeładunkowej, holowniki.
3. **Terytorium.** Pole należy do tego, kto ma na nim stację. Na polu rasy
   nie da się budować, a twoje drony nie kopią tam w czasie pokoju.
   Kopanie promieniem na cudzym polu to kradzież: relacja z tą rasą spada.
4. **Armia.** **Stocznia wojenna** (piąta stacja) buduje eskortowce,
   fregaty i krążowniki z metalu w układzie. Okręty mają rozkazy: eskorta,
   obrona pola albo atak na pole (panel P → Flota, mapa M).
5. **Dominacja.** Kto kontroluje połowę wartości pól sektora, ten wygrywa.
   Po zwycięstwie gra toczy się dalej.

## Rasy jako gracze ekonomiczni (`shared/systems/strategy.js`)

Sześć ras (wszystkie poza rasą gracza) gra tą samą grę, tylko zaocznie:
co 5 s każda zarabia na swoich polach (poziom placówki × wartość pola),
płaci utrzymanie floty i decyduje:

- **Ekspansja.** Zakłada placówkę na wolnym polu (70 s), chętniej w
  układach, w których już jest. Limit pól rasy rośnie co 8 minut, żeby na
  starcie zostało miejsce dla gracza.
- **Rozbudowa** placówek do poziomu 5 i **flota**. Rasa zbroi się tym
  bardziej, im jest agresywniejsza i im groźniejszych ma wrogów.
- **Wojna.** Relacje (−100…100) startują z kart ras i same spadają, gdy
  rasy dzielą układ. Chciwe rasy tracą cierpliwość szybciej. Wspólny wróg
  zbliża. Poniżej −50 agresywna i dość silna rasa wypowiada wojnę i atakuje
  pola wroga: najbogatsze i najsłabiej bronione. Przegrywająca strona prosi
  o pokój.
- **Dyplomacja wobec gracza.** Silna i chciwa rasa, z którą dzielisz układ,
  żąda haraczu za prawo wydobycia. Rasa, która cię lubi, proponuje pakt, a
  przy wspólnym wrogu sojusz. Propozycje przychodzą przez komunikator
  z portretem rozmówcy (Z / X). Brak odpowiedzi przez 60 s liczy się jako
  odmowa.
- **Okres ochronny.** Przez pierwsze 10 minut żadna rasa nie wypowie
  graczowi wojny.

Temperament ras bierze się z kart (tactical-ai.js: agresja, ostrożność).
Ze stronnictwa rządzącego (agresywne rasy to „jastrzębie”, pozostałe
„handlowcy”) wynikają nazwy i portrety w dyplomacji.

## Rywale w układzie (`shared/systems/rival-presence.js`)

Na każdym odkrytym polu rasy stoi **placówka**. Ma tyle stacji, ile
poziomów: dok, magazyn, wieża, przeładunek, druga wieża, wszystkie w kolorze
rasy. Jej **rój dronów** kopie na tamtejszych skałach. Zbliżenie się do
cudzego pola kończy się komunikatem od rasy, a jego ton zależy od relacji.

- **Pokój.** Placówka jest neutralna: twoje pociski jej nie trafiają
  (`combat.js`: strona neutralna).
- **Wojna.** Te same stacje i drony stają się wrogie. Wieże strzelają do
  ciebie, twoich dronów i floty, a przy placówce krążą patrole rasy (NPC
  z taktycznym AI). Każda zniszczona stacja obniża poziom pola.
  Poziom 0 oznacza, że pole jest wolne i możesz na nim budować.

## Armia gracza (`shared/systems/army.js`)

| Okręt | Siła | Kadłub | Koszt | Utrzymanie |
|---|---|---|---|---|
| Eskortowiec | 1 | 160 | 700 kr · 60 Fe · 20 Ni | 18 kr/min |
| Fregata | 3 | 420 | 1800 kr · 160 Fe · 60 Ni · 15 Co | 48 kr/min |
| Krążownik | 6 | 900 | 4200 kr · 320 Fe · 120 Ni · 40 Co · 8 Pt | 108 kr/min |

W twoim układzie okręty są prawdziwymi sojuszniczymi NPC z modelem statku
twojej rasy. Walczą z napastnikami, patrolami i placówkami. W innych
układach liczą się jako **siła**: wzmacniają obronę twoich pól (zaoczne
rozstrzygnięcia ataków) i oblegają pole z rozkazem „atak”. Co 40 s dochodzi
do starcia siły floty z obroną pola: zwycięstwo niszczy dwa poziomy
placówki, a straty obu stron zależą od siły przeciwnika. Eskorta leci
z graczem przez skoki międzygwiezdne, reszta zostaje. Stocznia naprawia
kadłuby okrętów w swoim układzie.

## Ataki ras na gracza

Rasa w stanie wojny wysyła okręty na twoje pole (`raids.js`, ta sama
mechanika co naloty z kroku 10). W twoim układzie jest 15 s ostrzeżenia
(roje z ewakuacją chowają się w dokach), potem okręty wojenne tej rasy
wychodzą z fałdy. Zniszczone okręty obniżają jej flotę w strategii.
Gdzie indziej atak rozstrzyga się zaocznie: platformy obronne i twoja flota
w tym układzie kontra napastnicy. Piraci nadal się zdarzają, ale rzadziej.

## Oprawa

- **Mapa strategiczna (M).**
  - Karta Sektor: mapa wybranego układu (pola w kolorach właścicieli, aura
    wpływu rośnie z poziomem, przerywana aura oznacza wroga, pulsujący
    pierścień oblężenie), twój statek i flota, ranking dominacji
    z portretami. Klik w pole pokazuje wartość (★), właściciela, obronę
    i akcje: kurs (znacznik celu na ekranie), skok do układu, wysłanie floty.
  - Karta Dyplomacja: karty ras z dużym portretem, stronnictwem, cechami
    (agresywni, chciwi…), stanem stosunków, miernikiem relacji, polami,
    flotą i akcjami (wojna, pokój, pakt, sojusz, dar 1000 kr, haracz).
  - Karta Kronika: wieści z sektora z portretami ras.
- **Portrety.** Załoga ma twarze twojej rasy (różne osobniki na różne
  role), a rozmówcy z innych ras mają portrety swojego stronnictwa. Wszystko
  to proceduralne SVG z `race-portraits.js`.
- **Ikony** (`shared/ui/icons.js`): metale jako sztabka i kryształy,
  sylwetki stacji, okręty trzech klas, dron, kredyty, pole, symbole
  dyplomacji. Są wektorowe, generowane w kodzie.
- **Miniatury okrętów** w stoczni: prawdziwe rendery modeli twojej rasy
  (`shared/ships/models/thumbs/`).

## Misja „Obrona kopalni”

Ósma misja na tablicy (`shared/systems/missions.js`, `obrona`). Łączy walkę
z gospodarką. Przy polu macierzystym powstaje **kopalnia kontraktowa**: dok,
skład z 636 t metalu i rój 16 dronów, który nie może się ewakuować (kontrakt
dostaw). Na konto wpływa zaliczka 1500 kr, np. na platformę obronną. Po 35 s
nadchodzą trzy fale napastników (3, 4 i 5 okrętów, w ostatniej ciężki), za
każdym razem z innej strony. Polują na drony i łupią skład.

- **Wygrana:** trzy fale odparte, strata najwyżej 8 dronów. Premia 60 kr za
  każdego ocalałego drona i 12 ładunku.
- **Przegrana:** 9 straconych dronów albo 350 t zrabowane ze składu (albo
  utrata statku).

Kopalnia kontraktowa jest **tymczasowa**. Stacje i rój mają znacznik `temp`,
nie trafiają do zapisu kampanii (`economy.save` je pomija) i znikają
10 s po wyniku albo przy przerwaniu misji (`economy.removeTemp`,
`ctx.cleanup` w missions.js). Misja wymaga gospodarki (`getEconomy`), więc
w kroku 9 kończy się od razu z wyjaśnieniem. Z tablicy uruchamia się
w kroku 11. W trakcie misji naloty i ataki ras czekają.

Test: `check.mjs`, sekcja 9. Obejmuje krok bez gospodarki, kopalnię poza
zapisem, przygotowanie przed pierwszą falą, przegraną bez obrony, sprzątanie
i wygraną z platformami obronnymi.

## Sterowanie (zmiany względem kroku 10)

| Klawisz | Akcja |
|---|---|
| **M** | mapa strategiczna (wcześniej lista układów) |
| **P** | przemysł; zakładka **Flota**: stocznia i rozkazy okrętów |
| **Z / X** | odpowiedź na propozycję rasy w komunikatorze |

## Zapis

Każda rasa ma osobną kampanię: `teegarden-b.dominacja.v1.<rasa>`
w `localStorage`. Zapis obejmuje gospodarkę, strategię (pola, relacje,
floty ras, kronikę) i armię. Zapis piaskownicy z kroku 10 jest osobny.

## Pliki

```
shared/systems/fields.js          pola surowcowe: 5 na układ, charakter, wartość, sygnały
shared/systems/strategy.js        rasy jako gracze ekonomiczni, relacje, wojny, dyplomacja, oblężenia
shared/systems/rival-presence.js  placówki i roje ras w układzie gracza, wieże, patrole
shared/systems/army.js            stocznia, okręty gracza, rozkazy, oblężenia zaoczne
shared/systems/army-panel.js      zakładka Flota panelu P
shared/systems/strategic-map.js   mapa strategiczna: sektor, dyplomacja, kronika
shared/ui/icons.js                ikony SVG
shared/systems/economy.js         + wiele pól na układ, odkrywanie, haki strategii (canBuildAt, canMineField)
shared/systems/raids.js           + ataki ras (launch), piraci rzadziej
shared/systems/star-systems.js    + spawnOf(): punkt startu bez budowania sceny
shared/systems/npc-ships.js       + getContacts (z kroku 10)
shared/systems/dashboard.js       + portrety w awatarach załogi
step11-dominacja/check.mjs        bezgłowy test całej warstwy strategicznej
```

## Testy

```bash
npm i three@0.184.0          # raz, katalog wyżej (repo nie ma package.json)
node step11-dominacja/check.mjs
```

1. 25 deterministycznych pól o różnej wartości, najdalsze ok. 38 tys. j. od
   startu.
2. Eksploracja: na starcie znane tylko pole macierzyste, czujniki odkrywają
   kolejne, id skał są unikalne.
3. 40 minut strategii: ekspansja, rozbudowa, floty, wojny, kronika. Po
   10 minutach zostają wolne pola dla gracza.
4. Dyplomacja: dar, pakt po zbudowaniu zaufania, odmowy (sojusz bez paktu,
   haracz od silniejszych), zapłata żądania.
5. Wojna w układzie gracza: placówka neutralna w pokoju i wroga w wojnie,
   blokada budowy, patrole, rozbicie placówki zwalnia pole, a gracz je
   przejmuje.
6. Stocznia (koszt z puli metalu), okręty jako NPC, rozkaz ataku wymaga
   wojny, oblężenie zaoczne zdobywa pole.
7. Rasa w wojnie atakuje pole gracza: ostrzeżenie, okręty tej rasy
   z fałdy, rozstrzygnięcie; atak w innym układzie liczony zaocznie.
8. Zwycięstwo przy 50% wartości sektora; strategia i armia w zapisie.

Test w przeglądarce (`tools/browser-check/check.mjs`, sekcja 3c) sprawdza
kampanię jako domyślną na tablicy, odkrywanie pola, mapę strategiczną,
dyplomację z portretami, wojnę z rozbiciem placówki i stocznię z okrętem
w układzie.

## Co dalej

- Handel między rasami (kursy metali zależne od układu, kontrakty dostaw).
- Rasy odbudowujące placówki po stracie pola i kontrataki na zdobyte pola.
- Misja „obrona kopalni” i fabularne kampanie ras.
- Więcej układów z `galaxy.js` jako kolejne obszary eksploracji.
