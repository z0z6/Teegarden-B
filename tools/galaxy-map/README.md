# Mapa galaktyki — znany wszechświat

Model: `shared/data/galaxy.js` (czysta logika, bez three.js).
Podgląd: `tools/galaxy-map/` (canvas 2D). Testy: `node tools/galaxy-map/check.mjs`.

## Założenie

Wszechświat ma być **ogromny, ale policzalny**: każdy układ ma numer, nazwę,
pozycję, gwiazdę, sektor i właściciela. Da się go wyliczyć, zliczyć i
zapisać, a ten sam `seed` daje zawsze tę samą galaktykę (zapis gry trzyma
tylko zmienną część stanu, ok. 4–5 kB).

| | Domyślnie |
|---|---|
| Układy | 12 000 |
| Sektory | 96 (ok. 125 układów na sektor) |
| Dysk | promień 1000 lat świetlnych, 4 ramiona spiralne, Jądro o promieniu 170 |
| Domena rasy | 5 sektorów na starcie (ok. 550–730 układów) |
| Rdzeń | stolica + 11 najbliższych układów |
| Poza domenami | ok. 65% galaktyki (pogranicze i dzicz) |

Wszystkie liczby są w `GALAXY_DEFAULTS` i `RULES` na początku pliku.

## Warstwy

| Warstwa | Co to jest | Militaryzacja (średnio) |
|---|---|---|
| Stolica | siedziba władzy rasy | 100 |
| Układy core'owe | stolica i najbliższe układy | ~84 |
| Domena | reszta sektorów rasy | ~53 |
| Pogranicze | niczyje sektory przylegające do domen | ~20 |
| Dzicz | reszta, w tym Jądro galaktyki | ~8 |

**Planeta macierzysta** to osobne pole rasy. Na starcie jest stolicą. Po
odwrocie zostaje w starym miejscu jako utracona (na mapie przekreślona), co
daje fabule gotowy motyw powrotu.

Stolice leżą przy gwiazdach, które pasują do lore ras (propozycja, jak
wizerunki ras): Heliotropi przy błękitnym nadolbrzymie (Zenit), Rezonanci
przy białym karle (Dolina Rezonansu), Pieśniarze przy czerwonym olbrzymie
(Pierwsza Pieśń), Szczepieni przy pomarańczowym karle (Ul Macierzysty) itd.
Nazwy stolic nawiązują do kwestii z `races.js` („wracamy do ula”, „cofamy
się do doliny”).

**Rubież Teegardena**: 5 ręcznie zrobionych układów z kroku 8 leży w jednym
niczyim sektorze na styku domen. To naturalne miejsce startu, bo spotyka się
tam kilka ras.

## Zasady dostępu (pojedynczy statek, np. gracz)

`accessFor(g, systemId, raceId)`:

| Gdzie | Sojusznik (≥ +15) | Neutralny | Wróg (≤ −15) |
|---|---|---|---|
| Domena | swobodny przelot | myto | patrole, rajdy możliwe |
| Rdzeń / stolica | wejście pod eskortą, bez broni | **strefa zamknięta** | **strefa zamknięta** |
| Pogranicze | patrole, potyczki możliwe | | |
| Dzicz | wolna | | |

Strefa zamknięta w grze to zakłócenie fałdy na granicy rdzenia (ten sam
mechanizm co przechwycenie w kroku 5), a nie niewidzialna ściana.

## Koalicja, odwrót, odbudowa

Do działań zbrojnych w cudzym rdzeniu potrzeba koalicji (`validCoalition`):

- co najmniej **2 rasy**, żadna nie jest celem,
- partnerzy mają ze sobą relację **≥ +10** (handel lub sojusz),
- każdy partner ma z celem relację **≤ −15** (napięcie lub wojna),
- każdy partner ma gotowość floty **≥ 60%** i nie walczy gdzie indziej,
- cel nie jest w okresie ochronnym i nie toczy już kampanii.

Kampania idzie w cyklach strategicznych (`advance`). Nacisk koalicji to suma
sił partnerów × 0,6 (reszta broni domu) × zaopatrzenie (słabnie z
odległością stolic). Obrońca ma w rdzeniu przewagę ×1,8. Kampania kończy się:

- **odwrotem**, gdy gotowość obrońcy spadnie do 35% — zwykle po 12–15 cyklach
  przy pełnych siłach obu stron,
- **porażką koalicji**, gdy któryś partner spadnie poniżej 40%, partnerzy się
  skłócą albo oblężenie trwa ponad 30 cykli.

Po odwrocie rasa:

1. traci sektory, w których leżał jej rdzeń — zajmuje je koalicja (dla
   okupanta to zwykła domena, nie rdzeń),
2. przenosi stolicę w rejon jak najdalej od napastników, ale nie na drugi
   koniec galaktyki (własny sektor albo wolny sektor obok domeny),
3. buduje nowy pełny rdzeń, wychodzi z co najmniej 30% floty i odbudowuje
   5% na cykl,
4. ma 12 cykli okresu ochronnego,
5. zapamiętuje napastników (relacja spada do −60).

Rasy **nie da się zniszczyć**: test puszcza 6 kolejnych kampanii na
Rezonantów, każda kończy się odwrotem, a oni wciąż mają stolicę, rdzeń i
domenę.

## Co wynika ze startowych relacji

Przy relacjach z `races.js` jedyną rasą, na którą da się zmontować koalicję,
są **Szczepieni** (Wybudzeni + Rezonanci, Wybudzeni + Pieśniarze albo
Rezonanci + Wykonawcy). Każda inna para wrogów celu jest ze sobą skłócona.
Przykład: Pieśniarze i Szczepieni nie znoszą Rezonantów, ale sami mają −20.
To może być zaletą (dyplomacja gracza jest potrzebna, żeby cokolwiek się
ruszyło), ale warto to świadomie zdecydować.

## Czego jeszcze nie ma

- Galaktyka nie jest jeszcze podpięta do gry: mapa M w kroku 8 nadal pokazuje
  5 układów. Następny krok to podpięcie `accessFor` pod skok (zamknięty rdzeń
  = zakłócenie fałdy) i losowanie ras w spotkaniach według właściciela układu
  zamiast `pickRaceByRelation`.
- Układy z katalogu mają typ gwiazdy, ale nie mają jeszcze planet; budowanie
  ich w 3D wymaga generycznego `build(k)` w `star-systems.js`.
- Rasy AI same nie wypowiadają wojen — kampanie uruchamia się ręcznie (w
  narzędziu albo z fabuły).
