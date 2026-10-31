# remember: memory / chat-recall token simulation

Deterministic, no LLM calls. tokens = ceil(chars/4) for every policy. Synthetic project: 40 transcripts (18,974 KB total, 30 KB to 2,051 KB each), 60 planted facts (10 superseded pairs), 25 decision notes, 30 small source files; index = {"file":30,"chat":40,"note":21,"chunks":2233,"unembedded":0} chunks, built in 58 s with the real multilingual-e5-small embedder. 80 hand-written questions.

## 1. Fixed cost per session

| component | schemas loaded | deferred |
| --- | --- | --- |
| 5 skill descriptions (name + description) | 327 | 327 |
| MCP tools (6): search, save_note, reindex, status, configure, forget | 712 | 59 (names only) |
| SessionStart hook line | 59 | 59 |
| **Fixed total per session** | **1,098** | **445** |
| First lookup only: recall SKILL.md body (+ search schema fetch when deferred) | 314 | 568 |

Tool JSON is the tools array exactly as the server lists it; trimmed to name/description/input_schema it is 654 tokens. Per tool: search 194, save_note 127, reindex 119, status 72, configure 94, forget 105.

## 2. Recall quality (remember, one search() call, limit 8, scope all)

| slice | n | recall@1 | recall@8 (chunk contains fact) | fact visible in formatted output |
| --- | --- | --- | --- | --- |
| **overall** | 80 | 72.5% | 85% | 85% |
| lang en | 65 | 72.3% | 84.6% | 84.6% |
| lang de | 4 | 75% | 75% | 75% |
| lang nl | 4 | 100% | 100% | 100% |
| lang fr | 4 | 50% | 100% | 100% |
| lang es | 3 | 66.7% | 66.7% | 66.7% |
| type regular | 40 | 72.5% | 87.5% | 87.5% |
| type vague | 15 | 60% | 66.7% | 66.7% |
| type foreign | 15 | 73.3% | 86.7% | 86.7% |
| type superseded | 10 | 90% | 100% | 100% |
| fact also saved as a note | 33 | 87.9% | 90.9% | 90.9% |
| fact only in chat history | 47 | 61.7% | 80.9% | 80.9% |

Superseded decisions (10 questions, newest answer is correct):

| measure | count |
| --- | --- |
| newest version in top 8 | 10/10 |
| newest version at rank 1 | 9/10 |
| both old and new returned | 10 |
| ... and newest ranked above old | 10/10 |
| only the OLD version returned (stale answer risk) | 0 |
| neither returned | 0 |
| questions whose newest fact also has a note (old note is excluded via supersedes) | 6 |

Among chat results, newer chats get a small score boost, so a later decision tends to rank above the one it replaced; notes with `supersedes` remove the old note entirely.

## 3. Tokens per lookup, by policy (80 questions)

| policy | median | mean | p90 | max | found the fact |
| --- | --- | --- | --- | --- | --- |
| remember (1 search call) | 655 | 665 | 820 | 1,144 | 85% in top 8 (85% visible) |
| grep transcripts + Read best file | 150,645 | 284,461 | 707,418 | 1,190,744 | 45% (grep output 42.5%, Read 28.8%) |
|   grep step alone (100-line cap) | 774 | 36,760 | 180,691 | 664,017 | - |
|   grep step alone, lines cut to 500 chars | 770 | 7,068 | 20,414 | 20,497 | - |
|   Read step alone (2000-line cap) | 150,437 | 247,701 | 526,727 | 526,727 | - |
| re-explain (fact + 40) | 66 | 67 | 74 | 77 | 100% if the user remembers it |

Grep baseline found the fact for 36/80 questions; 11 questions had no usable query word in the corpus (foreign wording). Superseded questions found by grep: 7/10. Median search latency 34 ms.

### Memory file (CLAUDE.md-style) vs flat search cost

| decisions in file | file tokens, paid EVERY session | remember: fixed + first use + 1 lookup (deferred) | ... + 3 lookups | ... + 5 lookups | ... + 3 lookups (schemas loaded) |
| --- | --- | --- | --- | --- | --- |
| 10 | 292 | 1,668 | 2,977 | 4,286 | 3,376 |
| 25 | 726 | 1,668 | 2,977 | 4,286 | 3,376 |
| 60 | 1,464 | 1,668 | 2,977 | 4,286 | 3,376 |
| 150 | 3,482 | 1,668 | 2,977 | 4,286 | 3,376 |
| 400 | 9,035 | 1,668 | 2,977 | 4,286 | 3,376 |

