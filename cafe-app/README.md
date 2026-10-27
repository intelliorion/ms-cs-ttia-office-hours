# Creators' Café operator app

A local app for the person who runs the CS TTIA Creators' Café. It imports the submission export, tracks
each idea's 25 steps, drafts the emails, blocks any email that still needs a date or link, shows replies
that are late. It never sends anything: each email opens in Outlook
as a new message for you to check and send.

The design is in `docs/superpowers/specs/2026-10-19-cafe-universe-ui-design.md` (the one-screen UI) and
`docs/superpowers/specs/2026-10-19-creators-cafe-app-design.md` (the core).

## What you see

One screen, in the style of the sc-datav "demo 0" dashboard: near-black background, a slow starfield, glass
panels, large white titles and pill buttons at the bottom.

- **The universe (centre).** The knowledge graph as a 3D star map. Each idea is a star; teams, people,
  pain points, capabilities, tools and systems orbit the ideas they relate to. Click a star to fly to it and
  see its card; hover to light up its links. A dashed amber link is one the AI found that waits on you (see the graph
  rule below); a dashed violet link is one the rules derived (see Knowledge graph below); every other link is solid.
  A person's role on an idea has its own thread: **lead** gold and thicker, **builder** blue, **sponsor** rose,
  **member** dotted (each theme has its own shades; still in every quality, nothing animates). The **Show** menu at the
  bottom has the legend.
  If the browser has no WebGL it falls back to a flat 2D map.
- **Left: ideas.** The list of ideas, with a coloured ring for the stage. Click one and the universe flies to
  its star (its links lit, the rest dimmed) while the left panel switches to that idea's details, in one column:
  any suggested move (Yes/No), Review, Stage, Emails, Graph links (Remove, Grow the universe; **Add it anyway** only on
  a link a conflict rule held), Details
  and History. **← Back** (or Esc) returns to the list where you left it (same search, filters and scroll); the
  star stays selected. Opening an idea turns Focus off so the panel shows.
- **Right: charts.** Pipeline by stage, then demand: support asked for, function by region, and, once the rules have
  derived anything, the systems ideas depend on and the tools in use.
- **Pop-outs.** Import, Rounds, Project configuration and AI open in front of the universe; close them with the X or Esc.
  (Import with a report opens from a link inside the Import.) Ideas never open in a pop-out: an idea link in the
  Import or the late list opens it in the left panel.
- **First run.** With no ideas yet, a card in the middle of the universe says "Nothing here but dark matter." and
  its one button, **Start: import submissions**, opens the Import. It goes away as soon as the first idea exists.
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
- **Title bar.** The newest round's name and today's date, the AI assistant, **Deep read** (a small ring and a percentage: how
  much of what people wrote the assistant has read; see Deep read below), the Import button (with how many things wait on you),
  Rounds, and ⚙ Settings: the AI connector (a dot shows whether an
  AI is answering), Project configuration (your email signature, several lines, the first being your name; the form, CSIC and Teams links, the
  distribution list; kept in rules/settings.yaml; it also shows where the data folder is, with
  **Open data folder** to show it in Finder or File Explorer) and the theme: Default (the night sky), Frost (a
  light winter morning: the stars become glossy baubles with gold caps on silver threads, with snow falling) or
  Blueprint (a drafting table: wireframe stars and drafted circles on blue, white pencil links, chalk-yellow highlights).
  The theme is remembered in this browser only.

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

The setup sits at the top; everything the Café makes or is given sits in `data/`, which you can delete
(all of it, or any part) at any time, even while the app runs: the Café simply starts again empty.
README.txt in the workspace says the same.

```
data/                 the Café's data: safe to delete
  rounds/             one folder per round you make (ROUND-001, ...): its name and dates
  inbox/              dropped files and exports (see Import: drop anything); inbox/held/ keeps files the app will not read
  ideas/              one folder per idea: the submission, its emails, its history, the design files and the
                      roadshow (roadshow.yaml, and roadshow/ with the deck, the script and the photos)
  cohorts/  roadshows/
  graph/              the universe: ai-links.jsonl (AI suggestions and your Yes or No), operator.jsonl (your
                      changes from the assistant: links, renames, merges, aliases), ai-reads.json (when the AI last
                      read each idea), layout.json (cached star positions); nodes.jsonl and edges.jsonl are what the
                      last build held (derived links flagged), rewritten on every read
  chat/               the assistant's conversations
  exports/            files the app writes for you, the JSON-LD exports of the graph among them
  memory/             Deep read's index (index.jsonl, state.json, labels.jsonl): rebuilt by a Run, safe to delete
rules/                your configuration: settings.yaml (your name, links, the AI choice), stages.yaml, and the
                      knowledge graph's entities.yaml (stable names and aliases), inference.yaml (the rules) and
                      ontology.yaml (what each kind of star and each link means). Keep it.
templates/            the email templates. Keep them; a missing one is copied back at the next start.
```

An older workspace that kept rounds/, inbox/, ideas/ and the rest at the top has them moved into data/ the
first time this version starts (the console says what moved). Stored references are relative to data/, so
nothing else changes. A folder found in both places is left alone and named, never merged.

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

## Rounds

A round is something you make, when you want it: nothing makes one for you, and you never need to run anything
first. Open **Rounds** in the title bar, give the new round a name (it offers the quarter, for example `2026 Q4`) and
press **Create**. You can have as many rounds as you like; ids run `ROUND-001`, `ROUND-002`, and so on.

- **Its ideas.** Imported ideas start in no round. Tick them under **Unassigned ideas**, pick a round and press
  **Put N ideas in …**; **Take out** sends one back. The idea head has a round chip too (the round's name, or
  "No round") to move one idea at a time. Each change is logged on the idea.
- **Its dates.** Each round keeps its own dates (opens, deadline, decisions by, design series, roadshow). An email
  for an idea in no round still drafts, with the dates left blank and the note "Put this idea in a round to fill the
  dates".
- **In the universe.** Every round is a cream star with its name, and each of its ideas links to it (`IN_ROUND`),
  so you can see which ideas are in which round. A round with no ideas yet is a star on its own. Click a round's
  star and switch **Only related** on to see just its ideas. The AI never adds or moves rounds.

## A round, by hand

1. **Rounds** (pop-out): create the round, set its dates, the links and your name. Draft E0 (call for ideas) and E0B
   (deadline reminder).
2. **Import** (pop-out): drop the SharePoint or Forms export. Re-dropping it only adds new rows. New ideas
   appear as stars and in the left list; put them in the round from **Rounds**.
3. **Idea** (click it in the list or the universe): read it, draft E1, and set the stage forward or back, or
   close it. Every change is logged and nothing is ever blocked. A move picked while the AI works (the plan and
   kits, a design question) waits for it, since the app makes one change at a time: the panel says so at once
   ("Moving it to Launch and Learn as soon as the AI finishes writing the plan and kits"), then "Moved to Launch and Learn."
