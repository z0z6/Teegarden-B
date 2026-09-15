# Krok 2 — Ruch statku + kamera trzecioosobowa

## Sterowanie
- **W / ↑** — przyspiesz do przodu
- **S / ↓** — cofaj / hamuj
- **A / ←**, **D / →** — skręt (yaw)
- **Shift** — boost (wyższa maks. prędkość)
- **Spacja** — aktywne hamowanie (szybciej niż naturalne tłumienie)

Uruchamianie tak samo jak w kroku 1 (`npx serve .` albo `python3 -m http.server`).

## Co się zmieniło i dlaczego

**Input handling przez `Set`.** Trzymamy zbiór aktualnie wciśniętych
klawiszy (`keydown`/`keyup`). Dzięki temu można trzymać kilka klawiszy
naraz (np. W + A jednocześnie) bez komplikowania kodu.

**Bezwładność zamiast bezpośredniej zmiany pozycji.** Nie robimy
`ship.position.z -= 1` przy każdym wciśnięciu W. Zamiast tego zmieniamy
`speed` (przyspieszenie), a dopiero `speed` przesuwa statek. To różnica
między "grą jak w Pacmanie" a "grą, która ma czuć ciężar". Podobnie
skręt ma swoją `yawVelocity` z tłumieniem (`turnDrag`) — statek nie
zatrzymuje obrotu w miejscu, tylko płynnie go wygasza.

**`delta` wszędzie.** Każda zmiana prędkości/pozycji jest mnożona przez
czas klatki. Bez tego gra działałaby różnie na różnych ekranach
(60Hz vs 144Hz) — klasyczny, częsty błąd początkujących.

**Bank (przechył) przy skręcie.** `shipBody.rotation.z` reaguje na
`yawVelocity`. To całkowicie kosmetyczne, statek "fizycznie" tego nie
potrzebuje — ale to typowy trik z gier arcade'owych (np. Star Fox,
Rebel Galaxy), który sprawia, że ruch wygląda dynamicznie.

**Kamera na sprężynie (`lerp` zamiast sztywnego przypięcia).** Gdybyśmy
zrobili `camera.position.copy(ship.position).add(offset)` na sztywno,
kamera "kleiłaby się" do statku bez żadnej płynności — przy szybkich
skrętach wyglądałoby to szarpanie. Zamiast tego liczymy pozycję
*docelową* i każdą klatkę przesuwamy kamerę o ułamek dystansu do niej
(`camera.position.lerp(target, factor)`). Ten sam trik stosuje się do
punktu, na który kamera patrzy.

**`Math.min(delta, 0.05)`.** Zabezpieczenie przed sytuacją, gdy
przełączysz kartę przeglądarki na kilka sekund i wrócisz — bez tego
statek "teleportowałby się" do przodu przez ogromną wartość `delta`.

## Do eksperymentowania
Spróbuj zmienić w kodzie:
- `SHIP.acceleration` i `SHIP.drag` — poczuj różnicę między "ciężkim
  frachtowcem" a "zwinnym myśliwcem"
- `cameraOffset` — bliżej/dalej, wyżej/niżej
- `followLerp` (wartość bazowa `0.0001`) — mniejsza = kamera "leniwsza"
  i bardziej filmowa, większa = sztywniejsza i bardziej responsywna

## Co dalej (Krok 3)
Podmienimy stożek na prawdziwy model statku (format glTF), dodamy
kilka statków do wyboru i podstawowy system "zaokrętowania" (przełączanie
się między statkami) — czyli mechanikę, o której wspominałeś na
początku.
