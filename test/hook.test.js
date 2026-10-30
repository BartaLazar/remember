import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHook } from '../server/bin/hook.js';
import { setOff, setOverride, writeConfig, readStatus, writeStatus } from '../server/lib/userdata.js';

const REAL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOK = path.join(REAL_ROOT, 'server', 'bin', 'hook.js');

function tmp() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rem-hook-'))); }
function setup(files = ['a.js']) {
  const root = tmp();
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), 'x\n'); }
  const cfg = tmp();
  process.env.REMEMBER_CONFIG_DIR = cfg;
  process.env.REMEMBER_MODELS_DIR = tmp();
  const calls = [];
  const deps = { spawnWorker: (r, a) => calls.push([r, a]), pluginRoot: REAL_ROOT };
  return { root, calls, deps };
}
const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput.additionalContext;

test('session-start spawns and tells Claude about recall', () => {
  return (async () => {
    const { root, calls, deps } = setup();
    const r = await handleHook('session-start', { cwd: root }, deps);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(ctx(r), /recall skill/);
    assert.match(ctx(r), /downloading for the first time/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [root, []]);
  })();
});

test('session-start with off file: no output, no spawn', async () => {
  const { root, calls, deps } = setup();
  setOff(path.join(root, '.remember'), true);
  const r = await handleHook('session-start', { cwd: root }, deps);
  assert.equal(r.stdout, '');
  assert.equal(calls.length, 0);
});

test('session-start in blocked root', async () => {
  const { calls, deps } = setup();
  const r = await handleHook('session-start', { cwd: os.homedir() }, deps);
  assert.match(ctx(r), /too broad to index automatically/);
  assert.equal(calls.length, 0);
});

test('session-start with missing dependencies reports install', async () => {
  const { root, calls, deps } = setup();
  const prevData = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const r = await handleHook('session-start', { cwd: root }, { ...deps, pluginRoot: tmp(), depsAvailable: () => false, installDeps: () => { calls.push('install'); return true; } });
    assert.match(ctx(r), /installing its dependencies in the background/);
    assert.deepEqual(calls, ['install']);
  } finally { if (prevData !== undefined) process.env.CLAUDE_PLUGIN_DATA = prevData; }
});

test('session-start over threshold asks, sets needs-confirmation, no spawn', async () => {
  const { root, calls, deps } = setup(['a.js', 'b.js', 'c.js']);
  writeConfig({ maxFiles: 2 });
  const r = await handleHook('session-start', { cwd: root }, deps);
  const c = ctx(r);
  assert.match(c, /more than 2 files/);
  assert.match(c, /\(1\) index everything/);
  assert.match(c, /\(2\) skip this project/);
  assert.match(c, /\(3\) change the threshold/);
  assert.equal(calls.length, 0);
  assert.equal(readStatus(path.join(root, '.remember')).phase, 'needs-confirmation');
});

test('existing needs-confirmation status re-triggers the prompt', async () => {
  const { root, calls, deps } = setup(['a.js', 'b.js', 'c.js']);
  writeConfig({ maxFiles: 2 });
  writeStatus(path.join(root, '.remember'), { phase: 'needs-confirmation', done: 0, total: 3, updatedAt: Date.now() });
  const r = await handleHook('session-start', { cwd: root }, deps);
  assert.match(ctx(r), /more than 2 files/);
  assert.equal(calls.length, 0);
});

test('post-tool-use ignores .remember paths', async () => {
  const { root, calls, deps } = setup(['.remember/x.json']);
  await handleHook('post-tool-use', { cwd: root, tool_input: { file_path: path.join(root, '.remember', 'x.json') } }, deps);
  assert.equal(calls.length, 0);
});

test('session-start without data dir reports missing deps instead of install', async () => {
  const { root, calls, deps } = setup();
  const r = await handleHook('session-start', { cwd: root }, { ...deps, depsAvailable: () => false, installDeps: () => false });
  assert.match(ctx(r), /dependencies are missing.*npm ci --omit=dev/);
  assert.equal(calls.length, 0);
});

test('session-start with maxFiles 0 skips the size check', async () => {
  const { root, calls, deps } = setup(['a.js', 'b.js', 'c.js']);
  writeConfig({ maxFiles: 0 });
  await handleHook('session-start', { cwd: root }, deps);
  assert.equal(calls.length, 1);
});

test('old Node version stops with a message', async () => {
  const { root, calls, deps } = setup();
  const r = await handleHook('session-start', { cwd: root }, { ...deps, nodeVersion: '20.11.0' });
  assert.match(ctx(r), /needs Node\.js 22\.13 or newer \(found 20\.11\.0\)/);
  assert.equal(calls.length, 0);
});

test('post-tool-use spawns with --paths JSON array', async () => {
  const { root, calls, deps } = setup(['src/a.js']);
  const r = await handleHook('post-tool-use', { cwd: root, tool_input: { file_path: path.join(root, 'src', 'a.js') } }, deps);
  assert.equal(r.stdout, '');
  assert.deepEqual(calls, [[root, ['--paths', JSON.stringify(['src/a.js'])]]]);
});

test('post-tool-use outside root does not spawn', async () => {
  const { root, calls, deps } = setup();
  await handleHook('post-tool-use', { cwd: root, tool_input: { file_path: path.join(tmp(), 'z.js') } }, deps);
  assert.equal(calls.length, 0);
});

test('session-end spawns unless off', async () => {
  const { root, calls, deps } = setup();
  await handleHook('session-end', { cwd: root }, deps);
  assert.equal(calls.length, 1);
  setOff(path.join(root, '.remember'), true);
  await handleHook('session-end', { cwd: root }, deps);
  assert.equal(calls.length, 1);
});

test('main exits 0 on malformed stdin and prints nothing to stdout', () => {
  const r = spawnSync(process.execPath, [HOOK, 'session-start'], { input: 'not json{', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('over-threshold status write keeps .remember out of git', async () => {
  const { root, deps } = setup(['a.js', 'b.js', 'c.js']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeConfig({ maxFiles: 2 });
  const r = await handleHook('session-start', { cwd: root }, deps);
  assert.equal(readStatus(path.join(root, '.remember')).phase, 'needs-confirmation');
  assert.match(ctx(r), /more than 2 files/);
  const st = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
  assert.match(st, /a\.js/);
  assert.doesNotMatch(st, /\.remember/);
});

test('blocked root with an override file is active; off still wins', async () => {
  const { root, calls, deps } = setup();
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = root; process.env.USERPROFILE = root;
  try {
    const dd = path.join(root, '.remember');
    assert.match(ctx(await handleHook('session-start', { cwd: root }, deps)), /too broad/);
    assert.equal(calls.length, 0);
    setOverride(dd);
    assert.match(ctx(await handleHook('session-start', { cwd: root }, deps)), /recall skill/);
    assert.equal(calls.length, 1);
    await handleHook('session-end', { cwd: root }, deps);
    assert.equal(calls.length, 2);
    setOff(dd, true);
    assert.equal((await handleHook('session-start', { cwd: root }, deps)).stdout, '');
    assert.equal(calls.length, 2);
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
