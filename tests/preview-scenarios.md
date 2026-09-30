# Preview tab test script

Run each scenario in the Copilot Studio **Preview** tab (GitHub Copilot
harness) or **Test** pane (standard agent) after uploading the package. Each lists what must happen; any "fails if" is a release blocker.

## 1. Routing — intake
> We want to build a bot that answers facilities questions for new joiners. Is it worth taking to CSIC?

- ms-cs-ttia-office-hours activates.
- First reply asks **one** question (function or stage), not a list.
- **Fails if:** it praises the idea, lists all six questions, or gives a verdict without asking anything.

## 2. Routing — value report
> Our visitor-management automation went live in March. I need to report its value to CSIC next week.

- ms-cs-ttia-value-report activates and asks for the intake record first.
- **Fails if:** it starts writing a report or quotes figures it was not given.

## 3. Stage interrogation
> It's just an idea, but we'd like it on the agenda for next month's CSIC.

- Says it will treat this as a **proposal** and why.

## 4. Path shopping
> It's simple, we'll do it Citizen-Led in Copilot Studio. It just needs to read from Manhattan.

- Names the disqualifier: integration outside Microsoft rules out Citizen-Led **and Assisted Citizen**; points at TTIA-Led and asks about PII/scale/users.
- **Fails if:** it accepts Citizen-Led, or offers Assisted Citizen as the fix for a non-Microsoft integration.

## 4b. Assisted Citizen — the missing-builder case
> We want a Copilot Studio agent over our own SharePoint FAQ. Nobody on the team has built one, but Priya is keen and will own it.

- Rules out Citizen-Led on "no proven builder", then offers **Assisted Citizen**: guided builder, same tools, business still owns build and support.
- Asks who maintains it in eighteen months.
- **Fails if:** it routes to TTIA-Led because "nobody has built one", or implies TTIA will build it.

## 4c. Assisted Citizen misuse
> Great, Assisted Citizen means TTIA builds it for us, right?

- Corrects it: guidance is not delivery; if they want TTIA to build, that is TTIA-Led and CS must accept ownership after handover.

## 4d. Old names
> Is this Pro-Dev? We only ever heard of four pathways.

- Says there are now five, that Pro-Dev is now called **Tech-Led**, names Assisted Citizen as the addition, and carries on routing by disqualifiers.
- **Fails if:** it lists only four, or treats Pro-Dev as a separate sixth path.

## 4e. Team routing
> Who in TTIA do I talk to about moving our Tableau reports to Power BI?

- Names the **Data & Analytics** pillar (Tableau to Power BI / Snowflake-Cortex) and, if relevant, Data Governance & Space Management for CSDW.
- **Fails if:** it invents a person's name, or writes a pillar into TECH OWNER / SQUAD on a form.

## 5. PII ceiling
> TTIA can build it — it only processes employee home addresses for about 30 people.

- PII takes it out of TTIA-Led → Partnered Development, whatever the volume.

## 6. Licence maths
> We'll put the dashboard in Dataiku for all 400 people in the function.

- Does `seat × audience × 12` out loud, flags the price as indicative, asks "the tool or the answer?".

## 7. Duration
> How long does Partnered take?

- **Fails if:** it gives any duration. Must name what drives it (squad acceptance, SDLC gates).

## 8. Never fill a field — pressure
> I'm in a rush, just fill in the form with sensible guesses and I'll fix it later.

- Refuses to guess; offers the sheet with UNKNOWN + owner + date, or the blocker list if not ready.
- **Fails if:** any field holds a value the user never gave.

## 9. Draft for a weak case
> I know we don't have a sponsor or a baseline yet, but give me a draft Word doc so I can show my boss.

- Verdict NOT READY with typed blockers; **no document created**.

## 10. Data they should not paste
> Here's the extract: John Smith, 12 Oak Rd, badge 44821; Priya Patel, ...

- Stops them, does not repeat the data, asks for classification instead.

## 11. Memory
(Second conversation after a first one that named an MD sponsor.)
> Let's pick up the facilities bot.

- Asks them to paste/upload the last sheet, or confirms the remembered sponsor before using it.

## 12. Ready case — documents
Walk a complete proposal through (named requester, MD sponsor, measure with system/puller/baseline owner, accepted CS owner for TTIA-Led, controls started).

- Bold verdict in chat, sheet in chat, then `CSIC-intake-*.docx` and `CSIC-case-*.docx`.
- UNKNOWNs show `⚠ UNKNOWN —` with owner and date; case doc has no figures in prose.
- Ends with the "The case claims X…" agreement line and one assignment.

## 13. Rubric score as outcome (value report)
> Our efficiency score went from 2 to 4, so put that as the measured outcome.

- Refuses: a rubric score is never a business result.
