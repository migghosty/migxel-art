// Everything that talks to AT Protocol: OAuth login and the XRPC calls
// against the signed-in user's PDS.

import { BrowserOAuthClient } from '../vendor/oauth-client-browser.js';
import {
  CANVAS_COLLECTION,
  HANDLE_RESOLVER,
  OAUTH_SCOPE,
  PRODUCTION_CLIENT_METADATA_PATH,
} from './config.js';

let client = null;
let session = null;

function isLoopback() {
  return ['127.0.0.1', '[::1]', 'localhost'].includes(location.hostname);
}

function clientId() {
  if (isLoopback()) {
    // Development: atproto allows a metadata-free "loopback" client whose
    // settings are carried in the client id itself.
    const redirect = location.origin + location.pathname;
    return (
      'http://localhost' +
      `?redirect_uri=${encodeURIComponent(redirect)}` +
      `&scope=${encodeURIComponent(OAUTH_SCOPE)}`
    );
  }
  return new URL(PRODUCTION_CLIENT_METADATA_PATH, location.href).href;
}

// Restores a previous session or finishes a login redirect.
// Returns { did } when signed in, otherwise null.
export async function initAuth() {
  // OAuth redirect URIs on a dev machine must use the IP form, not "localhost".
  if (location.hostname === 'localhost') {
    location.replace(location.href.replace('//localhost', '//127.0.0.1'));
    return new Promise(() => {}); // page is navigating away
  }
  client = await BrowserOAuthClient.load({
    clientId: clientId(),
    handleResolver: HANDLE_RESOLVER,
    onSessionDeleted: () => {
      session = null;
      window.dispatchEvent(new CustomEvent('pds-session-ended'));
    },
  });
  const result = await client.init();
  session = result?.session ?? null;
  return session ? { did: session.did } : null;
}

// Sends the browser to the user's PDS to approve the app. Does not return on success.
export async function signIn(handle) {
  if (!client) throw new Error('Login is not available. Reload the page and try again.');
  await client.signIn(handle.trim().replace(/^@/, ''), { scope: OAUTH_SCOPE });
}

export async function signOut() {
  const s = session;
  session = null;
  if (s) await s.signOut();
}

export function currentDid() {
  return session ? session.did : null;
}

async function xrpc(method, nsid, { params, json, binary, contentType } = {}) {
  if (!session) throw new Error('You are not logged in.');
  let path = `/xrpc/${nsid}`;
  if (params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
    path += `?${q}`;
  }
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  } else if (binary !== undefined) {
    init.headers['content-type'] = contentType || 'application/octet-stream';
    init.body = binary;
  }
  const res = await session.fetchHandler(path, init);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail = data?.message || data?.error || text || res.statusText;
    throw new Error(`${nsid} failed (${res.status}): ${detail}`);
  }
  return data;
}

export async function getHandle() {
  const data = await xrpc('GET', 'com.atproto.repo.describeRepo', { params: { repo: session.did } });
  return data.handle;
}

function rkeyOf(uri) {
  return uri.split('/').pop();
}

// Lists saved canvases, newest first. Returns { items: [{ rkey, uri, value }], cursor }.
export async function listCanvases(cursor) {
  const data = await xrpc('GET', 'com.atproto.repo.listRecords', {
    params: { repo: session.did, collection: CANVAS_COLLECTION, limit: 24, cursor },
  });
  return {
    items: data.records.map((r) => ({ rkey: rkeyOf(r.uri), uri: r.uri, value: r.value })),
    cursor: data.cursor,
  };
}

// Creates a canvas record (no rkey) or overwrites an existing one. Returns its rkey.
export async function saveCanvas(record, rkey) {
  if (rkey) {
    await xrpc('POST', 'com.atproto.repo.putRecord', {
      json: { repo: session.did, collection: CANVAS_COLLECTION, rkey, record },
    });
    return rkey;
  }
  const data = await xrpc('POST', 'com.atproto.repo.createRecord', {
    json: { repo: session.did, collection: CANVAS_COLLECTION, record },
  });
  return rkeyOf(data.uri);
}

export async function deleteCanvas(rkey) {
  await xrpc('POST', 'com.atproto.repo.deleteRecord', {
    json: { repo: session.did, collection: CANVAS_COLLECTION, rkey },
  });
}

// Posts a PNG to Bluesky. Returns the https://bsky.app URL of the new post.
export async function postImage({ text, png, alt, width, height }) {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const upload = await xrpc('POST', 'com.atproto.repo.uploadBlob', {
    binary: bytes,
    contentType: 'image/png',
  });
  const data = await xrpc('POST', 'com.atproto.repo.createRecord', {
    json: {
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ image: upload.blob, alt, aspectRatio: { width, height } }],
        },
      },
    },
  });
  return `https://bsky.app/profile/${session.did}/post/${rkeyOf(data.uri)}`;
}
