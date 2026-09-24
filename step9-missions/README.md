# Krok 9 — Misje, wataha i taktyczne AI

Krok 8 + tablica misji (7 scenariuszy), **wataha** (skrzydłowi rasy gracza
walczący w skoordynowany sposób), nowy mózg NPC w
`shared/systems/tactical-ai.js` i **warstwa audio** (`shared/audio/`). Kroki 5–8 zachowują stare, proste AI —
nowy mózg włącza się tylko wtedy, gdy krok przekaże `tactics` do
`createNpcManager`.

## Przepływ: intro → tablica misji → gra

Okładka (`index.html`) → **Graj** → **tablica misji** (`missions.html`,
osobna strona) → gra. Tablica pokazuje odprawę każdej misji: schemat
taktyczny, cel, warunek porażki, wskazówkę i poziom zagrożenia. Tam też
wybiera się statek (czyli rasę załogi), trudność przeciwników, watahę i
układ. Gra dostaje wszystko w adresie:

```
step9-missions/?misja=waves&statek=goniec-wybudzeni-hawk-7&trudnosc=trudna&wataha=1&uklad=teegarden
```

**Dlaczego tablica wyszła z gry.** Jako nakładka w locie była jedną linijką
na misję i nie miała miejsca na odprawę. Statek zmieniało się już po starcie
(przeładowanie modelu i restart misji). Teraz wybór dzieje się przed
startem, a link do konkretnej misji da się komuś wysłać. Bez `misja=` gra
startuje jako wolny lot. Tablica zapamiętuje ostatnie wybory.

## Sterowanie (dodatki do kroku 8)

| Klawisz | Akcja |
|---|---|
| **N** | powrót na tablicę misji (w trakcie misji trzeba nacisnąć dwa razy) |
| **Enter** | po zakończonej misji: ta sama misja jeszcze raz |
| **R** | po śmierci: odrodzenie, a jeśli trwała misja, to ta sama misja od nowa |
| **L** | wezwij / odeślij watahę |
| **G** | wataha: atak na mój cel (namierzony broń albo najbliższy przed dziobem) |
| **H** | wataha: kleszcze — skrzydła wchodzą z dwóch flank |
| **V** | wataha: osłona — trzymają się przy graczu i biją tych, którzy go atakują |
| **B** | wataha: szyk — powrót do formacji |
| **O** | dźwięk: wycisz / włącz (suwaki: przycisk głośnika w prawym górnym rogu) |
| **7 / 8 / 9 / 0 / K** | jak wcześniej (sceny demo) — przerywają aktywną misję |

Na tablicy misji: ↑ ↓ to wybór misji, statek klikiem, T trudność, W wataha,
Enter start, Esc powrót do intro. Na dotyku: przyciski **Misje** (tablica)
i **Rozkaz** (rozkazy przełączają się po kolei).

## Misje (`shared/systems/missions.js`)

| Misja | Cel | Porażka | Co wymusza |
|---|---|---|---|
| **Przechwycenie** | unieruchomić kuriera (poniżej 35% kadłuba zdycha napęd, ale statek żyje) i przez 5 s trzymać się bliżej niż 320 j. z prędkością względną < 90 | zniszczyć kuriera; pozwolić mu naładować fałdę (ładuje, gdy gracz jest dalej niż 1600 j.) | dawkowanie ognia zamiast „zestrzel wszystko”; dwóch strażników próbuje odciągnąć |
| **Blokada** | przedrzeć się przez bramę 15,5 tys. j. przed dziobem | zniszczenie | interdyktor zagłusza fałdę (5000 j.) i spowalnia (2600 j.); pikiety wykrywają zależnie od sygnatury — boost zdradza, cichy łuk daje wyższą nagrodę |
| **Odeprzyj atak** | 10 wrogów w trzech falach (3/3/4) z trzech kierunków | zniszczenie | liczy się zabity, wycofany lub odlatujący — przegnanie wroga to też wygrana |
| **Eskorta** | „Karawana” (Kharath, handlowiec) dolatuje do punktu skoku | handlowiec zniszczony; porzucenie go skokiem fałdowym | dwa napady; rabusie celują w handlowca, nie w gracza |
| **Zasadzka** | sygnał SOS jest przynętą: 5 ukrytych statków + zagłuszacz | zniszczenie | wykrywanie po czujnikach; atak naraz (< 1500 j.); wygrana to rozbicie zasadzki albo ucieczka (> 8000 j.), a nawet ominięcie jej po wykryciu |
| **Pościg** | zgubić 3 łowców (> 7500 j. przez 3 s) albo skoczyć, gdy zagłuszacz nie sięga | zniszczenie | łowcy mają sprint (780 j./s przez 7 s), który się przegrzewa — okna na ucieczkę; co 45 s posiłki zajeżdżają drogę z przodu |
| **Łowy watahy** | wataha rusza automatycznie; rozbić frachtowiec „Brzemię” z 3 eskortowcami, zanim skoczy | frachtowiec ucieka | ćwiczy rozkazy G/H/V/B; po 45 s przylatują posiłki |

