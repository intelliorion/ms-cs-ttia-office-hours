# Creators' Café operator app

A local app for the person who runs the CS TTIA Creators' Café. It imports the submission export, tracks
each idea's 25 steps, drafts the emails, blocks any email that still needs a date or link, shows replies
that are late, and writes `status.csv` for submitters. It never sends anything: you approve, copy, send
from Outlook, then mark the email as sent.

This is plan 1 of 4 (core, no AI). The design is in
`docs/superpowers/specs/2026-10-19-creators-cafe-app-design.md`.

## Run it

```bash
cd cafe-app
npm install
npm run cafe -- start --workspace ~/cafe-workspace
```

Open http://localhost:4100. The workspace folder is plain YAML and Markdown; keep it in git if you want
history.

Other commands:

```bash
npm run cafe -- init   --workspace ~/cafe-workspace     # create the folders, rules and templates
npm run cafe -- import export.csv --workspace ~/cafe-workspace
npm run cafe -- status --workspace ~/cafe-workspace     # write exports/status.csv
```

`CAFE_TODAY=2026-10-26` pretends today is another date, for example to see which replies are late.

## A round, by hand

1. **Round:** set the dates, the links and your name. Draft E0 (call for ideas) and E0B (deadline reminder).
2. **Ideas:** drop the SharePoint or Forms export. Re-dropping it only adds new rows.
3. **Checklist:** draft E1 for each idea, tick what the team has done, then move it to Review and Select.
4. **Review:** tick the five criteria, pick a decision, give a reason. Routing to CSIC also writes
   `csic-handoff.md` with a follow-up date four weeks out.
5. **Outbox:** approve and copy, send from Outlook, mark as sent. The matching step ticks itself and
   E2 starts a five-day reply clock.
6. **Round:** write `status.csv` and the review pack for TTIA.

## Tests

```bash
npm test
npm run typecheck
```
