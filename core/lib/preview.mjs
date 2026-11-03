// Writes preview.html next to the package: a single self-contained page (manifest, atlas map,
// atlas and layer images are embedded) that plays the item the way the app's engine would and
// shows the layers on a checkerboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const template = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'preview.html'), 'utf8');

const dataUri = (file) => `data:image/webp;base64,${fs.readFileSync(file).toString('base64')}`;

export function writePreview(outDir, { manifest, atlasJson, atlasFile, layers, ptPerPixel, report }) {
  const data = {
    manifest,
    ptPerPixel,
    atlas: atlasJson,
    image: atlasFile ? dataUri(atlasFile) : null,
    layers: layers.map((l) => ({ name: l.name, z: l.z, w: l.w, h: l.h, src: dataUri(path.join(outDir, l.file)) })),
    report: { packageKB: report.packageKB, budgetKB: report.budgetKB, atlas: report.atlas, layers: report.layers, warnings: report.warnings, poses: report.poses },
  };
  const html = template
    .replace('__TITLE__', escapeHtml(manifest.name?.tr ?? manifest.name?.en ?? manifest.id))
    .replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
  const file = path.join(outDir, 'preview.html');
  fs.writeFileSync(file, html);
  return file;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
