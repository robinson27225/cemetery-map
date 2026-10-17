// "Find a cemetery" dialog: browse WikiTree's own place hierarchy (continent > country > state > county),
// or search by name/town when the optional directory/ files are installed (see js/directory.js).
import { h } from './detail.js';
import { nameOf, placeOf, plainCategory } from './directory.js';
import { mergeReadyMade } from './plotting.js';

const fmt = (n) => n.toLocaleString('en-US');
const LIVE_FOOT = 'Read live from WikiTree and WikiTree+. Searching by name needs the optional directory files, so browse by place.';
const STATIC_FOOT = 'Cemeteries are WikiTree’s own cemetery categories, listed by WikiTree+. Start from a continent and narrow down, or search.';

/**
 * @param {{dlg:HTMLDialogElement, directory:ReturnType<import('./directory.js').createDirectory>,
 *   registered:()=>{id:string,name:string,location?:string,wikitree?:{category?:string}}[],
 *   discovered?:()=>Promise<{category:string,name:string,location:string}[]>,
 *   onRegistered:(id:string)=>void, onRecord:(rec:any[])=>void}} o
 */
export function initPicker({ dlg, directory, registered, discovered = async () => [], onRegistered, onRecord }) {
  const $ = (id) => dlg.querySelector(`#${id}`);
  const q = $('pk-q'), crumbs = $('pk-crumbs'), list = $('pk-list'), msg = $('pk-msg'), filter = $('pk-filter'), foot = $('pk-foot');
  let node = 0;
  let mapped = new Set();
  let found = []; // cemeteries found through the Plotting_Pages category (when WikiTree can be read from here)
  let timer;

  const isMapped = (rec) => mapped.has(rec[0]);
  const close = () => dlg.close();
  const pickRecord = (rec) => { close(); onRecord(rec); };

  function cemeteryRow(rec) {
    return h('li', {}, h('button', { type: 'button', class: 'pk-row', onclick: () => pickRecord(rec) },
      h('span', { class: 'pk-main' }, nameOf(rec[0])),
      h('span', { class: 'pk-sub' }, [placeOf(rec[0]), `${fmt(rec[1])} ${rec[1] === 1 ? 'profile' : 'profiles'}`].filter(Boolean).join(' · ')),
      isMapped(rec) ? h('span', { class: 'badge ok' }, 'map ready') : rec[4] ? h('span', { class: 'badge' }, 'has Space page') : null));
  }

  function registeredRows() {
    const rows = mergeReadyMade(registered(), found);
    if (!rows.length) return [];
    return [h('li', { class: 'pk-head' }, 'Ready-made maps'),
      ...rows.map((c) => h('li', {}, h('button', { type: 'button', class: 'pk-row', onclick: () => { close(); if (c.id) onRegistered(c.id); else onRecord([c.category, 0, null, null]); } },
        h('span', { class: 'pk-main' }, c.name), h('span', { class: 'pk-sub' }, c.location || ''), h('span', { class: 'badge ok' }, 'map ready'))))];
  }

  async function browse(idx, { keepFilter = false } = {}) {
    node = idx;
    q.value = '';
    if (!keepFilter) filter.value = '';
    let t;
    try { t = await directory.tree(); } catch {
      crumbs.replaceChildren();
      filter.hidden = true;
      msg.textContent = 'Couldn’t load the list of places from WikiTree+. Pick a ready-made map below, or use Import data.';
      list.replaceChildren(...registeredRows());
      return;
    }
    if (node !== idx) return;
    const live = t.mode === 'live';
    foot.textContent = live ? LIVE_FOOT : STATIC_FOOT;
    const path = await directory.pathTo(idx);
    crumbs.replaceChildren(...path.flatMap((i, n) => {
      const last = n === path.length - 1;
      return [n ? h('span', { 'aria-hidden': 'true' }, ' › ') : null,
        last ? h('b', { 'aria-current': 'page' }, t.nodes[i][0])
          : h('button', { type: 'button', class: 'link-btn', onclick: () => browse(i) }, t.nodes[i][0])];
    }).filter(Boolean));
    const rows = [];
    if (idx === 0) rows.push(...registeredRows());
    const kids = t.kids[idx];
    if (kids.length) {
      rows.push(h('li', { class: 'pk-head' }, idx === 0 ? 'Choose a continent' : 'Choose a place'));
      for (const k of kids) {
        const count = t.nodes[k][3];
        rows.push(h('li', {}, h('button', { type: 'button', class: 'pk-row', onclick: () => browse(k) },
          h('span', { class: 'pk-main' }, t.nodes[k][0]),
          live ? null : h('span', { class: 'pk-sub' }, `${fmt(count)} ${count === 1 ? 'cemetery' : 'cemeteries'}`),
          h('span', { class: 'pk-go', 'aria-hidden': 'true' }, '›'))));
      }
    }
    msg.textContent = '';
    filter.hidden = true;
    // Static files know how many cemeteries sit directly under a place; live, we have to ask the place's page.
    const hasList = idx > 0 && (live || t.nodes[idx][2] > 0);
    if (!hasList) { list.replaceChildren(...rows); return; }
    const head = h('li', { class: 'pk-head' }, live ? 'Cemeteries here' : `Cemeteries here (${fmt(t.nodes[idx][2])})`);
    const holder = h('li', { class: 'pk-loading' }, 'Loading…');
    list.replaceChildren(...rows, head, holder);
    try {
      const { records, note, url } = await directory.cemeteriesAt(idx);
      if (node !== idx) return;
      if (live && !records.length) { head.remove(); holder.remove(); return; }
      if (live) head.textContent = `Cemeteries here (${fmt(records.length)})`;
      filter.hidden = records.length < 25;
      const wanted = filter.value.trim().toLowerCase();
      const shown = records.filter((r) => !wanted || r[0].toLowerCase().includes(wanted));
      holder.replaceWith(...shown.slice(0, 400).map(cemeteryRow));
      if (shown.length > 400) list.append(h('li', { class: 'pk-head' }, 'Showing the 400 with the most profiles. Use the filter to find others.'));
      if (note) list.append(h('li', { class: 'pk-loading' }, note, ' ', url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on WikiTree') : null));
    } catch (e) {
      if (node !== idx) return;
      holder.replaceChildren(e.message === 'blocked'
        ? 'WikiTree didn’t return this place’s list. These lists are read live from WikiTree, so they load when the app is opened from wikitree.com, and WikiTree may refuse requests for a minute if it is busy. Try again shortly.'
        : 'Could not load this list.');
    }
  }

  async function search(text) {
    crumbs.replaceChildren(h('button', { type: 'button', class: 'link-btn', onclick: () => browse(0) }, '← Browse by place'));
    filter.hidden = true;
    msg.textContent = 'Searching…';
    let hits;
    try { hits = await directory.search(text); } catch { hits = []; }
    if (q.value.trim() !== text) return; // a newer search is running
    if (hits === null) {
      msg.textContent = 'Searching by name needs the optional directory files, which this copy of the app doesn’t have. Browse by place instead.';
      list.replaceChildren();
      return;
    }
    msg.textContent = hits.length ? '' : 'No cemeteries found. Start with the first word of its name or its town, or browse by place.';
    list.replaceChildren(...hits.map(cemeteryRow));
  }

  q.addEventListener('input', () => {
    clearTimeout(timer);
    const text = q.value.trim();
    if (text.length < 2) { if (!text) browse(node); return; }
    timer = setTimeout(() => search(text), 200);
  });
  filter.addEventListener('input', () => browse(node, { keepFilter: true }));

  return {
    open() {
      const refreshMapped = () => {
        mapped = new Set([...registered().map((c) => c.wikitree?.category && plainCategory(c.wikitree.category)), ...found.map((d) => d.category)].filter(Boolean));
      };
      refreshMapped();
      dlg.showModal();
      browse(node === 0 || !q.value ? node : 0);
      q.focus();
      // Cemeteries with plotting pages are read from WikiTree in the background and added when they arrive.
      discovered().then((list) => {
        found = list || [];
        refreshMapped();
        if (dlg.open && node === 0 && !q.value.trim()) browse(0);
      }).catch(() => {});
    },
  };
}
