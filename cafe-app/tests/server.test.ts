import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer, FIXTURE } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (r: Response): Promise<any> => r.json();
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function boot() {
  const s = await startServer();
  close = () => new Promise<void>((resolve) => {
    s.server.close(() => resolve());
    s.server.closeAllConnections();
  });
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
  it('starts with no rounds', async () => {
    const { base } = await boot();
    const state = await j(await fetch(`${base}/api/state`));
    expect(state.rounds).toEqual([]);
    expect(state).not.toHaveProperty('round');
    expect(state.ideas).toEqual([]);
    expect(state.steps).toHaveLength(25);
    expect(state.today).toBe('2026-10-19');
  });

  it('imports a dropped export and shows each idea with its stage, no step counts', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/import`, {
      method: 'POST', headers: { 'x-filename': 'export.csv', 'content-type': 'application/octet-stream' }, body: await readFile(FIXTURE),
    });
    expect((await j(res)).created).toHaveLength(3);
    const state = await j(await fetch(`${base}/api/state`));
    expect(state.ideas[0]).toMatchObject({ stage: 2, overdue: [], offerE2R: false, sent: {}, due: {} });
    expect(state.ideas[0]).not.toHaveProperty('progress');
    expect(state.ideas[0]).not.toHaveProperty('status');
    expect(state.ideas[0]).not.toHaveProperty('missingToAdvance');
    expect(state.stageNames['3']).toBe('Design series');
    expect(state.closures.csic).toBe('Routed to CSIC');
  });

  it('imports an export whose name has non-Latin-1 characters, sent encoded, and keeps the name', async () => {
    const { base, root } = await boot();
    const name = 'Café – export.csv';
    const res = await fetch(`${base}/api/import`, {
      method: 'POST', headers: { 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' }, body: await readFile(FIXTURE),
    });
    expect(res.status).toBe(200);
    expect((await j(res)).created).toHaveLength(3);
    expect((await readdir(path.join(root, 'inbox'))).filter((n) => n.endsWith('.csv'))).toEqual(['2026-10-19-Café – export.csv']);
  });

  it('sets a stage freely, logs it, and shows the history', async () => {
    const { base } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const moved = await post(base, '/api/ideas/CAFE-2026-001/stage', { stage: 4 });
    expect(moved.status).toBe(200);
    expect((await j(moved)).stage).toBe(4);
    const closed = await j(await post(base, '/api/ideas/CAFE-2026-001/stage', { closeAs: 'csic' }));
    expect(closed.closed).toEqual({ as: 'csic', at: '2026-10-19', followUp: '2026-11-16' });
    const bad = await post(base, '/api/ideas/CAFE-2026-001/stage', { stage: 9 });
    expect(bad.status).toBe(400);
    expect((await j(bad)).error).toContain('Pick Review and Select');
    const history = await j(await fetch(`${base}/api/ideas/CAFE-2026-001/history`));
    expect(history.filter((h: { action: string }) => h.action === 'stage').map((h: { detail: string }) => h.detail))
      .toEqual(['Review and Select → Launch and Learn', 'Launch and Learn → Closed · Routed to CSIC']);
    expect(history[0].action).toBe('created');
    expect((await fetch(`${base}/api/ideas/..%2Fx/history`)).status).toBe(400);
  });

  it('has no advance route any more', async () => {
    const { base } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    expect((await post(base, '/api/ideas/CAFE-2026-001/advance', {})).status).toBe(404);
  });

  it('records a reply received, which clears the late reply', async () => {
    const { base, root } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const ideaFile = path.join(root, 'ideas', 'CAFE-2026-001-email-scheduler', 'idea.yaml');
    const yaml = await readFile(ideaFile, 'utf8');
    await writeFile(ideaFile, yaml.replace(/^due: \{\}$/m, 'due:\n  s2d: 2026-10-10'));
    expect((await j(await fetch(`${base}/api/state`))).ideas[0].overdue).toHaveLength(1);
    const r = await j(await post(base, '/api/ideas/CAFE-2026-001/reply', {}));
    expect(r.checklist.s2d).toMatchObject({ done: true, by: 'operator', source: 'reply received' });
    expect((await j(await fetch(`${base}/api/state`))).ideas[0].overdue).toEqual([]);
  });

  it('turns a missing setting into a 400 that names it', async () => {
    const { base } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const draft = await j(await post(base, '/api/ideas/CAFE-2026-001/draft', { template: 'E1' }));
    const res = await post(base, '/api/outbox/approve', { key: draft.key });
    expect(res.status).toBe(400);
    // The idea is in no round yet, so the round's dates are one note.
    expect((await j(res)).missing).toEqual(['Put this idea in a round to fill the dates', 'Your name (email signature)']);
  });

  it('refuses paths and IDs outside the workspace', async () => {
    const { base } = await boot();
    const res = await post(base, '/api/ideas/..%2F..%2Fetc/tick', { step: 's1a', done: true });
    expect(res.status).toBe(400);
    expect((await j(res)).error).toContain('Not a Café ID');
    for (const p of ['/../package.json', '/%2e%2e/package.json']) {
      expect(await rawStatus(base, p, 'localhost')).not.toBe(200);
    }
    expect((await post(base, '/api/outbox/approve', { key: '../../x.md' })).status).toBe(400);
  });

  it('only accepts JSON posts or a named file upload', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/rounds`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
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
    expect((await j(res)).error).toBe('Drop a .csv or .xlsx export');
  });

  it('does not trust a content type that only mentions JSON', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/rounds`, { method: 'POST', headers: { 'content-type': 'text/plain; x=application/json' }, body: '{}' });
    expect(res.status).toBe(415);
  });

  it('refuses cross-site origins and accepts local ones', async () => {
    const { base } = await boot();
    const send = (origin: string) => fetch(`${base}/api/rounds`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin }, body: '{}',
    });
    expect((await send('http://evil.example')).status).toBe(403);
    expect((await send('http://localhost:4100')).status).toBe(200);
  });
  it('runs posts one at a time, so a double click ticks once and imports never reuse an ID', async () => {
    const { base, root } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    await post(base, '/api/rounds', { name: 'Autumn' });
    await post(base, '/api/rounds/ROUND-001/ideas', { ideaIds: ['CAFE-2026-001'] });
    await post(base, '/api/rounds/ROUND-001', { reviewBy: '2026-11-02' });
    await post(base, '/api/settings', { operatorName: 'Café operator' });
    const draft = await j(await post(base, '/api/ideas/CAFE-2026-001/draft', { template: 'E1' }));
    expect((await post(base, '/api/outbox/approve', { key: draft.key })).status).toBe(200);
    await Promise.all([post(base, '/api/outbox/sent', { key: draft.key }), post(base, '/api/outbox/sent', { key: draft.key })]);
    const lines = (await readFile(path.join(root, 'ideas', 'CAFE-2026-001-email-scheduler', 'history.log'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.action === 'tick' && l.source === draft.key)).toHaveLength(1);
    expect(lines.filter((l) => l.action === 'sent')).toHaveLength(1);

    const csv = (title: string) => `Title,Submitter Name\n${title},Person 1 (CS)\n`;
    const imp = (name: string, title: string) => fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': name }, body: csv(title) });
    await Promise.all([imp('a.csv', 'Alpha idea'), imp('b.csv', 'Beta idea')]);
    const state = await j(await fetch(`${base}/api/state`));
    const ids = state.ideas.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.ideas.map((i: { title: string }) => i.title)).toEqual(expect.arrayContaining(['Alpha idea', 'Beta idea']));
    expect(ids).toHaveLength(5);
  });

  it('makes rounds, fills them with ideas and takes one out', async () => {
    const { base } = await boot();
    await fetch(`${base}/api/import`, { method: 'POST', headers: { 'x-filename': 'export.csv' }, body: await readFile(FIXTURE) });
    const made = await j(await post(base, '/api/rounds', { name: '' }));
    expect(made).toEqual({ id: 'ROUND-001', name: '2026 Q4', created: '2026-10-19' });
    expect(await j(await post(base, '/api/rounds/ROUND-001/ideas', { ideaIds: ['CAFE-2026-001', 'CAFE-2026-002'] }))).toEqual({ updated: 2 });
    expect((await j(await fetch(`${base}/api/rounds`))).rounds).toEqual([{ ...made, ideas: 2 }]);
    expect((await j(await post(base, '/api/rounds/ROUND-001', { deadline: '2026-11-01' }))).deadline).toBe('2026-11-01');
    const out = await j(await post(base, '/api/ideas/CAFE-2026-002/round', { round: '' }));
    expect(out.round).toBe('');
    const state = await j(await fetch(`${base}/api/state`));
    expect(state.rounds.map((r: { id: string }) => r.id)).toEqual(['ROUND-001']);
    expect((await j(await fetch(`${base}/api/rounds`))).rounds[0].ideas).toBe(1);
    const partial = await post(base, '/api/rounds/ROUND-001/ideas', { ideaIds: ['CAFE-2026-002', 'CAFE-2026-999'] });
    expect(partial.status).toBe(400);
    expect((await j(await fetch(`${base}/api/rounds`))).rounds[0].ideas).toBe(1);
    expect(await j(await post(base, '/api/rounds/ROUND-001/ideas', { ideaIds: ['CAFE-2026-001', 'CAFE-2026-002'] }))).toEqual({ updated: 1 });
    const bad = await post(base, '/api/ideas/CAFE-2026-001/round', { round: 'ROUND-404' });
    expect(bad.status).toBe(400);
    expect((await j(bad)).error).toContain('Unknown round');
  });

  it('a round.yaml that cannot be read is named in the state, and the other rounds still load', async () => {
    const { base, root } = await boot();
    await post(base, '/api/rounds', { name: 'Good' });
    await mkdir(path.join(root, 'rounds', 'ROUND-002'), { recursive: true });
    await writeFile(path.join(root, 'rounds', 'ROUND-002', 'round.yaml'), 'id: [unclosed\n');
    const state = await j(await fetch(`${base}/api/state`));
    expect(state.rounds.map((r: { id: string }) => r.id)).toEqual(['ROUND-001']);
    expect(state.roundProblems.map((p: { folder: string }) => p.folder)).toEqual(['ROUND-002']);
  });
});
