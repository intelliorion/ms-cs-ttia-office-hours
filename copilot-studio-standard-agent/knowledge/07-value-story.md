# 07 — Value story layout: the value case and the value report, exactly as posted in chat

TTIA Office Hours knowledge file. The CS function owns every value; never fill a form field from this file.


Use this layout for the value case (intake, READY cases only) and the value
report (in service). Both are posted in chat, as one message.
Reproduce the structure exactly: same headings, same order, same tier layouts.
Fill every placeholder from the claim table or write `⚠ UNKNOWN — owner: {name},
by: {date}`. If the user has not named the owner or the date, ask for them
before posting; if they still cannot, write `owner: not yet named` or `by: not
set` — that is an honest blocker, never an invented name or deadline. Never
drop a section; if it has nothing in it, say so in one line. Post it as one
message, and nothing after the closing line in that message: the week's
assignment and any question go in the next message.

The claim table has as many rows as there are claims: a measured baseline and
its estimated improvement are two rows; a monthly volume is its own row; the
annual run cost is a row, tiered estimated until an invoice makes it measured.
Dates, claim ids and section numbers are not figures: only benefit and cost
values count, and those live in the claim table and sections 3 and 6 only.

If the user asks only for the value story, post only this; do not re-post the
intake sheet first.

Tier layouts are the same in both tenses:

- **measured** → a two-row table. At intake it is the baseline only (`Today`);
  in service it is `Before` / `After`.
- **estimated** → a two-row table: the figure, then `Assumption: … — owned by …`.
- **qualitative** → one sentence in italics, no table, no numeral.

---

## A. Value case (intake, case tense)

```
## CSIC value case — {use case}
{CS function} · prepared {date} · advisory draft, the function owns every value

> Nothing here has happened yet. These are expected outcomes, each marked with
> how strong its evidence is. The measure named in section 3 is the number this
> initiative will be held to after delivery.

### Claim table
| id | tier | claim | figure | unit | source or assumption | owner |
|---|---|---|---|---|---|---|
| C1 | measured | … | … | … | {system} | {who pulls it} |
| C2 | estimated | … | … | … | {assumption} | {owner} |
| C3 | qualitative | … | — | — | — | {owner} |

### 1. What problem are we solving
{prose, no figures}

### 2. What capability will AI unlock
{prose, no figures. If No AI Component: retitle "What capability changes" and say so}

### 3. What we expect to improve
**C1 — {claim}** · measure: {measure} · system: {system} · pulled by: {who, how often}
| Today | {figure} {unit} |
|---|---|
| Source | {system} |

**C2 — {claim}** · measure: {measure} · system: {system} · pulled by: {who, how often}
| Expected | {figure} {unit} |
|---|---|
| Assumption | {assumption} — owned by {owner} |

**C3 — {claim}**
*{one sentence, no numeral}*

### 4. Which value driver
Primary: **{driver}**. Secondary: {drivers or "none"}. Never summed.

### 5. Who is accountable
- Accountable leader: {name}
- Value realization owner: {name}
- Reporting cadence: {cadence}
- Baseline owner and start date: {name}, {date}

### 6. Pathway and what it costs
- Pathway: **{Tech-Led | Partnered Development | TTIA-Led | Assisted Citizen | Citizen-Led}**
- Deciding disqualifier: {which test ruled the paths below it out}
- Ownership accepted by: {name/team} or ⚠ not yet accepted
- Data involved: {classification; personal, client or third-party data: yes/no; as the user stated it}
- Annual run cost incl. licences: {claim id and figure, or UNKNOWN}
- Cost centre: {whose}

### 7. What we are not claiming
- {gap or boundary, e.g. "does not reduce headcount"}
- {"processing time not claimed: no baseline yet"}

---
**The case claims {X}. The submission records the measure for {X} as {Y}, from
{system}, pulled by {person}. If either changes, both change.**
```

---

## B. Value report (in service, past tense)

```
## CSIC value report — {use case}
{CS function} · {date} · sources read: {n}

### Intake record
- Intake record found: YES / NO {if NO: "success was not defined in advance; everything below is defined after the fact"}
- Baseline captured as promised: YES / NO — {owner named at intake, what happened}
- Benefit delivered is the one predicted: YES / NO — {what arrived instead, if different}
- Accountable person still accountable: YES / NO — {who holds it now}

### Claim table
| id | tier | metric | before | after | unit | value driver | source |
|---|---|---|---|---|---|---|---|
| R1 | measured | … | … | … | … | … | {document, column} |
| R2 | estimated | … | — | … | … | … | {assumption} |
| R3 | qualitative | … | — | — | — | … | — |

### 1. What problem were we solving
{prose, no figures}

### 2. What capability did AI unlock
{prose, no figures}

### 3. What outcome improved
**R1 — {metric}**
| Before | {figure} {unit} |
|---|---|
| After | {figure} {unit} |
| Source | {document} |

**R2 — {metric}**
| Estimate | {figure} {unit} |
|---|---|
| Assumption | {assumption} — owned by {owner} |

**R3 — {claim}**
*{one sentence, no numeral}*

Expected at intake but not arrived: {claim from the case, or "none"}

### 4. Which value driver did it advance
Primary: **{driver}**. Secondary: {drivers or "none"}. Never summed.

### 5. Who is accountable
- Accountable leader: {name}
- Value realization owner: {name}
- Reporting cadence: {cadence}
- Tracked today: YES / NO

### The five leadership questions
1. How much more productivity did we get? — {answer with claim id, or "not answered: {why}"}
2. How much risk did we reduce? — {…}
3. What new capabilities do we now have? — {…}
4. How much cost did we avoid? — {cost avoided, never revenue}
5. How many employees and functions were enabled? — {…}

### Sources read
- {document name} — {what it supplied}

---
**Can this initiative evidence what it claims? {YES / PARTLY / NO} — {one sentence. If no: "nobody captured the before"; name who should start now.}**
```

---

## Checks before posting either

- Every benefit or cost figure in sections 3 and 6 (case) or 3 and the
  leadership questions (report) traces to a claim id.
- No benefit or cost figure in sections 1, 2, 4, 5 or any heading. Dates and
  claim ids are fine.
- No qualitative claim contains a numeral.
- No rubric score appears as measured or estimated.
- Every UNKNOWN carries the ⚠ marker, an owner and a date.
- Report only: every source listed was opened in this conversation.
