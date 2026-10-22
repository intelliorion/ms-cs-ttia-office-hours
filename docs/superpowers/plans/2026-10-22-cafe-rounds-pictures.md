# Rounds, pictures and PDFs, first-run welcome — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rounds become operator-made, many, and visible in the knowledge graph; the Import reads text PDFs itself and lets the AI read pictures and scanned PDFs; an empty workspace greets the operator; status.csv goes; "Inbox" is called "Import".

**Architecture:** Server (Node ≥20, TypeScript strict, vitest) in `cafe-app/src`, plain-file workspace. UI React 19 + Vite in `cafe-app/ui`, built into `cafe-app/web` (committed). Rounds are folders under `rounds/`; the graph is rebuilt from ideas + AI links by `buildGraph`. Picture reading is a new optional provider ability `look` used by the Import's Read step.

**Tech Stack:** TypeScript, vitest, React, zustand, `pdfjs-dist` (new, legacy build), Claude Code CLI (`--tools Read --allowedTools "Read(./<name>)"`).

**Spec:** `docs/superpowers/specs/2026-10-22-cafe-rounds-pictures-design.md` (binding).

## Global Constraints
- No real names in test data, copy or fixtures; kit names come from the kit script's synthetic `NAMES`.
- Stages never change by code or dropped file. AI proposes, code decides.
- User-facing word is "Import", never "Inbox". Code identifiers, routes `/api/inbox/...`, folder `inbox/`, data-testids and `data-action="inbox"` stay.
- New UI matches the universe look (tokens `--teal`, `--amber`, `--cream`); `[data-quality="lite"]` disables animation.
- Commands run from `cafe-app/`: server tests `npx vitest run`; UI tests `cd ui && npx vitest run`; typecheck `npx tsc -p ui --noEmit` and `npx tsc --noEmit`; build `npm run build:ui`; kit `npm run test-data`; manifest `bash ../scripts/make-manifest.sh` (from repo root `bash scripts/make-manifest.sh`).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01P3ov37P2fF1cuhtF4wyed3`.
- Never touch the server on port 4100 (the operator's). Tests and scripts use their own ports/workspaces.

## Review Focus
1. A workspace from before this change (folder `rounds/ROUND-2026-Q4/round.yaml` with only `id`; ideas with `round: ROUND-2026-Q4`) must load, list that round, and draw the IN_ROUND links. Test in Task 1.
2. An idea with `round: ''` drafts an E2 without throwing; the Outbox shows the missing-dates note. Test in Task 1.
3. A picture that holds at the screen leaves no transcription in the sidecar JSON. Test in Task 3.
4. A PDF with no text layer goes to the AI path; a text PDF never calls the AI. Test in Task 3.
5. The welcome card never shows while a pop-out is open and vanishes when the first idea arrives. Test in Task 2.

---

### Task 1: Rounds on the server, in the graph, and status.csv removed

**Files:**
- Modify: `cafe-app/src/round/round.ts`, `cafe-app/src/round/store.ts`, `cafe-app/src/workspace/init.ts`, `cafe-app/src/import/importRows.ts`, `cafe-app/src/inbox/actions.ts` (≈line 320), `cafe-app/src/inbox/flow.ts` (≈line 370), `cafe-app/src/comms/outbox.ts` (lines 104, 129), `cafe-app/src/review/review.ts` (≈line 140), `cafe-app/src/server/api.ts` (state route ≈line 55, `/api/round` line 78, status export line 260), `cafe-app/src/graph/ontology.ts`, `cafe-app/src/graph/build.ts`
- Delete: `cafe-app/src/exports/status.ts` and its test(s) (`grep -rl "writeStatusCsv\|status.csv" cafe-app/src cafe-app/tests`)
- Test: `cafe-app/src/round/store.test.ts` (new or extend), `cafe-app/src/graph/build.test.ts` (extend), the api test file that covers `/api/state`

**Interfaces:**
- Produces (Task 2 consumes):
  - `interface Round { id: string; name: string; created: string; open?; deadline?; reviewBy?; seriesStart?; roadshow? }`
  - `listRounds(root): Promise<Round[]>` newest first by `created`, then id desc; any `rounds/ROUND-*` folder counts; a round.yaml without `name` gets `name = id`, without `created` gets `created = ''` (sorts last).
  - `createRound(root, name: string, clock): Promise<Round>` → id `ROUND-${String(n).padStart(3,'0')}` where n = 1 + the highest existing `ROUND-NNN` number (folders not matching `ROUND-\d{3}` are ignored for numbering); empty name → `defaultRoundName(clock())` = `${year} Q${quarter}`.
  - `currentRoundId(root): Promise<string | null>` = `listRounds(root)[0]?.id ?? null`.
  - `saveRound(root, id, patch)` (id now required); `loadRound(root, id)`.
  - `setIdeaRound(root, ideaId, round: string, clock): Promise<Idea>`: `''` clears; otherwise the round folder must exist or throw `Unknown round`; writes `idea.round`, appends history `round set to <name>` / `round cleared` the way `setStage` appends its line (find `setStage` with grep and mirror its history call).
  - Routes: `GET /api/rounds` → `{ rounds: (Round & { ideas: number })[] }`; `POST /api/rounds {name}` → Round; `POST /api/rounds/:id {dates…}` → Round (replaces `POST /api/round`); `POST /api/rounds/:id/ideas {ideaIds: string[]}` → `{ updated: number }`; `POST /api/ideas/:id/round {round}` → Idea.
  - `GET /api/state` returns `rounds: Round[]` (newest first) and no longer `round`.
  - Ontology: `NodeType` gains `'Round'`; `NODE_TYPES`, `NODE_LABELS.Round = 'Round'`, `NODE_COLOURS.Round = '#e7d8b1'`; `Relation` gains `'IN_ROUND'`; `ALLOWED.IN_ROUND = ['Round', 'Idea']` wait — direction: the spec says Idea → Round, so `ALLOWED.IN_ROUND = ['Idea', 'Round']`. `AI_RELATIONS` and `AI_NODE_TYPES` unchanged.
  - `buildGraph(ideas, aiLinks, rounds: Round[] = [])`: one `Round` node per round (`id: nodeId('Round', round.id)`, `label: round.name`, `attrs: { roundId, ideas: <count> }`), and for each idea with a non-empty `round` an edge `IN_ROUND` from the idea node to the round node, description `'Round'`, source `form:<ideaId>`, confidence 1, confirmed. An idea whose round folder is missing gets a Round node made from the id (label = id) so the link still draws.
  - `rebuildGraph(root)` passes `await listRounds(root)`.

- [ ] **Step 1: Failing tests for the round store**
  In `src/round/store.test.ts`: (a) `currentRoundId` on an empty workspace resolves `null`; (b) `createRound(root, '', clock)` with clock `2026-10-22T…` makes `rounds/ROUND-001/round.yaml` with `name: '2026 Q4'`, `created` = clock; a second create gives `ROUND-002`; (c) a pre-existing folder `rounds/ROUND-2026-Q4/round.yaml` containing only `id` lists with `name: 'ROUND-2026-Q4'`, and a later `createRound` yields `ROUND-001` (legacy folder ignored for numbering); (d) `listRounds` orders newest `created` first; (e) `setIdeaRound` with an unknown id throws `Unknown round`, with `''` clears and logs `round cleared`.
- [ ] **Step 2: Run, see them fail.** `npx vitest run src/round`
- [ ] **Step 3: Implement** `round.ts`/`store.ts`/`init.ts` (init: remove the round-creation block and `roundIdFor`; keep folder creation). Update every caller listed in Files: import and the note→idea action set `round: ''`; `flow.ts` line ≈370 and `review.ts` ≈140 handle `null` per spec §2.1 (review: group by round, notice "Create a round first (Rounds button)" when there are no rounds at all — find how the review pack reports a problem today and use that mechanism); `outbox.ts` 104: `idea?.round || null`, and `loadRound` only when non-null, else `round: {}` so the existing fields-missing note fires with the text "Put this idea in a round to fill the dates" (find where the note text for missing round fields is built and make this the wording when the idea has no round).
- [ ] **Step 4: Failing test for the graph.** In `build.test.ts`: two rounds, three ideas (two in ROUND-001, one unassigned) → two Round nodes with `attrs.ideas` 2 and 0, exactly two IN_ROUND edges, confirmed, from idea to round; an idea pointing at a missing round `ROUND-999` yields a Round node labelled `ROUND-999`.
- [ ] **Step 5: Implement ontology + buildGraph + rebuildGraph.** Run `npx vitest run src/graph`.
- [ ] **Step 6: Routes and state.** Add the routes; replace `/api/round`; `/api/state` sends `rounds`. Extend the api test for `/api/state` to assert `rounds` is an array and `round` is absent; add a route test: create → assign two ideas → `GET /api/rounds` shows `ideas: 2` → clear one via `/api/ideas/:id/round {round:''}`.
- [ ] **Step 7: Remove status.csv.** Delete `src/exports/status.ts`, its tests, the route at api.ts 260, and the README line (`grep -n "status.csv" cafe-app/README.md`). `grep -rn "status-export\|writeStatusCsv" cafe-app/src cafe-app/scripts` must be empty.
- [ ] **Step 8: Review Focus 1 and 2 tests.** (1) legacy workspace fixture loads and `rebuildGraph` has an IN_ROUND edge to a node labelled `ROUND-2026-Q4`. (2) `draftEmail` for an idea with `round: ''` resolves and the Outbox row carries the note text.
- [ ] **Step 9:** `npx tsc --noEmit && npx vitest run` green. Commit: `Rounds: operator-made, many, and in the graph; status.csv removed`.

---

### Task 2: Rounds pop-out, round chip, Import rename, welcome card

**Files:**
- Modify: `cafe-app/ui/src/popouts/RoundPopout.tsx` (becomes the Rounds pop-out; keep the file name), `cafe-app/ui/src/layout/TitleBar.tsx`, `cafe-app/ui/src/panels/IdeaDetails.tsx` (id-head ≈line 118), `cafe-app/ui/src/popouts/IdeaSections.tsx` (next to `StageButton`), `cafe-app/ui/src/state/store.ts`, `cafe-app/ui/src/api.ts`, `cafe-app/ui/src/App.tsx`, `cafe-app/ui/src/panels/IdeasPane.tsx`, `cafe-app/ui/src/theme.css`, `cafe-app/ui/src/universe/graphView.ts` (`ALWAYS` gains `'Round'`, `BASE_SIZE.Round = 2.4`)
- Create: `cafe-app/ui/src/layout/Welcome.tsx`, `cafe-app/ui/src/layout/Welcome.test.tsx`
- Modify (copy only): every user-facing "Inbox" in `ui/src` (`grep -rn "Inbox" ui/src --include='*.tsx' --include='*.ts' | grep -v "\.test\.\|^.*import \|InboxPopout\|InboxCard\|inboxHelpers"`) and in `src` (`src/ai/tasks.ts`, `src/design/tools.ts`, `src/inbox/{actions,flow,match,parse,screen,steps,store,triage}.ts`) — strings only; fix the tests that assert those strings.
- Test: `ui/src/popouts/popouts.test.ts` (extend; remove the status.csv case), `ui/src/layout/TitleBar.test.tsx` if present, `Welcome.test.tsx`

**Interfaces:**
- Consumes Task 1's routes and `state.rounds`.
- Produces: `RoundChip({ ideaId, round })` in IdeaSections exporting a drop-down (`.stg-wrap` style portal like `StageButton`; class `.rnd-wrap`, do not reuse `.stage-wrap`) listing `state.rounds` + "No round"; posts `/api/ideas/:id/round` then `refresh()`.
- `Welcome({ onStart })`: renders only when `state.ideas.length === 0 && !popout`; markup: `<section className="welcome" data-testid="welcome"><h2>Nothing here but dark matter.</h2><p>Drop the first submissions export and watch the stars come out. The app sorts them; you drink the coffee.</p><button className="btn primary" data-action="welcome-import">Start: import submissions</button></section>`; the button opens `{ kind: 'inbox' }`.

- [ ] **Step 1: Failing UI tests.** Welcome: shows with zero ideas and no pop-out; hidden when a pop-out is open; hidden with one idea; button opens the Import pop-out. Pop-outs test: title bar has buttons "Import", "Rounds", no "status.csv"; Rounds pop-out lists rounds newest first with counts, Create posts `/api/rounds` with the typed name, "Put 2 ideas in …" posts `/api/rounds/ROUND-001/ideas` with both ids, "Take out" posts `/api/ideas/:id/round` with `''`.
- [ ] **Step 2: Run, see them fail.** `cd ui && npx vitest run`
- [ ] **Step 3: Implement** per spec §2.2 and §4. Rounds pop-out layout: `.pop-grid` two columns (reuse), left = rounds list + New round, right = Unassigned ideas; Settings form below unchanged. Welcome CSS: centred absolutely in the frame (`left:50%; top:46%; transform:translate(-50%,-50%)`), max-width 520px, `.panel` background, 1px teal rim with `box-shadow: 0 0 40px rgba(125,211,207,.25)`, heading in `--cream`, fade-in 400 ms keyframe; `[data-quality="lite"] .welcome{animation:none}`. z-index between the universe (0) and `.modal-back` (30): use 8.
- [ ] **Step 4: Rename copy.** "Inbox" → "Import" in the files listed (title bar pill text, pop-out heading, step details, hold reasons, notices, drop-well hint). Server-side strings too. Fix asserting tests. `grep -rn "Inbox" cafe-app/ui/src cafe-app/src --include='*.ts' --include='*.tsx' | grep -v "InboxPopout\|InboxCard\|inboxHelpers\|InboxItem\|InboxType\|InboxMeta\|inbox\b" ` should list only identifiers.
- [ ] **Step 5: Graph colours.** `ALWAYS` includes Round; `NODE_COLOURS` comes from the server ontology already; check the legend (if any component lists node types, Round appears with the label "Round").
- [ ] **Step 6: Review Focus 5 test** is Step 1's Welcome cases; confirm present.
- [ ] **Step 7:** `npx tsc -p ui --noEmit`, `cd ui && npx vitest run`, `npm run build:ui`. Commit: `Rounds pop-out and round chip, Import rename, first-run welcome`.

---

### Task 3: Text PDFs read by code, pictures and scanned PDFs read by the AI

**Files:**
- Modify: `cafe-app/package.json` (add `pdfjs-dist`), `cafe-app/src/inbox/parse.ts` (line 63 case), `cafe-app/src/inbox/triage.ts` (`readAndScreen`), `cafe-app/src/inbox/flow.ts` (Read step), `cafe-app/src/inbox/store.ts` (`InboxMeta` gains `pages?`, `words?`, `readBy?: 'ai'`, `notes?`), `cafe-app/src/ai/connector.ts` (`Provider.look?`, `Connector.look`), `cafe-app/src/ai/tasks.ts` (`lookTask`), `cafe-app/src/ai/providers/claude.ts`, `cafe-app/src/ai/providers/cli.ts` (if `runCli` needs a `cwd` option), `cafe-app/src/ai/providers/fake.ts`
- Create: `cafe-app/src/inbox/pdf.ts` (`readPdfText(bytes): Promise<{ text: string; pages: number } | { error: 'protected' | 'broken' }>`), `cafe-app/src/inbox/pdf.test.ts`, `cafe-app/src/ai/look.test.ts`
- Test: `cafe-app/src/inbox/flow.test.ts` (extend), `cafe-app/src/inbox/parse.test.ts` (extend)

**Interfaces:**
- `parseDrop(name, bytes)` stays synchronous for every type it reads today. New return values: for `.pdf` it returns `{ type: 'document', text: '', meta: { pending: 'pdf' } }`; for `.png/.jpg/.jpeg/.gif/.webp` `{ type: 'note', text: '', meta: { pending: 'picture' } }`; for `.bmp/.tif/.tiff/.heic` unreadable "This picture format isn't supported; save it as PNG or JPG"; over 10 MB (`bytes.length > 10 * 1024 * 1024`) unreadable "Pictures and PDFs up to 10 MB only".
- `readAndScreen(root, id, ai, onStep)` becomes the owner of the pending cases: `pending: 'pdf'` → `readPdfText`; ≥40 non-space chars → `type 'document'`, `meta { pages, words }`; fewer → fall to the picture path with `meta.pages`; `error` → unreadable "Can't open this PDF (it may be protected)". `pending: 'picture'` → `ai.look(filePath, lookTask)`; no `look` on the chosen provider → unreadable "Reading pictures needs Claude Code (AI helper → provider)"; `readable: false` → unreadable `Can't read this picture: ${notes}`; else `type 'note'`, `text = output.text`, `meta { readBy: 'ai', notes, words }`. `onStep(detail)` lets `flow.ts` update the Read step detail while the AI runs.
- `Connector.look(file: string, task: LookTask, opts?) : Promise<{ provider, label, output, ms }>`; `Provider.look?(file, prompt, { timeoutMs })`. Claude: copy the file to `fs.mkdtemp(os.tmpdir()/cafe-look-)` under its basename; args `['-p','--output-format','text','--tools','Read','--allowedTools',`Read(./${name})`,'--max-turns','3','--strict-mcp-config','--no-session-persistence']`; `runCli` with `cwd` = that folder; always remove the folder in `finally`.
- `lookTask`: prompt as spec §3.2; `schema: { text: string, notes: string, readable: boolean }` through the existing `schema.ts` validator; `timeoutMs: 90_000`.
- Fake `look`: by file name per spec §3.4; honours `CAFE_AI_FAKE_DELAY`.
- Read step detail strings: running `Picture: the AI is reading it…`; done `Picture read by the AI, ${s} s, ${words} words`; text PDF `PDF, ${pages} page(s), ${words} words`; scanned PDF `Scanned PDF read by the AI, ${s} s, ${words} words`.
- Hold at the screen for an AI-read item: the stored item has `text: ''` and `meta.readBy: 'ai'`, hold reason list gains "The text was not kept."

