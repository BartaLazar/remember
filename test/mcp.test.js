import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runIndex } from '../server/lib/indexer.js';
import { openStore } from '../server/lib/store.js';
import { createFakeEmbedder } from '../server/lib/embed.js';
import { readNotes, readExclusions } from '../server/lib/userdata.js';

const SERVER = fileURLToPath(new URL('../server/mcp.js', import.meta.url));
let base, root, dataDir, client, spawnLog;
const extra = [];
const spawns = () => (fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const connect = async (dir, env = {}) => {
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({
    command: process.execPath, args: [SERVER],
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, REMEMBER_PROJECT_DIR: dir, REMEMBER_FAKE_EMBEDDER: '1', REMEMBER_CONFIG_DIR: path.join(base, 'cfg'), REMEMBER_SPAWN_LOG: spawnLog, ...env },
  }));
  extra.push(c);
  return c;
};
const callOn = async (c, name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { text: r.content.map((x) => x.text).join('\n'), isError: !!r.isError };
};

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join('\n'), isError: !!r.isError };
};

before(async () => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'remember-mcp-')));
  root = path.join(base, 'proj');
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'docs', 'guide.md'), '# Guide\nthe zebracorn pagination guide\n');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const zebracorn = 1;\n');
  dataDir = path.join(root, '.remember');
  fs.mkdirSync(dataDir, { recursive: true });
  const store = openStore(path.join(dataDir, 'index.db'));
  await runIndex({ root, dataDir, store, embedder: createFakeEmbedder(), projectsDir: path.join(base, 'projects') });
  store.close();
  spawnLog = path.join(base, 'spawn.log');
  client = await connect(root);
});
after(async () => {
  for (const c of extra) await c.close().catch(() => {});
  fs.rmSync(base, { recursive: true, force: true });
});

test('lists the six tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['configure', 'forget', 'reindex', 'save_note', 'search', 'status']);
});

test('status mentions files:', async () => {
  const { text } = await call('status');
  assert.match(text, /files:/);
});

test('search points at the known file', async () => {
  const { text, isError } = await call('search', { query: 'zebracorn' });
  assert.equal(isError, false);
  assert.match(text, /docs\/guide\.md:\d+-\d+/);
});

test('save_note returns an id found in notes.jsonl', async () => {
  const { text } = await call('save_note', { title: 'Cursors', body: 'use cursor pagination', tags: ['db'] });
  const id = text.match(/Saved note (\S+)\./)[1];
  assert.ok(readNotes(dataDir).some((n) => n.id === id));
});

test('configure validates and stores', async () => {
  const ok = await call('configure', { max_files: 0 });
  assert.match(ok.text, /0/);
  const bad = await client.callTool({ name: 'configure', arguments: { max_files: -1 } }).catch(() => ({ isError: true }));
  assert.equal(!!bad.isError, true);
});

test('reindex starts in background', async () => {
  const { text } = await call('reindex', { paths: ['src/a.js'] });
  assert.match(text, /Indexing started/);
});

test('forget removes docs from the next search; undo restores exclusion list', async () => {
  const r = await call('forget', { target: 'docs/**' });
  assert.deepEqual(readExclusions(dataDir).patterns, ['docs/**']);
  assert.ok(r.text.length > 0);
  const { text } = await call('search', { query: 'zebracorn' });
  assert.doesNotMatch(text, /docs\/guide\.md/);
  assert.match(text, /src\/a\.js/);
  await call('forget', { target: 'docs/**', undo: true });
  assert.deepEqual(readExclusions(dataDir).patterns, []);
});

test('disable_project turns search off with one line', async () => {
  await call('forget', { disable_project: true });
  const { text } = await call('search', { query: 'zebracorn' });
  assert.match(text, /off/i);
  assert.doesNotMatch(text, /guide\.md/);
  await call('forget', { disable_project: true, undo: true });
  assert.ok(!fs.existsSync(path.join(dataDir, 'off')));
});

test('forget and supersedes validation', async () => {
  for (const args of [{ target: '  ' }, { target: 'session:' }, { target: 'session:', undo: true }, {}]) {
    assert.equal((await call('forget', args)).isError, true, JSON.stringify(args));
  }
  const r = await call('save_note', { title: 't', body: 'b', supersedes: 'n-nope' });
  assert.equal(r.isError, true);
  const ok = await call('save_note', { title: 't2', body: 'b' });
  const id = ok.text.match(/Saved note (\S+)\./)[1];
  assert.equal((await call('save_note', { title: 't3', body: 'b', supersedes: id })).isError, false);
});

