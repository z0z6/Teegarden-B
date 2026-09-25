# Teegarden-B

Gra kosmiczna budowana krok po kroku w three.js — każdy katalog `stepN-*`
to samodzielna, działająca wersja gry na danym etapie nauki, z README
tłumaczącym co i dlaczego zostało dodane.

## Jak uruchomić dowolny krok

Moduły ES (`import`) wymagają serwera HTTP (nie działają z `file://`).
Z **głównego katalogu repo** (nie z folderu kroku — `step3-ships/` i dalej
odwołują się do `shared/` ścieżką względną):

```bash
npx serve .
# albo
python3 -m http.server 8080
```

Potem otwórz `http://localhost:3000/` — to **okładka gry** (wybór układu startowego, sterowanie). Przycisk „Graj” prowadzi na **tablicę misji** (`missions.html`: odprawa, wybór statku, trudności i watahy), a stamtąd do **kampanii „Dominacja”** (`step11-dominacja`) — gry głównej; misje z kroku 9 i piaskownica gospodarki są niżej na liście. Dziennik budowy ze wszystkimi krokami jest w `dev.html`, a konkretny krok otworzysz np. pod `http://localhost:3000/step3-ships/`.

Okładka (`index.html` + `cover/`) renderuje na żywo Gwiazdę Teegardena z tranzytującą planetą b tymi samymi shaderami co gra; wybrany układ zapamiętuje w przeglądarce i przekazuje do gry jako `?uklad=`. Czcionki (Big Shoulders Display, Manrope — OFL 1.1, licencje w `cover/fonts/`) są hostowane lokalnie. Bez WebGL okładka pokazuje statyczne tło.

**Wizerunki ras** (`shared/data/race-portraits.js`): proceduralne, animowane portrety SVG przedstawicieli siedmiu ras. Komunikator pokazuje portret rozmówcy we wszystkich krokach od 5. Ten sam NPC ma zawsze ten sam wizerunek, osobniki różnią się szczegółami, a stronnictwo zmienia wizerunek tam, gdzie wynika to z jego nazwy (np. maska Świetlistych, blizna „Bez Numeru”). Karty ras nie opisują wyglądu, więc wizerunki są propozycją wyprowadzoną z lore — uzasadnienie przy każdej rasie jest na początku pliku. Podgląd wszystkich: `tools/race-gallery/`.

## Kroki

| Krok | Co dodaje |
|---|---|
| [`step1-scene`](./step1-scene) | Scena, kamera, renderer, gwiazdy, planeta na orbicie, placeholder statku |
| [`step2-movement`](./step2-movement) | Sterowanie statkiem (WASD + bezwładność), kamera trzecioosobowa "na sprężynie" |
| [`step3-ships`](./step3-ships) | Prawdziwe modele statków (glTF), wybór z 4 statków, zaokrętowanie, fizyka skalowana rozmiarem modelu |
| [`step4-stellar-physics`](./step4-stellar-physics) | Układ potrójny (prawdziwa fizyka N-ciał, integracja leapfrog), sztuczne oświetlenie statku, tło gwiazd i mgławic, kolizje, gruz, dashboard gracza (telemetria + komunikaty załogi) |
| [`step5-encounters`](./step5-encounters) | Rasy i statystyki (z kart ras), walka, NPC-e i **demo fabularne**: kontakt sojusznika, przechwycenie, atak wrogiego statku |
| [`step6-warp`](./step6-warp) | **Napęd fałdowy** dla wszystkich statków: wejście w fałdę, relatywistyczna aberracja gwiazd, sygnatura skoku zależna od rasy, NPC wchodzą/odlatują przez fałdę, eskorta skacze z graczem |
| [`step7-weapons`](./step7-weapons) | **Uzbrojenie**: 5 broni o różnej mechanice (działko, rakiety z namierzaniem, torpedy Grot i Trójząb z głowicą, która gubi cel, torpeda z implozją), system **Ciepła** z kart ras, broń rasowa NPC |
| [`step8-star-systems`](./step8-star-systems) | **Układy gwiezdne**: 5 układów (m.in. prawdziwa Gwiazda Teegardena, para z dyskiem akrecyjnym, nadolbrzym), dużo większe gwiazdy, proceduralne powierzchnie gwiazd (granulacja, plazma, protuberancje, rozbłyski) i planet, skok międzygwiezdny |
| [`step9-missions`](./step9-missions) | **Misje, taktyczne AI i audio**: 7 scenariuszy (przechwycenie, blokada, odparcie 10 wrogów, eskorta handlowca, zasadzka, pościg, łowy watahy) z osobną **tablicą misji** po okładce, **wataha** skrzydłowych rasy gracza z rozkazami, nowy mózg NPC (ocena ryzyka/nagrody, role w eskadrze, uniki, odwrót zamiast samobójstwa), poziomy trudności, **warstwa audio** (muzyka generatywna, fałda z głosem każdej rasy, ostrzeżenia, powiadomienia, walka) |
| [`step10-economy`](./step10-economy) | **Ekonomia**: pas planetoid (klasy C/S/M) przy każdym układzie, promień wydobywczy i ładownia, **stacje orbitalne** (magazyn, stacja przeładunkowa z rynkiem, dok roju), holowniki między stacjami, **roje autonomicznych dronów górniczych** lądujących na obracających się skałach, **rabusie**: naloty na kopalnie (taktyczne AI poluje na drony i łupi stacje), ewakuacja rojów, platformy obronne, nagrody za zestrzelonych, symulacja zaoczna innych układów, zapis w przeglądarce |
| [`step11-dominacja`](./step11-dominacja) | **Dominacja — gra główna**: gospodarka jako główna płaszczyzna w duchu RTS-ów. 25 pól surowcowych w 5 układach odkrywanych czujnikami, **rasy jako gracze ekonomiczni** (ekspansja, rozbudowa placówek, floty), rywalizacja o pola prowadzi do żądań, paktów, sojuszy i **wojen**; placówki i roje ras widoczne w układzie, **stocznia i flota** gracza (obrona, podbój), **mapa strategiczna z dyplomacją** (M), portrety ras i ikony SVG, zwycięstwo przy 50% sektora |

