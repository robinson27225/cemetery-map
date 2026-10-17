// The cemetery's profile list, from WikiTree+ (it knows every profile in the cemetery's category and
// each profile's Find a Grave memorial). plus.wikitree.com answers requests from any website.
import { isWikiTreeId, hasProfile } from './links.js';

const REPORT = 'https://plus.wikitree.com/function/WTCemetery/Cemetery.htm';

export const isCategoryTitle = (t) => /^Category:[^<>{}|\[\]\n]{3,200}$/.test(t || '');
export const reportUrl = (category) =>
  `${REPORT}?cemetery=${encodeURIComponent(category.replace(/^Category:/, '').replace(/ /g, '_'))}`;

/**
 * The report has two halves: the profiles in the category (grouped by their Find a Grave cemetery), then a
 * "Memorials" half listing Find a Grave memorials of that cemetery whose profiles are elsewhere. Only the
 * first half is this cemetery's people, so stop at the first "N Memorials" header.
 * @returns {{profiles: {wt:string, fag?:string}[], findAGraveCemetery?:string, declared?:number}}
 */
export function parseCemeteryReport(html) {
  const cut = html.search(/<th[^>]*>\s*\d+\s+Memorials?\s*<\/th>/i);
  const block = cut > 0 ? html.slice(0, cut) : html;
  const profiles = [];
  const seen = new Set();
  // A profile is a link to wikitree.com/wiki/<id or number> whose text is the WikiTree ID, optionally
  // followed by "(<memorial link>)". Profiles with no memorial are bare links.
  const re = /<a href="https:\/\/www\.wikitree\.com\/wiki\/([^"?#]+)"[^>]*>([^<]+)<\/a>(\s*\(\s*<a href="https:\/\/www\.findagrave\.com\/memorial\/(\d+)"[^>]*>[^<]*<\/a>\s*\))?/gi;
  for (const m of block.matchAll(re)) {
    if (m[1].includes(':') || m[1].includes('%3A')) continue; // Category:, Space:, ...
    const wt = m[2].trim();
    if (!isWikiTreeId(wt) || seen.has(wt)) continue;
    seen.add(wt);
    profiles.push(m[4] ? { wt, fag: m[4] } : { wt });
  }
  const linked = /Linked FG Cemetery:[\s\S]{0,800}?findagrave\.com\/cemetery\/(\d+)/i.exec(block) || /findagrave\.com\/cemetery\/(\d+)/i.exec(block);
  const n = /<th>\s*(\d+)\s+Profiles?\s*<\/th>/i.exec(block);
  return { profiles, findAGraveCemetery: linked?.[1], declared: n ? Number(n[1]) : undefined };
}

export async function fetchRoster(category, { fetchImpl = fetch } = {}) {
  if (!isCategoryTitle(category)) throw new Error('No WikiTree category is set for this cemetery.');
  const res = await fetchImpl(reportUrl(category));
  if (!res.ok) throw new Error(`WikiTree+ answered ${res.status}.`);
  const r = parseCemeteryReport(await res.text());
  if (!r.profiles.length) throw new Error('The WikiTree+ report listed no profiles for that category.');
  return r;
}

/**
 * Fold the WikiTree+ roster into the working graves (mutates). Roster profiles with no row yet are
 * added without coordinates, which is what makes the "needs a location" list. Returns data-check notes.
 */
export function mergeRoster(graves, roster, { reportHref = '' } = {}) {
  const issues = [];
  const byId = new Map(graves.map((g) => [g.wt, g]));
  const inRoster = new Set(roster.profiles.map((r) => r.wt));
  for (const r of roster.profiles) {
    const g = byId.get(r.wt);
    if (!g) { const n = { wt: r.wt, ...(r.fag ? { fag: r.fag } : {}) }; graves.push(n); byId.set(r.wt, n); continue; }
    if (r.fag && !g.fag) g.fag = r.fag;
    else if (r.fag && g.fag !== r.fag && hasProfile(g.wt)) {
      issues.push({ level: 'warn', wt: r.wt, msg: `Find a Grave memorial is ${g.fag} in the table but ${r.fag} on the WikiTree profile.` });
    }
  }
  if (roster.declared && roster.declared !== roster.profiles.length) {
    issues.push({ level: 'info', msg: `WikiTree+ says ${roster.declared} profiles but ${roster.profiles.length} could be read from its report.` });
  }
  const stray = graves.filter((g) => g.lat != null && hasProfile(g.wt) && !inRoster.has(g.wt)).map((g) => g.wt);
  // Just a count and a pointer: the WikiTree+ report is where these get sorted out.
  if (stray.length) {
    issues.push({
      level: 'info', kind: 'stray',
      msg: `${stray.length.toLocaleString()} ${stray.length === 1 ? 'profile in the table is' : 'profiles in the table are'} not in the WikiTree category.`,
      ...(reportHref ? { links: [{ href: reportHref, text: 'WikiTree+ report' }] } : {}),
    });
  }
  return issues;
}
