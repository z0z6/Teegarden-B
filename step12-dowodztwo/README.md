# Krok 12 — Dowództwo: mostek siedziby rasy

Od tego kroku gra zaczyna się **na mostku siedziby** twojej rasy, a nie
w kokpicie. Na okładce wybierasz układ, klikasz „Graj” i po krótkim
najeździe kamery patrzysz **z głębi zatoki hangaru** siedziby: ściany
z żebrami konstrukcji, lampy, kontenery, pas startowy ze światłami
prowadzącymi, a przez wylot hangaru — pas planetoid pola macierzystego,
po prawej huta, po lewej reaktor. Drony startują z zatoki i wylatują
przez wylot.

```
step12-dowodztwo/?uklad=teegarden&statek=goniec-wybudzeni-hawk-7
```

Rasę wyznacza statek, podobnie jak w krokach 9–11. Rasę wybierasz na
okładce („Rasa: …”); okładka podaje wtedy pierwszy statek tej rasy (albo
statek z tablicy misji, jeśli należy do wybranej rasy). Bez wyboru działa
jak dotąd: statek wybrany ostatnio na tablicy misji, a gdy go nie ma,
pierwszy z floty. Misja uruchomiona z tablicy (`&misja=...`)
startuje od razu w locie.

## Tryby gry

| Tryb | Co widać | Jak wejść |
|---|---|---|
| **mostek** | widok przez szybę siedziby i panel gracza; statek stoi w hangarze | start gry, `Tab` z lotu, „Wróć na mostek” |
| **lot** | kamera za myśliwcem, HUD lotu z kroków 5–11 | „Za sterami”, decyzja „Za stery” przy ataku, `Tab` na mostku |
| **podgląd** | kamera krąży nad bitwą albo wyprawą, gracz ogląda starcie zdalnie | „Poślij flotę” / „Obserwuj” w decyzji, oko przy wyprawie, „Obserwuj flotę” |

Wylot z hangaru naprawia i dozbraja myśliwiec. Przy wylocie działają też
ulepszenia myśliwca (osłony i działa). Powrót na mostek z innego układu
przenosi statek do siedziby.

## Pętla dowodzenia (`shared/systems/command.js`)

1. **Hangar** siedziby buduje drony z metalu w składzie. Są cztery typy
   (`shared/data/command.js`, `DRONE_TYPES`):
   - **zwiadowca** — szybki, bada skały i odkrywa nieznane pola,
   - **górnik** — wierci zbadane skały i przywozi urobek,
   - **holownik** (po badaniu) — ładownia na 40 t,
   - **strażnik** (po badaniu) — pilnuje skały i strzela do napastników.
2. **Wyprawa** (rozkazy po lewej: wybór celu i liczby dronów) ma takie fazy:

   ```
   wylot → przelot (w skrócie) → dolot → praca → [pełne: decyzja] → odlot → powrót (w skrócie) → podejście do huty → rozładunek
   ```

   Wylot z hangaru widać przez szybę. Gdy drony znikną z kadru, otwiera się
   **okienko podglądu** z ujęciem z zewnątrz stacji: drony wylatują
   z hangaru i mijają kamerę. Potem ujęcie przy skale pokazuje, jak
   dolatują. Okienko się zamyka, a kwatermistrz melduje „drony na
   miejscu”. Powrót działa odwrotnie: odlot od skały, przylot pod hutę
   z daleka, a na końcu podejście do huty już przez szybę mostka.
   Przelot jest celowo skrócony do kilku sekund, zamiast minut lotu.
3. **Huta** przetapia urobek na metal do składu siedziby (ten skład jest
   pulą metalu gospodarki, tak jak magazyny). Odzysk zależy od nauki: na
   starcie żelazo 92%, nikiel 70%, a kobalt i platyna idą na hałdę.
   Flotacja, ługowanie i rafinacja otwierają kolejne metale.
