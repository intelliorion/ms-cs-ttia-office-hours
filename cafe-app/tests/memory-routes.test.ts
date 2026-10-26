import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { startServer, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { fullIdea } from './memory-chunks.test';

// Deep read's fake embedder and the fake AI: nothing is downloaded and nothing leaves the machine.
const was = { embed: process.env.CAFE_EMBED_FAKE, ai: process.env.CAFE_AI_FAKE };
beforeAll(() => { process.env.CAFE_EMBED_FAKE = '1'; process.env.CAFE_AI_FAKE = '1'; });
afterAll(() => { process.env.CAFE_EMBED_FAKE = was.embed; process.env.CAFE_AI_FAKE = was.ai; });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function boot() {
  const s = await startServer();
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

describe('Deep read routes', () => {
  it('with no index: 0 %, idle, the model named with its folder, and the ideas route says null', async () => {
    const { base, root } = await boot();
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
    const { base, root } = await boot();
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
    const { base, root } = await boot();
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