Stan misji pokazuje panel na górze ekranu, a cele znaczniki na etykietach.
Zmiana układu albo scena demo przerywa misję bez kary. Śmierć kończy misję,
a R zaczyna ją od nowa. Dane odprawy (`brief`, `win`, `lose`, `tip`,
`threat`, `tags`, `pack`) są w `MISSIONS`, obok logiki misji.

## Taktyczne AI (`shared/systems/tactical-ai.js`)

**Dlaczego osobny moduł, a nie więcej `if`-ów w `npc-ships.js`.**
`npc-ships.js` odpowiada za fizykę i sterowanie (jak lecieć), mózg za decyzje
(dokąd i po co). Mózg zwraca *intencję* — punkt, prędkość, czy strzelać, czy
się wycofać — i nie dotyka pozycji statku. Dzięki temu jeden mózg obsługuje
wrogów, sojuszników i watahę, a test w Node może go sprawdzić bez renderera.

**Decyzje (ocena ryzyka / nagrody).** Każdy NPC co ~0,5 s (szybciej na
trudnym poziomie) ocenia wszystkie wrogie kontakty: wartość celu, jego
uszkodzenie, dystans, zemstę (kto mnie ostatnio trafił), obronę kolegi,
wspólny cel eskadry, ryzyko (czy cel patrzy na mnie dziobem), tłok (ilu
już go atakuje). Histereza trzyma cel, żeby statki nie „mrugały” między
dwoma. Wróg przestał celować wyłącznie w gracza — atakuje też sojuszników,
handlowców i watahę.

**Temperament ras.** Agresja, ostrożność, dyscyplina i przebiegłość wzięte
z kart ras (komentarz przy każdej rasie w `TEMPERAMENT`): Heliotropi walczą
w frenzji do końca, Wykonawcy trzymają się doktryny i wycofują się przy
25% kadłuba, Szczepieni odskakują, żeby się zregenerować, Pieśniarze
przewidują tor i flankują, Rezonanci atakują salwami w „oknach”.
Stronnictwa modyfikują temperament (jastrzębie ostrzej, kupcy ostrożniej).

**Dyrektor eskadry.** Statki jednej eskadry dzielą cel i role:
*striker* (w natarciu), *flank* (krąży z boku, czeka na żeton), *bait*
(przynęta ściąga uwagę), *cutoff* (odcina drogę ucieczki w pościgu). Na
gracza naraz nacierają najwyżej 1/2/3 statki (łatwa/normalna/trudna) —
reszta krąży „karuzelą” po slotach flankowych i zmienia się z tymi, którzy
odchodzą po przelocie. Presja nie spada (w teście: 42 trafienia w 90 s),
ale gracz nie dostaje ognia z sześciu luf naraz.

**Kreatywność.** Drugi cel zamiast ślepego uporu, wejście od rufy,
różne manewry odejścia po przelocie, przynęta, kleszcze, orbita
dystansowa dla statków z rakietami i torpedami (nie lecą w zwarcie z
bronią, która tego nie potrzebuje).

