// Video prompt per pose, filled from item.json with templates/video-prompt.json. The camera
// sentence comes from the pose kind and the background colour from the pose's start frame
// (or the anchor before a start frame exists), so the prompt matches the image it goes with.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { UserError } from './log.mjs';
import { flattenBackground, hex } from './prep.mjs';
import { byName, itemPath } from './poses.mjs';
import { startFramePaths } from './startframe.mjs';

export const PROMPT_TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/video-prompt.json');

// Fields the prompt needs, in the order a person fills them in.
const NEEDS = [
  ['style', (item) => item.style?.trim()],
  ['subject', (item) => item.subject?.trim()],
  ['persistentDetails', (item) => item.persistentDetails?.length],
  ['motion', (item, p) => p.motion?.trim()],
];

export function missingPromptFields(item, p) {
  return NEEDS.filter(([, has]) => !has(item, p)).map(([k]) => k);
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function backgroundColour(item, p) {
  const meta = startFramePaths(item, p.name).meta;
  if (fs.existsSync(meta)) return JSON.parse(fs.readFileSync(meta, 'utf8')).background;
  if (!item.anchor || !fs.existsSync(itemPath(item, item.anchor))) return null;
  const { data, info } = await sharp(itemPath(item, item.anchor)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return hex(flattenBackground(data, info.width, info.height).bg);
}

// { text, missing, background } — text is null while fields are missing.
export async function videoPrompt(item, poseName) {
  const p = byName(item, poseName);
  if (!p) throw new UserError(`unknown pose "${poseName}"`);
  if (p.kind === 'still') throw new UserError(`${p.name} is a still: it uses a frame of ${p.startsFrom.pose} and needs no video`);
  const t = JSON.parse(fs.readFileSync(PROMPT_TEMPLATE, 'utf8'));
  const missing = missingPromptFields(item, p);
  const colour = await backgroundColour(item, p);
  if (!colour) missing.push('anchor');
  if (missing.length) return { text: null, missing, background: colour };
  const sentence = (s) => { const v = s.trim(); return /[.!?]$/.test(v) ? v : `${v}.`; };
  const values = {
    style: sentence(item.style),
    subject: capitalise(item.subject.trim().replace(/[.]$/, '')), // it opens a sentence
    facing: t.facing[item.facing ?? 'left'],
    motion: sentence(p.motion),
    camera: t.camera[p.kind],
    details: t.details.replace('{{list}}', item.persistentDetails.map((d) => d.trim().replace(/[.]$/, '')).join('; ')),
    background: t.background.replace('{{colour}}', colour),
  };
  const text = t.lines.map((l) => l.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in values)) throw new Error(`video-prompt.json: unknown placeholder {{${k}}}`);
    return values[k];
  })).join(' ');
  return { text, missing: [], background: colour };
}
