/* global L */
import { parseGraves } from './parse.js';
import { groupPlots, auditGraves, centerOf, distanceM, pointsInArea } from './model.js';
import { createMap } from './map.js';
import { renderDetail, displayName, lifeSpan, h } from './detail.js';
import { renderEdit } from './edit.js';
import { enrichGraves, fetchPhotos } from './wikitree-api.js';
import {
  slugify, toJson, decodeShare, appUrl, spaceSnippet, indexEntry, validateDocument, spaceTableMarkup,
} from './export.js';
import { isHttpUrl, wikiTreeSpaceUrl, wikiTreeUrl, hasProfile } from './links.js';
import { hasDisplayName, isTableEntry } from './people.js';
import { loadCemetery, onWikiTreeHost } from './source.js';
import { fetchSpaceTable, fetchSpaceTables, isSpacePage, categoryUrl, spacePageUrl, readCategoryPage } from './spacetable.js';
import { overviewEntries, readCounts, saveCount, countRows } from './overview.js';
import { fetchRoster, mergeRoster, isCategoryTitle, reportUrl } from './plus.js';
import { suggestTableTitle, tablePageFromInput, tableTitleOf } from './table-title.js';
import { loadEdits, saveEdits, withEdit, applyEdits, pruneEdits } from './edits.js';
import { createDirectory, plainCategory, categoryTitle, tablePageFor, nameOf, placeOf } from './directory.js';
import { initPicker } from './picker.js';
import { createPlottingRegistry, PLOTTING_CATEGORY } from './plotting.js';
import { APP_URL, SPACE_URL, VERSION, RELEASED, DIRECTORY_BASES } from './config.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DETAIL_KEYS = ['name', 'born', 'died', 'birthPlace', 'deathPlace', 'living'];

let cem = null;          // current cemetery: metadata + `graves` (the merged working list)
let base = [];           // graves as loaded from the Space table / snapshot, before roster and edits
let baseIssues = [];
let roster = null;       // WikiTree+ profile list, once loaded
let rosterIssues = [];
let details = new Map(); // names/dates from the WikiTree API, keyed by WikiTree ID
let edits = {};          // unpublished changes (see edits.js)
let plots = [];
let issues = [];
let selectedKey = null;
let selectedWt = null;
let editing = null;      // { wt, ctl } while the Set-location panel is open
let wantedWt = params.get('wt');
let loadToken = 0;
let startedEmpty = false; // no plot-map table exists for the open cemetery yet
const directory = createDirectory({ bases: DIRECTORY_BASES });
const plotting = createPlottingRegistry();

const mapApi = createMap($('map'), {
  onSelect: (k) => { if (!editing) openPlot(k, { fly: false }); },
  onViewChange: () => {},
});

// The version sits in the map's attribution corner, so it is always visible and easy to quote in a bug report.
mapApi.map.attributionControl.setPrefix(`<a href="${SPACE_URL}" target="_blank" rel="noopener noreferrer" title="Released ${RELEASED}. About Cemetery Map on WikiTree">Cemetery Map v${VERSION}</a> | <a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>`);
document.documentElement.dataset.version = VERSION;

// "my location" control (useful when standing in the cemetery)
L.Control.Locate = L.Control.extend({
  onAdd() {
    const b = h('button', { type: 'button', class: 'secondary', title: 'Show my location', 'aria-label': 'Show my location', style: 'width:34px;height:34px;padding:0;background:var(--panel)' }, '◎');
    L.DomEvent.disableClickPropagation(b);
    b.addEventListener('click', () => mapApi.locate());
    return b;
  },
});
new L.Control.Locate({ position: 'topleft' }).addTo(mapApi.map);
mapApi.map.on('locationerror', () => status('Could not get your location.'));

