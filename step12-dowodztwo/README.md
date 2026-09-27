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

## Grupy bojowe i operacje (krok 12c, `shared/systems/fleet-ops.js`)

Okręty łączą się w **grupy bojowe**. Grupa dostaje misję i prowadzi ją
sama: „daj rozkaz i zapomnij”. Rozkazy wydaje się w zakładce **Operacje**
(obok Floty; na telefonie pod przyciskiem *Flota* w dolnym pasku).

```
przelot (fałda) → zbiórka (godzina H) → akcja → powrót → raport → obrona bazy
```

| Misja | Co robi grupa | Cel |
|---|---|---|
| **Obrona pola** | trzyma szyk przy polu, odpowiada na wezwania wsparcia | twoje pole |
| **Patrol** | krąży między twoimi polami w układzie, przechwytuje intruzów | twoje pole |
| **Zwiad** | przelot, obserwacja, powrót; unika walki, nie wywołuje wojny | dowolne pole |
| **Uderzenie na infrastrukturę** | rajd na wybrane stacje placówki, potem odwrót | pole rasy |
| **Zdobycie pola** | rozbija całą placówkę, pole staje się wolne | pole rasy |

**Cele uderzenia** (`STRIKE_TARGETS` w `shared/data/military.js`):

- **wieże** osłabiają obronę pola o 60% na 4 min, co ułatwia późniejszy szturm (wieże ma placówka od poziomu 3),
- **doki i przeładunek** dają polu połowę dochodu przez 5 min, a rasa traci kredyty,
- **drony** to szybki rajd o małym ryzyku.

Uderzenie na rasę, z którą nie ma wojny, wymaga potwierdzenia drugim
kliknięciem i jest wypowiedzeniem wojny.

**Szyki** (`FORMATIONS`) działają na żywo i zaocznie:

| Szyk | Postawa | Na żywo | Zaocznie |
|---|---|---|---|
| Klin | natarcie | lot w V do kontaktu, potem walka | atak ×1,15 |
| Linia | natarcie | wszystkie lufy do przodu | ×1,1, stacje ×1,25 |
| Kleszcze | natarcie | skrzydła wychodzą na flanki celu (od 4 okr.) | ×1,2 |
| Kolumna | przelot | ogień tylko okazyjny | przelot o 20% krótszy |
| Jeż | obrona | kula wokół pola, ogień ze slotów | obrona ×1,3 |
| Ściana | obrona | płaszczyzna obrócona frontem do wroga | obrona ×1,2 |

**Zasady użycia siły** (ROE):

- **agresywna** walczy do wykonania zadania,
- **zrównoważona** wycofuje się po utracie połowy siły,
- **ostrożna** wycofuje się wcześnie. Ranne okręty chowają się w szyku, a w starciu zaocznym grupa zrywa kontakt, zanim padnie.

Szyk i ROE można zmienić grupie w locie.

**Operacja skoordynowana.** Zaznacz kilka grup (albo grupę i wolne
okręty). Szybsze grupy czekają na zbiórce na ostatnią. O godzinie H
wszystkie ruszają naraz i podchodzą do celu z różnych stron. Zaocznie
siły się sumują, a każda kolejna grupa daje +10% (najwyżej +20%).

**Łączność** (`tactical-ai.js`, baza `'fleet'`):

- Wszystkie okręty gracza, także garnizon, są w sieci **`flota`**. Cel widziany przez jedną eskadrę widzą wszystkie.
- Eskadra, która przegrywa wymianę ognia, **wzywa wsparcia**. Najbliższa grupa z misją obrony albo patrolu leci na miejsce na 45 s, a potem wraca na posterunek.
- Grupy meldują kontakt, trafienia, godzinę H i raporty. Meldunki trafiają do dziennika załogi i na listę „Łączność floty” w zakładce.

**Wywiad.** Zwiad zapisuje stan pola: właściciela, poziom, obronę, flotę
rasy, a na żywo także wieże, stacje i patrole. Zapis ma czas obserwacji.

