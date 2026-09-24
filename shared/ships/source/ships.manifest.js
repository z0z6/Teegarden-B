/**
 * ships.manifest.js — lista statków do wygenerowania przez build-ships.mjs.
 *
 * Jedna pozycja = jeden plik .glb (+ LOD1/LOD2) w shared/ships/models/.
 * Ścieżki `module` są względne do tego katalogu (shared/ships/source/).
 *
 * Pola pozycji:
 *   id       nazwa pliku i id w SHIPS (kebab-case, unikalne)
 *   name     nazwa wyświetlana w SHIPS
 *   module   plik generatora
 *   builder  nazwa eksportowanej funkcji budującej
 *   race     id rasy do SHIP_RACE (shared/data/races.js)
 *   opts     opcje przekazywane do buildera (seed, faction, wear, ...)
 *   bowAxis  opcjonalnie; domyślnie z group.userData.bowAxis, potem '+Z'
 */
export default {
  modelsDir: '../models',
  fleetFile: '../fleet.js',
  racesFile: '../../data/races.js',

  ships: [
    {
      id: 'goniec-wybudzeni-hawk-7',
      name: 'Goniec — Kwartał Spisowy',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 7, faction: 'hawk' },
    },
    {
      id: 'goniec-wybudzeni-trade-11',
      name: 'Goniec — Cech Rzeczników',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 11, faction: 'trade' },
    },
    {
      id: 'goniec-wybudzeni-coalition-13',
      name: 'Goniec — Bez Numeru',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 13, faction: 'coalition', wear: 0.55 },
    },
    {
      id: 'goniec-wybudzeni-hawk-21',
      name: 'Goniec — Weteran Kwartału',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 21, faction: 'hawk', wear: 0.7, greebleDensity: 0.7 },
    },
    {
      id: 'goniec-wybudzeni-trade-34',
      name: 'Goniec — Rzecznik Dalekiego Szlaku',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 34, faction: 'trade', lengthScale: 1.15, greebleDensity: 0.9, wear: 0.1 },
    },
    {
      id: 'goniec-wybudzeni-coalition-58',
      name: 'Goniec — Odrzut Spisu',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 58, faction: 'coalition', wear: 0.85, asymmetry: 0.6, emissiveBoost: 0.5 },
    },
    {
      id: 'goniec-wybudzeni-hawk-90',
      name: 'Goniec — Paradny Kwartału',
      module: './goniec_wybudzeni.js',
      builder: 'buildGoniecWybudzeni',
      race: 'wybudzeni',
      opts: { seed: 90, faction: 'hawk', wear: 0, lengthScale: 0.9, emissiveBoost: 2 },
    },

    {
      id: 'kryza-heliotropi-hawk-3',
      name: 'Kryza — Żar',
      module: './kryza_heliotropi.js',
      builder: 'buildKryzaHeliotropi',
      race: 'heliotropi',
      opts: { seed: 3, faction: 'hawk' },
    },
    {
      id: 'kryza-heliotropi-trade-17',
      name: 'Kryza — Chłodni',
      module: './kryza_heliotropi.js',
      builder: 'buildKryzaHeliotropi',
      race: 'heliotropi',
      opts: { seed: 17, faction: 'trade' },
    },
    {
      id: 'kryza-heliotropi-coalition-29',
      name: 'Kryza — Hibernatorzy Szlaku',
      module: './kryza_heliotropi.js',
      builder: 'buildKryzaHeliotropi',
      race: 'heliotropi',
      opts: { seed: 29, faction: 'coalition', wear: 0.5 },
    },
    {
      id: 'kryza-heliotropi-hawk-44',
      name: 'Kryza — Płomień Żaru',
      module: './kryza_heliotropi.js',
      builder: 'buildKryzaHeliotropi',
      race: 'heliotropi',
      opts: { seed: 44, faction: 'hawk', lengthScale: 1.1, greebleDensity: 0.8, emissiveBoost: 2 },
    },
  ],
};
