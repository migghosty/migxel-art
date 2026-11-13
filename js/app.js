// UI: the editor, the History view, and the Save / Share / Login flows.

import {
  SWATCHES, DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_SIZE, MAX_SIZE, MAX_COLORS,
} from './config.js';
import * as M from './model.js';
import * as pds from './pds.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'migxelart:draft:v1';
const UNDO_LIMIT = 50;

const state = {
  canvas: M.createCanvas(DEFAULT_SIZE, DEFAULT_SIZE),
  name: '',
  rkey: null,       // record key once the canvas has been saved
  owner: null,      // DID of the account the rkey belongs to
  createdAt: null,
  dirty: false,
  primary: DEFAULT_PRIMARY,
  secondary: DEFAULT_SECONDARY,
  tool: 'pencil',
  zoom: 16,
  grid: true,
  undo: [],
  user: null,       // { did, handle } when logged in
  authReady: false,
};

/* ---------- status line ---------- */

function setStatus(message, { error = false, link } = {}) {
  const el = $('status');
  el.textContent = message;
  el.classList.toggle('error', error);
  if (link) {
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = link.text;
    el.append(' ', a);
  }
}

/* ---------- drawing surface ---------- */

const board = $('board');
const ctx = board.getContext('2d');
const off = document.createElement('canvas');
let offCtx = null;
let imageData = null;
let renderQueued = false;

function fitZoom() {
  const { width, height } = state.canvas;
  const z = Math.floor(Math.min(720 / width, 560 / height));
  return Math.max(2, Math.min(80, z));
}

function resetSurface() {
  const { width, height } = state.canvas;
  off.width = width;
  off.height = height;
  offCtx = off.getContext('2d');
  imageData = offCtx.createImageData(width, height);
  applyZoom();
}

function applyZoom() {
  const { width, height } = state.canvas;
  board.width = width * state.zoom;
  board.height = height * state.zoom;
  board.style.width = `${board.width}px`;
  board.style.height = `${board.height}px`;
  $('zoom-label').textContent = `${state.zoom}×`;
  render();
}

function render() {
  renderQueued = false;
  const { width, height } = state.canvas;
  M.toRgba(state.canvas, imageData.data);
  offCtx.putImageData(imageData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, board.width, board.height);
  if (state.grid && state.zoom >= 4) {
    const z = state.zoom;
    ctx.fillStyle = z >= 12 ? 'rgba(30,30,30,0.85)' : 'rgba(30,30,30,0.3)';
    for (let x = 1; x < width; x++) ctx.fillRect(x * z, 0, 1, board.height);
    for (let y = 1; y < height; y++) ctx.fillRect(0, y * z, board.width, 1);
  }
}

function queueRender() {
  if (!renderQueued) {
    renderQueued = true;
    requestAnimationFrame(render);
  }
}

function updateMeta() {
  const { width, height } = state.canvas;
  const saved = state.rkey ? (state.dirty ? 'unsaved changes' : 'saved') : 'not saved yet';
  $('canvas-meta').textContent = `${width}×${height} · ${saved}`;
}

/* ---------- draft (survives reloads and the login redirect) ---------- */

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      name: state.name,
      rkey: state.rkey,
      owner: state.owner,
      createdAt: state.createdAt,
      dirty: state.dirty,
      primary: state.primary,
      secondary: state.secondary,
      record: M.toRecord(state.canvas),
    }));
  } catch {
    /* storage full or blocked: the drawing still lives in memory */
  }
}

function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!d) return false;
    state.canvas = M.fromRecord(d.record);
    state.name = d.name || '';
    state.rkey = d.rkey || null;
    state.owner = d.owner || null;
    state.createdAt = d.createdAt || null;
    state.dirty = !!d.dirty;
    if (d.primary) state.primary = M.normalizeHex(d.primary);
    if (d.secondary) state.secondary = M.normalizeHex(d.secondary);
    return true;
  } catch {
    return false;
  }
}

function markDirty() {
  state.dirty = true;
  updateMeta();
  saveDraft();
}

