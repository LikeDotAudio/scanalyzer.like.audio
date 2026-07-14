// Generate src/musicprodTaxonomy.ts from UCS/categories/MUSICPROD.json — the single
// source of truth the Rust engine also reads. Run `npm run gen:musicprod` after editing
// the JSON, so the scope chips, the colours and the engine never drift apart.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'UCS', 'categories', 'MUSICPROD.json');
const out = join(here, '..', 'src', 'musicprodTaxonomy.ts');

const doc = JSON.parse(readFileSync(src, 'utf8'));

// Family display order + hue come from `families`; membership from `instruments`.
const order = doc.families.map((f) => f.family);
const hues = Object.fromEntries(doc.families.map((f) => [f.family, f.hue ?? null]));

const members = new Map(order.map((f) => [f, []]));
for (const inst of doc.instruments) {
  const list = members.get(inst.family);
  if (list && !list.includes(inst.instrument)) list.push(inst.instrument);
}

const cats = order.map((f) => [f, members.get(f) ?? []]);

const banner =
  `// GENERATED from UCS/categories/MUSICPROD.json — do not edit by hand.\n` +
  `// Regenerate with \`npm run gen:musicprod\` whenever the taxonomy changes.\n` +
  `// FAMILY (music_production_category) -> its member INSTRUMENTS (classification.group).\n\n`;

const body =
  `export const MUSIC_PROD_CATEGORIES: [string, string[]][] = ${JSON.stringify(cats, null, 2)};\n\n` +
  `export const MUSIC_PROD_HUES: Record<string, number | null> = ${JSON.stringify(hues, null, 2)};\n`;

writeFileSync(out, banner + body);
console.log(`wrote ${out} — ${cats.length} families, ${doc.instruments.length} instrument rules`);
