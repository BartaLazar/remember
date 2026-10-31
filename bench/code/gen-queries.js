// Generates queries/<repo>.json: auto (identifier/docstring/vague, from parsed definitions) + hand-written (natural/multilingual).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPOS, root } from './common.js';

const here = import.meta.dirname;
const N_AUTO = 40;
const STOP = new Set('the a an of to in on for and or is are be as it its this that these those with by from at which when if not can will may should must into than then also any each all more most such used uses use using returns return given gets get set sets whether does do has have was were been being their there they you your other only both one two'.split(' '));

function rng(seed) { // mulberry32
  let a = [...seed].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const indent = (s) => s.match(/^\s*/)[0].length;

/** End line (0-based, inclusive) of the construct starting at line i. */
export function endOf(lines, i, mode) {
  const ind = indent(lines[i]);
  let j = i;
  if (mode === 'py') {
    while (j < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[j])) j++; // signature may span lines
    let last = j;
    for (let k = j + 1; k < lines.length; k++) {
      if (lines[k].trim() === '') continue;
      if (indent(lines[k]) <= ind) break;
      last = k;
    }
    return last;
  }
  if (/[;)]\s*$/.test(lines[i]) && !/[{(]\s*$/.test(lines[i]) && !/\{|\(/.test(lines[i].slice(-3))) { /* single-line decl */ }
  for (let k = i + 1; k < lines.length; k++) {
    if (indent(lines[k]) <= ind && /^\s*[}\])]/.test(lines[k]) && /^\s*\}/.test(lines[k])) return k;
  }
  return Math.min(lines.length - 1, i + 40);
}

const isTest = (f) => /(^|\/)(tests?|__tests__|fuzz|benchsuite|examples?|docs?|testdata|ci|scripts)(\/|$)|_test\.go$|\.test\.js$|test_[^/]*\.py$/.test(f);
const LANG = { '.js': 'js', '.py': 'py', '.go': 'go', '.rs': 'rs' };

