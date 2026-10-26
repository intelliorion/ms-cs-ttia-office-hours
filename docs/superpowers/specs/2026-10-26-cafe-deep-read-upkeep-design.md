# Deep read keeps itself current, and knows when not to

Date: 2026-10-26. App: `cafe-app/`. Branch: `main`. Builds on the Deep read design
(`2026-10-26-cafe-deep-read-design.md`). The operator asked for full autonomy; the rulings below are mine and are listed
for them. The brief fixed the rules in §2; what it left open is decided in §3 onwards.

## 1. What the operator asked for, in their words

"build in the atentic ai too, make sure Ai knows what to do.... not just blind rebuild or go ahead do something not
nessssary"

and, mid-task: "and can you show a dashboard what's processed, what's not, % need to process... at the least user will
know where they are, which ideas has not processed yet."

Today re-reading is manual ("Read what changed"). The app should keep the index current by itself, piece by piece, but
deliberately: it must know WHEN a re-read is warranted, WHAT to re-read, and WHEN TO DO NOTHING. Never a blind rebuild,
never work the operator did not ask for. And the pop-out must say where things stand.

## 2. The rules fixed by the brief (not re-opened)

1. **Never the first run.** No index, or no embedder recorded: upkeep does nothing. The operator starts Deep read; the
   app never downloads the model or builds the index on its own.
2. **Respect the operator.** Paused: never resumed (ideas may be marked stale). Running: the trigger is queued and
   folded into the end of that run, one re-check.
3. **Only what changed, and only if it changed.** A trigger names the ideas it touched; only their passages are
   re-hashed; every hash already in the index → skip; else read just the changed or new passages (and drop gone ones).
   Never the whole workspace.
4. **Coalesce bursts.** Many saves in a short window become one re-read; a queued run absorbs new triggers.
5. **Never block the operator.** Upkeep runs after the triggering action has returned.
6. **Fail quietly, once.** An embedder failure marks that trigger `defer` with the error; no retry until the next
   trigger; the pop-out shows the error once.
7. **Embedder mismatch:** upkeep does nothing but say so; Rerun all stays the operator's call.
8. **Workspace-wide events** (a star renamed or merged): skip unless a passage's text changed; label vectors are
   refreshed cheaply for the renamed or merged stars only.

Also fixed: a settings switch (not an approval step), the assistant told the state, the dashboard of section F, and
the tests of section E. No model download on the app's own initiative; no new approval steps; no push.

## 3. The decision: `src/memory/upkeep.ts`

One pure function, every trigger goes through it:

```ts
decide(trigger: UpkeepTrigger, state: UpkeepState): UpkeepDecision
UpkeepTrigger  = { sources: TouchSource[]; ideas: string[]; at: string }
UpkeepState    = { hasIndex: boolean; indexEmbedder?: string; embedder: string; on: boolean;
                   status: JobStatus; ideas: { id: string; present: string[]; indexed: string[] }[] }
UpkeepDecision = { act: 'read' | 'skip' | 'queue' | 'defer'; ideas: string[]; why: string; passages: number; labels?: true }
```

`ideas[].present` are the hashes of the idea's passages on disk now; `indexed` the hashes the index holds for it. An idea
in the trigger that is not on disk any more has `present: []`. The runner (§4) builds the state; `decide` reads nothing.

The rules, in the order they are tested, and the reason each records:

| # | when | act | why |
|---|---|---|---|
| 1 | `!hasIndex` or no `indexEmbedder` | skip | `Deep read has not been run yet` |
| 2 | `!on` | skip | `automatic upkeep is off` |
| 3 | `indexEmbedder !== embedder` | skip | `the index was built with another model (<name>): Rerun all to read with this one` |
| 4 | `status === 'paused'` | skip | `paused by you: <ideas> will be read at Continue` |
| 5 | `status === 'running'` | queue | `a read is running: <ideas> will be checked when it ends` |
| 6 | sources are only `stars` | skip, `labels: true` | `star labels refreshed; no passage changed` |
| 7 | every present hash is indexed and nothing is gone | skip | `nothing changed in <ideas>` |
| 8 | otherwise | read | `read <ideas> after <source words> · N passages` (`· M dropped` when passages are gone; an idea whose folder is gone: `<id> removed: its passages dropped`) |