4. **Zasilanie.** Siedziba daje 40 MW, każdy reaktor 45 MW. Stacje pobierają
   prąd (huta 14 MW, stocznia 12 MW, dok 8 MW…). Przy niedoborze stacje
   pracują wolniej (hook `economy.hooks.efficiency`): wolniej budują, wytapiają,
   sprzedają i strzelają. Po badaniu „Ogniwa autonomiczne” każda stacja może
   dostać własne zasilanie i wtedy nie zależy od sieci, także w innych
   układach.
5. **Ulepszenia** (`UPGRADES`) kosztują kredyty i metal, a koszt rośnie
   z poziomem. Dotyczą napędu, ładowni, wierteł i pancerza dronów, hangaru,
   pieców i separatorów huty, rdzeni reaktorów, kadłubów i dział floty
   (mnożniki w `army.js`) oraz osłon i dział twojego myśliwca.
6. **Nauka** (`TECHS`) prowadzi jedno badanie naraz i zużywa prąd laboratoriów.
   Po odkryciu wyskakuje karta w stylu „Nasi naukowcy odkryli właśnie…”, a gdy
   ma to sens, z gotową akcją („Zbuduj 3 holowniki”). Autonomia rojów
   sprawia, że wyprawy same wracają i same ruszają na kolejny kurs.

Z mostka budujesz też stacje (zakładka Moduły): hutę, reaktor, magazyn,
dok, platformę obronną, stocznię i przeładunek. Każda staje w wolnym
miejscu przy siedzibie (`economy.findSpot`), a holowniki same dowożą
metal ze składu. Klasyczne roje doków, rynek i stocznia zostają w panelu
„Przemysł”.

## Garnizon i flota na widoku

Kampania zaczyna się z **garnizonem siedziby**: trzy eskortowce (najprostsza
klasa okrętu) od pierwszej minuty bronią pola macierzystego
(`army.grantGarrison`). Garnizon dostaje się raz na kampanię. Flaga leży
w zapisie, więc starsze kampanie też go dostały przy pierwszym wczytaniu.
Utrzymanie garnizonu pokrywa siedziba, więc nie zjada kredytów na starcie.
Okręty zbudowane później kosztują utrzymanie jak dotąd.

Flota nie jest już schowana w piątej zakładce:
- **blok „Flota” pod rozkazami** (zawsze na widoku): liczba okrętów, siła,
  kadłuby, przyciski *Broń bazy*, *Obserwuj* i *Buduj okręty*,
- **okręty na górnym pasku** (klik otwiera zakładkę Flota),
- **zakładka Flota** jest wyróżniona kolorem i licznikiem. Buduje się w niej
  okręty prosto z mostka (trzy klasy, koszt, kolejka z postępem) i zmienia
  rozkazy okrętów. Gdy nie ma stoczni, zakładka pokazuje przycisk
  *Postaw stocznię*.

## Start gry i menu (Esc)

**Włączenie gry zaczyna nową kampanię od stanu początkowego.** Autozapis
nadal robi się co kilka sekund, ale przy starcie nie jest wczytywany. Trafia
na listę zapisów jako **„Ostatnia gra — rasa (autozapis)”**, więc do
poprzedniej sesji można wrócić przez *Wczytaj grę*. Każde włączenie gry
nadpisuje ten wpis, a sesje krótsze niż 20 s się nie liczą. Do dalszej gry
wraca się tylko przez wczytanie zapisu: strona przeładowuje się wtedy
z `?wczytaj=1` i od razu usuwa ten parametr z adresu, więc odświeżenie
strony znów zaczyna nową grę.

**Esc** otwiera **menu gry**, a gra na ten czas staje (pauza):

- **Wróć do gry** (albo Esc jeszcze raz),
- **Zapisz grę** — od razu nowy zapis z nazwą (rasa, układ, data),
- **Wczytaj grę…** — lista zapisów (poniżej),
- **Porzuć grę** — po drugim kliknięciu („Na pewno?”) powrót na okładkę
  bez zapisywania.

Esc najpierw zamyka to, co jest otwarte: mapę taktyczną (albo stawianie
wieży), panel przemysłu, mapę sektora, dziennik, okno zapisów. Dopiero
kolejne Esc otwiera menu. Na mostku menu otwiera też przycisk **Menu**
(górny pasek, na telefonie dolny), a w locie przycisk **☰** obok dziennika.

