import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGraves, splitDelimited } from '../js/parse.js';
import { groupPlots, auditGraves, centerOf } from '../js/model.js';
import { wikiTreeUrl, findAGraveUrl, familySearchUrl, extractFamilySearchId, extractFindAGraveId, extractWikiTreeId } from '../js/links.js';

const sample = readFileSync(new URL('../samples/fairview-raton.tsv', import.meta.url), 'utf8');

test('sample parses: 35 rows, none dropped, lon/lat in right order', () => {
  const { graves, issues } = parseGraves(sample);
  assert.equal(graves.length, 35);
  assert.equal(issues.filter((i) => i.level === 'error').length, 0);
  const t = graves.find((g) => g.wt === 'Tapia-408');
  assert.equal(t.fag, '30366702');
  assert.equal(t.fs, 'GJ31-WG9');
  assert.equal(t.lon, -104.423425);
  assert.equal(t.lat, 36.903978);
  assert.ok(graves.every((g) => g.lat != null));
});

test('plots: identical coordinates merge, nearby distinct stones do not', () => {
  const { graves } = parseGraves(sample);
  const plots = groupPlots(graves);
  const of = (id) => plots.find((p) => p.members.some((g) => g.wt === id));
  assert.deepEqual(of('Leal-658').members.map((g) => g.wt).sort(), ['Aragon-579', 'Leal-658', 'Lopez-6743']);
  assert.deepEqual(of('Martinez-7221').members.map((g) => g.wt).sort(),
    ['Martinez-7221', 'Martinez-7224', 'Martinez-7227', 'Rodriguez-7914']);
  assert.deepEqual(of('Martinez-7223').members.map((g) => g.wt).sort(), ['Garcia-9527', 'Martinez-7223']);
  assert.notEqual(of('Tapia-408'), of('Tapia-409'));
  assert.equal(plots.reduce((n, p) => n + p.members.length, 0), 35);
});

test('audit: shared photo at far-apart coordinates is reported, no outliers', () => {
  const { graves } = parseGraves(sample);
  const issues = auditGraves(graves);
  assert.ok(issues.some((i) => /Martinez-7223.*Gonzales-2521|Gonzales-2521.*Martinez-7223/.test(i.msg)));
  assert.ok(!issues.some((i) => /km from/.test(i.msg)));
  const c = centerOf(graves);
  assert.ok(Math.abs(c.lat - 36.904) < 0.002 && Math.abs(c.lon + 104.4236) < 0.002);
});

test('swapped lat/lon is corrected; bad rows reported not dropped silently', () => {
  const { graves, issues } = parseGraves('WikiTree ID\tLong\tLat\nA-1\t36.9\t-104.4\nB-2\tx\ty\nBad ID\t-104\t36');
  assert.equal(graves[0].lat, 36.9);
  assert.equal(graves[0].lon, -104.4);
  assert.ok(issues.some((i) => /swapped/.test(i.msg)));
  assert.ok(issues.some((i) => i.wt === 'B-2' && /No usable coordinates/.test(i.msg)));
  assert.ok(issues.some((i) => /does not look like a WikiTree ID/.test(i.msg)));
});

test('missing required columns is an error', () => {
  const { graves, issues } = parseGraves('Foo\tBar\n1\t2');
  assert.equal(graves.length, 0);
  assert.ok(issues.some((i) => i.level === 'error'));
});

test('csv with quotes and aliases', () => {
  assert.deepEqual(splitDelimited('a,b\n"x, y",2'), [['a', 'b'], ['x, y', '2']]);
  const { graves } = parseGraves('Profile,Longitude,Latitude,Find a Grave\nSmith-1,-100.5,35.2,https://www.findagrave.com/memorial/123/john');
  assert.equal(graves[0].fag, '123');
});

test('link builders', () => {
  assert.equal(wikiTreeUrl('Tapia-408'), 'https://www.wikitree.com/wiki/Tapia-408');
  assert.equal(findAGraveUrl('30366702'), 'https://www.findagrave.com/memorial/30366702');
  assert.equal(familySearchUrl('GJ31-WG9'), 'https://www.familysearch.org/tree/person/details/GJ31-WG9');
  assert.equal(extractFamilySearchId('https://www.familysearch.org/tree/person/details/gj31-wg9'), 'GJ31-WG9');
  assert.equal(extractFindAGraveId('24170737'), '24170737');
  assert.equal(extractWikiTreeId('https://www.wikitree.com/wiki/Tapia-408'), 'Tapia-408');
});

import { encodeShare, decodeShare, slugify, validateDocument, spaceSnippet, appUrl, toJson } from '../js/export.js';

test('share link round-trips and is compact', async () => {
  const doc = JSON.parse(readFileSync(new URL('../cemeteries/fairview-raton-nm.json', import.meta.url), 'utf8'));
  const s = await encodeShare(doc);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.ok(s.length < 12000, `share string is ${s.length} chars`);
  assert.deepEqual(await decodeShare(s), doc);
});

test('slug, validation, snippet', () => {
  assert.equal(slugify('Fairview Presbyterian Cemetery, Raton'), 'fairview-presbyterian-cemetery-raton');
  assert.throws(() => validateDocument({}));
  const d = validateDocument({ graves: [{ wt: 'A-1', lat: '1.5', lon: 'x' }, { nope: 1 }] });
  assert.equal(d.graves.length, 1);
  assert.equal(d.graves[0].lon, undefined);
  assert.equal(spaceSnippet('https://x.org/?cemetery=a', 'A'), '[https://x.org/?cemetery=a Cemetery Plot Map of A]');
  assert.equal(appUrl('https://x.org/app/index.html?old=1#h', { cemetery: 'a' }), 'https://x.org/app/index.html?cemetery=a');
});

import { parseSpaceTable, fetchSpaceTable, isSpacePage } from '../js/spacetable.js';
import { loadCemetery } from '../js/source.js';
import { spaceTableMarkup, indexEntry } from '../js/export.js';

// Build HTML shaped like the rendered Space page table (see samples/): link cells carry the IDs/URLs.
function spaceHtml(graves, { header = ['WikiTree', 'FindAGrave', 'FamilySearch', 'Long', 'Lat', 'Image link'] } = {}) {
  const row = (g) => `<tr>
<td><a href="/wiki/${g.wt}" title="">${g.wt}</a></td>
<td>Find A Grave: <a href="https://www.findagrave.com/memorial/${g.fag}" class="external text" rel="nofollow">Memorial #${g.fag}</a></td>
<td>FamilySearch Person: <a href="https://www.familysearch.org/tree/person/${g.fs}" class="external text" rel="nofollow">${g.fs}</a></td>
<td>${g.lon}</td>
<td>${g.lat}</td>
<td><a href="${g.photo}" class="external text" rel="nofollow">Headstone</a>
</td></tr>`;
  return `<html><body><table class="other"><tr><td>nav</td></tr></table>
<table class="sortable" id="sortable_table_id_0"><tbody><tr>${header.map((h) => `<th>${h}&nbsp;</th>`).join('')}</tr>
${graves.map(row).join('\n')}</tbody></table></body></html>`;
}
const sampleGraves = () => parseGraves(sample).graves.map(({ _plot, ...g }) => g);
const PAGE = 'Space:Fairview_Presbyterian_Cemetery_Raton_NM_USA_Plot_Map_Table';

test('Space table parses to the same graves as the TSV import', () => {
  const r = parseSpaceTable(spaceHtml(sampleGraves()));
  assert.equal(r.found, true);
  assert.deepEqual(r.graves, sampleGraves());
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0);
});

test('Space table: picks the right table, reports a missing one', () => {
  assert.equal(parseSpaceTable('<p>nothing</p>').found, false);
  assert.equal(parseSpaceTable('<table><tr><th>Name</th></tr></table>').found, false);
  assert.ok(isSpacePage(PAGE));
  assert.ok(!isSpacePage('Space:../../evil') && !isSpacePage('Category:Foo') && !isSpacePage('https://x.org'));
});

test('fetchSpaceTable: 202 challenge page counts as blocked', async () => {
  await assert.rejects(fetchSpaceTable(PAGE, { fetchImpl: async () => ({ status: 202, text: async () => '' }) }), /blocked/);
  await assert.rejects(fetchSpaceTable(PAGE, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), /blocked/);
  await assert.rejects(fetchSpaceTable(PAGE, { fetchImpl: async () => ({ status: 200, text: async () => '<p>x</p>' }) }), /no-table/);
  const ok = await fetchSpaceTable(PAGE, { fetchImpl: async (u, o) => {
    assert.equal(u, `https://www.wikitree.com/wiki/${PAGE}`);
    assert.equal(o.credentials, 'include');
    return { status: 200, text: async () => spaceHtml(sampleGraves()) };
  } });
  assert.equal(ok.graves.length, 35);
});

test('loadCemetery: live on wikitree.com, keeps snapshot extras, notes dropped rows', async () => {
  const snapshot = { schema: 1, id: 'x', name: 'Fairview', overlay: { geojson: { type: 'FeatureCollection', features: [] } },
    graves: sampleGraves().map((g) => ({ ...g, name: `N ${g.wt}` })) };
  const liveRows = sampleGraves().slice(0, 34); // Space page missing the last row
  const fetchImpl = async (u) => (u.startsWith('cemeteries/')
    ? { ok: true, json: async () => snapshot }
    : { status: 200, text: async () => spaceHtml(liveRows) });
  const entry = { id: 'x', name: 'Fairview', source: { type: 'wikitree-space', page: PAGE } };
  const r = await loadCemetery(entry, { fetchImpl, live: true });
  assert.equal(r.origin, 'live');
  assert.equal(r.doc.graves.length, 34);
  assert.equal(r.doc.graves[0].name, 'N Apodaca-290');
  assert.ok(r.doc.overlay);
  assert.ok(r.doc._issues.some((i) => /Wheeler-5591/.test(i.msg)));
});

test('loadCemetery: off wikitree.com or blocked falls back to the snapshot; no snapshot is an error', async () => {
  const snapshot = { schema: 1, id: 'x', name: 'F', graves: [{ wt: 'A-1' }] };
  const entry = { id: 'x', source: { type: 'wikitree-space', page: PAGE } };
  const withSnap = async (u) => (u.startsWith('cemeteries/') ? { ok: true, json: async () => snapshot } : { status: 202, text: async () => '' });
  const off = await loadCemetery(entry, { fetchImpl: withSnap, live: false });
  assert.equal(off.origin, 'snapshot');
  assert.match(off.note, /not running on wikitree\.com/);
  const blocked = await loadCemetery(entry, { fetchImpl: withSnap, live: true });
  assert.equal(blocked.origin, 'snapshot');
  assert.match(blocked.note, /did not return/);
  const noSnap = async (u) => (u.startsWith('cemeteries/') ? { ok: false } : { status: 202, text: async () => '' });
  await assert.rejects(loadCemetery(entry, { fetchImpl: noSnap, live: false }), /no saved snapshot/);
});

test('table markup and index entry', () => {
  const md = spaceTableMarkup(sampleGraves());
  const lines = md.split('\n');
  assert.equal(lines[0], '{| border="1" class="sortable"');
  assert.equal(lines.at(-1), '|}');
  assert.equal(lines.filter((l) => l === '|-').length, 35);
  assert.ok(md.includes('| [[Apodaca-290]] || {{FindAGrave|24170737}} || {{FamilySearch|G9SJ-N7S}} || -104.422896 || 36.903378 || [https://www.wikitree.com/photo.php/4/4c/Apodaca-290.jpg Headstone]'));
  assert.deepEqual(JSON.parse(indexEntry({ id: 'a', name: 'A', source: { type: 'wikitree-space', page: PAGE } })).source.page, PAGE);
  // a validated doc drops a source that isn't a Space page
  assert.equal(validateDocument({ graves: [], source: { type: 'wikitree-space', page: 'https://evil' } }).source, undefined);
});