- Świeży wywiad (do 5 min) daje premię ×1,12 w starciu.
- Przycisk *Dobierz skład* liczy siłę potrzebną na cel.
- Pola układu, przez który przeleciał zwiad, odkrywają się przy wejściu gracza.

**Raport.** Po misji wyskakuje karta z trzema wyborami: *Przyjąć*, *Powtórz
zadanie* albo *Rozwiąż grupę*. Grupa wraca do siedziby i broni pola
macierzystego w jeżu. *Obserwuj* przy grupie w układzie gracza przełącza
na podgląd zdalny nad jej okrętami.

Przycisk *Broń bazy* / *Poślij flotę* z karty nalotu rusza tylko okręty
spoza grup. Grupy walczą według swoich misji i odpowiadają na wezwania.
Ręczna zmiana rozkazu okrętu (zakładka Flota) wyjmuje go z grupy.

| Plik | Co robi |
|---|---|
| `shared/data/military.js` | szyki, ROE, misje, cele uderzenia, czasy (jedno miejsce do strojenia) |
| `shared/systems/fleet-ops.js` | grupy, misje, fazy, rama szyku, rozstrzygnięcie zaoczne, wsparcie, wywiad, raporty |
| `shared/systems/fleet-ops-panel.js` | zakładka Operacje |
| `shared/systems/tactical-ai.js` | baza `'fleet'`: sloty szyku (`formationSlot`), postawy, łącze danych, wezwania wsparcia |
| `shared/systems/army.js` | hook `brainFor`, przeloty w fałdzie (`s.transit`), `rebrain`, `lose` |
| `shared/systems/strategy.js` | `sabotage`: osłabiona obrona i dochód pola |
| `shared/systems/rival-presence.js` | `outpostInfo`: stacje, wieże, drony i patrole placówki |

Test: `node step12-dowodztwo/check-military.mjs`. Sprawdza szyki, rajd
zaoczny z raportem i powrotem, zdobycie pola, odwrót wg ROE, zwiad
i wywiad, godzinę H oraz na żywo: jeża, łącze danych, wezwanie wsparcia
i rajd w układzie gracza, a także raport z potyczki (werdykty, przypisanie
zestrzeleń w prawdziwym nalocie rasy na siedzibę) i naprawy (naprawa polowa,
pauza pod ostrzałem, remont przyspieszony i jego koszt, stacje, grupa „na naprawę” z daleka)
oraz poziomy trudności (przełączanie bez kumulowania, symulacja wojny na trzech poziomach).


## Raport z potyczki i strefa obrony (krok 12c)

Po każdym nalocie albo ataku rasy wyskakuje karta **„Raport z potyczki”**
z werdyktem (`shared/systems/battle-report.js`):

| Werdykt | Kiedy |
|---|---|
| **Wróg rozbity** | zestrzeleni wszyscy |
| **Wróg przegoniony** | część zestrzelona, reszta uciekła bez większego łupu |
| **Wróg się wycofał** | odlecieli bez strat po obu stronach |
| **Wróg odleciał z łupem** | zabrali, po co przylecieli |
| **Obrona złamana** | łup i ponad połowa siły naszej floty w układzie stracona |

Pierwsze zdanie odpowiada wprost na pytanie, czy flota przegoniła wroga.
Pod nim jest tabelka:

- wróg: liczba i stronnictwo,
- zestrzeleni i uciekinierzy,
- **kto strzelał**: flota, ty, wataha, wieże i platformy,
- nasza flota: stracone okręty z nazwami, uszkodzenia w procentach,
- gospodarka: stracone drony, zrabowany urobek, złupione stacje,
- **flota rasy przed → po** i stan wojny.

Skutek strategiczny to porównanie sił po walce. Przy przewadze karta
proponuje **Kontratak →**: otwiera zakładkę Operacje z gotowym celem (pole
tej rasy, najpierw w układzie siedziby) i dobranym składem. Przy stratach
albo słabości proponuje *Buduj okręty*. Ataki rozegrane zaocznie dostają
krótszy raport. Na telefonie tabelka jest zwinięta pod „Szczegóły ▾”.