// ---- status toast ------------------------------------------------------------------
let statusTimer;
function status(msg, ms = 4000) {
  const el = $('status');
  el.textContent = msg;
  el.hidden = !msg;
  clearTimeout(statusTimer);
  if (msg && ms) statusTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---- loading a cemetery -----------------------------------------------------------
function setCemetery(doc, { fit = true } = {}) {
  loadToken += 1;
  mapApi.clearOverview();
  stopEdit();
  cem = validateDocument(doc);
  base = cem.graves;
  baseIssues = cem._issues || [];
  delete cem._issues;
  roster = null; rosterIssues = []; details = new Map();
  edits = pruneEdits(loadEdits(cem.id), base);
  saveEdits(cem.id, edits);
  mapApi.setOverlay(cem.overlay);
  document.title = `${cem.name} · WikiTree Cemetery Plot Map`;
  $('cem-name').textContent = cem.name;
  $('cem-name').title = cem.wikitree?.space ? wikiTreeSpaceUrl(cem.wikitree.space) : '';
  closeDetail();
  listLimit = LIST_PAGE;
  $('label-by').value = loadLabelBy(cem.id);
  recompute({ fit });
  // A big cemetery reads better one monument at a time than as a thousand names.
  $('list-by').value = base.length > LIST_PAGE && plots.some((p) => p.members.some((m) => !m.marker)) ? 'monuments' : 'people';
  renderList();
  if (!base.some((g) => g.lat != null) && Array.isArray(cem.center)) mapApi.setView(cem.center[0], cem.center[1], cem.zoom || 18);
  loadRoster(loadToken);
}

/** Rebuild the working list: base rows + WikiTree+ roster + unpublished edits + names/dates. */
function recompute({ fit = false } = {}) {
  let graves = base.map((g) => ({ ...g }));
  applyEdits(graves, edits); // first, so a burial that has just been given a WikiTree ID merges with the roster below
  rosterIssues = roster ? mergeRoster(graves, roster, { reportHref: isCategoryTitle(cem.wikitree?.category) ? reportUrl(cem.wikitree.category) : '' }) : [];
  for (const g of graves) {
    const d = details.get(g.wt);
    if (!d) continue;
    const own = g.given || g.surname || g.maiden; // the table's own names and dates win over the API's
    for (const k of DETAIL_KEYS) if (d[k] && !g[k] && !(own && (k === 'born' || k === 'died'))) g[k] = d[k];
  }
  graves = graves.filter((g) => !g.living); // privacy: living people are never listed or mapped
  cem.graves = graves;
  // Headstones with no profile (unreadable, or marked unknown) are drawn too, but are not people.
  const markerGraves = (cem.markers || []).map((m, i) => ({ ...m, wt: `marker:${i}`, marker: true }));
  // Which of Plot, Monument and Reference the table has decides what the "Label stones by" menu offers.
  const labelSelect = $('label-by');
  const present = { plot: false, monument: false, reference: false };
  for (const g of graves) for (const k of Object.keys(present)) if (g[k]) present[k] = true;
  for (const o of labelSelect.options) o.disabled = o.value !== 'auto' && !present[o.value];
  if (labelSelect.selectedOptions[0]?.disabled) labelSelect.value = 'auto';
  $('label-by-row').hidden = !Object.values(present).some(Boolean);
  plots = groupPlots([...graves, ...markerGraves], { labelBy: labelSelect.value });
  issues = [...baseIssues, ...auditGraves(graves, { center: cem.center }), ...rosterIssues];
  mapApi.setPlots(plots, { fit, fitTo: fit ? pointsInArea(plots, cem.center) : null });
  const mapped = graves.filter((g) => g.lat != null).length;
  const need = graves.length - mapped;
  const unknown = markerGraves.length;
  const noId = graves.filter((g) => !hasProfile(g.wt)).length;
  const profiles = graves.length - noId;
  $('cem-sub').textContent = [cem.location, `${profiles.toLocaleString()} ${profiles === 1 ? 'profile' : 'profiles'}${noId ? ` · ${noId.toLocaleString()} without a WikiTree ID` : ''} · ${mapped.toLocaleString()} on the map${need ? ` · ${need.toLocaleString()} need a location` : ''}${unknown ? ` · ${unknown.toLocaleString()} unknown headstones` : ''}`].filter(Boolean).join(' · ');
  renderList();
  renderReport();
  renderPending();
  renderLinks();
  if (selectedWt && !editing) showPerson(selectedWt, { quiet: true });
  openWanted();
}

async function loadRoster(token) {
  const cat = cem.wikitree?.category;
  if (!isCategoryTitle(cat)) return;
  try {
    const r = await fetchRoster(cat);
    if (token !== loadToken) return;
    roster = r;
    if (r.findAGraveCemetery) cem.fgCemetery = r.findAGraveCemetery;
  } catch (e) {
    if (token === loadToken) status(`Couldn’t load the list of people buried here from WikiTree+ (${e.message}). Showing only profiles that already have a location.`, 8000);
    return;
  }
  recompute();
  const target = cem.graves;
  enrichGraves(target, () => {
    if (token !== loadToken) return;
    for (const g of target) if (g.name) details.set(g.wt, Object.fromEntries(DETAIL_KEYS.filter((k) => g[k]).map((k) => [k, g[k]])));
    for (const g of cem.graves) { const d = details.get(g.wt); if (d) for (const k of DETAIL_KEYS) if (d[k] && !g[k]) g[k] = d[k]; }
    renderList();
    if (selectedWt && !editing) showPerson(selectedWt, { quiet: true });
  });
}

function openWanted() {
  if (!wantedWt || !cem) return;
  const g = cem.graves.find((x) => x.wt.toLowerCase() === wantedWt.toLowerCase());
  const rosterPending = isCategoryTitle(cem.wikitree?.category) && !roster;
  if (!g) {
    if (!rosterPending) { status(`${wantedWt} is not in this cemetery's list.`, 6000); wantedWt = null; }
    return;
  }
  const wt = g.wt;
  wantedWt = null;
  if (g.lat != null) showPerson(wt); else startEdit(wt);
}

const progress = (done, total) => { if (total > 1) status(`Reading the cemetery’s Space pages… ${done} of ${total}`, 0); };
let index = [];
async function openById(id, { fit = true } = {}) {
  const entry = index.find((c) => c.id === id) || { id };
  // allowEmpty: a registered cemetery with no saved snapshot still opens (live on wikitree.com, or as its WikiTree+ list elsewhere).
  const { doc, origin, note } = await loadCemetery(entry, { onProgress: progress, allowEmpty: true });
  startedEmpty = origin === 'empty';
  setCemetery(doc, { fit });
  $('cem-sub').title = note;
  status(note, origin === 'live' ? 3000 : 7000);
  history.replaceState(null, '', appUrl(location.href, { cemetery: id }));
  return origin;
}

/** Open any WikiTree cemetery category from the directory: [category, profiles, lat, lon, spacePage?]. */
async function openRecord(rec, { fit = true } = {}) {
  const [category, , lat, lon, space] = rec;
  const registered = index.find((c) => c.wikitree?.category && plainCategory(c.wikitree.category) === category);
  if (registered) return openById(registered.id, { fit });
  const page = tablePageFor(rec);
  const entry = {
    id: slugify(category), name: nameOf(category), location: placeOf(category),
    wikitree: { category: categoryTitle(category), ...(space ? { space: `Space:${space}` } : {}) },
    ...(isSpacePage(page) ? { source: { type: 'wikitree-space', page } } : {}),
    ...(!space ? { sourceGuessed: true } : {}), // the real Space page name is read from the category page when we can
    ...(lat != null ? { center: [lat, lon] } : {}),
  };
  const { doc, origin, note } = await loadCemetery(entry, { allowEmpty: true, onProgress: progress });
  startedEmpty = origin === 'empty';
  setCemetery(doc, { fit });
  $('cem-sub').title = note;
  status(note, 8000);
  history.replaceState(null, '', appUrl(location.href, { category: category.replace(/ /g, '_') }));
  return origin;
}

async function loadIndex() {
  try {
    const res = await fetch('cemeteries/index.json');
    index = res.ok ? (await res.json()).cemeteries || [] : [];
  } catch { index = []; }
}

const picker = initPicker({
  dlg: $('dlg-pick'),
  directory,
  registered: () => index,
  discovered: () => plotting.list(),
  onRegistered: (id) => openById(id).catch((err) => status(err.message, 6000)),
  onRecord: (rec) => openRecord(rec).catch((err) => status(err.message, 6000)),
});
$('btn-pick').addEventListener('click', () => picker.open());

// ---- list + search -----------------------------------------------------------------
function matches(g, q) {
  return [g.name, g.given, g.surname, g.maiden, g.notes, hasProfile(g.wt) ? g.wt : '', g.fag, g.fs, g.section, g.plot, g.monument, g.reference].some((v) => v && String(v).toLowerCase().includes(q));
}
const LABEL_KEY = 'wtcpm.labelby.v1'; // the chosen way to label stones, per cemetery, kept in this browser
function loadLabelBy(id) { try { return JSON.parse(localStorage.getItem(LABEL_KEY) || '{}')[id] || 'auto'; } catch { return 'auto'; } }
function saveLabelBy(id, v) { try { localStorage.setItem(LABEL_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(LABEL_KEY) || '{}'), [id]: v })); } catch { /* storage unavailable */ } }
const LIST_PAGE = 600; // rows shown at a time; "Show more" adds another page
let listLimit = LIST_PAGE;
const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

