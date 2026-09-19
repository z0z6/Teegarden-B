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

Potem otwórz np. `http://localhost:3000/step3-ships/` w przeglądarce.

## Kroki

| Krok | Co dodaje |
|---|---|
| [`step1-scene`](./step1-scene) | Scena, kamera, renderer, gwiazdy, planeta na orbicie, placeholder statku |
| [`step2-movement`](./step2-movement) | Sterowanie statkiem (WASD + bezwładność), kamera trzecioosobowa "na sprężynie" |
| [`step3-ships`](./step3-ships) | Prawdziwe modele statków (glTF), wybór z 4 statków, zaokrętowanie, fizyka skalowana rozmiarem modelu |
| [`step4-stellar-physics`](./step4-stellar-physics) | Układ potrójny (prawdziwa fizyka N-ciał, integracja leapfrog), sztuczne oświetlenie statku gracza |

Każdy krok ma własny `README.md` z wyjaśnieniem *dlaczego* kod wygląda tak,
jak wygląda — nie tylko *co* robi.

## `shared/`

Zasoby współdzielone między krokami.

```
shared/
├── ships/
│   ├── models/    gotowe .glb (LOD0/1/2) - to wczytuje gra
│   ├── source/    proceduralne generatory .js - "source of truth" dla modeli
│   └── lod_helper.js
├── physics/
│   └── n-body.js          generyczny silnik grawitacji N-ciał (leapfrog)
└── systems/
    └── triple-star-system.js   konkretny układ potrójny (masy, orbity, wizualizacja)
```

Szczegóły floty: [`shared/ships/README.md`](./shared/ships/README.md).
Szczegóły fizyki układu gwiezdnego: [`step4-stellar-physics/README.md`](./step4-stellar-physics/README.md).

## Wersja three.js

Cały projekt trzyma się jednej wersji three.js (`0.184.0`) przez importmapy
w każdym `index.html`, żeby uniknąć niespójności API między krokami.
