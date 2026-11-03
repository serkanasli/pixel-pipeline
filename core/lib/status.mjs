// Where an item stands: the stage of every pose in chain order, the package, and the one next
// step. Read-only and fast (no frame extraction), so the server can call it on every change.
//
// Pose stages, in order: start-frame -> prompt -> video -> range -> done. A pose whose video is
// already there skips the first two (the start frame only matters before the video is made).
// A still is done as soon as the pose it takes its frame from is done.
import fs from 'node:fs';
import { packageInputs } from './make.mjs';
import { missingPromptFields } from './prompt.mjs';
import { byName, cachedAnalysis, effectiveRange, itemPath, poseVideo } from './poses.mjs';
import { chainOrder } from './schema.mjs';
import { startFrameState } from './startframe.mjs';

export const STAGES = ['start-frame', 'prompt', 'video', 'range', 'done'];

export function poseStatus(item, p, done) {
  if (p.kind === 'still') {
    const ref = p.startsFrom.pose;
    return done.has(ref)
      ? { name: p.name, kind: p.kind, stage: 'done', next: null }
      : { name: p.name, kind: p.kind, stage: 'waiting', waitsFor: ref, next: null };
  }
  const video = poseVideo(item, p);
  const startFrame = startFrameState(item, p);
  const missing = missingPromptFields(item, p);
  const analysis = cachedAnalysis(item, p);
  const r = analysis ? effectiveRange(p, analysis) : { range: p.range ?? null, explicit: !!p.range, suggestion: null };
  const s = { name: p.name, kind: p.kind, fps: p.fps ?? 12, startsFrom: p.startsFrom, video: video.rel, hasVideo: video.exists,
    startFrame: { state: startFrame.state, file: startFrame.file ?? null, blocked: startFrame.blocked ?? null, madeAt: startFrame.made?.madeAt ?? null,
      made: startFrame.made ? { background: startFrame.made.background, sourceFrame: startFrame.made.sourceFrame ?? null } : null },
    promptMissing: missing, range: p.range ?? null, suggested: r.suggestion ? [r.suggestion.start, r.suggestion.end] : null, frames: analysis?.frames.length ?? null };
  if (video.exists) {
    s.stage = p.range ? 'done' : 'range';
    s.next = p.range ? null : { action: 'choose-range', pose: p.name, suggested: s.suggested };
    // The video exists, so a start frame that changed since is only worth a note.
    if (startFrame.state === 'stale') s.note = 'start-frame-changed';
    return s;
  }
  if (startFrame.state !== 'ready') {
    s.stage = 'start-frame';
    const b = startFrame.blocked;
    s.next = b?.blocked === 'no-anchor' ? { action: 'add-anchor', pose: p.name }
      : b ? { action: 'wait', pose: p.name, waitsFor: b.pose, reason: b.blocked }
      : { action: startFrame.state === 'stale' ? 'remake-start-frame' : 'make-start-frame', pose: p.name };
    return s;
  }
  if (missing.length) {
    s.stage = 'prompt';
    s.next = { action: 'fill-fields', pose: p.name, fields: missing };
    return s;
  }
  s.stage = 'video';
  s.next = { action: 'add-video', pose: p.name, video: video.rel, startFrame: startFrame.file };
  return s;
}

export function packageStatus(item) {
  const dir = itemPath(item, item.output ?? `build/${item.id}`);
  const file = `${dir}/report.json`;
  if (!fs.existsSync(file)) return { state: 'none' };
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    state: report.inputs === packageInputs(item) ? 'ready' : 'stale',
    dir, packageKB: report.packageKB, budgetKB: report.budgetKB, warnings: report.warnings.length, madeAt: report.madeAt ?? null,
  };
}

export function itemStatus(item) {
  const done = new Set();
  const poses = [];
  for (const p of chainOrder(item.poses)) {
    const s = poseStatus(item, p, done);
    if (s.stage === 'done') done.add(p.name);
    poses.push(s);
  }
  const pkg = packageStatus(item);
  const open = poses.find((s) => s.next);
  const next = open?.next ?? (poses.every((s) => s.stage === 'done')
    ? (pkg.state === 'ready' ? { action: 'done' } : { action: pkg.state === 'stale' ? 'remake-package' : 'make-package' })
    : { action: 'wait', pose: poses.find((s) => s.stage !== 'done').name });
  return { id: item.id, name: item.name, posesDone: done.size, posesTotal: poses.length, poses, package: pkg, next };
}

// The next step as one English sentence (CLI output; the web UI words it in Turkish itself).
export function describeNext(item, n) {
  const p = n.pose && byName(item, n.pose);
  switch (n.action) {
    case 'add-anchor': return `add an anchor image (anchor.png) to the item folder and set "anchor" in item.json`;
    case 'make-start-frame': return `${n.pose}: make the start frame (start-frame item.json ${n.pose})`;
    case 'remake-start-frame': return `${n.pose}: the start frame is outdated, make it again (start-frame item.json ${n.pose})`;
    case 'fill-fields': return `${n.pose}: fill in ${n.fields.join(', ')} in item.json, then get the prompt (prompt item.json ${n.pose})`;
    case 'add-video': return `${n.pose}: generate the video from ${n.startFrame} with the prompt (prompt item.json ${n.pose}) and save it as ${n.video}`;
    case 'choose-range': return `${n.pose}: choose the range (set-range item.json ${n.pose} <a> <b>)${n.suggested ? `; suggested ${n.suggested[0]} ${n.suggested[1]}` : '; inspect it first (inspect item.json ' + n.pose + ')'}`;
    case 'wait': return `${n.pose}: waits for ${n.waitsFor ?? p?.startsFrom?.pose ?? 'an earlier pose'}`;
    case 'make-package': return 'every pose is ready: make the package (make item.json)';
    case 'remake-package': return 'the package is outdated: make it again (make item.json)';
    case 'done': return 'the package is ready and up to date';
    default: return n.action;
  }
}
