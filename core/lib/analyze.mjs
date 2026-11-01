// Measurements on keyed frames and the automatic choices made from them:
// loop points, walking speed, and the useful range of one-shot clips.
import path from 'node:path';
import sharp from 'sharp';
import { frameDiff, listFrames, measure, round } from './util.mjs';

const THUMB = 4; // downscale factor for frame comparisons
const BAND = 8; // px above the lowest opaque row that count as touching the ground

// Per frame: bbox, centroid, lowest row, a small thumbnail for comparisons, and ground-contact blobs.
export async function measureClip(keyDir) {
  const frames = [];
  for (const f of listFrames(keyDir)) {
    const { data, info } = await sharp(path.join(keyDir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const m = measure(data, w, h);
    const thumb = await sharp(path.join(keyDir, f)).resize(Math.round(w / THUMB), Math.round(h / THUMB)).ensureAlpha().raw().toBuffer();
    frames.push({ f, w, h, m, thumb, contacts: m ? contacts(data, w, m.maxY) : [] });
  }
  const motion = frames.slice(1).map((fr, i) => round(frameDiff(frames[i].thumb, fr.thumb), 2));
  return { frames, motion };
}

function contacts(data, w, ground) {
  const cols = new Uint8Array(w);
  for (let y = Math.max(0, ground - BAND); y <= ground; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 127) cols[x] = 1;
  const blobs = [];
  for (let x = 0; x < w; x++) {
    if (!cols[x]) continue;
    let e = x; while (e + 1 < w && cols[e + 1]) e++;
    if (e - x >= 3) blobs.push((x + e) / 2);
    x = e;
  }
  return blobs;
}

const diffAt = (clip, a, b) => frameDiff(clip.frames[a].thumb, clip.frames[b].thumb);

// Best (start, length) whose first and last frames match. Lengths divisible by `step` are
// preferred so the loop samples cleanly at 24/step fps.
export function findLoop(clip, { minLen = 12, maxLen = 60, step = 2, from = 0, to = clip.frames.length - 1 } = {}) {
  const cands = [];
  for (let L = minLen; L <= maxLen; L++) {
    if (L % step) continue;
    for (let s = from; s + L <= to; s++) cands.push({ start: s, length: L, score: diffAt(clip, s, s + L) });
  }
  cands.sort((a, b) => a.score - b.score);
  return cands.slice(0, 5).map((c) => ({ ...c, score: round(c.score, 2) }));
}

// Walking speed in source px per frame: planted paws slide backwards (to the right for a
// figure facing left) at the walking speed while the tracking camera keeps the body still.
export function groundSpeed(clip, from, to, facing = 'left') {
  const dir = facing === 'left' ? 1 : -1;
  const moves = [];
  for (let t = from; t < to; t++) {
    for (const c of clip.frames[t].contacts) {
      let best = null;
      for (const d of clip.frames[t + 1].contacts) if (best === null || Math.abs(d - c) < Math.abs(best - c)) best = d;
      if (best !== null && Math.abs(best - c) < 25) moves.push((best - c) * dir);
    }
  }
  const pos = moves.filter((d) => d > 0.3).sort((a, b) => a - b);
  return { speed: pos.length ? pos[pos.length >> 1] : 0, samples: pos.length };
}

// One-shot clip that settles into a new pose (curl up, sit down, intro): from just before the
// motion starts until it stops changing. Ambient detail (smoke, hair) keeps a small noise floor.
export function transitionRange(clip) {
  const n = clip.frames.length, last = n - 1;
  const toLast = clip.frames.map((_, i) => diffAt(clip, i, last));
  const tail = toLast.slice(Math.floor(n * 0.8)).sort((a, b) => a - b);
  const settleNoise = tail[tail.length >> 1];
  let end = last;
  for (let i = 0; i < n; i++) if (toLast[i] <= settleNoise * 1.5 + 1) { end = i; break; }
  // Start: the frame before the figure first moves away from its opening pose. Video models
  // often repeat the first frame a few times, so the noise floor comes from frames 1–2.
  const toFirst = clip.frames.map((_, i) => diffAt(clip, 0, i));
  const startNoise = Math.max(toFirst[1] ?? 0, toFirst[2] ?? 0) * 2 + 2;
  let start = 0;
  for (let i = 1; i < n; i++) if (toFirst[i] > startNoise) { start = i - 1; break; }
  return { start, end, settleNoise: round(settleNoise, 2) };
}

// One-shot clip that returns to its first pose (tail wag, wave): from the first frame until the
// frame after the biggest change that is closest to the first frame again.
export function reactionRange(clip) {
  const n = clip.frames.length;
  const toFirst = clip.frames.map((_, i) => diffAt(clip, 0, i));
  let peak = 0;
  for (let i = 1; i < n; i++) if (toFirst[i] > toFirst[peak]) peak = i;
  let end = n - 1;
  for (let i = peak + 1; i < n; i++) if (toFirst[i] < toFirst[end]) end = i;
  return { start: 0, end, returnScore: round(toFirst[end], 2), peak };
}