**Nietragiczność.** Rozumiem to jako: NPC nie robią rzeczy samobójczych ani
absurdalnych. Konkretnie:

- omijają planety i gwiazdy (unikanie + twarda bariera w `resolveCollisions`),
  nie zlewają się w jeden punkt (separacja);
- robią uniki przed rakietami i torpedami (`combat.incoming()` mówi, co i kiedy
  w nich trafi; naprowadzane — zwrot poprzeczny, obszarowe — ucieczka z pola);
- „jinkują” w celowniku gracza, zamiast lecieć po prostej;
- wycofują się, gdy ryzyko przerasta nagrodę — pojedynczo (kadłub vs
  ostrożność rasy) albo całą eskadrą (stosunek sił); wycofany wróg w misji
  *Odeprzyj atak* liczy się jako odparty;
- ranny kolega dostaje osłonę;
- skrzydłowi watahy nie uciekają samotnie — chowają się w szyku przy graczu.

**Poziom trudności** (`DIFFICULTY`): czas reakcji 0,75 / 0,45 / 0,28 s,
liczba żetonów natarcia 1 / 2 / 3, skuteczność uników 45 / 80 / 100%, siła
jinkowania.

## Wataha (`shared/systems/wolfpack.js`)

Trzech skrzydłowych rasy gracza (znaki: Kieł, Szron, Basior…) w szyku V.
Używają tego samego mózgu co wrogowie (`base: 'pack'`, eskadra `pack`), więc
koordynację dostają za darmo: wspólny cel, żetony, flanki. Rozkazy nakładają
się na dyrektora eskadry:

- **Swobodne łowy** — dyrektor sam wybiera cele (domyślnie);
- **Atak na mój cel (G)** — wszyscy biją cel gracza;
- **Kleszcze (H)** — skrzydła rozchodzą się łukiem i wchodzą z dwóch stron;
- **Osłona (V)** — priorytet mają ci, którzy strzelają do gracza;
- **Szyk (B)** — przerywają walkę i wracają do formacji.

Skrzydłowi meldują się przez dashboard (cel, osłona, odwrót do szyku).
Statek (= rasa kapitana i watahy) wybiera się na tablicy misji i leci nim
całą misję, do sukcesu albo porażki. W grze nie ma już przełączania 1–4;
zmiana statku to powrót na tablicę (N) i nowy start.

## Audio (`shared/audio/`)

Cała warstwa jest **syntezowana** w Web Audio, bez plików dźwiękowych.
Powody: repo nie ma nagrań (więc nie ma licencji do pilnowania), dźwięk może
zależeć od stanu gry, a nic nie trzeba ładować.

| Moduł | Rola |
|---|---|
| `audio.js` | silnik: szyny, pogłos, ogranicznik, odblokowanie po geście, odległość/panorama, limit powtórzeń i głosów, alarmy cykliczne |
| `sfx.js` | przepisy wszystkich dźwięków + `WARP_VOICE` (głos fałdy każdej rasy) |
| `music.js` | muzyka generatywna: nastroje, intensywność walki, przerywniki |
| `game-audio.js` | tłumaczy stan gry na dźwięk (dashboard, komunikator, fałda, alarmy, misja, walka, muzyka) |
| `audio-controls.js` | przycisk głośnika + suwaki, ten sam na okładce, tablicy i w grze |

**Miks.** Są trzy szyny z osobnymi suwakami: **Muzyka**, **Efekty** (fałda,
broń, wybuchy) i **Komunikaty** (interfejs, powiadomienia, ostrzeżenia).
Ostrzeżenia celowo idą po szynie Komunikaty. Gracz, który ściszy muzykę i
efekty, nadal usłyszy alarm kadłuba. Pogłos śledzi suwak swojej szyny, więc
ściszona muzyka nie zostawia „ogona”. Ustawienia są wspólne dla wszystkich
stron (localStorage).

