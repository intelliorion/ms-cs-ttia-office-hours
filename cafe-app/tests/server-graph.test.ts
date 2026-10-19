import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { startServer, FIXTURE } from './helpers';

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
});
