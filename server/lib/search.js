import fs from 'node:fs';
import path from 'node:path';

const KINDS = { all: ['file', 'chat', 'note'], files: ['file'], chats: ['chat'], notes: ['note'] };
const TOP = 50;
const RRF_K = 60;
const NOTE_BOOST = 1.5;
const SNIPPET_MAX = 600;
const OUTPUT_MAX = 6000;

export function toFtsQuery(q) {
  const toks = String(q ?? '').match(/[\p{L}\p{N}_]+/gu);
  if (!toks) return null;
  return toks.map((t) => `"${t}"`).join(' OR ');
}

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

export async function search({ store, embedder, root, query, scope = 'all', limit = 8 }) {
  const kinds = KINDS[scope] ?? KINDS.all;
  const scores = new Map();
  const add = (ids) => ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1)));

  if (embedder && String(query ?? '').trim()) {
    try {
      const q = await embedder.embedQuery(query);
      const ranked = store.vectors(kinds)
        .map((v) => ({ id: v.id, s: dot(q, v.vector) }))
        .sort((a, b) => b.s - a.s || a.id - b.id)
        .slice(0, TOP);
      add(ranked.map((r) => r.id));
    } catch {
      // semantic leg is best effort
    }
  }

  const match = toFtsQuery(query);
  if (match) {
    try {
      add(store.fts(match, kinds, TOP).map((h) => h.id));
    } catch {
      // invalid MATCH: keyword results empty
    }
  }
  if (!scores.size) return [];

  const rows = new Map(store.getChunks([...scores.keys()]).map((r) => [r.id, r]));
  const out = [];
  for (const [id, base] of scores) {
    const r = rows.get(id);
    if (!r) continue;
    out.push({
      kind: r.kind, loc: r.loc, startLine: r.startLine, endLine: r.endLine, text: r.text, date: r.date,
      score: r.kind === 'note' ? base * NOTE_BOOST : base,
      stale: isStale(store, root, r), _id: id,
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