**Muzyka.** Wszystkie nastroje są w d-moll, więc przejście intro → tablica →
gra nie zmienia utworu, tylko jego gęstość:
- *cover* — wolny pad i dzwonki;
- *briefing* — ósemkowy bas, tykanie i akord A-dur, który ciągnie do d-moll lotu;
- *flight* — pad i dzwonki, plus warstwy walki;
- *aftermath* — po śmierci.

W locie warstwy walki wchodzą przy kolejnych progach intensywności: bas →
stopa → hi-hat → arpeggio → werbel → przejścia na kotłach. Intensywność
liczy `game-audio.js` z wrogów w promieniu 4000 j., świeżych trafień i
naprowadzanych pocisków. Rośnie w ~1 s, a opada wolniej, żeby walka
„wybrzmiała”. Nastrój zmienia się na granicy taktu. Przerywniki: zaliczona
(tercja pikardyjska), nieudana, śmierć.

**Fałda.** Ładowanie wspina się o dwie oktawy z przyspieszającym tremolo, po
nim zanurzenie i tunel (dron za „oddychającym” filtrem). Zatrzaśnięcie
wychodzi z `warp-drive.js` (hak `onSlam`). Dzięki temu słychać też przyloty
i odloty NPC, z odległością. Każda rasa ma własny głos (`WARP_VOICE`, ta sama
idea co wizualne sygnatury skoku): Wybudzeni nisko, z czystą kwintą;
Szczepieni z trytonem i chropowatością; Świetliści szklani. W czasie skoku
muzyka jest przyciszona.

**Ostrzeżenia i powiadomienia.** Karty dashboardu grają dźwięk tylko przy
pojawieniu się albo wzroście pilności (dashboard odświeża je ~10 razy na
sekundę). Barwa rośnie z zagrożeniem: dzwonek (info), dwa tony (uwaga), piła
(zagrożenie). Kanały z własnym dźwiękiem:
- alarm kadłuba poniżej 30%, co 2,4 s;
- rakieta naprowadzana na nas — piknięcia tym szybsze, im bliżej;
- przegrzanie, zablokowany skok, namiar i jego utrata;
- napęd znów gotowy;
- komunikator, meldunki watahy;
- start misji, nowy cel, zasadzka.

**Walka.** Wystrzały każdej broni (haki `onFire`/`onBlast` w `weapons.js`,
także NPC), trafienia w nas i w nich, wybuchy statków, implozja. Dźwięki mają
odległość (umowną — w próżni nic nie słychać, ale gra potrzebuje dystansu)
i panoramę względem kamery.

**Przeglądarki** blokują dźwięk do pierwszego gestu. Silnik tworzy kontekst
przy pierwszym kliknięciu albo klawiszu i do tego czasu ignoruje wywołania.
Przycisk głośnika ma wtedy pomarańczową kropkę. W karcie w tle kontekst jest
wstrzymany. Przed przejściem na inną stronę muzyka jest wyciszana (0,45 s),
żeby nie urwała się w pół dźwięku.

## Zmiany w modułach współdzielonych

- `combat.js`: `incoming(position, radius, side, horizon)` — najgroźniejszy
  pocisk lecący w dany punkt (czas do najbliższego zbliżenia, czy naprowadzany,
  czy obszarowy).
- `weapons.js`: `PLAYER_SHOOTER` — jeden stały obiekt strzelca gracza, żeby mózg
  mógł rozpoznać „kto mnie trafił” (zemsta, obrona kolegi).
- `warp-drive.js`: opcja `onSlam(position, sig)` (audio zatrzaśnięcia fałdy).
- `weapons.js` (audio): opcje `onFire(id, origin, side)` i `onBlast(kind, position, size)`.
- `npc-ships.js`: opcje `tactics` i `getObstacles`; nowe pola spawnu (`hull`,
  `ai`, `stealth`, `disableAt`, `role`, `tag`, `value`…); `damage(npc, amount,
  shooter)`, zdarzenia `hit`/`disabled`, omijanie przeszkód, separacja,
  regeneracja rasowa. Bez `tactics` kroki 5–8 działają jak wcześniej.