import { md5 } from '../js/md5.js';
import { createHash } from 'node:crypto';
import { photoUrlForName, normalizePhotoRef, photoUrlFromApi, thumbUrl } from '../js/images.js';
import { readGps, parseLatLon } from '../js/exif.js';
import { parseCemeteryReport, reportUrl, fetchRoster, isCategoryTitle, mergeRoster } from '../js/plus.js';
import { loadEdits, saveEdits, withEdit, withoutEdit, applyEdits, pruneEdits } from '../js/edits.js';

test('md5 matches node crypto, incl. multi-block and non-ASCII input', () => {
  for (const s of ['', 'a', 'Tapia-408.jpg', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'y'.repeat(1000), 'Peña-1.jpg']) {
    assert.equal(md5(s), createHash('md5').update(s).digest('hex'), JSON.stringify(s.slice(0, 20)));
  }
});

test('image refs normalise to the stored photo.php URL', () => {
  const want = 'https://www.wikitree.com/photo.php/c/cf/Tapia-408.jpg';
  assert.equal(photoUrlForName('Tapia-408.jpg'), want);
  assert.equal(photoUrlForName('Image:Tapia 408.jpg'), photoUrlForName('Tapia_408.jpg'));
  assert.equal(normalizePhotoRef(want), want);
  assert.equal(normalizePhotoRef('/photo.php/thumb/c/cf/Tapia-408.jpg/300px-Tapia-408.jpg'), want);
  assert.equal(normalizePhotoRef('https://www.wikitree.com/photo/jpg/Tapia-408'), want);
  assert.equal(normalizePhotoRef('https://www.wikitree.com/wiki/Image:Tapia-408.jpg'), want);
  assert.equal(normalizePhotoRef('Tapia-408.jpg'), want);
  assert.equal(normalizePhotoRef('https://example.com/pic.jpg'), '');
  assert.equal(normalizePhotoRef('hello'), '');
  const api = { ImageName: 'Tapia-408.jpg', URL_300: '/photo.php/thumb/c/cf/Tapia-408.jpg/300px-Tapia-408.jpg' };
  assert.equal(photoUrlFromApi(api), want);
  assert.equal(thumbUrl(want, 300), 'https://www.wikitree.com/photo.php/thumb/c/cf/Tapia-408.jpg/300px-Tapia-408.jpg');
});

// Build a minimal JPEG with an EXIF GPS block.
function jpegWithGps({ lat, lon, le = false } = {}) {
  const buf = new ArrayBuffer(400); const v = new DataView(buf);
  const u16 = (p, x) => v.setUint16(p, x, le), u32 = (p, x) => v.setUint32(p, x, le);
  v.setUint16(0, 0xffd8); v.setUint16(2, 0xffe1); v.setUint32(6, 0x45786966); // Exif
  const t = 12; // TIFF header start
  v.setUint16(t, le ? 0x4949 : 0x4d4d); u16(t + 2, 42); u32(t + 4, 8);
  u16(t + 8, 1); u16(t + 10, 0x8825); u16(t + 12, 4); u32(t + 14, 1); u32(t + 18, 26); // IFD0 -> GPS IFD at +26
  u32(t + 22, 0);
  const g = t + 26; u16(g, 4);
  const ent = (i, tag, type, count) => { u16(g + 2 + i * 12, tag); u16(g + 4 + i * 12, type); u32(g + 6 + i * 12, count); };
  ent(0, 1, 2, 2); v.setUint8(g + 10 + 0, lat.ref.charCodeAt(0));
  ent(1, 2, 5, 3); u32(g + 10 + 12, 100);
  ent(2, 3, 2, 2); v.setUint8(g + 10 + 24, lon.ref.charCodeAt(0));
  ent(3, 4, 5, 3); u32(g + 10 + 36, 130);
  const rat = (p, [d, m, s]) => { u32(t + p, d); u32(t + p + 4, 1); u32(t + p + 8, m); u32(t + p + 12, 1); u32(t + p + 16, Math.round(s * 100)); u32(t + p + 20, 100); };
  rat(100, lat.dms); rat(130, lon.dms);
  v.setUint16(4, 300); // APP1 length
  v.setUint16(320, 0xffda);
  return buf;
}
test('EXIF GPS: reads N/W coordinates in both byte orders; absent/garbled data is null', () => {
  for (const le of [false, true]) {
    const r = readGps(jpegWithGps({ le, lat: { ref: 'N', dms: [36, 54, 14.62] }, lon: { ref: 'W', dms: [104, 25, 25.12] } }));
    assert.ok(Math.abs(r.lat - 36.904061) < 1e-5, JSON.stringify(r));
    assert.ok(Math.abs(r.lon + 104.423644) < 1e-5, JSON.stringify(r));
  }
  const s = readGps(jpegWithGps({ lat: { ref: 'S', dms: [10, 0, 0] }, lon: { ref: 'E', dms: [20, 30, 0] } }));
  assert.deepEqual(s, { lat: -10, lon: 20.5 });
  assert.equal(readGps(new ArrayBuffer(4)), null);
  assert.equal(readGps(new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0]).buffer), null);
  const bad = new Uint8Array(jpegWithGps({ lat: { ref: 'N', dms: [1, 0, 0] }, lon: { ref: 'E', dms: [1, 0, 0] } }));
  assert.doesNotThrow(() => readGps(bad.slice(0, 60).buffer)); // truncated file
});

test('lat/lon text parsing', () => {
  assert.deepEqual(parseLatLon('36.904061, -104.423645'), { lat: 36.904061, lon: -104.423645 });
  assert.deepEqual(parseLatLon(' 36.9 -104.4 '), { lat: 36.9, lon: -104.4 });
  assert.equal(parseLatLon('91, 10'), null);
  assert.equal(parseLatLon('abc'), null);
  assert.equal(parseLatLon('0,0'), null);
});

const REPORT_HTML = `<th>41 Profiles</th>
<tr><td colspan="10"><div style="display: grid;">
<div><a href="https://www.wikitree.com/wiki/Apodaca-290" target="_blank">Apodaca-290</a>
 (<a href="https://www.findagrave.com/memorial/24170737" target="_blank">24170737</a>)</div>
<div><a href="https://www.wikitree.com/wiki/Dawson-12756" target="_blank">Dawson-12756</a>
 (<a href="https://www.findagrave.com/memorial/107645767" target="_blank">107645767</a>)</div>
<div><a href="https://www.wikitree.com/wiki/Nolink-1" target="_blank">Nolink-1</a></div>
<div><a href="https://www.wikitree.com/wiki/Apodaca-290" target="_blank">Apodaca-290</a> (<a href="https://www.findagrave.com/memorial/24170737">24170737</a>)</div>
</div></td></tr><a href="https://www.findagrave.com/cemetery/2236958" target="_blank"><b>Fairview</b></a>`;
test('WikiTree+ report parsing and URL', async () => {
  const r = parseCemeteryReport(REPORT_HTML);
  assert.deepEqual(r.profiles, [{ wt: 'Apodaca-290', fag: '24170737' }, { wt: 'Dawson-12756', fag: '107645767' }, { wt: 'Nolink-1' }]);
  assert.equal(r.findAGraveCemetery, '2236958');
  assert.equal(r.declared, 41);
  assert.equal(reportUrl('Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico'),
    'https://plus.wikitree.com/function/WTCemetery/Cemetery.htm?cemetery=Fairview_Presbyterian_Cemetery%2C_Raton%2C_New_Mexico');
  assert.equal(reportUrl('Category:Some Cemetery, X'), 'https://plus.wikitree.com/function/WTCemetery/Cemetery.htm?cemetery=Some_Cemetery%2C_X');
  assert.ok(isCategoryTitle('Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico') && !isCategoryTitle('Space:X') && !isCategoryTitle(''));
  const ok = await fetchRoster('Category:X_Cemetery', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => REPORT_HTML }) });
  assert.equal(ok.profiles.length, 3);
  await assert.rejects(fetchRoster('Category:X_Cemetery', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<p>none</p>' }) }), /no profiles/);
  await assert.rejects(fetchRoster('Category:X_Cemetery', { fetchImpl: async () => ({ ok: false, status: 500 }) }), /500/);
});

test('pending edits: apply, prune once published, remove', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  let e = withEdit({}, 'A-1', { lat: 1.5, lon: 2.5, photo: 'https://www.wikitree.com/photo.php/a/ab/A-1.jpg' }, 10);
  e = withEdit(e, 'B-2', { remove: true }, 11);
  e = withEdit(e, 'C-3', { lat: 3, lon: 4 }, 12);
  saveEdits('x', e, storage);
  assert.deepEqual(loadEdits('x', storage), e);
  const graves = [{ wt: 'A-1', lat: 9, lon: 9, photo: 'old' }, { wt: 'B-2', lat: 5, lon: 5 }];
  assert.deepEqual(applyEdits(graves, e).sort(), ['A-1', 'B-2', 'C-3']);
  assert.deepEqual(graves[0], { wt: 'A-1', lat: 1.5, lon: 2.5, photo: 'https://www.wikitree.com/photo.php/a/ab/A-1.jpg', _edited: true });
  assert.equal(graves[1].lat, undefined);
  assert.deepEqual(graves[2], { wt: 'C-3', lat: 3, lon: 4, _edited: true });
  // after the table is republished, the base data matches and the edits fall away
  const base = [{ wt: 'A-1', lat: 1.5, lon: 2.5, photo: 'https://www.wikitree.com/photo.php/a/ab/A-1.jpg' }, { wt: 'B-2' }, { wt: 'C-3', lat: 3.0000001, lon: 4 }];
  assert.deepEqual(pruneEdits(e, base), {});
  assert.deepEqual(Object.keys(pruneEdits(e, [{ wt: 'A-1', lat: 1.5, lon: 2.5, photo: 'other' }, { wt: 'B-2', lat: 5, lon: 5 }])).sort(), ['A-1', 'B-2', 'C-3']);
  assert.deepEqual(withoutEdit(e, 'A-1') && Object.keys(withoutEdit(e, 'A-1')), ['B-2', 'C-3']);
  saveEdits('x', {}, storage);
  assert.deepEqual(loadEdits('x', storage), {});
  assert.deepEqual(loadEdits('x', { getItem() { throw new Error('blocked'); } }), {});
});

import { wordsOf, shardKey, keysForRecord, nameOf, placeOf, tablePageFor, plainCategory, categoryTitle, createDirectory } from '../js/directory.js';
import { buildDirectory } from '../tools/build-directory.mjs';

test('directory words, shard keys and table page names', () => {
  assert.deepEqual(wordsOf("Saint Mary's Cemetery, Pérez-Ville"), ['saint', 'mary', 's', 'cemetery', 'perez', 'ville']);
  assert.equal(shardKey('fairview'), 'fa');
  assert.equal(shardKey('a'), 'a');
  assert.equal(shardKey('élan'.normalize('NFKD').replace(/[̀-ͯ]/g, '')), 'el');
  assert.equal(shardKey('привет'), 'u43f_u440');
  assert.deepEqual(keysForRecord('Fairview Presbyterian Cemetery, Raton, New Mexico').sort(), ['fa', 'ra']);
  assert.deepEqual(keysForRecord('Raton Cemetery, Raton, New Mexico'), ['ra']);
  assert.equal(nameOf('Fairview Presbyterian Cemetery, Raton, New Mexico'), 'Fairview Presbyterian Cemetery');
  assert.equal(placeOf('Fairview Presbyterian Cemetery, Raton, New Mexico'), 'Raton, New Mexico');
  assert.equal(tablePageFor(['Fairview Presbyterian Cemetery, Raton, New Mexico', 41, 1, 2, 'Fairview_Presbyterian_Cemetery_Raton_NM_USA']),
    'Space:Fairview_Presbyterian_Cemetery_Raton_NM_USA_Plot_Map_Table');
  assert.equal(tablePageFor(["St. Mary's Cemetery, Dayton, Ohio", 3, null, null]), 'Space:St_Mary_s_Cemetery_Plot_Map_Table');
  assert.equal(plainCategory('Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico'), 'Fairview Presbyterian Cemetery, Raton, New Mexico');
  assert.equal(categoryTitle('Fairview Presbyterian Cemetery, Raton, New Mexico'), 'Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico');
});

