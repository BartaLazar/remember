---
name: recall
description: Use BEFORE reading, grepping or globbing files to find where something is implemented, how something works, or what was discussed or decided in earlier sessions of this project. Searches the local knowledge base and returns file:line pointers so you read only the relevant lines.
---

# Recall

Call `search` (from the remember MCP server) before opening or grepping files.

1. Write a natural-language query and add key identifiers (function, file or error names).
   If the user wrote in a different language from the project's code and comments (usually English), keep their wording as `query` and also pass your translation as `translation`. Code is searched far better in its own language; past chats and notes may be in the user's language, so both are used.
2. Set `scope` when the question is clearly about one source: `chats` for past sessions, `notes` for saved decisions, `files` for code and docs. Default is `all`.
3. Each result is a file:line pointer. Read only those line ranges, with a little context around them.
4. Re-read any result marked CHANGED. The file was edited after it was indexed, so the snippet may be stale.
5. If results are empty, or only weak keyword matches, fall back to normal reading and grep.
6. Do not repeat the same search. Rephrase once at most, then fall back.

If the reply is "remember is turned off for this project." or "remember is not active here: this folder is too broad to index.", tell the user and use normal reading. Use the `index` or `forget` skills to change that, not this one.
