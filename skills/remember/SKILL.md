---
name: remember
description: Use when the user and Claude settle a decision, convention, constraint or non-obvious fact about this project, with its reason, that a future session would otherwise get wrong or re-debate. Not for routine choices the code or git history already shows.
---

# Remember

Save settled decisions with `save_note` (remember MCP server).

1. First call `search` with `scope: 'notes'` to see whether a note on the topic exists.
2. If an older note conflicts with the new decision, pass its id as `supersedes`.
3. Set `title` to the decision itself.
4. Write `body` as what was decided, why, and the date context. Keep it to 120 words or fewer.
5. Optionally add `tags` for later lookup.
6. Do not save what the code or git history already shows.

The reply `Saved note <id>.` confirms the save. Notes are stored locally and indexed in the background.
