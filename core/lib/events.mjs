// Server side events and the job queue. Every long operation (frames, start frame, make) runs as
// a job: one at a time per item, so two requests never extract the same video at once, and its
// progress and log lines go to every open page over SSE.
import path from 'node:path';
import { info, logError, withLog } from './log.mjs';

const clients = new Set();

export function addClient(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// Proxies and some browsers drop idle streams; a comment line keeps them open.
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

const queues = new Map(); // item dir -> promise of the last queued job
let nextId = 1;

// Runs fn(…) for the item after the item's earlier jobs; logs and streams everything it does.
// Quiet jobs (reads the range picker repeats on every click) only log when slow or failing.
export function runJob(dir, name, fn, { quiet = false } = {}) {
  const item = path.basename(dir), id = nextId++;
  const listener = (line) => broadcast('log', { item, job: id, ...line });
  const start = () => withLog({ itemDir: dir, listener }, async () => {
    const t0 = Date.now();
    broadcast('job', { item, job: id, name, state: 'running' });
    if (!quiet) info(`${name}: started`);
    try {
      const result = await fn();
      const secs = (Date.now() - t0) / 1000;
      if (!quiet || secs > 1) info(`${name}: done in ${secs.toFixed(1)} s`);
      broadcast('job', { item, job: id, name, state: 'done' });
      return result;
    } catch (e) {
      const text = logError(e);
      e.logged = true; // the HTTP error handler must not log it a second time
      broadcast('job', { item, job: id, name, state: 'failed', error: e.message, detail: text });
      throw e;
    }
  });
  const prev = queues.get(dir) ?? Promise.resolve();
  if (queues.has(dir)) broadcast('job', { item, job: id, name, state: 'queued' });
  const run = prev.catch(() => {}).then(start);
  const tail = run.catch(() => {});
  queues.set(dir, tail);
  tail.then(() => { if (queues.get(dir) === tail) queues.delete(dir); });
  return run;
}

// Short operations (save, upload) are logged and streamed the same way but not queued.
export function logged(dir, fn) {
  const item = path.basename(dir);
  return withLog({ itemDir: dir, listener: (line) => broadcast('log', { item, ...line }) }, fn);
}
