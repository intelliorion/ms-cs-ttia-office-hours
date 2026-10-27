import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { fixedClock } from '../src/clock';
import { createApp } from '../src/server/server';
import type { AddressInfo } from 'node:net';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { fullIdea } from './memory-chunks.test';
import { readFile } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FIXTURE } from './helpers';
import { readYaml } from '../src/workspace/files';

// Deep read's fake embedder and the fake AI: nothing is downloaded and nothing leaves the machine.
const was = { embed: process.env.CAFE_EMBED_FAKE, ai: process.env.CAFE_AI_FAKE };
beforeAll(() => { process.env.CAFE_EMBED_FAKE = '1'; process.env.CAFE_AI_FAKE = '1'; });
afterAll(() => { process.env.CAFE_EMBED_FAKE = was.embed; process.env.CAFE_AI_FAKE = was.ai; });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function boot(extra: Parameters<typeof startServer>[1] = {}) {
  // Upkeep's quiet time is 5 s in the app; the tests make it short.
  const s = await startServer('2026-10-19', { upkeep: { quietMs: 20, maxMs: 150 }, ...extra });
  close = () => new Promise<void>((resolve) => { s.server.close(() => resolve()); s.server.closeAllConnections(); });
  return s;
}
const post = (base: string, url: string, body: unknown = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (base: string, url: string) => fetch(base + url).then(j);
async function untilIdle(base: string) {
  for (let i = 0; i < 200; i++) {
    const m = await get(base, '/api/memory');
    if (m.job.status !== 'running') return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still running');
}

// The manual controls, with upkeep held back (a quiet time longer than the test), so only the buttons read.
const manual = () => boot({ upkeep: { quietMs: 60_000, maxMs: 60_000 } });

describe('Deep read routes', () => {
  it('with no index: 0 %, idle, the model named with its folder, and the ideas route says null', async () => {
    const { base, root } = await manual();
    await fullIdea(root);
    const m = await get(base, '/api/memory');
    expect(m.model).toMatchObject({ id: 'fake', cached: true });
    expect(m.model.dir).toMatch(/models$/);
    expect(m.job).toMatchObject({ status: 'idle', done: 0, total: 0 });
    expect(m.summary).toMatchObject({ chunks: 17, embedded: 0, percent: 0, available: false });
    expect(m.summary.ideas[0]).toMatchObject({ id: 'CAFE-2026-001', status: 'new', chunks: 17, embedded: 0 });
    expect(await get(base, '/api/memory/ideas?q=contracts')).toEqual({ ideas: null });
  });

  it('Run reads everything to 100 %; the ideas route then ranks by meaning; Rerun all reads again', async () => {
    const { base, root } = await manual();
    await fullIdea(root);
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking assistant', challenge: 'Desks are double booked every morning.', dedupe_key: 'b' }));
    const started = await j(await post(base, '/api/memory/run'));
    expect(['running', 'done']).toContain(started.job.status);
    const m = await untilIdle(base);
    expect(m.job).toMatchObject({ status: 'done', embedder: 'fake', done: 18, total: 18 });
    expect(m.job.lastRun).toMatchObject({ chunks: 18, ideas: 2 });
    expect(m.job.lastRun.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(m.summary).toMatchObject({ percent: 100, embedded: 18, available: true });
    expect(m.summary.kinds).toMatchObject({ submission: { chunks: 7, embedded: 7 }, email: { chunks: 2, embedded: 2 }, design: { chunks: 4, embedded: 4 }, review: { chunks: 1, embedded: 1 }, roadshow: { chunks: 1, embedded: 1 } });
    expect(m.summary.ideas.map((i: { status: string }) => i.status)).toEqual(['read', 'read']);
    const ranked = await get(base, '/api/memory/ideas?q=vendor+contracts+and+the+notice+date');
    expect(ranked.ideas[0]).toMatchObject({ id: 'CAFE-2026-001', section: 'title+challenge' });
    expect(ranked.ideas[0].score).toBeGreaterThan(0);
    expect(await get(base, '/api/memory/ideas?q=')).toEqual({ ideas: null });
    // Pause with nothing running and Continue are safe; Rerun all drops the index and reads it again.
    expect((await j(await post(base, '/api/memory/pause'))).job.status).toBe('done');
    await post(base, '/api/memory/rerun');
    const again = await untilIdle(base);
    expect(again.job).toMatchObject({ status: 'done', done: 18 });
    expect(again.summary.percent).toBe(100);
    // A changed idea shows stale until the next Run reads it.
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking assistant', challenge: 'Desks are double booked, and no-shows are never released.', dedupe_key: 'b' }));
    const stale = await get(base, '/api/memory');
    expect(stale.summary.ideas[1]).toMatchObject({ id: 'CAFE-2026-002', status: 'stale' });
    expect(stale.summary.percent).toBe(94);
    await post(base, '/api/memory/continue');
    expect((await untilIdle(base)).summary.percent).toBe(100);
  });

  it('a chat question only the index can answer: hits with a trace, the ideas lit; without the index the graph answers as before', async () => {
    const { base, root } = await manual();
    await fullIdea(root);
    // Before Deep read: the fake answers from the graph alone, as it always did, and nothing is searched.
    const before = await j(await post(base, '/api/chat', { text: 'what did teams say about data access?' }));
    expect(before).toMatchObject({ kind: 'question', reply: 'The graph does not hold that.', steps: [] });
    expect(before.trace).toBeUndefined();
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const e = await j(await post(base, '/api/chat', { text: 'what did teams say about data access?' }));
    expect(e.kind).toBe('question');
    expect(e.steps).toEqual([{ kind: 'search', text: 'Searching what people wrote', found: 1 }]);
    expect(e.trace).toEqual([[{ text: 'Search what people wrote for "what did teams say about data access"', size: 1 }]]);
    expect(e.highlight).toEqual(['idea:CAFE-2026-001']);
    // The agent wrote the idea as its code; the operator sees its title.
    expect(e.reply).toMatch(/^1 idea mentions that\. Vendor contract summariser \([\w+ ]+\): "/);
    expect(e.reply.toLowerCase()).toContain('data access');
  });
});

/** Polls the view until upkeep has settled and the state's last decision satisfies the test. */
async function untilDecided(base: string, ok: (d: { act: string; why: string; ideas: string[] } | undefined) => boolean) {
  for (let i = 0; i < 300; i++) {
    const m = await get(base, '/api/memory');
    if (!m.upkeep.waiting && m.job.status !== 'running' && ok(m.job.lastDecision)) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('upkeep never decided');
}
const importFixture = async (base: string) => fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv', 'content-type': 'application/octet-stream' }, body: await readFile(FIXTURE) });

describe('Deep read upkeep through the routes', () => {
  it('after a run, an Import re-reads only the new ideas ("after Import"); a save with no text change is skipped; the view says where upkeep stands', async () => {
    const { base, root } = await boot();
    await fullIdea(root);
    // The model is here (the fake one): the new idea is read on its own, no Run pressed.
    const auto = await untilDecided(base, (d) => d?.act === 'read');
    expect(auto.upkeep).toMatchObject({ on: true });
    expect(auto.job.lastDecision.why).toBe('read 2026-001 after a save · 17 passages');
    expect(auto.summary.percent).toBe(100);
    // A Run now has nothing left to read.
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const rows0 = (await fs.readFile(path.join(root, 'data', 'memory', 'index.jsonl'), 'utf8')).trim().split('\n');
    expect(rows0).toHaveLength(17);
    const res = await j(await importFixture(base));
    expect(res.created.length).toBeGreaterThan(0);
    const m = await untilDecided(base, (d) => d?.act === 'read');
    expect(m.job.lastDecision.why).toMatch(/^read 2026-002(, 2026-\d{3})*( and 2026-\d{3})? after Import · \d+ passages$/);
    expect(m.job.lastDecision.ideas).toEqual(res.created.map((c: { id: string }) => c.id));
    expect(m.job.lastDecision.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Everything is read again, and the first idea's rows were not touched (same lines, same order).
    expect(m.summary.percent).toBe(100);
    expect(m.summary.ideas.every((i: { status: string }) => i.status === 'read')).toBe(true);
    const rows1 = (await fs.readFile(path.join(root, 'data', 'memory', 'index.jsonl'), 'utf8')).trim().split('\n');
    expect(rows1.slice(0, 17)).toEqual(rows0);
    // Per idea: the kinds present and read, and when it was last read.
    expect(m.summary.ideas[0].kinds).toMatchObject({ submission: { chunks: 6, embedded: 6 }, email: { chunks: 2, embedded: 2 } });
    expect(m.summary.ideas[0].lastRead).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // A save that changes no passage is looked at and skipped, with the reason.
    await saveIdea(root, await loadIdea(root, 'CAFE-2026-001'));
    const sk = await untilDecided(base, (d) => d?.act === 'skip');
    expect(sk.job.lastDecision).toMatchObject({ act: 'skip', ideas: ['CAFE-2026-001'], why: 'nothing changed in 2026-001' });
    expect(sk.summary.percent).toBe(100);
  });

  it('the switch: off is kept in rules/settings.yaml, a change is then recorded as skipped, and on reads it', async () => {
    const { base, root } = await boot();
    await fullIdea(root);
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const off = await j(await post(base, '/api/memory/upkeep', { on: false }));
    expect(off.upkeep.on).toBe(false);
    expect(await readYaml<{ deepRead?: { upkeep?: boolean } }>(path.join(root, 'rules', 'settings.yaml'))).toMatchObject({ deepRead: { upkeep: false } });
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Vendor contract summariser', challenge: 'Contracts changed.', dedupe_key: 'a' }));
    const m = await untilDecided(base, (d) => d?.why === 'automatic upkeep is off');
    expect(m.summary.ideas[0].status).toBe('stale');
    const on = await j(await post(base, '/api/memory/upkeep', { on: true }));
    expect(on.upkeep.on).toBe(true);
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Vendor contract summariser', challenge: 'Contracts changed twice.', dedupe_key: 'a' }));
    const r = await untilDecided(base, (d) => d?.act === 'read');
    expect(r.job.lastDecision.why).toMatch(/^read 2026-001 after a save · 1 passage/);
    expect(r.summary.ideas[0].status).toBe('read');
  });

  it('a fresh workspace with the model here: an Import ends with the new ideas read, no click; the view says the model is here', async () => {
    const { base } = await boot();
    const res = await j(await importFixture(base));
    expect(res.created.length).toBeGreaterThan(0);
    const m = await untilDecided(base, (d) => d?.act === 'read' && d.why.includes('after Import'));
    expect(m.model.cached).toBe(true);
    expect(m.job.embedder).toBe('fake');
    expect(m.job.lastDecision.ideas).toEqual(res.created.map((c: { id: string }) => c.id));
    expect(m.summary).toMatchObject({ percent: 100, available: true });
    expect(m.summary.ideas.every((i: { status: string }) => i.status === 'read')).toBe(true);
  });

  it('start-up: a server that comes up with unread ideas reads just those in the background; a second start reads nothing', async () => {
    const root = await tmpWorkspace('2026-10-19');
    await fullIdea(root);
    const up = async () => {
      const server = createApp({ root, clock: fixedClock('2026-10-19'), upkeep: { quietMs: 60_000, maxMs: 60_000 } });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      close = () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const base = await up();
    const m = await untilDecided(base, (d) => d?.act === 'read');
    expect(m.job.lastDecision).toMatchObject({ act: 'read', ideas: ['CAFE-2026-001'], why: 'read 2026-001 at start-up · 17 passages' });
    expect(m.upkeep.startup).toMatchObject({ act: 'read', why: 'read 2026-001 at start-up · 17 passages' });
    expect(m.summary.percent).toBe(100);
    await close!(); close = undefined;
    const base2 = await up();
    let v = await get(base2, '/api/memory');
    for (let i = 0; i < 100 && !v.upkeep.startup; i++) { await new Promise((r) => setTimeout(r, 20)); v = await get(base2, '/api/memory'); }
    expect(v.upkeep.startup).toMatchObject({ act: 'skip', ideas: [], why: 'every idea is already read' });
    // The decision on disk is still the first start's: a start with nothing to do writes nothing.
    expect(v.job.lastDecision.why).toBe('read 2026-001 at start-up · 17 passages');
  });
});
