// Start frames: the image a pose's video is generated from (start-frames/<pose>.png).
// - startsFrom "anchor": the anchor image placed on a 16:9 canvas (prep.mjs)
// - startsFrom another pose: that pose's chosen frame, raw from the video (not keyed, so the
//   model sees exactly what the previous clip showed), background made one flat colour, 16:9
// Next to each image, <pose>.json records what it was made from. When that no longer matches
// the item (another anchor, the source pose's range or video changed) the start frame is stale.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { progress, UserError } from './log.mjs';
import { flattenBackground, hex, prepStart } from './prep.mjs';
import { byName, continuation, itemPath, poseClip, poseVideo } from './poses.mjs';
import { START_DEFAULTS } from './schema.mjs';
import { fileKey, listFrames } from './util.mjs';

export const startFramePaths = (item, pose) => ({
  image: itemPath(item, `start-frames/${pose}.png`),
  meta: itemPath(item, `start-frames/${pose}.json`),
  rel: `start-frames/${pose}.png`,
});

// What the start frame of pose `p` must be made from right now, or { blocked } with the reason.
export function expectedSource(item, p) {
  const s = { ...START_DEFAULTS, ...p.start };
  if (p.startsFrom === 'anchor') {
    if (!item.anchor) return { blocked: 'no-anchor', message: 'the item has no anchor image yet' };
    const abs = itemPath(item, item.anchor);
    if (!fs.existsSync(abs)) return { blocked: 'no-anchor', message: `anchor image not found: ${item.anchor}` };
    return { source: 'anchor', anchor: item.anchor, anchorKey: fileKey(abs), below: s.below, maxFigure: s.maxFigure, width: s.width, height: s.height };
  }
  const ref = byName(item, p.startsFrom.pose);
  const v = poseVideo(item, ref);
  if (!v.exists) return { blocked: 'source-video', pose: ref.name, message: `${ref.name} has no video yet` };
  if (!ref.range) return { blocked: 'source-range', pose: ref.name, message: `choose the range of ${ref.name} first` };
  const c = continuation(ref, p.startsFrom.frame, ref.range);
  return { source: 'pose', pose: ref.name, frame: p.startsFrom.frame, sourceFrame: c.sourceFrame, video: v.rel, videoKey: fileKey(v.abs), width: s.width, height: s.height };
}

const SOURCE_KEYS = ['source', 'anchor', 'anchorKey', 'below', 'maxFigure', 'pose', 'frame', 'sourceFrame', 'video', 'videoKey', 'width', 'height'];
const sameSource = (a, b) => SOURCE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

// { state: 'none' | 'missing' | 'stale' | 'ready' | 'blocked', … } for one pose.
export function startFrameState(item, p) {
  if (p.kind === 'still') return { state: 'none' };
  const files = startFramePaths(item, p.name);
  const expected = expectedSource(item, p);
  const made = fs.existsSync(files.meta) && fs.existsSync(files.image) ? JSON.parse(fs.readFileSync(files.meta, 'utf8')) : null;
  if (expected.blocked) return { state: made ? 'stale' : 'blocked', blocked: expected, file: made ? files.rel : null, made };
  if (!made) return { state: 'missing', expected };
  return { state: sameSource(made, expected) ? 'ready' : 'stale', file: files.rel, made, expected };
}

export async function makeStartFrame(item, poseName) {
  const p = byName(item, poseName);
  if (!p) throw new UserError(`unknown pose "${poseName}"`);
  if (p.kind === 'still') throw new UserError(`${p.name} is a still: it takes a frame of ${p.startsFrom.pose} and has no video, so it needs no start frame`);
  const expected = expectedSource(item, p);
  if (expected.blocked) throw new UserError(`${p.name}: cannot make the start frame, ${expected.message}`);
  const files = startFramePaths(item, p.name);
  fs.mkdirSync(path.dirname(files.image), { recursive: true });
  progress('start frame', `${p.name} from ${expected.source === 'anchor' ? expected.anchor : `${expected.pose} frame ${expected.sourceFrame}`}`);
  let made;
  if (expected.source === 'anchor') {
    const r = await prepStart(itemPath(item, item.anchor), files.image, expected);
    made = { background: r.background, figure: r.figure };
  } else {
    const clip = await poseClip(item, byName(item, expected.pose));
    const name = listFrames(clip.src)[expected.sourceFrame];
    if (!name) throw new UserError(`${expected.pose}: frame ${expected.sourceFrame} does not exist in ${expected.video}`);
    made = await chainedFrame(path.join(clip.src, name), files.image, expected);
  }
  const meta = { ...expected, ...made, image: files.rel, madeAt: new Date().toISOString() };
  fs.writeFileSync(files.meta, JSON.stringify(meta, null, 1) + '\n');
  return meta;
}

// Fit the source frame into width×height (16:9) without cropping; any letterbox is filled with
// the frame's background colour, then the whole background is made exactly that colour.
async function chainedFrame(input, output, { width, height }) {
  const meta = await sharp(input).metadata();
  const scale = Math.min(width / meta.width, height / meta.height);
  const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
  const resized = await sharp(input).resize(w, h, { kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer();
  const first = flattenBackground(resized, w, h);
  const canvas = await sharp({ create: { width, height, channels: 4, background: { r: first.bg[0], g: first.bg[1], b: first.bg[2], alpha: 1 } } })
    .composite([{ input: first.flat, raw: { width: w, height: h, channels: 4 }, left: Math.round((width - w) / 2), top: Math.round((height - h) / 2) }])
    .raw().toBuffer();
  const { bg, flat, figure } = flattenBackground(canvas, width, height);
  if (!figure) throw new UserError('no figure found in the source frame');
  await sharp(flat, { raw: { width, height, channels: 4 } }).removeAlpha().png().toFile(output);
  return { background: hex(bg), figure: { x: figure.minX, y: figure.minY, w: figure.width, h: figure.height } };
}
