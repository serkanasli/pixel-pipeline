// Places pixel art frames on a common canvas (anchor point and ground line), trims them and
// shelf-packs everything into one losslessly stored atlas.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { measure } from './util.mjs';

const GAP = 2;

// frames: [{ name, file, anchorX, ground }] in art px of the pixelized grid.
// Returns { canvas: { w, h }, groundRow, anchorY, sprites: [{ name, x, y, w, h, offX, offY }], atlas: Buffer, atlasSize }
export async function pack(frames, { margin = 2, maxWidth = 2048, minCanvas = null } = {}) {
  for (const fr of frames) {
    const { data, info } = await sharp(fr.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    fr.m = measure(data, info.width, info.height);
    if (!fr.m) throw new Error(`empty frame after processing: ${fr.name}`);
  }
  // Canvas: symmetric around the anchor so the manifest anchor is x = 0.5.
  let half = 0, up = 0, down = 0;
  for (const { m, anchorX, ground } of frames) {
    half = Math.max(half, anchorX - m.minX, m.maxX + 1 - anchorX);
    up = Math.max(up, ground - m.minY);
    down = Math.max(down, m.maxY + 1 - ground);
  }
  // A frame's ground is its lowest pixel row, so down is 1 unless something hangs below the
  // ground (a tail swinging down). Then the canvas keeps room under the ground line; otherwise the
  // row on the ground is the canvas's last row and the anchor sits on its bottom edge (y = 1).
  const sags = down > 1;
  let w = 2 * Math.ceil(half + margin), h = sags ? Math.ceil(up + down + 2 * margin) : Math.ceil(up + 1 + margin);
  if (minCanvas) { w = Math.max(w, minCanvas.w); h = Math.max(h, minCanvas.h); }
  if (w % 2) w++;
  const groundRow = sags ? h - margin - Math.ceil(down) : h - 1;
  const anchorY = sags ? groundRow / h : 1;

  const sprites = [];
  for (const fr of frames) {
    const left = Math.round(w / 2 - fr.anchorX), top = Math.round(groundRow - fr.ground);
    const x0 = fr.m.minX, y0 = fr.m.minY;
    const buf = await sharp(fr.file).extract({ left: x0, top: y0, width: fr.m.width, height: fr.m.height }).png().toBuffer();
    sprites.push({ name: fr.name, buf, w: fr.m.width, h: fr.m.height, offX: left + x0, offY: top + y0 });
  }

  // Shelf packing, tallest first.
  const order = [...sprites].sort((a, b) => b.h - a.h);
  let x = 0, y = 0, shelfH = 0, usedW = 0;
  for (const s of order) {
    if (x + s.w > maxWidth) { x = 0; y += shelfH + GAP; shelfH = 0; }
    s.x = x; s.y = y;
    x += s.w + GAP; shelfH = Math.max(shelfH, s.h); usedW = Math.max(usedW, x - GAP);
  }
  const atlasSize = { w: usedW, h: y + shelfH };
  const atlas = await sharp({ create: { width: atlasSize.w, height: atlasSize.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(sprites.map((s) => ({ input: s.buf, left: s.x, top: s.y })))
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  return {
    canvas: { w, h }, groundRow, anchorY, atlas, atlasSize,
    sprites: sprites.map(({ name, x, y, w, h, offX, offY }) => ({ name, x, y, w, h, offX, offY })),
  };
}

export function writeAtlas(outDir, base, packed, ptPerPixel) {
  fs.mkdirSync(outDir, { recursive: true });
  const image = `${base}-atlas.webp`, map = `${base}-atlas.json`;
  fs.writeFileSync(path.join(outDir, image), packed.atlas);
  const json = {
    meta: { image, size: packed.atlasSize, scale: 1 / ptPerPixel, filter: 'nearest', sourceSize: packed.canvas },
    frames: Object.fromEntries(packed.sprites.map((s) => [s.name, { x: s.x, y: s.y, w: s.w, h: s.h, offX: s.offX, offY: s.offY }])),
  };
  fs.writeFileSync(path.join(outDir, map), JSON.stringify(json, null, 1));
  return { image, map, json };
}
