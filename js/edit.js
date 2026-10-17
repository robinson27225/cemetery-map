// "Set location" panel: choose a headstone photo and place the grave for one burial, and give a burial that
// has no WikiTree profile yet its WikiTree ID.
import { h, displayName, lifeSpan } from './detail.js';
import { readGps, parseLatLon } from './exif.js';
import { normalizePhotoRef, photoUrlFromApi, thumbUrl, displayImageUrl, isAlbumLink } from './images.js';
import { distanceM } from './model.js';
import { isHttpUrl, hasProfile, extractWikiTreeId, isWikiTreeId } from './links.js';
import { hasDisplayName } from './people.js';

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 *  grave, mates (others on the same headstone), mapped (graves with coordinates), cemName, center,
 *  getPhotos ((wt)=>Promise|null), pick (map pin controller factory), onSave(change, {withMates}), onRemove(), onCancel(), say(msg)
 */
export function renderEdit(root, ctx) {
  const { grave: g } = ctx;
  let coords = g.lat != null ? { lat: g.lat, lon: g.lon } : null;
  let photo = g.photo || '';
  let pin = null;

  const noProfile = !hasProfile(g.wt);
  const title = h('h2', {}, `${noProfile ? 'Edit entry' : g.lat != null ? 'Edit location' : 'Set location'}: ${displayName(g)}`);
  const sub = h('p', { class: 'muted' }, [noProfile ? 'No WikiTree profile yet' : hasDisplayName(g) ? g.wt : null, lifeSpan(g)].filter(Boolean).join(' · '));

  // ---- WikiTree ID (only for a burial that has none yet) ---------------------------------
  const idInput = noProfile ? h('input', { type: 'text', id: 'ed-wtid', placeholder: 'e.g. Smith-1234', autocomplete: 'off', spellcheck: 'false' }) : null;
  const idNote = noProfile ? h('p', { class: 'muted', 'aria-live': 'polite' }, 'Once this person has a WikiTree profile, enter its ID so the row points to it.') : null;
  /** The ID typed, if it is usable ('' if empty or not valid). */
  const typedId = () => {
    if (!idInput) return '';
    const v = extractWikiTreeId(idInput.value);
    return v && isWikiTreeId(v) && !ctx.hasId(v) ? v : '';
  };
  function checkId() {
    if (!idInput) return;
    const raw = idInput.value.trim();
    const v = extractWikiTreeId(raw);
    if (!raw) idNote.textContent = 'Once this person has a WikiTree profile, enter its ID so the row points to it.';
    else if (!isWikiTreeId(v)) idNote.textContent = 'That doesn’t look like a WikiTree ID. It is the surname, a hyphen and a number, like Smith-1234 (a profile link works too).';
    else if (ctx.hasId(v)) idNote.textContent = `${v} is already on this map. If it is the same person, use that entry instead.`;
    else idNote.textContent = `This row will become ${v}.`;
    refreshSave();
  }
  idInput?.addEventListener('input', checkId);

  // ---- photo ------------------------------------------------------------------------
  const preview = h('div', { class: 'photo-preview', 'aria-live': 'polite' });
  const gallery = h('div', { class: 'gallery', role: 'group', 'aria-label': 'Photos on this profile' });
  const photoInput = h('input', { type: 'text', id: 'ed-photo', placeholder: 'Paste an image link (WikiTree or anywhere else)', autocomplete: 'off' });
  const photoNote = h('p', { class: 'muted' });

  function showPhoto() {
    preview.replaceChildren();
    if (!photo) return;
    if (isAlbumLink(photo)) { preview.append(h('div', { class: 'muted' }, 'This is an album link, so it opens as a link in the headstone details. ', h('a', { href: photo, target: '_blank', rel: 'noopener noreferrer' }, 'Open the album'))); return; }
    const img = h('img', { src: displayImageUrl(thumbUrl(photo, 500), 800), alt: 'Selected headstone photo', referrerpolicy: 'no-referrer', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(h('div', { class: 'broken' }, 'This image could not be shown here. ', h('a', { href: photo, target: '_blank', rel: 'noopener noreferrer' }, 'Open it directly'), ' to check the link.')));
    preview.append(img);
    for (const b of gallery.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.url === photo));
  }
  function setPhotoFromText() {
    const v = photoInput.value.trim();
    if (!v) { photoNote.textContent = ''; return; }
    // A WikiTree image (page link, photo.php link or file name) is normalised to its photo.php address;
    // an image stored anywhere else is used as the address it was pasted with.
    const url = normalizePhotoRef(v) || (isHttpUrl(v) ? v : '');
    if (url) { photo = url; photoNote.textContent = ''; showPhoto(); }
    else photoNote.textContent = 'Paste the image’s full web address (https://…), or the file name of a WikiTree image.';
  }
  photoInput.addEventListener('change', setPhotoFromText);

  const photoBox = h('div', { class: 'ed-section' }, h('h3', {}, 'Headstone photo'), gallery, preview,
    h('label', { for: 'ed-photo' }, 'Another image'), photoInput, photoNote);
  if (ctx.getPhotos) {
    gallery.append(h('span', { class: 'muted gallery-msg' }, 'Loading this profile’s photos…'));
    ctx.getPhotos(g.wt).then((photos) => {
      gallery.replaceChildren();
      if (!photos.length) { gallery.append(h('span', { class: 'muted gallery-msg' }, 'This profile has no photos yet. Upload one on WikiTree, then paste its link below.')); return; }
      const here = (p) => ctx.cemName && p.location && p.location.toLowerCase().includes(ctx.cemName.toLowerCase().split(',')[0]);
      for (const p of [...photos].sort((a, b) => Number(!!here(b)) - Number(!!here(a)))) {
        const url = photoUrlFromApi({ ImageName: p.name, URL_300: p.urlPath });
        gallery.append(h('button', {
          type: 'button', class: 'thumb', 'data-url': url, 'aria-pressed': String(url === photo),
          title: [p.title, p.date, p.location].filter(Boolean).join(' · '),
          onclick: () => { photo = url; photoInput.value = ''; photoNote.textContent = ''; showPhoto(); },
        }, h('img', { src: p.thumb, alt: p.title || p.name, loading: 'lazy', referrerpolicy: 'no-referrer' }),
        h('span', {}, p.title || p.name), here(p) ? h('em', {}, 'at this cemetery') : null));
      }
      if (!photo && photos.length === 1) { photo = photoUrlFromApi({ ImageName: photos[0].name, URL_300: photos[0].urlPath }); }
      showPhoto();
    }).catch(() => {
      gallery.replaceChildren(h('span', { class: 'muted gallery-msg' }, 'Photo lists can only be loaded when this app is opened from wikitree.com. Paste the image’s link below instead.'));
    });
  } else {
    gallery.append(h('span', { class: 'muted gallery-msg' }, noProfile
      ? 'This burial has no WikiTree profile yet, so there are no WikiTree photos to choose from. Paste the image’s link below.'
      : 'Photo lists can only be loaded when this app is opened from wikitree.com. Paste the image’s link below instead.'));
  }

  // ---- location ---------------------------------------------------------------------
  const readout = h('p', { class: 'muted', 'aria-live': 'polite' });
  const latlon = h('input', { type: 'text', id: 'ed-latlon', inputmode: 'decimal', placeholder: 'Latitude, longitude  e.g. 36.904061, -104.423645', autocomplete: 'off' });
  const save = h('button', { type: 'button', disabled: true, onclick: () => submit() }, 'Save');
  const refreshSave = () => { save.disabled = !(coords || typedId()); };

  function setCoords(c, { fromPin = false, note = '' } = {}) {
    coords = c;
    latlon.value = c ? `${c.lat}, ${c.lon}` : '';
    if (c && !fromPin) pin.move(c.lat, c.lon);
    const far = c && ctx.mapped.length ? Math.min(...ctx.mapped.map((m) => distanceM(c, m))) : 0;
    readout.textContent = c
      ? [note, far > 500 ? `⚠ ${(far / 1000).toFixed(1)} km from the nearest mapped grave. Check it.` : 'Drag the pin or click the map to adjust.'].filter(Boolean).join(' ')
      : 'Click the map to drop the pin, or use one of the options above.';
    refreshSave();
  }
  latlon.addEventListener('change', () => {
    const c = parseLatLon(latlon.value);
    if (c) setCoords(c); else { readout.textContent = 'Enter two numbers: latitude then longitude.'; coords = null; refreshSave(); }
  });

  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/*', hidden: true });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const c = readGps(await f.arrayBuffer());
    if (c) setCoords(c, { note: 'Location read from the photo (it was not uploaded anywhere).' });
    else ctx.say('No GPS location in that photo. Phones leave it out when location is off or when the camera is opened from a web page. Use your current location or click the map.');
    fileInput.value = '';
  });
  const geo = h('button', { type: 'button', class: 'secondary', onclick: () => {
    if (!navigator.geolocation) { ctx.say('This browser can’t share your location.'); return; }
    geo.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (p) => { geo.disabled = false; setCoords({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6) }, { note: `Your location, accurate to about ${Math.round(p.coords.accuracy)} m.` }); },
      () => { geo.disabled = false; ctx.say('Couldn’t get your location. Check the browser’s location permission.'); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  } }, 'Use my location');

  const sameAs = ctx.mapped.length ? h('select', { 'aria-label': 'Same headstone as', onchange: (e) => {
    const m = ctx.mapped.find((x) => x.wt === e.target.value);
    if (!m) return;
    setCoords({ lat: m.lat, lon: m.lon }, { note: `Same spot as ${displayName(m)}.` });
    if (m.photo) { photo = m.photo; photoInput.value = ''; showPhoto(); }
    e.target.value = '';
  } }, h('option', { value: '' }, 'Same headstone as…'),
  ...[...ctx.mapped].sort((a, b) => displayName(a).localeCompare(displayName(b))).map((m) => h('option', { value: m.wt }, `${displayName(m)}${m.wt !== displayName(m) ? ` (${m.wt})` : ''}`))) : null;

  const locBox = h('div', { class: 'ed-section' }, h('h3', {}, 'Location'),
    h('div', { class: 'ed-row' }, geo, h('button', { type: 'button', class: 'secondary', onclick: () => fileInput.click() }, 'Read from a photo file…'), fileInput, sameAs),
    h('label', { for: 'ed-latlon' }, 'Coordinates'), latlon, readout);

  // ---- mates + actions ------------------------------------------------------------------
  const withMates = ctx.mates.length ? h('input', { type: 'checkbox', id: 'ed-mates', checked: true }) : null;
  const matesRow = withMates ? h('label', { class: 'check', for: 'ed-mates' }, withMates,
    `Also apply to the ${ctx.mates.length} other ${ctx.mates.length === 1 ? 'person' : 'people'} on this headstone (${ctx.mates.map(displayName).join(', ')})`) : null;

  function finish() { pin?.stop(); }
  function submit() {
    const assignWt = typedId();
    if (!coords && !assignWt) return;
    setPhotoFromText();
    finish();
    ctx.onSave({ ...(coords ? { lat: coords.lat, lon: coords.lon } : {}), ...(photo ? { photo } : {}), ...(assignWt ? { assignWt } : {}) }, { withMates: !!withMates?.checked && !!coords });
  }
  const actions = h('div', { class: 'ed-actions' }, save,
    h('button', { type: 'button', class: 'secondary', onclick: () => { finish(); ctx.onCancel(); } }, 'Cancel'),
    g.lat != null ? h('button', { type: 'button', class: 'link-btn danger', onclick: () => { finish(); ctx.onRemove(); } }, 'Remove location') : null);

  root.replaceChildren(...[h('button', { class: 'close secondary', type: 'button', 'aria-label': 'Cancel editing', onclick: () => { finish(); ctx.onCancel(); } }, '×'),
    title, sub, noProfile ? h('div', { class: 'ed-section' }, h('h3', {}, 'WikiTree ID'), h('label', { for: 'ed-wtid' }, 'WikiTree ID (when there is one)'), idInput, idNote) : null, photoBox, locBox, matesRow, actions,
    h('p', { class: 'muted' }, 'Saved on this device first. Use Publish to share it on WikiTree.')].filter(Boolean));
  root.hidden = false;

  pin = ctx.pick({ lat: g.lat, lon: g.lon }, (c) => setCoords(c, { fromPin: true }));
  if (ctx.focus === 'id' && idInput) setTimeout(() => { idInput.scrollIntoView({ block: 'center' }); idInput.focus(); }, 0);
  setCoords(coords, { fromPin: true });
  showPhoto();
  return { stop: finish };
}
