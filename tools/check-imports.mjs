// Statyczna kontrola stron: dla każdego *.html czyta import mapę i przechodzi
// cały graf modułów ES (od <script type="module">, też inline), rozwiązując
// importy jak przeglądarka. Wykrywa brakujące pliki i zewnętrzne adresy,
// zanim zrobi to gracz. Bez zależności:  node tools/check-imports.mjs
import { relative } from 'node:path';
import { ROOT, listPages, pageGraph } from './module-graph.mjs';

let fails = 0, total = 0;
const pages = listPages();
for (const html of pages) {
  const { files, problems, maxDepth } = pageGraph(html);
  total += files.size;
  const label = relative(ROOT, html);
  if (problems.length) { fails++; console.log(`FAIL ${label}`); for (const p of problems) console.log(`       ${p}`); }
  else console.log(`  ok ${label}: ${files.size} modułów, łańcuch importów ${maxDepth}`);
}
console.log(`\n${pages.length} stron, ${total} rozwiązanych modułów. ${fails ? `BŁĘDY: ${fails}` : 'Wszystko OK'}`);
process.exit(fails ? 1 : 0);
