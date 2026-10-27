# The Creators' Café graph becomes a knowledge graph: registry, rules, ontology as data

Date: 2026-10-26. App: `cafe-app/`. Branch: `main`. Builds on the core graph design
(`2026-10-19-creators-cafe-app-design.md`) and Deep read (`2026-10-26-cafe-deep-read-design.md`). The operator asked
for full autonomy; the brief fixed the decisions in §2, and what it left open is decided in §3 onwards and listed for
them in §6.

## 1. What the operator asked for, in their words

"how would you plean to build a true knowledge graph, and how my app will actually benefit from it" · "does it make
sense keep the true knowledge graph build in deep read button?" (no: the core graph; Deep read stays optional) · "if we
already build knowledge graph, do we still senmentic layer search then" (yes, both) · "replace what i have as property
graph? or just on top of it" (on top, inside the rebuild) · "where you would start to build KG? and how do you plan to
keep everything updated when info is updated" · "when the app is empty, and start to drop the 1st file, is KG happens
right away" · "what technique you would use to just updated changed info, not rebuild every single time".

## 2. Fixed by the brief (not re-opened)

- The property graph (`GNode`/`GEdge`, `ALLOWED`, form → AI links → operator edits, rebuilt in memory on every read,
  `data/` deletable) is the storage and is not replaced. Everything here is more layers in the same `buildGraph`.
- It works from the first imported idea; no "build the KG" step, no switch for the registry; rules can be disabled one
  by one in a file. Deep read stays optional and parallel; the graph never waits on it.
- Derived facts look derived: dashed in the universe, `source: rule:<name>`, named in the trace, excluded from counts
  unless a panel asks. Nothing derived is auto-confirmed, auto-routed or auto-merged. No approval steps. No push.
- Phase 1 the registry (`rules/entities.yaml`, `resolve`, the `alias` edit, merge records an alias, wired into every
  place a star is born). Phase 2 inference (`rules/inference.yaml`, four rules, `derived`, `idea` on edges, same-idea
  scope, last layer of the build, incremental by hash, universe and panels, query engine). Phase 3 ontology as data
  (`rules/ontology.yaml`, `cafe ontology check`, the extraction prompt from meanings, JSON-LD export and the hand-off).

## 3. Phase 1: the registry

**File.** `rules/entities.yaml`, created by `init`, one section per type (`Tool`, `System`, `Team`, `Entity`,
`Capability`, `PainPoint`, `Beneficiary`), each a list of `{ id, label, aliases: [], ref? }`. `init` seeds the Tool
section from `APPROVED_TOOLS`/`TOOL_ALIASES`. When the file is absent (older workspaces, unit tests building the graph
directly) the built-in tool entries are the registry, so the graph is exactly today's.

**`src/graph/registry.ts`.** `makeRegistry(entries, aliasEdits)` → `Registry` with `resolve(type, label)` →
`{ id, label } | undefined` (label or alias, matched by `slug`: case, whitespace and diacritics are ignored),
`aliasesOf(id)`, `refOf(id)`, `tools()` (the approved labels, in file order). `loadRegistry(root)` reads the file and
the active `alias` edits from `operator.jsonl`. `defaultEntries()` is the built-in Tool section.

**The alias edit.** `{ t: 'alias'; node; label; of? }` in `operator.jsonl`: `label` is the alias, `of` the star's label
when it was recorded (so a merged twin keeps its name even when its star is born first in a rebuild). Undoable like
every edit. A merge (`mergeStars` in `graph/store.ts`, used by the assistant's merge, the tool picker's Merge and
`POST /api/graph/merge`) appends the merge edit and then an alias edit of the merged label on the target; the inverse
switches both off. The command bar gains `alias <label> as <star>` (`op: 'alias'`, `name` + `a`).

