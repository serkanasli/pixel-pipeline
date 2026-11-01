// Writes preview.html next to the package: a single self-contained page (manifest, atlas map and
// atlas image are embedded) that plays the item the way the app's engine would.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const template = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'preview.html'), 'utf8');

export function writePreview(outDir, { manifest, atlasJson, atlasFile, report }) {
  const data = {
    manifest,
    atlas: atlasJson,
    image: `data:image/webp;base64,${fs.readFileSync(atlasFile).toString('base64')}`,
    report: { packageKB: report.packageKB, budgetKB: report.budgetKB, atlas: report.atlas, warnings: report.warnings, poses: report.poses },
  };
  const html = template
    .replace('__TITLE__', escapeHtml(manifest.name?.tr ?? manifest.name?.en ?? manifest.id))
    .replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
  const file = path.join(outDir, 'preview.html');
  fs.writeFileSync(file, html);
  return file;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
