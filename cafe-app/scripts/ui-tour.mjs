#!/usr/bin/env node
// Screenshot tour of the Café page. Starts its own server on a scratch workspace,
// imports sample ideas through the API, and saves screenshots. Never touches port 4100.
//
//   node scripts/ui-tour.mjs --workspace <scratch dir> --out <shots dir> [--port 4103] [--extra extra.csv ...] [--only=panels|hover|popout(=panel)|popouts2|ai|inbox|inboxhand|drawers|empty|focus|ideacard|design|quality]  (ai, inbox and design need CAFE_AI_FAKE=1; inboxhand restarts the server without it;
//   a full tour includes the AI shots when CAFE_AI_FAKE=1 is set)
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const flags = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const port = Number(flag('port', '4103'));
if (port === 4100) throw new Error('The tour never uses port 4100 (the operator\'s Café).');
const workspace = path.resolve(flag('workspace', path.join(APP, '.tour-workspace')));
const out = path.resolve(flag('out', path.join(workspace, 'shots')));
const only = argv.find((a) => a.startsWith('--only='))?.slice(7);
const base = `http://localhost:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GPU = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const NO_GL = ['--disable-gpu', '--disable-webgl', '--disable-webgl2'];

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/state`)).ok) return; } catch { /* not yet */ }
    await sleep(200);
  }
  throw new Error('The server did not start');
}

async function importCsv(file) {
  const res = await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': path.basename(file), 'content-type': 'text/csv' }, body: await fs.readFile(file) });
  if (!res.ok) throw new Error(`Import failed: ${await res.text()}`);
}

