import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readNotes, appendNote, activeNotes, readExclusions, addExclusion, removeExclusion,
  isOff, setOff, readStatus, writeStatus, readConfig, writeConfig, getConfigDir,
} from '../server/lib/userdata.js';

const tmp = () => path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'remember-ud-'))), '.remember');

test('missing files give empty defaults', () => {
  const d = tmp();
  assert.deepEqual(readNotes(d), []);
  assert.deepEqual(readExclusions(d), { patterns: [], sessions: [] });
  assert.equal(isOff(d), false);
  assert.equal(readStatus(d), null);
});

test('appendNote assigns id and createdAt; superseded notes are dropped', () => {
  const d = tmp();
  const a = appendNote(d, { title: 'A', body: 'one', tags: ['x'] });
  assert.match(a.id, /^n-[0-9a-z]+-[0-9a-f]{4}$/);
  assert.deepEqual(a.tags, ['x']);
  const b = appendNote(d, { title: 'B', body: 'two', supersedes: a.id });
  const notes = readNotes(d);
  assert.equal(notes.length, 2);
  assert.deepEqual(activeNotes(notes).map((n) => n.id), [b.id]);
});

test('garbage lines in notes.jsonl are skipped', () => {
  const d = tmp();
  appendNote(d, { title: 'A', body: 'one' });
  fs.appendFileSync(path.join(d, 'notes.jsonl'), 'not json\n{"x":\n');
  appendNote(d, { title: 'B', body: 'two' });
  assert.equal(readNotes(d).length, 2);
});

test('exclusions: sessions vs patterns, no duplicates, removable', () => {
  const d = tmp();
  addExclusion(d, 'session:abc');
  addExclusion(d, 'session:abc');
  addExclusion(d, 'docs/**');
  addExclusion(d, 'docs/**');
  assert.deepEqual(readExclusions(d), { patterns: ['docs/**'], sessions: ['abc'] });
  removeExclusion(d, 'session:abc');
  removeExclusion(d, 'docs/**');
  assert.deepEqual(readExclusions(d), { patterns: [], sessions: [] });
});

test('off flag', () => {
  const d = tmp();
  setOff(d, true);
  assert.equal(isOff(d), true);
  setOff(d, false);
  assert.equal(isOff(d), false);
  setOff(d, false);
});

test('status round-trips and leaves no temp files', () => {
  const d = tmp();
  const s = { phase: 'building', done: 3, total: 10, updatedAt: new Date().toISOString(), message: 'hi' };
  writeStatus(d, s);
  writeStatus(d, s);
  assert.deepEqual(readStatus(d), s);
  assert.deepEqual(fs.readdirSync(d).sort(), ['.gitignore', 'status.json']);
});

test('config defaults to 5000, round-trips 0, rejects bad values, survives corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remember-cfg-'));
  process.env.REMEMBER_CONFIG_DIR = dir;
  assert.equal(getConfigDir(), dir);
  assert.deepEqual(readConfig(), { maxFiles: 5000 });
  assert.deepEqual(writeConfig({ maxFiles: 0 }), { maxFiles: 0 });
  assert.equal(readConfig().maxFiles, 0);
  for (const bad of [-1, 1.5, '3', NaN, null]) assert.throws(() => writeConfig({ maxFiles: bad }));
  assert.equal(readConfig().maxFiles, 0);
  fs.writeFileSync(path.join(dir, 'config.json'), '{not json');
  assert.deepEqual(readConfig(), { maxFiles: 5000 });
  fs.writeFileSync(path.join(dir, 'config.json'), '{"maxFiles":-4}');
  assert.deepEqual(readConfig(), { maxFiles: 5000 });
});

test('every writer leaves a .gitignore in the data dir', () => {
  const writers = [
    (d) => writeStatus(d, { phase: 'idle' }),
    (d) => appendNote(d, { title: 't', body: 'b' }),
    (d) => addExclusion(d, 'x/**'),
    (d) => setOff(d, true),
  ];
  for (const w of writers) {
    const d = tmp();
    w(d);
    assert.equal(fs.readFileSync(path.join(d, '.gitignore'), 'utf8'), '*\n');
  }
});

test('corrupt exclusions.json: add/remove throw and the file is left alone', () => {
  const d = tmp();
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'exclusions.json'), '{not json');
  assert.throws(() => readExclusions(d), /exclusions\.json/);
  assert.throws(() => addExclusion(d, 'a/**'), /exclusions\.json/);
  assert.throws(() => removeExclusion(d, 'a/**'), /exclusions\.json/);
  assert.equal(fs.readFileSync(path.join(d, 'exclusions.json'), 'utf8'), '{not json');
});

test('exclusions are written atomically (no temp files left)', () => {
  const d = tmp();
  addExclusion(d, 'a/**');
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith('.tmp')), []);
});

test('appendNote starts a new line when the file lacks a trailing newline', () => {
  const d = tmp();
  fs.mkdirSync(d, { recursive: true });
  const first = { id: 'n-1', title: 'a', body: 'b', tags: [], createdAt: 'x' };
  fs.writeFileSync(path.join(d, 'notes.jsonl'), JSON.stringify(first));
  appendNote(d, { title: 'second', body: 'b2' });
  const notes = readNotes(d);
  assert.deepEqual(notes.map((n) => n.title), ['a', 'second']);
});
