// Video -> PNG frames (ffmpeg) -> keyed frames, cached per video file.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { keyDir } from './key.mjs';
import { progress, UserError } from './log.mjs';
import { fileKey, listFrames } from './util.mjs';

export const SOURCE_FPS = 24; // every clip is sampled at 24 fps; poses take every 2nd (12 fps) or 3rd (8 fps) frame
const SHEET_COLS = 12;

const run = promisify(execFile);

let tools = null;
export function ffmpegTools() {
  if (tools) return tools;
  const find = (name) => {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      const file = path.join(dir, name);
      try { fs.accessSync(file, fs.constants.X_OK); return file; } catch {}
    }
    return null;
  };
  const ffmpeg = find('ffmpeg'), ffprobe = find('ffprobe');
  if (!ffmpeg || !ffprobe) {
    throw new UserError(`${!ffmpeg ? 'ffmpeg' : 'ffprobe'} not found on PATH. Install ffmpeg (it ships ffprobe): macOS "brew install ffmpeg", Debian/Ubuntu "sudo apt install ffmpeg"`);
  }
  return (tools = { ffmpeg, ffprobe });
}

// A video ffmpeg cannot read is the user's to fix: say which file and what ffmpeg reported.
async function tool(bin, args, video) {
  try { return await run(bin, args, { maxBuffer: 16 << 20 }); }
  catch (e) {
    if (e.code === 'ENOENT' || e.stderr === undefined) throw e;
    const why = String(e.stderr).trim().split('\n').pop().replace(/^\[[^\]]*\]\s*/, '').replace(`${video}: `, '');
    throw new UserError(`cannot read video ${path.basename(video)}: ${why || `${path.basename(bin)} exited with code ${e.code}`}`);
  }
}

// Duration, nominal fps, display size and colour tags of the first video stream.
export async function probe(video) {
  const { ffprobe } = ffmpegTools();
  const { stdout } = await tool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,avg_frame_rate,r_frame_rate,color_space,color_range,duration:stream_side_data_list:format=duration',
    '-of', 'json', video], video);
  const j = JSON.parse(stdout), s = j.streams?.[0];
  if (!s) throw new Error(`no video stream in ${video}`);
  const rate = (r) => { const [a, b] = String(r ?? '0/1').split('/').map(Number); return b ? a / b : 0; };
  const rotation = Math.abs(Number(s.side_data_list?.find((d) => d.rotation != null)?.rotation ?? 0)) % 180;
  return {
    duration: Number(s.duration ?? j.format?.duration ?? 0),
    fps: rate(s.avg_frame_rate) || rate(s.r_frame_rate),
    width: rotation === 90 ? s.height : s.width,
    height: rotation === 90 ? s.width : s.height,
    colorSpace: s.color_space ?? null,
    colorRange: s.color_range ?? null,
  };
}

// YUV -> RGB has to use the same matrix and range everywhere, otherwise the same video gives
// slightly different frames per platform. Tagged videos use their tags; untagged ones follow the
// usual convention (BT.709 from 720 lines up, BT.601 below, limited range).
const MATRIX = { bt709: 'bt709', smpte170m: 'bt601', bt470bg: 'bt601', fcc: 'fcc', smpte240m: 'smpte240m', bt2020nc: 'bt2020', bt2020c: 'bt2020' };
export function colourConversion(info) {
  const matrix = MATRIX[info.colorSpace] ?? (info.height >= 720 ? 'bt709' : 'bt601');
  const range = info.colorRange === 'pc' ? 'pc' : 'tv';
  return { matrix, range };
}

// Returns { dir, src, key, info } where src/key hold f000.png… and info is the video metadata.
export async function extract(video, cacheRoot) {
  if (!fs.existsSync(video)) throw new Error(`video not found: ${video}`);
  const dir = path.join(cacheRoot, `${path.basename(video, path.extname(video))}-${fileKey(video)}`);
  const src = path.join(dir, 'src'), key = path.join(dir, 'key'), infoFile = path.join(dir, 'info.json');
  if (fs.existsSync(infoFile)) return { dir, src, key, info: JSON.parse(fs.readFileSync(infoFile, 'utf8')) };

  const { ffmpeg } = ffmpegTools();
  const meta = await probe(video);
  if (!(meta.duration > 0)) throw new Error(`cannot read video: ${video}`);
  const conv = colourConversion(meta);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(src, { recursive: true });
  progress('extracting frames', `${path.basename(video)} (${conv.matrix}, ${conv.range} range)`);
  const vf = [
    `fps=${SOURCE_FPS}`,
    `scale=in_color_matrix=${conv.matrix}:in_range=${conv.range}:out_color_matrix=${conv.matrix}:out_range=pc:flags=accurate_rnd+full_chroma_int+bitexact`,
    'format=rgb24',
  ].join(',');
  await tool(ffmpeg, ['-v', 'error', '-nostdin', '-i', video, '-map', '0:v:0', '-an', '-sn', '-vf', vf,
    '-fflags', '+bitexact', '-flags', '+bitexact', '-start_number', '0', path.join(src, 'f%03d.png')], video);
  const files = listFrames(src);
  if (!files.length) throw new Error(`ffmpeg wrote no frames for ${video}`);
  await contactSheet(src, files);

  const info = { duration: meta.duration, fps: meta.fps, width: meta.width, height: meta.height, frames: files.length, colour: conv };
  progress('removing background', `${info.frames} frames`);
  info.background = await keyDir(src, key);
  info.frameCount = listFrames(key).length;
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 1));
  return { dir, src, key, info };
}

// Half-size frames, SHEET_COLS per row, on white: what the range picker shows.
async function contactSheet(dir, files) {
  const first = await sharp(path.join(dir, files[0])).metadata();
  const w = Math.floor(first.width / 2), h = Math.floor(first.height / 2);
  const rows = Math.ceil(files.length / SHEET_COLS);
  const tiles = await Promise.all(files.map((f) => sharp(path.join(dir, f)).resize(w, h).png().toBuffer()));
  await sharp({ create: { width: w * SHEET_COLS, height: h * rows, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, k) => ({ input, left: (k % SHEET_COLS) * w, top: Math.floor(k / SHEET_COLS) * h })))
    .png().toFile(path.join(dir, 'sheet.png'));
}

export const sheetLayout = (info) => ({ cols: SHEET_COLS, tileW: Math.floor(info.width / 2), tileH: Math.floor(info.height / 2) });

