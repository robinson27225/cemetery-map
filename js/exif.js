// Read GPS coordinates from a JPEG's EXIF block, entirely in the browser (the photo is never uploaded).

/** @returns {{lat:number, lon:number}|null} */
export function readGps(buffer) {
  const v = new DataView(buffer);
  if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  while (o + 4 < v.byteLength && v.getUint8(o) === 0xff) {
    const marker = v.getUint8(o + 1);
    const len = v.getUint16(o + 2);
    if (marker === 0xda) break; // start of image data
    if (marker === 0xe1 && v.getUint32(o + 4) === 0x45786966) return gpsFromTiff(v, o + 10, o + 2 + len);
    o += 2 + len;
  }
  return null;
}

function gpsFromTiff(v, t, end) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (p) => v.getUint16(p, le), u32 = (p) => v.getUint32(p, le);
  const inRange = (p, n) => p >= 0 && p + n <= end && p + n <= v.byteLength;
  const ifd0 = t + u32(t + 4);
  if (!inRange(ifd0, 2)) return null;
  let gpsPtr = null;
  for (let i = 0, n = u16(ifd0); i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (!inRange(e, 12)) return null;
    if (u16(e) === 0x8825) gpsPtr = u32(e + 8);
  }
  if (gpsPtr == null) return null;
  const gps = t + gpsPtr;
  if (!inRange(gps, 2)) return null;
  const tags = {};
  for (let i = 0, n = u16(gps); i < n; i++) {
    const e = gps + 2 + i * 12;
    if (!inRange(e, 12)) return null;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    if (type === 2 && count >= 1) tags[tag] = String.fromCharCode(v.getUint8(e + 8)); // ASCII ref, stored inline
    else if (type === 5 && count === 3) {
      const p = t + u32(e + 8);
      if (!inRange(p, 24)) return null;
      const r = (k) => { const d = u32(p + k * 8 + 4); return d ? u32(p + k * 8) / d : NaN; };
      tags[tag] = r(0) + r(1) / 60 + r(2) / 3600;
    }
  }
  const { 1: latRef, 2: lat, 3: lonRef, 4: lon } = tags;
  if (![lat, lon].every(Number.isFinite) || !latRef || !lonRef) return null;
  const out = { lat: (latRef === 'S' ? -1 : 1) * lat, lon: (lonRef === 'W' ? -1 : 1) * lon };
  if (Math.abs(out.lat) > 90 || Math.abs(out.lon) > 180 || (out.lat === 0 && out.lon === 0)) return null;
  return { lat: +out.lat.toFixed(6), lon: +out.lon.toFixed(6) };
}

/** Accept "36.904061, -104.423645", "36.904061 -104.423645", or the pair copied from a map app. */
export function parseLatLon(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
}
