#!/usr/bin/env node
// pixel-pipeline: side-view videos of a character -> pixel art package (atlas + manifest).
//
//   node cli.mjs prep-start <image> <out.png> [--below 0.2]   start frame for a video model
//   node cli.mjs inspect <video> [--cache dir] [--json]       frames, contact sheet, suggested ranges
//   node cli.mjs make <item.json> [--out dir] [--json]        package + preview.html + report.json
//
// With --json the result is printed to stdout as JSON and progress goes to stderr as JSON lines.
import path from 'node:path';
import { findLoop, measureClip, reactionRange, transitionRange } from './lib/analyze.mjs';
import { extract } from './lib/frames.mjs';
import { loadItem, make } from './lib/make.mjs';
import { prepStart } from './lib/prep.mjs';
import { setJsonProgress } from './lib/util.mjs';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args[i + 1]; };
const json = args.includes('--json');
setJsonProgress(json);
const [cmd, a1, a2] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--json'].includes(args[i - 1])));

function print(result, human) {
  if (json) process.stdout.write(JSON.stringify(result) + '\n');
  else console.log(human(result));
}

try {
  if (cmd === 'prep-start' && a1 && a2) {
    const r = await prepStart(path.resolve(a1), path.resolve(a2), { below: +flag('below', 0.2) });
    print(r, (r) => `start frame: ${r.output}\nbackground ${r.background}, figure ${r.figure.w}×${r.figure.h} at (${r.figure.x}, ${r.figure.y})`);
  } else if (cmd === 'inspect' && a1) {
    const video = path.resolve(a1);
    const ex = await extract(video, path.resolve(flag('cache', path.join(path.dirname(video), '.pixel-cache'))));
    const clip = await measureClip(ex.key);
    const first = clip.frames[0].m;
    const r = {
      video, info: ex.info, contactSheet: path.join(ex.src, 'sheet.png'), frames: clip.frames.length,
      figure: first && { width: first.width, height: first.height },
      motion: clip.motion,
      suggestions: {
        loop: findLoop(clip, { step: 2, minLen: 12, maxLen: 48 })[0] ?? null,
        transition: transitionRange(clip),
        reaction: reactionRange(clip),
      },
    };
    print(r, (r) => [
      `${path.basename(video)}: ${r.frames} frames at 24 fps, ${r.info.width}×${r.info.height}`,
      `figure ${r.figure?.width}×${r.figure?.height} px (first frame)`,
      `loop:       start ${r.suggestions.loop?.start}, length ${r.suggestions.loop?.length} (score ${r.suggestions.loop?.score})`,
      `transition: frames ${r.suggestions.transition.start}–${r.suggestions.transition.end}`,
      `reaction:   frames ${r.suggestions.reaction.start}–${r.suggestions.reaction.end} (return score ${r.suggestions.reaction.returnScore})`,
      `contact sheet: ${r.contactSheet}`,
    ].join('\n'));
  } else if (cmd === 'make' && a1) {
    const item = loadItem(path.resolve(a1));
    const out = flag('out');
    const r = await make(item, { out: out && path.resolve(out) });
    print(r, (r) => [
      `package: ${r.output}`,
      `size ${r.size.width}×${r.size.height} pt, anchor y ${r.anchor.y}, ${r.sourcePxPerPixel} source px per pixel, ${r.palette.length} colours`,
      ...Object.entries(r.poses).map(([n, p]) => `  ${n.padEnd(12)} ${p.kind.padEnd(10)} ${String(p.frames).padStart(3)} frames @ ${p.fps} fps${p.range ? `  (source ${p.range[0]}–${p.range[1]})` : ''}`),
      r.locomotion ? `stride ${r.locomotion.strideLength} pt, speed ${r.locomotion.speed} pt/s` : null,
      `atlas ${r.atlas.w}×${r.atlas.h} (${r.atlas.kb} KB, ${r.atlas.memoryMB} MB in memory), package ${r.packageKB} KB of ${r.budgetKB} KB`,
      ...r.warnings.map((w) => `! ${w}`),
      `preview: ${r.preview}`,
    ].filter(Boolean).join('\n'));
  } else {
    console.error('usage:\n  cli.mjs prep-start <image> <out.png> [--below 0.2]\n  cli.mjs inspect <video> [--json]\n  cli.mjs make <item.json> [--out dir] [--json]');
    process.exit(2);
  }
} catch (e) {
  if (json) process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
  else console.error(`error: ${e.message}`);
  process.exit(1);
}
