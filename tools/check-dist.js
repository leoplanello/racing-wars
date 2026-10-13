// Valida dist/: todo import (estatico ou dinamico) e todo href/src de HTML precisa resolver a um arquivo existente.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(DIST);
const errors = [];
const exists = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

// importmap de cada pagina (chave -> alvo relativo a pagina)
function importMap(htmlFile) {
  const m = fs.readFileSync(htmlFile, 'utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).imports : {};
}
function resolveSpec(spec, fromFile, map, mapBase) {
  spec = spec.replace(/[?#].*$/, ''); // cache-busting (?v=2)
  if (spec.startsWith('.')) return path.resolve(path.dirname(fromFile), spec);
  if (spec.startsWith('http')) return null;
  for (const [k, v] of Object.entries(map)) {
    if (k.endsWith('/') ? spec.startsWith(k) : spec === k) return path.resolve(mapBase, v + (k.endsWith('/') ? spec.slice(k.length) : ''));
  }
  return undefined;
}

const pages = files.filter((f) => f.endsWith('.html') && !f.endsWith('404.html'));
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const map = importMap(page);
  for (const [, u] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
    if (/^(https?:|data:)/.test(u)) continue;
    if (u.startsWith('/')) errors.push(`${path.relative(DIST, page)}: caminho absoluto "${u}"`);
    else if (!exists(path.resolve(path.dirname(page), u))) errors.push(`${path.relative(DIST, page)}: "${u}" nao existe`);
  }
  // modulos alcancaveis a partir da pagina
  const seen = new Set();
  const queue = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"|<script[^>]*src="([^"]+)"[^>]*type="module"/g)].map((m) => path.resolve(path.dirname(page), m[1] || m[2]));
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!exists(f)) { errors.push(`${path.relative(DIST, page)}: modulo ausente ${path.relative(DIST, f)}`); continue; }
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:^|[;\s}])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] || m[2];
      const r = resolveSpec(spec, f, map, path.dirname(page));
      if (r === null) continue;
      if (r === undefined) errors.push(`${path.relative(DIST, page)}: "${spec}" (em ${path.relative(DIST, f)}) fora do importmap`);
      else queue.push(r);
    }
  }
}
for (const need of ['index.html', 'host/index.html', 'pad/index.html', '.nojekyll']) if (!exists(path.join(DIST, need))) errors.push(`dist/${need} ausente`);

if (errors.length) { console.error('dist invalido:\n - ' + errors.join('\n - ')); process.exit(1); }
console.log(`dist ok (${files.length} arquivos, ${pages.length} paginas verificadas)`);
