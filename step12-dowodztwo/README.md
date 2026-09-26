# Krok 12 — Dowództwo: mostek siedziby rasy

Od tego kroku gra zaczyna się **na mostku siedziby** twojej rasy, a nie
w kokpicie. Na okładce wybierasz układ, klikasz „Graj” i po krótkim
najeździe kamery siedzisz przed szybą mostka. Przed tobą leży pas
planetoid pola macierzystego, po prawej pracuje huta, po lewej reaktor.
Pod szybą jest pokład hangaru, z którego wylatują drony.

```
step12-dowodztwo/?uklad=teegarden&statek=goniec-wybudzeni-hawk-7
```

Rasę wyznacza statek, podobnie jak w krokach 9–11. Okładka bierze statek
wybrany ostatnio na tablicy misji (link „Misje i wybór statku”), a gdy go
nie ma, pierwszy z floty. Misja uruchomiona z tablicy (`&misja=...`)
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
| `shared/systems/army.js` | `mods` — mnożniki siły i kadłuba floty z ulepszeń |

Zapis kampanii kroku 12 jest osobny od kroku 11
(`teegarden-b.dowodztwo.v1.<rasa>`). Stan dowództwa (hangar, wyprawy,
urobek, nauka, ulepszenia) jest częścią zapisu gospodarki
(`economy.state.command`).

## Testy

```
node step12-dowodztwo/check.mjs
```

Test sprawdza siedzibę zwróconą do pasa, zasilanie i niedobór prądu,
ogniwa, pełny cykl zwiadu (fazy, „skrót”, odkrycie pola, raport
i decyzję), górników (pełne ładownie, decyzję, hutę i odzysk), naukę
(wymagania i odkrycia), ulepszenia (koszt, limit, mnożniki floty),
autonomię rojów, wyprawę pod ostrzałem, budowę z mostka i zapis.
W przeglądarce: `node tools/browser-check/check.mjs`, sekcja „Krok 12”.