async function post(url, body) {
  const res = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: ${await res.text()}`);
  return res.json();
}

// The tour's Chrome draws with SwiftShader, so a fresh browser would auto-pick Lite quality (with a notice).
// Every shot except the quality ones keeps Full, set by hand, so they stay comparable with earlier tours.
async function pinFull(ctx) {
  await ctx.addInitScript(() => {
    try { if (!localStorage.getItem('cafe-quality')) { localStorage.setItem('cafe-quality', 'full'); localStorage.setItem('cafe-quality-by-hand', '1'); } } catch { /* no storage */ }
  });
}

async function page(browser, errors, { fresh = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  if (!fresh) await pinFull(ctx);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base, { waitUntil: 'networkidle' });
  return p;
}

// Two pending AI links (below 0.7, so dashed and unconfirmed) for the pop-out and the star card, and one
// 0.9 link between stars the form already made, which is added confirmed and can still be removed.
async function seedAiLinks() {
  const dir = path.join(workspace, 'graph');
  await fs.mkdir(dir, { recursive: true });
  const links = [
    { from: 'idea:CAFE-2026-002', to: 'painpoint:re-keying-requests-into-a-tracker', rel: 'REPLACES', description: 'Requests are re-keyed into an Excel tracker by hand',
      source: 'ai: extract, CAFE-2026-002 Business Challenge', confidence: 0.62, status: 'pending',
      newNodes: [{ id: 'painpoint:re-keying-requests-into-a-tracker', type: 'PainPoint', label: 'Re-keying requests into a tracker' }] },
    { from: 'capability:agent-design-guidance', to: 'tool:copilot-studio', rel: 'BUILT_WITH', description: 'Agent design guidance is usually built with Copilot Studio',
      source: 'ai: extract, CAFE-2026-002 Support Requested', confidence: 0.55, status: 'pending',
      newNodes: [{ id: 'tool:copilot-studio', type: 'Tool', label: 'Copilot Studio' }] },
    { from: 'idea:CAFE-2026-002', to: 'capability:ai-solution-brainstorming', rel: 'NEEDS', description: 'Brainstorm where an agent fits the intake',
      source: 'ai: extract, CAFE-2026-002 Business Challenge', confidence: 0.9, status: 'pending' },
  ];
  await fs.writeFile(path.join(dir, 'ai-links.jsonl'), links.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// Ideas open in the left panel, not a pop-out: a real click on a list item shows its details beside the universe
// (star selected and highlighted), a review's suggestion inside them, Back to the list, then a star's card → Open idea.
const DETAILS = '[data-testid="idea-details"]';
async function popoutShots(p) {
  const assert = (ok, msg) => { if (!ok) throw new Error(`panel: ${msg}`); };
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await sleep(1500);
  const item = p.locator('.idea-list li').filter({ has: p.locator('.iid', { hasText: '2026-002' }) });
  await item.click(); // a real pointer click
  await p.waitForSelector(DETAILS);
  assert((await p.locator('[role="dialog"]').count()) === 0, 'a list click opened a dialog');
  assert(await p.isHidden('.idea-list'), 'the list still shows beside the details');
  assert((await p.evaluate(() => document.querySelector('.side-panel.left .id-scroll').scrollWidth <= document.querySelector('.side-panel.left .id-scroll').clientWidth)), 'the details overflow sideways');
  await sleep(3500);
  await p.mouse.move(960, 1060);
  await shot(p, '30-panel-idea.png');
  // "Only related": the universe keeps just this idea and what it links to (one hop); Show all brings the rest back.
  await p.click('[data-action="only-related"]');
  await sleep(3000);
  await shot(p, '34-only-related.png');
  assert((await p.textContent('[data-action="only-related"]')) === 'Show all', 'the Only related pill did not flip');
  await p.click('[data-action="only-related"]');
  await sleep(1500);
  // A CSIC decision through the panel (the idea is at stage 2, so the Decision form is the one action section):
  // tick two checks, pick the decision, give a reason, save.
  assert((await p.locator(`${DETAILS} [data-testid="tool-picker"]`).count()) === 0, 'the tool picker shows at stage 2');
  const crit = p.locator(`${DETAILS} .criteria input`);
  await crit.nth(0).check(); await crit.nth(2).check();
  await p.check(`${DETAILS} input[name^="decision-"][value="csic"]`);
  await p.fill(`${DETAILS} textarea.reason`, 'It needs the live shared mailbox, so it belongs in the CSIC Repository.');
  await p.click(`${DETAILS} [data-action="save-review"]`);
  await p.waitForSelector('[data-testid="suggest"]');
  await sleep(800);
  await shot(p, '07-panel-suggest.png');
  await p.click(`${DETAILS} [data-action="suggest-no"]`);
  await p.click(`${DETAILS} [data-action="back"]`);
  await p.waitForSelector(DETAILS, { state: 'detached' });
  assert(await p.isVisible('.idea-list'), 'Back did not show the list');
  assert((await p.evaluate(() => document.querySelector('.idea-list li.sel')?.textContent ?? '')).includes('2026-002'), 'Back lost the selection');
  await sleep(800);
  await shot(p, '31-panel-back.png');
  // Esc closes the star card that the kept selection shows; then select the star again and open it from its card.
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
  await p.waitForSelector('[data-testid="ideacard"]');
  await sleep(1500);
  await p.click('[data-testid="ideacard"] [data-action="open-idea"]');
  await p.waitForSelector(DETAILS);
  assert((await p.locator('[role="dialog"]').count()) === 0, 'Open idea opened a dialog');
  assert((await p.locator('[data-testid="ideacard"]').count()) === 0, 'the card stayed over the details');
  await sleep(2500);
  await shot(p, '32-card-open.png');
  // The lower sections (Graph links, Details, History) in the same column.
  await p.evaluate(() => { const el = document.querySelector('.side-panel.left .id-scroll'); el.scrollTop = el.scrollHeight; });
  await sleep(500);
  await shot(p, '33-panel-lower.png');
  // Esc in the details goes Back.
  await p.mouse.click(960, 1070); // focus off any control (empty bottom of the stage)
  await p.keyboard.press('Escape');
  await p.waitForSelector(DETAILS, { state: 'detached' });
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await sleep(1500);
  await p.evaluate(() => window.__cafe.click('capability:agent-design-guidance'));
  await p.waitForSelector('[data-testid="nodecard"]');
  await sleep(3500);
  await shot(p, '08-nodecard.png');
  await p.evaluate(() => window.__cafe.select(null));
}

// A second export: one row already imported, two new ones, one without a title, and a column the app does not use.
const SECOND_EXPORT = [
  'ID,Title,Submitter Name,CS Function,Region,Participation Type,Team Members and Lead,Business Challenge,Desired Outcomes,Current Process,Support Requested,Have you already experimented with AI for this idea?,Reviewer notes',
  '11,Email scheduler,Person 1 (CS),BSI,AMER,Individual,,Arranging meetings takes many back-and-forth emails.,;#Save time;#,Emails go back and forth.,;#Agent Design Guidance;#,Yes,Looks fine',
  '12,Contract clause finder,Person 12 (CS),Legal Ops,EMEA,Individual,,Lawyers search old contracts by hand for the same clauses.,;#Save time;#Improve quality;#,Open each contract and read it.,;#AI Solution Brainstorming;#,No,Needs data check',
  '13,Desk booking assistant,Person 13 (CS),Workplace,EMEA,Team,Person 13 (Lead); Person 14,Desk bookings are chased over email each week.,;#Improve visibility;#,Email the desk booking mailbox.,;#Agent Design Guidance;#,No,',
  '14,,Person 15 (CS),BSI,AMER,Individual,,No title given,,,,No,',
].join('\n');

const click = (p, sel) => p.click(sel);

// Import, Round, Outbox from the title bar, then a late reply (the app clock moved 8 days on).
async function popouts2Shots(p, gl, errors, restart) {
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await click(p, '.titlebar [data-action="import"]');
  await p.waitForSelector('[data-testid="dropzone"]');
  const csv = path.join(workspace, 'second-export.csv');
  await fs.writeFile(csv, SECOND_EXPORT);
  await p.setInputFiles('[data-testid="import-file"]', csv);
  await p.waitForSelector('[data-testid="import-report"]');
  await sleep(1500);
  await shot(p, '09-import.png');
  await p.keyboard.press('Escape');

  // Round: fill the dates and settings through the page, leaving the Teams link and the series date empty.
  await click(p, '.titlebar [data-action="round"]');
  await p.waitForSelector('[data-field="deadline"]');
  await p.fill('[data-field="open"]', '2026-10-05');
  await p.fill('[data-field="deadline"]', '2026-10-30');
  await p.fill('[data-field="reviewBy"]', '2026-11-13');
  await p.fill('[data-field="operatorName"]', 'Café operator');
  await p.fill('[data-field="formLink"]', 'https://forms.example.com/cafe');
  await click(p, '[data-action="save-round"]');
  await sleep(500);
  await click(p, '[data-action="save-settings"]');
  await sleep(700);
  await shot(p, '10-round.png');
  await p.keyboard.press('Escape');

  // Fixture: an E2 sent on the app's day, so it is late 8 days on.
  const { ideas } = await (await fetch(`${base}/api/state`)).json();
  const [a, b, c] = [ideas[1].id, ideas[2].id, ideas[4].id];
  const e2 = await post(`/api/ideas/${a}/draft`, { template: 'E2' });
  await post('/api/outbox/approve', { key: e2.key });
  await post('/api/outbox/sent', { key: e2.key });
  const e1 = await post(`/api/ideas/${b}/draft`, { template: 'E1' });
  await post('/api/outbox/approve', { key: e1.key });
  await post(`/api/ideas/${c}/draft`, { template: 'E3' }); // a second draft, waiting to be approved
  await post(`/api/ideas/${b}/draft`, { template: 'E2' });
  await post('/api/round/draft', { template: 'E0' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('canvas');
  await sleep(2500);
  await click(p, '.titlebar [data-action="outbox"]');
  await p.waitForSelector('[data-group]');
  await sleep(800);
  await shot(p, '12-outbox.png');
  await p.keyboard.press('Escape');

  // Eight days on: the reply is late. Ideas list shows the amber line, Pipeline shows the late list.
  const later = new Date(Date.now() + 8 * 864e5);
  const iso = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}`;
  await restart({ CAFE_TODAY: iso });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('canvas');
  await sleep(3000);
  await p.mouse.move(960, 540);
  await shot(p, '11-late.png');
}

