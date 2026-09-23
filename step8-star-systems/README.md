# Krok 8 — Układy gwiezdne

Krok 7 + pięć układów ciał niebieskich, dużo większe gwiazdy i proceduralne
powierzchnie gwiazd (granulacja, plazma, obłoki materii) oraz planet.
Kroki 4–7 celowo zostają przy starym układzie potrójnym z jednolitymi kulami.

## Sterowanie (dodatki do kroku 7)

| Klawisz | Akcja |
|---|---|
| **U** / **Następny układ** (dotyk) | skok międzygwiezdny do następnego układu |
| **M** | mapa układów (klik = skok) |
| `?uklad=teegarden` w adresie | start w wybranym układzie (`potrojny`, `teegarden`, `blizniaki`, `symbiotyczny`, `nadolbrzym`) |

## Układy (`shared/systems/star-systems.js`)

| Układ | Zawartość |
|---|---|
| **Teegarden-B: układ potrójny** | układ z kroków 4–7, powiększony: gwiazda G (1600 j.) + biały karzeł w ciasnej parze, czerwony olbrzym (15 000 j.), planeta oceaniczna z księżycem |
| **Gwiazda Teegardena** | prawdziwy układ, od którego gra ma nazwę: czerwony karzeł M7, planety b, c, d z proporcjami okresów jak w rzeczywistości (~1 : 2,3 : 4,5); karzeł często rozbłyskuje |
| **Bliźnięta** | para G + K, pas planetoid (z kolizjami), gazowy olbrzym z pierścieniami i dwoma księżycami (lawowy, lodowy), lodowa planeta |
| **Oddech olbrzyma** | układ symbiotyczny: olbrzym wypełnia płat Roche'a (deformacja w „łzę”), strumień materii płynie przez punkt L1 do dysku akrecyjnego wokół białego karła |
| **Błękitny nadolbrzym** | gwiazda o promieniu 30 000 j. (ponad 150 długości Kharatha), planeta lawowa i gazowy olbrzym z pierścieniami |

Fizyka: ten sam silnik N-ciał (leapfrog). G każdego układu z III prawa
Keplera dla orbity odniesienia. Planety okołopodwójne leżą dalej niż ~3,5 ×
separacja pary (granica stabilności). Separację układu symbiotycznego
dobrano wzorem Eggletona tak, żeby olbrzym wypełniał swój płat Roche'a, a
punkt L1 z przybliżenia 0,5 − 0,227·log₁₀(q).

Uproszczenia: księżyce krążą kinematycznie (planeta jest cząstką testową bez
masy), a pas planetoid obraca się jak ciało sztywne.

## Powierzchnie gwiazd (`shared/systems/star-surface.js`)

Bez plików tekstur — wszystko liczy shader:

- **Granulacja**: komórki konwekcyjne (szum Worleya) z „oddychającymi”
  środkami, plus supergranule. Z daleka drobny detal płynnie wygasa
  (`fwidth`), zamiast migotać.
- **Olbrzymie komórki konwekcji** czerwonych olbrzymów (kilka na tarczę,
  jak na Betelgezie).
- **Plazma**: pole przepływu (zawirowana domena), po którym płyną wszystkie
  warstwy, i jasne włókna.
- **Plamy** z cieniem i półcieniem, pochodnie przy brzegu, pociemnienie
  brzegowe, rotacja różnicowa (równik szybciej niż bieguny).
- **Korona** ze smugami, chromosfera ze spikulami, a u olbrzymów **obłoki
  materii**: grudkowata otoczka gazu i pyłu.
- **Protuberancje**: pętle plazmy, które rosną, żyją i gasną albo są
  wyrzucane w przestrzeń.
- **Rozbłyski**: łata powierzchni, korona i światło gwiazdy rozjaśniają się
  naraz, więc naprawdę doświetlają okolicę.
- Barwa z temperatury (ciało doskonale czarne). Osobna `colorTemp` sprawia,
  że „żółta = G, czerwona = M” czyta się od razu (fizycznie Słońce jest
  niemal białe).

Podgląd każdego typu z bliska i z daleka: `tools/star-lab/`.

## Planety (`shared/systems/planet-surface.js`)

Oceaniczne (z chmurami), skaliste z kraterami, pustynne, lodowe, lawowe
(szczeliny świecą też po nocnej stronie) i gazowe olbrzymy (pasy, burza,
pierścienie z przerwą). Są normalnie oświetlane przez gwiazdy.

## Skok międzygwiezdny

Zwykła sekwencja fałdy z dłuższym przelotem. W połowie tunelu świat jest
podmieniany: nowy układ, nowe niebo (`background.reseed`), nowe pole gruzu.
Niebo jest wtedy przygaszone, a obraz zalewają smugi, więc podmiany nie
widać. Eskorta skacze razem z graczem, a wrogowie zostają w starym układzie.
Zakłócenie napędu blokuje także ten skok. Zasięg zwykłego skoku (J) zależy
od skali układu (15–50 tys. j.).

