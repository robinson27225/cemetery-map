import { imagePageUrl } from './images.js';
import { wikiTreeUrl, hasProfile, findAGraveUrl } from './links.js';
import { displayName, labelOf } from './people.js';

// Group graves into plots (one marker per headstone) and flag data that looks suspicious.

const R = 6371000;
export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Centre of all plotted graves (median, so outliers don't drag it). */
export function centerOf(graves) {
  const p = graves.filter((g) => g.lat != null);
  if (!p.length) return null;
  return { lat: median(p.map((g) => g.lat)), lon: median(p.map((g) => g.lon)) };
}

/**
 * Plots = graves with identical coordinates (6 d.p. ≈ 0.1 m), or the same
 * headstone photo within `photoJoinM` metres of each other.
 * Returns plots sorted north→south, west→east; each has a stable `key`.
 */
export function groupPlots(graves, { photoJoinM = 3, labelBy = 'auto' } = {}) {
  const pts = graves.map((g, i) => ({ g, i })).filter(({ g }) => g.lat != null);
  const parent = pts.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => { parent[find(a)] = find(b); };

  const byCoord = new Map();
  pts.forEach(({ g }, i) => {
    const k = `${g.lat.toFixed(6)},${g.lon.toFixed(6)}`;
    if (byCoord.has(k)) union(i, byCoord.get(k)); else byCoord.set(k, i);
  });
  const byPhoto = new Map();
  pts.forEach(({ g }, i) => {
    if (!g.photo) return;
    for (const j of byPhoto.get(g.photo) || []) {
      if (distanceM(g, pts[j].g) <= photoJoinM) union(i, j);
    }
    byPhoto.set(g.photo, [...(byPhoto.get(g.photo) || []), i]);
  });

  const buckets = new Map();
  pts.forEach(({ g }, i) => {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(g);
  });
  const plots = [...buckets.values()].map((members) => {
    const lat = members.reduce((s, g) => s + g.lat, 0) / members.length;
    const lon = members.reduce((s, g) => s + g.lon, 0) / members.length;
    const photos = [...new Set(members.map((g) => g.photo).filter(Boolean))];
    return { lat, lon, members, photos };
  });
  plots.sort((a, b) => b.lat - a.lat || a.lon - b.lon);
  // Notes can say anything (Veteran, Notable), so they only name a stone when the table has no Plot, Monument or Reference column.
  const notesFallback = !graves.some((g) => g.plot || g.monument || g.reference);
  plots.forEach((p, i) => { p.key = `p${i + 1}`; { const l = labelOf(p.members, { mode: labelBy, notesFallback }); p.label = l.text; p.labelKind = l.kind; } p.members.forEach((g) => { g._plot = p.key; }); });
  return plots;
}

/**
 * Cross-record sanity checks that need the whole set. Problems that can be checked on a WikiTree page carry a link:
 * the image page for a photo, or the profile when there is no photo.
 * `center` is the cemetery's own position [lat, lon] when known; otherwise the middle of the points is used.
 */
/**
 * The "reasonable area" around a cemetery: at least a kilometre, and wider than three times the typical (median)
 * distance from the centre, so a big cemetery is not flagged for being big and a few stray points cannot widen it.
 */
export function areaLimitKm(points, c, minKm = 1) {
  if (!points.length) return minKm;
  const dist = points.map((g) => distanceM(g, c) / 1000).sort((a, b) => a - b);
  return Math.max(minKm, 3 * dist[dist.length >> 1]);
}

export function auditGraves(graves, { center = null, minOutlierKm = 1 } = {}) {
  const issues = [];
  const placed = graves.filter((g) => g.lat != null);
  const c = Array.isArray(center) ? { lat: center[0], lon: center[1] } : centerOf(placed);
  if (c && placed.length) {
    const limit = areaLimitKm(placed, c, minOutlierKm);
    placed.forEach((g) => {
      const km = distanceM(g, c) / 1000;
      if (km <= limit) return;
      const page = g.photo ? imagePageUrl(g.photo) : '';
      const fallback = hasProfile(g.wt) ? { href: wikiTreeUrl(g.wt), text: 'Profile' } : g.fag ? { href: findAGraveUrl(g.fag), text: 'Find a Grave' } : null;
      issues.push({
        level: 'warn', kind: 'outlier', wt: hasProfile(g.wt) ? g.wt : displayName(g), msg: `${km.toFixed(1)} km from the cemetery; check the coordinates.`,
        ...(page || fallback ? { links: [page ? { href: page, text: 'Image page' } : fallback] } : {}),
      });
    });
  }
  // Same photo, different spot: usually a family stone, but worth a look.
  const byPhoto = new Map();
  for (const g of graves) if (g.photo) byPhoto.set(g.photo, [...(byPhoto.get(g.photo) || []), g]);
  for (const [photo, list] of byPhoto) {
    const there = list.filter((g) => g.lat != null);
    if (there.length < 2 || !there.some((g) => distanceM(g, there[0]) > 10)) continue;
    const names = there.map((g) => (hasProfile(g.wt) ? g.wt : displayName(g)));
    const page = imagePageUrl(photo);
    issues.push({
      level: 'info', kind: 'sharedphoto',
      msg: `Photo ${photo.split('/').pop()} is shared by ${names.slice(0, 6).join(', ')}${names.length > 6 ? ` and ${names.length - 6} more` : ''}, but their coordinates differ by more than 10 m.`,
      ...(page ? { links: [{ href: page, text: 'Image page' }] } : {}),
    });
  }
  return issues;
}

/** Points inside the reasonable area, for choosing the first view (so one stray point doesn't zoom the map out). */
export function pointsInArea(points, center = null, minKm = 1) {
  const placed = points.filter((p) => p.lat != null);
  const c = Array.isArray(center) ? { lat: center[0], lon: center[1] } : centerOf(placed);
  if (!c) return placed;
  const limit = areaLimitKm(placed, c, minKm);
  const inside = placed.filter((p) => distanceM(p, c) / 1000 <= limit);
  return inside.length ? inside : placed;
}
