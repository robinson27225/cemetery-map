// Load a cemetery listed in cemeteries/index.json. The WikiTree Space table is the live source
// when we can read it; otherwise fall back to the saved snapshot in cemeteries/<id>.json.
import { fetchSpaceTables, readCategoryPage, isSpacePage } from './spacetable.js';

export const onWikiTreeHost = (host = globalThis.location?.hostname || '') =>
  host === 'wikitree.com' || host.endsWith('.wikitree.com');

const DETAIL_KEYS = ['name', 'born', 'died', 'birthPlace', 'deathPlace'];

/** Facts from the category page that fill gaps in what we already know about the cemetery. */
function extras(info, entry, snapshot) {
  const out = {};
  const known = { ...(snapshot?.wikitree || {}), ...(entry.wikitree || {}) };
  if (info.space && !known.space) out.wikitree = { ...known, space: info.space };
  if (info.center && !(entry.center || snapshot?.center)) out.center = info.center;
  if (info.fgCemetery && !snapshot?.fgCemetery) out.fgCemetery = info.fgCemetery;
  return out;
}

/**
 * @param {{id:string,name?:string,location?:string,source?:{type:string,page:string}}} entry
 * @returns {Promise<{doc:object, origin:'live'|'snapshot', note:string}>}
 */
export async function loadCemetery(entry, { fetchImpl = fetch, live = onWikiTreeHost(), allowEmpty = false, onProgress } = {}) {
  let snapshot = null;
  try {
    const r = await fetchImpl(`cemeteries/${encodeURIComponent(entry.id)}.json`);
    if (r.ok) snapshot = await r.json();
  } catch { /* no snapshot */ }

  let source = entry.source?.type === 'wikitree-space' ? entry.source : snapshot?.source;
  const category = entry.wikitree?.category || snapshot?.wikitree?.category;
  let info = {};
  let why = 'this cemetery has no WikiTree Space table';
  if (source?.page || category) {
    if (!live) why = 'the app is not running on wikitree.com, so WikiTree blocks reading the Space pages';
    else {
      try {
        // The cemetery's own table page, any other Space pages named in its entry, and every Space page the
        // WikiTree category lists (large cemeteries keep one page per section); pages without a plot table are skipped.
        info = category ? await readCategoryPage(category, { fetchImpl }) : {};
        // A table page named by guesswork becomes "<Space page>_Plot_Map_Table" once the real Space page is known.
        if (entry.sourceGuessed && info.space && isSpacePage(`${info.space}_Plot_Map_Table`)) source = { type: 'wikitree-space', page: `${info.space}_Plot_Map_Table` };
        const found = info.pages || [];
        // A cemetery's plot-map pages are the Space pages in its WikiTree category (plus any named in its entry).
        const pages = [...new Set([source?.page, ...(source?.pages || []), ...found].filter(Boolean))];
        const { graves, markers, issues, pages: used } = await fetchSpaceTables(pages, { fetchImpl, onProgress });
        if (!graves.length && !markers.length) throw new Error('no-table');
        const doc = {
          schema: 1, id: entry.id, name: entry.name || '', location: entry.location || '',
          ...(snapshot || {}), ...(entry.wikitree ? { wikitree: entry.wikitree } : {}), ...extras(info, entry, snapshot),
          source: { type: 'wikitree-space', ...(source?.page ? { page: source.page } : {}), pages: used.map((u) => u.page) },
          graves, ...(markers.length ? { markers } : {}), _issues: issues,
        };
        doc.name = doc.name || entry.name || entry.id;
        // The cemetery's own table is the page that holds its plot map, however it was named.
        if (!used.some((u) => u.page === doc.source.page)) {
          const own = used.find((u) => /Plot_Map(_Table)?$/i.test(u.page));
          if (own) doc.source.page = own.page;
        }
        // Names/dates already fetched into the snapshot carry over; the API fills in the rest.
        const old = new Map((snapshot?.graves || []).map((g) => [g.wt, g]));
        for (const g of graves) {
          const o = old.get(g.wt);
          if (o) for (const k of DETAIL_KEYS) if (o[k] && !g[k]) g[k] = o[k];
        }
        const live_ids = new Set(graves.map((g) => g.wt));
        const gone = [...old.keys()].filter((id) => !live_ids.has(id));
        if (gone.length) issues.push({ level: 'info', msg: `In the saved snapshot but not on the Space page${used.length > 1 ? 's' : ''}: ${gone.slice(0, 20).join(', ')}${gone.length > 20 ? ` and ${gone.length - 20} more` : ''}.` });
        return { doc, origin: 'live', note: `Loaded ${graves.length} graves${markers.length ? ` and ${markers.length} unknown headstones` : ''} from ${used.length === 1 ? 'the WikiTree Space page' : `${used.length} WikiTree Space pages`}.` };
      } catch (e) {
        why = e.message === 'blocked' ? 'WikiTree did not return the Space pages'
          : e.message === 'no-table' ? 'no Space page has a plot-map table yet'
            : e.message;
      }
    }
  }
  if (snapshot) return { doc: snapshot, origin: 'snapshot', note: `Showing the saved snapshot (${why}).` };
  if (allowEmpty) {
    // A cemetery nobody has mapped yet: start from WikiTree+'s list of its profiles (loaded by the app).
    const { id, name = '', location = '', wikitree } = entry;
    const wt = { ...(wikitree || {}), ...(info.space && !wikitree?.space ? { space: info.space } : {}) };
    const center = entry.center || info.center;
    const srcPage = source && (entry.sourceGuessed && info.space && isSpacePage(`${info.space}_Plot_Map_Table`)
      ? { type: 'wikitree-space', page: `${info.space}_Plot_Map_Table` } : source);
    return {
      doc: { schema: 1, id, name: name || id, location, ...(Object.keys(wt).length ? { wikitree: wt } : {}), ...(srcPage ? { source: srcPage } : {}), ...(center ? { center } : {}), ...(info.fgCemetery ? { fgCemetery: info.fgCemetery } : {}), zoom: 19, graves: [] },
      origin: 'empty',
      note: /^(the app is not running|WikiTree did not)/.test(why)
        ? `Showing only the list of people: ${why}. Open the app from wikitree.com to see the recorded locations.`
        : 'Nobody has recorded locations for this cemetery yet. Everyone buried here is listed under "Needs a location".',
    };
  }
  throw new Error(`Cemetery "${entry.id}" has no saved snapshot and could not be read live: ${why}.`);
}
