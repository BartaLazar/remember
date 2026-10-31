import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../server/lib/store.js';

const tmpDb = () => path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'remember-st-'))), 'index.db');
const src = (key, kind = 'file') => ({ key, kind, hash: 'h', mtimeMs: 1, size: 2 });
const chunk = (text, extra = {}) => ({ loc: 'a.js', startLine: 1, endLine: 2, text, date: null, embedding: null, ...extra });

test('replaceSource then fts finds text; getSource and getChunks work', () => {
  const s = openStore(tmpDb());
  s.replaceSource(src('file:a.js'), [chunk('hello snake_case world')]);
  assert.deepEqual(s.getSource('file:a.js'), src('file:a.js'));
  const hits = s.fts('"snake_case"', ['file', 'chat', 'note'], 10);
  assert.equal(hits.length, 1);
  const [c] = s.getChunks([hits[0].id]);
  assert.equal(c.sourceKey, 'file:a.js');
  assert.equal(c.kind, 'file');
  assert.equal(c.startLine, 1);
  assert.equal(c.text, 'hello snake_case world');
  s.close();
});

test('replacing a source removes old chunks from fts', () => {
  const s = openStore(tmpDb());
  s.replaceSource(src('file:a.js'), [chunk('alpha')]);
  s.replaceSource(src('file:a.js'), [chunk('beta')]);
  assert.equal(s.fts('alpha', ['file'], 10).length, 0);
  assert.equal(s.fts('beta', ['file'], 10).length, 1);
  assert.equal(s.counts().chunks, 1);
  s.close();
});

test('deleteSource cascades and listSourceKeys lists by kind', () => {
  const s = openStore(tmpDb());
  s.replaceSource(src('file:a.js'), [chunk('alpha')]);
  s.replaceSource(src('note:1', 'note'), [chunk('alpha', { loc: 'T' })]);
  assert.deepEqual(s.listSourceKeys('file'), ['file:a.js']);
  s.deleteSource('file:a.js');
  assert.equal(s.getSource('file:a.js'), undefined);
  assert.equal(s.counts().chunks, 1);
  assert.equal(s.fts('alpha', ['file', 'note'], 10).length, 1);
  assert.deepEqual(s.counts(), { file: 0, chat: 0, note: 1, chunks: 1, unembedded: 1 });
  s.close();
});

test('vectors round-trip byte-exact; missing embeddings listed and cleared', () => {
  const s = openStore(tmpDb());
  const v = new Float32Array([0.1, -2.5, 3.25e-7]);
  s.replaceSource(src('file:a.js'), [chunk('one', { embedding: v }), chunk('two')]);
  const vs = s.vectors(['file']);
  assert.equal(vs.length, 1);
  assert.deepEqual(Buffer.from(vs[0].vector.buffer, vs[0].vector.byteOffset, vs[0].vector.byteLength), Buffer.from(v.buffer));
  const miss = s.chunksMissingEmbeddings(10);
  assert.equal(miss.length, 1);
  assert.equal(miss[0].text, 'two');
  s.setEmbedding(miss[0].id, new Float32Array([1, 2, 3]));
  assert.equal(s.chunksMissingEmbeddings(10).length, 0);
  assert.equal(s.vectors(['file']).length, 2);
  assert.equal(s.vectors(['note']).length, 0);
  s.close();
});

test('fts kinds filter excludes other kinds', () => {
  const s = openStore(tmpDb());
  s.replaceSource(src('file:a.js'), [chunk('needle')]);
  s.replaceSource(src('note:1', 'note'), [chunk('needle', { loc: 'T' })]);
  const hits = s.fts('needle', ['note'], 10);
  assert.equal(hits.length, 1);
  assert.equal(s.getChunks([hits[0].id])[0].kind, 'note');
  s.close();
});

test('garbage db file is replaced with a working empty store', () => {
  const p = tmpDb();
  fs.writeFileSync(p, Buffer.alloc(4096, 0x41));
  const s = openStore(p);
  assert.equal(s.counts().chunks, 0);
  s.replaceSource(src('file:a.js'), [chunk('ok')]);
  assert.equal(s.counts().chunks, 1);
  s.close();
});

test('persists across reopen', () => {
  const p = tmpDb();
  let s = openStore(p);
  s.replaceSource(src('file:a.js'), [chunk('persist')]);
  s.close();
  s = openStore(p);
  assert.equal(s.fts('persist', ['file'], 5).length, 1);
  s.close();
});

test('touchSource updates mtime/size only; missing list carries kind and loc', () => {
  const s = openStore(tmpDb());
  s.replaceSource(src('file:a.js'), [chunk('one')]);
  s.touchSource('file:a.js', 99, 7);
  assert.deepEqual(s.getSource('file:a.js'), { ...src('file:a.js'), mtimeMs: 99, size: 7 });
  assert.equal(s.counts().chunks, 1);
  const [m] = s.chunksMissingEmbeddings(5);
  assert.equal(m.kind, 'file');
  assert.equal(m.loc, 'a.js');
  s.close();
});

import { spawn } from 'node:child_process';

/** Hold BEGIN EXCLUSIVE on dbPath in another process for holdMs; resolves once locked. */
function holdLock(dbPath, holdMs) {
  const code = `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);` +
    `d.exec('BEGIN EXCLUSIVE');console.log('locked');setTimeout(()=>{d.exec('COMMIT');process.exit(0)},${holdMs});`;
  const child = spawn(process.execPath, ['-e', code, dbPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    child.stdout.once('data', () => resolve(child));
    child.once('error', reject);
  });
}

test('a briefly locked database is waited for and its data survives', async () => {
  const db = tmpDb();
  const s = openStore(db);
  s.replaceSource(src('file:a.js'), [chunk('keepme')]);
  s.close();
  const child = await holdLock(db, 300);
  const s2 = openStore(db);
  assert.equal(s2.fts('keepme', ['file'], 5).length, 1);
  s2.close();
  child.kill();
});

test('a long lock makes openStore throw and never deletes the file', async () => {
  const db = tmpDb();
  const s = openStore(db);
  s.replaceSource(src('file:a.js'), [chunk('keepme')]);
  s.close();
  const child = await holdLock(db, 3000);
  try {
    assert.throws(() => openStore(db, { busyTimeoutMs: 200 }), /locked|busy/i);
    assert.equal(fs.existsSync(db), true);
  } finally { child.kill(); }
  await new Promise((r) => setTimeout(r, 100));
  const s3 = openStore(db);
  assert.equal(s3.fts('keepme', ['file'], 5).length, 1);
  s3.close();
});

test('a real non-database file is replaced', () => {
  const db = tmpDb();
  fs.writeFileSync(db, 'this is not a sqlite database, just text '.repeat(50));
  const s = openStore(db);
  assert.equal(s.counts().chunks, 0);
  s.close();
});
