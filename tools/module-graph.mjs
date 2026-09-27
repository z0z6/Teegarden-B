// Graf modułów ES stron gry, rozwiązywany jak w przeglądarce (import mapa,
// ścieżki względne). Wspólne dla tools/check-imports.mjs i tools/preload.mjs.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function listPages() {
  const out = [];
  (function scan(d) {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === 'vendor' || n.startsWith('.')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) scan(p); else if (n.endsWith('.html')) out.push(p);
    }
  })(ROOT);
  return out;
}

const IMPORT_RE = /(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/**
 * Dla strony: { files: Map<ścieżka, {depth, dynamic}>, problems: string[], maxDepth }.
 * depth = numer „fali” pobierania bez preloadu (1 = importowany wprost ze strony).
 * dynamic = osiągalny tylko przez import() - nie preloadujemy go.
 */
export function pageGraph(html) {
  const src = readFileSync(html, 'utf8');
  const map = JSON.parse(src.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1] ?? '{"imports":{}}').imports ?? {};
  const base = pathToFileURL(html);
  const resolveSpec = (spec, from) => {
    if (/^(\.\.?\/|\/)/.test(spec)) return new URL(spec, from);
    if (/^https?:/.test(spec)) return new URL(spec);
    if (map[spec]) return new URL(map[spec], base);
    const pre = Object.keys(map).filter((k) => k.endsWith('/') && spec.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    return pre ? new URL(map[pre] + spec.slice(pre.length), base) : null;
  };
  const files = new Map(), problems = [];
  // BFS: najkrótsza głębokość = fala, w której przeglądarka odkrywa plik
  let queue = [];
  for (const m of src.matchAll(/<script type="module"(?:\s+src="([^"]+)")?\s*>([\s\S]*?)<\/script>/g)) {
    queue.push({ code: m[1] ? `import "${m[1]}";` : m[2], from: base, depth: 0, dynamic: false });
  }
  while (queue.length) {
    const next = [];
    for (const { code, from, depth, dynamic } of queue) {
      for (const m of stripComments(code).matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2];
        const isDyn = dynamic || !!m[2];
        const u = resolveSpec(spec, from);
        if (!u) { problems.push(`nierozwiązany import "${spec}" w ${fileURLToPath(from)}`); continue; }
        if (u.protocol !== 'file:') { problems.push(`zewnętrzny import ${u.href}`); continue; }
        const f = fileURLToPath(u);
        const known = files.get(f);
        if (known) { if (!isDyn) known.dynamic = false; continue; }
        if (!existsSync(f)) { problems.push(`brak pliku ${f} (import "${spec}")`); continue; }
        files.set(f, { depth: depth + 1, dynamic: isDyn });
        next.push({ code: readFileSync(f, 'utf8'), from: u, depth: depth + 1, dynamic: isDyn });
      }
    }
    queue = next;
  }
  const maxDepth = Math.max(0, ...[...files.values()].map((x) => x.depth));
  return { files, problems, maxDepth };
}
