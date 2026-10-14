# Changelog

## 2026-10-14 (round 4 test fixes)

- **Dead end closed:** a Café idea that needs a live non-Microsoft system, or
  personal or client data, can now hand forward to CSIC once the user says in
  their own words what to build, even if the Café suggested it.
- **Small team-local builds:** the agent offers the CSIC Repository or the
  Café (KEEP AS A CAFÉ PATTERN), and the user chooses.
- **CSIC:** the remaining form fields are asked before the verdict, so a
  required field left UNKNOWN makes the case NOT READY instead of READY. The
  requester, the MD sponsor and the data are confirmed at every stage before
  they can block. A user who leaves for the Café midway gets the verdict as
  it stands. Resuming also asks for audience and pathway.
- **Value story:** a live initiative that never went through CSIC still gets
  its value story; CSIC comes in only for "who owns it". An after figure with
  no before is measured as a level, with no improvement claimed.
  "Nothing live yet" also offers the Café on the standard agent.
- **Assignments:** a value case or value story ends with its closing line,
  then one assignment line, in the same message.
- **Standard agent:** lists all seven Café routes, offers the Café after a
  productivity question, and gives no licence price inside the Café
  (7,908 characters).
- Scenarios 14-19 added.
- **Re-check fixes:** the GitHub instructions also offer both levels for
  team-local builds, and resume there asks for audience and pathway. A user
  who quits CSIC for the Café stays in the Café in that conversation, and
  questions not yet asked are listed as such rather than as blockers. From
  "approved" on, CSIC asks whether the pathway owner has accepted. Resuming
  re-checks the pathway against the data and audience. The CSIC value case
  ends with one assignment line. Route names are spelled the same everywhere.

## 2026-10-14 (later) — three levels, forward only

- **Three skills, three levels.** `ms-cs-ttia-creators-cafe` (find the right
  solution, never measures value), `ms-cs-ttia-csic-repository` (renamed from
  `ms-cs-ttia-office-hours`; identify and measure the AI ROI),
  `ms-cs-ttia-value-story` (renamed from `ms-cs-ttia-value-report`; what a
  live initiative actually delivered). Delete the old skills from Copilot
  Studio before uploading the new zips.
- **New routing test.** "Do you know what you want built and roughly how, who
  would use it, and what you expect it to change?" All three: CSIC
  Repository. Any missing: Café. Sponsorship and stage labels are no longer
  the test.
- **Forward only.** Fixes the dead end where the Café and intake sent the same
  item back and forth. The CSIC Repository never hands back; a missing
  sponsor is a blocker. NOT AN INITIATIVE YET ends with an assignment to the
  Café, not a handoff. The value story never restarts intake.
- **Proof of concept with users, no CSIC record** now has a home: the CSIC
  Repository, as a pilot proposal.
- **Resume rule** in both instruction files and all three skills: memory is
  off, so ask for the last sheet, and if they do not have it re-ask only what
  the level needs.
- **CSIC Repository:** an explicit order for the whole conversation, so the
  measure, five cards and alternatives are always reached; the user chooses
  the value driver; a remaining-fields step before the sheet (FWAI theme is
  picked from the form); READY at proposal no longer needs an accepted
  owner (carry-over risk instead); personal data rules out Citizen-Led and
  Assisted Citizen even as an extract; firm disqualifiers cannot be
  escalated; a blocker type for escalations and a place to raise them.
- **Café:** licence and access questions go to Tech Governance & Enablement;
  unlisted tools are "not on the approved list"; the user writes the two
  submission sentences; the Café page and its button are named; the
  start-here map reference is read explicitly.
- **Value story:** starts from the claim; asks whether the system holds
  history from before go-live before declaring a claim unevidenceable.
- **Standard agent:** instructions rewritten around the three levels (about
  7,100 characters); knowledge file 05 defers to 07 for the value case
  layout; the build no longer turns "this skill" into "this agent".
- Test scenarios rewritten for routing (0a–3e) and added for the dead ends
  (5b, 5c, 11, 13b, 13c).
