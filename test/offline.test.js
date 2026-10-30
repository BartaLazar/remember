import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from '../server/lib/store.js';
import { modelIsPresent } from '../server/lib/embed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const BLOCK = pathToFileURL(path.join(here, 'helpers', 'block-network.js')).href;
const WORKER = path.join(repo, 'server', 'bin', 'index-worker.js');

function env() {
  const e = { ...process.env };
  delete e.REMEMBER_FAKE_EMBEDDER;
  return e;
}

test('block-network helper catches fetch, sockets and DNS', () => {
  const code = `
    for (const f of [
      () => fetch('http://example.com'),
      () => import('node:net').then((n) => n.default.connect(80, 'example.com')),
      () => import('node:dns').then((d) => d.default.lookup('example.com', () => {})),
      () => import('node:dns').then((d) => d.default.promises.lookup('example.com')),
      () => import('node:https').then((h) => h.default.request('https://example.com')),
    ]) { try { await f(); } catch {} }`;
  const r = spawnSync(process.execPath, ['--import', BLOCK, '--input-type=module', '-e', code], { encoding: 'utf8' });
  const hits = r.stderr.match(/NETWORK_ATTEMPT/g) ?? [];
  assert.equal(hits.length, 5, r.stderr);
});

test('real model: index and search with all network blocked', { timeout: 300000 }, async (t) => {
  if (!modelIsPresent()) return t.skip('model not downloaded');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remember-offline-'));
  try {    fs.writeFileSync(path.join(root, 'auth.js'), 'export function login(user, password) {\n  // verify the password hash and start a session\n  return startSession(user);\n}\n');
    fs.writeFileSync(path.join(root, 'notes.md'), '# Billing\nInvoices are generated on the first day of each month.\n');

    const w = spawnSync(process.execPath, ['--import', BLOCK, WORKER, '--root', root], { encoding: 'utf8', env: env(), timeout: 240000 });
    assert.equal(w.status, 0, w.stderr);
    assert.ok(!w.stderr.includes('NETWORK_ATTEMPT'), w.stderr);

    const script = `
      import path from 'node:path';
      import { createEmbedder } from ${JSON.stringify(pathToFileURL(path.join(repo, 'server/lib/embed.js')).href)};
      import { search } from ${JSON.stringify(pathToFileURL(path.join(repo, 'server/lib/search.js')).href)};
      import { openStore } from ${JSON.stringify(pathToFileURL(path.join(repo, 'server/lib/store.js')).href)};
      const root = ${JSON.stringify(root)};
      const store = openStore(path.join(root, '.remember', 'index.db'));
      const embedder = await createEmbedder();
      const res = await search({ store, embedder, root, query: 'where is the user login handled' });
      console.log(JSON.stringify(res));
      store.close();`;
    const s = spawnSync(process.execPath, ['--import', BLOCK, '--input-type=module', '-e', script], { encoding: 'utf8', env: env(), timeout: 240000 });
    assert.equal(s.status, 0, s.stderr);
    assert.ok(!s.stderr.includes('NETWORK_ATTEMPT'), s.stderr);
    const res = JSON.parse(s.stdout.trim().split('\n').pop());
    const list = Array.isArray(res) ? res : res.results ?? [];
    assert.ok(list.length > 0, s.stdout);
    assert.ok(JSON.stringify(list).includes('auth.js'), s.stdout);

    const logFile = path.join(root, '.remember', 'worker.log');
    const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    assert.ok(!logText.includes('embedder unavailable'), logText);
    const check = openStore(path.join(root, '.remember', 'index.db'));
    try {
      const c = check.counts();
      assert.ok(c.chunks > 0, JSON.stringify(c));
      assert.equal(c.unembedded, 0, JSON.stringify(c));
    } finally { check.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
