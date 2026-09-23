# Krok 7 — Uzbrojenie

Krok 6 + pięć rodzajów broni, pierwszy podpięty system z kart ras
(**Ciepło**) i broń rasowa NPC. Cała logika siedzi w
`shared/systems/weapons.js`, zbudowanym na rozszerzonym `combat.js`.

> **Zmiana arsenału.** Pierwotnie krok 7 miał Śrutownicę i Lancę (ciągły
> promień). Zostały zastąpione dwiema torpedami z głowicą, która **może
> zgubić cel**: Grotem i Trójzębem. `weapons.js` jest wspólny dla kroków 7
> i 8, więc zmiana obejmuje oba; stara wersja jest w historii gita.

## Sterowanie (dodatki do kroku 6)

| Klawisz | Akcja |
|---|---|
| **F** / LPM / **OGIEŃ** | spust (trzymany) — jak dotąd |
| **Q / E**, kółko myszy, **5** | poprzednia / następna broń |
| klik w pasek broni | wybór bezpośredni |
| **BROŃ** (dotyk) | następna broń (na przycisku nazwa aktualnej) |

Po zaokrętowaniu aktywna jest broń rasowa kapitana.

## Pięć broni — różna mechanika, nie tylko kolor

| Broń | Mechanika | Kiedy się opłaca |
|---|---|---|
| **Działko impulsowe** | szybkie bolty, asysta celowania 12° | zawsze; niskie ciepło |
| **Rój rakiet** | salwa 2 rakiet z obu burt, naprowadzanie, mały wybuch | cel ruchliwy lub daleki; wymaga **namierzenia** |
| **Torpeda Grot** | jedna, bardzo szybka (do 1500 j./s), mocna (60 + wybuch 40); głowica **łatwo gubi cel** | cel, który leci w miarę prosto; jeden mocny cios |
| **Salwa Trójząb** | trzy szybkie torpedy w wachlarzu ±9° (po 38 + wybuch 16); **zwykle dochodzą 1–2** | pewniejsze obrażenia niż Grot, ale grzeje najmocniej |
| **Torpeda fałdowa** | wolna, słabo skręca, zapalnik zbliżeniowy, **implozja** w promieniu 300 j. | ciężki cel albo grupa; wybucha też na końcu lotu |

**Namierzanie** (rakiety i wszystkie torpedy): cel w stożku 18° przed dziobem, do
3200 j., trzymany 0,7 s. Romb na celu zwęża się i obraca w trakcie, po
namierzeniu robi się czerwony, a Oficer Taktyczny to potwierdza. Namiar
trzyma się w szerszym stożku (32°), żeby nie gubił się przy manewrze. Bez
namiaru pociski lecą prosto.

**Wygląd**: rakiety wylatują na boki i zakręcają do celu, ciągnąc smugę
ognia i dymu; torpeda leci w spirali iskier, a przy detonacji kula
**zapada się do środka** (iskry są zasysane), po czym błysk i pierścień
zwrócony do kamery. Grot i Trójząb to jasne, smukłe groty z ciasną, prostą
smugą iskier; gdy głowica zgubi cel, torpeda sypie iskrami, zbacza, a jej
smuga gaśnie do szarości — widać, która torpeda już nie trafi.

## Głowica, która gubi cel (Grot, Trójząb)

Zasady są w `combat.js` (opcjonalne pola `homing`, inne pociski działają
jak dawniej):

- **pole widzenia głowicy** (Grot 22°, Trójząb 26°): cel poza nim — zgubiony
  na dobre,
- **szum**: losowa szansa zgubienia na sekundę (Grot 0,4, Trójząb 0,7) plus
  składnik rosnący z prędkością obrotu linii celowania — cel, który ostro
  manewruje, łatwiej zgubić,
- zgubiona torpeda **zbacza o 8–16°** i leci prosto; zapalnik zbliżeniowy
  dalej działa, więc czasem trafi przypadkiem,
- **bliżej niż 180 j.** głowica już nie gubi (torpeda i tak jest na kursie).

