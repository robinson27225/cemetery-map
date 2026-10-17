// Turn the many ways a WikiTree image gets referenced into the one URL we store:
//   https://www.wikitree.com/photo.php/c/cf/Tapia-408.jpg
import { md5 } from './md5.js';

const WT = 'https://www.wikitree.com';

export function photoUrlForName(name) {
  const file = name.trim().replace(/^(Image|File):/i, '').replace(/ /g, '_');
  const h = md5(file);
  return `${WT}/photo.php/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(file).replace(/%2C/g, ',')}`;
}

/** @returns {string} canonical URL, or '' if the input isn't recognisably a WikiTree image. */
export function normalizePhotoRef(input) {
  const v = String(input ?? '').trim();
  if (!v) return '';
  // Full-size, thumbnail, or site-relative photo.php URLs.
  const direct = /(?:wikitree\.com)?\/photo\.php\/(?:thumb\/)?([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+?\.[A-Za-z0-9]+)(?:\/[^?#]*)?(?:[?#].*)?$/i.exec(v);
  if (direct) return `${WT}/photo.php/${direct[1].toLowerCase()}/${direct[2].toLowerCase()}/${direct[3]}`;
  // Image page: /photo/jpg/Name  (WikiTree names the extension in the path)
  const page = /wikitree\.com\/photo\/([A-Za-z0-9]+)\/([^/?#]+)/i.exec(v);
  if (page) return photoUrlForName(`${decodeURIComponent(page[2])}.${page[1].toLowerCase()}`);
  // Image: wiki page, or a bare file name.
  const wiki = /wikitree\.com\/wiki\/(?:Image|File):([^?#]+)/i.exec(v);
  const name = wiki ? decodeURIComponent(wiki[1]) : /^(?:Image:|File:)?[^/\\?#:]+\.(?:jpe?g|png|gif|webp)$/i.test(v) ? v : '';
  return name ? photoUrlForName(name) : '';
}

/** From a getPhotos entry (its URL_300 thumbnail path carries the hash directory). */
export function photoUrlFromApi(p) {
  return normalizePhotoRef(p.URL_300 || p.URL_75 || '') || (p.ImageName ? photoUrlForName(p.ImageName) : '');
}
export const thumbUrl = (full, px = 300) => {
  const m = /\/photo\.php\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/i.exec(full);
  return m ? `${WT}/photo.php/thumb/${m[1]}/${m[2]}/${px}px-${m[2]}` : full;
};

/** The WikiTree page that describes a stored photo URL (where its title, date and location can be checked). */
export function imagePageUrl(photoUrl) {
  const m = /\/photo\.php\/[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+?)\.([A-Za-z0-9]+)$/i.exec(String(photoUrl || ''));
  return m ? `${WT}/photo/${m[2].toLowerCase()}/${m[1]}` : '';
}

/**
 * The address to put in an <img> for a stored photo link. Most links are used as they are; a Google Drive "share" link
 * (https://drive.google.com/file/d/<id>/view) is a web page, not a picture, so it is swapped for Drive's picture address
 * for the same file. The table keeps the original link, and the file must be shared so that anyone with the link can view it.
 */
/**
 * A Google Photos or Drive link that is a web page, not a picture: an album (or Drive folder), or one photo in a share
 * (photos.google.com/share/<album>/photo/<id>). Google gives no picture address for either, so they can't be shown as an
 * image; they are offered as links that open Google's own viewer, with every photo and zoom. Returns 'album', 'photo' or ''.
 */
export function pageLinkKind(url) {
  const u = String(url || '');
  if (/^https?:\/\/photos\.google\.com\/share\/[^?#]*\/photo\//i.test(u)) return 'photo';
  if (/^https?:\/\/(photos\.app\.goo\.gl\/|photos\.google\.com\/(share|album)\/|(www\.)?google\.com\/photos\/|drive\.google\.com\/drive\/folders\/)/i.test(u)) return 'album';
  return '';
}
export const isAlbumLink = (url) => !!pageLinkKind(url);

export function displayImageUrl(url, px = 1600) {
  const m = /^https?:\/\/drive\.google\.com\/(?:file\/d\/|(?:open|uc)\?(?:[^#]*&)?id=)([\w-]{10,})/i.exec(String(url || ''));
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w${px}` : url;
}