Memory file costs about 22.2 tokens per decision. It overtakes remember (deferred, 3 lookups/session) at about 135 decisions. The file has no retrieval cost and no miss, but it only holds what someone wrote down and it never covers chat history that was not distilled into it.

## 4. Break-even

Fixed cost must be repaid by per-lookup savings. Expected saving per lookup = hit x baseline - remember cost (a miss costs the search and then you fall back anyway). The code-search saving is a **placeholder of 3,000 tokens/lookup; the code agent's measured numbers should be plugged in** (rerun with `--code-savings=N`).

| scenario | saving / lookup (tokens) | lookups to break even, schemas loaded | schemas deferred | loaded, ignoring first-use | deferred, ignoring first-use |
| --- | --- | --- | --- | --- | --- |
| code search (placeholder, --code-savings) | 3,000 | 1 | 1 | 1 | 1 |
| chat recall vs grep+read (median) | 77,692 | 1 | 1 | 1 | 1 |
| chat recall vs grep+read (mean) | 241,088 | 1 | 1 | 1 | 1 |
| chat recall vs grep only (median) | -25 | never | never | never | never |
| chat recall vs re-explain (mean) | -608 | never | never | never | never |

## 5. Findings

1. Fixed cost is 1,098 tokens/session with schemas loaded and 445 deferred. Deferral removes 59.5% of it; the tools array is the bulk when loaded.
2. Retrieval: recall@8 85%, recall@1 72.5%; only 85% of facts are actually visible in the formatted output because snippets are cut at 600 chars (a long chunk can contain the fact in the index but not in what the model reads). Notes help: 90.9% vs 80.9% (recall@8 note-backed vs chat-only).
3. Versus grepping transcripts, a search costs a median 655 tokens against 150,645 for grep + Read (230x), and grep found the fact only 45% of the time, and only 2/15 non-English queries. The transcript Read alone would be 150,437 tokens at the median (real Claude Code also refuses big files, which this does not model).
4. Where it loses: re-explaining costs a median 66 tokens, far below 655 per search, so remember never pays back in tokens against re-typing (it saves the user's time and memory, not tokens). Likewise a small decision file (under ~135 decisions) is cheaper per session than the plugin's fixed cost plus 3 lookups, and 100% reliable; the file grows linearly (9,035 tokens at 400 decisions) while search stays flat.
5. Superseded decisions: newest in top 8 for 10/10, newest above old when both returned 10/10, old-only (stale answer) 0/10. Newer chats get a small ranking boost; notes with `supersedes` remove the old note. Cross-lingual queries: de 75%, nl 100%, fr 100%, es 66.7% recall@8.

## Caveats

- Synthetic corpus: filler chat and tool output are template-generated, so retrieval is probably easier than real history (topics in filler are shallow, the facts are distinctive, keys unique). Real recall will likely be lower.
- Ground truth is substring presence of the planted key in a returned chunk; notes duplicate chat facts so note-backed facts are easy. 25 notes cover 25 facts (21 are active in the index after 4 supersessions), more than most users will write.
- Grep baseline: query words are picked by corpus rarity (an oracle-ish advantage, df over the real corpus), matched case-insensitively as substrings, cap 100 lines, best file chosen by visible match count; untruncated lines counted as instructed. Real Claude Code may truncate long lines or refuse the Read (>~25k tokens), which would change both cost and hit rate.
- Deferred-schema cost approximates names as `mcp__plugin_remember_remember__<tool>`; first-use cost for deferred adds the search schema plus 60 tokens for the schema-fetch call. Skill list lines assumed `- remember:<name>: <description>`.
- Memory-file lines beyond the 60 real decisions are synthesized at the same average length; the file model assumes every decision was written down and the model always reads it, i.e. it is an upper bound on file usefulness.
- Re-explain tokens ignore the user's time and the chance they forgot. Savings for code search are a placeholder until the code benchmark is merged.