function renderList() {
  if (!cem) return;
  if ($('list-by').value === 'monuments') renderMonuments(); else renderPeople();
}

/** "Show N more" row at the end of a long list. */
function moreRow(left) {
  return h('li', { class: 'more' }, h('button', { type: 'button', class: 'secondary', onclick: () => { listLimit += LIST_PAGE; renderList(); } },
    `Show ${Math.min(left, LIST_PAGE).toLocaleString()} more (${left.toLocaleString()} left)`));
}

function renderPeople() {
  const q = $('q').value.trim().toLowerCase();
  const f = $('filter').value;
  const plotOf = new Map();
  for (const p of plots) for (const m of p.members) if (!m.marker) plotOf.set(m.wt, p);
  const rows = [];
  for (const g of cem.graves) {
    const p = plotOf.get(g.wt) || null;
    if (f === 'needs' && p) continue;
    if (f === 'mapped' && !p) continue;
    if (f === 'noid' && hasProfile(g.wt)) continue;
    if (q && !matches(g, q)) continue;
    rows.push({ p, g });
  }
  rows.sort((a, b) => displayName(a.g).localeCompare(displayName(b.g)));
  const shown = rows.slice(0, listLimit);
  $('count').textContent = rows.length > shown.length
    ? `Showing ${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} people. Search, filter or list by monument to narrow it down.`
    : `${rows.length.toLocaleString()} of ${cem.graves.length.toLocaleString()} people${q || f !== 'all' ? ' shown' : ''}`;
  const items = shown.map(({ p, g }) => {
    const show = () => { if (p) openPlot(p.key); else openPerson(g.wt); document.body.classList.remove('side-open'); };
    const go = () => { if (p) show(); else startEdit(g.wt); document.body.classList.remove('side-open'); };
    const label = displayName(g);
    return h('li', { class: `row${(p ? p.key === selectedKey : g.wt === selectedWt) ? ' current' : ''}`, onclick: (e) => { if (!e.target.closest('a, button')) show(); } },
      h('div', { class: 'row-text' },
        hasProfile(g.wt)
          ? h('a', { class: 'row-name', href: wikiTreeUrl(g.wt), target: '_blank', rel: 'noopener noreferrer', title: `Open ${g.wt} on WikiTree` }, label)
          : h('span', { class: 'row-name' }, label),
        h('span', { class: 'sub' }, [hasProfile(g.wt) ? (hasDisplayName(g) ? g.wt : null) : 'no WikiTree ID yet', lifeSpan(g), p ? null : 'needs a location', g._edited ? 'unpublished' : null].filter(Boolean).join(' · '))),
      // One button per job: Map (show them), Locate (add a location), Identify (add a WikiTree ID).
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'row-go secondary', 'aria-label': `${p ? 'Show on the map' : 'Set a location for'} ${label}`, onclick: go }, p ? 'Map' : 'Locate'),
        hasProfile(g.wt) ? null : h('button', { type: 'button', class: 'row-go secondary', 'aria-label': `Add a WikiTree ID for ${label}`, onclick: () => { startEdit(g.wt, { focus: 'id' }); document.body.classList.remove('side-open'); } }, 'Identify')));
  });
  $('results').replaceChildren(...items, ...(rows.length > shown.length ? [moreRow(rows.length - shown.length)] : []));
}