Każdy krok ma własny `README.md` z wyjaśnieniem *dlaczego* kod wygląda tak,
jak wygląda — nie tylko *co* robi.

## `shared/`

Zasoby współdzielone między krokami.

```
shared/
├── ships/
│   ├── models/    gotowe .glb (LOD0/1/2) - to wczytuje gra
│   ├── source/    proceduralne generatory .js - "source of truth" dla modeli
│   ├── fleet.js   lista statków, orientacja dziobu, kadrowanie kamery (kroki 3+4)
│   └── lod_helper.js
├── audio/                 warstwa audio (krok 9), cała syntezowana - bez plików dźwiękowych
│   ├── audio.js           silnik: szyny, pogłos, odblokowanie po geście, odległość, limity
│   ├── sfx.js             przepisy dźwięków + głos fałdy każdej rasy
│   ├── music.js           muzyka generatywna: nastroje, intensywność walki
│   ├── game-audio.js      stan gry -> dźwięk (dashboard, komunikator, fałda, alarmy, walka)
│   └── audio-controls.js  przycisk głośnika + suwaki (okładka, tablica misji, gra)
├── physics/
│   └── n-body.js          generyczny silnik grawitacji N-ciał (leapfrog)
├── data/
│   ├── races.js            rasy, stronnictwa, relacje, statystyki (jedno miejsce do strojenia)
│   ├── economy.js          metale, klasy planetoid, stacje, drony, rynek (krok 10)
│   └── galaxy.js           znany wszechświat: 12 000 układów, domeny ras, rdzenie, koalicje
└── systems/
    ├── triple-star-system.js   konkretny układ potrójny (masy, orbity, wizualizacja)
    ├── space-background.js     gwiazdy + mgławice "w nieskończoności" (krok 4)
    ├── debris-field.js         gruz i meteoryty (ciała stałe)
    ├── collision.js            twarda bariera: statek nie wchodzi w ciała stałe
    ├── dashboard.js            komunikaty załogi (dashboard gracza)
    ├── combat.js               pociski, trafienia, efekty (krok 5; naprowadzanie, wybuchy, promienie - krok 7)
    ├── npc-ships.js            statki NPC: sojusznicy i wrogowie z prostym AI (krok 5; mózg taktyczny, omijanie przeszkód - krok 9)
    ├── comms.js                komunikator: rozmowy z wyborami (krok 5)
    ├── target-labels.js        etykiety celów na ekranie (krok 5)
    ├── encounters.js           reżyser scen fabularnych (krok 5)
    ├── warp-drive.js           napęd fałdowy: efekt skoku dla każdego statku (krok 6)
    ├── weapons.js              uzbrojenie: 5 broni, ciepło, namierzanie, broń rasowa NPC (krok 7)
    ├── star-systems.js         5 układów ciał niebieskich, ogólny interfejs układu (krok 8)
    ├── star-surface.js         proceduralne gwiazdy: granulacja, plazma, korona, protuberancje (krok 8)
    ├── planet-surface.js       proceduralne planety i pierścienie (krok 8)
    ├── tactical-ai.js          mózg NPC: wybór celu, role eskadry, uniki, odwrót, temperament ras (krok 9)
    ├── wolfpack.js             wataha: skrzydłowi rasy gracza i rozkazy (krok 9)
    ├── missions.js             7 misji, zagłuszacze fałdy, cele i znaczniki (krok 9)
    ├── asteroid-belt.js        pas planetoid: złoża, kształt, powierzchnia, ślady wydobycia (krok 10)
    ├── economy.js              gospodarka: stacje, rynek, logistyka, roje dronów, zapis (krok 10)
    ├── economy-visuals.js      stacje, drony, iskry, promień wydobywczy (krok 10)
    ├── economy-panel.js        panel przemysłu (krok 10)
    ├── raids.js                rabusie i ataki ras na kopalnie, raporty (krok 10-11)
    ├── fields.js               pola surowcowe: 5 na układ, charakter, wartość (krok 11)
    ├── strategy.js             rasy jako gracze ekonomiczni, relacje, wojny, dyplomacja (krok 11)
    ├── rival-presence.js       placówki i roje ras w układzie gracza (krok 11)
    ├── army.js / army-panel.js stocznia i flota gracza (krok 11)
    └── strategic-map.js        mapa strategiczna: sektor, dyplomacja, kronika (krok 11)
```

