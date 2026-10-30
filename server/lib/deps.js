import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REQUIRED = ['@huggingface/transformers', '@modelcontextprotocol/sdk/server/mcp.js', 'zod', 'ignore', 'onnxruntime-node'];
const MARKER_MAX_AGE_MS = 10 * 60 * 1000;
const PLUGIN_REQUIRE = createRequire(fileURLToPath(import.meta.url));

const dataDir = () => process.env.CLAUDE_PLUGIN_DATA || null;
const dataRequire = (dir) => createRequire(path.join(dir, 'package.json'));

function canResolve(req, name) {
  try { req.resolve(name); return true; } catch { return false; }
}

/** True when every direct dependency (and onnxruntime-node) resolves from the plugin root or the data dir. */
export function depsAvailable(required = REQUIRED) {
  const dir = dataDir();
  return required.every((name) => canResolve(PLUGIN_REQUIRE, name) || (!!dir && canResolve(dataRequire(dir), name)));
}

/** Import a third-party package: plugin root first, then `${CLAUDE_PLUGIN_DATA}/node_modules`. */
export async function importDep(name) {
  try {
    return await import(name);
  } catch (e) {
    const dir = dataDir();
    if (!dir) throw e;
    let resolved;
    try { resolved = dataRequire(dir).resolve(name); } catch { throw e; }
    return import(pathToFileURL(resolved).href);
  }
}

/**
 * Copy manifests to the data dir and run `npm ci` there, detached, logging to install.log.
 * Returns true when an install is running or was recently started; false when it cannot be done.
 */
export function installDepsInBackground(pluginRoot, dir = dataDir()) {
  if (!dir) return false;
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'install.log');
  const marker = path.join(dir, '.installing');
  try {
    if (Date.now() - fs.statSync(marker).mtimeMs < MARKER_MAX_AGE_MS) return true;
  } catch { /* no marker */ }
  try {
    for (const f of ['package.json', 'package-lock.json']) {
      fs.copyFileSync(path.join(pluginRoot, f), path.join(dir, f));
    }
  } catch (e) {
    try { fs.appendFileSync(log, `${new Date().toISOString()} cannot install: ${e.message}\n`); } catch { /* ignore */ }
    return false;
  }
  fs.writeFileSync(marker, new Date().toISOString());
  let fd = 'ignore';
  try { fd = fs.openSync(log, 'a'); } catch { /* ignore */ }
  const child = spawn('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: dir, detached: true, stdio: ['ignore', fd, fd], windowsHide: true, shell: process.platform === 'win32',
  });
  child.on('error', () => {});
  child.unref();
  if (fd !== 'ignore') try { fs.closeSync(fd); } catch { /* ignore */ }
  return true;
}
