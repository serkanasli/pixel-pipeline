// The working folder of the web UI: one folder whose subfolders are items (each with an
// item.json). Chosen in the UI and kept in config.local.json at the repo root, which git ignores,
// so no personal path is ever part of the repository.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from './log.mjs';
import { resolveInside } from './util.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG_FILE = path.join(REPO_ROOT, 'config.local.json');

export class HttpError extends UserError {
  constructor(status, message) { super(message); this.status = status; }
}

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new UserError(`config.local.json: ${e.message}`); }
}

export function setWorkspace(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new HttpError(400, 'the working folder must be an absolute path');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(400, `folder not found: ${dir}`);
  const config = { ...readConfig(), workspace: path.resolve(dir) };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  return config;
}

export function workspaceRoot() {
  const ws = readConfig().workspace;
  return ws && fs.existsSync(ws) ? ws : null;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Absolute folder of the item `name` (one folder level under the workspace).
export function itemDir(name, { mustExist = true } = {}) {
  const root = workspaceRoot();
  if (!root) throw new HttpError(409, 'no working folder is set');
  if (!NAME.test(name ?? '')) throw new HttpError(400, `invalid item folder name "${name}": letters, digits, ".", "_" and "-" only`);
  const dir = resolveInside(root, name);
  if (!dir) throw new HttpError(400, `item folder leaves the working folder: ${name}`);
  if (mustExist && !fs.existsSync(path.join(dir, 'item.json'))) throw new HttpError(404, `no item in ${name}`);
  return dir;
}

export function listItemDirs() {
  const root = workspaceRoot();
  if (!root) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && NAME.test(e.name) && fs.existsSync(path.join(root, e.name, 'item.json')))
    .map((e) => e.name).sort();
}

// A file inside an item folder, for serving; null when it would leave the folder.
export function itemFile(name, rel) {
  return resolveInside(itemDir(name), rel);
}
