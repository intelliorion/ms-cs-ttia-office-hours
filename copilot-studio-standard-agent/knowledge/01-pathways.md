# 01 — Delivery pathways, tools, licence maths and durations

TTIA Office Hours knowledge file. The CS function owns every value; never fill a form field from this file.

# Phase 2 — the delivery pathways

Explain these early, not at the end. A function that understands the ladder
asks better questions for the rest of the conversation.

**Capability goes up. Autonomy goes down.** That is the whole trade.

## The five pathways at a glance

CSIC recognises **five** delivery pathways. They are numbered from the most
Technology-owned (1) to the most business-owned (5). Read the ladder from the
bottom up when routing: start at 5 and stop at the first path that is not
disqualified.

| # | pathway | one line | who builds | who owns for life |
|---|---|---|---|---|
| 1 | **Tech-Led** | Strategic platforms and major transformations | Technology, dedicated team | Technology |
| 2 | **Partnered Development** | Joint delivery with Technology using approved firm frameworks | Technology squad + CS partner developers | Technology (asset), CS (outcome) |
| 3 | **TTIA-Led** | Targeted internal solutions and automator pods | TTIA (CSLab / automator pods) | Corporate Services, after handover |
| 4 | **Assisted Citizen** | Guided builders using approved low-code and AI tools | a business builder, guided by TTIA | the business |
| 5 | **Citizen-Led** | Local solutions within clear controls and lifecycle expectations | the business, on its own | the business |

Use the official names above on the sheet. Older material says "Pro-Dev" for
Tech-Led and lists only four paths; **Assisted Citizen is the one that was
added.** If the user uses the old words, translate without fuss.

## 5 · Citizen-Led — business builds and owns, TTIA advises

Business teams independently build and manage **low-complexity** solutions using
**approved** citizen-development tools, within clear controls and lifecycle
expectations, with technology visibility and governance oversight. **The
business owns the solution end-to-end.**

Tools: **Copilot · Copilot Studio · Power Apps · AI@MS agents**

What it demands: that it is genuinely low-complexity, on an approved tool, that
someone in the team has built this kind of thing before, and that the business
has accepted **support**, not just build. There is no squad behind you. When it
breaks in eighteen months, it is still yours.

## 4 · Assisted Citizen — business builds with a guide, business owns

The same tools and the same ownership as Citizen-Led, with one difference:
**the builder is guided.** TTIA (or an approved enablement programme) pairs
with a named person in the function who will build it, so the team does not
need someone who has already done it. Guidance covers tool choice, patterns,
controls and the handover into support.

Tools: the Citizen-Led set — **Copilot · Copilot Studio · Power Apps · AI@MS
agents** — used with guidance.

What it demands: **a named builder who will do the work and stay with it.**
Guidance is not delivery: TTIA does not build it and does not hold the pager.
The business still owns build **and** support. Everything that rules out
Citizen-Led on integration or maintenance grounds rules out Assisted Citizen
too; the only disqualifier it removes is "no proven builder".

> "You have someone keen but nobody who has built a Copilot Studio agent
> before. That is exactly what Assisted Citizen is for. It is still yours to
> run afterwards, though — guidance ends, ownership does not."

## 3 · TTIA-Led — TTIA builds, Corporate Services owns

TTIA designs, builds and delivers **targeted internal solutions**, through
**CSLab** and its **automator pods**, that **Corporate Services chooses to own
and support throughout their lifecycle**. It creates delivery capacity outside
the traditional Technology Book of Work while keeping required governance and
controls.

Tools: everything Citizen-Led has, **plus Dataiku · UiPath · Snowflake Cortex ·
a vibe-coded custom app.** This is the path that takes a citizen-built idea to
the next level.

What it demands: **CS must choose to own and support it.** TTIA builds it and
hands it over. If nobody in CS has agreed to hold it afterwards, this is the
orphan waiting to happen — and it is the single most common reason an item is
carried over.

## 2 · Partnered Development — Technology owns the asset, you own the outcome

Corporate Services and Technology jointly deliver, **using approved firm
frameworks**. Partner Developers add capacity inside a Technology squad.
**Technology retains lifecycle ownership.**

This is the one people misunderstand. "Partnered" sounds like help. Here is what
it actually means:

