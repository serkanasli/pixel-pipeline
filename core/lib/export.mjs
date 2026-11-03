// Copies a made package out of the item folder, e.g. into another project's assets folder. This
// is the only place the tool writes outside an item folder: into <target>/<id>/, where it only
// replaces or removes the files of an earlier package of the same item and leaves anything else.
import fs from 'node:fs';
import path from 'node:path';
import { info, UserError } from './log.mjs';
import { packageInputs } from './make.mjs';
import { packageDir } from './poses.mjs';

// The package's own files: what its manifest lists, the manifest and the report.
const ownFiles = (manifest) => {
  const files = [...Object.keys(manifest.files ?? {}), 'manifest.json', 'report.json'];
  // A manifest names files next to it; anything else is not ours to touch.
  return files.filter((f) => f === path.basename(f) && !f.startsWith('.'));
};

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// to: a folder (relative to the item folder or absolute); defaults to item.json's "export".
export function exportPackage(item, { to } = {}) {
  const target = to ?? item.export;
  if (!target) throw new UserError('no export target: pass --to <dir> or set "export" in item.json');
  const src = packageDir(item);
  const manifest = readJson(path.join(src, 'manifest.json')), report = readJson(path.join(src, 'report.json'));
  if (!manifest || !report) throw new UserError('there is no package yet; make it first');
  const stale = report.inputs !== packageInputs(item);
  if (stale) info('the package is older than item.json or its media; exporting it as it is');

  const dest = path.join(path.resolve(item.__dir, target), item.id);
  if (fs.existsSync(dest) && !fs.statSync(dest).isDirectory()) throw new UserError(`${dest} is a file, not a folder`);
  const files = ownFiles(manifest);
  const removed = [];
  const present = fs.existsSync(dest) ? fs.readdirSync(dest) : [];
  if (present.length) {
    const old = readJson(path.join(dest, 'manifest.json'));
    if (old?.id !== item.id) throw new UserError(`${dest} is not empty and holds no package of ${item.id}; choose another target or empty the folder`);
    for (const f of ownFiles(old)) {
      if (files.includes(f) || !fs.existsSync(path.join(dest, f))) continue;
      fs.rmSync(path.join(dest, f));
      removed.push(f);
    }
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    if (f === 'report.json') continue;
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
  // The report goes along without the paths of this machine.
  const { output, preview, ...portable } = report;
  fs.writeFileSync(path.join(dest, 'report.json'), JSON.stringify(portable, null, 1));
  const untouched = fs.readdirSync(dest).filter((f) => !files.includes(f));
  info(`exported ${item.id} to ${dest} (${files.length} files${removed.length ? `, removed ${removed.join(', ')}` : ''})`);
  return { id: item.id, target: dest, files, removed, untouched, stale };
}
