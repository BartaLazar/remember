# Asking questions efficiently

remember makes lookups cheaper, but it can't make them free. Each search costs tokens, and a question the search can't answer costs the search plus the normal exploration that follows. How you phrase a question decides which of those you get.

This guide covers what to ask, how to word it, and when to skip the search entirely. Numbers come from the simulations in [`bench/`](../bench/): 604 code questions on five open-source projects and 80 questions about past decisions.

## Where the tokens go

| What Claude does | Tokens (median) |
|---|--:|
| Greps, then reads whole files until it finds the answer | 23,700 |
| Greps, then reads 120 lines around each match | 11,200 |
| Searches remember, then reads the lines it points to | 2,200 |
| Searches remember for a past decision | 660 |
| Reads the exact lines you named | a few hundred |

Two things follow from this table:

- **Reading is the expensive part, not searching.** Anything that tells Claude where to read saves the most.
- **The cheapest question is one that needs no search at all.** If you already know where something is, say so.

## 1. Use names when you have them

A function, class, file or config key name is the strongest signal you can give.

| Instead of | Ask |
|---|---|
| "Where's the thing that retries failed uploads?" | "Where is `retryUpload` defined?" |
| "How do we handle the session cookie?" | "How does `SessionStore.refresh` work?" |
| "What's that setting for the queue size?" | "What is `MAX_QUEUE_DEPTH` set to and why?" |

Exact names found the right place in the top 8 results **98%** of the time, and ranked it first **79%** of the time. Names with a capital in the middle, an underscore or a digit (`retryUpload`, `max_depth`, `v2`) are recognised as code. For plain lowercase names, add "defined" or "implemented": *"where is `range` defined"*.

## 2. Otherwise, describe what the code does, in its own words

When you don't know the name, describe the behaviour using words that would appear in the code or its comments.

| Instead of | Ask |
|---|---|
| "Why does the app crash sometimes?" | "Where do we recover from panics and return a 500?" |
| "How does auth work?" | "Where are expired refresh tokens rejected?" |
| "Explain the upload stuff" | "Where are uploads split into chunks before sending?" |

Behaviour descriptions found the right place **94%** of the time. A few distinctive keywords work nearly as well (**89%**): *"stale lock heartbeat"*, *"middleware recovers panics"*.

## 3. Break open-ended questions into concrete ones

"How does X work?" is the weakest kind of question. It found the right place only **66%** of the time, and saved nothing compared with careful grepping. There's rarely a single place that answers it.

Split it into the parts you actually want to know:

> ~~How does caching work in this project?~~
>
> Where is the cache created? → What decides when an entry expires? → Where is it invalidated after a write?

Each concrete question lands on one place, and each answer gives you the names to use in the next one.

## 4. Ask about code in the language the code is written in

The embedding model understands about 100 languages, but questions about English code in another language almost always miss: **13%** found the right place. Use the language of the names and comments.

Notes and chats are different. They are prose, and questions in German, Dutch, French or Spanish found past decisions **73%** of the time.

## 5. If you know where it is, skip the search

A search costs about 2,000 tokens even when it succeeds. Point Claude straight at the place and it reads only that.

| Instead of | Ask |
|---|---|
| "Find where we validate emails and fix the regex" | "Fix the email regex in `src/validate.ts` around line 40" |
| "Look at the deploy script" | "Read `scripts/deploy.sh` lines 1–60" |

You don't need the exact line. A file name alone already saves the search.

## 6. Recalling decisions: use the subject, not the date

Past decisions are found by what they were about, not by when they happened.

| Instead of | Ask |
|---|---|
| "What did we decide last Tuesday?" | "What did we decide about pagination?" |
| "Remind me what we said earlier" | "Why did we choose Postgres over SQLite?" |
| "What was that thing about the queue?" | "What do we use for the job queue, and why?" |

Decisions were found **83%** of the time for about 660 tokens each. Grepping old chat logs instead cost around 150,000 tokens and found the answer less than half the time.

## 7. Save decisions so future questions are cheap

A decision saved as a note was found **88%** of the time, against **79%** for one that only exists somewhere in a chat. Notes also rank above everything else.

