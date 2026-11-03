// Shell of the UI: hash routes, the step bar, the single "next step" band, the log drawer and
// the server event stream. Item pages share one copy of the item (item.json + status) that is
// re-read whenever the server reports a change, from this page or from outside (CLI, Finder).
import { api, itemUrl } from './api.js';
import { clear, errorCard, h, nextStep, STAGES, toast } from './ui.js';
import * as itemsView from './views/items.js';
import * as itemView from './views/item.js';
import * as newItemView from './views/new-item.js';
import * as packageView from './views/package.js';
import * as poseView from './views/pose.js';
import * as setupView from './views/setup.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
let current = null; // { route, module, handle, data }

function parseRoute() {
  const [pathPart, query = ''] = location.hash.replace(/^#/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const q = Object.fromEntries(new URLSearchParams(query));
  if (parts[0] === 'setup') return { name: 'setup', module: setupView, q };
  if (parts[0] === 'new') return { name: 'new', module: newItemView, q };
  if (parts[0] === 'item' && parts[1]) {
    if (parts[2] === 'pose' && parts[3]) return { name: 'pose', module: poseView, dir: parts[1], pose: parts[3], q };
    if (parts[2] === 'package') return { name: 'package', module: packageView, dir: parts[1], q };
    return { name: 'item', module: itemView, dir: parts[1], q };
  }
  return { name: 'items', module: itemsView, q };
}

// ---------- step bar and next band ----------

function renderSteps(route, data) {
  const bar = $('steps');
  if (!route.dir) {
    clear(bar, h('ol',
      h('li', { class: route.name === 'items' ? 'active' : '' }, h('a', { href: '#/' }, 'Öğeler')),
      h('li', { class: route.name === 'new' ? 'active' : '' }, h('a', { href: '#/new' }, 'Yeni öğe')),
      h('li.todo', h('span', 'Pozlar')),
      h('li.todo', h('span', 'Paket'))));
    return;
  }
  const base = `#/item/${encodeURIComponent(route.dir)}`;
  const s = data?.status;
  const stageIndex = (st) => STAGES.findIndex(([k]) => k === st);
  const poseSteps = (s?.poses ?? []).map((p) => {
    const cls = [p.stage === 'done' ? 'done' : p.stage === 'waiting' ? 'todo' : 'open', route.pose === p.name ? 'active' : ''].join(' ');
    const sub = p.stage === 'done' ? 'tamam' : p.stage === 'waiting' ? 'bekliyor' : STAGES[stageIndex(p.stage)]?.[1].toLowerCase();
    return h('li', { class: cls }, h('a', { href: `${base}/pose/${p.name}` }, h('span.dot'), p.name, h('small', sub)));
  });
  const pkgState = s?.package.state ?? 'none';
  clear(bar, h('ol',
    h('li.done', h('a', { href: '#/' }, 'Öğeler')),
    h('li', { class: route.name === 'item' ? 'active' : 'done' }, h('a', { href: base }, data?.item?.name?.tr ?? route.dir)),
    poseSteps,
    h('li', { class: `${pkgState === 'ready' ? 'done' : 'open'} ${route.name === 'package' ? 'active' : ''}` },
      h('a', { href: `${base}/package` }, h('span.dot'), 'Paket', h('small', { none: 'yok', stale: 'eski', ready: 'hazır' }[pkgState])))));
}

function renderNext(route, data) {
  const band = $('next');
  if (route.name === 'items') {
    band.hidden = false;
    clear(band, h('span.k', 'Sıradaki adım'), h('span', 'Devam etmek için bir öğe seç ya da yeni öğe oluştur.'));
    return;
  }
  if (!route.dir || !data?.status) { band.hidden = true; return; }
  const n = nextStep(route.dir, data.status.next);
  band.hidden = false;
  const here = location.hash.split('?')[0] === n.href.split('?')[0];
  clear(band, h('span.k', 'Sıradaki adım'), h('span', n.text), here ? h('span.muted', '(bu sayfada)') : h('a.button', { href: n.href }, 'Git'));
}

// ---------- routing ----------

async function loadItem(dir) {
  return api.get(itemUrl(dir));
}

async function show() {
  const route = parseRoute();
  current?.handle?.destroy?.();
  current = { route, module: route.module, handle: null, data: null };
  view.setAttribute('aria-busy', 'true');
  try {
    if (route.dir) {
      current.data = await loadItem(route.dir);
      loadLogs(route.dir);
    } else {
      loadLogs(null);
    }
    renderSteps(route, current.data);
    renderNext(route, current.data);
    clear(view);
    if (route.dir && current.data.error) {
      view.append(itemErrorView(route, current.data));
    } else {
      current.handle = await route.module.render(view, { route, data: current.data, reload });
    }
  } catch (e) {
    renderSteps(route, null);
    $('next').hidden = true;
    clear(view, errorCard(e, 'Sayfa yüklenemedi'));
    if (e.status === 409) view.append(h('p', h('a.button', { href: '#/setup' }, 'Çalışma klasörünü seç')));
  } finally {
    view.removeAttribute('aria-busy');
  }
  document.title = `${route.dir ? `${current.data?.item?.name?.tr ?? route.dir} · ` : ''}Pixel Pipeline`;
}

// item.json could not be read or failed validation: show why and the raw text to fix it.
function itemErrorView(route, data) {
  const area = h('textarea.code', { rows: 24, spellcheck: false }, data.raw);
  const out = h('div');
  return h('section.panel',
    h('h1', `${route.dir}: item.json okunamadı`),
    errorCard({ message: data.error }, 'Doğrulama hatası'),
    h('p.muted', 'Dosyayı burada düzeltip kaydedebilir ya da bir düzenleyicide açabilirsin; değişiklik kendiliğinden yansır.'),
    area,
    h('div.row', h('button.primary', { type: 'button', onclick: async () => {
      clear(out);
      let item;
      try { item = JSON.parse(area.value); } catch (e) { out.append(errorCard({ message: `JSON hatası: ${e.message}` })); return; }
      try { await api.put(itemUrl(route.dir), { item }); toast('Kaydedildi'); show(); } catch (e) { out.append(errorCard(e, 'Kaydedilemedi')); }
    } }, 'Kaydet')),
    out);
}

// Re-reads the item and lets the page update in place (keeps scroll position and open forms).
async function reload() {
  if (!current) return;
  const { route } = current;
  if (!route.dir) { current.handle?.update?.(); return; }
  try {
    const data = await loadItem(route.dir);
    const wasBroken = !!current.data?.error;
    current.data = data;
    renderSteps(route, data);
    renderNext(route, data);
    if (data.error || wasBroken) return show();
    current.handle?.update?.(data);
  } catch (e) {
    if (e.status === 404) { toast(`${route.dir} artık yok`); location.hash = '#/'; return; }
    toast(`Yenilenemedi: ${e.message}`);
  }
}

window.addEventListener('hashchange', show);

// ---------- log drawer ----------

const logLines = $('logLines');
const logPanel = $('logs');
let logItem = null;

function logLine({ time, level, text, item }) {
  const t = time ? new Date(time).toLocaleTimeString('tr-TR') : '';
  const li = h(`li.${level === 'error' ? 'err' : 'inf'}`, h('time', t), item && !logItem ? h('b', `[${item}] `) : null, h('span', text));
  logLines.append(li);
  while (logLines.children.length > 600) logLines.firstChild.remove();
  logLines.parentElement.scrollTop = logLines.parentElement.scrollHeight;
  if (level === 'error') openLogs(true);
}

async function loadLogs(dir) {
  logItem = dir;
  clear(logLines);
  $('logTitle').textContent = dir ? `Log · ${dir}` : 'Log · tüm öğeler (canlı)';
  if (!dir) return;
  try {
    const r = await api.get(`${itemUrl(dir)}/logs?lines=300`);
    $('logTitle').textContent = `Log · ${dir}${r.file ? ` · logs/${r.file}` : ''}`;
    // "2026-11-03T09:55:19.625Z web info  text" (continuation lines start with spaces)
    for (const line of r.lines) {
      const m = /^(\S+) (\S+) (\S+)\s+(.*)$/.exec(line);
      if (m) logLine({ time: m[1], level: m[3], text: `${m[2] === 'cli' ? '[cli] ' : ''}${m[4]}` });
      else if (logLines.lastChild) logLines.lastChild.lastChild.textContent += `\n${line.trim()}`;
    }
  } catch (e) {
    logLine({ level: 'error', text: `Log okunamadı: ${e.message}` });
  }
}

function openLogs(open) {
  logPanel.classList.toggle('open', open);
  $('logToggle').setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('logsOpen', open ? '1' : ''); } catch {}
}
$('logToggle').addEventListener('click', () => openLogs(!logPanel.classList.contains('open')));
try { openLogs(!!localStorage.getItem('logsOpen')); } catch { openLogs(false); }

// ---------- server events ----------

const running = new Map(); // job id -> name, for the current item
function showJobs() {
  const el = $('job');
  el.hidden = !running.size;
  el.textContent = running.size ? `Çalışıyor: ${[...running.values()].join(', ')}` : '';
}

let reloadTimer;
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('open', () => $('offline').hidden = true);
  es.addEventListener('error', () => { $('offline').hidden = false; });
  es.addEventListener('log', (e) => {
    const d = JSON.parse(e.data);
    if (!logItem || d.item === logItem) logLine(d);
    if (current?.route.dir === d.item) current.handle?.log?.(d);
  });
  es.addEventListener('job', (e) => {
    const d = JSON.parse(e.data);
    if (current?.route.dir && d.item !== current.route.dir) return;
    if (d.state === 'running' || d.state === 'queued') running.set(d.job, d.name);
    else running.delete(d.job);
    if (d.state === 'failed') toast(`Başarısız: ${d.name}`);
    showJobs();
    current?.handle?.job?.(d);
  });
  es.addEventListener('changed', (e) => {
    const d = JSON.parse(e.data);
    const r = current?.route;
    if (!r || (r.dir ? d.item !== r.dir : r.name !== 'items')) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 150);
  });
}

connect();
show();
