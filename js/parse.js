// Parse a pasted/uploaded TSV or CSV into validated grave records plus an issue list.
import {
  extractWikiTreeId, isWikiTreeId, extractFindAGraveId, isFindAGraveId,
  extractFamilySearchId, isFamilySearchId, isHttpUrl,
  NO_ID_PREFIX,
} from './links.js';
import { normalizePhotoRef } from './images.js';
import { tidyName } from './people.js';

// header text (lower-cased, non-alphanumerics stripped) -> field
const ALIASES = {
  wikitreeid: 'wt', wikitree: 'wt', wtid: 'wt', profile: 'wt', profileid: 'wt', id: 'wt',
  findagrave: 'fag', findagraveid: 'fag', findagravememorial: 'fag', memorial: 'fag', memorialid: 'fag', fag: 'fag',
  familysearch: 'fs', familysearchid: 'fs', familysearchprofile: 'fs', fsid: 'fs', fs: 'fs',
  long: 'lon', lon: 'lon', lng: 'lon', longitude: 'lon', x: 'lon',
  lat: 'lat', latitude: 'lat', y: 'lat',
  headstonephotoonwikitree: 'photo', imagelink: 'photo', headstonelink: 'photo', picture: 'photo', headstonephoto: 'photo', photo: 'photo', photourl: 'photo', image: 'photo', headstone: 'photo',
  // names and dates (the table's own columns: Given Names, Surname, Maiden, Birth, Death)
  givennames: 'given', given: 'given', firstname: 'given', firstnames: 'given', forename: 'given', forenames: 'given',
  surname: 'surname', lastname: 'surname', currentlastname: 'surname', lastnamecurrent: 'surname', lnc: 'surname', familyname: 'surname',
  maiden: 'maiden', maidenname: 'maiden', lastnameatbirth: 'maiden', lnab: 'maiden', birthname: 'maiden', birthsurname: 'maiden',
  birth: 'born', birthdate: 'born', born: 'born', dob: 'born', dateofbirth: 'born',
  death: 'died', deathdate: 'died', died: 'died', dod: 'died', dateofdeath: 'died',
  file: 'label', section: 'section', block: 'section', plot: 'plot', lot: 'plot', row: 'row', notes: 'notes', note: 'notes',
  monument: 'monument', monumentname: 'monument', monumentheading: 'monument', heading: 'monument',
  reference: 'reference', ref: 'reference', referenceno: 'reference', referencenumber: 'reference',
};
/** Optional descriptive columns kept on a row: where the stone is, what it is called, and a note. */
export const EXTRA = ['section', 'plot', 'row', 'monument', 'reference', 'notes'];
const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
export const fieldForHeader = (h) => ALIASES[norm(h)] || null;

/** Split delimited text into rows of cells. Handles quoted CSV fields. */
export function splitDelimited(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!src) return [];
  const first = src.split('\n', 1)[0];
  const delim = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export const LIVING = /\bstill\s+living\b/i;

/**
 * Parse delimited text into graves (people with a WikiTree ID) and markers (headstones with a location but no profile,
 * such as unreadable or unmarked stones). Rows for living people are left out for privacy, silently.
 * Every issue has a `kind` so callers can group them ("266 rows on Album 1 have no coordinates").
 * @returns {{graves: object[], markers: object[], issues: {level:'error'|'warn'|'info', kind?:string, row?:number, wt?:string, msg:string}[], unknownColumns:string[]}}
 */
