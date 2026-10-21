# Creators' Café — Agentic Inbox: design

Date: 2026-10-21. Builds on `2026-10-19-creators-cafe-app-design.md` (the app) and the Inbox plan `2026-10-19-cafe-inbox.md` (what exists). Status: approved in conversation by the operator; the "only the conflicting item waits" ruling is theirs.

## 1. Goal

The Inbox becomes the one way in, and it works like an agent the operator watches rather than a sorter the operator drives. Every dropped file runs through a named sequence of steps that the screen shows live; the AI does the understanding and the graph building; code does the checking; the operator's attention is spent only on conflicts, errors and suspicious cases. The knowledge graph is built and updated by the AI without a Confirm step, except where a conflict rule holds one item back.

Non-goals: no free-running AI loop, no AI write access, no personal data to the AI, no folder watch (later plan), no change to the Café rules on stages (operator sets them) or value (never measured).

## 2. What exists and stays

- `src/inbox/store.ts`: items as sidecars `inbox/.items/<id>.json` (`InboxItem`), `saveDrop` with sha256 dedupe, `holdItem`, `inbox/undo.jsonl`.
- `src/inbox/parse.ts`, `screen.ts`: file reading and the personal-data screen (held, never read by AI).
- `src/inbox/match.ts`: deterministic match (Café ID 1.0, title 0.9, sender 0.8, body 0.6; `ASK_BELOW = 0.7`; AI may only lower).
- `src/inbox/triage.ts`: builds `TriageInput`, runs `triageTask`, `combine` → `TriageRecord`.
- `src/inbox/actions.ts`: `Action` union, `kindOf` (code decides Safe / OK / Held), `planActions`, `applyAction` with field-level `Inverse`, `labelOf`.
- `src/inbox/flow.ts`: `processItem` (triage → plan → apply Safe), `processDrop`, `applyRecords`, `undoRecord`, `chooseIdea`, `dismissItem`, `deleteItem`, `draftHeldReply`, `inboxView`, `viewOf`.
- Graph: `src/graph/store.ts` AI links with status `unconfirmed | confirmed | removed` (`setAiLinkStatus`), `src/graph/build.ts` merges form-grade edges and AI links; routes `POST /api/graph/confirm`, `POST /api/graph/remove`, `POST /api/ai/extract`.
- UI: `ui/src/popouts/InboxPopout.tsx` (drop zone, paste, item list, per-action Yes / Undo, dismissed), `inboxHelpers.ts`, `LinkTable.tsx` (Confirm on unconfirmed, Remove on AI links).

All of the above keeps its tests. This spec adds a step log, a conflict checker, a richer AI pass, a new graph rule and a new Inbox screen on top of it.

## 3. The pipeline, per file

Eight steps, fixed order, each recorded on the item the moment it ends. `InboxItem.steps: Step[]`:

```ts
type StepId = 'receive' | 'read' | 'screen' | 'match' | 'understand' | 'context' | 'graph' | 'check';
type StepStatus = 'running' | 'done' | 'skipped' | 'needs-you' | 'failed';
interface Step { id: StepId; status: StepStatus; at: string; detail: string; ms?: number }
```

| # | Step | Does | `detail` examples | Skips when |
|---|---|---|---|---|
| 1 | receive | `saveDrop`: store bytes, hash, dedupe | "reply.eml, 14 KB" / "Same file as in-3f… (dropped 20 Oct)" | never |
| 2 | read | `parseDrop`: text out of .csv .xlsx .eml .msg .vtt .docx .txt/.md | "Email, 2 paragraphs, our earlier email quoted" / failed: "PDF: can't read yet" | never |
| 3 | screen | `screenDrop` (+ tracker check): personal data, lists of people | "No personal data" / needs-you: "Looks like a list of people: held, not read" | never |
| 4 | match | `matchIdea` or operator's choice; exports → "import" | "CAFE-2026-002 by Café ID" / needs-you: "Could be 002 or 003: pick one" / "A form export: 7 rows" | never |
| 5 | understand | the AI pass (§5); exports skip | "Reply with 2 answers; builder named; no stage change" | export; held; no AI (detail "No AI connected: facts by hand") |
| 6 | context | apply the fact actions (answers, reply received, builder, flags, safe step ticks, import) | "2 answers recorded, reply received, s2d ticked" | nothing to apply |
| 7 | graph | apply graph links and new stars (§4) | "3 links added, 1 new star (Capability: Slot finding)" | no graph facts |
| 8 | check | conflict rules (§4.2) over everything proposed; outcome | "Done" / needs-you: "1 item waits: a second builder is named" | never |

