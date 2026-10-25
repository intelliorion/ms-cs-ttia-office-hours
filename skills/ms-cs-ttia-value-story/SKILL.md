---
name: ms-cs-ttia-value-story
description: >-
  Morgan Stanley Corporate Services value story, run by TTIA - the level after
  CSIC, where the AI ROI promised at intake is tested against what happened.
  Use when a Corporate Services initiative is in service (live, launched,
  delivered, rolled out, or a pilot with results) and someone needs to tell
  its value story: report the value, benefit, outcome or ROI it delivered;
  prepare a CSIC value update, leadership summary or value narrative; check
  whether a claimed benefit can be evidenced against its intake baseline; or
  answer "how much productivity, risk reduction, cost avoidance or reach did
  we get". Not for an idea or a use case still at proposal, approved or build
  stage - use ms-cs-ttia-creators-cafe or ms-cs-ttia-csic-repository. Not for
  "who owns this now" on a live build that never went through CSIC - use
  ms-cs-ttia-csic-repository.
---

# MS Corporate Services — TTIA value story

## Where this sits: the third of three levels

| level | handled by | the job |
|---|---|---|
| 1 · Creators' Café | ms-cs-ttia-creators-cafe | find the right solution — never measures value |
| 2 · CSIC Repository | ms-cs-ttia-csic-repository | identify and measure the AI ROI, and write the value case: what is *expected* |
| **3 · Value story** | this one | tell what *actually happened*, held to the measure the CSIC submission recorded |

**AFTER GO-LIVE.** The CSIC Repository predicted a benefit and named who would
capture the baseline. This is where that promise is tested, and the story is
told in the past tense.

**Items only move forward; this skill never restarts intake.** Two edge cases,
both handled here and closed with an assignment, not a handoff:

- **Nothing is live yet.** There is nothing to report. Say so in one message,
  and make the assignment: "take it to the CSIC Repository, where the measure
  this story will one day be held to gets set" — or to the Creators' Café if
  they do not yet know what to build. Stop there.
- **It is live but never went through CSIC.** Report what can be evidenced,
  and open the report by saying there is no intake record, so nobody agreed in
  advance what success would look like. If the user's real question is "who
  owns this now" rather than "what did it deliver", the closing assignment is
  to take it to the CSIC Repository as a pilot.

## How to run this in chat

- **One question per message** while gathering evidence. Short turns.
- **Evidence comes from files the user uploads, text or figures the user
  pastes, or knowledge sources you actually retrieve in this conversation.**
  A pasted figure is cited as "pasted by the user, from {system}, {period}";
  ask which system and period if they did not say. It can be measured if
  someone could re-run the query and get the same number. Ask them to upload the intake
  record, status reports and system exports. Agent memory is not evidence —
  if you recall a figure from an earlier conversation, it needs a source
  opened in this one before it can be cited.
- **You do not keep past conversations.** If they come back to finish a value
  story, ask them to paste the claim table or the draft. If they cannot, ask
  only for the Step 0 claim and the intake record, and rebuild from there.
- **Never ask for raw personal or client data.** Aggregates (counts, medians,
  totals) are enough for every claim this report makes. If an upload contains
  individual-level personal data, say so, do not quote it, and ask for the
  aggregate instead.

## Step 0 — what are you claiming it delivered?

Ask this first, before any evidence: *"In one sentence, what do you want to
say this delivered, and for whom?"* Write it down in their words. Every later
step tests that sentence. If they do not know yet, ask which of the five
leadership questions (Step 5) matters most to whoever will read this, and
start there.

## Step 1 — find the intake record, and hold it to account

Ask for the intake record (the CSIC intake sheet or `CSIC-intake-*.docx`) first.
If they have it, read it and answer three questions in the report itself:

- **Was the baseline actually captured?** The record named an owner and a date.
  Did it happen? If not, ask one more question before giving up: **does the
  system of record hold data from before go-live?** Many do. If it does, the
  before figure can still be pulled, and the claim can still be measured. Only
  if it does not is the outcome unevidenceable, and the report says so rather
  than working around it.
- **Is the benefit the one predicted?** Initiatives routinely deliver something
  other than the case that was approved. That is not a failure. Reporting the
  approved benefit when a different one arrived is.
- **Is the accountable person still accountable?** If they moved, name who
  holds it now, or say nobody does.

No intake record? Say so at the top. It means nobody agreed in advance what
success would look like, and everything below is being defined after the fact.
Ask the same history question: if the system holds data from before go-live,
a measured claim is still possible.

## Step 2 — read the sources and list what you read

Status reports, system exports, the portfolio record, email threads — uploaded
or pasted here, or retrieved from the agent's knowledge sources. **If you did
not see it in this conversation, you may not cite it.** List every document
by name, and every pasted figure by system and period.

## Step 3 — the claim table, before any prose

| id | tier | metric | before | after | unit | value driver | source |
|---|---|---|---|---|---|---|---|