export function parseGraves(text) {
  const issues = [];
  const rows = splitDelimited(text);
  const fail = (msg) => ({ graves: [], markers: [], issues: [{ level: 'error', kind: 'structure', msg }], unknownColumns: [] });
  if (rows.length < 2) return fail('No data rows found. Include a header row plus at least one grave.');
  const headers = rows[0].map((h) => ALIASES[norm(h)] || null);
  const unknownColumns = rows[0].filter((_, i) => !headers[i]).map((h) => h.trim()).filter(Boolean);
  for (const need of ['lat', 'lon']) {
    if (!headers.includes(need)) return fail(`Missing required column for "${need === 'lat' ? 'Lat' : 'Long'}".`);
  }
  // Tables of unknown headstones have no WikiTree ID column, only locations and pictures.
  if (!headers.includes('wt') && !headers.includes('photo')) return fail('Missing required column for "WikiTree ID".');

  const graves = [], markers = [];
  const seen = new Map();
  const keyCount = new Map();
  rows.slice(1).forEach((cells, idx) => {
    const rowNo = idx + 2; // 1-based incl. header
    if (cells.some((c) => LIVING.test(c))) return; // privacy: living people are not listed or mapped
    const rec = {};
    headers.forEach((f, i) => { if (f) rec[f] = (cells[i] ?? '').trim(); });

    // ---- location (shared by people and markers) ----
    let lat = Number(rec.lat), lon = Number(rec.lon);
    const haveCoords = rec.lat !== '' && rec.lon !== '' && Number.isFinite(lat) && Number.isFinite(lon);
    let located = false;
    let wt = extractWikiTreeId(rec.wt);
    const note = (level, kind, msg) => issues.push({ level, kind, row: rowNo, ...(wt ? { wt } : {}), msg });
    if (haveCoords) {
      if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
        [lat, lon] = [lon, lat];
        note('info', 'swapped', 'Latitude/longitude looked swapped; corrected.');
      }
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
        note('warn', 'badcoords', `Coordinates out of range (${rec.lat}, ${rec.lon}); not plotted.`);
      } else located = true;
    }

    // Names and dates, when the table has them (for people with and without a WikiTree profile).
    const who = {};
    for (const k of ['given', 'surname', 'maiden']) if (rec[k]) who[k] = tidyName(rec[k]).slice(0, 120);
    for (const k of ['born', 'died']) if (rec[k]) who[k] = rec[k].slice(0, 40);

    // ---- no WikiTree ID ----
    if (!wt) {
      const named = !!(who.given || who.surname || who.maiden);
      if (named) {
        // A burial that has no profile yet: keep it, so it can be placed on the map and given an ID later.
        const fag = extractFindAGraveId(rec.fag);
        const slug = [who.given, who.surname, who.maiden, who.born, who.died, rec.plot].filter(Boolean).join('-').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
        const base = NO_ID_PREFIX + (fag ? `fag${fag}` : slug || 'row');
        const n = (keyCount.get(base) || 0) + 1;
        keyCount.set(base, n);
        const e = { wt: n > 1 ? `${base}~${n}` : base, ...who };
        if (fag) { e.fag = fag; if (!isFindAGraveId(fag)) note('warn', 'badfag', `Find a Grave ID "${fag}" is not a number.`); }
        const fs = extractFamilySearchId(rec.fs);
        if (fs) e.fs = fs;
        if (rec.photo) { e.photo = normalizePhotoRef(rec.photo) || rec.photo; if (!isHttpUrl(e.photo)) note('warn', 'badphoto', 'Headstone photo is not a valid http(s) URL.'); }
        for (const k of EXTRA) if (rec[k]) e[k] = rec[k];
        if (located) { e.lat = lat; e.lon = lon; } else if (!haveCoords) note('info', 'nocoords', 'No usable coordinates; listed but not plotted.');
        graves.push(e);
        return;
      }
      // A stone with a location but nobody named: an unknown headstone.
      if (located && (rec.photo || !headers.includes('wt'))) {
        const m = { lat, lon };
        if (rec.photo) m.photo = normalizePhotoRef(rec.photo) || rec.photo;
        for (const k of ['label', ...EXTRA]) if (rec[k]) m[k] = rec[k];
        markers.push(m);
      } else if (!haveCoords) note('info', headers.includes('wt') ? 'noid' : 'nocoords', headers.includes('wt') ? 'No WikiTree ID yet.' : 'No usable coordinates.');
      return;
    }

    if (!isWikiTreeId(wt)) note('warn', 'badid', `"${wt}" does not look like a WikiTree ID (Surname-123).`);
    if (seen.has(wt)) note('warn', 'dupid', `Duplicate WikiTree ID (also on row ${seen.get(wt)}); both kept.`);
    else seen.set(wt, rowNo);

    const g = { wt, ...who };
    const fag = extractFindAGraveId(rec.fag);
    if (fag) { g.fag = fag; if (!isFindAGraveId(fag)) note('warn', 'badfag', `Find a Grave ID "${fag}" is not a number.`); }
    const fs = extractFamilySearchId(rec.fs);
    if (fs) { g.fs = fs; if (!isFamilySearchId(fs)) note('warn', 'badfs', `FamilySearch ID "${fs}" is not in the XXXX-XXX form.`); }
    if (rec.photo) {
      g.photo = normalizePhotoRef(rec.photo) || rec.photo;
      if (!isHttpUrl(g.photo)) note('warn', 'badphoto', 'Headstone photo is not a valid http(s) URL.');
    }
    for (const k of EXTRA) if (rec[k]) g[k] = rec[k];
    if (located) { g.lat = lat; g.lon = lon; } else if (!haveCoords) note('info', 'nocoords', 'No usable coordinates; listed but not plotted.');
    graves.push(g);
  });
  return { graves, markers, issues, unknownColumns };
}
