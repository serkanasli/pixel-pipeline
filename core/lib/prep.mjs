// Start frame for a video model: the anchor image on a 16:9 canvas of one flat background
// colour, with room around the figure (tails and arms swing outside the anchor's outline).
import sharp from 'sharp';
import { measure } from './util.mjs';

const TOLERANCE = 14; // background pixels within this channel distance become exactly the background colour

export async function prepStart(input, output, { width = 1600, height = 900, below = 0.2, maxFigure = 0.66 } = {}) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const border = [[], [], []];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) for (let k = 0; k < 3; k++) border[k].push(data[(y * w + x) * 4 + k]);
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) for (let k = 0; k < 3; k++) border[k].push(data[(y * w + x) * 4 + k]);
  const bg = border.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);

  // Flood fill from the border: background becomes exactly bg and transparent in the mask.
  const near = (i) => Math.max(...[0, 1, 2].map((k) => Math.abs(data[i * 4 + k] - bg[k]))) <= TOLERANCE;
  const seen = new Uint8Array(n), stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (seen[i] || !near(i)) continue;
    seen[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1); if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w); if (i < n - w) stack.push(i + w);
  }
  const fig = Buffer.from(data);
  for (let i = 0; i < n; i++) if (seen[i]) { fig[i * 4] = bg[0]; fig[i * 4 + 1] = bg[1]; fig[i * 4 + 2] = bg[2]; fig[i * 4 + 3] = 0; }
  const m = measure(fig, w, h, 0);
  if (!m) throw new Error('no figure found on the background');

  // Fit the figure (never upscale more than needed), bottom at (1 - below) of the canvas.
  const scale = Math.min(1, (maxFigure * height) / m.height, (0.8 * width) / m.width);
  const crop = await sharp(fig, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: m.minX, top: m.minY, width: m.width, height: m.height })
    .resize(Math.round(m.width * scale), Math.round(m.height * scale), { kernel: 'nearest' })
    .png().toBuffer({ resolveWithObject: true });
  const left = Math.round((width - crop.info.width) / 2);
  const top = Math.round(height * (1 - below) - crop.info.height);
  await sharp({ create: { width, height, channels: 3, background: { r: bg[0], g: bg[1], b: bg[2] } } })
    .composite([{ input: crop.data, left, top: Math.max(0, top) }])
    .png().toFile(output);
  return { output, background: '#' + bg.map((v) => v.toString(16).padStart(2, '0')).join(''), figure: { x: left, y: Math.max(0, top), w: crop.info.width, h: crop.info.height }, scale: +scale.toFixed(3) };
}