**Where resolve is wired.** `buildGraph` takes an options object (`{ registry, rules, cache }`): form stars for Team,
Entity, Beneficiary, Capability and Tool are born through `resolve` (a hit gives the id and, when the star is not there
yet, the registry's label). `planAiLinks` resolves each proposed label first (registry, then exact label, then Deep
read's nearest, then a new star); its `opts.registry` defaults to the built-in one. `resolveSteps` (`add_star`,
`rename`) says "X is already a star, known as Y" when the name is an alias. `canonicalTool`/`isApprovedTool` keep their
signatures and read the registry last loaded for the workspace (`currentRegistry()`), the built-in one before any load.
Star details (`starProfile`, the right panel's Star) show "Also known as" and "Reference" from `attrs.aliases` /
`attrs.ref`, which the build puts on every registered star.

## 4. Phase 2: inference

**Ontology.** Relations `DEPENDS_ON [Idea, System]`, `USES [Idea, Tool]`, `OWNS [Team, Idea]`, `SIMILAR_TO [Idea,
Idea]`, listed in `DERIVED_RELATIONS`. The assistant cannot `link` them by hand; they are facts the rules derive.
`GEdge.derived?: { rule; inputs }` (input edge ids), `GEdge.idea?` (the idea an AI edge was extracted for;
`planAiLinks` sets `AiLink.idea`; an operator `link` edit carries `idea` when the command was made with an idea on
screen). Derived edges: `source: 'rule:<name>'`, `confidence = min(inputs)`, `confirmed = every input confirmed`,
description "via <middle star>" for a chain and "share <stars>" for shared-stars.

**Rules file.** `rules/inference.yaml` (created by `init`; built-in defaults when absent or unreadable):
`needs+uses_data` (NEEDS, USES_DATA → DEPENDS_ON, scope same-idea), `needs+built_with` (NEEDS, BUILT_WITH → USES),
`member+submitted` (HAS_MEMBER, SUBMITTED → OWNS), `shared-stars` (≥ 2 of NEEDS/REPLACES targets ∪ IN_CATEGORY →
SIMILAR_TO, confidence min(1, n/3)). `src/graph/rules.ts`: `loadRules(root)`, `DEFAULT_RULES`, `infer(nodes, edges,
rules)`.

**Scope.** `ideaOf(edge)` = `edge.idea`, else the idea in a `form:<id>` source, else the Idea end of the edge, else
undefined. Under `same-idea` two inputs chain only when their ideas are equal or one of them is undefined (an
operator's context-free link is shared knowledge). This is the bug the simulation caught: 2026-007 "depended on" the
travel policy through a capability it shared with 2026-006, because the USES_DATA was extracted for 006 only.

**The last layer.** `infer` runs after the operator edits; a derived edge never overwrites an edge with the same id;
derived edges are recomputed on every build, never read from disk, and `edges.jsonl` includes them flagged.

**Incremental.** The form layer is a pure `ideaBundle(idea)`; `buildGraph` keeps a per-idea cache keyed by a content
hash of the idea record (level 1) when given `cache`; `rebuildGraph` holds one cache per workspace and the Deep read
touch bus invalidates an idea's bundle. `readEdits` folds the operator log by appended lines (a rewritten file is
parsed in full). Rules run in full with `derived.inputs` kept, so neighbourhood recompute can follow later.

**Where it shows.** Universe: derived links dashed in a third colour (violet), with a legend in the Show menu. Demand:
"By system" and "By tool" beams from DEPENDS_ON/USES. The idea's Connections: a "Similar ideas" block from SIMILAR_TO
with the shared stars as the why, and a line "Text changed since the AI last read it" (or "not read yet") with one
button, **Read again** (`POST /api/ai/extract`); the app never calls the AI on its own. `extractCoded` notes each read
in `data/graph/ai-reads.json` (idea → when, the hash of the text it read). Link tables mark a derived row "derived by
<rule>" and never offer "Add it anyway" on it. Counts (`unconfirmed`, link counts, the star's Links fact) leave derived
edges out.

**Query engine.** `follow`/`rank` with a derived `rel` work over derived edges; without `rel` they use the stated
links only. Each derived edge a step used adds a trace line "derived by <rule> from <inputs>" (at most five, then "and N
more"). `QUERY_GUIDE` lists the derived relations and when to use them (facts, dependencies, pairs) against `search`.

## 5. Phase 3: ontology as data, validation, export

**File.** `rules/ontology.yaml`: `nodes: { <Type>: { label, colour, description } }` and `relations: { <REL>: { from,
to, meaning, inverse, derived } }`. `ontology.ts` keeps the built-in ontology as data and exports `ALLOWED`,
`NODE_LABELS`, `NODE_COLOURS`, `RELATION_MEANINGS` derived from it; `src/graph/ontologyFile.ts` (node only) loads the
file and applies it in place (only known type and relation names can be changed: labels, colours, descriptions,
meanings, pairs). `/api/state` carries the ontology so the UI's labels and colours follow the file.

**Check.** `cafe ontology check --workspace DIR`: the ontology file (unknown types or relations, bad pairs), the
entities file (sections, id prefix by type, duplicate ids and aliases), the rules file (unknown relations, chains whose
types do not line up), then the workspace graph (every edge's relation allowed and its end types right, every derived
edge's inputs present, alias edits whose star is gone). Prints each violation on a line, "No violations" otherwise,
exit code 1 when any. Never fixes.

**Prompt.** `extractTask` lists the AI relations with their meanings from the ontology, not only the type pairs.

**Export.** `exportJsonLd(graph, scope)` with an `@context` mapping every type and relation to the Café vocabulary;
each node is a resource with its label, attributes and its outgoing links as properties, and `links` lists every edge
in full (source, confidence, confirmed, derived). `cafe export --workspace DIR [--idea ID]` and the command bar's
`export graph [idea]` write `data/exports/<stamp>-<scope>.jsonld`. Routing to CSIC writes the idea's subgraph as
`csic-handoff.jsonld` beside `csic-handoff.md`. Names stay as in the files (the export is local).

## 6. Decisions beyond the brief

1. The alias edit records `of` (the target's label) so a merged twin's label is stable across rebuilds.
2. An operator link made with no idea on screen is unscoped and chains with any idea's edges under `same-idea`.
3. Derived relations cannot be linked by hand; the assistant says they are derived.
4. Derived links are dashed violet (not amber, which stays "waits on you"); the legend is in the Show menu.
5. Export goes to `data/exports/` (the existing exports folder), not a new `data/export/`.
6. The bundle cache key is a content hash of the idea record (what `listIdeas` already reads), not mtimes.
7. The fake agent learns `add a <kind> X to [S]`, `alias X as [S]` and `export graph` so the practice server can show
   the whole flow with no real AI.
8. The last-read note lives in `data/graph/ai-reads.json`, one entry per idea, written by `extractCoded`.

## 7. Tests

Phase 1: `tests/registry.test.ts` (resolve table, file + alias edits, defaults), `graph.test.ts` additions (a feature
under an alias lands on one star; no file → identical graph), `server-graph.test.ts` (a second import under other
wording lands on one star; merge then re-read stays merged; merge records the alias; the alias route/command).
Phase 2: `tests/rules.test.ts` (one table test per rule, the 006/007 scope case, a disabled rule, never confirmed
unless inputs are, counts exclude derived, incremental == full after each kind of change), `command-query.test.ts`
(follow over DEPENDS_ON with the trace line), UI tests for the beams, the Similar block, the link row tag.
Phase 3: `tests/ontology.test.ts` (load/fallback equality, check clean on the test data, violations on a broken
fixture, export round-trip, the hand-off's JSON-LD).

## 8. Non-goals

No database, no RDF store, no OWL reasoner, no cloud. No change to AI providers. No auto-confirm, auto-route or
auto-merge. No approval steps. No push.

## 9. Addendum (2026-10-26): capabilities at a reusable level

Measured on the practice workspace with the real provider, reading the 7 ideas gave 36 Capability stars, accurate
but idea-specific ("Region-specific policy rule lookup", "Split claim detection"), so almost none was shared and
`shared-stars` fired only on the stub provider's leftovers. The capability is the graph's reusable unit; these are
decided, not re-opened:

1. **The extract prompt.** A capability is "something a solution does that another idea could reuse", a short noun
   phrase (2 to 4 words, no noun that belongs to the idea alone), 2 to 5 per idea; the specific detail goes into the
   link's `description`. Before inventing a label the AI picks one from `existing.capabilities` whenever the meaning
   matches, even if the wording differs. Three worked examples, specific → reusable. Pain points may stay specific;
   a system is the system or data source, not the file ("Expense system", not "Expense system export").
2. **A superset guard in `planAiLinks`.** After the registry, the exact label and Deep read's nearest, a proposed
   Capability whose words (stop words aside) are a superset of an existing Capability's words reuses that star, and
   the extra words go into the link's description ("Answers (for travel)"). Only a Capability, only a star of two or
   more words (a one-word star such as "Reporting" absorbs nothing), never across types.
3. **Counts.** `growIdea` reports `capabilities: { reused, new }`; the idea panel's Read again line says
   "Read again: 3 capabilities reused, 1 new."
4. **No change to the fake provider.** Its two generic capabilities already read as reusable.

## 10. Addendum (2026-10-27): what the full re-test found (7.6/10), decided

1. **Reply.** `reply` is required with answer, propose and clarify (stated in the prompt; the JSON-schema subset has
   no conditionals, so the app enforces it). An empty reply is asked for once more with `note` and `stepsLeft: 1`;
   still empty, `plainReply` writes "From the graph: …" from the results (groups, ranked list, people, counts or the
   set; then records and passages). The thought is never shown as the answer.
2. **Budget.** `stepsLine(left)` says the step number of 5 and how many remain after it; `stepsLeft` is in DATA. An
   answer claiming a step limit with steps left is sent back once ("Asked again: …" in the trace).
3. **Scope.** `search last: true` scopes to the ideas of the set before it, else of the previous answer (ideas, or
   the ideas linked to its stars), searching wide (50) before cutting to `limit`. With a field-shaped match (current
   process, challenge, impact) every scoped idea with no passage of that section is read from its record
   (`records`), Deep read on or off. An intersect removes what it dropped from `touched`.
4. **Rank.** Distinct linked stars, of `type` when given; every star tied with the last kept is kept.
5. **Exact.** A match equal (by slug) to a label or an alias in `attrs.aliases` starts from those stars only, before
   containment and before the nearest labels; the trace says "exactly: X, known as "m"".
6. **Already there.** System → Idea: if the registry resolves the name and one of the idea's capabilities USES_DATA
   it (or the idea DEPENDS_ON it), the resolver reports it and proposes nothing.
7. **Stale edits.** `staleEdits(nodes, edits)` follows active merges first, then names link, unlink, rename, alias and
   merge (target) edits whose stars are missing. `applyEdits` re-points an edit made after a merge. On the practice
   workspace op-2, op-3 and op-6 stay stale: their capability (Document parsing, Workflow routing) was renamed by the
   re-extraction, which is not a merge; op-6's merged system is no longer the reason.
8. **Trace.** Lines past the derived cut are kept aside (`aside`) with their ends and come back when the reply names
   both; a team named in the reply must have come from a step (sent back once, else a "Not from a step" line).
9. **Small.** Upkeep's read writes `lastRun`/`done`/`total` when the job is idle or done; the operator's message chips
   only @-picked stars; a quoted name is not chipped.
