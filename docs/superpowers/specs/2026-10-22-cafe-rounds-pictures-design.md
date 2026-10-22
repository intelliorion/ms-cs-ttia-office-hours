# Rounds in the universe, pictures and PDFs in the Import, a first-run welcome

Date: 2026-10-22. App: `cafe-app/`. Branch: `agentic-inbox` (continues the agentic Import round). The operator asked for
all of this in one go and waived the spec review; rulings below are mine and are listed for them.

## 1. What the operator asked for, in their words

- "why I need run init, no, round info should be later once process all the submissions, then we can always add
  different rounds there will be multiple rounds, and round also need to be in KG this way we know which use case are
  in which round"
- "then also include PDF and image processing"
- "if app open blank, show a sleek humor message box with button start to import"
- "also remove status .csv, i don't know what is that"
- "also change the Inbox to Import"

## 2. Rounds

### 2.1 Model
- A round is a folder `rounds/ROUND-NNN/round.yaml` with `id`, `name`, `created` (ISO) and the existing date fields
  (`open`, `deadline`, `reviewBy`, `seriesStart`, `roadshow`). Ids are sequential: `ROUND-001`, `ROUND-002`. The name is
  free text; the default offered is `<year> Q<quarter>` of today, e.g. `2026 Q4`.
- Nothing creates a round for the operator. `cafe init` and `cafe start` create folders only. The string
  `Run "cafe init" first` is gone from the code.
- An idea's `round` is `''` (unassigned) until the operator puts it in one. Import never assigns a round. The Import's
  "create an idea from a note" action never assigns a round.
- `currentRoundId(root)` returns the newest round by `created` or `null`. Callers that need a round and get `null` say
  so in words, never throw a stack:
  - outbox drafting for an idea with no round: the draft still renders; date fields are blank and the Outbox row shows
    the note "Put this idea in a round to fill the dates" (the existing fields-missing mechanism).
  - the review pack groups ideas by round, newest round first, with ideas in no round under a final group
    "No round yet"; with no rounds at all it still builds (one group) and carries the notice
    "Create a round first (Rounds button)".
- Settings (`settings.yaml`) are unchanged and remain workspace-wide.

### 2.2 Operator surface
- The title bar button "Round" becomes "Rounds" and opens the Rounds pop-out:
  - left column: the list of rounds, newest first, each with name, id, idea count and the date fields (editable as
    today). Below the list: "New round" with a name box prefilled with the default name and a Create button.
  - right column: "Unassigned ideas" (checkbox list, Café id + title) with a round picker and the button
    "Put N ideas in <round>"; under each round in the left column its ideas, each with "Take out" (back to unassigned).
  - the Settings form stays in this pop-out, below, unchanged.
- The idea head (next to the Stage button) shows a round chip: the round name, or "No round", as a drop-down of all
  rounds plus "No round". Changing it writes `idea.round`.
- Routes: `GET /api/rounds` (list with counts), `POST /api/rounds` `{name}` → round, `POST /api/rounds/:id` dates
  patch (replaces `POST /api/round`), `POST /api/rounds/:id/ideas` `{ideaIds: [...]}` assign,
  `POST /api/ideas/:id/round` `{round: 'ROUND-002' | ''}`. `GET /api/state` carries `rounds` (list) instead of `round`.
- History log line per idea: `round set to <name>` / `round cleared`.

### 2.3 Rounds in the knowledge graph
- New node type `Round` (colour cream `#e7d8b1`, label = round name, `attrs.roundId`, `attrs.ideas` count). It is a
  label-always star like Idea and Team.
- New relation `IN_ROUND: ['Idea', 'Round']`, source `form:<ideaId>`, confirmed, built by `buildGraph` from
  `idea.round`. Every round is a star, with or without ideas, so an upcoming round shows as an empty star.
- The AI may not propose Round nodes or IN_ROUND links (`AI_NODE_TYPES`/`AI_RELATIONS` unchanged). The conflict rule
  `person-star` is unchanged; a new star named like a round is just a star.
- Clicking a round star and switching "Only related" on shows exactly that round's ideas.

## 3. Pictures and PDFs in the Import

### 3.1 Text PDFs
- `pdfjs-dist` (legacy build, runs in Node without a DOM) is added as a dependency. `parseDrop` reads every page's
  text, joins pages with a blank line, and returns `type: 'document'`, `meta: { pages, words }`, screenText as for a
  Word file. The Read step detail reads `PDF, 3 pages, 1,240 words`.
- A PDF whose text has fewer than 40 non-space characters in total is a scanned PDF and goes the picture way (3.2).
- Encrypted or broken PDFs are held: "Can't open this PDF (it may be protected)".

### 3.2 Pictures and scanned PDFs: the AI looks
- Supported: `.png .jpg .jpeg .gif .webp` and scanned `.pdf`, up to 10 MB. (The 10 MB limit holds every PDF, text ones
  too: it is checked before pdf.js runs, which has no page cap; the held reason reads "Pictures and PDFs up to 10 MB only".) `.bmp .tif .tiff .heic` stay held with
  "This picture format isn't supported; save it as PNG or JPG".
- A new provider ability `look(file, prompt, opts)`:
  - Claude Code: the file is copied alone into a fresh temp folder under the fixed safe name `picture.<ext>` (the
    extension lower-cased, one of png/jpg/jpeg/gif/webp/pdf; no other file). The CLI runs with
    `--tools Read --allowedTools "Read(./picture.<ext>)" --max-turns 3 --strict-mcp-config --no-session-persistence
    --setting-sources "" --permission-mode default`, cwd = that folder, prompt on stdin, so none of the operator's own
    Claude Code settings widen what Read can open. Verified on Claude Code 2.1.304 with a PNG (and a read outside the
    folder refused). The folder is deleted after.
  - Copilot CLI and the VS Code helper: `look` is absent; the item is held with "Reading pictures needs Claude Code
    (AI helper → provider)".
  - Fake: returns a canned transcription chosen by the file name (see 3.4).
