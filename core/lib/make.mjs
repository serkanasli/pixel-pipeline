// item.json -> pixel art package (manifest + atlas), preview page and report.
// Every decision that was made by hand in the wolf test is made here from measurements:
// loop points, clip ranges, pixel size, palette, anchor and ground placement, canvas size.
import fs from 'node:fs';
import path from 'node:path';
import { findLoop, groundSpeed, measureClip, reactionRange, transitionRange } from './analyze.mjs';
import { extract, SOURCE_FPS } from './frames.mjs';
import { pack, writeAtlas } from './pack.mjs';
import { pixelFile, pixelize } from './pixelize.mjs';
import { writePreview } from './preview.mjs';
import { listFrames, measure, progress, readRGBA, round, sha256 } from './util.mjs';

export const KINDS = ['locomotion', 'loop', 'transition', 'reaction', 'still'];
export const BUDGET_KB = { animated: 500, static: 150 }; // package size budget per item

export function loadItem(file) {
  const item = JSON.parse(fs.readFileSync(file, 'utf8'));
  item.__dir = path.dirname(path.resolve(file));
  return validate(item);
}

export function validate(item) {
  const err = (m) => { throw new Error(`item.json: ${m}`); };
  if (!/^[a-z]+\.[a-z0-9-]+$/.test(item.id ?? '')) err('"id" must look like "pet.shadow-wolf"');
  if (!item.poses?.length) err('"poses" is empty');
  const names = new Set();
  for (const p of item.poses) {
    if (!/^[a-z][a-z0-9_]*$/.test(p.name ?? '')) err(`pose name "${p.name}" must be snake_case`);
    if (names.has(p.name)) err(`pose "${p.name}" appears twice`);
    names.add(p.name);
    if (!KINDS.includes(p.kind)) err(`pose "${p.name}": kind must be one of ${KINDS.join(', ')}`);
    if (p.kind === 'still') { if (!p.from && !p.video) err(`pose "${p.name}": a still needs "from" (pose) or "video"`); }
    else if (!p.video) err(`pose "${p.name}": "video" is missing`);
    if (p.fps && ![6, 8, 12, 24].includes(p.fps)) err(`pose "${p.name}": fps must be 6, 8, 12 or 24`);
  }
  for (const p of item.poses) {
    for (const ref of [p.from, p.startsFrom].filter((r) => r && r !== 'anchor')) if (!names.has(ref)) err(`pose "${p.name}" refers to unknown pose "${ref}"`);
  }
  const b = item.behavior ?? {};
  for (const ref of [b.enter, b.onPress, ...(b.arrive ?? [])].filter(Boolean)) if (!names.has(ref)) err(`behavior refers to unknown pose "${ref}"`);
  return item;
}

const resolve = (item, p) => (path.isAbsolute(p) ? p : path.join(item.__dir, p));

