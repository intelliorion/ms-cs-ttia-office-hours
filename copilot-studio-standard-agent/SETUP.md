# TTIA Office Hours — standard agent

Use this package when your Copilot Studio agent shows **Overview · Knowledge ·
Tools · Agents · Topics** and has no **Skills** panel (the "standard harness").
If you do have a Skills panel, use `../copilot-studio-github-agent/` instead. (The **Add skill → manifest URL** option in
Settings is an older Bot Framework feature — ignore it; it does not take these
files.)

What changes versus the skills version:

| | GitHub Copilot harness agent | this package |
|---|---|---|
| procedure | `SKILL.md`, loaded when relevant | core flow in Instructions (6.5k of 8k chars) |
| detail | inside the skill | seven knowledge files, searched by topic |
| intake + case output | Word documents | markdown in chat |
| value report | separate skill | same agent, knowledge file 06 |

## 1. Get the files

```bash
git clone https://github.com/intelliorion/ms-cs-ttia-office-hours.git
cd ms-cs-ttia-office-hours
bash scripts/build.sh              # regenerates knowledge/*.md from the skills
```

The generated files are also committed, so you can download them straight from
GitHub.

## 2. Instructions

**Overview → Instructions → Edit.** Paste all of `agent-instructions.md`.
Save.

## 3. Knowledge — upload seven files

**Knowledge → Add knowledge → upload file**, one at a time, from `knowledge/`.
Do not zip them — knowledge only accepts individual files. Use these names and
descriptions exactly — the orchestrator uses the description to decide when to
search each file.

| file | name | description |
|---|---|---|
| `00-ttia-team.md` | 00-ttia-team | What TTIA (CS Technology Transformation, Innovation & Analytics) is, its partners (GSS, CSI, CBS, RES) and its five pillars: Tech Governance & Enablement, Data & Analytics, Data Governance & Space Management, Process Optimization, AI & ML. Use for "what does TTIA do" and "who should I talk to". |
| `01-pathways.md` | 01-pathways | The five CSIC delivery pathways (Tech-Led, Partnered Development, TTIA-Led/CSLab, Assisted Citizen, Citizen-Led), which tools each allows, the disqualifiers that rule each out, licence cost maths, and what drives pathway duration. |
| `02-questions.md` | 02-questions | The six forcing questions for CSIC intake, what good and bad answers look like, operating principles, failure patterns, and the rubric. |
| `03-measures.md` | 03-measures | How to find a measure the function can produce, the five measure shapes, making impact meaningful, the five-card story and the value driver taxonomy. |
| `04-verdict.md` | 04-verdict | Alternatives, pilot oversight, the intake verdict (ready, not ready, not an initiative), blocker types, the bar by stage, and escalation. |
| `05-intake-form.md` | 05-intake-form | The CSIC intake form fields in order, dropdown guidance, REQUIREMENTS READINESS mapping, and how to write the value case for a ready submission. |
| `06-value-report.md` | 06-value-report | How to report the value of a Corporate Services initiative already in service: intake record check, claim tiers, five cards, leadership questions. |

Uploaded knowledge needs **Dataverse search** on in the environment. If upload
fails, ask your admin to turn it on.

## 4. Settings

- **Generative AI orchestration: on** (Settings → Generative AI). Without it
  the agent cannot follow the instructions across turns.
- **Web search: off.** Public web content must never shape CSIC advice.
- **General/model knowledge: leave on at first.** The agent needs it to hold a
  coaching conversation; the instructions forbid using it for facts or form
  values. Microsoft notes that turning it off can drop valid responses — test
  before changing.
- **File input from users: on**, if you want the value report to read uploaded
  status reports and exports (see Microsoft's "Allow file input from users").
- **Conversation starters** (Overview): *Is my idea ready for CSIC?* · *Which
  delivery pathway fits this?* · *Help me fill in the CSIC intake form.* ·
  *Report the value of an initiative that's already live.*

## 5. Test

In the **Test** pane, run `../tests/preview-scenarios.md`. On this engine,
scenario 12 expects the sheet and value case **in chat**, not Word files.
Anything marked "fails if" blocks publishing.

## 6. Publish and share

1. **Publish** (top right).
2. **Channels → Teams and Microsoft 365 Copilot → Add channel** (keep *Make agent
   available in Microsoft 365 Copilot* ticked).
3. **See agent in Teams → Add** to try it yourself.
4. Share with the TTIA pilot group: **Channels → Teams and Microsoft 365 Copilot
   → Availability options → Show to my teammates and shared users**.
5. Org-wide: **Availability options → Show to everyone in my org → Submit for
   admin approval**.

After any change: **Publish** again, then type **Start over** in an open chat to
pick up the new version.

## Keeping it in sync

Edit the skills (`skills/*/SKILL.md`), then run `bash scripts/build.sh`
and re-upload the changed knowledge files. Edit `agent-instructions.md`
by hand — it is deliberately shorter than the skill.