- Task LOOK: "Open ./picture.<ext> with the Read tool. Transcribe all text in it verbatim, line by line, tables one row per
  line. Then describe what the picture shows in at most two sentences." Output schema `{ text: string, notes: string,
  readable: boolean }`. `readable: false` (blank, unreadable, not a document) holds the item with the AI's note.
- Where it sits: the **Read** step. For a picture the Read step is timed and its detail reads
  `Picture: the AI is reading it…` while running, then `Picture read by the AI, 4.2 s, 86 words`. The result becomes
  `type: 'note'`, `text` = transcription, `meta: { readBy: 'ai', notes }`. Screen, Match, Understand and the rest run
  on that text exactly as for a pasted note. A scanned PDF is the same with `meta.pages`.
- Personal data: the screen runs on the transcription. When it holds, the transcription is **not** stored on the item
  (the sidecar keeps only the hold reasons), and the detail says so: "Held: names and ids in the picture. The text was
  not kept." The operator asked for pictures to be read; the AI seeing them before the screen is the cost, and the
  README says so in one line.
- Undo and Run again behave as for any other file. Run again re-reads the picture (the AI looks again). Answering
  "Which idea?" does not: the pick reuses the stored transcription the operator was shown.

### 3.3 Import surface
- The drop well's hint lists "exports, emails, transcripts, Word, PDF and pictures".
- History chips gain `picture`. The card's "What the AI understood" shows the transcription under "What the AI read"
  when `meta.readBy === 'ai'`.

### 3.4 Test kit
- `12-cannot-read.pdf` is replaced by `12-text.pdf`: a one-page text PDF, a short memo on CAFE-2026-004 (Expense
  anomaly finder) with three facts (data source: the expense system export; a capability "Duplicate claim spotting";
  the finance team wants a weekly digest). Expect: read as a document, matched by Café id, facts applied.
- New `14-whiteboard.png`: a generated bitmap (block-letter text, 5×7 font scaled ×4, black on white, about 1200×600)
  reading: `CAFE-2026-002 DESK BOOKING / NEEDS: FIND A FREE DESK, SWAP A BOOKING, RELEASE NO-SHOWS / TOOL: COPILOT
  STUDIO / DATA: FLOOR PLAN SYSTEM`. Expect: Read by the AI, matched to 002, stars and links added confirmed.
- New `15-scanned.pdf`: the same bitmap embedded as an image in a one-page PDF with no text layer. Expect: the
  scanned path, same result as 14.
- The fake provider returns, for LOOK: file name containing `whiteboard` or `scanned` → the whiteboard text above with
  `notes: "A whiteboard photo with a bulleted list"`; anything else → `readable: false`, `notes: "A blank picture"`.
- README rows and the suggested order are updated; acceptance gains rows for 12, 14 and 15 (fake AI); the tour gets a
  shot of a picture card mid-read and done.

## 4. First-run welcome
- When the workspace has no ideas and no pop-out is open, a card sits in the centre of the universe (z above the
  canvas, below pop-outs), class `welcome`, with:
  - heading: **Nothing here but dark matter.**
  - line: *Drop the first submissions export and watch the stars come out. The app sorts them; you drink the coffee.*
  - one button, primary: **Start: import submissions** → opens the Import pop-out.
- It uses the universe palette (teal rim glow, cream heading), fades in over 400 ms, and disappears the moment the
  first idea exists. Lite/Flat quality: no animation.
- The Ideas panel's empty body reads "No ideas yet" and nothing else; the card carries the invitation.

## 5. Removals and renames
- status.csv: the title bar pill, `POST /api/status-export`, `src/exports/status.ts` and its tests are removed. The
  README loses the line about it. (The review pack stays.)
- "Inbox" → "Import" in every user-facing string: the title bar pill (icon kept, badge kept), the pop-out heading,
  step details, hold reasons, notices, the drop well hint, README and test-data README. Code identifiers, routes
  (`/api/inbox/...`), folder names (`inbox/`), data-testids and `data-action="inbox"` stay as they are.

## 6. Constraints carried over
- No real names anywhere in test data or copy; kit names are synthetic.
- Stages never move by code or by a dropped file. AI proposes, code decides.
- Charts and new UI match the universe look; `[data-quality="lite"]` disables animation.
- Node ≥ 20, TypeScript strict, vitest; UI built into `cafe-app/web` and committed; `MANIFEST.txt` refreshed.
- Every commit ends with the Fable co-author and session trailers.

## 7. Rulings made for the operator
1. Rounds are never created automatically; the welcome card and the Rounds pop-out make creating one a one-click act.
   Cost if wrong: one click per round.
2. Ids are `ROUND-NNN`, names are free text; the graph shows the name. Cost: existing `ROUND-2026-Q4` folders in old
   workspaces still load (any `ROUND-*` folder is a round; the sort uses `created`, falling back to the folder name).
3. Pictures are read by the AI before the personal-data screen; a held transcription is not kept. Cost: the AI sees
   the picture once.
4. Non-Claude providers cannot read pictures; the item is held with the reason rather than guessing.
5. The empty-text threshold for a scanned PDF is 40 characters.
