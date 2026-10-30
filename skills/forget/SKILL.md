---
name: forget
description: Use when the user wants a file, folder, glob or past chat session kept out of the project index, wants it removed from the index, or wants remember turned off (or back on) for this project. Calls forget on the remember MCP server.
---

# Forget

Call `forget` (remember MCP server).

- File, folder or glob: `forget({target: "secrets/**"})`.
- Chat session: `forget({target: "session:<id>"})`. A session id is required.
- Turn remember off for this project: `forget({disable_project: true})`.
- Turn it back on: `forget({disable_project: true, undo: true})`.
- Reverse an exclusion: `forget({target, undo: true})`. It re-indexes in the background.

The reply says what was excluded and removed from the index. Confirm that to the user in one line and mention that `undo` reverses it.