// The AI pop-out, then "Grow the universe" on CAFE-2026-002 with the fake provider. Needs CAFE_AI_FAKE=1.
async function aiShots(p) {
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await p.waitForSelector('.titlebar [data-action="ai"]');
  await sleep(1000);
  await p.click('.titlebar [data-action="ai"]');
  await p.waitForSelector('.ai-pop');
  await sleep(800);
  await shot(p, '13-ai-chip.png');
  await p.click('.ai-pop [data-action="ai-test"]');
  await p.waitForSelector('.ai-pop .pop-notice:has-text("Connected:")', { timeout: 40000 });
  await sleep(300);
  await shot(p, '16-ai-test.png');
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.__cafe.openIdea('CAFE-2026-002'));
  await p.waitForSelector('[data-testid="idea-details"]');
  await sleep(3000);
  await p.click('[data-testid="idea-details"] [data-action="ai-grow"]');
  await p.waitForSelector('[data-testid="idea-details"] .pop-notice:has-text("Added")', { timeout: 60000 });
  await sleep(3500);
  await p.locator('[data-testid="idea-details"] [data-action="ai-grow"]').scrollIntoViewIfNeeded();
  await shot(p, '14-grown.png');
  // A confirmed AI link still has Remove.
  const row = p.locator('[data-testid="idea-details"] li[data-edge="idea:CAFE-2026-002|NEEDS|capability:ai-solution-brainstorming"]');
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((el) => { el.style.outline = '1px solid #f5b36b'; });
  await sleep(500);
  await shot(p, '17-ai-link-remove.png');
  await row.evaluate((el) => { el.style.outline = ''; });
  await row.locator('[data-action="remove-link"]').click();
  await p.waitForSelector('[data-testid="idea-details"] .pop-notice:has-text("Link removed.")');
  await p.waitForSelector('[data-testid="idea-details"] li[data-edge="idea:CAFE-2026-002|NEEDS|capability:ai-solution-brainstorming"]', { state: 'detached' });
  await p.click('[data-testid="idea-details"] [data-action="back"]');
}

