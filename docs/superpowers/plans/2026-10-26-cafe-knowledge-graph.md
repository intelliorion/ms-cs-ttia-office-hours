# Plan: the Café knowledge graph (registry, rules, ontology as data)

Spec: `docs/superpowers/specs/2026-10-26-cafe-knowledge-graph-design.md`. Branch `main`, commit per step, never push.
Every step: test first (vitest), then the code, `npm test`, `npm run typecheck`; UI steps also `npm run build:ui` and
commit `web/`. Each phase leaves the app working on its own.

## Phase 1: registry

1. **Registry module** (`src/graph/registry.ts`, `tests/registry.test.ts`): `makeRegistry`, `resolve` (label, alias,
   diacritics, unknown), `aliasesOf`, `refOf`, `tools()`, `defaultEntries()`, `loadRegistry` (file + alias edits),
   `currentRegistry()`. `paths().entities`; `init` writes the seed file. `canonicalTool`/`isApprovedTool` read it.
2. **Alias edit and merge** (`ontology.ts` OperatorEdit, `graph/store.ts` `mergeStars`, `command/actions.ts` merge
   and the new `alias` op, `api.ts` merge route, `ai/tasks.ts` COMMAND_OPS + prompt, the fake): tests in
   `operator-edits.test.ts` and `command.test.ts`.
3. **Resolve where stars are born** (`build.ts` options object + form stars, `ai/apply.ts` planAiLinks, `rebuildGraph`
   loads the registry, `resolveSteps` add/rename, `attrs.aliases`/`attrs.ref`): `graph.test.ts` snapshot and alias
   tests; `server-graph.test.ts` second import under other wording, merge then re-read.
4. **UI**: `starProfile` facts "Also known as" / "Reference"; build, commit `web/`.

## Phase 2: inference

5. **Ontology additions** (`Relation`s, `DERIVED_RELATIONS`, `GEdge.derived`/`idea`, `AiLink.idea`, planAiLinks sets
   it, link edits carry `idea`): small tests.
6. **Rules** (`src/graph/rules.ts`, `tests/rules.test.ts`): `DEFAULT_RULES`, `infer`, one table test per rule, the
   006/007 scope case, disabled rule, confirmed only when inputs are, min(inputs) confidence; `loadRules`, `init`
   writes the file; `buildGraph` runs it last; `unconfirmed` count excludes derived.
7. **Incremental** (`ideaBundle`, `cache` option, per-root cache in `store.ts`, touch invalidation, `readEdits` fold):
   the incremental == full test over every kind of change.
8. **Query engine and assistant** (`query.ts` follow/rank over derived, trace lines, `QUERY_GUIDE`; `chat.ts` passes
   the focus idea to `resolveSteps`): `command-query.test.ts`.
9. **AI reads note** (`ai-reads.json` in `extractCoded`, `/api/state` idea.aiRead): route test.
10. **UI**: edge style + palette + legend, Demand beams by system/tool, Similar block, Read again line, link row tag,
    counts; UI tests; build, commit `web/`.

## Phase 3: ontology as data

11. **Ontology file** (`ontology.ts` data + derived consts, `ontologyFile.ts` load/apply, `init` writes it,
    `/api/state.ontology`, UI applies colours/labels; `extractTask` prompt from meanings): `tests/ontology.test.ts`
    load/fallback equality.
12. **Check** (`src/graph/check.ts`, `cafe ontology check`): clean on the test data, violations on a broken fixture.
13. **Export** (`src/graph/jsonld.ts`, `cafe export`, the `export` command op, the hand-off's `csic-handoff.jsonld`):
    round-trip test, hand-off test.
14. **Docs and verification**: README "Knowledge graph" section, CHANGELOG; practice server on 4100 with the fakes;
    the travel-policy scenario; `cafe ontology check` clean.
