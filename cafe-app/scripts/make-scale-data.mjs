#!/usr/bin/env node
// Scale test of the universe. Generates a 60-row export (fictional names, 6 functions, varied support) and
// ~150 synthetic AI links into a scratch folder (nothing here is committed), imports them into a fresh
// workspace, then measures GET /api/graph and, in headless Chrome with software WebGL, the frame time with
// and without a selection, label placement and the fly-to. Starts its own server on a free port (never 4100).
//
//   npx tsx scripts/make-scale-data.mjs --out <scratch dir> [--rows 60] [--links 150] [--seconds 5] [--data-only]
//
// Writes <out>/scale-export.csv, <out>/workspace/, <out>/scale-universe.png, <out>/scale-report.json.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const out = path.resolve(flag('out', path.join(APP, '.scale')));
const ROWS = Number(flag('rows', '60'));
const LINKS = Number(flag('links', '150'));
const SECONDS = Number(flag('seconds', '5'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- deterministic data ---------- */

let seed = 20261020;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const some = (a, min, max) => { const n = min + Math.floor(rnd() * (max - min + 1)); return [...new Set(Array.from({ length: n }, () => pick(a)))]; };

const FIRST = ['Avery', 'Priya', 'Mateo', 'Ingrid', 'Zainab', 'Lucía', 'Dmitri', 'Kwame', 'Hana', 'Noor', 'Rhys', 'Tomasz', 'Chloé', 'Liam', 'Aisha', 'Callum',
  'Sofia', 'Jin-woo', 'Elena', 'Mikael', 'Anjali', 'Thiago', 'Marta', 'Samir', 'Oluwaseun', 'Fatima', 'Mei-Ling', 'Gustavo', 'Ines', 'Kenji'];
const LAST = ['Chen', 'Nair', 'Álvarez', 'Solberg', 'Okafor', 'Fernández', 'Volkov', 'Mensah', 'Kobayashi', 'El-Sayed', 'Llewellyn', 'Wiśniewski', 'Dubois',
  "O'Connell", 'Rahman', 'Reid', 'Marchetti', 'Park', 'Petrova', 'Lindqvist', 'Deshpande', 'Carvalho', 'Kowalczyk', 'Haddad', 'Wong'];
const FUNCTIONS = ['Legal Ops', 'Workplace', 'BSI', 'GSS', 'Procurement', 'HR Ops'];
const REGIONS = ['AMER', 'EMEA', 'APAC'];
const SUPPORT = ['Agent Design Guidance', 'Data Access Guidance', 'Prompt Coaching', 'AI Solution Brainstorming', 'Collaboration Tooling Guidance'];
const OUTCOMES = ['Save time', 'Reduce risk', 'Improve quality', 'Improve visibility', 'Improve experience'];
const VERBS = ['summariser', 'assistant', 'finder', 'tracker', 'helper', 'router', 'checker', 'dashboard', 'FAQ bot', 'drafter'];
const NOUNS = ['Vendor contract', 'Desk booking', 'Onboarding checklist', 'Expense anomaly', 'Meeting notes', 'Travel policy', 'Facilities request',
  'Procurement threshold', 'Invoice category', 'Lease renewal', 'Access request', 'Training record', 'Supplier risk', 'Policy change', 'Visitor badge',
  'Catering order', 'Mailroom parcel', 'Contract clause', 'Payroll query', 'Audit evidence'];

const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const multi = (xs) => `;#${xs.join(';#')};#`;

function makeExport() {
  const header = ['ID', 'Title', 'Submitter Name', 'CS Function', 'Region', 'Participation Type', 'Team Members and Lead', 'Business Challenge',
    'Desired Outcomes', 'Current Process', 'Support Requested', 'Have you already experimented with AI for this idea?'];
  const titles = new Set();
  const rows = [];
  for (let i = 1; i <= ROWS; i++) {
    let title;
    do title = `${pick(NOUNS)} ${pick(VERBS)}`; while (titles.has(title));
    titles.add(title);
    const sub = person(); const team = rnd() < 0.35;
    rows.push([String(i), title, `${sub} (CS)`, FUNCTIONS[i % FUNCTIONS.length], pick(REGIONS), team ? 'Team' : 'Individual',
      team ? `${sub} (Lead); ${person()} (Sponsor); ${person()}` : '',
      `${title.split(' ')[0]} work is done by hand and takes most of a day each week.`, multi(some(OUTCOMES, 1, 3)),
      'A person reads each item and updates a spreadsheet.', multi(some(SUPPORT, 1, 3)), rnd() < 0.4 ? 'Yes' : 'No']);
  }
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

const CAPS = ['Document parsing', 'Workflow routing', 'Classification', 'Summarisation', 'Anomaly detection', 'Search over policies', 'Form filling',
  'Scheduling', 'Status tracking', 'Q&A over FAQs', 'Data extraction', 'Notification'];
const SYSTEMS = ['Shared mailbox', 'SharePoint list', 'Service Catalogue', 'ServiceNow', 'Expense system', 'Contract repository', 'HR system', 'Excel tracker'];
const TOOLS = ['Copilot Studio', 'Power Apps', 'Dataiku', 'UiPath', 'Microsoft Copilot', 'custom app', 'Power Automate'];
const PAINS = ['Manual triage', 'Re-keying data', 'Missed deadlines', 'Repeated questions', 'No visibility of status', 'Slow approvals'];
const slug = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

/** ~LINKS AI links on 20 ideas: idea→capability/painpoint, capability→system/tool; a mix of confirmed, pending and new stars. */
function makeLinks(ideaIds) {
  const links = [];
  const seen = new Set();
  const add = (l) => { const k = `${l.from}|${l.rel}|${l.to}`; if (!seen.has(k)) { seen.add(k); links.push(l); } };
  const twenty = ideaIds.slice(0, 20);
  while (links.length < LINKS) {
    const idea = `idea:${pick(twenty)}`;
    const conf = Math.round((0.5 + rnd() * 0.45) * 100) / 100;
    const status = rnd() < 0.3 ? 'confirmed' : 'pending';
    const base = { description: 'Synthetic scale link', source: 'ai: scale test', confidence: conf, status };
    const r = rnd();
    // Half the capabilities are specific to a kind of work, so the universe grows to 300+ stars.
    if (r < 0.4) { const c = rnd() < 0.6 ? `${pick(CAPS)} for ${pick(NOUNS).toLowerCase()}s` : pick(CAPS); add({ ...base, from: idea, to: `capability:${slug(c)}`, rel: 'NEEDS', newNodes: [{ id: `capability:${slug(c)}`, type: 'Capability', label: c }] }); }
    else if (r < 0.55) { const p = rnd() < 0.6 ? `${pick(PAINS)} on ${pick(NOUNS).toLowerCase()}s` : pick(PAINS); add({ ...base, from: idea, to: `painpoint:${slug(p)}`, rel: 'REPLACES', newNodes: [{ id: `painpoint:${slug(p)}`, type: 'PainPoint', label: p }] }); }
    else if (r < 0.8) { const c = pick(CAPS); const s = pick(SYSTEMS);
      add({ ...base, from: `capability:${slug(c)}`, to: `system:${slug(s)}`, rel: 'USES_DATA', newNodes: [{ id: `capability:${slug(c)}`, type: 'Capability', label: c }, { id: `system:${slug(s)}`, type: 'System', label: s }] }); }
    else { const c = pick(CAPS); const t = pick(TOOLS);
      add({ ...base, from: `capability:${slug(c)}`, to: `tool:${slug(t)}`, rel: 'BUILT_WITH', newNodes: [{ id: `capability:${slug(c)}`, type: 'Capability', label: c }, { id: `tool:${slug(t)}`, type: 'Tool', label: t }] }); }
  }
  return links;
}

/* ---------- run ---------- */

async function main() {
  await fs.mkdir(out, { recursive: true });
  const csv = path.join(out, 'scale-export.csv');
  await fs.writeFile(csv, makeExport());
  console.log(`Wrote ${csv} (${ROWS} rows)`);
  if (argv.includes('--data-only')) return;

  const { initWorkspace } = await import('../src/workspace/init.ts');
  const { importExport } = await import('../src/import/importRows.ts');
  const { loadSteps } = await import('../src/rules/stages.ts');
  const { appendAiLink } = await import('../src/graph/store.ts');
  const { createApp } = await import('../src/server/server.ts');
  const { createConnector } = await import('../src/ai/connector.ts');
  const { fixedClock } = await import('../src/clock.ts');

  const ws = path.join(out, 'workspace');
  await fs.rm(ws, { recursive: true, force: true });
  const clock = fixedClock('2026-10-20');
  await initWorkspace(ws);
  const report = await importExport(ws, csv, { clock, steps: await loadSteps(ws) });
  const links = makeLinks(report.created.map((c) => c.id));
  for (const l of links) await appendAiLink(ws, l);
  console.log(`Imported ${report.created.length} ideas (${report.errors.length} errors); appended ${links.length} AI links`);

  const server = createApp({ root: ws, clock, connector: createConnector({ providers: [], settings: {} }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  if (port === 4100) throw new Error('Never port 4100');
  const base = `http://localhost:${port}`;
  const result = { ideas: report.created.length, aiLinks: links.length };
  try {
    // GET /api/graph: the first call computes and caches the layout; later ones read the cache.
    const times = [];
    let g;
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      g = await (await fetch(`${base}/api/graph`)).json();
      times.push(Math.round(performance.now() - t0));
    }
    const finite = Object.values(g.layout).every((p) => p.every(Number.isFinite));
    Object.assign(result, {
      graphMsCold: times[0], graphMsWarm: Math.round(times.slice(1).reduce((a, b) => a + b, 0) / (times.length - 1)),
      nodes: g.nodes.length, edges: g.edges.length, unconfirmed: g.unconfirmed, graphProblems: g.problems.length,
      layoutCovers: Object.keys(g.layout).length === g.nodes.length && finite, responseKB: Math.round(JSON.stringify(g).length / 1024),
    });
    console.log(`GET /api/graph: cold ${times[0]} ms, warm ${result.graphMsWarm} ms; ${g.nodes.length} nodes, ${g.edges.length} edges`);
    Object.assign(result, await browser(base, g));
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
  await fs.writeFile(path.join(out, 'scale-report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  const broken = !result.layoutCovers || result.consoleErrors.length || !result.labelsVisible || result.labelOverlaps || !result.flyToCloser;
  if (broken) console.log('SCALE: something broke (see above)');
  process.exitCode = broken ? 1 : 0;
}

async function browser(base, g) {
  const { chromium } = await import('playwright-core');
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
    p.on('pageerror', (e) => errors.push(String(e)));
    const t0 = Date.now();
    await p.goto(base, { waitUntil: 'networkidle' });
    await p.waitForSelector('canvas', { timeout: 60_000 });
    await p.waitForFunction(() => document.querySelectorAll('.star-label').length > 0, null, { timeout: 60_000 });
    const firstPaintMs = Date.now() - t0;
    await sleep(4000);
    const frames = (s) => p.evaluate((ms) => new Promise((resolve) => {
      const d = []; let last = performance.now(); const end = last + ms;
      const step = (t) => { d.push(t - last); last = t; if (t < end) requestAnimationFrame(step); else resolve(d); };
      requestAnimationFrame(step);
    }), s * 1000);
    const stats = (d) => { const s = [...d].sort((a, c) => a - c); return { frames: d.length, avgMs: Math.round(d.reduce((a, c) => a + c, 0) / d.length), p95Ms: Math.round(s[Math.floor(s.length * 0.95)]) }; };
    const labels = () => p.evaluate(() => {
      const vis = [...document.querySelectorAll('.star-label')].filter((el) => el.style.visibility !== 'hidden')
        .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      let overlaps = 0;
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i]; const c = vis[j];
        if (a.left < c.right - 4 && c.left < a.right - 4 && a.top < c.bottom - 4 && c.top < a.bottom - 4) overlaps++;
      }
      return { total: document.querySelectorAll('.star-label').length, visible: vis.length, overlaps };
    });
    const idle = stats(await frames(SECONDS));
    const labelsIdle = await labels();

    // Select the busiest idea: the camera flies to it, so its label ends nearer the centre of the screen.
    const deg = new Map();
    for (const e of g.edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
    const target = g.nodes.filter((n) => n.type === 'Idea').sort((a, c) => (deg.get(c.id) ?? 0) - (deg.get(a.id) ?? 0))[0];
    const dist = () => p.evaluate((label) => {
      const el = [...document.querySelectorAll('.star-label .l1')].find((x) => x.textContent === label);
      const r = el?.closest('.star-label')?.getBoundingClientRect();
      return r && r.width ? Math.round(Math.hypot(r.left - 960, r.top + r.height / 2 - 540)) : null;
    }, target.label);
    const before = await dist();
    await p.evaluate((id) => window.__cafe.click(id), target.id);
    await sleep(5000);
    const after = await dist();
    const selected = stats(await frames(SECONDS));
    const labelsSelected = await labels();
    await p.screenshot({ path: path.join(out, 'scale-universe.png') });
    await p.evaluate(() => window.__cafe.select(null));
    return {
      firstPaintMs, frameIdle: idle, frameSelected: selected, labelsIdle, labelsSelected,
      labelsVisible: labelsIdle.visible > 0 && labelsSelected.visible > 0, labelOverlaps: labelsIdle.overlaps + labelsSelected.overlaps,
      flyTo: { target: target.id, distBefore: before, distAfter: after }, flyToCloser: after !== null && (before === null || after < before),
      consoleErrors: errors,
    };
  } finally {
    await b.close();
  }
}

await main();
