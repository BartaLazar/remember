import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MAX_FILE_BYTES, isSecretPath, isBinary, listIndexableFiles } from '../server/lib/files.js';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'remember-files-')));
const put = (root, rel, content = 'x') => {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const rels = (list) => list.map((f) => f.rel).sort();

function fixture(root) {
  put(root, 'a.js', 'console.log(1)');
  put(root, '.env', 'KEY=1');
  put(root, 'secret.pem', 'pem');
  put(root, 'node_modules/x.js');
  put(root, 'big.txt', Buffer.alloc(1_100_000, 97));
  put(root, '.gitignore', 'out/\n');
  put(root, 'out/o.js');
  put(root, '.remember/index.db');
}

test('isSecretPath matches secret file patterns', () => {
  for (const p of ['.env', '.env.local', 'a/b/server.pem', 'k.key', 'x.p12', 'x.pfx', 'id_rsa', 'id_rsa.pub',
    'id_ed25519', 'my.keystore', 'credentials.json', 'credentials-prod.json', 'dir/.env.production']) {
    assert.equal(isSecretPath(p), true, p);
  }
  for (const p of ['a.js', 'environment.md', 'keys.md', 'credentials.md', 'src/env.js']) {
    assert.equal(isSecretPath(p), false, p);
  }
});

test('isBinary looks for NUL in the first 8000 bytes', () => {
  assert.equal(isBinary(Buffer.from('hello')), false);
  assert.equal(isBinary(Buffer.from([104, 0, 105])), true);
  const late = Buffer.concat([Buffer.alloc(8000, 97), Buffer.from([0])]);
  assert.equal(isBinary(late), false);
});

test('git repo: lists only indexable files', async () => {
  const root = tmp();
  execFileSync('git', ['init', '-q'], { cwd: root });
  fixture(root);
  const list = await listIndexableFiles(root, { patterns: [] });
  assert.deepEqual(rels(list), ['.gitignore', 'a.js']);
  const a = list.find((f) => f.rel === 'a.js');
  assert.equal(a.abs, path.join(root, 'a.js'));
  assert.equal(a.size, 14);
  assert.equal(typeof a.mtimeMs, 'number');
  assert.ok(MAX_FILE_BYTES === 1_048_576);
});

test('git repo: skips tracked files that were deleted', async () => {
  const root = tmp();
  execFileSync('git', ['init', '-q'], { cwd: root });
  put(root, 'a.js');
  put(root, 'gone.js');
  execFileSync('git', ['add', '.'], { cwd: root });
  fs.rmSync(path.join(root, 'gone.js'));
  assert.deepEqual(rels(await listIndexableFiles(root, { patterns: [] })), ['a.js']);
});

test('non-git dir: walks and honors the root .gitignore', async () => {
  const root = tmp();
  fixture(root);
  put(root, 'src/deep/b.js');
  const list = await listIndexableFiles(root, { patterns: [] });
  assert.deepEqual(rels(list), ['.gitignore', 'a.js', 'src/deep/b.js']);
  assert.equal(list.find((f) => f.rel === 'src/deep/b.js').abs, path.join(root, 'src', 'deep', 'b.js'));
});

test('does not follow symlinked directories in the walk', { skip: process.platform === 'win32' }, async () => {
  const root = tmp();
  put(root, 'real/a.js');
  fs.symlinkSync(root, path.join(root, 'loop'), 'dir');
  assert.deepEqual(rels(await listIndexableFiles(root, { patterns: [] })), ['real/a.js']);
});

test('exclusion patterns (gitignore syntax) remove matches', async () => {
  const root = tmp();
  put(root, 'docs/a.md');
  put(root, 'src/b.js');
  assert.deepEqual(rels(await listIndexableFiles(root, { patterns: ['docs/**'] })), ['src/b.js']);
  execFileSync('git', ['init', '-q'], { cwd: root });
  assert.deepEqual(rels(await listIndexableFiles(root, { patterns: ['docs/**'] })), ['src/b.js']);
});

test('limit stops early', async () => {
  const root = tmp();
  put(root, 'a.js'); put(root, 'b.js'); put(root, 'c.js');
  assert.equal((await listIndexableFiles(root, { patterns: [] }, { limit: 1 })).length, 1);
  execFileSync('git', ['init', '-q'], { cwd: root });
  assert.equal((await listIndexableFiles(root, { patterns: [] }, { limit: 2 })).length, 2);
});

test('non-git walk honors limit and stops early', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rem-lim-')));
  for (let d = 0; d < 10; d++) {
    fs.mkdirSync(path.join(root, `d${d}`));
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(root, `d${d}`, `f${i}.txt`), 'x');
  }
  const orig = fs.readdirSync;
  let reads = 0;
  fs.readdirSync = (...a) => { reads++; return orig(...a); };
  let files;
  try { files = await listIndexableFiles(root, {}, { limit: 5 }); } finally { fs.readdirSync = orig; }
  assert.equal(files.length, 5);
  assert.ok(reads <= 3, `expected early stop, got ${reads} readdir calls`);
});

test('walk limit counts only indexable files', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rem-sec-')));
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(root, `.env.${i}`), 'S=1');
  for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(root, `n${i}.txt`), 'x');
  const files = await listIndexableFiles(root, {}, { limit: 5 });
  assert.equal(files.length, 5);
  assert.ok(files.every((f) => f.rel.startsWith('n')));
});

test('more secret-bearing file names are skipped', () => {
  for (const p of ['id_ecdsa', 'id_ecdsa.pub', 'id_dsa', '.npmrc', 'a/.netrc', '.git-credentials', '.pgpass',
    'k.jks', 'vault.kdbx', 'terraform.tfstate', 'x/prod.tfvars', 'credentials', 'aws/credentials']) {
    assert.equal(isSecretPath(p), true, p);
  }
  for (const p of ['credentials.md', 'credential.js', 'npmrc.md']) assert.equal(isSecretPath(p), false, p);
});