Fakty zbiera `raids.js`:
- migawka okrętów i stacji przy wejściu wroga i po walce (hook `snapshot`),
- zestrzelenia według ostatniego strzelca (`npc.lastShooter` w `npc-ships.js`, `classifyKiller`),
- uciekinierzy.

**Strefa obrony.** Rozkaz obrony pola (garnizon, *Broń bazy*, grupy
bojowe) trzymał się dotąd środka pasa na smyczy 4500 j. Siedziba, huta
i reaktor stoją 5,5–7,4 tys. j. od środka pola, więc wróg łupiący stacje
był **poza zasięgiem obrońców**. Teraz `army.defenseZone(fid)` obejmuje pas
i stacje przy nim: szyk stoi między nimi, a smycz sięga najdalszej stacji
z zapasem.


## Naprawy (krok 12c)

Okręty naprawiają się tylko przy zapleczu i tylko **poza walką**, czyli
8 s po ostatnim trafieniu. Pod ostrzałem ekipy czekają, a lista okrętów
pokazuje to na czerwono. Stawki są w `REPAIR` w `shared/data/military.js`.

| Gdzie | Tempo | Koszt |
|---|---|---|
| **Stocznia** | 1% kadłuba/s | darmowo |
| **Siedziba bez stoczni** (naprawa polowa) | 0,3%/s — fregata od 50% w ok. 3 min | darmowo |
| **Remont przyspieszony** (przy stoczni albo siedzibie) | 5%/s — pełny kadłub w ok. 20 s | z góry: 1,1 kr + 0,07 t żelaza + 0,02 t niklu za punkt kadłuba |
| Poza zapleczem (inne układy, fałda) | brak | — |

Wcześniej okręty bez stoczni nigdy się nie naprawiały.

**Stacje** odrastają same (1%/s, 10 s po trafieniu). **Remont stacji**
(0,5 kr + 0,05 t Fe za punkt, +120 kr za wyłączoną) od razu przywraca do
pracy splądrowaną stację albo przegrzaną wieżę i dokańcza kadłub w 8%/s.

Gdzie są przyciski:

- **Flota → Naprawy** (na górze zakładki): uszkodzone okręty z ceną *Remontu przyspieszonego* i uszkodzone stacje z *Napraw stacje*. W wierszu każdego okrętu: kadłub, miejsce i czas naprawy, „remont 12 s”, „pod ostrzałem” albo „bez zaplecza”.
- **Operacje → karta grupy**: kadłuby grupy i stan naprawy oraz przycisk **Na naprawę**. W bazie oznacza płatny remont od razu. Z daleka grupa przerywa misję, wraca i remontuje się po przylocie. Przełącznik **Po misji: remont przyspieszony** zapewnia, że po każdym „daj rozkaz i zapomnij” grupa wraca w pełni sprawna.
- **Raport z potyczki**: przycisk **Napraw (N kr)** z ceną, dla okrętów i stacji w układzie potyczki.

Kadłub okrętu w układzie gracza jest brany na bieżąco z NPC, więc siła
grupy, próg odwrotu wg ROE i raporty widzą obrażenia z walki od razu.


## Poziomy trudności (krok 12c)

Poziom wybierasz w tablicy misji (**Poziom trudności**). Zmienić go można
w każdej chwili w **menu gry (Esc)**. Zapisuje się razem z kampanią, więc
wczytana gra wraca na swoim poziomie, a *Nowa gra* startuje na tym samym.
Klucze w adresie się nie zmieniły (`?trudnosc=latwa|normalna|trudna`).

