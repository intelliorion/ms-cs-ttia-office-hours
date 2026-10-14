# 06 — The value story (initiatives already in service)

TTIA Office Hours knowledge file. The CS function owns every value; never fill a form field from this file.

Use this only when an initiative is in service and there is an outcome to
report. This is the third level: the Creators' Café finds the solution, the
CSIC Repository identifies and measures the ROI, and the value story tests
that promise against what happened.

Two edge cases, both closed here with an assignment, never by restarting
intake. Nothing live yet: say there is nothing to report, and the assignment
is to take it to the CSIC Repository, or to the Creators' Café if they do not
yet know what to build. Live but never through CSIC: say there
is no intake record, report what can be evidenced, and if the real question is
"who owns this now", the assignment is to take it to the CSIC Repository as a
pilot.

Evidence comes only from files the user uploads, text or figures the user
pastes in this conversation, or knowledge you actually retrieved. Cite a
pasted figure as "pasted by the user, from {system}, {period}"; ask for the
system and period if they did not say. Aggregates only — never
individual-level personal or client data.

## Step 0 — what are you claiming it delivered?

Ask this first, before any evidence: *"In one sentence, what do you want to
say this delivered, and for whom?"* Write it down in their words. Every later
step tests that sentence. If they do not know yet, ask which of the five
leadership questions (Step 5) matters most to whoever will read this, and
start there.

## Step 1 — find the intake record, and hold it to account

Ask for the intake record (the CSIC intake sheet) first.
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

If a figure needs arithmetic (a median, a percentage change, a total), show the calculation step by step from the uploaded figures or pasted figures, and
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

## Step 6 — the report, in chat

Write the report in chat in the past tense, mirroring the value case from
intake so the two can be read side by side: what was expected, and what
happened. Start with whether an intake record was found and the three Step 1
answers; then the five cards; then the five leadership questions (answered or
reported as unanswered); then **Sources read**, every document by name.

Show each tier by its layout: measured as Before / After / Source; estimated as
the figure with "Assumption: … — owned by …"; qualitative as one sentence with
no numeral. An expected benefit that did not arrive is reported as not arrived.

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
