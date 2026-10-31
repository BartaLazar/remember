// Deterministic token-savings simulation: Grep+Read baselines vs the remember plugin's search().
// Usage: node bench/code/simulate.js   (run gen-queries.js and build-index.js first; they are cached)
import fs from 'node:fs';
import path from 'node:path';
process.env.REMEMBER_CONFIG_DIR = path.join(process.env.TMPDIR || '/tmp', 'remember-bench-cfg');
import { openStore } from '../../server/lib/store.js';
import { createEmbedder } from '../../server/lib/embed.js';
import { search, formatResults } from '../../server/lib/search.js';
import { listIndexableFiles, isBinary } from '../../server/lib/files.js';
import { REPOS, root, INDEX, MODELS } from './common.js';

const here = import.meta.dirname;
const RES = path.resolve(here, '../results');
const tok = (s) => Math.ceil(s.length / 4);
const overlap = (a0, a1, b0, b1) => a0 <= b1 && b0 <= a1;
const STOP = new Set('the a an of to in on for and or is are be as it its this that these those with by from at which when if not can will may should must into than then also any each all how where what why who does do did has have was were been being their there they you your other only both one two decide decides get gets set sets work works way'.split(' '));
const MAX_GREP_LINES = 100, MAX_FILES = 5, WINDOW = 120, MAX_WINDOWS_PER_FILE = 3, PAD = 15, MAX_FILES_LISTED = 250;

