---
name: status
description: Use when the user asks what is indexed, whether the index is up to date, how big it is, or why search results seem wrong or missing. Calls status on the remember MCP server and summarizes it.
---

# Status

Call `status` (remember MCP server). It returns lines for root, phase, progress, counts of files, chats and notes, unembedded items, whether the model is present, exclusions, whether the plugin is off, last update and the size threshold.

Summarize in 5 lines or fewer. Lead with the answer to the user's question, then only the relevant facts:
- phase `not indexed` or progress below total: indexing is not finished, results may be incomplete.
- unembedded above 0 or model present `no`: search falls back to keyword matching and may be weak.
- exclusions or `off: yes`: explain that these hide content on purpose.

Offer `reindex` (see the `index` skill) if the index looks stale. Do not change anything without being asked.
