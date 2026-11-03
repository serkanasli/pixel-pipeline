// Item types (templates/types/*.json). A type opens no branch in the code: it only gives
// defaults, whether a layer's background is removed ("key") and the anchor of a layered item.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TYPES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../templates/types');

let cache = null;
export function listTypes() {
  cache ??= fs.readdirSync(TYPES_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ name: f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(TYPES_DIR, f), 'utf8')) }));
  return cache;
}

export const typeDefaults = (type) => listTypes().find((t) => t.name === type) ?? { key: true, anchor: { x: 0.5, y: 1 } };
