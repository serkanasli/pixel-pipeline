// Watches the working folder so that changes made outside the UI (a video saved by the CLI, an
// agent or Finder, an edited item.json) reach open pages. Non-recursive watchers only: recursive
// fs.watch is not available everywhere. Per item folder: the folder (item.json, anchor, still and
// layer images), videos/ and start-frames/. Logs, caches and build output are ignored: they change
// during our own jobs.
import fs from 'node:fs';
import path from 'node:path';
import { broadcast } from './events.mjs';
import { workspaceRoot } from './workspace.mjs';

const SUBDIRS = ['videos', 'start-frames'];
const ITEM_FILES = /^(item\.json|[^.][^/]*\.(png|jpe?g|webp)|videos|start-frames)$/i;
const DEBOUNCE_MS = 200;

let root = null;
const watchers = new Map(); // path -> FSWatcher
const pending = new Map(); // item -> timer

function watch(dir, onChange) {
  if (watchers.has(dir) || !fs.existsSync(dir)) return;
  try {
    const w = fs.watch(dir, { persistent: false }, (_, file) => onChange(file ? String(file) : null));
    w.on('error', () => { w.close(); watchers.delete(dir); });
    watchers.set(dir, w);
  } catch {
    // The folder vanished between the check and the call; the next rescan picks it up again.
  }
}

function changed(item, what) {
  clearTimeout(pending.get(item));
  pending.set(item, setTimeout(() => { pending.delete(item); broadcast('changed', { item, what }); }, DEBOUNCE_MS));
}

const subfolders = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); }
  catch { return []; }
};

function rescan() {
  const wanted = new Set();
  if (root) {
    wanted.add(root);
    // Every subfolder, not only current items: a folder becomes an item when item.json appears.
    for (const name of subfolders(root)) {
      const dir = path.join(root, name);
      wanted.add(dir);
      for (const sub of SUBDIRS) wanted.add(path.join(dir, sub));
    }
  }
  for (const [dir, w] of watchers) if (!wanted.has(dir)) { w.close(); watchers.delete(dir); }
  for (const dir of wanted) {
    if (dir === root) watch(dir, () => { rescan(); changed('', 'items'); });
    else if (SUBDIRS.includes(path.basename(dir))) watch(dir, () => changed(path.basename(path.dirname(dir)), path.basename(dir)));
    else watch(dir, (file) => {
      if (file && !ITEM_FILES.test(file)) return;
      if (file === 'videos' || file === 'start-frames' || file === 'item.json') rescan();
      changed(path.basename(dir), file ?? 'item');
    });
  }
}

// (Re)starts watching the current working folder; call again after it changes.
export function startWatching() {
  root = workspaceRoot();
  rescan();
}
