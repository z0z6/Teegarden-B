# Krok 6 — Napęd fałdowy (skok) dla wszystkich statków

Krok 5 + skok. Cała logika i grafika siedzi w jednym module
(`shared/systems/warp-drive.js`), a ten krok tylko go podpina: do statku
gracza (każdy z 4 modeli), do wszystkich NPC i do tła gwiazd.

## Sterowanie (dodatki do kroku 5)

| Klawisz | Akcja |
|---|---|
| **J** / przycisk **SKOK** (dotyk) | skok fałdowy ~12 tys. j. prosto przed dziób |
| **K** | parada fałdy: po jednym statku każdej z 7 ras wychodzi z fałdy i odlatuje |

## Pomysł: statek nie przyspiesza — wchodzi w fałdę

Klasyczny warp to gwiazdy rozciągnięte w kreski. Tu statek **dosłownie
wsuwa się w płaszczyznę pierścienia** otwartego przed dziobem: wszystko, co
przeszło za płaszczyznę, znika, a linia cięcia żarzy się na kadłubie. Po
wejściu fałda się zatrzaskuje (echo + błysk), a w miejscu startu zostaje
świecący **szew**, który zaszywa się od początku do miejsca, gdzie była fałda.

Fazy skoku gracza:

| Faza | Czas | Co widać |
|---|---|---|
| ładowanie | 1,4 s | kadłub się żarzy, pasma interferencji biegną od rufy do dziobu, fałda otwiera się przed dziobem i **podąża za nim** (sterowanie działa), niebo lekko się "napina", kamera drży |
| wślizg | 0,5 s | sterowanie zablokowane, statek rozciąga się (dziób bardziej niż rufa) i znika w pierścieniu kawałek po kawałku |
| przelot | 2,1 s | tunel smug w kolorze rasy, **aberracja relatywistyczna** gwiazd, FOV 60→92, przygaszone mgławice |
| wyjście | 0,9 s | fałda wyjściowa, echo, niebo "odbija" (sprężyna), FOV z przestrzeleniem |

## Relatywistyczna aberracja zamiast tekstury

Gwiazdy tła (`space-background.js`) dostały dwa uniformy: `uBeta` (v/c) i
kierunek lotu. Shader liczy prawdziwy wzór aberracji:

```
cos θ' = (cos θ + β) / (1 + β·cos θ)
```

i czynnik Dopplera `D = 1 / (γ·(1 − β·cos θ'))`. Przy β ≈ 0,93 gwiazdy
zbiegają się w pęk przed dziobem i przesuwają ku fioletowi, a za rufą
rzedną i czerwienieją. Przy wyjściu beta chwilowo spada poniżej zera
(sprężyna z przestrzeleniem) — niebo na moment "rozchodzi się" i wraca na
miejsce. Przy `uBeta = 0` gwiazdy są dokładnie tam, gdzie były, więc
kroki 4 i 5 nie widzą żadnej różnicy.

Jasność ma twardy sufit (`min(D^0.7, 1,8)`): bez niego tysiące gwiazd
zbitych w stożek zlewały się w białą plamę, na której ginął statek.

## Sygnatury ras

Każda rasa "szyje" przestrzeń inaczej. Kolor krawędzi to kolor rasy z
`races.js`, kształt — tabela `WARP_SIGNATURES` w `warp-drive.js`:

| Rasa | Sygnatura | Charakter pierścienia |
|---|---|---|
| Wybudzeni | Pieczęć spisu | 16 kresek jak podziałka rejestru |
| Rezonanci | Okno rezonansu | gładki okrąg + mocne prążki interferencyjne |
| Pieśniarze | Harmoniczna | fala stojąca o 7 płatkach |
| Szczepieni | Szczep | żywy, organicznie falujący brzeg |
| Wykonawcy | Klauzula | sztywny sześciokąt z przerwami w narożnikach, bez skrętu |
| Heliotropi | Korona | 13 drobnych protuberancji + szum |
| Świetliści | Pryzmat | rozszczepienie RGB na trzy promienie |

Gracz skacze w sygnaturze rasy swojego kapitana (zmiana statku = zmiana
rasy = inna fałda). Parada (K) pokazuje wszystkie siedem naraz.

## NPC

`createNpcManager(scene, combat, player, { warp })` — bez `warp` zachowanie
jest identyczne jak w kroku 5.

- **Wejście**: każdy NPC pojawia się przez fałdę za swoją rufą (zamiast
  pojawiać się znikąd). Model ładuje się asynchronicznie — fałda czeka na
  niego najwyżej 4 s. Etykieta celu pojawia się dopiero po wyjściu.
- **Odlot**: tryb `flee` kończy się skokiem po ~2 s rozbiegu (zamiast
  zniknięcia po 14 s), także odwrót wroga i odprawiony sojusznik.