function parseFile(rel, text) {
  const lang = LANG[path.extname(rel)];
  if (!lang) return [];
  const lines = text.split('\n');
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (lang === 'rs' && /^#\[cfg\(test\)\]/.test(L)) break; // skip inline test modules
    let m, name, mode = 'brace';
    if (lang === 'js') {
      m = L.match(/^(?:[\w$]+\.)+([\w$]+)\s*=\s*function\s*([\w$]*)\s*\(/) || L.match(/^(?:async\s+)?function\s+([\w$]+)\s*\(/) || L.match(/^export\s+(?:async\s+)?function\s+([\w$]+)\s*\(/) || L.match(/^(?:export\s+)?class\s+([\w$]+)/);
      if (m) name = (m[2] || m[1]);
    } else if (lang === 'go') {
      m = L.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)\s*[(\[]/) || L.match(/^type\s+(\w+)\s+(?:struct|interface)/);
      if (m) name = m[1];
    } else if (lang === 'rs') {
      m = L.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)/) || L.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/);
      if (m) name = m[1];
    } else if (lang === 'py') {
      m = L.match(/^\s*(?:async\s+)?def\s+(\w+)/) || L.match(/^\s*class\s+(\w+)/);
      if (m) name = m[1];
      mode = 'py';
    }
    if (!name) continue;
    // doc comment
    let doc = null, start = i;
    if (lang === 'py') {
      let j = i; while (j < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[j])) j++;
      const d = lines[j + 1]?.trim() ?? '';
      const q = d.match(/^[rR]?("""|''')(.*)$/);
      if (q) {
        let buf = [q[2]]; let k = j + 1;
        if (!q[2].includes(q[1])) { while (++k < lines.length && !lines[k].includes(q[1])) buf.push(lines[k].trim()); buf.push((lines[k] ?? '').split(q[1])[0].trim()); }
        else buf = [q[2].split(q[1])[0]];
        doc = buf.join(' ');
      }
    } else {
      let k = i - 1;
      if (lang === 'js' && k >= 0 && lines[k].trim() === '') k--;
      while (k >= 0 && /^\s*#\[/.test(lines[k]) && lang === 'rs') k--;
      const buf = [];
      while (k >= 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[k])) { buf.unshift(lines[k].replace(/^\s*(\/\/\/?|\/\*\*?|\*\/|\*)\s?/, '').replace(/\*\/\s*$/, '')); start = k; k--; }
      if (buf.length) doc = buf.join('\n');
    }
    if (!doc) continue;
    const end = Math.min(endOf(lines, i, mode), start + 150);
    defs.push({ name, file: rel, start: start + 1, end: end + 1, doc });
  }
  return defs;
}

/** First sentence of a doc, minus the identifier and code-looking tokens. */
function docQuery(def) {
  let d = def.doc.replace(/\r/g, '');
  d = d.split(/\n\s*\n|\n\s*(?:@|:param|Example|Usage|\.\. )/)[0].replace(/\s+/g, ' ').trim();
  const sm = d.match(/^(.*?[.!?])(\s|$)/); if (sm) d = sm[1];
  d = d.replace(/:\w+:`[^`]*`|`[^`]*`/g, ' ');
  const words = d.split(/\s+/).filter((w) => {
    const bare = w.replace(/[^\w.$()<>/\\-]/g, '');
    if (!bare) return false;
    if (bare.toLowerCase() === def.name.toLowerCase()) return false;
    if (/[_$()<>.\\/]/.test(bare.replace(/\.$/, ''))) return false;
    if (/[a-z][A-Z]/.test(bare)) return false;
    return true;
  }).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  if (words.length < 5) return null;
  return words.join(' ');
}
function vagueQuery(dq) {
  const seen = new Set(); const out = [];
  for (const w of dq.toLowerCase().split(/\s+/)) {
    if (w.length < 4 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w); out.push(w);
    if (out.length === 4) break;
  }
  return out.length >= 3 ? out.join(' ') : null;
}

const spec = JSON.parse(fs.readFileSync(path.join(here, 'queries/hand-spec.json'), 'utf8'));
const summary = {};
for (const repo of REPOS) {
  const rt = root(repo);
  const files = execFileSync('git', ['-C', rt, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
  const all = [];
  for (const f of files) {
    if (isTest(f) || !LANG[path.extname(f)]) continue;
    let text; try { text = fs.readFileSync(path.join(rt, f), 'utf8'); } catch { continue; }
    if (text.length > 1e6) continue;
    all.push(...parseFile(f, text));
  }
  // names defined anywhere (docs or not) count for uniqueness
  const nameCount = new Map();
  for (const f of files) {
    if (!LANG[path.extname(f)]) continue;
    let text; try { text = fs.readFileSync(path.join(rt, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(/(?:\bfn|\bdef|\bfunc(?:\s*\([^)]*\))?|\bfunction|\bclass|\btype|\bstruct|\benum|\btrait)\s+([A-Za-z_]\w*)/g)) nameCount.set(m[1], (nameCount.get(m[1]) ?? 0) + 1);
  }
  const eligible = all.filter((d) => d.name.length >= 5 && nameCount.get(d.name) === 1 && docQuery(d));
  const rand = rng(repo);
  for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]]; }
  const picked = eligible.slice(0, N_AUTO);
  const qs = [];
  for (const d of picked) {
    const base = { repo, file: d.file, start: d.start, end: d.end, name: d.name };
    const dq = docQuery(d);
    qs.push({ id: `${repo}:id:${d.name}`, type: 'identifier', q: `where is ${d.name} defined`, ...base });
    qs.push({ id: `${repo}:doc:${d.name}`, type: 'docstring', q: dq, ...base });
    const vq = vagueQuery(dq);
    if (vq) qs.push({ id: `${repo}:vague:${d.name}`, type: 'vague', q: vq, ...base });
  }
  // hand-written
  let n = 0;
  for (const h of spec[repo] ?? []) {
    const lines = fs.readFileSync(path.join(rt, h.file), 'utf8').split('\n');
    const re = new RegExp(h.from);
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) throw new Error(`hand anchor not found: ${repo} ${h.file} ${h.from}`);
    const e = endOf(lines, i, h.end);
    console.log(`[${repo}] ${h.file}:${i + 1}-${e + 1} | ${lines[i].trim().slice(0, 60)} .. ${lines[e].trim().slice(0, 20)}`);
    qs.push({ id: `${repo}:hand:${++n}`, repo, type: h.lang ? 'multilingual' : 'natural', lang: h.lang, q: h.q, file: h.file, start: i + 1, end: e + 1 });
  }
  fs.writeFileSync(path.join(here, `queries/${repo}.json`), JSON.stringify(qs, null, 1));
  summary[repo] = { defsWithDocs: all.length, eligible: eligible.length, sampled: picked.length, queries: qs.length };
}
console.log(summary);
