import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, FIXTURE } from './helpers';
import { saveIdea } from '../src/ideas/store';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });
const json = (r: Response) => r.json() as Promise<any>;

describe('/api/graph', () => {
  it('returns nodes, edges, layout and the unconfirmed count', async () => {
    const s = await startServer();
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    await fetch(`${s.base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const g = await json(await fetch(`${s.base}/api/graph`));
    expect(g.nodes.some((n: any) => n.type === 'Idea')).toBe(true);
    expect(Object.keys(g.layout)).toHaveLength(g.nodes.length);
    expect(g.unconfirmed).toBe(0);
    const bad = await fetch(`${s.base}/api/graph/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ edgeId: 'nope' }) });
    expect(bad.status).toBe(400);
  });

  it('still serves the graph with a corrupt layout cache and a torn AI-links line, and lists the problem', async () => {
    const s = await startServer();
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    await fetch(`${s.base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    await mkdir(path.join(s.root, 'graph'), { recursive: true });
    await writeFile(path.join(s.root, 'graph', 'layout.json'), 'not json', 'utf8');
    await writeFile(path.join(s.root, 'graph', 'ai-links.jsonl'), 'garbage\n', 'utf8');
    const r = await fetch(`${s.base}/api/graph`);
    expect(r.status).toBe(200);
    const g = await json(r);
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(Object.keys(g.layout)).toHaveLength(g.nodes.length);
    expect(g.problems).toEqual([{ line: 1, message: expect.any(String) }]);
  });

  it('extract applies links confirmed on arrival and returns what the conflict rules held', async () => {
    process.env.CAFE_AI_FAKE = '1';
    const s = await startServer('2026-10-21');
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); delete process.env.CAFE_AI_FAKE; };
    await saveIdea(s.root, sampleIdea({ challenge: 'Too many emails' }));
    const r = await json(await fetch(`${s.base}/api/ai/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'CAFE-2026-001' }) }));
    expect(r.added).toBeGreaterThan(0);
    expect(Array.isArray(r.held)).toBe(true);
    const g = await json(await fetch(`${s.base}/api/graph`));
    const ai = g.edges.filter((e: any) => String(e.source).startsWith('ai:'));
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((e: any) => e.confirmed)).toBe(true);
  });
});
