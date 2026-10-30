import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, splitLong } from '../server/lib/chunk.js';

const lineCount = (t) => t.split('\n').length;

test('chunkText packs a 200-line JS file into 40-80 line windows with 5 lines overlap', () => {
  const lines = [];
  for (let i = 1; i <= 200; i++) lines.push(i % 7 === 0 ? '' : `const v${i} = ${i};`);
  const chunks = chunkText('src/a.js', lines.join('\n'));
  assert.ok(chunks.length > 1);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.at(-1).endLine, 200);
  chunks.forEach((c, i) => {
    const n = c.endLine - c.startLine + 1;
    if (i < chunks.length - 1) assert.ok(n >= 40 && n <= 80, `chunk ${i} has ${n} lines`);
    else assert.ok(n <= 80);
    assert.equal(c.text, lines.slice(c.startLine - 1, c.endLine).join('\n'));
    if (i > 0) {
      assert.ok(c.startLine <= chunks[i - 1].endLine, 'overlaps');
      assert.equal(chunks[i - 1].endLine - c.startLine + 1, 5);
    }
  });
});

test('chunkText splits markdown at headings', () => {
  const md = '## One\nalpha\nbeta\n\n## Two\ngamma\n\n## Three\ndelta\n';
  const chunks = chunkText('README.md', md);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.startLine), [1, 5, 8]);
  assert.ok(chunks[0].text.startsWith('## One'));
  assert.ok(chunks[1].text.startsWith('## Two'));
  assert.ok(chunks[2].text.startsWith('## Three'));
  assert.equal(chunks[2].endLine, 9);
});

test('chunkText ignores # lines inside markdown code fences', () => {
  const md = '## A\n```sh\n# not a heading\n```\n## B\nx\n';
  assert.equal(chunkText('a.md', md).length, 2);
});

test('chunkText packs plain text paragraphs up to 80 lines', () => {
  const paras = [];
  for (let p = 0; p < 10; p++) paras.push(Array.from({ length: 30 }, (_, i) => `p${p} l${i}`).join('\n'));
  const chunks = chunkText('notes.txt', paras.join('\n\n'));
  for (const c of chunks) assert.ok(c.endLine - c.startLine + 1 <= 80);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.at(-1).endLine, 10 * 30 + 9);
});

test('chunkText handles CRLF and strips carriage returns', () => {
  const chunks = chunkText('a.txt', 'one\r\ntwo\r\n\r\nthree\r\n');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text.includes('\r'), false);
  assert.equal(chunks[0].endLine, 4);
  const md = chunkText('a.md', '# A\r\nx\r\n# B\r\ny\r\n');
  assert.deepEqual(md.map((c) => c.startLine), [1, 3]);
  assert.equal(md.some((c) => c.text.includes('\r')), false);
});

test('chunkText returns [] for empty or blank text', () => {
  assert.deepEqual(chunkText('a.js', ''), []);
  assert.deepEqual(chunkText('a.js', '\n\n  \n'), []);
});

test('a single 900,000-char line yields chunks <= 2000 chars, all on line 1', () => {
  const chunks = chunkText('min.js', 'x'.repeat(900_000));
  assert.ok(chunks.length >= 450);
  for (const c of chunks) {
    assert.ok(c.text.length <= 2000);
    assert.equal(c.startLine, 1);
    assert.equal(c.endLine, 1);
  }
});

test('splitLong respects max and keeps all content', () => {
  assert.deepEqual(splitLong('abc'), ['abc']);
  const parts = splitLong('a'.repeat(5000), 2000);
  assert.deepEqual(parts.map((p) => p.length), [2000, 2000, 1000]);
  assert.equal(lineCount(parts.join('')), 1);
});
