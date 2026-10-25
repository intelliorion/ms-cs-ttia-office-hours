# Scenario test script

Run each scenario in a chat with the three skills installed
(`bash scripts/install-local.sh`). Each lists what must happen; any "fails if" is a release blocker.

## 0a. Routing — an idea goes to the Café
> I've got an idea: something to help with facilities questions from new joiners. Not sure what tool or how we'd build it.

- ms-cs-ttia-creators-cafe activates.
- Treats it as an idea (they do not know what to build or how) and asks one question, about who has the problem or what it would replace.
- **Fails if:** it runs the six questions, asks for an MD sponsor, a baseline, a saving or ROI, gives a READY / NOT READY verdict, or says "interesting idea".

## 0b. Café vs Repository
> What's the difference between Creators' Café and the CSIC Repository? Where does my idea go?

- Gives the simplest distinction (learn, experiment, collaborate vs formally capture, assess, route, track) and library + community vs system of record + governance.
- Gives the test: do you know what you want built and roughly how, who would use it, and what you expect it to change.
- **Fails if:** it treats them as the same thing, or uses sponsorship as the test.

## 0c. The Café as a back door
> We want a Copilot Studio agent over our HR policy SharePoint for the 200 people in GSS ops, to cut the policy questions to the HR mailbox. I'd rather just put it in the Creators' Café to keep it simple.

- Recognises all three answers (what and how, who, what changes) and says once, with the reason, that the CSIC Repository fits better: the ROI gets measured there, and a Café proof of concept would still go there afterwards.
- If the user then says *"No, I want to prototype in the Café first"*, it respects that, helps with the Café submission and closes **SUBMIT TO THE CAFÉ** without pushing again.
- **Fails if:** it silently accepts the Café on the first message, or keeps pushing CSIC after the user has chosen.

## 0d. Café submission — the two answers
> Help me write my Café submission. The idea is an AI assistant for our team.

- Pushes on what it would do, who uses it, what it replaces; then the desired outcome. Asks whether they have looked at what exists.
- Asks the user to write the two sentences, then ends with **SUBMIT TO THE CAFÉ** and the block containing only what they wrote.
- **Fails if:** it writes the idea for them, sizes a saving, invents a deadline or link, or leaves without a route.

## 0e. Productivity tool, then an idea
> I just want something to summarise long email threads. What can I use?

- Names an approved tool from the start-here map (Microsoft Copilot, ChatGPT Enterprise, etc.); no submission. Route: **A QUESTION ANSWERED**.
- Follow-up: *"Half my team doesn't have Copilot."* Says access and licences are a Tech Governance & Enablement question; quotes no price.
- Follow-up: *"Actually, could we build something that pulls actions into our tracker?"* Revises the route and moves to the Café idea flow.
- **Fails if:** it starts a submission on the first message, calls an unlisted tool approved, or quotes a licence price.

## 0f. Café specifics it does not have
> When's the deadline, where's the Café page, and who do I email about my Café idea?

- Says it does not have the deadline or a named contact; gives the Café page, http://cscreatorscafe/, and its "Submit your idea now" button; then offers something to do now.
- **Fails if:** it states a date, invents a URL, mailbox or name, or ends with nothing to do.

## 0g. A sharp Café idea still reaches SUBMIT
Start in the Café with a vague idea, sharpen it, and accept the agent's suggestion of Copilot Studio for the proof of concept.

- Ends **SUBMIT TO THE CAFÉ**, with the suggested tool in the block only because the user said they would use it.
- **Fails if:** the sharpened idea is handed to the CSIC Repository just because it now names a tool, users and an outcome.

## 0h. A sponsor and budget, but no idea what to build
> Our MD wants AI in onboarding and we have budget. The MD wants a business case with numbers for next month.

- Stays in the Café, says plainly that the business case comes after the solution is chosen, and asks one question about who has the onboarding problem.
- **Fails if:** it hands to the CSIC Repository (which could only close it NOT AN INITIATIVE YET and send it back), or sizes a business case.

## 0i. Rebuilding an approved tool
> Half my desk has no Copilot. Could we build our own meeting summariser instead?

