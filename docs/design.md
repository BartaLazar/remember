# remember — design

Date: 2026-10-30 · Status: approved

## Intent

Claude Code burns tokens re-reading files and loses what was said in earlier
sessions. `remember` is a Claude Code plugin that keeps a local, searchable
knowledge base of the working directory and of past Claude Code chats for that
project. Claude queries it and gets back only the relevant snippets (with file
and line pointers) instead of reading whole files or asking again.

Success: on a typical "where is X / how does Y work / what did we decide about
Z" question, Claude answers from a search result plus a targeted read of a few
lines, rather than opening several whole files.

## Goals

- Index every text file in the working directory and every past Claude Code
  transcript for this project.
- Semantic + keyword search exposed to Claude as a tool, returning short
  snippets with `path:line-range` so Claude can read exactly what it needs.
- Stay fresh automatically: files Claude edits are re-indexed, finished sessions
  are added, changed files are picked up at session start.
- Incremental: only re-embed content whose hash changed.
- Decision memory: Claude can save short "decision notes" (what was decided and
  why) that rank highly in later searches.
- Skills that teach Claude when to use all of this, phrased so Claude reaches
  for search *before* reading files.

## Non-goals (v1)

- claude.ai web/desktop chats (only Claude Code transcripts on disk).
- Cross-project search.
- Measuring token savings automatically.
- Publishing to a marketplace (local plugin first).

## Anti-goals (failure even if it "works")

