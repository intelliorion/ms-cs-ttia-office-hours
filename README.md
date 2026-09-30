# MS Corporate Services — TTIA Office Hours

The CSIC intake and value coach for Morgan Stanley Corporate Services, run by
**TTIA (CS Technology Transformation, Innovation & Analytics)**. One source of
truth in `skills/`, packaged for every place people actually work:

| where | how | see |
|---|---|---|
| Copilot Studio, GitHub Copilot harness (Build tab with a **Skills** panel) | upload two skill zips | [`copilot-studio-github-agent/SETUP.md`](copilot-studio-github-agent/SETUP.md) |
| Copilot Studio, standard agent (Knowledge · Tools · Topics, no Skills) | paste instructions, upload eight knowledge files | [`copilot-studio-standard-agent/SETUP.md`](copilot-studio-standard-agent/SETUP.md) |
| Claude Code | `bash scripts/install-local.sh --claude` | skills appear next session |
| GitHub Copilot in VS Code (agent mode) and Copilot CLI | `bash scripts/install-local.sh --copilot` | reads `~/.copilot/skills` and `~/.agents/skills` |

The stance is the one on the record: **USER-LED, TTIA ADVISED.** The function
owns the initiative; TTIA advises, scores and routes. The agent advises hard,
decides nothing, and never fills a field on the function's behalf, because a
guessed value becomes a portfolio fact nobody remembers guessing.

## What it does

- **Routes to one of five delivery pathways** by disqualifier, not preference.
- **Asks the six forcing questions** by stage, one per message. Q2 (what the
  status quo costs, and who records it) is asked every time.
- **Closes a measure** someone can actually produce: system, puller, cadence,
  baseline owner and date.
- **Ends every intake in a verdict**: READY TO SUBMIT, NOT READY with typed
  blockers, or NOT AN INITIATIVE YET. Ready cases get the intake sheet in the
  form's own field order and a value case in the case tense. Not-ready cases
  get the blocker list only.
- **Reports value after go-live** with the companion skill, refusing to
  overstate what was achieved or to treat a rubric score as a result.
- **Points people at the right TTIA pillar** when the question is outside
  intake.

## The five pathways

Numbered from most Technology-owned to most business-owned. The agent routes
from the bottom up and stops at the first path that is not disqualified.

| # | pathway | one line | ruled out by |
|---|---|---|---|
| 1 | **Tech-Led** (was Pro-Dev) | Strategic platforms and major transformations | not enterprise-scale or strategically prioritised |
| 2 | **Partnered Development** | Joint delivery with Technology using approved firm frameworks | no Technology team has accepted lifecycle ownership |
| 3 | **TTIA-Led** | Targeted internal solutions and automator pods | PII, high risk, many users, large volume; no CS owner after handover |
| 4 | **Assisted Citizen** (new) | Guided builders using approved low-code and AI tools | no named builder who will stay with it; integration outside Microsoft |
| 5 | **Citizen-Led** | Local solutions within clear controls and lifecycle expectations | no proven builder; nobody to maintain it; integration outside Microsoft |

Capability goes up the ladder. Autonomy goes down. Full detail, including the
licence maths and what drives duration, is in Phase 2 of the intake skill.

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

Source: `skills/ms-cs-ttia-office-hours/references/ttia-team.md`.

## Repository layout

```
skills/                                   source of truth — edit these
  ms-cs-ttia-office-hours/SKILL.md          intake: pathway, six questions, measure, verdict, form
  ms-cs-ttia-office-hours/references/       ttia-team.md · documents.md (Word layout) · value-story-chat.md (chat layout)
  ms-cs-ttia-value-report/SKILL.md          value report for initiatives in service
copilot-studio-github-agent/              package 1 — built from skills/
  SETUP.md · agent-instructions.md · upload/*.zip
copilot-studio-standard-agent/            package 2 — built from skills/
  SETUP.md · agent-instructions.md · knowledge/00..07-*.md
scripts/build.sh                          validate and rebuild both packages
scripts/install-local.sh                  install skills for Claude Code / VS Code Copilot / Copilot CLI
tests/preview-scenarios.md                18 scenarios to pass before publishing any package
CHANGELOG.md                              what changed, when
```

## Changing something

1. Edit `skills/*/SKILL.md` or a file under `references/`.
2. Run `bash scripts/build.sh`. It validates the skill front matter, checks
   every referenced file ships, regenerates the eight knowledge files, zips the
   skills, and fails if either instructions file is over the 8,000-character
   limit.
3. The two `agent-instructions.md` files are written by hand. If the change
   affects routing, pathways or hard rules, update both.
4. Run the scenarios in `tests/preview-scenarios.md` on the package you are
   publishing. Anything marked "fails if" blocks release.
5. Commit the rebuilt packages together with the source.

## Before go-live: TTIA to confirm

- **Pathway durations.** `_TBC_` in Phase 2 of the intake skill. Until filled,
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

Routed by stage: idea asks 1 to 3; proposal adds 6; approved asks 2 to 4; in
build asks 4 to 6. In service is not intake at all: it switches to the value
report.