## Jak to sprawdzono

```bash
node step9-missions/check.mjs      # misje i AI (symulacja w Node)
node tools/audio-lab/check.mjs     # audio: render offline + pomiary
node tools/browser-check/check.mjs # intro -> tablica -> gra w headless Chromium
```

Pierwszy test wymaga `three@0.184.0` w `node_modules` (np. `npm i three@0.184.0`
w katalogu nadrzędnym; repo nie ma `package.json`). Symulacja idzie bez
przeglądarki: atrapy DOM, deterministyczny generator losowy, bot zamiast gracza.

1. **Każda misja da się wygrać** (bot nieśmiertelny — test logiki misji) i
   **każda da się przegrać** tam, gdzie porażka coś znaczy: kurier bez pościgu
   ucieka, handlowiec bez gracza ginie, cichy łuk przez blokadę daje „niezauważeni”.
2. **Zachowanie AI**: nikt nie wchodzi w planetę, statki trzymają minimalny
   odstęp, w natarciu jest najwyżej 2 z 6, reszta krąży na flankach. NPC robią
   uniki przed rakietami. Ostrożne rasy się wycofują, Heliotropi nie,
   Szczepieni odskakują na regenerację.
3. **Uczciwa walka** (bot śmiertelny, trudność normalna) — tylko raport, nie
   test. Bot leci prosto i strzela, bez uników i bez sprytu, więc blokada,
   fale i zasadzka go zabijają. Żywy gracz ma boost, hamulec, 5 broni i watahę.
   To raczej sygnał, że misje nie są trywialne, niż pomiar balansu.

**Audio** (`tools/audio-lab/check.mjs`, pakiet `node-web-audio-api`). Każdy
dźwięk i nastrój jest renderowany do bufora i mierzony. Test sprawdza, że:
- każdy dźwięk gra, bez NaN i bez przesterowania;
- dźwięki ciągłe fałdy trwają, dopóki gra ich nie zatrzyma, i potem gasną;
- 7 głosów fałdy brzmi różnie;
- każdy nastrój mieści się w miksie, a intensywność walki zagęszcza muzykę;
- suwaki, wyciszenie i odległość działają;
- alarm słychać przy wyzerowanej muzyce i efektach;
- 30 powiadomień naraz nie sumuje się w przester.

**Przeglądarka** (`tools/browser-check/check.mjs`, Playwright + Chromium;
three.js podmieniane z lokalnego `node_modules`). Test sprawdza:
- „Graj” prowadzi na tablicę, a każda misja ma odprawę i schemat;
- klawisze tablicy budują poprawny adres gry;
- na telefonie w pionie tablica nie przewija się w bok;
- gra startuje z misją, statkiem, watahą i układem z adresu;
- audio rusza po kliknięciu, a muzyka gęstnieje po trafieniu;
- skok przechodzi wszystkie fazy;
- po śmierci zmienia się nastrój, a R odradza;
- Enter powtarza misję, N wraca na tablicę z tymi samymi ustawieniami;
- audio lab gra każdy dźwięk bez wycieku głosów;
- żadna strona nie ma błędów w konsoli.

Ostatnia sekcja testu przeładowuje kroki 5–8 (wczytanie, ogień, skok), bo
zmieniły się wspólne moduły. Zrzuty ekranu trafiają do
`tools/browser-check/out/`.

**Czego nie sprawdzono:**
- Nikt nie **słuchał** dźwięku. Testy mówią tylko, że sygnał jest poprawny
  technicznie. Do odsłuchu służy `tools/audio-lab/` w przeglądarce: każdy
  dźwięk, nastroje, suwak intensywności, pełny skok dla każdej rasy.
- Balans głośności między szynami i sama estetyka wymagają ucha.
- Gra na prawdziwym GPU i telefonie (test szedł na programowym renderze
  SwiftShader).
- Balans misji z żywym graczem. Liczby (kadłuby, zasięgi zagłuszaczy, sprint
  łowców) są w jednym miejscu na misję w `MISSIONS` — tam się je stroi.
