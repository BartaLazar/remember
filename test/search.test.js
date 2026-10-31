import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { search, toFtsQuery, formatResults } from '../server/lib/search.js';
import { runIndex } from '../server/lib/indexer.js';
import { openStore } from '../server/lib/store.js';
import { createFakeEmbedder } from '../server/lib/embed.js';
import { appendNote } from '../server/lib/userdata.js';

async function build(files, notes = []) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'remember-s-')));
  const root = path.join(base, 'proj');
  fs.mkdirSync(root);
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(root, n), t);
  const dataDir = path.join(root, '.remember');
  for (const n of notes) appendNote(dataDir, n);
  const store = openStore(path.join(base, 'index.db'));
  const embedder = createFakeEmbedder();
  await runIndex({ root, dataDir, store, embedder, projectsDir: path.join(base, 'projects') });
  return { root, store, embedder };
}

test('toFtsQuery quotes tokens and ORs them', () => {
  assert.equal(toFtsQuery('foo bar_1 "x"'), '"foo" OR "bar_1" OR "x"');
  assert.equal(toFtsQuery('*** -'), null);
});

test('toFtsQuery drops question words from code lookups only', () => {
  assert.equal(toFtsQuery('where is atomicWrite defined'), '"atomicWrite"');
  assert.equal(toFtsQuery('where is range defined'), '"range"');
  assert.equal(toFtsQuery('how does the cache work'), '"how" OR "does" OR "the" OR "cache" OR "work"');
  assert.equal(toFtsQuery('where is it defined'), '"where" OR "is" OR "it" OR "defined"');
});

test('the definition outranks tests that only call it', async () => {
  const calls = Array.from({ length: 6 }, (_, i) => `test('case ${i}', () => atomicWrite('f${i}', 'x'));`).join('\n');
  const c = await build({
    'write.test.js': `${calls}\n`,
    'util.js': 'export function atomicWrite(file, text) {\n  fs.writeFileSync(file, text);\n}\n',
  });
  const r = await search({ ...c, query: 'where is atomicWrite defined', embedder: null });
  assert.equal(r[0].loc, 'util.js');
});

test('test files rank lower unless the query asks about tests', async () => {
  const text = 'atomicWrite tests here\n';
  const c = await build({ 'write.test.js': text, 'write.js': text });
  const plain = await search({ ...c, query: 'atomicWrite', embedder: null });
  assert.equal(plain[0].loc, 'write.js');
  assert.ok(plain[0].score / plain[1].score > 1.3);
  const asked = await search({ ...c, query: 'atomicWrite tests', embedder: null });
  assert.ok(asked[0].score / asked[1].score < 1.1);
});

test('equal relevance: the newer chat outranks the older one', async () => {
  const c = await build({ 'a.txt': 'nothing here\n' });
  const chat = (key, date) => c.store.replaceSource(
    { key, kind: 'chat', hash: key, mtimeMs: 0, size: 0 },
    [{ loc: key, text: 'we decided pagination uses offsets', date }],
  );
  chat('chat:old', '2026-03-01T10:00:00.000Z');
  chat('chat:new', '2026-06-01T10:00:00.000Z');
  const r = await search({ ...c, query: 'pagination decision', embedder: null, scope: 'chats' });
  assert.deepEqual(r.map((x) => x.loc), ['chat:new', 'chat:old']);
});

test('identifier query ranks matching file first', async () => {
  const c = await build({
    'invoice.js': 'function parseInvoiceTotal(x) { return x.total; }\n',
    'other.js': 'function unrelated() { return 42; }\n',
    'misc.js': 'const colors = ["red", "green"];\n',
  });
  const r = await search({ ...c, query: 'parseInvoiceTotal' });
  assert.equal(r[0].loc, 'invoice.js');
  assert.equal(r[0].kind, 'file');
  assert.equal(r[0].stale, false);
});

