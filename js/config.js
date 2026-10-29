// Where this app is published. Links meant for WikiTree pages always use this address, even when the
// app is being tried out on localhost, so a pasted link works for everyone.
// The app's own page on WikiTree: the version number in the map corner links here.
export const SPACE_URL = 'https://www.wikitree.com/wiki/Space:Cemetery_Map';
export const APP_URL = 'https://apps.wikitree.com/apps/robinson27225/cemetery-map/index.html';

// The version of this copy of the app, shown at the bottom right of the map so a problem report can say which one it
// was. Change both lines (and package.json, CHANGELOG.md) for each upload; a test checks they agree.
export const VERSION = '0.10.2';
export const RELEASED = '2026-10-28';

// Where the cemetery picker's search files (directory/) can be read from, tried in order. The first is rebuilt every week by a
// GitHub Action (see .github/workflows/directory.yml); the second is a copy uploaded beside the app, if there is one.
export const DIRECTORY_BASES = ['https://robinson27225.github.io/cemetery-map/directory', 'directory'];
