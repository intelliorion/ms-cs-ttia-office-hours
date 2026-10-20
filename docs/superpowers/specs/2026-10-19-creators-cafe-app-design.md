# Creators' Café operator app — design

Status: draft for review · 2026-10-19
Mockup: Creators' Café Console (claude.ai artifact, private) — real submissions, simulated progress
Related: `skills/ms-cs-ttia-creators-cafe/`, the submitter playbook (workflow, team checklist, emails E1–E11)

## 1. Purpose

One person runs the CS TTIA Creators' Café. Submissions can arrive in bulk or in a trickle. The app does
the routine work of every stage — reading submissions, tracking each idea's steps, drafting emails,
grouping ideas into cohorts, recommending tools per feature, running the design brainstorm, producing
roadshow material — and keeps a knowledge graph of who is building what with which tools. The operator
approves; the app does not send, publish or decide on its own.

**Success looks like:** the operator drops whatever arrived today into one folder, reviews a short list of
"needs your OK" items, approves drafts, and can see at any moment which step every idea is on.

**The Café rules still hold.** The app finds the right solution; it never measures value or ROI. Ideas
only move forward: an idea that is defined, sponsored and serves people beyond its team is routed to the
CSIC Repository, not kept in the Café. No personal, client or third-party data is used in a proof of
concept.

### Non-goals