const GROUPS = ['Category\tSort\tProfiles Nr.\tparent',
  'North America, Cemeteries\t0\t0\tmain', 'United States, Cemeteries\t0\t0\tNorth America', 'New Mexico, Cemeteries\t0\t0\tUnited States',
  'Colfax County, New Mexico, Cemeteries\t0\t0\tNew Mexico', 'Union County, New Mexico, Cemeteries\t0\t0\tNew Mexico',
  'Europe, Cemeteries\t0\t0\tmain', 'Former Cemeteries\t0\t0\t', 'Empty Region, Cemeteries\t0\t0\tEurope'].join('\n');
const CEMS = ['Category\tProfiles Nr.\tcoordinate\tspacepage\tparent',
  'Fairview Presbyterian Cemetery, Raton, New Mexico\t41\t36.9033279, -104.4226532\tFairview_Presbyterian_Cemetery_Raton_NM_USA\tColfax County, New Mexico',
  'Fairmont Cemetery, Raton, New Mexico\t3094\t\t\tColfax_County, New Mexico',
  'Clayton Cemetery, Clayton, New Mexico\t5\t36.45, -103.18\t\tUnion County, New Mexico',
  'Nobody Here, Nowhere\t0\t1,2\t\tColfax County, New Mexico',
  'Strays Rest, Somewhere\t2\tnot a coordinate\t\tUnknown Place'].join('\n');

test('directory build: hierarchy, counts, shards, empty places dropped', () => {
  const d = buildDirectory(CEMS, GROUPS);
  const n = d.tree.nodes;
  assert.equal(d.kept, 4); // the zero-profile cemetery is skipped
  assert.deepEqual(n[0], ['All places', -1, 0, 4]);
  const find = (name, parent) => n.findIndex((x, i) => i > 0 && x[0] === name && x[1] === parent);
  const na = find('North America', 0), us = find('United States', na), nm = find('New Mexico', us);
  const colfax = find('Colfax County', nm), union = find('Union County', nm);
  assert.ok(colfax > 0 && union > 0, 'children are named relative to their parent');
  assert.deepEqual([n[colfax][2], n[colfax][3]], [2, 2]);
  assert.equal(n[nm][3], 3);
  assert.equal(find('Europe', 0), -1, 'places with no cemeteries are dropped');
  const other = n.findIndex((x) => x[0] === 'Other categories');
  assert.ok(other > 0 && n[other][3] === 1, 'cemeteries whose place is unknown go under Other');
  // place file: most profiles first; underscore-formatted parent names still resolve
  assert.deepEqual(d.groupFiles.get(colfax).map((r) => r[0]), ['Fairmont Cemetery, Raton, New Mexico', 'Fairview Presbyterian Cemetery, Raton, New Mexico']);
  const fv = d.groupFiles.get(colfax)[1];
  assert.deepEqual(fv, ['Fairview Presbyterian Cemetery, Raton, New Mexico', 41, 36.90333, -104.42265, 'Fairview_Presbyterian_Cemetery_Raton_NM_USA']);
  assert.deepEqual(d.groupFiles.get(colfax)[0].slice(2, 4), [null, null]);
  assert.deepEqual([...d.shards.keys()].sort(), ['cl', 'fa', 'ra', 'so', 'st']);
});

test('directory search, lookup and browsing against built files', async () => {
  const d = buildDirectory(CEMS, GROUPS);
  const files = new Map([['directory/tree.json', { nodes: d.tree.nodes }]]);
  for (const [k, v] of d.shards) files.set(`directory/${k}.json`, v);
  for (const [k, v] of d.groupFiles) files.set(`directory/g/${k}.json`, v);
  const fetchImpl = async (u) => (files.has(u) ? { ok: true, json: async () => files.get(u) } : { ok: false, status: 404 });
  const dir = createDirectory({ fetchImpl });
  assert.deepEqual((await dir.search('fairview')).map((r) => r[0]), ['Fairview Presbyterian Cemetery, Raton, New Mexico']);
  assert.deepEqual((await dir.search('raton')).map((r) => r[0]), ['Fairmont Cemetery, Raton, New Mexico', 'Fairview Presbyterian Cemetery, Raton, New Mexico']);
  assert.deepEqual((await dir.search('fair rat')).map((r) => r[1]), [3094, 41]);
  assert.deepEqual((await dir.search('fairview presby raton')).length, 1);
  assert.deepEqual(await dir.search('x'), []);
  assert.deepEqual(await dir.search('zzzz'), []);
  assert.equal((await dir.lookup('Fairview Presbyterian Cemetery, Raton, New Mexico'))[1], 41);
  assert.equal(await dir.lookup('No Such Cemetery, Nowhere'), null);
  const t = await dir.tree();
  const path = await dir.pathTo(t.kids.flat().find((i) => t.nodes[i][0] === 'Colfax County'));
  assert.deepEqual(path.map((i) => t.nodes[i][0]), ['All places', 'North America', 'United States', 'New Mexico', 'Colfax County']);
  assert.equal(t.kids[0].length, 2); // North America, Other categories
  assert.equal((await dir.cemeteriesAt(path.at(-1))).records.length, 2);
  // a missing directory/ is reported, not hidden
  await assert.rejects(createDirectory({ fetchImpl: async () => ({ ok: false, status: 404 }) }).tree());
});

test('on wikitree.com the picker browses live (always current) and the snapshot only serves search', async () => {
  const d = buildDirectory(CEMS, GROUPS);
  const files = new Map([['directory/tree.json', { nodes: d.tree.nodes }]]);
  for (const [k, v] of d.shards) files.set(`directory/${k}.json`, v);
  const mk = (groupsOk) => async (u) => {
    if (u === GROUPS_URL) return groupsOk ? { ok: true, text: async () => GROUPS } : { ok: false, status: 500 };
    return files.has(u) ? { ok: true, json: async () => files.get(u) } : { ok: false, status: 404 };
  };
  const dir = createDirectory({ fetchImpl: mk(true), preferLive: true });
  assert.equal((await dir.tree()).mode, 'live');
  assert.equal((await dir.search('fairview')).length, 1);
  assert.equal((await dir.lookup('Fairview Presbyterian Cemetery, Raton, New Mexico'))[1], 41);
  // if WikiTree+ can't be read, the snapshot still browses
  assert.equal((await createDirectory({ fetchImpl: mk(false), preferLive: true }).tree()).mode, 'static');
});

test('the directory is read from the first place that has it, else the next', async () => {
  const d = buildDirectory(CEMS, GROUPS);
  const files = new Map([['https://pages.example/directory/tree.json', { nodes: d.tree.nodes }], ['local/tree.json', { nodes: [['All places', -1, 0, 0]] }]]);
  for (const [k, v] of d.shards) files.set(`https://pages.example/directory/${k}.json`, v);
  const seen = [];
  const fetchImpl = async (u) => { seen.push(u); return files.has(u) ? { ok: true, json: async () => files.get(u) } : { ok: false, status: 404 }; };
  const online = createDirectory({ fetchImpl, bases: ['https://pages.example/directory', 'local'] });
  assert.equal((await online.search('fairview')).length, 1);
  assert.ok(!seen.includes('local/tree.json'));
  const fallback = createDirectory({ fetchImpl, bases: ['https://down.example/directory', 'local'] });
  assert.equal((await fallback.tree()).nodes.length, 1);
});

test('loadCemetery allowEmpty: a cemetery nobody has mapped starts empty with its centre', async () => {
  const entry = { id: 'x', name: 'X', wikitree: { category: 'Category:X' }, source: { type: 'wikitree-space', page: 'Space:X_Plot_Map_Table' }, center: [1, 2] };
  const noSnap = async (u) => (u.startsWith('cemeteries/') ? { ok: false } : { status: 200, text: async () => '<p>Page does not exist</p>' });
  const r = await loadCemetery(entry, { fetchImpl: noSnap, live: true, allowEmpty: true });
  assert.equal(r.origin, 'empty');
  assert.deepEqual(r.doc.graves, []);
  assert.deepEqual(r.doc.center, [1, 2]);
  assert.equal(r.doc.source.page, 'Space:X_Plot_Map_Table');
  await assert.rejects(loadCemetery(entry, { fetchImpl: noSnap, live: true }), /no saved snapshot/);
});

import { APP_URL } from '../js/config.js';
test('permanent links point at the published app', () => {
  assert.equal(APP_URL, 'https://apps.wikitree.com/apps/robinson27225/cemetery-map/index.html');
  assert.equal(appUrl(APP_URL, { cemetery: 'fairview-raton-nm' }), `${APP_URL}?cemetery=fairview-raton-nm`);
  assert.equal(appUrl(APP_URL, { category: 'Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico' }), `${APP_URL}?category=Fairview_Presbyterian_Cemetery%2C_Raton%2C_New_Mexico`);
});

import { tablesOf, parseCategoryPages, fetchSpaceTables, categoryUrl } from '../js/spacetable.js';

// Markup copied from a real album page (Space:Fairmont_Cemetery_Raton_NM_USA_Album_1): image cell is a nested table.
const albumRow = (id, lat, lon, plot, hash, file) => `<tr>
<td><a href="/wiki/${id}" title="${id}">${id}</a></td><td>${lat}</td><td>${lon}</td><td>VALDEZ</td><td>Jose A</td><td>1931</td><td>2011</td><td>${plot}</td><td>
<div class='table-wrapper'>
<table class="no-wrap" style="margin-left:auto;margin-right:auto;">
<tr>
<td style="text-align:center;"><span class="anon"><a href="/wiki/Image:${file}" class="image" title="${file}" rel="nofollow"><img alt="" src="/photo.php/thumb/${hash}/${file}/75px-${file}" width="75" height="39" class="scale-with-grid"/></a></span>
</td></tr>
<tr>
<td style="text-align:center;font-size:90%;">
</td></tr></table></div>
</td></tr>`;
const ALBUM = `<html><table><tr><td><a href="/wiki/Space:Album_2">Section 2</a></td></tr></table>
<table border="1" class="sortable">
<tr>
<th>WT-ID</th><th>Surname</th><th>Forename</th><th>Birth</th><th>Death</th><th>Plot</th></tr>
<tr><td><a href="/wiki/Malcolm-2409">Malcolm-2409</a></td><td>MALCOLM</td><td>Brian T</td><td>1953</td><td>2006</td><td>1-01-21b</td></tr></table>
<table border="1" class="sortable">
<tr>
<th>WT-ID</th><th>Latitude</th><th>Longitude</th><th>Surname</th><th>Forename</th><th>DOB</th><th>DOD</th><th>Plot</th><th>Image
</th></tr>
${albumRow('Valdez-1365', '36.904596', '-104.430908', '1', 'c/c9', 'Valdez-1365.jpg')}
${albumRow('Gomez-12', '36.904600', '-104.430900', '1-02', '6/6e', 'Gomez-12.jpg')}
<tr><td><a href="/wiki/Nobody-1">Nobody-1</a></td><td></td><td></td><td>X</td><td>Y</td><td></td><td></td><td></td><td></td></tr>
</table></html>`;

test('album-style table: nested image tables stay inside their cell, photo comes from the Image: link', () => {
  const tables = tablesOf(ALBUM);
  assert.equal(tables.filter((t) => t[0]?.length === 9).length, 1, 'the 9-column table is one table, not split by nested tables');
  const r = parseSpaceTable(ALBUM);
  assert.equal(r.found, true);
  assert.equal(r.tables, 1, 'the to-do table without coordinates is ignored');
  assert.equal(r.graves.length, 3);
  const v = r.graves[0];
  assert.deepEqual(v, { wt: 'Valdez-1365', given: 'Jose A', surname: 'Valdez', born: '1931', died: '2011', plot: '1', photo: 'https://www.wikitree.com/photo.php/c/c9/Valdez-1365.jpg', lat: 36.904596, lon: -104.430908 });
  assert.equal(r.graves[1].photo, 'https://www.wikitree.com/photo.php/6/6e/Gomez-12.jpg');
  assert.equal(r.graves[2].lat, undefined);
  assert.ok(r.issues.some((i) => i.wt === 'Nobody-1' && /No usable coordinates/.test(i.msg)));
});

