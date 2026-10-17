// Read plot-map tables from WikiTree Space pages (rendered HTML) into the grave records the import
// dialog produces. Two layouts are understood, and any mix of them across pages:
//   - the app's own table:  WikiTree | FindAGrave | FamilySearch | Long | Lat | Image link
//   - album-style tables:   WT-ID | Latitude | Longitude | Surname | Forename | DOB | DOD | Plot | Image
//     where the Image cell holds the picture itself (a nested table around an <img>).
// The parser is regex/tokenizer based on purpose: it runs unchanged in browsers and in Node tests.
import { parseGraves, fieldForHeader, LIVING } from './parse.js';
import { normalizePhotoRef } from './images.js';

const WT = 'https://www.wikitree.com';
// Space pages only; the title is interpolated into a URL, so keep it to safe characters. Letters in any alphabet are
// fine (Cimetière, Île d'Orléans, Québec); markup characters and slashes are not.
export const isSpacePage = (t) => /^Space:[\p{L}\p{M}\p{N}_%.,()'’\-]+$/u.test(t || '');
// Encode only non-ASCII characters, so a title that already has %XX escapes is not double-encoded.
const encodeTitle = (t) => t.replace(/[^\x00-\x7F]/g, (ch) => encodeURIComponent(ch));
export const spacePageUrl = (t) => `${WT}/wiki/${encodeTitle(t)}`;
/** One spelling for a page title: percent-escapes decoded, spaces as underscores. */
export function canonSpaceTitle(t) {
  let s = String(t);
  try { s = decodeURIComponent(s); } catch { /* leave as is */ }
  return s.replace(/ /g, '_');
}
export const categoryUrl = (cat) => `${WT}/wiki/Category:${encodeURIComponent(String(cat).replace(/^Category:/, '')).replace(/%20/g, '_')}`;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const attrAll = (html, tag, attr) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*?\\s${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'gi'))].map((m) => decode(m[1] ?? m[2]));

/**
 * Every table in the page as an array of rows of cell HTML. Tables nested inside cells (album pages wrap
 * each picture in one) are kept apart from the table they sit in.
 */
export function tablesOf(html) {
  const tables = [];
  const stack = [];
  const top = () => stack[stack.length - 1];
  const closeCell = (end) => { const c = stack.pop(); c.html = html.slice(c.start, end); top().cells.push(c.html); };
  const closeRow = () => { const r = stack.pop(); top().rows.push(r.cells); };
  for (const m of html.matchAll(/<(\/?)(table|tr|td|th)\b[^>]*>/gi)) {
    const close = m[1] === '/';
    const name = m[2].toLowerCase();
    if (name === 'table') {
      if (!close) { stack.push({ kind: 'table', rows: [] }); continue; }
      while (stack.length && top().kind !== 'table') (top().kind === 'cell' ? closeCell(m.index) : closeRow());
      if (stack.length) tables.push(stack.pop());
    } else if (name === 'tr') {
      if (top()?.kind === 'cell') closeCell(m.index);
      if (top()?.kind === 'tr') closeRow();
      if (!close && top()?.kind === 'table') stack.push({ kind: 'tr', cells: [] });
    } else if (!close) { // td / th
      if (top()?.kind === 'cell') closeCell(m.index);
      if (top()?.kind === 'tr') stack.push({ kind: 'cell', start: m.index + m[0].length });
    } else if (top()?.kind === 'cell') closeCell(m.index);
  }
  return tables.map((t) => t.rows);
}

function cellInfo(html) {
  return { text: text(html), hrefs: attrAll(html, 'a', 'href'), srcs: attrAll(html, 'img', 'src') };
}

/** Best image reference in a cell: a WikiTree image link or picture, else any link. */
function photoOf(c) {
  for (const ref of [...c.hrefs, ...c.srcs]) {
    const n = normalizePhotoRef(new URL(ref, WT).href);
    if (n) return n;
  }
  return c.hrefs[0] ? new URL(c.hrefs[0], WT).href : '';
}