- [ ] **Step 1: Failing tests.** `pdf.test.ts`: the kit's text PDF (build a tiny one inline with the same generator approach as `scripts/make-test-data.mjs`, or import a fixture) → text contains the memo sentence, pages 1; a PDF with an image and no text → `text.trim().length < 40`. `look.test.ts`: the connector with the fake provider returns the whiteboard text for `whiteboard.png`, `readable: false` for `blank.png`; a provider without `look` → the connector rejects with `AiError('This AI cannot read pictures')`. `flow.test.ts`: (a) drop `14-whiteboard.png` with fake AI → Read step done with detail starting `Picture read by the AI`, item type `note`, matched to CAFE-2026-002, stars added; (b) drop a text PDF → the fake's look is never called (spy) and Read detail starts `PDF, 1 page`; (c) a picture whose fake transcription contains a 12-person tracker (name the fake case `tracker.png`) holds at Screen with `text === ''` in the sidecar and the reason "The text was not kept."; (d) `.bmp` is unreadable with the format message.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Install** `npm i pdfjs-dist@<current 4.x>` (exact version; import `pdfjs-dist/legacy/build/pdf.mjs`; `getDocument({ data, useSystemFonts: true, isEvalSupported: false })`; join `textContent.items.map(i => 'str' in i ? i.str : '')` with spaces, pages with `\n\n`). Catch `PasswordException` → `protected`, others → `broken`.
- [ ] **Step 4: Implement** parse/triage/flow/connector/providers per Interfaces. The Read step in `flow.ts` wraps the picture path in `timed` so `ms` is recorded.
- [ ] **Step 5: Review Focus 3 and 4** are Step 1 (c) and (b); confirm present.
- [ ] **Step 6:** `npx tsc --noEmit && npx vitest run` green. Commit: `Import reads text PDFs itself and has the AI read pictures and scanned PDFs`.

