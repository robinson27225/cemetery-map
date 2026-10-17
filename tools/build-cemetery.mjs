#!/usr/bin/env node
// Build a cemetery JSON from a TSV/CSV:
//   node tools/build-cemetery.mjs samples/fairview-raton.tsv cemeteries/fairview-raton-nm.json [--enrich]
// Metadata for the cemetery comes from <input>.meta.json next to the input, if present.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseGraves } from '../js/parse.js';
import { auditGraves, centerOf } from '../js/model.js';
import { fetchPeople } from '../js/wikitree-api.js';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: build-cemetery.mjs <input.tsv|csv> <output.json> [--enrich]');
  process.exit(2);
}
const metaPath = input.replace(/\.[^.]+$/, '.meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};

const { graves, issues } = parseGraves(readFileSync(input, 'utf8'));
issues.push(...auditGraves(graves));
for (const i of issues) console.error(`${i.level.toUpperCase()}${i.row ? ` row ${i.row}` : ''}${i.wt ? ` ${i.wt}` : ''}: ${i.msg}`);
if (issues.some((i) => i.level === 'error')) process.exit(1);

if (flags.includes('--enrich')) {
  const people = await fetchPeople([...new Set(graves.map((g) => g.wt))]);
  for (const g of graves) Object.assign(g, people[g.wt]);
  console.error(`Enriched ${Object.keys(people).length}/${graves.length} profiles from the WikiTree API.`);
}

const c = centerOf(graves);
const doc = {
  schema: 1,
  id: meta.id || 'cemetery',
  name: meta.name || 'Cemetery',
  location: meta.location || '',
  ...(meta.wikitree ? { wikitree: meta.wikitree } : {}),
  ...(meta.source ? { source: meta.source } : {}),
  center: [Number(c.lat.toFixed(6)), Number(c.lon.toFixed(6))],
  zoom: meta.zoom || 19,
  ...(meta.overlay ? { overlay: meta.overlay } : {}),
  graves: graves.map(({ _plot, ...g }) => g),
};
writeFileSync(output, JSON.stringify(doc, null, 1) + '\n');
console.error(`Wrote ${output} (${graves.length} graves).`);
