// Which cemeteries have plot maps? Every plotting page carries two categories: Plotting_Pages, and the cemetery's own
// category. So the cemeteries with maps are found by reading the Plotting_Pages category (its list of Space pages) and
// asking the WikiTree API for each page's categories. Nobody has to edit a list. Reading WikiTree pages works only from a
// *.wikitree.com page; elsewhere the registry is empty and the app falls back to cemeteries/index.json.
import { parseCategoryPages, categoryUrl, canonSpaceTitle } from './spacetable.js';
import { wordsOf, nameOf, placeOf, plainCategory, categoryTitle } from './directory.js';

export const PLOTTING_CATEGORY = 'Category:Plotting_Pages';
const API = 'https://api.wikitree.com/api.php';
const CACHE_KEY = 'wtcpm.plotting.v1';
const TTL_MS = 10 * 60 * 1000;

/**
 * The cemetery category (or categories) among a plotting page's categories. A plotting page normally has just
 * the cemetery's category besides Plotting_Pages; when it has others (a town, a church), keep those whose name
 * starts the page's title ("Fairmont Cemetery" starts "Fairmont Cemetery Raton NM USA Album 1").
 * @param {string} pageTitle e.g. "Space:Fairmont_Cemetery_Raton_NM_USA_Album_1"
 * @param {string[]} categories names without the "Category:" prefix, underscores for spaces
 */
export function cemeteryCategoriesOf(pageTitle, categories) {
  const cands = categories.filter((c) => c && c !== 'Plotting_Pages');
  if (cands.length <= 1) return cands;
  const title = wordsOf(String(pageTitle).replace(/^Space:/, '')).join(' ');
  return cands.filter((c) => {
    const name = wordsOf(nameOf(plainCategory(c))).join(' ');
    return name && (title === name || title.startsWith(`${name} `));
  });
}

/** Group plotting pages by cemetery category: [{category (plain), name, location, pages[]}], sorted by name. */
export function groupByCemetery(entries) {
  const map = new Map();
  for (const { page, categories } of entries) {
    for (const c of cemeteryCategoriesOf(page, categories)) {
      const plain = plainCategory(c);
      if (!map.has(plain)) map.set(plain, { category: plain, name: nameOf(plain), location: placeOf(plain), pages: [] });
      map.get(plain).pages.push(page);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function pageCategories(page, fetchImpl) {
  const res = await fetchImpl(`${API}?action=getCategories&key=${encodeURIComponent(page)}&appId=WikiTreeCemeteryPlotMap`);
  if (!res.ok) throw new Error(`WikiTree API ${res.status}`);
  const body = (await res.json())[0];
  return Array.isArray(body?.categories) ? body.categories : [];
}

/**
 * Read the Plotting_Pages category and work out the cemeteries. Resolves to [] when WikiTree can't be read from here.
 * @returns {Promise<{category:string,name:string,location:string,pages:string[]}[]>}
 */
export async function discoverPlotting({ fetchImpl = fetch, concurrency = 4 } = {}) {
  let html = '';
  try {
    const res = await fetchImpl(categoryUrl(PLOTTING_CATEGORY), { credentials: 'include' });
    html = res.status === 200 ? await res.text() : '';
  } catch { return []; }
  const pages = parseCategoryPages(html).map(canonSpaceTitle);
  if (!pages.length) return [];
  const found = [];
  let next = 0;
  async function worker() {
    while (next < pages.length) {
      const page = pages[next++];
      try { found.push({ page, categories: await pageCategories(page, fetchImpl) }); } catch { /* skip this page */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
  found.sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page));
  return groupByCemetery(found);
}

/** The registry, remembered for ten minutes per browser tab so reopening the picker doesn't re-read WikiTree. */
export function createPlottingRegistry({ fetchImpl = fetch, storage = globalThis.sessionStorage, now = () => Date.now() } = {}) {
  let promise = null;
  const read = () => { try { const c = JSON.parse(storage.getItem(CACHE_KEY) || 'null'); return c && now() - c.t < TTL_MS ? c.list : null; } catch { return null; } };
  const write = (list) => { try { storage.setItem(CACHE_KEY, JSON.stringify({ t: now(), list })); } catch { /* storage unavailable */ } };
  return {
    /** @returns {Promise<{category:string,name:string,location:string,pages:string[]}[]>} */
    list() {
      const cached = read();
      if (cached) return Promise.resolve(cached);
      if (!promise) {
        promise = discoverPlotting({ fetchImpl }).then((list) => { if (list.length) write(list); return list; }).finally(() => { promise = null; });
      }
      return promise;
    },
  };
}

/**
 * The picker's "ready-made maps": the hand-registered ones (cemeteries/index.json) plus every cemetery found through
 * the Plotting_Pages category, one row per cemetery. Each row says how to open it.
 * @returns {{category:string,name:string,location:string,id?:string}[]}
 */
export function mergeReadyMade(registered, discovered) {
  const rows = [];
  const seen = new Set();
  for (const c of registered) {
    const cat = c.wikitree?.category ? plainCategory(c.wikitree.category) : '';
    if (cat) seen.add(cat);
    rows.push({ category: cat, name: c.name, location: c.location || '', id: c.id });
  }
  for (const d of discovered) if (!seen.has(d.category)) { seen.add(d.category); rows.push({ category: d.category, name: d.name, location: d.location }); }
  return rows;
}

export { categoryTitle };
