import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { importDep } from './deps.js';
import { transcriptFiles } from './project.js';
import { activeNotes, readNotes, readExclusions, isOff, isBlocked, readStatus, writeStatus, readConfig } from './userdata.js';
import { listIndexableFiles, isBinary } from './files.js';
import { chunkText, splitLong } from './chunk.js';
import { parseTranscript } from './transcripts.js';

const BATCH = 32;
const PROGRESS_EVERY = 20;

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/** Delete sources matching exclusion patterns (files) or excluded sessions (chats); returns how many. */
export async function purgeExcluded(store, root, exclusions) {
  const { patterns = [], sessions = [] } = exclusions ?? {};
  let removed = 0;
  if (patterns.length) {
    const ig = (await importDep('ignore')).default().add(patterns);
    for (const key of store.listSourceKeys('file')) {
      if (ig.ignores(key.slice('file:'.length))) { store.deleteSource(key); removed++; }
    }
  }
  for (const id of sessions) {
    const keys = new Set([`chat:${id}`, ...store.chatKeysByLoc(`chat ${id}`)]);
    for (const key of keys) {
      if (store.getSource(key)) { store.deleteSource(key); removed++; }
    }
  }
  return removed;
}

/**
 * Exclusions re-read whenever exclusions.json changes (checked by mtime/size), so a `forget`
 * issued during a long build takes effect before the next source is written.
 */
async function liveExclusions(dataDir) {
  const ignore = (await importDep('ignore')).default;
  const target = path.join(dataDir, 'exclusions.json');
  let stamp;
  let ig = null;
  let sessions = new Set();
  const refresh = () => {
    let now = 'none';
    try { const st = fs.statSync(target); now = `${st.mtimeMs}:${st.size}`; } catch { /* missing */ }
    if (now === stamp) return;
    const ex = readExclusions(dataDir);
    ig = ex.patterns.length ? ignore().add(ex.patterns) : null;
    sessions = new Set(ex.sessions);
    stamp = now;
  };
  refresh();
  return {
    file: (rel) => { refresh(); return !!ig && ig.ignores(rel); },
    session: (ids) => { refresh(); return ids.some((id) => sessions.has(id)); },
  };
}

/** True if abs resolves to a real path inside the real project root. */
function insideRoot(realRoot, abs) {
  try {
    const r = fs.realpathSync.native(abs);
    return r.startsWith(realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep);
  } catch { return false; }
}

/**
 * One indexing pass. `paths` refreshes just those files; `only: 'files'` scans every file but skips
 * chats and notes; `only: 'chats'` refreshes chats and notes only. Neither runs before the first build.
 */