---

### Task 4: Import surface for pictures, test kit, acceptance, tour, docs

**Files:**
- Modify: `cafe-app/ui/src/popouts/InboxPopout.tsx` (drop-well hint), `cafe-app/ui/src/popouts/InboxCard.tsx` ("What the AI read" block when `meta.readBy === 'ai'`), `cafe-app/ui/src/popouts/inboxHelpers.ts` (chip `picture` for `type === 'note' && meta.readBy === 'ai'`), `cafe-app/scripts/make-test-data.mjs`, `cafe-app/scripts/acceptance.mjs`, `cafe-app/scripts/ui-tour.mjs`, `cafe-app/README.md`, `cafe-app/test-data/README.md` (generated), `MANIFEST.txt`
- Test: `ui/src/popouts/inboxHelpers.test.ts` (chip), `ui/src/popouts/InboxCard.test.tsx` (read block)

**Interfaces:** consumes Task 3's `meta.readBy`, `meta.notes`, `meta.pages`.

- [ ] **Step 1: Failing UI tests** for the chip and the "What the AI read" block (shows the transcription and the notes; absent for a normal note).
- [ ] **Step 2: Implement UI.** Hint text: "Drop exports, emails, transcripts, Word, PDF and pictures". Block heading "What the AI read".
- [ ] **Step 3: Kit.** In `make-test-data.mjs`: remove `12-cannot-read.pdf`; add `12-text.pdf` (reuse the existing PDF writer, several text lines: "Memo on CAFE-2026-004 Expense anomaly finder", "Data: the monthly expense system export", "Capability: Duplicate claim spotting", "Finance wants a weekly digest of flagged claims"); add a bitmap text renderer (5×7 font for A–Z, 0–9, space, colon, comma, hyphen, slash; scale 4; 24 px line gap; black on white; PNG via zlib + CRC as in the Stage probe) and write `14-whiteboard.png` with the four spec lines; write `15-scanned.pdf` embedding that bitmap as an `/XObject /Image` with `/FlateDecode` RGB and no text. README rows per spec §3.4; one line in the README intro: "Pictures are read by the AI before the personal-data check; a held picture's text is not kept." Suggested order: `… 12-text.pdf, 13-outlook.msg, 12-first-builder.eml, 13-conflicting-reply.eml, then 14 and 15`.
- [ ] **Step 4: Acceptance.** Fake provider gets the `look` cases (Task 3); `agenticPass` gains rows: 12-text.pdf read as document and matched to 004; 14-whiteboard.png Read detail starts "Picture read by the AI", matched to 002; 15-scanned.pdf detail starts "Scanned PDF read by the AI". Rounds: a row that creates a round, assigns two ideas, and finds two IN_ROUND edges in `/api/graph`. Remove any status.csv row.
- [ ] **Step 5: Tour.** `--only=agentic` adds shot 65 (picture card mid-read, using `CAFE_AI_FAKE_DELAY`) and 66 (done, with "What the AI read" open); a shot of the welcome card on an empty workspace (67) and the Rounds pop-out with one round and two assigned ideas (68).
- [ ] **Step 6: Docs.** `cafe-app/README.md`: Rounds section (operator-made, many, in the graph), Import reads PDFs and pictures (how, and the privacy line), no status.csv, "Import" wording throughout.
- [ ] **Step 7:** `npm run test-data`, `node scripts/acceptance.mjs` all rows pass, `node scripts/ui-tour.mjs --only=agentic` clean, `npm run build:ui`, manifest refreshed. Commit: `Pictures in the Import: kit, acceptance, tour, docs`.