// The Inbox: a reply sorted by the fake AI (Applied + Needs your OK), a held list of people, and a note with no Café ID.
async function inboxShots(p) {
  const fx = path.join(APP, 'tests/fixtures/inbox');
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  // The E2 with the two questions goes out first: answers are saved on their own only against questions we sent.
  const e2 = await post('/api/ideas/CAFE-2026-001/draft', { template: 'E2' });
  await post('/api/outbox/update', { key: e2.key, body: 'Hi,\n\nTwo quick questions before review:\n1. How many requests a week?\n2. Who does it today?\n\nThanks' });
  await post('/api/outbox/approve', { key: e2.key });
  await post('/api/outbox/sent', { key: e2.key });
  await p.click('.titlebar [data-action="inbox"]');
  await p.waitForSelector('[data-testid="inbox-drop"]');
  // A name with an accent and an en dash: it must reach the server intact.
  const named = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'cafe-tour-')), 'RE Café – update.eml');
  await fs.copyFile(path.join(fx, 'reply.eml'), named);
  await p.setInputFiles('[data-testid="inbox-file"]', named);
  await p.waitForSelector('.ib-item [data-group="applied"]', { timeout: 120000 });
  await p.waitForSelector('.ib-item [data-group="ok"]');
  await sleep(1200);
  await shot(p, '22-inbox-drop.png');
  const dropped = (await (await fetch(`${base}/api/inbox`)).json()).items.find((i) => i.type === 'email');
  if (dropped?.name !== 'RE Café – update.eml') throw new Error(`inbox: the file name arrived as ${dropped?.name}`);
  console.log('  dropped as:', dropped.name, '|', dropped.actions.map((r) => `${r.label} [${r.kind}/${r.status}]`).join(' | '));
  const hist = await (await fetch(`${base}/api/ideas/CAFE-2026-001/history`)).json();
  if (!hist.some((h) => h.action === 'inbox')) throw new Error('inbox: no Inbox line in the idea history');
  console.log('  history:', hist.filter((h) => h.action === 'inbox').map((h) => h.detail).join(' | '));
  await p.setInputFiles('[data-testid="inbox-file"]', path.join(fx, 'held-tracker.csv'));
  await p.waitForSelector('.ib-item [data-group="held"]', { timeout: 120000 });
  await sleep(800);
  await shot(p, '23-inbox-held.png');
  await p.fill('[data-testid="inbox-paste"]', 'Quick call notes. Someone on the desk team asked for a weekly summary of open requests by region.\nThey will send an example next week.');
  await p.click('[data-action="add-note"]');
  await p.waitForSelector('[data-testid="which-idea"]', { timeout: 120000 });
  await sleep(800);
  await shot(p, '24-inbox-ask.png');
  // The title bar count follows the inbox: one waiting reply, one held, one asking.
  console.log('  title bar:', await p.textContent('.titlebar [data-action="inbox"]'));
  await p.keyboard.press('Escape');
}

// The Inbox with no AI (provider pinned to None, no fake): the "Working by hand" badge and problems, then an Undo
// that is partly refused because an idea the import made has been worked on since. Runs without CAFE_AI_FAKE.
const THIRD_EXPORT = [
  'ID,Title,Submitter Name,CS Function,Region,Participation Type,Team Members and Lead,Business Challenge,Desired Outcomes,Current Process,Support Requested,Have you already experimented with AI for this idea?',
  '21,Visitor badge reminders,Person 21 (CS),Workplace,EMEA,Individual,,Visitor badges are chased by email each morning.,;#Save time;#,Email the front desk.,;#Agent Design Guidance;#,No',
  '22,Vendor invoice triage,Person 22 (CS),Finance Ops,AMER,Individual,,Invoices are sorted by hand into queues.,;#Improve quality;#,Read each invoice.,;#AI Solution Brainstorming;#,No',
].join('\n');

async function inboxHandShots(p, restart) {
  const fx = path.join(APP, 'tests/fixtures/inbox');
  await restart({ CAFE_AI_FAKE: '' });
  await post('/api/ai/provider', { provider: 'none' });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('canvas');
  await sleep(2500);
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await p.click('.titlebar [data-action="inbox"]');
  await p.waitForSelector('[data-testid="inbox-drop"]');
  await p.setInputFiles('[data-testid="inbox-file"]', path.join(fx, 'transcript.vtt'));
  await p.waitForSelector('[data-testid="needs-hand"]', { timeout: 120000 });
  await sleep(1000);
  await shot(p, '25-inbox-by-hand.png');

  const before = new Set((await (await fetch(`${base}/api/state`)).json()).ideas.map((i) => i.id));
  const csv = path.join(workspace, 'third-export.csv');
  await fs.writeFile(csv, THIRD_EXPORT);
  await p.setInputFiles('[data-testid="inbox-file"]', csv);
  await p.waitForSelector('.ib-item:has-text("third-export.csv") [data-action="undo"]', { timeout: 120000 });
  const made = (await (await fetch(`${base}/api/state`)).json()).ideas.map((i) => i.id).filter((id) => !before.has(id));
  if (made.length < 2) throw new Error(`inbox undo: expected two new ideas, got ${made.length}`);
  await post(`/api/ideas/${made[0]}/tick`, { step: 's2a', done: true });
  await p.click('.ib-item:has-text("third-export.csv") [data-action="undo"]');
  await p.waitForSelector('[data-testid="item-notice"]');
  console.log('  undo notice:', await p.textContent('[data-testid="item-notice"]'));
  await sleep(1000);
  await shot(p, '26-inbox-undo-partial.png');
  await p.keyboard.press('Escape');
  await post('/api/ai/provider', { provider: 'auto' });
}