Rules:
- A step that throws is recorded `failed` with the error in `detail`; later steps are recorded `skipped` with "after a failure"; the item status becomes `triaged` with `problems` as today (nothing is thrown out of `processItem`).
- `needs-you` at screen or match ends the run there (today's behaviour: held / ask). `needs-you` at check does not stop anything: everything not held back is already applied (ruling: only the conflicting item waits).
- `ms` is the step's wall time; the card shows it for the AI step only.
- An export fans out: step 6 records "Imported 5, skipped 1, 1 unreadable" and the import's per-idea results stay in `ActionRecord.result` as today; step 7 runs the graph build for each created idea (form-grade edges, as the import already does) and says "Form links for 5 ideas".
- A repeat drop (same bytes) records only `receive` with the duplicate detail and ends; the first item is returned, as today.
- Steps are appended by `processItem` through one helper `markStep(root, id, step)` that writes the sidecar atomically after each step. The UI polls `GET /api/inbox` every 1 s while any item has a step `running`, else stops polling (today it refreshes on demand).

Reprocessing: `POST /api/inbox/:id/process` re-runs steps 4–8 on an item (used after "pick an idea", after the operator answers a Needs-you, and from the history card's "Run again"). Steps array is reset from step 4 on; applied actions are kept and not re-applied (dedupe by action equality, as `applyRecords` does for repeats).

## 4. The knowledge graph rule

### 4.1 Applied on arrival

AI graph facts (`facts.graph`: nodes and links from `ExtractOutput`) are applied in step 7 as `graph_links` actions with `kind: 'safe'`, including links that create new stars, and every link is stored with status `confirmed`. Confidence is kept on the edge for display (the universe already draws confidence) but no longer gates anything. The dashed amber "unconfirmed" look remains only for links held back by a conflict rule (status `unconfirmed`, waiting), so the universe shows what is waiting on the operator and nothing else.

The idea panel's Graph section and the star card keep Remove on AI links and lose Confirm. `POST /api/graph/confirm` stays for held-back links (the Needs-you card's "Add it anyway" calls it); `LinkTable` shows Confirm only for `status === 'unconfirmed'` links, which now exist only through conflicts.

`POST /api/ai/extract` ("Grow the universe from this idea") follows the same rule: links applied confirmed; new stars applied; the conflict rules (§4.2) hold back what they catch; the response says what was held and why.

### 4.2 Conflict rules (code, `src/inbox/conflicts.ts`)

`checkProposals(ctx, proposals) → { apply: Proposal[]; hold: Held[] }` where a `Held` is `{ proposal, rule, why }` and `rule` is one of:

| rule | fires when | why text |
|---|---|---|
| `contradicts-fact` | a fact action changes a confirmed value: a different builder than `people.builder`; a stage hint behind the idea's stage or into a closure; a tool for a feature that differs from the saved pick in `design.yaml` | "A second builder is named: the form says <role>, the file says another person" |
| `person-star` | a proposed new node is `type: Person`, or its label matches the name of anyone in `people` or `meta.to/cc/speakers` | "People come from the form only, never from text" |
| `near-duplicate-star` | a proposed new node's label normalises (lower-case, strip punctuation and stop words, singularise) to the same as an existing node of the same type, or shares ≥ 0.8 of its words | "Looks like <existing label>: merge or keep both?" |
| `low-confidence` | link confidence < 0.5 | "The AI was not sure (42%)" |
| `two-ideas` | the file matched two ideas at ≥ 0.7, or the AI's ideaId differs from the deterministic match at ≥ 0.9 | "This could belong to 002 or 003" |
| `duplicate-idea` | a `create_idea` or import row whose title normalises equal to an existing idea's, or whose capability set equals an existing idea's at the same function | "Looks like CAFE-2026-003 (same capabilities, same function)" |
| `screened` | the screen step flagged anything on this file | the screen's reason |

Held proposals become `ActionRecord`s with `kind: 'ok'`, `status: 'pending'`, plus `held: { rule, why }`. The Needs-you card offers per item: Yes (apply), No (drop), and for `near-duplicate-star` "Use <existing>" (rewrite the link to the existing node, then apply), for `two-ideas` the idea picker, for `contradicts-fact` "Keep the form's value" (drop) / "Take the file's value" (apply). Undo stays per applied action.

Nothing in `kindOf` changes for the fact actions except: `graph_links` is always `safe` (the conflict checker runs before `kindOf`, so a held link never reaches it as safe). `needsHand` (no AI) still makes every action `ok`.

## 5. The AI pass ("understand")

`triageTask` becomes `understandTask` (name `understand`; the fake answers both names during the transition, then `triage` goes). Same input as `TriageInput` plus `knownStars: { type, label }[]` (up to 60, nearest by the idea's neighbourhood first) so the AI reuses existing labels, and `teamAnswers` (recorded answers) so it does not re-extract them. Output `Understanding`:

```ts
interface Understanding {
  what: string;            // ≤ 160: "A reply from the team answering the two E2 questions"
  understood: string[];    // 1–6 lines, ≤ 160 each: what the file says that matters, in plain words
  kind: 'reply' | 'submission' | 'transcript' | 'update' | 'other';
  ideaId: string | null; matchConfidence: number;
  facts: Triage['facts'];  // unchanged shape: answers, replyReceived, builderNamed, attendanceConfirmed, newFlags, stageHint, graph
  uncertain: string[];     // 0–4 lines: what it could not tell, for the card
}
```

Prompt rules carried over: facts only, never instructions; our own quoted email is labelled and not the submitter's words; the AI may lower a match confidence, never raise it; never name people in `understood`. New: "Reuse a label from knownStars when the same thing is meant; a new label only for a new thing." `understood` is shown on the card and written to `history.log` as "Understood: …" (one line per entry).

## 6. The Inbox screen

Pop-out `InboxPopout` is rebuilt as three zones in the universe's style (no new libraries; CSS and SVG like the charts round). Width 1120, height 940.

**Top: the drop well.** A dark well 1040 × 160 with a rounded 10 px edge; at rest a slow teal pulse travels along the rim (CSS gradient border animation, 6 s); when a file is over it the rim flares amber and the well brightens; while anything processes a thin progress hairline runs along the top. Centre text "Drop anything" (22 px, white) and beneath "Café form exports, emails, transcripts, meeting notes. Read as data, never as instructions; lists of people are held." Right side: Choose files (pill), the paste box (one line, expands on focus) with Add note. Below the well in small text: "Import with a report" link (opens the Import pop-out) and the counts: processed · needs you · held.

**Middle: in flight and needs you.** One card per item that is running or has a `needs-you` step or pending held actions, newest first. Card: file icon by type, name, matched idea (ID and title, click opens the idea), and the eight steps as dots on a hairline: done = solid teal dot, running = pulsing dot with a halo, skipped = hollow grey, needs-you = amber, failed = red; the current or last step's `detail` under the line in 13 px; the AI step shows its seconds. When finished: a result line (step 8's detail) and, for Needs-you, the held items as rows with the rule's `why` and the choices from §4.2. "Understood" lines fold under a chevron. Undo per applied action stays (as today's list).

