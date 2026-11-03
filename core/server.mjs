#!/usr/bin/env node
// Local web UI: serves web/ and a JSON API over the same core functions as the CLI.
// Binds to 127.0.0.1 only. Port: --port <n>, PORT, or 4317.
//
//   npm start            or   node core/server.mjs [--port 4317]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { addClient, broadcast, logged, runJob } from './lib/events.mjs';
import { exportPackage } from './lib/export.mjs';
import { ffmpegTools } from './lib/frames.mjs';
import { inspectPose, setRange } from './lib/inspect.mjs';
import { info, logError, setLogSource, UserError } from './lib/log.mjs';
import { make } from './lib/make.mjs';
import { createItem, listTemplates } from './lib/plan.mjs';
import { listTypes } from './lib/types.mjs';
import { byName, measureLocomotion, packageDir, poseClip } from './lib/poses.mjs';
import { videoPrompt } from './lib/prompt.mjs';
import { loadItem, saveItem } from './lib/schema.mjs';
import { makeStartFrame } from './lib/startframe.mjs';
import { itemStatus } from './lib/status.mjs';
import { resolveInside } from './lib/util.mjs';
import { startWatching } from './lib/watch.mjs';
import { HttpError, itemDir, itemFile, listItemDirs, readConfig, REPO_ROOT, setWorkspace, workspaceRoot } from './lib/workspace.mjs';

const WEB_DIR = path.join(REPO_ROOT, 'web');
const HOST = '127.0.0.1';
const MAX_UPLOAD = 1024 ** 3; // videos are small (360p, a few seconds); this only stops runaway uploads
const VIDEO_EXTS = ['mp4', 'mov', 'm4v', 'webm'];
const IMAGE_EXTS = ['png', 'jpg'];
const LAYER_EXTS = ['png', 'jpg', 'webp']; // still and layer images
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

setLogSource('web');

// ---------- helpers ----------

async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 4 << 20) throw new HttpError(413, 'request body too large'); }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new HttpError(400, 'request body is not valid JSON'); }
}

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const loadAt = (dir) => loadItem(path.join(dir, 'item.json'));

function poseOf(item, name) {
  const p = byName(item, name);
  if (!p) throw new HttpError(404, `unknown pose "${name}"`);
  return p;
}

