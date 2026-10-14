# MS Corporate Services — TTIA Office Hours

The Corporate Services guide for taking an AI idea from first thought to
measured value, for Morgan Stanley Corporate Services, run by **TTIA (CS
Technology Transformation, Innovation & Analytics)**. One source of truth in
`skills/`, packaged for every place people actually work:

Creating the Copilot Studio agent? Every field it asks for, ready to paste,
is in [`COPILOT-STUDIO-AGENT.md`](COPILOT-STUDIO-AGENT.md).

| where | how | see |
|---|---|---|
| Copilot Studio, GitHub Copilot harness (Build tab with a **Skills** panel) | upload three skill zips | [`copilot-studio-github-agent/SETUP.md`](copilot-studio-github-agent/SETUP.md) |
| Claude Code | `bash scripts/install-local.sh --claude` | skills appear next session |
| GitHub Copilot in VS Code (agent mode) and Copilot CLI | `bash scripts/install-local.sh --copilot` | reads `~/.copilot/skills` and `~/.agents/skills` |

The stance is the one on the record: **USER-LED, TTIA ADVISED.** The function
owns the initiative; TTIA advises, scores and routes. The agent advises hard,
decides nothing, and never fills a field on the function's behalf, because a
guessed value becomes a portfolio fact nobody remembers guessing.

## Three skills, three levels

| level | skill | the user | the job |
|---|---|---|---|
| **1 · Creators' Café** | `ms-cs-ttia-creators-cafe` | has an idea or a question; knows the problem but not which tool, how to build it or how to deploy it | **find the right solution**: tool, pathway, reuse, proof of concept. Never measures value. Ends in a route. |
| **2 · CSIC Repository** | `ms-cs-ttia-csic-repository` | knows what they want and what to expect | **identify and measure the AI ROI**: pathway, six questions, a measure and baseline owner, a verdict, the intake form and the value case |
| **3 · Value story** | `ms-cs-ttia-value-story` | it went through CSIC and is live | tell what actually happened, held to the measure the CSIC submission recorded |

**The routing test**, asked once if it is not obvious: *"Do you know what you
want built and roughly how, who would use it, and what you expect it to
change?"* All three answered concretely goes to the CSIC Repository; any one
missing goes to the Café. Sponsorship, funding and stage labels are not the
test: a missing sponsor is a blocker inside the CSIC Repository, not a reason
to send someone back.

**Items only move forward.** The Café hands an idea to the CSIC Repository
when it matures or outgrows the Café: a non-Microsoft system, personal data,
users beyond the builder's team, an owner other than the builder, or a
request for ROI. The CSIC Repository never sends anything back; its only
pointer to the Café is the closing assignment of a NOT AN INITIATIVE YET
verdict. The value story never restarts intake. A proof of concept with users
but no CSIC record goes to the CSIC Repository as a pilot.

## What it does

- **Places people on the start-here map** first: approved productivity tools,
  programs and learning resources get a pointer, not a submission.
- **Runs the Creators' Café** for ideas: Café vs Repository, one idea and one
  desired outcome in the submitter's own words, what review looks for,
  scoping a proof of concept for the design series, and launch-and-learn.
  No ROI, no baseline, no verdict.
- **Routes to one of five delivery pathways** by disqualifier, not preference.
- **Asks the six forcing questions** by stage, one per message. Q2 (what the
  status quo costs, and who records it) is asked every time.
- **Closes a measure** someone can actually produce: system, puller, cadence,
  baseline owner and date.
- **Ends every intake in a verdict**: READY TO SUBMIT, NOT READY with typed
  blockers, or NOT AN INITIATIVE YET. Ready cases get the intake sheet in the
  form's own field order and a value case in the case tense. Not-ready cases
  get the blocker list only.
- **Tells the value story after go-live**: starts from what the user claims,
  checks it against the intake baseline (or system history from before
  go-live), and refuses to overstate what was achieved or to treat a rubric
  score as a result.
- **Points people at the right TTIA pillar or program** from the Café.

## The five pathways

Numbered from most Technology-owned to most business-owned. The agent routes
from the bottom up and stops at the first path that is not disqualified.

| # | pathway | one line | tools on the start-here map | ruled out by |
|---|---|---|---|---|
| 1 | **Tech-Led** (was Pro-Dev) | Strategic platforms and major transformations | Technology's platforms | not enterprise-scale or strategically prioritised |
| 2 | **Partnered Development** | Joint delivery with Technology using approved firm frameworks | approved firm frameworks | no Technology team has accepted lifecycle ownership |
| 3 | **TTIA-Led** | Targeted internal solutions and automator pods | citizen set + custom app (+ Snowflake Cortex) | PII, high risk, many users, large volume; no CS owner after handover |
| 4 | **Assisted Citizen** (new) | Guided builders using approved low-code and AI tools | Copilot Studio · Power Apps · Dataiku · UiPath | no named builder who will stay with it; integration outside Microsoft |
| 5 | **Citizen-Led** | Local solutions within clear controls and lifecycle expectations | Copilot Studio · Power Apps · Dataiku · UiPath | no proven builder; nobody to maintain it; integration outside Microsoft |

Capability goes up the ladder. Autonomy goes down. Full detail, including the
licence maths and what drives duration, is in Phase 2 of the CSIC Repository skill.

## The TTIA team

TTIA works hand-in-hand with partners across GSS, CSI, CBS and RES. Five
pillars; the agent uses them for "who do I talk to", never for a form value.