- Routes **REUSE WHAT EXISTS**: the need is access to an approved tool, a Tech Governance & Enablement question; no build.
- **Fails if:** it helps write a Café submission to rebuild Copilot's meeting recap.

## 0j. Show me the map
> Can you show me the "How I want to use & Build AI" diagram?

- Posts the text map (four branches, the two doors, the five pathways with their tools) exactly as in the Café reference, then the link http://ttia-ai-diagram/ (firm network), then asks which branch they are on.
- **Fails if:** it says it cannot show the map, invents content not in the text map, or omits the link.

## 1. Routing — CSIC Repository
> We want a Copilot Studio agent that answers new joiners' facilities questions from our SharePoint FAQ, for the GSS front-desk team, so the facilities mailbox stops fielding them. Our COO wants it at CSIC.

- ms-cs-ttia-csic-repository activates (all three answers given).
- First reply asks **one** question (function or stage), not a list.
- **Fails if:** it praises the idea, lists all six questions, gives a verdict without asking anything, or sends it to the Café.

## 2. Routing — value story
> Our visitor-management automation went through CSIC and went live in March. I need to report its value to CSIC next week.

- ms-cs-ttia-value-story activates and first asks what they want to say it delivered, then for the intake record.
- **Fails if:** it starts writing a report or quotes figures it was not given.

## 3. "Just an idea" inside the CSIC Repository
> It's just an idea, but we'd like it on the agenda for next month's CSIC. It's a UiPath bot that files vendor onboarding forms for the RES procurement team.

- They can say what, how, who and roughly what changes, so it stays in the CSIC Repository and the agent says it will treat it as a proposal.
- **Fails if:** it sends it to the Café.

## 3b. No bounce: unsponsored proposal
> It's a proposal for November CSIC: a Power App for desk no-show auto-release for RES. Our MD might sign, we haven't asked.

- Stays in the CSIC Repository all the way to a verdict. The missing sponsor appears as a hard blocker (type "needs a conversation") on **NOT READY**.
- **Fails if:** it switches to the Café at any point, or the Café would send it straight back.

## 3c. No bounce: Café handoff into the CSIC Repository
Start in the Café with a vague idea; during design-series scoping reveal it needs badge data from a non-Microsoft access system.

- The Café routes **TAKE IT TO THE CSIC REPOSITORY** because it has outgrown the Café, and says why.
- The CSIC Repository takes the stage and facts as given, does not re-explain the pathways, and runs to a verdict, even though there is no sponsor yet.
- **Fails if:** the CSIC Repository sends it back to the Café, or re-asks what the user already said.

## 3d. Proof of concept with users, no CSIC record
> We built it in the Café design series. 40 people use it daily now. Who owns it?

- Goes to the CSIC Repository as a **pilot proposal**: asks for an owner for the users it already has, then Q1–Q3 and Q6, then pilot terms (stopping condition, decision date). Asks whether the system holds history from before people started using it.
- **Fails if:** it starts a value story, or sends it back to the Café.

## 3e. Not an initiative, closed properly
In the CSIC Repository, the user turns out not to know what they want built or for whom.

- Gives **NOT AN INITIATIVE YET**, says which of the three is missing, and makes the assignment to take it to the Creators' Café. The conversation ends there.
- **Fails if:** it hands to the Café mid-conversation, or gives no verdict.

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

## 5b. Personal data on a citizen path
> It's Citizen-Led. It reads a nightly Manhattan extract that lands in SharePoint, with visitor names and badge numbers.

- The extract clears the integration test; the personal data still rules out Citizen-Led and Assisted Citizen.
- **Fails if:** it accepts Citizen-Led because the data arrives as an extract.

## 5c. Escalating a firm disqualifier
> We disagree that PII rules out TTIA-Led. Can we escalate it?

- Says a firm disqualifier is a fact about the work, not a decision to escalate; offers the real options (Partnered, or removing the personal data).
- **Fails if:** it frames the PII ceiling as an escalation item.

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

## 11. Resuming
(Second conversation; memory is off.)
> Let's pick up the facilities bot.

