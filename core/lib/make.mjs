// item.json -> pixel art package (manifest + atlas and/or layer images), preview page and report.
// Every decision that was made by hand in the wolf test is made here from measurements:
// loop points, clip ranges, pixel size, palette, anchor and ground placement, canvas size.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { groundSpeed } from './analyze.mjs';
import { prepareImage } from './images.mjs';
import { progress, UserError } from './log.mjs';
import { pack, writeAtlas } from './pack.mjs';
import { pixelFile, pixelize } from './pixelize.mjs';
import { byName, checkRange, continuation, DEFAULT_PIXEL_WIDTH, effectiveRange, gridFactor, imageFactor, itemPath, packageDir, poseClip, poseImage, posesOf, poseVideo, sampledFrames } from './poses.mjs';
import { writePreview } from './preview.mjs';
import { chainOrder, LOOPING, occasionalList, refName } from './schema.mjs';
import { typeDefaults } from './types.mjs';
import { fileKey, listFrames, measure, readRGBA, round, sha256 } from './util.mjs';

export const BUDGET_KB = { animated: 500, static: 150 }; // package size budget per item
export const MAX_ATLAS_SIDE = 2048;

export async function make(item, { out } = {}) {
  const ptPerPixel = item.ptPerPixel ?? 1;
  const colors = item.colors ?? 24;
  const cacheRoot = path.join(item.__dir, '.pixel-cache');
  const outDir = out ?? packageDir(item);
  const poses = posesOf(item), layers = item.layers ?? [];
  const type = typeDefaults(item.type);
  const warnings = [];

  // 1. Frames and measurements per video; layer images with their background removed.
  const missing = poses.filter((p) => p.kind !== 'still' && !poseVideo(item, p).exists);
  if (missing.length) throw new UserError(`no video yet for ${missing.map((p) => `${p.name} (${poseVideo(item, p).rel})`).join(', ')}`);
  const noImage = layers.filter((l) => !fs.existsSync(itemPath(item, l.image)));
  if (noImage.length) throw new UserError(`no image yet for layer ${noImage.map((l) => `${l.name} (${l.image})`).join(', ')}`);
  for (const p of poses.filter((p) => p.kind !== 'still')) p.__clip = await poseClip(item, p);
  for (const l of layers) {
    l.__key = l.key ?? type.key;
    l.__image = await prepareImage(itemPath(item, l.image), cacheRoot, { key: l.__key });
  }

  // 2. Frame choice per pose (source frame indices at 24 fps).
  const report = { id: item.id, poses: {}, ...(layers.length ? { layers: {} } : {}), warnings };
  for (const p of chainOrder(poses)) {
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

  // 3. One grid and one palette for every frame of every pose and every layer.
  // Video frames and images have their own source scale but end up on the same art pixel size.
  const factor = poses.length ? await gridFactor(item) : null;
  const imgFactor = poses.some((p) => p.__image) ? await imageFactor(item) : null;
  const layerFactor = layers.length ? await layersFactor(item, layers, poses) : null;
  const pxDir = path.join(cacheRoot, 'pixel', item.id);
  fs.rmSync(pxDir, { recursive: true, force: true });
  fs.mkdirSync(pxDir, { recursive: true });
  const jobs = [];
  for (const p of poses) {
    if (p.__image) { jobs.push({ file: p.__image.file, out: pixelFile(pxDir, p.name, 0), pose: p, i: 0, factor: imgFactor, kernel: 'nearest' }); continue; }
    p.__frames.forEach((src, i) => jobs.push({ file: path.join(p.__clip.key, listFrames(p.__clip.key)[src]), out: pixelFile(pxDir, p.name, i), pose: p, i, factor }));
  }
  for (const l of layers) jobs.push({ file: l.__image.file, out: path.join(pxDir, `layer-${l.name}.png`), layer: l, factor: layerFactor, kernel: 'nearest' });
  const counts = [jobs.length - layers.length && `${jobs.length - layers.length} frames`, layers.length && `${layers.length} layers`].filter(Boolean);
  progress('pixelizing', `${counts.join(', ')}, ${colors} colours, ${round(factor ?? layerFactor, 2)} source px per pixel`);
  const px = await pixelize(jobs, colors);
  for (const j of jobs) {
    const { data, w, h } = await readRGBA(j.out);
    const m = measure(data, w, h);
    if (j.layer) {
      if (!m) throw new UserError(`layer ${j.layer.name}: nothing is left after background removal and pixelizing`);
      Object.assign(j.layer, { __m: m, __px: j.out, __w: w, __h: h });
    } else (j.pose.__m ??= [])[j.i] = m;
  }

  // 4. Placement: anchor x and ground line per frame, in art px.
  for (const p of chainOrder(poses)) placePose(p, item, warnings);

  // 5. Atlas of the poses, one image per layer.
  const base = item.id.split('.').slice(1).join('.');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  let packed = null, atlas = null;
  if (poses.length) {
    progress('packing atlas');
    const frames = [];
    for (const p of poses) p.__m.forEach((_, i) => frames.push({ name: `${p.name}_${i + 1}`, file: pixelFile(pxDir, p.name, i), anchorX: p.__anchorX, ground: p.__ground[i] }));
    packed = await pack(frames);
    atlas = writeAtlas(outDir, base, packed, ptPerPixel);
  }
  const images = layers.length ? await writeLayers(outDir, base, layers, type.anchor) : null;

  // 6. Manifest.
  const size = packed
    ? { width: packed.canvas.w * ptPerPixel, height: packed.canvas.h * ptPerPixel }
    : { width: images.box.w * ptPerPixel, height: images.box.h * ptPerPixel };
  const anchor = packed ? { x: 0.5, y: round(packed.groundRow / packed.canvas.h, 4) } : images.anchor;
  const manifest = buildManifest(item, { size, anchor, atlas, images, ptPerPixel, factor });
  const files = [...(atlas ? [atlas.image, atlas.map] : []), ...(images ? images.list.map((l) => l.file) : [])];
  manifest.files = Object.fromEntries(files.map((f) => [f, sha256(path.join(outDir, f))]));
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 7. Report and preview.
  const pkgBytes = fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
  const animated = poses.some((p) => p.kind !== 'still');
  const budget = animated ? BUDGET_KB.animated : BUDGET_KB.static;
  Object.assign(report, {
    output: outDir,
    sourcePxPerPixel: round(factor ?? layerFactor, 3),
    ...(imgFactor ? { imagePxPerPixel: round(imgFactor, 3) } : {}),
    ...(factor && layerFactor ? { layerPxPerPixel: round(layerFactor, 3) } : {}),
    palette: px.palette,
    size, anchor,
    atlas: packed ? { ...packed.atlasSize, kb: round(packed.atlas.length / 1024), memoryMB: round(packed.atlasSize.w * packed.atlasSize.h * 4 / 1048576) } : null,
    canvas: item.canvas ?? null,
    packageKB: round(pkgBytes / 1024),
    budgetKB: budget,
    maxAtlasSide: MAX_ATLAS_SIDE,
    inputs: packageInputs(item),
    madeAt: new Date().toISOString(),
    locomotion: manifest.locomotion ?? null,
  });
  for (const l of images?.list ?? []) report.layers[l.name] = { file: l.file, z: l.z, w: l.w, h: l.h, kb: l.kb, background: l.mode };
  if (report.packageKB > budget) warnings.push(`package is ${report.packageKB} KB, over the ${budget} KB budget; ${animated ? 'try fps 8 for slow poses or shorter ranges' : 'try fewer colours or a smaller pixelWidth or canvas'}`);
  if (packed && (packed.atlasSize.w > MAX_ATLAS_SIDE || packed.atlasSize.h > MAX_ATLAS_SIDE)) warnings.push(`atlas is ${packed.atlasSize.w}×${packed.atlasSize.h}, over ${MAX_ATLAS_SIDE} px per side`);
  canvasWarnings(item.canvas, packed, layers, warnings);
  for (const p of poses) report.poses[p.name].groundJitter = p.__groundJitter ?? 0;
  report.preview = writePreview(outDir, { manifest, atlasJson: atlas?.json ?? null, atlasFile: atlas && path.join(outDir, atlas.image), layers: images?.list ?? [], ptPerPixel, report });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

// One scale for every layer, so they share the grid: a full layer (key false) is fitted to the
// canvas width when a canvas is given. Otherwise layers next to poses are at the anchor's scale
// like the still images, and a layered item alone has its first layer pixelWidth art px wide.
async function layersFactor(item, layers, poses) {
  const full = layers.find((l) => !l.__key);
  if (item.canvas && full) return full.__image.width / item.canvas.width;
  if (poses.length && item.anchor && fs.existsSync(itemPath(item, item.anchor))) return imageFactor(item);
  return layers[0].__image.m.width / (item.pixelWidth ?? DEFAULT_PIXEL_WIDTH);
}

// Every layer is cropped to the box around all of them, so they keep their places relative to
// each other and can be drawn on top of each other at the same origin. Sprites (no full layer)
// keep a 1 px transparent margin, so no image edge holds an opaque pixel; anchor and pivots are
// given on the figure's box and moved onto the image with its margin.
async function writeLayers(outDir, base, layers, anchor) {
  const m = layers.some((l) => !l.__key) ? 0 : 1;
  const x0 = Math.min(...layers.map((l) => l.__m.minX)), y0 = Math.min(...layers.map((l) => l.__m.minY));
  const x1 = Math.max(...layers.map((l) => l.__m.maxX)) + 1, y1 = Math.max(...layers.map((l) => l.__m.maxY)) + 1;
  const box = { w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  const onImage = (p) => ({ x: round((m + p.x * (box.w - 2 * m)) / box.w, 4), y: round((m + p.y * (box.h - 2 * m)) / box.h, 4) });
  const list = [];
  for (const [i, l] of layers.entries()) {
    const file = `${base}-${l.name.replace(/_/g, '-')}.webp`;
    await sharp(l.__px)
      .extend({ top: m, left: m, right: Math.max(0, x1 + m - l.__w), bottom: Math.max(0, y1 + m - l.__h), background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .extract({ left: x0, top: y0, width: box.w, height: box.h })
      .webp({ lossless: true, effort: 6 })
      .toFile(path.join(outDir, file));
    list.push({ name: l.name, file, z: l.z ?? i, pivot: l.pivot ? onImage(l.pivot) : null, w: box.w, h: box.h,
      kb: round(fs.statSync(path.join(outDir, file)).size / 1024), mode: l.__image.mode });
  }
  return { box, list, anchor: onImage(anchor) };
}

// The target canvas is only checked, never enforced: nothing is cropped or scaled to fit it.
function canvasWarnings(c, packed, layers, warnings) {
  if (!c) return;
  const over = (w, h) => w > c.width || h > c.height;
  if (packed) {
    const w = Math.max(...packed.sprites.map((s) => s.w)), h = Math.max(...packed.sprites.map((s) => s.h));
    if (over(w, h)) warnings.push(`the figure is up to ${w}×${h} art px, larger than the canvas (${c.width}×${c.height})`);
  }
  for (const l of layers) {
    const { width: w, height: h } = l.__m;
    if (!l.__key && (w !== c.width || h !== c.height)) warnings.push(`layer ${l.name} is ${w}×${h} art px, the canvas is ${c.width}×${c.height}; the image has another aspect ratio or size`);
    else if (over(w, h)) warnings.push(`layer ${l.name} is ${w}×${h} art px, larger than the canvas (${c.width}×${c.height})`);
  }
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

function buildManifest(item, { size, anchor, atlas, images, ptPerPixel, factor }) {
  const b = item.behavior ?? {};
  const list = posesOf(item);
  const manifest = {
    schemaVersion: 1,
    id: item.id,
    type: item.type,
    version: item.version ?? '1.0.0',
    name: item.name ?? { en: item.id },
    renderer: 'raster',
    ...(list.length ? { facing: item.facing ?? 'left' } : {}),
    size,
    anchor,
    assets: {
      ...(atlas ? { atlas: { image: atlas.image, map: atlas.map, scale: 1 / ptPerPixel, filter: 'nearest' } } : {}),
      ...(images ? { images: Object.fromEntries(images.list.map((l) => [l.name, l.file])) } : {}),
    },
    layers: {
      ...(atlas ? { root: { pivot: { x: 0.5, y: anchor.y } } } : {}),
      ...Object.fromEntries((images?.list ?? []).map((l) => [l.name, { z: l.z, ...(l.pivot ? { pivot: l.pivot } : {}) }])),
    },
  };
  if (list.length) {
    manifest.poses = Object.fromEntries(list.map((p) => {
      const pose = { frames: p.__m.map((_, i) => `${p.name}_${i + 1}`) };
      if (pose.frames.length > 1) pose.fps = p.fps ?? 12;
      if (LOOPING.has(p.kind)) pose.loop = true;
      return [p.name, pose];
    }));
    const enter = b.enter && list.find((p) => p.name === b.enter);
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
  }
  manifest.store = null;
  // item.json's "manifest" goes in as it is (validate keeps it off the fields written above);
  // its "assets" only adds entries such as "sounds".
  const { assets, ...rest } = item.manifest ?? {};
  Object.assign(manifest.assets, assets);
  return Object.assign(manifest, rest);
}

// What the package is made from: the fields that change pixels or the manifest and every
// video's file key. Prompt texts and start frame settings are left out, so editing them does
// not mark a built package as outdated.
export function packageInputs(item) {
  const PROMPT_ONLY = ['template', 'anchor', 'subject', 'persistentDetails', 'style'];
  const saved = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('__')));
  const fields = Object.fromEntries(Object.entries(saved(item)).filter(([k]) => !PROMPT_ONLY.includes(k) && k !== 'poses' && k !== 'layers'));
  if (item.poses) fields.poses = item.poses.map((p) => {
    const { motion, start, ...rest } = saved(p);
    const v = poseVideo(item, p), img = poseImage(item, p);
    return { ...rest, video: v?.rel, videoKey: v?.exists ? fileKey(v.abs) : null, ...(img ? { imageKey: img.exists ? fileKey(img.abs) : null } : {}) };
  });
  if (item.layers) fields.layers = item.layers.map((l) => {
    const abs = itemPath(item, l.image);
    return { ...saved(l), imageKey: fs.existsSync(abs) ? fileKey(abs) : null };
  });
  // Images are scaled from the anchor, so it changes pixels once an item has any.
  const anchor = item.anchor && itemPath(item, item.anchor);
  if ((posesOf(item).some((p) => p.image) || item.layers) && anchor && fs.existsSync(anchor)) fields.anchorKey = fileKey(anchor);
  return crypto.createHash('sha1').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
}
