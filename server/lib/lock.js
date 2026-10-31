import fs from 'node:fs';
import path from 'node:path';

const lockPath = (dataDir) => path.join(dataDir, 'lock');
const pendingPath = (dataDir) => path.join(dataDir, 'pending.jsonl');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const STALE_MS = 10 * 60 * 1000;

function isStale(file) {
  try { if (Date.now() - fs.statSync(file).mtimeMs > STALE_MS) return true; } catch { return true; }
  let pid;
  try { pid = parseInt(fs.readFileSync(file, 'utf8'), 10); } catch { return true; }
  if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
  // Empty/garbled: the owner may be mid-write; only stale if old.
  try { return Date.now() - fs.statSync(file).mtimeMs > 10_000; } catch { return true; }
}

/** Take the per-project lock. Returns false if another live process holds it. */
export function acquireLock(dataDir) {
  const file = lockPath(dataDir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeSync(fd, String(process.pid)); } finally { fs.closeSync(fd); }
      return ownsLock(file);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!isStale(file)) return false;
      try { fs.unlinkSync(file); } catch { /* raced */ }
    }
  }
  return false;
}

function ownsLock(file) {
  try { return parseInt(fs.readFileSync(file, 'utf8'), 10) === process.pid; } catch { return false; }
}

/** Unlink the lock only if we own it. */
export function releaseLock(dataDir) {
  const file = lockPath(dataDir);
  if (ownsLock(file)) { try { fs.unlinkSync(file); } catch { /* already gone */ } }
}

/** Bump the lock's mtime so a live holder is never judged stale. Returns a stop function. */
export function startHeartbeat(dataDir, ms = 60_000) {
  const file = lockPath(dataDir);
  const t = setInterval(() => {
    try { const n = new Date(); fs.utimesSync(file, n, n); } catch { /* ignore */ }
  }, ms);
  t.unref();
  return () => clearInterval(t);
}

export function queueRequest(dataDir, req) {
  fs.appendFileSync(pendingPath(dataDir), JSON.stringify(req) + '\n');
}

/** Atomically take all queued requests (rename, read, delete). */
export function drainRequests(dataDir) {
  const src = pendingPath(dataDir);
  const tmp = `${src}.${process.pid}.${Date.now()}`;
  try { fs.renameSync(src, tmp); } catch { return []; }
  let text = '';
  try { text = fs.readFileSync(tmp, 'utf8'); } finally { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn line */ }
  }
  return out;
}

export function hasPending(dataDir) {
  try { return fs.statSync(pendingPath(dataDir)).size > 0; } catch { return false; }
}

/**
 * Merge queued requests into the passes to run: a full request covers everything; a files scan covers
 * any paths; a chats pass runs alongside a files scan or paths refresh.
 */
export function mergeRequests(reqs) {
  const force = reqs.some((r) => r.force);
  const full = reqs.some((r) => r.full || (!Array.isArray(r.paths) && !r.only));
  const files = reqs.some((r) => r.only === 'files');
  const chats = reqs.some((r) => r.only === 'chats');
  if (full || (files && chats)) return [{ force }];
  const runs = [];
  const paths = [...new Set(reqs.flatMap((r) => (Array.isArray(r.paths) ? r.paths : [])))];
  if (files) runs.push({ only: 'files', force });
  else if (paths.length) runs.push({ paths, force });
  if (chats) runs.push({ only: 'chats', force });
  return runs;
}
