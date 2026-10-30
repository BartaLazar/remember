import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFakeEmbedder, createEmbedder, modelIsPresent, DIMS, MODEL_ID } from '../server/lib/embed.js';

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

test('fake: deterministic, 384 dims, normalized', async () => {
  const e = createFakeEmbedder();
  const [a] = await e.embedDocuments(['Hello snake_case world']);
  const b = await e.embedQuery('hello SNAKE_case world');
  assert.equal(a.length, DIMS);
  assert.ok(a instanceof Float32Array);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.sqrt(dot(a, a)) - 1) < 1e-5);
});

test('fake: overlap scores higher than disjoint; empty text is NaN-free', async () => {
  const e = createFakeEmbedder();
  const q = await e.embedQuery('user login authenticate');
  const [near, far, empty] = await e.embedDocuments(['authenticate the user login', 'render chart legend', '']);
  assert.ok(dot(q, near) > dot(q, far));
  assert.ok(empty.every((x) => Number.isFinite(x)));
});

test('fake: batches of many texts', async () => {
  const out = await createFakeEmbedder().embedDocuments(Array.from({ length: 70 }, (_, i) => `t${i}`));
  assert.equal(out.length, 70);
});

test('createEmbedder rejects when model absent and download not allowed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remember-emb-'));
  assert.equal(modelIsPresent(dir), false);
  await assert.rejects(createEmbedder({ modelsDir: dir, allowDownload: false }));
});

test('real model: semantic ranking incl. German query, long text', async (t) => {
  if (!modelIsPresent()) return t.skip('model not downloaded');
  assert.equal(MODEL_ID, 'Xenova/multilingual-e5-small');
  const e = await createEmbedder();
  const [auth, chart] = await e.embedDocuments(['function authenticate(user, password)', 'render the chart legend']);
  assert.equal(auth.length, DIMS);
  for (const q of ['how is the user logged in', 'wie wird der Benutzer angemeldet']) {
    const v = await e.embedQuery(q);
    assert.ok(dot(v, auth) > dot(v, chart), q);
  }
  const [long] = await e.embedDocuments(['word '.repeat(5000)]);
  assert.equal(long.length, DIMS);
});
