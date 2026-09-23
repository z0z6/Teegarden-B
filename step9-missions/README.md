# Krok 9 — Misje, wataha i taktyczne AI

Krok 8 + tablica misji (7 scenariuszy), **wataha** (skrzydłowi rasy gracza
walczący w skoordynowany sposób) i nowy mózg NPC w
`shared/systems/tactical-ai.js`. Kroki 5–8 zachowują stare, proste AI —
nowy mózg włącza się tylko wtedy, gdy krok przekaże `tactics` do
`createNpcManager`.

## Sterowanie (dodatki do kroku 8)

| Klawisz | Akcja |
|---|---|
| **N** | tablica misji (Esc zamyka) |
| **L** | wezwij / odeślij watahę |
| **G** | wataha: atak na mój cel (namierzony broń albo najbliższy przed dziobem) |
| **H** | wataha: kleszcze — skrzydła wchodzą z dwóch flank |
| **V** | wataha: osłona — trzymają się przy graczu i biją tych, którzy go atakują |
| **B** | wataha: szyk — powrót do formacji |
| **7 / 8 / 9 / 0 / K** | jak wcześniej (sceny demo) — przerywają aktywną misję |
| `?trudnosc=latwa` / `normalna` / `trudna` | poziom trudności AI |

Na dotyku: przyciski **Misje** i **Rozkaz** (rozkazy przełączają się po kolei).

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

Stan misji pokazuje panel na górze ekranu, cele — znaczniki na etykietach.
Śmierć, zmiana układu albo scena demo przerywa misję (bez kary).

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
Przy zmianie statku (1–4) wataha zmienia rasę razem z graczem.

## Zmiany w modułach współdzielonych

- `combat.js`: `incoming(position, radius, side, horizon)` — najgroźniejszy
  pocisk lecący w dany punkt (czas do najbliższego zbliżenia, czy naprowadzany,
  czy obszarowy).
- `weapons.js`: `PLAYER_SHOOTER` — jeden stały obiekt strzelca gracza, żeby mózg
  mógł rozpoznać „kto mnie trafił” (zemsta, obrona kolegi).
- `npc-ships.js`: opcje `tactics` i `getObstacles`; nowe pola spawnu (`hull`,
  `ai`, `stealth`, `disableAt`, `role`, `tag`, `value`…); `damage(npc, amount,
  shooter)`, zdarzenia `hit`/`disabled`, omijanie przeszkód, separacja,
  regeneracja rasowa. Bez `tactics` kroki 5–8 działają jak wcześniej.

## Jak to sprawdzono

```bash
node step9-missions/check.mjs
```

Wymaga `three@0.184.0` w `node_modules` (np. `npm i three@0.184.0` w
katalogu nadrzędnym; repo nie ma `package.json`). Symulacja bez przeglądarki:
atrapy DOM, deterministyczny generator losowy, bot zamiast gracza.

1. **Każda misja da się wygrać** (bot nieśmiertelny — test logiki misji) i
   **każda da się przegrać** tam, gdzie porażka coś znaczy: kurier bez pościgu
   ucieka, handlowiec bez gracza ginie, cichy łuk przez blokadę daje „niezauważeni”.
2. **Zachowanie AI**: nikt nie wchodzi w planetę, minimalny odstęp między
   statkami, najwyżej 2 z 6 w natarciu, reszta na flankach, uniki przed
   rakietami, ostrożne rasy się wycofują, Heliotropi nie, Szczepieni odskakują
   na regenerację.
3. **Uczciwa walka** (bot śmiertelny, trudność normalna) — tylko raport, nie
   test. Bot leci prosto i strzela, bez uników i bez sprytu, więc blokada,
   fale i zasadzka go zabijają; żywy gracz ma boost, hamulec, 5 broni i watahę.
   To raczej sygnał, że misje nie są trywialne, niż pomiar balansu.

**Czego nie sprawdzono:** renderowania w przeglądarce (GPU), układu panelu
misji i przycisków na telefonie ani balansu z żywym graczem. Liczby
(kadłuby, zasięgi zagłuszaczy, sprint łowców) są w jednym miejscu na misję
w `MISSIONS` — tam się je stroi.
