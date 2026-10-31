## Notable findings

Search ranking as of the definition boost, test-file penalty, code-lookup keyword filter and translated queries (first run before them: recall@8 84%, 39% saved vs B).

1. Biggest savings vs A (whole-file reads): behaviour questions (docstring, 85% saved, recall@8 94%) and keyword queries (vague, 81%). Baseline A reads ~25-40k tokens of large files; remember answers in ~2k.
2. Exact-name lookups went from the weakest to the strongest case: recall@8 98% and hit@1 79% (were 84% and 41%), saving 48% even vs the careful grep baseline (was 11%). On ripgrep, where names are unique and grep is precise, the two are level (0%).
3. Losses are concentrated in fallbacks: when the target is not in the top 8 (65/604 queries, 11%), the search cost is pure overhead on top of A. remember costs more than B in 142 queries (24%), the rest being hits whose chunk plus padding is longer than a short grep window.
4. Free-form developer questions ("how does gin determine the real client IP behind trusted proxies") are the hardest English case: hit@1 14%, recall@8 66%. They still save 58% vs A but are about level with careful grepping (-3%).
5. Questions in another language than the code (DE/NL/FR/ES about English code): with the agent's English translation passed as `translation`, recall@8 is 50% (8/16, was 13% without), still 15% costlier than careful grepping. The translation rarely contains the code's exact names, so it behaves like an English free-form question.