/** One row per headstone: its plot number or reference, how many are buried there, and who. */
function renderMonuments() {
  const q = $('q').value.trim().toLowerCase();
  const f = $('filter').value;
  const stones = plots.map((p) => ({ p, people: p.members.filter((m) => !m.marker) }))
    .filter(({ p, people }) => (people.length || p.members.length)
      && (f !== 'noid' || people.some((m) => !hasProfile(m.wt)))
      && (f !== 'needs')
      && (!q || String(p.label || '').toLowerCase().includes(q) || people.some((m) => matches(m, q))));
  stones.sort((a, b) => naturalCompare(a.p.label || displayName(a.people[0] || {}), b.p.label || displayName(b.people[0] || {})));
  const unplaced = cem.graves.filter((g) => !plots.some((p) => p.members.includes(g))).length;
  const shown = stones; // every monument is listed: a headstone is one row, so even a big cemetery stays manageable
  $('count').textContent = `${stones.length.toLocaleString()} ${stones.length === 1 ? 'monument' : 'monuments'}${q || f !== 'all' ? ' shown' : ''}${unplaced ? ` · ${unplaced.toLocaleString()} people have no location yet` : ''}`;
  const rows = shown.map(({ p, people }) => {
    const names = people.map(displayName);
    const sub = people.length
      ? `${people.length} ${people.length === 1 ? 'burial' : 'burials'}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`
      : 'Unknown headstone';
    const show = () => { openPlot(p.key); document.body.classList.remove('side-open'); };
    return h('li', { class: `row${p.key === selectedKey ? ' current' : ''}`, onclick: (e) => { if (!e.target.closest('a, button')) show(); } },
      h('div', { class: 'row-text' },
        h('span', { class: 'row-name' }, p.label ? p.label : (names[0] || 'Unknown headstone')),
        h('span', { class: 'sub' }, sub)),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'row-go secondary', 'aria-label': `Show monument ${p.label || names[0] || ''} on the map`, onclick: show }, 'Map')));
  });
  const tail = [];
  if (unplaced && f !== 'mapped') {
    tail.push(h('li', { class: 'more' }, h('button', { type: 'button', class: 'link-btn', onclick: () => { $('list-by').value = 'people'; $('filter').value = 'needs'; listLimit = LIST_PAGE; renderList(); } },
      `Show the ${unplaced.toLocaleString()} people who have no location yet`)));
  }
  $('results').replaceChildren(...rows, ...tail);
}
$('q').addEventListener('input', () => { listLimit = LIST_PAGE; renderList(); });
$('filter').addEventListener('change', () => { listLimit = LIST_PAGE; renderList(); });
$('list-by').addEventListener('change', () => { listLimit = LIST_PAGE; renderList(); });
$('label-by').addEventListener('change', () => { saveLabelBy(cem.id, $('label-by').value); recompute(); renderList(); });

// Long kinds of finding are shown in part, with the rest counted, so a big cemetery doesn't produce a wall of text.
const REPORT_CAP = { sharedphoto: 30, outlier: 30, badfag: 20, dupid: 20 };
function renderReport() {
  const box = $('report');
  box.hidden = !issues.length;
  if (!issues.length) return;
  const shown = [], left = new Map();
  const per = new Map();
  for (const i of [...issues].sort((a, b) => (a.level === 'warn' ? 0 : 1) - (b.level === 'warn' ? 0 : 1))) {
    const cap = REPORT_CAP[i.kind];
    const n = (per.get(i.kind) || 0) + 1;
    per.set(i.kind, n);
    if (cap && n > cap) left.set(i.kind, (left.get(i.kind) || 0) + 1); else shown.push(i);
  }
  const warn = issues.filter((i) => i.level !== 'info').length;
  $('report-summary').textContent = `Data check: ${warn} to review, ${issues.length - warn} notes`;
  const item = (i) => h('li', { class: i.level }, [i.row ? `Row ${i.row}` : null, i.wt, i.msg].filter(Boolean).join(' · '),
    ...(i.links || []).flatMap((l) => [' ', h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, l.text)]));
  $('report-list').replaceChildren(...shown.map(item),
    ...[...left].map(([kind, n]) => h('li', { class: 'info' }, `…and ${n.toLocaleString()} more like the ones above (${kind === 'sharedphoto' ? 'shared photos' : kind === 'outlier' ? 'far from the cemetery' : kind}).`)));
  box.open = issues.some((i) => i.level === 'warn' && !i.wt && !i.page); // open on structural problems
}

// ---- links to the cemetery on WikiTree, Find a Grave and WikiTree+ -----------------------
function renderLinks() {
  const box = $('cem-links');
  if (!cem) { box.replaceChildren(); return; }
  const a = (href, text, title) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', title }, text);
  const parts = [];
  if (cem.wikitree?.category) parts.push(a(categoryUrl(cem.wikitree.category), 'WikiTree category'));
  if (cem.wikitree?.space) parts.push(a(wikiTreeSpaceUrl(cem.wikitree.space), 'Space page'));
  const pages = cem.source?.pages?.length ? cem.source.pages : cem.source?.page && !startedEmpty ? [cem.source.page] : [];
  if (pages.length === 1) parts.push(a(spacePageUrl(pages[0]), 'Plot-map table', 'The Space page this map reads its locations from'));
  else if (pages.length > 1) {
    parts.push(h('details', { class: 'pages' }, h('summary', {}, `Plot-map pages (${pages.length})`),
      h('ul', {}, pages.map((pg) => h('li', {}, a(spacePageUrl(pg), pg.replace(/^Space:/, '').replace(/_/g, ' ')))))));
  }
  if (cem.fgCemetery) parts.push(a(`https://www.findagrave.com/cemetery/${cem.fgCemetery}`, 'Find a Grave cemetery'));
  if (isCategoryTitle(cem.wikitree?.category)) parts.push(a(reportUrl(cem.wikitree.category), 'WikiTree+ report', 'Detailed report on this cemetery’s profiles and related Find a Grave cemeteries'));
  box.replaceChildren(...parts.flatMap((el, i) => (i ? [h('span', { 'aria-hidden': 'true' }, ' · '), el] : [el])));
}

