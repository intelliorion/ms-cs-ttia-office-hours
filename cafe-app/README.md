# Creators' Café operator app

A local app for the person who runs the CS TTIA Creators' Café. It imports the submission export, tracks
each idea's 25 steps, drafts the emails, blocks any email that still needs a date or link, shows replies
that are late, and writes the review pack for TTIA. It never sends anything: you approve, copy, send
from Outlook, then mark the email as sent.

The design is in `docs/superpowers/specs/2026-10-19-cafe-universe-ui-design.md` (the one-screen UI) and
`docs/superpowers/specs/2026-10-19-creators-cafe-app-design.md` (the core).

## What you see

One screen, in the style of the sc-datav "demo 0" dashboard: near-black background, a slow starfield, glass
panels, large white titles and pill buttons at the bottom.

- **The universe (centre).** The knowledge graph as a 3D star map. Each idea is a star; teams, people,
  pain points, capabilities, tools and systems orbit the ideas they relate to. Click a star to fly to it and
  see its card; hover to light up its links. A dashed link is one the AI found that waits on you (see the graph rule
  below); every other link is solid.
  If the browser has no WebGL it falls back to a flat 2D map.
- **Left: ideas.** The list of ideas, with a coloured ring for the stage. Click one and the universe flies to
  its star (its links lit, the rest dimmed) while the left panel switches to that idea's details, in one column:
  any suggested move (Yes/No), Review, Stage, Emails, Graph links (Remove, Grow the universe; **Add it anyway** only on
  a link a conflict rule held), Details
  and History. **← Back** (or Esc) returns to the list where you left it (same search, filters and scroll); the
  star stays selected. Opening an idea turns Focus off so the panel shows.
- **Right: charts.** Pipeline by stage, then demand: support asked for and function by region.
- **Pop-outs.** Import, Round, Outbox, Inbox and AI open in front of the universe; close them with the X or Esc.
  Ideas never open in a pop-out: an idea link in the Inbox or the late list opens it in the left panel.
- **Narrow windows.** Below 1000px wide the side panels become drawers: tap the "Ideas" tab on the left or
  "Charts" on the right; close with the X or Esc. The universe stays behind them. The Ideas drawer shows an idea's details the
  same way, with Back; Esc goes Back first, then closes the drawer.
- **Bottom centre.** Reset view, Labels, Focus and Quality.
- **Focus.** The Focus button (or the F key) hides every panel and drawer so only the universe shows; clicks still work. Click again (Show panels) to bring them back.
- **Quality.** The Quality button cycles Full → Lite → Flat. **Full** is the whole look (bloom, antialiasing,
  sharp on high-DPI screens). **Lite** drops the bloom pass and antialiasing, draws at 1× pixel density, uses a sixth of
  the background stars, draws the quiet links in a few batches, moves labels in whole pixels, and drops the blur behind
  the glass panels; soft coloured halos (larger and pulsing on the selected star) and a glow on the selection's links
  keep it glowing. **Flat** is the 2D map (also used automatically when the browser has no WebGL). On the first load a
  browser with software graphics (SwiftShader, llvmpipe and the like, as on many virtual desktops) starts in Lite and
  says so; in Full, if the first few seconds draw under 20 fps it switches to Lite once and says so. The choice is
  remembered per browser, and once you pick a level with the button nothing switches it for you again.
- **Idea stars.** Clicking an idea star selects it and shows its card (ID, stage, emails, links); the card's Open idea button shows the idea's details in the left panel. Esc or ✕ closes the card.
- **Title bar.** The round and today's date, the Import, Round and Outbox buttons, Review pack (this writes the file),
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
```

`CAFE_TODAY=2026-10-26` pretends today is another date, for example to see which replies are late.

### The workspace folder

```
rounds/       one folder per round you make (ROUND-001, ...): its name and dates; the review pack
inbox/        dropped files and exports (see Inbox: drop anything); inbox/held/ keeps files the app will not read
ideas/        one folder per idea: the submission, its emails, its history
cohorts/  roadshows/
graph/        the universe: nodes.jsonl, edges.jsonl, ai-links.jsonl (AI suggestions and your Yes or No),
              layout.json (cached star positions)
