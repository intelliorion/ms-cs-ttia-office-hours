# Plan: Deep read upkeep and the dashboard

Spec: `docs/superpowers/specs/2026-10-26-cafe-deep-read-upkeep-design.md`. Branch `main`, commit per step, never push.
Every step: test first (vitest, stub embedder), then the code, then `npm test` green.

1. **The bus and the decision** (`src/memory/touch.ts`, `src/memory/upkeep.ts`, `tests/memory-upkeep.test.ts`).
   `touched` / `onTouched` / `sourceOfPath`; `decide()` table tests for rules 1–8 and the reason strings; `sourceWords`.
2. **The runner** (`createUpkeep` in `upkeep.ts`, more tests). Pending map, quiet/max timers, flush: read only the
   changed passages, skip when nothing changed, coalesce a burst, queue and fold while running, paused never resumes,
   off / never-run write nothing, a failing embedder defers once, stars refresh labels only. `IndexRow.at` and
   `MemoryState.lastDecision`; `summary()` gains `kinds` and `lastRead` per idea.
3. **Wiring** (`src/workspace/files.ts` hook, `inbox/flow.ts`, `import/importRows.ts`, `graph/operator.ts`,
   `round/round.ts` settings field, `server/api.ts`: the runner, `upkeep` in the view, `POST /api/memory/upkeep`,
   `settle()` before run/rerun). Route tests: Import after a run re-reads only the new idea "after Import"; a no-change
   save skips; the switch.
4. **The assistant** (`ai/tasks.ts` AgentInput.deepRead object + prompt, `command/query.ts` `queryGuide(on)`,
   `command/chat.ts` summary once, stale trace). Tests in `tests/memory-routes.test.ts` and `tests/ai.test.ts`.
5. **The dashboard** (`ui/src/popouts/deepReadHelpers.ts` summary math, sort, filter, kinds; `DeepReadPopout.tsx`
   tiles, keeps-current block with the switch, table, beams; `DeepReadButton.tsx` dot; store `deepReadView`; CSS).
   UI tests. `npm run build:ui`, commit `web/`.
6. **Docs and verification**: README Deep read section, CHANGELOG; practice server on 4100 with the fakes; Import one
   file → only that idea read "after Import"; save with no change → skipped; dashboard screenshot.
