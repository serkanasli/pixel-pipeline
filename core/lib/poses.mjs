// Per-pose facts shared by make, status, start frames and the range picker: which video a pose
// uses, its measured clip, the range in effect (chosen or suggested), the frames it plays and the
// source frame another pose continues from.
import fs from 'node:fs';
import path from 'node:path';
import { analyzeClip, groundSpeed } from './analyze.mjs';
import { extract, SOURCE_FPS } from './frames.mjs';
import { prepareImage } from './images.mjs';
import { UserError } from './log.mjs';
import { LOOPING } from './schema.mjs';
import { fileKey, resolveInside, round } from './util.mjs';

export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm'];
export const DEFAULT_PIXEL_WIDTH = 170;

// A path from item.json, resolved inside the item folder; never outside it (symlinks included).
export function itemPath(item, rel) {
  const abs = resolveInside(item.__dir, rel);
  if (!abs) throw new UserError(`path leaves the item folder: ${rel}`);
  return abs;
}

export const byName = (item, name) => item.poses.find((p) => p.name === name);
export const stepOf = (p) => SOURCE_FPS / (p.fps ?? 12);

// The pose's video: "video" when set, otherwise videos/<pose name>.<mp4|mov|m4v|webm> when such a
// file exists. The convention lets the CLI, an agent or Finder add a video by just saving it.
export function poseVideo(item, p) {
  if (p.kind === 'still') return null;
  if (p.video) { const abs = itemPath(item, p.video); return { rel: p.video, abs, exists: fs.existsSync(abs), explicit: true }; }
  for (const ext of VIDEO_EXTS) {
    const rel = `videos/${p.name}${ext}`, abs = itemPath(item, rel);
    if (fs.existsSync(abs)) return { rel, abs, exists: true, explicit: false };
  }
  return { rel: `videos/${p.name}.mp4`, abs: itemPath(item, `videos/${p.name}.mp4`), exists: false, explicit: false };
}

// The image of a still pose that has "image": the anchor or a file in the item folder.
export function poseImage(item, p) {
  if (!p.image) return null;
  const rel = p.image === 'anchor' ? item.anchor ?? null : p.image;
  if (!rel) return { rel: null, abs: null, exists: false, anchor: true };
  const abs = itemPath(item, rel);
  return { rel, abs, exists: fs.existsSync(abs), anchor: p.image === 'anchor' };
}

// Where a still's frame comes from, for messages.
export const stillSource = (p) => (p.image === 'anchor' ? 'the anchor image' : p.image ? p.image : `a frame of ${p.startsFrom.pose}`);

// Extracted frames + analysis of the pose's video, memoised on the item object.
export async function poseClip(item, p) {
  const v = poseVideo(item, p);
  if (!v?.exists) return null;
  if (!item.__clips) Object.defineProperty(item, '__clips', { value: new Map(), enumerable: false });
  const memo = item.__clips;
  if (!memo.has(v.abs)) {
    const ex = await extract(v.abs, path.join(item.__dir, '.pixel-cache'));
    memo.set(v.abs, { ...ex, ...(await analyzeClip(ex)), video: v });
  }
  return memo.get(v.abs);
}