// ---- detail panel ----------------------------------------------------------------
function openPlot(key, { fly = true } = {}) {
  const plot = plots.find((p) => p.key === key);
  if (!plot) return;
  stopEdit();
  selectedKey = key;
  selectedWt = plot.members[0].wt;
  // Keep the marker visible beside (desktop) or above (phone) the detail panel.
  const d = $('detail');
  const offset = () => (window.matchMedia('(max-width: 800px)').matches ? [0, d.offsetHeight / 2] : [d.offsetWidth / 2, 0]);
  renderDetail(d, plot, {
    onClose: closeDetail,
    onCopy: (t) => navigator.clipboard?.writeText(t).then(() => status('Coordinates copied', 1500), () => status(t, 6000)),
    onLayout: () => { if (selectedKey === key) mapApi.reveal(key, offset()); },
    onEdit: startEdit,
  });
  document.body.classList.add('has-detail');
  mapApi.select(key, { fly, offset: offset() });
  renderList();
}
function showPerson(wt, { quiet = false } = {}) {
  const plot = plots.find((p) => p.members.some((m) => m.wt === wt));
  if (plot) openPlot(plot.key, { fly: !quiet });
  else if (cem.graves.some((g) => g.wt === wt)) openPerson(wt);
  else closeDetail();
}

/** Details for someone who has no location yet: their name, dates, notes, links and headstone photo. */
function openPerson(wt) {
  const g = cem.graves.find((x) => x.wt === wt);
  if (!g) return;
  const plot = plots.find((p) => p.members.some((m) => m.wt === wt));
  if (plot) { openPlot(plot.key); return; }
  stopEdit();
  selectedKey = null;
  selectedWt = wt;
  mapApi.select(null);
  renderDetail($('detail'), { lat: null, lon: null, photos: g.photo ? [g.photo] : [], members: [g] }, { onClose: closeDetail, onCopy: () => {}, onEdit: startEdit });
  document.body.classList.add('has-detail');
  renderList();
}
function closeDetail() {
  stopEdit();
  selectedKey = null;
  selectedWt = null;
  document.body.classList.remove('has-detail');
  $('detail').hidden = true;
  mapApi.select(null);
  renderList();
}

$('color-by').addEventListener('change', (e) => mapApi.setMode(e.target.value));
$('toggle-side').addEventListener('click', () => {
  const open = document.body.classList.toggle('side-open');
  $('toggle-side').setAttribute('aria-expanded', String(open));
});

// ---- editing a profile's location / photo ------------------------------------------
function startEdit(wt, { focus = '' } = {}) {
  const g = cem.graves.find((x) => x.wt === wt);
  if (!g) return;
  stopEdit();
  const plot = plots.find((p) => p.members.some((m) => m.wt === wt));
  selectedKey = null;
  selectedWt = null;
  mapApi.select(null);
  document.body.classList.add('has-detail');
  document.body.classList.remove('side-open');
  const ctl = renderEdit($('detail'), {
    grave: g,
    mates: plot ? plot.members.filter((m) => m.wt !== wt && !m.marker) : [],
    mapped: cem.graves.filter((m) => m.lat != null && m.wt !== wt),
    cemName: cem.name,
    getPhotos: onWikiTreeHost() && hasProfile(wt) ? (id) => fetchPhotos(id) : null,
    hasId: (id) => cem.graves.some((x) => x.wt === id),
    focus,
    pick: (initial, onChange) => mapApi.startPick(initial, onChange),
    say: (m) => status(m, 7000),
    onCancel: () => { editing = null; showPerson(wt, { quiet: true }); },
    onRemove: () => commitEdits([wt], { remove: true }, wt, 'Location removed. Publish to share the change.'),
    onSave: (change, { withMates }) => {
      // Others on the same stone share the location and photo, never the WikiTree ID.
      const { assignWt, ...shared } = change;
      for (const m of withMates && plot ? plot.members.filter((x) => x.wt !== wt && !x.marker) : []) edits = withEdit(edits, m.wt, shared);
      commitEdits([wt], change, assignWt || wt, 'Saved on this device. Use Publish to share it on WikiTree.');
    },
  });
  editing = { wt, ctl };
}
function stopEdit() {
  if (editing) { editing.ctl.stop(); editing = null; }
  mapApi.stopPick();
}
function commitEdits(wts, change, focusWt, msg) {
  for (const w of wts) edits = withEdit(edits, w, change);
  const ok = saveEdits(cem.id, edits);
  editing = null;
  recompute();
  showPerson(focusWt);
  status(ok ? msg : 'Saved for this visit only: the browser wouldn’t let this page store it. Publish before closing the tab.', ok ? 5000 : 9000);
}

// ---- unpublished changes + publishing ------------------------------------------------
function renderPending() {
  const n = Object.keys(edits).length;
  $('pending').hidden = !n;
  $('pending-text').textContent = `${n} unpublished ${n === 1 ? 'change' : 'changes'}, saved on this device only.`;
}
$('btn-discard').addEventListener('click', () => {
  if (!confirm('Throw away all unpublished changes on this device?')) return;
  edits = {};
  saveEdits(cem.id, edits);
  recompute();
  status('Unpublished changes discarded.');
});

function describeChange(wt, e) {
  const b = base.find((g) => g.wt === wt);
  const g = cem.graves.find((x) => x.wt === (e.assignWt || wt)) || {};
  const who = hasProfile(wt) ? (g.name ? `${g.name} (${wt})` : wt) : displayName(g);
  if (e.remove) return `${who}: location removed`;
  const parts = [];
  if (e.assignWt) parts.push(`WikiTree ID ${e.assignWt} added`);
  if (e.lat != null) {
    if (!b || b.lat == null) parts.push('new location');
    else {
      const m = distanceM(b, e);
      if (m >= 0.1) parts.push(`moved ${m < 10 ? m.toFixed(1) : Math.round(m)} m`);
    }
  }
  if (e.photo && (!b || b.photo !== e.photo)) parts.push(b?.photo ? 'photo changed' : 'photo added');
  const other = b?.src && b.src !== cem.source?.page ? ` (on ${b.src.replace(/^Space:/, '').replace(/_/g, ' ')})` : '';
  return `${who}: ${parts.join(', ') || 'no change'}${other}`;
}