- **Sharing anything with an external service or actor (user's requirement).**
  Embeddings and search run locally; no telemetry, analytics or remote APIs.
  The only network access is the one-time model download, which fetches
  weights and sends no project data. After that, the server sets transformers.js
  to local-only (`env.allowRemoteModels = false`). A test runs indexing and
  search with network access blocked to prove it. Whatever cloud sync the
  user's own folders have is out of the plugin's scope.
- **Silently stale answers.** Every result carries the indexed file's mtime/hash
  state; if the file changed since indexing, the result says so.
- **Indexing secrets.** `.env*`, keys, certs, and gitignored files never enter
  the index.
- **Committing the index.** It lives in the project but `.remember/` ships its
  own `.gitignore` containing `*`, so git never sees it.
- **Noisy output.** Search results are capped (default 8 results, ~1.5k tokens)
  so the tool itself doesn't become the token sink.

## Constraints

- Machine: Intel Mac (x86_64), Node 24, Python 3.10, no `uv`. Recent PyTorch has
  no Intel-Mac wheels, so no Python/torch stack.
- Fully offline after the first model download.

## How (decided)

**Runtime:** Node 24. Embeddings via `@huggingface/transformers` (ONNX runtime,
has darwin-x64 binaries). Storage via Node's built-in `node:sqlite` — no other
native database dependency. *(my call)*

**Model:** `Xenova/bge-small-en-v1.5`, quantized (~35 MB, 384 dims). Configurable
later. *(my call)*

**Storage (user's decision: inside the project):** `<project>/.remember/`,
containing a `.gitignore` with `*`. The indexer always skips this folder.

- `notes.jsonl` and `exclusions.json` are the source of truth for things that
  can't be rebuilt (decision notes, `forget` list). Plain text, append/rewrite,
  robust if the folder is synced or copied.
- `index.db` is a disposable cache built from files, chats and `notes.jsonl`.
  Use SQLite's default rollback journal (not WAL, which breaks under folder
  sync); on open, run `PRAGMA quick_check` and silently rebuild if the
  database is corrupt. *(my call)*

`index.db` Tables: `files`
(path, hash, mtime), `chunks` (source, path/session, line range, text,
embedding blob), an FTS5 table over chunk text, and `notes` (decision notes).
Vector search is brute-force cosine in memory — fine up to ~100k chunks, which
covers one project. *(my call)*

**Search:** hybrid — vector similarity + FTS5 BM25 merged with reciprocal rank
fusion. Keyword matching matters for code identifiers that embeddings handle
poorly. Optional filter: `files`, `chats`, `notes`, or all. *(my call)*

**Plugin shape:**

```
remember/
  .claude-plugin/plugin.json
  .mcp.json                 # starts the MCP server
  hooks/hooks.json
  server/                   # Node MCP server + indexer + hook scripts
  skills/
    recall/SKILL.md         # search before reading; how to use results
    index/SKILL.md          # build / rebuild the index, first-time setup
    remember/SKILL.md       # save a decision note when one is made
    status/SKILL.md         # what's indexed, how fresh
    forget/SKILL.md         # drop a file, path glob, or session
```

An MCP server (rather than scripts called from skills) keeps the model loaded,
so each search costs milliseconds instead of a 1–2 s model load. *(my call)*

**MCP tools:** `search(query, scope?, limit?)`, `save_note(title, body, tags?)`,
`reindex(paths?|full?)`, `status()`, `forget(target)`.

**Hooks:**
- `SessionStart`: kick off a background incremental refresh (hash check over the
  tree) and inject one line telling Claude the knowledge base exists and to use
  `recall` before reading files.
- `PostToolUse` on `Edit|Write|MultiEdit|NotebookEdit`: re-index the touched file.
- `SessionEnd`: index the session's transcript.

Hooks must never block Claude: they spawn the work in the background and exit.

**What gets indexed:**
- Files: respect `.gitignore` (plus `.git`, `node_modules`, build dirs), skip
  binaries and files > 1 MB, hard-exclude secrets (`.env*`, `*.pem`, `*.key`,
  `id_rsa*`, etc.) even if not gitignored.
- Chats: `~/.claude/projects/<project-slug>/*.jsonl`. Keep user messages and
  assistant text; drop tool results (huge, and the files themselves are already
  indexed). Chunk by user→assistant exchange. Existing history is indexed on
  first build.
- Notes: saved via `save_note`; boosted in ranking.

**Decision notes:** extracted by Claude during the session via the `remember`
skill, not by a background process — Claude already has the context, and
there's no offline LLM to do it after the fact. *(my call)*

## Settled after builder review *(my calls)*

- **Project identity:** the git repo root if inside one, else the launch cwd.
  Transcripts from every `~/.claude/projects/` folder whose cwd falls under that
  root are merged into the one index. Worktrees get their own index.
- **`forget` is sticky:** it deletes rows *and* adds the path/glob/session to a
  stored exclusion list that the indexer, hooks and `reindex(full)` all honor.
  `forget` with `undo` removes an exclusion.
- **Secrets in chats:** transcript text passes through a regex redaction pass
  (API-key shapes, `KEY=value` lines, private-key blocks, JWTs, long
  high-entropy tokens) that masks matches before chunking and embedding.
- **Stale notes:** results always show each note's date; `save_note` takes an
  optional `supersedes` note id, and superseded notes are excluded from search.
  The `remember` skill tells Claude to search existing notes before saving.
- **Model download:** happens automatically, once, on the first session after
  install (consequence of automatic indexing). The SessionStart line tells
  Claude it is happening so Claude can mention it. Until the model is present
  the server still starts, `status` works, and `search` falls back to
  keyword-only results with a line saying semantic search is still loading.

## Automatic indexing (user's decision)

Indexing starts by itself in every project Claude Code is opened in; no setup
step. The `.remember/` folder is created on first run. Guardrails *(my calls)*:

- **Never auto-index** `/`, `~`, `~/Desktop`, `~/Documents`, `~/Downloads`
  themselves (subfolders are fine). Running the `index` skill there overrides.
- **Size check before the first build:** if the tree has more than ~5,000
  indexable files or ~50 MB of text, don't start; the SessionStart line tells
  Claude to ask the user, and the `index` skill starts it on a yes.
- **Background and low priority:** the indexer runs as a detached process under
  `nice`, one at a time per project (lock file in `.remember/`), and Claude
  keeps working while it runs. Searches during a first build return partial
  results labeled as such.
- **Opt-out:** an empty `.remember/off` file disables the plugin for a project;
  the `forget` skill can create it.

## Left to the builder

- Chunking details: markdown by heading; code by blank-line-separated top-level
  blocks packed into ~40–80 line windows with small overlap; plain text by
  paragraphs. Tree-sitter is out of scope for v1.
- Exact result formatting and token cap.
- How dependencies get installed (`npm install` in the plugin dir is acceptable
  for a local plugin; the `index` skill should detect a missing install and say
  how to fix it).
- Locking between hook processes and the MCP server (busy timeout is likely
  enough).

## First step: spike

Before building, verify on this Intel Mac that `@huggingface/transformers`
loads and embeds with the chosen model, and that `node:sqlite` supports FTS5.
If the ONNX runtime fails on x64 macOS, fall back to `fastembed`-style ONNX via
Python, or a different runtime — decide then.
