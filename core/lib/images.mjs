// Single images that go into a package next to (or instead of) video frames: a still pose's
// image and, for static items, the layers. They get the same background removal as video
// frames; an image that already has transparent pixels keeps its own alpha.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { keyFrame, keyTag } from './key.mjs';
import { UserError } from './log.mjs';
import { fileKey, measure } from './util.mjs';

// key: true (or settings, see key.mjs) removes the flat background, false keeps the image opaque
// as it is. Either way an
// image with real transparency is taken as it is. Returns { file, mode, width, height, m }
// where file is an RGBA PNG in the cache and m its opaque bounding box.
export async function prepareImage(abs, cacheRoot, { key } = {}) {
  if (!fs.existsSync(abs)) throw new UserError(`image not found: ${abs}`);
  const dir = path.join(cacheRoot, 'images', `${path.basename(abs, path.extname(abs))}-${fileKey(abs)}`);
  const { data, info } = await sharp(abs).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { transparent = true; break; }
  const mode = transparent ? 'alpha' : key !== false ? 'keyed' : 'opaque';
  const file = path.join(dir, `${mode}${mode === 'keyed' ? keyTag(key) : ''}.png`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    if (mode === 'keyed') await keyFrame(abs, file, key);
    else await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(file);
  }
  const out = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = measure(out.data, out.info.width, out.info.height);
  if (!m) throw new UserError(`${path.basename(abs)}: nothing is left after background removal`);
  return { file, mode, width: out.info.width, height: out.info.height, m };
}
