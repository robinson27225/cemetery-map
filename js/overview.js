// The default view of the app: every cemetery that has a ready-made map, as a dot on the map with its number of rows.
// Locations come from WikiTree+'s cemetery table (the directory files) or the cemetery's own category page; the row
// counts are read from the plot-map pages and remembered for a day, because reading them is the slow part.
import { mergeReadyMade } from './plotting.js';
import { plainCategory } from './directory.js';
import { fetchSpaceTables } from './spacetable.js';

const KEY = 'wtcpm.rows.v1';
const FRESH_MS = 60 * 60 * 1000;      // a count this young is used as it is
const KEEP_MS = 7 * 24 * 60 * 60 * 1000; // an older one is still shown while a new one is read

/** One entry per ready-made cemetery that has a category: {category (plain), name, location, id?, pages[]}. */
export function overviewEntries(registered, discovered) {
  const pagesOf = new Map(discovered.map((d) => [d.category, d.pages || []]));
  const own = new Map(registered.filter((c) => c.wikitree?.category).map((c) => [plainCategory(c.wikitree.category), c.source?.page ? [c.source.page, ...(c.source.pages || [])] : []]));
  return mergeReadyMade(registered, discovered).filter((r) => r.category).map((r) => ({
    category: r.category, name: r.name, location: r.location, ...(r.id ? { id: r.id } : {}),
    pages: [...new Set([...(own.get(r.category) || []), ...(pagesOf.get(r.category) || [])])],
  }));
}

/**
 * Row counts remembered from earlier visits: {category: {rows, fresh}}. A count under an hour old is fresh; an older one (up to a
 * week) is still shown while a new one is read, because tables change as people add rows.
 */
export function readCounts({ storage = globalThis.localStorage, now = Date.now() } = {}) {
  try {
    const all = JSON.parse(storage.getItem(KEY) || '{}');
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && now - v.t < KEEP_MS).map(([k, v]) => [k, { rows: v.rows, fresh: now - v.t < FRESH_MS }]));
  } catch { return {}; }
}

export function saveCount(category, rows, { storage = globalThis.localStorage, now = Date.now() } = {}) {
  try {
    const all = JSON.parse(storage.getItem(KEY) || '{}');
    storage.setItem(KEY, JSON.stringify({ ...all, [category]: { rows, t: now } }));
  } catch { /* storage unavailable */ }
}

/** The number of rows in a cemetery's plot-map pages (people with or without a location, and unknown headstones); null if they can't be read. */
export async function countRows(entry, { fetchImpl = fetch } = {}) {
  if (!entry.pages.length) return null;
  try {
    const { graves, markers, failed } = await fetchSpaceTables(entry.pages, { fetchImpl, concurrency: 2 });
    return failed.length ? null : graves.length + markers.length; // a page that couldn't be read would give a count that is too low
  } catch { return null; }
}