`defer` is never chosen by the rules: it is what the runner records when a `read` fails (rule 6 of the brief), with the
error as the reason. It is in the type so the pop-out and the tests see it.

Source words: `after Import`, `after a save`, `after the design was saved`, `after an email`, `after the roadshow`,
`after the hand-off`, `after the history`, `after a file`; several sources are joined with "and"; Import wins when it
is among them (an Import saves the idea too).

Before the first run (rule 1) the decision is **not written to disk**: the memory folder stays empty until the operator
has run Deep read once, so an operator who never uses Deep read has no `data/memory/` at all. Every other decision is
kept in `state.lastDecision = { act, ideas, why, at }` and shown in the pop-out.

## 4. The runner: `createUpkeep` (same file)

One per server, made in `api.ts` beside the job. It subscribes to the touch bus (§5) for its root, keeps one pending map
(idea → the sources that touched it) and one timer: **5 s of quiet** after the last touch, **at most 30 s** after the
first pending touch (a brainstorm that writes every few seconds cannot starve it). Tests pass shorter times.

A flush:
1. `readState`, `readIndex`; the settings switch; the embedder name for this process.
2. For each pending idea: `loadIdea` + `chunkIdea` (file reads only; a missing idea → `present: []`); the index rows
   of that idea → `indexed`.
3. `decide`. Then:
   - **read**: embed the changed passages (batches of 16, one `embed` call each), replace that idea's rows in the index
     (gone rows dropped), stamp each new row with `at`, write the index, write the state with `lastDecision` and the
     ideas removed from `state.stale`. On a thrown error: `lastDecision = { act: 'defer', why: 'could not read <ideas>:
     <error>; will try again at the next change' }`, status untouched, nothing retried.
   - **queue**: record it, then `await job.idle()` and flush again once with the same pending set (the fold).
   - **skip**: record it; with `labels` the missing star labels are embedded into `labels.jsonl` (the renamed or merged
     stars are exactly the labels not yet cached). Paused: the ideas are appended to `state.stale`.
4. The pending map is cleared when the flush starts; touches during a flush start the next timer.

Serialisation: the flush never runs while the job runs (rule 5 → queue), and the job's `run`/`rerun` routes
`await upkeep.settle()` first (a flush is short: a few passages). Upkeep is not behind the HTTP lock: it reads idea files
(atomic writes make that safe) and writes only `data/memory/`, so an Import or a save never waits on the embedder.
`upkeep.idle()` settles when nothing is pending or running (tests wait on it).

## 5. The triggers: `src/memory/touch.ts`

A tiny bus with no imports: `touched(root, ideas, source)`, `onTouched(listener)`. Sources:
`import | save | design | email | roadshow | handoff | history | file | stars`.

Where it is called:
- **`src/workspace/files.ts`**: every write into an idea folder (`writeFileAtomic`, so also `writeYaml`, and
  `appendHistory`) notes the idea from the path (`…/data/ideas/CAFE-YYYY-NNN-slug/<file>`) with the source by file:
  `idea.yaml` → save, `design.yaml`/`approach.md` → design, `emails/…` → email, `roadshow/…` → roadshow,
  `csic-handoff.md` → handoff, `history.log` → history, anything else → file. That is the one chokepoint: no module that
  writes an idea needs to know about Deep read, and nothing that writes an idea is missed (every idea write goes
  through this file; raw `fs` writes in the app touch only the inbox, kits and photos).
- **`src/inbox/flow.ts`** and **`src/import/importRows.ts`**: at the end of an Import run, `touched(created ∪
  updated, 'import')`, so the reason reads "after Import".
