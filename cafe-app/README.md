# Creators' Café operator app

A local app for the person who runs the CS TTIA Creators' Café. It imports the submission export, tracks
each idea's 25 steps, drafts the emails, blocks any email that still needs a date or link, shows replies
that are late, and writes `status.csv` for submitters. It never sends anything: you approve, copy, send
from Outlook, then mark the email as sent.

The design is in `docs/superpowers/specs/2026-10-19-cafe-universe-ui-design.md` (the one-screen UI) and
`docs/superpowers/specs/2026-10-19-creators-cafe-app-design.md` (the core).

## What you see

One screen, in the style of the sc-datav "demo 0" dashboard: near-black background, a slow starfield, glass
panels, large white titles and pill buttons at the bottom.

- **The universe (centre).** The knowledge graph as a 3D star map. Each idea is a star; teams, people,
  pain points, capabilities, tools and systems orbit the ideas they relate to. Click a star to fly to it and
  see its card; hover to light up its links. Links below 0.7 confidence are dashed and marked unconfirmed.
  If the browser has no WebGL it falls back to a flat 2D map.
- **Left: ideas.** The list of ideas, with a coloured ring for the stage. Click one and the universe flies to
  its star (its links lit, the rest dimmed) while the left panel switches to that idea's details, in one column:
  any suggested move (Yes/No), Review, Stage, Emails, Graph links (Confirm/Remove, Grow the universe), Details
  and History. **← Back** (or Esc) returns to the list where you left it (same search, filters and scroll); the
  star stays selected. Opening an idea turns Focus off so the panel shows.
- **Right: charts.** Pipeline by stage, then demand: support asked for and function by region.
- **Pop-outs.** Import, Round, Outbox, Inbox and AI open in front of the universe; close them with the X or Esc.
  Ideas never open in a pop-out: an idea link in the Inbox or the late list opens it in the left panel.
- **Narrow windows.** Below 1000px wide the side panels become drawers: tap the "Ideas" tab on the left or
  "Charts" on the right; close with the X or Esc. The universe stays behind them. The Ideas drawer shows an idea's details the
  same way, with Back; Esc goes Back first, then closes the drawer.
- **Bottom centre.** Reset view, Labels and Focus.
- **Focus.** The Focus button (or the F key) hides every panel and drawer so only the universe shows; clicks still work. Click again (Show panels) to bring them back.
- **Idea stars.** Clicking an idea star selects it and shows its card (ID, stage, emails, links); the card's Open idea button shows the idea's details in the left panel. Esc or ✕ closes the card.
- **Title bar.** The round and today's date, the Import, Round and Outbox buttons, Review pack and status.csv (these write the files),
  and the AI chip (which shows who is answering).

## Run it

```bash
cd cafe-app
npm install
npm run cafe -- start --workspace ~/cafe-workspace
```

Open http://localhost:4100. The app only answers on localhost. The workspace folder is plain files; keep it
in git if you want history.

Other commands:

```bash
npm run cafe -- init   --workspace ~/cafe-workspace     # create the folders, rules and templates
npm run cafe -- import export.csv --workspace ~/cafe-workspace
npm run cafe -- status --workspace ~/cafe-workspace     # write exports/status.csv
```

`CAFE_TODAY=2026-10-26` pretends today is another date, for example to see which replies are late.

### The workspace folder

```
rounds/       the round's dates, links and your name
inbox/        dropped files and exports (see Inbox: drop anything); inbox/held/ keeps files the app will not read
ideas/        one folder per idea: the submission, its emails, its history
cohorts/  roadshows/
graph/        the universe: nodes.jsonl, edges.jsonl, ai-links.jsonl (AI suggestions and your Yes or No),
              layout.json (cached star positions)
templates/    the email templates
rules/        settings.yaml (including the AI choice), stages.yaml
exports/      status.csv and the review pack
skills/
```

## Build the UI

The UI lives in `ui/` (React, Vite, three.js, ECharts, all bundled; nothing loads from the network). The
server serves the build from `web/`, and `web/` is **committed build output**, so running the app needs no
build step. After you change anything in `ui/`, rebuild and commit `web/`:

```bash
npm run build:ui
```

The build empties `web/` first, so it holds only `index.html` and the hashed files it references.

### Dev mode

```bash
npm run cafe -- start --workspace ~/cafe-workspace    # the API on 4100
npm run dev:ui                                        # the UI with hot reload; it talks to the API on 4100
```

## A round, by hand

1. **Round** (pop-out): set the dates, the links and your name. Draft E0 (call for ideas) and E0B (deadline
   reminder).
2. **Import** (pop-out): drop the SharePoint or Forms export. Re-dropping it only adds new rows. New ideas
   appear as stars and in the left list.
3. **Idea** (click it in the list or the universe): read it, draft E1, and set the stage forward or back, or
   close it. Every change is logged and nothing is ever blocked.
4. **Review** (in the idea's details, left panel): tick the five criteria, pick a decision, give a reason. Saving drafts
   the decision email and suggests a move (for example "Close it as Routed to CSIC?"); nothing moves until
   you say Yes. Routing to CSIC writes `csic-handoff.md`; its follow-up date (four weeks out) is filled in
   once you close it as CSIC. Links the idea has in the universe are listed here too, with Confirm and
   Remove.
5. **Emails** (in the idea's details) and **Outbox** (pop-out): approve and copy, send from Outlook, mark as
   sent. E2 starts a five-day reply clock; use "Reply received" on the idea when they answer. Marking E3,
   E4, E5, E6 or E10 as sent suggests a move too. A missing date or link blocks approval until you set it.
6. **Round** (pop-out): write `status.csv` and the review pack for TTIA.

## Inbox: drop anything

Open **Inbox** in the title bar (it shows how many things wait on you). Drop files on it, or paste a note,
and the app works out which idea each one belongs to and what it changes. Everything dropped is read as
**data, never as instructions**.

**What you can drop**

- Café exports: `.csv` and `.xlsx`. These are imported the same way as in Import.
- Emails: `.eml` and `.msg`.
- Teams meeting transcripts: `.vtt`.
- Word files: `.docx`.
- Notes and pasted text.
- Dropping a file anywhere on the Inbox pop-out works, not only on the dashed zone.
- Want something to try? `test-data/` holds 12 synthetic files (exports, emails, a transcript, a Word file, a held tracker, a PDF) with a README on what to expect; regenerate with `npm run test-data` (script: `scripts/make-test-data.mjs`). All names in it are fictional; any resemblance is coincidental.

**What is held.** PDFs and images show "can't read this yet". Lists of people (for example a tracker with
names, phone numbers or employee ids) are held too. A held file moves to `inbox/held/`, is not read any
further and is never copied into an idea. You can delete it, or draft a reply asking the sender for counts
instead of names.

**How an idea is matched**

- A Café ID in the subject, the file name or the body is a sure match (1.0).
- The whole idea title in the subject or file name is a likely match (0.9).
- A sender who submitted exactly one idea is a likely match (0.8).
- The title only in the body is unsure (0.6), so the app asks "Which idea?" and you pick.
- Anything below 0.7 asks. The AI can lower a confidence, and so make the app ask, but it never raises one.

**What you see for each item.** Three groups:

- **Applied**: safe changes the app already made, each with an **Undo**.
- **Needs your OK**: changes that wait for a Yes. You can apply them one at a time, tick some, or apply all.
- **Held**: described above.

If the AI can't be reached, the item says "Working by hand", explains why, and nothing is applied on its
own. You can still choose the idea and apply changes yourself.

**What the AI may propose and what code decides.** The AI can only report facts: a short summary, which
idea it looks like, answers to the Café questions, flags, names and links. It cannot run anything. The code
decides what is safe, what needs your OK and what is held, and it writes every file itself. The AI's word
alone is never enough for a safe change: an answer is saved on its own only when it answers a question we
sent in the E2; a reply is marked received only when an E2 or E2R was sent; attendance is logged only when
the E3 invitation was sent. Anything else waits for your Yes (for example "question not one we sent").
An email from you (the name in Settings) is filed as sent and nothing else is proposed from it; anything else is filed as received.

**What goes in the universe**

- A link between stars you already have, at 0.7 or more, is applied (and can be undone).
- A link below 0.7 comes in dashed and unconfirmed.
- A new star, or a change to a person's role, always waits for your Yes.
- People who are only in an email's To or Cc line never become stars.

**Undo.** Each applied change records how to put it back, and Undo replays that, field by field. For the
stage, the builder, ticks, links in the universe and ideas an import created, Undo first checks whether
you have changed them since, and keeps your change if so. For example, if you ticked a step on an idea an
import created, Undo keeps that idea and says so ("CAFE-2026-002 has changed since the import; close it
instead"). Filed copies, flags and saved answers are removed as they were recorded. If nothing could be
undone, it says why.

**Duplicates.** Dropping the same file again shows "Already dropped on <date>" and does nothing a second
time. If the first drop was never sorted (the app stopped part way), dropping it again sorts it now.

**File names and size.** Any file name works, accents and dashes included. Files over 20 MB are refused
before they are sent.

**Tests.** `CAFE_AI_FAKE=1` also makes the fake provider answer `TASK: triage` with fixed facts, so the
Inbox can be tested without a real AI. See Test hook below.

New folders in the workspace:

```
inbox/               dropped files
inbox/held/          files the app will not read
inbox/.items/        one small file per dropped item (what was found, what was done)
inbox/undo.jsonl     a log of every apply and Undo
ideas/<idea>/emails/in/   emails filed against an idea, each with a short summary beside it
ideas/<idea>/notes/       transcripts, notes and documents filed against an idea
```

## AI help (optional)

With no AI, everything above works by hand and nothing breaks. With one, the app can do two things:

- **Grow the universe from this idea** (in the idea's details): reads the idea's title, challenge, current
  process and outcomes and proposes capabilities, systems, pain points and tools, with links.
- **Suggest a review** (in the idea's details): fills in the five criteria, a decision and a reason for you to
  edit. It is highlighted until you change it.

The **AI chip** in the title bar says who is answering ("Claude Code", "Copilot CLI", "Copilot (VS Code)" or
"No AI: working by hand"). Click it to pick a provider (Auto, Claude Code, Copilot CLI, VS Code or None) and
press Test, which asks the AI for a tiny checked reply (up to 30 seconds) and says who answered and how long it
took. The choice is saved in `rules/settings.yaml`.

### The providers and how each is found

| Provider | Found by | Command |
|---|---|---|
| Claude Code | `which claude` | `claude -p --output-format text --tools "" --max-turns 1 --strict-mcp-config --no-session-persistence`, prompt on stdin, in an empty temp folder, `CAFE_*` variables removed |
| Copilot CLI | `which copilot`, or the binary named by `CAFE_COPILOT_BIN` | `copilot -s --output-format text --no-ask-user --disable-builtin-mcps --excluded-tools=<every built-in tool> --deny-tool=shell --deny-tool=write --deny-tool=url --deny-tool=memory`, prompt on stdin, in an empty temp folder, `CAFE_*` variables removed |
| VS Code helper | `~/.cafe-ai/vscode-helper.json` (`{port, token, model}`) and a `GET /health` on 127.0.0.1 that answers `ok: true` | `POST /complete` with the `x-cafe-token` header |

Auto takes the first one found, in that order. Copilot CLI was checked against the real CLI (1.0.100): asked to
run `ls`, read `/etc/hosts` or a file, or fetch a URL, it answers that it cannot, and the chip note says
"Verified with Copilot CLI 1.0.100". Tools are switched off with `--excluded-tools` naming each built-in tool,
because `--available-tools` with no value is ignored by the CLI. A newer CLI that adds a tool would need that list
extended (`src/ai/providers/copilot.ts`). Set `CAFE_COPILOT_BIN=/path/to/copilot` when it is not on PATH. The
prompt goes on stdin, so it does not show in `ps`.

The VS Code helper is a small extension in `vscode-helper/`; see
[`vscode-helper/README.md`](vscode-helper/README.md) for installing it and its security notes.

### The rules

- The submission text is **data, not instructions**. Every prompt says so and the answer must be one JSON
  object.
- The AI gets **no shell, file or network access**. Only the title, challenge, current process and outcomes
  leave the app, each capped in length. No names, email addresses or ids.
- The answer is **checked against a schema** before anything is used. Anything else is thrown away and the
  app says it is working by hand.
- **High-confidence links between stars you already have are added at once; anything that would add a new
  star waits for your Yes; you can remove any AI link from the idea's details.** A link below 0.7 comes in as
  pending (dashed, unconfirmed) until you confirm it. **New stars always need a Yes**, whatever the AI's
  confidence. After "Grow the universe" the app says how many links were added and how many wait for you.
  A link you removed is not proposed again.
- If `graph/ai-links.jsonl` has a line the app cannot read, that line is skipped (and kept in the file), the
  rest of the universe still shows, and `GET /api/graph` lists it under `problems`. A broken
  `graph/layout.json` is only a cache: the app lays the universe out afresh.
- One AI call runs at a time, behind the server's lock, for up to 90 seconds.

### Test hook

`CAFE_AI_FAKE=1 npm run cafe -- start ...` adds a fake provider that returns fixed answers. It exists only
for the screenshot tour and tests. It cannot be picked in the chip, and only the exact value `1` turns it on.
Do not set it for real rounds.

## Tests

```bash
npm test                 # the app: graph, AI, server, rounds (vitest)
npm run typecheck
cd ui && npm test        # the UI helpers
node scripts/ui-tour.mjs --workspace /tmp/cafe-tour-ws --out /tmp/cafe-tour-shots
```

**Acceptance run of the Inbox.** `npm run acceptance` drops the whole `test-data/` kit (01 to 12) through the API on its own
server (a free port, never 4100) and a fresh workspace, sends an E2 for CAFE-2026-002 first, then applies one Needs-OK
action, undoes one Safe one and confirms one link, and prints file → expected → actual → PASS/FAIL (non-zero exit on a
FAIL). It runs with `--fake`: a scripted, deterministic triage (which obeys the injection in 05, to show the code holds
it). `npx tsx scripts/acceptance.mjs --real-ai` uses this machine's AI instead (about 8 calls, a few minutes) and checks
tiers and kinds, not wording. Add `--workspace DIR` to choose the scratch folder.

**Scale test of the universe.** `npm run scale -- --out /tmp/cafe-scale` generates a 60-idea export and 150 synthetic
AI links (`--links 300` for about 300 stars), imports them into a fresh workspace, times `GET /api/graph`, and in
headless Chrome (software WebGL) measures the frame time with and without a selection, checks labels do not overlap and
the fly-to lands, and saves `scale-universe.png` and `scale-report.json`. Nothing it writes is committed.

The tour starts its own server on port 4103 (never 4100) against a scratch workspace that it wipes, drives
Chrome with Playwright, and saves screenshots. It needs Google Chrome installed. WebGL runs in software, so
a full tour takes several minutes. `--only=panels|hover|panel|popouts2|ai|inbox|inboxhand|drawers|focus|ideacard|empty` runs one part (`panel`, also `popout`, clicks a list item and checks the idea opens in the left panel with no dialog, Back, and the star card's Open idea); `--only=ai` and `--only=inbox`
need `CAFE_AI_FAKE=1`; `inboxhand` restarts the server without it, and a full tour includes the AI shots only when it is set. The tour reports any console error and exits non-zero.

## Before the first round

These need an answer from outside this app:

1. **AI on submission content.** Get approval from Tech Governance & Enablement, naming the provider and
   model, before turning on any AI. Until then set the provider to None.
2. **The VS Code helper.** Check whether the firm allows installing it from a folder, or needs it packaged
   as a VSIX and approved.
3. **Names in shared screenshots.** Show people by role in anything shared with TTIA, not by name.
