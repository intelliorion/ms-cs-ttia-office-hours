# Changelog

## 2026-10-27 (Café app: Deep read arms itself; every chat edit shows in the universe)

- **Deep read arms itself.** Upkeep no longer waits for a first manual Run: once the model is on this machine (or the
  embedder is the fake one) and the switch is on, a changed idea is read even with no index yet, and at start-up,
  once the server is listening, the ideas not read yet are read in the background, just those ("read 2026-001 and
  2026-002 at start-up · 14 passages"); with every idea read start-up does nothing and writes nothing. Still never a
  download on the app's own initiative (the pop-out says "press Run once to download the model"), never a resumed
  pause, never another model's index. The switch is on by default and always shown.
- **Every chat edit shows in the universe.** Do it and Undo return `changed` (the stars and threads that are new,
  changed or gone, by comparing the graph before and after, derived links left out) with a line such as "Updated: Alex
  Wang → Lead on Procurement FAQ bot". The UI fetches the graph again, then pulses those stars and threads for about two
  seconds, as a selection's, with no change of selection and no camera move, and shows the line. The cause of "it does
  not update unless I reselect": the data was fresh at once, but a role added between two stars already linked drew a
  new thread exactly over the old one, in the same colour. Roles now have their own threads: lead gold and thicker,
  builder blue, sponsor rose, member dotted (per theme, static in Lite), with a legend row in the Show menu.

## 2026-10-27 (Café app: the assistant keeps both halves of a message, and follows a shared capability home)

- **A two-part message.** "Add X to [I1], then tell me which ideas depend on [S1]": the agent searches the question
  first and proposes with the answer in its own field (`answer`), kept apart from what it says about the change. When
  the change becomes a problem the reply is the answer first, then the problem lines, so nothing computed is thrown
  away and the card never contradicts the sentence above it; with a proposal the reply is the request, the answer,
  then the resolver's notes. A search identical to one already run for the message is not run again: the agent is
  told its result is in the steps, and the trace holds it once.
- **Shared capabilities.** `follow` gains `group: true`: the result lists, for each star of the set, the stars it
  reached, and the trace shows one line per group ("Policy Q&A: Travel policy assistant, Onboarding checklist
  helper"). The guide plans "a capability shared by GSS and BSI ideas, and which ideas" as one query (each side's
  ideas, NEEDS to capabilities, intersect, then NEEDS back to ideas grouped per capability) and answers per
  capability; `search` gains `last: true`, which keeps it to the ideas the previous answer found, for "what did each
  submitter say the current process is" once Deep read has run (one line that it has not read them yet, otherwise).
  The fake provider plans both the same way.

## 2026-10-26 (Café app: the graph becomes a knowledge graph)

- **The registry.** `rules/entities.yaml` (written by `init`, seeded with the approved tools and their aliases) gives
  stars a stable identity with aliases and an optional reference; every place a star is born resolves its label there
  first (form stars, extraction, the assistant's add and rename, the Import), ignoring case, spacing and accents. A
  merge records the merged label as an alias of the star kept, so the twin cannot return; the assistant gains
  `alias X as Y`; star details show "Also known as" and "Reference". With no file the graph is exactly as before.
- **Inference.** `rules/inference.yaml` (four rules, each switchable) runs as the last layer of every build and derives
  DEPENDS_ON, USES, OWNS and SIMILAR_TO, marked derived (dashed violet, `source: rule:<name>`, inputs named, the lowest
  confidence, confirmed only when every input is, left out of counts). `needs+uses_data` is scoped to the idea the data
  link was extracted for, the bug the simulation caught. Demand gains beams by system and by tool; the idea's
  Connections gain Similar ideas and a "changed since the AI last read it" line with Read again; the assistant follows
  and ranks over derived relations and its trace says what derived each link.
- **Incremental.** One bundle per idea cached by the record's hash and the registry's version, dropped on a Deep read
  touch; the operator log folded by appended lines; incremental equals full after every kind of change.
- **Ontology as data.** `rules/ontology.yaml` (types with label, colour and description; relations with from, to,
  meaning, inverse and derived) applied over the built-in ontology for the panels, the universe and the extraction
  prompt. `cafe ontology check` validates the files and the graph and prints violations, fixing nothing. JSON-LD
  export (`cafe export`, the assistant's "export graph [idea]") and `csic-handoff.jsonld` beside the hand-off. Spec:
  `docs/superpowers/specs/2026-10-26-cafe-knowledge-graph-design.md`.

## 2026-10-26 (Café app: Deep read keeps itself current)

- **Deep read upkeep.** After the first Run the index keeps itself current, piece by piece and deliberately: every
  change (an Import, a save, a design, an email, the roadshow, the hand-off, a history line) goes through one pure
  `decide()` whose reason is kept and shown ("Last: read 2026-003 after Import · 3 passages", "Last: skipped, nothing
  changed"). Never before the first Run, never while paused, queued behind a running read, only the changed passages
  of the touched ideas, bursts coalesced (5 s quiet, 30 s cap), never in the operator's way, a failure deferred once,
  another model's index left alone, a renamed or merged star refreshes labels only. A per-workspace switch
  (`rules/settings.yaml` → `deepRead.upkeep`) in the pop-out; no new approval step.
- **The pop-out is a dashboard:** Read · Changed since · Not yet tiles with shares, "passages to go: N (NN %)", bars
  by kind, a table of every idea (status, passages, kinds still to read, last read; not yet first) with filter chips
  and a search, a row opening the idea; a dot on the title-bar pill when anything is changed since or not yet.
- **The assistant** is told where Deep read stands (on, % read, ideas changed since, last read), searches what people
  wrote only for questions about what they wrote, and names a stale idea in the trace. Spec:
  `docs/superpowers/specs/2026-10-26-cafe-deep-read-upkeep-design.md`.

## 2026-10-26 (Café app: Deep read)

- **Deep read**, a local long-term memory for the Creators' Café app, as an add-on: a title-bar button with a
  progress ring opens a pop-out (what has been read, by kind and by idea; Run · Pause · Continue · Rerun all; why,
  what happens without it, what it reads, privacy). A second, local model (Transformers.js, all-MiniLM-L6-v2,
  downloaded once into `~/.cafe-ai/models`, `CAFE_MODEL_DIR` to move it) reads every idea folder into passages kept in
  `data/memory/`. With an index the assistant gains `search` and `similar` steps and a nearest-label fallback, the
  ideas panel finds by meaning, and extraction reuses the nearest existing star or holds a near one with the existing
  near-duplicate rule. With no index every path behaves exactly as before. `CAFE_EMBED_FAKE=1` stubs the model for
  tests. Spec: `docs/superpowers/specs/2026-10-26-cafe-deep-read-design.md`.

## 2026-10-25 (Copilot Studio agent removed)

- The Copilot Studio agent package is gone: `COPILOT-STUDIO-AGENT.md`,
  `copilot-studio-github-agent/`, `scripts/build-github-agent.sh` and
  `scripts/build.sh`. The skills install for Claude Code and GitHub Copilot with
  `scripts/install-local.sh`; the scenarios run in any chat with them installed.

## 2026-10-14 (Café link)

- The Creators' Café page link, http://cscreatorscafe/ (firm network), is now
  in the Café skill and the start-here reference; the agent gives it for
  "where's the Café page", submissions and "was mine selected?". The form
  link, deadline and design-series dates are still to come from TTIA.

## 2026-10-14 (map, single package)

- **Start-here map shown on request.** The Café reference now has a text
  version of the "How I want to use & Build AI" diagram, posted as-is when
  someone asks to see the map, followed by the link to the original,
  http://ttia-ai-diagram/ (firm network; the agent cannot open it). Scenario
  0j added.
- **Standard agent removed.** `copilot-studio-standard-agent/` and
  `scripts/build-standard-agent.sh` are gone; the GitHub Copilot harness is
  the only Copilot Studio package. Docs, build and scenarios updated
  (12b removed).

## 2026-10-14 (round 4 test fixes)

- **Dead end closed:** a Café idea that needs a live non-Microsoft system, or
  personal or client data, can now hand forward to CSIC once the user says in
  their own words what to build, even if the Café suggested it.
- **Small team-local builds:** the agent offers the CSIC Repository or the
  Café (KEEP AS A CAFÉ PATTERN), and the user chooses.
- **CSIC:** the remaining form fields are asked before the verdict, so a
  required field left UNKNOWN makes the case NOT READY instead of READY. The
  requester, the MD sponsor and the data are confirmed at every stage before
  they can block. A user who leaves for the Café midway gets the verdict as
  it stands. Resuming also asks for audience and pathway.
- **Value story:** a live initiative that never went through CSIC still gets
  its value story; CSIC comes in only for "who owns it". An after figure with
  no before is measured as a level, with no improvement claimed.
  "Nothing live yet" also offers the Café on the standard agent.
- **Assignments:** a value case or value story ends with its closing line,
  then one assignment line, in the same message.
- **Standard agent:** lists all seven Café routes, offers the Café after a
  productivity question, and gives no licence price inside the Café
  (7,908 characters).
- Scenarios 14-19 added.
- **Re-check fixes:** the GitHub instructions also offer both levels for
  team-local builds, and resume there asks for audience and pathway. A user
  who quits CSIC for the Café stays in the Café in that conversation, and
  questions not yet asked are listed as such rather than as blockers. From
  "approved" on, CSIC asks whether the pathway owner has accepted. Resuming
  re-checks the pathway against the data and audience. The CSIC value case
  ends with one assignment line. Route names are spelled the same everywhere.

## 2026-10-14 (later) — three levels, forward only

- **Three skills, three levels.** `ms-cs-ttia-creators-cafe` (find the right
  solution, never measures value), `ms-cs-ttia-csic-repository` (renamed from
  `ms-cs-ttia-office-hours`; identify and measure the AI ROI),
  `ms-cs-ttia-value-story` (renamed from `ms-cs-ttia-value-report`; what a
  live initiative actually delivered). Delete the old skills from Copilot
  Studio before uploading the new zips.
- **New routing test.** "Do you know what you want built and roughly how, who
  would use it, and what you expect it to change?" All three: CSIC
  Repository. Any missing: Café. Sponsorship and stage labels are no longer
  the test.
- **Forward only.** Fixes the dead end where the Café and intake sent the same
  item back and forth. The CSIC Repository never hands back; a missing
  sponsor is a blocker. NOT AN INITIATIVE YET ends with an assignment to the
  Café, not a handoff. The value story never restarts intake.
- **Proof of concept with users, no CSIC record** now has a home: the CSIC
  Repository, as a pilot proposal.
- **Resume rule** in both instruction files and all three skills: memory is
  off, so ask for the last sheet, and if they do not have it re-ask only what
  the level needs.
- **CSIC Repository:** an explicit order for the whole conversation, so the
  measure, five cards and alternatives are always reached; the user chooses
  the value driver; a remaining-fields step before the sheet (FWAI theme is
  picked from the form); READY at proposal no longer needs an accepted
  owner (carry-over risk instead); personal data rules out Citizen-Led and
  Assisted Citizen even as an extract; firm disqualifiers cannot be
  escalated; a blocker type for escalations and a place to raise them.
- **Café:** licence and access questions go to Tech Governance & Enablement;
  unlisted tools are "not on the approved list"; the user writes the two
  submission sentences; the Café page and its button are named; the
  start-here map reference is read explicitly.
- **Value story:** starts from the claim; asks whether the system holds
  history from before go-live before declaring a claim unevidenceable.
- **Standard agent:** instructions rewritten around the three levels (about
  7,100 characters); knowledge file 05 defers to 07 for the value case
  layout; the build no longer turns "this skill" into "this agent".
- Test scenarios rewritten for routing (0a–3e) and added for the dead ends
  (5b, 5c, 11, 13b, 13c).
- **Second test round fixes.** The routing test is applied once, at entry, so
  a well-sharpened Café idea can still reach SUBMIT TO THE CAFÉ. The Café
  hands forward on outgrowth only when the user can say what they want built,
  closing the last Café/CSIC loop; a business case for an undefined idea
  stays in the Café. A user may choose the Café after being told once why
  CSIC fits. New Café routes: KEEP AS A CAFÉ PATTERN, STOP KEEP THE LEARNING,
  and REUSE for an approved tool they lack access to. A handoff is not a
  closing message. CSIC: baseline owner is a hard blocker everywhere; the
  data question is on the proposal bar; the sponsor must be an MD who has
  agreed; OPPORTUNITY DESCRIPTION is asked for and three dropdowns are
  confirmed; an ownership escalation at proposal goes alongside a READY
  sheet; a de-identified extract can reopen Citizen-Led; a Café proof of
  concept is a stage; resume asks the level first and continues from the
  measure. Value story: pasted figures count as evidence. Scenarios 0g–0i
  and 13d added; 0c updated.

## 2026-10-14

- **Creators' Café skill.** New `skills/ms-cs-ttia-creators-cafe/` for the CS
  TTIA Creators' Café, the Corporate Services Advanced AI Community of
  Practice: the start-here map, Café vs TTIA CSIC Repository, the four Café
  stages (Submit Idea, Review and Select, Design series, Launch and Learn),
  tools and pathways at Café depth, and a route instead of a verdict. Ships
  as a third zip for the GitHub Copilot harness agent and as knowledge file
  `08-creators-cafe.md` for the standard agent.
- **Idea stage goes to the Café.** Intake now starts at proposal. The stage
  question sends "idea" to the Café skill and "NOT AN INITIATIVE YET" does
  the same. The test between the two is the map's: defined, validated and
  sponsored.
- **Start-here map ingested** as
  `skills/ms-cs-ttia-creators-cafe/references/how-to-start-ai.md`: approved
  productivity tools, the two doors for a new idea, programs (CS TTIA, CS AI
  Ambassadors, CS Evolve) and learning (AIDP, DeepLearning.AI, MS Employee
  Development).
- **Tool lists aligned to the map.** Dataiku and UiPath now sit on Citizen-Led
  and Assisted Citizen as well as TTIA-Led; the custom app is TTIA-Led only.
  Flagged in the README for TTIA to confirm.
- Both `agent-instructions.md` files route three ways; the standard-agent
  one was trimmed to stay under 8,000 characters. Test scenarios 0a to 0f
  and 3b added for the Café.

## 2026-09-30

- **Value story chat layout.** New `references/value-story-chat.md` gives the
  exact markdown layout for the value case and the value report; generated as
  knowledge file `07-value-story.md` for the standard agent, which cannot make
  files. "Value story" and "business case" are now explicitly in scope.
- **CSLab wording removed**; TTIA-Led is delivered by automator pods.

- **Five pathways.** Tech-Led (was Pro-Dev), Partnered Development, TTIA-Led,
  **Assisted Citizen (new)**, Citizen-Led. The disqualifier test now has four
  steps and runs from the bottom of the ladder up. Every table, the form's
  "alongside the sheet" block and the standard-agent instructions updated.
- **TTIA team ingested.** Correct name (CS Technology Transformation,
  **Innovation** & Analytics), partners (GSS, CSI, CBS, RES) and the five
  pillars with their remits. New `references/ttia-team.md` in the intake skill
  and a generated `00-ttia-team.md` knowledge file for the standard agent.
- **Test scenarios** 4b–4e added: Assisted Citizen routing and misuse, old
  pathway names, team routing.
- **`scripts/install-local.sh`** installs the skills for Claude Code, GitHub
  Copilot in VS Code and Copilot CLI.

## 2026-09-29

- Split into two Copilot Studio packages (GitHub Copilot harness, standard).
- Initial skills: `ms-cs-ttia-office-hours`, `ms-cs-ttia-value-report`.