| area | Technology | CS / Partner Developer |
|---|---|---|
| Ownership | owns the asset and lifecycle | owns the **business outcome** |
| Development | leads engineering governance | adds delivery capacity |
| Architecture | accountable | contributes within agreed scope |
| Testing & code review | accountable | may participate, **cannot self-approve** |
| Deployment | Technology only | **no production deployment** |
| Production support | Technology accountable | limited to agreed support and knowledge transfer |
| Squad direction | Technology squad leads the work | Partner Developer works within the squad |
| People management | n/a | remains with the CS manager |

Say it plainly: **Partnered gives you engineering capacity, not control.** If
what you want is to keep control, you want TTIA-Led — and that means CS accepts
support forever.

What it demands: **a named Technology team must accept lifecycle ownership.**
Not "was mentioned in a meeting". Accepted.

## 1 · Tech-Led — Technology builds, owns and operates

Technology-led delivery for **strategic platforms and major transformations**:
enterprise-scale, strategically prioritised solutions requiring dedicated
engineering teams, full SDLC governance and long-term Technology ownership and
support. (Older material calls this Pro-Dev.)

What it demands: that it is genuinely enterprise-scale and strategically
prioritised enough to earn a dedicated team. Most things are not, and saying so
early is a kindness.

## Choosing the pathway — the disqualifier test

**Do not start from what they want. Start from what rules each path out.** People
choose a pathway by how fast it looks; the path is actually decided by
integration, scale, risk and who will maintain it.

Ask these in order, from the bottom of the ladder up, and stop at the first
path that is not disqualified.

### 1. Can it be Citizen-Led?

All three must be true. One "no" disqualifies it.

- **Does the requesting team have a person who can actually build this** in
  Copilot Studio, Copilot, or configure agents in AI@MS? Not "we could learn" —
  a named person who has done it.
- **Will that team maintain it?** The client side is accountable for
  maintenance. TTIA advises; it does not hold the pager.
- **Does it stay inside Microsoft?** Citizen-Led cannot take complex
  integrations — no database connections, no API sources outside Microsoft
  products. A **live connection** to a non-Microsoft system fails this test. A
  **published extract** that already lands in SharePoint or Teams on a schedule
  someone else owns does not; ask which one they mean before ruling it out.

> "You need one connection to a system that is not Microsoft. That rules out
> Citizen-Led on its own, whatever else is true."

The maintenance question is the one people skip and regret. Ask it directly:
*"In eighteen months, when the person who built this has moved teams and it
breaks — who fixes it?"* If there is no answer, this is not Citizen-Led however
simple the build looks.

### 2. Can it be Assisted Citizen?

Only one thing changes from step 1: **the builder does not need to have done it
before.** Ask:

- **Is there a named person in the function who will build it and stay with
  it?** Willing and available, not "someone on the team could".
- The maintenance and stays-inside-Microsoft tests are **unchanged**. If either
  failed in step 1, it fails here too.

If the only thing that stopped Citizen-Led was a missing proven builder, this
is the path. If the team has no builder at all, or the tools cannot do the job,
move up.

> "Nobody has done this before, but you have someone who will. Assisted Citizen
> gets you a guide. It does not get you a squad."

### 3. Can it be TTIA-Led?

This is where **CSLab** and the **automator pods**, the TTIA delivery teams,
engage. They handle what a citizen build cannot:

- integration with existing data sources — **LDAP, Manhattan, Security**, and
  the like
- additional coding: data flows, workflows, format conversion
- the wider toolset: Dataiku, UiPath, Snowflake Cortex, a vibe-coded custom app

**But it has a ceiling, and the ceiling is firm.** TTIA-Led requires
**below-medium scale**:

- fewer users
- lower risk level
- **no PII**

Any one of those broken and it is not TTIA-Led, regardless of how keen anyone is.

Badge, access, HR, visitor and occupancy data usually identifies people. When
the integration touches one of those, raise the PII question in the same breath
as TTIA-Led — do not let them leave thinking CSLab is settled.

> "The integration is fine for CSLab. The PII is not. That takes this to
> Partnered whatever the volume looks like."

Remember the handover: **TTIA builds, Corporate Services owns and supports.** A
TTIA-Led item still needs a named CS owner who has accepted it for life.

### 4. Partnered Development or Tech-Led

Everything above the TTIA-Led ceiling:

- complex integration
- live ingestion
- large data volumes
- high risk
- **PII**

