// item.json -> pixel art package (manifest + atlas), preview page and report.
// Every decision that was made by hand in the wolf test is made here from measurements:
// loop points, clip ranges, pixel size, palette, anchor and ground placement, canvas size.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { groundSpeed } from './analyze.mjs';
import { prepareImage } from './images.mjs';
import { progress, UserError } from './log.mjs';
import { pack, writeAtlas } from './pack.mjs';
import { pixelFile, pixelize } from './pixelize.mjs';
import { byName, checkRange, continuation, effectiveRange, gridFactor, imageFactor, itemPath, poseClip, poseImage, poseVideo, sampledFrames } from './poses.mjs';
import { writePreview } from './preview.mjs';
import { chainOrder, LOOPING, occasionalList, refName } from './schema.mjs';
import { fileKey, listFrames, measure, readRGBA, round, sha256 } from './util.mjs';

export const BUDGET_KB = { animated: 500, static: 150 }; // package size budget per item
export const MAX_ATLAS_SIDE = 2048;

export async function make(item, { out } = {}) {
  const ptPerPixel = item.ptPerPixel ?? 1;
  const colors = item.colors ?? 24;
  const cacheRoot = path.join(item.__dir, '.pixel-cache');
  const outDir = out ?? itemPath(item, item.output ?? `build/${item.id}`);
  const warnings = [];

  // 1. Frames and measurements per video.
  const missing = item.poses.filter((p) => p.kind !== 'still' && !poseVideo(item, p).exists);
  if (missing.length) throw new UserError(`no video yet for ${missing.map((p) => `${p.name} (${poseVideo(item, p).rel})`).join(', ')}`);
  for (const p of item.poses.filter((p) => p.kind !== 'still')) p.__clip = await poseClip(item, p);

  // 2. Frame choice per pose (source frame indices at 24 fps).
  const report = { id: item.id, poses: {}, warnings };
  for (const p of chainOrder(item.poses)) {
    const r = { kind: p.kind };
    if (p.kind === 'still' && p.image) {
      const img = poseImage(item, p);
      if (!img.exists) throw new UserError(`${p.name}: ${img.rel ? `image not found: ${img.rel}` : 'the item has no anchor image yet'}`);
      p.__image = await prepareImage(img.abs, cacheRoot);
      p.__frames = [0];
      r.image = img.rel;
    } else if (p.kind === 'still') {
      const ref = byName(item, p.startsFrom.pose);
      const c = continuation(ref, p.startsFrom.frame, ref.__range);
      p.__clip = ref.__clip;
      p.__frames = [c.sourceFrame];
      p.__from = c;
      r.sourceFrame = c.sourceFrame;
    } else {
      const clip = p.__clip;
      const { range, explicit, suggestion } = effectiveRange(p, clip);
      if (!range) throw new UserError(`${p.name}: no ${p.kind} range could be suggested for this video; choose one with set-range`);
      checkRange(p, clip, range);
      p.__range = range;
      p.__frames = sampledFrames(p, range);
      r.fps = p.fps ?? 12;
      r.range = range;
      r.rangeChosen = explicit;
      if (!explicit && suggestion) {
        if (LOOPING.has(p.kind)) {
          r.loopScore = suggestion.score;
          if (suggestion.score > 25) warnings.push(`${p.name}: loop does not close cleanly (score ${suggestion.score}); check the jump from the last frame to the first`);
        }
        if (p.kind === 'reaction' && suggestion.returnScore > 15) warnings.push(`${p.name}: does not return to its first pose cleanly (score ${suggestion.returnScore})`);
      }
      if (p.kind === 'locomotion') {
        const gs = groundSpeed(clip, range[0], range[1] - 1, item.facing ?? 'left');
        p.__strideSrc = gs.speed * (range[1] - range[0]);
        r.groundSpeedSrcPxPerFrame = gs.speed;
        if (gs.samples < range[1] - range[0]) warnings.push(`${p.name}: few ground contacts measured (${gs.samples}); stride length may be off`);
      }
      if (refName(p)) p.__from = continuation(byName(item, p.startsFrom.pose), p.startsFrom.frame, byName(item, p.startsFrom.pose).__range);
    }
    r.frames = p.__frames.length;
    report.poses[p.name] = r;
  }

  // 3. One grid and one palette for every frame of every pose.
  // Video frames and images have their own source scale but end up on the same art pixel size.
  const factor = await gridFactor(item);
  const imgFactor = item.poses.some((p) => p.__image) ? await imageFactor(item) : null;
  const pxDir = path.join(cacheRoot, 'pixel', item.id);
  fs.rmSync(pxDir, { recursive: true, force: true });
  fs.mkdirSync(pxDir, { recursive: true });
  const jobs = [];
  for (const p of item.poses) {
    if (p.__image) { jobs.push({ file: p.__image.file, out: pixelFile(pxDir, p.name, 0), pose: p, i: 0, factor: imgFactor, kernel: 'nearest' }); continue; }
    p.__frames.forEach((src, i) => jobs.push({ file: path.join(p.__clip.key, listFrames(p.__clip.key)[src]), out: pixelFile(pxDir, p.name, i), pose: p, i, factor }));
  }
  progress('pixelizing', `${jobs.length} frames, ${colors} colours, ${round(factor, 2)} source px per pixel`);
  const px = await pixelize(jobs, colors);
  for (const j of jobs) {
    const { data, w, h } = await readRGBA(j.out);
    (j.pose.__m ??= [])[j.i] = measure(data, w, h);
  }

  // 4. Placement: anchor x and ground line per frame, in art px.
  for (const p of chainOrder(item.poses)) placePose(p, item, warnings);

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
    ...(imgFactor ? { imagePxPerPixel: round(imgFactor, 3) } : {}),
    palette: px.palette,
    size, anchor: { x: 0.5, y: anchorY },
    atlas: { ...packed.atlasSize, kb: round(packed.atlas.length / 1024), memoryMB: round(packed.atlasSize.w * packed.atlasSize.h * 4 / 1048576) },
    packageKB: round(pkgBytes / 1024),
    budgetKB: budget,
    maxAtlasSide: MAX_ATLAS_SIDE,
    inputs: packageInputs(item),
    madeAt: new Date().toISOString(),
    locomotion: manifest.locomotion ?? null,
  });
  if (report.packageKB > budget) warnings.push(`package is ${report.packageKB} KB, over the ${budget} KB budget; try fps 8 for slow poses or shorter ranges`);
  if (packed.atlasSize.w > MAX_ATLAS_SIDE || packed.atlasSize.h > MAX_ATLAS_SIDE) warnings.push(`atlas is ${packed.atlasSize.w}×${packed.atlasSize.h}, over ${MAX_ATLAS_SIDE} px per side`);
  for (const p of item.poses) report.poses[p.name].groundJitter = p.__groundJitter ?? 0;
  report.preview = writePreview(outDir, { manifest, atlasJson: atlas.json, atlasFile: path.join(outDir, atlas.image), report });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

