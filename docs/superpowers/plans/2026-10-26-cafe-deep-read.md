# Plan: Deep read (local long-term memory)

Spec: `docs/superpowers/specs/2026-10-26-cafe-deep-read-design.md`. App: `cafe-app/`. Branch `main`, commit per task,
never push. Each task: tests first (vitest), then the code, then `npm test`, `npm run typecheck`.

## Task 1: Embedder and the fake
- `src/memory/embed.ts`: `Embedder`, `fakeEmbedder()` (64-dim word-hash, normalised), `realEmbedder()` with the lazy
  `await import('@huggingface/transformers')`, `modelDir()`, `modelCached()`, `getEmbedder()` (fake when
  `CAFE_EMBED_FAKE=1`), `cosine`, `meanVector`, `EMBED_MODEL`.
- `package.json`: add `@huggingface/transformers`.
- Tests `tests/memory-index.test.ts` (part 1): fake is deterministic, unit length, shared words → higher cosine,
  `getEmbedder()` returns the fake under the env var and never imports the library.

## Task 2: Chunker
- `src/memory/chunks.ts`: `splitText`, `chunkIdea(root, idea)`, `chunkWorkspace(root)`, kinds.
- Tests `tests/memory-chunks.test.ts`: a tmp workspace with one idea holding every file kind.

## Task 3: Index, state, summary, labels cache
- `src/memory/index.ts`: read/write `index.jsonl`, `state.json`, `labels.jsonl`; `summary(root)`; `nearestChunks`,
  `ideaCentroids`; `labelVectors(root, embedder, nodes)`.
- `src/workspace/paths.ts`: `memory` path and `DATA_FOLDERS`.
- Tests (part 2 of memory-index): incremental hashes, stale, mismatch, summary percent.

## Task 4: The job
- `src/memory/job.ts`: `createDeepRead(root, embedder)`, run/pause/continue/rerun/status.
- Tests `tests/memory-job.test.ts`: run to 100 %, pause mid-way with a slow embedder, continue, rerun drops.

## Task 5: Query steps and chat
- `src/command/query.ts`: `search`, `similar`, match fallback, `QueryMemory`, guide lines.
- `src/memory/lookup.ts`: `prepareMemory(root, query, graph)` → `QueryMemory | undefined`.
- `src/command/chat.ts`: prepare memory, pass hits coded, lit ideas, `deepRead` flag.
- `src/ai/tasks.ts`: `AgentInput.deepRead`, one prompt line. `src/ai/providers/fake.ts`: a plain question searches.
- Tests `tests/memory-query.test.ts`: each step with memory and without (unchanged).

## Task 6: Routes
- `src/server/api.ts`: GET /api/memory, POST run/pause/continue/rerun, GET /api/memory/ideas.
- Tests `tests/memory-routes.test.ts`: status without index, run reaches done, ideas route both ways, chat question
  with trace under CAFE_AI_FAKE + CAFE_EMBED_FAKE.

## Task 7: Extraction reuse and the hold
- `src/ai/apply.ts`: `opts.nearest`, `near` in the result, thresholds. `src/inbox/conflicts.ts`: `ctx.near`.
- `src/memory/lookup.ts`: `starMatcher(root, labels, nodes)`.
- Wire grow.ts, inbox/flow.ts (reuse + hold), inbox/actions.ts, review/updates.ts (reuse).
- Tests `tests/memory-links.test.ts`.

## Task 8: UI
- `ui/src/api.ts`: `getMemory`, `memoryPost`, `memoryIdeas`. `ui/src/state/store.ts`: `memory`, `refreshMemory`,
  popout kind `deep-read`.
- `ui/src/layout/DeepReadButton.tsx` + `TitleBar.tsx`; `ui/src/popouts/DeepReadPopout.tsx`; `deepReadHelpers.ts`
  (ring label, status line, button set, meaning marker); `IdeasList.tsx` by-meaning fallback; `theme.css`; `App.tsx`.
- UI tests: helpers and a pop-out render test.
- `npm run build:ui`, commit `web/`.

## Task 9: Docs and verification
- README "Deep read" section; root CHANGELOG entry.
- `npm test`, `npm run typecheck`, `npm run build:ui`; restart the practice server on 4100 with
  `CAFE_AI_FAKE=1 CAFE_EMBED_FAKE=1`; `npm run test-data`, import 01-submissions.csv; Run to 100 %; pause/continue;
  a chat question answered from hits with a trace.
