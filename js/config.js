// App-wide settings. Change these in one place.

// NSID of the canvas record, based on the GitHub Pages host
// migghosty.github.io. Do not change this once people have saved canvases:
// records saved under the old name will not show up under a new one.
export const CANVAS_COLLECTION = 'io.github.migghosty.migxelart.canvas';

// Record names used by earlier versions of the app. History offers to import
// canvases found under these names into CANVAS_COLLECTION.
export const LEGACY_COLLECTIONS = [
  'com.example.pixelart.canvas',
  'com.example.migxelart.canvas',
];

// Limits that mirror the lexicon.
export const MAX_SIZE = 256;
export const MAX_COLORS = 256;
export const MAX_NAME_GRAPHEMES = 64;
export const DEFAULT_SIZE = 32;

// Service used to turn a handle (alice.bsky.social) into a DID at login.
export const HANDLE_RESOLVER = 'https://bsky.social';

// OAuth scope. "transition:generic" lets the app write records (canvases and
// the Bluesky post created by Share) and upload the shared image.
export const OAUTH_SCOPE = 'atproto transition:generic';

// When deployed to a real https origin, the OAuth client id is the URL of a
// client metadata JSON file hosted next to index.html. See README.md.
export const PRODUCTION_CLIENT_METADATA_PATH = 'client-metadata.json';

// Colors shown in the sidebar, in the order of the sketch (two columns).
export const SWATCHES = [
  '#ffffff', '#1e1e1e',
  '#ced4da', '#868e96',
  '#ff8787', '#e03131',
  '#b2f2bb', '#2f9e44',
  '#a5d8ff', '#1971c2',
  '#ffec99', '#f08c00',
];

export const DEFAULT_PRIMARY = '#1e1e1e';
export const DEFAULT_SECONDARY = '#b2f2bb';
export const BACKGROUND = '#ffffff';
