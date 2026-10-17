// WikiTree's cemetery place hierarchy (continent > country > state > county ...), built from the table
// WikiTree+ publishes (CIBCemeteryGroup.tsv). Shared by the live picker and tools/build-directory.mjs.

export const SUFFIX = ', Cemeteries';
export const OTHER = 'Other categories';
export const GROUPS_URL = 'https://plus.wikitree.com/Categories/CIBCemeteryGroup.tsv';

export const clean = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
export const display = (cat) => (cat.endsWith(SUFFIX) ? cat.slice(0, -SUFFIX.length) : cat);

export function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split('\n').filter(Boolean);
  const head = lines[0].split('\t');
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  return { col, rows: lines.slice(1).map((l) => l.split('\t')) };
}

/**
 * Parent/child structure of the place categories.
 * `cats` maps category title -> parent place name; `kids` maps a category (or null for top level) to its children.
 */
export function placeStructure(groupTsv) {
  const g = parseTsv(groupTsv);
  if (!('Category' in g.col) || !('parent' in g.col)) throw new Error('Group table has no Category/parent columns.');
  const cats = new Map(g.rows.map((r) => [clean(r[g.col.Category]), clean(r[g.col.parent])]));
  const resolve = (name) => {
    const p = clean(name);
    if (cats.has(`${p}${SUFFIX}`)) return `${p}${SUFFIX}`;
    return cats.has(p) ? p : null;
  };
  const parentCat = (cat) => {
    const p = cats.get(cat);
    return !p || p === 'main' ? null : resolve(p);
  };
  const kids = new Map([[null, []]]);
  for (const cat of cats.keys()) {
    // A place that points into a loop would never be reachable; hang those under "Other".
    const seen = new Set([cat]);
    let x = parentCat(cat), loop = false;
    while (x) { if (seen.has(x)) { loop = true; break; } seen.add(x); x = parentCat(x); }
    const key = loop ? null : parentCat(cat);
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key).push(cat);
  }
  const byName = (a, b) => display(a).localeCompare(display(b));
  const top = (kids.get(null) || []).filter((c) => cats.get(c) === 'main').sort(byName);
  const rest = (kids.get(null) || []).filter((c) => cats.get(c) !== 'main').sort(byName);
  return { cats, kids, top, rest, resolve, byName };
}

/** "Colfax County, New Mexico" under "New Mexico" reads better as "Colfax County". */
export function shortName(cat, parentCat) {
  const name = display(cat);
  const parent = parentCat ? display(parentCat) : '';
  return parent && name.endsWith(`, ${parent}`) ? name.slice(0, -(parent.length + 2)) : name;
}

/**
 * Flatten to node arrays [name, parentIndex, 0, 0, category]; index 0 is the root. `keep(cat)` decides which
 * places to include (the builder drops places with no cemeteries; the live picker keeps them all). Places with
 * no recorded parent go under an "Other categories" node (category = OTHER).
 */
export function layout(struct, keep = () => true) {
  const nodes = [['All places', -1, 0, 0, null]];
  const add = (cat, parentIdx, parentCat) => {
    if (!keep(cat)) return;
    const idx = nodes.length;
    nodes.push([shortName(cat, parentCat), parentIdx, 0, 0, cat]);
    for (const k of [...(struct.kids.get(cat) || [])].sort(struct.byName)) add(k, idx, cat);
  };
  for (const cat of struct.top) add(cat, 0, null);
  const otherKept = keep(OTHER) || struct.rest.some((c) => keep(c));
  if (otherKept) {
    const oi = nodes.length;
    nodes.push([OTHER, 0, 0, 0, OTHER]);
    for (const k of struct.rest) add(k, oi, null);
  }
  return nodes;
}
