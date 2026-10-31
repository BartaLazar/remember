#!/usr/bin/env node
// Deterministic token-cost simulation of the `remember` plugin (memory / chat-recall side).
// Run: node bench/memory/simulate.js [--code-savings=3000]
// No LLM calls. tokens = ceil(chars / 4) everywhere. Scratch data goes to MEMSIM_DIR (default below).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REGULAR, SUPERSEDED, Q1, QS, QFOREIGN, QVAGUE, NOTE_REGULAR, NOTE_PAIRS, NOTE_NEW_ONLY,
} from './data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const RESULTS = path.join(REPO, 'bench/results');
const SCRATCH = process.env.MEMSIM_DIR
  || path.join(os.tmpdir(), 'remember-bench', 'memsim');
const MODELS = process.env.REMEMBER_MODELS_DIR || path.join(os.homedir(), '.claude', 'remember', 'models');
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const CODE_SAVINGS = Number(arg('code-savings', 3000)); // PLACEHOLDER net tokens saved per code lookup
const tok = (s) => Math.ceil(String(s).length / 4);

// ---------- deterministic helpers
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20260401);
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
const normal = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const f0 = (n) => Math.round(n).toLocaleString('en-US');
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const pc = (a, b) => (b ? `${f1((100 * a) / b)}%` : 'n/a');

// ---------- Part 1: fixed cost
async function mcpToolsList(projDir, cfgDir) {
  const child = spawn(process.execPath, [path.join(REPO, 'server/mcp.js')], {
    env: { ...process.env, REMEMBER_PROJECT_DIR: projDir, REMEMBER_FAKE_EMBEDDER: '1', REMEMBER_CONFIG_DIR: cfgDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.id != null && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch { /* ignore */ }
    }
  });
  child.stderr.on('data', () => {});
  const rpc = (id, method, params) => new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error(`mcp timeout ${method}`)), 30000);
    waiting.set(id, (m) => { clearTimeout(to); res(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'memsim', version: '0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const r = await rpc(2, 'tools/list', {});
  child.kill();
  return r.result.tools;
}

async function part1(projDir, cfgDir) {
  const skillsDir = path.join(REPO, 'skills');
  const skills = fs.readdirSync(skillsDir).sort().map((n) => {
    const t = fs.readFileSync(path.join(skillsDir, n, 'SKILL.md'), 'utf8');
    const fm = t.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const name = fm[1].match(/^name:\s*(.+)$/m)[1].trim();
    const description = fm[1].match(/^description:\s*(.+)$/m)[1].trim();
    return { name, description, bodyTokens: tok(fm[2].trim()), line: `- remember:${name}: ${description}` };
  });
  const tools = await mcpToolsList(projDir, cfgDir);
  const toolsJson = JSON.stringify(tools);
  const slim = JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })));
  const names = tools.map((t) => `mcp__plugin_remember_remember__${t.name}`).join('\n');
  const { handleHook } = await import(path.join(REPO, 'server/bin/hook.js'));
  const hookOut = await handleHook('session-start', { cwd: projDir },
    { depsAvailable: () => true, spawnWorker: () => {}, listIndexableFiles: async () => [] });
  const hookMsg = hookOut.stdout ? JSON.parse(hookOut.stdout).hookSpecificOutput.additionalContext : '';
  const skillTokens = tok(skills.map((s) => s.line).join('\n'));
  const searchTool = tools.find((t) => t.name === 'search');
  const out = {
    skills: skills.map((s) => ({ name: s.name, descTokens: tok(s.line), bodyTokens: s.bodyTokens })),
    skillTokens,
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
    toolsPerTool: tools.map((t) => ({ name: t.name, tokens: tok(JSON.stringify(t)) })),
    toolsLoadedTokens: tok(toolsJson),
    toolsLoadedSlimTokens: tok(slim),
    toolsDeferredTokens: tok(names),
    hookTokens: tok(hookMsg),
    hookMsg,
    recallBodyTokens: skills.find((s) => s.name === 'recall').bodyTokens,
    searchToolTokens: searchTool ? tok(JSON.stringify(searchTool)) : 0,
  };
  out.fixedLoaded = skillTokens + out.toolsLoadedTokens + out.hookTokens;
  out.fixedDeferred = skillTokens + out.toolsDeferredTokens + out.hookTokens;
  // extra paid once, on the first lookup of a session: the recall skill body, and (deferred) fetching the search schema
  out.firstUseLoaded = out.recallBodyTokens;
  out.firstUseDeferred = out.recallBodyTokens + out.searchToolTokens + 60;
  return out;
}

