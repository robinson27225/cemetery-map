// How a burial is named and dated for display. Some burials have a WikiTree profile; others are only a row in a
// table (a name, dates and a headstone) and are keyed by NO_ID_PREFIX + something stable until someone adds an ID.
import { yearOf } from './wikitree-api.js';
import { hasProfile } from './links.js';

/** "MCQUEARY" -> "Mcqueary"-style tidy-up, but only when a whole name is in capitals. Mixed case is left alone. */
export function tidyName(s) {
  const t = String(s ?? '').trim();
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s'’\-.(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Mc)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
}

/** "Mary (Jones) Smith": given names, then the name at birth in brackets when it differs, then the current last name. */
export function composeName(g) {
  const given = (g.given || '').trim();
  const cur = (g.surname || '').trim();
  const birth = (g.maiden || '').trim();
  const maiden = birth && birth.toLowerCase() !== cur.toLowerCase() ? birth : '';
  const last = cur || maiden;
  return [given, cur && maiden ? `(${maiden})` : '', last].filter(Boolean).join(' ').trim();
}

/** The name to show: the WikiTree name once loaded, else what the table says, else the WikiTree ID. */
export function displayName(g) {
  return g.name || composeName(g) || (hasProfile(g.wt) ? g.wt : 'Name not recorded');
}
export const hasDisplayName = (g) => !!(g.name || composeName(g));

export function lifeSpan(g) {
  const b = yearOf(g.born), d = yearOf(g.died);
  return b || d ? `${b || '?'} – ${d || '?'}` : '';
}

/** Names and dates typed into a table row (as opposed to the ones the WikiTree API supplies for display). */
export const hasTableNames = (g) => !!(g.given || g.surname || g.maiden);

/**
 * Is this entry something the table has to keep? A location, a burial with no WikiTree profile, or anything typed
 * into the row (names, notes, a headstone photo). A profile that is only a WikiTree+ roster entry is not kept:
 * the roster lists it every time.
 */
export const isTableEntry = (g) => g.lat != null || !hasProfile(g.wt) || hasTableNames(g) || !!g.notes || !!g.photo;

/** What the label of a headstone can be taken from. "auto" tries them in order. */
export const LABEL_MODES = ['auto', 'plot', 'monument', 'reference'];
const KIND_OF = { plot: 'Plot', monument: 'Monument', reference: 'Reference' };

/** The one value everyone on a stone shares for a column ("A…" when they differ), or ''. */
function sharedValue(people, key) {
  const vals = [...new Set(people.map((m) => String(m[key] || '').trim()).filter(Boolean))];
  return !vals.length ? '' : vals.length === 1 ? vals[0] : `${vals[0]}…`;
}

/**
 * What to call a headstone: {text, kind}. With mode "auto" its Plot, else its Monument (the heading on the stone),
 * else its Reference, else (when the table has none of those columns at all) the short reference everyone on it shares
 * in Notes, else the label of an unnamed stone. A chosen mode (plot, monument or reference) uses that column first.
 * text is '' if there is nothing to show.
 */
export function labelOf(members, { mode = 'auto', notesFallback = true } = {}) {
  const people = members.filter((m) => !m.marker);
  const order = KIND_OF[mode] ? [mode, 'plot', 'monument', 'reference'] : ['plot', 'monument', 'reference'];
  for (const key of order) {
    const v = sharedValue(people, key);
    if (v) return { text: v, kind: KIND_OF[key] };
  }
  if (notesFallback) {
    const notes = people.map((m) => String(m.notes || '').trim());
    if (notes.length && notes[0] && notes[0].length <= 16 && notes.every((n) => n === notes[0])) return { text: notes[0], kind: 'Plot' };
  }
  const unnamed = members.find((m) => m.marker && m.label)?.label || '';
  return { text: unnamed, kind: 'Plot' };
}

/** The label text alone. */
export const plotLabel = (members, opts) => labelOf(members, opts).text;
