// Shared paths/config for the code-search simulation.
import os from 'node:os';
import path from 'node:path';
export const SCRATCH = process.env.BENCH_DIR || path.join(os.tmpdir(), 'remember-bench');
export const CORPORA = path.join(SCRATCH, 'corpora');
export const INDEX = path.join(SCRATCH, 'index');
export const MODELS = process.env.REMEMBER_MODELS_DIR || path.join(os.homedir(), '.claude', 'remember', 'models');
export const REPOS = ['express', 'flask', 'gin', 'ripgrep', 'remember'];
export const root = (r) => path.join(CORPORA, r);
