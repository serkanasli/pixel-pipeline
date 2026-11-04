// Background removal for frames rendered on a flat background.
// - background colour: median of the frame border
// - background region: flood fill from the border through pixels close to that colour
//   (the dark outline stops the fill, so light colours inside the figure are never removed)
// - enclosed pockets (e.g. between crossing legs) are cleared when they hold enough
//   pure-background pixels
// - optional fringe pass: light anti-aliasing/JPEG halo touching the background is peeled off
// - soft edge: alpha ramps with colour distance, edge colour is decontaminated from the background
// - detached specks smaller than ISLAND_MIN of the main body are removed
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { listFrames } from './util.mjs';

const ALPHA_LO = 10; // distance at or below this is fully transparent
const ALPHA_HI = 40; // distance at or above this is fully opaque
const ISLAND_MIN = 0.002; // fraction of the largest component
const POCKET_MIN = 20; // enclosed region needs this many pure-background pixels to be cleared
const FRINGE_PASSES = 3; // a halo is at most this many pixels thick; the dark outline stops it sooner

// Per pose / layer settings ("key" in item.json). flood: max channel distance the flood may
// cross; pockets: clear enclosed background pockets; fringe: max distance of the halo pixels
// peeled off (0 = off). Light figures on a similar background (silver hair on grey) need a low
// flood and no pockets, with the fringe pass cleaning the edge instead.
export const KEY_DEFAULTS = { flood: 42, pockets: true, fringe: 0 };
export const KEY_LIMITS = { flood: [0, 255], fringe: [0, 255] };

// true, undefined or a partial object -> full settings; false stays false (no removal).
export const keyOptions = (key) => (key === false ? false : { ...KEY_DEFAULTS, ...(typeof key === 'object' && key ? key : {}) });

// Cache name suffix: '' for the defaults, so caches made before these settings stay valid.
export function keyTag(key) {
  const o = keyOptions(key);
  if (!o || Object.keys(KEY_DEFAULTS).every((k) => o[k] === KEY_DEFAULTS[k])) return '';
  const json = JSON.stringify(Object.keys(KEY_DEFAULTS).map((k) => o[k]));
  return `-k${crypto.createHash('sha1').update(json).digest('hex').slice(0, 8)}`;
}

const median = (a) => Float64Array.from(a).sort()[a.length >> 1];

export async function keyFrame(file, outFile, key) {
  const { flood, pockets, fringe } = keyOptions(key);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const n = w * h;

  const br = [], bgc = [], bb = [];
  for (let x = 0; x < w; x++) for (const y of [0, 1, h - 2, h - 1]) { const o = (y * w + x) * 4; br.push(data[o]); bgc.push(data[o + 1]); bb.push(data[o + 2]); }
  for (let y = 0; y < h; y++) for (const x of [0, 1, w - 2, w - 1]) { const o = (y * w + x) * 4; br.push(data[o]); bgc.push(data[o + 1]); bb.push(data[o + 2]); }
  const bg = [median(br), median(bgc), median(bb)];

  const dist = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    dist[i] = Math.max(Math.abs(data[o] - bg[0]), Math.abs(data[o + 1] - bg[1]), Math.abs(data[o + 2] - bg[2]));
  }

  const isBg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i) => { if (!isBg[i] && dist[i] <= flood) { isBg[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp], x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < n - w) push(i + w);
  }

  const region = new Int32Array(n);
  for (let s = 0; pockets && s < n; s++) {
    if (isBg[s] || dist[s] > ALPHA_LO) continue;
    let count = 0, pure = 0;
    sp = 0; stack[sp++] = s; isBg[s] = 2;
    while (sp > 0) {
      const i = stack[--sp];
      region[count++] = i;
      if (dist[i] <= ALPHA_LO) pure++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) {
        if (j >= 0 && !isBg[j] && dist[j] <= flood) { isBg[j] = 2; stack[sp++] = j; }
      }
    }
    if (pure < POCKET_MIN) for (let k = 0; k < count; k++) isBg[region[k]] = 3; // too small: keep opaque
  }
  for (let i = 0; i < n; i++) if (isBg[i] === 3) isBg[i] = 0;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = isBg[i] ? Math.min(1, Math.max(0, (dist[i] - ALPHA_LO) / (ALPHA_HI - ALPHA_LO))) : 1;

  // Halo pixels next to the cleared background, one ring per pass so a dark outline stops it.
  for (let pass = 0; fringe && pass < FRINGE_PASSES; pass++) {
    sp = 0;
    for (let i = 0; i < n; i++) {
      if (alpha[i] <= 0 || dist[i] > fringe) continue;
      const x = i % w;
      if ((x > 0 && alpha[i - 1] <= 0) || (x < w - 1 && alpha[i + 1] <= 0) || (i >= w && alpha[i - w] <= 0) || (i < n - w && alpha[i + w] <= 0)) stack[sp++] = i;
    }
    if (!sp) break;
    for (let k = 0; k < sp; k++) alpha[stack[k]] = 0;
  }

  const label = new Int32Array(n).fill(-1);
  const sizes = [];
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || alpha[s] <= 0.5) continue;
    const id = sizes.length;
    let size = 0;
    sp = 0; stack[sp++] = s; label[s] = id;
    while (sp > 0) {
      const i = stack[--sp]; size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) {
        if (j >= 0 && label[j] === -1 && alpha[j] > 0.5) { label[j] = id; stack[sp++] = j; }
      }
    }
    sizes.push(size);
  }
  const largest = sizes.length ? Math.max(...sizes) : 0;
  const keep = sizes.map((s) => s >= largest * ISLAND_MIN);

  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    let a = alpha[i];
    if (label[i] >= 0 && !keep[label[i]]) a = 0;
    const o = i * 4;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const v = a < 1 ? (data[o + c] - (1 - a) * bg[c]) / a : data[o + c];
      out[o + c] = Math.max(0, Math.min(255, Math.round(v)));
    }
    out[o + 3] = Math.round(a * 255);
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(outFile);
  return bg;
}

// Keys every fNNN.png of srcDir into outDir; returns the background colour of the first frame.
export async function keyDir(srcDir, outDir, key) {
  fs.mkdirSync(outDir, { recursive: true });
  let first = null;
  for (const f of listFrames(srcDir)) {
    const bg = await keyFrame(path.join(srcDir, f), path.join(outDir, f), key);
    first ??= bg;
  }
  return first;
}
