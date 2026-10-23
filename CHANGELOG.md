# Changelog

Versions are `0.x` while the app is in beta. The current version is shown at the bottom right of the map. To release:
change `VERSION` and `RELEASED` in `js/config.js`, `version` in `package.json`, and add an entry here (a test checks the
first two agree). Documentation-only changes (README) don't get a new version.

## 0.10.1 (2026-10-22)
- New logo and icon, a companion to the Headstone Photo Tool's: the page tab, the header and the README now show them.

## 0.10.0 (2026-10-18)
- **The default view shows the ready-made maps as dots on the map.** Opening the app with no cemetery picked now shows every
  cemetery that has a map (found through `Category:Plotting_Pages`, plus the hand-registered ones) as a dot with its number of
  rows; dots that are close together merge and add up. Click a dot, then **Open this map**. The rows are counted from the plot-map
  pages when the app is open on wikitree.com (a few seconds, remembered for a day); elsewhere the dot shows the cemetery's number of
  profiles when it knows it. Locations come from WikiTree+'s cemetery table.

## 0.9.2 (2026-10-17)
- **Name search stays current by itself.** The search files (`directory/`) are rebuilt every week by a GitHub Action from
  WikiTree+'s tables and published on GitHub Pages; the app reads them from there first, then from a copy beside the app if
  there is one. Nobody has to rebuild and upload them.

## 0.9.1 (2026-10-17)
- **Find a cemetery lists every cemetery in a place.** When the app has the optional `directory/` files, it browsed from that
  snapshot even on wikitree.com, so cemeteries added to WikiTree since it was built (two of the six on Île d'Orléans) were
  missing and some counts were old. On wikitree.com it now browses from WikiTree's own pages, which are always current; the
  snapshot only serves search by name, and browsing elsewhere.

## 0.9.0 (2026-10-15)
- **Monument and Reference columns**, optional like Plot. Monument is the heading on the stone (for example a family name),
  Reference is a trace back to another database. Anything else about a row (Veteran, Notable) stays in Notes. They are shown in
  the headstone details, searched, and written back when the table is published, together with Section, Plot and Row (these were
  dropped before) whenever a row has a value.
- **Label stones by** (shown when the table has Plot, Monument or Reference values): choose which one names a stone beside its pin
  and in the monument list. The default tries Plot, then Monument, then Reference. Notes name a stone only when the table has none
  of those columns, so a note like "Veteran" is never used as a label. The choice is remembered per cemetery in the browser.
- **The monument list shows every monument**, with no "Show more".
- A Google Photos link in Image link (an album, a Drive folder, or one photo in a share) shows as "Open the photo album" or "Open the
  photo" in the details, which opens Google's own viewer with zoom. Google gives no picture address for these, so they can't be
  shown as a picture inside the app.

## 0.8.6 (2026-10-14)
- Fixed the word "null" showing under the title of a headstone's details when the stone has no plot label.

## 0.8.5 (2026-10-14)
- FamilySearch IDs are written with WikiTree's `{{FamilySearch|ID}}` template too, instead of an external link. Tables written
  before still read the same.

## 0.8.4 (2026-10-14)
- The table the app writes now uses WikiTree's `{{FindAGrave|memorial number}}` template for Find a Grave memorials instead of an
  external link. Tables written before still read the same.

## 0.8.3 (2026-10-14)
- **Export & share is for everyone, not just the app's maintainer.** It now shows: 1 the plot-map table, 2 the two categories the
  page must be in (the cemetery's own and Plotting Pages), 3 the permanent link (link and WikiTree markup). The cemetery file and
  index entry, which only the person who looks after the app's folder on the apps server can use, are collapsed at the bottom.
- The quick-share link is gone.

## 0.8.2 (2026-10-14)
- **Plot-map table page is a plain title.** The Import dialog shows it the way you type it into WikiTree's new-page box (spaces,
  no `Space:`), and suggests one with the place in it for a cemetery nobody has mapped yet, such as
  `Fern Hill Cemetery Aberdeen WA USA Plot Map Table`. Titles with `Space:` or underscores still work.
- The example column headers in Import now read `WikiTree ID,FindAGrave,FamilySearch,Long,Lat,Headstone photo,Given Names,Surname,Maiden,Birth,Death,Plot,Notes`,
  and "Read the table from that page" fills the same columns.

## 0.8.1 (2026-10-14)
- **Import data starts with the open cemetery's details** (name, location, short ID, Space page, category, table page) filled in.
- Documented how to start a cemetery from a Find a Grave list made with the WikiTree Browser Extension's Find A Grave
  Memorial Extractor.

## 0.8.0 (2026-10-13)
- **Ready-made maps are found automatically.** Every cemetery whose plot-map pages are in `Category:Plotting_Pages` (and in
  the cemetery's own category) is listed under "Ready-made maps" in Find a cemetery, and marked "map ready" wherever it
  appears, without anyone editing a list. This is read from WikiTree, so it works when the app is opened from wikitree.com
  (the list is remembered for ten minutes); elsewhere the hand-registered list in `cemeteries/index.json` is used.
- Publish now shows both category lines to add to a plot-map page.

## 0.7.2 (2026-10-13)
- Fairmont Cemetery (Raton) and Cimetière de Sainte-Famille (Île d'Orléans) are listed as ready-made maps in Find a cemetery,
  with the "map ready" badge. A registered cemetery with no saved snapshot now still opens.

## 0.7.1 (2026-10-13)
- The name and version in the corner of the map link to Cemetery Map's page on WikiTree.

## 0.7.0 (2026-10-13)
- **Accented Space page titles** (Cimetière, Île d'Orléans, Québec…) are now accepted. Before, the app skipped the plot-map
  pages of any cemetery whose title had an accent, so nothing was listed.
- **List by monument.** A new "List by" menu shows one row per headstone (its plot number or reference, how many are buried
  there, and who). Big cemeteries open in this view. The people list adds pages with "Show more" instead of stopping at 600.
- **Plot label on the map.** A headstone's Plot number (or, if there isn't one, the reference everyone on it shares in Notes)
  shows beside the pin when zoomed in, and in the details as "Plot …".
- Publish reminds you to put the cemetery's category on the plot-map page (that is how the map finds it). A Space page that
  doesn't exist is skipped quietly instead of counting as WikiTree blocking the app.

## 0.6.1 (2026-10-11)
- WikiTree logo at the bottom left of the map and "© WikiTree contributors" in the attribution, as on the WikiTree Maps
  cemetery map.
- The cemetery's links and summary line under its name wrap instead of being cut off.

## 0.6.0 (2026-10-11)
- Burials without a WikiTree profile: rows with names (Given Names, Surname, Maiden, Birth, Death, Notes) but no
  WikiTree ID are kept, listed, mapped and written back to the table. **Show → Needs WikiTree ID**, and **Identify** to
  add the ID later.
- Clicking someone who has no location shows their details and photo; **Locate** opens the editor.
- Photos can be stored anywhere. Google Drive share links (`drive.google.com/file/d/…/view`) are displayed.
- Data check: problems grouped per Space page with counts and links; shared photos and far-away points link to the
  image page; living people are never listed or mapped; unknown headstones are drawn as grey markers.
- Large cemeteries: every Space page in the cemetery's category that has a plot table is read (album layouts too).
- Cemetery picker reads WikiTree live; the optional `directory/` files add search by name or town.
- Dialog Cancel/Close buttons always close.

Earlier 0.x releases were development builds and are not listed.