## Zapis i wczytanie gry (`shared/systems/save-slots.js`, `save-panel.js`)

Autozapis zapisuje bieżący stan kampanii rasy co kilka sekund (i trafia do
„Ostatniej gry” przy następnym włączeniu). *Wczytaj grę…* w menu (Esc)
otwiera okno z własnymi zapisami:

- **Zapisz** tworzy nowy zapis z nazwą (domyślnie rasa, układ i data),
- **Wczytaj** podmienia autozapis na stan z zapisu i przeładowuje grę
  z adresem tego zapisu (układ siedziby i statek, czyli rasa). Wczytać można
  także zapis innej rasy,
- **Nadpisz**, **Usuń**,
- **Pobierz** i **Wczytaj z pliku…** działają na pliku `.json`, np. żeby
  przenieść kampanię z komputera na telefon,
- **Nowa gra** zaczyna kampanię tej rasy od zera (to samo robi każde
  włączenie gry).

Wczytanie, nadpisanie, usunięcie i nowa gra wymagają drugiego kliknięcia
(„Na pewno?”). Nie ma okien `confirm()`, bo na telefonie wyrzucają z pełnego
ekranu. **Ctrl+S** robi szybki zapis (slot „Szybki zapis”). Na czas
wczytywania autozapis jest zamrożony, żeby nie nadpisał podmienionego stanu
tuż przed przeładowaniem.

## Telefon: tryb kompaktowy

Na małym ekranie (wysokość do 560 px albo szerokość do 760 px, czyli telefon
w poziomie) strona dostaje klasę `body.ui-compact`. Adres `?ui=kompakt` albo
`?ui=pelny` wymusza tryb.

- **Mostek**: zasoby w jednym wąskim pasku u góry. Na dole jest **pasek
  nawigacji** (Rozkazy · Wyprawy · Baza · Flota · Mapa · Przemysł · Zapis ·
  Za sterami). Naraz otwarty jest najwyżej **jeden arkusz** po prawej.
  Ponowne dotknięcie chowa go i odsłania widok z mostka. Po wysłaniu
  wyprawy arkusz sam się zamyka, żeby było widać wylot dronów.
- **Decyzje**: jedna karta naraz (reszta czeka, „+N czeka”), zwarta, tekst
  do trzech linii.
- **Meldunki załogi**: jeden naraz na mostku, dwa w locie, każdy do dwóch
  linii. Dotknięcie chowa kartę.
- **Dziennik** (dymek obok głośnika, z licznikiem nowych): pełna lista
  ostatnich meldunków, także tych, które nie zmieściły się na ekranie. Na
  komputerze też działa.
- **Komunikator**: dotknięcie zamyka komunikat bez wyboru.

## Wieże strażnicze i mapa taktyczna (`shared/systems/tactical-map.js`)

**Wieża strażnicza** to autonomiczny dron obronny, piąty typ w hangarze. Na
start są dwie. Ma lekkie działko (szybki ogień) i rakiety z naprowadzaniem
(rzadko, mocno, wybuch obszarowy). Nie lata na wyprawy: rozstawia się ją
w dowolnym punkcie układu siedziby na **mapie taktycznej** („Mapa taktyczna”
na górze rozkazów, rozkaz „Rozstaw wieże”, a na telefonie przycisk
*Taktyka* w dolnym pasku).

- **Postaw wieżę**, potem dotknij mapy: wieża wylatuje z hangaru na to
  miejsce. Podczas wybierania okrąg zasięgu idzie za kursorem albo palcem.
- **Okrąg** wokół wieży (na mapie i w 3D, płaski pierścień pod wieżą) to
  zasięg skutecznej osłony, domyślnie 1900 j. Wrogów w nim wieża
  ostrzeliwuje. Górnicy i zwiadowcy pracujący w okręgu giną dużo wolniej
  (każda wieża: −70% strat).
- Wieżę na mapie można **przeciągnąć**: przelatuje na nowe miejsce.
  *Wycofaj* odsyła ją do hangaru.