$('btn-publish').addEventListener('click', async () => {
  const primary = cem.source?.page || '';
  const loaded = cem.source?.pages || [];
  const known = [...new Set([primary, ...loaded].filter(Boolean))];
  const primaryExists = !!primary && (loaded.includes(primary) || (!loaded.length && !startedEmpty));
  let note;
  if (known.length && !startedEmpty && onWikiTreeHost()) {
    try {
      const r = await fetchSpaceTables(known);
      base = r.graves; // rebase onto what's on the Space pages right now
      edits = pruneEdits(edits, base);
      saveEdits(cem.id, edits);
      recompute();
      note = 'The Space pages were re-read just now, so your changes are applied on top of their latest content.';
    } catch {
      note = 'The Space pages could not be re-read, so this is based on what was loaded earlier. If someone else has edited the table since, pasting it will overwrite their changes. Reload first if unsure.';
    }
  } else if (primary && !primaryExists) {
    note = '';
  } else if (primary) {
    note = 'This app can’t read the Space page from here, so the table is based on the saved snapshot. If the Space page has changed since, pasting this will overwrite those changes. Open the app from wikitree.com to avoid that.';
  } else {
    note = 'This cemetery has no plot-map table page yet. Create a Space page for it (for example titled ' + suggestTableTitle(cem.name, cem.location) + '), put it in the cemetery’s category and Plotting_Pages, and paste the table there.';
  }
  if (primary && !primaryExists) {
    note = `Nobody has published the plot-map table ${primary.replace(/_/g, ' ')} for this cemetery yet. Create that Space page (the editor link below opens it) and paste the table as its content. If the page already exists with a table, open it and merge by hand instead of pasting over it.${note ? ` ${note}` : ''}`;
  }
  if (!Object.keys(edits).length) { status('Those changes are already on the Space page.', 6000); return; }

  // Profiles whose current row lives on another page (e.g. a section album) can't be written into our table.
  const where = (wt) => base.find((g) => g.wt === wt)?.src;
  const external = Object.entries(edits).filter(([wt]) => where(wt) && where(wt) !== primary);
  const standard = Object.keys(edits).length - external.length;
  $('pub-intro').textContent = note;
  $('pub-changes').replaceChildren(...Object.entries(edits).map(([wt, e]) => h('li', {}, describeChange(wt, e))));
  $('pub-std').hidden = !standard || !primary;
  $('pub-table').value = spaceTableMarkup(cem.graves.filter((g) => !g.src || g.src === primary));
  const catStep = $('pub-cat-step');
  const cat = cem.wikitree?.category;
  catStep.hidden = !isCategoryTitle(cat);
  if (!catStep.hidden) $('pub-cat').textContent = `[[${cat}]] [[${PLOTTING_CATEGORY}]]`;
  const open = $('pub-open');
  if (primary) { open.href = `https://www.wikitree.com/index.php?title=${encodeURIComponent(primary)}&action=edit`; open.hidden = false; } else open.hidden = true;
  const byPage = new Map();
  for (const [wt, e] of external) { const pg = where(wt); byPage.set(pg, [...(byPage.get(pg) || []), [wt, e]]); }
  $('pub-external').hidden = !byPage.size;
  $('pub-external-list').replaceChildren(...[...byPage].map(([pg, list]) => h('li', {},
    h('a', { href: `https://www.wikitree.com/index.php?title=${encodeURIComponent(pg)}&action=edit`, target: '_blank', rel: 'noopener noreferrer' }, `Edit ${pg.replace(/^Space:/, '').replace(/_/g, ' ')}`),
    h('pre', {}, list.map(([wt, e]) => (e.remove ? `${wt}: remove the location` : `${wt}: ${e.lat}, ${e.lon}${e.photo ? `, image ${e.photo}` : ''}`)).join('\n')))));
  $('dlg-publish').showModal();
});
$('pub-copy').addEventListener('click', async () => {
  const t = $('pub-table');
  try { await navigator.clipboard.writeText(t.value); status('Table copied.', 2000); } catch { t.select(); status('Press Ctrl/⌘+C to copy the selected table.', 5000); }
});
$('pub-table').addEventListener('focus', (e) => e.target.select());