**Łącze salwy (Trójząb).** Przy trzech niezależnych torpedach wynik
rozkłada się jak rzut monetą: sporo salw kończy się zerem albo kompletem.
Dlatego torpedy salwy dzielą łącze naprowadzania: dopóki żadna nie zgubiła
celu, każda gubi go łatwiej (×1,4); po pierwszej stracie pozostałe dostają
lepszy namiar (×0,5), a po drugiej ostatnia prawie go nie traci (×0,1).

Oficer Taktyczny melduje wynik: „Grot zgubił cel.” albo „Trójząb: 2 z 3 w
celu.”

### Skuteczność torped

Symulacja w Node (ten sam `combat.js`, 400 strzałów z 1000–2400 j.) i
pomiar w grze (krok 8, `?debug`, 50 strzałów z 1200–2000 j.):

| | Grot: trafienia | Trójząb: salwy z 0 / 1 / 2 / 3 trafieniami |
|---|---|---|
| symulacja: cel leci prosto | ~68% | 1% / 36% / 57% / 6% |
| symulacja: cel z prędkością NPC, zmienia kurs co 1–2 s | ~64% | 1% / 40% / 53% / 6% |
| symulacja: cel szybki, ostre uniki co 0,5–1,3 s | ~28% | 24% / 52% / 23% / 2% |
| gra: nieruchomy NPC | 62–78% | 0% / 30–36% / 60–64% / 4–6% |
| gra: NPC w trybie ataku | 50–58% | 28% / 24% / 44% / 4% |

NPC w trybie ataku szarżuje prosto na gracza i ostro odbija, więc
zachowuje się jak cel robiący uniki — tam Trójząb częściej chybia całą
salwą. To celowe: salwa jest pewna na cel, który nie tańczy.

## Ciepło (z karty rasy)

Pole `ship.thermal` z `races.js` czekało na system od kroku 5 — teraz go ma.

- każdy strzał grzeje statek (Trójząb najmocniej: 18 na salwę),
- ciepło uchodzi samo,
- **100% = przegrzanie**: broń milknie, aż temperatura spadnie do 30%
  (Inżynier ogłasza oba momenty),
- skala: `60 / thermal` — Świetliści (40) grzeją się 1,5× szybciej niż
  wzorzec, Heliotropi (90) o jedną trzecią wolniej, i tyle samo szybciej
  oddają ciepło.

Ciepło jest w telemetrii (pasek pod ładunkiem; widoczny też na telefonie w
poziomie).

## Broń rasowa

| Rasa | Broń | Dlaczego |
|---|---|---|
| Wybudzeni | Torpeda fałdowa | ciężkie niszczyciele; "wpis do manifestu" jednym strzałem |
| Rezonanci | Torpeda Grot | jeden strzał w chwili otwarcia okna |
| Pieśniarze | Rój rakiet | "widzieliśmy twój tor trzy pieśni temu" — pociski znające kurs |
| Szczepieni | Salwa Trójząb | rój zarodników: kilka wysłanych, któreś dotrze |
| Wykonawcy | Działko impulsowe | precyzja klauzuli |
| Heliotropi | Salwa Trójząb | frenzja: sypią salwami |
| Świetliści | Torpeda Grot | światło: szybkie i proste |

Gracz grzeje bronią rasową **30% mniej** (w pasku broni oznaczona jako
"rasowa"). **NPC strzelają bronią swojej rasy** — każda z własnym zasięgiem
otwarcia ognia, wymaganym wycelowaniem i rytmem (`NPC_PROFILE`): Pieśniarze
odpalają rakiety z 2600 j., Rezonanci strzelają Grotem z 2400 j. co 3–4 s,
Szczepieni sypią salwami z 2200 j. Etykieta wroga pokazuje jego broń.
Pociski NPC mają kolor strony (zielony/czerwony), żeby było wiadomo, kto
strzela — broń rozpoznaje się po kształcie.

Obrażenia NPC w 20 s walki z nieruchomym graczem (krok 8, średnia z 3–8
prób): działko 88–102, rakiety 68–75, Grot ~91, Trójząb ~96, torpeda
fałdowa 81–83. Działko to dawny bolt z kroku 5 (~110), więc skala walki się
nie zmieniła — zmienił się jej charakter.

