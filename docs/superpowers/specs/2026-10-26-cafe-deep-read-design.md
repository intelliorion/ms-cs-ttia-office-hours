# Deep read: a local long-term memory for the Creators' Café app

Date: 2026-10-26. App: `cafe-app/`. Branch: `main`. The operator asked for full autonomy ("make every decision"); the
rulings below are mine and are listed for them. The brief that fixed the first ten decisions is summarised in §2.

## 1. What the operator asked for, in their words

"make a button on the top to show AI's undernstanding (think a better name for that button) when click, it pop out a
page that shows % context has been understand and processed, give options to run, rerun, continues, etc the goal is
to have a backend process, to process all informatino give info to the user like why we need to do this, what happens
we don't this etc.... make it sleek, does my approcah make sense to you? cause w/o it, my app still works... this
should be a addon, not a must"

## 2. Decisions fixed by the brief (not re-opened)

1. **Name.** Title-bar button **Deep read** with a small progress ring and percentage beside the label. Pop-out title
   "Deep read: what the assistant has read".
2. **Add-on, never a must.** With no index every path (chat, panel search, extraction) behaves exactly as today. The
   model downloads only on the first Run, once, into `~/.cafe-ai/models/` (`CAFE_MODEL_DIR` overrides). The library is a
   lazy dynamic import inside the embed module.
3. **Controls.** Run · Pause · Continue · Rerun all. No Yes/No gates. One background job at a time in the server; it
   survives the pop-out closing. Ideas changed since their last read are "stale" and re-read on the next Run
   (incremental by content hash); Rerun all drops the index first.
4. **"% read"** = chunks embedded ÷ chunks present, with a per-idea breakdown (read / stale / not yet), counts by kind
   (submissions, emails, designs, reviews, roadshows), last run time and duration. The copy says reading index, not
   comprehension.
5. **Pop-out copy** answers: why; what happens without it; what it reads; privacy; what changes when it is on.
6. **What the index feeds:** chat (`search`, `similar`, `match` fallback), the ideas panel (by meaning when the
   substring finds nothing), extraction (nearest-star reuse above a high threshold; the existing `near-duplicate-star`
   hold in a lower band).
7. **Storage.** `data/memory/index.jsonl`, `data/memory/state.json`; `memory` joins `DATA_FOLDERS`; rebuildable from
   nothing.
8. **Tests.** Stub embedder (`CAFE_EMBED_FAKE=1`) that hashes words into a fixed-length vector; `npm test` never downloads.
9. **Look.** Glass pop-out like Import / Rounds / AI; Lite drops animation; the ring is subtle; Esc / X closes.
10. **README + CHANGELOG** get a Deep read section.

## 3. The model and the embedder

- Library `@huggingface/transformers` (4.x), a runtime dependency, imported with `await import(...)` inside
  `src/memory/embed.ts` only when a real embedding is first needed. `npm start` and every test run never evaluate it.
- Model `Xenova/all-MiniLM-L6-v2`, quantised (`dtype: 'q8'`), mean pooling, normalised vectors (384 dims). Cache folder
  `CAFE_MODEL_DIR` or `~/.cafe-ai/models`. Nothing is sent anywhere: the only network call is the one-time model download
  from the Hugging Face hub, and only when the operator presses Run.
- `Embedder` is `{ name, dims, embed(texts) → number[][] }`. The fake (`CAFE_EMBED_FAKE=1`) hashes each lower-cased word
  into one of 64 buckets (FNV-1a), counts, and normalises: deterministic, shared words give a high cosine, and no
  download. The fake is only present when the variable is set, like `CAFE_AI_FAKE`.
- **Mismatch rule (my call):** `state.json` records the embedder name. An index built with another embedder (fake vs
  real) is reported as "built with another model" and every idea counts as stale until Rerun all.
- **Offline PCs (my call):** the README tells the operator to run Deep read once on a PC that can download, then copy
  `~/.cafe-ai/models` (the whole folder) to the same place on the PC that cannot, or anywhere and point `CAFE_MODEL_DIR`
  at it. No zip step: it is a folder copy.

## 4. What is read: the chunker (`src/memory/chunks.ts`)

