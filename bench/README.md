# Benchmarks

Deterministic simulations of how many tokens Claude Code spends finding things with and without `remember`. No language model is called: each policy is a scripted sequence of tool calls (Grep, Read, search), and tokens are counted as `ceil(chars / 4)` of what each tool would return, the same way for every policy. The real plugin code and the real embedding model are used for indexing and search.

Needs the embedding model in `~/.claude/remember/models` (or set `REMEMBER_MODELS_DIR`). Scratch data goes to `$BENCH_DIR` (default: `<tmp>/remember-bench`).

```
# Code search: clones express, flask, gin and ripgrep, indexes them, runs 604 questions
node bench/code/gen-queries.js
node bench/code/build-index.js
node bench/code/simulate.js

# Chats and decision notes: synthetic history of 40 sessions, 80 questions, fixed cost, break-even
node bench/memory/simulate.js
```

Results: [`results/code-summary.md`](results/code-summary.md) and [`results/memory-summary.md`](results/memory-summary.md), with per-question rows in the matching `.json` files.
