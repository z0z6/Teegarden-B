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

    // Istniejące generatory też działają (bez opts):
    // { id: 'raptor-interceptor', name: 'Raptor-class Interceptor', module: './raptor_interceptor.js',
    //   builder: 'buildRaptorInterceptor', race: 'rezonanci', bowAxis: '+Z', opts: { ground: false } },
  ],
};