test('category page lists its Space pages (titles with spaces become underscores)', () => {
  const html = `<h2>Pages (3)</h2></div><div class="row Pages"><a href="/wiki/Space:Fairmont Cemetery Raton NM USA" target="_blank">x</a>
<a href="/wiki/Space:Fairmont Cemetery Raton NM USA Album 1" target="_blank">y</a><a href="/wiki/Space:Fairmont Cemetery Raton NM USA Album 1" target="_blank">dup</a>
<h2>Person Profiles (3,094)</h2><a href="/wiki/Space:Not_In_Pages_Section">z</a>`;
  assert.deepEqual(parseCategoryPages(html), ['Space:Fairmont_Cemetery_Raton_NM_USA', 'Space:Fairmont_Cemetery_Raton_NM_USA_Album_1']);
  assert.deepEqual(parseCategoryPages('<p>no pages</p>'), []);
});

test('fetchSpaceTables: merges pages, first page wins duplicates, skips pages without tables', async () => {
  const std = spaceHtml([{ wt: 'Valdez-1365', fag: '1', fs: 'AAAA-BBB', lat: 1, lon: 2, photo: 'https://www.wikitree.com/photo.php/c/c9/Valdez-1365.jpg' },
    { wt: 'Other-1', fag: '2', fs: 'AAAA-BBC', lat: 3, lon: 4, photo: 'https://www.wikitree.com/photo.php/a/ab/Other-1.jpg' }]);
  const pages = { Space_A: ALBUM, Space_B: std, Space_C: '<p>text only</p>' };
  const fetchImpl = async (u) => {
    const k = u.split('/wiki/Space:')[1].replace('Fairmont_', '');
    return pages[k] !== undefined ? { status: 200, text: async () => pages[k] } : { status: 200, text: async () => '' };
  };
  const r = await fetchSpaceTables(['Space:Space_A', 'Space:Space_B', 'Space:Space_C', 'Space:Space_Missing', 'not a page'], { fetchImpl: (u) => fetchImpl(u.replace('Space:Space_', 'Space:Fairmont_Space_')) });
  assert.deepEqual(r.pages, [{ page: 'Space:Space_A', count: 3, markers: 0 }, { page: 'Space:Space_B', count: 1, markers: 0 }]);
  assert.deepEqual(r.skipped, ['Space:Space_C', 'Space:Space_Missing']);
  assert.equal(r.graves.length, 4);
  assert.equal(r.graves.find((g) => g.wt === 'Valdez-1365').src, 'Space:Space_A');
  const dup = r.issues.find((i) => i.kind === 'otherpage');
  assert.equal(dup.count, 1);
  assert.match(dup.msg, /Space B: 1 profile is also listed on an earlier page/);
  assert.equal(dup.links[0].href, 'https://www.wikitree.com/wiki/Space:Space_B');
  await assert.rejects(fetchSpaceTables(['Space:Only_Blocked'], { fetchImpl: async () => ({ status: 202, text: async () => '' }) }), /blocked/);
});

const REAL_REPORT = `<th>Fairmont Cemetery, Raton, New Mexico</b></a></th><th>5 Profiles</th></tr>
<tr><th>Linked FG Cemetery:</th><th><a href="https://plus.wikitree.com/default.htm?report=srch1&Query=fagcemetery%3Dfgcem38059">38059</a></th><th><a href="https://www.findagrave.com/cemetery/38059">Fairmont Cemetery</a></th>
<tr><th>FG Cemetery:</th><th colspan="8">No FindAGrave Memorial Defined</th><th>2 Profiles</th>
<tr><td colspan="10"><div style="display: grid;">
<a href="https://www.wikitree.com/wiki/31070216" target="_blank">Austellano-1</a>
<a href="https://www.wikitree.com/wiki/28655863" target="_blank">San Roman-26</a>
</div>
<tr><th>FG Cemetery:</th><th>38059</th><th>3 Profiles</th>
<tr><td colspan="10"><div style="display: grid;">
<div><a href="https://www.wikitree.com/wiki/Valdez-1365" target="_blank">Valdez-1365</a>
 (<a href="https://www.findagrave.com/memorial/111" target="_blank">111</a>)</div>
<div><a href="https://www.wikitree.com/wiki/Gomez-12" target="_blank">Gomez-12</a>
 (<a href="https://www.findagrave.com/memorial/222" target="_blank">222</a>)</div>
<div><a href="https://www.wikitree.com/wiki/Category:Fairmont_Cemetery%2C_Raton%2C_New_Mexico" target="_blank">Category link</a></div>
</div>
<H2>Fairmont Cemetery</H2><p><b>Partial Cemetery</b></p><table><tr><td>FGCemeteryID</td><th>2992 Memorials</th></tr>
<div><a href="https://www.wikitree.com/wiki/Elsewhere-5" target="_blank">Elsewhere-5</a> (<a href="https://www.findagrave.com/memorial/999">999</a>)</div>`;
test('WikiTree+ report: only the category half; profiles without a memorial; linked FG cemetery', () => {
  const r = parseCemeteryReport(REAL_REPORT);
  assert.deepEqual(r.profiles, [{ wt: 'Austellano-1' }, { wt: 'San Roman-26' }, { wt: 'Valdez-1365', fag: '111' }, { wt: 'Gomez-12', fag: '222' }]);
  assert.equal(r.declared, 5);
  assert.equal(r.findAGraveCemetery, '38059');
  const issues = mergeRoster([], r);
  assert.ok(issues.some((i) => /says 5 profiles but 4/.test(i.msg)));
});

test('loadCemetery live: also reads every Space page the category lists', async () => {
  const cat = 'Category:Fairmont_Cemetery,_Raton,_New_Mexico';
  const catPage = `<h2>Pages (3)</h2><a href="/wiki/Space:Fairmont Cemetery Raton NM USA Album 1">a</a><a href="/wiki/Space:Fairmont Cemetery Raton NM USA Unknown Headstones">u</a><h2>Person Profiles (9)</h2>`;
  const std = spaceHtml([{ wt: 'Std-1', fag: '5', fs: 'AAAA-BBB', lat: 9, lon: 8, photo: 'https://www.wikitree.com/photo.php/c/c9/Valdez-1365.jpg' }]);
  const pages = {
    [categoryUrl(cat)]: catPage,
    'https://www.wikitree.com/wiki/Space:Fairmont_Cemetery_Raton_NM_USA_Album_1': ALBUM,
    'https://www.wikitree.com/wiki/Space:Fairmont_Cemetery_Raton_NM_USA_Unknown_Headstones': '<p>no table here</p>',
    'https://www.wikitree.com/wiki/Space:Fairmont_Cemetery_Raton_NM_USA_Plot_Map_Table': std,
  };
  const seen = [];
  const fetchImpl = async (u) => {
    if (u.startsWith('cemeteries/')) return { ok: false };
    seen.push(u);
    return pages[u] !== undefined ? { status: 200, text: async () => pages[u] } : { status: 404, text: async () => '' };
  };
  const entry = { id: 'fm', name: 'Fairmont Cemetery', wikitree: { category: cat }, source: { type: 'wikitree-space', page: 'Space:Fairmont_Cemetery_Raton_NM_USA_Plot_Map_Table' } };
  const r = await loadCemetery(entry, { fetchImpl, live: true });
  assert.equal(r.origin, 'live');
  assert.equal(r.doc.graves.length, 4); // 3 from the album + 1 from the standard table
  assert.deepEqual(r.doc.source.pages, ['Space:Fairmont_Cemetery_Raton_NM_USA_Plot_Map_Table', 'Space:Fairmont_Cemetery_Raton_NM_USA_Album_1']);
  assert.equal(r.doc.source.page, 'Space:Fairmont_Cemetery_Raton_NM_USA_Plot_Map_Table');
  assert.equal(r.doc.graves.find((g) => g.wt === 'Valdez-1365').src, 'Space:Fairmont_Cemetery_Raton_NM_USA_Album_1');
  assert.match(r.note, /2 WikiTree Space pages/);
});

test('category URL keeps commas encoded', () => {
  assert.equal(categoryUrl('Category:Fairmont_Cemetery,_Raton,_New_Mexico'), 'https://www.wikitree.com/wiki/Category:Fairmont_Cemetery%2C_Raton%2C_New_Mexico');
});

import { isWikiTreeId } from '../js/links.js';
test('WikiTree IDs in any alphabet validate; non-IDs do not', () => {
  for (const id of ['Smith-1', "O'Brien-22", 'San Roman-26', 'Crnčevich-1', 'Райчевич-1', 'Κονταρπάκης-1', 'Peña-3']) assert.ok(isWikiTreeId(id), id);
  for (const id of ['Smith', 'Smith-', '-12', 'Space:Foo-1', 'Category:Bar-2', '', 'a b']) assert.ok(!isWikiTreeId(id), id);
});

import { parseCategoryCemeteries, createLiveDirectory } from '../js/live-directory.js';
import { parseCategoryInfo } from '../js/spacetable.js';
import { GROUPS_URL } from '../js/place-tree.js';

const COUNTY_PAGE = (inner) => `<div id="Subcategories"><h2 class="mt-3">Subcategories (${inner.count})</h2></div>
<div class="row Subcategories"><div class="col"><h3>A</h3>
${inner.items.join('\n')}
</div></div><h2 class="mt-3">Pages (0)</h2><a href="/wiki/Category:Not_A_Subcategory%2C_Nowhere">x (0, 9, 0)</a>`;
const itemPlain = (cat, tuple) => `<div class="P-ITEM"><a href="/wiki/Category:${cat.replace(/ /g, '_')}" itemprop="item" title="The ${cat} category">${cat} ${tuple}</a></div>`;
const itemSpans = (cat, tuple) => `<div class="P-ITEM"><a href="/wiki/Category:${cat.replace(/ /g, '_')}" itemprop="item"><span itemprop="name">${cat}</span>
 <small>${tuple}</small></a></div>`;

test('category page: cemeteries are listed with profile counts; places and empty categories are skipped', () => {
  const html = COUNTY_PAGE({ count: 4, items: [
    itemPlain('Abbott Cemetery, Colfax County, New Mexico', '(0, 8, 0)'),
    itemSpans('Fairmont Cemetery, Raton, New Mexico', '(0, 3094, 11)'),
    itemPlain('Empty Cemetery, Nowhere, New Mexico', '(0, 0, 0)'),
    itemPlain('Some County, New Mexico, Cemeteries', '(19, 0, 0)'),
  ] });
  const r = parseCategoryCemeteries(html);
  assert.deepEqual(r.records, [['Fairmont Cemetery, Raton, New Mexico', 3094, null, null], ['Abbott Cemetery, Colfax County, New Mexico', 8, null, null]]);
  assert.equal(r.declared, 4);
  assert.equal(r.listed, 4);
  assert.deepEqual(parseCategoryCemeteries('<p>nothing</p>'), { records: [], declared: 0, listed: 0 });
});

test('category info: map position, Find a Grave cemetery and Space page come from the info box, not the Pages list', () => {
  const html = `<table><tr><td>WikiTree page:</td><td><a href="/wiki/Space:Fairmont_Cemetery_Raton_NM_USA">Space: Fairmont</a></td></tr>
<tr><td><a href="https://www.findagrave.com/cemetery/38059">38059</a></td></tr>
<tr><td><a href="https://www.openstreetmap.org/#map=17/36.9033279/-104.4226532">OpenStreetMap</a></td></tr></table>
<h2>Pages (1)</h2><a href="/wiki/Space:Fairmont Cemetery Raton NM USA Album 1">x</a><a href="https://www.findagrave.com/cemetery/999">other</a>`;
  assert.deepEqual(parseCategoryInfo(html), {
    pages: ['Space:Fairmont_Cemetery_Raton_NM_USA_Album_1'], space: 'Space:Fairmont_Cemetery_Raton_NM_USA',
    center: [36.9033279, -104.4226532], fgCemetery: '38059',
  });
  assert.deepEqual(parseCategoryInfo('<p>x</p>'), { pages: [] });
});