/** @returns {{found: boolean, tables: number, graves: object[], issues: object[], unknownColumns: string[]}} */
export function parseSpaceTable(html) {
  // A plot table has locations, and either WikiTree IDs or pictures (tables of unknown headstones have no IDs).
  const usable = tablesOf(String(html)).filter((rows) => {
    const fields = (rows[0] || []).map((c) => fieldForHeader(text(c)));
    return fields.includes('lat') && fields.includes('lon') && (fields.includes('wt') || fields.includes('photo'));
  });
  if (!usable.length) {
    return { found: false, tables: 0, graves: [], markers: [], unknownColumns: [], issues: [{ level: 'error', kind: 'structure', msg: 'No table with locations (Lat and Long) and WikiTree IDs or pictures was found on that page.' }] };
  }
  const graves = [], markers = [], issues = [], unknown = new Set();
  for (const rows of usable) {
    const fields = rows[0].map((c) => fieldForHeader(text(c)));
    const clean = (v) => v.replace(/[\t\r\n]+/g, ' ').trim();
    const lines = [rows[0].map((c) => clean(text(c))).join('\t')];
    for (const row of rows.slice(1)) {
      if (row.some((c) => LIVING.test(text(c)))) continue; // privacy: living people are left out entirely
      lines.push(fields.map((f, i) => {
        if (row[i] == null) return '';
        const c = cellInfo(row[i]);
        if (f === 'photo') return clean(photoOf(c));
        // IDs live in link targets; prefer them over the label text.
        if ((f === 'fag' || f === 'fs') && c.hrefs[0]) return clean(new URL(c.hrefs[0], WT).href);
        return clean(c.text);
      }).join('\t'));
    }
    const r = parseGraves(lines.join('\n'));
    graves.push(...r.graves);
    markers.push(...r.markers);
    issues.push(...r.issues);
    r.unknownColumns.forEach((u) => unknown.add(u));
  }
  return { found: true, tables: usable.length, graves, markers, issues, unknownColumns: [...unknown] };
}