- Wieża może zostać zestrzelona, bo wrogowie widzą ją jako cel. Na pozycji
  sama się naprawia, gdy nikt do niej nie strzela.
- Ulepszenie **Uzbrojenie wież** daje +20% obrażeń i +10% zasięgu na poziom.

Mapa pokazuje układ z góry: siedzibę na dole i jej wylot w górę, jak widok
z mostka. Widać na niej pola (nieznane jako „?”), skały (kolor = klasa,
przerywana obwódka = niezbadana), stacje, frachtowiec, wyprawy w locie
i wrogów. Kółko myszy albo `+`/`−` przybliża, `⌂` wraca do okolic siedziby,
`⤢` pokazuje cały układ. Przeciąganie tła przesuwa mapę.

## Sektory: ile dronów w którym polu

Zakładka **Sektory** mapy taktycznej ma dla każdego pola liczniki
**Zwiadowca / Górnik / Holownik** z przyciskami −/+. To stały przydział:
zarządca (`command.js updateAlloc`) sam wysyła drony z hangaru, rozkłada
grupy po najmniej obłożonych skałach, dosyła po powrocie i odwołuje
nadmiar. Przy zmniejszeniu przydziału część grupy odłącza się i wraca.
Wyprawy z przydziału nie pytają o nic, więc nie ma dla nich kart decyzji.

- Zwiadowcy lecą na nieznane pole, a potem na niezbadane skały. Gdy
  wszystko jest zbadane, wracają i przydział sam się zeruje.
- Górnicy bez zbadanych skał czekają, a kwatermistrz podpowiada
  „przydziel zwiadowców”.
- Każde pole ma własną trasę urobku (Huta / Magazyn / Frachtowiec) oraz
  licznik wież, które je osłaniają.
- Alarm („Zaalarmuj wszystkich”) wstrzymuje dosyłanie.

Na start hangar ma **12 górników** (było 6). Starsze kampanie dostają raz
+6 górników i 2 wieże przy pierwszym wczytaniu.

## Logistyka urobku: decyzja uruchamia automatykę

Przy wysłaniu górników wyskakuje karta **„Dokąd urobek?”**:

| Trasa | Co się dzieje dalej, samo |
|---|---|
| **Huta** | urobek od razu do pieca. Gdy w kolejce jest ponad 900 t, karta „Huta nie nadąża” z przyciskami *Ulepsz piece* / *Nowy urobek do magazynu* / *…na frachtowiec* |
| **Magazyn** | urobek do magazynu, a huta sama dobiera z magazynów, gdy ma wolne moce. Bez magazynu wyskakuje karta z gotowym *Zbuduj magazyn* (urobek idzie tymczasem do huty). **Magazyn pełny (95%)**: frachtowiec sam go opróżnia do połowy i sprzedaje urobek, a karta proponuje **Wielki magazyn** (nowa stacja, 2400 t urobku, 6000 t metalu) jednym kliknięciem |
| **Frachtowiec** | urobek na frachtowiec przy siedzibie. Frachtowiec odlatuje, gdy ma pełną ładownię (400 t) albo dłużej nic nie dostaje, po czym sprzedaje urobek poza układem (55% wartości czystego metalu) i wraca. Gdy nie nadąża, karta *Kup frachtowiec* / *Urobek do huty* |

Wybór w karcie staje się trasą domyślną. „Zawsze: …” wyłącza pytanie.
Zakładka **Logistyka** pokazuje trasę domyślną i przełącznik pytania,
kolejkę huty, zapełnienie magazynów (z budową magazynów), frachtowce
(z dokupieniem kolejnego, najwyżej 4) i przydziały do pól.

## Giełda (`shared/systems/exchange.js`)

Zakładka **Giełda** wymienia dowolny zasób na inny: kredyty, żelazo,
nikiel, kobalt, platynę oraz urobek (urobek tylko na sprzedaż). Wymiana
idzie przez kredyty po kursie rynku z kroku 10:

- sprzedaż: kurs × (1 − prowizja). Prowizja wynosi 8%, a z własnym
  terminalem (stacja przeładunkowa przy siedzibie) 3%,