test('live directory: no directory/ files -> hierarchy from WikiTree+, cemeteries from category pages, no name search', async () => {
  const urls = [];
  const pages = {
    [categoryUrl('Category:Colfax County, New Mexico, Cemeteries')]: COUNTY_PAGE({ count: 30, items: [itemPlain('Abbott Cemetery, Colfax County, New Mexico', '(0, 8, 0)')] }),
  };
  const fetchImpl = async (u) => {
    urls.push(u);
    if (u === GROUPS_URL) return { ok: true, status: 200, text: async () => GROUPS };
    if (pages[u]) return { ok: true, status: 200, text: async () => pages[u] };
    return { ok: false, status: u.startsWith('directory/') ? 404 : 202, text: async () => '' };
  };
  const dir = createDirectory({ fetchImpl });
  const t = await dir.tree();
  assert.equal(t.mode, 'live');
  assert.deepEqual(t.kids[0].map((i) => t.nodes[i][0]), ['Europe', 'North America', 'Other categories']); // empty places are kept in live mode
  const colfax = t.nodes.findIndex((n) => n[0] === 'Colfax County');
  assert.equal(t.nodes[colfax][4], 'Colfax County, New Mexico, Cemeteries');
  assert.deepEqual((await dir.pathTo(colfax)).map((i) => t.nodes[i][0]), ['All places', 'North America', 'United States', 'New Mexico', 'Colfax County']);
  const r = await dir.cemeteriesAt(colfax);
  assert.deepEqual(r.records.map((x) => x[0]), ['Abbott Cemetery, Colfax County, New Mexico']);
  assert.match(r.note, /30 entries.*first 1/);
  assert.match(r.url, /Category:Colfax_County%2C_New_Mexico%2C_Cemeteries$/);
  assert.equal(await dir.search('abbott'), null);
  assert.equal(await dir.lookup('Abbott Cemetery, Colfax County, New Mexico'), null);
  // a place whose page WikiTree won't return reports "blocked" instead of an empty list
  const europe = t.nodes.findIndex((n) => n[0] === 'Europe');
  await assert.rejects(dir.cemeteriesAt(europe), /blocked/);
});

// The real "Unknown Headstones" page: no WikiTree IDs, columns labelled Longitude/Latitude but holding lat/lon the other way round.
const UNKNOWN_PAGE = `<table class="sortable"><tr><th>Longitude</th><th>Latitude</th><th>File</th><th>Section</th><th>Image</th></tr>
<tr><td>36.903995</td><td>-104.430891</td><td>1-35</td><td>1</td><td><div class='table-wrapper'><table class="no-wrap"><tr><td><a href="/wiki/Image:Unknown_Headstone-1-35.jpg" class="image"><img src="/photo.php/thumb/x/xx/Unknown_Headstone-1-35.jpg/75px-x.jpg"/></a></td></tr></table></div></td></tr>
<tr><td>36.903495</td><td>-104.430803</td><td>1-36</td><td>1</td><td></td></tr>
<tr><td>36.903495</td><td>-104.430803</td><td>1-36</td><td>1</td><td></td></tr>
<tr><td></td><td></td><td>9-9</td><td>9</td><td></td></tr></table>`;
test('unknown headstones: no profile needed, swapped columns fixed, repeated rows are not "repeated people"', () => {
  const r = parseSpaceTable(UNKNOWN_PAGE);
  assert.equal(r.found, true);
  assert.equal(r.graves.length, 0);
  assert.equal(r.markers.length, 3);
  assert.deepEqual(r.markers[0].lat, 36.903995);
  assert.deepEqual(r.markers[0].lon, -104.430891);
  assert.equal(r.markers[0].label, '1-35');
  assert.equal(r.markers[0].photo, photoUrlForName('Unknown_Headstone-1-35.jpg'));
  assert.ok(!r.issues.some((i) => i.kind === 'dupid'), 'no duplicate warnings for unknown markers');
});

test('living people are left out silently; spaces in IDs written as underscores are kept as spaces', () => {
  const rows = [
    albumRow('Towndrow-39', '36.9', '-104.4', '1-03-44', 'a/ab', 'T.jpg').replace('</td></tr>', '</td><td>Still Living</td></tr>'),
    albumRow('Van_De_Valde-6', '36.9', '-104.4', '1', 'c/c9', 'V.jpg'),
    albumRow('Livingston-4797', '36.9', '-104.4', '1-20-23', 'c/c9', 'L.jpg'),
  ];
  const html = `<table><tr><th>WT-ID</th><th>Latitude</th><th>Longitude</th><th>Surname</th><th>Forename</th><th>DOB</th><th>DOD</th><th>Plot</th><th>Image</th><th>Note</th></tr>${rows.join('')}</table>`;
  const r = parseSpaceTable(html);
  assert.deepEqual(r.graves.map((g) => g.wt), ['Van De Valde-6', 'Livingston-4797']);
  assert.equal(r.issues.length, 0, JSON.stringify(r.issues));
  assert.equal(wikiTreeUrl('Van De Valde-6'), 'https://www.wikitree.com/wiki/Van_De_Valde-6');
  assert.equal(extractWikiTreeId('Van_De_Valde-6'), 'Van De Valde-6');
  const csv = parseGraves('WikiTree ID,Lat,Long,Note\nA-1,1,2,still living\nB-2,1,2,\n');
  assert.deepEqual(csv.graves.map((g) => g.wt), ['B-2']);
});

test('per-page problems are grouped: one line with a count and a link to the page', async () => {
  const bad = `<table><tr><th>WT-ID</th><th>Latitude</th><th>Longitude</th><th>Surname</th><th>Image</th></tr>
<tr><td><a href="/wiki/Ok-1">Ok-1</a></td><td>1</td><td>2</td><td>OK</td><td></td></tr>
<tr><td>Nope-1</td><td></td><td></td><td>NOPE</td><td></td></tr><tr><td>Nope-2</td><td></td><td></td><td>NOPE</td><td></td></tr><tr><td>Nope-3</td><td></td><td></td><td>NOPE</td><td></td></tr>
<tr><td></td><td></td><td></td><td>HALL</td><td>image needed</td></tr></table>`;
  const r = await fetchSpaceTables(['Space:Album_9'], { fetchImpl: async () => ({ status: 200, text: async () => bad }) });
  const nc = r.issues.find((i) => i.kind === 'nocoords');
  assert.equal(nc.count, 4, 'three people with an ID and one named burial without an ID, none with coordinates');
  assert.equal(nc.msg, 'Album 9: 4 rows have no usable coordinates.');
  assert.equal(nc.links[0].href, 'https://www.wikitree.com/wiki/Space:Album_9');
  assert.equal(r.issues.find((i) => i.kind === 'noid'), undefined, 'a named row without an ID is a burial to keep, not a problem');
  assert.equal(r.graves.filter((g) => g.wt.startsWith('nowt:')).length, 1);
  assert.equal(r.issues.length, 1, 'no per-row lines');
});

import { imagePageUrl } from '../js/images.js';
import { slimPerson } from '../js/wikitree-api.js';

test('image page URL from a stored photo URL', () => {
  assert.equal(imagePageUrl('https://www.wikitree.com/photo.php/c/c9/Valdez-1365.jpg'), 'https://www.wikitree.com/photo/jpg/Valdez-1365');
  assert.equal(imagePageUrl('https://www.wikitree.com/photo.php/4/4e/Cemetery_Map-1.png'), 'https://www.wikitree.com/photo/png/Cemetery_Map-1');
  assert.equal(imagePageUrl('https://example.com/pic.jpg'), '');
  assert.equal(imagePageUrl(undefined), '');
});

test('data check: shared photo and far-away points link to the image page; no per-row noise for the rest', () => {
  const photo = photoUrlForName('Shared-1.jpg');
  const far = photoUrlForName('Faraway-9.jpg');
  const graves = [
    { wt: 'A-1', lat: 36.9040, lon: -104.4300, photo },
    { wt: 'B-2', lat: 36.9050, lon: -104.4300, photo },           // ~110 m from A-1, same photo
    { wt: 'C-3', lat: 36.9041, lon: -104.4301 },
    { wt: 'D-4', lat: 36.9042, lon: -104.4302 },
    { wt: 'E-5', lat: 37.5, lon: -104.4300, photo: far },          // ~66 km away, has a photo
    { wt: 'F-6', lat: 37.6, lon: -104.4300 },                      // far away, no photo
  ];
  const issues = auditGraves(graves, { center: [36.9041, -104.4301] });
  const shared = issues.find((i) => i.kind === 'sharedphoto');
  assert.match(shared.msg, /Shared-1\.jpg is shared by A-1, B-2, but their coordinates differ by more than 10 m/);
  assert.deepEqual(shared.links, [{ href: 'https://www.wikitree.com/photo/jpg/Shared-1', text: 'Image page' }]);
  const out = issues.filter((i) => i.kind === 'outlier');
  assert.deepEqual(out.map((i) => i.wt).sort(), ['E-5', 'F-6']);
  assert.deepEqual(out.find((i) => i.wt === 'E-5').links, [{ href: 'https://www.wikitree.com/photo/jpg/Faraway-9', text: 'Image page' }]);
  assert.deepEqual(out.find((i) => i.wt === 'F-6').links, [{ href: 'https://www.wikitree.com/wiki/F-6', text: 'Profile' }]);
  // a spread-out but legitimate cemetery is not flagged for its size
  const wide = Array.from({ length: 50 }, (_, i) => ({ wt: `W-${i}`, lat: 36.9 + i * 0.0001, lon: -104.43 }));
  assert.equal(auditGraves(wide, { center: [36.9025, -104.43] }).length, 0);
});

test('profiles in the table but not in the category: one count, a link to the report', () => {
  const graves = [{ wt: 'In-1', lat: 1, lon: 2 }, { wt: 'Out-2', lat: 1, lon: 2 }, { wt: 'Out-3', lat: 1, lon: 2 }];
  const issues = mergeRoster(graves, { profiles: [{ wt: 'In-1' }] }, { reportHref: 'https://plus.wikitree.com/report' });
  const stray = issues.filter((i) => i.kind === 'stray');
  assert.equal(stray.length, 1);
  assert.equal(stray[0].msg, '2 profiles in the table are not in the WikiTree category.');
  assert.deepEqual(stray[0].links, [{ href: 'https://plus.wikitree.com/report', text: 'WikiTree+ report' }]);
  assert.ok(!stray[0].msg.includes('Out-2'));
});

test('a living person from the API keeps nothing else', () => {
  assert.deepEqual(slimPerson({ IsLiving: 1, FirstName: 'Pat', LastNameAtBirth: 'Smith', BirthDate: '1980-01-01' }), { living: true });
  assert.equal(slimPerson({ IsLiving: 0, FirstName: 'Pat', LastNameAtBirth: 'Smith' }).name, 'Pat Smith');
});

test('documents keep unknown-headstone markers and drop unusable ones', () => {
  const d = validateDocument({ graves: [], markers: [{ lat: '36.9', lon: -104.4, label: '1-35' }, { lat: 'x', lon: 1 }, null] });
  assert.deepEqual(d.markers, [{ lat: 36.9, lon: -104.4, label: '1-35' }]);
  assert.equal(validateDocument({ graves: [], markers: [] }).markers, undefined);
});

import { pointsInArea } from '../js/model.js';
test('first view ignores stray points but keeps a big cemetery whole', () => {
  const near = Array.from({ length: 20 }, (_, i) => ({ wt: `N-${i}`, lat: 36.904 + i * 0.00005, lon: -104.43 }));
  const withStray = [...near, { wt: 'Far-1', lat: 37.5, lon: -104.43 }];
  assert.equal(pointsInArea(withStray, [36.9045, -104.43]).length, 20);
  assert.equal(pointsInArea(withStray).length, 20);
  assert.equal(pointsInArea([{ wt: 'Only-1', lat: 1, lon: 2 }]).length, 1);
  assert.deepEqual(pointsInArea([], [1, 2]), []);
});

