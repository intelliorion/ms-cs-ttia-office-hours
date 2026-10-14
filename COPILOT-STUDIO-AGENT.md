# TTIA Office Hours — Copilot Studio agent metadata

Everything Copilot Studio asks for when you create the agent, in the order it
asks, ready to copy. Values in code blocks are exact. Values marked
_your choice_ are yours to set. The step-by-step walkthrough for each engine
is in the two `SETUP.md` files; this page is the field sheet.

Run `bash scripts/build.sh` first so the zips and knowledge files are current.

---

## 1. Identity

| field | value |
|---|---|
| **Name** | `TTIA Office Hours` |
| **Description** (required to publish) | `Takes a Corporate Services AI idea from first thought to measured value, run by TTIA: the Creators' Café finds the right solution, the CSIC Repository identifies and measures the ROI, and the value story reports what went live.` |
| **Icon** | PNG, 100 KB or less. _Your choice_ — the TTIA or Creators' Café mark if one exists. |
| **Language** | English |
| **Solution / environment** | _your choice_ — a CS-owned environment with Copilot Credits allocated and Dataverse search on |
| **Owner** | TTIA, AI & ML pillar (named owner _TBC_) |

## 2. Which engine you are on, and what that changes

Open the agent after creating it. If the **Build** tab shows a side panel with
**Model · Skills · Tools · Knowledge · Connected agents · Memory**, you are on
the **GitHub Copilot harness**. If you see **Overview · Knowledge · Tools ·
Agents · Topics** and no Skills panel, you are on the **standard agent**. An
agent cannot change engine later.

| | GitHub Copilot harness | standard agent |
|---|---|---|
| instructions | `copilot-studio-github-agent/agent-instructions.md` (about 4,800 chars) | `copilot-studio-standard-agent/agent-instructions.md` (about 7,100 of 8,000 chars) |
| behaviour detail | three skill zips, loaded when relevant | nine knowledge files, searched by topic |
| outputs | Word documents for intake sheet, value case, value story | the same content as markdown in chat |
| setup guide | `copilot-studio-github-agent/SETUP.md` | `copilot-studio-standard-agent/SETUP.md` |

## 3. Instructions

Paste the **entire** file for your engine into **Instructions**, unchanged.
Both files are hand-written and sit under the 8,000-character limit; the
build fails if either goes over.

- GitHub Copilot harness: `copilot-studio-github-agent/agent-instructions.md`
- standard agent: `copilot-studio-standard-agent/agent-instructions.md`

## 4. Skills (GitHub Copilot harness only)

**Build → Skills → Add skill → Upload a skill.** Upload all three, in this
order. Each zip has `SKILL.md` at its root; the name and description below are
read from the zip and shown in the Skills list. If a zip is rejected, upload
that skill's bare `SKILL.md` from `skills/<name>/` instead.

| zip | skill name | level | loads when |
|---|---|---|---|
| `copilot-studio-github-agent/upload/ms-cs-ttia-creators-cafe.zip` | `ms-cs-ttia-creators-cafe` | 1 · Creators' Café | the user only has an idea or a question: not sure which tool, how to build it or how to deploy it; approved tools, access, learning, "who in TTIA do I talk to"; a Café submission, design series, proof of concept or roadshow. Never measures value. |
| `copilot-studio-github-agent/upload/ms-cs-ttia-csic-repository.zip` | `ms-cs-ttia-csic-repository` | 2 · CSIC Repository | the user knows what they want and what to expect; proposal, approved, in build, or a proof of concept with users but no CSIC record; AI ROI, a measure, a pathway for a defined use case, an escalation, the CSIC intake form |
| `copilot-studio-github-agent/upload/ms-cs-ttia-value-story.zip` | `ms-cs-ttia-value-story` | 3 · Value story | an initiative that went through CSIC and is live, whose value, benefit, outcome or ROI needs reporting against the intake baseline |

If you uploaded the earlier zips, delete `ms-cs-ttia-office-hours` and
`ms-cs-ttia-value-report` from the Skills panel first. They were renamed on
2026-10-14 and would compete with the new ones.

Each zip's full description is the `description:` field at the top of its
`SKILL.md`; Copilot Studio uses it to decide when to load the skill.

## 5. Knowledge

### Standard agent — nine files, required

**Knowledge → Add knowledge → Upload file**, one file at a time from
`copilot-studio-standard-agent/knowledge/`. Do not zip them. Use the names
and descriptions exactly; the orchestrator reads the description to decide
which file to search.

| file | name | description |
|---|---|---|
| `00-ttia-team.md` | `00-ttia-team` | What TTIA (CS Technology Transformation, Innovation & Analytics) is, its partners (GSS, CSI, CBS, RES) and its five pillars: Tech Governance & Enablement, Data & Analytics, Data Governance & Space Management, Process Optimization, AI & ML. Use for "what does TTIA do" and "who should I talk to". |
| `01-pathways.md` | `01-pathways` | The five CSIC delivery pathways (Tech-Led, Partnered Development, TTIA-Led, Assisted Citizen, Citizen-Led), which tools each allows, the disqualifiers that rule each out, licence cost maths, and what drives pathway duration. |
| `02-questions.md` | `02-questions` | The six forcing questions for CSIC intake, what good and bad answers look like, operating principles, failure patterns, and the rubric. |
| `03-measures.md` | `03-measures` | How to find a measure the function can produce, the five measure shapes, making impact meaningful, the five-card story and the value driver taxonomy. |
| `04-verdict.md` | `04-verdict` | Alternatives, pilot oversight, the intake verdict (ready, not ready, not an initiative), blocker types, the bar by stage, and escalation. |
| `05-intake-form.md` | `05-intake-form` | The CSIC intake form fields in order, dropdown guidance, REQUIREMENTS READINESS mapping, and how to write the value case for a ready submission. |
| `06-value-report.md` | `06-value-report` | The value story: how to report what a Corporate Services initiative actually delivered once in service, starting from the claim, checking the intake baseline or pre-go-live history, claim tiers, five cards, leadership questions. |
| `07-value-story.md` | `07-value-story` | The exact chat layout for the value case (intake) and the value report (in service): headings, claim table, tier layouts, closing line. Use whenever a value case, value report, value story or business case is produced. |
| `08-creators-cafe.md` | `08-creators-cafe` | The CS TTIA Creators' Café (Corporate Services Advanced AI Community of Practice): the "How I want to use & Build AI" start-here map with approved productivity tools, programs and learning; Café vs TTIA CSIC Repository; the four Café stages (Submit Idea, Review and Select, Design series, Launch and Learn); tools and pathways at Café depth; the route. Use for any idea at early stage, a Café submission, "which tool", "what have others built", or "Café or Repository?". |