- Sending email, posting to Teams or writing to SharePoint. The operator sends from Outlook.
- Measuring benefits, savings or KPIs (that is the CSIC Repository's job).
- A server, a database or a multi-user service. One operator, one workspace folder.
- Building the PoCs end to end. The app writes starter kits and plans; a builder (or a coding agent the
  operator starts) builds.

### Before the first round (decisions, not build work)

1. **AI use on submission content** is approved by Tech Governance & Enablement, naming the agent and
   model allowed. Until then the app runs in no-AI mode.
2. **Personal data is defined**: names and roles of participants are allowed (every transcript has
   them); data *about* individuals, clients or third parties is held.
3. **Prompt-injection guard** (section 10) is in place and tested.
4. **Workspace location and retention** are decided, including how to delete someone's data on request.

## 2. How it runs

- A local web app (Node and TypeScript) started with `cafe start`, at http://localhost:4100.
- It needs one coding agent on the machine for AI steps, tried in this order: Claude Code headless
  (`claude -p`), GitHub Copilot CLI, a small VS Code Copilot helper extension. A firm model gateway can be
  added later behind the same adapter.
- With no AI available, everything still works by hand: import, stages, templates, cohorts, graph
  (from structured fields only).

## 3. Workspace

Everything is plain files in one folder kept in git. The app's screens read the folders; there is no
separate database.

```
cafe-workspace/
  rounds/ROUND-2026-Q4/round.yaml   open, deadline, decisions-by, design-series start, roadshow
  inbox/                 drop anything here; inbox/held/ for files with sensitive data
  ideas/CAFE-2026-003-third-party-invoice-assessment/
    idea.yaml            submission, round, stage, checklist ticks and due dates, route
    review.md            the five criteria, the decision and the reason
    csic-handoff.md      only when routed to CSIC: the pre-filled intake draft
    understanding.md     what the AI understood, and what it assumed
    approach.md          features and the tool picked for each
    design.md  plan.md  design-session.md
    kit/{copilot-studio,power-apps,dataiku,custom-app}/
    emails/  notes/  attachments/
    outcome.md  history.log
  cohorts/COH-2026-02-document-understanding/{cohort.yaml, agenda.md, invites/, notes/}
  roadshows/RS-2026-Q4/{deck.pptx, script.md, run-of-show.md, invite-list.md, feedback.md}
  graph/{nodes.jsonl, edges.jsonl}
  templates/             E1–E11 and the data-held reply
  rules/                 settings.yaml, ontology.yaml, tools.yaml, pathways.yaml, stages.yaml
  exports/               status.csv for submitters, monthly report
  skills/                the skills each AI step runs
```

IDs are `CAFE-{year}-{seq}` plus a slug. Re-importing the same row never creates a second idea.

### idea.yaml, from the real submission form

The current form (SharePoint list export) has these columns, and each maps to one field:

| Form column | idea.yaml field | Notes |
|---|---|---|
| Title | `title` | |
| Submitter Name | `people.submitter` | kept locally for emails only |
| CS Function | `function` | BSI, GSS, … |
| Region | `region` | AMER, APAC, … |
| Participation Type | `participation` | Individual or Team |
| Team Members and Lead | `people.team[]` with `role` | lead, sponsor, member |
| Business Challenge | `challenge` | |
| Desired Outcomes | `outcomes[]` | multi-select, split on `;#` |
| Current Process | `current_process` | |
| Support Requested | `support[]` | multi-select, split on `;#`; drives cohorts |
| Have you already experimented | `experimented` | Yes or No |

Plus app-owned fields: `id`, `round`, `stage`, `checklist` (step id → done, by whom, when, from which
file, due date),
`flags[]`, `route`, `cohort`, `tools` (feature → tool).

### Rounds and settings

- **Round.** Every idea belongs to one round (`ROUND-2026-Q4`). The round holds its dates: opens,
  submission deadline, decisions by, design series starts, roadshow. "Not this round" means the next
  round.
- **Settings** (`rules/settings.yaml`): Café form link, CSIC Repository intake link, Teams link for
  sessions, distribution list for the call for ideas, firm deck template, and the operator's capacity.
- Every template reads round dates and settings by name (`[DEADLINE]`, `[FORM LINK]`,
  `[REVIEW DATE]`, `[CSIC REPOSITORY INTAKE LINK]`, `[ROOM OR TEAMS LINK]`, `[DISTRIBUTION LIST]`).
  **An email that still needs an unset setting cannot be approved**; its button opens the settings
  screen. Content placeholders (`[QUESTION 1]`) are filled by the operator in Outlook, and the Outbox says
  how many are left.
- **Capacity.** The operator sets the most ideas they can take into the design series per round and the
  most sessions per week. Review warns when a selection goes over the cap; Cohorts shows sessions per
  week against the limit.

## 4. Stages

Four Café stages (Submit Idea, Review and Select, Design series, Launch and Learn), plus Closed. **The
operator sets each idea's stage freely**, forward or back, from a menu on its row in Ideas, or closes it
(reuse, routed to CSIC, not this round, Café pattern, stop and keep the learning). Setting a stage on a
closed idea reopens it. The app never blocks a stage change and never moves an idea on its own; it logs
every change in `history.log` ("Submit Idea → Design series"). It **suggests** moves, each with Yes and
No: after a review decision (select → Design series; reuse, CSIC or not this round → close that way) and
after E3, E4, E5, E6 or E10 is marked sent (E3 → Design series, E4 → close as reuse, E5 → close as
routed to CSIC, E6 → close as not this round, E10 → Launch and Learn). A suggestion is only offered when
it would change something, and it is never applied without the operator's Yes.

Steps (appendix A) **tick themselves as a background log, not shown as a checklist**: an email step when
that email is marked sent, "feasibility assessed" when a review is saved, "answers received" when the
operator clicks Reply received, "tool per feature" when picks are confirmed, "design.md approved" when it
is approved. Every tick is logged in `history.log` with its source. Steps never gate a stage.

**Review** (usually at Review and Select, but any open idea can be reviewed) uses five criteria: a PoC
is feasible with approved tools and no live non-Microsoft system; a builder is named and can attend; synthetic, aggregated or sample data is enough; it fits a
theme or cohort; it could be reused beyond the submitting team. The AI pre-ticks them and suggests a
decision (select, reuse, route to CSIC, not this round, or ask first) with a reason; the operator
changes anything, then saves. Saving writes `review.md`, ticks "feasibility assessed" (except for "ask
first"), drafts the matching email (E3, E4, E5, E6 or E2) and suggests the matching move; it never closes
or moves the idea itself. A closed idea is reopened (by setting its stage) before it is reviewed again. **Review pack:** one click writes
`review-pack-{date}.md` for the TTIA review meeting (each idea's flags, criteria, suggested decision and
graph theme); the meeting transcript then comes back through the Inbox.

**Due dates and reminders.** Steps that wait on someone carry a due date: a reply to E2 is due five days
after it is marked sent. Ideas past a due date show amber in the Ideas list ("E2 sent 7 days ago · reply
due …"), with a Reply received button that records the answer and clears the amber, and the offer to
draft the reminder email (E2R). Session reminders go out the day before each
session.

**Routing to CSIC.** When the decision is "route to CSIC", the app builds `csic-handoff.md`: a pre-filled
CSIC intake draft from the Café record (opportunity description, current process, users, sponsor and
whether they are a confirmed MD, expected change without figures, systems and data, Café history), each
field with its source. The app suggests closing the idea as "routed to CSIC"; when the operator does,
it sets a follow-up check four weeks later (did it reach the CSIC Repository?) and fills that date into
the handoff, which reads "[FOLLOW-UP DATE]" until then.

An idea can close early: **reuse**, **routed to CSIC** or **not this round** during review; **reuse**,
**Café pattern**, **CSIC** or **stop, keep the learning** at the end of the design series. A closed idea
keeps the stage it reached.

## 5. Inbox: drop anything

The operator drops files into `inbox/` (or onto the Inbox screen), or pastes a note. Accepted: Forms and
SharePoint list exports (.xlsx, .csv), Outlook emails (.msg, .eml), Teams transcripts (.vtt, .docx),
documents, PDFs and screenshots.

For each item the AI says what it is, which idea or cohort it belongs to and how sure it is (Café ID in
a subject line is high confidence; title, sender or content matches are lower), then sorts its actions
into three kinds:

| Kind | Examples | Behaviour |
|---|---|---|
| **Safe** | file an email or attachment, skip an exact duplicate row, record answers in idea.yaml, split multi-select answers | applied at once, each with Undo |
| **Needs your OK** | create ideas, record steps, draft emails, change a flag | waits for Apply |
| **Held** | any file with personal, client or third-party data | moved to `inbox/held/`, not read further, never copied into an idea; the only actions are delete, and draft a reply asking for counts |

**Every inbox item also updates the knowledge graph** (section 9), with the same three kinds:

- *Safe, applied with Undo:* links read from form fields of an applied import, and AI links at 0.7 or
  above between nodes that already exist (for example a transcript confirming that an idea needs
  catalogue classification).
- *Needs your OK:* a new person, a new capability or system not yet in the list, a merge of two nodes,
  and any change to someone's role on an idea (submitted, sponsors, related).
- *Unconfirmed:* AI links below 0.7 are added dashed and listed until confirmed.
- People who are only in an email's To or Cc line do not become nodes; a person enters the graph only
  with a role on an idea. Held files never reach the graph.

Low-confidence matches always ask ("two GSS ideas could fit — which one?"). Later, a Power Automate flow
can save Café emails and new list rows into a synced OneDrive folder used as `inbox/`, so nothing needs
dropping by hand; the app still never touches the mailbox.

## 6. Tool picker and design

1. The AI splits the idea into features and recommends one tool per feature from the approved list
   (Microsoft Copilot with no build, Copilot Studio, Power Apps, Dataiku, UiPath, custom app), with a reason
   and any pathway flag. The operator picks; picks go to `approach.md`.
2. The design brainstorm runs in the app, one question at a time with suggested answers, using the
   embedded brainstorming skill. "I don't know" turns a question into an E2 draft to the submitter.
   `design.md` fills in live and always ends with a **Café check**: no value measured, data rules, and
   any feature that would take the idea to CSIC.
3. On approval the app writes `plan.md` and a starter kit per picked tool. Custom-app builds are handed
   to a coding agent ("Build with Claude Code / Copilot").

## 7. Cohorts, sessions and roadshows

- Cohorts group ideas by the capability they share (from the graph) and the support they asked for
  (`support[]`). Session dates come from the round's design-series start (weekly by default); until it is
  set they show "set in Round".
- **Calendar invites.** Sessions and roadshows get `.ics` files (date, time, Teams link, agenda) in the
  cohort's `invites/` folder for the operator to open and send from Outlook.
- Invites, follow-ups and the roadshow pack (deck on the firm template if supplied, script, run of show,
  invite list, feedback form) are drafts in the cohort or roadshow folder.
- The roadshow invite list comes from the graph: teams whose ideas share a capability with what is shown.

## 8. Communications

Templates E1–E11 from the submitter playbook, plus: **E0** call for ideas (round open, deadline, form
link), **E0B** deadline reminder, **E2R** reminder when E2 has no reply, **E6** not this round, a session
reminder, a reschedule notice and the data-held reply. Drafts carry the Café ID in the
subject so replies match back. The AI fills what it knows from the idea and leaves every unknown date,
link or contact as a `[PLACEHOLDER]`; it never invents one. Outbox flow: draft → approved and copied for
Outlook → marked as sent (which ticks the matching step and starts any reply clock).

**Status for submitters.** `exports/status.csv` lists each Café ID, title and public status (for example
"Under review · decision by {decisions-by date}"), with no names. The Café page or the Copilot Studio
agent can read it, so "was mine selected?" has an answer without the operator.

## 9. Knowledge graph

**Why.** With more than a handful of ideas, the useful questions are about connections: which ideas need
the same capability, who has already built with Dataiku, which team should see this demo, which ideas
touch a system that would take them to CSIC.

The design follows the operator's own Orion knowledge-graph app (`../llmfun`): a curated ontology, an
extraction pipeline of separate agents, entity resolution, graph-grounded Q&A and path finding. It differs
where the Café needs it to: a fixed ontology rather than one inferred per document, provenance and
confidence on every link, files instead of an in-memory session, and no role-play of real people.

### Ontology (fixed, in `rules/ontology.yaml`)

Like an Orion domain template, but not re-inferred per run, so graphs stay comparable across months.

| Entity type | Examples from the first three submissions |
|---|---|
| Entity | the organisation the teams belong to: Corporate Services, from the “(CS)” after each Submitter Name |
| Team | the CS Function from the form: BSI, GSS (region is an attribute of the person and the idea, not part of the team) |
| Person | one node per real person, reused across ideas; the role sits on the link to each idea, not on the person |
| Idea | Email scheduler · RFx CoE intake & ticketing · Third party invoice assessment, each carrying its **status** |
| Pain point | back-and-forth email · re-keying into a tracker · status chased by hand · manual research per invoice |
| Capability | reading and sending email · meeting coordination · ticketing and status · document reading and translation · catalogue classification · record lookup and matching |
| Tool | Microsoft Copilot · Copilot Studio · Power Apps · Dataiku · UiPath · custom app |
| System or data | Outlook calendars · RFx CoE mailbox · RFx CoE Excel tracker · third-party invoices · Service Catalogue (TPPM) · iShield |
| Cohort, Pattern | added as the Café runs |

Relations, in UPPER_SNAKE_CASE as in Orion: `HAS_TEAM` (entity → team), `HAS_MEMBER` (team → person),
`SUBMITTED`, `SPONSORS`, `RELATED` (person → idea; the link's description keeps the form's wording,
such as "also listed as Lead" or "Team member"), `REPLACES` (idea → pain point),
`NEEDS` (idea → capability), `BUILT_WITH` (capability → tool), `USES_DATA` (capability → system),
`IN_COHORT`, `REUSES`, `SIMILAR_TO`.

A person's tie to an idea is always one of three roles: **submitted** (Submitter Name), **sponsors**
(Sponsor in Team Members and Lead) or **related** (anyone else listed). Someone on two ideas has one
node and two role links, so "what else is this person involved in" is one hop.

Entity, team and person are always separate nodes, joined entity → team → person → idea, so "who in GSS
has ideas, and who leads them" is a walk along the graph. A link the form does not state (for
example whether the RFx CoE sponsor sits in GSS) is added at low confidence and stays unconfirmed until the
operator confirms it.

**Idea status** is an attribute of the idea, not a node (Orion's entity versus attribute rule). It is
read live from `idea.yaml` (stage plus steps done, for example "Design series · 12 of 25"), shown on the
idea node, coloured by stage, and usable as a filter: selecting a status highlights those ideas and
everything linked to them.

**Entities versus attributes** (Orion's rule): email addresses, phone numbers, employee or work IDs,
KPI figures and dates are attributes in `idea.yaml`, never nodes. This also keeps contact details out of
anything the graph exports.

### Pipeline

1. **Structured pass, no AI.** Form fields become nodes and links directly: people and roles, team,
   region, support requested, tool picks, cohort. As in Orion's rule for tabular data, the row subject
   (the idea) is the primary entity and every column is either a related entity or an attribute.
2. **Extraction agent.** Reads the business challenge, current process, design and notes, and returns
   entities and links using only the ontology's types, as JSON validated against a schema.
3. **Resolution agent.** Proposes merges ("Service Catalogue" and "TPPM Service Catalogue") under
   Orion's rule: if unsure, do not merge. Merges, and any new capability not yet in the list, go to the
   Inbox as "needs your OK".
4. **Write.** `graph/nodes.jsonl` and `graph/edges.jsonl`. Every link carries its relation, a short
   description, the source file and a confidence. Links from the form or from an approved design are
   1.0; AI links below 0.7 are drawn dashed and listed as unconfirmed until the operator confirms them.
   The graph can be rebuilt from the folders at any time, so it never drifts from the ideas.

### Screen

- Orion's graph view, as Orion draws it with vis-network: dot nodes coloured by type (Orion's palette),
  a force layout that settles and then freezes, arrows, link labels (toggle), zoom and fit. Clicking a
  node lights its neighbourhood in indigo and dims the rest; search enlarges matches. Type toggles and a
  side panel showing each link with where it came from and a Confirm button. Idea nodes show their
  status under the name.
- A summary line in Orion's style: entities by type, links, unconfirmed links, most connected idea and
  tool. Status chips (for example "Under review (2)") filter the view; an idea's panel shows its status,
  stage and a link to its row in Ideas.
- **Suggestions** (never applied automatically): shared capabilities worth one pattern, shared pain
  points across functions, cohort membership, first session topic, roadshow invitees, a builder who
  already knows a tool, and ideas touching a system that needs a live connection (a CSIC flag).
- **Find a connection** (Orion's shortest path): pick any two nodes; the app shows each hop with its
  relation and source, and the AI explains what the chain means for reuse, cohorts or routing.
- **Ask the graph** (Orion's grounded Q&A): answers come only from the graph and say which links they
  used, for example "Who should come to the Agent Design Guidance session?".
- **What if** for tools and rules, not people: "What if Dataiku is not allowed on the citizen
  pathway?" follows `BUILT_WITH` and `NEEDS` back to the affected features and ideas. Orion's first-person
  interviews are left out: role-playing real colleagues is not appropriate here.

### Storage and libraries

No graph database: at Café volumes (tens to hundreds of ideas) JSON-lines files are enough. Path finding
and degree use graphology in the Node app; the view uses vis-network, as Orion does. Orion's code is
under PolyForm Noncommercial; reusing it inside the firm is the licensor's decision, otherwise the Café
app reimplements the same ideas.

### People

Names stay in the local workspace for emails and invite lists. Anything the app exports or shares
(decks, screenshots, graph images) shows people by role unless the operator chooses otherwise.

## 10. AI layer

- One adapter interface (`run(skill, input) → structured output`) over Claude Code, Copilot CLI or the
  VS Code helper, gateway later.
- Every AI step is a skill in `skills/`: understand a submission, triage an inbox item, split features
  and recommend tools, brainstorm and design, draft an email, build the graph, draft a deck. The TTIA
  Café and CSIC skills are reused for routing and the Café check. The brainstorming and writing-plans
  skills are embedded for design (MIT licence, notice kept).
- Output is validated against a schema before any file is written. A coding agent may write only inside
  the idea's `kit/`.
- **Everything dropped in the Inbox is data, never instructions.** The AI steps that read it run with no
  shell, no network and no file access of their own; they return structured output that the app checks
  and writes. Tests include emails that try to give the AI instructions.

## 11. Data protection

- Allowed: names and roles of submitters, team members and meeting participants (needed for emails,
  invites and the graph). Not allowed: data *about* individuals, clients or third parties (records,
  IDs, contact details beyond work email, client names, invoice contents). Such files are held.
- Files with such data are held (section 5). PoCs use synthetic, aggregated, redacted or sample data.
- The workspace stays on the firm machine; git remotes are the operator's choice.

## 12. Error handling

- An AI step that fails or returns invalid output leaves the item in "needs your OK" with the reason
  and a "do it by hand" path; nothing half-written lands in an idea folder.
- Import of a malformed export reports which rows and columns could not be read; good rows still import.
- Cut-off cells in exports (for example `#Imp…`) are kept as-is and flagged for the operator to check.
- Undo restores the files touched by a safe action from the history log.

## 13. Testing

- Unit tests for import mapping (the real column set above), de-duplication, setting the stage (free moves forward and back,
  close and reopen, every change logged, suggestions never applied on their own), template
  filling (no invented values: every unknown stays a placeholder) and graph building (only ontology
  types; attributes never become nodes; every link has a source; rebuild from folders is identical).
- Golden tests per skill: fixed inputs (the three real submissions, redacted) → schema-valid outputs.
- Inbox triage tests: a held file is never copied; low confidence always asks; Undo restores state;
  emails with embedded instructions change nothing.
- Settings gating: an email needing an unset setting cannot be approved; setting it fills every draft.
- Due dates: marking E2 sent starts the clock; after five days the idea shows overdue and E2R is offered.
- An end-to-end run on a sample workspace: drop the export, apply, pick tools, approve a design, mark
  emails sent, and check every idea's steps and stage.

## 14. Worked examples (the first three real submissions)

| Idea | What the app does |
|---|---|
| **CAFE-2026-001 Email scheduler** (BSI, AMER; Agent Design Guidance, AI Solution Brainstorming; experimented) | Flags a **reuse check**: an approved tool may already schedule these meetings. Drafts E2 asking whether they tried Microsoft Copilot in Outlook and what stopped it. If not a reuse, it joins COH-2026-01 with a Copilot Studio email agent. |
| **CAFE-2026-002 RFx CoE Intelligent Intake & Ticketing Agent** (GSS, APAC; team with lead and sponsor; not yet experimented) | Flags that it **passes the CSIC test**: defined, sponsored, serves 200+ Sourcing Managers beyond the team, with operating-model KPIs to evidence. Drafts E5 routing it to the CSIC Repository; the Café does not measure those KPIs. A tracker export naming Sourcing Managers is **held**. |
| **CAFE-2026-003 Third Party Invoice Assessment** (GSS, APAC; AI Solution Brainstorming; experimented) | Flags "Individual" participation with six people listed. Splits into four features: read and translate invoices (Copilot Studio), suggest TPPM Category and Sub Category (Dataiku), suggest iShield ID for Enhanced or Specialized risk (Dataiku on an exported list; a live lookup would go to CSIC), analyst confirms (Power Apps). PoC on redacted sample invoices. |

The graph links 002 and 003 through **catalogue classification** (RFx activities, TPPM categories) and
001 and 002 through **reading and sending email**, which is how the two cohorts were formed.

## 15. Open questions for TTIA

1. The form link, deadline and design-series dates (the app leaves them as placeholders until given).
2. Two Support Requested and one Desired Outcomes value are cut off in the export (`#Collab…`, `#Imp…`):
   what are the full option names?
3. Is Microsoft Copilot in Outlook available to submitters for scheduling (affects 001's reuse check)?
4. Does iShield have an export a Café PoC may use, or does any iShield use mean CSIC?
5. Dataiku and UiPath on the citizen pathways (open from the Café skill).
6. Where the workspace lives (a firm OneDrive folder, a git repo, or both).
7. Form changes, from the first three submissions: a one-sentence desired outcome (what changes, for
   whom); who would use it day to day; does it need personal, client or third-party data (Yes, No, Not
   sure); who would build it and can they attend; if a sponsor is named, are they an MD who has agreed;
   full option names in the export.

## 16. Later (after the first round runs)

Access and licence request tracking per idea; build milestones between sessions; a demo check ("did it
show the one thing?") before the route; a synthetic-data skill; roadshow feedback forms imported through
the Inbox; 30- and 90-day check-ins on Café patterns for outgrowth; a published library of patterns and
lessons; a monthly pipeline report for TTIA leadership; Café service levels (time to acknowledge, time to
decision, stalled ideas); capability trends for TTIA's roadmap; a backup operator and handover note;
spot checks of AI triage accuracy.

## Appendix A. Background log of steps (not shown)

The 25 steps the app records quietly in `idea.yaml` and `history.log`, each marked **Team** or **TTIA**.
They are not shown as a checklist and do not gate any stage; the steps once marked *needed* are in bold
for reference only.

| Stage | Steps (needed in bold) |
|---|---|
| 1 Submit Idea | **idea and outcome in their words** · **no personal, client or third-party data** · checked the Café use cases · **Café ID, duplicates checked** · **E1 acknowledgement sent** |
| 2 Review and Select | **feasibility assessed** · theme tagged · E2 questions sent · answers received · **builder named** · **decision email sent** (E3, E4, E5 or E6) |
| 3 Design series | attendance confirmed · E7 invites sent · **the one thing the PoC must show** · **smallest input, synthetic or aggregated** · **tool per feature** · **design.md approved** · builder has tool access · E8 follow-up sent · **E9 route sent** |
| 4 Launch and Learn | **E10 roadshow booked** · slides and demo received · demo given, four feedback questions asked · reuse write-up received · **E11 feedback and decision sent** |