test('headstone photos can live anywhere: any http(s) address is kept as written, shared photos still group the stone', () => {
  const g1 = 'https://lh3.googleusercontent.com/pw/AP1Gcz-abc123=w1200-h900';
  const csv = `WikiTree ID,Long,Lat,Image
Côté-12,-71.0123,46.9123,${g1}
Gagnon-45,-71.0123,46.9123,${g1}
Roy-7,-71.0200,46.9200,https://example.org/photos/roy-7.jpg
Odd-1,-71.0300,46.9300,not-a-link`;
  const { graves, issues } = parseGraves(csv);
  assert.deepEqual(graves.map((g) => g.photo), [g1, g1, 'https://example.org/photos/roy-7.jpg', 'not-a-link']);
  assert.ok(issues.some((i) => i.wt === 'Odd-1' && i.kind === 'badphoto'));
  assert.equal(graves[0].wt, 'Côté-12');
  const plots = groupPlots(graves);
  assert.equal(plots.length, 3);
  assert.deepEqual(plots.find((p) => p.members.length === 2).members.map((m) => m.wt), ['Côté-12', 'Gagnon-45']);
  assert.equal(thumbUrl(g1, 500), g1);
  assert.equal(imagePageUrl(g1), '', 'no WikiTree image page for a photo stored elsewhere');
  assert.ok(spaceTableMarkup(graves).includes(`[${g1} Headstone]`));
});

import { composeName, displayName, tidyName, lifeSpan } from '../js/people.js';
import { NO_ID_PREFIX, hasProfile } from '../js/links.js';

// The layout of the Fairview Plot Map Table after names were added (two test rows have no WikiTree ID).
const NAMES_PAGE = `<table border="1" class="sortable"><tr><th>WikiTree</th><th>FindAGrave</th><th>FamilySearch</th><th>Long</th><th>Lat</th><th>Image link</th><th>Given Names</th><th>Surname</th><th>Maiden</th><th>Birth</th><th>Death</th><th>Notes</th></tr>
<tr><td><a href="/wiki/Dawson-12756">Dawson-12756</a></td><td>Find A Grave: <a href="https://www.findagrave.com/memorial/107645767">Memorial #107645767</a></td><td></td><td></td><td></td><td><a href="https://www.wikitree.com/photo.php/9/91/Padilla-1750.jpg">Headstone</a></td><td>George Washington</td><td>Dawson</td><td></td><td>1858</td><td>1939</td><td></td></tr>
<tr><td></td><td>Find A Grave: <a href="https://www.findagrave.com/memorial/24170747">Memorial #24170747</a></td><td></td><td></td><td></td><td><a href="https://www.wikitree.com/photo.php/9/91/Padilla-1750.jpg">Headstone</a></td><td></td><td>Bunker</td><td></td><td></td><td>1956</td><td>Name on stone only</td></tr>
<tr><td></td><td>Find A Grave: <a href="https://www.findagrave.com/memorial/24170748">Memorial #24170748</a></td><td></td><td>-104.4237</td><td>36.9041</td><td><a href="https://example.org/cruz.jpg">Headstone</a></td><td>Estevan</td><td>Cruz</td><td>Pacheco</td><td>1956</td><td>1956</td><td></td></tr>
<tr><td></td><td></td><td></td><td>-104.4240</td><td>36.9042</td><td><a href="https://example.org/blank.jpg">Headstone</a></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>`;

test('burials without a WikiTree ID are kept, named, and keyed by their Find a Grave memorial', () => {
  const r = parseSpaceTable(NAMES_PAGE);
  assert.equal(r.found, true);
  const [dawson, bunker, cruz] = r.graves;
  assert.equal(r.graves.length, 3);
  assert.deepEqual([dawson.wt, dawson.given, dawson.surname, dawson.born, dawson.died], ['Dawson-12756', 'George Washington', 'Dawson', '1858', '1939']);
  assert.equal(bunker.wt, `${NO_ID_PREFIX}fag24170747`);
  assert.equal(hasProfile(bunker.wt), false);
  assert.equal(hasProfile(dawson.wt), true);
  assert.deepEqual([bunker.surname, bunker.died, bunker.notes, bunker.fag, bunker.lat], ['Bunker', '1956', 'Name on stone only', '24170747', undefined]);
  assert.deepEqual([cruz.given, cruz.surname, cruz.maiden, cruz.lat, cruz.lon, cruz.photo], ['Estevan', 'Cruz', 'Pacheco', 36.9041, -104.4237, 'https://example.org/cruz.jpg']);
  assert.equal(r.markers.length, 1, 'a stone with a location and a picture but nobody named is still an unknown headstone');
  assert.equal(composeName(cruz), 'Estevan (Pacheco) Cruz');
  assert.equal(displayName(bunker), 'Bunker');
  assert.equal(displayName({ wt: 'Smith-1' }), 'Smith-1');
  assert.equal(displayName({ wt: `${NO_ID_PREFIX}x` }), 'Name not recorded');
  assert.equal(lifeSpan(cruz), '1956 – 1956');
  assert.equal(lifeSpan({ born: '4 Mar 1912', died: 'abt 1998' }), '1912 – 1998');
});

test('name tidy-up only touches names that are entirely in capitals; maiden equal to surname is not repeated', () => {
  assert.equal(tidyName('MALCOLM'), 'Malcolm');
  assert.equal(tidyName("O'QUINN"), "O'Quinn");
  assert.equal(tidyName('MCQUEARY'), 'McQueary');
  assert.equal(tidyName('Dos Santos'), 'Dos Santos');
  assert.equal(tidyName('de la Cruz'), 'de la Cruz');
  assert.equal(composeName({ given: 'Ann', surname: 'Roy', maiden: 'roy' }), 'Ann Roy');
  assert.equal(composeName({ surname: 'Roy' }), 'Roy');
  assert.equal(composeName({ given: 'Ann', maiden: 'Gagné' }), 'Ann Gagné');
});

test('two burials with the same details get distinct keys; a CSV in the same layout imports the same way', () => {
  const csv = `Given Names,Surname,Birth,Death,Long,Lat,Image
Marie,Côté,1901,1950,-71.01,46.9,https://example.org/a.jpg
Marie,Côté,1901,1950,-71.01,46.9,https://example.org/a.jpg
Jean,Côté,,1949,-71.01,46.9,https://example.org/a.jpg`;
  const { graves, issues } = parseGraves(csv);
  assert.equal(new Set(graves.map((g) => g.wt)).size, 3);
  assert.ok(graves.every((g) => !hasProfile(g.wt)));
  assert.deepEqual(issues.filter((i) => i.level !== 'info'), []);
  const plots = groupPlots(graves);
  assert.equal(plots.length, 1, 'same coordinates: one headstone with three people');
  assert.equal(plots[0].members.length, 3);
});

test('table markup keeps names, dates and notes, and keeps burials with no profile even without a location', () => {
  const r = parseSpaceTable(NAMES_PAGE);
  const md = spaceTableMarkup(r.graves);
  assert.ok(md.includes('! WikiTree !! FindAGrave !! FamilySearch !! Long !! Lat !! Image link !! Given Names !! Surname !! Maiden !! Birth !! Death !! Notes'));
  const lines = md.split('\n').filter((l) => l.startsWith('| '));
  assert.equal(lines.length, 3, 'Dawson has no location but its names and photo are in the table, so the row stays, and so do both burials without an ID');
  assert.ok(lines.some((l) => l.startsWith('| [[Dawson-12756]]')));
  assert.equal(spaceTableMarkup([{ wt: 'Roster-1', fag: '5' }, { wt: 'Placed-2', lat: 1, lon: 2 }]).split('\n').filter((l) => l.startsWith('| ')).length, 1, 'a profile that is only a roster entry is not written');
  const bunker = lines.find((l) => l.includes('{{FindAGrave|24170747}}'));
  assert.equal(bunker, '|  || {{FindAGrave|24170747}} ||  ||  ||  || [https://www.wikitree.com/photo.php/9/91/Padilla-1750.jpg Headstone] ||  || Bunker ||  ||  || 1956 || Name on stone only');
  const cruz = lines.find((l) => l.includes('Estevan'));
  assert.ok(cruz.includes('|| -104.4237 || 36.9041 || [https://example.org/cruz.jpg Headstone] || Estevan || Cruz || Pacheco || 1956 || 1956 ||'));
});

import { applyEdits as applyE, pruneEdits as pruneE } from '../js/edits.js';
test('adding a WikiTree ID to a burial re-keys it, merges with the roster, and drops the edit once published', () => {
  const key = `${NO_ID_PREFIX}fag24170747`;
  const base = [{ wt: key, surname: 'Bunker', fag: '24170747', died: '1956' }];
  const edits = { [key]: { assignWt: 'Bunker-12', lat: 36.9, lon: -104.4 } };
  const graves = base.map((g) => ({ ...g }));
  applyE(graves, edits);
  assert.deepEqual(graves.map((g) => [g.wt, g.surname, g.lat]), [['Bunker-12', 'Bunker', 36.9]]);
  const issues = mergeRoster(graves, { profiles: [{ wt: 'Bunker-12', fag: '24170747' }, { wt: 'Other-1' }] });
  assert.equal(graves.length, 2, 'the roster profile merges into the entry instead of adding a duplicate');
  assert.deepEqual(issues, []);
  // not on the page yet -> still pending; on the page -> pruned
  assert.deepEqual(Object.keys(pruneE(edits, base)), [key]);
  assert.deepEqual(pruneE(edits, [{ wt: 'Bunker-12', lat: 36.9, lon: -104.4 }]), {});
  assert.deepEqual(Object.keys(pruneE({ [key]: { assignWt: 'Bunker-12' } }, [{ wt: key }])), [key]);
  assert.deepEqual(pruneE({ [key]: { assignWt: 'Bunker-12' } }, [{ wt: 'Bunker-12' }]), {});
});

test('snapshots and share links keep burials that have no WikiTree profile, even without a location', async () => {
  const cem = { id: 'x', name: 'X', graves: [
    { wt: 'Has-1', lat: 1, lon: 2 }, { wt: 'NoLoc-2', fag: '7' }, { wt: `${NO_ID_PREFIX}fag9`, surname: 'Bunker', _edited: true },
    { wt: 'Named-3', given: 'Ann', surname: 'Roy' }, { wt: 'Photo-4', photo: 'https://example.org/p.jpg' },
  ] };
  const keep = ['Has-1', `${NO_ID_PREFIX}fag9`, 'Named-3', 'Photo-4'];
  const doc = JSON.parse(toJson(cem));
  assert.deepEqual(doc.graves.map((g) => g.wt), keep, 'a roster-only profile (NoLoc-2) is left out; everything typed into the table is kept');
  assert.equal(doc.graves[1]._edited, undefined);
  const back = await decodeShare(await encodeShare(cem));
  assert.deepEqual(back.graves.map((g) => g.wt), keep);
});

import { VERSION } from '../js/config.js';
import { displayImageUrl } from '../js/images.js';
test('the version in config.js, package.json and the changelog agree', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const log = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, VERSION);
  assert.ok(log.includes(`## ${VERSION} (`), 'CHANGELOG.md has an entry for this version');
});

