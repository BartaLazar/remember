import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { depsAvailable, importDep, installDepsInBackground } from '../server/lib/deps.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rem-deps-'));

test('importDep resolves from the plugin root', async () => {
  const m = await importDep('ignore');
  assert.equal(typeof m.default, 'function');
});

test('importDep falls back to the data dir node_modules', async () => {
  const data = tmp();
  const pkg = path.join(data, 'node_modules', 'fake-dep-xyz');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"fake-dep-xyz","main":"i.js"}');
  fs.writeFileSync(path.join(pkg, 'i.js'), 'module.exports = { hi: 1 };');
  process.env.CLAUDE_PLUGIN_DATA = data;
  try {
    const m = await importDep('fake-dep-xyz');
    assert.equal((m.default ?? m).hi, 1);
    await assert.rejects(importDep('definitely-not-installed-abc'));
  } finally { delete process.env.CLAUDE_PLUGIN_DATA; }
});

test('depsAvailable is true here; installer without data dir is a no-op', () => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  assert.equal(depsAvailable(), true);
  installDepsInBackground(tmp(), undefined);
});

test('installer skips when a fresh marker exists', () => {
  const data = tmp();
  fs.writeFileSync(path.join(data, '.installing'), 'x');
  installDepsInBackground(tmp(), data);
  assert.equal(fs.existsSync(path.join(data, 'package.json')), false);
});

test('installer with missing lock file logs and returns false', () => {
  const data = tmp();
  assert.equal(installDepsInBackground(tmp(), data), false);
  assert.match(fs.readFileSync(path.join(data, 'install.log'), 'utf8'), /cannot install/);
});

test('installer without data dir returns false', () => {
  assert.equal(installDepsInBackground(tmp(), undefined), false);
});

test('depsAvailable requires every dependency to resolve', () => {
  delete process.env.CLAUDE_PLUGIN_DATA;
  assert.equal(depsAvailable(['zod', 'ignore']), true);
  assert.equal(depsAvailable(['zod', 'definitely-not-installed-abc']), false);
  assert.equal(depsAvailable(), true);
});

test('fallback npm ci runs with --ignore-scripts', { skip: process.platform === 'win32' }, async () => {
  const bin = tmp();
  const out = path.join(bin, 'args.txt');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho "$@" > "${out}"\n`, { mode: 0o755 });
  const root = tmp();
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  const prev = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prev}`;
  try {
    assert.equal(installDepsInBackground(root, tmp()), true);
    for (let i = 0; i < 100 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 50));
  } finally { process.env.PATH = prev; }
  const args = fs.readFileSync(out, 'utf8').trim().split(' ');
  assert.deepEqual(args.slice(0, 2), ['ci', '--omit=dev']);
  assert.ok(args.includes('--ignore-scripts'), args.join(' '));
});