function setCanvas({ canvas, name = '', rkey = null, createdAt = null, dirty = false }) {
  state.canvas = canvas;
  state.name = name;
  state.rkey = rkey;
  state.owner = rkey && state.user ? state.user.did : null;
  state.createdAt = createdAt;
  state.dirty = dirty;
  state.undo = [];
  state.zoom = fitZoom();
  $('canvas-name').value = name;
  resetSurface();
  updateMeta();
  saveDraft();
}

function okToDiscard() {
  return !state.dirty || confirm('This canvas has unsaved changes. Discard them?');
}

/* ---------- painting ---------- */

let stroke = null;

function cellAt(e) {
  const r = board.getBoundingClientRect();
  const { width, height } = state.canvas;
  const x = Math.floor(((e.clientX - r.left) / r.width) * width);
  const y = Math.floor(((e.clientY - r.top) / r.height) * height);
  return [Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y))];
}

function pushUndo() {
  state.undo.push(M.cloneCanvas(state.canvas));
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
}

function undo() {
  const prev = state.undo.pop();
  if (!prev) return;
  state.canvas = prev;
  queueRender();
  markDirty();
}

function plot(x, y) {
  const i = y * state.canvas.width + x;
  if (state.canvas.pixels[i] !== stroke.index) {
    state.canvas.pixels[i] = stroke.index;
    stroke.changed = true;
  }
}

board.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  const color = e.button === 2 ? state.secondary : state.primary;
  const index = M.colorIndex(state.canvas, color);
  if (index === -1) {
    setStatus(`This canvas already uses ${MAX_COLORS} colors. Paint over one to free it up.`, { error: true });
    return;
  }
  pushUndo();
  const [x, y] = cellAt(e);
  if (state.tool === 'fill') {
    if (M.floodFill(state.canvas, x, y, index)) {
      queueRender();
      markDirty();
    } else {
      state.undo.pop();
    }
    return;
  }
  stroke = { index, x, y, changed: false };
  board.setPointerCapture(e.pointerId);
  plot(x, y);
  queueRender();
});

board.addEventListener('pointermove', (e) => {
  if (!stroke) return;
  const [x, y] = cellAt(e);
  if (x === stroke.x && y === stroke.y) return;
  M.line(stroke.x, stroke.y, x, y, plot);
  stroke.x = x;
  stroke.y = y;
  queueRender();
});

function endStroke() {
  if (!stroke) return;
  if (stroke.changed) markDirty();
  else state.undo.pop();
  stroke = null;
}
board.addEventListener('pointerup', endStroke);
board.addEventListener('pointercancel', endStroke);
board.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- colors ---------- */

let pickerTarget = 'primary';

function renderColors() {
  $('chip-primary').style.background = state.primary;
  $('chip-secondary').style.background = state.secondary;
  for (const el of $('swatches').children) {
    el.classList.toggle('is-primary', el.dataset.color === state.primary);
  }
}

function setColor(which, color) {
  state[which] = M.normalizeHex(color);
  renderColors();
  saveDraft();
}

function buildSwatches() {
  for (const color of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = color;
    b.style.background = color;
    b.title = `${color} (right click sets the back color)`;
    b.setAttribute('aria-label', `Color ${color}`);
    b.addEventListener('click', () => setColor('primary', color));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      setColor('secondary', color);
    });
    $('swatches').append(b);
  }
}

function openPicker(which) {
  pickerTarget = which;
  $('custom-color').value = state[which];
  $('custom-color').click();
}

$('chip-primary').addEventListener('click', () => openPicker('primary'));
$('chip-secondary').addEventListener('click', () => openPicker('secondary'));
$('custom-color').addEventListener('pointerdown', () => {
  pickerTarget = 'primary';
  $('custom-color').value = state.primary;
});
$('custom-color').addEventListener('input', (e) => setColor(pickerTarget, e.target.value));

function swapColors() {
  [state.primary, state.secondary] = [state.secondary, state.primary];
  renderColors();
  saveDraft();
}
$('swap').addEventListener('click', swapColors);