- kupno metalu: kurs × 1,1,
- sprzedaż metalu obniża jego kurs, a kupno podnosi (duże wymiany psują
  sobie kurs),
- urobek wyceniany jest na połowę wartości metali, które w nim są,
- giełda nie sprzeda metalu, którego nie ma gdzie złożyć (miejsce w składzie
  siedziby i magazynach).

Wybierasz *Oddaję*, *Dostaję* i ilość (10 / 50 / 100 / 500, ½, wszystko),
a wycena z kursem i prowizją widać przed kliknięciem **Wymień**. Pod spodem
jest tabela kursów kupna, sprzedaży i trendu rynku.

## Decyzje zamiast klawiszologii (`shared/systems/decisions.js`)

Karty wyskakują same. Każda ma 1–3 proste przyciski i czasem
„Zarządzaj ▾”, które rozwija drugi rząd opcji. Pasek na dole karty
odlicza czas. Gdy nikt nie kliknie, zadziała bezpieczny wybór domyślny,
więc gra toczy się sama, a gracz tylko koryguje. Najechanie myszą
wstrzymuje odliczanie.

| Karta | Wybory | Zarządzaj ▾ | Domyślnie |
|---|---|---|---|
| Ładownie pełne | Tak · Tak, i wracajcie na złoże · Nie | Odwołaj, Poślij na inną skałę, Przywołaj ochronę, Zaalarmuj pozostałych | powrót |
| Raport zwiadu | Tak (wyślij górników) · Nie | Poślij wszystkich górników, Poślij holowniki | nic |
| Wyprawa pod ostrzałem | Odwołaj · Zostań | Przywołaj ochronę, Zaalarmuj pozostałych, Poślij flotę | odwołanie |
| Nalot / atak rasy | Poślij flotę (albo Obserwuj) · Za stery | Odwołaj drony, Przywołaj ochronę, Zaalarmuj pozostałych | flota broni pola / drony wracają |
| Odkrycie naukowców | Świetnie (czasem gotowa akcja) | — | — |

Na mostku nie potrzeba ani jednego klawisza. W locie ściąga sterowania
jest krótsza niż w kroku 11: celowanie i ciąg, dopalacz, ogień, kopanie,
skok, mapa i `Tab` na mostek. Starsze skróty (wataha, sceny) nadal działają,
ale nie ma ich na ściądze.

## Walka jako wybór

Gdy przy stacjach pojawią się wrogie statki, wyskakuje karta:
- **Poślij flotę**: okręty w układzie dostają rozkaz obrony pola
  macierzystego, a kamera przechodzi w **podgląd zdalny** i krąży nad
  środkiem walki. Z podglądu możesz wrócić na mostek albo przejąć stery.
- **Za stery**: wylot myśliwcem z hangaru. To ten sam tryb lotu i walki,
  który powstawał od kroku 1.
- **Przywołaj ochronę**: strażnicy z hangaru lecą pilnować pola.
  Strzelają do napastników, a każdy z nich zmniejsza straty wypraw.

Wyprawy pod ostrzałem tracą drony (pancerz dronów i strażnicy spowalniają
straty), a pierwsze trafienie otwiera kartę z wyborem.

## Pliki

| Plik | Co robi |
|---|---|
| `shared/data/command.js` | liczby: rozstawienie siedziby, typy dronów, czasy faz, zasilanie, huta, ulepszenia, nauka |
| `shared/systems/command.js` | logika: siedziba, hangar, wyprawy, zagrożenia, huta, energia, nauka, ulepszenia (działa w Node) |
| `shared/systems/command-view.js` | kamera mostka i najazd, drony wypraw w 3D, okienko podglądu (drugi render w prostokącie), podgląd zdalny |
| `shared/systems/command-panel.js` | panel gracza: zasoby, rozkazy, wyprawy, Hangar / Moduły / Ulepszenia / Nauka / Flota |
| `shared/systems/decisions.js` | karty decyzji |
| `shared/systems/economy-visuals.js` | modele siedziby (mostek, pokład hangaru z pasem świateł, pierścień), huty i reaktora |
| `shared/systems/economy.js` | nowe typy stacji, skład siedziby w puli, `findSpot` / `placeNear`, hook zasilania |
| `shared/systems/army.js` | `mods` — mnożniki siły i kadłuba floty z ulepszeń, `grantGarrison` — garnizon siedziby |
| `shared/systems/save-slots.js` | nazwane zapisy w localStorage, wczytanie (podmiana autozapisu), eksport / import pliku |
| `shared/systems/save-panel.js` | okno zapisu gry |
| `shared/systems/dashboard.js` | meldunki załogi, limit kart naraz, dziennik |
| `shared/systems/tactical-map.js` | mapa taktyczna: wieże (stawianie, przeciąganie, okręgi zasięgu), przydział dronów do pól |
| `shared/systems/exchange.js` | giełda: wycena i wymiana zasobów |

