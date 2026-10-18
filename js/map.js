// Leaflet map: base layers, clustered headstone markers, plot-map overlay, legend.
/* global L */
import { isHttpUrl } from './links.js';
import { displayName } from './people.js';

const PEOPLE_STEPS = [
  { min: 1, color: '#2f7d32', label: '1 person' },
  { min: 2, color: '#b8860b', label: '2 people' },
  { min: 3, color: '#c4561b', label: '3–4 people' },
  { min: 5, color: '#7b3fa0', label: '5 or more' },
];
const LINK_STEPS = [
  { color: '#2f7d32', label: 'Photo + Find a Grave + FamilySearch' },
  { color: '#b8860b', label: 'Some links missing' },
  { color: '#8a8f85', label: 'No photo and no links' },
];

export const UNKNOWN_COLOR = '#6b7280';
export function plotColor(plot, mode) {
  if (plot.members.every((m) => m.marker)) return UNKNOWN_COLOR;
  if (mode === 'links') {
    const m = plot.members.filter((x) => !x.marker);
    const full = plot.photos.length && m.every((g) => g.fag && g.fs);
    const none = !plot.photos.length && m.every((g) => !g.fag && !g.fs);
    return full ? LINK_STEPS[0].color : none ? LINK_STEPS[2].color : LINK_STEPS[1].color;
  }
  const n = plot.members.filter((x) => !x.marker).length || 1;
  return [...PEOPLE_STEPS].reverse().find((s) => n >= s.min).color;
}

