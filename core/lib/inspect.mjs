// Looking at a video before choosing its range, and saving the choice. The range picker in the
// web UI and the inspect / set-range commands both come here.
import fs from 'node:fs';
import path from 'node:path';
import { analyzeClip } from './analyze.mjs';
import { extract, sheetLayout } from './frames.mjs';
import { prepareImage } from './images.mjs';
import { keyFrame, keyTag } from './key.mjs';
import { info, UserError } from './log.mjs';
import { byName, checkRange, effectiveRange, itemPath, measureLocomotion, poseClip, poseImage, posesOf, poseVideo, sampledFrames, stepOf, stillSource } from './poses.mjs';
import { saveItem, validateKey } from './schema.mjs';
import { listFrames } from './util.mjs';

// A pose's video: frame count, contact sheet, the suggestion for its kind and fps, the range in
// effect and, for locomotion, stride and speed of that range.
export async function inspectPose(item, poseName) {
  const p = poseOf(item, poseName);
  const clip = await poseClip(item, p);
  if (!clip) throw new UserError(`${p.name}: no video yet (expected ${poseVideo(item, p).rel})`);
  const { range, explicit, suggestion } = effectiveRange(p, clip);
  const r = {
    pose: p.name, kind: p.kind, fps: p.fps ?? 12, step: stepOf(p),
    video: clip.video.rel, info: clip.info,
    contactSheet: path.relative(item.__dir, path.join(clip.src, 'sheet.png')), sheet: sheetLayout(clip.info),
    frames: clip.frames.length, motion: clip.motion,
    suggestion, range, rangeChosen: explicit,
    played: range ? sampledFrames(p, range).length : 0,
  };
  if (range && p.kind === 'locomotion') r.locomotion = await measureLocomotion(item, p, range);
  return r;
}

// Any video, outside an item: the old standalone inspect.
export async function inspectVideo(video, cacheRoot = path.join(path.dirname(video), '.pixel-cache')) {
  const ex = await extract(video, cacheRoot);
  const a = await analyzeClip(ex);
  const first = a.frames[0].m;
  return {
    video, info: ex.info, contactSheet: path.join(ex.src, 'sheet.png'), frames: a.frames.length,
    figure: first && { width: first.width, height: first.height },
    motion: a.motion,
    suggestions: { loop: a.suggestions.loop[2], locomotion: a.suggestions.locomotion[2], transition: a.suggestions.transition[2], reaction: a.suggestions.reaction[2] },
  };
}

// Saves [a, b] as the pose's range. Returns the same facts as inspectPose for the new range, so
// the caller can show the measured stride right away.
export async function setRange(item, poseName, a, b) {
  const p = poseOf(item, poseName);
  const clip = await poseClip(item, p);
  if (!clip) throw new UserError(`${p.name}: no video yet (expected ${poseVideo(item, p).rel})`);
  const range = [Number(a), Number(b)];
  if (!range.every(Number.isInteger)) throw new UserError(`${p.name}: range must be two whole source frame numbers`);
  checkRange(p, clip, range);
  const before = p.range;
  p.range = range;
  try { saveItem(item); } catch (e) { p.range = before; throw e; }
  info(`${p.name}: range set to ${range[0]}–${range[1]}${before ? ` (was ${before[0]}–${before[1]})` : ''}`);
  return inspectPose(item, p.name);
}

// Background removal settings tried before they are saved: one image (a still's or a layer's)
// or the first frame of a pose's range, cleaned with `key`. Returns { file } relative to the
// item folder; the result is cached per setting like the frames make uses.
export async function keyPreview(item, { pose, image, key = true }) {
  validateKey(key, 'key', true, (m) => { throw new UserError(m); });
  const cacheRoot = path.join(item.__dir, '.pixel-cache');
  let file;
  if (image !== undefined) {
    const abs = itemPath(item, image);
    file = (await prepareImage(abs, cacheRoot, { key })).file;
  } else {
    const p = byName(item, pose);
    if (!p) throw new UserError(`unknown pose "${pose}"`);
    if (p.kind === 'still' && !p.image) throw new UserError(`${p.name}: the frame comes from ${stillSource(p)}; its background removal is set there`);
    if (p.image) {
      const img = poseImage(item, p);
      if (!img.exists) throw new UserError(`${p.name}: ${img.rel ? `image not found: ${img.rel}` : 'the item has no anchor image yet'}`);
      file = (await prepareImage(img.abs, cacheRoot, { key })).file;
    } else {
      const clip = await poseClip(item, p);
      if (!clip) throw new UserError(`${p.name}: no video yet (expected ${poseVideo(item, p).rel})`);
      const at = effectiveRange(p, clip).range?.[0] ?? 0;
      const src = path.join(clip.src, listFrames(clip.src)[at]);
      file = path.join(clip.dir, 'preview', `${path.basename(src, '.png')}${key === false ? '-raw' : keyTag(key)}.png`);
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (key === false) fs.copyFileSync(src, file); else await keyFrame(src, file, key);
      }
    }
  }
  return { file: path.relative(item.__dir, file) };
}

function poseOf(item, name) {
  const p = byName(item, name);
  if (!p) throw new UserError(`unknown pose "${name}"; poses: ${posesOf(item).map((q) => q.name).join(', ') || 'none'}`);
  if (p.kind === 'still') throw new UserError(`${p.name} is a still: it uses ${stillSource(p)} and has no video of its own`);
  return p;
}
