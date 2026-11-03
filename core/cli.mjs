#!/usr/bin/env node
// pixel-pipeline: side-view videos of a character, pet or object -> pixel art package (atlas + manifest).
// Every command calls the same core functions as the web UI and logs to <item>/logs/.
//
//   init <dir> --template <name> [--anchor <img>] [--id <type.name>]   new item folder from a plan template
//   templates                                                        list plan templates
//   status <item.json>                                               stage of every pose and the next step
//   start-frame <item.json> <pose>                                   start-frames/<pose>.png for the video model
//   prompt <item.json> <pose>                                        video prompt for the pose
//   inspect <item.json> <pose> | inspect <video>                     frames, contact sheet, suggested range
//   set-range <item.json> <pose> <a> <b>                             choose the pose's range (24 fps source frames)
//   make <item.json> [--out dir]                                     package + preview.html + report.json
//
// With --json the result is printed to stdout as JSON and progress goes to stderr as JSON lines.
import path from 'node:path';
import { inspectPose, inspectVideo, setRange } from './lib/inspect.mjs';
import { logError, setJsonProgress, UserError, withLog } from './lib/log.mjs';
import { make } from './lib/make.mjs';
import { createItem, listTemplates } from './lib/plan.mjs';
import { videoPrompt } from './lib/prompt.mjs';
import { loadItem } from './lib/schema.mjs';
import { makeStartFrame } from './lib/startframe.mjs';
import { describeNext, itemStatus } from './lib/status.mjs';

const USAGE = `usage:
  cli.mjs init <dir> --template <name> [--anchor <img>] [--id <type.name>]
  cli.mjs templates
  cli.mjs status <item.json>
  cli.mjs start-frame <item.json> <pose>
  cli.mjs prompt <item.json> <pose>
  cli.mjs inspect <item.json> <pose>   |   cli.mjs inspect <video> [--cache dir]
  cli.mjs set-range <item.json> <pose> <a> <b>
  cli.mjs make <item.json> [--out dir]
options: --json (result on stdout as JSON, progress on stderr as JSON lines)`;

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}

const VALUE_FLAGS = ['template', 'anchor', 'id', 'out', 'cache'];
const args = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') flags.json = true;
  else if (a.startsWith('--') && VALUE_FLAGS.includes(a.slice(2))) flags[a.slice(2)] = args[++i];
  else if (a.startsWith('--')) usage(`unknown option ${a}`);
  else pos.push(a);
}
setJsonProgress(!!flags.json);
const [cmd, ...rest] = pos;

function print(result, human) {
  if (flags.json) process.stdout.write(JSON.stringify(result) + '\n');
  else console.log(human(result));
}

const need = (n) => { if (rest.length < n) usage(`${cmd} needs ${n} argument${n > 1 ? 's' : ''}`); };
const isItemFile = (f) => path.basename(f) === 'item.json' || f.endsWith('.json');

// Commands on an item log into that item's folder, failures included.
function inItem(dir, fn) {
  return withLog({ itemDir: dir }, async () => {
    try { return await fn(); }
    catch (e) { logError(e); throw e; }
  });
}
const onItem = (file, fn) => inItem(path.dirname(path.resolve(file)), () => fn(loadItem(file)));

