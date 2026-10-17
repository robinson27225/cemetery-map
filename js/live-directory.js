// The cemetery picker's data read straight from WikiTree, with nothing shipped alongside the app:
//   - the place hierarchy from WikiTree+'s group table (small, readable from any website);
//   - the cemeteries in a place from that place's WikiTree category page (wikitree.com pages only).
import { placeStructure, layout, GROUPS_URL, SUFFIX, clean } from './place-tree.js';
import { categoryUrl } from './spacetable.js';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  }
  return ENT[e.toLowerCase()] ?? m;
});

/**
 * Cemeteries listed under a place's category page ("Subcategories (19)").
 * Entries read "Name, Town, State (subcategories, profiles, pages)"; places (…, Cemeteries) are skipped.
 * @returns {{records:any[][], declared:number, listed:number}}
 */
export function parseCategoryCemeteries(html) {
  const head = /Subcategories\s*\((\d+)\)/.exec(html);
  if (!head) return { records: [], declared: 0, listed: 0 };
  const rest = html.slice(head.index + head[0].length);
  const end = rest.search(/<h2\b/);
  const seg = end > 0 ? rest.slice(0, end) : rest;
  const records = [];
  let listed = 0;
  for (const m of seg.matchAll(/<a href="\/wiki\/Category:[^"]+"[^>]*>([\s\S]*?)<\/a>/g)) {
    listed += 1;
    // The link text may be wrapped in spans/small tags, so read the text content.
    const label = decode(m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const t = /^(.*?)\s*\((\d+),\s*(\d+),\s*(\d+)\)\s*$/.exec(label);
    if (!t) continue;
    const name = clean(t[1]);
    if (name.endsWith(SUFFIX) || +t[3] < 1) continue;
    records.push([name, +t[3], null, null]);
  }
  records.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { records, declared: Number(head[1]), listed };
}

export function createLiveDirectory({ fetchImpl = fetch } = {}) {
  let struct = null;
  const places = new Map();
  let treePromise = null;

  function tree() {
    if (!treePromise) {
      treePromise = fetchImpl(GROUPS_URL).then((r) => {
        if (!r.ok) throw new Error(`WikiTree+ answered ${r.status}.`);
        return r.text();
      }).then((text) => {
        struct = placeStructure(text);
        const nodes = layout(struct);
        const kids = nodes.map(() => []);
        nodes.forEach((n, i) => { if (i > 0) kids[n[1]].push(i); });
        return { nodes, kids };
      });
      treePromise.catch(() => { treePromise = null; });
    }
    return treePromise;
  }

  /** @returns {Promise<{records:any[][], note?:string, url?:string}>} */
  function cemeteriesAt(index, t) {
    const cat = t.nodes[index]?.[4];
    if (index === 0 || !cat || !struct.cats.has(cat)) return Promise.resolve({ records: [] });
    if (!places.has(index)) {
      const url = categoryUrl(cat);
      places.set(index, (async () => {
        let body = '';
        try {
          const res = await fetchImpl(url, { credentials: 'include' });
          body = res.status === 200 ? await res.text() : '';
        } catch { /* blocked below */ }
        if (!body) { places.delete(index); throw new Error('blocked'); }
        const { records, declared, listed } = parseCategoryCemeteries(body);
        // Category pages show the first page of subcategories; say so if there are more.
        const note = declared > listed ? `WikiTree lists ${declared} entries here and its page shows the first ${listed}. Open the category on WikiTree to see the rest.` : '';
        return { records, url, ...(note ? { note } : {}) };
      })());
    }
    return places.get(index);
  }
  return { tree, cemeteriesAt };
}
