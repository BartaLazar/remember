import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIndex, purgeExcluded } from '../server/lib/indexer.js';
import { openStore } from '../server/lib/store.js';
import { createFakeEmbedder } from '../server/lib/embed.js';
import { claudeSlug } from '../server/lib/project.js';
import { appendNote, addExclusion, readExclusions, setOff, setOverride, readStatus, writeConfig } from '../server/lib/userdata.js';

const real = (p) => fs.realpathSync.native(p);
const mk = (prefix) => real(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

function setup(files = { 'a.js': 'export const a = 1;\n', 'b.js': 'export const b = 2;\n' }) {
  const base = mk('remember-ix-');
  const root = path.join(base, 'proj');
  fs.mkdirSync(root);
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(root, n), t);
  const dataDir = path.join(root, '.remember');
  const projectsDir = path.join(base, 'projects');
  const pd = path.join(projectsDir, claudeSlug(root));
  fs.mkdirSync(pd, { recursive: true });
  const fx = fs.readFileSync(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8').replaceAll('/work/demo', JSON.stringify(root).slice(1, -1));
  fs.writeFileSync(path.join(pd, 'sess-1111.jsonl'), fx);
  process.env.REMEMBER_CONFIG_DIR = path.join(base, 'cfg');
  const store = openStore(path.join(base, 'index.db'));
  const embedder = createFakeEmbedder();
  return { base, root, dataDir, projectsDir, store, embedder };
}
const setMax = (n) => writeConfig({ maxFiles: n });
const spy = (e) => {
  const s = { calls: 0, embedDocuments: async (t) => { s.calls++; return e.embedDocuments(t); }, embedQuery: e.embedQuery };
  return s;
};

test('first run indexes files, chat and note; second run embeds nothing', async () => {
  const c = setup();
  appendNote(c.dataDir, { title: 'Use cursors', body: 'pagination decision' });
  const st = await runIndex({ ...c });
  assert.equal(st.phase, 'idle');
  const n = c.store.counts();
  assert.equal(n.file, 2);
  assert.equal(n.chat, 1);
  assert.equal(n.note, 1);
  assert.equal(n.unembedded, 0);
  assert.equal(readStatus(c.dataDir).phase, 'idle');
  assert.ok(c.store.getSource('chat:sess-1111'));
  const [nc] = c.store.getChunks(c.store.fts('pagination', ['note'], 5).map((h) => h.id));
  assert.equal(nc.loc, 'Use cursors');
  assert.equal(nc.text, 'Use cursors\n\npagination decision');
  const s = spy(c.embedder);
  await runIndex({ ...c, embedder: s });
  assert.equal(s.calls, 0);
  assert.deepEqual(c.store.counts(), n);
});

test('touching mtime without content change does not re-chunk', async () => {
  const c = setup();
  await runIndex({ ...c });
  const before = c.store.counts();
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(c.root, 'a.js'), t, t);
  const s = spy(c.embedder);
  await runIndex({ ...c, embedder: s });
  assert.equal(s.calls, 0);
  assert.deepEqual(c.store.counts(), before);
  assert.equal(c.store.getSource('file:a.js').mtimeMs, fs.statSync(path.join(c.root, 'a.js')).mtimeMs);
});

test('deleted and renamed files are removed; paths for missing file deletes', async () => {
  const c = setup();
  await runIndex({ ...c });
  fs.rmSync(path.join(c.root, 'a.js'));
  fs.renameSync(path.join(c.root, 'b.js'), path.join(c.root, 'c.js'));
  await runIndex({ ...c });
  assert.equal(c.store.getSource('file:a.js'), undefined);
  assert.equal(c.store.getSource('file:b.js'), undefined);
  assert.ok(c.store.getSource('file:c.js'));
  fs.writeFileSync(path.join(c.root, 'gone.js'), 'x = 1\n');
  await runIndex({ ...c, paths: ['gone.js'] });
  assert.ok(c.store.getSource('file:gone.js'));
  fs.rmSync(path.join(c.root, 'gone.js'));
  await runIndex({ ...c, paths: ['gone.js'] });
  assert.equal(c.store.getSource('file:gone.js'), undefined);
  assert.ok(c.store.getSource('file:c.js'));
});

test('superseding a note removes the old note source', async () => {
  const c = setup();
  const a = appendNote(c.dataDir, { title: 'A', body: 'one' });
  await runIndex({ ...c });
  assert.ok(c.store.getSource(`note:${a.id}`));
  const b = appendNote(c.dataDir, { title: 'B', body: 'two', supersedes: a.id });
  await runIndex({ ...c });
  assert.equal(c.store.getSource(`note:${a.id}`), undefined);
  assert.ok(c.store.getSource(`note:${b.id}`));
});