## Jak zweryfikowano

Headless Chrome (SwiftShader, bez GPU):

- każdy z 5 układów buduje się i symuluje bez błędów,
- skok potrójny → Teegarden kończy się dokładnie w punkcie wejścia,
- zrzuty: G, K, M, olbrzym, nadolbrzym w laboratorium, granulacja z bliska,
  gra po starcie i po skoku.

**Nie** sprawdziłem wydajności na prawdziwym GPU. Shader fotosfery jest
ciężki, kiedy gwiazda wypełnia cały ekran — w SwiftShader jedna klatka z
bliska trwała sekundy. Na telefonach (`pointer: coarse`) jakość jest
obniżona (mniej protuberancji i planetoid), ale sam shader nie ma jeszcze
wersji uproszczonej.

## Optymalizacja

Pomiar przed zmianami pokazał, że **CPU nie jest problemem**: fizyka N-ciał,
AI i walka zajmują 0,1–0,2 ms na klatkę. Całe obciążenie było po stronie
renderu. Zmiany według zysku:

| Zmiana | Plik | Dlaczego |
|---|---|---|
| **LOD dla NPC** (lod0/1/2 wg odległości; progi 2,5 i 9 przekątnych statku) | `npc-ships.js` | Kharath w LOD0 ma 372 tys. trójkątów, w LOD2 22 tys.; z daleka wyglądają tak samo. `lod_helper.js` nie dało się podpiąć (importy npm, nie działają z import mapą), więc LOD jest zbudowany wprost w menedżerze NPC. |
| **Stała pula 2 świateł** dla NPC zamiast światła w każdym statku | `npc-ships.js` | Zmiana liczby świateł zmusza three.js do rekompilacji shaderów wszystkich oświetlonych materiałów (przycięcie przy każdym pojawieniu się NPC), a każde światło kosztuje w każdym pikselu. Światła dostają 2 najbliższe statki. |
| **Szum z tekstur 3D** zamiast liczonego w pikselu | `noise-textures.js`, `star-surface.js`, `planet-surface.js` | Próbka szumu to 1 odczyt tekstury zamiast 8 haszy, komórka Worleya — 1–2 odczyty zamiast pętli po 27 sąsiadach. Tekstury (32³ i 64³) liczone raz przy starcie, współdzielone. Te same nazwy funkcji w GLSL, więc wygląd i logika shaderów się nie zmieniły. |
| **Adaptacyjna rozdzielczość** | `step8-star-systems/main.js` | Poniżej ~48 fps przez 1 s — rozdzielczość sceny −15%; powyżej ~57 fps przez 5 s — +8% (histereza). Minimum 50%, HUD zostaje ostry. Wartość w telemetrii („Rozdzielczość”). `?jakosc=pelna` wyłącza. W VR wyłączone. |
| **Częściowa wysyłka cząstek** | `weapons.js` | Do GPU idzie tylko fragment bufora z nowymi cząstkami, a nie 2400 × 13 liczb co klatkę. |
| Lżejsza siatka fotosfery (128×96 zamiast 160×120) | `star-surface.js` | Mniej wierzchołków bez widocznej różnicy (detal daje shader). |

Wyniki (headless Chrome, SwiftShader — render na CPU, więc czas ≈ koszt
pikseli i geometrii; na GPU liczby bezwzględne są dużo mniejsze, ale
proporcje podobne):

| Scenariusz | Przed | Po |
|---|---|---|
| widok ze startu | 640 ms | 485 ms (−24%) |
| gwiazda wypełnia ekran | 888 ms | 553 ms (−38%) |
| parada 7 NPC | 1752 ms, 342 draw calle, 14 świateł, 7 rekompilacji | 1179 ms (−33%), 190 draw calli, 9 świateł (stałe), 2 rekompilacje |

Parada była mierzona z progami LOD 5/16; po obniżeniu ich do 2,5/9 Kharath
w paradzie przechodzi na LOD1 (130 tys. zamiast 372 tys. trójkątów) —
tego wariantu już nie mierzyłem.

Czego nie zrobiłem: gracz nadal leci pełnym LOD0 (kamera jest blisko, więc
różnica byłaby widoczna). Pilotując Kharatha, rysujesz więc 372 tys.
trójkątów i to jest dziś najdroższy pojedynczy element sceny. Kolejne
kroki, jeśli nadal będzie ciężko: LOD1 dla Kharatha gracza albo
uproszczony model, prekompilacja shaderów przy starcie
(`renderer.compileAsync`) — usunęłaby 2 pozostałe rekompilacje — i
rzadsze odświeżanie koron gwiazd.
