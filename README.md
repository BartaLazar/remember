# remember

A Claude Code plugin that keeps a local knowledge base of each project: its files, your past chats with Claude, and decision notes. Claude searches it instead of grepping and reading whole files, so it spends fewer tokens finding things and remembers what was decided in earlier sessions.

Everything stays on your machine. Nothing is sent to any service.

## What it does

- Indexes the files in your project (respecting `.gitignore`) with both keyword search and multilingual semantic search.
- Indexes your past Claude Code chats for the project, with obvious secrets redacted.
- Stores decision notes that you and Claude agree are worth keeping.
- Answers searches with `file:line` pointers, so Claude reads only the relevant lines.
- Keeps the index current as files change, and refreshes at the start of each session.

## Install

```
/plugin marketplace add BartaLazar/remember
/plugin install remember@remember
```

Requirement: Node.js 22.13 or newer on your `PATH`.

## First run

1. Claude Code installs the plugin's npm dependencies. If that does not finish, the plugin installs them in the background (log: `install.log`).
2. The embedding model (`multilingual-e5-small`, about 120 MB) is downloaded once from Hugging Face and cached in the plugin data folder (outside a Claude Code session: `~/.claude/remember/models`). Only the model weights are fetched. No project data is sent.
3. Indexing starts by itself in the background at low priority. Until the model is ready, search falls back to keyword results and says so.

The plugin never auto-indexes `/`, your home folder, or `~/Desktop`, `~/Documents`, `~/Downloads` themselves (their subfolders are fine). The `index` skill overrides this.

## The `.remember/` folder

Created in the project root on first run:

- `notes.jsonl`: your decision notes. The one file worth backing up; everything else can be rebuilt.
- `exclusions.json`: what you asked `forget` to keep out of the index.
- `index.db`: the search index (SQLite). Rebuildable.
- `worker.log`: log of the background indexer.
- `status.json`, `lock`, `pending.jsonl`: internal indexer state.
- `off` (only if you create it): disables the plugin for this project.

A `.gitignore` inside the folder keeps it out of git automatically.

## Size threshold

If a project has more indexable files than the threshold, the first build waits and Claude asks whether to index everything, skip the project, or change the threshold. The default is 5,000 files; `0` means never ask. The threshold is global and lives in `config.json` in the plugin data folder (outside Claude Code: `~/.claude/remember/`). To change it, ask Claude ("set the remember threshold to 20000"), which calls the `configure` tool.

## Turn it off for a project

Ask Claude to turn remember off here (the `forget` skill), or create an empty file `.remember/off`. Delete the file to turn it back on. The `forget` skill can also remove a file, folder, glob or chat session from the index.

## Skills

- `recall`: search the knowledge base before reading or grepping files.
- `remember`: save a decision, convention or constraint with its reason.
- `index`: build or refresh the index, and change the size threshold.
- `status`: show what is indexed and whether the index is current.
- `forget`: exclude or remove content, or switch the plugin off or on for a project.

## Privacy

- The plugin only goes online to install: the one-time model download from Hugging Face and, if Claude Code's own dependency install failed, the packages from the npm registry. These only fetch files.
- After the model is cached, everything runs offline. A test (`test/offline.test.js`) indexes and searches with all network access blocked and fails on any attempt.
- Files, chats and notes never leave the project's `.remember/` folder.
- Chat text is stored with common secret patterns redacted.
- The plugin never sends your files, chats, notes or any other data to an external service or third party. What the operating system or its runtimes do on their own (for example Windows diagnostic data) is outside the plugin's scope.

## Troubleshooting

- Ask Claude for the index `status`: it shows the root, progress, counts, whether the model is present, and the threshold.
- `.remember/worker.log` records indexer errors.
- `install.log` (in the plugin data folder) records dependency installation.
- Search shows keyword-only results: the model is still downloading or failed to download. Check connectivity once, then restart the session.
- Stale or odd results: ask Claude to rebuild the index (`index` skill).

## Why the dependencies are pinned

`@huggingface/transformers` is pinned to 4.3.2 and `onnxruntime-node` is overridden to 1.23.2. From 1.24, `onnxruntime-node` dropped macOS Intel (x64) binaries. 1.23.2 ships macOS x64 and arm64, Linux and Windows, so the plugin works on all of them.

## Development

```
npm ci
npm test
claude plugin validate --strict
```

Tests that need the real model skip themselves when it is not cached. Licensed MIT.
