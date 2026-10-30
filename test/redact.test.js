import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { redact } from '../server/lib/redact.js';

const R = '[REDACTED]';

test('masks each listed secret shape', () => {
  const cases = {
    pem: '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndef/ghi==\n-----END RSA PRIVATE KEY-----',
    sk: 'sk-' + 'a1B2c3D4e5F6g7H8i9J0',
    skAnt: 'sk-ant-api03-' + 'a1B2c3D4e5F6g7H8i9J0_-xyz',
    ghp: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4',
    pat: 'github_pat_' + '11ABCDEFG0abcdefgh_ijklmnop12345',
    slack: 'xoxb-' + '123456789012-abcdefABCDEF',
    aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
    google: 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz',
  };
  for (const [name, secret] of Object.entries(cases)) {
    const out = redact(`before ${secret} after`);
    assert.equal(out, `before ${R} after`, name);
  }
});

test('masks values of secret-named assignments', () => {
  assert.equal(redact('DB_PASSWORD=hunter2hunter2'), `DB_PASSWORD=${R}`);
  assert.equal(redact('{"api_token": "abc123xyz"}'), `{"api_token": "${R}"}`);
  assert.equal(redact('const apiKey = "abc123def456";'), `const apiKey = "${R}";`);
  assert.equal(redact('AUTH: Bearer12345'), `AUTH: ${R}`);
});

test('masks long high-entropy tokens', () => {
  const tok = 'Zx9Qw3Er7Ty1Ui5Op2As6Df0Gh4Jk8Lm3Nb7Vc1Xz';
  assert.equal(redact(`value ${tok} end`), `value ${R} end`);
});

test('leaves ordinary text alone', () => {
  const samples = [
    'function getUserName() { return user.name; }',
    'fixed in commit 3b18e512dba79e4c8300dd08aeb37f8e728b8dad today',
    'id 123e4567-e89b-12d3-a456-426614174000 ok',
    'see server/lib/transcripts and the token budget discussion',
    'const MAX_LINES_PER_CHUNK_FOR_INDEXING = 80;',
  ];
  for (const s of samples) assert.equal(redact(s), s);
});

test('is idempotent', () => {
  const once = redact('PASSWORD=abcdef12');
  assert.equal(redact(once), once);
});

test('masks credentials with auth schemes, quoted phrases, YAML and exports', () => {
  const cases = [
    ['Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
    ['password: "correct horse battery"', 'horse'],
    ['password: hunter2', 'hunter2'],
    ['export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
  ];
  for (const [input, secret] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(secret), `${input} -> ${out}`);
    assert.ok(out.includes(R), input);
  }
  assert.equal(redact('password: "correct horse battery"'), `password: "${R}"`);
});

test('runs in linear time on long inputs', () => {
  const inputs = [
    'a'.repeat(200000),
    'Zx9'.repeat(70000),
    'function f(a,b){return a+b}var x=1;'.repeat(30000),
  ];
  for (const s of inputs) {
    const t = performance.now();
    redact(s);
    assert.ok(performance.now() - t < 500, `${s.length} chars took ${performance.now() - t}ms`);
  }
});

test('random UUIDs survive', () => {
  for (let i = 0; i < 20; i++) {
    const u = randomUUID();
    assert.equal(redact(`id ${u}`), `id ${u}`);
  }
});

test('quoted values may contain the other quote character', () => {
  assert.equal(redact(`{"password": "it's secret"}`), `{"password": "${R}"}`);
  assert.equal(redact(`token = 'say "hi" now'`), `token = '${R}'`);
});

test('an unterminated quote masks the rest of the line', () => {
  assert.equal(redact('password = "abc def\nnext line'), `password = ${R}\nnext line`);
});

test('URL userinfo passwords are masked, scheme and user kept', () => {
  assert.equal(redact('postgres://admin:S3cretPass@db.example.com:5432/app'), `postgres://admin:${R}@db.example.com:5432/app`);
  assert.equal(redact('mongodb+srv://u:p4ssw0rd@cluster0.x.net'), `mongodb+srv://u:${R}@cluster0.x.net`);
  assert.equal(redact('see https://example.com/a/b and http://host:8080/x'), 'see https://example.com/a/b and http://host:8080/x');
});

test('GitLab personal access tokens are masked', () => {
  assert.equal(redact('use glpat-' + 'a1B2c3D4e5F6g7H8i9J0 here'), `use ${R} here`);
});

test('new patterns run in linear time', () => {
  for (const s of ['a'.repeat(200000), 'a://b:'.repeat(30000), 'password="'.repeat(20000), "key:'x ".repeat(30000), 'glpat-'.repeat(30000)]) {
    const t = performance.now();
    redact(s);
    assert.ok(performance.now() - t < 1000, `${s.slice(0, 12)} took ${performance.now() - t}ms`);
  }
});
