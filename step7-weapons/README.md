# Krok 7 — Uzbrojenie

Krok 6 + pięć rodzajów broni, pierwszy podpięty system z kart ras
(**Ciepło**) i broń rasowa NPC. Cała logika siedzi w
`shared/systems/weapons.js`, zbudowanym na rozszerzonym `combat.js`.

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
| **Śrutownica** | 10 śrucin w stożku 4,5°, zasięg ~770 j. | z bliska (z 200 j. ~160 obrażeń w 3 s, z 700 j. ~30) |
| **Lanca** | ciągły promień, trafienie natychmiastowe, zasięg 1600 j. | krótkie serie — przegrzewa statek w kilka sekund |
| **Rój rakiet** | salwa 2 rakiet z obu burt, naprowadzanie, mały wybuch | cel ruchliwy lub daleki; wymaga **namierzenia** |
| **Torpeda fałdowa** | wolna, słabo skręca, zapalnik zbliżeniowy, **implozja** w promieniu 300 j. | ciężki cel albo grupa; wybucha też na końcu lotu |

**Namierzanie** (rakiety i torpedy): cel w stożku 18° przed dziobem, do
3200 j., trzymany 0,7 s. Romb na celu zwęża się i obraca w trakcie, po
namierzeniu robi się czerwony, a Oficer Taktyczny to potwierdza. Namiar
trzyma się w szerszym stożku (32°), żeby nie gubił się przy manewrze. Bez
namiaru pociski lecą prosto.

**Wygląd**: rakiety wylatują na boki i zakręcają do celu, ciągnąc smugę
ognia i dymu; torpeda leci w spirali iskier, a przy detonacji kula
**zapada się do środka** (iskry są zasysane), po czym błysk i pierścień
zwrócony do kamery. Lanca ma "zwoje" płynące wzdłuż promienia (widać
kierunek strzału) i sypie iskrami w punkcie trafienia.

## Ciepło (z karty rasy)

Pole `ship.thermal` z `races.js` czekało na system od kroku 5 — teraz go ma.

- każdy strzał grzeje statek; Lanca grzeje ciągle, dopóki świeci,
- ciepło uchodzi samo (wolniej, gdy Lanca pracuje),
- **100% = przegrzanie**: broń milknie, aż temperatura spadnie do 30%
  (Inżynier ogłasza oba momenty),
- skala: `60 / thermal` — Świetliści (40) grzeją się 1,5× szybciej niż
  wzorzec, Heliotropi (90) o jedną trzecią wolniej, i tyle samo szybciej
  oddają ciepło.

Przykład z testu: Pieśniarze (thermal 45) przegrzewają się Lancą po 3,6 s,
schłodzenie do 30% trwa 4,7 s.

Ciepło jest w telemetrii (pasek pod ładunkiem; widoczny też na telefonie w
poziomie).

## Broń rasowa

| Rasa | Broń | Dlaczego |
|---|---|---|
| Wybudzeni | Torpeda fałdowa | ciężkie niszczyciele; "wpis do manifestu" jednym strzałem |
| Rezonanci | Lanca | rezonans = ciągła fala |
| Pieśniarze | Rój rakiet | "widzieliśmy twój tor trzy pieśni temu" — pociski znające kurs |
| Szczepieni | Śrutownica | rój zarodników |
| Wykonawcy | Działko impulsowe | precyzja klauzuli |
| Heliotropi | Śrutownica | wyrzuty plazmy |
| Świetliści | Lanca | światło |

Gracz grzeje bronią rasową **30% mniej** (w pasku broni oznaczona jako
"rasowa"). **NPC strzelają bronią swojej rasy** — każda z własnym zasięgiem
otwarcia ognia, wymaganym wycelowaniem i rytmem (`NPC_PROFILE`): Pieśniarze
odpalają rakiety z 2600 j., Szczepieni muszą podejść na 750 j., Rezonanci
omiatają lancą w krótkich seriach. Etykieta wroga pokazuje jego broń.
Pociski NPC mają kolor strony (zielony/czerwony), żeby było wiadomo, kto
strzela — broń rozpoznaje się po kształcie.

Obrażenia NPC w 20 s walki z graczem (bez pancerza, test): działko 100,
śrut 66, lanca 66, rakiety 80, torpeda 113. Działko to dawny bolt z kroku 5
(~110), więc skala walki się nie zmieniła — zmienił się jej charakter.

## Co zmieniło się w `combat.js` (wstecznie zgodne)

- `fire()` przyjmuje opcjonalnie: `size`, `mesh` (własny wygląd),
  `homing` (cel + prędkość skrętu), `accel`/`maxSpeed`, `aoe` (wybuch),
  `proximity` (zapalnik zbliżeniowy), `onUpdate`/`onEnd` (smugi, efekty).
- `raycast(origin, dir, maxDist, side)` — dla promieni.
- `explode(pos, radius, damage, side)` — obrażenia ze spadkiem od **krawędzi**
  aktora (duży okręt obrywa, gdy wybuch liźnie burtę).

## Dlaczego tak

**Lanca zadaje obrażenia paczkami co 0,25 s, nie co klatkę.** Pancerz
odejmuje stałą wartość od *każdego* trafienia. Porcja co klatkę (46 dps /
60 fps ≈ 0,8) byłaby w całości zjadana przez pancerz — Lanca nie raniłaby
niczego z pancerzem.

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
- śrut z 200 / 420 / 700 j. (160 / 49 / 31 w 3 s),
- przegrzanie i schłodzenie Lancą,
- każda z 5 broni NPC przeciw graczowi (20 s walki),
- zrzuty ekranu: rakiety w locie, implozja torpedy, Lanca, pasek broni,
- kroki 5, 6 i 7 bez błędów w konsoli.

**Nie** sprawdziłem, jak walka "leży w ręce" na prawdziwym GPU i telefonie
(płynność, czytelność śrutu z daleka, czy 2400 cząstek to dobry limit).

## Do zrobienia

Sloty (`ship.slots` z karty rasy: 2-4 bronie na pokład zamiast wszystkich
pięciu), Energia jako drugi zasób broni, flary/zakłócanie przeciw rakietom,
dźwięki, sojusznik w eskorcie wybierający broń pod dystans.
