import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { startServer, FIXTURE } from './helpers';
import { saveIdea, listIdeas } from '../src/ideas/store';
import { normalizeIdea } from '../src/ideas/idea';
import { createConnector, type Connector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import type { Triage } from '../src/ai/tasks';

const FIX = (name: string) => fileURLToPath(new URL(`./fixtures/inbox/${name}`, import.meta.url));
const json = (r: Response) => r.json() as Promise<any>;
const exists = (p: string) => access(p).then(() => true, () => false);

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

async function server(connector?: Connector) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-20', { connector: connector ?? createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = async (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const drop = async (name: string, bytes: Uint8Array | Buffer) => json(await fetch(`${s.base}/api/inbox/drop`, { method: 'POST', headers: { 'x-filename': name, 'content-type': 'application/octet-stream' }, body: bytes }));
  const inbox = async () => json(await fetch(`${s.base}/api/inbox`));
  return { ...s, post, drop, inbox };
}

function triageConnector(reply: Triage | (() => never)) {
  const provider: Provider = {
    id: 'claude', label: 'Test AI', available: async () => true,
    complete: async () => (typeof reply === 'function' ? reply() : JSON.stringify(reply)),
  };
  return createConnector({ providers: [provider], settings: DEFAULT_SETTINGS });
}

const ideaFolders = async (root: string) => (await readdir(path.join(root, 'ideas'))).sort();

describe('/api/inbox: exports', () => {
  it('dropping the sample export imports 3 ideas as Safe; Undo removes exactly those (Review Focus 5)', async () => {
    const s = await server();
    const { item } = await s.drop('export.csv', await readFile(FIXTURE));
    expect(item.type).toBe('export');
    const [r] = item.actions;
    expect(r).toMatchObject({ kind: 'safe', status: 'applied', action: { t: 'import_export' }, inverse: { t: 'remove-ideas' } });
    expect(r.inverse.ids).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(item.status).toBe('applied');
    expect((await ideaFolders(s.root))).toHaveLength(3);

    // Another idea created another way in between.
    await saveIdea(s.root, normalizeIdea({ id: 'CAFE-2026-004', slug: 'by-hand', title: 'By hand', round: 'ROUND-2026-Q4', dedupe_key: 'x' }));
    const undone = await json(await s.post(`/api/inbox/${item.id}/undo`, { recordId: r.id }));
    expect(undone.item.actions[0].status).toBe('undone');
    expect(await ideaFolders(s.root)).toEqual(['CAFE-2026-004-by-hand']);
    expect(await exists(path.join(s.root, ...item.file.split('/')))).toBe(true);
  });

  it('Review Focus 3: the same drop twice is a duplicate and applies nothing', async () => {
    const s = await server();
    const first = await s.drop('export.csv', await readFile(FIXTURE));
    const lines = await readFile(path.join(s.root, 'inbox', 'undo.jsonl'), 'utf8');
    const again = await s.drop('export-again.csv', await readFile(FIXTURE));
    expect(again.duplicate).toBe(true);
    expect(again.item.id).toBe(first.item.id);
    expect((await listIdeas(s.root)).ideas).toHaveLength(3);
    expect(await readFile(path.join(s.root, 'inbox', 'undo.jsonl'), 'utf8')).toBe(lines);
    expect((await s.inbox()).items).toHaveLength(1);
  });

  it('an .xlsx list of people is held, not imported', async () => {
    const s = await server();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Name', 'Employee ID', 'Phone']);
    for (let i = 21; i < 25; i++) ws.addRow([`Person ${i}`, `AB1236${i}`, `+44 20 7946 00${i}`]);
    const { item } = await s.drop('list.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(item.status).toBe('held');
    expect(item.hold.reasons.join(' ')).toMatch(/people/i);
    expect(item.file).toMatch(/^inbox\/held\//);
    expect((await listIdeas(s.root)).ideas).toHaveLength(0);
  });
});

describe('/api/inbox: emails and notes', () => {
  it('a reply with the fake AI: Safe applied, counts, apply and undo of the new-star links via /api/graph', async () => {
    const s = await server();
    await s.drop('export.csv', await readFile(FIXTURE));
    const { item } = await s.drop('reply.eml', await readFile(FIX('reply.eml')));
    expect(item.triage.ideaId).toBe('CAFE-2026-001');
    const by = (t: string) => item.actions.find((r: any) => r.action.t === t);
    expect(by('file_email')).toMatchObject({ kind: 'safe', status: 'applied' });
    expect(by('reply_received')).toMatchObject({ kind: 'safe', status: 'applied' });
    expect(by('record_answers')).toMatchObject({ kind: 'safe', status: 'applied' });
    const g = by('graph_links');
    expect(g).toMatchObject({ kind: 'ok', status: 'pending' });

    const list = await s.inbox();
    expect(list.items[0].id).toBe(item.id);
    expect(list.counts).toEqual({ new: 0, ok: 1, held: 0, applied: 1 });

    const applied = await json(await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [g.id] }));
    expect(applied.item.status).toBe('applied');
    let graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.find((e: any) => e.id === 'idea:CAFE-2026-001|REPLACES|painpoint:manual-request-triage')).toMatchObject({ confirmed: false });
    await s.post(`/api/inbox/${item.id}/undo`, { recordId: g.id });
    graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.some((e: any) => e.id === 'idea:CAFE-2026-001|REPLACES|painpoint:manual-request-triage')).toBe(false);
  });

  it('a link at 0.7 or above between known stars is Safe, shows in /api/graph, and Undo removes it', async () => {
    const s = await server(triageConnector({
      summary: 'Invoices need design guidance.', kind: 'update', ideaId: 'CAFE-2026-003', matchConfidence: 0.9,
      facts: { graph: { nodes: [{ type: 'Capability', label: 'Agent Design Guidance' }], links: [{ from: 'idea', to: 'Agent Design Guidance', rel: 'NEEDS', description: 'Asked for guidance', confidence: 0.8 }] } },
    }));
    await s.drop('export.csv', await readFile(FIXTURE));
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Update on CAFE-2026-003: they want agent design guidance.', name: 'update' }));
    const g = item.actions.find((r: any) => r.action.t === 'graph_links');
    expect(g).toMatchObject({ kind: 'safe', status: 'applied' });
    const id = 'idea:CAFE-2026-003|NEEDS|capability:agent-design-guidance';
    let graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.find((e: any) => e.id === id)).toMatchObject({ confirmed: true });
    await s.post(`/api/inbox/${item.id}/undo`, { recordId: g.id });
    graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.some((e: any) => e.id === id)).toBe(false);
  });

  it('"Which idea?": choose re-triages with how: chosen and then acts on that idea', async () => {
    const s = await server();
    await s.drop('export.csv', await readFile(FIXTURE));
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Some thoughts on requests and invoices.' }));
    expect(item.triage.ask).toBe(true);
    expect(item.actions.map((r: any) => r.action.t)).toEqual(['ask_idea']);
    const bad = await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [item.actions[0].id] });
    expect(bad.status).toBe(400);
    const chosen = await json(await s.post(`/api/inbox/${item.id}/choose`, { ideaId: 'CAFE-2026-002' }));
    expect(chosen.item.triage).toMatchObject({ ideaId: 'CAFE-2026-002', ask: false, match: { how: 'chosen' } });
    expect(chosen.item.actions.find((r: any) => r.action.t === 'file_email')).toMatchObject({ status: 'applied', action: { ideaId: 'CAFE-2026-002' } });
    expect(chosen.item.actions.find((r: any) => r.action.t === 'ask_idea')).toBeUndefined();
  });

  it('when the AI fails, the drop still answers 200 with the item needing a hand and nothing applied', async () => {
    const s = await server(triageConnector(() => { throw new Error('timed out after 90 s'); }));
    await s.drop('export.csv', await readFile(FIXTURE));
    const r = await fetch(`${s.base}/api/inbox/drop`, { method: 'POST', headers: { 'x-filename': 'reply.eml' }, body: await readFile(FIX('reply.eml')) });
    expect(r.status).toBe(200);
    const { item } = await json(r);
    expect(item.triage.needsHand).toBe(true);
    expect(item.actions.every((a: any) => a.status === 'pending')).toBe(true);
    expect((await listIdeas(s.root)).ideas.find((i) => i.id === 'CAFE-2026-001')!.checklist.s2d).toBeUndefined();
  });

  it('dismiss sets it aside', async () => {
    const s = await server();
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Nothing much.' }));
    const d = await json(await s.post(`/api/inbox/${item.id}/dismiss`));
    expect(d.item.status).toBe('dismissed');
  });
});