// The design series on CAFE-2026-002 with the fake AI: Tool picker (suggest, save), the brainstorm one question at a time
// (a suggested answer, "I don't know" to the E2, a typed answer), done, the Café check, Approve with the CSIC
// suggestion, then plan.md and the kits. Needs CAFE_AI_FAKE=1.
async function designShots(p) {
  const assert = (ok, msg) => { if (!ok) throw new Error(`design: ${msg}`); };
  const D = '[data-testid="idea-details"]';
  const notice = (text) => p.waitForSelector(`${D} .pop-notice:has-text("${text}")`, { timeout: 90000 });
  const into = async (sel) => { await p.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'start' })); await sleep(400); };
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  // The series opens at stage 3; the panel shows the decision as a card above the tool picker.
  await post('/api/ideas/CAFE-2026-002/stage', { stage: 3 });
  await p.evaluate(() => window.__cafe.refresh());
  await sleep(500);
  await p.evaluate(() => window.__cafe.openIdea('CAFE-2026-002'));
  await p.waitForSelector(`${D} [data-testid="tool-picker"]`);
  assert((await p.locator(`${D} [data-testid="review-card"]`).count()) === 1, 'no decision card at stage 3');
  assert((await p.locator(`${D} [data-testid="review"]`).count()) === 0, 'the decision form is still editable at stage 3');
  await sleep(2500);
  // Tool picker: the AI suggests the one tool, with why it picked it; it is a custom app, so the CSIC note shows.
  await p.click(`${D} [data-action="tools-suggest"]`);
  await p.waitForSelector(`${D} .tp-row.suggested`, { timeout: 90000 });
  assert((await p.locator(`${D} .tp-row.suggested`).count()) === 1, 'expected one suggested row');
  assert((await p.locator(`${D} [data-testid="tool-context"][open] li`).count()) >= 1, 'no "why this tool" lines on the suggestion');
  assert((await p.locator(`${D} [data-testid="csic-note"]`).count()) === 1, 'no CSIC note on the custom-app row');
  await into(`${D} [data-testid="tool-picker"]`);
  await shot(p, '40-toolpicker.png');
  await p.click(`${D} [data-action="tools-save"]`);
  await notice('Saved 1 feature');
  await p.waitForSelector(`${D} .tp-row.suggested`, { state: 'detached', timeout: 10000 }); // saved: no longer suggestions
  const graph = await (await fetch(`${base}/api/graph`)).json();
  const built = (graph.edges ?? graph.links ?? []).filter((e) => e.rel === 'BUILT_WITH' && String(e.source ?? '').includes('CAFE-2026-002:approach.md'));
  assert(built.length >= 1 && built.every((e) => e.confirmed !== false), 'the picks made no confirmed (solid) Capability → Tool links');
  console.log('  BUILT_WITH links from the picks:', built.length);
  // Brainstorm: the first question, with its why and suggested answers.
  await p.click(`${D} [data-action="next-question"]`);
  await p.waitForSelector(`${D} .ds-step[data-step="1"]`, { timeout: 90000 });
  await into(`${D} [data-testid="design"]`);
  await shot(p, '41-design-step.png');
  await p.locator(`${D} .ds-step[data-step="1"] [data-action="pick-suggested"]`).first().click();
  await notice('Answer to question 1 saved.');
  await p.click(`${D} [data-action="next-question"]`);
  await p.waitForSelector(`${D} .ds-step[data-step="2"]`, { timeout: 90000 });
  await p.click(`${D} .ds-step[data-step="2"] [data-action="idk"]`);
  await p.waitForSelector(`${D} .ds-step[data-step="2"] [data-testid="asked-team"]`);
  const outbox = (await (await fetch(`${base}/api/state`)).json()).outbox.filter((m) => m.idea === 'CAFE-2026-002' && m.template === 'E2' && m.status === 'draft');
  assert(outbox.length === 1, 'no E2 draft after "I don\'t know"');
  await into(`${D} .ds-step[data-step="2"]`);
  await p.locator(`${D} .ds-step[data-step="1"]`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await shot(p, '42-design-idk.png');
  await p.click(`${D} .ds-step[data-step="2"] [data-action="open-outbox"]`);
  await p.waitForSelector('[data-group]');
  await p.keyboard.press('Escape');
  await p.waitForSelector(D);
  // The third question by hand-typed answer, then the AI says done.
  await p.click(`${D} [data-action="next-question"]`);
  await p.waitForSelector(`${D} .ds-step[data-step="3"]`, { timeout: 90000 });
  await p.fill(`${D} .ds-step[data-step="3"] textarea`, 'A citizen builder in the desk team, with a synthetic sample of twenty requests.');
  await p.click(`${D} .ds-step[data-step="3"] [data-action="save-answer"]`);
  await notice('Answer to question 3 saved.');
  await p.click(`${D} [data-action="next-question"]`);
  await p.waitForSelector(`${D} [data-testid="design-complete"]`, { timeout: 90000 });
  // Approve: the custom-app pick is a CSIC flag, so the notice says so and the CSIC move is offered (Yes/No).
  await p.click(`${D} [data-action="approve-design"]`);
  await p.waitForSelector(`${D} [data-testid="suggest"]`);
  assert((await p.textContent(`${D} [data-testid="suggest"]`)).includes('CSIC'), 'no CSIC suggestion after approve');
  await into(`${D} [data-testid="design-complete"]`);
  await shot(p, '43-cafe-check.png');
  await p.click(`${D} [data-action="suggest-no"]`);
  // Plan and kits.
  await p.click(`${D} [data-action="write-plan"]`);
  await p.waitForSelector(`${D} .pk-files li`, { timeout: 90000 });
  assert(await p.isVisible(`${D} [data-action="copy-instruction"]`), 'no Copy build instruction for the custom-app kit');
  await p.click(`${D} [data-action="toggle-plan-md"]`);
  await into(`${D} [data-testid="plan-kits"]`);
  await shot(p, '44-plan-kits.png');
  const stage = (await (await fetch(`${base}/api/state`)).json()).ideas.find((i) => i.id === 'CAFE-2026-002');
  assert(!stage.closed, 'the idea was closed without a click on Yes');
  // Stage 4: every earlier section is a read-only card; Edit reopens one.
  await p.click(`${D} [data-action="stage"]`);
  await p.waitForSelector('[data-testid="stage-menu"]');
  await shot(p, '47-stage-menu.png');
  await p.click('[data-action="stage-pick"][data-value="stage:4"]');
  await p.waitForSelector(`${D} [data-testid="plan-card"]`, { timeout: 10000 });
  assert((await p.locator(`${D} [data-testid="tool-picker"]`).count()) === 0, 'the tool picker is still a form at stage 4');
  await into(`${D} [data-testid="review-card"]`);
  await sleep(400);
  await shot(p, '45-stage4-cards.png');
  await p.click(`${D} [data-action="edit-tools-card"]`);
  await p.waitForSelector(`${D} [data-testid="tool-picker"]`);
  // Stage 1: no action section at all, only the Next hint.
  await p.click(`${D} [data-action="back"]`);
  await p.waitForSelector(D, { state: 'detached' });
  const first = (await (await fetch(`${base}/api/state`)).json()).ideas.find((i) => i.stage === 1 && !i.closed);
  assert(first, 'no stage-1 idea to show');
  await p.evaluate((id) => window.__cafe.openIdea(id), first.id);
  await p.waitForSelector(`${D} [data-action="stage"]`);
  assert((await p.locator(`${D} [data-testid="review"], ${D} [data-testid="tool-picker"], ${D} [data-testid="design"]`).count()) === 0, 'an action section shows at stage 1');
  await sleep(1500);
  await shot(p, '46-stage1.png');
}

