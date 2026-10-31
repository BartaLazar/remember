<div align="center">

# remember

**A local memory for Claude Code.**<br>
Your project's files, your past chats and the decisions you made, searchable in one step and never sent anywhere.

[![Tests](https://github.com/BartaLazar/remember/actions/workflows/test.yml/badge.svg)](https://github.com/BartaLazar/remember/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933.svg)](https://nodejs.org)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-lightgrey.svg)

</div>

---

Every new Claude Code session starts from zero. Claude greps, opens whole files to find ten relevant lines, and asks again about things you settled last week. That costs tokens, time and patience.

**remember** gives Claude a knowledge base of the project it is working in. Before reading files, Claude asks it a question and gets back a handful of short snippets with exact `file:line` pointers, then reads only those lines. Decisions you made in earlier sessions come back too, with their reasons and dates.

It sets itself up. Install it, open a project, and indexing starts in the background.

## Install

```
/plugin marketplace add BartaLazar/remember
/plugin install remember@remember
```

That's it. You need **Node.js 22.13 or newer** on your `PATH`.

The first session downloads the embedding model once (about 120 MB). Until it arrives, search still works with keyword matching and says so.

## What it looks like

You ask Claude something about your project:

> **You:** Where do we handle expired refresh tokens, and didn't we decide something about retries?

Claude searches before it opens any file, and gets back:

```
[1] src/auth/session.ts:88-121
export async function refresh(token: RefreshToken) {
  if (token.expiresAt < Date.now()) {
    throw new SessionExpiredError(token.userId);
  ...

[2] note "No automatic retry on refresh failure" (2026-10-12)
Retrying a failed refresh hid revoked sessions from users. On failure we sign the user out. ...

[3] src/auth/errors.ts:14-30 — CHANGED SINCE INDEXED, re-read before trusting
export class SessionExpiredError extends Error {
  ...
```

Then it reads lines 88–121 of one file instead of the whole `auth/` folder, and remembers the decision without being told twice.

<sub>Example output. The format is what the plugin returns; the code and note are made up.</sub>

## What gets remembered

| Source | What is indexed | Kept fresh by |
|---|---|---|
| **Files** | Every text file in the project, respecting `.gitignore`. Binaries, files over 1 MB and secret files (`.env*`, keys, certificates, credentials) are always skipped. | Re-indexing each file Claude edits, plus a quick change check at the start of every session. |
| **Chats** | Your past Claude Code conversations in this project: what you asked and what Claude answered. Tool output is left out, and common secret patterns (API keys, tokens, passwords, connection strings) are masked before anything is stored. | Adding each session when it ends. |
| **Decision notes** | Short notes Claude saves when you settle something: the decision, the reason and the date. They rank above other results, and a newer note can replace an older one. | You and Claude, as you work. |

## How it works

```mermaid
flowchart LR
    subgraph Your machine
        A[Project files] --> I(Indexer)
        B[Past chats] --> I
        C[Decision notes] --> I
        I -- "embeddings + full-text" --> D[(.remember/index.db)]
        Q[Claude asks a question] --> S(Hybrid search)
        D --> S
        S -- "8 snippets with file:line" --> R[Claude reads only those lines]
    end
```

- **Hybrid search.** Every query runs twice: once by meaning, with a multilingual embedding model, and once by exact words with SQLite full-text search. The two rankings are merged, so it finds both "where do we log people out" and `SessionExpiredError`.
- **Multilingual.** The model, [`multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small), understands about 100 languages. You can ask in a different language from the one your code and comments are written in.
- **Small answers.** A search returns at most 8 short snippets, about 1,500 tokens, so the lookup itself never becomes the expensive part.
- **Honest about staleness.** If a file changed after it was indexed, its result says so, and Claude re-reads it before trusting it.
- **Never in the way.** Hooks start the indexer as a detached, low-priority background process and return immediately. Only one indexer runs per project at a time.
- **Incremental.** Only content whose hash changed gets re-embedded.

## Using it

Most of the time you do nothing: Claude reaches for the knowledge base by itself. You can also just ask:

| Say something like | What happens |
|---|---|
| "What did we decide about pagination?" | Claude searches your notes and past chats (`recall`). |
| "Remember that we never retry payment webhooks, because…" | Claude saves a decision note (`remember`). |
| "Is the index up to date?" | Progress, counts, model state and threshold (`status`). |
| "Rebuild the index" | Full background rebuild (`index`). |
| "Forget `legacy/**`" or "Forget that chat session" | Removed now and kept out from then on (`forget`). |
| "Turn remember off for this project" | The plugin stops working in this project until you turn it back on (`forget`). |

<details>
<summary><b>The five skills and six tools</b></summary>

<br>

**Skills** teach Claude when to use the knowledge base:

| Skill | Purpose |
|---|---|
| `recall` | Search before reading, grepping or globbing files. |
| `remember` | Save a decision, convention or constraint with its reason. |
| `index` | Build or refresh the index; change the size threshold. |
| `status` | Show what is indexed and whether it is current. |
| `forget` | Exclude or remove content; switch the plugin off or on for a project. |

**MCP tools** do the work: `search`, `save_note`, `reindex`, `status`, `configure`, `forget`.

**Hooks:** `SessionStart` (refresh changed files and tell Claude the knowledge base exists), `PostToolUse` on edits (re-index the touched file), `SessionEnd` (index the finished chat).

</details>

## Privacy

remember was built with one rule: **your project never leaves your machine.**

- The plugin only goes online to install: the one-time model download from Hugging Face and, if Claude Code's own dependency install failed, the packages from the npm registry. These only fetch files.
- After the model is cached, everything runs offline. A test ([`test/offline.test.js`](test/offline.test.js)) indexes and searches with all network access blocked, and fails on any attempt to connect.
- Files, chats and notes never leave the project's `.remember/` folder.
- Chat text is stored with common secret patterns redacted.
- The plugin never sends your files, chats, notes or any other data to an external service or third party. What the operating system or its runtimes do on their own (for example Windows diagnostic data) is outside the plugin's scope.

## Your data: the `.remember/` folder

Each project gets its own `.remember/` folder in its root. It contains a `.gitignore` of its own, so git never sees the folder and nothing in it ends up in a commit.

| File | What it is |
|---|---|
| `notes.jsonl` | Your decision notes. **The one file worth backing up.** Everything else can be rebuilt. |
| `exclusions.json` | What you asked `forget` to keep out. |
| `index.db` | The search index (SQLite). Safe to delete; it is rebuilt. |
| `worker.log` | Log of the background indexer. |
| `status.json`, `lock`, `pending.jsonl` | Internal indexer state. |
| `off` | Only exists if you turned the plugin off for this project. |

## Settings and safeguards

**Large projects.** If a project has more than 5,000 indexable files, the first build waits and Claude asks you what to do: index everything, skip this project, or change the threshold. Once you say yes, everything is indexed, with no cap. To change the threshold, tell Claude, for example *"set the remember threshold to 20000"*. `0` means never ask. The setting is global and lives in `config.json` in the plugin's data folder.

**Folders it won't index automatically.** Filesystem roots, your home folder, and `~/Desktop`, `~/Documents` and `~/Downloads` themselves are never indexed on their own. Their subfolders are fine. Ask Claude to index one of them and it will.

**Off switch.** Ask Claude to turn remember off for a project, or create an empty `.remember/off` file. Delete it to turn the plugin back on.

## Platforms

| | macOS (Apple silicon) | macOS (Intel) | Linux | Windows |
|---|:-:|:-:|:-:|:-:|
| Supported | ✓ | ✓ | ✓ | ✓ |
| Tested in CI on Node 22 and 24 | ✓ | ✓ | ✓ (x64) | ✓ (x64) |

## Troubleshooting

<details>
<summary><b>Search only returns keyword results</b></summary>

<br>

The embedding model is still downloading or the download failed. Make sure you are online once, then start a new session. Ask Claude for the index `status` to see whether the model is present.
</details>

<details>
<summary><b>Results seem stale, wrong or missing</b></summary>

<br>

Ask Claude for the index `status`. It shows the project root, progress, counts and exclusions. If something looks off, ask Claude to rebuild the index. Indexer errors are written to `.remember/worker.log`.
</details>

<details>
<summary><b>"Dependencies are missing" at session start</b></summary>

<br>

Claude Code's automatic install did not finish, so the plugin installs the dependencies in the background and is ready next session. The log is `install.log` in the plugin's data folder. If that install fails too, run `npm ci --omit=dev` in the plugin folder that the message names.
</details>

<details>
<summary><b>"Needs Node.js 22.13 or newer"</b></summary>

<br>

The plugin uses Node's built-in SQLite, which arrived in 22.13. Install a current Node.js LTS and make sure `node -v` shows it in the shell Claude Code starts from.
</details>

## Development

```
npm ci
npm test
claude plugin validate --strict
```

Tests that need the real model skip themselves when it is not cached. CI runs the full suite on macOS (Apple silicon and Intel), Linux and Windows, each with Node 22 and 24.

<details>
<summary><b>Why the dependencies are pinned</b></summary>

<br>

`@huggingface/transformers` is pinned to 4.3.2 and `onnxruntime-node` is overridden to 1.23.2. From 1.24, `onnxruntime-node` dropped macOS Intel (x64) binaries. 1.23.2 still ships macOS x64 and arm64, Linux and Windows, so the plugin runs on all of them.
</details>

Design notes are in [`docs/design.md`](docs/design.md).

## License

[MIT](LICENSE) © Bart Alazar