describe('/api/inbox: held items', () => {
  it('held tracker: draft-held-reply drafts a round-level PD; delete removes the file; nothing else can be done', async () => {
    const s = await server();
    const { item } = await s.drop('held-tracker.csv', await readFile(FIX('held-tracker.csv')));
    expect(item.status).toBe('held');
    expect(item.actions ?? []).toEqual([]);
    expect((await s.inbox()).counts.held).toBe(1);
    expect((await s.post(`/api/inbox/${item.id}/apply`, { actionIds: ['a1'] })).status).toBe(400);

    const drafted = await json(await s.post(`/api/inbox/${item.id}/draft-held-reply`));
    expect(drafted.email).toMatchObject({ template: 'PD', status: 'draft', key: 'rounds/ROUND-2026-Q4/emails/001-PD.md' });
    expect(drafted.email.body).toMatch(/held-tracker\.csv/);
    const state = await json(await fetch(`${s.base}/api/state`));
    expect(state.outbox.some((m: any) => m.key === drafted.email.key)).toBe(true);

    const del = await s.post(`/api/inbox/${item.id}/delete`);
    expect(del.status).toBe(200);
    expect(await exists(path.join(s.root, ...item.file.split('/')))).toBe(false);
    expect((await s.inbox()).items).toHaveLength(0);
  });

  it('a held item naming an idea drafts the PD for that idea', async () => {
    const s = await server();
    await s.drop('export.csv', await readFile(FIXTURE));
    const text = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'].join('\n');
    const { item } = await json(await s.post('/api/inbox/drop', { text, name: 'CAFE-2026-001 contacts' }));
    expect(item.status).toBe('held');
    const drafted = await json(await s.post(`/api/inbox/${item.id}/draft-held-reply`));
    expect(drafted.email).toMatchObject({ template: 'PD', idea: 'CAFE-2026-001' });
    expect(drafted.email.key).toMatch(/^ideas\/CAFE-2026-001-[^/]+\/emails\/\d{3}-PD\.md$/);
  });

  it('delete is for held items only', async () => {
    const s = await server();
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Nothing much.' }));
    const r = await s.post(`/api/inbox/${item.id}/delete`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/Only held items/);
  });
});
