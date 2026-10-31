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
| ALL | 604 | 56% | 90% | 77%/63% | 23,724 / 29,245 | 11,211 / 12,158 | 2,174 / 6,227 | 79% | 49% | 5.2 / 10.0 / 2.5 |
| identifier | 182 | 79% | 98% | 93%/92% | 14,624 / 17,077 | 3,485 / 5,572 | 2,126 / 2,874 | 83% | 48% | 4.4 / 5.9 / 2.1 |
| docstring | 182 | 58% | 94% | 77%/60% | 23,750 / 29,591 | 13,643 / 12,771 | 2,125 / 4,452 | 85% | 65% | 5.1 / 10.4 / 2.3 |
| vague | 174 | 46% | 89% | 64%/41% | 35,054 / 38,485 | 19,176 / 16,860 | 2,185 / 7,429 | 81% | 56% | 5.8 / 13.0 / 2.6 |
| natural | 50 | 14% | 66% | 64%/46% | 31,389 / 40,426 | 16,737 / 16,593 | 2,482 / 17,168 | 58% | -3% | 6.0 / 12.6 / 3.8 |
| multilingual | 16 | 13% | 50% | 63%/56% | 27,240 / 28,292 | 13,491 / 15,112 | 10,917 / 17,304 | 39% | -15% | 6.1 / 10.8 / 4.9 |

## Per repo

| group | n | hit@1 | hit@8 | A/B found | A tok med/mean | B tok med/mean | remember tok med/mean | saved vs A | saved vs B | calls A/B/R |
|---|---|---|---|---|---|---|---|---|---|---|
| express | 81 | 58% | 83% | 78%/60% | 31,108 / 31,122 | 11,945 / 12,426 | 1,954 / 8,410 | 73% | 32% | 5.5 / 11.6 / 2.9 |
| flask | 130 | 49% | 89% | 78%/64% | 25,346 / 31,609 | 12,993 / 12,673 | 2,411 / 7,100 | 78% | 44% | 5.2 / 10.5 / 2.7 |
| gin | 130 | 68% | 94% | 81%/64% | 22,187 / 29,325 | 8,700 / 10,389 | 2,024 / 4,520 | 85% | 56% | 4.9 / 9.7 / 2.3 |
| ripgrep | 127 | 55% | 93% | 80%/57% | 26,808 / 38,786 | 11,464 / 12,818 | 2,263 / 7,335 | 81% | 43% | 4.7 / 10.6 / 2.4 |
| remember | 136 | 50% | 90% | 68%/68% | 16,666 / 16,880 | 11,562 / 12,580 | 2,077 / 4,691 | 72% | 63% | 5.8 / 8.2 / 2.6 |

## Per repo x query type