/** Space pages listed in a category page's "Pages" section, as titles like Space:Name_With_Underscores. */
export function parseCategoryPages(html) {
  const start = html.search(/Pages\s*\(\d+\)/);
  if (start < 0) return [];
  const end = html.slice(start).search(/Person Profiles|Free-Space Profiles/i);
  const seg = html.slice(start, end > 0 ? start + end : start + 20000);
  const out = [];
  for (const m of seg.matchAll(/href="\/wiki\/(Space:[^"#?]+)"/g)) {
    const title = canonSpaceTitle(decode(m[1]));
    if (isSpacePage(title) && !out.includes(title)) out.push(title);
  }
  return out;
}

async function getPage(fetchImpl, title) {
  let res;
  try { res = await fetchImpl(spacePageUrl(title), { credentials: 'include' }); } catch { throw new Error('blocked'); }
  if (res.status === 404) throw new Error('missing'); // the page doesn't exist (not the same as WikiTree refusing us)
  const body = res.status === 200 ? await res.text() : '';
  if (!body) throw new Error('blocked');
  return body;
}

/**
 * Fetch and parse a Space page. Only works from a *.wikitree.com origin: elsewhere WikiTree's
 * bot protection answers with an empty 202, which surfaces here as "blocked".
 */
export async function fetchSpaceTable(page, { fetchImpl = fetch } = {}) {
  if (!isSpacePage(page)) throw new Error(`"${page}" is not a WikiTree Space page title.`);
  const parsed = parseSpaceTable(await getPage(fetchImpl, page));
  if (!parsed.found) throw new Error('no-table');
  return parsed;
}

/**
 * Read plot-map tables from several Space pages (explicit ones plus any Space page listed in the category),
 * a few at a time. Pages without such a table are skipped. Each grave remembers its page in `src`.
 * @returns {{graves:object[], markers:object[], issues:object[], pages:{page:string,count:number,markers:number}[], skipped:string[]}}
 */
export async function fetchSpaceTables(pages, { fetchImpl = fetch, concurrency = 3, onProgress } = {}) {
  const list = [...new Set(pages.filter(isSpacePage))];
  const results = new Map();
  let next = 0, done = 0;
  async function worker() {
    while (next < list.length) {
      const page = list[next++];
      try { results.set(page, await fetchSpaceTable(page, { fetchImpl })); } catch (e) { results.set(page, e); }
      onProgress?.(++done, list.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  const graves = [], markers = [], issues = [], used = [], skipped = [];
  const seen = new Map();
  const counts = new Map(); // `${page}|${kind}` -> aggregated issue
  const label = (page) => page.replace(/^Space:/, '').replace(/_/g, ' ');
  const tally = (page, kind, level) => {
    const key = `${page}|${kind}`;
    if (!counts.has(key)) counts.set(key, { level, kind, page, count: 0 });
    counts.get(key).count += 1;
  };
  let blocked = 0;
  for (const page of list) { // keep the given order so the first page wins on duplicates
    const r = results.get(page);
    if (r instanceof Error) { if (r.message === 'blocked') blocked += 1; skipped.push(page); continue; }
    let count = 0;
    for (const g of r.graves) {
      if (seen.has(g.wt)) { tally(page, 'otherpage', 'info'); continue; }
      seen.set(g.wt, page);
      graves.push({ ...g, src: page });
      count += 1;
    }
    for (const m of r.markers) markers.push({ ...m, src: page });
    // One line per page and kind of problem, not one per row.
    for (const i of r.issues) {
      if (i.kind) tally(page, i.kind, i.level); else issues.push({ ...i, page, msg: `${label(page)}: ${i.msg}` });
    }
    used.push({ page, count, markers: r.markers.length });
  }
  const WHAT = {
    nocoords: ['row has no usable coordinates', 'rows have no usable coordinates'],
    badcoords: ['row has coordinates that can’t be read or are out of range', 'rows have coordinates that can’t be read or are out of range'],
    noid: ['row has no WikiTree ID yet', 'rows have no WikiTree ID yet'],
    swapped: ['row had latitude and longitude swapped (fixed)', 'rows had latitude and longitude swapped (fixed)'],
    badid: ['row has a WikiTree ID that doesn’t look right', 'rows have a WikiTree ID that doesn’t look right'],
    dupid: ['row repeats a WikiTree ID from earlier on the page', 'rows repeat a WikiTree ID from earlier on the page'],
    otherpage: ['profile is also listed on an earlier page (that one is used)', 'profiles are also listed on an earlier page (that one is used)'],
    badfag: ['row has a Find a Grave ID that doesn’t look right', 'rows have a Find a Grave ID that doesn’t look right'],
    badfs: ['row has a FamilySearch ID that doesn’t look right', 'rows have a FamilySearch ID that doesn’t look right'],
    badphoto: ['row has a headstone photo link that doesn’t look right', 'rows have a headstone photo link that doesn’t look right'],
  };
  for (const c of counts.values()) {
    const [one, many] = WHAT[c.kind] || ['row has a problem', 'rows have a problem'];
    issues.push({ level: c.level, kind: c.kind, page: c.page, count: c.count, msg: `${label(c.page)}: ${c.count.toLocaleString()} ${c.count === 1 ? one : many}.`, links: [{ href: spacePageUrl(c.page), text: 'Open the page' }] });
  }
  if (!used.length && blocked) throw new Error('blocked');
  return { graves, markers, issues, pages: used, skipped };
}

/**
 * What a cemetery's own WikiTree category page tells us: its Space pages, the Space page named in its info box,
 * its map position (the OpenStreetMap link) and its Find a Grave cemetery.
 */
export function parseCategoryInfo(html) {
  const cut = html.search(/Subcategories\s*\(\d+\)|Pages\s*\(\d+\)/);
  const top = cut > 0 ? html.slice(0, cut) : html;
  const osm = /openstreetmap\.org\/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/i.exec(top);
  const fg = /findagrave\.com\/cemetery\/(\d+)/i.exec(top);
  const sp = /href="\/wiki\/(Space:[^"#?]+)"/.exec(top);
  const space = sp ? canonSpaceTitle(decode(sp[1])) : '';
  return {
    pages: parseCategoryPages(html),
    ...(isSpacePage(space) ? { space } : {}),
    ...(osm ? { center: [Number(osm[1]), Number(osm[2])] } : {}),
    ...(fg ? { fgCemetery: fg[1] } : {}),
  };
}

/** Read a category page; {} if it can't be read (the caller falls back to what it already knows). */
export async function readCategoryPage(category, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(categoryUrl(category), { credentials: 'include' });
    const body = res.status === 200 ? await res.text() : '';
    return body ? parseCategoryInfo(body) : {};
  } catch { return {}; }
}

/** Space pages listed on a category page; [] if it can't be read. */
export async function discoverSpacePages(category, { fetchImpl = fetch } = {}) {
  return (await readCategoryPage(category, { fetchImpl })).pages || [];
}