test('scope notes returns only notes; scope files only files', async () => {
  const c = await build({ 'a.js': 'zebra quokka\n' }, [{ title: 'Zoo', body: 'zebra quokka' }]);
  const n = await search({ ...c, query: 'zebra', scope: 'notes' });
  assert.ok(n.length > 0 && n.every((x) => x.kind === 'note'));
  const f = await search({ ...c, query: 'zebra', scope: 'files' });
  assert.ok(f.length > 0 && f.every((x) => x.kind === 'file'));
});

test('equal relevance: note outranks file', async () => {
  const c = await build({ 'a.txt': 'Zoo\n\nzebra quokka\n' }, [{ title: 'Zoo', body: 'zebra quokka' }]);
  const r = await search({ ...c, query: 'zebra quokka' });
  assert.equal(r[0].kind, 'note');
});

test('modified file is stale and formatted with warning', async () => {
  const c = await build({ 'a.js': 'const marker = 1;\n', 'b.js': 'const other = 2;\n' });
  fs.writeFileSync(path.join(c.root, 'a.js'), 'const marker = 1; // edited a lot\n');
  const r = await search({ ...c, query: 'marker' });
  assert.equal(r[0].stale, true);
  assert.match(formatResults(r, { status: null, semantic: true }), /CHANGED SINCE INDEXED, re-read before trusting/);
  fs.rmSync(path.join(c.root, 'a.js'));
  assert.equal((await search({ ...c, query: 'marker' }))[0].stale, true);
  assert.equal((await search({ ...c, query: 'other' }))[0].stale, false);
});

test('embedder null gives FTS results and keyword-only header', async () => {
  const c = await build({ 'a.js': 'const marker = 1;\n' });
  const r = await search({ ...c, embedder: null, query: 'marker' });
  assert.equal(r.length, 1);
  const out = formatResults(r, { status: null, semantic: false });
  assert.match(out, /Semantic search not ready yet \(model downloading\) — keyword results only\./);
  assert.match(out, /\[1\] a\.js:1-1/);
});

test('status header, empty results, note/chat labels', () => {
  assert.equal(formatResults([], { status: null, semantic: true }), 'No matches in the knowledge base.');
  const out = formatResults([
    { kind: 'note', loc: 'My title', startLine: null, endLine: null, text: 'a\n\n\n\nb', date: '2026-01-02T03:04:05Z', score: 1, stale: false },
    { kind: 'chat', loc: 'chat sess-9', startLine: null, endLine: null, text: 'hi', date: 1767312000000, score: 1, stale: false },
  ], { status: { phase: 'building', done: 3, total: 10, updatedAt: 0 }, semantic: true });
  assert.match(out, /^Index still building \(3\/10\) — results may be incomplete\./);
  assert.match(out, /\[1\] note "My title" \(2026-01-02\)\na\n\nb/);
  assert.match(out, /\[2\] chat sess-9 \(2026-01-02\)/);
});

test('output capped at 6000 chars; snippets at 600 without splitting surrogates', () => {
  const text = '😀'.repeat(2000);
  const rs = Array.from({ length: 20 }, (_, i) => ({ kind: 'file', loc: `f${i}.js`, startLine: 1, endLine: 9, text, date: null, score: 1, stale: false }));
  const out = formatResults(rs, { status: null, semantic: true });
  assert.ok(out.length <= 6000);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out));
  assert.ok(!/(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out));
});

test('hostile queries never throw', async () => {
  const c = await build({ 'a.js': 'foo bar a x\n' });
  for (const q of ['"unclosed', '-foo', 'a*', '(x', 'NEAR(a b)', 'foo:bar', '***', '', 'AND OR NOT']) {
    await assert.doesNotReject(search({ ...c, query: q }));
    await assert.doesNotReject(search({ ...c, embedder: null, query: q }));
  }
});

test('formatResults shows the building header only while building', () => {
  const r = [{ kind: 'note', loc: 't', text: 'x', date: null }];
  assert.match(formatResults(r, { status: { phase: 'building', done: 1, total: 4 }, semantic: true }), /Index still building \(1\/4\)/);
  for (const phase of ['needs-confirmation', 'blocked', 'idle', 'error']) {
    assert.doesNotMatch(formatResults(r, { status: { phase }, semantic: true }), /still building/);
  }
});
