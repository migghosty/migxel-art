// Canvas data model: a palette plus one palette index per pixel.
// Pure functions, no DOM, so it can be unit-tested in Node.

import { CANVAS_COLLECTION, MAX_SIZE, MAX_COLORS, BACKGROUND } from './config.js';

const HEX = /^#[0-9a-f]{6}$/;

export function normalizeHex(color) {
  const c = String(color).trim().toLowerCase();
  if (!HEX.test(c)) throw new Error(`Not a #rrggbb color: ${color}`);
  return c;
}

export function createCanvas(width, height, background = BACKGROUND) {
  assertSize(width, height);
  return {
    width,
    height,
    palette: [normalizeHex(background)],
    pixels: new Uint8Array(width * height), // all index 0 = background
  };
}

export function cloneCanvas(c) {
  return { width: c.width, height: c.height, palette: [...c.palette], pixels: c.pixels.slice() };
}

function assertSize(width, height) {
  for (const n of [width, height]) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_SIZE) {
      throw new Error(`Canvas width and height must be whole numbers from 1 to ${MAX_SIZE}.`);
    }
  }
}

// Returns the palette index for a color, adding it if needed.
// Returns -1 when the canvas already uses MAX_COLORS distinct colors.
export function colorIndex(canvas, color) {
  const c = normalizeHex(color);
  let i = canvas.palette.indexOf(c);
  if (i !== -1) return i;
  if (canvas.palette.length >= MAX_COLORS) {
    compact(canvas); // drop colors no pixel uses any more
    if (canvas.palette.length >= MAX_COLORS) return -1;
  }
  canvas.palette.push(c);
  return canvas.palette.length - 1;
}

// Removes unused palette entries and renumbers pixels. Mutates the canvas.
export function compact(canvas) {
  const used = new Uint8Array(canvas.palette.length);
  for (const p of canvas.pixels) used[p] = 1;
  const remap = new Int16Array(canvas.palette.length).fill(-1);
  const palette = [];
  for (let i = 0; i < used.length; i++) {
    if (used[i]) {
      remap[i] = palette.length;
      palette.push(canvas.palette[i]);
    }
  }
  for (let i = 0; i < canvas.pixels.length; i++) canvas.pixels[i] = remap[canvas.pixels[i]];
  canvas.palette = palette;
  return canvas;
}

export function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s).replace(/=+$/, ''); // atproto $bytes: base64, padding optional
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Builds the JSON record that is written to the PDS.
export function toRecord(canvas, { name, createdAt, updatedAt } = {}) {
  const c = compact(cloneCanvas(canvas));
  const record = {
    $type: CANVAS_COLLECTION,
    width: c.width,
    height: c.height,
    palette: c.palette,
    pixels: { $bytes: bytesToBase64(c.pixels) },
    createdAt: createdAt || new Date().toISOString(),
  };
  if (name) record.name = name;
  if (updatedAt) record.updatedAt = updatedAt;
  return record;
}

// Validates a record value read from a PDS and turns it into a canvas.
// Throws with a readable message if the record does not match the lexicon.
export function fromRecord(value) {
  if (!value || typeof value !== 'object') throw new Error('Record is empty.');
  const { width, height, palette } = value;
  assertSize(width, height);
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > MAX_COLORS) {
    throw new Error('Record has an invalid palette.');
  }
  const cleanPalette = palette.map(normalizeHex);
  const b64 = value.pixels && value.pixels.$bytes;
  if (typeof b64 !== 'string') throw new Error('Record has no pixel data.');
  let pixels;
  try {
    pixels = base64ToBytes(b64);
  } catch {
    throw new Error('Record pixel data is not valid base64.');
  }
  if (pixels.length !== width * height) {
    throw new Error(`Record has ${pixels.length} pixels but ${width}x${height} needs ${width * height}.`);
  }
  for (const p of pixels) {
    if (p >= cleanPalette.length) throw new Error('Record has a pixel that points outside its palette.');
  }
  return { width, height, palette: cleanPalette, pixels };
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Fills an RGBA buffer (width * height * 4 bytes) from the canvas.
export function toRgba(canvas, out = new Uint8ClampedArray(canvas.width * canvas.height * 4)) {
  const rgb = canvas.palette.map(hexToRgb);
  const px = canvas.pixels;
  for (let i = 0, j = 0; i < px.length; i++, j += 4) {
    const c = rgb[px[i]];
    out[j] = c[0];
    out[j + 1] = c[1];
    out[j + 2] = c[2];
    out[j + 3] = 255;
  }
  return out;
}

// Calls plot(x, y) for every cell on the line between two cells.
export function line(x0, y0, x1, y1, plot) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Flood fill from (x, y) with palette index `to`. Returns true if anything changed.
export function floodFill(canvas, x, y, to) {
  const { width, height, pixels } = canvas;
  const from = pixels[y * width + x];
  if (from === to) return false;
  const stack = [y * width + x];
  while (stack.length) {
    const i = stack.pop();
    if (pixels[i] !== from) continue;
    pixels[i] = to;
    const cx = i % width;
    if (cx > 0) stack.push(i - 1);
    if (cx < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  return true;
}
