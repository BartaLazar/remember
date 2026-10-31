# remember Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that automatically keeps a local, offline, hybrid (vector + keyword) index of the project's files, its past Claude Code chats and saved decision notes, and exposes search to Claude so it reads less.

**Architecture:** Plain-JS ESM Node package inside the plugin. A detached, low-priority worker process does all indexing (spawned by hooks and MCP tools, one at a time per project via a lock file). A long-lived MCP server keeps the embedding model loaded and answers searches. Five skills tell Claude when to use the tools. Per-project data lives in `<project>/.remember/`.

**Tech Stack:** Node 24 (ESM, `node:test`, built-in `node:sqlite` with FTS5), `@huggingface/transformers` (ONNX, model `Xenova/multilingual-e5-small` quantized, `onnxruntime-node` pinned to 1.23.2 via npm overrides), `@modelcontextprotocol/sdk` + `zod`, `ignore`.

**Spec:** `docs/design.md`

## Global Constraints

- Nothing is ever sent to an external service. The only network access is the model download, done only by the index worker; every other process creates the embedder with remote models disabled. No telemetry, no remote APIs.
- Model `Xenova/multilingual-e5-small`, `dtype: 'q8'`, 384 dims, `pooling: 'mean'`, `normalize: true`; queries prefixed `query: `, documents `passage: `. Cached in `MODELS_DIR` = `${CLAUDE_PLUGIN_DATA}/models` when that env var is set, else `~/.claude/remember/models` (shared across projects).
- Cross-platform: macOS arm64/x64, Linux, Windows. Use `path` APIs only; never shell out to Unix-only tools; background priority via `os.setPriority(pid, 10)` in try/catch (no `nice`).
- Published plugin: users never run `npm install`. Claude Code auto-installs from `package.json` + `package-lock.json` (`--ignore-scripts`); if packages are still missing, the SessionStart hook installs them into `${CLAUDE_PLUGIN_DATA}` and code imports them from there (Task 11).
- Requires Node ≥ 22.13; hooks report an older Node clearly instead of crashing.
- Per-project data dir `<root>/.remember/` containing `.gitignore` with content `*\n`; the indexer never indexes it.
- `notes.jsonl` and `exclusions.json` are the source of truth; `index.db` is a disposable cache (journal mode DELETE, `busy_timeout` 5000, `PRAGMA quick_check` on open; corrupt → delete and recreate).
- Files: skip gitignored, `.git`, `node_modules`, `.remember`, build dirs, binaries, files > 1,048,576 bytes, and secret paths (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.keystore`, `credentials*.json`) even when not gitignored.
- Auto-index guardrails: never auto-index `/`, `~`, `~/Desktop`, `~/Documents`, `~/Downloads` exactly; size question: if a project's indexable file count exceeds the user-set threshold `maxFiles` (global `config.json`, default 5000, `0` = never ask) the first build waits for the user's answer, and once confirmed everything is indexed with no cap; `.remember/off` disables the plugin.
- Search defaults: 8 results, each snippet ≤ 600 chars, whole output ≤ 6,000 chars; RRF k = 60; note scores × 1.5.
- Hooks never block: they spawn the worker detached and exit; stdout is only the hook JSON.
- Dependencies: only the four packages above. Tests run with `node --test test/`.

## Review Focus

1. A search query with FTS5 syntax characters (`"`, `-`, `*`, `(`, `NEAR`, `foo:bar`) must return results or nothing, never throw. → test in Task 9.
2. A file deleted or renamed since the last build must disappear from results, not be returned with a dead pointer. → test in Task 8.
3. A transcript being written during indexing (truncated last line, non-JSON lines) must index all complete lines and skip the rest. → test in Task 5.
4. Many PostToolUse hooks firing within a second (Claude editing several files) must produce one running worker and no duplicate chunks. → test in Task 10.
5. A minified file (one 900 KB line) must produce chunks ≤ 2,000 chars, not one huge chunk. → test in Task 4.

---

## File Structure

```
remember/
  .claude-plugin/plugin.json      # plugin manifest
  .mcp.json                       # starts server/mcp.js
  hooks/hooks.json                # SessionStart, PostToolUse, SessionEnd → server/bin/hook.js
  package.json                    # "type": "module", deps, "test" script
  skills/{recall,index,remember,status,forget}/SKILL.md
  server/
    mcp.js                        # MCP server: search, save_note, reindex, status, forget
    bin/hook.js                   # hook entry: node hook.js <event>
    bin/index-worker.js           # detached indexing worker
    lib/project.js                # project root, data dir, blocked roots, transcript discovery
    lib/userdata.js               # notes.jsonl, exclusions.json, off flag, status.json
    lib/files.js                  # walk + filters
    lib/chunk.js                  # text → chunks
    lib/redact.js                 # secret masking
    lib/transcripts.js            # .jsonl → exchanges
    lib/store.js                  # SQLite schema + queries
    lib/embed.js                  # real + fake embedders
    lib/indexer.js                # incremental indexing
    lib/search.js                 # hybrid search + formatting
    lib/lock.js                   # worker lock + pending queue
    lib/spawn.js                  # spawn the worker detached at low priority; lib/deps.js resolves deps (Task 11)
  test/                           # node:test files, helpers/
```

---

### Task 1: Scaffold and Intel-Mac spike (GATE)

**Files:**
- Create: `package.json`, `.claude-plugin/plugin.json`, `.gitignore` (`node_modules/`, `.remember/`), `server/spike.js`

**Interfaces:**
- Produces: installed dependencies; confirmed that the stack runs on this machine.

- [ ] **Step 1:** `git init` in the plugin root (it is not a repo yet). Create `package.json`: name `remember`, `"type": "module"`, `"engines": {"node": ">=22.13"}`, `"scripts": {"test": "node --test test/"}`, dependencies `@huggingface/transformers`, `@modelcontextprotocol/sdk`, `zod`, `ignore` (latest versions at least two weeks old). Create `.claude-plugin/plugin.json` with `name: "remember"`, `version: "0.1.0"`, description from the spec's Intent, author `{ "name": "BartaLazar" }`. Run `npm install`.
- [ ] **Step 2:** Write `server/spike.js`: (a) load `feature-extraction` pipeline for `Xenova/bge-small-en-v1.5` with `{ dtype: 'q8' }`, cacheDir `~/.claude/remember/models`, embed two sentences with `pooling: 'cls', normalize: true`, print dims and the cosine of a related vs. unrelated pair; (b) open `new DatabaseSync(':memory:')`, create an FTS5 table with `tokenize = "unicode61 tokenchars '_'"`, insert a row, `MATCH` it.
- [ ] **Step 3:** Run `node server/spike.js`. Expected: dims `384`, related cosine > unrelated cosine, one FTS row matched, exit 0. Record the elapsed model-load time and per-sentence embed time.
- [ ] **Step 4 (GATE):** If the ONNX runtime or FTS5 fails, STOP and report the error to the user; do not choose a fallback alone. If it passes, delete `server/spike.js`.
- [ ] **Step 5:** Commit `chore: scaffold remember plugin`.

---

### Task 2: Project resolution

**Files:** Create `server/lib/project.js`; Test `test/project.test.js`

**Interfaces:**
- Produces:
  - `resolveProject(cwd: string): { root: string, dataDir: string }` — root = `git -C cwd rev-parse --show-toplevel` (via `execFileSync`, errors → `path.resolve(cwd)`); dataDir = `join(root, '.remember')`.
  - `isBlockedRoot(root: string, home = os.homedir()): boolean`
  - `ensureDataDir(dataDir: string): void` — mkdir -p; writes `.gitignore` = `*\n` if missing.
  - `claudeSlug(p: string): string` — `p.replace(/[^A-Za-z0-9]/g, '-')`.
  - `transcriptFiles(root: string, projectsDir = join(home, '.claude/projects')): string[]` — absolute `.jsonl` paths from every dir whose name starts with `claudeSlug(root)` and whose first record carrying a `cwd` field has `cwd === root` or `cwd.startsWith(root + '/')`.

- [ ] **Step 1: Tests**
  - `resolveProject` on a subdir of a temp git repo returns the repo root; on a non-git temp dir returns that dir.
  - `isBlockedRoot('/')`, `(home)`, `(home + '/Desktop')`, `/Documents`, `/Downloads` → true; `home + '/Desktop/proj'` → false.
  - `ensureDataDir` creates `.gitignore` with exactly `*\n`, and doesn't overwrite an existing one.
  - Never synced with git: in a temp git repo, `ensureDataDir` then write `index.db`, `notes.jsonl`, `exclusions.json` into it → `git status --porcelain --untracked-files=all` and `git add -A --dry-run` both list nothing under `.remember/`.
  - `claudeSlug('/Users/a/claude_plugins/remember') === '-Users-a-claude-plugins-remember'`.
  - `transcriptFiles` with a fake projectsDir: includes `root` and `root/sub` sessions; excludes a dir `<slug>-other` whose records say cwd `root + '-other'`.
- [ ] **Step 2:** Run `node --test test/project.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: project resolution`.

---

### Task 3: User data files

**Files:** Create `server/lib/userdata.js`; Test `test/userdata.test.js`

**Interfaces:**
- Produces:
  - `type Note = { id: string, title: string, body: string, tags: string[], createdAt: string /*ISO*/, supersedes?: string }`
  - `readNotes(dataDir): Note[]` (skips malformed lines), `appendNote(dataDir, { title, body, tags?, supersedes? }): Note` (id `n-${Date.now().toString(36)}-${4 random hex}`), `activeNotes(notes: Note[]): Note[]` (drops any note whose id is some other note's `supersedes`).
  - `readExclusions(dataDir): { patterns: string[], sessions: string[] }`, `addExclusion(dataDir, target: string)`, `removeExclusion(dataDir, target: string)` — targets starting with `session:` go to `sessions` (stored without the prefix), others to `patterns` (gitignore syntax). No duplicates.
  - `isOff(dataDir): boolean`, `setOff(dataDir, off: boolean)` — the `off` file.
  - `type Status = { phase: 'idle'|'building'|'needs-confirmation'|'blocked'|'error', done: number, total: number, updatedAt: string, message?: string }`; `readStatus(dataDir): Status | null`, `writeStatus(dataDir, s: Status)` (write to temp + rename).

- [ ] **Step 1: Tests** — append two notes, the second `supersedes` the first → `activeNotes` returns only the second; a garbage line in `notes.jsonl` is skipped; `addExclusion('session:abc')` → `sessions: ['abc']`; add twice → one entry; `removeExclusion` undoes; `setOff(true)` → `isOff` true; `writeStatus`/`readStatus` round-trip.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: notes, exclusions and status files`.

---

### Task 4: File listing and chunking

**Files:** Create `server/lib/files.js`, `server/lib/chunk.js`; Test `test/files.test.js`, `test/chunk.test.js`

**Interfaces:**
- Consumes: `readExclusions` shape from Task 3.
- Produces:
  - `MAX_FILE_BYTES = 1_048_576`
  - `isSecretPath(rel: string): boolean`, `isBinary(buf: Buffer): boolean` (NUL in first 8,000 bytes)
  - `listIndexableFiles(root: string, { patterns }: { patterns: string[] }, { limit }?: { limit?: number }): Promise<Array<{ rel: string, abs: string, size: number, mtimeMs: number }>>` — in a git repo use `git ls-files -co --exclude-standard -z`; otherwise walk and apply the root `.gitignore` with `ignore`. Then apply default ignores (`.git`, `node_modules`, `.remember`, `dist`, `build`, `.next`, `target`, `__pycache__`, `.venv`), secrets, size, and exclusion patterns. Binary check happens at read time in the indexer. `limit` stops early (used by the size guard).
  - `chunkText(rel: string, text: string): Array<{ startLine: number, endLine: number, text: string }>` — 1-based inclusive lines. `.md/.mdx/.markdown` split at headings; code extensions split at blank-line-separated blocks packed into 40–80 line windows with 5 lines overlap; other text by paragraphs packed to ≤ 80 lines.
  - `splitLong(text: string, max = 2000): string[]` — every chunk text ≤ `max` chars; `chunkText` applies it (sub-chunks keep the parent's line range).

- [ ] **Step 1: Tests**
  - files: temp git repo with `a.js`, `.env`, `secret.pem`, `node_modules/x.js`, `big.txt` (1.1 MB), a gitignored `out/`, and `.remember/index.db` → result is exactly `['a.js']` plus `.gitignore`. Non-git dir with root `.gitignore` honored. Exclusion pattern `docs/**` removes `docs/a.md`. `limit: 1` returns 1 entry.
  - chunk: a 200-line JS file → every chunk 40–80 lines except the last, consecutive chunks overlap, lines cover 1..200. A markdown file with three `##` sections → three chunks starting at the heading lines. **Review Focus 5:** a single 900,000-char line → all chunks ≤ 2,000 chars, all with `startLine === endLine === 1`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: file listing and chunking`.

---

### Task 5: Transcripts and redaction

**Files:** Create `server/lib/redact.js`, `server/lib/transcripts.js`; Test `test/redact.test.js`, `test/transcripts.test.js`, fixture `test/fixtures/session.jsonl`

**Interfaces:**
- Produces:
  - `redact(text: string): string` — replaces with `[REDACTED]`: `-----BEGIN … PRIVATE KEY-----` blocks; `sk-…`, `sk-ant-…`, `ghp_…`, `github_pat_…`, `xox[abp]-…`, `AKIA[0-9A-Z]{16}`, `AIza…` keys; JWTs (`eyJ…\.…\.…`); the value in `NAME=value` / `"name": "value"` when NAME matches `/key|secret|token|passw|pwd|auth/i`; any 32+ char token from `[A-Za-z0-9+/_\-=]` with Shannon entropy > 4.0.
  - `parseTranscript(jsonl: string): { sessionId: string|null, cwd: string|null, exchanges: Array<{ index: number, timestamp: string|null, text: string }> }` — one exchange = a real user message (type `user`, string content or `text` blocks, not `tool_result`-only, not `isMeta`) plus the `text` blocks of the following assistant records up to the next real user message. Drop `thinking`, `tool_use`, `tool_result`, and strip `<system-reminder>…</system-reminder>` spans. Text is `User: …\n\nClaude: …`, passed through `redact`. Unparseable lines are skipped.

- [ ] **Step 1: Tests**
  - redact: each listed shape is masked; `const apiKey = "abc123..."` is masked; ordinary code (`function getUserName()`, a git SHA in prose, a UUID) is left as-is.
  - transcripts: the fixture (two exchanges with tool calls, a thinking block, a system-reminder, a tool_result user record) → 2 exchanges, no tool output, no reminder text, `sessionId` and `cwd` read from the records. **Review Focus 3:** fixture plus a truncated final line `{"type":"user","mess` and a line `not json` → still 2 exchanges, no throw.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: transcript parsing with secret redaction`.

---

### Task 6: Store

**Files:** Create `server/lib/store.js`; Test `test/store.test.js`

**Interfaces:**
- Produces: `openStore(dbPath: string): Store`, where `Store` has:
  - `getSource(key: string): { key, kind, hash, mtimeMs, size } | undefined` — keys are `file:<rel>`, `chat:<sessionId>`, `note:<id>`; kind `'file'|'chat'|'note'`.
  - `replaceSource(src: { key, kind, hash, mtimeMs, size }, chunks: Array<{ loc: string, startLine: number|null, endLine: number|null, text: string, date: string|null, embedding: Float32Array|null }>): void` — one transaction; replaces all chunks of that source.
  - `deleteSource(key: string): void`, `listSourceKeys(kind: string): string[]`
  - `chunksMissingEmbeddings(limit: number): Array<{ id: number, text: string }>`, `setEmbedding(id: number, v: Float32Array): void`
  - `vectors(kinds: string[]): Array<{ id: number, vector: Float32Array }>` (only embedded chunks)
  - `fts(match: string, kinds: string[], limit: number): Array<{ id: number }>` best first
  - `getChunks(ids: number[]): Array<{ id, kind, sourceKey, loc, startLine, endLine, text, date }>`
  - `counts(): { file: number, chat: number, note: number, chunks: number, unembedded: number }`
  - `close(): void`
- Schema: `sources(key PK, kind, hash, mtime_ms, size)`, `chunks(id PK, source_key → sources ON DELETE CASCADE, kind, loc, start_line, end_line, text, date, embedding BLOB)`, `chunks_fts` FTS5 external-content on `chunks(text)` with `tokenize = "unicode61 tokenchars '_'"` kept in sync by triggers. Pragmas: `foreign_keys=ON`, `journal_mode=DELETE`, `busy_timeout=5000`. Embeddings stored as `Buffer.from(v.buffer, v.byteOffset, v.byteLength)`.

- [ ] **Step 1: Tests** — replaceSource then fts finds the text; replacing a source removes its old chunks from fts; deleteSource cascades; vector round-trips byte-exact; `chunksMissingEmbeddings` lists null-embedding chunks and `setEmbedding` clears them; `fts` with `kinds: ['note']` excludes files; writing garbage bytes over the db file → `openStore` returns a working empty store.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: sqlite store with fts5`.

---

### Task 7: Embedder

**Files:** Create `server/lib/embed.js`; Test `test/embed.test.js`

**Interfaces:**
- Produces:
  - `MODEL_ID = 'Xenova/multilingual-e5-small'`, `DIMS = 384`, `MODELS_DIR` (Global Constraints), `QUERY_PREFIX = 'query: '`, `PASSAGE_PREFIX = 'passage: '`.
  - `type Embedder = { embedDocuments(texts: string[]): Promise<Float32Array[]>, embedQuery(text: string): Promise<Float32Array> }` — normalized vectors, documents batched by 32.
  - `modelIsPresent(modelsDir = MODELS_DIR): boolean` — marker file `<modelsDir>/.multilingual-e5-small.complete`.
  - `createEmbedder({ modelsDir = MODELS_DIR, allowDownload = false }): Promise<Embedder>` — sets `env.cacheDir`, `env.allowRemoteModels = allowDownload`, `env.allowLocalModels = true`; `dtype: 'q8'`, `pooling: 'mean'`; writes the marker after a successful load; throws if the model is absent and `allowDownload` is false.
  - `createFakeEmbedder(): Embedder` — deterministic: hash each lowercase word token into 384 buckets, L2-normalize. Used by all other tests.

- [ ] **Step 1: Tests** — fake: same text → identical vector, length 384, norm ≈ 1, overlapping texts have higher cosine than disjoint ones. Real (skip with `t.skip` when `!modelIsPresent()`): `createEmbedder()` (no download) embeds; "how is the user logged in" is closer to "function authenticate(user, password)" than to "render the chart legend"; the German query "wie wird der Benutzer angemeldet" is also closer to the authenticate passage than to the chart one. With an empty temp modelsDir and `allowDownload: false` → rejects.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS (real tests run because Task 1 downloaded the model; create the marker if the spike cached it without one).
- [ ] **Step 5:** Commit `feat: local embedder`.

---

### Task 8: Indexer

**Files:** Create `server/lib/indexer.js`; Test `test/indexer.test.js`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces:
  - `runIndex({ root, dataDir, store, embedder, paths?, force?, limits?, projectsDir? }): Promise<Status>`
    - `embedder` may be `null` → chunks stored with `embedding: null` (keyword search works; backfilled later).
    - `paths` (repo-relative) → only those files: index if indexable, `deleteSource` if missing, excluded or secret.
    - no `paths` → full incremental pass: files, then chats (`transcriptFiles`, skipping excluded sessions, key `chat:<sessionId>`, one chunk per exchange via `splitLong`, `loc` = `chat <sessionId>`, `date` = exchange timestamp), then notes (`activeNotes`, key `note:<id>`, text `title\n\nbody`, `date` = createdAt); delete every source of each kind not seen in this pass. Then backfill `chunksMissingEmbeddings` in batches of 32.
    - Unchanged = same `mtimeMs` and `size`; otherwise read, skip if `isBinary`, sha1, and re-chunk only if the hash differs. File chunk text embedded as `${rel}\n${text}`; stored `text` is the raw chunk.
    - Guards (skipped when `force`): `isOff` → return without work; `isBlockedRoot` → status `blocked`; store empty and `listIndexableFiles(..., { limit: 5001 })` exceeds 5,000 files or 50 MB total → status `needs-confirmation`.
    - Writes `Status` (`building` with `done/total` every 20 sources; `idle` at the end; `error` with message on exception, then rethrows).
  - `purgeExcluded(store, root, exclusions): void` — deletes sources matching exclusion patterns/sessions immediately.

- [ ] **Step 1: Tests** (fake embedder, temp project, fake projectsDir)
  - first run indexes files, the fixture chat and a note; `counts()` matches.
  - second run with no changes re-embeds nothing (spy on `embedDocuments` → 0 calls).
  - touching a file's mtime without changing content → not re-chunked.
  - **Review Focus 2:** delete `a.js` and rename `b.js` → `c.js`, run again → no `file:a.js`/`file:b.js` sources, `file:c.js` present; `paths: ['gone.js']` for a missing file deletes its source.
  - superseding a note removes the old note's source.
  - `addExclusion('session:<id>')` + `purgeExcluded` → chat gone, and stays gone after another run.
  - `setOff(true)` → nothing indexed. Root = fake home → `blocked`. `limits: { maxFiles: 2 }` on a 3-file empty store → `needs-confirmation`, nothing indexed; `force: true` → indexed.
  - `embedder: null` → chunks stored, `unembedded > 0`; next run with fake embedder → `unembedded === 0`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (`limits` defaults `{ maxFiles: 5000, maxBytes: 52_428_800 }`). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: incremental indexer`.

---

### Task 9: Search

**Files:** Create `server/lib/search.js`; Test `test/search.test.js`

**Interfaces:**
- Consumes: Store (Task 6), Embedder (Task 7).
- Produces:
  - `toFtsQuery(q: string): string | null` — tokens `/[\p{L}\p{N}_]+/gu`, each wrapped in double quotes, joined with ` OR `; `null` if no tokens.
  - `search({ store, embedder, root, query, scope = 'all', limit = 8 }): Promise<SearchResult[]>` — `scope` ∈ `all|files|chats|notes`. Take the top 50 by cosine (if `embedder`) and the top 50 by FTS, fuse with RRF (k = 60), multiply notes by 1.5, return the top `limit`.
  - `type SearchResult = { kind, loc, startLine, endLine, text, date, score, stale: boolean }` — `stale` for files whose current `mtimeMs`/`size` differ from the source row, or that no longer exist.
  - `formatResults(results: SearchResult[], { status: Status|null, semantic: boolean }): string` — header lines when relevant: `Index still building (done/total) — results may be incomplete.`; `Semantic search not ready yet (model downloading) — keyword results only.`. Each result: `[n] path:start-end` (files), `[n] note "<title>" (YYYY-MM-DD)`, `[n] chat <sessionId> (YYYY-MM-DD)`, plus ` — CHANGED SINCE INDEXED, re-read before trusting` when stale, then the snippet trimmed to 600 chars. Stop adding results once the output would exceed 6,000 chars. No results → `No matches in the knowledge base.`

- [ ] **Step 1: Tests** (fake embedder) — a query matching an identifier `parseInvoiceTotal` ranks that file first; `scope: 'notes'` returns only notes; with equal relevance a note outranks a file; a file modified after indexing is `stale` and formatted with the warning; `embedder: null` still returns FTS results and the formatter prints the keyword-only header; 20 long results → output ≤ 6,000 chars. **Review Focus 1:** queries `"unclosed`, `-foo`, `a*`, `(x`, `NEAR(a b)`, `foo:bar`, `***` → no throw.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: hybrid search`.

---

### Task 9b: User-set size threshold

**Files:** Modify `server/lib/userdata.js`, `server/lib/indexer.js`, tests

**Interfaces:**
- Produces: `getConfigDir(): string` (`${CLAUDE_PLUGIN_DATA}` if set, else `~/.claude/remember`; env `REMEMBER_CONFIG_DIR` overrides for tests), `readConfig(): { maxFiles: number }` (default `{ maxFiles: 5000 }`; corrupt/missing → default), `writeConfig(patch: { maxFiles?: number }): Config` (validates non-negative integer, temp+rename).
- `runIndex` drops the `limits` option and the 50 MB rule; the empty-store guard uses `readConfig().maxFiles` (0 = no guard). Everything else unchanged.

- [ ] **Step 1: Tests** — config default 5000; write 0 → read 0; negative/non-integer rejected; corrupt file → default. Indexer: config `maxFiles: 2`, 3 files, empty store → `needs-confirmation`, nothing indexed; `force` → all indexed; `maxFiles: 0` → indexed without force.
- [ ] **Step 2:** Implement; `npm test` → PASS. Commit `feat: user-set size threshold`.

---

### Task 10: Worker, lock and spawning

**Files:** Create `server/lib/lock.js`, `server/lib/spawn.js`, `server/bin/index-worker.js`; Test `test/worker.test.js`

**Interfaces:**
- Produces:
  - `acquireLock(dataDir): boolean` — `openSync(lockPath, 'wx')` writing the pid; if it exists and that pid is dead (`process.kill(pid, 0)` throws), replace it. `releaseLock(dataDir): void`.
  - `queueRequest(dataDir, req: { paths?: string[], full?: boolean, force?: boolean }): void` (append to `pending.jsonl`), `drainRequests(dataDir): Request[]` (read + truncate).
  - `spawnWorker(root: string, args: string[]): void` — `spawn(process.execPath, [WORKER, '--root', root, ...args], { detached: true, stdio: 'ignore', windowsHide: true })`, then `os.setPriority(child.pid, 10)` in try/catch, then `unref()`.
  - Worker CLI: `index-worker.js --root <root> [--paths a,b] [--full] [--force]`. Resolves dataDir, `ensureDataDir`; if the lock is taken → `queueRequest` and exit 0. Otherwise `createEmbedder({ allowDownload: !modelIsPresent() })` (on download failure continue with `null`), run, then loop over drained requests (merging them: any `full` wins, else union of paths) until none remain; release the lock in `finally`.

- [ ] **Step 1: Tests** — lock: second `acquireLock` → false; a lock file with a dead pid → acquirable. Queue round-trips and drain empties it. **Review Focus 4:** spawn the worker 10 times within 100 ms on a temp project (set env `REMEMBER_FAKE_EMBEDDER=1`, which the worker honors to use `createFakeEmbedder`, and `REMEMBER_MODELS_DIR` to a temp dir) → wait until the lock disappears → each file appears exactly once in `listSourceKeys('file')` and the chunk count equals a single clean run's.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: background index worker`.

---

### Task 11: Hooks

**Files:** Create `server/bin/hook.js`, `hooks/hooks.json`; Test `test/hook.test.js`

**Interfaces:**
- Consumes: `resolveProject`, `isBlockedRoot`, `isOff`, `readStatus`, `listIndexableFiles`, `modelIsPresent`, `spawnWorker`.
- Produces:
  - `handleHook(event: 'session-start'|'post-tool-use'|'session-end', input: object, deps = { spawnWorker, pluginRoot }): { stdout: string }` — exported for tests; `main` reads stdin JSON, calls it, prints `stdout`, always exits 0 (errors go to stderr).
  - `session-start`: project from `input.cwd`. If Node < 22.13 → context `remember plugin needs Node.js 22.13 or newer (found <version>); tell the user.` and stop. If the dependencies can't be resolved (`lib/deps.js`: `depsAvailable(): boolean` checks resolving `@huggingface/transformers` from the plugin root, then from `${CLAUDE_PLUGIN_DATA}/node_modules`) → copy `package.json` + `package-lock.json` into `${CLAUDE_PLUGIN_DATA}`, spawn `npm ci --omit=dev --no-audit --no-fund` there detached (`shell: true` on win32 for `npm.cmd`), context `remember plugin: installing its dependencies in the background; the knowledge base will be available next session.` and stop. `lib/deps.js` also exports `importDep(name: string): Promise<module>` (plugin root first, then the data dir via `createRequire(join(dataDir,'package.json')).resolve` + `import(pathToFileURL(...))`), which `embed.js`, `files.js` and `mcp.js` use for third-party packages. If off → no output. If blocked → context `remember: this folder is too broad to index automatically. If the user wants it indexed, use the index skill.` Otherwise, when no status exists yet or status is `needs-confirmation`, count with `listIndexableFiles(..., { limit: maxFiles + 1 })` (`maxFiles` from `readConfig()`; skip when 0); over → status `needs-confirmation` and context `remember: this project has more than <maxFiles> files (the user's threshold). Ask the user which they want: (1) index everything now — use the index skill; (2) skip this project — use the forget skill to turn remember off here; (3) change the threshold — use the index skill's configure step.` Else `spawnWorker(root, [])` and context:
    `This project has a local knowledge base (remember plugin). Before reading or grepping files to find where something is, how it works, or what was decided in earlier sessions, use the recall skill, then read only the lines it points to.` plus, when `!modelIsPresent()`, ` The search model is downloading for the first time; results are keyword-only until it finishes.`
    Output format: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`.
  - `post-tool-use`: path = `tool_input.file_path ?? tool_input.notebook_path`; if inside root, not off, not blocked → `spawnWorker(root, ['--paths', rel])`. No stdout.
  - `session-end`: not off, not blocked → `spawnWorker(root, [])`. No stdout.
  - `hooks/hooks.json`: `SessionStart` → `node "${CLAUDE_PLUGIN_ROOT}/server/bin/hook.js" session-start`; `PostToolUse` matcher `Edit|Write|MultiEdit|NotebookEdit` → `… post-tool-use`; `SessionEnd` → `… session-end`; timeout 10 s each.

- [ ] **Step 1: Tests** (spawnWorker stubbed) — session-start in a normal temp project → valid JSON whose additionalContext contains `recall skill`, and the stub was called once; with an off file → empty stdout, no spawn; blocked root → blocked message, no spawn; missing node_modules (fake pluginRoot) → install message; 3 files with config `maxFiles: 2` → threshold message naming the three options, no spawn; `maxFiles: 0` → spawned. post-tool-use for `<root>/src/a.js` → spawn args `['--paths', 'src/a.js']`; for a path outside root → no spawn. A malformed stdin through `main` → exit code 0.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (make the limit injectable via `deps.limits`). **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: hooks`.

---

### Task 12: MCP server

**Files:** Create `server/mcp.js`, `.mcp.json`; Test `test/mcp.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: stdio MCP server named `remember`. Root: see `.mcp.json` below. The embedder is loaded lazily with `allowDownload: false` and re-attempted on each search while absent. Tools (zod schemas; all return text):
  - `search({ query: string, scope?: 'all'|'files'|'chats'|'notes', limit?: number /*1–20*/ })` → `formatResults(...)`.
  - `save_note({ title: string, body: string, tags?: string[], supersedes?: string })` → `appendNote`, then `spawnWorker(root, [])`; returns `Saved note <id>.`
  - `reindex({ paths?: string[], full?: boolean, force?: boolean })` → `spawnWorker`; returns `Indexing started in the background.`
  - `status()` → root, phase, done/total, `counts()`, model present yes/no, exclusions, off yes/no, last update, size threshold.
  - `configure({ max_files: number /* ≥ 0, 0 = never ask */ })` → `writeConfig`; returns the new threshold. (Six tools in total.)
  - `forget({ target?: string, undo?: boolean, disable_project?: boolean })` → `disable_project` → `setOff(!undo)`; else add/remove exclusion and `purgeExcluded` (on add) or `spawnWorker` (on undo). Returns what changed.
  - `.mcp.json`: `{"mcpServers":{"remember":{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/server/mcp.js"],"env":{"REMEMBER_PROJECT_DIR":"${CLAUDE_PROJECT_DIR}"}}}}`; root = `resolveProject(process.env.REMEMBER_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd())`.

- [ ] **Step 1: Tests** — connect with the SDK's `Client` + `StdioClientTransport` to `server/mcp.js` with `CLAUDE_PROJECT_DIR` = a temp project pre-indexed by `runIndex` (fake embedder) and `REMEMBER_FAKE_EMBEDDER=1`: `listTools` returns the six names; `search` returns a result pointing to the known file; `save_note` returns an id that appears in `notes.jsonl`; `forget({ target: 'docs/**' })` removes docs results from the next search; `status` text contains `files:`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: mcp server`.

---

### Task 13: Skills

**Files:** Create `skills/{recall,index,remember,status,forget}/SKILL.md`

**Interfaces:**
- Consumes: the MCP tool names and parameters from Task 12.

Each file has frontmatter `name` and `description`, and a short body (≤ 40 lines) naming the tool to call and how to read its output.

- [ ] **Step 1:** `recall` — description: *Use BEFORE reading, grepping or globbing files to find where something is implemented, how something works, or what was discussed or decided in earlier sessions of this project. Searches the local knowledge base and returns file:line pointers so you read only the relevant lines.* Body: write a natural-language query plus key identifiers; use `scope` when the question is clearly about past chats or decisions; read only the pointed line ranges (with a little context) and re-read anything marked CHANGED; fall back to normal reading/grep when results are empty or keyword-only and weak; don't repeat the same search.
- [ ] **Step 2:** `remember` — description: *Use when the user and Claude settle a decision, convention, constraint or non-obvious fact about this project (a choice and its reason) that a future session should know.* Body: first `search` with `scope: 'notes'`; if an older note conflicts, pass its id as `supersedes`; title = the decision, body = what + why + date context, ≤ 120 words; don't save things the code or git history already shows.
- [ ] **Step 3:** `index` — triggers: user asks to build/rebuild the index, or the session context says the folder is too broad or over the size threshold and the user chose to index it, or the user wants to change the threshold (→ `configure`). Calls `reindex` (`force: true` only after the user agreed; `full: true` for a rebuild); explains it runs in the background; if the session said dependencies are missing, tells the user the `npm install` command.
- [ ] **Step 4:** `status` — user asks what is indexed, whether it's up to date, or why search seems wrong → `status`; summarize in ≤ 5 lines.
- [ ] **Step 5:** `forget` — user wants a file, folder, glob or chat session kept out of the index, or wants the plugin off for this project (or the reverse) → `forget` with the matching args; confirm what was removed; mention `undo`.
- [ ] **Step 6:** Verify every frontmatter parses (a small `node -e` that reads each file and checks `name` and `description` exist) and every tool name in the bodies is one of the five. Commit `feat: skills`.

---

### Task 14: Offline proof and end-to-end check

**Files:** Create `test/helpers/block-network.js`, `test/offline.test.js`, `README.md`, `LICENSE` (MIT, `BartaLazar`), `.claude-plugin/marketplace.json`, `.github/workflows/test.yml`

**Interfaces:**
- Consumes: worker CLI (Task 10), search (Task 9), the real model.

- [ ] **Step 1: Test** — `block-network.js` (loaded with `node --import`) replaces `net.Socket.prototype.connect`, `net.connect`, `tls.connect`, `http.request`, `https.request` and `globalThis.fetch` with functions that write `NETWORK_ATTEMPT` to stderr and throw. `offline.test.js` (skipped when `!modelIsPresent()`): run the worker with the real embedder on a temp project with that import → exit 0, stderr has no `NETWORK_ATTEMPT`; then run a script under the same import that loads `createEmbedder()` and `search`es → results returned, no `NETWORK_ATTEMPT`.
- [ ] **Step 2:** Run `npm test` → all tests PASS.
- [ ] **Step 3:** `README.md`: what it does, install (`npm install`, then `claude --plugin-dir <path>` or a local marketplace), the `.remember/` folder and what's in it, how to turn it off, the privacy guarantee and the one-time model download.
- [ ] **Step 4: Manual end-to-end** — in a scratch copy of a real project run `claude --plugin-dir <plugin root>`. Check: `.remember/` appears with `.gitignore`; `/mcp` lists `remember` with five tools; after indexing finishes, asking "where is X handled?" makes Claude use the recall skill and read only the pointed lines; editing a file and searching for the new text finds it within a few seconds; the next session's search finds the previous chat. Confirm the MCP server resolved the right root (via `status`); if `CLAUDE_PROJECT_DIR` isn't set for MCP servers and cwd is wrong, fix the root resolution and add a test.
- [ ] **Step 5: Publishing files** — `marketplace.json`: `{"name":"remember","owner":{"name":"BartaLazar"},"plugins":[{"name":"remember","source":"./","description":<plugin.json description>}]}`; plugin.json gains `license: "MIT"`, `repository`/`homepage` `https://github.com/BartaLazar/remember`, `keywords`. CI workflow: matrix `macos-latest` (arm64), `macos-13` (x64), `ubuntu-latest`, `windows-latest`; Node 22.x and 24.x; `npm ci && npm test` (real-model tests skip when the model isn't cached). Run `claude plugin validate --strict` → passes. README also states the Node ≥ 22.13 prerequisite and why transformers/onnxruntime are pinned.
- [ ] **Step 6:** Commit `docs: readme and publishing files; test: offline proof`.