- **`src/graph/operator.ts`** `appendEdit`: `touched([], 'stars')` for a rename or merge (the assistant's rename and
  merge go through it too).

A write that is not an idea write (rounds, inbox, graph, chat) touches nothing.

## 6. The switch

`Settings.deepRead?: { upkeep?: boolean }` in `rules/settings.yaml`; absent means **on**. `POST /api/memory/upkeep
{ on }` saves it and returns the memory view. The pop-out shows the switch only once the operator has run Deep read
(`job.embedder` set); off means fully manual as today. `saveSettings` leaves the field alone (it is not a form field).

## 7. The assistant

`AgentInput.deepRead` becomes `{ on: boolean; percent: number; staleIdeas: number; lastRead?: string }`. The prompt:
- on: "Deep read is on (N % read, M ideas changed since they were read, last read <when>). Use search and similar only
  for what people WROTE (challenge text, answers, designs, reviews, emails). For stars, links, counts, people and stages
  use stars, follow, filter, role, rank and count_by as before. A hit from an idea listed in stale changed since it was
  read: you may say so in one short line."
- off: the search and similar lines are left out of the query guide (`queryGuide(on)`), and the prompt says the steps
  do not exist.

`chat.ts` computes `summary()` once per message when the index is available (file reads only), and after a search step
whose hits come from a stale idea appends `<id> changed since it was read` to that query's trace and lists the codes in
the step result as `stale`. Nothing is re-read inline. The fake agent is unchanged.

## 8. The pop-out: a dashboard

- **Summary row**: three tiles, **Read** · **Changed since** · **Not yet**, each with its count and share of the ideas
  (shares are floor'd and the largest tile takes the remainder so they add to 100). Beside them the ring, "passages to
  go: N (NN %)", and the last decision line ("Last: read 2026-003 after Import · 3 passages, 26 Oct 14:02").
- **Keeps itself current**: one sentence on the rules, the switch, and "waiting for changes to settle" while a flush is
  pending.
- **Per-idea table**: Café ID, title, status pill, passages read ÷ present, the kinds that are stale ("emails, design"),
  last read. Sort: not yet, then changed since, then read; within a group by ID. Filter chips All · Not yet · Changed
  since · Read, and a search box (ID or title). A row click opens the idea in the left panel; the chip and the search
  text live in the store, so they are there when the pop-out is opened again. The table scrolls inside the pop-out.
- **By kind** beams: read ÷ present per kind, drawn with the Pipeline/Demand `Beams` look (a second, dimmer track shows
  the total).
- Polling while running or while upkeep is pending (every 1.5 s), so rows flip from "not yet" to "read".
- Title bar: the ring and % stay; a small amber dot when anything is "changed since" or "not yet".

The summary gains, per idea, `kinds` (present/embedded per kind) and `lastRead` (the newest `at` of its rows; rows
written before this change have none). The GET view gains `upkeep: { on, pending, waiting }`.

## 9. Tests

- `tests/memory-upkeep.test.ts`: `decide()` table for every rule; the runner with the fake embedder and short timers:
  a touch after a run reads only the changed passages, a save with no change skips, a burst coalesces, a running job
  queues and folds, paused never resumes, off and never-run do nothing (no file appears), a failing embedder defers
  once, stars refresh labels only.
- `tests/memory-routes.test.ts` additions: an Import of a new idea after a run → only that idea re-read with reason
  "after Import"; the switch route; the view carries `upkeep` and `lastDecision`.
- `tests/memory-query.test.ts` / `ai.test.ts` additions: the prompt carries the state, a stars-only question produces
  no search (fake), a stale idea is named in the trace.
- UI `deepRead.test.tsx`: summary math, sort, filter, row click opens the idea and keeps the chip.

## 10. Non-goals

No model download on the app's own initiative; no full rebuild except the operator's Rerun all; no approval steps; no
change to AI providers; no push.