test('fresh git repo: save_note leaves nothing of .remember untracked', async () => {
  const dir = path.join(base, 'gitproj');
  fs.mkdirSync(dir);
  execFileSync('git', ['init', '-q', dir]);
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  const c = await connect(dir);
  await callOn(c, 'save_note', { title: 'n', body: 'b' });
  await callOn(c, 'forget', { target: 'x.txt' });
  assert.ok(fs.existsSync(path.join(dir, '.remember', '.gitignore')));
  const out = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' });
  assert.doesNotMatch(out, /\.remember/);
});

test('blocked root: status creates no .remember, reindex refuses unless forced', async () => {
  const dir = path.join(base, 'home');
  fs.mkdirSync(dir);
  const c = await connect(dir, { HOME: dir, USERPROFILE: dir });
  const before = spawns().length;
  const st = await callOn(c, 'status');
  assert.match(st.text, /blocked/);
  assert.ok(!fs.existsSync(path.join(dir, '.remember')));
  assert.match((await callOn(c, 'reindex', {})).text, /too broad/);
  assert.equal(spawns().length, before);
  await callOn(c, 'reindex', { force: true });
  assert.equal(spawns().length, before + 1);
  // the forced reindex is an explicit override: the root is active from now on
  assert.ok(fs.existsSync(path.join(dir, '.remember', 'override')));
  assert.ok(fs.existsSync(path.join(dir, '.remember', '.gitignore')));
  await callOn(c, 'save_note', { title: 'n', body: 'b' });
  assert.equal(spawns().length, before + 2);
  assert.doesNotMatch((await callOn(c, 'status')).text, /blocked/);
  // turning the project off still wins over the override
  await callOn(c, 'forget', { disable_project: true });
  assert.match((await callOn(c, 'status')).text, /off/);
  assert.match((await callOn(c, 'reindex', { force: true })).text, /off/);
  assert.equal(spawns().length, before + 2);
});

async function freshProject(name, files) {
  const dir = path.join(base, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const dd = path.join(dir, '.remember');
  fs.mkdirSync(dd, { recursive: true });
  const store = openStore(path.join(dd, 'index.db'));
  await runIndex({ root: dir, dataDir: dd, store, embedder: createFakeEmbedder(), projectsDir: path.join(base, 'projects') });
  store.close();
  return { dir, dd };
}
const indexed = (dd) => { const s = openStore(path.join(dd, 'index.db')); const k = s.listSourceKeys('file'); s.close(); return k; };

test('forget normalizes ./ and backslashes and reports how many items were removed', async () => {
  const { dir, dd } = await freshProject('fg1', { 'secrets/a.txt': 'alpha\n', 'secrets/b.txt': 'beta\n', 'keep.txt': 'keep\n' });
  const c = await connect(dir);
  const before = spawns().length;
  const r = await callOn(c, 'forget', { target: './secrets/a.txt' });
  assert.match(r.text, /Excluded "secrets\/a\.txt"; removed 1 indexed item\./);
  assert.deepEqual(readExclusions(dd).patterns, ['secrets/a.txt']);
  assert.equal(spawns().length, before + 1); // queued run purges again
  const r2 = await callOn(c, 'forget', { target: 'secrets\\b.txt' });
  assert.match(r2.text, /removed 1 indexed item/);
  assert.deepEqual(readExclusions(dd).patterns, ['secrets/a.txt', 'secrets/b.txt']);
  assert.deepEqual(indexed(dd), ['file:keep.txt']);
  const r3 = await callOn(c, 'forget', { target: './nothing/here.txt' });
  assert.match(r3.text, /Excluded "nothing\/here\.txt"; nothing indexed matched yet\./);
});

test('off project: nothing is spawned', async () => {
  const dir = path.join(base, 'offproj');
  fs.mkdirSync(dir);
  const c = await connect(dir);
  await callOn(c, 'forget', { disable_project: true });
  const before = spawns().length;
  assert.match((await callOn(c, 'reindex', { force: true })).text, /off/);
  await callOn(c, 'save_note', { title: 'n', body: 'b' });
  await callOn(c, 'forget', { target: 'a', undo: true });
  assert.match((await callOn(c, 'status')).text, /off/);
  assert.equal(spawns().length, before);
});
