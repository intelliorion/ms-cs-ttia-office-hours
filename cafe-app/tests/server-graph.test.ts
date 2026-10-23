import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, FIXTURE } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { appendAiLink, readAiLinks } from '../src/graph/store';

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
    await mkdir(path.join(s.root, 'data', 'graph'), { recursive: true });
    await writeFile(path.join(s.root, 'data', 'graph', 'layout.json'), 'not json', 'utf8');
    await writeFile(path.join(s.root, 'data', 'graph', 'ai-links.jsonl'), 'garbage\n', 'utf8');
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

  it('extract holds a link whose new star near-duplicates an existing one: pending, counted apart, not duplicated by a second run', async () => {
    process.env.CAFE_AI_FAKE = '1';
    const s = await startServer('2026-10-21');
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); delete process.env.CAFE_AI_FAKE; };
    await saveIdea(s.root, sampleIdea({ challenge: 'Too many emails' }));
    await appendAiLink(s.root, {
      from: 'idea:CAFE-2026-001', to: 'capability:workflow-routings', rel: 'NEEDS', description: 'seed', source: 'operator', confidence: 0.9, status: 'confirmed',
      newNodes: [{ id: 'capability:workflow-routings', type: 'Capability', label: 'Workflow routings' }],
    });
    const post = async () => json(await fetch(`${s.base}/api/ai/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'CAFE-2026-001' }) }));
    const r = await post();
    expect(r.held.length).toBeGreaterThan(0);
    expect(r.held.every((h: any) => h.rule === 'near-duplicate-star')).toBe(true);
    expect(r.held[0].why).toMatch(/Looks like Workflow routings/);
    expect(r.held[0].existing).toBe('capability:workflow-routings');
    expect(r.added).toBe(r.links.filter((e: any) => e.confirmed).length);
    expect(r.links.some((e: any) => !e.confirmed)).toBe(true);
    const g1 = await json(await fetch(`${s.base}/api/graph`));
    const held = g1.edges.find((e: any) => e.id === 'idea:CAFE-2026-001|NEEDS|capability:workflow-routing');
    expect(held).toMatchObject({ confirmed: false });
    await post();
    const g2 = await json(await fetch(`${s.base}/api/graph`));
    expect(g2.edges.length).toBe(g1.edges.length);
  });
  it('extract keeps a person-star hold in the answer only: nothing about it is written to the graph store', async () => {
    process.env.CAFE_AI_FAKE = '1';
    const s = await startServer('2026-10-21');
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); delete process.env.CAFE_AI_FAKE; };
    // A team member whose name is the label the fake proposes for a System.
    await saveIdea(s.root, sampleIdea({ challenge: 'Too many emails', people: { submitter: 'Person 1', team: [{ name: 'Shared mailbox', roles: ['builder'] } as any] } }));
    const r = await json(await fetch(`${s.base}/api/ai/extract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'CAFE-2026-001' }) }));
    expect(r.held.some((h: any) => h.rule === 'person-star')).toBe(true);
    const { links } = await readAiLinks(s.root);
    expect(links.some((l) => l.from === 'system:shared-mailbox' || l.to === 'system:shared-mailbox')).toBe(false);
    const g = await json(await fetch(`${s.base}/api/graph`));
    expect(g.nodes.some((n: any) => n.id === 'system:shared-mailbox')).toBe(false);
  });
});
