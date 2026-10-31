import fs from 'node:fs';
import path from 'node:path';

const KINDS = { all: ['file', 'chat', 'note'], files: ['file'], chats: ['chat'], notes: ['note'] };
const TOP = 50;
const RRF_K = 60;
const NOTE_BOOST = 1.5;
const SNIPPET_MAX = 600;
const OUTPUT_MAX = 6000;
const DEF_BOOST = 1.5;
const TEST_PENALTY = 0.75;
const RECENCY_BOOST = 0.05;

// Question words that match almost every chunk and drown out the real keywords.
const STOPWORDS = new Set(`a about all an and any are as at be by can could did do does doing done for from get gets
has have how i if in into is it its me my of on or our should show so that the their them then there these this
those to us was we were what when where which who why will with would you your defined define definition
implemented implement implementation located find code function method handle handled handles happen happens
work works use used uses`.split(/\s+/));

// snake_case, camelCase, PascalCase with an inner capital, or digits: almost certainly a name in code.
const isCodeName = (t) => t.length > 2 && /[_\d]|\p{Lu}/u.test(t.slice(1));
const words = (q) => String(q ?? '').match(/[\p{L}\p{N}_]+/gu) ?? [];

/**
 * Words worth matching. For code lookups (a code-like name, or "defined"/"implemented") question words
 * are dropped; plain-language questions keep every word, which recalls chats and notes better.
 */
function keywords(q) {
  const all = words(q);
  if (!all.some(isCodeName) && !/\b(?:defined|definition|declared|implemented)\b/i.test(String(q))) return all;
  const kept = all.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  return kept.length ? kept : all;
}

export function toFtsQuery(q) {
  const toks = keywords(q);
  if (!toks.length) return null;
  return toks.map((t) => `"${t}"`).join(' OR ');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DEF_KEYWORDS = 'function|def|class|fn|func|type|struct|interface|enum|trait|impl|const|let|var|macro_rules!';

/**
 * Regex matching a line that defines a name the query asks about, or null. Names are words that
 * look like code (snake_case, camelCase, PascalCase, digits), or the only word left in a short lookup.
 */
function definitionRe(q) {
  const kw = keywords(q);
  const names = kw.filter((t) => t.length > 2 && (kw.length === 1 || /[_\d]|\p{Lu}/u.test(t)));
  if (!names.length) return null;
  const n = names.map(escapeRe).join('|');
  return new RegExp(
    `(?:^|\\n)[^\\n]*\\b(?:${DEF_KEYWORDS})\\s+(?:\\([^)]*\\)\\s*)?\\*?(?:${n})\\b`
    + `|(?:^|\\n)\\s*(?:export\\s+)?(?:[\\w.]+\\.)?(?:${n})\\s*[=:]\\s*(?:async\\s+)?(?:function|\\(|[\\w]+\\s*=>)`,
  );
}

const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|specs?|testdata)\/|[._-](?:test|spec)s?\.[^/]+$|(?:^|\/)test_[^/]+$/i;

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function isStale(store, root, r) {
  if (r.kind !== 'file') return false;
  const src = store.getSource(r.sourceKey);
  if (!src) return true;
  try {
    const st = fs.statSync(path.join(root, ...r.loc.split('/')));
    return st.mtimeMs !== src.mtimeMs || st.size !== src.size;
  } catch {
    return true;
  }
}

/**
 * Hybrid search. `translation` is the same question in the language of the code (usually English),
 * written by Claude when the user asked in another language; both wordings are searched and fused.
 */
export async function search({ store, embedder, root, query, translation, scope = 'all', limit = 8 }) {
  const kinds = KINDS[scope] ?? KINDS.all;
  const queries = [...new Set([query, translation].map((q) => String(q ?? '').trim()).filter(Boolean))];
  const scores = new Map();
  const add = (ids) => ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
  const vectors = embedder && queries.length ? store.vectors(kinds) : [];

  for (const text of queries) {
    if (embedder) {
      try {
        const q = await embedder.embedQuery(text);
        const ranked = vectors
          .map((v) => ({ id: v.id, s: dot(q, v.vector) }))
          .sort((a, b) => b.s - a.s || a.id - b.id)
          .slice(0, TOP);
        add(ranked.map((r) => r.id));
      } catch {
        // semantic leg is best effort
      }
    }
    const match = toFtsQuery(text);
    if (match) {
      try {
        add(store.fts(match, kinds, TOP).map((h) => h.id));
      } catch {
        // invalid MATCH: keyword results empty
      }
    }
  }
  if (!scores.size) return [];
  query = queries.join('\n');

  const rows = new Map(store.getChunks([...scores.keys()]).map((r) => [r.id, r]));
  const defRe = definitionRe(query);
  const askedForTests = /\b(?:tests?|specs?)\b/i.test(String(query));
  const chatTimes = [...rows.values()].filter((r) => r.kind === 'chat').map((r) => Date.parse(r.date)).filter(Number.isFinite);
  const tMin = Math.min(...chatTimes);
  const tSpan = Math.max(...chatTimes) - tMin;
  const out = [];
  for (const [id, base] of scores) {
    const r = rows.get(id);
    if (!r) continue;
    let score = base;
    if (r.kind === 'note') score *= NOTE_BOOST;
    if (r.kind === 'file') {
      if (defRe && defRe.test(r.text)) score *= DEF_BOOST;
      if (!askedForTests && TEST_PATH.test(r.loc)) score *= TEST_PENALTY;
    }
    if (r.kind === 'chat' && tSpan > 0) {
      // Newer chats win ties: a later decision usually replaces an earlier one.
      const t = Date.parse(r.date);
      if (Number.isFinite(t)) score *= 1 + RECENCY_BOOST * ((t - tMin) / tSpan);
    }
    out.push({
      kind: r.kind, loc: r.loc, startLine: r.startLine, endLine: r.endLine, text: r.text, date: r.date,
      score, stale: isStale(store, root, r), _id: id,
    });
  }
  out.sort((a, b) => b.score - a.score || a._id - b._id);
  return out.slice(0, limit).map(({ _id, ...r }) => r);
}

function fmtDate(d) {
  if (d == null || d === '') return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

function snippet(text) {
  let s = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n\n').trim();
  if (s.length > SNIPPET_MAX) {
    let end = SNIPPET_MAX;
    const c = s.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--;
    s = s.slice(0, end) + '…';
  }
  return s;
}

export function formatResults(results, { status = null, semantic = true } = {}) {
  const head = [];
  if (status && status.phase === 'building') {
    head.push(`Index still building (${status.done ?? 0}/${status.total ?? 0}) — results may be incomplete.`);
  }
  if (!semantic) head.push('Semantic search not ready yet (model downloading) — keyword results only.');
  if (!results.length) return [...head, 'No matches in the knowledge base.'].join('\n');

  let out = head.join('\n');
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const date = fmtDate(r.date);
    const d = date ? ` (${date})` : '';
    let label;
    if (r.kind === 'file') label = `[${i + 1}] ${r.loc}:${r.startLine}-${r.endLine}`;
    else if (r.kind === 'note') label = `[${i + 1}] note "${r.loc}"${d}`;
    else label = `[${i + 1}] ${r.loc}${d}`;
    if (r.stale) label += ' — CHANGED SINCE INDEXED, re-read before trusting';
    const block = `${label}\n${snippet(r.text)}`;
    const next = out ? `${out}\n\n${block}` : block;
    if (next.length > OUTPUT_MAX) break;
    out = next;
  }
  return out;
}