/* ---------- tools, zoom, grid ---------- */

function setTool(tool) {
  state.tool = tool;
  $('tool-pencil').setAttribute('aria-pressed', String(tool === 'pencil'));
  $('tool-fill').setAttribute('aria-pressed', String(tool === 'fill'));
}
$('tool-pencil').addEventListener('click', () => setTool('pencil'));
$('tool-fill').addEventListener('click', () => setTool('fill'));
$('btn-undo').addEventListener('click', undo);

function zoomBy(direction) {
  const step = Math.max(1, Math.round(state.zoom * 0.25));
  state.zoom = Math.max(1, Math.min(80, state.zoom + direction * step));
  applyZoom();
}
$('zoom-in').addEventListener('click', () => zoomBy(1));
$('zoom-out').addEventListener('click', () => zoomBy(-1));
$('grid-toggle').addEventListener('change', (e) => {
  state.grid = e.target.checked;
  render();
});

$('canvas-name').addEventListener('input', (e) => {
  state.name = e.target.value;
  markDirty();
});

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
    return;
  }
  if (e.target.matches('input, textarea')) return;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (!mod && e.key.toLowerCase() === 'x') swapColors();
  else if (!mod && e.key.toLowerCase() === 'p') setTool('pencil');
  else if (!mod && e.key.toLowerCase() === 'f') setTool('fill');
});

/* ---------- views ---------- */

function showView(view) {
  $('view-editor').hidden = view !== 'editor';
  $('view-history').hidden = view !== 'history';
  if (view === 'history') $('nav-history').setAttribute('aria-current', 'page');
  else $('nav-history').removeAttribute('aria-current');
}

$('nav-editor').addEventListener('click', (e) => {
  e.preventDefault();
  showView('editor');
});
$('nav-history').addEventListener('click', () => {
  showView('history');
  loadHistory(true);
});

/* ---------- new canvas ---------- */

$('nav-new').addEventListener('click', () => {
  $('new-name').value = '';
  $('dlg-new').showModal();
});
$('presets').addEventListener('click', (e) => {
  const size = e.target.dataset.size;
  if (!size) return;
  $('new-width').value = size;
  $('new-height').value = size;
});
$('new-ok').addEventListener('click', (e) => {
  e.preventDefault();
  const width = Number($('new-width').value);
  const height = Number($('new-height').value);
  const valid = [width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIZE);
  if (!valid) {
    $('new-width').reportValidity();
    $('new-height').reportValidity();
    return;
  }
  if (!okToDiscard()) return;
  setCanvas({ canvas: M.createCanvas(width, height), name: $('new-name').value.trim() });
  $('dlg-new').close();
  showView('editor');
  setStatus('');
});

/* ---------- login ---------- */

function renderUser() {
  const who = $('who');
  if (state.user) {
    who.textContent = `@${state.user.handle}`;
    who.hidden = false;
    $('nav-login').textContent = 'Logout';
  } else {
    who.hidden = true;
    $('nav-login').textContent = 'Login';
  }
}

function openLogin(reason = '') {
  $('login-error').textContent = reason;
  $('login-ok').disabled = false;
  $('dlg-login').showModal();
  $('login-handle').focus();
}

$('nav-login').addEventListener('click', async () => {
  if (!state.user) {
    openLogin();
    return;
  }
  try {
    await pds.signOut();
  } catch {
    /* the local session is gone either way */
  }
  state.user = null;
  renderUser();
  setStatus('Logged out.');
});

$('login-ok').addEventListener('click', async (e) => {
  e.preventDefault();
  const handle = $('login-handle').value.trim();
  if (!handle) {
    $('login-handle').reportValidity();
    return;
  }
  saveDraft();
  $('login-ok').disabled = true;
  $('login-error').textContent = 'Opening your sign-in page…';
  try {
    await pds.signIn(handle); // navigates away on success
  } catch (err) {
    $('login-error').textContent = `Could not start login: ${err.message}`;
    $('login-ok').disabled = false;
  }
});