// ---------- Part 2: synthetic history
const TOPICS = ['pagination', 'session handling', 'cache invalidation', 'retry logic', 'database migrations', 'webhook handler', 'file uploads', 'token refresh', 'job queue', 'search indexing', 'csv export', 'logging', 'flaky tests', 'CI pipeline', 'deployment script', 'translations', 'invoice totals', 'rate limiter', 'permission checks', 'dashboard widgets'];
const FILES = ['src/orders.js', 'src/sessions.js', 'src/cache.js', 'src/jobs/worker.js', 'src/db/migrate.js', 'src/webhooks.js', 'src/uploads.js', 'src/auth/tokens.js', 'src/search/indexer.js', 'src/export/csv.js', 'src/log.js', 'test/orders.test.js', 'scripts/deploy.sh', 'src/i18n.js', 'src/billing/invoice.js', 'src/ratelimit.js', 'src/acl.js', 'web/dashboard.js'];
const CAUSES = ['an off-by-one in the loop bounds', 'a missing await on the promise', 'a stale variable captured by the closure', 'an unescaped character in the input', 'a race between two callbacks', 'a default argument that was never overridden', 'a wrong import path after the rename', 'a null that slipped past the guard', 'a timing assumption in the test', 'a copy-pasted condition with the operands swapped'];
const ACTIONS = ['added a guard and a regression test', 'extracted the helper into its own function', 'renamed the variable so the intent is clear', 'moved the call behind the existing wrapper', 'tightened the types in the signature', 'rewrote the loop to be easier to read', 'split the long function in two', 'added logging around the failing branch'];
const USERQ = ['Can you look into the {t} code? Something feels off.', 'Why does the {t} test fail only on CI?', 'Please refactor the {t} module a bit.', 'I am seeing odd behaviour in {t}, can you trace it?', 'Can you explain how {t} works right now?', 'Add a unit test for {t}.', 'Review the diff I just made around {t}.', 'Let us clean up {t}; it grew messy.'];
const WORDS = ['alpha', 'beta', 'order', 'item', 'user', 'state', 'cache', 'batch', 'queue', 'token', 'frame', 'index', 'cursor', 'entry', 'ledger', 'handle', 'buffer', 'stream', 'config', 'record', 'metric', 'plan', 'node', 'link', 'span'];
const VERBS = ['get', 'set', 'build', 'parse', 'load', 'flush', 'merge', 'check', 'emit', 'map', 'reduce', 'wrap'];

function codeLine() {
  const k = int(0, 7); const a = pick(WORDS); const b = pick(WORDS); const v = pick(VERBS);
  const ind = '  '.repeat(int(0, 3));
  switch (k) {
    case 0: return `${ind}const ${a}${int(1, 99)} = await ${v}${b[0].toUpperCase()}${b.slice(1)}(${a}, { limit: ${int(1, 500)} });`;
    case 1: return `${ind}if (!${a} || ${a}.${b} === undefined) throw new Error('${a} missing ${b} at step ${int(1, 40)}');`;
    case 2: return `${ind}// ${v} the ${a} before touching the ${b}; see ticket ${int(100, 999)}`;
    case 3: return `${ind}for (const ${a} of ${b}s) { out.push(${v}(${a}, ${int(0, 9)})); }`;
    case 4: return `${ind}export function ${v}${a[0].toUpperCase()}${a.slice(1)}${int(1, 30)}(${b}, opts = {}) {`;
    case 5: return `${ind}return ${a}.${v}(${b}).filter((x) => x.${pick(WORDS)} > ${int(0, 100)}).slice(0, ${int(5, 200)});`;
    case 6: return `${ind}logger.debug('${v} ${a}', { ${b}: ${a}.${b}, took: ${int(1, 900)} });`;
    default: return `${ind}}`;
  }
}
function logLine() {
  const k = int(0, 4);
  const d = `2026-04-${String(int(1, 28)).padStart(2, '0')}T${String(int(0, 23)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}.${int(100, 999)}Z`;
  switch (k) {
    case 0: return `  ok ${int(1, 400)} - ${pick(WORDS)} ${pick(VERBS)}s ${pick(WORDS)} (${int(1, 900)}.${int(10, 99)}ms)`;
    case 1: return `# ${pick(WORDS)} ${pick(VERBS)} suite ${int(1, 60)}`;
    case 2: return `${d} INFO  request_id=${int(100000, 999999)} route=/${pick(WORDS)}s/${int(1, 9999)} status=200 ms=${int(2, 800)}`;
    case 3: return `${d} WARN  ${pick(WORDS)} slow query rows=${int(10, 90000)} plan=seq-scan-${int(1, 9)}`;
    default: return `    at ${pick(VERBS)}${pick(WORDS)} (src/${pick(WORDS)}/${pick(WORDS)}.js:${int(1, 400)}:${int(1, 60)})`;
  }
}
function toolOutput(size, kind) {
  const out = []; let n = 0; let ln = 1;
  while (n < size) {
    const l = kind === 'code' ? `${String(ln++).padStart(5)}\t${codeLine()}` : logLine();
    out.push(l); n += l.length + 1;
  }
  return out.join('\n');
}

function fillerUnit(session, budgetLeft) {
  const t = pick(TOPICS);
  const user = pick(USERQ).replace('{t}', t);
  const file = pick(FILES);
  const think = 'Reasoning about ' + t + ' and ' + pick(CAUSES) + '. ' + 'x'.repeat(int(100, 600));
  const text1 = `I'll start by looking at ${file}.`;
  const text2 = `I read ${file} and traced the ${t} path. The problem was ${pick(CAUSES)}. I ${pick(ACTIONS)}, and the ${pick(['unit', 'integration', 'lint'])} checks pass now. ` +
    `Nothing else in ${pick(FILES)} needed to change${R() < 0.4 ? `, though the ${pick(TOPICS)} code nearby could use a follow-up later` : ''}.`;
  const recs = [{ role: 'user', content: user }];
  const withTools = R() < 0.8;
  if (!withTools) { recs.push({ role: 'assistant', content: [{ type: 'text', text: text2 }] }); return recs; }
  const id = 'toolu_' + int(1e8, 9e8);
  recs.push({ role: 'assistant', content: [{ type: 'thinking', thinking: think }, { type: 'text', text: text1 }] });
  const isCode = R() < 0.6;
  recs.push({ role: 'assistant', content: [{ type: 'tool_use', id, name: isCode ? 'Read' : 'Bash', input: isCode ? { file_path: `/work/${file}` } : { command: 'npm test' } }] });
  let size = Math.round(Math.exp(Math.log(4000) + normal() * 1.3));
  size = Math.max(500, Math.min(size, 400000, Math.max(500, budgetLeft)));
  recs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: toolOutput(size, isCode ? 'code' : 'log') }] });
  recs.push({ role: 'assistant', content: [{ type: 'text', text: text2 }] });
  return recs;
}

