import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  hash TEXT,
  mtime_ms REAL,
  size INTEGER
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL REFERENCES sources(key) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  loc TEXT,
  start_line INTEGER,
  end_line INTEGER,
  text TEXT NOT NULL,
  date TEXT,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source_key);
CREATE INDEX IF NOT EXISTS chunks_kind ON chunks(kind);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize = "unicode61 tokenchars '_'"
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE OF text ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
`;

class CorruptError extends Error {}
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/** True only for errors that mean the file itself is damaged (never busy/locked/IO). */
function isCorruption(e) {
  if (e instanceof CorruptError) return true;
  if (e?.errcode === SQLITE_CORRUPT || e?.errcode === SQLITE_NOTADB) return true;
  return /file is not a database|malformed|corrupt/i.test(String(e?.message));
}

function tryOpen(dbPath, busyTimeoutMs) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs) | 0}`);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;');
    const qc = db.prepare('PRAGMA quick_check').get();
    if (!qc || Object.values(qc)[0] !== 'ok') throw new CorruptError('quick_check failed');
    db.exec(SCHEMA);
    return db;
  } catch (e) {
    try { db.close(); } catch { /* ignore */ }
    throw e;
  }
}

function removeDbFiles(dbPath) {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ }
  }
}

const toVec = (blob) => {
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
};
const toBlob = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const marks = (n) => Array.from({ length: n }, () => '?').join(',');

/**
 * Open (creating or recovering) the index database. The file is deleted and rebuilt only
 * when it is really corrupt; busy/locked errors are rethrown after `busyTimeoutMs`.
 */
export function openStore(dbPath, { busyTimeoutMs = 5000 } = {}) {
  let db;
  try {
    db = tryOpen(dbPath, busyTimeoutMs);
  } catch (e) {
    if (!isCorruption(e)) throw e;
    removeDbFiles(dbPath);
    db = tryOpen(dbPath, busyTimeoutMs);
  }

  const q = {
    getSource: db.prepare('SELECT key, kind, hash, mtime_ms AS mtimeMs, size FROM sources WHERE key = ?'),
    upsertSource: db.prepare(
      'INSERT INTO sources(key, kind, hash, mtime_ms, size) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, hash=excluded.hash, mtime_ms=excluded.mtime_ms, size=excluded.size'),
    delChunks: db.prepare('DELETE FROM chunks WHERE source_key = ?'),
    insChunk: db.prepare(
      'INSERT INTO chunks(source_key, kind, loc, start_line, end_line, text, date, embedding) VALUES (?,?,?,?,?,?,?,?)'),
    touch: db.prepare('UPDATE sources SET mtime_ms = ?, size = ? WHERE key = ?'),
    delSource: db.prepare('DELETE FROM sources WHERE key = ?'),
    keysByLoc: db.prepare("SELECT DISTINCT source_key AS key FROM chunks WHERE kind = 'chat' AND loc = ?"),
    listKeys: db.prepare('SELECT key FROM sources WHERE kind = ? ORDER BY key'),
    missing: db.prepare('SELECT id, kind, loc, text FROM chunks WHERE embedding IS NULL ORDER BY id LIMIT ?'),
    setEmb: db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?'),
    count: db.prepare('SELECT kind, COUNT(*) AS n FROM sources GROUP BY kind'),
    chunkCount: db.prepare('SELECT COUNT(*) AS n FROM chunks'),
    unembedded: db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NULL'),
  };
  const dynamic = new Map();
  const prep = (sql) => {
    let st = dynamic.get(sql);
    if (!st) { st = db.prepare(sql); dynamic.set(sql, st); }
    return st;
  };

  const tx = (fn) => {
    db.exec('BEGIN');
    try { fn(); db.exec('COMMIT'); } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  };

  return {
    getSource(key) {
      const r = q.getSource.get(key);
      return r ? { ...r } : undefined;
    },

    replaceSource(s, chunks) {
      tx(() => {
        q.upsertSource.run(s.key, s.kind, s.hash, s.mtimeMs, s.size);
        q.delChunks.run(s.key);
        for (const c of chunks) {
          q.insChunk.run(s.key, s.kind, c.loc ?? null, c.startLine ?? null, c.endLine ?? null,
            c.text, c.date ?? null, c.embedding ? toBlob(c.embedding) : null);
        }
      });
    },

    deleteSource(key) { q.delSource.run(key); },
    chatKeysByLoc: (loc) => q.keysByLoc.all(loc).map((r) => r.key),
    listSourceKeys: (kind) => q.listKeys.all(kind).map((r) => r.key),
    chunksMissingEmbeddings: (limit) => q.missing.all(limit).map((r) => ({ id: r.id, kind: r.kind, loc: r.loc, text: r.text })),
    touchSource(key, mtimeMs, size) { q.touch.run(mtimeMs, size, key); },
    setEmbedding(id, v) { q.setEmb.run(toBlob(v), id); },

    vectors(kinds) {
      if (!kinds.length) return [];
      return prep(`SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL AND kind IN (${marks(kinds.length)})`)
        .all(...kinds).map((r) => ({ id: r.id, vector: toVec(r.embedding) }));
    },

    fts(match, kinds, limit) {
      if (!kinds.length || !match) return [];
      return prep(
        `SELECT c.id AS id FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid ` +
        `WHERE chunks_fts MATCH ? AND c.kind IN (${marks(kinds.length)}) ORDER BY bm25(chunks_fts), c.id LIMIT ?`)
        .all(match, ...kinds, limit).map((r) => ({ id: r.id }));
    },

    /** Existing embeddings of a source's chunks, by chunk text, so unchanged chunks are not re-embedded. */
    embeddingsByText(key) {
      const out = new Map();
      for (const r of prep('SELECT text, embedding FROM chunks WHERE source_key = ? AND embedding IS NOT NULL').all(key)) {
        out.set(r.text, toVec(r.embedding));
      }
      return out;
    },

    getChunks(ids) {
      if (!ids.length) return [];
      return prep(
        'SELECT id, kind, source_key AS sourceKey, loc, start_line AS startLine, end_line AS endLine, text, date ' +
        `FROM chunks WHERE id IN (${marks(ids.length)})`).all(...ids).map((r) => ({ ...r }));
    },

    counts() {
      const out = { file: 0, chat: 0, note: 0, chunks: 0, unembedded: 0 };
      for (const r of q.count.all()) if (r.kind in out) out[r.kind] = r.n;
      out.chunks = q.chunkCount.get().n;
      out.unembedded = q.unembedded.get().n;
      return out;
    },

    close() { db.close(); },
  };
}
