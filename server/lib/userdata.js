import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { ensureDataDir, isBlockedRoot } from './project.js';

const file = (dataDir, name) => path.join(dataDir, name);

/** Read all notes; malformed lines are skipped. */
export function readNotes(dataDir) {
  let text;
  try { text = fs.readFileSync(file(dataDir, 'notes.jsonl'), 'utf8'); } catch { return []; }
  const notes = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const n = JSON.parse(line);
      if (n && typeof n === 'object' && typeof n.id === 'string') notes.push(n);
    } catch { /* skip */ }
  }
  return notes;
}

/** Append a note and return it. */
export function appendNote(dataDir, { title, body, tags = [], supersedes }) {
  ensureDataDir(dataDir);
  const note = {
    id: `n-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    title, body, tags, createdAt: new Date().toISOString(),
  };
  if (supersedes) note.supersedes = supersedes;
  const notesFile = file(dataDir, 'notes.jsonl');
  let lead = '';
  try {
    const fd = fs.openSync(notesFile, 'r');
    try {
      const { size } = fs.fstatSync(fd);
      if (size > 0) {
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, size - 1);
        if (b[0] !== 10) lead = '\n';
      }
    } finally { fs.closeSync(fd); }
  } catch { /* no file yet */ }
  fs.appendFileSync(notesFile, lead + JSON.stringify(note) + '\n');
  return note;
}

/** Drop notes superseded by another note. */
export function activeNotes(notes) {
  const gone = new Set(notes.map((n) => n.supersedes).filter(Boolean));
  return notes.filter((n) => !gone.has(n.id));
}

/** Read exclusions ({patterns, sessions}). Missing file is empty; an unparseable file throws. */
export function readExclusions(dataDir) {
  let text;
  try { text = fs.readFileSync(file(dataDir, 'exclusions.json'), 'utf8'); } catch { return { patterns: [], sessions: [] }; }
  let j;
  try { j = JSON.parse(text); } catch (e) {
    throw new Error(`exclusions.json is unreadable (${e.message}); fix or delete ${file(dataDir, 'exclusions.json')} before continuing.`);
  }
  if (!j || typeof j !== 'object') throw new Error(`exclusions.json is unreadable (not an object); fix or delete ${file(dataDir, 'exclusions.json')}.`);
  return {
    patterns: Array.isArray(j.patterns) ? j.patterns.filter((x) => typeof x === 'string') : [],
    sessions: Array.isArray(j.sessions) ? j.sessions.filter((x) => typeof x === 'string') : [],
  };
}

function writeExclusions(dataDir, ex) {
  ensureDataDir(dataDir);
  atomicWrite(file(dataDir, 'exclusions.json'), JSON.stringify(ex, null, 2) + '\n');
}

const SESSION = 'session:';

/** Normalize a forget target: `\\` becomes `/`, leading `./` is dropped; `session:<id>` is untouched. */
export function normalizeTarget(t) {
  t = String(t ?? '').trim();
  if (t.startsWith(SESSION)) return t;
  t = t.replace(/\\/g, '/');
  while (t.startsWith('./')) t = t.slice(2);
  return t;
}
const split = (t) => {
  t = normalizeTarget(t);
  return t.startsWith(SESSION) ? ['sessions', t.slice(SESSION.length).trim()] : ['patterns', t];
};

/** Add an exclusion pattern or `session:<id>`; no duplicates. */
export function addExclusion(dataDir, target) {
  const ex = readExclusions(dataDir);
  const [key, v] = split(target);
  if (!v || ex[key].includes(v)) return;
  ex[key].push(v);
  writeExclusions(dataDir, ex);
}

/** Remove an exclusion pattern or `session:<id>`. */
export function removeExclusion(dataDir, target) {
  const ex = readExclusions(dataDir);
  const [key, v] = split(target);
  if (!ex[key].includes(v)) return;
  ex[key] = ex[key].filter((x) => x !== v);
  writeExclusions(dataDir, ex);
}

export function isOff(dataDir) {
  return fs.existsSync(file(dataDir, 'off'));
}

export function setOff(dataDir, off) {
  if (off) {
    ensureDataDir(dataDir);
    fs.writeFileSync(file(dataDir, 'off'), '');
  } else {
    fs.rmSync(file(dataDir, 'off'), { force: true });
  }
}

/** Mark a blocked (too broad) root as explicitly allowed by the user. */
export function setOverride(dataDir) {
  ensureDataDir(dataDir);
  fs.writeFileSync(file(dataDir, 'override'), '');
}

export function hasOverride(dataDir) {
  return fs.existsSync(file(dataDir, 'override'));
}

/** True for a too-broad root the user has not explicitly overridden. */
export function isBlocked(root, dataDir) {
  return isBlockedRoot(root) && !hasOverride(dataDir);
}

/** Read status.json, or null if missing/invalid. */
export function readStatus(dataDir) {
  try { return JSON.parse(fs.readFileSync(file(dataDir, 'status.json'), 'utf8')); } catch { return null; }
}

/** Write a file atomically (temp + rename; retries on Windows EPERM). */
function atomicWrite(target, data) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, target); return; } catch { /* retry */ }
    const end = Date.now() + 10 * (i + 1);
    while (Date.now() < end) { /* brief spin */ }
  }
  try { fs.writeFileSync(target, data); } finally { fs.rmSync(tmp, { force: true }); }
}

/** Write status.json atomically. */
export function writeStatus(dataDir, s) {
  ensureDataDir(dataDir);
  atomicWrite(file(dataDir, 'status.json'), JSON.stringify(s));
}

const DEFAULT_CONFIG = { maxFiles: 5000 };
const validMax = (n) => Number.isInteger(n) && n >= 0;

/** Directory for user-level config. */
export function getConfigDir() {
  return process.env.REMEMBER_CONFIG_DIR
    || process.env.CLAUDE_PLUGIN_DATA
    || path.join(os.homedir(), '.claude', 'remember');
}

/** Read config; missing/corrupt/invalid values fall back to defaults. */
export function readConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(getConfigDir(), 'config.json'), 'utf8'));
    return { maxFiles: validMax(j?.maxFiles) ? j.maxFiles : DEFAULT_CONFIG.maxFiles };
  } catch { return { ...DEFAULT_CONFIG }; }
}

/** Merge a validated patch into config and persist it. */
export function writeConfig(patch = {}) {
  if ('maxFiles' in patch && !validMax(patch.maxFiles)) {
    throw new Error('maxFiles must be a non-negative integer');
  }
  const next = { ...readConfig(), ...(('maxFiles' in patch) ? { maxFiles: patch.maxFiles } : {}) };
  atomicWrite(path.join(getConfigDir(), 'config.json'), JSON.stringify(next, null, 2) + '\n');
  return next;
}