export async function make(item, { out } = {}) {
  const facing = item.facing ?? 'left';
  const ptPerPixel = item.ptPerPixel ?? 1;
  const colors = item.colors ?? 24;
  const cacheRoot = path.join(item.__dir, '.pixel-cache');
  const outDir = out ?? resolve(item, item.output ?? `build/${item.id}`);
  const warnings = [];

  // 1. Frames and measurements per video.
  const clips = {};
  for (const p of item.poses.filter((p) => p.video)) {
    const video = resolve(item, p.video);
    if (!clips[video]) {
      const ex = await extract(video, cacheRoot);
      progress('measuring', path.basename(video));
      clips[video] = { ...ex, ...(await measureClip(ex.key)) };
    }
    p.__clip = clips[video];
  }

  // 2. Frame choice per pose (source frame indices at 24 fps).
  const byName = Object.fromEntries(item.poses.map((p) => [p.name, p]));
  const report = { id: item.id, poses: {}, warnings };
  for (const p of ordered(item.poses)) {
    const fps = p.fps ?? 12, step = Math.round(SOURCE_FPS / fps), clip = p.__clip;
    const r = { kind: p.kind, fps };
    if (p.kind === 'still') {
      const src = p.from ? byName[p.from] : p;
      const list = p.from ? src.__frames : null;
      const idx = p.frame === 'last' ? list.at(-1) : p.frame === 'first' || p.frame == null ? (list ? list[0] : 0) : list ? list[p.frame] : p.frame;
      p.__frames = [idx];
      p.__clip = src.__clip;
      r.sourceFrame = idx;
    } else if (p.kind === 'locomotion' || p.kind === 'loop') {
      let start, length;
      if (p.range) { [start] = p.range; length = p.range[1] - p.range[0]; }
      else {
        const cands = findLoop(clip, { step, minLen: p.kind === 'locomotion' ? 16 : 12, maxLen: 48 });
        if (!cands.length) throw new Error(`pose "${p.name}": video is too short to find a loop`);
        ({ start, length } = cands[0]);
        r.loopScore = cands[0].score;
        if (cands[0].score > 25) warnings.push(`${p.name}: loop does not close cleanly (score ${cands[0].score}); check the jump from the last frame to the first`);
      }
      p.__frames = range(start, start + length - 1, step);
      r.range = [start, start + length];
      if (p.kind === 'locomotion') {
        const gs = groundSpeed(clip, start, start + length - 1, facing);
        p.__strideSrc = gs.speed * length;
        r.groundSpeedSrcPxPerFrame = gs.speed;
        if (gs.samples < length) warnings.push(`${p.name}: few ground contacts measured (${gs.samples}); stride length may be off`);
      }
    } else {
      const rr = p.range ? { start: p.range[0], end: p.range[1] } : p.kind === 'transition' ? transitionRange(clip) : reactionRange(clip);
      p.__frames = range(rr.start, rr.end, step);
      r.range = [rr.start, rr.end];
      if (p.kind === 'reaction' && rr.returnScore > 15) warnings.push(`${p.name}: does not return to its first pose cleanly (score ${rr.returnScore})`);
    }
    r.frames = p.__frames.length;
    report.poses[p.name] = r;
  }

  // 3. One grid and one palette for every frame of every pose.
  const refPose = byName[item.referencePose] ?? item.poses.find((p) => p.video);
  const refFrame = refPose.__clip.frames[refPose.__frames[0]].m;
  const factor = refFrame.width / (item.pixelWidth ?? 170);
  const pxDir = path.join(cacheRoot, 'pixel', item.id);
  fs.rmSync(pxDir, { recursive: true, force: true });
  fs.mkdirSync(pxDir, { recursive: true });
  const jobs = [];
  for (const p of item.poses) p.__frames.forEach((src, i) => jobs.push({ file: path.join(p.__clip.key, listFrames(p.__clip.key)[src]), out: pixelFile(pxDir, p.name, i), pose: p, i }));
  progress('pixelizing', `${jobs.length} frames, ${colors} colours, ${round(factor, 2)} source px per pixel`);
  const px = await pixelize(jobs, factor, colors);
  for (const j of jobs) {
    const { data, w, h } = await readRGBA(j.out);
    (j.pose.__m ??= [])[j.i] = measure(data, w, h);
  }

  // 4. Placement: anchor x and ground line per frame, in art px.
  for (const p of ordered(item.poses)) placePose(p, byName, warnings);

  // 5. Atlas.
  progress('packing atlas');
  const frames = [];
  for (const p of item.poses) p.__m.forEach((_, i) => frames.push({ name: `${p.name}_${i + 1}`, file: pixelFile(pxDir, p.name, i), anchorX: p.__anchorX, ground: p.__ground[i] }));
  const packed = await pack(frames);
  const base = item.id.split('.').slice(1).join('.');
  fs.rmSync(outDir, { recursive: true, force: true });
  const atlas = writeAtlas(outDir, base, packed, ptPerPixel);

  // 6. Manifest.
  const size = { width: packed.canvas.w * ptPerPixel, height: packed.canvas.h * ptPerPixel };
  const anchorY = round(packed.groundRow / packed.canvas.h, 4);
  const manifest = buildManifest(item, { size, anchorY, atlas, ptPerPixel, factor });
  manifest.files = Object.fromEntries([atlas.image, atlas.map].map((f) => [f, sha256(path.join(outDir, f))]));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 7. Report and preview.
  const pkgBytes = fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
  const animated = item.poses.some((p) => p.kind !== 'still');
  const budget = animated ? BUDGET_KB.animated : BUDGET_KB.static;
  Object.assign(report, {
    output: outDir,
    sourcePxPerPixel: round(factor, 3),
    palette: px.palette,
    size, anchor: { x: 0.5, y: anchorY },
    atlas: { ...packed.atlasSize, kb: round(packed.atlas.length / 1024), memoryMB: round(packed.atlasSize.w * packed.atlasSize.h * 4 / 1048576) },
    packageKB: round(pkgBytes / 1024),
    budgetKB: budget,
    locomotion: manifest.locomotion ?? null,
  });
  if (report.packageKB > budget) warnings.push(`package is ${report.packageKB} KB, over the ${budget} KB budget; try fps 8 for slow poses or shorter ranges`);
  if (packed.atlasSize.w > 2048 || packed.atlasSize.h > 2048) warnings.push(`atlas is ${packed.atlasSize.w}×${packed.atlasSize.h}, over 2048 px per side`);
  for (const p of item.poses) report.poses[p.name].groundJitter = p.__groundJitter ?? 0;
  report.preview = writePreview(outDir, { manifest, atlasJson: atlas.json, atlasFile: path.join(outDir, atlas.image), report });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

const range = (a, b, step) => { const o = []; for (let i = a; i <= b; i += step) o.push(i); return o; };

// Poses that depend on another pose (startsFrom / from) come after it.
function ordered(poses) {
  const done = new Set(), out = [];
  const visit = (p) => {
    if (done.has(p.name)) return;
    done.add(p.name);
    for (const ref of [p.from, p.startsFrom]) if (ref && ref !== 'anchor') visit(poses.find((q) => q.name === ref));
    out.push(p);
  };
  poses.forEach(visit);
  return out;
}

// Tracking-camera poses (locomotion) stand on their own lowest pixel in every frame.
// Fixed-camera poses keep the camera's ground; when the lowest pixel ends lower or higher
// (e.g. lying down brings the front paws forward), the ground eases to it over the clip.
// A pose that startsFrom another continues exactly where that pose's last frame is.
function placePose(p, byName, warnings) {
  const m = p.__m;
  if (p.kind === 'still') {
    const src = p.from ? byName[p.from] : null;
    const at = src ? (p.frame === 'last' ? src.__m.length - 1 : p.frame === 'first' || p.frame == null ? 0 : p.frame) : 0;
    p.__anchorX = src ? src.__anchorX : m[0].cx;
    p.__ground = [src ? src.__ground[at] : m[0].maxY];
    return;
  }
  if (p.kind === 'locomotion') {
    p.__anchorX = m.reduce((s, f) => s + f.cx, 0) / m.length;
    p.__ground = m.map((f) => f.maxY);
    const g = m.map((f) => f.maxY);
    p.__groundJitter = Math.max(...g) - Math.min(...g);
    if (p.__groundJitter > 4) warnings.push(`${p.name}: ground line moves ${p.__groundJitter} px between frames`);
    return;
  }
  const prev = p.startsFrom && p.startsFrom !== 'anchor' ? byName[p.startsFrom] : null;
  let anchorX, g0;
  if (prev) {
    const last = prev.__m.at(-1);
    anchorX = prev.__anchorX + (m[0].cx - last.cx);
    g0 = prev.__ground.at(-1) + (m[0].maxY - last.maxY);
    const jump = Math.hypot(m[0].cx - last.cx, m[0].maxY - last.maxY);
    if (jump > 6) warnings.push(`${p.name}: first frame is ${round(jump)} px away from the last frame of ${prev.name}; the clip may not start from that frame`);
  } else {
    anchorX = m[0].cx;
    g0 = m[0].maxY;
  }
  const delta = p.kind === 'transition' ? m.at(-1).maxY - m[0].maxY : 0;
  const n = m.length;
  p.__anchorX = anchorX;
  p.__ground = m.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 1, e = t * t * (3 - 2 * t);
    return g0 + (Math.abs(delta) > 2 ? delta * e : 0);
  });
}