Between the two: **Partnered Development** adds CS delivery capacity inside a
Technology squad, on approved firm frameworks, with Technology owning the
asset. **Tech-Led** is Technology-led for strategic platforms and major
transformations, with a dedicated team and full SDLC. Most things are not
Tech-Led.

## The disqualifiers, one line each

Say these plainly when they apply — they save more time than anything else in
the conversation:

| if this is true | it cannot be |
|---|---|
| no proven builder in the requesting team | Citizen-Led (consider Assisted Citizen) |
| no named builder at all, or nobody will maintain it | Citizen-Led or Assisted Citizen |
| any integration outside Microsoft products | Citizen-Led or Assisted Citizen |
| PII, high risk, many users, or large volume | TTIA-Led |
| live ingestion or complex integration | Citizen-Led, Assisted Citizen or TTIA-Led |
| not a strategic platform or major transformation | Tech-Led |
| a large audience on a per-seat tool, with a benefit smaller than the licence | that tool, on any pathway |

### Failure pattern: path shopping

Choosing the fastest-looking path rather than the one the constraints allow.
Almost always shows up as Citizen-Led chosen for something with a real
integration, Assisted Citizen chosen to get TTIA to build it, or TTIA-Led
chosen for something carrying PII. Test the claim against the disqualifiers
rather than accepting the preference — and say what you are doing, so it reads
as saving them a rejection rather than blocking them.

## The licence maths — ask audience size early

**Complexity is not the only thing that rules a tool out. Cost per seat does
too, and it works in the opposite direction.** Scale normally pushes an item UP
the ladder. Per-seat licensing can push it AWAY from a tool even when the
complexity would be fine.

Ask this in the first few minutes, not at the end:

> **"How many people end up touching this — and are they using it, or just
> reading the output?"**

### Do the arithmetic out loud

`licence per seat × audience × 12 = annual run cost`

A Dataiku reader licence is roughly **$10 per person per month** (indicative —
tell the user the current internal rate should be confirmed with TTIA). For a
dozen people that is a rounding error. For four hundred it is roughly $48,000 a
year, every year, for something whose benefit nobody has sized yet.

> "Four hundred users on a reader licence is about forty-eight thousand a year.
> That is not a reason to stop — it is a reason to know what the benefit is
> before you commit to it. What does the current process cost?"

**This is why the cost question forces the benefit question.** You cannot judge
a per-seat tool without a sized benefit.

Copilot and Copilot Studio are licensed or metered too. Citizen-Led is not free
— it is *already paid for* if the team has the licences or capacity, and a new
cost if they do not. Ask which.

### The pattern that usually saves it: authors vs readers

Most initiatives have **a few people who build and many who consume**. If the
consumers only need the output, they may not need the tool at all.

> "Five people build in Dataiku, five licences. The other four hundred read a
> published output somewhere they already have — SharePoint, a dashboard, an
> email. The cost question disappears."

Ask it directly: **"Does the audience need the tool, or the answer?"**

### When cost genuinely disqualifies

| situation | consequence |
|---|---|
| large audience, per-seat tool, unsized benefit | **not ready** — size the benefit first |
| large audience, per-seat tool, benefit smaller than the annual licence | the tool is wrong, not the idea |
| large audience who only need the output | re-architect: few authors, published output |
| licence cost has no owning cost centre | a carry-over risk — someone has to pay it every year |

The annual run cost belongs in **BUSINESS BENEFITS** as a net position, and in
the sustainability answer: **whose cost centre carries it, every year.**

## How long each pathway takes


| pathway | typical time to live | what drives the variation |
|---|---|---|
| 5 Citizen-Led | _TBC_ | builder availability; approval of the tool |
| 4 Assisted Citizen | _TBC_ | builder availability; guide availability |
| 3 TTIA-Led (CSLab / automator pods) | _TBC_ | CSLab capacity; number of data sources |
| 2 Partnered Development | _TBC_ | Technology squad availability; SDLC gates |
| 1 Tech-Led | _TBC_ | prioritisation cycle; dedicated team formation |

**While a cell says _TBC_, do not state a duration** — not a range, not
"typically", not a number from a knowledge source about another team. Say what
drives it instead: "this waits on CSLab capacity" or "this waits on a Technology
squad accepting it".

If someone needs it by a date, work backwards out loud: *"Partnered means a
squad has to accept it, then SDLC gates. If you need this in six weeks, the
honest options are a Citizen-Led version that does less, or moving the date."*

---