Zapis kampanii kroku 12 jest osobny od kroku 11
(`teegarden-b.dowodztwo.v1.<rasa>`). Stan dowództwa (hangar, wyprawy,
urobek, nauka, ulepszenia) jest częścią zapisu gospodarki
(`economy.state.command`).

## Powierzchnie bez tekstur (`shared/systems/surface-detail.js`)

Realizm bez plików graficznych i bez szwów UV: szum liczony w shaderze
z pozycji w układzie obiektu (patch `onBeforeCompile`).

- **Planetoidy i gruz**: spękania, kratery, pył w zagłębieniach,
  mineralne przebarwienia, zmienna szorstkość, relief z pochodnych
  wysokości. Siatka planetoidy ma teraz scalone wierzchołki (wcześniej
  każdy trójkąt miał własne i normalne wychodziły płaskie — „low-poly”).
- **Stacje**: płyty poszycia ze szczelinami i nitami, zabrudzenia,
  zacieki, zarysowania, przypalenia. Drobne wzory gasną z odległością
  (`fwidth`), więc z daleka nie ma „śniegu”.
- **Statki**: przybrudzenia, zadrapania i sadza, wpięte w shader fałdy
  (`warp-drive.js`), więc wszystkie statki dzielą jeden program GPU.

Koszt: kilka oktaw szumu na piksel tylko na tych obiektach, jeden program
GPU na tryb. Na telefonach (`setSurfaceQuality`) jest mniej oktaw i nie ma
nitów. Zatoka hangaru nie ma ścianek leżących w jednej płaszczyźnie
(to one migały na krawędziach pasa), a linie pasa wiszą nad podłogą.

## Testy

```
node step12-dowodztwo/check.mjs
```

Test sprawdza siedzibę zwróconą do pasa, zasilanie i niedobór prądu,
ogniwa, pełny cykl zwiadu (fazy, „skrót”, odkrycie pola, raport
i decyzję), górników (pełne ładownie, decyzję, hutę i odzysk), naukę
(wymagania i odkrycia), ulepszenia (koszt, limit, mnożniki floty),
autonomię rojów, wyprawę pod ostrzałem, budowę z mostka i zapis, garnizon
(3 okręty, obrona pola, bez utrzymania, raz na kampanię) oraz zapisy gry
(sloty, wczytanie, nadpisanie, eksport / import, brak miejsca), a od 12b
także start z 12 górnikami i wieżami (z dodatkiem dla starych zapisów),
wieże (rozstawienie, zasięg, ogień działka i rakiet, osłona wypraw,
przestawienie, wycofanie), przydział do pól (wysyłka, zmniejszenie,
zwiad nieznanego pola), trasy urobku z automatyką (magazyn → huta, pełny
magazyn → frachtowiec + karta, huta nie nadąża, drugi frachtowiec)
i giełdę.
W przeglądarce: `node tools/browser-check/check.mjs`, sekcje „3d”, „3e”
(garnizon, zapis → wczytanie z przeładowaniem, telefon 844×390) i „3f”
(mapa taktyczna: stawianie i przeciąganie wieży, sektory, karta trasy,
giełda) oraz „3g” (nowa gra przy starcie, „Ostatnia gra” na liście, menu
Esc, pauza, porzucenie).