function buildManifest(item, { size, anchorY, atlas, ptPerPixel, factor }) {
  const b = item.behavior ?? {};
  const poses = Object.fromEntries(item.poses.map((p) => {
    const pose = { frames: p.__m.map((_, i) => `${p.name}_${i + 1}`) };
    if (pose.frames.length > 1) pose.fps = p.fps ?? 12;
    if (p.kind === 'locomotion' || p.kind === 'loop') pose.loop = true;
    return [p.name, pose];
  }));
  const manifest = {
    schemaVersion: 1,
    id: item.id,
    type: item.type ?? 'pet',
    version: item.version ?? '0.1.0',
    name: item.name ?? { en: item.id },
    renderer: 'raster',
    facing: item.facing ?? 'left',
    size,
    anchor: { x: 0.5, y: anchorY },
    assets: { atlas: { image: atlas.image, map: atlas.map, scale: 1 / ptPerPixel, filter: 'nearest' } },
    layers: { root: { pivot: { x: 0.5, y: anchorY } } },
    poses,
  };
  const enter = b.enter && item.poses.find((p) => p.name === b.enter);
  if (enter?.kind === 'locomotion') {
    const stride = round(enter.__strideSrc / factor * ptPerPixel);
    manifest.locomotion = { type: 'walk', pose: enter.name, strideLength: stride, speed: round(stride * (enter.fps ?? 12) / enter.__m.length) };
  }
  const arrive = b.arrive ?? [];
  manifest.arrive = arrive.map((pose) => ({ pose }));
  manifest.rest = b.restTracks ?? [];
  manifest.occasional = [];
  const restPose = arrive.at(-1);
  manifest.onPress = [
    ...(b.onPress ? [{ pose: b.onPress, ...(restPose ? { returnTo: restPose } : {}) }] : []),
    { action: 'haptic', style: 'light' },
  ];
  manifest.store = null;
  return manifest;
}
