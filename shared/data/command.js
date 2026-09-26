/**
 * DOWÓDZTWO (krok 12): liczby do strojenia w jednym miejscu. Logika siedzi
 * w shared/systems/command.js, widok z mostka w command-view.js, panel
 * gracza w command-panel.js.
 *
 * PĘTLA DOWÓDZTWA:
 *   1. siedziba rasy buduje drony różnych typów (hangar),
 *   2. gracz wysyła je na wyprawy: zwiadowców do nieznanych skał i pól,
 *      górników i holowniki do zbadanych planetoid,
 *   3. pełne ładownie = decyzja "wracać?", urobek jedzie do huty,
 *   4. huta przetapia urobek na metal (odzysk zależy od nauki),
 *   5. reaktory zasilają stacje; metal idzie na drony, moduły, ulepszenia,
 *      badania i flotę.
 *
 * Jednostki jak w economy.js: tony, kredyty, sekundy, jednostki świata.
 */

/** Rozstawienie siedziby względem pola macierzystego (patrz command.js found()). */
export const HQ = {
  back: 6200,       // j. od środka pola w stronę punktu startowego (pas widać z mostka przed sobą)
  up: -300,
  // huta i reaktor przed siedzibą, w kadrze z mostka (huta z prawej, niżej; reaktor z lewej, wyżej)
  hutaSide: 540, hutaAhead: 1900, hutaUp: -260,
  reaktorSide: -470, reaktorAhead: 1750, reaktorUp: 250,
  hangar: { x: 0, y: 22, z: 300 },   // wylot hangaru (lokalnie w modelu siedziby, +Z = w stronę pasa)
  bridge: { x: 0, y: 128, z: 130 },  // kamera mostka
  start: { zelazo: 260, nikiel: 70, kobalt: 8 }, // metal na start w składzie siedziby
  startDrones: { zwiadowca: 3, gornik: 6 },
};

/**
 * Drony wypraw (hangar siedziby). hold - t urobku na drona, mine - t/s
 * wiercenia na drona, survey - s badania skały, guard - dron strażniczy
 * (strzela do wrogów przy polu).
 */
export const DRONE_TYPES = {
  zwiadowca: {
    name: 'Zwiadowca', plural: 'zwiadowców', color: '#9fd8ff',
    role: 'Szybki, lekki. Bada skały (skład, zasoby) i odkrywa nieznane pola.',
    cost: { credits: 40, zelazo: 5, nikiel: 2 }, buildTime: 3, speed: 900, hull: 18,
    hold: 0, mine: 0, survey: 5, group: 2,
  },
  gornik: {
    name: 'Górnik', plural: 'górników', color: '#ffb13d',
    role: 'Wierci na powierzchni zbadanej planetoidy i przywozi urobek do huty.',
    cost: { credits: 45, zelazo: 8, nikiel: 2 }, buildTime: 4, speed: 420, hull: 30,
    hold: 8, mine: 0.7, group: 6,
  },
  holownik: {
    name: 'Holownik', plural: 'holowników', color: '#4dd6a0', tech: 'holowniki',
    role: 'Ciężki transportowiec urobku: kopie wolno, ale mieści pięć razy więcej.',
    cost: { credits: 90, zelazo: 22, nikiel: 6, kobalt: 1 }, buildTime: 7, speed: 260, hull: 70,
    hold: 40, mine: 0.35, group: 3,
  },
  straznik: {
    name: 'Strażnik', plural: 'strażników', color: '#ff7a45', tech: 'straznicy',
    role: 'Uzbrojony dron osłony: pilnuje pola i strzela do napastników.',
    cost: { credits: 120, zelazo: 18, nikiel: 8, kobalt: 3 }, buildTime: 8, speed: 700, hull: 80,
    hold: 0, mine: 0, guard: { range: 1600, damage: 7, every: 0.55 }, group: 4,
  },
};
export const DRONE_TYPE_ORDER = ['zwiadowca', 'gornik', 'holownik', 'straznik'];

/** Wyprawa w czasie (s). Przelot jest "w skrócie": okienko podglądu zamiast minut lotu. */
export const EXPEDITION = {
  launch: 4,        // wylot z hangaru, widoczny z mostka
  transit: 3.2,     // skrót przelotu (okienko: ujęcie z zewnątrz stacji)
  approach: 3.2,    // dolot do skały (okienko: ujęcie przy skale)
  depart: 2.6,      // odlot od skały z urobkiem
  dock: 3.6,        // podejście do huty, widoczne z mostka
  unload: 2,
  decisionTimeout: 20, // s na decyzję "wracać?" - potem drony wracają same
  threatRange: 2600,   // wrogowie bliżej niż tyle od grupy = straty
  lossEvery: 2.4,      // s na jednego zestrzelonego drona pod ostrzałem (bez osłony)
  maxHangar: 60,       // dronów w hangarze siedziby (bez ulepszeń)
};

