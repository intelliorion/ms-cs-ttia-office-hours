# Changelog

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