test('session exclusion + purgeExcluded removes chat and it stays gone', async () => {
  const c = setup();
  await runIndex({ ...c });
  addExclusion(c.dataDir, 'session:sess-1111');
  await purgeExcluded(c.store, c.root, readExclusions(c.dataDir));
  assert.equal(c.store.getSource('chat:sess-1111'), undefined);
  await runIndex({ ...c });
  assert.equal(c.store.getSource('chat:sess-1111'), undefined);
});

test('purgeExcluded applies patterns to file sources', async () => {
  const c = setup();
  await runIndex({ ...c });
  await purgeExcluded(c.store, c.root, { patterns: ['a.js'], sessions: [] });
  assert.equal(c.store.getSource('file:a.js'), undefined);
  assert.ok(c.store.getSource('file:b.js'));
});

test('off switch indexes nothing', async () => {
  const c = setup();
  setOff(c.dataDir, true);
  await runIndex({ ...c });
  assert.equal(c.store.counts().chunks, 0);
});

test('blocked root yields blocked status', async () => {
  const c = setup();
  const st = await runIndex({ ...c, root: os.homedir() });
  assert.equal(st.phase, 'blocked');
  assert.equal(c.store.counts().chunks, 0);
});

test('too many files needs confirmation unless forced', async () => {
  const c = setup({ 'a.js': '1\n', 'b.js': '2\n', 'c.js': '3\n' });
  setMax(2);
  const st = await runIndex({ ...c });
  assert.equal(st.phase, 'needs-confirmation');
  assert.equal(c.store.counts().chunks, 0);
  const st2 = await runIndex({ ...c, force: true });
  assert.equal(st2.phase, 'idle');
  assert.equal(c.store.counts().file, 3);
});

test('maxFiles 0 disables the guard', async () => {
  const c = setup({ 'a.js': '1\n', 'b.js': '2\n', 'c.js': '3\n' });
  setMax(0);
  const st = await runIndex({ ...c });
  assert.equal(st.phase, 'idle');
  assert.equal(c.store.counts().file, 3);
});

test('null embedder stores chunks; later run backfills', async () => {
  const c = setup();
  await runIndex({ ...c, embedder: null });
  assert.ok(c.store.counts().unembedded > 0);
  const texts = [];
  const s = { embedDocuments: async (t) => { texts.push(...t); return c.embedder.embedDocuments(t); }, embedQuery: c.embedder.embedQuery };
  await runIndex({ ...c, embedder: s });
  assert.equal(c.store.counts().unembedded, 0);
  assert.ok(texts.some((t) => t.startsWith('a.js\n')));
});

test('throwing embedder does not lose text', async () => {
  const c = setup();
  const bad = { embedDocuments: async () => { throw new Error('boom'); }, embedQuery: async () => { throw new Error('boom'); } };
  await runIndex({ ...c, embedder: bad });
  assert.equal(c.store.counts().file, 2);
  assert.ok(c.store.counts().unembedded > 0);
});

test('symlink pointing outside the project is not indexed', async (t) => {
  const c = setup();
  const outside = path.join(c.base, 'outside.txt');
  fs.writeFileSync(outside, 'OUTSIDE-SECRET-CONTENT\n');
  try { fs.symlinkSync(outside, path.join(c.root, 'link.txt')); } catch { t.skip('no symlinks'); return; }
  await runIndex({ ...c });
  assert.equal(c.store.getSource('file:link.txt'), undefined);
  assert.equal(c.store.fts('OUTSIDE', ['file'], 5).length, 0);
  await runIndex({ ...c, paths: ['link.txt'] });
  assert.equal(c.store.getSource('file:link.txt'), undefined);
});

test('force indexes all files beyond maxFiles and keeps them on rerun', async () => {
  const f = {};
  for (let i = 0; i < 6; i++) f[`f${i}.js`] = `const v${i} = ${i};\n`;
  const c = setup(f);
  setMax(2);
  await runIndex({ ...c, force: true });
  assert.equal(c.store.counts().file, 6);
  await runIndex({ ...c, force: true });
  assert.equal(c.store.counts().file, 6);
});

test('paths run cannot bypass needs-confirmation', async () => {
  const c = setup({ 'a.js': '1\n', 'b.js': '2\n', 'c.js': '3\n' });
  setMax(2);
  await runIndex({ ...c });
  await runIndex({ ...c, paths: ['a.js'] });
  assert.equal(c.store.counts().chunks, 0);
  assert.equal(readStatus(c.dataDir).phase, 'needs-confirmation');
});

test('off returns idle/off and writes nothing', async () => {
  const c = setup();
  setOff(c.dataDir, true);
  const st = await runIndex({ ...c });
  assert.equal(st.phase, 'idle');
  assert.equal(st.message, 'off');
  assert.equal(readStatus(c.dataDir), null);
});