function buildFacts() {
  const facts = [];
  for (const [id, topic, text, key] of REGULAR) facts.push({ id, topic, text, key, kind: 'regular', session: int(0, 39) });
  for (const [id, topic, otext, okey, ntext, nkey] of SUPERSEDED) {
    const a = int(0, 16); const b = int(22, 39);
    facts.push({ id: id + 'o', pair: id, topic, text: otext, key: okey, kind: 'old', session: a });
    facts.push({ id: id + 'n', pair: id, topic, text: ntext, key: nkey, kind: 'new', session: b });
  }
  facts.forEach((f, i) => { f.where = i % 2 ? 'a' : 'u'; });
  return facts;
}

function plantedUnit(f) {
  if (f.where === 'u') {
    return [
      { role: 'user', content: `For the record, since we keep re-discussing ${f.topic}: ${f.text}` },
      { role: 'assistant', content: [{ type: 'text', text: `Understood. I will follow that for ${f.topic} from now on and flag any code that disagrees.` }] },
    ];
  }
  return [
    { role: 'user', content: `Remind me where we landed on ${f.topic}?` },
    { role: 'assistant', content: [{ type: 'text', text: `${f.text} Tell me if you want me to check the code against it.` }] },
  ];
}

function writeSessions(projectsDir, root, facts) {
  const slugDir = path.join(projectsDir, root.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(slugDir, { recursive: true });
  const files = [];
  const N = 40;
  // sizes: log-spaced 20 KB .. 2 MB, shuffled
  const sizes = Array.from({ length: N }, (_, i) => 20e3 * Math.pow(100, (i + 0.5) / N));
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [sizes[i], sizes[j]] = [sizes[j], sizes[i]]; }
  for (let s = 0; s < N; s++) {
    const sid = `${(0x10000000 + s * 7919).toString(16)}-0000-4000-8000-${(0xabc000000000 + s).toString(16)}`;
    const units = []; let bytes = 0;
    while (bytes < sizes[s] || units.length < 6) {
      const u = fillerUnit(s, sizes[s] - bytes);
      bytes += JSON.stringify(u).length + 200;
      units.push(u);
    }
    for (const f of facts.filter((x) => x.session === s)) units.splice(int(0, units.length), 0, plantedUnit(f));
    const lines = [JSON.stringify({ type: 'file-history-snapshot', messageId: 'm0', snapshot: {} })];
    let ts = Date.parse('2026-03-01T09:00:00Z') + s * 3 * 86400e3;
    for (const u of units) {
      for (const r of u) {
        ts += 4000;
        lines.push(JSON.stringify({
          type: r.role, sessionId: sid, cwd: root, timestamp: new Date(ts).toISOString(), uuid: `u${lines.length}`,
          message: { role: r.role, content: r.content },
        }));
      }
    }
    const fp = path.join(slugDir, `${sid}.jsonl`);
    fs.writeFileSync(fp, lines.join('\n') + '\n');
    files.push(fp);
  }
  return files;
}

function writeProjectFiles(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (let i = 0; i < 30; i++) {
    const lines = [`// ${pick(TOPICS)} helpers (module ${i})`];
    for (let k = 0; k < 60; k++) lines.push(codeLine());
    fs.writeFileSync(path.join(root, 'src', `mod${i}.js`), lines.join('\n') + '\n');
  }
}

const STOP = new Set(('the and for are was were what which when where why how does did our their that this with from have has into about there then than your you but not can who whom whose doing done any all use used using ' +
  'wir wie was ist sind der die das und für ein eine einen wann warum welche welches um uhr viel läuft haben nicht mit von auf den dem des alte wird ' +
  'wat het een van hoe lang wordt welk voor niet hebben geen maximale ' +
  'les des une est sont dans pour quel quelle comment gère pendant combien quand sur avec que qui où ' +
  'los las una por qué cómo cuántas puede usamos para cada con del que').split(/\s+/));