/** Zasilanie: podaż i pobór w MW (umowne). */
export const POWER = {
  supply: { siedziba: 40, reaktor: 45 },
  demand: { magazyn: 2, przeladunek: 5, dok: 8, wieza: 6, stocznia: 12, huta: 14, siedziba: 0, reaktor: 0 },
  hangar: 4,        // produkcja dronów w siedzibie
  lab: 5,           // badania w toku
  minEfficiency: 0.25, // nawet bez prądu stacja robi coś na akumulatorach
  autonomyCost: { credits: 600, zelazo: 40, nikiel: 20, kobalt: 6 },
};

/** Huta: tempo przetopu (t urobku/s) i odzysk metali (część zawartości metalu w urobku). */
export const SMELTER = {
  rate: 2.2,
  recovery: { zelazo: 0.92, nikiel: 0.7, kobalt: 0, platyna: 0 },
  withoutHuta: 0.35, // bez huty siedziba przetapia sama, dużo wolniej
};

/**
 * Ulepszenia: poziomy 1..max, koszt rośnie z poziomem (cost × poziom^1.5).
 * effect: mnożnik na poziom (patrz command.js mult()).
 */
export const UPGRADES = {
  'drony-naped':   { cat: 'Drony', name: 'Napęd dronów', max: 5, per: 0.15, desc: '+15% prędkości dronów wypraw na poziom', cost: { credits: 300, zelazo: 30, nikiel: 10 } },
  'drony-ladownie':{ cat: 'Drony', name: 'Ładownie', max: 5, per: 0.25, desc: '+25% ładowni górników i holowników na poziom', cost: { credits: 350, zelazo: 40, nikiel: 12 } },
  'drony-wiertla': { cat: 'Drony', name: 'Wiertła diamentowe', max: 5, per: 0.2, desc: '+20% tempa wiercenia na poziom', cost: { credits: 400, zelazo: 30, nikiel: 16, kobalt: 2 } },
  'drony-pancerz': { cat: 'Drony', name: 'Pancerz dronów', max: 3, per: 0.35, desc: 'Drony wolniej giną pod ostrzałem (+35% na poziom)', cost: { credits: 450, zelazo: 50, nikiel: 14 } },
  'hangar':        { cat: 'Siedziba', name: 'Rozbudowa hangaru', max: 4, per: 0.5, desc: '+50% miejsc w hangarze i szybsza produkcja dronów', cost: { credits: 800, zelazo: 90, nikiel: 30 } },
  'huta-piece':    { cat: 'Huta', name: 'Piece łukowe', max: 5, per: 0.3, desc: '+30% tempa przetopu na poziom', cost: { credits: 500, zelazo: 60, nikiel: 20 } },
  'huta-odzysk':   { cat: 'Huta', name: 'Separatory', max: 4, per: 0.05, desc: '+5 pkt. procentowych odzysku każdego odkrytego metalu', cost: { credits: 600, zelazo: 40, nikiel: 25, kobalt: 3 } },
  'reaktor-rdzen': { cat: 'Energia', name: 'Rdzenie reaktorów', max: 4, per: 0.25, desc: '+25% mocy reaktorów i siedziby na poziom', cost: { credits: 700, zelazo: 50, nikiel: 30, kobalt: 5 } },
  'flota-kadlub':  { cat: 'Flota', name: 'Kadłuby okrętów', max: 5, per: 0.15, desc: '+15% wytrzymałości okrętów floty', cost: { credits: 900, zelazo: 90, nikiel: 30, kobalt: 6 } },
  'flota-dziala':  { cat: 'Flota', name: 'Uzbrojenie okrętów', max: 5, per: 0.15, desc: '+15% siły ognia floty (także w bitwach zaocznych)', cost: { credits: 1000, zelazo: 60, nikiel: 30, kobalt: 10 } },
  'mysliwiec-oslony': { cat: 'Twój myśliwiec', name: 'Osłony myśliwca', max: 5, per: 0.12, desc: '+12% kadłuba twojego statku, gdy siadasz za sterami', cost: { credits: 500, zelazo: 40, nikiel: 16, kobalt: 2 } },
  'mysliwiec-dziala': { cat: 'Twój myśliwiec', name: 'Działa myśliwca', max: 5, per: 0.1, desc: '+10% obrażeń twoich broni', cost: { credits: 550, zelazo: 30, nikiel: 20, kobalt: 4 } },
};
export const UPGRADE_ORDER = Object.keys(UPGRADES);
export const UPGRADE_TECH = { 'huta-odzysk': 'flotacja', 'flota-kadlub': 'kompozyty', 'flota-dziala': 'kompozyty', 'drony-pancerz': 'straznicy' };

