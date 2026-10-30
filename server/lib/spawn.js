import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('../bin/index-worker.js', import.meta.url));

/** Start a detached, low-priority index worker. Never throws on priority failure. */
export function spawnWorker(root, args = []) {
  // Test hook: record the request instead of spawning.
  if (process.env.REMEMBER_SPAWN_LOG) {
    try { fs.appendFileSync(process.env.REMEMBER_SPAWN_LOG, JSON.stringify({ root, args }) + '\n'); } catch { /* ignore */ }
    return;
  }
  const child = spawn(process.execPath, [WORKER, '--root', root, ...args], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.on('error', () => {});
  try { os.setPriority(child.pid, 10); } catch { /* best effort */ }
  child.unref();
}
