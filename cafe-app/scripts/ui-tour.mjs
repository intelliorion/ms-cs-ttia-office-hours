#!/usr/bin/env node
// Screenshot tour of the Café page. Starts its own server on a scratch workspace,
// imports sample ideas through the API, and saves screenshots. Never touches port 4100.
//
//   node scripts/ui-tour.mjs --workspace <scratch dir> --out <shots dir> [--port 4103] [--extra extra.csv ...] [--only=panels|hover|popout|popouts2|ai|inbox|inboxhand|drawers|empty|focus|ideacard]  (ai and inbox need CAFE_AI_FAKE=1; inboxhand restarts the server without it;
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

async function page(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
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

// The idea pop-out, a review's suggestion inside it, and the card for a star that is not an idea.
async function popoutShots(p) {
  await p.evaluate(() => window.__cafe.openIdea('CAFE-2026-002')); // the card's Open idea
  await p.waitForSelector('.idea-pop');
  await sleep(3500);
  await shot(p, '06-popout.png');
  // A CSIC review through the page: tick two criteria, pick the decision, give a reason, save.
  const crit = p.locator('.idea-pop .criteria input');
  await crit.nth(0).check(); await crit.nth(2).check();
  await p.selectOption('.idea-pop [data-action="decision"]', 'csic');
  await p.fill('.idea-pop textarea.reason', 'It needs the live shared mailbox, so it belongs in the CSIC Repository.');
  await p.click('.idea-pop [data-action="save-review"]');
  await p.waitForSelector('[data-testid="suggest"]');
  await sleep(800);
  await shot(p, '07-popout-suggest.png');
  await p.click('.idea-pop [data-action="suggest-no"]');
  await p.keyboard.press('Escape');
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
  await p.waitForSelector('.idea-pop');
  await sleep(3000);
  await p.click('.idea-pop [data-action="ai-grow"]');
  await p.waitForSelector('.idea-pop .pop-notice:has-text("Added")', { timeout: 60000 });
  await sleep(3500);
  await p.locator('.idea-pop [data-action="ai-grow"]').scrollIntoViewIfNeeded();
  await shot(p, '14-grown.png');
  // A confirmed AI link still has Remove.
  const row = p.locator('.idea-pop li[data-edge="idea:CAFE-2026-002|NEEDS|capability:ai-solution-brainstorming"]');
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((el) => { el.style.outline = '1px solid #f5b36b'; });
  await sleep(500);
  await shot(p, '17-ai-link-remove.png');
  await row.evaluate((el) => { el.style.outline = ''; });
  await row.locator('[data-action="remove-link"]').click();
  await p.waitForSelector('.idea-pop .pop-notice:has-text("Link removed.")');
  await p.waitForSelector('.idea-pop li[data-edge="idea:CAFE-2026-002|NEEDS|capability:ai-solution-brainstorming"]', { state: 'detached' });
  await p.keyboard.press('Escape');
}

// The Inbox: a reply sorted by the fake AI (Applied + Needs your OK), a held list of people, and a note with no Café ID.
async function inboxShots(p) {
  const fx = path.join(APP, 'tests/fixtures/inbox');
  await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); });
  await p.click('.titlebar [data-action="inbox"]');
  await p.waitForSelector('[data-testid="inbox-drop"]');
  await p.setInputFiles('[data-testid="inbox-file"]', path.join(fx, 'reply.eml'));
  await p.waitForSelector('.ib-item [data-group="applied"]', { timeout: 120000 });
  await p.waitForSelector('.ib-item [data-group="ok"]');
  await sleep(1200);
  await shot(p, '22-inbox-drop.png');
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
  await shot(p, '26-inbox-undo-refused.png');
  await p.keyboard.press('Escape');
  await post('/api/ai/provider', { provider: 'auto' });
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
  await p.waitForSelector('[role="dialog"]');
  await sleep(2500);
  await shot(p, '21-idea-card-open.png');
  await p.keyboard.press('Escape');
  await p.waitForSelector('[role="dialog"]', { state: 'detached' });
  await p.evaluate(() => window.__cafe.select(null));
}

// Below 1000px wide: the side panels become drawers behind two edge tabs.
async function drawersShots(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
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
    await importCsv(path.join(APP, 'tests/fixtures/sample-export.csv'));
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
    if (only === 'popout') {
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