## Co zmieniło się w `combat.js` (wstecznie zgodne)

- `fire()` przyjmuje opcjonalnie: `size`, `mesh` (własny wygląd),
  `homing` (cel + prędkość skrętu), `accel`/`maxSpeed`, `aoe` (wybuch),
  `proximity` (zapalnik zbliżeniowy), `onUpdate`/`onEnd` (smugi, efekty).
- `raycast(origin, dir, maxDist, side)` — trafienie natychmiastowe na promieniu.
- `homing` przyjmuje pola głowicy, która gubi cel: `seekerConeDeg`,
  `lossPerSec`, `lossPerRad`, `lostDeflectDeg`, `commitRange`, `lossMult`,
  `onLost` (opis w nagłówku `combat.js`).
- Zapalnik zbliżeniowy zadaje celowi, który go wyzwolił, **pełne obrażenia
  bezpośrednie** (wcześniej tylko wybuch — przy torpedzie fałdowej bez
  zmian, bo ta ma obrażenia bezpośrednie 0).
- `explode(pos, radius, damage, side)` — obrażenia ze spadkiem od **krawędzi**
  aktora (duży okręt obrywa, gdy wybuch liźnie burtę).

## Dlaczego tak

**Naprowadzanie obraca kierunek po łuku wielkim**, a nie interpoluje
kwaternionów. Pierwotnie skręt liczył `rotateTowards` między kwaternionami
z `setFromUnitVectors(Z, kierunek)`. Dla kursu bliskiego −Z te kwaterniony
mają przypadkowy „przechył”, więc interpolacja szła okrężną drogą i pocisk
skręcał źle albo prawie wcale. Dotyczyło to też rakiet i torpedy fałdowej.
Teraz kierunek obraca się wokół osi *kurs × cel* o najwyżej `turnRate·dt`.

**Zgubienie celu zbacza torpedę.** Bez tego torpeda, która zgubiła cel
tuż przed trafieniem, i tak by trafiła (była już na kursie kolizyjnym) —
„zgubienie” nic by nie znaczyło. Z tego samego powodu z bliska (180 j.)
głowica już nie gubi.

**Wszystkie cząstki (smugi, iskry, dym) to jeden obiekt `Points`** z buforem
cyklicznym (2400 cząstek): jeden draw call dla całej walki, zero alokacji w
trakcie lotu. Ruch cząstek liczy shader (prędkość z oporem), więc CPU tylko
je "rodzi".

**W fałdzie się nie strzela** — statek jest poza przestrzenią (i tak jest
wtedy nietrafialny).

## Jak zweryfikowano

Headless Chrome (SwiftShader), symulacja przewijana `tick(0,05)` przez
`?debug` (`window.__game` ma teraz też `arsenal`, `weapons`, `combat`,
`fireInput`, `playerState`):

- każda broń gracza w nieruchomy cel: obrażenia, ciepło, namiar rakiet i torped,
- skuteczność Grota i Trójzęba (tabela wyżej): symulacja w Node i pomiar w
  grze,
- każda z 5 broni NPC przeciw graczowi (20 s walki),
- zrzuty ekranu: rakiety w locie, implozja torpedy, salwa Trójzęba, pasek broni,
- kroki 5, 6, 7 i 8 bez błędów w konsoli.

**Nie** sprawdziłem, jak walka "leży w ręce" na prawdziwym GPU i telefonie
(płynność, czytelność torped z daleka, czy 2400 cząstek to dobry limit),
ani czy Grot „gubiący cel” nie frustruje bardziej, niż bawi.

## Do zrobienia

Sloty (`ship.slots` z karty rasy: 2-4 bronie na pokład zamiast wszystkich
pięciu), Energia jako drugi zasób broni, flary/zakłócanie przeciw rakietom
(głowica Grota i Trójzęba ma już `lossMult` — flara może go po prostu podbić),
dźwięki, sojusznik w eskorcie wybierający broń pod dystans.