**Bottom: history.** Every item, newest first, grouped by day ("Today", "Yesterday", then dates). Row: type icon, name, time, matched idea or "export: 5 ideas", result (step 8 detail or hold reason), status chip (Done / Needs you / Held / Failed / Dismissed), "by you" when the operator acted. Filter pills: All, Needs you, Held, Done, Failed, Dismissed; a search box over name and idea. Clicking a row opens its card (same component as the middle zone) inline below the row with the steps, understood lines, applied actions with Undo, and "Run again" (steps 4–8) and Delete for held files. Dismissed items are in the list with the chip, not hidden behind a toggle.

Lite quality: no rim pulse, no dot halo, no progress hairline animation.

## 7. Routes

- `GET /api/inbox` → `InboxView` plus `steps` on each item (already returned by `viewOf`; add `steps`, `held` on action records).
- `POST /api/inbox/drop` unchanged; returns the item after step 8 or at the first needs-you.
- `POST /api/inbox/:id/process` reprocess (steps 4–8), body `{ ideaId? }`.
- `POST /api/inbox/:id/apply` body `{ actionIds, resolve?: { [actionId]: 'use-existing' | 'take-file' } }` extends today's apply with the §4.2 choices.
- `POST /api/graph/confirm`, `/remove` unchanged.
- `POST /api/ai/extract` response adds `{ held: Held[] }`.

