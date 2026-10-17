// Unpublished changes, kept in this browser until someone pastes the updated table onto the Space page.
// An edit is { lat, lon, photo?, t } or { remove: true, t }. After the table is published, edits that match
// the freshly loaded table are pruned automatically, so this list only ever holds what's still pending.

const key = (cemId) => `wtcpm.edits.v1.${cemId}`;
const same = (a, b) => Math.abs(a - b) < 1e-6;

export function loadEdits(cemId, storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(key(cemId)) || '{}') || {}; } catch { return {}; }
}
export function saveEdits(cemId, edits, storage = globalThis.localStorage) {
  try {
    if (Object.keys(edits).length) storage.setItem(key(cemId), JSON.stringify(edits));
    else storage.removeItem(key(cemId));
    return true;
  } catch { return false; }
}

export function withEdit(edits, wt, change, now = Date.now()) {
  return { ...edits, [wt]: { ...change, t: now } };
}
export function withoutEdit(edits, wt) {
  const { [wt]: _gone, ...rest } = edits;
  return rest;
}

/**
 * Overlay edits onto graves (mutates). Graves not in the list are added. Returns the changed keys.
 * An edit may set a location and/or photo, remove the location, and/or give a burial that has no WikiTree
 * profile its WikiTree ID (assignWt), which re-keys the burial.
 */
export function applyEdits(graves, edits) {
  const byId = new Map(graves.map((g) => [g.wt, g]));
  const changed = [];
  for (const [key, e] of Object.entries(edits)) {
    let g = byId.get(key);
    if (!g) { g = { wt: key }; graves.push(g); byId.set(key, g); }
    if (e.remove) { delete g.lat; delete g.lon; } else if (e.lat != null) { g.lat = e.lat; g.lon = e.lon; }
    if (e.photo) g.photo = e.photo;
    if (e.assignWt) g.wt = e.assignWt;
    g._edited = true;
    changed.push(key);
  }
  return changed;
}

/** Drop edits that the base (freshly loaded) data already contains. */
export function pruneEdits(edits, baseGraves) {
  const byId = new Map(baseGraves.map((g) => [g.wt, g]));
  const kept = {};
  for (const [key, e] of Object.entries(edits)) {
    const b = byId.get(e.assignWt || key);
    let done;
    if (e.remove) done = !b || b.lat == null;
    else done = !!b
      && (e.lat == null || (b.lat != null && same(b.lat, e.lat) && same(b.lon, e.lon)))
      && (!e.photo || b.photo === e.photo);
    if (!done) kept[key] = e;
  }
  return kept;
}
