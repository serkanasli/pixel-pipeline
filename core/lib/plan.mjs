// Plan templates (templates/plans/*.json) and new items made from them. A template is data: the
// ordered pose list, how the poses chain and the behavior. Nothing in the code knows a template
// or a pose by name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { info, UserError } from './log.mjs';
import { saveItem, SCHEMA_VERSION, validate } from './schema.mjs';

export const PLANS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/plans');
export const ITEM_DIRS = ['videos', 'start-frames'];

export function listTemplates() {
  return fs.readdirSync(PLANS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(PLANS_DIR, f), 'utf8')) }));
}

export function loadTemplate(name) {
  const t = listTemplates().find((t) => t.name === name);
  if (!t) throw new UserError(`unknown template "${name}"; available: ${listTemplates().map((t) => t.name).join(', ')}`);
  return t;
}

const titleCase = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The item.json a template gives for a new item; `fields` override any top-level field.
export function itemFromTemplate(template, dirName, fields = {}) {
  const t = loadTemplate(template);
  const slug = slugify(dirName) || 'item';
  const item = {
    schemaVersion: SCHEMA_VERSION,
    id: `${t.type}.${slug}`,
    name: { en: titleCase(slug), tr: titleCase(slug) },
    type: t.type,
    template: t.name,
    subject: '',
    persistentDetails: [],
    ...structuredClone(t.item),
    poses: structuredClone(t.poses),
    behavior: structuredClone(t.behavior ?? {}),
    ...fields,
  };
  return validate(item);
}

// Creates <dir> with item.json, videos/ and start-frames/; copies the anchor image when given.
export function createItem(dir, { template, anchor, fields = {} }) {
  const abs = path.resolve(dir);
  if (fs.existsSync(path.join(abs, 'item.json'))) throw new UserError(`${abs} already holds an item.json`);
  const item = itemFromTemplate(template, path.basename(abs), fields);
  fs.mkdirSync(abs, { recursive: true });
  for (const d of ITEM_DIRS) fs.mkdirSync(path.join(abs, d), { recursive: true });
  if (anchor) {
    const ext = path.extname(anchor).toLowerCase().replace('.jpeg', '.jpg');
    if (!['.png', '.jpg'].includes(ext)) throw new UserError('the anchor image must be a .png or .jpg file');
    fs.copyFileSync(anchor, path.join(abs, `anchor${ext}`));
    item.anchor = `anchor${ext}`;
  }
  const file = saveItem(item, path.join(abs, 'item.json'));
  info(`created ${item.id} from template ${template}`);
  return file;
}
