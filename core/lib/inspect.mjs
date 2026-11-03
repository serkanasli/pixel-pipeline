// Looking at a video before choosing its range, and saving the choice. The range picker in the
// web UI and the inspect / set-range commands both come here.
import path from 'node:path';
import { analyzeClip } from './analyze.mjs';
import { extract, sheetLayout } from './frames.mjs';
import { info, UserError } from './log.mjs';
import { byName, checkRange, effectiveRange, measureLocomotion, poseClip, poseVideo, sampledFrames, stepOf, stillSource } from './poses.mjs';
import { saveItem } from './schema.mjs';

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

function poseOf(item, name) {
  const p = byName(item, name);
  if (!p) throw new UserError(`unknown pose "${name}"; poses: ${item.poses.map((q) => q.name).join(', ')}`);
  if (p.kind === 'still') throw new UserError(`${p.name} is a still: it uses ${stillSource(p)} and has no video of its own`);
  return p;
}