test('backfill terminates when embedder returns no vectors', async () => {
  const c = setup();
  await runIndex({ ...c, embedder: null });
  const empty = { embedDocuments: async () => [], embedQuery: async () => null };
  await runIndex({ ...c, embedder: empty });
  assert.ok(c.store.counts().unembedded > 0);
});

test('unreadable existing file keeps its source', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('chmod not applicable'); return; }
  const c = setup();
  await runIndex({ ...c });
  const f = path.join(c.root, 'a.js');
  fs.writeFileSync(f, 'export const a = 22222;\n');
  fs.chmodSync(f, 0);
  try { await runIndex({ ...c }); } finally { fs.chmodSync(f, 0o644); }
  assert.ok(c.store.getSource('file:a.js'));
});

test('unreadable exclusions.json stops the run with phase error and indexes nothing', async () => {
  const c = setup();
  fs.mkdirSync(c.dataDir, { recursive: true });
  fs.writeFileSync(path.join(c.dataDir, 'exclusions.json'), '{oops');
  await assert.rejects(runIndex({ ...c }), /exclusions\.json/);
  const st = readStatus(c.dataDir);
  assert.equal(st.phase, 'error');
  assert.match(st.message, /exclusions\.json/);
  assert.equal(c.store.counts().file, 0);
});

test('a forget issued mid-run keeps the excluded file out of the index', async () => {
  const c = setup();
  let first = true;
  const embedder = {
    embedQuery: c.embedder.embedQuery,
    embedDocuments: async (texts) => {
      if (first) { // while the first file is being embedded, the user forgets the other one
        first = false;
        const other = texts[0].startsWith('a.js') ? 'b.js' : 'a.js';
        addExclusion(c.dataDir, other);
      }
      return c.embedder.embedDocuments(texts);
    },
  };
  await runIndex({ ...c, embedder });
  const keys = c.store.listSourceKeys('file');
  assert.equal(keys.length, 1, keys.join());
  const excluded = readExclusions(c.dataDir).patterns[0];
  assert.ok(!keys.includes(`file:${excluded}`));
});

test('purgeExcluded returns how many sources it removed', async () => {
  const c = setup();
  await runIndex({ ...c });
  assert.equal(await purgeExcluded(c.store, c.root, { patterns: ['a.js'], sessions: ['sess-1111'] }), 2);
  assert.equal(await purgeExcluded(c.store, c.root, { patterns: ['a.js'], sessions: ['sess-1111'] }), 0);
});

test('chats are keyed by transcript file name, so shared sessionIds do not collide', async () => {
  const c = setup();
  const pd = path.join(c.projectsDir, claudeSlug(c.root));
  fs.copyFileSync(path.join(pd, 'sess-1111.jsonl'), path.join(pd, 'forked-2222.jsonl'));
  await runIndex({ ...c });
  assert.deepEqual(c.store.listSourceKeys('chat'), ['chat:forked-2222', 'chat:sess-1111']);
});

test('session exclusion matches the file name or any sessionId inside the file', async () => {
  const c = setup();
  const pd = path.join(c.projectsDir, claudeSlug(c.root));
  fs.copyFileSync(path.join(pd, 'sess-1111.jsonl'), path.join(pd, 'forked-2222.jsonl'));
  await runIndex({ ...c });
  // by file name
  addExclusion(c.dataDir, 'session:forked-2222');
  await purgeExcluded(c.store, c.root, readExclusions(c.dataDir));
  assert.deepEqual(c.store.listSourceKeys('chat'), ['chat:sess-1111']);
  await runIndex({ ...c });
  assert.deepEqual(c.store.listSourceKeys('chat'), ['chat:sess-1111']);
  // by the sessionId recorded inside both files: purge removes the forked one's chunks too
  const c2 = setup();
  const pd2 = path.join(c2.projectsDir, claudeSlug(c2.root));
  fs.copyFileSync(path.join(pd2, 'sess-1111.jsonl'), path.join(pd2, 'forked-2222.jsonl'));
  await runIndex({ ...c2 });
  addExclusion(c2.dataDir, 'session:sess-1111');
  await purgeExcluded(c2.store, c2.root, readExclusions(c2.dataDir));
  assert.deepEqual(c2.store.listSourceKeys('chat'), []);
  await runIndex({ ...c2 });
  assert.deepEqual(c2.store.listSourceKeys('chat'), []);
});

test('a blocked root with an override file is indexed', async () => {
  const c = setup();
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = c.root; process.env.USERPROFILE = c.root;
  try {
    assert.equal((await runIndex({ ...c })).phase, 'blocked');
    setOverride(c.dataDir);
    assert.equal((await runIndex({ ...c })).phase, 'idle');
    assert.ok(c.store.counts().file > 0);
    setOff(c.dataDir, true);
    assert.equal((await runIndex({ ...c })).message, 'off');
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