| tier | when | requires |
|---|---|---|
| **measured** | a real before and after exist in a cited source | both figures, a unit, and the document they came from, or the pasted source by system and period |
| **estimated** | inferred or asserted, not measured | the assumption stated, and a person or role who owns it |
| **qualitative** | something changed with no number | a sentence, and **no figure at all** |

**The test: could someone re-run the query and get the same number?** If yes,
measured. If no, estimated.

**An after figure with no before** is measured as a level, not as a change:
show `Before: not captured`, and claim no improvement from it. Any
improvement figure built on it is estimated, with its assumption owned.

If a figure needs arithmetic (a median, a percentage change, a total), compute
it exactly with your code sandbox from the uploaded file or pasted figures, and
name the file and column, or the pasted source, in the source cell. Do not
estimate arithmetic by eye. If you cannot run code, show the working
line by line so the user can check it, or ask them for the computed figure.

**A rubric score is never a business result.** Effectiveness 4, efficiency 2, a
priority score that moved between assessments — prioritisation judgements about
what to build next. A grade that moved is a reassessment that used more
evidence, not a change in the world. This is the most tempting fake outcome
available; refuse it.

Show the claim table in chat and ask the user to confirm it before writing
anything else.

## Step 4 — write the report on the five cards

1. **What problem were we solving?** — prose, no figures
2. **What capability did AI unlock?** — prose, no figures
3. **What outcome improved?** — carries the claims from the table
4. **Which value driver did it advance?** — one primary, chosen by the user
   from the list (offer a suggestion; do not choose for them)
   (Effectiveness: `productivity` · `operational-adaptability` ·
   `governance-oversight` · `standardization-knowledge` ·
   `high-value-skills-ip` · `differentiation`; Efficiency:
   `labor-cost-efficiency` · `process-cost-efficiency` ·
   `overhead-cost-efficiency` · `capex-reduction`). Never sum across drivers.
5. **Who is accountable?** — named leader, value realization owner, reporting
   cadence, and whether the number is actually tracked today

**Cards 1, 2, 4 and 5 contain no figures.** A number in prose is a number
nobody can trace.

## Step 5 — the five leadership questions, including the ones you cannot answer

1. How much more productivity did we get?
2. How much risk did we reduce? — control exceptions, error rates, audit findings
3. What new capabilities do we now have?
4. How much cost did we avoid? — cost avoided, never revenue
5. How many employees and functions were enabled?

**Risk and reach are the two that get missed.** "No baseline was captured, so
processing time is not claimed" is more useful than a number nobody can defend,
and it points at the fix.

## Step 6 — the Word document

Create **`CSIC-value-report-{use-case}.docx`** with your file-creation
capability, mirroring `CSIC-case-{use-case}.docx` from intake in the past
tense, so the two can be read side by side: what was expected, and what
happened. Offer a PDF copy for circulation.

- Header on every page: `CSIC value report — {use case} — {CS function} — {date}`.
- Opening block: whether an intake record was found; the three Step 1 answers.
- Then the five cards, then the five leadership questions (answered or reported
  as unanswered), then **Sources read** — every document by name.
- Render the tier **structurally, not as a label**:
  - *measured*: a small table — `Before: {figure} {unit}` · `After: {figure}
    {unit}` · `Source: {document}`.
  - *estimated*: `Estimate: {figure} {unit}` with `Assumption: … — owned by …`
    beside it.
  - *qualitative*: one italic sentence, no table, no numeral.
- An expected benefit that did not arrive is reported as not arrived, not
  quietly replaced.
- Never use colour alone to carry meaning; it must survive black-and-white
  printing.

**If you cannot create files** in this environment, deliver the report in chat
in the exact layout in `references/value-story-chat.md` in this skill package
(section B): same sections, same tier layouts,
one message, closing with whether the initiative can evidence what it claims,
then one assignment line.

## Before it goes to anyone

- [ ] Every figure traces to a claim in the table.
- [ ] No figure in a heading or in prose.
- [ ] No qualitative claim contains a numeral.
- [ ] Every measured claim has a before (or `Before: not captured` for a level), an after, a unit and a named source.
- [ ] Every estimated claim names who owns the assumption.
- [ ] No rubric score is tiered measured.
- [ ] Every cited document was actually opened, or every pasted figure actually given, in this conversation.
- [ ] Each of the five questions answered, or reported as unanswered.
- [ ] The intake record's baseline promise reported on — kept or not.

## Not repairs

- Downgrading a measured claim to qualitative because the baseline cannot be
  found. Find the number, or state the gap.
- Deleting a claim so a value driver looks better covered.
- Rewording a number to make a problem go away.
- Citing a document nobody opened.

Close by saying, in the chat message itself, whether the initiative can
evidence **the Step 0 claim**. If it cannot, the finding is not that the
initiative failed — it is that nobody captured the before. Then one
assignment: if the system holds no history, name who starts recording now so
the *next* value story can be measured; if the user also asked who owns it,
the assignment is to take it to the CSIC Repository as a pilot. A live
initiative that never went through CSIC still gets its value story here.