Szczegóły floty: [`shared/ships/README.md`](./shared/ships/README.md).
Szczegóły fizyki układu gwiezdnego: [`step4-stellar-physics/README.md`](./step4-stellar-physics/README.md).

## `tools/`

Narzędzia deweloperskie/QA, nie kroki gry (nienumerowane, nie wchodzą
w postęp fabularny). [`tools/ship-gallery`](./tools/ship-gallery) —
wszystkie 4 statki naraz, ta sama perspektywa (za plecami, z góry,
proporcjonalnie do rozmiaru każdego statku). Przydatne do porównania floty
i do szybkiej diagnozy, gdy któryś model się nie ładuje.

[`tools/galaxy-map`](./tools/galaxy-map) — mapa znanego wszechświata z
`shared/data/galaxy.js`: domeny ras, układy core'owe, stolice, militaryzacja,
dostęp dla wybranej rasy i symulacja kampanii koalicji (odwrót, przeniesienie
stolicy, odbudowa). Zasady w jej README, testy: `node tools/galaxy-map/check.mjs`.

[`tools/audio-lab`](./tools/audio-lab) — odsłuch całej warstwy audio: każdy
dźwięk, nastroje muzyki, suwak intensywności walki, pełny skok fałdy dla każdej
rasy. Test bez słuchania (render offline + pomiary): `node tools/audio-lab/check.mjs`
(pakiet `node-web-audio-api`).

[`tools/browser-check`](./tools/browser-check) — dymny test w headless Chromium
(Playwright): okładka → tablica misji → gra, audio, kroki 5–8.
`node tools/browser-check/check.mjs`; zrzuty ekranu w `tools/browser-check/out/`.

## Sterowanie (od step3-ships)

Mysz — celowanie (pitch/yaw, względem środka ekranu, bez pointer lock).
W/S — ciąg. A/D — przechył (roll). Shift — boost. Spacja — hamulec.
1-4 — zaokrętowanie (od step3-ships). Krok 5 dodaje: F/LPM — ogień, Z/X/C — komunikator, 7/8/9 — sceny, 0 — demo od nowa. Krok 6 dodaje: J — skok fałdowy, K — parada fałdy. Krok 7 dodaje: Q/E lub kółko — zmiana broni. Krok 8 dodaje: U — skok międzygwiezdny, M — mapa. Krok 9 dodaje: N — powrót na tablicę misji, Enter — misja jeszcze raz, L — wataha, G/H/V/B — rozkazy watahy (cel, kleszcze, osłona, szyk), O — dźwięk.

**Android (kroki 3-5):** pierwsze dotknięcie włącza pełny ekran i blokadę poziomu; w pionie pokazuje się podpowiedź „Obróć telefon w poziom” (`shared/input/android-landscape.js`).

## Wersja three.js

Cały projekt trzyma się jednej wersji three.js (`0.184.0`) przez importmapy
w każdym `index.html`, żeby uniknąć niespójności API między krokami.