function queryWords(q) {
  return [...new Set((q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).filter((w) => w.length >= 4 && !STOP.has(w)))];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function grepPolicy(q, corpus, hitKeys) {
  const words = queryWords(q);
  const scored = words.map((w) => ({ w, df: corpus.filter((c) => c.lower.includes(w)).length })).filter((x) => x.df > 0)
    .sort((a, b) => a.df - b.df || b.w.length - a.w.length);
  const chosen = scored.slice(0, 2).map((x) => x.w);
  if (!chosen.length) return { chosen, grepOut: '', readOut: '', grepTokens: 0, readTokens: 0, hit: false, hitGrep: false, hitRead: false, file: null, matched: 0 };
  const re = new RegExp(chosen.map(esc).join('|'), 'i');
  const hits = []; let matched = 0;
  for (const c of corpus) {
    for (let i = 0; i < c.lines.length; i++) {
      if (re.test(c.lines[i])) { matched++; if (hits.length < 100) hits.push({ file: c.file, n: i + 1, line: c.lines[i] }); }
    }
  }
  const grepOut = hits.map((h) => `${h.file}:${h.n}:${h.line}`).join('\n');
  const grepTrunc = hits.map((h) => `${h.file}:${h.n}:${h.line.length > 500 ? h.line.slice(0, 500) : h.line}`).join('\n');
  const per = new Map();
  for (const h of hits) per.set(h.file, (per.get(h.file) || 0) + 1);
  let best = null; let bc = -1;
  for (const [f, n] of per) if (n > bc) { best = f; bc = n; }
  let readOut = '';
  if (best) {
    const c = corpus.find((x) => x.file === best);
    readOut = c.lines.slice(0, 2000).map((l, i) => `${String(i + 1).padStart(6)}\t${l}`).join('\n');
  }
  const hitGrep = hitKeys.some((k) => grepOut.includes(k));
  const hitRead = hitKeys.some((k) => readOut.includes(k));
  return {
    chosen, grepTokens: tok(grepOut), grepTruncTokens: tok(grepTrunc), readTokens: tok(readOut), hitGrep, hitRead, hit: hitGrep || hitRead,
    file: best ? path.basename(best) : null, matched, hitsShown: hits.length,
  };
}

function synthDecisionLines(n, avgChars) {
  const subj = ['Use', 'Avoid', 'Prefer', 'Never use', 'Standardize on'];
  const tech = ['pg-boss', 'zod', 'date-fns', 'undici', 'pino', 'Fastify', 'Vitest', 'esbuild', 'Kysely', 'Terraform', 'Helm', 'Sentry', 'Prisma', 'Playwright', 'nginx', 'RabbitMQ', 'Kafka', 'DynamoDB'];
  const area = ['the billing service', 'the admin UI', 'background jobs', 'the partner API', 'the mobile gateway', 'report generation', 'the audit log', 'tenant provisioning', 'file imports', 'email delivery', 'the search service', 'CI builds'];
  const why = ['the team already operates it', 'the benchmark showed a 3x gain', 'the licence was a blocker', 'the previous option leaked memory', 'ops asked for fewer moving parts', 'it cut cold start by 400 ms', 'the audit required it'];
  const lines = [];
  for (let i = 0; i < n; i++) {
    let l = `- ${pick(subj)} ${pick(tech)} for ${pick(area)}; ${pick(why)}, limit ${int(2, 900)} ${pick(['MB', 'ms', 'req/s', 'retries', 'days'])}.`;
    while (l.length < avgChars - 20) l += ` Also applies to ${pick(area)}.`;
    lines.push(l);
  }
  return lines;
}

// ---------- main
async function main() {
  const t0 = Date.now();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  const projDir = path.join(SCRATCH, 'proj'); const projectsDir = path.join(SCRATCH, 'projects'); const cfgDir = path.join(SCRATCH, 'cfg');
  for (const d of [projDir, projectsDir, cfgDir]) fs.mkdirSync(d, { recursive: true });
  const root = fs.realpathSync.native(projDir);
  process.env.REMEMBER_CONFIG_DIR = cfgDir;

  console.log('Part 1: fixed cost');
  const p1 = await part1(root, cfgDir);

  console.log('Part 2: building history');
  const facts = buildFacts();
  writeProjectFiles(root);
  const tfiles = writeSessions(projectsDir, root, facts);
  const sizes = tfiles.map((f) => fs.statSync(f).size);
  const dataDir = path.join(root, '.remember');
  const { appendNote } = await import(path.join(REPO, 'server/lib/userdata.js'));
  const byId = Object.fromEntries(facts.map((f) => [f.id, f]));
  const noteOf = {};
  const mkNote = (f, supersedes) => {
    const n = appendNote(dataDir, { title: `Decision: ${f.topic}`, body: `${f.text}\nWhy: agreed in chat; recorded so it is not re-debated.`, tags: ['decision'], supersedes });
    noteOf[f.id] = n.id;
  };
  for (const id of NOTE_REGULAR) mkNote(byId[id]);
  for (const p of NOTE_PAIRS) { mkNote(byId[p + 'o']); mkNote(byId[p + 'n'], noteOf[p + 'o']); }
  for (const p of NOTE_NEW_ONLY) mkNote(byId[p + 'n']);
  const noteCount = Object.keys(noteOf).length;

  // index with the real plugin
  const { createEmbedder } = await import(path.join(REPO, 'server/lib/embed.js'));
  const { openStore } = await import(path.join(REPO, 'server/lib/store.js'));
  const { runIndex } = await import(path.join(REPO, 'server/lib/indexer.js'));
  const { search, formatResults } = await import(path.join(REPO, 'server/lib/search.js'));
  const embedder = await createEmbedder({ modelsDir: MODELS, allowDownload: false });
  const store = openStore(path.join(dataDir, 'index.db'));
  console.log('indexing...');
  const ti = Date.now();
  const status = await runIndex({ root, dataDir, store, embedder, projectsDir });
  const indexSec = (Date.now() - ti) / 1000;
  const counts = store.counts();
  console.log('indexed', JSON.stringify(counts), `${indexSec.toFixed(0)}s`, status.phase);

  // questions
  const questions = [];
  for (const f of REGULAR) questions.push({ q: Q1[f[0]], lang: 'en', cat: 'regular', fact: f[0], keys: [f[3]] });
  for (const s of SUPERSEDED) questions.push({ q: QS[s[0]], lang: 'en', cat: 'superseded', fact: s[0] + 'n', keys: [s[5]], newKey: s[5], oldKey: s[3] });
  for (const [id, lang, q] of QFOREIGN) questions.push({ q, lang, cat: 'foreign', fact: id, keys: [byId[id].key] });
  for (const [id, q] of QVAGUE) questions.push({ q, lang: 'en', cat: 'vague', fact: id, keys: [byId[id].key] });
  if (questions.length !== 80) throw new Error('expected 80 questions, got ' + questions.length);
  const hasNote = (fid) => fid in noteOf;

  // ground-truth uniqueness sanity: each key appears in exactly one planted chat text
  const allChunkText = store.getChunks ? null : null; // (kept simple; uniqueness checked on facts below)
  for (const f of facts) {
    const n = facts.filter((g) => g.text.includes(f.key)).length;
    if (n !== 1) throw new Error(`key not unique: ${f.id} ${f.key}`);
  }

  // corpus for grep baseline
  const corpus = tfiles.sort().map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    return { file, lines: text.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')), lower: text.toLowerCase() };
  });

  console.log('running 80 questions');
  const rows = [];
  for (const Q of questions) {
    const ts = process.hrtime.bigint();
    const results = await search({ store, embedder, root, query: Q.q, scope: 'all', limit: 8 });
    const searchMs = Number(process.hrtime.bigint() - ts) / 1e6;
    const out = formatResults(results, { status: null, semantic: true });
    const rank = (key) => { const i = results.findIndex((r) => r.text.includes(key)); return i < 0 ? null : i + 1; };
    const firstKey = Q.keys[0];
    const rk = rank(firstKey);
    const visible = out.includes(firstKey);
    const fact = byId[Q.fact];
    const row = {
      q: Q.q, lang: Q.lang, cat: Q.cat, fact: Q.fact, rank: rk, hit1: rk === 1, hit8: rk != null, visible8: visible,
      viaNote: hasNote(Q.fact), remTokens: tok(out), searchMs, topKinds: results.map((r) => r.kind[0]).join(''),
      noteHit: results.some((r) => r.kind === 'note' && r.text.includes(firstKey)),
    };
    if (Q.cat === 'superseded') {
      row.newRank = rk; row.oldRank = rank(Q.oldKey);
      row.newestAboveOld = rk != null && (row.oldRank == null || rk < row.oldRank);
      row.oldOnly = rk == null && row.oldRank != null;
      row.bothPresent = rk != null && row.oldRank != null;
    }
    const g = grepPolicy(Q.q, corpus, [firstKey]);
    row.grep = g;
    row.grepReadTokens = g.grepTokens + g.readTokens;
    row.reexplainTokens = tok(fact.text) + 40;
    rows.push(row);
  }
  await embedder.dispose?.();
  store.close();

  // ---------- aggregate
  const agg = (rs) => ({
    n: rs.length, r1: rs.filter((r) => r.hit1).length, r8: rs.filter((r) => r.hit8).length, vis8: rs.filter((r) => r.visible8).length,
  });
  const overall = agg(rows);
  const byLang = {}; for (const l of ['en', 'de', 'nl', 'fr', 'es']) byLang[l] = agg(rows.filter((r) => r.lang === l));
  const byCat = {}; for (const c of ['regular', 'vague', 'foreign', 'superseded']) byCat[c] = agg(rows.filter((r) => r.cat === c));
  const sup = rows.filter((r) => r.cat === 'superseded');
  const supStats = {
    n: sup.length, newInTop8: sup.filter((r) => r.hit8).length, newAtRank1: sup.filter((r) => r.hit1).length,
    bothPresent: sup.filter((r) => r.bothPresent).length, newAboveOld: sup.filter((r) => r.bothPresent && r.newestAboveOld).length,
    oldOnly: sup.filter((r) => r.oldOnly).length, neither: sup.filter((r) => r.newRank == null && r.oldRank == null).length,
    noteBacked: sup.filter((r) => r.viaNote).length,
  };
  const reg = rows.filter((r) => r.cat !== 'superseded');
  const withNote = agg(rows.filter((r) => r.viaNote)); const chatOnly = agg(rows.filter((r) => !r.viaNote));
  const tokStats = (xs) => ({ median: median(xs), mean: mean(xs), p90: pct(xs, 0.9), min: Math.min(...xs), max: Math.max(...xs) });
  const policies = {
    remember: tokStats(rows.map((r) => r.remTokens)),
    grepRead: tokStats(rows.map((r) => r.grepReadTokens)),
    grepOnly: tokStats(rows.map((r) => r.grep.grepTokens)),
    grepOnlyTrunc500: tokStats(rows.map((r) => r.grep.grepTruncTokens ?? 0)),
    readOnly: tokStats(rows.map((r) => r.grep.readTokens)),
    reexplain: tokStats(rows.map((r) => r.reexplainTokens)),
  };
  const grepHit = { n: rows.length, hit: rows.filter((r) => r.grep.hit).length, hitGrepOutput: rows.filter((r) => r.grep.hitGrep).length, hitRead: rows.filter((r) => r.grep.hitRead).length, noWordsInCorpus: rows.filter((r) => !r.grep.chosen.length).length };
  const grepByLang = {}; for (const l of ['en', 'de', 'nl', 'fr', 'es']) { const rs = rows.filter((r) => r.lang === l); grepByLang[l] = { n: rs.length, hit: rs.filter((r) => r.grep.hit).length }; }
  const grepSup = sup.filter((r) => r.grep.hit).length;
  const searchMs = tokStats(rows.map((r) => r.searchMs));

  // memory file growth
  const realLines = facts.map((f) => `- ${f.text}`);
  const avgChars = mean(realLines.map((l) => l.length));
  const header = '# Project decisions\n';
  const memFile = {};
  const NS = [10, 25, 60, 150, 400];
  for (const n of NS) {
    const lines = n <= 60 ? realLines.slice(0, n) : [...realLines, ...synthDecisionLines(n - 60, avgChars)];
    memFile[n] = { lines: n, tokens: tok(header + lines.join('\n')) };
  }
  const answerableByFileAt = {}; // fraction of the 80 questions whose fact is in the first N lines (facts are in id order: REGULAR, then pairs)
  for (const n of NS) answerableByFileAt[n] = rows.filter((r) => facts.findIndex((f) => f.id === r.fact) < n).length / rows.length;

  // ---------- Part 3: break-even
  const hit = (r) => r.visible8;
  const perQSave = (r, baseline) => (hit(r) ? baseline(r) - r.remTokens : -r.remTokens);
  const recallVsGrepMean = mean(rows.map((r) => perQSave(r, (x) => x.grepReadTokens)));
  const recallVsGrepMed = median(rows.map((r) => perQSave(r, (x) => x.grepReadTokens)));
  const recallVsGrepOnlyMed = median(rows.map((r) => perQSave(r, (x) => x.grep.grepTokens)));
  const recallVsReexplain = mean(rows.map((r) => perQSave(r, (x) => x.reexplainTokens)));
  const be = (fixed, first, s) => (s > 0 ? Math.ceil((fixed + first) / s) : null);
  const scenarios = [
    ['code search (placeholder, --code-savings)', CODE_SAVINGS],
    ['chat recall vs grep+read (median)', recallVsGrepMed],
    ['chat recall vs grep+read (mean)', recallVsGrepMean],
    ['chat recall vs grep only (median)', recallVsGrepOnlyMed],
    ['chat recall vs re-explain (mean)', recallVsReexplain],
  ].map(([name, s]) => ({ name, savingPerLookup: s, loaded: be(p1.fixedLoaded, p1.firstUseLoaded, s), deferred: be(p1.fixedDeferred, p1.firstUseDeferred, s),
    loadedNoFirstUse: be(p1.fixedLoaded, 0, s), deferredNoFirstUse: be(p1.fixedDeferred, 0, s) }));

  const medSearch = policies.remember.median;
  const growth = NS.map((n) => ({
    n, memFileTokens: memFile[n].tokens,
    remember1: p1.fixedDeferred + p1.firstUseDeferred + medSearch,
    remember3: p1.fixedDeferred + p1.firstUseDeferred + 3 * medSearch,
    remember5: p1.fixedDeferred + p1.firstUseDeferred + 5 * medSearch,
    rememberLoaded3: p1.fixedLoaded + p1.firstUseLoaded + 3 * medSearch,
  }));
  // decisions count at which memory file per-session cost equals remember (deferred, 3 lookups)
  const perLine = (memFile[400].tokens - memFile[150].tokens) / 250;
  const crossover3 = Math.ceil(growth[0].remember3 / perLine);

  const results = {
    generated: 'deterministic (seeded); wall-clock timings vary',
    params: { codeSavingsPlaceholder: CODE_SAVINGS, tokenRule: 'ceil(chars/4)' },
    part1: p1,
    corpus: { transcripts: tfiles.length, totalBytes: sizes.reduce((a, b) => a + b, 0), minBytes: Math.min(...sizes), maxBytes: Math.max(...sizes), facts: facts.length, notes: noteCount, indexCounts: counts, indexSeconds: indexSec, questions: questions.length },
    recall: { overall, byLang, byCat, superseded: supStats, withNote, chatOnly, regularNoSup: agg(reg), searchMs },
    policies, grepHit, grepByLang, grepSupersededHit: grepSup,
    memFile, answerableByFileAt, growth, memFileTokensPerLine: perLine, crossoverDecisionsVsRemember3: crossover3,
    breakEven: scenarios, savings: { recallVsGrepMean, recallVsGrepMed, recallVsGrepOnlyMed, recallVsReexplain },
    rows: rows.map((r) => ({ ...r, grep: { ...r.grep, grepOut: undefined } })),
  };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'memory-results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(RESULTS, 'memory-summary.md'), summary(results, rows));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> bench/results/memory-summary.md`);
}