// ---------- simulated tool outputs ----------
function readOut(lines, from, to) { // Claude Code Read: "     N\ttext", default limit 2000 lines
  const s = Math.max(1, from), e = Math.min(lines.length, to, s + 1999);
  let n = 0;
  for (let i = s; i <= e; i++) n += 7 + Math.min(lines[i - 1].length, 2000) + 1;
  return { chars: n + 40, from: s, to: e }; // +40: system-reminder / header overhead
}
function loadCorpus(repo) {
  return listIndexableFiles(root(repo)).then((fl) => {
    const files = [];
    for (const f of fl.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
      const buf = fs.readFileSync(f.abs);
      if (isBinary(buf)) continue;
      const text = buf.toString('utf8');
      const lines = text.split('\n'); if (lines[lines.length - 1] === '') lines.pop();
      files.push({ rel: f.rel, lines, lower: text.toLowerCase() });
    }
    return files;
  });
}
function keywords(q, files) {
  if (q.type === 'identifier') return [q.name];
  const text = q.kwQuery ?? q.q;
  const words = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)))];
  const scored = words.map((w) => ({ w, df: files.filter((f) => f.lower.includes(w)).length })).filter((x) => x.df > 0);
  scored.sort((a, b) => a.df - b.df || b.w.length - a.w.length || (a.w < b.w ? -1 : 1));
  return scored.slice(0, 3).map((x) => x.w);
}
function grep(files, kws) {
  if (!kws.length) return { matches: [], filesOut: 'No files found' };
  const re = new RegExp(kws.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const matches = []; // per file: {rel, lines:[idx]}
  for (const f of files) {
    const hit = [];
    f.lines.forEach((l, i) => { if (re.test(l)) hit.push(i + 1); });
    if (hit.length) matches.push({ f, hit });
  }
  const filesOut = matches.length ? `Found ${matches.length} files\n${matches.slice(0, MAX_FILES_LISTED).map((m) => m.f.rel).join('\n')}` : 'No files found';
  return { matches, filesOut };
}
function grepContentChars(matches) {
  const out = [];
  for (const m of matches) for (const i of m.hit) { out.push(`${m.f.rel}:${i}:${m.f.lines[i - 1].slice(0, 500)}`); if (out.length >= MAX_GREP_LINES) return out.join('\n').length + 60; }
  return out.join('\n').length + 60;
}

function baselines(q, files) {
  const kws = keywords(q, files);
  const g = grep(files, kws);
  const base = tok(g.filesOut); // files_with_matches
  const contentTok = tok('x'.repeat(g.matches.length ? grepContentChars(g.matches) : 14));
  const ranked = [...g.matches].sort((a, b) => b.hit.length - a.hit.length || (a.f.rel < b.f.rel ? -1 : 1)).slice(0, MAX_FILES);
  const globTok = tok(files.slice(0, 100).map((f) => f.rel).join('\n'));
  // A: read whole files in match-count order until the target file is read
  let A = { tokens: base + contentTok, calls: 2, found: false };
  let chars = 0;
  for (const m of ranked) {
    const r = readOut(m.f.lines, 1, 2000); chars += r.chars; A.calls++;
    if (m.f.rel === q.file) {
      if (overlap(r.from, r.to, q.start, q.end)) { A.found = true; break; }
      const r2 = readOut(m.f.lines, q.start - 20, q.start + 1979); chars += r2.chars; A.calls++; A.found = true; break; // follow-up read at offset
    }
  }
  A.tokens += Math.ceil(chars / 4);
  if (!A.found) { A.tokens += globTok; A.calls++; }
  // B: 120-line windows around matches (<=3 per file), files in match-count order
  let B = { tokens: base + contentTok, calls: 2, found: false };
  chars = 0;
  outer: for (const m of ranked) {
    let read = []; let w = 0;
    for (const i of m.hit) {
      if (w >= MAX_WINDOWS_PER_FILE) break;
      if (read.some(([a, b]) => i >= a && i <= b)) continue;
      const from = Math.max(1, i - WINDOW / 2), r = readOut(m.f.lines, from, from + WINDOW - 1);
      read.push([r.from, r.to]); w++; chars += r.chars; B.calls++;
      if (m.f.rel === q.file && overlap(r.from, r.to, q.start, q.end)) { B.found = true; break outer; }
    }
  }
  B.tokens += Math.ceil(chars / 4);
  if (!B.found) { B.tokens += globTok; B.calls++; }
  return { A, B, kws };
}

// ---------- main ----------
const embedder = await createEmbedder({ modelsDir: MODELS, allowDownload: false });
const rows = [];
const indexInfo = JSON.parse(fs.readFileSync(path.join(RES, 'code-index.json'), 'utf8'));
const tags = { express: 'v5.3.0', flask: '3.1.3', gin: 'v1.12.0', ripgrep: '15.2.0', remember: 'working copy (excl. node_modules)' };

for (const repo of REPOS.filter((r) => !process.env.ONLY || process.env.ONLY.split(',').includes(r))) {
  const files = await loadCorpus(repo);
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const queries = JSON.parse(fs.readFileSync(path.join(here, `queries/${repo}.json`), 'utf8'));
  // multilingual: the baseline agent greps with the English twin's keywords (a bilingual agent would translate)
  for (const q of queries) if (q.type === 'multilingual') {
    const tw = queries.find((x) => x.type === 'natural' && x.file === q.file && x.start === q.start);
    if (tw) { q.kwQuery = tw.q; q.translation = tw.q; }
  }
  const store = openStore(path.join(INDEX, repo, 'index.db'));
  for (const q of queries) {
    const { A, B, kws } = baselines(q, files);
    const mode = process.env.TRANSLATE ?? 'both'; // none | only | both: how a translated question is passed
    const qq = q.translation && mode === 'only' ? q.translation : q.q;
    const tr = q.translation && mode === 'both' ? q.translation : undefined;
    const results = await search({ store, embedder, root: root(repo), query: qq, translation: tr, limit: 8 });
    const formatted = formatResults(results);
    const searchTok = tok(formatted);
    // only results that survive formatResults' output cap count as seen
    const shown = [...formatted.matchAll(/^\[(\d+)\] (\S+?):(\d+)-(\d+)/gm)].map((m) => ({ rank: +m[1], file: m[2], s: +m[3], e: +m[4] }));
    const hitIdx = shown.findIndex((r) => r.file === q.file && overlap(r.s, r.e, q.start, q.end));
    const hit1 = shown.length > 0 && shown[0].file === q.file && overlap(shown[0].s, shown[0].e, q.start, q.end);
    let R;
    if (hitIdx >= 0) {
      const h = shown[hitIdx], lines = byRel.get(h.file).lines;
      const r = readOut(lines, h.s - PAD, h.e + PAD);
      R = { tokens: searchTok + Math.ceil(r.chars / 4), calls: 2, found: true, fallback: false };
    } else {
      R = { tokens: searchTok + A.tokens, calls: 1 + A.calls, found: A.found, fallback: true };
    }
    rows.push({ id: q.id, repo, type: q.type, lang: q.lang ?? null, q: q.q, target: `${q.file}:${q.start}-${q.end}`, kws,
      hit1, hit8: hitIdx >= 0, rank: hitIdx >= 0 ? hitIdx + 1 : null, searchTokens: searchTok, shown: shown.length,
      A, B, R });
  }
  store.close();
  console.log(repo, queries.length, 'queries');
}
await embedder.dispose();

// ---------- summary ----------
const sum = (a) => a.reduce((x, y) => x + y, 0), mean = (a) => (a.length ? sum(a) / a.length : 0);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const f0 = (x) => Math.round(x).toLocaleString('en-US');
function stats(rs) {
  const A = rs.map((r) => r.A.tokens), B = rs.map((r) => r.B.tokens), R = rs.map((r) => r.R.tokens);
  return {
    n: rs.length, hit1: mean(rs.map((r) => +r.hit1)), hit8: mean(rs.map((r) => +r.hit8)),
    foundA: mean(rs.map((r) => +r.A.found)), foundB: mean(rs.map((r) => +r.B.found)),
    medA: median(A), medB: median(B), medR: median(R), meanA: mean(A), meanB: mean(B), meanR: mean(R),
    savedA: 1 - sum(R) / sum(A), savedB: 1 - sum(R) / sum(B),
    callsA: mean(rs.map((r) => r.A.calls)), callsB: mean(rs.map((r) => r.B.calls)), callsR: mean(rs.map((r) => r.R.calls)),
  };
}
const line = (label, s) => `| ${label} | ${s.n} | ${pct(s.hit1)} | ${pct(s.hit8)} | ${pct(s.foundA)}/${pct(s.foundB)} | ${f0(s.medA)} / ${f0(s.meanA)} | ${f0(s.medB)} / ${f0(s.meanB)} | ${f0(s.medR)} / ${f0(s.meanR)} | ${pct(s.savedA)} | ${pct(s.savedB)} | ${s.callsA.toFixed(1)} / ${s.callsB.toFixed(1)} / ${s.callsR.toFixed(1)} |`;
const header = '| group | n | hit@1 | hit@8 | A/B found | A tok med/mean | B tok med/mean | remember tok med/mean | saved vs A | saved vs B | calls A/B/R |\n|---|---|---|---|---|---|---|---|---|---|---|';
const types = ['identifier', 'docstring', 'vague', 'natural', 'multilingual'];
const sel = (repo, type) => rows.filter((r) => (!repo || r.repo === repo) && (!type || r.type === type));
let md = `# Code-search token simulation\n\nTokens = ceil(chars/4) of simulated tool output. A = Grep + whole-file Reads (max 5 files); B = Grep + 120-line window Reads; remember = search() then Read hit +/-15 lines, else fallback to A (search cost wasted). Oracle assumptions: the agent stops once it has read the target, and picks the correct hit among the 8 results. "saved" = 1 - total remember tokens / total baseline tokens. hit@k is plugin recall (chunk overlapping the target range, among results that survive formatResults' 6000-char cap).\n\n## Corpora and index\n\n| repo | version | files indexed | chunks | build s |\n|---|---|---|---|---|\n`;
for (const r of REPOS.filter((x) => indexInfo[x])) md += `| ${r} | ${tags[r]} | ${indexInfo[r].files} | ${indexInfo[r].chunks} | ${indexInfo[r].buildSeconds} |\n`;
md += `\n## Overall\n\n${header}\n${line('ALL', stats(rows))}\n`;
for (const t of types) if (sel(null, t).length) md += `${line(t, stats(sel(null, t)))}\n`;
md += `\n## Per repo\n\n${header}\n`;
for (const r of REPOS) md += `${line(r, stats(sel(r)))}\n`;
md += `\n## Per repo x query type\n\n${header}\n`;
for (const r of REPOS) for (const t of types) if (sel(r, t).length) md += `${line(`${r} / ${t}`, stats(sel(r, t)))}\n`;
// loss analysis
const fallbacks = rows.filter((r) => r.R.fallback);
const lossRows = rows.filter((r) => r.R.tokens > r.A.tokens);
const lossB = rows.filter((r) => r.R.tokens > r.B.tokens);
md += `\n## Loss analysis\n\n- remember falls back to baseline A in ${fallbacks.length}/${rows.length} queries (${pct(fallbacks.length / rows.length)}).\n- remember costs more than A in ${lossRows.length} queries, more than B in ${lossB.length} queries (${pct(lossB.length / rows.length)}).\n- Queries where baseline A never found the target: ${rows.filter((r) => !r.A.found).length}; B: ${rows.filter((r) => !r.B.found).length}; remember (incl. fallback): ${rows.filter((r) => !r.R.found).length}.\n`;
const totalA = sum(rows.map((r) => r.A.tokens)), totalB = sum(rows.map((r) => r.B.tokens)), totalR = sum(rows.map((r) => r.R.tokens));
md += `- Total tokens over ${rows.length} queries: A ${f0(totalA)}, B ${f0(totalB)}, remember ${f0(totalR)}.\n`;
if (fs.existsSync(path.join(here, 'findings.md'))) md += `\n${fs.readFileSync(path.join(here, 'findings.md'), 'utf8')}\n`;
fs.writeFileSync(path.join(RES, 'code-summary.md'), md);
fs.writeFileSync(path.join(RES, 'code-results.json'), JSON.stringify({ corpora: tags, index: indexInfo, rows }, null, 1));
const all = stats(rows);
console.log(`ALL n=${all.n} hit1=${pct(all.hit1)} hit8=${pct(all.hit8)} savedA=${pct(all.savedA)} savedB=${pct(all.savedB)}`);
