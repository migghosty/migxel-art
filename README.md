# Migxel Art

A front-end-only pixel-art editor that stores each canvas as one record in your
AT Protocol PDS. Plain HTML, CSS and JavaScript modules, no build step.

## Run it

Any static file server works. The address must be `127.0.0.1` (the OAuth
development flow does not accept `localhost`; the app redirects for you).

    cd migxel-art
    python3 -m http.server 8080 --bind 127.0.0.1

Then open http://127.0.0.1:8080/. Opening `index.html` straight from disk
(`file://`) does not work.

## Using it

- **Draw:** left click paints the front color, right click the back color.
  `X` swaps them, `P` pencil, `F` fill, `Ctrl+Z` undo, `Ctrl+S` save.
- **Colors:** click a swatch for the front color, right click for the back
  color. The color wheel (or clicking either color square) picks any color.
- **New:** choose a name and a size from 1x1 to 256x256.
- **Login:** enter your handle; you approve the app on your own account's
  sign-in page (OAuth). Your drawing is kept across the redirect.
- **Save:** writes the canvas to your PDS. The first save creates a record,
  later saves overwrite it.
- **History:** lists the canvases in your PDS; open or delete them.
- **Share:** posts an upscaled PNG of the canvas to Bluesky after you confirm
  the post text.

Unsaved work is kept in the browser's localStorage, so a reload does not lose it.

## The lexicon

`lexicons/io/github/migghosty/migxelart/canvas.json` — one record per canvas:

| Field | Type | Notes |
|---|---|---|
| `name` | string | optional, up to 64 graphemes |
| `width`, `height` | integer | 1 to 256 |
| `palette` | array of `#rrggbb` strings | 1 to 256 colors |
| `pixels` | bytes | `width * height` bytes, row by row, each a palette index |
| `createdAt`, `updatedAt` | datetime | `updatedAt` is set on re-saves |

The largest possible record (256x256) is about 64 KB of pixel data, roughly
90 KB as JSON.

The record type is `io.github.migghosty.migxelart.canvas` (`CANVAS_COLLECTION`
in `js/config.js`). Do not rename it once people have saved canvases: records
saved under the old name will not appear under a new one.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | Page and styles |
| `js/config.js` | Collection NSID, limits, swatches, OAuth scope |
| `js/model.js` | Canvas model: palette, encode/decode, validation, line, fill |
| `js/pds.js` | OAuth login and XRPC calls (list, create, put, delete, post) |
| `js/app.js` | Editor, History, dialogs |
| `vendor/oauth-client-browser.js` | Bundled `@atproto/oauth-client-browser` 0.5.14 |
| `client-metadata.json` | OAuth client metadata for the GitHub Pages deployment |

To rebuild the vendored OAuth client:

    npm install @atproto/oauth-client-browser esbuild
    echo "export { BrowserOAuthClient } from '@atproto/oauth-client-browser'" > entry.js
    npx esbuild entry.js --bundle --format=esm --minify --target=es2022 --outfile=vendor/oauth-client-browser.js

## Deploying

The project is configured for GitHub Pages at
`https://migghosty.github.io/migxel-art/`:

1. Push these files to the root of a repo named `migxel-art` under the
   `migghosty` account.
2. In the repo settings, enable Pages for the main branch (root folder).

On `127.0.0.1` the app uses atproto's metadata-free loopback OAuth client. On
the deployed site it uses `client-metadata.json`. If the address ever changes,
update every URL in that file: `client_id` must be the URL of the file itself
and `redirect_uris` the exact URL of the app, with the trailing slash.

Keep the empty `.nojekyll` file so GitHub Pages serves the files as they are.

## Notes

- Handles are resolved through `https://bsky.social` (`HANDLE_RESOLVER` in
  `js/config.js`).
- The OAuth scope is `atproto transition:generic`, which allows writing
  records and uploading the shared image.
- A canvas can use at most 256 distinct colors. Painting over a color frees
  its slot.