// ---- import ------------------------------------------------------------------------
const dlgImport = $('dlg-import');
/** When a cemetery is open, the Import dialog starts with its details; the rows to plot are still pasted or chosen. */
/** The open cemetery's plot-map page: its real one, or (nobody has mapped it yet) a suggested title for a new page. */
function tablePageForOpen() {
  const real = index.find((c) => c.id === cem.id)?.source?.page || (startedEmpty ? '' : cem.source?.page);
  return real || tablePageFromInput(suggestTableTitle(cem.name, cem.location));
}
let importFilledFor = null;
function prefillImport() {
  if (!cem || importFilledFor === cem.id) return;
  importFilledFor = cem.id;
  $('imp-name').value = cem.name || '';
  $('imp-loc').value = cem.location || '';
  $('imp-id').value = cem.id || '';
  $('imp-id').dataset.touched = '1';
  $('imp-space').value = cem.wikitree?.space || '';
  $('imp-cat').value = cem.wikitree?.category || '';
  // The table page is shown as the title you type into WikiTree's new-page box. A cemetery that nobody has mapped yet gets a suggestion.
  $('imp-table').value = tableTitleOf(tablePageForOpen());
}
$('btn-import').addEventListener('click', () => { prefillImport(); dlgImport.showModal(); });
$('imp-name').addEventListener('input', () => { if (!$('imp-id').dataset.touched) $('imp-id').value = slugify($('imp-name').value); });
$('imp-id').addEventListener('input', () => { $('imp-id').dataset.touched = '1'; });
$('imp-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) $('imp-text').value = await f.text();
});
$('imp-sample').addEventListener('click', async () => {
  $('imp-name').value = 'Fairview Presbyterian Cemetery';
  $('imp-loc').value = 'Raton, Colfax, New Mexico, USA';
  $('imp-id').value = 'fairview-raton-nm';
  $('imp-space').value = 'Space:Fairview_Presbyterian_Cemetery_Raton_NM_USA';
  $('imp-cat').value = 'Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico';
  $('imp-table').value = 'Fairview Presbyterian Cemetery Raton NM USA Plot Map Table';
  $('imp-text').value = await (await fetch('samples/fairview-raton.tsv')).text();
});
$('imp-fetch').addEventListener('click', async () => {
  const page = tablePageFromInput($('imp-table').value);
  if (!isSpacePage(page)) { status('Enter the title of the plot-map Space page, e.g. Fern Hill Cemetery Aberdeen WA USA Plot Map Table', 6000); return; }
  if (!onWikiTreeHost()) { status('Reading a Space page only works when this app is served from wikitree.com. Paste the table instead.', 8000); return; }
  try {
    const { graves } = await fetchSpaceTable(page);
    $('imp-text').value = ['WikiTree ID', 'FindAGrave', 'FamilySearch', 'Long', 'Lat', 'Headstone photo', 'Given Names', 'Surname', 'Maiden', 'Birth', 'Death', 'Plot', 'Notes'].join('\t') + '\n' +
      graves.map((g) => [hasProfile(g.wt) ? g.wt : '', g.fag, g.fs, g.lon, g.lat, g.photo, g.given, g.surname, g.maiden, g.born, g.died, g.plot, g.notes]
        .map((v) => String(v ?? '').replace(/[\t\n]+/g, ' ')).join('\t')).join('\n');
    status(`Read ${graves.length} rows from the Space page. Check the details above, then Plot on map.`, 6000);
  } catch (e) {
    status(e.message === 'no-table' ? 'That page has no table with WikiTree, Long and Lat columns.' : 'WikiTree did not return that page.', 6000);
  }
});
$('form-import').addEventListener('submit', (e) => {
  if (e.submitter?.id !== 'imp-go') return;
  const { graves, issues: parseIssues, unknownColumns } = parseGraves($('imp-text').value);
  if (unknownColumns.length) parseIssues.push({ level: 'info', msg: `Ignored columns: ${unknownColumns.join(', ')}.` });
  if (!graves.length) {
    e.preventDefault();
    status(parseIssues.find((i) => i.level === 'error')?.msg || 'No graves found.', 6000);
    return;
  }
  const name = $('imp-name').value.trim() || 'Cemetery';
  const c = centerOf(graves);
  const space = $('imp-space').value.trim();
  const category = $('imp-cat').value.trim();
  const tablePage = tablePageFromInput($('imp-table').value);
  const wikitree = { ...(space ? { space } : {}), ...(isCategoryTitle(category) ? { category } : {}) };
  startedEmpty = false;
  setCemetery({
    schema: 1, id: $('imp-id').value.trim() || slugify(name), name, location: $('imp-loc').value.trim(),
    ...(Object.keys(wikitree).length ? { wikitree } : {}),
    ...(isSpacePage(tablePage) ? { source: { type: 'wikitree-space', page: tablePage } } : {}),
    center: c ? [c.lat, c.lon] : undefined, zoom: 19, graves, _issues: parseIssues,
  });
  history.replaceState(null, '', appUrl(location.href, {}));
  status(`Plotted ${graves.filter((g) => g.lat != null).length} of ${graves.length} graves.`);
});

// ---- export ------------------------------------------------------------------------
$('btn-export').addEventListener('click', async () => {
  if (!cem) { status('Load or import a cemetery first.'); return; }
  const registered = index.some((c) => c.id === cem.id);
  // The permanent link always points at the published app, whichever copy is open.
  const link = registered || !cem.wikitree?.category
    ? appUrl(APP_URL, { cemetery: cem.id })
    : appUrl(APP_URL, { category: cem.wikitree.category.replace(/^Category:/, '') });
  $('ex-json-name').textContent = `${cem.id}.json`;
  $('ex-index').value = indexEntry(cem);
  $('ex-url').value = link;
  $('ex-markup').value = spaceSnippet(link, cem.name);
  $('ex-table').value = spaceTableMarkup(cem.graves);
  const cat = cem.wikitree?.category;
  const hasCat = isCategoryTitle(cat);
  $('ex-cat').value = [hasCat ? `[[${cat}]]` : '', `[[${PLOTTING_CATEGORY}]]`].filter(Boolean).join('\n');
  $('ex-cat-note').textContent = hasCat
    ? 'Add both to the page. The cemetery’s category is how the map finds the page’s data, and Plotting Pages is how the app learns that the cemetery has a map.'
    : 'Add the cemetery’s own WikiTree category to the page as well as this one: it is how the map finds the page’s data.';
  const page = tablePageForOpen();
  const open = $('ex-open');
  open.hidden = !page;
  if (page) open.href = `https://www.wikitree.com/index.php?title=${encodeURIComponent(page)}&action=edit`;
  $('dlg-export').showModal();
});
$('ex-json').addEventListener('click', () => {
  const a = h('a', { href: URL.createObjectURL(new Blob([toJson(cem)], { type: 'application/json' })), download: `${cem.id}.json` });
  document.body.append(a); a.click(); a.remove();
});
for (const id of ['ex-url', 'ex-markup', 'ex-cat', 'ex-index', 'ex-table']) $(id).addEventListener('focus', (e) => e.target.select());