export function createMap(el, { onSelect, onViewChange }) {
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxNativeZoom: 19, maxZoom: 22,
    attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  });
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxNativeZoom: 19, maxZoom: 22,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  const map = L.map(el, { layers: [esri], maxZoom: 22, zoomControl: true }).setView([39, -98], 4);
  // Data courtesy of WikiTree, credited in the attribution and with the logo (as on the WikiTree Maps cemetery map).
  map.attributionControl.addAttribution('<a href="https://www.wikitree.com" target="_blank" rel="noopener noreferrer" title="Data courtesy of WikiTree">© WikiTree contributors</a>');
  const brand = L.control({ position: 'bottomleft' });
  brand.onAdd = () => {
    const a = L.DomUtil.create('a', 'wt-logo');
    a.href = 'https://www.wikitree.com';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'WikiTree: Where genealogists collaborate';
    const img = L.DomUtil.create('img', '', a);
    img.src = 'https://www.wikitree.com/images/wikitree-logo-tagline.png';
    img.alt = 'WikiTree. Where genealogists collaborate';
    img.addEventListener('error', () => a.remove()); // never leave a broken image on the map
    L.DomEvent.disableClickPropagation(a);
    return a;
  };
  brand.addTo(map); // added first, so it stays at the very bottom with the legend above it
  const layersCtl = L.control.layers({ Satellite: esri, Streets: osm }, {}, { position: 'topright' }).addTo(map);

  const cluster = L.markerClusterGroup({
    maxClusterRadius: 36, spiderfyOnMaxZoom: true, showCoverageOnHover: false,
    disableClusteringAtZoom: 21, zoomToBoundsOnClick: true,
  }).addTo(map);

  // The default view: a dot per ready-made cemetery with its number of rows; dots that are close together merge, adding up their rows.
  const dotIcon = (count) => L.divIcon({
    className: 'ov-wrap', iconSize: [40, 40],
    html: `<div class="ov-dot${count == null ? ' ov-unknown' : ''}"><span>${count == null ? '' : count.toLocaleString()}</span></div>`,
  });
  const overview = L.markerClusterGroup({
    maxClusterRadius: 50, showCoverageOnHover: false, zoomToBoundsOnClick: true,
    iconCreateFunction: (c) => {
      const kids = c.getAllChildMarkers();
      return dotIcon(kids.some((k) => k.options.count == null) ? null : kids.reduce((s, k) => s + k.options.count, 0));
    },
  });
  /** items: [{lat, lon, count|null (rows), profiles?, name, location, onOpen}] */
  function setOverview(items, { fit = true } = {}) {
    overview.clearLayers();
    for (const it of items) {
      const m = L.marker([it.lat, it.lon], { icon: dotIcon(it.count), count: it.count, title: it.name, keyboard: true });
      const box = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = it.name;
      const sub = document.createElement('div'); sub.className = 'muted'; sub.textContent = [it.location, it.count != null ? `${it.count.toLocaleString()} ${it.count === 1 ? 'row' : 'rows'}` : it.profiles ? `${it.profiles.toLocaleString()} ${it.profiles === 1 ? 'profile' : 'profiles'}` : ''].filter(Boolean).join(' · ');
      const go = document.createElement('button'); go.type = 'button'; go.textContent = 'Open this map'; go.addEventListener('click', () => it.onOpen());
      box.append(name, sub, go);
      m.bindPopup(box);
      overview.addLayer(m);
    }
    if (!map.hasLayer(overview)) overview.addTo(map);
    if (fit && items.length) map.fitBounds(L.latLngBounds(items.map((i) => [i.lat, i.lon])).pad(0.3), { maxZoom: 9 });
  }
  const clearOverview = () => { overview.clearLayers(); if (map.hasLayer(overview)) map.removeLayer(overview); };

  let markers = new Map();
  let selected = null;
  let mode = 'people';
  let legend;

  const iconFor = (plot, sel) => L.divIcon({
    className: '',
    html: `<div class="pin${sel ? ' sel' : ''}" style="background:${plotColor(plot, mode)}"><span>${plot.members.length > 1 ? plot.members.length : ''}</span></div>`,
    iconSize: [26, 26], iconAnchor: [4, 26],
  });

  function refreshIcon(key) {
    const m = markers.get(key);
    if (m) m.setIcon(iconFor(m.plot, key === selected));
  }

  function drawLegend() {
    legend?.remove();
    legend = L.control({ position: 'bottomleft' });
    legend.onAdd = () => {
      const d = L.DomUtil.create('div', 'legend');
      const steps = [...(mode === 'links' ? LINK_STEPS : PEOPLE_STEPS), { color: UNKNOWN_COLOR, label: 'Unknown headstone' }];
      for (const s of steps) {
        const i = document.createElement('i');
        i.style.background = s.color;
        d.append(i, s.label, document.createElement('br'));
      }
      return d;
    };
    legend.addTo(map);
  }

  function setPlots(plots, { fit = true, keepView = false, fitTo = null } = {}) {
    cluster.clearLayers();
    markers = new Map();
    for (const p of plots) {
      const m = L.marker([p.lat, p.lon], { icon: iconFor(p, false), title: p.members.map((g) => (g.marker ? 'Unknown headstone' : displayName(g))).join(', '), keyboard: true, riseOnHover: true });
      m.plot = p;
      // The plot number (or reference) sits beside the pin once the map is zoomed in far enough to read it.
      if (p.label) m.bindTooltip(p.label, { permanent: true, direction: 'right', offset: [12, -13], className: 'plot-label', opacity: 1 });
      m.on('click', () => onSelect(p.key));
      markers.set(p.key, m);
      cluster.addLayer(m);
    }
    selected = null;
    drawLegend();
    if (fit && !keepView && plots.length) {
      map.fitBounds(L.latLngBounds((fitTo?.length ? fitTo : plots).map((p) => [p.lat, p.lon])).pad(0.25), { maxZoom: 20 });
    }
  }

  function select(key, { fly = true, offset = [0, 0] } = {}) {
    const prev = selected;
    selected = key;
    if (prev) refreshIcon(prev);
    if (!key) return;
    refreshIcon(key);
    const m = markers.get(key);
    if (m && fly) {
      cluster.zoomToShowLayer(m, () => {
        // `offset` (px) shifts the view centre so the marker clears an overlaid detail panel.
        const z = Math.max(map.getZoom(), 20);
        const centre = map.unproject(map.project(m.getLatLng(), z).add(offset), z);
        map.flyTo(centre, z, { duration: 0.6 });
      });
    }
  }

  /** Re-centre on a plot at the current zoom, shifted by `offset` px (used when the panel's size changes). */
  function reveal(key, offset) {
    const m = markers.get(key);
    if (!m || m !== markers.get(selected) || !map.getBounds().contains(m.getLatLng())) return;
    const z = map.getZoom();
    map.panTo(map.unproject(map.project(m.getLatLng(), z).add(offset), z), { animate: true, duration: 0.3 });
  }

  function setMode(next) {
    mode = next;
    for (const key of markers.keys()) refreshIcon(key);
    drawLegend();
  }

  // ---- overlay (image + GeoJSON) --------------------------------------------------
  let imageLayer = null, geoLayer = null;
  function setOverlay(overlay) {
    imageLayer && (layersCtl.removeLayer(imageLayer), map.removeLayer(imageLayer), imageLayer = null);
    geoLayer && (layersCtl.removeLayer(geoLayer), map.removeLayer(geoLayer), geoLayer = null);
    if (!overlay) return;
    const img = overlay.image;
    if (img && (img.url?.startsWith('data:image/') || isHttpUrl(img.url)) && Array.isArray(img.bounds)) {
      imageLayer = L.imageOverlay(img.url, img.bounds, { opacity: img.opacity ?? 0.7, interactive: false, zIndex: 5 }).addTo(map);
      layersCtl.addOverlay(imageLayer, 'Plot map');
    }
    if (overlay.geojson) {
      geoLayer = L.geoJSON(overlay.geojson, {
        style: { color: '#ffd400', weight: 2, fillOpacity: 0.08 },
        pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#fff', fillColor: '#ffd400', fillOpacity: 1, weight: 2 }),
        onEachFeature: (f, layer) => {
          const label = f.properties?.name || f.properties?.title;
          if (label) layer.bindTooltip(String(label), { permanent: f.geometry?.type !== 'Point' ? false : true, direction: 'top' });
        },
      }).addTo(map);
      layersCtl.addOverlay(geoLayer, 'Sections & landmarks');
    }
  }

  // ---- location picker: one draggable pin; clicking the map moves it -------------------
  let pin = null, pinClick = null;
  function stopPick() {
    if (pin) { pin.remove(); pin = null; }
    if (pinClick) { map.off('click', pinClick); pinClick = null; }
  }
  /** The pin appears when there is a position (existing location, typed coordinates) or on the first map click. */
  function startPick(initial, onChange) {
    stopPick();
    const emit = () => { const ll = pin.getLatLng(); onChange({ lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) }); };
    const place = (ll) => {
      if (pin) { pin.setLatLng(ll); return; }
      pin = L.marker(ll, {
        draggable: true, zIndexOffset: 5000, keyboard: true, title: 'Drag to the headstone',
        icon: L.divIcon({ className: '', html: '<div class="pin pick"><span>+</span></div>', iconSize: [26, 26], iconAnchor: [4, 26] }),
      }).addTo(map);
      pin.on('dragend', emit);
    };
    pinClick = (e) => { place(e.latlng); emit(); };
    map.on('click', pinClick);
    if (initial.lat != null) { place(L.latLng(initial.lat, initial.lon)); map.setView([initial.lat, initial.lon], Math.max(map.getZoom(), 20)); }
    return {
      move(lat, lon) { place(L.latLng(lat, lon)); if (!map.getBounds().pad(-0.2).contains([lat, lon])) map.panTo([lat, lon]); },
      stop: stopPick,
    };
  }

  const syncLabels = () => map.getContainer().classList.toggle('show-plot-labels', map.getZoom() >= 19);
  map.on('zoomend', syncLabels);
  syncLabels();

  map.on('moveend', () => onViewChange?.());
  return {
    map, setPlots, setOverview, clearOverview, select, reveal, setMode, setOverlay, startPick, stopPick,
    setView: (lat, lon, zoom) => map.setView([lat, lon], zoom),
    bounds: () => map.getBounds(),
    locate: () => map.locate({ setView: true, maxZoom: 20 }),
    refresh: () => map.invalidateSize(),
  };
}
