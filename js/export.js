import { isSpacePage } from './spacetable.js';
import { hasProfile } from './links.js';
import { composeName, hasTableNames, isTableEntry } from './people.js';

// Export helpers: cemetery JSON, shareable URL (compressed into the #fragment), WikiTree Space snippet.

export const slugify = (s) =>
  String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** The serialisable cemetery document (drops runtime-only fields). */
export function toDocument(cem) {
  const { graves, ...rest } = cem;
  const clean = (g) => Object.fromEntries(Object.entries(g).filter(([k]) => !k.startsWith('_')));
  // Profiles that are only a WikiTree+ roster entry come from WikiTree+ each time, so they don't belong in a snapshot.
  // Anything the table has to keep (see isTableEntry) does.
  return { schema: 1, ...rest, graves: graves.filter(isTableEntry).map(clean) };
}

export const toJson = (cem) => JSON.stringify(toDocument(cem), null, 1) + '\n';

const toB64Url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (str) => {
  const b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** Compact, URL-safe encoding of a cemetery document. Overlay images are not included. */
export async function encodeShare(cem) {
  const doc = toDocument(cem);
  if (doc.overlay?.image?.url?.startsWith('data:')) delete doc.overlay.image;
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  return toB64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}
export async function decodeShare(str) {
  const bytes = await pipe(fromB64Url(str), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function appUrl(base, params = {}) {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** WikiTree markup for a Space page / category description. */
export function spaceSnippet(url, name) {
  return `[${url} Cemetery Plot Map of ${name}]`;
}

export function indexEntry(cem) {
  return JSON.stringify({
    id: cem.id, name: cem.name, location: cem.location || '',
    ...(cem.source ? { source: cem.source } : {}),
    ...(cem.wikitree ? { wikitree: cem.wikitree } : {}),
  }, null, 2);
}

/**
 * WikiTree wiki-table markup for the plot-map table, in the column layout the Space page uses.
 * Paste it into the Space page's edit box (WikiTree has no write API).
 */
export function spaceTableMarkup(graves) {
  const cell = (v) => String(v ?? '').replace(/\|/g, '&#124;').replace(/\s+/g, ' ').trim();
  // Name and date columns are the table's own: they are written only for rows that came with them, so dates the
  // WikiTree API supplied for display are not copied into the table.
  const hasNames = hasTableNames;
  const sortKey = (g) => (hasProfile(g.wt) ? g.wt : `~${composeName(g) || g.wt}`);
  // Keep a row if it has a location, or if it holds something the WikiTree+ roster can't supply: a burial with no
  // WikiTree profile, or a name, notes or headstone photo typed into the table. Profiles that are only a roster
  // entry (no location, nothing else) are not written; the roster lists them every time.
  const kept = graves.filter(isTableEntry);
  // Optional columns are written only when some row has a value, so a plain table stays plain and a table that
  // already has a Plot, Monument or Reference column keeps it.
  const extra = [['Section', 'section'], ['Plot', 'plot'], ['Row', 'row'], ['Monument', 'monument'], ['Reference', 'reference']].filter(([, k]) => kept.some((g) => g[k]));
  const rows = kept.sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((g) => [
    hasProfile(g.wt) ? `[[${cell(g.wt)}]]` : '',
    g.fag ? `{{FindAGrave|${cell(g.fag)}}}` : '',
    g.fs ? `{{FamilySearch|${cell(g.fs)}}}` : '',
    g.lon ?? '',
    g.lat ?? '',
    g.photo ? `[${cell(g.photo)} Headstone]` : '',
    ...(hasNames(g) ? [g.given, g.surname, g.maiden, g.born, g.died].map(cell) : ['', '', '', '', '']),
    ...extra.map(([, k]) => cell(g[k])),
    cell(g.notes),
  ].join(' || '));
  return ['{| border="1" class="sortable"', `! WikiTree !! FindAGrave !! FamilySearch !! Long !! Lat !! Image link !! Given Names !! Surname !! Maiden !! Birth !! Death${extra.map(([h]) => ` !! ${h}`).join('')} !! Notes`,
    ...rows.map((r) => `|-\n| ${r}`), '|}'].join('\n');
}

/** Basic structural check for loaded documents (files, share links, ?cemetery=). */
export function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.graves)) throw new Error('Not a cemetery file: missing "graves" list.');
  doc.graves = doc.graves.filter((g) => g && typeof g.wt === 'string' && g.wt);
  doc.markers = (Array.isArray(doc.markers) ? doc.markers : []).filter((m) => m && Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lon)))
    .map((m) => ({ ...m, lat: Number(m.lat), lon: Number(m.lon) }));
  if (!doc.markers.length) delete doc.markers;
  for (const g of doc.graves) {
    const lat = g.lat == null || g.lat === '' ? NaN : Number(g.lat);
    const lon = g.lon == null || g.lon === '' ? NaN : Number(g.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) { g.lat = lat; g.lon = lon; } else { delete g.lat; delete g.lon; }
  }
  if (doc.source && doc.source.type === 'wikitree-space' && (isSpacePage(doc.source.page) || Array.isArray(doc.source.pages))) {
    doc.source = {
      type: 'wikitree-space',
      ...(isSpacePage(doc.source.page) ? { page: doc.source.page } : {}),
      ...(Array.isArray(doc.source.pages) ? { pages: doc.source.pages.filter(isSpacePage) } : {}),
    };
  } else delete doc.source;
  doc.name = String(doc.name || 'Cemetery');
  doc.id = String(doc.id || slugify(doc.name) || 'cemetery');
  return doc;
}