const COMMANDS = {
  async init() {
    need(1);
    if (!flags.template) usage('init needs --template <name>');
    const dir = path.resolve(rest[0]);
    const fields = flags.id ? { id: flags.id, type: flags.id.split('.')[0] } : {};
    const file = await inItem(dir, () => createItem(dir, { template: flags.template, anchor: flags.anchor && path.resolve(flags.anchor), fields }));
    const item = loadItem(file);
    print({ item: file, id: item.id, status: itemStatus(item) }, (r) => `created ${r.item} (${r.id})\nnext: ${describeNext(item, r.status.next)}`);
  },

  async templates() {
    const list = listTemplates().map((t) => ({ name: t.name, title: t.title, type: t.type,
      poses: (t.poses ?? []).map((p) => `${p.name}:${p.kind}`), layers: (t.layers ?? []).map((l) => l.name) }));
    print(list, (l) => l.map((t) => `${t.name.padEnd(16)} ${t.type.padEnd(11)} ${[...t.poses, ...t.layers.map((n) => `layer:${n}`)].join(' ')}`).join('\n'));
  },

  async status() {
    need(1);
    await onItem(rest[0], (item) => {
      const s = itemStatus(item);
      print(s, (s) => [
        `${s.id}: ${[s.posesTotal ? `${s.posesDone}/${s.posesTotal} poses` : null, s.layersTotal ? `${s.layersDone}/${s.layersTotal} layers` : null].filter(Boolean).join(', ')} ready, package ${s.package.state}${s.package.packageKB ? ` (${s.package.packageKB} KB)` : ''}`,
        ...s.poses.map((p) => `  ${p.name.padEnd(12)} ${p.kind.padEnd(10)} ${p.stage}${p.range ? `  range ${p.range[0]}–${p.range[1]}` : p.suggested ? `  suggested ${p.suggested[0]}–${p.suggested[1]}` : ''}${p.note ? `  (${p.note})` : ''}`),
        ...s.layers.map((l) => `  ${l.name.padEnd(12)} ${'layer'.padEnd(10)} ${l.hasImage ? 'done' : `no image (${l.image})`}`),
        `next: ${describeNext(item, s.next)}`,
      ].join('\n'));
    });
  },

  async 'start-frame'() {
    need(2);
    await onItem(rest[0], async (item) => {
      const r = await makeStartFrame(item, rest[1]);
      print(r, (r) => `start frame: ${r.image}\nfrom ${r.source === 'anchor' ? r.anchor : `${r.pose} frame ${r.sourceFrame}`}, background ${r.background}, figure ${r.figure.w}×${r.figure.h} at (${r.figure.x}, ${r.figure.y})`);
    });
  },

  async prompt() {
    need(2);
    await onItem(rest[0], async (item) => {
      const r = await videoPrompt(item, rest[1]);
      if (!r.text) throw new UserError(`${rest[1]}: the prompt needs ${r.missing.join(', ')} first`);
      print(r, (r) => r.text);
    });
  },

  async inspect() {
    need(1);
    if (rest.length >= 2 && isItemFile(rest[0])) {
      await onItem(rest[0], async (item) => {
        const r = await inspectPose(item, rest[1]);
        print(r, (r) => [
          `${r.pose} (${r.kind}, ${r.fps} fps): ${r.video}, ${r.frames} frames at 24 fps, ${r.info.width}×${r.info.height}`,
          r.suggestion ? `suggested range ${r.suggestion.start}–${r.suggestion.end}${r.suggestion.score != null ? ` (loop score ${r.suggestion.score})` : ''}` : 'no suggestion: choose the range with set-range',
          r.range ? `range in use ${r.range[0]}–${r.range[1]} (${r.rangeChosen ? 'chosen' : 'suggested'}), ${r.played} frames played` : null,
          r.locomotion ? `stride ${r.locomotion.strideLength} pt, speed ${r.locomotion.speed} pt/s` : null,
          `contact sheet: ${r.contactSheet} (${r.sheet.cols} per row)`,
        ].filter(Boolean).join('\n'));
      });
      return;
    }
    const video = path.resolve(rest[0]);
    const r = await inspectVideo(video, flags.cache && path.resolve(flags.cache));
    const s = r.suggestions;
    print(r, (r) => [
      `${path.basename(video)}: ${r.frames} frames at 24 fps, ${r.info.width}×${r.info.height}`,
      `figure ${r.figure?.width}×${r.figure?.height} px (first frame)`,
      `loop:       ${s.loop ? `${s.loop.start}–${s.loop.end} (score ${s.loop.score})` : 'no suggestion'}`,
      `locomotion: ${s.locomotion ? `${s.locomotion.start}–${s.locomotion.end} (score ${s.locomotion.score})` : 'no suggestion'}`,
      `transition: ${s.transition ? `${s.transition.start}–${s.transition.end}` : 'no suggestion'}`,
      `reaction:   ${s.reaction ? `${s.reaction.start}–${s.reaction.end} (return score ${s.reaction.returnScore})` : 'no suggestion'}`,
      `contact sheet: ${r.contactSheet}`,
    ].join('\n'));
  },

  async 'set-range'() {
    need(4);
    await onItem(rest[0], async (item) => {
      const r = await setRange(item, rest[1], rest[2], rest[3]);
      print(r, (r) => [`${r.pose}: range ${r.range[0]}–${r.range[1]}, ${r.played} frames at ${r.fps} fps`,
        r.locomotion ? `stride ${r.locomotion.strideLength} pt, speed ${r.locomotion.speed} pt/s` : null].filter(Boolean).join('\n'));
    });
  },

  async make() {
    need(1);
    await onItem(rest[0], async (item) => {
      const r = await make(item, { out: flags.out && path.resolve(flags.out) });
      print(r, (r) => [
        `package: ${r.output}`,
        `size ${r.size.width}×${r.size.height} pt, anchor y ${r.anchor.y}, ${r.sourcePxPerPixel} source px per pixel, ${r.palette.length} colours`,
        ...Object.entries(r.poses).map(([n, p]) => `  ${n.padEnd(12)} ${p.kind.padEnd(10)} ${String(p.frames).padStart(3)} frames${p.fps ? ` @ ${p.fps} fps` : ''}${p.range ? `  (source ${p.range[0]}–${p.range[1]}${p.rangeChosen ? '' : ', suggested'})` : ''}`),
        r.locomotion ? `stride ${r.locomotion.strideLength} pt, speed ${r.locomotion.speed} pt/s` : null,
        ...Object.entries(r.layers ?? {}).map(([n, l]) => `  ${n.padEnd(12)} ${'layer'.padEnd(10)} z ${l.z}, ${l.w}×${l.h} px, ${l.kb} KB (${l.background})`),
        r.atlas ? `atlas ${r.atlas.w}×${r.atlas.h} (${r.atlas.kb} KB, ${r.atlas.memoryMB} MB in memory)` : null,
        `package ${r.packageKB} KB of ${r.budgetKB} KB`,
        ...r.warnings.map((w) => `! ${w}`),
        `preview: ${r.preview}`,
      ].filter(Boolean).join('\n'));
    });
  },
};

if (!COMMANDS[cmd]) usage(cmd ? `unknown command "${cmd}"` : null);
try {
  await COMMANDS[cmd]();
} catch (e) {
  const text = e instanceof UserError ? e.message : (e.stack ?? String(e));
  if (flags.json) process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
  else console.error(`error: ${text}`);
  process.exit(1);
}
