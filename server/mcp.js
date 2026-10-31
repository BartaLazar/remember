import fs from 'node:fs';
import path from 'node:path';
import { importDep } from './lib/deps.js';
import { resolveProject, ensureDataDir } from './lib/project.js';
import { openStore } from './lib/store.js';
import { createEmbedder, createFakeEmbedder, modelIsPresent } from './lib/embed.js';
import { search, formatResults } from './lib/search.js';
import { purgeExcluded } from './lib/indexer.js';
import { spawnWorker } from './lib/spawn.js';
import {
  appendNote, readNotes, readExclusions, addExclusion, removeExclusion, normalizeTarget, isOff, setOff, isBlocked, setOverride,
  readStatus, readConfig, writeConfig,
} from './lib/userdata.js';

const { McpServer } = await importDep('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = await importDep('@modelcontextprotocol/sdk/server/stdio.js');
const z = (await importDep('zod')).z ?? (await importDep('zod'));

const { root, dataDir } = resolveProject(
  process.env.REMEMBER_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
);
const dbPath = path.join(dataDir, 'index.db');
// Off wins; a blocked (too broad) root is active only once the user forced a reindex (override file).
const inactive = () => (isOff(dataDir) ? 'off' : isBlocked(root, dataDir) ? 'blocked' : null);
const inactiveLine = (why) => (why === 'blocked'
  ? 'remember is not active here: this folder is too broad to index.'
  : 'remember is turned off for this project.');
/** Spawn the worker unless the project is blocked or off. */
const spawnIfActive = (args = []) => { if (!inactive()) spawnWorker(root, args); };
const log = (...a) => console.error('[remember]', ...a);

let embedder = null;
async function getEmbedder() {
  if (embedder) return embedder;
  try {
    embedder = process.env.REMEMBER_FAKE_EMBEDDER === '1'
      ? createFakeEmbedder()
      : await createEmbedder({ allowDownload: false });
  } catch (e) {
    log('embedder unavailable:', e.message);
    embedder = null;
  }
  return embedder;
}

async function withStore(fn) {
  ensureDataDir(dataDir);
  const store = openStore(dbPath);
  try { return await fn(store); } finally { try { store.close(); } catch { /* ignore */ } }
}

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e?.message ?? e}` }], isError: true });
const tool = (fn) => async (args) => { try { return text(await fn(args ?? {})); } catch (e) { log(e); return fail(e); } };

const server = new McpServer({ name: 'remember', version: '0.1.0' });

server.registerTool('search', {
  description: "Search this project's local knowledge base (files, past chats, decision notes). Use before reading or grepping files; returns file:line pointers.",
  inputSchema: {
    query: z.string().describe('What to look for, in natural language or keywords'),
    translation: z.string().optional().describe("The same query in the language of the project's code and comments (usually English). Pass it whenever the user asked in another language."),
    scope: z.enum(['all', 'files', 'chats', 'notes']).optional(),
    limit: z.number().int().min(1).max(20).optional().describe('Max results (default 8)'),
  },
}, tool(async ({ query, translation, scope, limit }) => {
  const why = inactive();
  if (why) return inactiveLine(why);
  const emb = await getEmbedder();
  return withStore(async (store) => {
    const results = await search({ store, embedder: emb, root, query, translation, scope, limit });
    return formatResults(results, { status: readStatus(dataDir), semantic: !!emb });
  });
}));

server.registerTool('save_note', {
  description: 'Save a decision or lesson to this project\'s knowledge base so future sessions can find it. Use `supersedes` with an older note id to replace it.',
  inputSchema: {
    title: z.string().min(1), body: z.string().min(1),
    tags: z.array(z.string()).optional(), supersedes: z.string().optional(),
  },
}, tool(async ({ title, body, tags, supersedes }) => {
  if (supersedes && !readNotes(dataDir).some((n) => n.id === supersedes)) {
    throw new Error(`supersedes: no note with id "${supersedes}".`);
  }
  ensureDataDir(dataDir);
  const note = appendNote(dataDir, { title, body, tags, supersedes });
  spawnIfActive([]);
  return `Saved note ${note.id}.`;
}));

server.registerTool('reindex', {
  description: 'Refresh the knowledge base in the background; pass paths to refresh specific files, full to rebuild everything, force to skip the size question and the too-broad-folder block (it does not re-embed).',
  inputSchema: {
    paths: z.array(z.string()).optional(), full: z.boolean().optional(), force: z.boolean().optional(),
  },
}, tool(async ({ paths, full, force }) => {
  const why = inactive();
  if (why === 'off' || (why === 'blocked' && !force)) return inactiveLine(why);
  if (why === 'blocked') setOverride(dataDir);
  const args = [];
  if (paths?.length) args.push('--paths', JSON.stringify(paths));
  if (full) args.push('--full');
  if (force) args.push('--force');
  spawnWorker(root, args);
  return 'Indexing started in the background.';
}));

server.registerTool('status', {
  description: "Show the state of this project's knowledge base: index progress, counts, model, exclusions and the size threshold.",
  inputSchema: {},
}, tool(async () => {
  const st = readStatus(dataDir);
  let ex;
  try { ex = readExclusions(dataDir); } catch (e) { ex = { patterns: [`UNREADABLE (${e.message})`], sessions: [] }; }
  const why = inactive();
  if (why) return `root: ${root}\nstate: ${why === 'blocked' ? 'blocked (folder too broad to index)' : 'off'}`;
  let counts = null;
  if (fs.existsSync(dbPath)) counts = await withStore((s) => s.counts());
  const exl = [...ex.patterns, ...ex.sessions.map((s) => `session:${s}`)];
  return [
    `root: ${root}`,
    `phase: ${st?.phase ?? 'not indexed'}${st?.message ? ` (${st.message})` : ''}`,
    `progress: ${st?.done ?? 0}/${st?.total ?? 0}`,
    counts
      ? `files: ${counts.file}, chats: ${counts.chat}, notes: ${counts.note}, unembedded: ${counts.unembedded}`
      : 'files: 0, chats: 0, notes: 0',
    `model present: ${modelIsPresent() ? 'yes' : 'no'}`,
    `exclusions: ${exl.length ? exl.join(', ') : 'none'}`,
    `off: ${isOff(dataDir) ? 'yes' : 'no'}`,
    `last update: ${st?.updatedAt ? new Date(st.updatedAt).toISOString() : 'never'}`,
    `size threshold: ${readConfig().maxFiles} files (0 = never ask)`,
  ].join('\n');
}));

server.registerTool('configure', {
  description: 'Set how many files a project may have before remember asks to confirm the first index. 0 means never ask.',
  inputSchema: { max_files: z.number().int().min(0) },
}, tool(async ({ max_files }) => {
  const c = writeConfig({ maxFiles: max_files });
  return c.maxFiles === 0
    ? 'Size threshold is now 0: projects are always indexed without asking.'
    : `Size threshold is now ${c.maxFiles} files; larger projects wait for confirmation before the first index (0 = never ask).`;
}));

server.registerTool('forget', {
  description: 'Exclude a file glob or `session:<id>` from the knowledge base and delete it from the index now, or turn remember off for this project. Pass undo to reverse.',
  inputSchema: {
    target: z.string().optional(), undo: z.boolean().optional(), disable_project: z.boolean().optional(),
  },
}, tool(async ({ target, undo, disable_project }) => {
  if (disable_project) {
    ensureDataDir(dataDir);
    setOff(dataDir, !undo);
    return undo ? 'remember is on again for this project.' : 'remember is turned off for this project.';
  }
  target = normalizeTarget(target);
  if (!target) throw new Error('Provide a target, or disable_project.');
  if (target === 'session:' || (target.startsWith('session:') && !target.slice(8).trim())) {
    throw new Error('session: needs a session id.');
  }
  ensureDataDir(dataDir);
  if (undo) {
    removeExclusion(dataDir, target);
    spawnIfActive([]);
    return `Removed exclusion "${target}"; re-indexing in the background.`;
  }
  addExclusion(dataDir, target);
  const n = await withStore((store) => purgeExcluded(store, root, readExclusions(dataDir)));
  spawnIfActive([]); // a queued run purges again, in case a build was running meanwhile
  return n
    ? `Excluded "${target}"; removed ${n} indexed item${n === 1 ? '' : 's'}.`
    : `Excluded "${target}"; nothing indexed matched yet.`;
}));

await server.connect(new StdioServerTransport());
