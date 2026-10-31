import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock, releaseLock, queueRequest, drainRequests } from '../server/lib/lock.js';
import { spawnWorker } from '../server/lib/spawn.js';
import { openStore } from '../server/lib/store.js';

const mk = (p) => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const WORKER = fileURLToPath(new URL('../server/bin/index-worker.js', import.meta.url));

test('lock: second acquire fails; release frees; dead pid is replaced', () => {
  const d = mk('remember-lock-');
  assert.equal(acquireLock(d), true);
  assert.equal(acquireLock(d), false);
  releaseLock(d);
  assert.equal(acquireLock(d), true);
  releaseLock(d);
  fs.writeFileSync(path.join(d, 'lock'), '99999999');
  assert.equal(acquireLock(d), true);
  assert.equal(fs.readFileSync(path.join(d, 'lock'), 'utf8'), String(process.pid));
  releaseLock(d);
});

test('lock: stale by mtime despite live pid; fresh lock is held; release only if owner', () => {
  const d = mk('remember-lk2-');
  const f = path.join(d, 'lock');
  fs.writeFileSync(f, String(process.pid));
  assert.equal(acquireLock(d), false);
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(f, old, old);
  assert.equal(acquireLock(d), true);
  fs.writeFileSync(f, '1');
  releaseLock(d);
  assert.equal(fs.existsSync(f), true);
});

test('queue round-trips and drain empties it', () => {
  const d = mk('remember-q-');
  assert.deepEqual(drainRequests(d), []);
  queueRequest(d, { paths: ['a.js', 'b,c.js'] });
  queueRequest(d, { full: true, force: true });
  assert.deepEqual(drainRequests(d), [{ paths: ['a.js', 'b,c.js'] }, { full: true, force: true }]);
  assert.deepEqual(drainRequests(d), []);
});

function project(n) {
  const base = mk('remember-w-');
  const root = path.join(base, 'proj');
  fs.mkdirSync(root);
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(root, `f${i}.js`), `export const v${i} = ${i};\n`);
  fs.writeFileSync(path.join(root, 'b,c.js'), 'export const comma = 1;\n');
  return { base, root, dataDir: path.join(root, '.remember') };
}
const envFor = (base) => ({
  ...process.env, REMEMBER_FAKE_EMBEDDER: '1',
  REMEMBER_MODELS_DIR: path.join(base, 'models'), REMEMBER_CONFIG_DIR: path.join(base, 'cfg'),
});
async function waitIdle(dataDir) {
  const pend = path.join(dataDir, 'pending.jsonl');
  const deadline = Date.now() + 30000;
  await new Promise((r) => setTimeout(r, 300));
  for (;;) {
    // A slow machine may not have started the worker yet: no lock does not mean done until a status exists.
    let phase = null;
    try { phase = JSON.parse(fs.readFileSync(path.join(dataDir, 'status.json'), 'utf8')).phase; } catch { /* not yet */ }
    const locked = fs.existsSync(path.join(dataDir, 'lock'));
    let pending = false;
    try { pending = fs.statSync(pend).size > 0; } catch { /* none */ }
    if (phase && phase !== 'building' && !locked && !pending) return;
    if (Date.now() > deadline) throw new Error('timeout waiting for worker');
    await new Promise((r) => setTimeout(r, 100));
  }
}
const snapshot = (dataDir) => {
  const s = openStore(path.join(dataDir, 'index.db'));
  try { return { keys: s.listSourceKeys('file'), counts: s.counts(), chunks: s.counts().chunks }; } finally { s.close(); }
};
const spawnW = (root, env, args = []) => spawn(process.execPath, [WORKER, '--root', root, ...args], { stdio: 'ignore', env });

test('10 workers in 100ms: each file once, same result as a single run', async () => {
  const a = project(5);
  const b = project(5);
  const envB = envFor(b.base);
  spawnW(b.root, envB);
  await waitIdle(b.dataDir);
  const clean = snapshot(b.dataDir);

  const env = envFor(a.base);
  const exits = [];
  for (let i = 0; i < 10; i++) {
    const p = spawnW(a.root, env, i % 2 ? ['--paths', JSON.stringify(['f1.js', 'b,c.js'])] : []);
    exits.push(new Promise((r) => p.on('exit', r)));
    await new Promise((r) => setTimeout(r, 10));
  }
  await Promise.all(exits);
  await waitIdle(a.dataDir);
  const got = snapshot(a.dataDir);
  assert.deepEqual(got.keys, clean.keys);
  assert.equal(new Set(got.keys).size, got.keys.length);
  assert.ok(got.keys.length >= 6);
  assert.deepEqual(got.counts, clean.counts);
  assert.equal(got.chunks, clean.chunks);
  assert.equal(fs.existsSync(path.join(a.dataDir, 'lock')), false);
});

test('spawnWorker launches a detached worker that indexes', async () => {
  const p = project(2);
  const e = envFor(p.base);
  const keys = ['REMEMBER_FAKE_EMBEDDER', 'REMEMBER_MODELS_DIR', 'REMEMBER_CONFIG_DIR'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = e[k];
  try { spawnWorker(p.root, []); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(path.join(p.dataDir, 'status.json')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  await waitIdle(p.dataDir);
  assert.ok(snapshot(p.dataDir).keys.includes('file:f0.js'));
});
