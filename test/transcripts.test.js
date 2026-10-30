import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTranscript } from '../server/lib/transcripts.js';

const fixture = readFileSync(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8');

test('parses the fixture into two exchanges', () => {
  const r = parseTranscript(fixture);
  assert.equal(r.sessionId, 'sess-1111');
  assert.equal(r.cwd, '/work/demo');
  assert.equal(r.exchanges.length, 2);
  assert.deepEqual(r.exchanges.map((e) => e.index), [0, 1]);
  assert.equal(r.exchanges[0].timestamp, '2026-01-01T10:00:00.000Z');
  assert.equal(
    r.exchanges[0].text,
    'User: How do I add pagination to the orders list?\n\nClaude: Use a cursor based approach.\n\nAdd a limit and an after parameter.',
  );
  assert.equal(r.exchanges[1].text, 'User: Now write the tests for it.\n\nClaude: Here are the tests, using node:test.');
  const all = r.exchanges.map((e) => e.text).join('\n');
  for (const bad of ['PRIVATE-THINKING', 'TOOL-OUTPUT', 'REMINDER-BODY', 'system-reminder', 'META-CAVEAT']) {
    assert.ok(!all.includes(bad), bad);
  }
});

test('skips truncated and non-JSON lines without throwing', () => {
  const r = parseTranscript(fixture + '{"type":"user","mess\nnot json');
  assert.equal(r.exchanges.length, 2);
});

test('handles CRLF line endings', () => {
  const r = parseTranscript(fixture.replace(/\n/g, '\r\n'));
  assert.equal(r.exchanges.length, 2);
  assert.equal(r.sessionId, 'sess-1111');
});

test('redacts secrets in exchange text', () => {
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'my key is ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4' } });
  const r = parseTranscript(line);
  assert.equal(r.exchanges[0].text, 'User: my key is [REDACTED]');
});

test('empty input gives no exchanges', () => {
  assert.deepEqual(parseTranscript(''), { sessionId: null, sessionIds: [], cwd: null, exchanges: [] });
});