// Tracking-camera poses (locomotion) stand on their own lowest pixel in every frame.
// Fixed-camera poses keep the camera's ground; when the lowest pixel ends lower or higher
// (e.g. lying down brings the front paws forward), the ground eases to it over the clip.
// A pose that startsFrom another continues exactly where that pose's chosen frame is.
function placePose(p, item, warnings) {
  const m = p.__m;
  if (p.kind === 'locomotion') {
    p.__anchorX = m.reduce((s, f) => s + f.cx, 0) / m.length;
    p.__ground = m.map((f) => f.maxY);
    const g = m.map((f) => f.maxY);
    p.__groundJitter = Math.max(...g) - Math.min(...g);
    if (p.__groundJitter > 4) warnings.push(`${p.name}: ground line moves ${p.__groundJitter} px between frames`);
    return;
  }
  const prev = p.__from ? byName(item, p.__from.pose) : null;
  let anchorX, g0;
  if (prev) {
    const at = prev.__m[p.__from.index];
    anchorX = prev.__anchorX + (m[0].cx - at.cx);
    g0 = prev.__ground[p.__from.index] + (m[0].maxY - at.maxY);
    const jump = Math.hypot(m[0].cx - at.cx, m[0].maxY - at.maxY);
    if (jump > 6) warnings.push(`${p.name}: first frame is ${round(jump)} px away from frame ${p.__from.sourceFrame} of ${prev.name}; the video may not start from that frame`);
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
    if (LOOPING.has(p.kind)) pose.loop = true;
    return [p.name, pose];
  }));
  const manifest = {
    schemaVersion: 1,
    id: item.id,
    type: item.type ?? 'pet',
    version: item.version ?? '1.0.0',
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
  manifest.occasional = occasionalList(b);
  const restPose = arrive.at(-1);
  manifest.onPress = [
    ...(b.onPress ? [{ pose: b.onPress, ...(restPose ? { returnTo: restPose } : {}) }] : []),
    { action: 'haptic', style: 'light' },
  ];
  manifest.store = null;
  return manifest;
}

// What the package is made from: the fields that change pixels or the manifest and every
// video's file key. Prompt texts and start frame settings are left out, so editing them does
// not mark a built package as outdated.
export function packageInputs(item) {
  const PROMPT_ONLY = ['template', 'anchor', 'subject', 'persistentDetails', 'style'];
  const saved = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('__')));
  const fields = Object.fromEntries(Object.entries(saved(item)).filter(([k]) => !PROMPT_ONLY.includes(k) && k !== 'poses'));
  fields.poses = item.poses.map((p) => {
    const { motion, start, ...rest } = saved(p);
    const v = poseVideo(item, p), img = poseImage(item, p);
    return { ...rest, video: v?.rel, videoKey: v?.exists ? fileKey(v.abs) : null, ...(img ? { imageKey: img.exists ? fileKey(img.abs) : null } : {}) };
  });
  // Images are scaled from the anchor, so it changes pixels once an item has any.
  const anchor = item.anchor && itemPath(item, item.anchor);
  if (item.poses.some((p) => p.image) && anchor && fs.existsSync(anchor)) fields.anchorKey = fileKey(anchor);
  return crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
}