4. **Review** (in the idea's details, left panel): pick a decision and save it. Saving sends and drafts no email
   (the decision's email, E3 to E6, waits in the idea's ✉ Emails menu for when you want to send it) and suggests a move (for example "Close it as Routed to CSIC?"); nothing moves until
   you say Yes. Routing to CSIC writes `csic-handoff.md`; its follow-up date (four weeks out) is filled in
   once you close it as CSIC. Links the idea has in the universe are listed here too: any AI link can be
   removed, and a link a conflict rule held says "Waiting on you" with **Add it anyway**.
5. **Emails.** There is no Outbox. Every email opens straight in Outlook as a new message (the app writes an unsent .eml under
   data/exports/outlook and opens it in Outlook; nothing is downloaded) and
   counts as sent, with Undo: from the stage's own button (Draft email, the questions), from the idea's
   **✉ Emails** menu (this stage's emails, the saved decision's email, plus anything drafted and not sent yet), and for a round's call for
   ideas and deadline reminder, from that round in Rounds. An idea keeps at most one unsent email per stage: a
   newer one (another decision, say) replaces it. E2 starts a five-day reply clock. Sending E3, E4, E5, E6 or
   E10 suggests a move too. A missing date or link stops the email opening until you set it (Project
   configuration, or the round's dates in Rounds); it then waits under ✉ Emails.

## Café assistant: ask, or tell the Café what to do

Click the box at the top of the screen (left of **Import**) or press **Ctrl+K** (⌘K on a Mac): the assistant opens
docked on the right, in place of the side panels, so the universe stays in view. Type in plain words and press Enter
(Shift+Enter for a new line). Unlike a dropped file, a message **is** an instruction.

**It works in steps, over the knowledge graph.** For each message the agent decides what to do next: search the graph,
or read an idea's text; it sees what came back and decides again (up to 5 steps), then answers, proposes changes, or
asks what you meant. Each step shows live as it happens ("Looking up who leads Procurement FAQ bot · 1 found"); **Stop**
ends a message after the step it is on. If a search finds nothing it tries another way before saying the graph does not
hold it, and a request like "find duplicate capabilities and merge them" is a search first, then merges for what it found.

**A conversation keeps its context.** "Who leads them?", "and which of those are in BSI?" and "do the same for GSS" work:
the agent gets the conversation so far, a star keeps the same code all through it, and a follow-up can start from what
the last answer found, computed on the graph. **New chat** starts fresh; **⋯** lists earlier chats to reopen with their
context. A change left waiting in another chat is cancelled, with a note, when a new chat starts.

**In the box:** **@** picks a star (narrow it with `@idea:`, `@person:`, `@team:` and so on); **/** offers shortcuts
(`/new`, `/grow` for the idea on screen, `/undo` for the last change in this chat, `/import`, `/rounds`); **↑** brings back
your last message. "This" and "it" mean the idea open on the left, or the star you clicked; the **About:** chip shows
which, and its ✕ asks in general instead.

**In a reply:** star names are chips (hover one to light it, click to fly to it); an answer lights the stars it rests on,
with **How I found it in the graph**, and offers up to three follow-ups you can send with a click. **The universe waits
for the answer:** while the AI works, the camera, the star you picked, what is lit and the Show filter stay exactly as you
left them; when the answer is in, its stars light and the view glides once to frame them. An answer with nothing from
the graph, a change waiting for Do it, an error or Stop leave the universe as it was. A change shows one
card per action, each with **Do it** and **Cancel**. **Nothing changes until you press Do it**, and every done action has
**Undo** (a team or round that changed since is kept, and the card says so). **A done change shows in the universe at
once:** the graph is fetched again, then the stars and threads it touched pulse for about two seconds, as a selection's
do, without changing what you have selected or moving the camera, and one line says what it was ("Updated: Alex Wang →
Lead on Procurement FAQ bot"). The server works out what changed by comparing the graph before and after (a role swapped
between two stars already linked is a new thread, since the relation is part of a link's identity), so there is never a
change you cannot see. Undo does the same ("Undone: …").

**Changes and questions.** The panel says how the agent read each message: a change, a question, or not sure. **A question is answered by the knowledge graph, not
from the AI's memory.** The AI turns it into a query from a fixed set of steps (find stars by kind or name, follow
links, filter ideas by stage, function, region or round, go from ideas to their submitter, lead, sponsor or members
and back, keep what a second search also found, the shortest chain between two stars, rank by number of links, count
by stage, function, region, round or kind). The app runs the query on the graph and the idea records, the AI words the
answer from those results only (people still by code), and the stars the query found light up with the links between
them. **How I found it in the graph** under the answer lists each step and how many stars it kept. Examples: "which
ideas use data from systems named like expense?", "which capability is needed by the most ideas?", "who leads the
travel policy assistant?", "how is Zainab Okafor connected to the travel policy assistant?", "highlight what is
related to GSS". When the graph doesn't hold the answer, it says so and lights nothing. A chip in the bar ("7 stars
lit ✕") keeps the highlight after the panel closes. **A question never changes anything.** Idea text (the challenge,
email answers) is not in the graph, so questions about it can't be answered yet.

What a change can do:

- Link or unlink two stars: "link Avery Chen to BSI" (a person to a team), "remove the link between X and Y".
- Set a person's role on an idea: "make Avery Chen sponsor of the procurement FAQ bot" (this changes the idea's team).
- Put ideas in a round, or create one: "put the travel and procurement bots in a new round called 2026 Q4".
- Rename a star, or merge a duplicate into another: "merge Policy Q&A into Natural-language policy Q&A".
- Create a star, always with its link: "add a capability Contract clause finding to the vendor contract summariser".
  Pain points, capabilities, systems and support requests can be created; a system links to a capability.
- Remove a star with all its links: "remove the star Shared mailbox" (the card says how many links go with it).
  The same four kinds; people, ideas, teams, rounds and tools come from elsewhere, and the agent says where.
- Give a star another name: "alias travel policy as Travel & Expense policy" (see Knowledge graph: the registry).
- Export the graph as JSON-LD: "export graph", or "export graph for the travel policy assistant" for one idea's corner
  of it; the card says where the file went (data/exports/).

The AI proposes; the app checks every action against the universe before it shows a card, and explains anything it
left out. Stages still move only by your hand (the agent points you to the stage button), tools are still picked in
the tool picker, and who submitted an idea stays as the form says. **Before the AI sees a command, every name the app
knows (people, teams, ideas, rounds, stars) is swapped for a code such as [P1]**, so a person's name never leaves your
machine; a name the app has never seen is sent as typed. Links you make are kept in `graph/operator.jsonl` and drawn
over what the form and the AI drew. The agent keeps no conversation, so the panel shows only the command you are
working on: a new command replaces it, and anything the last one left waiting is cancelled with a note. Every command
is still recorded in `chat/log.jsonl`.

## Import: drop anything

Open **Import** in the title bar (it shows how many things wait on you). Drop files on it,
and the app works out which idea each one belongs to and what it changes. Everything dropped is read as
**data, never as instructions**.

**What you can drop**

- Café exports: `.csv` and `.xlsx`. These are imported the same way as in Import with a report.
- Emails: `.eml` and `.msg`.
- Teams meeting transcripts: `.vtt`.
- Word files: `.docx`.
- PDFs: `.pdf`, with text or scanned, up to 10 MB.
- Pictures: `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp`, up to 10 MB (a whiteboard photo, a screenshot, a scan).
- Notes as text files (`.txt`, `.md`). To tell the Café what to do, use the Café assistant instead (above).
- Dropping a file anywhere on the Import pop-out works, not only on the dashed zone.
- Want something to try? `test-data/` holds synthetic files (exports, emails, a transcript, a Word file, a held tracker, a text PDF, a whiteboard picture, a scanned PDF, and a reply that clashes with what the app holds) with a README on what to expect; run `npm run test-data` first (the files are generated, not committed) (script: `scripts/make-test-data.mjs`). All names in it are fictional; any resemblance is coincidental.

**PDFs and pictures.** A PDF with text is read by the app itself, page by page, like a Word file (the Read step says
"PDF, 3 pages, 1,240 words"). A picture, or a scanned PDF with no text in it, is read by the AI: the app copies the
file alone into an empty temp folder and asks Claude Code to open it with its Read tool (that one file only), write
out all the text in it line by line, and say in two sentences what the picture shows; the folder is deleted after.
The Read step says "Picture: the AI is reading it…", then "Picture read by the AI, 4.2 s, 86 words". From there the
transcription goes through Screen, Match, Understand and the rest exactly like a text note, and the card shows it
under **What the AI read**. **Pictures are read by the AI before the personal-data check; a held picture's text is not
kept** (the held card says "The text was not kept"). Reading pictures needs Claude Code as the AI helper; with Copilot
CLI or the VS Code helper a picture is held with "Reading pictures needs Claude Code (AI helper → provider)", and with
no AI it is held too. **Run again** reads the picture again.
The picture read runs Claude Code with none of your own settings loaded (so a dropped picture can never widen what
the AI may read); on a machine whose Claude Code depends on `settings.json` for a proxy, an API-key helper or Bedrock,
pictures are held with "Couldn't read this one" while everything else keeps working.

**What is held.** Lists of people (for example a tracker with names, phone numbers or employee ids) are held,
including a list the AI found in a picture. So are a protected or broken PDF ("Can't open this PDF (it may be
protected)"), a blank or unreadable picture, and picture formats the app does not take (`.bmp`, `.tif`, `.tiff`,
`.heic`: "This picture format isn't supported; save it as PNG or JPG"). A held file moves to `inbox/held/`, is not
read any further and is never copied into an idea. You can delete it, or draft a reply asking the sender for counts
instead of names.

**How an idea is matched**

- A Café ID in the subject, the file name or the body is a sure match (1.0).
- The whole idea title in the subject or file name is a likely match (0.9).
- A sender who submitted exactly one idea is a likely match (0.8).
- The title only in the body is unsure (0.6), so the app asks "Which idea?" and you pick.
- Anything below 0.7 asks. The AI can lower a confidence, and so make the app ask, but it never raises one.

**What happens to each file: eight steps.** Every drop runs the same eight steps, and the Import shows them as
dots on the file's card while it runs (a pulsing dot is the step in progress). Each step is recorded with what it
found, so you can look back later.

| Step | What it does |
|---|---|
| Receive | Stores the file. The same file twice is noticed here and nothing else runs. |
| Read | Reads the text out of the email, transcript, Word file, PDF, note or export; a picture or a scanned PDF is read by the AI. |
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
anyway**; a held link from the Import waits on the file's card instead.

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

**History.** Below the cards in flight, the Import keeps every file it has seen, newest first, grouped by day.
The chips filter it: **All**, **Needs you**, **Held**, **Done**, **Failed**, **Dismissed**, **Pictures**, and the search box finds
a file by its name, its idea's ID or the idea's title. Click a row to open its card again.

If the AI can't be reached, the item says "Working by hand", explains why, and nothing is applied on its
own. You can still choose the idea and apply changes yourself.

**Names are coded before the AI reads a file.** Everyone the app knows, and every name the file itself gives (the
sender, the To and Cc lines, a meeting's speakers, the headers of an email quoted inside it, a first.last address),
reaches the AI as a code such as [P1]; email addresses reach it as `<email>`. The codes in its reply are turned back
into the names before anything is kept, so the card reads as usual. The same goes for **Grow** (`/grow`) and for
reading new ideas from a form export. A name the app has never seen in any form, typed only in free text, is sent as
typed. A picture or a scanned PDF is read by the AI as it is, so a name in it is not coded.

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
transcript, or, for text that mentions "a second builder", a reply that clashes), and reads pictures by their file name
(`whiteboard` or `scanned` in the name gives the kit's whiteboard text, `tracker` a list of people, anything else
"A blank picture"), so the Import can be tested without a real AI. See Test hook below.

New folders in the workspace (under data/):

```
inbox/               dropped files
inbox/held/          files the app will not read
inbox/.items/        one small file per dropped item (what was found, what was done)
inbox/undo.jsonl     a log of every apply and Undo
ideas/<idea>/emails/in/   emails filed against an idea, each with a short summary beside it
ideas/<idea>/notes/       transcripts, notes and documents filed against an idea
```

## Deep read (optional): a local long-term memory

**What.** The universe holds names: ideas, people, capabilities, systems. Everything long stays in each idea's folder:
the challenge, the current process, the business impact, the context, the team's answers, the emails (sent and filed),
the review and its to-do list, the design and the approach, the roadshow script, the CSIC hand-off and the history.
**Deep read** reads all of it into passages and keeps a map of what each says, on this machine, so the assistant and
the search can find things by meaning. It is a reading index, not understanding.

**Why, and what happens without it.** Without it the assistant answers from the stars alone: labels, not what people
wrote. "What did teams say about data access" finds nothing. Ideas and capabilities that mean the same thing in
different words stay apart, and twins pile up. With it:

- **The assistant** has two more query steps: `search` (free text → the passages nearest in meaning, grouped by idea,
  each hit shown with the idea and section it came from; the ideas light up in the universe) and `similar` (a star →
  the nearest stars of its kind; text → the nearest ideas). A `match` no label contains falls back to the nearest
  labels, and the trace says "nearest: …".
- **The ideas panel** search finds by meaning when no ID, title or function has the words: the list shows a small
  **by meaning** marker and a ≈ before each ID.
- **Extraction** (Grow the universe, the Import's read of new ideas, a dropped file's facts, updates from answers):
  a star the AI proposes that is close enough to one you already have reuses that star; one merely near it is kept and
  its link is held with the existing "Looks like X: merge or keep both?" rule. No new approval step: the same hold as
  today.

**Add-on, not a must.** With nothing read, every path above behaves exactly as before (the tests say so). The pop-out
copies nothing anywhere and asks no Yes/No: its controls are **Run**, **Pause**, **Continue** and **Rerun all**.

**How.** Click **Deep read** in the title bar. The pop-out is a dashboard of where things stand: the ring (passages
read ÷ passages present) with "passages to go: N (NN %)", the status ("Reading 120 of 480…", "Paused at 160 of 480",
"Read 26 Oct 14:02 in 48 s · 2 ideas changed since"), three tiles with counts and shares (**Read** · **Changed since** ·
**Not yet**), bars by kind (submissions, emails, designs, reviews, roadshows; read of present), and a table with every
idea (Café ID, title, status, passages read / present, which kinds are still to read, last read), not yet first, then
changed since, then read, with filter chips and a search; a row opens the idea in the left panel and the chips are
there again when you come back. Then five short blocks on why, and where the model lives. **Run** reads what is new or
changed (incremental, by content hash); the job runs in the server, in the background, and goes on when the pop-out
closes (Esc or ✕). **Pause** stops at the next batch (16 passages); **Continue** picks up there; **Rerun all** drops
the index first. The title-bar pill keeps the ring and the percentage and shows a small dot when anything is changed
since or not yet, so you know at a glance.

**Keeps itself current, and knows when not to.** Once the model is on this machine, Deep read keeps the index current
by itself, piece by piece, and deliberately, with no Run needed. Every change goes through one decision (`src/memory/upkeep.ts`, `decide()`), whose
reason is kept and shown in the pop-out ("Last: read 2026-003 after Import · 3 passages · 26 Oct 14:02", "Last:
skipped, nothing changed in 2026-003"). The rules, in order:

1. **Never downloads the model on its own.** Until the model is on this machine (your first **Run** downloads it once),
   upkeep does nothing and the pop-out says "press Run once to download the model". Once it is there, upkeep arms
   itself: a changed idea is read even when there is no index yet (its passages are all new, and the index is made).
   **At start-up**, once the server is listening, the ideas not read yet (never read, or changed while the app was
   closed) are read in the background, just those ("Last: read 2026-001 and 2026-002 at start-up · 14 passages");
   with every idea read it does nothing and writes nothing. The **Not yet** tile drains by itself.
2. **Never while paused** (a change while paused is marked changed since and read at Continue); **queued** behind a
   running read and checked once when it ends.
3. **Only what changed, and only if it changed.** An Import or a save names the ideas it touched; only their passages
   are re-hashed. Every hash already in the index: skipped, and said. Otherwise only the changed or new passages of
   those ideas are read (and gone ones dropped). Never the whole workspace: **Rerun all** stays yours.
4. **Bursts become one read.** An Import of forty files, or the design brainstorm writing after every answer, is one
   re-read: five seconds of quiet after the last change (at most thirty seconds after the first), and the pop-out says
   "waiting for changes to settle".
5. **Never in your way.** Upkeep runs after the Import, the save or the assistant has returned; nothing waits on it.
6. **Fails quietly, once.** If the model cannot be loaded the change is recorded as deferred with the error, shown
   once, and tried again at the next change, never in a loop.
7. **Another model's index** is left alone, and said; Rerun all is your call.
8. **A star renamed or merged** refreshes its label vector only; no passage is read.

What counts as a change: anything written into an idea's folder (the record, the design and approach, an email drafted,
sent or filed, the roadshow, the CSIC hand-off, a history line). **Automatic upkeep: on/off** in the pop-out (kept in
`rules/settings.yaml` as `deepRead.upkeep`; on unless you turn it off, and always shown) turns it off for fully manual
reading, start-up included. It is a setting, not an approval: nothing asks Yes or No.

**The assistant knows where Deep read stands.** It is told whether the index is on, how much is read, how many ideas
changed since, and when it last read; it uses `search` and `similar` only for what people wrote (challenge text,
answers, designs, reviews, emails) and the graph steps for stars, links, counts, people and stages. With no index the
two steps do not exist for it. When a search lands on an idea whose text changed since it was read, the trace says
"2026-003 changed since it was read"; the answer is not held up for a re-read, upkeep does that.

**The model, and where it goes.** Deep read uses a second, local model, not the AI connector: Transformers.js
(`@huggingface/transformers`) running `Xenova/all-MiniLM-L6-v2` (quantised, about 23 MB) on the CPU in the app's own
process. The library is loaded only when a read starts (`npm start` and the tests never load it). The model is
downloaded once, from the Hugging Face hub, on the first **Run**, into `~/.cafe-ai/models/` (outside the workspace, so
`data/` stays deletable). After that nothing goes out: no text is sent anywhere, and people's names are coded before any
AI sees a passage, exactly as today.

- `CAFE_MODEL_DIR=/path/to/models` keeps the model somewhere else.
- **A PC that cannot download.** Run Deep read once on a PC that can (the pop-out says "on this machine" once the model
  is there), then copy the whole `~/.cafe-ai/models` folder to the same place on the other PC, or anywhere and point
  `CAFE_MODEL_DIR` at it. It is a plain folder copy; no zip, no install. If a Run cannot get the model the pop-out says
  "Could not finish: …" and nothing else changes.
- An index built with another model (the test stub, say) shows as "Read with another model" and **Rerun all** reads
  it again with this one.

**Tests.** `CAFE_EMBED_FAKE=1` swaps the model for a stub that hashes words into a fixed-length vector (deterministic;
nothing downloaded). `npm test` uses it and never loads the library. Set it with `CAFE_AI_FAKE=1` to try the whole
flow without a real AI: Deep read reaches 100 % on the test data, and a plain question ("what did teams say about data
access?") is answered from the passages with a trace.

## Knowledge graph: the registry, the rules and the ontology

The universe is a property graph: stars (`GNode`) and links (`GEdge`), rebuilt in memory on every read from the ideas,
the AI links and your edits, nothing kept that cannot be rebuilt. Three more layers in the same build make it a
knowledge graph. They work from the first imported idea; there is no "build the knowledge graph" step and no switch.

**The registry: one star per thing, whatever people call it.** `rules/entities.yaml` (written by `init`) holds stable
identities, one section per kind (`Tool`, `System`, `Team`, `Entity`, `Capability`, `PainPoint`, `Beneficiary`):
`id` (`type:slug`), `label`, `aliases`, and an optional `ref` (a CSIC catalogue id, say). It starts with the approved
tools and their aliases, which used to live only in code. Wherever a star is born (a form's team, feature or tool, a
star the AI proposes, a star you add or rename, the Import's read of new ideas) its label is looked up here first, by
label or alias, ignoring case, spacing and accents: "travel policy" and "Travel & Expense policy" are one star. Then the
exact label, then Deep read's nearest star (when an index exists), then a new star. The star's details show **Also known
as** and **Reference**. A **merge** records the merged label as an alias of the star kept, so the twin cannot come back
at the next import or re-read; the assistant's `alias X as Y` records one by hand. Aliases are edits in
`graph/operator.jsonl` (`t: alias`), undoable like the others. With no file (an older workspace) the registry is the
approved tools alone and the graph is exactly what it was.

**The rules: facts nobody typed.** `rules/inference.yaml` (written by `init`; the built-in rules when absent) runs as
the last layer of every build, after your edits:

| Rule | From | Derives |
|---|---|---|
| `needs+uses_data` | Idea NEEDS Capability, Capability USES_DATA System, **for the same idea** | Idea DEPENDS_ON System |
| `needs+built_with` | Idea NEEDS Capability, Capability BUILT_WITH Tool (a capability's tool is shared) | Idea USES Tool |
| `member+submitted` | Team HAS_MEMBER Person, Person SUBMITTED Idea | Team OWNS Idea |
| `shared-stars` | two ideas sharing two or more capabilities, pain points or categories | Idea SIMILAR_TO Idea, confidence n/3 |

Each rule can be switched off in the file (`enabled: false`). A derived link looks derived: dashed violet in the
universe (the Show menu has the legend), `source: rule:<name>`, with `derived: { rule, inputs }` naming the links it
rests on; its confidence is the lowest of its inputs and it is confirmed only when every input is. It is never confirmed,
routed or merged by itself, it is left out of counts (the idea card, the Links tab, the star's links) and the link tables
tag it "derived by <rule>" with no Add it anyway. The **same idea** scope matters: the AI extracts links for one idea at
a time (each AI link carries `idea`), so a capability two ideas share does not hand one idea's data dependency to the
other. A link you make with an idea open on the left is that idea's; one made with nothing open is shared knowledge.
`edges.jsonl` holds the derived links too, flagged. Demand's **Systems depended on** and **Tools in use** beams, the
idea's **Similar ideas** block (with the shared stars as the why), and the assistant's `follow`/`rank` with a derived
relation ("which ideas depend on the expense system", "what does GSS own") all come from here; the trace says "derived
by <rule> from <the links>". A plain `follow` keeps to stated links.

**How it stays current.** Nothing is rebuilt that did not change: the build keeps one bundle per idea, keyed by a hash
of the idea's record and the registry's version, and the operator log is folded by its appended lines; a rebuild
recomputes the bundles of the ideas that changed (an Import, a save, a touch from Deep read's bus) and runs the rules
in full (cheap at this scale; the bookkeeping for neighbourhood recompute is there). The AI is never called on its own:
the idea's Connections say when the AI last read its text and whether the text changed since, with **Read again**.

**The ontology as data.** `rules/ontology.yaml` (written by `init`) is what each kind of star is (label, colour,
description) and what each link means (from, to, meaning, inverse, derived). The app applies it over the built-in
ontology, so the panels, the universe and the extraction prompt (which tells the AI what each link means, not only
which kinds it joins) use your words. Only the kinds and relations the code knows can be changed; anything else is
reported by the check and ignored.

```bash
npm run cafe -- ontology check --workspace ~/cafe-workspace   # files and graph against the ontology; prints violations, fixes nothing
npm run cafe -- export --workspace ~/cafe-workspace [--idea CAFE-2026-004]   # JSON-LD into data/exports/
```

**Check** reads `ontology.yaml`, `entities.yaml` (sections, id prefixes, duplicate ids and aliases),
`inference.yaml` (unknown relations, chains whose kinds do not line up), then the graph and the files behind it (an AI
link or an edit the build skipped, an alias on a star that is gone), one line per violation, exit code 1 when any.
**Export** writes the graph, or one idea and what it touches, as JSON-LD with an `@context` mapping the ontology; the
assistant's "export graph [idea]" does the same, and routing an idea to CSIC writes its corner of the graph as
`csic-handoff.jsonld` beside `csic-handoff.md`. The export is local and holds people's names as the files do.

## AI help (optional)

With no AI, everything above works by hand and nothing breaks. With one, the app can do two things:

- **Grow the universe from this idea** (in the idea's details): reads the idea's title, challenge, current
  process and outcomes and proposes capabilities, systems and pain points, with links. It never proposes a tool: a Tool star
  appears only when you pick the tool in the tool picker.
- **Decide by hand** (beside Suggest a decision, before anything is suggested) opens the decision form at once: the
  decision is yours with or without the AI.
- **Suggest a decision / Re-evaluate** (in the idea's details): a decision, its reason and a to-do list of what you
  still need. What the answers change in the record is **applied by itself**: a builder (the builder role, and
  "Builder named, can attend" when they confirm), participation, flags the answers settle, the answers themselves
  (saved on the idea for the design series and later suggestions, and "Answers received"; an answer already on the
  idea from the team's reply or another section's questions is not saved twice), and links in the universe (a system
  the answers name, say). The AI proposes each change, the app checks it (only real changes, each made once, names
  from their codes) and applies it, and lists it read-only under **Updated from your answers**; each is in the idea's
  history, by the AI, with the section's answers as its source. There is no Yes, No or Undo: change the record by hand
  (or with the assistant) if one is wrong. The tool picker, the design questions and the data questions do the same,
  each with its own list. An older record may still hold a change from before this (shown as not applied): the
  section's next suggestion applies it if the answers still say so; one you said no to then is never made.
- **The Submission** (right panel) shows the form, and in its own colour what came after it: a role or a person added
  later (by an answer, an email or the assistant), a field changed from the form's value ("Team (form: Individual)"),
  and **Learned since the form**: the AI's short brief of what the answers add, one point per topic (Builder, Data,
  Systems, Scope…; merged, repeats dropped, the later answer winning), written at each Suggest or Re-evaluate. The
  answers as given are folded under it, with where each came from and Remove for a wrong or duplicate one; after a
  Remove the brief says it is out of date until the next Re-evaluate.

**Settings → AI connector** says who is answering ("Claude Code", "Copilot CLI", "Copilot (VS Code)" or
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
- The answer is **checked against a schema** before anything is used. A reply the check refuses is thrown away and
  the AI is asked once more, told what was wrong, in the time the task has left (never after a timeout); if that
  reply is refused too, the app says it is working by hand.
- **What the AI finds is added at once, confirmed, new stars included; only a link a conflict rule holds waits
  for you; you can remove any AI link from the idea's details.** The rules are in the Import section above (a star
  that looks like one you have, a person, a link the AI was less than 50% sure of). A held link shows dashed with
  "Waiting on you" and **Add it anyway**. After "Grow the universe" the app says how many links were added and how
  many wait for you. A link you removed is not proposed again.
- If `graph/ai-links.jsonl` has a line the app cannot read, that line is skipped (and kept in the file), the
  rest of the universe still shows, and `GET /api/graph` lists it under `problems`. A broken
  `graph/layout.json` is only a cache: the app lays the universe out afresh.
- One AI call runs at a time, behind the server's lock, for up to 90 seconds (the roadshow deck, which writes every
  slide and its script in one reply, up to 5 minutes). Any other change, a stage move included, waits for it and is
  saved right after; the idea panel says the move is waiting.

### Test hook

`CAFE_AI_FAKE=1 npm run cafe -- start ...` adds a fake provider that returns fixed answers. It exists only
for the screenshot tour and tests. It cannot be picked in the chip, and only the exact value `1` turns it on.
Do not set it for real rounds. `CAFE_AI_FAKE_DELAY=<ms>` (with the fake only) makes every fake answer wait that long
first, so the tour can catch a step while it runs. `CAFE_EMBED_FAKE=1` does the same for Deep read's model (see Deep read).

## What the idea panel shows, by stage

Each action section has a home stage. Before it, the section is hidden; at it, the full form; after it (or once the idea is closed) a compact read-only card with an Edit link. Anything already saved is never hidden.

| Stage | Editable | Cards |
|---|---|---|
| 1 Review and Select | Decision (the choice first, the five checks fold away under it); the acknowledgement (E1) is sent from Emails | |
| 2 Design series | Understand the data and Features and tool (in either order), then Design (after its readiness check), then Plan and kits | |
| 3 Launch and Learn | Roadshow (photos, what the story needs, the deck) | The data, Features and tool, Design (no Edit); Plan (the decision is not shown after Review and Select) |

There is no Submit Idea stage: an imported idea starts in Review and Select, and the checks that used to sit in
Submit Idea (own words, no personal data, duplicates, acknowledgement) are Review and Select steps. In the files the
three stages are still numbered 2, 3 and 4, so older workspaces keep working; an idea or a stages.yaml step saved
with stage 1 is read as Review and Select.

## Design series: tool picker, brainstorm, plan and kits

An idea's details (the left panel) carry three more sections, after Review and before Stage. They are meant
for an idea in Café Work. They take the idea from "what must it do, and with which tool" to a plan a builder can start from. The AI suggests;
nothing is saved until you press a button, and you can do everything except plan.md by hand.

**What you see**

The data and the features and tool can be done in **either order**; each feeds the other once it is there (Suggest
features and Suggest a tool read the confirmed data; the data step reads the features). When the data is confirmed
after the tool was evaluated (features first, data later), the tool picker, approach.md and the readiness check say
the evaluation is out of date for the data and offer **Re-evaluate the tool**: an evaluation records which
confirmation it saw.

0. **Understand the data**. Drop the team's files on the section (or pick them): CSV, Excel, PDF, Word, text,
   an email (.eml, .msg) or a picture of a report, up to 10 MB each and 12 per idea. Each waits with a drop-down
   saying what it is (guessed from the name; you decide): **Sample input**, **Sample output** (what it should
   produce), **Today's output or report**, **Rules or reference**, **Process document**, **Example email** or
   **Other**. **Read and understand** sends them up one by one and shows each file's five step cards as they run
   (the Import's dots):
   - **Read**: the name, size and first bytes are checked before anything else; the file is copied into the idea
     folder's `data-files/` (never anywhere else) and read with the Import's readers; a spreadsheet or CSV as tables
     (every sheet).
   - **Check**: the Café data rule in code. Email addresses, phone, card and bank numbers, employee or account
     numbers, a column of people's names, the Café's own people and sensitive details hold the file: **It is masked /
     synthetic — continue** goes on (the flagged columns stay masked in everything the AI sees), **Remove** deletes
     it. Nothing in a held file reaches the AI. Made-up stand-ins ("Person 3", EMP-****1, hashes) are noted, not held.
   - **Profile**: by code: each column's type, how full, distinct values, ranges, the commonest values, shapes, a few
     example rows (masked), and the issues the code sees; a document's words, headings and tables.
   - **Understand**: the AI, names coded, with the Café data guide (`skills/cafe-data.md`). It may first ask to look
     closer at up to three unclear columns (twice at most), then says what the file is, what every column means
     (and its codes), the rules it implies, how an output derives from the input, the features it serves, its issues
     and what is missing. The code keeps only real columns and features, and says what it dropped.
   - **Saved**: into the design (`design.yaml`'s data section, and a Data section in design.md).

   With several files each is one line (name, kind, state: Understood, Held, Could not read…) that opens to its
   steps and what was understood; a file that needs you (held, failed, to understand again, or working) stays open,
   and a single file opens by itself. The summary shows its first few lines with **more**.

   **Edit understanding** corrects the one line and any column's meaning; your words win and survive **Understand
   again**. Changing a file's kind asks for Understand again. No step card is undone; a file can be removed. A step
   left running when the app stopped shows as stopped ("Understand it again, or remove the file"), so nothing waits on
   it for ever. A picture or a document has no columns of its own: a table the AI reads in it becomes one of its key
   facts ("Columns of the table in it: …").

   Then **Check the understanding**: the AI asks about the data one question at a time, like the design questions (why
   it matters, 2–4 suggested answers, your own, or **I don't know → ask the team** into the questions email), aimed
   at what the code sees open: no sample input, no sample of the output, no rules, unexplained columns or codes, the
   volumes. A topic the team's earlier answers already settle ("about 12,000 claims a month") is not asked: the AI
   quotes the answer, the code checks the words are in an answer on the idea (not a data answer) and closes that gap,
   shown under **Settled by earlier answers** with where the answer came from (and in design.md). Answers save themselves on the idea ("data questions"); the Import fills the ones asked of the team. What
   the answers and files imply for the record and the universe (a system the data comes from, a builder, a fact) is
   checked and **applied by itself**, listed read-only under **Updated from your answers** and logged in history (no
   Yes/No). When the AI says the understanding is complete it shows a summary (input, output, knowledge, rules, the
   gaps it closed, what is still open) and you confirm once: **Looks right**. Only a confirmed understanding is
   final: it settles the design's input, output and logic points, adds a **Data** point to "Learned since the
   form", and feeds Suggest features, Suggest a tool, the design questions, the diagram, the kits (sample-data.csv
   gets the sample input's real columns, values made up; the Dataiku datasets and Copilot Studio's knowledge.md name
   the real files) and the roadshow ("The data" slide). Dropping, removing or editing a file afterwards asks for a
   new confirmation; a file held at the check (or one that could not be read) is not part of the understanding, so
   dropping or removing it leaves the confirmation as it was. With no AI the files are read, checked and profiled; write their meaning by hand, add questions
   by hand and **Finish by hand**.

1. **Features and tool** (the tool picker), in two steps.
   - **Features.** A list of what the proof of concept must do: one row per feature, a name and one line on what
     it does. A feature has no tool of its own. **Add feature** adds an empty row and **×** removes one. **Suggest
     features with AI** fills the list from the idea, the team's answers and the Submission's **Learned since the
     form** brief (people's names are coded before the AI sees them). It never drops or changes a row you have; it
     only adds features with new names.
   - **Tool.** ONE tool from the approved list (Microsoft Copilot, Copilot Studio, Power Apps, Dataiku or custom
     app) for the whole list. **Suggest a tool** asks the AI for it, with a reason, its **Pros** (what the tool
     does well for this idea), its **Cons** (each part it cannot do, or does poorly, and how to cover it, such as "add
     Power Automate"), how it fits **each feature** (✓, partly or ✗, with a note on what is missing), and a folded "Why
     this tool" list (the facts it relied on). The drop-down is yours: pick another tool and the AI evaluates THAT tool
     against the features (it may not change it; a reply about another tool is refused), and the choice shows as
     "Your choice". With no AI connected the tool still changes, with its pros, cons and fit cleared and a note that
     they need the AI. If you change the features after a tool is chosen, the panel says the evaluation is out of date
     and offers **Re-evaluate the tool for the new features**.
   - Like the decision, the tool step keeps a **What you need** to-do list: what the AI still needs to be sure of
     the tool, each with the question for the team and a box for the answer. **✉ Draft email** opens the open
     questions (E2) in Outlook; **Re-evaluate** reads your answers (and any the Import recorded) and updates the list
     and the tool (your own tool is evaluated again, not replaced). When the form says too little to pick at all, it
     gives only the list. What the answers change in the record is applied by itself and listed under **Updated from
     your answers** (as for the decision), and the Submission's **Learned since the form** is rewritten.
   - The tool shows its pathway: custom app is TTIA-Led, Microsoft Copilot is Citizen-Led with no build, and any
     other tool is Citizen-Led with a named builder or Assisted Citizen without one. **Save** writes the features and
     the tool, approach.md and design.md, ticks "Tool picked", and links every feature to the one tool in the
     universe. A tool that is not on the approved list is refused. Older records that had a tool on each feature open
     with one tool: the most common one, with its pros and cons, as your choice. UiPath is no longer on the approved
     list: an older record that chose it opens as it was (never swapped for another tool), the picker shows no tool
     and says "UiPath is no longer on the approved list: pick another tool", design.md and approach.md say the same,
     the universe marks the link as not on the approved list, and neither approval nor the plan goes ahead until a
     new tool is picked.
2. **Design.** Before its first question (and again after a Redesign) the section shows **Ready for the design?**,
   a check worked out by the app (src/design/ready.ts), never by the AI: **The data** (at least one file, the
   understanding confirmed with Looks right and not reopened since), **The features** (at least one), **The tool**
   (one approved tool, evaluated, not out of date for the features, the design or the data, its What you need list
   all clear) and **Nothing waiting** (no file still being read, no data question with the team). Each item is ✓ or
   one plain line saying what is missing, with **Go to the data / features / tool**, which scrolls the panel to that
   step. When something is missing, a **Suggested** line names the next step ("Next: understand the data — drop the
   sample input and output."): the first gap that can be worked on now, in the order data, features, tool. A gap that
   only waits on the team's reply comes last. All clear: **Start with the first question**, as before. Not all clear:
   no start, only a red **Design anyway**, which asks first ("The design will miss: …"). A forced design records when
   and what was missing (design.yaml `forcedAt`, `forcedMissing`, and the idea's history). design.md and the design
   pack say "Designed before: …", and the AI's questions aim at the missing pieces first. The design-step route
   applies the same check: with gaps and no `force: true` it refuses with the missing list (`missing`). Once the
   design has a question it is not checked again. Redesign clears the forced mark.
   A short brainstorm, one question at a time: what the proof of concept must show, the smallest
   input it needs, who builds it, and so on. The questions build on the features and the tool: the AI gets the
   feature list, the tool, its cons and the features it covers only partly or not at all, and asks first how to
   cover those. It never asks again what the team's answers or the Learned since the form brief already settle
   (names are coded before it sees them). Each question comes with a reason and suggested answers. Pick
   one, type your own, or press **I don't know → ask the team**: the question goes into the idea's questions
   email (E2), sent from ✉ Emails, and when the team's reply comes in through the Import, it fills the answer. Each
   AI question also reads the answers so far, like the decision and the tool picker: what they change in the record
   (a builder named, a flag settled, a system the data comes from) is applied by itself and listed under **Updated
   from your answers** in the Design section, and the Submission's **Learned since the form** is
   rewritten with what they add. Names are coded on the way out. A question added by hand changes neither. The live
   design.md sits under the questions.
   The design runs until it is **build-ready**: after the five points (must show, smallest input, who uses it, what
   it replaces, who builds it) come the five build points a builder needs before the first session: **Input** (the
   sample's fields, format, rows, masking), **Logic** (the exact rule, its exceptions, the rules sheet's columns),
   **Output** (its columns, its form, where it lands, how often), **Done when** (a seeded sample and what must come
   out of it) and **Environment** (the instance or project, the data approval, builder access). The AI aims for
   about 8 questions, merges points one question can settle, and never asks what is already settled. When it is
   done, its reply also says in one line each what the earlier answers settled for any point no question asked
   about, so design.md and the pack show it instead of "(not yet answered)". design.md has a section for each build
   point; the design pack shows them under **To build it**.
   The **feature list follows the design**: when an answer leaves a feature out ("Leave marking out"), moves it to
   another tool ("draft with Copilot and log in a SharePoint list") or changes what it does, the AI says so in its
   reply and the app applies it at once, as the answers save themselves. Only names on the list count. A dropped
   feature stays in the list, struck through, marked **Out of scope** with why; a moved one names the other tool
   ("Microsoft Copilot + SharePoint, outside the Dataiku build"). design.md, approach.md, the design pack and the
   tool picker show the updated list; each change is logged in the idea's history. In the universe an out-of-scope
   feature is no longer needed by the idea, and an outside one is not built with the main tool (it is built with
   the other tool only when that is one approved tool). In the tool picker, **Put it back** (then Save) returns a
   feature to the build.
   The tool's fit follows too: a feature out of scope or done with another tool has no fit with the main tool any
   more (approach.md says "Out of scope" or "Covered by Microsoft Copilot, outside the build"; the diagram and the
   kits show the move); a feature whose job changed keeps its fit marked **out of date** (approach.md, the tool
   picker, the diagram's card, the kits), and the tool picker offers **Re-evaluate the tool**, which evaluates the
   same tool again.
   **See the design** opens the design pack with the design **drawn as an interactive diagram**, not a file: swim
   lanes for the data, the tool's build, any work done outside it and the people; rounded parts coloured by kind
   (input, store, step, output, person, gap) in the theme's colours; arrows with labels. Hover a part to light its
   whole path; click it for a card with what it does, the feature it belongs to, how the tool fits it (a gap, or a
   feature the design moved, is marked) and the question whose answer set it. Zoom in and out, **Fit**, and drag or
   scroll inside the box (it scrolls at phone width). The diagram is drawn by the AI (task `design-diagram`, a
   checked structure of lanes, parts and arrows, at most 16 parts, names coded before the AI sees them) when the
   design is finished, and stored in design.yaml with what it was drawn from: when the design changes it says it is
   out of date and offers **Redraw**. With no AI, or before it has drawn one, the pack draws a plain diagram from the
   design itself (the input, the features the tool builds, the output, who uses it, any outside tool), so it never
   shows nothing. Once the plan and kits are written, a Dataiku kit's **recipe flow** shows in the pack too, as
   Dataiku draws its Flow: dataset boxes (input, rules sheet, intermediate, output) go into recipe circles, then the
   output datasets and the dashboard, in the same theme colours. Hover a part to light its path; click it for a
   recipe's steps or a dataset's columns. The pack's **Files** list says what each kit file is and how to use it, the
   picked tool's kit first in the order of work, then each outside tool's kit; **Read it** on flow-diagram.html shows
   the flow here, and the file itself opens in any browser.
3. **Approve design.** Once the design is finished, approve it. If the tool choice has a CSIC flag (a
   custom app, or the tool or a feature flagged as needing a live system or personal data), the notice says so and the app offers "Close it as Routed to CSIC?" as a Yes/No.
   It never closes the idea on its own. Changing the features, the tool or the design afterwards un-approves it, and it
   needs approving again.
   **Redesign** (in the Design series, once the design has questions, whether in progress, complete or approved)
   starts the design again from the first question. It asks first ("Start the design again? The questions, answers,
   summary, approval and diagram are cleared; the features and the tool stay. The new design starts with the readiness
   check."), then clears the questions and
   answers, the summary and what it said was settled, the approval and the diagram, and the design's own answers on
   the idea; the feature list (as it is now) and the tool stay, design.md is rewritten and the idea's history says
   "Design started again". plan.md and the kits are not touched: when they exist, the Plan and kits section says they
   are out of date until they are written again from the new, approved design. It never moves the stage.
4. **Plan and kits.** **Write the plan and kits** writes plan.md (tasks for the tool, risks, and the
   CSIC note when the tool choice has a CSIC flag) and a filled-in starter kit for the picked tool. The plan task
   (design-plan) reads the idea, the summary, the features and the answered questions with people's names coded,
   like every other task, and the names are put back in plan.md. A second AI
   task (design-kit) reads the whole approved design (the features with their status and fit, the tool's pros and
   cons, every design answer and build point, the summary, the Learned since the form brief, the plan's tasks and
   risks; people's names coded) and writes the kit's content; the app checks it and writes the files. Where the
   design does not say something, the kit says "(not settled in the design)" rather than leaving it to you. Every
   tool also gets a short kit for each other tool the design uses for its gaps (a feature done outside the build,
   such as Power Automate). If the kit AI fails, the kits are still written from the design alone and the README
   says so. For a custom app, **Copy build instruction** copies a ready-made instruction for Claude Code or GitHub
   Copilot. Running it again rewrites only the files the app made and keeps any you added. The app keeps a list of
   the kit files it wrote (`kit/.cafe-written.json`): writing again takes away only the files on that list the new
   layout no longer writes (a tool no longer picked, a file the kits stopped having), and a folder that leaves empty;
   it is logged in the idea's history. For an idea written before the list existed, files with a name the kits used
   to have (such as topics.md) that are no longer written are shown in the design pack as **Older kit files**, with
   **Remove older kit files**: you decide, as you may have edited them. A file you or a coding agent added is never
   on either list.

**The files it writes** (under `ideas/<id>/`):

```
approach.md            the features, then the one tool: pathway, reason, pros, cons, a fit table per feature, why
design.yaml            the design's state: the data section (each dropped file's kind, step cards, check, profile,
                       understanding and your corrections; the data questions; the summary and the confirmation),
                       features (and where the design moved them), the tool, questions and
                       answers, the settled build points, summary, the diagram, approval date, and (after a
                       Redesign) the date the plan went out of date
data-files/            the copies of the files dropped in Understand the data (f1-<name>, f2-<name> …)
design.md              the design, readable: the points, the build points, the features and tool, the decisions
plan.md                the plan: the one thing to show, tasks for the tool, risks
kit/<tool>/...         the starter kit for the picked tool (below)
kit/<other tool>/README.md   a short kit (what it covers, what to set up, the test) for each tool the design adds
                       for its gaps, outside the build
```

**The starter kits.** Every kit has:

```
README.md              what the kit is, what it must show, the build points, the features by status, the files in
                       the order of work, the plan tasks, who does what, the sample's columns and seeded tests, risks
sample-data.csv        a SYNTHETIC sample with the design's input fields: about 24 ordinary rows from the AI's
                       example rows (ids numbered, dates moved by whole weeks), then the seeded test rows from "done
                       when" (marked T1, T2 … in test_case); at most 200 rows; a person column holds Person 1, 2 …
test-checklist.md      each "done when", each seeded group and each feature as a tick-box test with the expected result
```

and, by tool:

```
Microsoft Copilot      prompts.md: each prompt written against the sample's columns, with the answer to check against
Copilot Studio         instructions.md (the agent's instructions, ready to paste), skills.md (one topic per feature:
                       trigger phrases, inputs, steps, the answer, the action or connector), knowledge.md (what to
                       add, what not to add, test questions)
Power Apps             data-model.md (lists and columns with types), screens.md (each screen's controls and key
                       Power Fx formulas), flows.md (Power Automate flows for what the app cannot do, when any)
Dataiku                flow.md (each recipe's actual steps), datasets.md (schemas), rules.csv (the rules sheet
                       template, when the logic uses one), flow.json and flow-diagram.html (the recipe flow:
                       datasets → recipes → outputs and dashboard, one self-contained page)
custom app             BUILD-WITH-AGENT.md (the instruction for a coding agent, which starts from the scaffold) and
                       app/: a small starter scaffold the agent finishes. index.html (one screen per feature),
                       style.css and app.js (loads sample-data.csv from a file picker; one rule stub per logic
                       answer, each a TODO). Plain HTML, CSS and JavaScript: no build step, no network. The README
                       says how to run it (open app/index.html, load the sample). The kit AI proposes the screens
                       and rules; the code keeps only built features and the sample's columns, makes the rule names
                       safe function names, escapes everything and writes the files. Nothing runs from the app.
```

A plan task on a tool other than the one picked is listed under "Not picked" in plan.md, with no kit.

**With no AI.** Add the features and pick the tool by hand, write questions and their suggested answers
by hand (**Add a question by hand**), answer them, then **Finish by hand** with a short summary, and
approve. plan.md and the kits need an AI.

**The embedded guidance.** `skills/` holds three texts the app sends as guidance inside prompts; it never
executes them. `cafe-data.md` is the Café data guide: understand each file completely, then ask about the data one
question at a time until the input, output, rules, knowledge and volumes are known; Understand and the data
questions send it. `cafe-design.md` is the Café design guide, written for the app: one question per reply,
multiple choice where it can, aimed at the tool's gaps first, never re-asking what is settled, the smallest
proof of concept, the Café rules, and when to stop; plus how to tell a clear request from an unclear one. The
design questions, Suggest features and the tool picker send it. `writing-plans.md` is the "writing-plans" skill
from the Superpowers project, copied under the MIT licence (`skills/LICENSE-superpowers.md`), for plan.md.

**The rules**

- No value is measured in the Café: no ROI, savings, costs or KPIs. The AI is told so; a proof of
  concept shows one thing works, on synthetic, aggregated or sample data.
- A custom app is TTIA-Led, so an idea with one needs the CSIC Repository before any build beyond a proof
  of concept. The same goes for a live connection to a non-Microsoft system or personal, client or
  third-party data.
- The app runs no application code. The kits are instructions, a synthetic sample, checklists, a diagram and,
  for a custom app, an instruction for a coding agent that works only inside the kit folder, with a small starter
  scaffold (text files with TODOs) for it to finish. The design pack shows the scaffold's files as text.
- The stage never moves on its own. Saving the features and tool, answering the must-show and smallest-input questions
  and approving the design tick their steps in the background (s3e, s3c, s3d, s3f).

## Launch and Learn: the roadshow

In Launch and Learn the decision, the features and tool and the design are cards you read, not edit; the **Roadshow**
section is the work of the stage. It builds the team's deck for the roadshow (about ten minutes, with a demo) and the
script to talk, in three steps.

1. **Photos.** One row per person on the idea (the submitter and every team member, with their roles). Type the path of
   a picture on this computer (`/Users/…/photo.jpg` or `C:\…\photo.png`; quotes from "Copy as path" and `~` are fine)
   and press **Use**, or **Choose…** the file. The app checks it is a picture (named .png, .jpg, .jpeg, .webp or .gif,
   at most 5 MB, never a folder, and its first bytes really a PNG, JPEG, WebP or GIF; nothing else is read) and COPIES it
   into the idea folder as `roadshow/photos/<person>.<ext>`, so the deck never depends on the original. A small
   preview shows; **Remove** takes the copy off (never the original). Optional: a person with no photo gets their
   initials in a circle. Photos never go to the AI.
2. **What the story needs.** **Suggest** has the AI (task `roadshow-prep`) read everything the idea holds (the form,
   the decision, the brief, every answer, the features, the tool, the design, the plan and the dates; names coded)
   and list what the deck still needs from the team: what was hard, what surprised them, what they would do
   differently, the demo, before and after, how long it took, what someone else needs to reuse it, the one question
   for the room. Only what the record does not hold is asked. It is the decision's to-do list: a box per item,
   **✉ Draft email** (the open questions as the E2, opened in Outlook and counted as sent, with Undo) and
   **Re-evaluate**. What you paste is saved on the idea at once as an answer (source "roadshow"), with nothing to say
   yes to, and the reply rewrites **Learned since the form**. The list is kept in `roadshow.yaml`.
3. **The deck.** **Build the deck** has the AI (task `roadshow-deck`) write the slides and the speaker script as a
   checked structure (10 to 14 slides, about ten minutes: title, the problem, how it works today, the team, what was
   built, the data, the design, the tool, the demo, what was hard, what was learned, reuse, next steps, one question, thanks;
   each with points, an optional quote, a visual and the script in the presenter's voice, with cues such as "[switch
   to the demo]"). The code then checks it: a value claim (ROI, savings, KPIs…) or a figure the record does not hold
   is taken out (a point, or a sentence of the script), a visual must be one the app can draw, the deck opens with a
   title slide and has the team slide (and, once the team's data is confirmed, **The data** slide: what goes in, the
   rules, what comes out, drawn by the app from the files; the before-after then opens with today's report and the
   sample output), and the timings add up to about ten minutes; what it changed is listed under
   the deck. The app then draws, in code, into the idea folder's `roadshow/`:

   ```
   deck.html        ONE self-contained page (no network): 16:9 slides, ←/→ or click to move, S for the speaker
                    notes (with the time so far), F for full screen, T for light or dark. The title slide shows the presenters
                    (the lead and the builder; the AI is told who they are, for its subtitle). The team slide shows each
                    person's photo (inlined) or initials, name and roles; the design slide is full bleed: the
                    design diagram fills the slide under the title, with larger text (the app picks wide or
                    narrower, taller parts, whichever draws it largest), and any point the AI gave that slide
                    goes into its speaker notes; the tool slide the fit table; a timeline slide the idea's dates.
                    A slide whose content would run past its space (a long title, a long fit table, two files going
                    in) is drawn smaller until it fits. The question slide's title is the team's question, whole.
                    Printing gives one slide per page.
   script.md        the talk track, slide by slide, with timings and cues
   run-of-show.md   who does what, when: the demo cue, the one question, the four feedback questions
   deck.pptx        the same slides for PowerPoint (pptxgenjs), photos embedded, the diagram as shapes (full bleed,
                    as in deck.html), the script as each slide's speaker notes
   ```

   **▶ Present** opens the deck in a new tab (press F there for full screen); **Open script** and **Run of show**
   open as text; **Export PowerPoint** downloads deck.pptx; **Export PDF** opens the deck's print window: choose
   **Save as PDF**. **Open the folder** shows the files. When the record changes after a build (an answer, the team,
   the design, the plan) the section says the deck is out of date and offers **Rebuild**; when only the photos changed,
   **Update the files** draws them again with no AI. The roadshow lives in Launch and Learn only: the section shows
   in no other stage (not even as a card in the Design series), and **See the design** (the design pack) is about the
   design alone, with no roadshow, deck or script in it in any stage.

**The firm template.** pptxgenjs cannot fill a PowerPoint template's slide masters, so the app never claims to. When
Settings → Project configuration → Firm deck template holds the full path of a .potx, .pptx or .thmx file, the app reads
its theme and draws both decks in its colours and fonts, and says so under the deck; its masters, logos and layouts are
not used (put the slides on them with Reuse Slides in PowerPoint). When it is empty, or not a file the app can read, the
deck uses the app's own clean look and says that too. A WebP photo shows in deck.html; deck.pptx shows the initials
(not every PowerPoint opens WebP), and the build says so.

## Tests

```bash
npm test                 # the app: graph, AI, server, rounds (vitest)
npm run typecheck
cd ui && npm test        # the UI helpers
node scripts/ui-tour.mjs --workspace /tmp/cafe-tour-ws --out /tmp/cafe-tour-shots
```

**Acceptance run of the Import.** `npm run acceptance` drops the `test-data/` kit (01 to 11) through the API on its own
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
then settled; 08 builds one pain-point star; 07 is only filed; 11 stops at the screen; 12-text.pdf is read as a
document, matched to CAFE-2026-004 by its id and its facts applied; 14-whiteboard.png is read by the (fake) AI and
matched to CAFE-2026-002 with its star and link confirmed; 15-scanned.pdf takes the scanned path; and 02 dropped again
records only Receive. Then a rounds pass on a third fresh workspace (`<workspace>-rounds`): one round made, two ideas
put in it, and exactly two `IN_ROUND` links in the universe.

**Scale test of the universe.** `npm run scale -- --out /tmp/cafe-scale` generates a 60-idea export and 150 synthetic
AI links (`--links 300` for about 300 stars), imports them into a fresh workspace, times `GET /api/graph`, and in
headless Chrome (software WebGL) measures the frame time with and without a selection, checks labels do not overlap and
the fly-to lands, and saves `scale-universe.png` and `scale-report.json`. Nothing it writes is committed.

The tour starts its own server on port 4103 (never 4100) against a scratch workspace that it wipes, drives
Chrome with Playwright, and saves screenshots. It needs Google Chrome installed. WebGL runs in software, so
a full tour takes several minutes. `--only=panels|hover|panel|popouts2|ai|inbox|inboxhand|agentic|drawers|focus|ideacard|empty` runs one part (`panel`, also `popout`, clicks a list item and checks the idea opens in the left panel with no dialog, Back, and the star card's Open idea); `--only=ai`, `--only=inbox` and `--only=agentic`
need `CAFE_AI_FAKE=1` (`agentic` also needs `npm run test-data`: it drops 02, 13 and 14 from the kit with the fake slowed to
2.5 s, and saves 60 to 68: the drop well, a card running, Needs you, the history, the idea's links, a picture mid-read,
the picture done with "What the AI read" open, the welcome card on an empty workspace, and the Rounds pop-out with one
round and two ideas); `inboxhand` restarts the server without it, and a full tour includes the AI shots only when it is set. The tour reports any console error and exits non-zero.

## Before the first round

These need an answer from outside this app:

1. **AI on submission content.** Get approval from Tech Governance & Enablement, naming the provider and
   model, before turning on any AI. Until then set the provider to None.
2. **The VS Code helper.** Check whether the firm allows installing it from a folder, or needs it packaged
   as a VSIX and approved.
3. **Names in shared screenshots.** Show people by role in anything shared with TTIA, not by name.