| pillar | remit |
|---|---|
| Tech Governance & Enablement | portfolio governance, tech evaluation, financial planning, onboarding and lifecycle oversight, book-of-work prioritisation |
| Data & Analytics | BI and AI intelligence solutions, jSpi (GSS self-service), GSS data agenda, Tableau to Power BI / Snowflake-Cortex |
| Data Governance & Space Management | Global Data Quality Policy 3.0 for critical reports, space data, CAD and system admin, CSDW to Snowflake/Cortex |
| Process Optimization | process understanding, re-engineering, automation with modern tooling, programme monitoring and reporting |
| AI & ML | AI literacy and training, use-case discovery, internal AI solutions, third-party AI tool governance, partnered dev and enterprise tool enablement |

Source: `skills/ms-cs-ttia-csic-repository/references/ttia-team.md`.

## Repository layout

```
skills/                                   source of truth — edit these
  ms-cs-ttia-creators-cafe/SKILL.md         Creators' Café: start-here map, Café vs Repository, four Café stages, route
  ms-cs-ttia-creators-cafe/references/      how-to-start-ai.md (the CS start-here map: tools, doors, programs, learning)
  ms-cs-ttia-csic-repository/SKILL.md       CSIC: pathway, six questions, measure (ROI), verdict, form, value case
  ms-cs-ttia-csic-repository/references/    ttia-team.md · documents.md (Word layout) · value-story-chat.md (chat layout)
  ms-cs-ttia-value-story/SKILL.md           value story: what an initiative in service actually delivered
copilot-studio-github-agent/              package 1 — built from skills/
  SETUP.md · agent-instructions.md · upload/*.zip
scripts/build.sh                          validate and rebuild the package
scripts/install-local.sh                  install skills for Claude Code / VS Code Copilot / Copilot CLI
tests/preview-scenarios.md                scenarios to pass before publishing
CHANGELOG.md                              what changed, when
```

## Changing something

1. Edit `skills/*/SKILL.md` or a file under `references/`.
2. Run `bash scripts/build.sh`. It validates the skill front matter, checks
   every referenced file ships, zips the skills, and fails if the
   instructions file is over the 8,000-character limit.
3. `copilot-studio-github-agent/agent-instructions.md` is written by hand. If
   the change affects routing, pathways or hard rules, update it.
4. Run the scenarios in `tests/preview-scenarios.md` in the Preview tab. Anything marked "fails if" blocks release.
5. Commit the rebuilt packages together with the source.

## Before go-live: TTIA to confirm

- **Creators' Café specifics.** The skill knows the four stages, the two form
  questions (idea, desired outcome), first-come first-served review on
  feasibility and themes, and the Café-vs-Repository comparison. It does not
  know the current deadline, the MS Form link, the selection timeline, the
  Café page and form URLs, the design-series dates, or the catalogue of
  selected use cases, and says so. Supply them as a knowledge source or add
  them where the TTIA comment marks the spot in
  `skills/ms-cs-ttia-creators-cafe/references/how-to-start-ai.md`.
- **Personal data on the citizen pathways.** The pathway definitions name
  PII only against TTIA-Led. The CSIC Repository skill now also rules
  Citizen-Led and Assisted Citizen out on personal, client or third-party
  data, including a published extract, because a lower ceiling than TTIA-Led
  made no sense. Confirm, or change step 1 of the disqualifier test.
- **Escalation route.** The skill tells users to raise an escalation through
  the CSIC Repository as an escalation item. Confirm the actual route: a
  form field, a mailbox, or a CSIC agenda owner.
- **Citizen toolset.** The "How I want to use & Build AI" map shows Dataiku
  and UiPath on Citizen-Led and Assisted Citizen as well as TTIA-Led, with
  the custom app only on TTIA-Led. The skills now say that. Earlier material
  had Dataiku and UiPath as TTIA-Led only; confirm which is current, and
  whether a citizen builder in Dataiku or UiPath needs any extra approval.
- **Pathway durations.** `_TBC_` in Phase 2 of the CSIC Repository skill. Until filled,
  the agent says what drives the timeline and never gives a number.
- **Assisted Citizen disqualifiers.** The skill treats it as Citizen-Led minus
  the "proven builder" test: same tools, same integration ceiling, business
  still owns build and support, a named builder who will stay with it. If the
  pathway definition allows more than that (a wider toolset, or TTIA holding
  part of the support), change the Assisted Citizen section and step 2 of the
  disqualifier test.
- **CS function list.** The form uses CS-BSI, CS-RES, CS-GSS, CS-CSI and
  CS-Reimagine. The TTIA overview names GSS, CSI, CBS and RES as partners. The
  form values were left as they are; confirm whether CBS and BSI are the same
  thing and whether the dropdown has changed.
- **Contact route per pillar.** `_TBC_` in `references/ttia-team.md`. Until
  filled, "who do I talk to" gets a pillar name and an honest "no named
  contact".
- **Dataiku reader licence rate.** About $10 per person per month, flagged to
  users as indicative. Confirm the current internal rate.

## The six questions

1. Who asked for this, by name?
2. What does the status quo cost today, and is anyone recording it?
3. Who signs, and what is their bar?
4. What is the smallest version that clears a control review?
5. What breaks if it fails, and who is accountable?
6. Does it survive a budget cycle and a reorg?

Routed by stage inside the CSIC Repository: proposal, and a proof of concept
with users, ask 1 to 3 and 6; approved asks 2 to 4; in build asks 4 to 6. An
idea never reaches these questions: it is a Café conversation. A live
initiative that went through CSIC is a value story.