// Streams the request body into `file` through a temporary file, so a broken upload never
// leaves half a video where the watcher or a job could pick it up.
async function receiveFile(req, file) {
  const size = Number(req.headers['content-length'] ?? 0);
  if (!size) throw new HttpError(400, 'empty upload');
  if (size > MAX_UPLOAD) throw new HttpError(413, `file is larger than ${MAX_UPLOAD >> 20} MB`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.upload-${process.pid}-${Date.now()}`);
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function extOf(url, allowed) {
  const ext = (url.searchParams.get('ext') ?? '').toLowerCase().replace('jpeg', 'jpg');
  if (!allowed.includes(ext)) throw new HttpError(400, `file type must be one of ${allowed.join(', ')}`);
  return ext;
}

// Files with HTTP range support (needed by <video> for seeking).
function serveFile(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { throw new HttpError(404, 'file not found'); }
  if (!st.isFile()) throw new HttpError(404, 'file not found');
  const headers = {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes', 'cache-control': 'no-cache', etag: `"${st.size}-${Math.round(st.mtimeMs)}"`,
  };
  if (req.headers['if-none-match'] === headers.etag) { res.writeHead(304, headers); return res.end(); }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  fs.createReadStream(file).pipe(res);
}

function ffmpegState() {
  try { ffmpegTools(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function itemSummary(name) {
  const dir = path.join(workspaceRoot(), name);
  try {
    const item = loadAt(dir);
    const s = itemStatus(item);
    // A layered item without an anchor shows its first layer image in the list.
    const thumb = item.anchor ?? item.layers?.map((l) => l.image).find((f) => fs.existsSync(path.join(dir, f))) ?? null;
    return { dir: name, id: item.id, name: item.name, type: item.type, template: item.template ?? null, anchor: item.anchor ?? null, thumb,
      posesDone: s.posesDone, posesTotal: s.posesTotal, layersDone: s.layersDone, layersTotal: s.layersTotal, package: s.package, next: s.next };
  } catch (e) {
    return { dir: name, error: e.message };
  }
}

function today() { return `logs/${new Date().toLocaleDateString('sv-SE')}.log`; }

// ---------- routes ----------
// Each handler gets ({ req, res, url, params, dir }) where dir is set for /api/items/<name>/….

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/config$/, () => ({
  workspace: readConfig().workspace ?? null, workspaceFound: !!workspaceRoot(), repo: REPO_ROOT,
  ffmpeg: ffmpegState(), node: process.version,
}));

route('PUT', /^\/api\/config$/, async ({ req }) => {
  const body = await readJson(req);
  const config = setWorkspace(body.workspace);
  info(`working folder set to ${config.workspace}`);
  startWatching();
  broadcast('changed', { item: '', what: 'items' });
  return { workspace: config.workspace };
});

route('GET', /^\/api\/templates$/, () => listTemplates());

route('GET', /^\/api\/types$/, () => listTypes());

route('GET', /^\/api\/items$/, () => ({ workspace: workspaceRoot(), items: listItemDirs().map(itemSummary) }));

route('POST', /^\/api\/items$/, async ({ req }) => {
  const body = await readJson(req);
  const dir = itemDir(body.dir, { mustExist: false });
  if (fs.existsSync(dir)) throw new HttpError(409, `the folder ${body.dir} already exists`);
  if (typeof body.template !== 'string') throw new HttpError(400, 'choose a plan template');
  // createItem makes the folder first, so its log line already lands in the new item's log.
  return logged(dir, () => {
    createItem(dir, { template: body.template, fields: body.fields ?? {} });
    return itemSummary(body.dir);
  });
});

route('GET', /^\/api\/items\/([^/]+)$/, ({ dir, params }) => {
  let item;
  try { item = loadAt(dir); }
  catch (e) {
    // A broken item.json must stay editable: send the text and the problem.
    return { dir: params[0], error: e.message, raw: fs.readFileSync(path.join(dir, 'item.json'), 'utf8') };
  }
  return { dir: params[0], item, status: itemStatus(item) };
});

route('PUT', /^\/api\/items\/([^/]+)$/, async ({ req, dir, params }) => {
  const body = await readJson(req);
  const item = body.item;
  if (!item || typeof item !== 'object') throw new HttpError(400, 'expected { "item": { … } }');
  Object.defineProperty(item, '__dir', { value: dir, enumerable: false });
  saveItem(item, path.join(dir, 'item.json'));
  info('item.json saved from the web UI');
  return { dir: params[0], item, status: itemStatus(loadAt(dir)) };
});

route('PUT', /^\/api\/items\/([^/]+)\/anchor$/, async ({ req, url, dir }) => {
  const ext = extOf(url, IMAGE_EXTS);
  const item = loadAt(dir);
  await receiveFile(req, path.join(dir, `anchor.${ext}`));
  for (const other of IMAGE_EXTS) if (other !== ext) fs.rmSync(path.join(dir, `anchor.${other}`), { force: true });
  item.anchor = `anchor.${ext}`;
  saveItem(item);
  info(`anchor image uploaded (anchor.${ext})`);
  return { anchor: item.anchor, status: itemStatus(loadAt(dir)) };
});

route('PUT', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/video$/, async ({ req, url, dir, params }) => {
  const ext = extOf(url, VIDEO_EXTS);
  const item = loadAt(dir), p = poseOf(item, params[1]);
  if (p.kind === 'still') throw new HttpError(400, `${p.name} is a still and has no video`);
  const rel = `videos/${p.name}.${ext}`;
  await receiveFile(req, path.join(dir, rel));
  // A new video makes the old range meaningless.
  const hadRange = !!p.range;
  p.video = rel;
  delete p.range;
  saveItem(item);
  info(`${p.name}: video uploaded (${rel})${hadRange ? ', range cleared' : ''}`);
  return { video: rel, status: itemStatus(loadAt(dir)) };
});

// An image file is kept where item.json already points when the type matches, otherwise it is
// saved as <name>.<ext> in the item folder and item.json is pointed at it.
const imageTarget = (current, name, ext) => (current && current !== 'anchor' && path.extname(current).slice(1).toLowerCase().replace('jpeg', 'jpg') === ext ? current : `${name}.${ext}`);

route('PUT', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/image$/, async ({ req, url, dir, params }) => {
  const ext = extOf(url, LAYER_EXTS);
  const item = loadAt(dir), p = poseOf(item, params[1]);
  if (p.kind !== 'still') throw new HttpError(400, `${p.name} is a ${p.kind} and comes from its video; only a still takes an image`);
  const rel = imageTarget(p.image, p.name, ext);
  await receiveFile(req, path.join(dir, rel));
  p.image = rel;
  delete p.startsFrom;
  saveItem(item);
  info(`${p.name}: still image uploaded (${rel})`);
  return { image: rel, status: itemStatus(loadAt(dir)) };
});

route('PUT', /^\/api\/items\/([^/]+)\/layers\/([a-z0-9_]+)\/image$/, async ({ req, url, dir, params }) => {
  const ext = extOf(url, LAYER_EXTS);
  const item = loadAt(dir), l = (item.layers ?? []).find((x) => x.name === params[1]);
  if (!l) throw new HttpError(404, `no layer "${params[1]}"; save the layer list first`);
  const rel = imageTarget(l.image, l.name, ext);
  await receiveFile(req, path.join(dir, rel));
  if (l.image !== rel) { l.image = rel; saveItem(item); }
  info(`layer ${l.name}: image uploaded (${rel})`);
  return { image: rel, status: itemStatus(loadAt(dir)) };
});

route('POST', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/start-frame$/, async ({ req, dir, params }) => {
  const body = await readJson(req);
  return runJob(dir, `start frame ${params[1]}`, async () => {
    const item = loadAt(dir), p = poseOf(item, params[1]);
    if (body.start) { p.start = { ...p.start, ...body.start }; saveItem(item); }
    const made = await makeStartFrame(item, p.name);
    return { made, status: itemStatus(loadAt(dir)) };
  });
});

route('GET', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/prompt$/, ({ dir, params }) => videoPrompt(loadAt(dir), params[1]));

route('POST', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/inspect$/, ({ dir, params }) =>
  runJob(dir, `inspect ${params[1]}`, () => inspectPose(loadAt(dir), params[1]), { quiet: true }));

route('PUT', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/range$/, async ({ req, dir, params }) => {
  const { range } = await readJson(req);
  if (!Array.isArray(range) || range.length !== 2) throw new HttpError(400, 'expected { "range": [a, b] }');
  return runJob(dir, `set range ${params[1]}`, async () => {
    const r = await setRange(loadAt(dir), params[1], range[0], range[1]);
    return { ...r, status: itemStatus(loadAt(dir)) };
  });
});

// Stride and speed of a range that is not saved yet (the picker shows them while choosing).
route('GET', /^\/api\/items\/([^/]+)\/poses\/([a-z0-9_]+)\/measure$/, ({ url, dir, params }) => {
  const range = [Number(url.searchParams.get('a')), Number(url.searchParams.get('b'))];
  if (!range.every(Number.isInteger) || range[0] >= range[1]) throw new HttpError(400, 'a and b must be source frame numbers with a < b');
  return runJob(dir, `measure ${params[1]}`, async () => {
    const item = loadAt(dir), p = poseOf(item, params[1]);
    if (p.kind !== 'locomotion') throw new HttpError(400, `${p.name} is not a locomotion pose`);
    if (!(await poseClip(item, p))) throw new HttpError(400, `${p.name} has no video yet`);
    return measureLocomotion(item, p, range);
  }, { quiet: true });
});

route('POST', /^\/api\/items\/([^/]+)\/make$/, ({ dir }) => runJob(dir, 'make package', async () => {
  const report = await make(loadAt(dir));
  return { report, status: itemStatus(loadAt(dir)) };
}));

// Export to another folder. A target given here becomes the item's "export" setting, so the
// next export (from the UI or the CLI) goes to the same place.
route('POST', /^\/api\/items\/([^/]+)\/export$/, async ({ req, dir }) => {
  const { to } = await readJson(req);
  return runJob(dir, 'export package', async () => {
    const item = loadAt(dir);
    if (typeof to === 'string' && to.trim() && to.trim() !== item.export) {
      item.export = to.trim();
      saveItem(item);
    }
    return { export: exportPackage(item), status: itemStatus(loadAt(dir)) };
  });
});

route('GET', /^\/api\/items\/([^/]+)\/report$/, ({ dir }) => {
  const item = loadAt(dir);
  const file = path.join(packageDir(item), 'report.json');
  if (!fs.existsSync(file)) return { report: null }; // not made yet: a state, not an error
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { report, base: path.relative(dir, path.dirname(file)) };
});

route('GET', /^\/api\/items\/([^/]+)\/logs$/, ({ url, dir }) => {
  const logDir = path.join(dir, 'logs');
  const files = fs.existsSync(logDir) ? fs.readdirSync(logDir).filter((f) => f.endsWith('.log')).sort() : [];
  const file = url.searchParams.get('file') ?? files.at(-1);
  if (!file) return { files, file: null, lines: [] };
  if (!files.includes(file)) throw new HttpError(404, `no log ${file}`);
  const lines = fs.readFileSync(path.join(logDir, file), 'utf8').split('\n').filter(Boolean);
  return { files, file, lines: lines.slice(-Number(url.searchParams.get('lines') ?? 400)) };
});

route('GET', /^\/api\/items\/([^/]+)\/files\/(.+)$/, ({ req, res, params }) => {
  const file = itemFile(params[0], decodeURIComponent(params[1]));
  if (!file) throw new HttpError(403, 'path leaves the item folder');
  serveFile(req, res, file);
});

route('GET', /^\/api\/events$/, ({ res }) => addClient(res));

// ---------- server ----------

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  if (!url.pathname.startsWith('/api/')) {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = resolveInside(WEB_DIR, rel);
    if (!file) throw new HttpError(403, 'forbidden');
    return serveFile(req, res, file);
  }
  const hit = routes.map((r) => ({ r, m: r.method === req.method && r.pattern.exec(url.pathname) })).find((x) => x.m);
  if (!hit) throw new HttpError(404, `no route ${req.method} ${url.pathname}`);
  const params = hit.m.slice(1).map(decodeURIComponent);
  const dir = url.pathname.startsWith('/api/items/') ? itemDir(params[0]) : null;
  const ctx = { req, res, url, params, dir };
  const result = dir ? await logged(dir, () => hit.r.handler(ctx)) : await hit.r.handler(ctx);
  if (result !== undefined && !res.headersSent) send(res, 200, result);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    const status = e.status ?? (e instanceof UserError ? 400 : 500);
    // Errors inside a job are logged by the job; the rest are logged here, into the item's log.
    let dir = null;
    try { const m = /^\/api\/items\/([^/]+)/.exec(new URL(req.url, `http://${HOST}`).pathname); if (m) dir = itemDir(decodeURIComponent(m[1])); } catch {}
    const text = e.logged ? e.message : dir ? logged(dir, () => logError(e)) : logError(e);
    e.logged = true;
    if (res.headersSent) return res.end();
    send(res, status, { error: e.message, detail: text !== e.message ? text : null, log: dir ? today() : null });
  });
});

const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag > 0 ? process.argv[portFlag + 1] : process.env.PORT ?? 4317);
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `port ${port} is in use; start with --port <n> or PORT=<n>` : e.stack);
  process.exit(1);
});
server.listen(port, HOST, () => {
  console.log(`Pixel Pipeline: http://${HOST}:${port}/`);
  const ff = ffmpegState();
  if (!ff.ok) console.log(`warning: ${ff.error}`);
  const ws = readConfig().workspace;
  console.log(ws ? `working folder: ${ws}${workspaceRoot() ? '' : ' (not found)'}` : 'no working folder yet: choose one in the UI');
  startWatching();
});