export async function runIndex({ root, dataDir, store, embedder, paths, only, force = false, projectsDir } = {}) {
  if (isOff(dataDir)) return { phase: 'idle', message: 'off', done: 0, total: 0, updatedAt: Date.now() };

  if ((paths || only) && !force) {
    const cur = readStatus(dataDir);
    if (store.counts().file === 0 || cur?.phase === 'needs-confirmation' || cur?.phase === 'blocked') {
      return cur ?? { phase: 'idle', done: 0, total: 0, updatedAt: Date.now() };
    }
  }

  const setStatus = (phase, done, total, message) => {
    const s = { phase, done, total, updatedAt: Date.now() };
    if (message) s.message = message;
    writeStatus(dataDir, s);
    return s;
  };

  if (!force && isBlocked(root, dataDir)) {
    return setStatus('blocked', 0, 0, 'Project root is too broad to index automatically.');
  }

  try {
    const exclusions = readExclusions(dataDir);
    await purgeExcluded(store, root, exclusions);
    const live = await liveExclusions(dataDir);

    const realRoot = fs.realpathSync.native(root);
    const { maxFiles } = readConfig();
    if (!paths && !force && maxFiles > 0) {
      const c = store.counts();
      if (c.file + c.chat + c.note === 0) {
        const files = await listIndexableFiles(root, { patterns: exclusions.patterns }, { limit: maxFiles + 1 });
        if (files.length > maxFiles) {
          return setStatus('needs-confirmation', 0, files.length,
            `Project has more than ${maxFiles} files; confirm to index.`);
        }
      }
    }

    const doFiles = only !== 'chats';
    const doHistory = !paths && only !== 'files';
    const files = doFiles ? await listIndexableFiles(root, { patterns: exclusions.patterns }) : [];

    let embedFailed = false;
    // `known` maps stored chunk text (`keys[i]`, default the input itself) to an embedding the source
    // already has; only chunks without one are embedded.
    const embed = async (texts, known = new Map(), keys = texts) => {
      const out = keys.map((k) => known.get(k) ?? null);
      const todo = out.flatMap((v, i) => (v ? [] : [i]));
      if (!embedder) return out;
      for (let i = 0; i < todo.length && !embedFailed; i += BATCH) {
        const idx = todo.slice(i, i + BATCH);
        try {
          const v = await embedder.embedDocuments(idx.map((k) => texts[k]));
          idx.forEach((k, j) => { out[k] = v[j] ?? null; });
        } catch {
          embedFailed = true;
        }
      }
      return out;
    };

    let done = 0;
    let total = 0;
    const tick = () => {
      done++;
      if (done % PROGRESS_EVERY === 0) setStatus('building', done, total);
    };

    // ---- files
    let targets = files;
    const seenFiles = new Set();
    if (paths) {
      const want = new Set(paths.map((p) => p.split(path.sep).join('/')));
      targets = files.filter((f) => want.has(f.rel));
      for (const rel of want) {
        if (!targets.some((f) => f.rel === rel)) store.deleteSource(`file:${rel}`);
      }
    }
    // chats and notes are gathered up front so progress has a total
    const transcripts = doHistory ? transcriptFiles(root, projectsDir) : [];
    const notes = doHistory ? activeNotes(readNotes(dataDir)) : [];
    total = targets.length + transcripts.length + notes.length;
    setStatus('building', 0, total);

    for (const f of targets) {
      const key = `file:${f.rel}`;
      if (!insideRoot(realRoot, f.abs) || live.file(f.rel)) { tick(); continue; }
      const prev = store.getSource(key);
      if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) {
        seenFiles.add(key); tick(); continue;
      }
      let buf;
      try { buf = fs.readFileSync(f.abs); } catch { if (prev) seenFiles.add(key); tick(); continue; }
      if (isBinary(buf)) { tick(); continue; }
      seenFiles.add(key);
      const hash = sha1(buf);
      if (prev && prev.hash === hash) { store.touchSource(key, f.mtimeMs, f.size); tick(); continue; }
      const chunks = chunkText(f.rel, buf.toString('utf8'));
      const vecs = await embed(chunks.map((c) => `${f.rel}\n${c.text}`), store.embeddingsByText(key), chunks.map((c) => c.text));
      if (live.file(f.rel)) { seenFiles.delete(key); tick(); continue; }
      store.replaceSource(
        { key, kind: 'file', hash, mtimeMs: f.mtimeMs, size: f.size },
        chunks.map((c, i) => ({ loc: f.rel, startLine: c.startLine, endLine: c.endLine, text: c.text, date: null, embedding: vecs[i] })));
      tick();
    }
    if (paths) {
      for (const p of paths) {
        const key = `file:${p.split(path.sep).join('/')}`;
        if (!seenFiles.has(key)) store.deleteSource(key);
      }
    } else {
      if (doFiles) for (const key of store.listSourceKeys('file')) if (!seenFiles.has(key)) store.deleteSource(key);
    }
    if (doHistory) {
      // ---- chats
      const seenChats = new Set();
      for (const tf of transcripts) {
        const base = path.basename(tf, '.jsonl');
        const key = `chat:${base}`;
        if (live.session([base])) { tick(); continue; }
        let st;
        try { st = fs.statSync(tf); } catch { if (store.getSource(key)) seenChats.add(key); tick(); continue; }
        const prev = store.getSource(key);
        if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
          seenChats.add(key); tick(); continue;
        }
        let buf;
        try { buf = fs.readFileSync(tf); } catch { if (prev) seenChats.add(key); tick(); continue; }
        const parsed = parseTranscript(buf.toString('utf8'));
        const sid = parsed.sessionId || base;
        if (live.session(parsed.sessionIds)) { tick(); continue; }
        seenChats.add(key);
        const hash = sha1(buf);
        if (prev && prev.hash === hash) { store.touchSource(key, st.mtimeMs, st.size); tick(); continue; }
        const raw = [];
        for (const ex of parsed.exchanges) {
          for (const piece of splitLong(ex.text)) raw.push({ text: piece, date: ex.timestamp ?? null });
        }
        const vecs = await embed(raw.map((c) => c.text), store.embeddingsByText(key));
        if (live.session([base, ...parsed.sessionIds])) { seenChats.delete(key); tick(); continue; }
        store.replaceSource(
          { key, kind: 'chat', hash, mtimeMs: st.mtimeMs, size: st.size },
          raw.map((c, i) => ({ loc: `chat ${sid}`, startLine: null, endLine: null, text: c.text, date: c.date, embedding: vecs[i] })));
        tick();
      }
      for (const key of store.listSourceKeys('chat')) if (!seenChats.has(key)) store.deleteSource(key);

      // ---- notes
      const seenNotes = new Set();
      for (const n of notes) {
        const key = `note:${n.id}`;
        seenNotes.add(key);
        const text = `${n.title}\n\n${n.body}`;
        const hash = sha1(Buffer.from(text));
        const prev = store.getSource(key);
        if (!prev || prev.hash !== hash) {
          const [v] = await embed([text]);
          store.replaceSource({ key, kind: 'note', hash, mtimeMs: 0, size: text.length },
            [{ loc: n.title, startLine: null, endLine: null, text, date: n.createdAt ?? null, embedding: v }]);
        }
        tick();
      }
      for (const key of store.listSourceKeys('note')) if (!seenNotes.has(key)) store.deleteSource(key);
    }

    // ---- backfill
    if (embedder && !embedFailed) {
      for (;;) {
        const missing = store.chunksMissingEmbeddings(BATCH);
        if (!missing.length) break;
        let vecs;
        try {
          vecs = await embedder.embedDocuments(missing.map((m) => (m.kind === 'file' ? `${m.loc}\n${m.text}` : m.text)));
        } catch { break; }
        let updated = 0;
        missing.forEach((m, i) => { if (vecs?.[i]) { store.setEmbedding(m.id, vecs[i]); updated++; } });
        if (!updated) break;
      }
    }

    const s = setStatus('idle', total, total);
    return { ...s, counts: store.counts() };
  } catch (e) {
    try { setStatus('error', 0, 0, String(e?.message ?? e)); } catch { /* ignore */ }
    throw e;
  }
}
