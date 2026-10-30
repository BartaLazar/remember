import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { importDep } from './deps.js';

export const MAX_FILE_BYTES = 1_048_576;

const DEFAULT_IGNORED_DIRS = new Set([
  '.git', 'node_modules', '.remember', 'dist', 'build', '.next', 'target', '__pycache__', '.venv',
]);
const SECRET_RES = [
  /^\.env/, /\.pem$/, /\.key$/, /\.p12$/, /\.pfx$/, /^id_rsa/, /^id_ed25519/, /\.keystore$/,
  /^credentials.*\.json$/, /^credentials$/, /^id_ecdsa/, /^id_dsa/, /^\.npmrc$/, /^\.netrc$/,
  /^\.git-credentials$/, /^\.pgpass$/, /\.jks$/, /\.kdbx$/, /\.tfstate$/, /\.tfvars$/,
];

/** True for files that commonly hold secrets (matched on the basename, case-insensitive). */
export function isSecretPath(rel) {
  const base = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  return SECRET_RES.some((re) => re.test(base));
}

/** True when a NUL byte appears in the first 8,000 bytes. */
export function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

const toAbs = (root, rel) => path.join(root, ...rel.split('/'));

function gitFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 512 * 1024 * 1024,
    });
    return [...new Set(out.split('\0').filter(Boolean))];
  } catch {
    return null;
  }
}

/** Walk without git; `accept(rel)` returns an entry (counted toward limit) or null. */
async function walkFiles(root, limit, accept) {
  const ignore = (await importDep('ignore')).default;
  let ig = null;
  try { ig = ignore().add(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')); } catch { /* none */ }
  const out = [];
  const visit = (relDir) => {
    let entries;
    try { entries = fs.readdirSync(toAbs(root, relDir) || root, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (limit != null && out.length >= limit) return;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(e.name)) continue;
        if (ig && ig.ignores(`${rel}/`)) continue;
        visit(rel);
      } else if (e.isFile() || e.isSymbolicLink()) {
        if (ig && ig.ignores(rel)) continue;
        const entry = accept(rel); // symlinks: accept's statSync keeps only those pointing at files
        if (entry) out.push(entry);
      }
    }
  };
  visit('');
  return out;
}

/** Indexable files under root: gitignore-aware, minus defaults, secrets, big files and user exclusions. */
export async function listIndexableFiles(root, { patterns = [] } = {}, { limit } = {}) {
  const excl = patterns.length ? (await importDep('ignore')).default().add(patterns) : null;
  const accept = (rel) => {
    if (rel.split('/').some((seg) => DEFAULT_IGNORED_DIRS.has(seg))) return null;
    if (isSecretPath(rel)) return null;
    if (excl && excl.ignores(rel)) return null;
    const abs = toAbs(root, rel);
    let st;
    try { st = fs.statSync(abs); } catch { return null; }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return { rel, abs, size: st.size, mtimeMs: st.mtimeMs };
  };
  const candidates = gitFiles(root);
  if (!candidates) return walkFiles(root, limit, accept);
  const out = [];
  for (const rel of candidates) {
    if (limit != null && out.length >= limit) break;
    const entry = accept(rel);
    if (entry) out.push(entry);
  }
  return out;
}
