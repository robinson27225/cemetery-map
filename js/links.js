// URL builders and ID extractors for the three external systems we link to.

// A burial that is only a table row (no WikiTree profile yet) is keyed by this prefix plus something stable.
export const NO_ID_PREFIX = 'nowt:';
export const hasProfile = (wt) => !!wt && !String(wt).startsWith(NO_ID_PREFIX);

export const wikiTreeUrl = (id) => `https://www.wikitree.com/wiki/${encodeURIComponent(String(id).replace(/ /g, '_'))}`;
export const findAGraveUrl = (id) => `https://www.findagrave.com/memorial/${encodeURIComponent(id)}`;
export const familySearchUrl = (id) =>
  `https://www.familysearch.org/tree/person/details/${encodeURIComponent(id)}`;
export const googleMapsUrl = (lat, lon) =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
export const wikiTreeSpaceUrl = (title) => `https://www.wikitree.com/wiki/${title}`;

// WikiTree IDs look like Surname-123; the surname may be in any alphabet and contain apostrophes, hyphens, spaces.
const WT_ID = /^[\p{L}\p{M}'’.\- ]+-\d+$/u;

export function extractWikiTreeId(value) {
  let v = String(value ?? '').trim();
  if (!v) return '';
  const m = v.match(/wikitree\.com\/wiki\/([^?#\s]+)/i);
  if (m) v = decodeURIComponent(m[1]);
  // Some tables write spaces in a name as underscores (Van_De_Valde-6); the report writes them as spaces. Use spaces.
  return v.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}
export const isWikiTreeId = (id) => WT_ID.test(id) && !/^(Space|Category|Project):/i.test(id);

// Find a Grave memorial IDs are plain integers; accept a pasted memorial URL too.
export function extractFindAGraveId(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const m = v.match(/findagrave\.com\/memorial\/(\d+)/i);
  return m ? m[1] : v;
}
export const isFindAGraveId = (id) => /^\d{1,12}$/.test(id);

// FamilySearch person IDs: 4 chars, hyphen, 3 chars (e.g. G9SJ-N7S). Accept URLs.
export function extractFamilySearchId(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const m = v.match(/\b([A-Z0-9]{4}-[A-Z0-9]{3,4})\b/i);
  return m && /familysearch\.org/i.test(v) ? m[1].toUpperCase() : v.toUpperCase();
}
export const isFamilySearchId = (id) => /^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/.test(id);

export function isHttpUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}
