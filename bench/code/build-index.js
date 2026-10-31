// Build (or reuse) a real remember index per corpus repo; writes bench/results/code-index.json.
import fs from 'node:fs';
import path from 'node:path';
process.env.REMEMBER_CONFIG_DIR = path.join(process.env.TMPDIR || '/tmp', 'remember-bench-cfg');
import { runIndex } from '../../server/lib/indexer.js';
import { openStore } from '../../server/lib/store.js';
import { createEmbedder } from '../../server/lib/embed.js';
import { REPOS, root, INDEX, MODELS } from './common.js';

const out = path.resolve(import.meta.dirname, '../results/code-index.json');
const info = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
const embedder = await createEmbedder({ modelsDir: MODELS, allowDownload: false });
for (const r of REPOS) {
  const dataDir = path.join(INDEX, r);
  if (info[r] && fs.existsSync(path.join(dataDir, 'index.db'))) { console.log('cached', r); continue; }
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  const projectsDir = path.join(INDEX, '_empty'); fs.mkdirSync(projectsDir, { recursive: true });
  const store = openStore(path.join(dataDir, 'index.db'));
  const t0 = Date.now();
  await runIndex({ root: root(r), dataDir, store, embedder, force: true, projectsDir });
  const ms = Date.now() - t0;
  const chunks = store.counts().chunks;
  info[r] = { files: store.counts().file, chunks, buildSeconds: +(ms / 1000).toFixed(1) };
  console.log(r, info[r]);
  store.close?.();
  fs.writeFileSync(out, JSON.stringify(info, null, 1));
}
await embedder.dispose();
