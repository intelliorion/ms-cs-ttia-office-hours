import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { fullIdea } from './memory-chunks.test';
import { agentTask, type AgentInput } from '../src/ai/tasks';
import { queryGuide, QUERY_GUIDE } from '../src/command/query';

const was = { embed: process.env.CAFE_EMBED_FAKE, ai: process.env.CAFE_AI_FAKE };
beforeAll(() => { process.env.CAFE_EMBED_FAKE = '1'; process.env.CAFE_AI_FAKE = '1'; });
afterAll(() => { process.env.CAFE_EMBED_FAKE = was.embed; process.env.CAFE_AI_FAKE = was.ai; });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
async function boot() {
  const s = await startServer('2026-10-19', { upkeep: { quietMs: 20, maxMs: 150 } });
  close = () => new Promise<void>((resolve) => { s.server.close(() => resolve()); s.server.closeAllConnections(); });
  return s;
}
const post = (base: string, url: string, body: unknown = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (base: string, url: string) => fetch(base + url).then(j);
async function untilIdle(base: string) {
  for (let i = 0; i < 200; i++) {
    const m = await get(base, '/api/memory');
    if (m.job.status !== 'running' && !m.upkeep.waiting) return m;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still running');
}

const input = (deepRead: AgentInput['deepRead']): AgentInput => ({ message: 'how many ideas?', stars: [], steps: [], stepsLeft: 6, deepRead });

describe('the assistant knows where Deep read stands', () => {
  it('the prompt carries the state and tells the agent when to search what people wrote, and when not to', () => {
    const on = agentTask.prompt(input({ on: true, percent: 94, staleIdeas: 1, lastRead: '2026-10-26T09:00:00.000Z' }));
    expect(on).toContain('Deep read is on: 94 % of what people wrote is read, 1 idea changed since it was read, last read 2026-10-26T09:00:00.000Z.');
    expect(on).toContain('Use search and similar only for questions about what people WROTE');
    expect(on).toContain('For stars, links, counts, people and stages use stars, follow, filter, role, rank and count_by');
    expect(on).toContain('- search: Deep read.');
    expect(on).toContain('"deepRead":{"on":true,"percent":94,"staleIdeas":1,"lastRead":"2026-10-26T09:00:00.000Z"}');
    const off = agentTask.prompt(input({ on: false, percent: 0, staleIdeas: 0 }));
    expect(off).toContain('Deep read has not run: the search and similar steps do not exist');
    expect(off).not.toContain('- search: Deep read.');
    expect(off).not.toContain('- similar: Deep read.');
    expect(off).not.toContain('what did teams say about data access');
    expect(off).toContain('"deepRead":{"on":false');
    // An older caller passing nothing still gets a sensible prompt.
    expect(agentTask.prompt(input(undefined))).toContain('Deep read has not run');
    expect(queryGuide(true)).toEqual(QUERY_GUIDE);
    expect(queryGuide(false).filter((l) => /Deep read|similar|"search"/.test(l))).toEqual([]);
  });

  it('a question about stars runs graph steps only, never a search; a stale idea is named in the trace, not re-read inline', async () => {
    const { base, root } = await boot();
    await fullIdea(root);
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking assistant', challenge: 'Desks are double booked every morning.', dedupe_key: 'b' }));
    await post(base, '/api/memory/run');
    await untilIdle(base);
    const stars = await j(await post(base, '/api/chat', { text: 'who leads the desk booking assistant?' }));
    expect(stars.kind).toBe('question');
    expect(stars.trace.flat().map((t: { text: string }) => t.text).join(' ')).not.toMatch(/Search what people wrote/);
    expect(stars.trace.flat().every((t: { text: string }) => !/changed since/.test(t.text))).toBe(true);
    // Upkeep off, the idea's text changed: it is stale, and a search that lands on it says so.
    await post(base, '/api/memory/upkeep', { on: false });
    const idea = await loadIdea(root, 'CAFE-2026-001');
    await saveIdea(root, { ...idea, challenge: `${idea.challenge} And now the notice dates slip.` });
    await untilIdle(base);
    const before = await get(base, '/api/memory');
    expect(before.summary.ideas[0].status).toBe('stale');
    expect(before.job.lastDecision).toMatchObject({ act: 'skip', why: 'automatic upkeep is off' });
    const e = await j(await post(base, '/api/chat', { text: 'what did teams say about data access?' }));
    expect(e.kind).toBe('question');
    expect(e.trace[0]).toEqual([
      { text: 'Search what people wrote for "what did teams say about data access"', size: 2 },
      { text: '2026-001 changed since it was read', size: 1 },
    ]);
    // Not re-read inline: still stale after the answer.
    expect((await get(base, '/api/memory')).summary.ideas[0].status).toBe('stale');
    expect(e.reply).toMatch(/^2 ideas mention that\./);
  });
});
