import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { startServer, FIXTURE } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();
let close: (() => void) | undefined;
afterEach(() => close?.());

async function boot() {
  const s = await startServer();
  close = () => s.server.close();
  return s;
}

const post = (base: string, url: string, body: unknown) =>
  fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function rawStatus(base: string, pathName: string, host: string): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: pathName, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('api', () => {
  it('reports an empty round', async () => {
    const { base } = await boot();
    const state = await (await fetch(`${base}/api/state`)).json();
    expect(state.round.id).toBe('ROUND-2026-Q4');
    expect(state.ideas).toEqual([]);
    expect(state.steps).toHaveLength(25);
    expect(state.today).toBe('2026-10-19');
  });

  it('imports a dropped export and shows each idea with its progress', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/import`, {
      method: 'POST', headers: { 'x-filename': 'export.csv', 'content-type': 'application/octet-stream' }, body: await readFile(FIXTURE),
    });
    expect(((await j(res))()).created).toHaveLength(3);
    const state = await (await fetch(`${base}/api/state`)).json();
    expect(state.ideas[0].progress.label).toBe('Submit Idea · 1 of 25');
    expect(state.ideas[0].status.s1d).toBe('done');
  });

  it('turns a missing setting into a 400 that names it', async () => {
    const { base } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const draft = await (await post(base, '/api/ideas/CAFE-2026-001/draft', { template: 'E1' })).json();
    const res = await post(base, '/api/outbox/approve', { key: draft.key });
    expect(res.status).toBe(400);
    expect(((await j(res))()).missing).toEqual(['Decisions by', 'Your name (email signature)']);
  });

  it('refuses paths and IDs outside the workspace', async () => {
    const { base } = await boot();
    const res = await post(base, '/api/ideas/..%2F..%2Fetc/tick', { step: 's1a', done: true });
    expect(res.status).toBe(400);
    expect(((await j(res))()).error).toContain('Not a Café ID');
    expect((await fetch(`${base}/../package.json`)).status).toBe(404);
    expect((await post(base, '/api/outbox/approve', { key: '../../x.md' })).status).toBe(400);
  });

  it('only accepts JSON posts or a named file upload', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/round`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('refuses requests for another host name', async () => {
    const { base } = await boot();
    expect(await rawStatus(base, '/api/state', 'evil.example')).toBe(403);
    expect(await rawStatus(base, '/api/state', 'localhost:4100')).toBe(200);
  });

  it('refuses a file type it cannot import', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'notes.exe' }, body: 'x' });
    expect(res.status).toBe(400);
    expect(((await j(res))()).error).toBe('Drop a .csv or .xlsx export');
  });
});