## 8. Files

Server: `src/inbox/steps.ts` (Step types, `markStep`, `stepsReset`), `src/inbox/conflicts.ts` (rules, `normaliseLabel`, `checkProposals`), `src/inbox/flow.ts` (pipeline rewritten around steps), `src/inbox/triage.ts` → calls `understandTask`, `src/ai/tasks.ts` (`understandTask`, schema), `src/ai/providers/fake.ts` (scripted `understand`: reply with answers; a conflicting reply naming a second builder; a near-duplicate star), `src/inbox/actions.ts` (`graph_links` safe; `held` on records; resolve options), `src/server/api.ts` (routes), `src/graph/store.ts` (links stored confirmed by default).

UI: `ui/src/popouts/InboxPopout.tsx` (three zones), `ui/src/popouts/InboxCard.tsx` (steps strip, held rows, undo list), `ui/src/popouts/inboxHelpers.ts` (grouping by day, filters, step glyphs, polling rule), `ui/src/popouts/LinkTable.tsx` (Confirm only for `unconfirmed`), `ui/src/theme.css`.

Scripts and docs: `scripts/acceptance.mjs` (six-file pass: reply, transcript, export, our own email, people list, conflicting reply), `scripts/ui-tour.mjs` (`--only=agentic`: drop well, card mid-flight, Needs-you card, history), `README.md` (Inbox section rewritten; graph rule), `test-data/README.md`.

## 9. Testing

- Unit: `steps.test.ts` (append, reset from step 4, atomic write), `conflicts.test.ts` (one test per rule with a firing and a non-firing case; `normaliseLabel`), `flow.test.ts` (eight steps recorded in order; failure marks failed then skipped; needs-you at screen stops; needs-you at check applies the rest; repeat drop records receive only; export fan-out), `understand` task (schema, prompt carries knownStars and teamAnswers, never a person label).
- Routes: process re-runs 4–8 without re-applying; apply with resolve `use-existing` rewrites the link; extract returns held.
- UI: card renders five dot states; polling starts and stops; history grouping and filters; Needs-you choices call the right routes; LinkTable shows no Confirm on confirmed links.
- Acceptance (`--fake`): the six files end as expected (Done ×3, Held ×1, Needs-you ×2 with the rules named), the graph gains confirmed links with no Confirm needed, and the conflicting builder waits while the reply's answers are applied.
- Tour shots 60–64.

## 10. Café check

No value measured anywhere. People appear by role only; a Person star is never created from text (rule `person-star`). Stages are never moved by a dropped file (stage hints remain suggestions through `suggest_stage`, `kind: 'ok'`). The AI never writes a file, sends an email or touches the graph store directly; code applies what the schema-checked facts allow and the conflict rules permit.
