// Side/bottom panel for one headstone. Built with DOM APIs (no innerHTML) because the data is user-supplied.
import { wikiTreeUrl, findAGraveUrl, familySearchUrl, googleMapsUrl, isHttpUrl, hasProfile } from './links.js';
import { displayName, lifeSpan, hasDisplayName } from './people.js';
import { imagePageUrl, displayImageUrl, pageLinkKind } from './images.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}

const ext = (href, text, title) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', title }, text);

export { displayName, lifeSpan };

/** Where a burial is, as the table says: section, plot, row, monument heading and reference. */
const where = (g) => [g.section && `Section ${g.section}`, g.plot && `Plot ${g.plot}`, g.row && `Row ${g.row}`, g.monument && `Monument ${g.monument}`, g.reference && `Reference ${g.reference}`].filter(Boolean).join(', ');

export function renderDetail(root, plot, { onClose, onCopy, onLayout, onEdit }) {
  root.replaceChildren();
  const people = plot.members.filter((m) => !m.marker);
  const unknown = plot.members.filter((m) => m.marker);
  const names = people.map(displayName);
  const title = names.length ? (names.length > 2 ? `${names[0]} and ${names.length - 1} others` : names.join(' & ')) : (unknown.length > 1 ? `${unknown.length} unknown headstones` : `Unknown headstone${unknown[0]?.label ? ` ${unknown[0].label}` : ''}`);
  root.append(
    h('button', { class: 'close secondary', type: 'button', 'aria-label': 'Close details', onclick: onClose }, '×'),
    h('h2', {}, title),
    ...(plot.label ? [h('p', { class: 'muted plot-ref' }, `${plot.labelKind || 'Plot'} ${plot.label}`)] : []),
  );

  const photos = plot.photos.filter(isHttpUrl);
  if (photos.length) {
    root.append(h('div', { class: 'photos' }, photos.map((src) => {
      const kind = pageLinkKind(src);
      if (kind) return h('div', { class: 'album-link' }, ext(src, kind === 'photo' ? 'Open the photo' : 'Open the photo album'), kind === 'photo' ? ' (opens in Google Photos, with zoom)' : ' (all the photos for this headstone)');
      const img = h('img', { src: displayImageUrl(src), loading: 'lazy', alt: `Headstone photo for ${names.length ? names.join(', ') : 'an unknown headstone'}`, referrerpolicy: 'no-referrer' });
      const link = h('a', { href: src, target: '_blank', rel: 'noopener noreferrer', title: 'Open full-size photo' }, img);
      img.addEventListener('load', () => onLayout?.());
      img.addEventListener('error', () => { link.replaceWith(h('div', { class: 'broken' }, 'Photo could not be loaded. ', ext(src, 'Open it directly'))); onLayout?.(); });
      return link;
    })));
  }

  for (const g of unknown) {
    const page = imagePageUrl(g.photo);
    root.append(h('div', { class: 'person' },
      h('h3', {}, `Unknown headstone${g.label ? ` ${g.label}` : ''}`),
      h('div', { class: 'dates' }, [g.section && `Section ${g.section}`, 'No profile yet: the stone is unreadable or marked unknown'].filter(Boolean).join(' · ')),
      page ? h('div', { class: 'chips' }, ext(page, 'Image page', 'The WikiTree page for this photo')) : null));
  }
  for (const g of people) {
    const chips = hasProfile(g.wt) ? [ext(wikiTreeUrl(g.wt), 'WikiTree', `Open ${g.wt} on WikiTree`)] : [];
    if (g.fag) chips.push(ext(findAGraveUrl(g.fag), 'Find a Grave', `Memorial ${g.fag}`));
    if (g.fs) chips.push(ext(familySearchUrl(g.fs), 'FamilySearch', `Person ${g.fs}`));
    root.append(h('div', { class: 'person' },
      h('h3', {}, hasProfile(g.wt) ? h('a', { href: wikiTreeUrl(g.wt), target: '_blank', rel: 'noopener noreferrer', title: `Open ${g.wt} on WikiTree` }, displayName(g)) : displayName(g)),
      h('div', { class: 'dates' }, [hasProfile(g.wt) ? (hasDisplayName(g) ? g.wt : null) : 'No WikiTree profile yet', lifeSpan(g)].filter(Boolean).join(' · ')),
      g.deathPlace ? h('div', { class: 'dates' }, `Died: ${g.deathPlace}`) : null,
      where(g) ? h('div', { class: 'dates' }, where(g)) : null,
      g.notes && g.notes !== plot.label ? h('div', { class: 'dates' }, g.notes) : null,
      h('div', { class: 'chips' }, chips),
      h('div', { class: 'person-actions' },
        hasProfile(g.wt) ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => onEdit?.(g.wt, { focus: 'id' }) }, 'Identify: add WikiTree ID'),
        h('button', { type: 'button', class: 'link-btn', onclick: () => onEdit?.(g.wt) }, hasProfile(g.wt) ? 'Edit location or photo' : 'Locate: add location or photo'),
        g._edited ? h('span', { class: 'badge', title: 'Saved on this device only. Publish it to share.' }, 'unpublished change') : null),
    ));
  }

  if (plot.lat == null) {
    root.append(h('div', { class: 'coords' }, h('span', {}, 'No location yet')));
    root.hidden = false;
    return;
  }
  const coord = `${plot.lat.toFixed(6)}, ${plot.lon.toFixed(6)}`;
  root.append(h('div', { class: 'coords' },
    h('span', {}, coord),
    h('button', { type: 'button', class: 'link-btn', onclick: () => onCopy(coord) }, 'Copy'),
    ext(googleMapsUrl(plot.lat.toFixed(6), plot.lon.toFixed(6)), 'Directions'),
  ));
  root.hidden = false;
}
