# Document specifications — Phase 11

Two Word documents, created only when the verdict is READY TO SUBMIT. Both must
read correctly when printed in black and white and when forwarded to someone who
was not in the conversation.

General rules for both:

- Portrait A4/Letter, one standard sans-serif font, no images, no logos, no
  firm branding.
- A header line on every page: `CSIC — {use case} — {CS function} — prepared {date}`.
- A footer on every page: `Advisory draft prepared with TTIA Office Hours. The
  function owns every value in this document.`
- **Never use colour alone to carry meaning.** Anything highlighted also carries
  a text marker, so it survives black-and-white printing.

---

## 1. `CSIC-intake-{use-case}.docx` — the submission

What gets typed into the repository, laid out so it can be checked at a glance
before anyone opens the form.

**Top block** (before any field):

| | |
|---|---|
| Verdict | READY TO SUBMIT |
| REQUIREMENTS READINESS | the mapped value (High-Level Only / Completely Documented) |
| Open UNKNOWNs | the count |
| Submit at | http://cslabs-ttia-repository.ms.com/intake |

**Fields** — one two-column table in the form's order (Phase 10 sheet):

- Column 1: field name. Required fields end with ` *`.
- Column 2: the value, exactly as the user gave it.
- **Dropdowns:** list every option on one line, the recommended option in bold
  and followed by `← recommended`, e.g.
  `Strategic | **BAU ← recommended** | Ideation`.
- **UNKNOWN values:** the cell text starts with `⚠ UNKNOWN —` followed by
  `owner: {name}, by: {date}`. Shade the cell light yellow as well. An UNKNOWN
  must be impossible to skim past.
- BUSINESS BENEFITS is a nested block: measure · system of record · who pulls
  it and how often · before figure exists (YES/NO) · baseline owner and date ·
  annual run cost and cost centre.

**After the fields**, three headed sections the form has no field for:

1. **Pathway** — the path, the disqualifier that decided it, who has
   **accepted** ownership (or `⚠ not yet accepted`).
2. **Pilot terms** — stopping condition, review cadence and reporter, decision
   date. Omit only if it is not a pilot, and say "Not a pilot."
3. **Escalations** — each as: decision required · options · who decides · what
   is blocked and its cost per cycle · what has been tried. "None." if none.

---

## 2. `CSIC-case-{use-case}.docx` — the value case, in the case tense

What a sponsor reads and what CSIC discusses. **It is a case, not a report.**

**Opening paragraph, verbatim in substance:** "Nothing in this document has
happened yet. These are expected outcomes, each marked with how strong its
evidence is. The measure named in section 3 is the number this initiative will
be held to after delivery."

**Build the claim table first**, then write the sections from it:

| id | tier | claim | figure | unit | source or assumption | owner |
|---|---|---|---|---|---|---|

| tier | at submission this means | requires |
|---|---|---|
| **measured** | the CURRENT state only — "work orders take 4.1 days today, from the workflow tool". The baseline, never an outcome. | the figure and the system it came from |
| **estimated** | the expected benefit | the assumption stated, and a person or role who owns it |
| **qualitative** | a capability change with no number | a sentence, and no figure at all |

**Sections, in order:**

1. **What problem are we solving** — prose, no figures.
2. **What capability will AI unlock** — prose, no figures. If AI COMPONENT is
   "No AI Component", title it "What capability changes" and say so.
3. **What we expect to improve** — one block per claim, rendered by tier:
   - *measured (baseline)*: a two-row table — `Today: {figure} {unit}` and
     `Source: {system}`.
   - *estimated*: a two-row table — `Expected: {figure} {unit}` and
     `Assumption: {assumption} — owned by {owner}`.
   - *qualitative*: a single sentence in italics, no table, no numeral.
   Every block also names the measure, system of record and who pulls it.
4. **Which value driver** — one primary from the taxonomy; secondaries listed,
   never summed.
5. **Who is accountable** — named leader, value realization owner, reporting
   cadence.
6. **Pathway and what it costs** — the path, the deciding disqualifier, who has
   accepted ownership, the annual run cost including licences, and whose cost
   centre carries it.
7. **What we are not claiming** — the gaps and boundaries, named ("does not
   reduce headcount", "processing time not claimed: no baseline yet").

**Rules that do not relax because it is a forecast:**

- Every figure comes from a row in the claim table. No number in a heading or
  in prose.
- No qualitative claim contains a numeral.
- No rubric score appears as measured or estimated. A prioritisation grade is
  not a business result in any tense.
- The tier is visible from the layout, not only from a label: a reader who
  never learns the vocabulary still sees that a qualitative claim is a
  different kind of thing.

**Closing line of the document:** "The case claims {X}. The submission records
the measure for {X} as {Y}, from {system}, pulled by {person}. If either
changes, both change."

---

## Before sending either file

- [ ] The verdict in the file matches the verdict stated in chat.
- [ ] Every value came from the user in this conversation — none from memory,
      knowledge sources or inference.
- [ ] Every UNKNOWN has an owner and a date, and the ⚠ marker.
- [ ] The measure in the case matches BUSINESS BENEFITS in the intake file.
- [ ] No figure in case sections 1, 2, 4, 5 or in any heading.