- **Eskorta skacze z graczem**: gdy gracz wchodzi w fałdę, sojusznicy w
  eskorcie/formacji też skaczą, a wychodzą po drugiej stronie na swoich
  miejscach w szyku, z lekkim opóźnieniem jeden po drugim.

## Zasady gry wokół skoku

- **Zakłócenie napędu blokuje skok** (scena przechwycenia) — skok nie jest
  przyciskiem "uciekam od myta". Przed zakłóceniem (wróg jeszcze dolatuje)
  skok działa i reżyser uznaje to za ucieczkę.
- **Kurs jest skracany przed masą**: plan skoku (`planJump`) sprawdza
  przecięcie z gwiazdami i planetą (strefa 1,15 × promień + 900 j.). Gdy do
  masy jest mniej niż 2500 j. — skok odmówiony, Nawigator mówi dlaczego.
  Gruz jest pomijany (po wyjściu i tak rozwiąże go kolizja).
- **W fałdzie statek jest nietrafialny** i nie koliduje.
- **Chłodzenie 6 s** po każdym skoku; stan napędu jest w telemetrii.
- Po wyjściu statek ma prędkość ≥ 1,5 × przelotowej (nie zero — inaczej
  wyjście z fałdy wyglądałoby jak uderzenie w ścianę).

## Jak to jest zbudowane (dlaczego tak)

**Kadłub** — `onBeforeCompile` na sklonowanych materiałach statku.
Deformację liczymy w przestrzeni **świata**, nie modelu: modele glTF mają
dowolną hierarchię węzłów (Kharath ma kwantyzację pozycji i skalę w węźle),
a oś lotu w świecie jest jedna dla całego kadłuba. Gdy efekt jest wyłączony,
shader idzie oryginalną ścieżką `modelViewMatrix` — statek w spoczynku
renderuje się bit w bit jak wcześniej (i bez utraty precyzji float32 na
współrzędnych rzędu 50 tys.). Materiały są **klonowane**, bo NPC-e
współdzielą materiały z cache modeli, a każdy statek potrzebuje własnych
uniformów. Wszystkie statki dzielą za to jeden program GPU
(`customProgramCacheKey`).

**Światła** — fałda doświetla kadłub w kolorze rasy, a błysk rozświetla
okolicę. Światła są w stałej puli 3 sztuk (zawsze w scenie, nieużywane mają
natężenie 0): dodanie/usunięcie światła w trakcie gry wymusza w three.js
rekompilację shaderów wszystkich oświetlonych materiałów — przycięcie klatki
dokładnie w momencie efektu.

**Kamera** — w przelocie statek leci ~6000 j./s, a kamera "na sprężynie"
zostawałaby setki jednostek z tyłu. `cameraStiffness` (0..1) usztywnia ją
na czas przelotu i płynnie luzuje przy wyjściu. We wślizgu kamera jest
jeszcze sprężysta, celowo: statek "ucieka" jej w pierścień.

**VR** — bez drżenia kamery i bez zmiany FOV (przepis na chorobę
lokomocyjną). Tunel i aberracja działają, bo to geometria 3D wokół gracza.

**Czas** — wszystko liczone w czasie symulacji (`update(dt)`), tak jak
reżyser scen; parada też (bez `setTimeout`).

## Jak zweryfikowano

Headless Chrome (SwiftShader, bez GPU), three.js 0.184.0: pełny cykl skoku
gracza (fazy, prędkość w telemetrii do ~10 tys. j./s, powrót do trybu
"gotowy"), parada z 7 rasami i 4 modelami, wejścia i odloty NPC, brak
błędów w konsoli, kroki 4 i 5 bez regresji.

Skok z eskortą przewijany deterministycznie (krok 0,05 s): sojusznik znika
~1 s po wejściu gracza w fałdę, czeka ukryty, ląduje ~160 j. od gracza po
drugiej stronie (gracz przebył ~12 100 j.) z kursem równoległym (cos = 1,000),
po ~2 s wraca do normalnego AI. Patch fałdy trafia na wszystkie materiały
NPC (7/7) po asynchronicznym załadowaniu modelu.

**Hak testowy:** z `?debug` w adresie (`/step6-warp/?debug`) gra wystawia
`window.__game` (`tick(dt)`, `npcs`, `encounters`, `playerWarp`, `warp`,
`shipGroup`) — do przewijania symulacji bez renderu. Bez parametru nic nie
jest wystawiane. **Nie** sprawdziłem płynności
na prawdziwym GPU ani na telefonie.

## Do zrobienia

Dźwięk (narastający ton ładowania, "trzask" zatrzaśnięcia), skok do
wskazanego celu zamiast "prosto przed siebie", koszt energii (gdy powstanie
system Energii z kart ras), wrogowie skaczący za graczem (pościg przez fałdę).