- **Second test round fixes.** The routing test is applied once, at entry, so
  a well-sharpened Café idea can still reach SUBMIT TO THE CAFÉ. The Café
  hands forward on outgrowth only when the user can say what they want built,
  closing the last Café/CSIC loop; a business case for an undefined idea
  stays in the Café. A user may choose the Café after being told once why
  CSIC fits. New Café routes: KEEP AS A CAFÉ PATTERN, STOP KEEP THE LEARNING,
  and REUSE for an approved tool they lack access to. A handoff is not a
  closing message. CSIC: baseline owner is a hard blocker everywhere; the
  data question is on the proposal bar; the sponsor must be an MD who has
  agreed; OPPORTUNITY DESCRIPTION is asked for and three dropdowns are
  confirmed; an ownership escalation at proposal goes alongside a READY
  sheet; a de-identified extract can reopen Citizen-Led; a Café proof of
  concept is a stage; resume asks the level first and continues from the
  measure. Value story: pasted figures count as evidence. Scenarios 0g–0i
  and 13d added; 0c updated.

## 2026-10-14

- **Creators' Café skill.** New `skills/ms-cs-ttia-creators-cafe/` for the CS
  TTIA Creators' Café, the Corporate Services Advanced AI Community of
  Practice: the start-here map, Café vs TTIA CSIC Repository, the four Café
  stages (Submit Idea, Review and Select, Design series, Launch and Learn),
  tools and pathways at Café depth, and a route instead of a verdict. Ships
  as a third zip for the GitHub Copilot harness agent and as knowledge file
  `08-creators-cafe.md` for the standard agent.
- **Idea stage goes to the Café.** Intake now starts at proposal. The stage
  question sends "idea" to the Café skill and "NOT AN INITIATIVE YET" does
  the same. The test between the two is the map's: defined, validated and
  sponsored.
- **Start-here map ingested** as
  `skills/ms-cs-ttia-creators-cafe/references/how-to-start-ai.md`: approved
  productivity tools, the two doors for a new idea, programs (CS TTIA, CS AI
  Ambassadors, CS Evolve) and learning (AIDP, DeepLearning.AI, MS Employee
  Development).
- **Tool lists aligned to the map.** Dataiku and UiPath now sit on Citizen-Led
  and Assisted Citizen as well as TTIA-Led; the custom app is TTIA-Led only.
  Flagged in the README for TTIA to confirm.
- Both `agent-instructions.md` files route three ways; the standard-agent
  one was trimmed to stay under 8,000 characters. Test scenarios 0a to 0f
  and 3b added for the Café.

## 2026-09-30

- **Value story chat layout.** New `references/value-story-chat.md` gives the
  exact markdown layout for the value case and the value report; generated as
  knowledge file `07-value-story.md` for the standard agent, which cannot make
  files. "Value story" and "business case" are now explicitly in scope.
- **CSLab wording removed**; TTIA-Led is delivered by automator pods.

- **Five pathways.** Tech-Led (was Pro-Dev), Partnered Development, TTIA-Led,
  **Assisted Citizen (new)**, Citizen-Led. The disqualifier test now has four
  steps and runs from the bottom of the ladder up. Every table, the form's
  "alongside the sheet" block and the standard-agent instructions updated.
- **TTIA team ingested.** Correct name (CS Technology Transformation,
  **Innovation** & Analytics), partners (GSS, CSI, CBS, RES) and the five
  pillars with their remits. New `references/ttia-team.md` in the intake skill
  and a generated `00-ttia-team.md` knowledge file for the standard agent.
- **Test scenarios** 4b–4e added: Assisted Citizen routing and misuse, old
  pathway names, team routing.
- **`scripts/install-local.sh`** installs the skills for Claude Code, GitHub
  Copilot in VS Code and Copilot CLI.

## 2026-09-29

- Split into two Copilot Studio packages (GitHub Copilot harness, standard).
- Initial skills: `ms-cs-ttia-office-hours`, `ms-cs-ttia-value-report`.