// Selecting an idea star shows its card, not the pop-out; "Open idea" opens the pop-out. Also a real pointer click.
async function ideaCardShots(p) {
  const assert = (ok, msg) => { if (!ok) throw new Error(`ideacard: ${msg}`); };
  // Real pointer click on the star: the label wrapper's translate3d marks it; click 20px to its left.
  await p.evaluate(() => window.__cafe.hover('idea:CAFE-2026-002'));
  await sleep(1200);
  const spot = await p.evaluate(() => {
    for (const l of document.querySelectorAll('.star-label')) {
      if (!l.textContent.includes('CAFE-2026-002') && !l.closest('div[style*="translate3d"]')) continue;
      const w = l.closest('div[style*="translate3d"]'); if (!w) continue;
      const r = l.getBoundingClientRect();
      if (l.classList.contains('hot')) return { x: r.left, y: r.top + r.height / 2, left: l.classList.contains('left') };
    }
    return null;
  });
  assert(spot, 'no hot label found for the pointer click');
  await p.evaluate(() => window.__cafe.hover(null));
  const x = spot.left ? spot.x + 20 + 0 : spot.x - 20;
  console.log('  pointer click at', Math.round(x), Math.round(spot.y));
  await p.mouse.click(x, spot.y);
  await sleep(1500);
  const pointerCard = await p.locator('[data-testid="ideacard"]').count();
  const pointerDialog = await p.locator('[role="dialog"]').count();
  console.log(`  pointer click: card=${pointerCard} dialog=${pointerDialog}`);
  assert(pointerDialog === 0, 'a star click opened a dialog');
  assert(pointerCard === 1, 'a star click did not show the idea card');
  await p.keyboard.press('Escape');
  await sleep(300);
  assert((await p.locator('[data-testid="ideacard"]').count()) === 0, 'Esc did not close the card');
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await sleep(1500);
  await p.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
  await p.waitForSelector('[data-testid="ideacard"]');
  await sleep(3500);
  assert((await p.locator('[role="dialog"]').count()) === 0, 'selecting opened a dialog');
  await shot(p, '20-idea-card.png');
  await p.click('[data-testid="ideacard"] [data-action="open-idea"]');
  await p.waitForSelector('[data-testid="idea-details"]');
  assert((await p.locator('[role="dialog"]').count()) === 0, 'Open idea opened a dialog');
  await sleep(2500);
  await shot(p, '21-idea-card-open.png');
  await p.click('[data-testid="idea-details"] [data-action="back"]');
  await p.waitForSelector('[data-testid="idea-details"]', { state: 'detached' });
  await p.evaluate(() => window.__cafe.select(null));
}

