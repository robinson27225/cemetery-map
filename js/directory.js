// Search WikiTree's cemetery categories (the list WikiTree+ publishes: ~150,000 of them).
// The full list is far too big for a browser, so tools/build-directory.mjs splits it into small files
// under directory/, keyed by the first two letters of the first word of the cemetery's name and of its
// town. A search loads only the files for the words you typed.
//
// A record is [category, profiles, lat|null, lon|null, spacePageName?] where category is the plain
// category title, e.g. "Fairview Presbyterian Cemetery, Raton, New Mexico".

import { onWikiTreeHost } from './source.js';
import { createLiveDirectory } from './live-directory.js';

const DIR = 'directory';

/** Lower-case, accents folded, letters/digits only per word. */
export function wordsOf(text) {
  return String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** File-safe shard key for a word: its first two characters; non-ASCII ones become u<hex>. */
export function shardKey(word) {
  const chars = [...word].slice(0, 2);
  if (!chars.length) return '';
  return chars.every((c) => /[a-z0-9]/.test(c))
    ? chars.join('')
    : chars.map((c) => (/[a-z0-9]/.test(c) ? c : `u${c.codePointAt(0).toString(16)}`)).join('_');
}
export const shardFile = (key, base = DIR) => `${base}/${key}.json`;

export const nameOf = (category) => category.split(',')[0].trim();
export const placeOf = (category) => category.split(',').slice(1).join(',').trim();

/** The shards a record is stored in: by first word of its name and first word of its town. */
export function keysForRecord(category) {
  const keys = new Set();
  for (const part of [nameOf(category), placeOf(category)]) {
    const w = wordsOf(part)[0];
    if (w) keys.add(shardKey(w));
  }
  return [...keys];
}

/** WikiTree category title <-> the plain form used in URLs and records. */
export const categoryTitle = (plain) => `Category:${plain.replace(/ /g, '_')}`;
export const plainCategory = (title) => String(title).replace(/^Category:/, '').replace(/_/g, ' ').trim();

/** Suggested title of the Space page that holds this cemetery's plot-map table. */
export function tablePageFor(record) {
  const base = record[4] || nameOf(record[0]).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base ? `Space:${base}_Plot_Map_Table` : '';
}

/**
 * @param {{fetchImpl?: typeof fetch, preferLive?: boolean}} opts
 *   preferLive: browse from WikiTree's own pages (always current) instead of the optional directory/ snapshot. On by
 *   default on wikitree.com, where those pages can be read; the snapshot then only serves search by name.
 */
export function createDirectory({ fetchImpl = fetch, preferLive = onWikiTreeHost(), bases = [DIR] } = {}) {
  const shards = new Map();
  let treePromise = null;
  const json = (path) => fetchImpl(path).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); });

  const live = createLiveDirectory({ fetchImpl });

  /**
   * The place hierarchy: nodes are [name, parentIndex, directCemeteries, totalCemeteries]; index 0 is the root.
   * `mode` is "static" when the optional directory/ files are installed, otherwise "live" (read from WikiTree,
   * with no cemetery counts and no name search).
   */
  let staticPromise = null;
  let base = bases[0];
  /** The optional directory/ snapshot's place tree (rejects when it isn't installed). */
  function staticTree() {
    if (!staticPromise) {
      // The first place that has the files wins (the weekly rebuild online, else a copy beside the app).
      const tryBase = async (i) => {
        try { const t = await json(`${bases[i]}/tree.json`); base = bases[i]; return t; } catch (e) { if (i + 1 < bases.length) return tryBase(i + 1); throw e; }
      };
      staticPromise = tryBase(0).then((t) => {
        const kids = t.nodes.map(() => []);
        t.nodes.forEach((n, i) => { if (i > 0) kids[n[1]].push(i); });
        return { ...t, kids, mode: 'static' };
      });
      staticPromise.catch(() => { staticPromise = null; });
    }
    return staticPromise;
  }
  const liveTree = () => live.tree().then((t) => ({ ...t, mode: 'live' }));
  function tree() {
    if (!treePromise) {
      treePromise = (preferLive ? liveTree().catch(() => staticTree()) : staticTree().catch(liveTree));
      treePromise.catch(() => { treePromise = null; });
    }
    return treePromise;
  }
  /** Root-to-node list of indexes. */
  async function pathTo(index) {
    const { nodes } = await tree();
    const out = [];
    for (let i = index, guard = 0; i >= 0 && guard < 20; i = nodes[i][1], guard += 1) out.unshift(i);
    return out;
  }
  const places = new Map();
  /** @returns {Promise<{records:any[][], note?:string, url?:string}>} */
  async function cemeteriesAt(index) {
    const t = await tree();
    if (t.mode === 'live') return live.cemeteriesAt(index, t);
    if (!places.has(index)) {
      places.set(index, json(`${base}/g/${index}.json`).then((records) => ({ records })).catch((e) => { places.delete(index); throw e; }));
    }
    return places.get(index);
  }
  async function shard(key) {
    if (!key) return [];
    if (!shards.has(key)) {
      shards.set(key, fetchImpl(shardFile(key, base)).then((r) => (r.ok ? r.json() : [])).catch(() => []));
    }
    return shards.get(key);
  }

  /** Records for which every typed word starts some word of the name or town, best (most profiles) first. null when name search isn't installed. */
  async function search(query, { limit = 40 } = {}) {
    if (!(await staticTree().catch(() => null))) return null; // needs the optional directory/ files
    const tokens = wordsOf(query).filter((t) => t.length >= 2 || /\d/.test(t));
    if (!tokens.length) return [];
    const keys = [...new Set(tokens.map(shardKey))].slice(0, 3);
    const pool = new Map();
    for (const list of await Promise.all(keys.map(shard))) for (const r of list) pool.set(r[0], r);
    const hits = [];
    for (const r of pool.values()) {
      const words = wordsOf(r[0]);
      if (tokens.every((t) => words.some((w) => w.startsWith(t)))) hits.push(r);
    }
    const first = tokens[0];
    const rank = (r) => (wordsOf(nameOf(r[0]))[0]?.startsWith(first) ? 1 : 0);
    hits.sort((a, b) => rank(b) - rank(a) || b[1] - a[1] || a[0].localeCompare(b[0]));
    return hits.slice(0, limit);
  }

  /** Find one record by exact category title (for ?category= links). */
  async function lookup(plain) {
    if (!(await staticTree().catch(() => null))) return null;
    for (const key of keysForRecord(plain)) {
      const hit = (await shard(key)).find((r) => r[0] === plain);
      if (hit) return hit;
    }
    return null;
  }
  return { search, lookup, tree, pathTo, cemeteriesAt };
}