| group | n | hit@1 | hit@8 | A/B found | A tok med/mean | B tok med/mean | remember tok med/mean | saved vs A | saved vs B | calls A/B/R |
|---|---|---|---|---|---|---|---|---|---|---|
| express / identifier | 22 | 68% | 91% | 82%/73% | 32,068 / 25,588 | 10,445 / 9,366 | 1,955 / 5,404 | 79% | 42% | 5.3 / 9.6 / 2.5 |
| express / docstring | 22 | 77% | 91% | 82%/55% | 31,419 / 29,988 | 14,458 / 13,657 | 1,907 / 5,663 | 81% | 59% | 5.2 / 12.6 / 2.5 |
| express / vague | 19 | 68% | 84% | 74%/53% | 32,201 / 36,149 | 16,073 / 15,026 | 1,944 / 7,604 | 79% | 49% | 5.8 / 13.3 / 2.7 |
| express / natural | 10 | 10% | 60% | 70%/60% | 30,818 / 33,808 | 10,940 / 11,893 | 2,119 / 15,817 | 53% | -33% | 5.8 / 10.9 / 3.7 |
| express / multilingual | 8 | 13% | 63% | 75%/63% | 30,818 / 34,166 | 10,940 / 11,948 | 1,965 / 16,887 | 51% | -41% | 5.8 / 10.9 / 4.0 |
| flask / identifier | 40 | 73% | 98% | 98%/98% | 15,968 / 18,685 | 2,959 / 5,217 | 2,360 / 2,789 | 85% | 47% | 4.4 / 6.0 / 2.1 |
| flask / docstring | 40 | 53% | 90% | 73%/57% | 34,210 / 34,531 | 15,537 / 14,171 | 2,425 / 6,809 | 80% | 52% | 5.4 / 11.3 / 2.7 |
| flask / vague | 40 | 30% | 83% | 57%/35% | 40,082 / 40,204 | 20,757 / 17,741 | 2,422 / 11,770 | 71% | 34% | 5.9 / 14.1 / 3.2 |
| flask / natural | 10 | 20% | 80% | 100%/70% | 24,260 / 37,242 | 16,282 / 16,232 | 2,529 / 6,826 | 82% | 58% | 4.5 / 11.8 / 2.6 |
| gin / identifier | 40 | 95% | 100% | 100%/100% | 14,297 / 16,489 | 2,574 / 3,595 | 1,988 / 1,951 | 88% | 46% | 3.9 / 4.7 / 2.0 |
| gin / docstring | 40 | 68% | 98% | 80%/57% | 17,190 / 27,726 | 10,030 / 11,531 | 2,029 / 2,369 | 91% | 79% | 4.6 / 10.3 / 2.0 |
| gin / vague | 40 | 57% | 90% | 70%/40% | 40,676 / 40,512 | 17,769 / 15,136 | 1,994 / 5,521 | 86% | 64% | 5.7 / 13.4 / 2.4 |
| gin / natural | 10 | 10% | 70% | 50%/40% | 49,275 / 42,320 | 15,640 / 14,013 | 2,169 / 19,394 | 54% | -38% | 6.5 / 13.0 / 4.1 |
| ripgrep / identifier | 40 | 83% | 98% | 100%/98% | 15,753 / 16,315 | 2,589 / 3,330 | 2,260 / 3,313 | 80% | 0% | 3.3 / 4.3 / 2.1 |
| ripgrep / docstring | 40 | 50% | 95% | 78%/53% | 32,619 / 40,813 | 16,397 / 14,158 | 2,261 / 4,811 | 88% | 66% | 5.0 / 11.6 / 2.3 |
| ripgrep / vague | 37 | 41% | 95% | 65%/27% | 50,999 / 53,497 | 22,268 / 19,328 | 2,256 / 7,600 | 86% | 61% | 5.6 / 15.0 / 2.4 |
| ripgrep / natural | 10 | 20% | 60% | 60%/20% | 65,313 / 66,126 | 22,616 / 21,329 | 2,517 / 32,535 | 51% | -53% | 6.2 / 16.2 / 4.0 |
| remember / identifier | 40 | 70% | 100% | 83%/83% | 15,616 / 12,138 | 8,570 / 8,060 | 2,060 / 2,051 | 83% | 75% | 5.5 / 6.6 / 2.0 |
| remember / docstring | 40 | 53% | 95% | 75%/75% | 14,625 / 15,076 | 9,066 / 10,735 | 2,034 / 3,155 | 79% | 71% | 5.4 / 7.3 / 2.2 |
| remember / vague | 38 | 45% | 92% | 58%/58% | 19,928 / 21,091 | 18,968 / 16,260 | 2,082 / 4,613 | 78% | 72% | 6.1 / 9.6 / 2.5 |
| remember / natural | 10 | 10% | 60% | 40%/40% | 24,477 / 22,634 | 21,909 / 19,499 | 2,484 / 11,269 | 50% | 42% | 6.8 / 11.3 / 4.6 |
| remember / multilingual | 8 | 13% | 38% | 50%/50% | 24,477 / 22,417 | 20,105 / 18,277 | 22,449 / 17,721 | 21% | 3% | 6.5 / 10.6 / 5.9 |

## Loss analysis

- remember falls back to baseline A in 59/604 queries (10%).
- remember costs more than A in 83 queries, more than B in 136 queries (23%).
- Queries where baseline A never found the target: 141; B: 224; remember (incl. fallback): 30.
- Total tokens over 604 queries: A 17,663,890, B 7,343,480, remember 3,761,285.

## Notable findings

Search ranking as of the definition boost, test-file penalty, code-lookup keyword filter and translated queries (first run before them: recall@8 84%, 39% saved vs B).

1. Biggest savings vs A (whole-file reads): behaviour questions (docstring, 85% saved, recall@8 94%) and keyword queries (vague, 81%). Baseline A reads ~25-40k tokens of large files; remember answers in ~2k.
2. Exact-name lookups went from the weakest to the strongest case: recall@8 98% and hit@1 79% (were 84% and 41%), saving 48% even vs the careful grep baseline (was 11%). On ripgrep, where names are unique and grep is precise, the two are level (0%).
3. Losses are concentrated in fallbacks: when the target is not in the top 8 (65/604 queries, 11%), the search cost is pure overhead on top of A. remember costs more than B in 142 queries (24%), the rest being hits whose chunk plus padding is longer than a short grep window.
4. Free-form developer questions ("how does gin determine the real client IP behind trusted proxies") are the hardest English case: hit@1 14%, recall@8 66%. They still save 58% vs A but are about level with careful grepping (-3%).
5. Questions in another language than the code (DE/NL/FR/ES about English code): with the agent's English translation passed as `translation`, recall@8 is 50% (8/16, was 13% without), still 15% costlier than careful grepping. The translation rarely contains the code's exact names, so it behaves like an English free-form question.

