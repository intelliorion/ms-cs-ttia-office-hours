# MS Corporate Services — TTIA Office Hours

A Copilot Studio agent for **TTIA (Technology Transformation, Information &
Analytics)** inside Morgan Stanley Corporate Services: the team that scores the
portfolio, routes items and prepares them for **CSIC** (the Corporate Service
Innovation Council).

The stance is the one on the record: **USER-LED, TTIA ADVISED.** The function
owns the initiative; TTIA advises, scores and routes. The agent advises hard,
decides nothing, and never fills a field on the function's behalf, because a
guessed value becomes a portfolio fact nobody remembers guessing.

## What's here

```
copilot-studio/agent-instructions.md      paste into the agent's Instructions (always on, ~2.5k chars)
skills/ms-cs-ttia-office-hours/           intake skill: pathway, six questions, measure, verdict, form
  SKILL.md
  references/documents.md                 layout of the two Word documents
skills/ms-cs-ttia-value-report/           post-service skill: the value report
  SKILL.md
scripts/build.sh                          validate both skills, zip them into dist/
tests/preview-scenarios.md                13 scenarios to run in the Preview tab before publishing
```

## Why it is built this way

- **It runs on the GitHub Copilot harness.** That is the Copilot Studio harness
  that supports skills and creates Word/PDF files natively. The standard and
  Copilot chat harnesses do not support skills.
- **The 8,000-character Instructions limit still applies**, so the agent
  instructions only cover identity, routing and the hard rules. The skills hold
  the procedure and load only when a request matches their description.
- **There are two skills rather than one**, because the orchestrator chooses a
  skill by its description. Intake (before service) and the value report
  (after service) are separate triggers, and each must refuse the other's job.
- **Critical rules live in `SKILL.md`, not in reference files.** Microsoft does
  not document how bundled reference files are read at runtime. Only the
  document layout is in `references/`, and `SKILL.md` carries a fallback
  summary in case it is not read.
- **Outputs are Word documents, not HTML.** The harness creates Word and PDF
  natively, and both print and forward cleanly.

## Deploy

1. `bash scripts/build.sh` validates the name and description rules, checks
   referenced files exist, checks the Instructions length, and writes
   `dist/ms-cs-ttia-office-hours.zip` and `dist/ms-cs-ttia-value-report.zip`,
   each with `SKILL.md` at the archive root.
2. In Copilot Studio, create an agent on the **GitHub Copilot harness**.
3. **Instructions:** paste the contents of `copilot-studio/agent-instructions.md`.
4. **Build → Skills → Add skill → Upload a skill**, once for each zip. If a zip
   is rejected, upload the bare `SKILL.md` for that skill instead. The intake
   skill still works without `references/documents.md` because of the fallback
   summary.
5. Optional **knowledge**: CSIC policy and pathway documents. Knowledge informs
   advice but never supplies a form value. That rule is in both the
   instructions and the skill.
6. Run every scenario in `tests/preview-scenarios.md` in the **Preview** tab.
   Anything marked "fails if" blocks publishing.
7. Publish to Teams / Microsoft 365 Copilot.

Suggested conversation starters:
- *"Is my idea ready for CSIC?"*
- *"Which delivery pathway fits this?"*
- *"Help me fill in the CSIC intake form."*
- *"Report the value of an initiative that's already live."*

Billing: the GitHub Copilot harness consumes Copilot Credits for building,
testing and running.

## Before go-live: TTIA to fill in

- **Pathway durations.** `_TBC_` in `SKILL.md` Phase 2. Until they are filled
  in, the agent names what drives the timeline and never gives a number.
- **Dataiku reader licence rate.** Phase 2 uses about $10 per person per month
  and tells users it is indicative. Confirm the current internal rate.

## The six questions

1. Who asked for this, by name?
2. What does the status quo cost today, and is anyone recording it?
3. Who signs, and what is their bar?
4. What is the smallest version that clears a control review?
5. What breaks if it fails, and who is accountable?
6. Does it survive a budget cycle and a reorg?

It routes by stage rather than asking all six. **Q2 is asked every time**
because it is the only one that gets harder to answer with time.

## What it produces

- **Every conversation:** a verdict in chat. READY TO SUBMIT, NOT READY with
  typed blockers, or NOT AN INITIATIVE YET.
- **Ready cases only:** the intake sheet in the form's own field order (Phase
  10), then `CSIC-intake-{use-case}.docx` and `CSIC-case-{use-case}.docx`
  (Phase 11). Every UNKNOWN carries an owner and a date.
- **Not-ready cases:** the blocker list only. A polished form makes a thin case
  look ready.

## The loop

`ms-cs-ttia-office-hours` runs at intake and forces the baseline to be
captured. `ms-cs-ttia-value-report` runs once the initiative is in service and
refuses to overstate what was achieved. The gap between them is where most
portfolio initiatives lose their evidence: the benefit is claimed months later
against a baseline nobody recorded.

## Also works in Claude Code

Copy a skill folder to `~/.claude/skills/<name>/`. The Copilot Studio-specific
guidance (one question per message, memory and Word output) is harmless there.