- Says it does not keep past conversations, and asks them to paste the last sheet, blocker list or Café draft.
- Follow-up: *"I don't have it, you should remember."* Re-asks only what the level needs (CSIC: stage, sponsor, measure, baseline owner; Café: idea and desired outcome), not the full interview.
- **Fails if:** it claims to remember, invents prior answers, or restarts every question.

## 12. Ready case — documents
Walk a complete proposal through (named requester, MD sponsor, measure with system/puller/baseline owner, accepted CS owner for TTIA-Led, controls started).

- Bold verdict in chat, sheet in chat, then `CSIC-intake-*.docx` and `CSIC-case-*.docx`.
- UNKNOWNs show `⚠ UNKNOWN —` with owner and date; case doc has no figures in prose.
- Ends with the "The case claims X…" agreement line and one assignment.

## 13. Rubric score as outcome (value story)
> Our efficiency score went from 2 to 4, so put that as the measured outcome.

- Refuses: a rubric score is never a business result.

## 13b. No baseline, but history exists
> We never captured a baseline before go-live. So we can't claim anything, right?

- Asks whether the system of record holds data from before go-live; if it does, the claim can still be measured.
- **Fails if:** it concludes "not evidenceable" without asking.

## 13d. Pasted figures as evidence
> We didn't upload anything, but here are the numbers from ServiceNow: February median 4.2 days, April median 2.1 days.

- Accepts the pasted figures as evidence, asks anything missing about system and period, and cites them as pasted by the user from ServiceNow.
- **Fails if:** it refuses pasted figures because they are not an uploaded file.

## 13c. Value story for something not live
> Can you write the value story for our Café idea? We haven't built it yet.

- Says there is nothing to report yet; assignment: take it to the CSIC Repository, where the measure gets set, or to the Café if they do not yet know what to build. Ends there.
- **Fails if:** it writes a forecast as a value story.

## 14. Café idea that needs a non-Microsoft system
> I want something to answer supplier questions from live Ariba data. Not sure what tool. … OK, a UiPath bot reading Ariba sounds right.

- Café; once the user says in their own words what they want built (even the Café's own suggestion), the live non-Microsoft connection means no Café proof of concept could try it, so it hands forward: **TAKE IT TO THE CSIC REPOSITORY**, then the first CSIC question.
- **Fails if:** it leaves the idea with no route, or calls it NOT AN IDEA YET.

## 15. Small team-local build
> A Copilot Studio agent over my 10-person team's SharePoint FAQ, for my team, so we stop answering the same five questions. No funding needed.

- Offers both once: CSIC (ROI measured, needs an MD sponsor) or the Café (KEEP AS A CAFÉ PATTERN). The user chooses.
- **Fails if:** it sends it straight to CSIC and blocks it on an MD sponsor without offering the Café.

## 16. Required field unknown
> (CSIC, everything met) For the opportunity description — don't know yet, my lead will write it.

- The remaining fields are asked **before** the verdict. A required field left UNKNOWN makes it NOT READY, with that field as a "clear this week" blocker owned by the lead.
- **Fails if:** it shows READY TO SUBMIT with a required field UNKNOWN.

## 17. Quitting CSIC midway
> (at Q2) This is too much, I'll just take it to the Café.

- Respects it: gives the verdict as it stands (NOT READY with the open items as blockers), then switches to the Café in the same conversation.
- **Fails if:** it argues twice, or ends with no verdict.

## 18. Live, never through CSIC, "what did it deliver?"
> Our Power App has been live a year. It never went to CSIC. What did it deliver?

- Value story: says there is no intake record, then reports what can be evidenced. A CSIC assignment comes only if they ask who owns it.
- **Fails if:** it routes the question to CSIC instead of telling the story.

## 19. After figure with no before
> We only have this month: median 2.1 days. Nobody recorded the before, and the system keeps no history.

- Measured as a level (`Before: not captured`); no improvement claimed; the closing says the Step 0 claim cannot be evidenced, and names who starts recording now.
- **Fails if:** it claims an improvement, or tiers an invented before as measured.
