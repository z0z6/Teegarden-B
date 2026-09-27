// CONTENT-SECURITY-POLICY dla wszystkich stron gry (GitHub Pages nie pozwala
// ustawiać nagłówków HTTP, więc polityka siedzi w <meta> każdej strony).
//
//   node tools/csp.mjs           - wpisuje / aktualizuje <meta> CSP we wszystkich *.html
//   node tools/csp.mjs --check   - tylko sprawdza (kod wyjścia 1, gdy coś nieaktualne)
//
// Inline <script> (import mapa, ściąga sterowania, moduły inline) są
// dopuszczone po skrócie SHA-256 treści. Po KAŻDEJ zmianie inline skryptu
// trzeba uruchomić ten plik, inaczej przeglądarka zablokuje skrypt (w konsoli:
// "Refused to execute inline script"). Nowy kod lepiej dawać do plików .js.
//
// Czego gra potrzebuje i dlaczego:
//   'wasm-unsafe-eval'  - dekoder meshopt (modele .glb) to WebAssembly
//   worker-src blob:    - meshopt może dekodować w workerze z blob:
//   img/connect blob:   - GLTFLoader (tekstury w .glb), pobieranie zapisu gry
//   style 'unsafe-inline' - atrybuty style="--h:..." w panelach (same style, nie skrypty)
// Uwaga: frame-ancestors nie działa w <meta> - tylko jako nagłówek HTTP.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const htmls = [];
(function scan(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n === 'vendor' || n.startsWith('.')) continue;
    const p = join(d, n);
    if (statSync(p).isDirectory()) scan(p); else if (n.endsWith('.html')) htmls.push(p);
  }
})(ROOT);

const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
function policy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${hashes.length ? ' ' + hashes.join(' ') : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' data: blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

const META_RE = /[ \t]*<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>\n?/;
let stale = 0;
for (const file of htmls) {
  const src = readFileSync(file, 'utf8');
  // inline = <script> bez src (też type="importmap" i type="module")
  const hashes = [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => sha(m[1]));
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy([...new Set(hashes)])}" />`;
  let out;
  if (META_RE.test(src)) out = src.replace(META_RE, (m) => m.replace(/<meta[^>]*>/, meta));
  else {
    // tuż po <meta charset>: polityka działa tylko na to, co stoi ZA nią
    const at = src.match(/<meta charset="[^"]*"\s*\/?>\n?/i);
    if (!at) { console.log(`FAIL ${relative(ROOT, file)}: brak <meta charset> - nie wiem, gdzie wstawić CSP`); stale++; continue; }
    const indent = src.slice(src.lastIndexOf('\n', at.index) + 1, at.index);
    const end = at.index + at[0].length;
    out = src.slice(0, end) + (at[0].endsWith('\n') ? '' : '\n') + indent + meta + '\n' + src.slice(end);
  }
  const label = relative(ROOT, file);
  if (out === src) { console.log(`  ok ${label} (${hashes.length} inline)`); continue; }
  if (CHECK) { console.log(`FAIL ${label}: CSP nieaktualna - uruchom node tools/csp.mjs`); stale++; }
  else { writeFileSync(file, out); console.log(`  zapisano ${label} (${hashes.length} inline)`); }
}
if (CHECK && stale) process.exit(1);
