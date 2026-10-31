import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  resolveProject, isBlockedRoot, ensureDataDir, claudeSlug, transcriptFiles,
} from '../server/lib/project.js';

const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'remember-proj-')));
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

test('resolveProject returns the git root from a subdir', () => {
  const root = tmp();
  git(root, 'init', '-q');
  const sub = path.join(root, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  const r = resolveProject(sub);
  assert.equal(r.root, root);
  assert.equal(r.dataDir, path.join(root, '.remember'));
});

test('resolveProject falls back to the (real) dir when not a git repo', () => {
  const dir = tmp();
  const r = resolveProject(dir);
  assert.equal(r.root, fs.realpathSync.native(dir));
  assert.equal(r.dataDir, path.join(r.root, '.remember'));
});

test('isBlockedRoot', () => {
  const home = '/Users/someone';
  assert.equal(isBlockedRoot('/', home), true);
  assert.equal(isBlockedRoot(home, home), true);
  assert.equal(isBlockedRoot(home + '/Desktop', home), true);
  assert.equal(isBlockedRoot(home + '/Documents', home), true);
  assert.equal(isBlockedRoot(home + '/Downloads', home), true);
  assert.equal(isBlockedRoot(home + '/Desktop/proj', home), false);
});

test('isBlockedRoot handles Windows-style paths', () => {
  const home = 'C:\\Users\\x';
  const w = path.win32;
  assert.equal(isBlockedRoot('C:\\', home, w), true);
  assert.equal(isBlockedRoot('C:\\Users\\x', home, w), true);
  assert.equal(isBlockedRoot('c:\\users\\X\\desktop', home, w), true);
  assert.equal(isBlockedRoot('C:\\Users\\x\\Desktop\\proj', home, w), false);
  assert.equal(claudeSlug('C:\\Users\\x'), 'C--Users-x');
});

test('ensureDataDir creates .gitignore and does not overwrite', () => {
  const root = tmp();
  const dataDir = path.join(root, '.remember');
  ensureDataDir(dataDir);
  assert.equal(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8'), '*\n');
  fs.writeFileSync(path.join(dataDir, '.gitignore'), 'custom\n');
  ensureDataDir(dataDir);
  assert.equal(fs.readFileSync(path.join(dataDir, '.gitignore'), 'utf8'), 'custom\n');
});

test('data dir is never seen by git', () => {
  const root = tmp();
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'x');
  const { dataDir } = resolveProject(root);
  ensureDataDir(dataDir);
  for (const f of ['index.db', 'notes.jsonl', 'exclusions.json']) fs.writeFileSync(path.join(dataDir, f), 'x');
  const status = git(root, 'status', '--porcelain', '--untracked-files=all');
  const add = git(root, 'add', '-A', '--dry-run');
  assert.ok(!status.includes('.remember'), status);
  assert.ok(!add.includes('.remember'), add);
  assert.ok(status.includes('tracked.txt'));
});

test('claudeSlug', () => {
  assert.equal(claudeSlug('/Users/a/claude_plugins/remember'), '-Users-a-claude-plugins-remember');
});

test('transcriptFiles matches by cwd, excluding sibling-prefixed projects', () => {
  const root = path.join(path.sep, 'work', 'proj');
  const projectsDir = tmp();
  const mk = (dirName, file, records) => {
    const d = path.join(projectsDir, dirName);
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, file);
    fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return f;
  };
  const slug = claudeSlug(root);
  const a = mk(slug, 's1.jsonl', [{ type: 'summary' }, { cwd: root, type: 'user' }]);
  const b = mk(slug + '-sub', 's2.jsonl', [{ cwd: path.join(root, 'sub') }]);
  mk(slug + '-other', 's3.jsonl', [{ cwd: root + '-other' }]);
  mk('unrelated', 's4.jsonl', [{ cwd: '/elsewhere' }]);
  const got = transcriptFiles(root, projectsDir).sort();
  assert.deepEqual(got, [a, b].sort());
  assert.deepEqual(transcriptFiles(root, path.join(projectsDir, 'missing')), []);
});

test('transcriptFiles finds cwd on a huge transcript without needing the whole file', () => {
  const root = path.join(path.sep, 'work', 'big');
  const projectsDir = tmp();
  const d = path.join(projectsDir, claudeSlug(root));
  fs.mkdirSync(d);
  const f = path.join(d, 'big.jsonl');
  fs.writeFileSync(f, JSON.stringify({ cwd: root }) + '\n' + ('x'.repeat(1023) + '\n').repeat(5 * 1024));
  assert.deepEqual(transcriptFiles(root, projectsDir), [f]);
});

test('transcriptFiles ignores a cwd that only appears after the scan cap', () => {
  const root = path.join(path.sep, 'work', 'late');
  const projectsDir = tmp();
  const d = path.join(projectsDir, claudeSlug(root));
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'l.jsonl'), ('x'.repeat(1023) + '\n').repeat(2048) + JSON.stringify({ cwd: root }) + '\n');
  assert.deepEqual(transcriptFiles(root, projectsDir), []);
});

test('transcriptFiles compares realpaths of recorded cwd', () => {
  const real = tmp();
  const link = path.join(tmp(), 'link');
  fs.symlinkSync(real, link);
  const projectsDir = tmp();
  const d = path.join(projectsDir, claudeSlug(real));
  fs.mkdirSync(d);
  const f = path.join(d, 'a.jsonl');
  fs.writeFileSync(f, JSON.stringify({ cwd: link }) + '\n');
  assert.deepEqual(transcriptFiles(real, projectsDir), [f]);
});
