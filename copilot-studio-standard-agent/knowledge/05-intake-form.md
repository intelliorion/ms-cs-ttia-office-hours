# 05 — The CSIC intake form and the value case

TTIA Office Hours knowledge file. The CS function owns every value; never fill a form field from this file.

# Phase 10 — the submission sheet

Produce the sheet **only when the verdict is READY TO SUBMIT.** The
remaining fields below are asked in their own step, just before the verdict. Show it in chat in
the form's own field order, so it can be copied straight into
http://cslabs-ttia-repository.ms.com/intake.

**Never invent a value.** Every UNKNOWN carries an owner **and a date**. For
every dropdown, show the options and mark the one you are recommending.

## First, the fields the questions did not reach

The six questions and the measure fill most of the form, but not all of it.
Before the verdict, ask for what is still missing **in one message** —
the one place a short list is allowed — and say that "don't know yet" is a
fine answer as long as they name who will know and by when:

- **USE CASE** — the short name they want it filed under.
- **OPPORTUNITY DESCRIPTION** (required) — in their words: the problem, and
  what changes. No figures. You may offer a draft built only from what they
  said; it goes on the form only once they confirm or rewrite it.
- **STRATEGIC DRIVER** and **STRATEGIC OBJECTIVE** — which stated CS objective
  this serves; not a restatement of the initiative.
- **FWAI THEME** — you do not have the theme list; ask them to pick from the
  dropdown on the form, or leave it UNKNOWN with an owner and date.
- **TECH CONTACT**, **PLATFORM PRODUCT OWNER**, **PLATFORM** — named people
  and the platform, if they exist yet.
- **DELIVERY QUARTER** and **PRIORITY** — their view, with the warning in the
  dropdown guidance below.
- **PROJECT TYPE, SOLUTION TYPE, AI COMPONENT** — show your recommendation
  for each and ask them to confirm or change it. A recommendation they did
  not confirm is shown as "recommended, not confirmed".

Anything still unanswered goes on the sheet as UNKNOWN with the owner and
date they gave. If they cannot name an owner for it, write "owner: not yet
named" — never guess one. A **required (*)** field still UNKNOWN is a hard
blocker: the verdict is NOT READY, with that field on the list.

## REQUIREMENTS READINESS is the verdict

| your verdict | the honest selection |
|---|---|
| NOT AN INITIATIVE YET, or no producible measure | **Not Determined** |
| READY, but an UNKNOWN or a carry-over risk remains | **High-Level Only** |
| READY, every field named, measure and baseline owner in place, owner accepted | **Completely Documented** |

> "You want Completely Documented. The Technology squad hasn't accepted
> ownership yet, so this is High-Level Only. Close that and it changes."

## The sheet

```
CSIC intake — {use case}
Submit at: http://cslabs-ttia-repository.ms.com/intake

USE CASE *
  >
CS FUNCTION *                    CS-BSI | CS-RES | CS-GSS | CS-CSI | CS-Reimagine
  >
OPPORTUNITY DESCRIPTION *
  >   (the problem and what changes - no figures here)
BUSINESS BENEFITS
  >   cost avoided / risk reduced / capacity released - never revenue
  >   measure:
  >   system of record:
  >   who pulls it, how often:
  >   before figure exists:  YES / NO
  >   BASELINE OWNER AND DATE:
  >   annual run cost incl. licences, and whose cost centre:
REQUIREMENTS READINESS *         Not Determined | High-Level Only | Completely Documented
  >   recommended:
MD SPONSOR *
  >
PROJECT TYPE                     Strategic | BAU | Ideation
  >   recommended:
PRIORITY                         High | Medium | Low
  >   recommended:
STRATEGIC DRIVER
  >
STRATEGIC OBJECTIVE
  >   which stated objective - not a restatement of the initiative
TECH OWNER / SQUAD
  >   accepted, or only mentioned?
TECH CONTACT
  >
PLATFORM PRODUCT OWNER
  >
PLATFORM
  >
SOLUTION TYPE                    Internal | Third-Party | Hybrid | TBD
  >   recommended:
AI COMPONENT                     AI-Enabled Solution | AI-Assisted Process | No AI Component | TBD
  >   recommended:
FWAI THEME
  >
DELIVERY QUARTER
  >   a quarter with no accepted owner is a wish
```

## Guidance on the dropdowns people get wrong

**PROJECT TYPE.** Most things called Strategic are BAU. A use case with no
named client is Ideation. Choosing Strategic to attract attention raises the bar the
item is judged against.

**PRIORITY.** The function's view, not the rubric's priority score. If
everything a function submits is High, none of it is. Ask what they would drop
if this were funded.

**SOLUTION TYPE.** *Internal* is built in-house. *Third-Party* is a bought
product. *Hybrid* is a bought product with real integration work around it.
**TBD is dishonest once they know what they want built** — and if they are here, they do. Use it only when the build-or-buy choice is genuinely still open, and say who decides by when.

**AI COMPONENT.**

- **AI-Enabled Solution** — AI is in the product. Remove it and it does not work.
- **AI-Assisted Process** — AI helps a person do the work. Remove it and the
  process still runs, slower.
- **No AI Component** — say so without embarrassment. Dressing a workflow as AI
  draws scrutiny it does not need.
- **TBD** — only if the solution genuinely is not chosen yet.

## Alongside the sheet

Carry these four, outside the form, because CSIC will ask:

- **Pathway.** Tech-Led / Partnered Development / TTIA-Led / Assisted Citizen /
  Citizen-Led, which disqualifier
  decided it, and who has **accepted** ownership for that path.
- **Pilot terms**, if it is a pilot: stopping condition, review cadence,
  decision date.
- **Escalations** — framed as a decision with options and a named decider.
- **Alternatives considered** — do nothing, buy or extend, the narrow build:
  which they looked at, and why this one, in their words.

## Two blanks to call out every time

- **Nobody has accepted ownership for the pathway.** The item gets carried over.
- **BASELINE OWNER blank.** The benefit will one day be claimed against a number
  nobody captured.

---


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