// Below 1000px wide: the side panels become drawers behind two edge tabs.
async function drawersShots(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  await pinFull(ctx);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(base, { waitUntil: 'networkidle' });
  await p.waitForSelector('canvas');
  await sleep(2500);
  await shot(p, '15-narrow.png');
  await p.click('[data-action="drawer-ideas"]');
  await p.waitForSelector('[data-testid="drawer"] .idea-list');
  await sleep(800);
  await shot(p, '15-drawers.png');
  // The drawer hosts an idea's details the same way, with Back; Esc goes Back first, then closes the drawer.
  await p.locator('[data-testid="drawer"] .idea-list li').first().click();
  await p.waitForSelector('[data-testid="drawer"] [data-testid="idea-details"]');
  await sleep(1500);
  await shot(p, '15-drawer-idea.png');
  await p.click('[data-testid="drawer"] [data-action="back"]');
  await p.waitForSelector('[data-testid="drawer"] .idea-list');
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid="drawer"]', { state: 'detached' });
  await p.click('[data-action="drawer-charts"]');
  await p.waitForSelector('[data-testid="drawer"] .kpis');
  await sleep(1200);
  await shot(p, '15-drawers-charts.png');
  await p.click('[data-testid="drawer"] .x');
  await p.waitForSelector('[data-testid="drawer"]', { state: 'detached' });
  await ctx.close();
}

// A workspace with no ideas: the 3D universe says what to do.
async function emptyShot(errors, restart) {
  const empty = `${workspace}-empty`;
  if (!safeToDelete(empty)) throw new Error(`Refusing to delete ${empty}`);
  await fs.rm(empty, { recursive: true, force: true });
  await restart({}, empty);
  const gl = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
  const p = await page(gl, errors);
  await p.waitForSelector('canvas');
  await p.waitForSelector('[data-testid="universe-empty"]');
  await sleep(1500);
  await shot(p, '18-empty-3d.png');
  await gl.close();
  await fs.rm(empty, { recursive: true, force: true });
}

// Quality: a fresh browser on SwiftShader auto-picks Lite (with its notice); then the same scene in Full, Lite and Flat,
// with the measured frame time (requestAnimationFrame, as scripts/make-scale-data.mjs measures it) for Full and Lite.
async function frameStats(p, seconds = 5) {
  const d = await p.evaluate((ms) => new Promise((resolve) => {
    const d = []; let last = performance.now(); const end = last + ms;
    const step = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(step); else resolve(d); };
    requestAnimationFrame(step);
  }), seconds * 1000);
  const s = [...d].sort((a, c) => a - c);
  return { frames: d.length, avgMs: Math.round(d.reduce((a, c) => a + c, 0) / d.length), p95Ms: Math.round(s[Math.floor(s.length * 0.95)]) };
}

async function qualityShots(gl, errors) {
  const assert = (ok, msg) => { if (!ok) throw new Error(`quality: ${msg}`); };
  const p = await page(gl, errors, { fresh: true });
  await p.waitForSelector('canvas');
  await sleep(1500);
  const auto = await p.evaluate(() => ({ q: document.querySelector('[data-testid="universe"]')?.getAttribute('data-quality'), notice: document.querySelector('.notice')?.textContent ?? '',
    pill: document.querySelector('[data-action="quality"]')?.textContent, stored: localStorage.getItem('cafe-quality'), hand: localStorage.getItem('cafe-quality-by-hand') }));
  console.log(`  auto-pick: ${JSON.stringify(auto)}`);
  assert(auto.q === 'lite' && auto.pill === 'Quality: Lite' && auto.stored === 'lite' && auto.hand === '0', 'SwiftShader did not auto-pick Lite');
  assert(auto.notice.startsWith('Lite quality picked for this browser'), 'no auto-pick notice');
  await p.evaluate(() => window.__cafe.setNotice(null));
  const ID = 'idea:CAFE-2026-002';
  const SETTLE = 6000;
  const set = async (q, selected) => {
    await p.evaluate(([q, id]) => { window.__cafe.select(id); window.__cafe.setQuality(q); }, [q, selected ? ID : null]);
    await sleep(SETTLE);
    if (q !== 'flat') assert(await p.evaluate((q) => document.querySelector('[data-testid="universe"]')?.getAttribute('data-quality') === q, q), `not in ${q}`);
  };
  const times = {};
  await set('full', false);
  await p.mouse.move(960, 1075);
  await shot(p, '50-full.png');
  times.fullIdle = await frameStats(p);
  await set('full', true);
  await shot(p, '50-full-selected.png');
  times.fullSelected = await frameStats(p);
  await set('lite', false);
  await shot(p, '51-lite.png');
  times.liteIdle = await frameStats(p);
  await set('lite', true);
  await shot(p, '52-lite-selected.png');
  times.liteSelected = await frameStats(p);
  await set('flat', true);
  assert(await p.isVisible('[data-testid="flat2d"]'), 'Flat did not draw the 2D map');
  await shot(p, '53-flat.png');
  // The pill cycles Flat → Full and says so; the choice is remembered as set by hand.
  await p.click('[data-action="quality"]');
  assert((await p.textContent('[data-action="quality"]')) === 'Quality: Full', 'the pill did not cycle to Full');
  assert(await p.evaluate(() => localStorage.getItem('cafe-quality') === 'full' && localStorage.getItem('cafe-quality-by-hand') === '1'), 'the choice was not stored');
  const nodes = await (await fetch(`${base}/api/graph`)).json().then((g) => `${g.nodes.length} stars, ${g.edges.length} links`);
  console.log(`  frame time (${nodes}, SwiftShader, 1920×1080): ${JSON.stringify(times)}`);
  await fs.writeFile(path.join(out, 'frame-times.json'), JSON.stringify({ scene: nodes, ...times }, null, 2));
  await p.context().close();
}

