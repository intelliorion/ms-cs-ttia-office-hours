#!/usr/bin/env bash
# Generate the classic-engine (standard harness) knowledge files from the skills,
# so there is one source of truth. Output: classic/knowledge/*.md
# Upload each file in Copilot Studio: Knowledge > Add knowledge > Upload file.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
intake="$root/skills/ms-cs-ttia-office-hours/SKILL.md"
value="$root/skills/ms-cs-ttia-value-report/SKILL.md"
out="$root/classic/knowledge"
mkdir -p "$out"

# Print from the first line matching $2 up to (not including) the first later
# line matching $3. Empty $3 means to end of file.
section() {
  awk -v start="$2" -v stop="$3" '
    !on && $0 ~ start { on = 1; print; next }
    on && stop != "" && $0 ~ stop { exit }
    on { print }
  ' "$1"
}

# Wording that only makes sense for the skills version.
adapt() {
  perl -0pe 's/compute\s+it exactly with your code sandbox from the uploaded file/show the calculation step by step from the uploaded figures/g' |
  sed -e '/^<!--.*-->$/d' \
      -e 's/ or `CSIC-intake-\*\.docx`//' \
      -e 's/the \*\*ms-cs-ttia-value-report\*\* skill/the value report (knowledge file 06-value-report)/g' \
      -e 's/ms-cs-ttia-value-report/the value report flow (06-value-report)/g' \
      -e 's/ms-cs-ttia-office-hours/the intake flow/g' \
      -e 's/[Tt]his skill/this agent/g' \
      -e 's/in this skill package//g'
}

header() { printf '# %s\n\nTTIA Office Hours knowledge file. The CS function owns every value; never fill a form field from this file.\n\n' "$1"; }

{ header "01 — Delivery pathways, tools, licence maths and durations"
  section "$intake" '^# Phase 2 ' '^# Phase 3 ' | adapt
} > "$out/01-pathways.md"

{ header "02 — Operating principles and the six forcing questions"
  section "$intake" '^# Phase 3 ' '^# Phase 5 ' | adapt
} > "$out/02-questions.md"

{ header "03 — Measures, impact and the five-card story"
  section "$intake" '^# Phase 5 ' '^# Phase 8 ' | adapt
} > "$out/03-measures.md"

{ header "04 — Alternatives, pilot oversight, verdict and escalation"
  section "$intake" '^# Phase 8 ' '^# Phase 10 ' | adapt
} > "$out/04-verdict.md"

{ header "05 — The CSIC intake form and the value case"
  section "$intake" '^# Phase 10 ' '^# Phase 11 ' | adapt
  cat <<'MD'

---

# The value case, in the case tense (after the sheet, READY cases only)

Write it in chat after the sheet. It is a case, not a report. Open with: "Nothing
here has happened yet. These are expected outcomes, each marked with how strong
its evidence is. The measure named below is the number this will be held to."

Build the claim table first, then the sections from it:

| id | tier | claim | figure | unit | source or assumption | owner |
|---|---|---|---|---|---|---|

- **measured** — the CURRENT state only (the baseline), with the system it came from. Never an outcome.
- **estimated** — the expected benefit, with the assumption and who owns it.
- **qualitative** — a capability change, one sentence, no numeral.

Sections, in order: 1 What problem are we solving (no figures) · 2 What
capability will AI unlock (no figures) · 3 What we expect to improve (the
claims, each naming measure, system of record and who pulls it) · 4 Which value
driver (one primary) · 5 Who is accountable (named leader, value realization
owner, cadence) · 6 Pathway and what it costs (path, deciding disqualifier, who
accepted ownership, annual run cost incl. licences, whose cost centre) · 7 What
we are not claiming.

Every figure comes from the claim table; none in headings or prose. No rubric
score appears as measured or estimated.

Close with: "The case claims X. The submission records the measure for X as Y,
from system Z, pulled by A. If either changes, both change." Then tell them
this is the number the value report will be held to after delivery; changing
it now is free, later is not.
MD
} > "$out/05-intake-form.md"

{ header "06 — The value report (initiatives already in service)"
  cat <<'MD'
Use this only when an initiative is in service and there is an outcome to
report. If it is not in service yet, return to the intake flow: a value report
on something that has not happened is a forecast dressed as a result.

Evidence comes only from files the user uploads in this conversation or
knowledge you actually retrieved. Aggregates only — never individual-level
personal or client data.

MD
  section "$value" '^## Step 1 ' '^## Step 6 ' | adapt
  cat <<'MD'
## Step 6 — the report, in chat

Write the report in chat in the past tense, mirroring the value case from
intake so the two can be read side by side: what was expected, and what
happened. Start with whether an intake record was found and the three Step 1
answers; then the five cards; then the five leadership questions (answered or
reported as unanswered); then **Sources read**, every document by name.

Show each tier by its layout: measured as Before / After / Source; estimated as
the figure with "Assumption: … — owned by …"; qualitative as one sentence with
no numeral. An expected benefit that did not arrive is reported as not arrived.

MD
  section "$value" '^## Before it goes to anyone' '' | adapt
} > "$out/06-value-report.md"

# Checks: nothing from the skills-only world should survive into knowledge files.
fail=0
if grep -nE '\.docx|Word document|file-creation|code sandbox|references/|SKILL\.md|skill\b|<!--' "$out"/*.md; then
  echo "✗ skills-only wording left in classic knowledge files"; fail=1
fi
n=$(wc -m < "$root/classic/agent-instructions.md" | tr -d ' ')
echo "classic/agent-instructions.md: $n characters (limit 8000)"
(( n <= 8000 )) || { echo "✗ over the limit"; fail=1; }
wc -c "$out"/*.md
exit $fail
