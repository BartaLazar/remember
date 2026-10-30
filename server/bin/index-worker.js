#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { resolveProject, ensureDataDir } from '../lib/project.js';
import { openStore } from '../lib/store.js';
import { runIndex } from '../lib/indexer.js';
import { createEmbedder, createFakeEmbedder, modelIsPresent } from '../lib/embed.js';
import { acquireLock, releaseLock, startHeartbeat, queueRequest, drainRequests, hasPending } from '../lib/lock.js';

const LOG_CAP = 256 * 1024;

function log(dataDir, msg) {
  try {
    const f = path.join(dataDir, 'worker.log');
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`);
    if (fs.statSync(f).size > LOG_CAP) {
      const buf = fs.readFileSync(f);
      fs.writeFileSync(f, buf.subarray(buf.length >> 1));
    }
  } catch { /* logging must never throw */ }
}

/** Merge requests: any full (or path-less) request wins; else union of paths. */
function merge(reqs) {
  const force = reqs.some((r) => r.force);
  if (reqs.some((r) => r.full || !Array.isArray(r.paths))) return { paths: undefined, force };
  return { paths: [...new Set(reqs.flatMap((r) => r.paths))], force };
}

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' }, paths: { type: 'string' },
      full: { type: 'boolean' }, force: { type: 'boolean' },
    },
    strict: false,
  });
  if (!values.root) return;
  const { root, dataDir } = resolveProject(values.root);
  ensureDataDir(dataDir);

  let paths;
  if (values.paths) {
    try {
      const p = JSON.parse(values.paths);
      if (Array.isArray(p) && p.every((x) => typeof x === 'string')) paths = p;
    } catch { /* treat as full run */ }
  }
  const first = { paths: values.full ? undefined : paths, full: !paths || !!values.full, force: !!values.force };

  if (!acquireLock(dataDir)) {
    queueRequest(dataDir, first);
    // The holder may have finished between our failed acquire and the enqueue.
    if (!acquireLock(dataDir)) return;
  }

  let store; let held = true; let embedder = null;
  let stopBeat = startHeartbeat(dataDir);
  try {
    try {
      embedder = process.env.REMEMBER_FAKE_EMBEDDER === '1'
        ? createFakeEmbedder()
        : await createEmbedder({ allowDownload: !modelIsPresent() });
    } catch (e) { log(dataDir, `embedder unavailable: ${e?.stack ?? e}`); }
    store = openStore(path.join(dataDir, 'index.db'));

    let batch = drainRequests(dataDir);
    if (!batch.length) batch = [first];
    else if (!batch.includes(first)) batch.push(first);
    for (;;) {
      const { paths: ps, force } = merge(batch);
      try { await runIndex({ root, dataDir, store, embedder, paths: ps, force }); }
      catch (e) { log(dataDir, `index failed: ${e?.stack ?? e}`); }
      batch = drainRequests(dataDir);
      if (batch.length) continue;
      // Nothing left: release, then re-check once for a request queued meanwhile.
      releaseLock(dataDir); held = false;
      if (!hasPending(dataDir) || !acquireLock(dataDir)) break;
      held = true;
      batch = drainRequests(dataDir);
      if (!batch.length) break;
    }
  } finally {
    stopBeat();
    try { store?.close(); } catch { /* ignore */ }
    try { await embedder?.dispose?.(); } catch { /* ignore */ }
    if (held) releaseLock(dataDir);
  }
}

main().catch((e) => {
  try {
    const { dataDir } = resolveProject(process.argv[process.argv.indexOf('--root') + 1] ?? '.');
    log(dataDir, `worker failed: ${e?.stack ?? e}`);
  } catch { /* ignore */ }
}).finally(() => {
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 5000).unref(); // safety net if a handle keeps the loop alive
});
