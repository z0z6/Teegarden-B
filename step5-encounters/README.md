# Krok 5 — Rasy, walka i sceny fabularne (demo)

Krok 4 + warstwa fabularna: statek wyznacza **rasę kapitana**, rasa daje
**statystyki**, a w grze odbywa się krótkie demo z trzema scenami: **kontakt
sojusznika**, **przechwycenie** i **atak wrogiego statku**.

## Sterowanie (dodatki do kroków 3-4)

| Klawisz | Akcja |
|---|---|
| **F** / lewy przycisk myszy / przycisk OGIEŃ (dotyk) | ogień |
| **Z / X / C** | odpowiedź w komunikatorze (można też kliknąć) |
| **7 / 8 / 9** | uruchom osobno scenę: kontakt / przechwycenie / atak |
| **0** | demo od nowa (kontakt → przechwycenie → atak) |
| **R** | odrodzenie po zniszczeniu statku |
| **1-4** | zmiana statku = zmiana rasy (i nowi losowi rozmówcy) |

Demo startuje samo ~6 s po wczytaniu statku.

## Skąd rasa

`shared/data/races.js` → `SHIP_RACE` przypisuje modele do ras. Przydział jest
**wylosowany raz i zapisany** (do czasu, gdy powstaną własne modele ras):

| Statek | Rasa |
|---|---|
| Warbird — Light Skirmisher | Pieśniarze |
| Raptor-class Interceptor | Rezonanci |
| Warbird — Heavy Siege Interceptor | Szczepieni |
| Kharath — Heavy Destroyer | Wybudzeni |

Wszystkie **siedem ras** ma pełne karty w `races.js` (atrybuty, szablon
statku, modyfikatory stronnictw). Trzy z nich (Wykonawcy, Heliotropi,
Świetliści) nie mają jeszcze własnych modeli statków, więc **nie ma statku,
którym można by nimi zagrać** — występują w scenach jako sojusznicy/wrogowie
(dostają wtedy losowy model). Żeby nimi grać, wystarczy dopisać wpis do
`SHIP_RACE` w momencie, gdy powstanie model.

## Statystyki (co jest już podpięte)

Wzory z kart ras. **Wszystkie liczby siedzą w `shared/data/races.js`** — tam
je stroisz.

| Statystyka | Efekt w grze |
|---|---|
| Nawigacja | horyzont alertu "kurs kolizyjny" = 5 s × N (dziś 25 s w kroku 4 = N 5) |
| Czujniki | zasięg czujników = 6000 × (1 + 0,08 × (C−5)) |
| Taktyka | obrażenia gracza × (1 + 0,04 × (T−5)) |
| Wpływ | szansa negocjacji w scenie przechwycenia |
| Kadłub, Pancerz | punkty życia i płaska redukcja obrażeń (połowa wartości pancerza) |
| Regeneracja | Szczepieni: 0,2%/s po 5 s bez trafienia |

Jeszcze **nie** podpięte (brak systemów): Pilotaż (jest w modelu lotu, ale nie
skalowany rasą), Inżynieria, Energia, Ciepło, zasoby podpisowe (Manifest,
Rezonans, Horyzont, Szczepy), Sygnatura. Dane są w kartach, mechaniki czekają.

**Uwaga o prędkościach:** w kartach podałem ciąg/prędkość z wzoru kroku 3.
Krok 4 ma mnożnik boostu ×14 (nie ×2,2), więc prawdziwe wartości to ~42 j./s
przelotowo i ~584 j./s na boostcie. NPC-e są dobrane do tego, nie do kart.

## Sceny

Reżyser (`shared/systems/encounters.js`) liczy czas w czasie SYMULACJI, nie
zegara ściany — sceny działają tak samo przy 10 i 60 fps i można je
"przewijać" w testach (`tick(delta)` w `main.js`).

