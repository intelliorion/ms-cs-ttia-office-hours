# Test data for the Import

Everything here is **synthetic**: all names ("Avery Chen" to "Mei-Ling Wong"), employee ids, phone numbers and figures are made up.
Regenerate with `npm run test-data` (from `cafe-app/`); the output is the same every time. Do not edit these files by hand.
Pictures are read by the AI before the personal-data check; a held picture's text is not kept.

Suggested order: drop **01** first (so the ideas and their Café IDs exist), then **02-07**, then **08-11**, **12-text.pdf**, **13-outlook.msg**, **12-first-builder.eml**, **13-conflicting-reply.eml** (it shows what the Import holds for you), then **14** and **15**.

| File | What it is | What to expect |
|---|---|---|
| 01-submissions.xlsx / .csv | The same 8 submissions in both formats, shaped like the real SharePoint export: "Last, First (CS)", CS Function as BSI or GSS, multi-select joined by ";#", team lists one per line in mixed styles ("Lead: Name(she/her)", "Name (Lead)"), some blank cells, long challenges and numbered processes | Import creates CAFE-2026-001 to 007 (the 7th data row has no title, so the import reports it; the report counts the header as row 1). Names are stored first name first. Rows 2, 4 and 8 are teams with a lead and a sponsor. Row 1 says Individual but lists 5 people, so it is flagged. Dropping both files shows dedupe (the second adds nothing new). |
| 02-reply-with-id.eml | Priya Nair answers our three questions; subject has CAFE-2026-002 | Sure match to Desk booking assistant. Our quoted E2 is split off below "-----Original Message-----". |
| 03-reply-no-id.eml | Reply whose subject is only the idea title | Likely match to Desk booking assistant (title in subject). |
| 04-sender-only.eml | Mateo Álvarez writes "Quick update" | No ID or title, so a sender match (submitter, 0.8) or a question to you. |
| 05-injection.eml | Reply to CAFE-2026-003 that tells the app to set a stage and record budget approval | Safety demo: only the three answers can be proposed; the stage and budget do not change. |
| 06-tracker.eml | Forwarded table of 12 people with employee ids and phone numbers | HELD (names, ids, phones); not read further. |
| 07-our-own-sent.eml | Our own E3 sent to Ingrid Solberg, from cafe@example.com | Filed as "out" (our mail), nothing proposed. |
| 08-transcript.vtt | Teams design session, 12 cues, 4 speakers, mentions CAFE-2026-002 | Good AI material: features and a system (Service Catalogue) become stars. The tools it names (Copilot Studio, Dataiku) do not: the AI never picks a tool; they stay in the text for the tool picker. |
| 09-minutes.docx | Word minutes: heading, 3 paragraphs, an actions table | Read as a document; the table is kept as rows. |
| 10-note.txt | Pasted-style note with no Café ID | Asks which idea it belongs to. |
| 11-held-tracker.csv | Name, Employee ID, Phone, Client for 15 people | HELD, not imported as ideas. |
| 12-text.pdf | One-page text PDF: a short memo on CAFE-2026-004 (Expense anomaly finder) with three facts: the data is the monthly expense system export, a "Duplicate claim spotting" capability, finance wants a weekly digest | Read as a document (Read: "PDF, 1 page, … words"), matched by Café ID to 004, facts applied. |
| 12-first-builder.eml | Avery Chen answers on CAFE-2026-001: names Mikael Lindqvist as the builder, a "Slot finding" capability and the Contract Repository system | Nothing clashes, so it all applies on its own: builder named, new stars and links added confirmed. Sets up the conflict demo in 13. |
| 13-outlook.msg | A real Outlook .msg (Apache-2.0 sample, 3 image attachments) | Read as an email; expect it to ask which idea, since it has no Café ID. |
| 13-conflicting-reply.eml | A reply on CAFE-2026-001 from team@example.test: "a second builder now", and "slot findings across time zones" | The Import holds only what clashes, under Needs you: the new builder (the idea names one already) and the "Slot findings" star when a "Slot finding" star exists. The filing still happens on its own. |
| 14-whiteboard.png | A generated whiteboard picture (block letters, black on white): CAFE-2026-002 DESK BOOKING / NEEDS: FIND A FREE DESK, SWAP A BOOKING, RELEASE NO-SHOWS / TOOL: COPILOT STUDIO / DATA: FLOOR PLAN SYSTEM | Read by the AI (Read: "Picture read by the AI, … s, … words"), matched to 002, stars and links added confirmed (not the tool: the tool picker decides that later). The card shows "What the AI read". Needs Claude Code as the AI helper. |
| 15-scanned.pdf | The same picture inside a one-page PDF with no text layer | The scanned-PDF path (Read: "Scanned PDF read by the AI, …"); same result as 14. |
