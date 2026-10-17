// Optional enrichment: names and dates from the public WikiTree API.
// Browsers only get a response when the page is served from a *.wikitree.com origin
// (api.wikitree.com sends no CORS header for other hosts). For other hosts, run
// tools/enrich.mjs to bake the details into the cemetery JSON instead.

import { hasProfile } from './links.js';

const API = 'https://api.wikitree.com/api.php';
const FIELDS = 'Name,FirstName,MiddleName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,DeathLocation,IsLiving,Privacy';
const CACHE_KEY = 'wtcpm.people.v1';
const TTL_MS = 7 * 24 * 3600 * 1000;

/** Reduce an API person object to the small shape we store. */
export function slimPerson(p) {
  if (Number(p.IsLiving) === 1) return { living: true }; // privacy: nothing else about a living person is kept
  const out = {};
  const first = [p.FirstName, p.MiddleName].filter(Boolean).join(' ');
  const last = p.LastNameAtBirth || p.LastNameCurrent;
  if (first || last) out.name = [first, last].filter(Boolean).join(' ');
  if (p.BirthDate && p.BirthDate !== '0000-00-00') out.born = p.BirthDate;
  if (p.DeathDate && p.DeathDate !== '0000-00-00') out.died = p.DeathDate;
  if (p.BirthLocation) out.birthPlace = p.BirthLocation;
  if (p.DeathLocation) out.deathPlace = p.DeathLocation;
  return out;
}

export function yearOf(date) {
  const m = /(\d{4})/.exec(date || ''); // "1912", "1912-03-04", "4 Mar 1912", "abt 1912"
  return m && m[1] !== '0000' ? m[1] : '';
}

export async function fetchPeople(ids, { fetchImpl = fetch, chunk = 50, appId = 'WikiTreeCemeteryPlotMap' } = {}) {
  const result = {};
  for (let i = 0; i < ids.length; i += chunk) {
    const keys = ids.slice(i, i + chunk).join(',');
    const url = `${API}?action=getPeople&keys=${encodeURIComponent(keys)}&fields=${FIELDS}&appId=${appId}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`WikiTree API ${res.status}`);
    const body = (await res.json())[0] || {};
    for (const [key, ref] of Object.entries(body.resultByKey || {})) {
      const person = ref && body.people?.[ref.Id];
      if (person) result[key] = slimPerson(person);
    }
  }
  return result;
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
}
function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* storage full or blocked */ }
}

/**
 * Fill `person` details onto graves that lack them. Calls `onUpdate` after cache hits
 * and after the network round-trip. Resolves to 'ok' | 'blocked' | 'nothing-to-do'.
 */
export async function enrichGraves(graves, onUpdate) {
  const cache = readCache();
  const now = Date.now();
  const apply = (g, p) => { Object.assign(g, p); };
  const todo = [];
  for (const g of graves) {
    if (g.name || !hasProfile(g.wt)) continue;
    const hit = cache[g.wt];
    if (hit && now - hit.t < TTL_MS) apply(g, hit.p); else todo.push(g);
  }
  onUpdate?.();
  if (!todo.length) return 'nothing-to-do';
  try {
    const people = await fetchPeople([...new Set(todo.map((g) => g.wt))]);
    for (const g of todo) {
      const p = people[g.wt];
      if (p) { apply(g, p); cache[g.wt] = { t: now, p }; }
    }
    writeCache(cache);
    onUpdate?.();
    return 'ok';
  } catch {
    return 'blocked';
  }
}

/**
 * Images attached to a profile (getPhotos). Only works from a *.wikitree.com page.
 * @returns {Promise<{name:string,title:string,date:string,location:string,url:string,thumb:string}[]>}
 */
export async function fetchPhotos(wt, { fetchImpl = fetch, appId = 'WikiTreeCemeteryPlotMap' } = {}) {
  const url = `${API}?action=getPhotos&key=${encodeURIComponent(wt)}&limit=100&appId=${appId}`;
  let body;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`WikiTree API ${res.status}`);
    body = (await res.json())[0];
  } catch (e) {
    throw new Error('blocked');
  }
  const abs = (p) => (p ? new URL(p, 'https://www.wikitree.com').href : '');
  return (body?.photos || [])
    .filter((p) => p.Type !== 'document' && p.ImageName)
    .map((p) => ({
      name: p.ImageName, title: p.Title || '', date: p.Date || '', location: p.Location || '',
      urlPath: p.URL_300 || p.URL_75 || '', thumb: abs(p.URL_300 || p.URL_75), page: abs(p.URL),
    }));
}