### Either engine — optional sources

Add these if TTIA can supply them. They inform advice; the instructions
forbid using them to fill a form field.

| source | why |
|---|---|
| Creators' Café SharePoint page | current deadline, MS Form link, contact route, selected use cases — the agent says it does not have these until a source provides them |
| CSIC pathway and control policy documents | how a pathway or control works |
| The "How I want to use & Build AI" map (image or page) | already summarised in the Café skill; the live version keeps tool lists current |

Files labelled confidential or highly confidential are indexed but never
answered from.

## 6. Settings

| setting | value | where |
|---|---|---|
| Generative AI orchestration | **on** | Settings → Generative AI (standard agent; default on the harness) |
| Web search | **off** | Settings → Generative AI |
| General / model knowledge | leave **on** at first; the instructions forbid using it for facts or form values. Test before turning off. | Settings → Generative AI |
| File input from users | **on** (the value story reads uploaded status reports and exports) | Settings |
| Model | keep the default for the first test pass; also try Claude Sonnet 5 and keep whichever passes more scenarios | Build → Model (harness only) |
| Memory | **off** for the first release | Build → Memory (harness only) |
| Authentication | **Authenticate with Microsoft** (required for sharing with a security group) | Settings → Security |
| Content moderation | default | Settings |

## 7. Conversation starters

Overview → Conversation starters. Up to four show in Teams; the five below
are in priority order.

```
I have an idea — where does it go?
Help me write my Creators' Café submission.
Is my use case ready for CSIC?
Which delivery pathway fits this?
Report the value of an initiative that's already live.
```

## 8. Channels and publishing

| step | value |
|---|---|
| Channels | **Microsoft Teams** and **Microsoft 365 Copilot** (keep "Make agent available in Microsoft 365 Copilot" ticked) |
| First test | **See agent in Teams → Add**, try it yourself |
| Pilot | **Share** → TTIA pilot security group (harness), or **Availability options → Show to my teammates and shared users** (standard) |
| Org-wide | **Availability options → Show to everyone in my org → Submit for admin approval** |
| After every change | **Publish** again; open chats keep the old version until the user types **Start over** |

Teams app manifest values, if the admin centre asks:

| field | value |
|---|---|
| Short name | `TTIA Office Hours` |
| Short description | `Creators' Café, CSIC intake and value coach for CS, run by TTIA.` |
| Long description | the Description in section 1 |
| Developer / publisher | `Corporate Services — TTIA` |
| Privacy / terms URLs | _your choice_ — the Café or TTIA SharePoint page until a policy URL exists |

## 9. Test before publishing

Run every scenario in `tests/preview-scenarios.md` in the Preview tab
(harness) or Test pane (standard). Anything marked "fails if" blocks
publishing. The ones that catch most regressions:

| scenario | checks |
|---|---|
| 0a, 1, 2 | the right level activates: idea (Café), a use case they can define (CSIC Repository), live (value story) |
| 0c, 3b, 3c | items only move forward: no bounce between the Café and the CSIC Repository |
| 0f, 7 | no invented Café deadline or contact, no invented pathway duration |
| 8, 9 | no field filled on the user's behalf, no draft document for a weak case |
| 12 / 12b | the intake sheet and value case come out in the right form for the engine (Word on the harness, chat on standard) |

Turn the scenarios into a test set in the **Evaluate** tab so they rerun
after every change.

## 10. What the agent is, in one paragraph

For the "About" box, a Teams announcement or an admin approval request:

> TTIA Office Hours is the Corporate Services coach for getting an AI or
> automation idea from "I think this would help" to a delivery pathway, and
> for reporting what it delivered afterwards. It places a colleague on the CS
> "How I want to use & Build AI" map, and works at three levels: the
> Creators' Café finds the right solution for an early idea; the CSIC
> Repository identifies and measures the AI ROI for a use case the colleague
> can define; and the value story reports what a live initiative delivered
> against the measure recorded at intake. It is user-led and TTIA-advised: it never fills
> a form field for you, never invents a figure, a deadline or a contact, and
> every intake conversation ends in a verdict with a reason.

## 11. Still to be supplied by TTIA

The agent says "I do not have that" for each of these until a knowledge
source or a skill edit provides it. See the README's "Before go-live" list.

- Creators' Café: current deadline, MS Form link, contact route, selected
  use-case catalogue, selection timeline.
- Pathway durations and the current Dataiku licence rate.
- A contact route per TTIA pillar.
- Confirmation that Dataiku and UiPath sit on the citizen pathways, as the
  start-here map shows.