test('Google Drive share links are shown through Drive\'s picture address; other links are untouched', () => {
  const id = '1GKozIuic0NT3e_I_OPHVcijcZGrfH4BO';
  const want = `https://drive.google.com/thumbnail?id=${id}&sz=w1600`;
  assert.equal(displayImageUrl(`https://drive.google.com/file/d/${id}/view?usp=sharing`), want);
  assert.equal(displayImageUrl(`https://drive.google.com/file/d/${id}/view`), want);
  assert.equal(displayImageUrl(`https://drive.google.com/open?id=${id}`), want);
  assert.equal(displayImageUrl(`https://drive.google.com/uc?export=view&id=${id}`), want);
  assert.equal(displayImageUrl(`https://drive.google.com/file/d/${id}/view`, 800), `https://drive.google.com/thumbnail?id=${id}&sz=w800`);
  for (const u of ['https://lh3.googleusercontent.com/pw/ABC=w800', 'https://www.wikitree.com/photo.php/c/cf/Tapia-408.jpg', 'https://example.org/a.jpg', '', undefined]) {
    assert.equal(displayImageUrl(u), u);
  }
});

import { canonSpaceTitle, spacePageUrl } from '../js/spacetable.js';

const FR_SPACE = "Space:Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec";
test('Space page titles with accents and apostrophes are accepted; markup and paths are not', () => {
  assert.ok(isSpacePage(FR_SPACE));
  assert.ok(isSpacePage(`${FR_SPACE}_Plot_Map`));
  assert.ok(isSpacePage('Space:Cimeti%C3%A8re_de_Sainte-Famille%2C_%C3%8Ele'));
  assert.ok(isSpacePage('Space:Кладбище_Святой_Семьи'));
  for (const bad of ['Space:A/B', 'Space:A[[B]]', 'Space:A<b>', 'Space:', 'Category:X', 'Space:A\nB', 'Space:A|B']) assert.ok(!isSpacePage(bad), bad);
  assert.equal(canonSpaceTitle('Space:Cimeti%C3%A8re_de_Sainte-Famille%2C_%C3%8Ele'), 'Space:Cimetière_de_Sainte-Famille,_Île');
  assert.equal(canonSpaceTitle('Space:A B'), 'Space:A_B');
  assert.equal(spacePageUrl(`${FR_SPACE}_Plot_Map`), "https://www.wikitree.com/wiki/Space:Cimeti%C3%A8re_de_Sainte-Famille,_%C3%8Ele_d'Orl%C3%A9ans,_Qu%C3%A9bec_Plot_Map");
  assert.equal(spacePageUrl('Space:A%2CB'), 'https://www.wikitree.com/wiki/Space:A%2CB', 'already-escaped titles are not double-encoded');
});

test("a plot page in the category is found even with accents in its title, and becomes the table page", async () => {
  const cat = "Category:Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec";
  const plotPage = `${FR_SPACE}_Plot_Map`;
  const table = `<table class="sortable"><tr><th>WikiTree</th><th>FindAGrave</th><th>FamilySearch</th><th>Long</th><th>Lat</th><th>Image link</th><th>Given Names</th><th>Surname</th><th>Maiden</th><th>Birth</th><th>Death</th><th>Notes</th></tr>
<tr><td></td><td></td><td></td><td>-70.96</td><td>46.97</td><td><a href="https://photos.app.goo.gl/abc">Headstone</a></td><td>Adelaide</td><td>Tremblay</td><td></td><td></td><td>1911-02-18</td><td>Fam-4150</td></tr></table>`;
  const catHtml = `<a href="/wiki/Space:Cimeti%C3%A8re_de_Sainte-Famille%2C_%C3%8Ele_d'Orl%C3%A9ans%2C_Qu%C3%A9bec">Space</a> <a href="https://www.openstreetmap.org/#map=17/46.9741/-70.9615">OSM</a>
<h2>Pages (3)</h2><a href="/wiki/Space:Cimetière de Sainte-Famille, Île d'Orléans, Québec">main</a><a href="/wiki/Space:Cemetery of Sainte-Famille, Île d'Orléans, Québec">en</a><a href="/wiki/Space:Cimeti%C3%A8re_de_Sainte-Famille%2C_%C3%8Ele_d'Orl%C3%A9ans%2C_Qu%C3%A9bec_Plot_Map">plot</a><h2>Person Profiles (9)</h2>`;
  const mainHtml = '<p>The cemetery. No table here.</p>';
  const pages = new Map([
    [categoryUrl(cat), catHtml],
    [spacePageUrl(FR_SPACE), mainHtml],
    [spacePageUrl("Space:Cemetery_of_Sainte-Famille,_Île_d'Orléans,_Québec"), mainHtml],
    [spacePageUrl(plotPage), table],
  ]);
  const asked = [];
  const fetchImpl = async (u) => {
    if (u.startsWith('cemeteries/')) return { ok: false };
    asked.push(u);
    return pages.has(u) ? { status: 200, text: async () => pages.get(u) } : { status: 404, text: async () => 'Page not found' };
  };
  const entry = { id: 'sf', name: 'Cimetière de Sainte-Famille', wikitree: { category: cat }, sourceGuessed: true,
    source: { type: 'wikitree-space', page: `${FR_SPACE}_Plot_Map_Table` } };
  const r = await loadCemetery(entry, { fetchImpl, live: true });
  assert.equal(r.origin, 'live');
  assert.equal(r.doc.graves.length, 1);
  assert.equal(r.doc.graves[0].notes, 'Fam-4150');
  assert.equal(r.doc.source.page, plotPage, 'the page that really holds the table becomes the table page');
  assert.deepEqual(r.doc.source.pages, [plotPage]);
  assert.equal(r.doc.wikitree.space, FR_SPACE);
  assert.deepEqual(r.doc.center, [46.9741, -70.9615]);
  // pages that don't exist are skipped quietly, and "nothing found" is not reported as WikiTree blocking us
  const none = await fetchSpaceTables(['Space:Nope_One', 'Space:Nope_Two'], { fetchImpl: async () => ({ status: 404, text: async () => 'x' }) });
  assert.deepEqual([none.graves.length, none.pages.length, none.skipped.length], [0, 0, 2]);
});

import { plotLabel } from '../js/people.js';
test('a headstone is labelled by its Plot number, else the reference everyone on it shares in Notes', () => {
  assert.equal(plotLabel([{ wt: 'A-1', plot: '1-01-21b', notes: 'x' }]), '1-01-21b');
  assert.equal(plotLabel([{ wt: 'A-1', notes: 'Fam-4150' }, { wt: 'B-2', notes: 'Fam-4150' }]), 'Fam-4150');
  assert.equal(plotLabel([{ wt: 'A-1', notes: 'Fam-4150' }, { wt: 'B-2', notes: 'Fam-4151' }]), '', 'different notes are not a shared reference');
  assert.equal(plotLabel([{ wt: 'A-1', notes: 'Infant, died of a long illness the winter before' }]), '', 'long notes are not a label');
  assert.equal(plotLabel([{ wt: 'A-1', notes: '' }]), '');
  assert.equal(plotLabel([{ marker: true, label: '1-35' }]), '1-35');
  assert.equal(plotLabel([{ wt: 'A-1', plot: 'P1' }, { wt: 'B-2', plot: 'P2' }]), 'P1…');
  const plots = groupPlots([{ wt: 'A-1', lat: 1, lon: 2, notes: 'Fam-1' }, { wt: 'B-2', lat: 1, lon: 2, notes: 'Fam-1' }, { wt: 'C-3', lat: 5, lon: 6 }]);
  assert.deepEqual(plots.map((p) => p.label).sort(), ['', 'Fam-1']);
});

import { SPACE_URL, GITHUB_URL, AUTHOR_URL } from '../js/config.js';
test("the map's corner credits the app: source on GitHub, the author's profile, and Help on the Space page", () => {
  assert.equal(SPACE_URL, 'https://www.wikitree.com/wiki/Space:Cemetery_Map');
  assert.equal(GITHUB_URL, 'https://github.com/robinson27225/cemetery-map');
  assert.equal(AUTHOR_URL, 'https://www.wikitree.com/wiki/Robinson-27225');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes('link(GITHUB_URL, `Cemetery Map v${VERSION}`'), 'the version links to the source code');
  assert.ok(app.includes('Created by ${link(AUTHOR_URL, AUTHOR_ID)}'), 'the author is credited with a link to their profile');
  assert.ok(app.includes("link(SPACE_URL, 'Help'"), 'Help links to the Space page');
});

test('every ready-made map in cemeteries/index.json is well formed', () => {
  const idx = JSON.parse(readFileSync(new URL('../cemeteries/index.json', import.meta.url), 'utf8')).cemeteries;
  assert.ok(idx.length >= 3);
  assert.equal(new Set(idx.map((c) => c.id)).size, idx.length, 'ids are unique');
  for (const c of idx) {
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.ok(c.name && c.location, `${c.id} has a name and location`);
    assert.ok(isCategoryTitle(c.wikitree?.category), `${c.id} has a category`);
    assert.ok(isSpacePage(c.wikitree?.space), `${c.id} has a Space page`);
    if (c.source) assert.ok(isSpacePage(c.source.page), `${c.id} source page`);
  }
  const names = idx.map((c) => c.name);
  assert.ok(names.includes('Fairmont Cemetery') && names.includes('Cimetière de Sainte-Famille'));
});

test('an empty start says why: cannot read the pages from here, versus nothing recorded yet', async () => {
  const entry = { id: 'z', name: 'Z', wikitree: { category: 'Category:Z' }, source: { type: 'wikitree-space', page: 'Space:Z_Plot_Map' } };
  const none = async (u) => (u.startsWith('cemeteries/') ? { ok: false } : { status: 202, text: async () => '' });
  const off = await loadCemetery(entry, { fetchImpl: none, live: false, allowEmpty: true });
  assert.match(off.note, /Showing only the list of people: the app is not running on wikitree\.com/);
  const blocked = await loadCemetery(entry, { fetchImpl: none, live: true, allowEmpty: true });
  assert.match(blocked.note, /WikiTree did not return/);
  const missing = await loadCemetery(entry, { fetchImpl: async (u) => (u.startsWith('cemeteries/') ? { ok: false } : { status: 404, text: async () => 'x' }), live: true, allowEmpty: true });
  assert.match(missing.note, /Nobody has recorded locations/);
});

import { cemeteryCategoriesOf, groupByCemetery, discoverPlotting, createPlottingRegistry, mergeReadyMade, PLOTTING_CATEGORY } from '../js/plotting.js';

test('the cemetery category is the plotting page\'s category that isn\'t Plotting_Pages', () => {
  assert.equal(PLOTTING_CATEGORY, 'Category:Plotting_Pages');
  assert.deepEqual(cemeteryCategoriesOf('Space:Fairmont_Cemetery_Raton_NM_USA_Album_1', ['Fairmont_Cemetery,_Raton,_New_Mexico', 'Plotting_Pages']), ['Fairmont_Cemetery,_Raton,_New_Mexico']);
  // a page with other categories too: keep the one whose name starts the page title
  assert.deepEqual(cemeteryCategoriesOf('Space:Fairview_Presbyterian_Cemetery_Raton_NM_USA',
    ['Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico', 'First_Presbyterian_Church,_Raton,_New_Mexico', 'Plotting_Pages', 'Raton,_New_Mexico', 'Raton,_New_Mexico_One_Place_Study']),
  ['Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico']);
  assert.deepEqual(cemeteryCategoriesOf("Space:Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec_Plot_Map", ["Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec", 'Plotting_Pages']), ["Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec"]);
  assert.deepEqual(cemeteryCategoriesOf('Space:Something_Else', ['Plotting_Pages']), []);
  assert.deepEqual(cemeteryCategoriesOf('Space:Something_Else', ['Raton,_New_Mexico', 'Colfax_County,_New_Mexico']), [], 'several categories and none starts the title: not guessed');
});

