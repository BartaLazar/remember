---
name: index
description: Use when the user asks to build, rebuild or refresh the project index, when session context says the folder is too broad or over the size threshold, or when the user wants to change that threshold. Calls reindex and configure on the remember MCP server.
---

# Index

Build or refresh the index with `reindex`; set the size threshold with `configure`. Both belong to the remember MCP server.

- Refresh: `reindex()`. For specific files, pass `paths` as an array of repo-relative paths.
- Rebuild from scratch: `reindex({full: true})`.
- Indexing runs in the background. Tell the user it may take a while and that `status` shows progress.
- Use `force: true` only after the user has agreed to index a large or broad project.

When session context says the project exceeds the user's size threshold, do not index yet. Ask which they want:
1. Index everything now: `reindex({force: true})`.
2. Skip this project: `forget({disable_project: true})`.
3. Change the threshold: ask for the number, call `configure({max_files})`, then `reindex()`.

When the user asks to change the threshold at any time, ask for the number and call `configure({max_files})`. A value of 0 means never ask.

If session context says dependencies are installing in the background, tell the user the knowledge base will be ready next session. If it says they are missing, give the user the exact command from that message (it names the directory). Do not invent a command or run it unasked.
