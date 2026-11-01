// Video -> PNG frames (native AVFoundation tool) -> keyed frames, cached per video file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyDir } from './key.mjs';
import { fileKey, listFrames, progress } from './util.mjs';

export const SOURCE_FPS = 24; // every clip is sampled at 24 fps; poses take every 2nd (12 fps) or 3rd (8 fps) frame

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nativeSrc = path.join(root, 'native/frames.swift');
const nativeBin = path.join(root, 'native/bin/frames');

// The frame extractor is compiled on first use (swiftc ships with Xcode / Command Line Tools).
function framesTool() {
  const stale = !fs.existsSync(nativeBin) || fs.statSync(nativeBin).mtimeMs < fs.statSync(nativeSrc).mtimeMs;
  if (stale) {
    progress('compiling frame extractor', 'native/frames.swift');
    fs.mkdirSync(path.dirname(nativeBin), { recursive: true });
    execFileSync('swiftc', ['-O', '-suppress-warnings', nativeSrc, '-o', nativeBin], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  return nativeBin;
}

// Returns { dir, src, key, info } where src/key hold f000.png… and info is the video metadata.
export async function extract(video, cacheRoot) {
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const dir = path.join(cacheRoot, `${path.basename(video, path.extname(video))}-${fileKey(video)}`);
  const src = path.join(dir, 'src'), key = path.join(dir, 'key'), infoFile = path.join(dir, 'info.json');
  if (fs.existsSync(infoFile)) return { dir, src, key, info: JSON.parse(fs.readFileSync(infoFile, 'utf8')) };

  fs.rmSync(dir, { recursive: true, force: true });
  progress('extracting frames', path.basename(video));
  const out = execFileSync(framesTool(), [video, src, String(SOURCE_FPS), '12'], { encoding: 'utf8' });
  const info = JSON.parse(out.trim().split('\n').pop());
  progress('removing background', `${info.frames} frames`);
  const bg = await keyDir(src, key);
  info.background = bg;
  info.frameCount = listFrames(key).length;
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 1));
  return { dir, src, key, info };
}