// The analysis of the pose's video if it was already made; never extracts frames. Lets status
// show suggestions without making a listing of items wait for ffmpeg.
export function cachedAnalysis(item, p) {
  const v = poseVideo(item, p);
  if (!v?.exists) return null;
  const file = path.join(item.__dir, '.pixel-cache', `${path.basename(v.abs, path.extname(v.abs))}-${fileKey(v.abs)}`, 'analysis.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// { range, explicit, suggestion } — the chosen range, or the suggestion when none is chosen.
export function effectiveRange(p, clip) {
  const s = clip.suggestions[p.kind]?.[stepOf(p)] ?? null;
  if (p.range) return { range: [...p.range], explicit: true, suggestion: s };
  if (!s) return { range: null, explicit: false, suggestion: null };
  return { range: [s.start, s.end], explicit: false, suggestion: s };
}

// Source frames a pose plays. Looping kinds stop one step before the end frame (it equals the start).
export function sampledFrames(p, range) {
  const step = stepOf(p), end = LOOPING.has(p.kind) ? range[1] - 1 : range[1], out = [];
  for (let i = range[0]; i <= end; i += step) out.push(i);
  return out;
}

export function checkRange(p, clip, range) {
  const n = clip.frames.length;
  if (range[1] > n - 1) throw new UserError(`${p.name}: range ${range[0]}–${range[1]} goes past the last frame of the video (${n - 1})`);
  if (sampledFrames(p, range).length < (p.kind === 'still' ? 1 : 2)) throw new UserError(`${p.name}: range ${range[0]}–${range[1]} holds fewer than 2 frames at ${p.fps ?? 12} fps`);
}

// Where in its source pose a pose continues: { pose, sourceFrame, index } with index into the
// source pose's played frames (nearest one when a source frame number between steps is given).
export function continuation(ref, frame, range) {
  const list = sampledFrames(ref, range);
  const sourceFrame = frame === 'first' ? list[0] : frame === 'last' ? list.at(-1) : frame;
  let index = 0;
  list.forEach((f, i) => { if (Math.abs(f - sourceFrame) < Math.abs(list[index] - sourceFrame)) index = i; });
  return { pose: ref.name, sourceFrame, index };
}

// The pose whose first played frame sets the pixel grid: "referencePose", else the first pose with a video.
export const referencePose = (item) => (item.referencePose ? byName(item, item.referencePose) : item.poses.find((p) => p.kind !== 'still'));

// Source px per art pixel, from the figure width in the reference pose's first played frame.
// An item without videos is measured from its images instead.
export async function gridFactor(item) {
  const ref = referencePose(item);
  if (!ref) return imageFactor(item);
  const clip = await poseClip(item, ref);
  if (!clip) throw new UserError(`${ref.name}: the reference pose has no video yet; the pixel grid is measured from it`);
  const { range } = effectiveRange(ref, clip);
  if (!range) throw new UserError(`${ref.name}: no range could be found in the video`);
  const m = clip.frames[range[0]].m;
  if (!m) throw new UserError(`${ref.name}: frame ${range[0]} is empty after background removal`);
  return m.width / (item.pixelWidth ?? DEFAULT_PIXEL_WIDTH);
}

// Source px per art pixel for images. Images are taken at the anchor's scale: the figure in the
// anchor is pixelWidth art pixels wide, the same as the reference pose's first frame (which
// normally starts from the anchor). Without an anchor the first still image sets the scale.
export async function imageFactor(item) {
  let abs = item.anchor ? itemPath(item, item.anchor) : null;
  if (!abs || !fs.existsSync(abs)) abs = item.poses.map((p) => poseImage(item, p)).find((i) => i?.exists)?.abs ?? null;
  if (!abs) throw new UserError('the pixel grid is measured from the anchor image or a still image, and neither is there yet');
  const img = await prepareImage(abs, path.join(item.__dir, '.pixel-cache'));
  return img.m.width / (item.pixelWidth ?? DEFAULT_PIXEL_WIDTH);
}

// Stride (pt) and speed (pt/s) of a locomotion range: planted feet slide back at walking speed.
export async function measureLocomotion(item, p, range) {
  const clip = await poseClip(item, p);
  const factor = await gridFactor(item);
  const gs = groundSpeed(clip, range[0], range[1] - 1, item.facing ?? 'left');
  const length = range[1] - range[0];
  const stride = round(gs.speed * length / factor * (item.ptPerPixel ?? 1));
  const frames = sampledFrames(p, range).length;
  return { strideLength: stride, speed: round(stride * (p.fps ?? 12) / frames), frames, groundSpeedSrcPxPerFrame: gs.speed, samples: gs.samples, factor };
}
