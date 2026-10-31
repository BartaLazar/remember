# Code-search token simulation

Tokens = ceil(chars/4) of simulated tool output. A = Grep + whole-file Reads (max 5 files); B = Grep + 120-line window Reads; remember = search() then Read hit +/-15 lines, else fallback to A (search cost wasted). Oracle assumptions: the agent stops once it has read the target, and picks the correct hit among the 8 results. "saved" = 1 - total remember tokens / total baseline tokens. hit@k is plugin recall (chunk overlapping the target range, among results that survive formatResults' 6000-char cap).

## Corpora and index

| repo | version | files indexed | chunks | build s |
|---|---|---|---|---|
| express | v5.3.0 | 213 | 645 | 67.2 |
| flask | 3.1.3 | 229 | 1180 | 183.5 |
| gin | v1.12.0 | 128 | 837 | 173.5 |
| ripgrep | 15.2.0 | 214 | 2312 | 349.9 |
| remember | working copy (excl. node_modules) | 52 | 253 | 30.4 |

## Overall

| group | n | hit@1 | hit@8 | A/B found | A tok med/mean | B tok med/mean | remember tok med/mean | saved vs A | saved vs B | calls A/B/R |
|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 604 | 44% | 84% | 77%/63% | 23,724 / 29,245 | 11,211 / 12,158 | 2,207 / 7,361 | 75% | 39% | 5.2 / 10.0 / 2.8 |
| identifier | 182 | 41% | 84% | 93%/92% | 14,624 / 17,077 | 3,485 / 5,572 | 2,234 / 4,936 | 71% | 11% | 4.4 / 5.9 / 2.7 |
| docstring | 182 | 58% | 93% | 77%/60% | 23,750 / 29,591 | 13,643 / 12,771 | 2,114 / 4,517 | 85% | 65% | 5.1 / 10.4 / 2.4 |
| vague | 174 | 44% | 89% | 64%/41% | 35,054 / 38,485 | 19,176 / 16,860 | 2,187 / 7,727 | 80% | 54% | 5.8 / 13.0 / 2.7 |
| natural | 50 | 14% | 62% | 64%/46% | 31,389 / 40,426 | 16,737 / 16,593 | 2,498 / 18,686 | 54% | -13% | 6.0 / 12.6 / 4.1 |
| multilingual | 16 | 0% | 6% | 63%/56% | 27,240 / 28,292 | 13,491 / 15,112 | 28,021 / 27,926 | 1% | -85% | 6.1 / 10.8 / 6.7 |

## Per repo

| group | n | hit@1 | hit@8 | A/B found | A tok med/mean | B tok med/mean | remember tok med/mean | saved vs A | saved vs B | calls A/B/R |
|---|---|---|---|---|---|---|---|---|---|---|
| express | 81 | 48% | 73% | 78%/60% | 31,108 / 31,122 | 11,945 / 12,426 | 1,942 / 11,095 | 64% | 11% | 5.5 / 11.6 / 3.3 |
| flask | 130 | 38% | 86% | 78%/64% | 25,346 / 31,609 | 12,993 / 12,673 | 2,412 / 7,695 | 76% | 39% | 5.2 / 10.5 / 2.8 |
| gin | 130 | 62% | 92% | 81%/64% | 22,187 / 29,325 | 8,700 / 10,389 | 2,048 / 5,450 | 81% | 48% | 4.9 / 9.7 / 2.4 |
| ripgrep | 127 | 44% | 91% | 80%/57% | 26,808 / 38,786 | 11,464 / 12,818 | 2,264 / 7,633 | 80% | 40% | 4.7 / 10.6 / 2.4 |
| remember | 136 | 29% | 75% | 68%/68% | 16,666 / 16,880 | 11,562 / 12,580 | 2,109 / 6,391 | 62% | 49% | 5.8 / 8.2 / 3.3 |

## Per repo x query type

| group | n | hit@1 | hit@8 | A/B found | A tok med/mean | B tok med/mean | remember tok med/mean | saved vs A | saved vs B | calls A/B/R |
|---|---|---|---|---|---|---|---|---|---|---|
| express / identifier | 22 | 41% | 77% | 82%/73% | 32,068 / 25,588 | 10,445 / 9,366 | 1,889 / 8,842 | 65% | 6% | 5.3 / 9.6 / 3.2 |
| express / docstring | 22 | 73% | 91% | 82%/55% | 31,419 / 29,988 | 14,458 / 13,657 | 1,701 / 5,538 | 82% | 59% | 5.2 / 12.6 / 2.5 |
| express / vague | 19 | 68% | 84% | 74%/53% | 32,201 / 36,149 | 16,073 / 15,026 | 1,920 / 7,578 | 79% | 50% | 5.8 / 13.3 / 2.7 |
| express / natural | 10 | 10% | 60% | 70%/60% | 30,818 / 33,808 | 10,940 / 11,893 | 2,123 / 15,839 | 53% | -33% | 5.8 / 10.9 / 3.7 |
| express / multilingual | 8 | 0% | 0% | 75%/63% | 30,818 / 34,166 | 10,940 / 11,948 | 31,552 / 34,991 | -2% | -193% | 5.8 / 10.9 / 6.8 |
| flask / identifier | 40 | 38% | 88% | 98%/98% | 15,968 / 18,685 | 2,959 / 5,217 | 2,353 / 4,727 | 75% | 9% | 4.4 / 6.0 / 2.4 |
| flask / docstring | 40 | 50% | 90% | 73%/57% | 34,210 / 34,531 | 15,537 / 14,171 | 2,425 / 6,808 | 80% | 52% | 5.4 / 11.3 / 2.7 |
| flask / vague | 40 | 30% | 83% | 57%/35% | 40,082 / 40,204 | 20,757 / 17,741 | 2,422 / 11,767 | 71% | 34% | 5.9 / 14.1 / 3.2 |
| flask / natural | 10 | 20% | 80% | 100%/70% | 24,260 / 37,242 | 16,282 / 16,232 | 2,529 / 6,826 | 82% | 58% | 4.5 / 11.8 / 2.6 |
| gin / identifier | 40 | 73% | 98% | 100%/100% | 14,297 / 16,489 | 2,574 / 3,595 | 2,033 / 2,340 | 86% | 35% | 3.9 / 4.7 / 2.0 |
| gin / docstring | 40 | 70% | 98% | 80%/57% | 17,190 / 27,726 | 10,030 / 11,531 | 2,030 / 2,371 | 91% | 79% | 4.6 / 10.3 / 2.0 |
| gin / vague | 40 | 55% | 88% | 70%/40% | 40,676 / 40,512 | 17,769 / 15,136 | 2,036 / 6,852 | 83% | 55% | 5.7 / 13.4 / 2.5 |
| gin / natural | 10 | 10% | 60% | 50%/40% | 49,275 / 42,320 | 15,640 / 14,013 | 2,278 / 24,594 | 42% | -76% | 6.5 / 13.0 / 4.8 |
| ripgrep / identifier | 40 | 45% | 93% | 100%/98% | 15,753 / 16,315 | 2,589 / 3,330 | 2,258 / 4,278 | 74% | -28% | 3.3 / 4.3 / 2.2 |
| ripgrep / docstring | 40 | 53% | 95% | 78%/53% | 32,619 / 40,813 | 16,397 / 14,158 | 2,261 / 4,806 | 88% | 66% | 5.0 / 11.6 / 2.3 |
| ripgrep / vague | 37 | 41% | 95% | 65%/27% | 50,999 / 53,497 | 22,268 / 19,328 | 2,256 / 7,585 | 86% | 61% | 5.6 / 15.0 / 2.4 |
| ripgrep / natural | 10 | 20% | 60% | 60%/20% | 65,313 / 66,126 | 22,616 / 21,329 | 2,517 / 32,535 | 51% | -53% | 6.2 / 16.2 / 4.0 |
| remember / identifier | 40 | 10% | 60% | 83%/83% | 15,616 / 12,138 | 8,570 / 8,060 | 2,323 / 6,251 | 49% | 22% | 5.5 / 6.6 / 3.8 |
| remember / docstring | 40 | 53% | 93% | 75%/75% | 14,625 / 15,076 | 9,066 / 10,735 | 2,053 / 3,522 | 77% | 67% | 5.4 / 7.3 / 2.3 |
| remember / vague | 38 | 37% | 92% | 58%/58% | 19,928 / 21,091 | 18,968 / 16,260 | 2,082 / 4,607 | 78% | 72% | 6.1 / 9.6 / 2.5 |
| remember / natural | 10 | 10% | 50% | 40%/40% | 24,477 / 22,634 | 21,909 / 19,499 | 10,942 / 13,638 | 40% | 30% | 6.8 / 11.3 / 5.3 |
| remember / multilingual | 8 | 0% | 13% | 50%/50% | 24,477 / 22,417 | 20,105 / 18,277 | 25,556 / 20,861 | 7% | -14% | 6.5 / 10.6 / 6.6 |

## Loss analysis

- remember falls back to baseline A in 96/604 queries (16%).
- remember costs more than A in 113 queries, more than B in 163 queries (27%).
- Queries where baseline A never found the target: 141; B: 224; remember (incl. fallback): 37.
- Total tokens over 604 queries: A 17,663,890, B 7,343,480, remember 4,446,041.

## Notable findings

1. Biggest savings vs A (whole-file reads): docstring-style behaviour questions (85% saved, recall@8 93%) and vague keyword queries (80%); baseline A burns ~25-40k tokens reading large files, remember answers in ~2k.
2. Savings vs the careful baseline B are far smaller for exact-identifier queries (11%): one precise grep plus a 120-line window costs ~3.5k tokens median, about the same as a search plus read. remember's median (2.2k) wins, but its mean (4.9k) is pulled up by misses.
3. Losses are concentrated in fallbacks: when the target is not in the top 8 (96/604 queries, 16%), the search cost is pure overhead on top of A (+~1.2k tokens). remember costs more than B in 163 queries (27%), 93 of them fallbacks and 70 hit-but-more-expensive cases (long chunk + padding vs a short grep window).
4. Failure pattern, identifier queries on short/generic helpers: the exact-name lookup ("where is isBlocked defined") often misses because semantic embedding of a bare name is weak and FTS OR-matching over all words ("where", "is", "defined") floods results; test files and docs frequently outrank the definition (express: test/res.send.js outranks lib/utils.js).
5. Multilingual queries (DE/NL/FR/ES) are a failure: recall@8 6% (1/16), 0/8 on express; remember is no cheaper than A there (about -1%) and 85% worse than B. FTS contributes nothing for non-English words, and the semantic leg ranks English test/prose chunks above the exact function. Natural questions (hand-written) have only 14% hit@1 / 62% hit@8 and lose 13% vs B, though they still save 54% vs A.