**1. Kontakt sojusznika.** Rasa sojusznika jest losowana spośród ras o relacji
≥ +15 z rasą gracza (`pickRaceByRelation`). Sojusznik podlatuje i nadaje
wywołanie w swoim "głosie". *Przyjmij pomoc* → leci z tyłu i **pomaga w
walce**, +10 reputacji. *Zignoruj* → odchodzi.

**2. Przechwycenie.** Wróg (relacja ≤ −15) dogania gracza od rufy i "przytrzymuje"
go: **zakłócenie napędu** ogranicza pułap prędkości do 25% i żąda myta.
- *Zapłać* (−4 ładunku) → wróg odlatuje.
- *Negocjuj* → szansa = 0,30 + 0,06 × (Wpływ−5) + reputacja/300 (10-90%);
  pokazana w menu. Sukces = wróg odlatuje, porażka = atak.
- *Odmów* → atak.
Kto ucieknie na boost, zanim wróg go dogoni, kończy scenę. Kto zestrzeli
przechwytywacza w drodze — też.

**3. Atak.** Wróg wykonuje przeloty z ostrzałem (faza ataku i zawrotki).
Kończy się jego zniszczeniem (+3 ładunku), odwrotem (poniżej 25% kadłuba)
albo ucieczką gracza. Reputacja u rasy wroga spada.

Role załogi z dashboardu mają teraz zawartość: **Oficer Taktyczny** (wreszcie
używany) zgłasza kontakty bojowe i trafienia, Inżynier — zakłócenie napędu i
odzysk, Nawigator — identyfikację i reputację.

## Znane uproszczenia (świadome)

- **NPC-e nie kolidują ze statkiem ani z gwiazdami** (nie są w
  `collectSolidBodies`) — można przelecieć przez wroga.
- **Ruch NPC jest kinematyczny** (ograniczona prędkość i skręt), nie ten sam
  model lotu co gracz. Wróg lata ~220 j./s: dogoni gracza na przelotowej, ale
  nie na boostcie.
- **Asysta celowania:** pocisk gracza koryguje kierunek na wroga w stożku 12°
  (z wyprzedzeniem), a jego promień trafienia jest ×2 — bez tego mysz jest za
  mało precyzyjna. Pociski NPC też mają ×2,2 (statek gracza ma promień ~7 j.).
- **Balans jest z powietrza.** Z sojusznikiem wróg pada lub ucieka w kilka
  sekund. Do strojenia: `maxHull` i obrażenia w `npc-ships.js`.
- **Ładunek to licznik**, reputacja jest liczona tylko w obrębie dema
  (reset przy każdym starcie sekwencji).
- **Demo nie zapisuje stanu**, a śmierć = restart sekwencji (R).
- Komunikator, kadłub i etykiety to elementy DOM — **niewidoczne w VR**.
- Model NPC ładuje się asynchronicznie; statek jest widoczny jako punkt
  (beacon) od razu, sylwetka dochodzi po chwili.

## Jak zweryfikowano

Na headless Chrome bez GPU, z przewijaniem symulacji: statystyki 4 ras (zgodne
z kartami), pełny łańcuch trzech scen z prawdziwymi klawiszami (Z/X/C, 7/8/9,
0), ograniczenie prędkości i jego zwolnienie, zapłata myta (ładunek 10→6),
próbkowanie negocjacji (12 prób przy pokazanych 29-35%: 5 sukcesów), walka z
trafieniami obu stron i sojusznikiem, epilog. **Nie** sprawdziłem, jak to
"leży w ręce" (fps, czucie sterowania) — tego nie da się zmierzyć bez GPU.

## Do zrobienia

Własne modele dla trzech ras bez statku (żeby były grywalne), kolizje z NPC, podpięcie Energii/Ciepła i zasobów
podpisowych, ekonomia (dziś ładunek nic nie kosztuje poza myto), rozgałęzienia
fabuły zależne od stronnictwa gracza, zapis stanu.
