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

Potem otwórz `http://localhost:3000/` — to **okładka gry** (wybór układu startowego, sterowanie, przycisk „Graj” prowadzi do najnowszego kroku). Dziennik budowy ze wszystkimi krokami jest w `dev.html`, a konkretny krok otworzysz np. pod `http://localhost:3000/step3-ships/`.

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
| [`step7-weapons`](./step7-weapons) | **Uzbrojenie**: 5 broni o różnej mechanice (działko, śrutownica, lanca, rakiety z namierzaniem, torpeda z implozją), system **Ciepła** z kart ras, broń rasowa NPC |
| [`step8-star-systems`](./step8-star-systems) | **Układy gwiezdne**: 5 układów (m.in. prawdziwa Gwiazda Teegardena, para z dyskiem akrecyjnym, nadolbrzym), dużo większe gwiazdy, proceduralne powierzchnie gwiazd (granulacja, plazma, protuberancje, rozbłyski) i planet, skok międzygwiezdny |

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
├── physics/
│   └── n-body.js          generyczny silnik grawitacji N-ciał (leapfrog)
├── data/
│   └── races.js            rasy, stronnictwa, relacje, statystyki (jedno miejsce do strojenia)
└── systems/
    ├── triple-star-system.js   konkretny układ potrójny (masy, orbity, wizualizacja)
    ├── space-background.js     gwiazdy + mgławice "w nieskończoności" (krok 4)
    ├── debris-field.js         gruz i meteoryty (ciała stałe)
    ├── collision.js            twarda bariera: statek nie wchodzi w ciała stałe
    ├── dashboard.js            komunikaty załogi (dashboard gracza)
    ├── combat.js               pociski, trafienia, efekty (krok 5; naprowadzanie, wybuchy, promienie - krok 7)
    ├── npc-ships.js            statki NPC: sojusznicy i wrogowie z prostym AI (krok 5)
    ├── comms.js                komunikator: rozmowy z wyborami (krok 5)
    ├── target-labels.js        etykiety celów na ekranie (krok 5)
    ├── encounters.js           reżyser scen fabularnych (krok 5)
    ├── warp-drive.js           napęd fałdowy: efekt skoku dla każdego statku (krok 6)
    ├── weapons.js              uzbrojenie: 5 broni, ciepło, namierzanie, broń rasowa NPC (krok 7)
    ├── star-systems.js         5 układów ciał niebieskich, ogólny interfejs układu (krok 8)
    ├── star-surface.js         proceduralne gwiazdy: granulacja, plazma, korona, protuberancje (krok 8)
    └── planet-surface.js       proceduralne planety i pierścienie (krok 8)
```

Szczegóły floty: [`shared/ships/README.md`](./shared/ships/README.md).
Szczegóły fizyki układu gwiezdnego: [`step4-stellar-physics/README.md`](./step4-stellar-physics/README.md).

## `tools/`

Narzędzia deweloperskie/QA, nie kroki gry (nienumerowane, nie wchodzą
w postęp fabularny). Na razie jedno: [`tools/ship-gallery`](./tools/ship-gallery) —
wszystkie 4 statki naraz, ta sama perspektywa (za plecami, z góry,
proporcjonalnie do rozmiaru każdego statku). Przydatne do porównania floty
i do szybkiej diagnozy, gdy któryś model się nie ładuje.

## Sterowanie (od step3-ships)

Mysz — celowanie (pitch/yaw, względem środka ekranu, bez pointer lock).
W/S — ciąg. A/D — przechył (roll). Shift — boost. Spacja — hamulec.
1-4 — zaokrętowanie (od step3-ships). Krok 5 dodaje: F/LPM — ogień, Z/X/C — komunikator, 7/8/9 — sceny, 0 — demo od nowa. Krok 6 dodaje: J — skok fałdowy, K — parada fałdy. Krok 7 dodaje: Q/E lub kółko — zmiana broni.

**Android (kroki 3-5):** pierwsze dotknięcie włącza pełny ekran i blokadę poziomu; w pionie pokazuje się podpowiedź „Obróć telefon w poziom” (`shared/input/android-landscape.js`).

## Wersja three.js

Cały projekt trzyma się jednej wersji three.js (`0.184.0`) przez importmapy
w każdym `index.html`, żeby uniknąć niespójności API między krokami.
