import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProject } from '../lib/project.js';
import { isOff, isBlocked, readStatus, writeStatus, readConfig } from '../lib/userdata.js';
import { modelIsPresent } from '../lib/embed.js';
import { spawnWorker } from '../lib/spawn.js';
import { depsAvailable, installDepsInBackground } from '../lib/deps.js';

const PLUGIN_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const out = (additionalContext) => ({
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }),
});
const none = { stdout: '' };

function nodeTooOld(version) {
  const [maj, min] = version.split('.').map(Number);
  return maj < 22 || (maj === 22 && min < 13);
}

/** Exported for tests. Returns what to print to stdout. */
export async function handleHook(event, input = {}, deps = {}) {
  const d = {
    spawnWorker, pluginRoot: PLUGIN_ROOT, depsAvailable, installDeps: installDepsInBackground,
    nodeVersion: process.versions.node, listIndexableFiles: null, ...deps,
  };
  const cwd = input.cwd || process.cwd();
  const { root, dataDir } = resolveProject(cwd);

  if (event === 'session-start') {
    if (nodeTooOld(d.nodeVersion)) {
      return out(`remember plugin needs Node.js 22.13 or newer (found ${d.nodeVersion}); tell the user.`);
    }
    if (!d.depsAvailable()) {
      if (!d.installDeps(d.pluginRoot)) {
        return out(`remember plugin: its dependencies are missing; ask the user to run "npm ci --omit=dev" in ${d.pluginRoot}.`);
      }
      return out('remember plugin: installing its dependencies in the background; the knowledge base will be available next session.');
    }
    if (isOff(dataDir)) return none;
    if (isBlocked(root, dataDir)) {
      return out('remember: this folder is too broad to index automatically. If the user wants it indexed, use the index skill.');
    }
    const status = readStatus(dataDir);
    if (!status || status.phase === 'needs-confirmation') {
      const { maxFiles } = readConfig();
      if (maxFiles > 0) {
        const list = d.listIndexableFiles ?? (await import('../lib/files.js')).listIndexableFiles;
        const files = await list(root, {}, { limit: maxFiles + 1 });
        if (files.length > maxFiles) {
          const message = `More than ${maxFiles} files; waiting for the user to confirm indexing.`;
          writeStatus(dataDir, { phase: 'needs-confirmation', done: 0, total: files.length, updatedAt: Date.now(), message });
          return out(`remember: this project has more than ${maxFiles} files (the user's threshold). Ask the user which they want: (1) index everything now — use the index skill; (2) skip this project — use the forget skill to turn remember off here; (3) change the threshold — use the index skill's configure step.`);
        }
      }
    }
    d.spawnWorker(root, []);
    let msg = 'This project has a local knowledge base (remember plugin). Before reading or grepping files to find where something is, how it works, or what was decided in earlier sessions, use the recall skill, then read only the lines it points to.';
    if (!modelIsPresent()) msg += ' The search model is downloading for the first time; results are keyword-only until it finishes.';
    return out(msg);
  }

  if (isOff(dataDir) || isBlocked(root, dataDir)) return none;

  if (event === 'post-tool-use') {
    const p = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!p || typeof p !== 'string') return none;
    let abs = path.resolve(cwd, p);
    let realRoot = root;
    try { abs = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs)); } catch { /* keep */ }
    try { realRoot = fs.realpathSync.native(root); } catch { /* keep */ }
    const rel = path.relative(realRoot, abs);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return none;
    const relPosix = rel.split(path.sep).join('/');
    if (relPosix === '.remember' || relPosix.startsWith('.remember/')) return none;
    d.spawnWorker(root, ['--paths', JSON.stringify([relPosix])]);
    return none;
  }

  if (event === 'post-bash') {
    // Shell commands can change files the edit hook never sees (sed, codegen, git checkout): rescan files.
    d.spawnWorker(root, ['--only', 'files']);
    return none;
  }

  if (event === 'pre-compact') {
    // Index the conversation before compaction summarizes it, so its details stay searchable.
    d.spawnWorker(root, ['--only', 'chats']);
    return none;
  }

  if (event === 'session-end') {
    d.spawnWorker(root, []);
    return none;
  }
  return none;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  try {
    const event = process.argv[2];
    const input = JSON.parse(await readStdin());
    const { stdout } = await handleHook(event, input);
    if (stdout) process.stdout.write(stdout);
  } catch (e) {
    process.stderr.write(`remember hook: ${e?.stack ?? e}\n`);
  }
  process.exitCode = 0;
}

if (process.argv[1] && fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(fileURLToPath(import.meta.url))) main();