const PLOTTING_PAGE = `<h2>Pages (4)</h2>
<a href="/wiki/Space:Cimetière de Sainte-Famille, Île d'Orléans, Québec Plot Map">a</a>
<a href="/wiki/Space:Fairmont Cemetery Raton NM USA Album 1">b</a>
<a href="/wiki/Space:Fairmont Cemetery Raton NM USA Album 2">c</a>
<a href="/wiki/Space:Fairview Presbyterian Cemetery Raton NM USA">d</a><h2>Person Profiles (0)</h2>`;
const CATS = {
  "Space:Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec_Plot_Map": ["Cimetière_de_Sainte-Famille,_Île_d'Orléans,_Québec", 'Plotting_Pages'],
  'Space:Fairmont_Cemetery_Raton_NM_USA_Album_1': ['Fairmont_Cemetery,_Raton,_New_Mexico', 'Plotting_Pages'],
  'Space:Fairmont_Cemetery_Raton_NM_USA_Album_2': ['Fairmont_Cemetery,_Raton,_New_Mexico', 'Plotting_Pages'],
  'Space:Fairview_Presbyterian_Cemetery_Raton_NM_USA': ['Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico', 'Plotting_Pages', 'Raton,_New_Mexico'],
};
const plottingFetch = (calls = []) => async (u) => {
  calls.push(u);
  if (u === categoryUrl(PLOTTING_CATEGORY)) return { ok: true, status: 200, text: async () => PLOTTING_PAGE };
  const key = decodeURIComponent(new URL(u).searchParams.get('key') || '');
  return CATS[key] ? { ok: true, status: 200, json: async () => [{ page_name: key, categories: CATS[key], status: 0 }] } : { ok: false, status: 404 };
};

test('cemeteries with plot maps are found by reading the Plotting_Pages category', async () => {
  const list = await discoverPlotting({ fetchImpl: plottingFetch() });
  assert.deepEqual(list.map((c) => c.name), ['Cimetière de Sainte-Famille', 'Fairmont Cemetery', 'Fairview Presbyterian Cemetery']);
  const fairmont = list.find((c) => c.name === 'Fairmont Cemetery');
  assert.equal(fairmont.category, 'Fairmont Cemetery, Raton, New Mexico');
  assert.equal(fairmont.location, 'Raton, New Mexico');
  assert.deepEqual(fairmont.pages, ['Space:Fairmont_Cemetery_Raton_NM_USA_Album_1', 'Space:Fairmont_Cemetery_Raton_NM_USA_Album_2']);
  assert.equal(list.length, 3, 'Raton, New Mexico (a town) is not taken for a cemetery');
  // WikiTree can't be read from here: an empty answer, not an error
  assert.deepEqual(await discoverPlotting({ fetchImpl: async () => ({ ok: true, status: 202, text: async () => '' }) }), []);
  assert.deepEqual(await discoverPlotting({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }), []);
});

test('the registry is remembered for ten minutes, and empty answers are not remembered', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let t = 1000;
  const calls = [];
  const reg = createPlottingRegistry({ fetchImpl: plottingFetch(calls), storage, now: () => t });
  assert.equal((await reg.list()).length, 3);
  const n = calls.length;
  assert.equal((await reg.list()).length, 3);
  assert.equal(calls.length, n, 'second call comes from the cache');
  t += 11 * 60 * 1000;
  await reg.list();
  assert.ok(calls.length > n, 'after ten minutes it reads WikiTree again');
  const empty = createPlottingRegistry({ fetchImpl: async () => ({ ok: true, status: 202, text: async () => '' }), storage: { getItem: () => null, setItem: () => assert.fail('should not cache an empty list') } });
  assert.deepEqual(await empty.list(), []);
});

test('ready-made maps: hand-registered ones plus the discovered ones, one row per cemetery', () => {
  const registered = [{ id: 'fairview-raton-nm', name: 'Fairview Presbyterian Cemetery', location: 'Raton, Colfax County, New Mexico, USA', wikitree: { category: 'Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico' } }, { id: 'no-cat', name: 'No category' }];
  const discovered = [
    { category: 'Fairview Presbyterian Cemetery, Raton, New Mexico', name: 'Fairview Presbyterian Cemetery', location: 'Raton, New Mexico', pages: [] },
    { category: 'Fairmont Cemetery, Raton, New Mexico', name: 'Fairmont Cemetery', location: 'Raton, New Mexico', pages: [] },
  ];
  const rows = mergeReadyMade(registered, discovered);
  assert.deepEqual(rows.map((r) => r.name), ['Fairview Presbyterian Cemetery', 'No category', 'Fairmont Cemetery']);
  assert.equal(rows[0].id, 'fairview-raton-nm', 'the registered entry wins, so it keeps its snapshot');
  assert.equal(rows[2].id, undefined);
  assert.equal(rows[2].category, 'Fairmont Cemetery, Raton, New Mexico');
});

import { suggestTableTitle, tablePageFromInput, tableTitleOf, placeWords } from '../js/table-title.js';
test('suggested plot-map page titles carry the place, with spaces and no Space: prefix', () => {
  assert.equal(suggestTableTitle('Fern Hill Cemetery', 'Aberdeen, Washington'), 'Fern Hill Cemetery Aberdeen WA USA Plot Map Table');
  assert.equal(suggestTableTitle('Fairview Presbyterian Cemetery', 'Raton, Colfax County, New Mexico, USA'), 'Fairview Presbyterian Cemetery Raton NM USA Plot Map Table');
  assert.equal(suggestTableTitle('Mount Calvary', 'Raton, New Mexico'), 'Mount Calvary Raton NM USA Plot Map Table');
  assert.equal(placeWords('Paris, France'), 'Paris France');
  assert.equal(placeWords("Île d'Orléans, Québec, Canada"), "Île d'Orléans QC Canada");
  assert.equal(suggestTableTitle('', 'Raton'), '');
});
test('typed table titles become the page key and back', () => {
  assert.equal(tablePageFromInput('Fern Hill Cemetery Aberdeen WA USA Plot Map Table'), 'Space:Fern_Hill_Cemetery_Aberdeen_WA_USA_Plot_Map_Table');
  assert.equal(tablePageFromInput('Space:Fern_Hill_Plot_Map_Table'), 'Space:Fern_Hill_Plot_Map_Table');
  assert.equal(tablePageFromInput('https://www.wikitree.com/wiki/Space:A_B_Plot_Map_Table'), 'Space:A_B_Plot_Map_Table');
  assert.equal(tablePageFromInput('  '), '');
  assert.equal(tableTitleOf('Space:Fern_Hill_Plot_Map_Table'), 'Fern Hill Plot Map Table');
});

import { labelOf } from '../js/people.js';
test('Monument and Reference columns are read, kept and labelled', () => {
  const { graves } = parseGraves('WikiTree ID,Long,Lat,Plot,Monument,Reference,Notes\nSmith-1,-100,35,P7,Family Smith,Fam-1,Veteran\nSmith-2,-100,35,P7,Family Smith,Fam-1,');
  assert.deepEqual([graves[0].plot, graves[0].monument, graves[0].reference, graves[0].notes], ['P7', 'Family Smith', 'Fam-1', 'Veteran']);
  assert.equal(labelOf(graves).text, 'P7');
  assert.deepEqual(labelOf(graves, { mode: 'monument' }), { text: 'Family Smith', kind: 'Monument' });
  assert.deepEqual(labelOf(graves, { mode: 'reference' }), { text: 'Fam-1', kind: 'Reference' });
  // a chosen column that is empty falls back to the automatic order
  assert.equal(labelOf([{ wt: 'A-1', reference: 'R1' }], { mode: 'plot' }).text, 'R1');
});
test('Notes only name a stone when the table has no Plot, Monument or Reference column', () => {
  const stone = (extra) => groupPlots([{ wt: 'A-1', lat: 1, lon: 1, notes: 'Veteran', ...extra }, { wt: 'A-2', lat: 1, lon: 1, notes: 'Veteran' }])[0].label;
  assert.equal(stone({}), 'Veteran');
  const two = groupPlots([{ wt: 'A-1', lat: 1, lon: 1, notes: 'Veteran' }, { wt: 'B-2', lat: 2, lon: 2, notes: 'x', monument: 'M' }]);
  assert.deepEqual(two.map((p) => p.label), ['M', '']);
});
test('the table keeps Plot, Monument and Reference columns only when a row has them', () => {
  const plain = spaceTableMarkup([{ wt: 'A-1', lat: 1, lon: 2 }]);
  assert.ok(!/Plot|Monument|Reference/.test(plain.split('\n')[1]));
  const md = spaceTableMarkup([{ wt: 'A-1', lat: 1, lon: 2, plot: 'P7', monument: 'Family A', reference: 'Fam-1', notes: 'Veteran' }]);
  assert.ok(md.split('\n')[1].endsWith('!! Death !! Plot !! Monument !! Reference !! Notes'));
  assert.ok(md.includes('|| P7 || Family A || Fam-1 || Veteran'));
});

import { isAlbumLink, pageLinkKind } from '../js/images.js';
test('album links are told apart from picture links', () => {
  assert.ok(isAlbumLink('https://photos.app.goo.gl/nXnKoocp381gQHHp9'));
  assert.ok(isAlbumLink('https://drive.google.com/drive/folders/1AbCdEfGhIjK'));
  assert.equal(pageLinkKind('https://photos.google.com/share/AF1QipOx4/photo/AF1QipPe?key=UEpQ'), 'photo');
  assert.equal(pageLinkKind('https://photos.app.goo.gl/nXnK'), 'album');
  assert.ok(!isAlbumLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view'));
  assert.ok(!isAlbumLink('https://www.wikitree.com/photo.php/9/9d/Cemetery_Map.png'));
});

import { overviewEntries, readCounts, saveCount, countRows } from '../js/overview.js';
test('overview entries: one per ready-made cemetery, with the pages that hold its rows', () => {
  const registered = [{ id: 'f', name: 'Fairview', location: 'Raton', wikitree: { category: 'Category:Fairview_Cemetery,_Raton' }, source: { type: 'wikitree-space', page: 'Space:F_Plot_Map_Table' } }, { id: 'x', name: 'No category' }];
  const discovered = [{ category: 'Fairview Cemetery, Raton', name: 'Fairview', location: 'Raton', pages: ['Space:F_Plot_Map_Table', 'Space:F_Album_1'] }, { category: 'Other Cemetery, Town', name: 'Other', location: 'Town', pages: ['Space:O_Plot'] }];
  const e = overviewEntries(registered, discovered);
  assert.deepEqual(e.map((x) => x.name), ['Fairview', 'Other']);
  assert.deepEqual(e[0].pages, ['Space:F_Plot_Map_Table', 'Space:F_Album_1']);
  assert.equal(e[0].id, 'f');
  assert.equal(e[1].id, undefined);
});
test('row counts are remembered, trusted for an hour and shown for a week', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveCount('A', 12, { storage, now: 1000 });
  assert.deepEqual(readCounts({ storage, now: 2000 }), { A: { rows: 12, fresh: true } });
  assert.deepEqual(readCounts({ storage, now: 1000 + 2 * 3600 * 1000 }), { A: { rows: 12, fresh: false } }, 'an old count is still shown, but not trusted');
  assert.deepEqual(readCounts({ storage, now: 1000 + 8 * 24 * 3600 * 1000 }), {});
  assert.deepEqual(readCounts({ storage: { getItem() { throw new Error('no'); } } }), {});
});
test('countRows adds the rows of every page and gives up quietly when WikiTree blocks', async () => {
  const table = (n, who) => `<table><tr><th>WikiTree</th><th>Long</th><th>Lat</th></tr>${Array.from({ length: n }, (_, i) => `<tr><td><a href="/wiki/${who}-${i + 1}">${who}-${i + 1}</a></td><td>-100</td><td>35</td></tr>`).join('')}</table>`;
  const ok = async (u) => ({ status: 200, text: async () => (u.includes('Space:A') ? table(3, 'Smith') : table(2, 'Jones')) });
  assert.equal(await countRows({ pages: ['Space:A', 'Space:B'] }, { fetchImpl: ok }), 5);
  assert.equal(await countRows({ pages: [] }), null);
  const flaky = async (u) => (u.includes('Space:A') ? { status: 429, text: async () => '' } : ok(u));
  assert.equal(await countRows({ pages: ['Space:A', 'Space:B'] }, { fetchImpl: flaky }), null, 'a page that could not be read must not give a low count');
  assert.equal(await countRows({ pages: ['Space:A'] }, { fetchImpl: async () => ({ status: 202, text: async () => '' }) }), null);
});