templates/    the email templates
rules/        settings.yaml (including the AI choice), stages.yaml
exports/      files the app writes for you
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
   once you close it as CSIC. Links the idea has in the universe are listed here too: any AI link can be
   removed, and a link a conflict rule held says "Waiting on you" with **Add it anyway**.
5. **Emails** (in the idea's details) and **Outbox** (pop-out): approve and copy, send from Outlook, mark as
   sent. E2 starts a five-day reply clock; use "Reply received" on the idea when they answer. Marking E3,
   E4, E5, E6 or E10 as sent suggests a move too. A missing date or link blocks approval until you set it.
6. **Review pack** (title bar): write the review pack for TTIA, grouped by round.

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
- Want something to try? `test-data/` holds synthetic files (exports, emails, a transcript, a Word file, a held tracker, a PDF, and a reply that clashes with what the app holds) with a README on what to expect; run `npm run test-data` first (the files are generated, not committed) (script: `scripts/make-test-data.mjs`). All names in it are fictional; any resemblance is coincidental.

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

**What happens to each file: eight steps.** Every drop runs the same eight steps, and the Inbox shows them as
dots on the file's card while it runs (a pulsing dot is the step in progress). Each step is recorded with what it
found, so you can look back later.

| Step | What it does |
|---|---|
| Receive | Stores the file. The same file twice is noticed here and nothing else runs. |
| Read | Reads the text out of the email, transcript, Word file, note or export. |
| Screen | Checks for lists of people and files it can't read. A hit stops here and the file is held. |
| Match | Works out which idea it belongs to (see above). If it can't tell, it asks "Which idea?". |
| Understand | Asks the AI what the file says: answers, a builder, attendance, flags, stars and links. Exports skip it. |
| Update context | Files it against the idea and saves what is safe: answers, reply received, attendance, flags. |
| Build the graph | Adds the AI's stars and links to the universe. |
| Check | Done, or says how many things wait on you and why. |

Each dot is lit when done, a dashed ring when skipped (for example an export skips Understand), an empty ring when
not reached yet, amber when it needs you, and red when it failed. A failed step stops the run, says "do it by hand", and nothing is half-applied; **Run again**
on the card repeats steps 4 to 8, and what was already applied stays applied and is not done twice.

**The graph rule.** What the AI finds goes into the universe at once, confirmed, new stars included; there is no
Confirm step. The only links that wait are the ones a conflict rule below holds. You can remove any AI link later
from the idea's details. A held link from **Grow the universe** shows dashed, with "Waiting on you" and **Add it
anyway**; a held link from the Inbox waits on the file's card instead.

**What waits for you: the conflict rules.** Code, not the AI, decides. Only the item that clashes waits; the rest
of the same file is applied.

| Rule | When it holds something | Your choices |
|---|---|---|
| Contradiction | The file names a different builder from the one the idea has, or points the idea at an earlier stage or at closing it | Keep the form's value / Take the file's value |
| Looks the same | A new star looks like one already in the universe ("Slot findings" next to "Slot finding") | Use the existing star / Keep both / No |
| A person | A new star is a person. People come from the form only, never from text | Yes / No |
| Not sure | The AI was less than 50% sure of a link | Yes / No |
| Two ideas | The file could belong to two ideas and the AI picked a different one from the match | Yes / No |
| Duplicate idea | A new idea has the same title as one you have | Yes / No |
| Screened | The screen flagged something but still let the file through | Yes / No |

**Needs you.** A held item shows under **Needs you** on the file's card, with the rule, the reason in one line, the
star it looks like (when there is one) and the choices above. Saying no keeps a note on the file ("Dropped by you")
and changes nothing. Some changes are never held but still wait for an OK on their own, such as a builder named for
the first time or an answer to a question we didn't send; they sit under **Needs your OK** with **Apply**. What
was applied sits under **Applied**, each with **Undo**.

**History.** Below the cards in flight, the Inbox keeps every file it has seen, newest first, grouped by day.
The chips filter it: **All**, **Needs you**, **Held**, **Done**, **Failed**, **Dismissed**, and the search box finds
a file by its name, its idea's ID or the idea's title. Click a row to open its card again.

If the AI can't be reached, the item says "Working by hand", explains why, and nothing is applied on its
own. You can still choose the idea and apply changes yourself.

**What the AI may propose and what code decides.** The AI can only report facts: what the file is, what it
understood and what it is not sure about, which idea it looks like, answers to the Café questions, flags, names
and links. It cannot run anything. The code decides what is safe, what needs your OK and what is held, and it
writes every file itself. The AI's word alone is never enough for a safe change: an answer is saved on its own
only when it answers a question we sent in the E2; a reply is marked received only when an E2 or E2R was sent;
attendance is logged only when the E3 invitation was sent. Anything else waits for your Yes (for example
"question not one we sent"). An email from you (the name in Settings) is filed as sent and nothing else is
proposed from it; anything else is filed as received. People who are only in an email's To or Cc line never
become stars.

**Undo.** Each applied change records how to put it back, and Undo replays that, field by field. For the
stage, the builder, ticks, links in the universe and ideas an import created, Undo first checks whether
you have changed them since, and keeps your change if so. For example, if you ticked a step on an idea an
import created, Undo keeps that idea and says so ("CAFE-2026-002 has changed since the import; close it
instead"). Filed copies, flags and saved answers are removed as they were recorded. If nothing could be
undone, it says why.

**Duplicates.** Dropping the same file again records one step, Receive ("Same file as …"), and does nothing a
second time. If the first drop was never sorted (the app stopped part way), dropping it again sorts it now.

**File names and size.** Any file name works, accents and dashes included. Files over 20 MB are refused
before they are sent.

**Tests.** `CAFE_AI_FAKE=1` also makes the fake provider answer `TASK: understand` with fixed facts (a reply, a
transcript, or, for text that mentions "a second builder", a reply that clashes), so the Inbox can be tested without
a real AI. See Test hook below.

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
- **What the AI finds is added at once, confirmed, new stars included; only a link a conflict rule holds waits
  for you; you can remove any AI link from the idea's details.** The rules are in the Inbox section above (a star
  that looks like one you have, a person, a link the AI was less than 50% sure of). A held link shows dashed with
  "Waiting on you" and **Add it anyway**. After "Grow the universe" the app says how many links were added and how
  many wait for you. A link you removed is not proposed again.
- If `graph/ai-links.jsonl` has a line the app cannot read, that line is skipped (and kept in the file), the
  rest of the universe still shows, and `GET /api/graph` lists it under `problems`. A broken
  `graph/layout.json` is only a cache: the app lays the universe out afresh.
- One AI call runs at a time, behind the server's lock, for up to 90 seconds.

### Test hook

`CAFE_AI_FAKE=1 npm run cafe -- start ...` adds a fake provider that returns fixed answers. It exists only
for the screenshot tour and tests. It cannot be picked in the chip, and only the exact value `1` turns it on.
Do not set it for real rounds. `CAFE_AI_FAKE_DELAY=<ms>` (with the fake only) makes every fake answer wait that long
first, so the tour can catch a step while it runs.

## What the idea panel shows, by stage

In the idea head, **Only related** draws just that idea and what it links to (one hop) and nothing else; **Show all** or Back brings the whole universe back. Stars keep their positions.

Each action section has a home stage. Before it, the section is hidden; at it, the full form; after it (or once the idea is closed) a compact read-only card with an Edit link. Anything already saved is never hidden.

| Stage | Editable | Cards |
|---|---|---|
| 1 Submit Idea | nothing yet: send E1 from Emails | |
| 2 Review and Select | Decision (the choice first, the five checks fold away under it) | |
| 3 Design series | Tool picker, then Design, then Plan and kits | Decision |
| 4 Launch and Learn | nothing new | Decision, Tools, Design, Plan |

## Design series: tool picker, brainstorm, plan and kits

An idea's details (the left panel) carry three more sections, after Review and before Stage. They are meant
for an idea in Café Work. They take the idea from "which tool for which part" to a plan a builder can start from. The AI suggests;
nothing is saved until you press a button, and you can do everything except plan.md by hand.

**What you see**

1. **Tool picker.** One row per feature: a name, one line on what it does, and a tool from the approved list
   (Microsoft Copilot, Copilot Studio, Power Apps, Dataiku, UiPath or custom app). **Suggest with AI** asks for
   the one tool for the proof of concept: it comes back as one suggested row with a "Why this tool" list (the facts from
   the form it relied on and the rule that led to the tool), and the tool drop-down stays yours to change. When the form
   says too little, the AI returns every question it needs instead, all of them in one E2 draft in the Outbox; the panel
   lists them and Suggest waits until the reply is marked received (or you forget the questions). **Add feature** adds an
   empty row. Each row shows
   its pathway: custom app is TTIA-Led, Microsoft Copilot is Citizen-Led with no build, and any other tool is
   Citizen-Led with a named builder or Assisted Citizen without one. **Save** writes the picks and links each
   feature to its tool in the universe. A tool that is not on the approved list is refused.
2. **Design.** A short brainstorm, one question at a time: what the proof of concept must show, the smallest
   input it needs, who builds it, and so on. Each question comes with a reason and suggested answers. Pick
   one, type your own, or press **I don't know → ask the team**: the question goes into the idea's E2 draft
   in the Outbox, and when the team's reply comes in through the Inbox, it fills the answer. The live
   design.md sits under the questions and ends with the **Café check**: value words, data flags and CSIC
   flags, each "Clean" or listed.
3. **Approve design.** Once the design is finished, approve it. If the Café check has a CSIC flag (for
   example a custom app), the notice says so and the app offers "Close it as Routed to CSIC?" as a Yes/No.
   It never closes the idea on its own. Changing the picks or the design afterwards un-approves it, and it
   needs approving again.
4. **Plan and kits.** **Write the plan and kits** writes plan.md (tasks grouped by tool, risks, the same
   Café check) and a starter kit for each picked tool. For a custom app, **Copy build instruction** copies a
   ready-made instruction for Claude Code or GitHub Copilot. Running it again rewrites only the files the app
   made and keeps any you added.

**The files it writes** (under `ideas/<id>/`):

```
approach.md            the features and the tool picked for each, with its pathway
design.yaml            the design's state: features, questions and answers, summary, approval date
design.md              the design, readable, ending with the Café check
plan.md                the plan: the one thing to show, tasks by tool, risks, the Café check
kit/<tool>/...         a starter kit per picked tool, all Markdown: topics, screens, a flow, a process,
                       prompts, or for a custom app README.md and BUILD-WITH-AGENT.md
```

A plan task whose tool no feature picked is listed under "Not picked" in plan.md, with no kit. If the plan's
own words mention value (ROI, savings, costs and so on), plan.md lists them under the Café check as "Value
words in the plan".

**With no AI.** Add the features and pick their tools by hand, write questions and their suggested answers
by hand (**Add a question by hand**), answer them, then **Finish by hand** with a short summary, and
approve. plan.md and the kits need an AI.

**The embedded skills.** `skills/` holds the "brainstorming" and "writing-plans" skills from the Superpowers
project, copied under the MIT licence (`skills/LICENSE-superpowers.md`). The app only sends them as guidance
text inside the brainstorm and plan prompts. It never executes them.

**The rules**

- No value is measured in the Café: no ROI, savings, costs or KPIs. The Café check flags them; a proof of
  concept shows one thing works, on synthetic, aggregated or sample data.
- A custom app is TTIA-Led, so an idea with one needs the CSIC Repository before any build beyond a proof
  of concept. The same goes for a live connection to a non-Microsoft system or personal, client or
  third-party data.
- The app writes no application code. The kits are outlines, checklists and, for a custom app, an
  instruction for a coding agent that works only inside the kit folder.
- The stage never moves on its own. Saving the picks, answering the must-show and smallest-input questions
  and approving the design tick their steps in the background (s3e, s3c, s3d, s3f).

## Tests

```bash
npm test                 # the app: graph, AI, server, rounds (vitest)
npm run typecheck
cd ui && npm test        # the UI helpers
node scripts/ui-tour.mjs --workspace /tmp/cafe-tour-ws --out /tmp/cafe-tour-shots
```

**Acceptance run of the Inbox.** `npm run acceptance` drops the whole `test-data/` kit (01 to 12) through the API on its own
server (a free port, never 4100) and a fresh workspace, sends an E2 for CAFE-2026-002 first, then applies one Needs-OK
action, undoes one Safe one and checks that no AI link waits in the universe, and prints file → expected → actual → PASS/FAIL (non-zero exit on a
FAIL). It runs with `--fake`: a scripted, deterministic triage (which obeys the injection in 05, to show the code holds
it). `npx tsx scripts/acceptance.mjs --real-ai` uses this machine's AI instead (about 8 calls, a few minutes) and checks
tiers and kinds, not wording. Add `--workspace DIR` to choose the scratch folder. With `--fake` it then runs a design
pass on CAFE-2026-005: suggest and save the tool picks (approach.md, the links in the universe), three brainstorm
questions with the second answered "I don't know" (an E2 draft with that question), finish and approve (s3f ticked, the
CSIC suggestion for the custom app), and write the plan (plan.md and the custom app kit). Last, an agentic pass on a second
fresh workspace (`<workspace>-agentic`): 02 runs all eight steps to "Done" with its AI links confirmed; 13 (the
conflicting reply) holds the second builder and the "Slot findings" star (a "Slot finding" star is seeded first) and is
then settled; 08 builds one pain-point star; 07 is only filed; 11 stops at the screen; and 02 dropped again records
only Receive.

**Scale test of the universe.** `npm run scale -- --out /tmp/cafe-scale` generates a 60-idea export and 150 synthetic
AI links (`--links 300` for about 300 stars), imports them into a fresh workspace, times `GET /api/graph`, and in
headless Chrome (software WebGL) measures the frame time with and without a selection, checks labels do not overlap and
the fly-to lands, and saves `scale-universe.png` and `scale-report.json`. Nothing it writes is committed.

The tour starts its own server on port 4103 (never 4100) against a scratch workspace that it wipes, drives
Chrome with Playwright, and saves screenshots. It needs Google Chrome installed. WebGL runs in software, so
a full tour takes several minutes. `--only=panels|hover|panel|popouts2|ai|inbox|inboxhand|agentic|drawers|focus|ideacard|empty` runs one part (`panel`, also `popout`, clicks a list item and checks the idea opens in the left panel with no dialog, Back, and the star card's Open idea); `--only=ai`, `--only=inbox` and `--only=agentic`
need `CAFE_AI_FAKE=1` (`agentic` also needs `npm run test-data`: it drops 02 and 13 from the kit with the fake slowed to
2.5 s, and saves 60 to 64: the drop well, a card running, Needs you, the history, and the idea's links); `inboxhand` restarts the server without it, and a full tour includes the AI shots only when it is set. The tour reports any console error and exits non-zero.

## Before the first round

These need an answer from outside this app:

1. **AI on submission content.** Get approval from Tech Governance & Enablement, naming the provider and
   model, before turning on any AI. Until then set the provider to None.
2. **The VS Code helper.** Check whether the firm allows installing it from a folder, or needs it packaged
   as a VSIX and approved.
3. **Names in shared screenshots.** Show people by role in anything shared with TTIA, not by name.