// ---- overlay -----------------------------------------------------------------------
const dlgOv = $('dlg-overlay');
let pendingImage = null;
const num = (id) => parseFloat($(id).value);
function readBounds() {
  const b = [[num('ov-s'), num('ov-w')], [num('ov-n'), num('ov-e')]];
  return b.flat().every(Number.isFinite) && b[0][0] < b[1][0] && b[0][1] < b[1][1] ? b : null;
}
$('btn-overlay').addEventListener('click', () => {
  if (!cem) { status('Load or import a cemetery first.'); return; }
  const img = cem.overlay?.image;
  if (img?.bounds) { [[$('ov-s').value, $('ov-w').value], [$('ov-n').value, $('ov-e').value]] = img.bounds; }
  $('ov-opacity').value = img?.opacity ?? 0.7;
  $('ov-url').value = img?.url && !img.url.startsWith('data:') ? img.url : '';
  dlgOv.showModal();
});
$('ov-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) { status('Image is over 4 MB; use a smaller file or host it and paste its URL.', 6000); e.target.value = ''; return; }
  const r = new FileReader();
  r.onload = () => { pendingImage = r.result; $('ov-url').value = ''; };
  r.readAsDataURL(f);
});
$('ov-fit').addEventListener('click', () => {
  const b = mapApi.bounds();
  const inset = 0.15;
  const dLat = (b.getNorth() - b.getSouth()) * inset, dLon = (b.getEast() - b.getWest()) * inset;
  $('ov-s').value = (b.getSouth() + dLat).toFixed(6); $('ov-n').value = (b.getNorth() - dLat).toFixed(6);
  $('ov-w').value = (b.getWest() + dLon).toFixed(6); $('ov-e').value = (b.getEast() - dLon).toFixed(6);
});
function currentImage() {
  const url = pendingImage || $('ov-url').value.trim() || cem.overlay?.image?.url;
  const bounds = readBounds();
  if (!url || !bounds) return null;
  if (!url.startsWith('data:image/') && !isHttpUrl(url)) return null;
  return { url, bounds, opacity: Number($('ov-opacity').value) };
}
function applyOverlay() {
  const image = currentImage();
  cem.overlay = { ...(cem.overlay || {}), ...(image ? { image } : {}) };
  mapApi.setOverlay(cem.overlay);
  return image;
}
$('ov-opacity').addEventListener('input', () => { if (cem?.overlay?.image) { cem.overlay.image.opacity = Number($('ov-opacity').value); mapApi.setOverlay(cem.overlay); } });
$('ov-apply').addEventListener('click', () => {
  if (!applyOverlay() && !cem.overlay?.geojson) status('Choose an image and give all four corners (south < north, west < east).', 6000);
  else dlgOv.close();
});
$('ov-geo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const gj = JSON.parse(await f.text());
    if (!gj.type) throw new Error('not GeoJSON');
    cem.overlay = { ...(cem.overlay || {}), geojson: gj };
    mapApi.setOverlay(cem.overlay);
    status('Sections & landmarks added.');
  } catch { status('That file is not valid GeoJSON.', 5000); }
});
$('ov-clear').addEventListener('click', () => { delete cem.overlay; pendingImage = null; mapApi.setOverlay(null); dlgOv.close(); });

// ---- the default view: ready-made maps as dots -------------------------------------------
/** Every cemetery with a ready-made map, as a dot with its number of rows. Click one to open it. */
async function showOverview() {
  const found = await plotting.list().catch(() => []);
  const entries = overviewEntries(index, found);
  if (cem || !entries.length) return;
  const counts = readCounts();
  const items = [];
  await Promise.all(entries.map(async (e) => {
    let at = null;
    const rec = await directory.lookup(e.category).catch(() => null);
    if (rec?.[2] != null) at = [rec[2], rec[3]];
    else if (onWikiTreeHost()) at = (await readCategoryPage(categoryTitle(e.category)).catch(() => ({}))).center || null;
    if (!at) return;
    items.push({
      ...e, lat: at[0], lon: at[1], count: counts[e.category] ?? null, profiles: rec?.[1] || 0,
      onOpen: () => (e.id ? openById(e.id) : openRecord(rec || [e.category, 0, null, null])).catch((err) => status(err.message, 6000)),
    });
  }));
  if (cem || !items.length) return;
  const draw = (fit) => { if (!cem) mapApi.setOverview(items.map((i) => ({ ...i })), { fit }); };
  draw(true);
  // Reading the plot-map pages is slow, so counts arrive one cemetery at a time and are remembered for a day.
  if (!onWikiTreeHost()) return;
  for (const it of items) {
    if (cem) return;
    if (it.count != null) continue;
    const rows = await countRows(it);
    if (rows == null) continue;
    it.count = rows;
    saveCount(it.category, rows);
    draw(false);
  }
}

// ---- boot ----------------------------------------------------------------------------
(async function boot() {
  await loadIndex();
  try {
    const hash = new URLSearchParams(location.hash.slice(1)).get('d');
    const id = params.get('cemetery');
    const cat = params.get('category');
    if (hash) setCemetery(await decodeShare(hash));
    else if (id) await openById(id);
    else if (cat) {
      const plain = plainCategory(cat);
      const rec = await directory.lookup(plain);
      // Without the directory files we can still open it from the name alone; the WikiTree+ report supplies the rest.
      await openRecord(rec || [plain, 0, null, null]);
    } else {
      status('Use “Find a cemetery…” to pick one, or Import data to plot your own list.', 8000);
      showOverview();
    }
  } catch (err) {
    status(`Could not load the cemetery: ${err.message}`, 8000);
  }
})();

// Pasting a share link into the address bar of an already-open copy only changes the hash.
window.addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).has('d')) location.reload(); });
