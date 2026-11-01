// Turns keyed frames into true pixel art: one pixel grid and one palette for the whole item.
// - grid: every frame is downscaled by the same factor (source px per art pixel)
// - alpha: hard edge (>= 50% opaque), no anti-aliasing
// - palette: k-means over the opaque pixels of all frames of all poses together, so a colour
//   cannot change from frame to frame or pose to pose; no dithering
// - specks: opaque islands of at most SPECK pixels are dropped
import path from 'node:path';
import sharp from 'sharp';

const ITER = 15;
const SPECK = 12;
const SAMPLE_MAX = 400000; // palette is fitted on at most this many pixels

// jobs: [{ file, out }]; returns { width, height, palette: ['#rrggbb', …] }
export async function pixelize(jobs, factor, colors) {
  const meta = await sharp(jobs[0].file).metadata();
  const W = Math.round(meta.width / factor), H = Math.round(meta.height / factor);

  const frames = [];
  for (const job of jobs) {
    const data = await sharp(job.file).resize(W, H, { kernel: 'cubic' }).ensureAlpha().raw().toBuffer();
    frames.push({ ...job, data });
  }

  const px = [];
  for (const { data } of frames) for (let i = 0; i < W * H; i++) if (data[i * 4 + 3] >= 128) px.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  const sample = px.length > SAMPLE_MAX ? px.filter((_, i) => i % Math.ceil(px.length / SAMPLE_MAX) === 0) : px;
  const pal = kmeans(sample, colors);

  for (const { data, out } of frames) {
    const buf = Buffer.alloc(W * H * 4);
    const drop = specks(data, W, H);
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] < 128 || drop[i]) continue;
      const p = pal[nearest(pal, data[i * 4], data[i * 4 + 1], data[i * 4 + 2])];
      buf[i * 4] = p[0]; buf[i * 4 + 1] = p[1]; buf[i * 4 + 2] = p[2]; buf[i * 4 + 3] = 255;
    }
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
  }
  return { width: W, height: H, palette: pal.map((p) => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('')) };
}

function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < pal.length; k++) {
    const d = (r - pal[k][0]) ** 2 + (g - pal[k][1]) ** 2 + (b - pal[k][2]) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// Seeded at luminance quantiles so the result is deterministic.
function kmeans(px, K) {
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  let pal = Array.from({ length: K }, (_, k) => [...sorted[Math.floor(((k + 0.5) / K) * sorted.length)]]);
  for (let it = 0; it < ITER; it++) {
    const sum = pal.map(() => [0, 0, 0, 0]);
    for (const c of px) { const k = nearest(pal, c[0], c[1], c[2]); sum[k][0] += c[0]; sum[k][1] += c[1]; sum[k][2] += c[2]; sum[k][3]++; }
    pal = pal.map((p, k) => (sum[k][3] ? sum[k].slice(0, 3).map((v) => v / sum[k][3]) : p));
  }
  return pal.map((p) => p.map(Math.round));
}

function specks(data, W, H) {
  const drop = new Uint8Array(W * H), seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || data[s * 4 + 3] < 128) continue;
    const comp = [s]; seen[s] = 1;
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j >= 0 && j < W * H && !seen[j] && data[j * 4 + 3] >= 128) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length <= SPECK) for (const i of comp) drop[i] = 1;
  }
  return drop;
}

export const pixelFile = (dir, pose, i) => path.join(dir, `${pose}_${i + 1}.png`);