When you settle something, ask Claude to remember it, and include:

- **The subject in plain words** that you'd later search for: "pagination", "job queue", "Node version".
- **The decision and the reason.** "Cursor pagination, because offsets slowed down past a million rows."
- **Names from the code**, if any: `listOrders`, `PAGE_SIZE`.

When a decision changes, say that it replaces the old one. The old note then disappears from search, so Claude can't act on it by mistake.

> "Remember: we switched the job queue from Redis to Postgres `LISTEN/NOTIFY`, to drop a dependency. This replaces the earlier Redis decision."

## 8. Narrow the search when you know what you want

If you only want past decisions, or only code, say so. Results from the other sources won't crowd the answer.

- *"Search only our notes: what's our policy on breaking API changes?"*
- *"Only in the code, not old chats: where is the rate limit set?"*

## 9. Keywords that change how the search behaves

A few words switch the search into a different mode. Use them on purpose.

| Keyword in your question | What it does | Example |
|---|---|---|
| **defined**, **definition**, **declared**, **implemented** | Treats the question as a code lookup: question words are ignored, and the place where the name is defined ranks above places that only use it. | "where is `range` defined" |
| A **code-like name** (`retryUpload`, `max_depth`, `v2`) | Same code-lookup mode, triggered by the name itself. | "how does `retryUpload` back off" |
| **test**, **tests**, **spec**, **specs** | Test files are no longer ranked down. Leave these words out when you want the real implementation. | "which tests cover `retryUpload`" |
| **notes**, **saved decisions** | Claude searches only your decision notes. | "search our notes for the API versioning policy" |
| **chats**, **earlier sessions**, **we discussed** | Claude searches only past conversations. | "in earlier sessions, what did we say about flaky CI?" |
| **code**, **files**, **docs** | Claude searches only the project's files. | "only in the code: where is the timeout set?" |
| **remember** | Claude saves a decision note. | "remember: we pin Node 22 because…" |
| **replaces**, **instead of**, **we changed our mind** | When saving, Claude marks the old note as replaced, and the old note drops out of search. | "remember: cursor pagination, replacing the offset decision" |
| **forget** | Claude removes a file, folder or chat from the index and keeps it out. | "forget `legacy/**`" |

**Words that are ignored in code lookups:** where, is, how, does, what, which, the, find, show, code, function, method, defined, implemented, and similar question words. They match almost every file, so in code-lookup mode only your real keywords count. In plain-language questions about decisions, every word is kept, because there they help.

The first three rows are built into the search itself. The rest work because the plugin's skills tell Claude how to react to them, so other phrasings with the same meaning work too.

## 10. Habits outside the plugin

These are general Claude Code habits. They aren't measured here, but each one keeps the conversation shorter, and a shorter conversation costs less on every turn.

- **One task per conversation.** Run `/clear` when you switch to something unrelated. Claude can find what it needs again through remember.
- **Keep `CLAUDE.md` short.** It's loaded into every session. Put the handful of rules that matter every time there, and let remember hold the rest. In the simulation, a decision file past about 125 entries cost more per session than searching it.
- **Say what you want back.** "Just the file and line" or "a one-paragraph answer" stops Claude from reading more than the answer needs.

## Quick reference

| You have… | Ask like this | Found |
|---|---|--:|
| A name | "Where is `retryUpload` defined?" | 98% |
| A description of what the code does | "Where do we recover from panics and return a 500?" | 94% |
| A few keywords | "stale lock heartbeat" | 89% |
| A broad "how does X work" | Split into concrete questions first | 66% |
| A file and roughly where | "Read `src/x.ts` around line 80" | no search needed |
| A past decision | "What did we decide about pagination?" | 83% |
| A decision just made | "Remember: … because … (replaces …)" | 88% later |

**Keywords to keep handy:** *defined* · *implemented* · *tests* (only when you want tests) · *notes* · *earlier sessions* · *only in the code* · *remember* · *replaces* · *forget*

<sub>"Found" means the right place was among the 8 results a search returns. Figures come from simulations with synthetic and open-source data; real results vary by project. Method and caveats: [`bench/`](../bench/).</sub>