/**
 * NAUKA. Jedno badanie naraz, koszt płatny na starcie. discovery = co mówią
 * naukowcy po odkryciu; effect czyta command.js (has()).
 */
export const TECHS = {
  spektrometria: {
    name: 'Spektrometria wiązkowa', time: 45, cost: { credits: 400, zelazo: 20 }, requires: [],
    desc: 'Zwiadowcy badają całe pole naraz zamiast pojedynczej skały.',
    discovery: 'Nasi naukowcy zestroili spektrometry z czujnikami zwiadowców. Jedna wyprawa zwiadowcza bada teraz wszystkie skały pola.',
  },
  flotacja: {
    name: 'Flotacja magnetyczna', time: 60, cost: { credits: 600, zelazo: 40, nikiel: 10 }, requires: [],
    desc: 'Odzysk niklu w hucie 70% → 95%. Odblokowuje separatory.',
    discovery: 'Nasi naukowcy opracowali flotację magnetyczną. Z tego samego urobku huta odzyskuje o jedną trzecią więcej niklu.',
  },
  lugowanie: {
    name: 'Ługowanie kobaltu', time: 80, cost: { credits: 900, zelazo: 50, nikiel: 30 }, requires: ['flotacja'],
    desc: 'Huta zaczyna odzyskiwać kobalt z urobku (0% → 75%).',
    discovery: 'Przełom w laboratorium! Nasi naukowcy odkryli metodę ługowania kobaltu z rudy. Kobalt, który dotąd szedł na hałdę, trafi do składu.',
  },
  rafinacja: {
    name: 'Rafinacja platynowców', time: 110, cost: { credits: 1600, zelazo: 60, nikiel: 40, kobalt: 10 }, requires: ['lugowanie'],
    desc: 'Huta odzyskuje platynę (0% → 70%). Planetoidy metaliczne stają się bezcenne.',
    discovery: 'Nasi naukowcy opanowali rafinację platynowców. Po raz pierwszy wytapiamy platynę — cmentarzyska protoplanet są teraz warte fortunę.',
  },
  holowniki: {
    name: 'Holowniki ciężkie', time: 55, cost: { credits: 700, zelazo: 60, nikiel: 20 }, requires: [],
    desc: 'Nowy typ drona: holownik z ładownią na 40 t.',
    discovery: 'Inżynierowie przerobili kadłuby transportowców na holowniki urobku. Hangar może je już budować.',
  },
  straznicy: {
    name: 'Drony strażnicze', time: 70, cost: { credits: 900, zelazo: 60, nikiel: 25, kobalt: 4 }, requires: [],
    desc: 'Nowy typ drona: uzbrojony strażnik pola. Odblokowuje pancerz dronów.',
    discovery: 'Zbrojmistrzowie zmieścili działko pulsacyjne w kadłubie drona. Strażnicy mogą pilnować pól i wypraw.',
  },
  reaktory: {
    name: 'Reaktory fuzyjne', time: 75, cost: { credits: 1000, zelazo: 50, nikiel: 30, kobalt: 6 }, requires: [],
    desc: '+50% mocy każdego reaktora.',
    discovery: 'Nasi fizycy ustabilizowali plazmę w nowych rdzeniach. Reaktory dają połowę mocy więcej.',
  },
  ogniwa: {
    name: 'Ogniwa autonomiczne', time: 90, cost: { credits: 1200, zelazo: 40, nikiel: 40, kobalt: 8 }, requires: ['reaktory'],
    desc: 'Stacje mogą dostać własne źródło zasilania i nie zależą od sieci siedziby (także w innych układach).',
    discovery: 'Nasi naukowcy zamknęli mikroreaktor w module wielkości kontenera. Każda stacja może teraz mieć własne zasilanie.',
  },
  automatyka: {
    name: 'Autonomia rojów', time: 80, cost: { credits: 1100, zelazo: 40, nikiel: 30, kobalt: 4 }, requires: ['spektrometria'],
    desc: 'Wyprawy wracają same po zapełnieniu ładowni i same ruszają na kolejny kurs.',
    discovery: 'Programiści floty dronów skończyli nowe oprogramowanie. Roje same decydują o powrocie i wracają na złoże bez rozkazu.',
  },
  kompozyty: {
    name: 'Kompozytowe kadłuby', time: 100, cost: { credits: 1500, zelazo: 80, nikiel: 40, kobalt: 10 }, requires: [],
    desc: 'Odblokowuje ulepszenia kadłubów i uzbrojenia floty.',
    discovery: 'Metalurdzy wyhodowali kompozyt kobaltowo-niklowy. Stocznia może wzmacniać kadłuby i działa okrętów.',
  },
};
export const TECH_ORDER = ['spektrometria', 'flotacja', 'holowniki', 'reaktory', 'lugowanie', 'straznicy', 'automatyka', 'ogniwa', 'kompozyty', 'rafinacja'];
