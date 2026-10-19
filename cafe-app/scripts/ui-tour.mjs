#!/usr/bin/env node
// Screenshot tour of the Café page. Starts its own server on a scratch workspace,
// imports sample ideas through the API, and saves screenshots. Never touches port 4100.
//
//   node scripts/ui-tour.mjs --workspace <scratch dir> --out <shots dir> [--port 4103] [--extra extra.csv ...] [--only=panels|hover|popout|popouts2]
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

// Two pending AI links (below 0.7, so dashed and unconfirmed) for the pop-out and the star card.
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
  ];
  await fs.writeFile(path.join(dir, 'ai-links.jsonl'), links.map((l) => JSON.stringify(l)).join('\n') + '\n');
}

// The idea pop-out, a review's suggestion inside it, and the card for a star that is not an idea.
async function popoutShots(p) {
  await p.evaluate(() => window.__cafe.click('idea:CAFE-2026-002')); // as a click on the star
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
  await p.fill('[data-field="operatorName"]', 'Johnny Hao');
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
  await post(`/api/ideas/${c}/draft`, { template: 'E3' }); // blocked: the series date is not set
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
  const launch = (env = {}) => spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), 'bin/cafe.ts', 'start', '--workspace', workspace, '--port', String(port)], { cwd: APP, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  let server = launch();
  const restart = async (env) => {
    server.kill('SIGTERM');
    await new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)));
    server = launch(env);
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
    await popouts2Shots(p, gl, errors, restart);
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
  } finally {
    server.kill('SIGTERM');
  }
  console.log(errors.length ? `Console errors:\n  ${errors.join('\n  ')}` : 'No console errors.');
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
