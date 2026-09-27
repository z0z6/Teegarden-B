// <link rel="modulepreload"> dla wszystkich modułów strony, z grafu importów.
//
//   node tools/preload.mjs           - wpisuje / aktualizuje bloki we wszystkich *.html
//   node tools/preload.mjs --check   - tylko sprawdza (kod wyjścia 1, gdy nieaktualne)
//
// Bez tego przeglądarka odkrywa moduły falami: main.js -> systemy -> three ->
// three.core (4 kolejne rundy do serwera). Z preloadem wszystkie pliki lecą
// równolegle zaraz po HTML (HTTP/2 na GitHub Pages). Uruchom po dodaniu albo
// usunięciu importu - inaczej preload jest niepełny (gra działa, tylko wolniej
// startuje; --check to wychwyci).
//
// Blok MUSI stać po <script type="importmap">: import mapa dodana po
// rozpoczęciu ładowania modułów jest odrzucana i `import 'three'` przestaje działać.
// Moduły ładowane tylko przez import() są pomijane (to celowo odroczone).
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, dirname, sep } from 'node:path';
import { ROOT, listPages, pageGraph } from './module-graph.mjs';

const CHECK = process.argv.includes('--check');
const START = '<!-- modulepreload: generuje tools/preload.mjs -->';
const END = '<!-- /modulepreload -->';
const BLOCK_RE = new RegExp(`[ \\t]*${START.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\n?`);

let stale = 0;
for (const html of listPages()) {
  const label = relative(ROOT, html);
  const src = readFileSync(html, 'utf8');
  const { files, problems } = pageGraph(html);
  if (problems.length) { console.log(`FAIL ${label}: ${problems[0]} (napraw: node tools/check-imports.mjs)`); stale++; continue; }
  const srcTags = new Set([...src.matchAll(/<script type="module"\s+src="([^"]+)"/g)].map((m) => m[1]));
  const links = [...files.entries()]
    .filter(([, v]) => !v.dynamic)
    .sort((a, b) => a[1].depth - b[1].depth || a[0].localeCompare(b[0]))
    .map(([f]) => { let r = relative(dirname(html), f).split(sep).join('/'); if (!r.startsWith('.')) r = `./${r}`; return r; })
    .filter((r) => !srcTags.has(r) && !srcTags.has(r.replace(/^\.\//, '')));
  let out = src.replace(BLOCK_RE, '');
  if (links.length) {
    const im = out.match(/<script type="importmap">[\s\S]*?<\/script>\n?/);
    const at = im ? im.index + im[0].length : out.search(/[ \t]*<script type="module"/);
    if (at < 0) { console.log(`  -- ${label}: brak modułów`); continue; }
    const lineStart = out.lastIndexOf('\n', (im ? im.index : at) - 1) + 1;
    const indent = out.slice(lineStart).match(/^[ \t]*/)[0];
    const block = [START, ...links.map((l) => `<link rel="modulepreload" href="${l}" />`), END].map((l) => indent + l).join('\n') + '\n';
    out = out.slice(0, at) + (im && !im[0].endsWith('\n') ? '\n' : '') + block + out.slice(at);
  }
  if (out === src) { console.log(`  ok ${label} (${links.length})`); continue; }
  if (CHECK) { console.log(`FAIL ${label}: preload nieaktualny - uruchom node tools/preload.mjs`); stale++; }
  else { writeFileSync(html, out); console.log(`  zapisano ${label} (${links.length} modułów)`); }
}
if (CHECK && stale) process.exit(1);