const shot = async (p, name) => { await p.screenshot({ path: path.join(out, name), timeout: 120000 }); console.log(`  ${name}`); };

// The workspace is wiped on every run, so only ever delete a throwaway folder.
function safeToDelete(dir) {
  const under = (root) => { const rel = path.relative(path.resolve(root), dir); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
  return under(os.tmpdir()) || under('/private/tmp') || under('/tmp') || /tour|scratch/i.test(path.basename(dir));
}

async function main() {
  if (!safeToDelete(workspace)) {
    console.error(`Refusing to delete ${workspace}: the tour wipes its workspace, so pass a folder under the temp directory or one whose name contains "tour" or "scratch".`);
    process.exit(2);
  }
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(out, { recursive: true });
  const launch = (env = {}, ws = workspace) => spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), 'bin/cafe.ts', 'start', '--workspace', ws, '--port', String(port)], { cwd: APP, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  let server = launch();
  const restart = async (env, ws) => {
    server.kill('SIGTERM');
    await new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)));
    server = launch(env, ws);
    await waitForServer();
  };
  const errors = [];
  try {
    await waitForServer();
    await importCsv(flag('fixture', '') ? path.resolve(flag('fixture', '')) : path.join(APP, 'tests/fixtures/sample-export.csv'));
    for (const f of flags('extra')) await importCsv(path.resolve(f));
    // Spread the ideas over the stages so the rings show every colour.
    const { ideas } = await (await fetch(`${base}/api/state`)).json();
    const plan = [null, { stage: 2 }, { stage: 3 }, null, { stage: 2 }, { stage: 4 }, { stage: 3 }, { closeAs: 'csic' }];
    for (const [i, t] of plan.entries()) if (t && ideas[i]) await post(`/api/ideas/${ideas[i].id}/stage`, t);
    await seedAiLinks();

    console.log('WebGL:');
    const gl = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
    const p = await page(gl, errors);
    await p.waitForSelector('canvas');
    await sleep(3000);
    if (only === 'hover') {
      await p.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
      await sleep(3500);
      await shot(p, '02-selected.png');
      await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); window.__cafe.hover('team:gss'); });
      await sleep(2500);
      await shot(p, '05-hover.png');
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'popout' || only === 'panel') {
      await popoutShots(p);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'popouts2') {
      await popouts2Shots(p, gl, errors, restart);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'ai') {
      await aiShots(p);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'inbox') {
      await inboxShots(p);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'inboxhand') {
      await inboxHandShots(p, restart);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'drawers') {
      await gl.close();
      const narrow = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
      await drawersShots(narrow, errors);
      await narrow.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'focus') {
      await p.evaluate(() => window.__cafe.toggleFocus());
      await sleep(2500);
      await p.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
      await sleep(3500);
      await shot(p, '19-focus.png');
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'design') {
      if (process.env.CAFE_AI_FAKE !== '1') throw new Error('--only=design needs CAFE_AI_FAKE=1');
      await designShots(p);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'ideacard') {
      await ideaCardShots(p);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'empty') {
      await gl.close();
      await emptyShot(errors, restart);
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'quality') {
      await p.context().close(); // its Full universe would keep drawing in the background and skew the frame times
      await qualityShots(gl, errors);
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    if (only === 'panels') {
      await p.mouse.move(200, 330);
      await shot(p, '05-panels.png');
      await gl.close();
      console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
      process.exitCode = errors.length ? 1 : 0;
      return;
    }
    await shot(p, '01-universe.png');
    await p.hover('.idea-list li:nth-child(2)');
    await sleep(800);
    await shot(p, '05-panels.png');
    await p.mouse.move(960, 540);
    await p.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
    await sleep(3500); // software WebGL is slow; let the 0.9 s fly-to settle
    await shot(p, '02-selected.png');
    await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); window.__cafe.toggleLabels(); });
    await sleep(2200);
    await shot(p, '03-labels.png');
    await p.evaluate(() => { window.__cafe.toggleLabels(); window.__cafe.hover('team:gss'); });
    await sleep(800);
    await shot(p, '05-hover.png');
    await p.evaluate(() => window.__cafe.hover(null));
    await popoutShots(p);
    if (process.env.CAFE_AI_FAKE === '1') { await aiShots(p); await inboxShots(p); }
    await drawersShots(gl, errors);
    await popouts2Shots(p, gl, errors, restart);
    await inboxHandShots(p, restart);
    await gl.close();

    console.log('No WebGL:');
    const flat = await chromium.launch({ channel: 'chrome', headless: true, args: NO_GL });
    const f = await page(flat, errors);
    await f.waitForSelector('[data-testid="flat2d"]');
    await sleep(500);
    await shot(f, '04-flat.png');
    await f.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
    await sleep(300);
    await shot(f, '06-flat-selected.png');
    await flat.close();
    await emptyShot(errors, restart);
  } finally {
    server.kill('SIGTERM');
  }
  console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