| | **Łatwy** — lekko i przyjemnie | **Średni** — ambitnie, ale do ogarnięcia | **Trudny** — ambitnie |
|---|---|---|---|
| Okres ochronny (rasy nie wypowiadają wojny) | 20 min | 10 min | 7 min |
| Ataki ras | rzadkie (co ~4,3 min), siły ×0,7 | co ~2,5 min | częste (co ~1,9 min), siły ×1,25 |
| Skłonność ras do wojny / pokoju | ×0,5 / ×1,8 | ×1 / ×1 | ×1,3 / ×0,6 |
| Rasy: kredyty i okręty na start, dochód, limit floty | 2600 kr, 3, 42, 14 | 3500 kr, 4, 55, 24 | 4500 kr, 5, 66, 30 |
| Obrona pól ras (rajdy, szturmy) | ×0,8 | ×1 | ×1,2 |
| Naloty: zagrożenie, rabusie, kadłub, przerwa | ×0,55, 2–4, 90, 6,3 min | ×1, 2–6, 120, 4 min | ×1,3, 3–7, 150, 3 min |
| Ostrzeżenie przed nalotem | 25 s | 15 s | 12 s |
| Łup z magazynu / wyłączenie stacji | 25% / 15 s | 40% / 25 s | 50% / 35 s |
| Kredyty gracza na start | 2500 | 1500 | 1200 |
| Okręty: koszt / utrzymanie / budowa | ×0,8 / ×0,6 / ×0,75 | ×1 | ×1,15 / ×1,25 / ×1,1 |
| Naprawy: tempo / koszt remontu / pauza po trafieniu | ×1,6 / ×0,6 / 6 s | ×1 / ×1 / 8 s | ×0,75 / ×1,3 / 10 s |
| Walka myśliwcem | 1 wróg naraz, rakiety 95% | 2 naraz, 75% | 3 naraz, 50% |

**Średni to dotychczasowy balans gry.** Wartości bazowe są w
`shared/data/economy.js` i `military.js`.

Wszystkie liczby stroisz w `shared/data/difficulty.js`.
`shared/systems/difficulty.js` nakłada je na stałe gry w miejscu, zawsze od
wartości bazowych, więc przełączanie poziomów się nie kumuluje. Mnożniki
zachowań ras (`attackMul`, `defenseMul`, `warMul`, `peaceMul`) czyta
`strategy.js` i dotyczą tylko stosunku ras do gracza. Między sobą rasy
walczą tak samo na każdym poziomie.

Symulacja 30 minut wojny ze wszystkimi rasami (test 11):

| | Łatwy | Średni | Trudny |
|---|---|---|---|
| Ataki | 55 | 96 | 124 |
| Wysłane okręty łącznie | 200 | 801 | 1122 |

## Płynność walki: rozgrzewka shaderów (`shared/systems/warmup.js`)

Przycięcia przy ataku nie brały się z logiki. AI, walka i gospodarka to
poniżej 1 ms na klatkę, także w bitwie. Brały się z **kompilacji shaderów
w środku walki**:

- **pierwsze użycie**: modele statków wrogiej rasy, brama, fala i blizna fałdy, pociski, błyski i wybuchy kompilują się dopiero wtedy, gdy pierwszy raz trafiają do kadru,
- **ponowna kompilacja po każdej ciszy**: efekty (np. implozja torpedy, brama fałdy) tworzą materiał na ułamek sekundy i go niszczą. Gdy znika ostatni materiał danego rodzaju, three.js zwalnia program, a następny efekt kompiluje go od nowa. Torpedy Wybudzonych robiły to przy **każdym trafieniu**.

Naprawa składa się z dwóch części:

- **Próba generalna pod animacją wejścia na mostek.** Daleko poza kadrem wychodzi z fałdy po jednym statku z każdego modelu floty, każda broń strzela, jest wybuch i implozja torpedy (`weapons.demoEffects`). Co chwilę `renderer.compile(scene, camera)` kompiluje wszystko bez względu na kadr.
- **Kotwice.** Dla każdego programu zostaje kopia materiału na niewidocznej siatce (`shader-anchors`). Jest widoczna tylko na czas kompilacji i nigdy nie jest niszczona, więc programy żyją całą sesję. Programy, które pojawią się później (rzadki efekt), dostają kotwicę przy pierwszym użyciu.

Pomiar w headless Chromium, walka z 8 okrętami rasy:

| | przed | po |
|---|---|---|
| kompilacje shaderów w trakcie walki | 6–9 (każda to przycięcie) | **0** |

Logika gry i koszt rysowania się nie zmieniły.

## Testy

```
node step12-dowodztwo/check.mjs
node step12-dowodztwo/check-military.mjs   # krok 12c: grupy bojowe i operacje
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
