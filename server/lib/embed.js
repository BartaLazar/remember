import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importDep } from './deps.js';

export const MODEL_ID = 'Xenova/multilingual-e5-small';
export const DIMS = 384;
export const QUERY_PREFIX = 'query: ';
export const PASSAGE_PREFIX = 'passage: ';
const MARKER = '.multilingual-e5-small.complete';
const BATCH = 32;

export function getModelsDir() {
  if (process.env.REMEMBER_MODELS_DIR) return process.env.REMEMBER_MODELS_DIR;
  if (process.env.CLAUDE_PLUGIN_DATA) return path.join(process.env.CLAUDE_PLUGIN_DATA, 'models');
  return path.join(os.homedir(), '.claude', 'remember', 'models');
}

export function modelIsPresent(modelsDir = getModelsDir()) {
  return fs.existsSync(path.join(modelsDir, MARKER));
}

export async function createEmbedder({ modelsDir = getModelsDir(), allowDownload = false } = {}) {
  if (!allowDownload && !modelIsPresent(modelsDir)) {
    throw new Error(`embedding model not present in ${modelsDir}`);
  }
  const mod = await importDep('@huggingface/transformers');
  const { pipeline, env } = mod.pipeline ? mod : mod.default;
  env.cacheDir = modelsDir;
  env.allowRemoteModels = allowDownload;
  env.allowLocalModels = true;
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
  if (!modelIsPresent(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(path.join(modelsDir, MARKER), new Date().toISOString());
  }

  async function run(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const t = await extractor(batch, { pooling: 'mean', normalize: true });
      const data = t.data;
      for (let j = 0; j < batch.length; j++) out.push(Float32Array.from(data.subarray(j * DIMS, (j + 1) * DIMS)));
    }
    return out;
  }
  return {
    embedDocuments: (texts) => run(texts.map((x) => PASSAGE_PREFIX + x)),
    async embedQuery(text) {
      return (await run([QUERY_PREFIX + text]))[0];
    },
    /** Release the ONNX session; exiting with it live aborts the process on some platforms. */
    async dispose() { try { await extractor.dispose?.(); } catch { /* ignore */ } },
  };
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (const ch of s) {
    for (const b of Buffer.from(ch, 'utf8')) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h;
}

function fakeVector(text) {
  const v = new Float32Array(DIMS);
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) v[fnv1a(m[0]) % DIMS] += 1;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < DIMS; i++) v[i] /= n;
  return v;
}

export function createFakeEmbedder() {
  return {
    embedDocuments: async (texts) => texts.map(fakeVector),
    embedQuery: async (text) => fakeVector(text),
  };
}
