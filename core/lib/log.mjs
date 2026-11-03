// Progress and errors, written to the terminal and to <item>/logs/YYYY-MM-DD.log.
// The CLI and the server share this module, so both leave the same trail in an item's log.
// A job runs inside withLog(): the item folder and an optional listener (the server's progress
// stream) follow it through every await without being passed around.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

const store = new AsyncLocalStorage();
let jsonProgress = false;
let source = 'cli';

// --json: progress lines on stderr are JSON objects so stdout stays free for the result.
export function setJsonProgress(on) { jsonProgress = on; }
export function setLogSource(name) { source = name; }

// Errors the user can fix (bad item.json, missing video): the message is enough, no stack.
export class UserError extends Error {}

export function withLog(ctx, fn) { return store.run({ ...store.getStore(), ...ctx }, fn); }

const day = (d) => d.toLocaleDateString('sv-SE'); // local YYYY-MM-DD

function write(level, text) {
  const ctx = store.getStore() ?? {};
  const now = new Date();
  if (ctx.itemDir && fs.existsSync(ctx.itemDir)) {
    try {
      const dir = path.join(ctx.itemDir, 'logs');
      fs.mkdirSync(dir, { recursive: true });
      const lines = text.split('\n').map((l, i) => (i ? `    ${l}` : l)).join('\n');
      fs.appendFileSync(path.join(dir, `${day(now)}.log`), `${now.toISOString()} ${source} ${level.padEnd(5)} ${lines}\n`);
    } catch {
      // A read-only or vanished item folder must not turn a log line into a second failure.
    }
  }
  ctx.listener?.({ level, text, time: now.toISOString() });
}

export function progress(step, detail = '') {
  const text = `${step}${detail ? ` — ${detail}` : ''}`;
  if (source === 'cli') process.stderr.write(jsonProgress ? JSON.stringify({ progress: step, detail }) + '\n' : `• ${text}\n`);
  else process.stdout.write(`${stamp()} ${itemLabel()}${text}\n`);
  write('info', text);
}

// Operations worth a line in the log that are not progress steps (a saved range, an upload).
export function info(text) {
  if (source !== 'cli') process.stdout.write(`${stamp()} ${itemLabel()}${text}\n`);
  write('info', text);
}

export function logError(err) {
  const text = err instanceof UserError ? err.message : (err?.stack ?? String(err));
  if (source !== 'cli') process.stderr.write(`${stamp()} ${itemLabel()}ERROR ${text}\n`);
  write('error', text);
  return text;
}

const stamp = () => new Date().toTimeString().slice(0, 8);
const itemLabel = () => { const d = store.getStore()?.itemDir; return d ? `[${path.basename(d)}] ` : ''; };
