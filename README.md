# Krok 1 — Scena kosmiczna

Pierwszy krok w budowie gry: pusta, ale klimatyczna scena 3D z gwiazdami,
gwiazdą-słońcem, orbitującą planetą i placeholderem statku gracza.

## Jak uruchomić

Moduły ES (`import`) nie działają po prostu z otwarcia pliku `index.html`
w przeglądarce (`file://`) — przeglądarka blokuje to z powodów bezpieczeństwa.
Potrzebny jest lokalny serwer HTTP. Najprościej:

```bash
# Jeśli masz Node.js:
npx serve .

# Albo Python 3:
python3 -m http.server 8080
```

Potem otwórz w przeglądarce adres, który wypisze konsola (zwykle
`http://localhost:3000` albo `http://localhost:8080`).

## Co tu jest i dlaczego

- **Scene / Camera / Renderer** — trzy obowiązkowe elementy każdej sceny
  three.js. Scene to kontener na obiekty, Camera określa z jakiej
  perspektywy patrzymy, Renderer rysuje to na `<canvas>`.
- **Gwiazdy (`THREE.Points`)** — zamiast tysięcy osobnych obiektów,
  używamy jednej geometrii z tysiącami punktów. To fundamentalna technika
  wydajnościowa w grach 3D — im więcej obiektów, tym ważniejsze
  "batchowanie" (łączenie w jedną geometrię).
- **Oświetlenie** — `AmbientLight` (słabe światło "wszędzie") +
  `PointLight` (punktowe źródło, jak gwiazda). W kosmosie nie ma
  rozproszonego światła atmosfery, więc kontrast światło/cień jest mocny —
  to celowe, buduje klimat.
- **Orbita planety** — prosta trygonometria (`cos`/`sin`) zamiast fizyki.
  To wystarczy na start; realną grawitację/orbity Keplera dodamy później,
  jeśli zechcesz.
- **`THREE.Clock` i `delta`** — ruch niezależny od liczby klatek na
  sekundę. Zawsze mnożymy prędkość przez `delta`, inaczej gra działałaby
  szybciej na mocniejszym sprzęcie.
- **`OrbitControls`** — tymczasowa kamera do oglądania sceny. W kroku 2
  zastąpimy ją kamerą trzecioosobową podążającą za statkiem.

## Co dalej (Krok 2)

Sterowanie statkiem: WASD/strzałki do ruchu, kamera trzecioosobowa
"na sprężynie" za statkiem, podstawowa fizyka (bezwładność, żeby ruch
w kosmosie czuć było inaczej niż na ziemi).
