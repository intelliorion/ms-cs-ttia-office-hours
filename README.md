# MS Corporate Services — TTIA Office Hours

A Copilot Studio agent for **TTIA (Technology Transformation, Information &
Analytics)** inside Morgan Stanley Corporate Services: the team that scores the
portfolio, routes items and prepares them for **CSIC** (the Corporate Service
Innovation Council).

The stance is the one on the record: **USER-LED, TTIA ADVISED.** The function
owns the initiative; TTIA advises, scores and routes. The agent advises hard,
decides nothing, and never fills a field on the function's behalf, because a
guessed value becomes a portfolio fact nobody remembers guessing.

## Pick your package

Copilot Studio builds each agent on one of two engines, and the agent keeps its
engine for life. Open your agent and look at the layout:

| what you see | engine | package |
|---|---|---|
| **Build** tab with a side panel: Model · **Skills** · Tools · Knowledge · Connected agents · Memory | GitHub Copilot harness (Microsoft's name; it is part of Copilot Studio) | [`copilot-studio-github-agent/`](copilot-studio-github-agent/SETUP.md) |
| Tabs such as Overview · Knowledge · Tools · Agents · Topics, no Skills | standard harness | [`copilot-studio-standard-agent/`](copilot-studio-standard-agent/SETUP.md) |

| | GitHub Copilot harness agent | standard agent |
|---|---|---|
| Instructions | 2.5k chars: identity, routing, hard rules | 5.8k chars: the whole core flow |
| Procedure lives in | two uploaded skills (`upload/*.zip`) | six knowledge files (`knowledge/*.md`) |
| How detail is used | skill loads in full when a request matches | knowledge is searched by topic |
| Ready-case output | Word documents + sheet in chat | sheet and value case in chat |
| Value report | its own skill | same agent, knowledge file 06 |
| Best when | you have the Skills panel | you don't |

Each package folder has a `SETUP.md` with every click, from creating the agent to
publishing in Teams and Microsoft 365 Copilot.

## Repository layout

```
skills/                                   source of truth — edit these
  ms-cs-ttia-office-hours/SKILL.md          intake: pathway, six questions, measure, verdict, form
  ms-cs-ttia-office-hours/references/       Word document layout
  ms-cs-ttia-value-report/SKILL.md          value report for initiatives in service
copilot-studio-github-agent/              package 1 — built from skills/
  SETUP.md · agent-instructions.md · upload/*.zip
copilot-studio-standard-agent/            package 2 — built from skills/
  SETUP.md · agent-instructions.md · knowledge/01..06-*.md
scripts/build.sh                          validate and rebuild both packages
tests/preview-scenarios.md                13 scenarios to pass before publishing either package
```

After editing anything in `skills/`, run `bash scripts/build.sh` and commit the
rebuilt packages. The two `agent-instructions.md` files are written by hand.

## Before go-live: TTIA to fill in

- **Pathway durations** — `_TBC_` in `skills/ms-cs-ttia-office-hours/SKILL.md`
  Phase 2. Until filled, the agent says what drives the timeline and never
  gives a number.
- **Dataiku reader licence rate** — about $10 per person per month, flagged to
  users as indicative. Confirm the current internal rate.

## The six questions

1. Who asked for this, by name?
2. What does the status quo cost today — and is anyone recording it?
3. Who signs, and what is their bar?
4. What is the smallest version that clears a control review?
5. What breaks if it fails, and who is accountable?
6. Does it survive a budget cycle and a reorg?

It routes by stage rather than asking all six. **Q2 is asked every time** — it
is the only one that gets harder to answer with time.

## What it produces

- **Every conversation:** a verdict in chat — READY TO SUBMIT, NOT READY with
  typed blockers, or NOT AN INITIATIVE YET.
- **Ready cases only:** the intake sheet in the form's own field order and the
  value case in the case tense; every UNKNOWN carries an owner and a date.
- **Not-ready cases:** the blocker list only. A polished form makes a thin case
  look ready.

The intake flow forces the baseline to be captured; the value report, run once
the initiative is in service, refuses to overstate what was achieved.

## Also works in VS Code and Claude Code

The `skills/` folders are standard Agent Skills. Copy them to
`~/.copilot/skills/` (GitHub Copilot in VS Code, agent mode) or
`~/.claude/skills/` (Claude Code).
