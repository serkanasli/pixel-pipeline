// Shared helpers: frame file names, file keys, image measurement.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const frameName = (i) => `f${String(i).padStart(3, '0')}.png`;
// Numeric order: clips longer than 1000 frames get f1000.png, which sorts before f101.png as text.
export const listFrames = (dir) => fs.readdirSync(dir).filter((f) => /^f\d+\.png$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

export function fileKey(file) {
  const st = fs.statSync(file);
  return crypto.createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 10);
}

// `rel` resolved inside `root`; throws when it would leave it, symlinks included. Paths that do
// not exist yet are checked through their nearest existing parent.
export function resolveInside(root, rel) {
  const abs = path.resolve(root, rel);
  const rootReal = fs.realpathSync(root);
  let probe = abs, rest = '';
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) { rest = path.join(path.basename(probe), rest); probe = path.dirname(probe); }
  const real = path.join(fs.realpathSync(probe), rest);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
  return abs;
}

export const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Opaque bounding box, centroid and lowest opaque row of an RGBA buffer.
export function measure(data, w, h, threshold = 127) {
  let minX = w, maxX = -1, minY = h, maxY = -1, sx = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] <= threshold) continue;
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    sx += x; n++;
  }
  return n ? { minX, maxX, minY, maxY, cx: sx / n, area: n, width: maxX - minX + 1, height: maxY - minY + 1 } : null;
}

export async function readRGBA(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

// Premultiplied colour + alpha difference between two equally sized RGBA buffers.
export function frameDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] / 255, ba = b[i + 3] / 255;
    s += Math.abs(a[i] * aa - b[i] * ba) + Math.abs(a[i + 1] * aa - b[i + 1] * ba) + Math.abs(a[i + 2] * aa - b[i + 2] * ba) + 3 * Math.abs(a[i + 3] - b[i + 3]);
  }
  return s / (a.length / 4);
}

export const round = (v, d = 1) => +v.toFixed(d);
