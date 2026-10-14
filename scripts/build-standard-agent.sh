#!/usr/bin/env bash
# Generate the standard-agent knowledge files (00..08) from the skills, so there
# is one source of truth. Output: copilot-studio-standard-agent/knowledge/*.md
# Upload each file in Copilot Studio: Knowledge > Add knowledge > Upload file.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
intake="$root/skills/ms-cs-ttia-csic-repository/SKILL.md"
value="$root/skills/ms-cs-ttia-value-story/SKILL.md"
cafe="$root/skills/ms-cs-ttia-creators-cafe/SKILL.md"
out="$root/copilot-studio-standard-agent/knowledge"
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
  perl -0pe 's/compute\s+it exactly with your code sandbox from the uploaded file/show the calculation step by step from the uploaded figures/g;
              s/the\s+\*\*ms-cs-ttia-value-story\*\*\s+skill/the value story (knowledge file 06-value-report)/g;
              s/the\s+\*\*ms-cs-ttia-creators-cafe\*\*\s+skill/the Creators\x27 Café flow (knowledge file 08-creators-cafe)/g;
              s/the\s+\*\*ms-cs-ttia-csic-repository\*\*\s+skill/the CSIC Repository flow (knowledge files 00-05 and 07)/g' |
  sed -e '/^[[:space:]]*<!--.*-->$/d' \
      -e 's/ or `CSIC-intake-\*\.docx`//' \
      -e 's/ms-cs-ttia-value-story/the value story flow (06-value-report)/g' \
      -e 's/ms-cs-ttia-creators-cafe/the Creators'"'"' Café flow (08-creators-cafe)/g' \
      -e 's/ms-cs-ttia-csic-repository/the CSIC Repository flow/g' \
      -e 's/ in this skill package//g' \
      -e 's/This skill/This flow/g' -e 's/this skill/this flow/g'
}

header() { printf '# %s\n\nTTIA Office Hours knowledge file. The CS function owns every value; never fill a form field from this file.\n\n' "$1"; }

{ header "00 — TTIA: what the team is and its five pillars"
  sed '1d' "$root/skills/ms-cs-ttia-csic-repository/references/ttia-team.md" | adapt
} > "$out/00-ttia-team.md"

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

This is where the AI ROI is written down. Post it in chat as one message,
after the sheet, in the exact layout of knowledge file 07-value-story,
section A: same opening, same headings, same order, claim table first, tier
layouts as shown, and after its closing line only the assignment line. Do not
use any other layout.

Every figure comes from the claim table; none in headings or prose. No rubric
score appears as measured or estimated. The value driver is the one the user
chose.

In that assignment line: this is the number the value story will be held to
after go-live; changing it now is free, later is not. Then this week's one
action.
MD
} > "$out/05-intake-form.md"

{ header "06 — The value story (initiatives already in service)"
  cat <<'MD'
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

MD
  section "$value" '^## Step 0 ' '^## Step 6 ' | adapt
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

{ header "07 — Value story layout: the value case and the value report, exactly as posted in chat"
  sed '1d' "$root/skills/ms-cs-ttia-csic-repository/references/value-story-chat.md" |
    sed -e 's/^Use this layout whenever the value case (intake, READY cases only) or the value$/Use this layout for the value case (intake, READY cases only) and the value/' \
        -e 's/^report (in service) is delivered as a chat message rather than a Word file\.$/report (in service). Both are posted in chat, as one message./' | adapt
} > "$out/07-value-story.md"

{ header "08 — Creators' Café: the CS Advanced AI Community of Practice (idea stage, tools, reuse, Café vs Repository)"
  # Everything after the front matter.
  awk 'NR==1 && /^---$/ {fm=1; next} fm && /^---$/ {fm=0; next} !fm' "$cafe" |
    perl -0pe 's/Read\s+`references\/how-to-start-ai\.md`\s+in\s+this\s+skill\s+package\s+before/Use the start-here map section at the end of this file before/g' | adapt
  printf '\n\n---\n\n'
  sed '1d' "$root/skills/ms-cs-ttia-creators-cafe/references/how-to-start-ai.md" | adapt
} > "$out/08-creators-cafe.md"

# Checks: nothing from the skills-only world should survive into knowledge files.
fail=0
if grep -nE '\.docx|Word document|file-creation|code sandbox|references/|SKILL\.md|skill\b|<!--' "$out"/*.md; then
  echo "✗ skills-only wording left in standard-agent knowledge files"; fail=1
fi
n=$(wc -m < "$root/copilot-studio-standard-agent/agent-instructions.md" | tr -d ' ')
echo "standard agent instructions: $n characters (limit 8000)"
(( n <= 8000 )) || { echo "✗ over the limit"; fail=1; }
wc -c "$out"/*.md
exit $fail
