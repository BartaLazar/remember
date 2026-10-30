import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Resolve the project root (git toplevel, else cwd; both realpath'd) and its data dir. */
export function resolveProject(cwd) {
  let root;
  try {
    root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!root) throw new Error('empty');
  } catch {
    root = path.resolve(cwd);
  }
  try { root = fs.realpathSync(root); } catch { /* keep as is */ }
  return { root, dataDir: path.join(root, '.remember') };
}

/**
 * True for roots that must never be auto-indexed: any filesystem root, ~, ~/Desktop,
 * ~/Documents, ~/Downloads. `pathImpl` lets tests exercise path.win32.
 */
export function isBlockedRoot(root, home = os.homedir(), pathImpl = path) {
  const win = pathImpl.sep === '\\';
  const norm = (p) => {
    const r = pathImpl.resolve(p);
    return win ? r.toLowerCase() : r;
  };
  const r = pathImpl.resolve(root);
  if (pathImpl.parse(r).root === r) return true;
  const h = pathImpl.resolve(home);
  return [h, ...['Desktop', 'Documents', 'Downloads'].map((d) => pathImpl.join(h, d))]
    .some((b) => norm(b) === norm(r));
}

/** Create the data dir (mkdir -p) with a `.gitignore` of `*` if one is missing. */
export function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dataDir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

/** Claude Code's project-directory naming: every non-alphanumeric char becomes `-`. */
export function claudeSlug(p) {
  return p.replace(/[^A-Za-z0-9]/g, '-');
}

const CHUNK = 64 * 1024;
const SCAN_CAP = 1024 * 1024;

function cwdOfLine(line) {
  if (!line.includes('"cwd"')) return null;
  try {
    const rec = JSON.parse(line);
    return typeof rec?.cwd === 'string' ? rec.cwd : null;
  } catch { return null; }
}

/** First string `cwd` in a JSONL file, reading at most SCAN_CAP bytes in chunks. */
function fileCwd(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const buf = Buffer.alloc(CHUNK);
    let pending = Buffer.alloc(0);
    let scanned = 0;
    while (scanned < SCAN_CAP) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) break;
      scanned += n;
      pending = Buffer.concat([pending, buf.subarray(0, n)]);
      let nl;
      while ((nl = pending.indexOf(10)) !== -1) {
        const cwd = cwdOfLine(pending.subarray(0, nl).toString('utf8'));
        if (cwd !== null) return cwd;
        pending = pending.subarray(nl + 1);
      }
    }
    return cwdOfLine(pending.toString('utf8'));
  } catch { return null; } finally { fs.closeSync(fd); }
}

function firstCwd(files) {
  for (const f of files) {
    const cwd = fileCwd(f);
    if (cwd !== null) return cwd;
  }
  return null;
}

function isUnder(root, cwd) {
  const win = path.sep === '\\';
  let c = cwd;
  let r = root;
  if (win) {
    c = c.replace(/\//g, '\\').toLowerCase();
    r = r.toLowerCase();
  }
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Absolute .jsonl transcript paths belonging to `root` (or its subdirs). */
export function transcriptFiles(root, projectsDir = path.join(os.homedir(), '.claude', 'projects')) {
  const slug = claudeSlug(root);
  let dirs;
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    if (!d.isDirectory() || !d.name.startsWith(slug)) continue;
    const dir = path.join(projectsDir, d.name);
    let files;
    try {
      files = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(dir, n));
    } catch { continue; }
    let cwd = firstCwd(files);
    if (cwd === null) continue;
    try { cwd = fs.realpathSync(cwd); } catch { /* not on disk; use as recorded */ }
    if (isUnder(root, cwd)) out.push(...files);
  }
  return out;
}
