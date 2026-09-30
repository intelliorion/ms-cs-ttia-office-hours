# TTIA Office Hours — GitHub Copilot harness agent

Use this package when your Copilot Studio agent has a **Build** tab with a side
panel listing **Model · Skills · Tools · Knowledge · Connected agents · Memory**.
("GitHub Copilot harness" is Microsoft's name for Copilot Studio's newer agent
engine. It runs inside Copilot Studio; no GitHub account is involved.)

No Skills panel? Use `../copilot-studio-standard-agent/` instead.

## What is in this package

| file | goes where in Copilot Studio |
|---|---|
| `agent-instructions.md` | Build → Instructions (2,850 of 8,000 characters) |
| `upload/ms-cs-ttia-office-hours.zip` | Build → Skills → Upload a skill |
| `upload/ms-cs-ttia-value-report.zip` | Build → Skills → Upload a skill |

The instructions are short on purpose: they load on every turn, while each
skill loads only when a request matches its description. The intake skill
handles anything not yet in service; the value-report skill handles initiatives
already live.

## Before you start

- Maker access to a Copilot Studio environment, and Copilot Credits allocated to
  it — building, testing and running this engine all consume credits.
- Teams and Microsoft 365 Copilot allowed as channels by your organisation's
  data policies, and Power Platform apps allowed in Teams.

## 1. Create the agent

1. Copilot Studio **home page** → make sure **New experience** is on.
2. Create a **new agent** from the agent card, keeping the default engine. Do
   not choose **Build using standard orchestration** or **Other ways to build** —
   those create a standard agent, and an agent cannot switch engines later.
3. Check the Build tab shows the side panel with **Skills**.

## 2. Configure the Build tab

1. **Name:** `TTIA Office Hours`. **Icon:** PNG of 100 KB or less.
2. **Description:** `CSIC intake and value coach for Corporate Services, run by TTIA.`
   (Publishing is blocked without a description.)
3. **Instructions:** paste all of `agent-instructions.md` → **Save**.
4. **Skills → Add skill → Upload a skill:** upload
   `upload/ms-cs-ttia-office-hours.zip`, then
   `upload/ms-cs-ttia-value-report.zip`.
   If a zip is rejected, upload that skill's bare `SKILL.md` from
   `../skills/<skill-name>/` instead.
5. **Model:** keep the default for the first test pass; also try Claude Sonnet 5
   and keep whichever passes more test scenarios.
6. **Memory: off** for the first release. The skills never take form values from
   memory anyway, and memory is still a preview feature.
7. **Knowledge (optional):** CSIC policy or pathway documents. They inform advice
   but never supply a form value. Files labelled confidential or highly
   confidential are indexed but never answered from.

## 3. Test (Preview tab)

Run every scenario in `../tests/preview-scenarios.md`. Anything marked "fails
if" blocks publishing. Pay attention to:

- **Scenario 12** — confirms the two Word documents (`CSIC-intake-*.docx`,
  `CSIC-case-*.docx`) are created and downloadable. Check this again in Teams
  and Microsoft 365 Copilot after publishing.
- **Scenarios 1–2** — confirm the right skill activates for intake vs value
  report.

Then turn the scenarios into a test set in the **Evaluate** tab so you can rerun
them after every change.

## 4. Publish

1. Chevron next to **Publish** → in **Publish agent**, select **Microsoft Teams**
   and **Microsoft 365 Copilot**.
2. Fix anything the readiness check flags → **Publish**.

## 5. Share

1. Try it yourself first: **Channels → Teams and Microsoft 365 Copilot → See
   agent in Teams → Add**.
2. TTIA pilot: **Share** icon (next to Publish) → add people or a security group.
   Requires authentication set to **Authenticate with Microsoft**.
3. Whole organisation: **Availability options → Show to everyone in my org →
   Submit for admin approval**. Keep access at everyone-in-org afterwards.

## Updating

Edit `../skills/*/SKILL.md`, run `bash scripts/build.sh` from the repo root, then
in Copilot Studio replace the uploaded skill and **Publish** again. Open chats
keep the old version until the user types **Start over**.

If Teams shows `SystemError` after a republish: disable and re-enable the app in
the Teams admin center, toggle the Teams channel off and on, and republish.