window.addEventListener('pds-session-ended', () => {
  state.user = null;
  renderUser();
  setStatus('Your session ended. Log in again to save.', { error: true });
});

/* ---------- save ---------- */

let saving = false;

async function save() {
  if (saving) return;
  if (!state.user) {
    openLogin(state.authReady ? 'Log in to save this canvas to your PDS.' : 'Still checking your login. Try again in a moment.');
    return;
  }
  saving = true;
  $('btn-save').disabled = true;
  setStatus('Saving…');
  try {
    // A draft saved under another account must become a new record here.
    if (state.rkey && state.owner && state.owner !== state.user.did) state.rkey = null;
    const now = new Date().toISOString();
    const createdAt = state.createdAt || now;
    const record = M.toRecord(state.canvas, {
      name: state.name.trim(),
      createdAt,
      updatedAt: state.rkey ? now : undefined,
    });
    const before = JSON.stringify(record);
    state.rkey = await pds.saveCanvas(record, state.rkey);
    state.owner = state.user.did;
    state.createdAt = createdAt;
    // Only mark clean if nothing was drawn while the request was in flight.
    const after = JSON.stringify(M.toRecord(state.canvas, { name: state.name.trim(), createdAt, updatedAt: record.updatedAt }));
    state.dirty = before !== after;
    updateMeta();
    saveDraft();
    setStatus('Saved to your PDS.');
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, { error: true });
  } finally {
    saving = false;
    $('btn-save').disabled = false;
  }
}
$('btn-save').addEventListener('click', save);

/* ---------- share ---------- */

const SHARE_TARGET_PX = 1024;      // long side of the posted image
const SHARE_MAX_BYTES = 950_000;   // stay under Bluesky's per-image limit
let sharePng = null;
let shareSize = null;

function canvasToPng(scale) {
  const { width, height } = state.canvas;
  M.toRgba(state.canvas, imageData.data);
  offCtx.putImageData(imageData, 0, 0);
  const out = document.createElement('canvas');
  out.width = width * scale;
  out.height = height * scale;
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(off, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve({ blob: b, width: out.width, height: out.height }) : reject(new Error('Could not create the image.'))), 'image/png');
  });
}

async function buildSharePng() {
  const { width, height } = state.canvas;
  let scale = Math.max(1, Math.floor(SHARE_TARGET_PX / Math.max(width, height)));
  for (;;) {
    const result = await canvasToPng(scale);
    if (result.blob.size <= SHARE_MAX_BYTES || scale === 1) return result;
    scale = Math.max(1, Math.floor(scale / 2));
  }
}

$('btn-share').addEventListener('click', async () => {
  if (!state.user) {
    openLogin('Log in to share to Bluesky.');
    return;
  }
  try {
    const result = await buildSharePng();
    if (result.blob.size > SHARE_MAX_BYTES) throw new Error('The image is too large to post.');
    sharePng = result.blob;
    shareSize = { width: result.width, height: result.height };
    const preview = $('share-preview');
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(sharePng);
    const name = state.name.trim();
    $('share-text').value = name ? `${name} — made with Migxel Art` : 'Made with Migxel Art';
    $('share-error').textContent = '';
    $('share-ok').disabled = false;
    $('dlg-share').showModal();
  } catch (err) {
    setStatus(`Share failed: ${err.message}`, { error: true });
  }
});

$('share-ok').addEventListener('click', async (e) => {
  e.preventDefault();
  $('share-ok').disabled = true;
  $('share-error').textContent = 'Posting…';
  try {
    const { width, height } = state.canvas;
    const name = state.name.trim() || 'Untitled';
    const url = await pds.postImage({
      text: $('share-text').value,
      png: sharePng,
      alt: `Pixel art "${name}", ${width} by ${height} pixels.`,
      width: shareSize.width,
      height: shareSize.height,
    });
    $('dlg-share').close();
    setStatus('Posted to Bluesky.', { link: { href: url, text: 'View post' } });
  } catch (err) {
    $('share-error').textContent = `Post failed: ${err.message}`;
    $('share-ok').disabled = false;
  }
});

