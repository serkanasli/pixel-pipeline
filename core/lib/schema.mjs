// item.json, schema version 2: what an item is, which poses it has and how they chain.
// The validator rejects unknown fields and says which field is wrong and why. An item may be
// unfinished (no subject yet, a pose without video): that is a stage reported by status, not
// an error. Only `make` needs every pose to have its video.
import fs from 'node:fs';
import path from 'node:path';
import { UserError } from './log.mjs';

export const SCHEMA_VERSION = 2;
export const KINDS = ['locomotion', 'loop', 'transition', 'reaction', 'still'];
export const FPS = [6, 8, 12, 24];
export const FACING = ['left', 'right'];
export const LOOPING = new Set(['locomotion', 'loop']); // range end is the frame that matches the start
export const START_DEFAULTS = { below: 0.2, maxFigure: 0.66, width: 1600, height: 900 };
export const OCCASIONAL_DEFAULTS = { weight: 1, wait: [5, 12] };

const ITEM_FIELDS = ['schemaVersion', 'id', 'name', 'type', 'version', 'facing', 'template', 'anchor', 'subject', 'persistentDetails', 'style',
  'pixelWidth', 'ptPerPixel', 'colors', 'referencePose', 'output', 'poses', 'behavior'];
const POSE_FIELDS = ['name', 'kind', 'fps', 'startsFrom', 'image', 'motion', 'video', 'range', 'start'];
export const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const START_FIELDS = Object.keys(START_DEFAULTS);
const BEHAVIOR_FIELDS = ['enter', 'arrive', 'onPress', 'occasional', 'restTracks'];
// Fields of version 1 with their replacement, so an old file gets a useful message.
const RENAMED = { from: 'startsFrom: { "pose": …, "frame": "first" | "last" }', frame: 'startsFrom: { "pose": …, "frame": … }' };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';

export function loadItem(file) {
  const abs = path.resolve(file);
  let item;
  try { item = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { throw new UserError(e.code === 'ENOENT' ? `item.json not found: ${abs}` : `item.json: invalid JSON (${e.message})`); }
  validate(item);
  Object.defineProperty(item, '__dir', { value: path.dirname(abs), enumerable: false, writable: true });
  Object.defineProperty(item, '__file', { value: abs, enumerable: false, writable: true });
  return item;
}

// Writes the item with a stable field order. Runtime fields (__clip, __frames…) are never saved.
export function saveItem(item, file = item.__file) {
  validate(item);
  const clean = JSON.parse(JSON.stringify(item, (k, v) => (k.startsWith('__') ? undefined : v)));
  const ordered = orderKeys(clean, ITEM_FIELDS);
  ordered.poses = clean.poses.map((p) => orderKeys(p, POSE_FIELDS));
  fs.writeFileSync(file, formatJson(ordered) + '\n');
  return file;
}

// JSON with 2-space indent, but short arrays and flat objects on one line, the way item.json
// files are written by hand ("range": [42, 74], "name": { "en": …, "tr": … }).
export function formatJson(v, indent = '') {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  const inline = JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']');
  const prim = (x) => x === null || typeof x !== 'object';
  const flat = (x) => (Array.isArray(x) ? x.every(prim) : Object.values(x).every((y) => prim(y) || (Array.isArray(y) && y.every(prim))));
  if (flat(v) && indent.length + inline.length <= 100) return inline;
  const inner = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + formatJson(x, inner)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatJson(x, inner)}`).join(',\n')}\n${indent}}`;
}

const orderKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export function validate(item) {
  const err = (m) => { throw new UserError(`item.json: ${m}`); };
  if (!isObj(item)) err('must be a JSON object');
  unknown(item, ITEM_FIELDS, '', err);
  if (item.schemaVersion !== SCHEMA_VERSION) err(`"schemaVersion" must be ${SCHEMA_VERSION} (found ${JSON.stringify(item.schemaVersion)}); see README for the version 2 fields`);
  if (!/^[a-z]+\.[a-z0-9]+(-[a-z0-9]+)*$/.test(item.id ?? '')) err('"id" must be "<type>.<kebab-case>", e.g. "pet.shadow-wolf"');
  if (!/^[a-z]+$/.test(item.type ?? '')) err('"type" must be one lowercase word, e.g. "pet" or "character"');
  if (item.id.split('.')[0] !== item.type) err(`"id" starts with "${item.id.split('.')[0]}" but "type" is "${item.type}"; they must match`);
  if (item.name !== undefined) {
    if (!isObj(item.name)) err('"name" must be an object like { "en": "…", "tr": "…" }');
    for (const [k, v] of Object.entries(item.name)) if (!/^[a-z]{2}$/.test(k) || !isStr(v)) err(`"name.${k}" must be a text under a two-letter language code`);
  }
  if (item.version !== undefined && !/^\d+\.\d+\.\d+$/.test(item.version)) err('"version" must look like "0.1.0"');
  if (item.facing !== undefined && !FACING.includes(item.facing)) err(`"facing" must be ${FACING.join(' or ')}`);
  for (const k of ['template', 'anchor', 'subject', 'style', 'referencePose', 'output']) if (item[k] !== undefined && !isStr(item[k])) err(`"${k}" must be a text`);
  if (item.anchor !== undefined && !/\.(png|jpe?g)$/i.test(item.anchor)) err('"anchor" must be a .png or .jpg file inside the item folder');
  for (const k of ['anchor', 'output']) if (item[k] !== undefined) inside(item[k], `"${k}"`, err);
  if (item.persistentDetails !== undefined && (!Array.isArray(item.persistentDetails) || !item.persistentDetails.every((d) => isStr(d) && d.trim())))
    err('"persistentDetails" must be a list of non-empty texts');
  if (item.pixelWidth !== undefined && !(Number.isInteger(item.pixelWidth) && item.pixelWidth >= 16 && item.pixelWidth <= 1024)) err('"pixelWidth" must be a whole number between 16 and 1024');
  if (item.ptPerPixel !== undefined && ![1, 2, 3, 4].includes(item.ptPerPixel)) err('"ptPerPixel" must be 1, 2, 3 or 4');
  if (item.colors !== undefined && !(Number.isInteger(item.colors) && item.colors >= 2 && item.colors <= 256)) err('"colors" must be a whole number between 2 and 256');

  if (!Array.isArray(item.poses) || !item.poses.length) err('"poses" must be a non-empty list');
  const names = new Set();
  item.poses.forEach((p, i) => {
    const at = `poses[${i}]${isStr(p?.name) ? ` "${p.name}"` : ''}`;
    if (!isObj(p)) err(`${at} must be an object`);
    for (const k of Object.keys(p)) {
      if (POSE_FIELDS.includes(k)) continue;
      err(`${at}: unknown field "${k}"${RENAMED[k] ? ` (version 2 uses ${RENAMED[k]})` : ''}`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(p.name ?? '')) err(`${at}: "name" must be snake_case (lowercase letters, digits, _)`);
    if (names.has(p.name)) err(`${at}: pose name "${p.name}" appears twice`);
    names.add(p.name);
    if (!KINDS.includes(p.kind)) err(`${at}: "kind" must be one of ${KINDS.join(', ')}`);
    if (p.motion !== undefined && !isStr(p.motion)) err(`${at}: "motion" must be a text`);
    if (p.kind === 'still') {
      for (const k of ['fps', 'video', 'range', 'start']) if (p[k] !== undefined) err(`${at}: a still is one frame from another pose or an image, "${k}" is not used`);
      if ((p.startsFrom === undefined) === (p.image === undefined))
        err(`${at}: a still needs either "startsFrom": { "pose": …, "frame": "first" | "last" | <source frame> } or "image": "anchor" | "<file>"`);
      if (p.startsFrom !== undefined && !isObj(p.startsFrom)) err(`${at}: a still's "startsFrom" must be { "pose": …, "frame": … }`);
      if (p.image !== undefined && p.image !== 'anchor') {
        if (!isStr(p.image) || !IMAGE_EXT.test(p.image)) err(`${at}: "image" must be "anchor" or a .png, .jpg or .webp file inside the item folder`);
        inside(p.image, `${at}: "image"`, err);
      }
    } else {
      if (p.image !== undefined) err(`${at}: only a still takes "image"; a ${p.kind} comes from its video`);
      if (p.fps !== undefined && !FPS.includes(p.fps)) err(`${at}: "fps" must be ${FPS.join(', ')}`);
      if (p.video !== undefined) { if (!isStr(p.video) || !p.video) err(`${at}: "video" must be a path`); inside(p.video, `${at}: "video"`, err); }
      if (p.range !== undefined) {
        if (!Array.isArray(p.range) || p.range.length !== 2 || !p.range.every((v) => Number.isInteger(v) && v >= 0) || p.range[0] >= p.range[1])
          err(`${at}: "range" must be [start, end] with whole source frame numbers (24 fps) and start < end`);
        const step = 24 / (p.fps ?? 12);
        if (LOOPING.has(p.kind) && (p.range[1] - p.range[0]) % step)
          err(`${at}: a ${p.kind} range must span a multiple of ${step} source frames at ${p.fps ?? 12} fps (found ${p.range[1] - p.range[0]})`);
      }
      if (p.startsFrom === undefined) err(`${at}: "startsFrom" is missing ("anchor" or { "pose": …, "frame": … })`);
    }
    if (p.start !== undefined) {
      if (!isObj(p.start)) err(`${at}: "start" must be an object`);
      unknown(p.start, START_FIELDS, `${at}: start.`, err);
      const chained = p.startsFrom !== 'anchor';
      for (const k of ['below', 'maxFigure']) {
        if (p.start[k] === undefined) continue;
        if (chained) err(`${at}: "start.${k}" only applies to poses that start from the anchor; a chained start frame keeps the position of the frame it continues from`);
        if (!(typeof p.start[k] === 'number' && p.start[k] >= 0 && p.start[k] <= (k === 'below' ? 0.6 : 1) && (k === 'below' || p.start[k] >= 0.1)))
          err(`${at}: "start.${k}" must be a number between ${k === 'below' ? '0 and 0.6' : '0.1 and 1'}`);
      }
      for (const k of ['width', 'height']) if (p.start[k] !== undefined && !(Number.isInteger(p.start[k]) && p.start[k] >= 256 && p.start[k] <= 4096))
        err(`${at}: "start.${k}" must be a whole number of pixels between 256 and 4096`);
    }
  });
  for (const [i, p] of item.poses.entries()) {
    const at = `poses[${i}] "${p.name}"`;
    if (p.startsFrom === undefined || p.startsFrom === 'anchor') continue;
    const s = p.startsFrom;
    if (!isObj(s)) err(`${at}: "startsFrom" must be "anchor" or { "pose": …, "frame": … }`);
    unknown(s, ['pose', 'frame'], `${at}: startsFrom.`, err);
    if (!names.has(s.pose)) err(`${at}: "startsFrom.pose" refers to unknown pose "${s.pose}"`);
    if (s.pose === p.name) err(`${at}: a pose cannot start from itself`);
    if (item.poses.find((q) => q.name === s.pose).kind === 'still') err(`${at}: "${s.pose}" is a still and has no frames of its own; start from the pose it comes from`);
    if (!(s.frame === 'first' || s.frame === 'last' || (Number.isInteger(s.frame) && s.frame >= 0)))
      err(`${at}: "startsFrom.frame" must be "first", "last" or a source frame number`);
    const ref = item.poses.find((q) => q.name === s.pose);
    if (Number.isInteger(s.frame) && ref.range && (s.frame < ref.range[0] || s.frame > ref.range[1]))
      err(`${at}: "startsFrom.frame" ${s.frame} is outside the range of "${s.pose}" (${ref.range[0]}–${ref.range[1]})`);
  }
  chainOrder(item.poses, err);
  if (item.referencePose !== undefined && !item.poses.some((p) => p.name === item.referencePose && p.kind !== 'still'))
    err(`"referencePose" must name a pose with a video`);

  const b = item.behavior ?? {};
  if (!isObj(b)) err('"behavior" must be an object');
  unknown(b, BEHAVIOR_FIELDS, 'behavior.', err);
  const known = (ref, where) => { if (!names.has(ref)) err(`${where} refers to unknown pose "${ref}"`); };
  for (const k of ['enter', 'onPress']) if (b[k] !== undefined) known(b[k], `"behavior.${k}"`);
  if (b.enter !== undefined && item.poses.find((p) => p.name === b.enter).kind !== 'locomotion') err('"behavior.enter" must be a locomotion pose');
  if (b.arrive !== undefined) { if (!Array.isArray(b.arrive)) err('"behavior.arrive" must be a list of pose names'); b.arrive.forEach((r) => known(r, '"behavior.arrive"')); }
  if (b.occasional !== undefined) {
    if (!Array.isArray(b.occasional)) err('"behavior.occasional" must be a list');
    b.occasional.forEach((o, i) => {
      const at = `"behavior.occasional[${i}]"`;
      if (isStr(o)) return known(o, at);
      if (!isObj(o)) err(`${at} must be a pose name or { "pose", "weight", "wait": [min, max] }`);
      unknown(o, ['pose', 'weight', 'wait'], `behavior.occasional[${i}].`, err);
      known(o.pose, at);
      if (o.weight !== undefined && !(typeof o.weight === 'number' && o.weight > 0)) err(`${at}: "weight" must be a positive number`);
      if (o.wait !== undefined && !(Array.isArray(o.wait) && o.wait.length === 2 && o.wait.every((v) => typeof v === 'number' && v >= 0) && o.wait[0] <= o.wait[1]))
        err(`${at}: "wait" must be [min, max] seconds with min ≤ max`);
    });
  }
  if (b.restTracks !== undefined && !Array.isArray(b.restTracks)) err('"behavior.restTracks" must be a list');
  return item;
}

function unknown(obj, allowed, prefix, err) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) err(`unknown field "${prefix}${k}"${RENAMED[k] && !prefix ? ` (version 2 uses ${RENAMED[k]})` : ''}`);
}

function inside(rel, where, err) {
  if (path.isAbsolute(rel) || path.normalize(rel).split(/[\\/]/).includes('..')) err(`${where} must be a path inside the item folder`);
}

// Poses in an order where every pose comes after the pose it starts from.
export function chainOrder(poses, err = (m) => { throw new UserError(`item.json: ${m}`); }) {
  const state = new Map(), out = [];
  const visit = (p, trail) => {
    if (state.get(p.name) === 'done') return;
    if (state.get(p.name) === 'visiting') err(`poses start from each other in a circle: ${[...trail, p.name].join(' → ')}`);
    state.set(p.name, 'visiting');
    const ref = refName(p);
    if (ref) visit(poses.find((q) => q.name === ref), [...trail, p.name]);
    state.set(p.name, 'done');
    out.push(p);
  };
  poses.forEach((p) => visit(p, []));
  return out;
}

export const refName = (p) => (p.startsFrom && p.startsFrom !== 'anchor' ? p.startsFrom.pose : null);

export const occasionalList = (b) => (b?.occasional ?? []).map((o) => ({ ...OCCASIONAL_DEFAULTS, ...(isStr(o) ? { pose: o } : o) }));
