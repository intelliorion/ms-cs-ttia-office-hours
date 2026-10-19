#!/usr/bin/env node
// Screenshot tour of the Café page. Starts its own server on a scratch workspace,
// imports sample ideas through the API, and saves screenshots. Never touches port 4100.
//
//   node scripts/ui-tour.mjs --workspace <scratch dir> --out <shots dir> [--port 4103] [--extra extra.csv ...]
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
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

const shot = async (p, name) => { await p.screenshot({ path: path.join(out, name), timeout: 120000 }); console.log(`  ${name}`); };

async function main() {
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(out, { recursive: true });
  const server = spawn(process.execPath, [path.join(APP, 'node_modules/tsx/dist/cli.mjs'), 'bin/cafe.ts', 'start', '--workspace', workspace, '--port', String(port)], { cwd: APP, stdio: ['ignore', 'pipe', 'inherit'] });
  const errors = [];
  try {
    await waitForServer();
    await importCsv(path.join(APP, 'tests/fixtures/sample-export.csv'));
    for (const f of flags('extra')) await importCsv(path.resolve(f));
    // Spread the ideas over the stages so the rings show every colour.
    const { ideas } = await (await fetch(`${base}/api/state`)).json();
    const plan = [null, { stage: 2 }, { stage: 3 }, null, { stage: 2 }, { stage: 4 }, { stage: 3 }, { closeAs: 'csic' }];
    for (const [i, t] of plan.entries()) if (t && ideas[i]) await post(`/api/ideas/${ideas[i].id}/stage`, t);

    console.log('WebGL:');
    const gl = await chromium.launch({ channel: 'chrome', headless: true, args: GPU });
    const p = await page(gl, errors);
    await p.waitForSelector('canvas');
    await sleep(3000);
    await shot(p, '01-universe.png');
    await p.evaluate(() => window.__cafe.select('idea:CAFE-2026-002'));
    await sleep(3500); // software WebGL is slow; let the 0.9 s fly-to settle
    await shot(p, '02-selected.png');
    await p.evaluate(() => { window.__cafe.select(null); window.__cafe.resetView(); window.__cafe.toggleLabels(); });
    await sleep(2200);
    await shot(p, '03-labels.png');
    await p.evaluate(() => { window.__cafe.toggleLabels(); window.__cafe.hover('team:gss'); });
    await sleep(800);
    await shot(p, '05-hover.png');
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