/* ---------- history ---------- */

let historyCursor = null;
let historyLoading = false;

function historyCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  const actions = document.createElement('div');
  actions.className = 'actions';

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn small';
  del.textContent = 'Delete';

  let canvas = null;
  let label = 'this canvas';
  try {
    canvas = M.fromRecord(item.value);
    label = `"${item.value.name || 'Untitled'}"`;
    const thumb = document.createElement('canvas');
    thumb.width = canvas.width;
    thumb.height = canvas.height;
    const data = new ImageData(M.toRgba(canvas), canvas.width, canvas.height);
    thumb.getContext('2d').putImageData(data, 0, 0);

    const title = document.createElement('h3');
    title.textContent = item.value.name || 'Untitled';
    const meta = document.createElement('span');
    meta.className = 'meta';
    const when = new Date(item.value.updatedAt || item.value.createdAt);
    const date = Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleDateString()}`;
    meta.textContent = `${canvas.width}×${canvas.height}${date}`;

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn small solid';
    open.textContent = 'Open';
    open.addEventListener('click', () => {
      if (!okToDiscard()) return;
      setCanvas({
        canvas: M.cloneCanvas(canvas),
        name: item.value.name || '',
        rkey: item.rkey,
        createdAt: item.value.createdAt,
      });
      showView('editor');
      setStatus('');
    });
    actions.append(open);
    card.append(thumb, title, meta);
  } catch (err) {
    card.classList.add('bad');
    card.append(`Record ${item.rkey} could not be read: ${err.message}`);
  }

  del.addEventListener('click', async () => {
    if (!confirm(`Delete ${label} from your PDS? This cannot be undone.`)) return;
    del.disabled = true;
    try {
      await pds.deleteCanvas(item.rkey);
      card.remove();
      if (state.rkey === item.rkey) {
        state.rkey = null;
        markDirty();
      }
    } catch (err) {
      $('history-status').textContent = `Delete failed: ${err.message}`;
      del.disabled = false;
    }
  });
  actions.append(del);
  card.append(actions);
  return card;
}

async function loadHistory(reset) {
  if (historyLoading) return;
  const status = $('history-status');
  if (reset) {
    $('cards').replaceChildren();
    historyCursor = null;
    $('history-more').hidden = true;
  }
  if (!state.user) {
    status.textContent = state.authReady ? 'Log in to see the canvases saved in your PDS.' : 'Checking your login…';
    return;
  }
  historyLoading = true;
  status.textContent = 'Loading…';
  try {
    const { items, cursor } = await pds.listCanvases(historyCursor);
    for (const item of items) $('cards').append(historyCard(item));
    historyCursor = items.length ? cursor || null : null;
    $('history-more').hidden = !historyCursor;
    status.textContent = $('cards').children.length ? '' : 'No saved canvases yet. Draw something and press Save.';
  } catch (err) {
    status.textContent = `Could not load your canvases: ${err.message}`;
  } finally {
    historyLoading = false;
  }
}
$('history-refresh').addEventListener('click', () => loadHistory(true));
$('history-more').addEventListener('click', () => loadHistory(false));

/* ---------- start ---------- */

async function start() {
  buildSwatches();
  const restored = loadDraft();
  state.zoom = fitZoom();
  $('canvas-name').value = state.name;
  resetSurface();
  updateMeta();
  renderColors();
  renderUser();
  if (restored && state.dirty) setStatus('Restored your unsaved drawing.');

  try {
    const auth = await pds.initAuth();
    if (auth) {
      state.user = { did: auth.did, handle: auth.did };
      renderUser();
      try {
        state.user.handle = await pds.getHandle();
        renderUser();
      } catch {
        /* keep showing the DID */
      }
    }
  } catch (err) {
    setStatus(`Login is unavailable: ${err.message}`, { error: true });
  } finally {
    state.authReady = true;
    if (!$('view-history').hidden) loadHistory(true);
  }
}

start();