One chunk per field or section, each split at `CHUNK_MAX = 1200` characters with `CHUNK_OVERLAP = 150` on a sentence or
line boundary where one exists. Every chunk: `{ id, ideaId, file, section, kind, text, hash }`; `hash` is SHA-1 of
`section + text`; `id` is `<ideaId>:<file>:<section>:<n>`.

| kind | file | sections |
|---|---|---|
| submission | idea.yaml | `title+challenge` (the title on its first line), `current_process`, `business_impact`, `additional_context`, `outcomes` (joined), `answers` (each Q+A pair, batched by the max size) |
| email | emails/NNN-Ex.md (the app's drafts and sent mails), emails/in/*.summary.md, emails/out/*.summary.md | one per file: `email <template>` or `email in`, the body with the front matter dropped |
| other | notes/*.summary.md | `note` |
| review | idea.yaml (review + prep) | `review`: decision label, reason, the to-do list's needs and answers |
| design | design.yaml + approach.md | `design features` (name + what, the tool with pros/cons), `design Q&A` (each step's question + answer, batched), `design summary` |
| roadshow | roadshow/script.md | `roadshow script` |
| other | csic-handoff.md | `handoff` |
| other | history.log | `history`: the `detail` lines joined (operator and app notes), batched |

People's names are not special-cased in the chunk text on disk (the index is local data like the idea folder), but every
hit shown to the AI is coded with the same `hideNames` as idea text today.

## 5. The index and the job (`src/memory/index.ts`, `src/memory/job.ts`)

- `index.jsonl`: one line per chunk: `{ id, ideaId, file, section, kind, hash, text, vector }`. The text is kept so a hit
  can be shown without re-reading the folder; vectors are plain `number[]` rounded to 5 decimals.
- `state.json`: `{ status: 'idle'|'running'|'paused'|'done'|'error', embedder, done, total, startedAt?, lastRun?:
  { at, ms, chunks, ideas }, error?, stale: string[] }`.
- `summary(root)` chunks the whole workspace (file reads only, no model) and compares hashes with the index:
  `chunks`, `embedded`, `percent`, `kinds` (per-kind present/embedded), `ideas[]` with `status` read | stale | new,
  `available` (any embedded chunk and the embedder matches).
- The job is one object per server (`createDeepRead`). `run()` plans, drops rows whose hash is gone, embeds the missing
  chunks in batches of 16, writes the index and state after every batch, and checks the pause flag between batches.
  `pause()` sets the flag; `continue()` is `run()` (the plan is recomputed, so a change made while paused is read too);
  `rerun()` deletes the index and runs. A second `run()` while running is a no-op that returns the status. Errors
  (the download failed, say) land in `state.error`, status `error`, the partial index kept.
- The pop-out polls `GET /api/memory` every 1.5 s while the status is running (my call: polling, not a stream: the job
  outlives the request, which a stream does not).

## 6. Routes

| route | what |
|---|---|
| `GET /api/memory` | `{ model: { id, dir, cached }, job: state, summary }` |
| `POST /api/memory/run` · `/pause` · `/continue` · `/rerun` | start, pause, continue, drop and start; each returns the same shape as GET at once (the job runs on) |
| `GET /api/memory/ideas?q=` | `{ ideas: null }` with no index; else `{ ideas: [{ id, score, section }] }`, best first, score ≥ 0.25 (fake) / 0.30 (real), top 12 |

## 7. The query steps (`src/command/query.ts`)

`QueryWorld` gains an optional `memory: QueryMemory` built by `prepareMemory(root, query, graph)` in chat.ts before the
query runs (it embeds every `match` string of the query in one call, so `runQuery` stays synchronous). With no index
`memory` is undefined and every step behaves as today.

- `search` (`match`, `limit` ≤ 20, default 8): nearest chunks to the text, grouped by idea; the set is the ideas, best
  first; `hits` on the result: `{ ideaId, section, text, score }`. Trace: `Search what people wrote for "…"` with the
  number of ideas. Without memory: empty set, trace `Deep read has not run: nothing to search`.
- `similar` (`codes` or `match`, `type`, `limit` default 5): from an idea code, the nearest other ideas by the mean of
  their chunk vectors; from text, the nearest ideas; from any other star, the nearest stars of its type by label
  vector. Trace `Nearest ideas to …`.
- `match` fallback on `stars` and `filter`: when the substring finds nothing and memory exists, keep the up-to-5 stars
  (of the step's type when given, never a person) whose label vector is nearest the text above 0.45 (fake 0.35), and
  the trace says `… (nearest: A, B)`.
- Star labels are embedded on demand and cached in `data/memory/labels.jsonl` keyed by `sha1(type + label)`; people
  are never embedded.

In chat the hits reach the AI as `result.hits: [{ idea: code, section, text }]` (names coded, text trimmed to 500
characters) and the lit stars are the ideas the hits came from. `AgentInput.deepRead` tells the prompt whether the
`search`/`similar` steps work; QUERY_GUIDE describes them. The fake agent answers a plain question (no star code) with
one `search` step and reports how many ideas the hits came from.

## 8. Extraction and duplicates (`src/ai/apply.ts`, `src/inbox/conflicts.ts`)

`planAiLinks` takes `opts.nearest?: (type, label) => { node, score } | undefined` (a synchronous lookup prepared by
`starMatcher(root, labels, nodes)`, undefined when no index). After the exact label match fails:
- score ≥ `REUSE_AT = 0.85` (fake 0.80): the existing star is used in the link, no new node.
- `NEAR_AT = 0.70` ≤ score < reuse: the new node is kept and `result.near[newNodeId] = existingId`; callers that run
  `checkProposals` pass it as `ctx.near`, and `checkLink` holds the link with the existing `near-duplicate-star` rule
  ("Looks like X: merge or keep both?") when neither `sameLabel` nor `wordOverlap` caught it first.
- Below: as today.
Callers: grow.ts and inbox/flow.ts (reuse + hold); inbox/actions.ts and review/updates.ts (reuse only: they apply
confirmed links with no hold path, and a hold there would be a new approval step, which the user rule forbids).

## 9. The ideas panel

`filterIdeas` is unchanged. In `IdeasList`, when the search text is not blank, the substring filter finds nothing and
`memory.available` is true, the list asks `GET /api/memory/ideas?q=` (debounced 300 ms) and shows the ranked ideas with
a small **by meaning** marker above them and a dot on each row. The count line reads "N by meaning". With no index the
list says "No ideas match." exactly as today.

## 10. The UI

- **Title bar:** `Deep read` pill between the assistant launcher and Import, with a 14 px SVG ring (stroke-dasharray)
  and the percentage. Idle with no index: an empty ring and no number. Running: the ring fills and a soft pulse (none
  in Lite). The store keeps `memory` (the GET shape) and `refreshMemory()`; the bar refreshes on mount, when the
  pop-out closes, and after every `refresh()`.
- **Pop-out `DeepReadPopout`** (860 × 760, class `deep-pop`): head "Deep read" / "What the assistant has read".
  Top: a 96 px ring with the percentage, "N of M passages", the status line (Not run yet · Reading n of m · Paused at
  n of m · Read 26 Oct 14:02 in 48 s · Could not finish: …), the buttons for the state (idle/done → Run (or "Read
  what changed" when stale) and Rerun all; running → Pause; paused → Continue and Rerun all; error → Run and Rerun
  all). Then the kind counts, then the per-idea list (status dot, id, title, n/m), then five short copy blocks (Why ·
  Without it · What it reads · Stays here · When it is on), then one line on the model and where it lives.
- Esc / X close; the job runs on.

## 11. Tests

Server (vitest, `tests/`): `memory-chunks`, `memory-index` (fake embedder, cosine, incremental, stale, mismatch),
`memory-job` (run to 100 %, pause/continue with a slow embedder, rerun drops), `memory-query` (search, similar, match
fallback, and that every step is byte-identical without memory), `memory-routes` (status, run, ideas route with and
without an index, chat question answered from hits with a trace), `memory-links` (reuse, hold, unchanged without
`nearest`). UI (`ui/`): the ring label helper, the meaning marker helper, a render test of the pop-out with a mocked
fetch.

## 12. Non-goals

No change to the AI providers or the connector; no cloud embeddings; no vector database; no new approval steps; no
auto-merge of stars; no push.
