#!/usr/bin/env node
// Build directory/ (the cemetery picker's data) from the tables WikiTree+ publishes:
//   node tools/build-directory.mjs [--cemeteries=<tsv|url>] [--groups=<tsv|url>] [--out=<dir>]
// Defaults fetch https://plus.wikitree.com/Categories/CIBCemetery.tsv (~37 MB) and CIBCemeteryGroup.tsv.
//
// Output:
//   tree.json        the place hierarchy (continent > country > state > county ...) with cemetery counts
//   g/<node>.json    the cemeteries directly under one place
//   <xx>.json        name/town search shards (see js/directory.js)
//   meta.json
// Cemeteries with no profiles are left out.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { keysForRecord } from '../js/directory.js';

import { SUFFIX, OTHER, clean, display, parseTsv, placeStructure, layout } from '../js/place-tree.js';

/** @returns {{tree:{nodes:any[][]}, groupFiles:Map<number,any[]>, shards:Map<string,any[]>, kept:number}} */
export function buildDirectory(cemeteryTsv, groupTsv) {
  const struct = placeStructure(groupTsv);

  // ---- cemeteries ---------------------------------------------------------------------
  const c = parseTsv(cemeteryTsv);
  for (const need of ['Category', 'Profiles Nr.', 'coordinate', 'spacepage', 'parent']) {
    if (!(need in c.col)) throw new Error(`Cemetery table has no "${need}" column.`);
  }
  const byGroup = new Map(); // group category (or OTHER) -> records
  const shards = new Map();
  let kept = 0;
  for (const f of c.rows) {
    const category = clean(f[c.col.Category]);
    const profiles = Number(f[c.col['Profiles Nr.']]) || 0;
    if (!category || profiles < 1) continue;
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(f[c.col.coordinate] || '');
    const ok = m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180;
    const space = (f[c.col.spacepage] || '').trim();
    const rec = [category, profiles, ok ? +(+m[1]).toFixed(5) : null, ok ? +(+m[2]).toFixed(5) : null,
      ...(/^[A-Za-z0-9_%.,()'\-]+$/.test(space) ? [space] : [])];
    kept += 1;
    const gk = struct.resolve(f[c.col.parent]) || OTHER;
    if (!byGroup.has(gk)) byGroup.set(gk, []);
    byGroup.get(gk).push(rec);
    for (const key of keysForRecord(category)) {
      if (!shards.has(key)) shards.set(key, []);
      shards.get(key).push(rec);
    }
  }

  // ---- tree: totals, then drop places with no cemeteries ---------------------------------
  const total = new Map();
  const sumOf = (cat) => {
    if (total.has(cat)) return total.get(cat);
    total.set(cat, 0); // guards against cycles
    const n = (byGroup.get(cat)?.length || 0) + (struct.kids.get(cat) || []).reduce((s, k) => s + sumOf(k), 0);
    total.set(cat, n);
    return n;
  };
  for (const cat of struct.cats.keys()) sumOf(cat);
  const nodes = layout(struct, (cat) => (cat === OTHER ? (byGroup.get(OTHER)?.length || 0) + struct.rest.reduce((s, k) => s + sumOf(k), 0) > 0 : sumOf(cat) > 0));
  const groupFiles = new Map();
  nodes.forEach((n, idx) => {
    const cat = n[4];
    if (idx === 0) { n[3] = kept; return; }
    const direct = byGroup.get(cat) || [];
    n[2] = direct.length;
    n[3] = cat === OTHER ? direct.length + struct.rest.reduce((s, k) => s + sumOf(k), 0) : sumOf(cat);
    if (direct.length) groupFiles.set(idx, direct.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  });
  return { tree: { nodes: nodes.map((n) => n.slice(0, 4)) }, groupFiles, shards, kept };
}

function readSource(s) {
  return /^https?:/.test(s)
    ? fetch(s).then((r) => { if (!r.ok) throw new Error(`${s}: ${r.status}`); return r.text(); })
    : Promise.resolve(readFileSync(s, 'utf8'));
}

export function writeDirectory(out, { tree, groupFiles, shards, kept }, source) {
  for (const f of readdirSync(out)) if (f.endsWith('.json')) rmSync(join(out, f));
  rmSync(join(out, 'g'), { recursive: true, force: true });
  mkdirSync(join(out, 'g'), { recursive: true });
  let bytes = 0;
  const put = (path, data) => { const j = JSON.stringify(data); writeFileSync(path, j); bytes += j.length; return j.length; };
  for (const [idx, list] of groupFiles) put(join(out, 'g', `${idx}.json`), list);
  let biggest = ['', 0];
  for (const [key, list] of shards) {
    list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const n = put(join(out, `${key}.json`), list);
    if (n > biggest[1]) biggest = [key, n];
  }
  const generated = new Date().toISOString().slice(0, 10);
  put(join(out, 'tree.json'), { generated, nodes: tree.nodes });
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ generated, source, cemeteries: kept, places: tree.nodes.length, searchShards: shards.size, groupFiles: groupFiles.size }) + '\n');
  return { bytes, biggest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split(/=(.*)/s).slice(0, 2)));
  const base = 'https://plus.wikitree.com/Categories/';
  const cemeteries = opt.cemeteries || `${base}CIBCemetery.tsv`;
  const groups = opt.groups || `${base}CIBCemeteryGroup.tsv`;
  const out = opt.out || fileURLToPath(new URL('../directory', import.meta.url));
  mkdirSync(out, { recursive: true });
  const built = buildDirectory(await readSource(cemeteries), await readSource(groups));
  const { bytes, biggest } = writeDirectory(out, built, cemeteries);
  console.error(`${built.kept} cemeteries, ${built.tree.nodes.length} places, ${built.groupFiles.size} place files, ${built.shards.size} search shards; ${(bytes / 1e6).toFixed(1)} MB (largest search shard ${biggest[0]}, ${(biggest[1] / 1e3).toFixed(0)} KB)`);
}