function summary(r, rows) {
  const p1 = r.part1; const rc = r.recall; const P = r.policies;
  const L = [];
  const tbl = (head, body) => { L.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`); body.forEach((b) => L.push(`| ${b.join(' | ')} |`)); L.push(''); };
  L.push('# remember: memory / chat-recall token simulation', '');
  L.push('Deterministic, no LLM calls. tokens = ceil(chars/4) for every policy. Synthetic project: ' +
    `${r.corpus.transcripts} transcripts (${f0(r.corpus.totalBytes / 1024)} KB total, ${f0(r.corpus.minBytes / 1024)} KB to ${f0(r.corpus.maxBytes / 1024)} KB each), ` +
    `${r.corpus.facts} planted facts (10 superseded pairs), ${r.corpus.notes} decision notes, 30 small source files; ` +
    `index = ${JSON.stringify(r.corpus.indexCounts)} chunks, built in ${f0(r.corpus.indexSeconds)} s with the real multilingual-e5-small embedder. 80 hand-written questions.`, '');

  L.push('## 1. Fixed cost per session', '');
  tbl(['component', 'schemas loaded', 'deferred'], [
    [`5 skill descriptions (name + description)`, f0(p1.skillTokens), f0(p1.skillTokens)],
    [`MCP tools (${p1.toolCount}): ${p1.toolNames.join(', ')}`, f0(p1.toolsLoadedTokens), `${f0(p1.toolsDeferredTokens)} (names only)`],
    ['SessionStart hook line', f0(p1.hookTokens), f0(p1.hookTokens)],
    ['**Fixed total per session**', `**${f0(p1.fixedLoaded)}**`, `**${f0(p1.fixedDeferred)}**`],
    ['First lookup only: recall SKILL.md body' + ' (+ search schema fetch when deferred)', f0(p1.firstUseLoaded), f0(p1.firstUseDeferred)],
  ]);
  L.push(`Tool JSON is the tools array exactly as the server lists it; trimmed to name/description/input_schema it is ${f0(p1.toolsLoadedSlimTokens)} tokens. Per tool: ${p1.toolsPerTool.map((t) => `${t.name} ${t.tokens}`).join(', ')}.`, '');

  L.push('## 2. Recall quality (remember, one search() call, limit 8, scope all)', '');
  const row = (name, a) => [name, a.n, pc(a.r1, a.n), pc(a.r8, a.n), pc(a.vis8, a.n)];
  tbl(['slice', 'n', 'recall@1', 'recall@8 (chunk contains fact)', 'fact visible in formatted output'], [
    row('**overall**', rc.overall),
    ...Object.entries(rc.byLang).map(([l, a]) => row(`lang ${l}`, a)),
    ...Object.entries(rc.byCat).map(([c, a]) => row(`type ${c}`, a)),
    row('fact also saved as a note', rc.withNote), row('fact only in chat history', rc.chatOnly),
  ]);
  const s = rc.superseded;
  L.push('Superseded decisions (10 questions, newest answer is correct):', '');
  tbl(['measure', 'count'], [
    ['newest version in top 8', `${s.newInTop8}/${s.n}`], ['newest version at rank 1', `${s.newAtRank1}/${s.n}`],
    ['both old and new returned', s.bothPresent], ['... and newest ranked above old', `${s.newAboveOld}/${s.bothPresent}`],
    ['only the OLD version returned (stale answer risk)', s.oldOnly], ['neither returned', s.neither],
    ['questions whose newest fact also has a note (old note is excluded via supersedes)', s.noteBacked],
  ]);
  L.push('Among chat results, newer chats get a small score boost, so a later decision tends to rank above the one it replaced; notes with `supersedes` remove the old note entirely.', '');

  L.push('## 3. Tokens per lookup, by policy (80 questions)', '');
  const prow = (n, x, hitTxt) => [n, f0(x.median), f0(x.mean), f0(x.p90), f0(x.max), hitTxt];
  tbl(['policy', 'median', 'mean', 'p90', 'max', 'found the fact'], [
    prow('remember (1 search call)', P.remember, `${pc(rc.overall.r8, 80)} in top 8 (${pc(rc.overall.vis8, 80)} visible)`),
    prow('grep transcripts + Read best file', P.grepRead, `${pc(r.grepHit.hit, 80)} (grep output ${pc(r.grepHit.hitGrepOutput, 80)}, Read ${pc(r.grepHit.hitRead, 80)})`),
    prow('  grep step alone (100-line cap)', P.grepOnly, '-'),
    prow('  grep step alone, lines cut to 500 chars', P.grepOnlyTrunc500, '-'),
    prow('  Read step alone (2000-line cap)', P.readOnly, '-'),
    prow('re-explain (fact + 40)', P.reexplain, '100% if the user remembers it'),
  ]);
  L.push(`Grep baseline found the fact for ${r.grepHit.hit}/80 questions; ${r.grepHit.noWordsInCorpus} questions had no usable query word in the corpus (foreign wording). Superseded questions found by grep: ${r.grepSupersededHit}/10. Median search latency ${f0(rc.searchMs.median)} ms.`, '');

  L.push('### Memory file (CLAUDE.md-style) vs flat search cost', '');
  tbl(['decisions in file', 'file tokens, paid EVERY session', 'remember: fixed + first use + 1 lookup (deferred)', '... + 3 lookups', '... + 5 lookups', '... + 3 lookups (schemas loaded)'],
    r.growth.map((g) => [g.n, f0(g.memFileTokens), f0(g.remember1), f0(g.remember3), f0(g.remember5), f0(g.rememberLoaded3)]));
  L.push(`Memory file costs about ${f1(r.memFileTokensPerLine)} tokens per decision. It overtakes remember (deferred, 3 lookups/session) at about ${r.crossoverDecisionsVsRemember3} decisions. The file has no retrieval cost and no miss, but it only holds what someone wrote down and it never covers chat history that was not distilled into it.`, '');

  L.push('## 4. Break-even', '');
  L.push(`Fixed cost must be repaid by per-lookup savings. Expected saving per lookup = hit x baseline - remember cost (a miss costs the search and then you fall back anyway). The code-search saving is a **placeholder of ${f0(CODE_SAVINGS)} tokens/lookup; the code agent's measured numbers should be plugged in** (rerun with \`--code-savings=N\`).`, '');
  tbl(['scenario', 'saving / lookup (tokens)', 'lookups to break even, schemas loaded', 'schemas deferred', 'loaded, ignoring first-use', 'deferred, ignoring first-use'],
    r.breakEven.map((b) => [b.name, f0(b.savingPerLookup), b.loaded ?? 'never', b.deferred ?? 'never', b.loadedNoFirstUse ?? 'never', b.deferredNoFirstUse ?? 'never']));

  L.push('## 5. Findings', '');
  const noteVsChat = `${pc(rc.withNote.r8, rc.withNote.n)} vs ${pc(rc.chatOnly.r8, rc.chatOnly.n)}`;
  L.push(`1. Fixed cost is ${f0(p1.fixedLoaded)} tokens/session with schemas loaded and ${f0(p1.fixedDeferred)} deferred. Deferral removes ${pc(p1.fixedLoaded - p1.fixedDeferred, p1.fixedLoaded)} of it; the tools array is the bulk when loaded.`);
  L.push(`2. Retrieval: recall@8 ${pc(rc.overall.r8, 80)}, recall@1 ${pc(rc.overall.r1, 80)}; only ${pc(rc.overall.vis8, 80)} of facts are actually visible in the formatted output because snippets are cut at 600 chars (a long chunk can contain the fact in the index but not in what the model reads). Notes help: ${noteVsChat} (recall@8 note-backed vs chat-only).`);
  L.push(`3. Versus grepping transcripts, a search costs a median ${f0(P.remember.median)} tokens against ${f0(P.grepRead.median)} for grep + Read (${f0(P.grepRead.median / Math.max(1, P.remember.median))}x), and grep found the fact only ${pc(r.grepHit.hit, 80)} of the time, and only ${['de','nl','fr','es'].reduce((a,l)=>a+r.grepByLang[l].hit,0)}/15 non-English queries. The transcript Read alone would be ${f0(P.readOnly.median)} tokens at the median (real Claude Code also refuses big files, which this does not model).`);
  L.push(`4. Where it loses: re-explaining costs a median ${f0(P.reexplain.median)} tokens, far below ${f0(P.remember.median)} per search, so remember never pays back in tokens against re-typing (it saves the user's time and memory, not tokens). Likewise a small decision file (under ~${r.crossoverDecisionsVsRemember3} decisions) is cheaper per session than the plugin's fixed cost plus 3 lookups, and 100% reliable; the file grows linearly (${f0(r.memFile[400].tokens)} tokens at 400 decisions) while search stays flat.`);
  L.push(`5. Superseded decisions: newest in top 8 for ${s.newInTop8}/10, newest above old when both returned ${s.newAboveOld}/${s.bothPresent}, old-only (stale answer) ${s.oldOnly}/10. Newer chats get a small ranking boost; notes with \`supersedes\` remove the old note. Cross-lingual queries: ${['de', 'nl', 'fr', 'es'].map((l) => `${l} ${pc(rc.byLang[l].r8, rc.byLang[l].n)}`).join(', ')} recall@8.`, '');

  L.push('## Caveats', '');
  L.push('- Synthetic corpus: filler chat and tool output are template-generated, so retrieval is probably easier than real history (topics in filler are shallow, the facts are distinctive, keys unique). Real recall will likely be lower.');
  L.push('- Ground truth is substring presence of the planted key in a returned chunk; notes duplicate chat facts so note-backed facts are easy. 25 notes cover 25 facts (21 are active in the index after 4 supersessions), more than most users will write.');
  L.push('- Grep baseline: query words are picked by corpus rarity (an oracle-ish advantage, df over the real corpus), matched case-insensitively as substrings, cap 100 lines, best file chosen by visible match count; untruncated lines counted as instructed. Real Claude Code may truncate long lines or refuse the Read (>~25k tokens), which would change both cost and hit rate.');
  L.push('- Deferred-schema cost approximates names as `mcp__plugin_remember_remember__<tool>`; first-use cost for deferred adds the search schema plus 60 tokens for the schema-fetch call. Skill list lines assumed `- remember:<name>: <description>`.');
  L.push('- Memory-file lines beyond the 60 real decisions are synthesized at the same average length; the file model assumes every decision was written down and the model always reads it, i.e. it is an upper bound on file usefulness.');
  L.push('- Re-explain tokens ignore the user\'s time and the chance they forgot. Savings for code search are a placeholder until the code benchmark is merged.');
  return L.join('\n') + '\n';
}

main().catch((e) => { console.error(e); process.exit(1); });
