<p align="center"><img src="assets/logo-1080.png" alt="Cemetery Map logo" width="180"></p>

# WikiTree Cemetery Plot Map (`cemetery-map`)

A [WikiTree App](https://apps.wikitree.com/apps/) that puts the people buried in a cemetery on a map. Pick a cemetery, see
who is buried where, add a headstone photo and a location for anyone who isn't on the map yet, and share the result as a table
on a WikiTree Space page that everyone can read and fix.

- Live: <https://apps.wikitree.com/apps/robinson27225/cemetery-map/index.html>
- About, with screenshots: <https://www.wikitree.com/wiki/Space:Cemetery_Map>
- Version: shown at the bottom right of the map (see [CHANGELOG.md](CHANGELOG.md)). It is a beta.

Plain static files (Leaflet and Leaflet.markercluster, vendored in `lib/`). No build step, no server, no API keys.

## How it fits together

- **The people** in a cemetery come from the WikiTree+ cemetery report for the cemetery's WikiTree category: every profile and its
  Find a Grave memorial. Profiles show up before anyone has mapped them.
- **The locations** are a table on a WikiTree Space page: WikiTree ID, coordinates, headstone image, and optionally names and
  dates. Anyone who can edit WikiTree can fix a row, and the map follows. The app prepares the updated table; pasting it onto the
  page is a manual step because WikiTree has no way for an app to write to a page.
- **Two categories make it work.** Every plot-map page must be in the cemetery's own WikiTree category (that is how the map finds
  the page's data) and in [Category:Plotting_Pages](https://www.wikitree.com/wiki/Category:Plotting_Pages) (that is how the app
  learns that the cemetery has a map). See [Plot-map pages and categories](#plot-map-pages-and-categories).
- **Nothing is stored on a server.** Unpublished edits are kept in the browser that made them.

## Run it

```bash
python3 -m http.server 8000      # from this folder
# open http://localhost:8000/?cemetery=fairview-raton-nm
npm test                         # node:test suite (Node 18+)
```

Off `wikitree.com` the app can't read WikiTree's pages (see [Reading WikiTree](#reading-wikitree-and-its-limits)), so locally you see
the saved snapshots, the WikiTree+ lists and the editing tools, not the live Space pages.

## Using the app

### Choosing a cemetery

With no cemetery chosen, the map starts with every ready-made map as a dot showing its number of rows (counted from the
plot-map pages on wikitree.com and trusted for an hour, refreshed as you browse; elsewhere the dot shows the cemetery's profile count). Dots that are close
together merge and add up. Click a dot, then **Open this map**.

**Find a cemetery…** has three ways in:

- **Ready-made maps** at the top: every cemetery that has a plot map (see Plotting Pages below), marked **map ready** wherever it
  appears.
- **Search** by the first word of a cemetery's name or its town, adding words to narrow it ("Mount Calvary Raton"). Needs the optional
  `directory/` files.
- **Browse** WikiTree's own place hierarchy: continent → country → state → county → the cemeteries in it.

Any WikiTree cemetery category opens, with everyone buried there listed under **Needs a location**, ready to be mapped. A direct link
is `?category=Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico`; a ready-made one is `?cemetery=fairview-raton-nm`.

By default nothing needs to be installed: the place hierarchy comes from the table WikiTree+ publishes (`CIBCemeteryGroup.tsv`,
about 0.6 MB, readable from any site) and each place's cemeteries from its WikiTree category page (about 35 KB, wikitree.com pages
only). Opening a cemetery also reads its category page for its map position, Find a Grave cemetery and Space page.

**Optional `directory/`.** `npm run build:directory` turns WikiTree+'s full cemetery table (about 150,000 cemeteries, 37 MB, too big
to load in a browser) into small files under `directory/` (about 30 MB, a few thousand files; it is in `.gitignore`). If they are
uploaded beside the app, the picker adds **search by name or town**, and browsing away from wikitree.com (where WikiTree's pages
can't be read) uses them, with cemetery counts in the hierarchy. They are a snapshot, so rebuild now and then: a cemetery or count
added since the build is missing from name search and from browsing off wikitree.com. On wikitree.com the picker browses from
WikiTree's own pages instead, so the lists are always current and only name search depends on the snapshot.

**Keeping it current.** [`.github/workflows/directory.yml`](.github/workflows/directory.yml) rebuilds `directory/` every Monday (and
on demand: Actions → Rebuild the cemetery directory → Run workflow) and publishes it on GitHub Pages at
`https://robinson27225.github.io/cemetery-map/directory/`. The app reads it from there first and from a `directory/` beside the app
second (`DIRECTORY_BASES` in `js/config.js`), so nothing needs uploading. One-time setup: in the repository's Settings → Pages, set
Source to "GitHub Actions". GitHub Pages answers any website, so the app can read the files from there.

### Seeing who is buried where

- Click a marker for the headstone photo and everyone on that stone. A name opens the person's WikiTree profile. Links to WikiTree,
  Find a Grave and FamilySearch, a directions link and the coordinates are in the details. People who share a headstone share one marker.
- **List by** switches between people and **monuments**. The monument view has one row per headstone: its plot number or reference,
  how many are buried there, and who. Every monument is listed. Cemeteries of more than 600 people open in this view; the people
  list shows 600 at a time with a "Show more" button.
- A headstone's label is its **Plot**, **Monument** (the heading on the stone) or **Reference** (a trace back to another database)
  column. **Label stones by** chooses which; the default tries them in that order, and the choice is remembered per cemetery in
  the browser. Only when a table has none of those columns, the short value everyone on a stone shares in **Notes** (like
  `Fam-4150`) is the label, so notes such as "Veteran" are never used. The label shows beside the pin once you zoom in, and in
  the details as "Plot …", "Monument …" or "Reference …".
- **Show** filters the list (Needs a location, On the map, Needs WikiTree ID); **Colour by** changes what the marker colours mean.
  Search the list by name, WikiTree ID, Find a Grave memorial, FamilySearch ID, plot or notes.
- Each person has up to two buttons: **Map** (they are on the map) or **Locate** (they need a location), and **Identify** for a burial
  with no WikiTree profile yet. Clicking a row shows their details and photo, even with no location.
- The links under the cemetery's name go to its WikiTree category, Space page, the page or pages the locations come from, its Find a
  Grave cemetery and the WikiTree+ report.

### Adding and updating locations

Pick the person (the list, or `?cemetery=ID&wt=Tapia-408` from a profile), then **Locate** or **Edit location or photo**:

- **Photo:** pick one of the profile's WikiTree photos (when the app is opened from wikitree.com), or paste an image link or WikiTree
  file name. The picture can be stored anywhere (see [Input format](#input-format)).
- **Location:** click the map or drag the pin; **Use my location** (best at the grave); type or paste `lat, lon`; **Read from a photo
  file…** (reads the GPS tag from a photo on your device, nothing is uploaded); or **Same headstone as…** to copy a relative's spot
  and photo. On a shared headstone, one tick applies it to everyone on it.

Changes are saved **on your device first** and marked "unpublished". **Publish…** re-reads the Space pages (when it can), lists what
changed, and gives you the updated table to paste over the table on the plot-map page, with the category lines to keep on it. Once
the page has the change, it stops being "unpublished" by itself, so the list always means "not on WikiTree yet".

For a cemetery whose locations are spread over several Space pages, changes to rows on the cemetery's own table go into the table;
changes to rows on another page (such as an album) are listed under "Rows on other pages" with a link to that page's editor.

### Burials without a WikiTree profile

A row with a name but no WikiTree ID is kept as a burial of its own: named from Given Names, Surname and Maiden, dated from Birth
and Death, with its Notes and Find a Grave memorial. It is listed, drawn on its headstone with everyone who shares it, and counted
in the header. **Show → Needs WikiTree ID** lists them. **Identify** lets you type the ID once the person has a profile (a profile
link works too, an ID already on the map is refused). The row then becomes that profile, merges with the WikiTree+ list, and Publish
writes the ID into the table. A stone with a location but nobody named is drawn as a grey **unknown headstone**.

### Importing your own list

**Import data** plots a spreadsheet: paste the rows or choose a `.tsv` or `.csv` file. A header row, then one row per person;
column order doesn't matter.

When a cemetery is open, the dialog starts with that cemetery's name, location, ID, Space page, category and table page filled in.
The table page is a plain title as you would type it into WikiTree's new-page box (no `Space:`, spaces not underscores); for a
cemetery with no table yet it suggests one with the place in it, like `Fern Hill Cemetery Aberdeen WA USA Plot Map Table`.
A list of memorials from the WikiTree Browser Extension's *Find A Grave Memorial Extractor* works once its columns are arranged
as WikiTree ID, FindAGrave, FamilySearch, Long, Lat (empty), Given Names, Surname, Maiden, Birth, Death, Notes.

#### Input format

| Column | Required | Notes |
| --- | --- | --- |
| WikiTree ID | yes, unless the row has names | `Tapia-408` (a wikitree.com URL also works). Blank for a burial with no profile yet |
| Long, Lat | yes | decimal degrees in two columns. Swapped values are detected and fixed |
| FindAGrave | no | memorial number or URL |
| FamilySearch | no | e.g. `GJ31-WG9` or a familysearch.org URL |
| Image link | no | the headstone photo's address: a WikiTree photo or **any other address**. A Google Drive share link (`https://drive.google.com/file/d/…/view`, shared with "anyone with the link") is shown as a picture and kept as written in the table. A Google Photos album (`photos.app.goo.gl`), one photo in a share (`photos.google.com/share/…/photo/…`) or a Drive folder is a web page, not a picture, so it shows as "Open the photo album" or "Open the photo" and opens Google's own viewer: a way to give one stone several photos |
| Given Names, Surname, Maiden, Birth, Death | no | Surname is the current last name, Maiden the last name at birth; Birth and Death can be a year or a full date |
| Section, Plot, Row, Monument, Reference, Notes | no | shown in the details and searched. Plot, Monument or Reference labels the marker; Notes is for anything else about the row (Veteran, Notable) |

People who share a headstone share its Long, Lat and image: two profiles on one stone are two rows with the same position and
picture. See `samples/fairview-raton.tsv`, and `docs/example-plot-map.csv` for three profiles on one stone.

### Plot map overlay

Lays a scanned cemetery plot map over the satellite imagery: pick an image (or give a URL), enter the south/west/north/east corner
coordinates (or **Fit to what's on screen** and adjust), set the opacity. You can also load a GeoJSON file of sections and
landmarks (polygons or points with a `name`). Both are saved in the cemetery file. Images are axis-aligned rectangles (no rotation
yet); images chosen from disk are embedded in the JSON (4 MB limit), so host the image and use its URL to keep the file small.

## Where a cemetery's data lives

### The table

The app's own plot-map table, for example `Space:Fairview_Presbyterian_Cemetery_Raton_NM_USA_Plot_Map_Table`, has these columns in this
order: `WikiTree | FindAGrave | FamilySearch | Long | Lat | Image link | Given Names | Surname | Maiden | Birth | Death | Notes`, with Section, Plot, Row, Monument and Reference before Notes when any row has them.
Rows are kept if they have a location, no WikiTree profile, or anything typed into the row (names, notes, a photo), so nothing in
the table is lost when it is republished. A profile that is only a WikiTree+ list entry is not written, because the list supplies it
every time. Album-style tables (`WT-ID | Latitude | Longitude | Surname | Forename | DOB | DOD | Plot | Image`, with the picture in
the Image cell) and tables of unknown headstones (locations and pictures, no IDs) are read too, and can be mixed.

### Plot-map pages and categories

Every plot-map page (including each album page of a large cemetery) should be in **two** categories:

1. the cemetery's own WikiTree category, e.g. `[[Category:Fairview_Presbyterian_Cemetery,_Raton,_New_Mexico]]`. The app reads
   every Space page in that category that has a table with locations. A plot-map page that isn't in it is not found, and the map
   shows the profiles with no locations. Pages with accents in their titles work.
2. `[[Category:Plotting_Pages]]`. On wikitree.com the app reads that category, asks the WikiTree API for each page's categories,
   and lists every such cemetery under **Ready-made maps** (marking it "map ready" in the place lists) with nothing to edit. The result is remembered for
   ten minutes. Elsewhere WikiTree can't be read, so only the hand-registered maps in `cemeteries/index.json` are listed.

**Publish** shows the exact category lines for the cemetery. The list of pages being read is under **Plot-map pages** at the top.

### Large cemeteries: several Space pages

A big cemetery can keep one Space page per section (Fairmont, Raton has Album 1–8 and an Unknown Headstones page). Each location
remembers the page it came from, and if the same profile is on two pages, the first wins.

### Reading WikiTree, and its limits

WikiTree's bot protection answers requests from other sites with an empty `202`, so live reading works only from a `*.wikitree.com`
page, using `fetch(..., {credentials: 'include'})` so the visitor's protection cookie goes along. In testing it worked right after
visiting a wikitree.com page and failed several minutes later in the same tab, probably because the cookie expired; its lifetime wasn't
measured and it is outside the app's control, so treat live reading as best-effort. When it fails the app falls back to the saved
snapshot (if there is one) and says so. WikiTree can also answer "too many requests" (HTTP 429) for a minute if it is hit hard. There
is no API for reading Space pages, and `?action=raw` returns HTML, not wikitext, so the table parser (`js/spacetable.js`) reads the
rendered HTML, including tables nested inside cells; header names are matched loosely and IDs and photo addresses come from link
targets.

### Hand-registered cemeteries and snapshots (optional)

`cemeteries/index.json` lists hand-registered cemeteries (id, name, location, categories, table page) and `cemeteries/<id>.json`
holds a saved snapshot: the locations as last read, plus things the table can't hold (plot-map overlay, map centre and zoom, cached
names). They matter off wikitree.com, where the live pages can't be read. To add one: **Import data** → fill in the name, location
and table page → **Plot on map**, then **Export & share**. Anyone can use its first three sections: the plot-map table to paste onto
the Space page, the two categories the page must be in (the cemetery's own and `Plotting_Pages`), and the permanent link. The
collapsed sections at the bottom, the cemetery file (download it into `cemeteries/`) and the index entry, are for whoever looks after
the app's folder on the apps server; a cemetery in its category and `Plotting_Pages` is listed without them. To refresh a snapshot,
open the cemetery on wikitree.com (it loads live), then **Export & share → Cemetery file**. From the command line:
`node tools/build-cemetery.mjs input.tsv cemeteries/ID.json [--enrich]` (cemetery name, table page etc. come from `input.meta.json`;
see `samples/`). Old quick-share links (`#d=…`) still open, but new ones are no longer made.

## Data rules

- **Living people are never listed or mapped.** A table row marked "Still Living" is skipped, and a profile the WikiTree API says is
  living is dropped.
- **Unknown headstones are not errors.** They are grey markers, not people, so they aren't in the list and can't be duplicates.
- **The Data check** under the list reports what looks odd, grouped so a large cemetery doesn't produce a wall of text: one line per
  Space page and kind of problem with a count and a link to the page ("Album 1: 266 rows have no usable coordinates"); a photo shared
  by profiles more than 10 m apart links to the photo's page, and so does a marker outside a reasonable area around the cemetery (at
  least a kilometre, and wider than three times the typical distance from the centre); profiles in a table but not in the category
  are only counted, with a link to the WikiTree+ report. A cemetery that is still a work in progress will show a lot here.
- **IDs written with underscores** (`Van_De_Valde-6`) are read as `Van De Valde-6`; WikiTree IDs in any alphabet are accepted.
- **The people list** reads only the first half of the WikiTree+ cemetery report (the profiles in the category) and ignores its
  "Memorials" half, which lists Find a Grave memorials whose profiles belong to other categories.

## Names and dates

Names and birth/death dates come from the public WikiTree API, which answers browsers only on `*.wikitree.com` pages (it sends no CORS
header for other hosts), so elsewhere the live lookup is skipped. Names typed into the table are used instead, and `--enrich` in
`tools/build-cemetery.mjs` can bake API names and dates into a snapshot. Without either, the map shows WikiTree IDs.

## GPS in photos uploaded to WikiTree

WikiTree keeps a photo's EXIF block in the original file, but whether it holds a location depends on the phone and how the photo got
to WikiTree. Of three public test uploads from the mobile-upload announcement on G2G, one iPhone photo had GPS tags, one Samsung photo
had date and camera tags but no GPS, and one (apparently taken through the browser's camera capture) had its metadata stripped. The
app can't read the bytes of images hosted on wikitree.com from another origin (no CORS header), so it never reads GPS from the
WikiTree copy; use the location options above, or choose the original photo file on your device.

## Deploying and releasing

Upload the app to its folder on the apps server (here `apps/robinson27225/cemetery-map/`): `index.html`, `css/`, `js/`, `lib/` and
`cemeteries/`. `directory/` is optional (it adds name search); `samples/` only feeds the Import dialog's sample button. Don't upload
`tests/`, `tools/`, `docs/`, `package.json` or `node_modules`. All paths are relative, so any folder works.

To release: change `VERSION` and `RELEASED` in `js/config.js`, `version` in `package.json`, add an entry to `CHANGELOG.md` (a test fails
if these disagree), then upload the changed files. The version in the corner of the map shows which copy is live; if it shows an old
number after an upload, a file was missed or the browser has an old copy (refresh once).

## Layout

```
index.html, css/app.css      app shell
js/app.js                    wiring and URL parameters
js/config.js                 version, the app's WikiTree page and published address
js/parse.js                  TSV/CSV → validated graves, markers and an issue list
js/people.js                 names, dates and stone labels (plot, monument, reference) for display
js/model.js                  group graves into headstones, audit, first view
js/links.js                  WikiTree / Find a Grave / FamilySearch URLs and ID parsing
js/table-title.js            suggested plot-map page titles (with the place) and title ↔ page-key conversion
js/map.js                    Leaflet map, clustering, legend, plot labels, logo, overlay
js/detail.js                 headstone panel (DOM-built; no innerHTML for user data)
js/edit.js, js/edits.js      Locate/Identify panel; unpublished-changes store
js/images.js, js/md5.js      image address handling (WikiTree hash path, Google Drive links)
js/exif.js                   GPS from a local JPEG; lat,lon text parsing
js/spacetable.js             read plot-map tables and category pages from Space pages
js/source.js                 live-from-Space-pages or snapshot loader
js/plus.js                   WikiTree+ cemetery roster (profiles + Find a Grave IDs)
js/plotting.js               ready-made maps, found through Category:Plotting_Pages
js/overview.js               the default view: ready-made maps as dots with row counts
js/wikitree-api.js           names/dates and photo lists from the WikiTree API
js/directory.js, js/live-directory.js, js/place-tree.js, js/picker.js
                             the cemetery picker: place hierarchy, live or from directory/
js/export.js                 JSON, share link, table markup
directory/                   optional, generated by tools/build-directory.mjs
cemeteries/                  index.json (+ a snapshot per cemetery, if any)
samples/, tests/, tools/     sample input, node:test suite, command-line builders
docs/                        example-plot-map.csv, a sample import (not deployed)
lib/                         vendored Leaflet 1.9.4, Leaflet.markercluster 1.5.3 (BSD-2 / MIT)
```

## Logo

`assets/` holds the logo and icon (`logo.svg`, `icon.svg` and PNGs), a companion to the Headstone Photo Tool's: the same palette,
viewfinder corners, grass bar and pin, with a map of headstones. For the WikiTree apps page use `logo-1080.png` (1080 px square) and
`icon-96.png`; for a round photo slot such as a Space page's primary photo, `logo-circle-500.png` (500 px, the logo on a white disc,
transparent outside the circle). The page tab uses `icon.svg` and `icon-32.png`. They are drawn by `tools/make-logo.cjs` (needs
`npm i --no-save opentype.js @fontsource/source-sans-3 sharp`; the wordmark is Source Sans 3 Bold, SIL Open Font License, as outlines).

## License

MIT, see [LICENSE](LICENSE). Leaflet and Leaflet.markercluster in `lib/` keep their own licenses (BSD-2 and MIT).

## Known limits

- Beta; tested in a desktop browser only, not on phones.
- Saving back to WikiTree is a copy and paste.
- Reading Space pages, names and photo lists works only while the app is open on wikitree.com, and WikiTree's access checks can make a
  request fail now and then (the app falls back to the snapshot and says so).
- The generated table markup uses `{| border="1" class="sortable"` and `[[ID]]` links, mirroring the Fairview page.
- Headstone photos are hot-linked from wherever they are stored; if one fails to load the panel shows a link instead.
- Imagery is Esri World Imagery (default) or OpenStreetMap, so the map needs an internet connection.
- Grouping merges identical coordinates (and the same photo within 3 m); stones a metre or two apart stay separate and cluster on the map.
- Plot-map image overlays can't be rotated.
