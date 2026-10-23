import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, readdir, access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { startServer, FIXTURE } from './helpers';
import { saveIdea, listIdeas } from '../src/ideas/store';
import { normalizeIdea } from '../src/ideas/idea';
import { createConnector, type Connector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { ideaReads } from '../src/inbox/flow';
import { DEFAULT_SETTINGS } from '../src/round/round';
import type { Understanding } from '../src/ai/tasks';

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
  // A form export goes on reading its new ideas in the background; the tests wait for that unless they say not to.
  const drop = async (name: string, bytes: Uint8Array | Buffer, opts: { wait?: boolean } = {}) => {
    const r = await json(await fetch(`${s.base}/api/inbox/drop`, { method: 'POST', headers: { 'x-filename': name, 'content-type': 'application/octet-stream' }, body: bytes }));
    if (opts.wait !== false && r.item?.id) await ideaReads.get(r.item.id);
    return r;
  };
  const inbox = async () => json(await fetch(`${s.base}/api/inbox`));
  return { ...s, post, drop, inbox };
}

function triageConnector(reply: Understanding | (() => never)) {
  const provider: Provider = {
    id: 'claude', label: 'Test AI', available: async () => true,
    complete: async () => (typeof reply === 'function' ? reply() : JSON.stringify(reply)),
  };
  return createConnector({ providers: [provider], settings: DEFAULT_SETTINGS });
}

/** Marks the E2 for an idea as sent with these questions: answers to them may be saved without a Yes. */
async function sentE2(root: string, id: string, questions: string[]) {
  const idea = (await listIdeas(root)).ideas.find((i) => i.id === id)!;
  await saveIdea(root, { ...idea, sent: { ...idea.sent, E2: '2026-10-20' } });
  const dir = path.join(root, 'data', 'ideas', (await ideaFolders(root)).find((f) => f.startsWith(id))!, 'emails');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '001-E2.md'), `---\ntemplate: E2\nidea: ${id}\nstatus: sent\nsentAt: 2026-10-20\n---\nHi,\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n`);
}

/** A capability the operator stands behind: one they picked a tool for. */
async function pickTool(root: string, id: string, feature: string) {
  const idea = (await listIdeas(root)).ideas.find((i) => i.id === id)!;
  await saveIdea(root, { ...idea, tools: { [feature]: 'Copilot Studio' } });
}
const ideaFolders = async (root: string) => (await readdir(path.join(root, 'data', 'ideas'))).sort();

describe('/api/inbox: exports', () => {
  it('a form export: the graph step counts what the form drew, then the AI reads every new idea into the universe', async () => {
    const s = await server();
    const { item } = await s.drop('export.csv', await readFile(FIXTURE), { wait: false });
    const step = (it: any, k: string) => it.steps.find((x: any) => x.id === k);
    // The import itself drew stars from the form's columns: never "No graph facts".
    expect(step(item, 'graph').detail).toMatch(/\d+ stars? and \d+ links? from the form/);
    expect(step(item, 'understand').status).toBe('running');
    await ideaReads.get(item.id);
    const after = (await s.inbox()).items.find((i: any) => i.id === item.id);
    expect(step(after, 'understand')).toMatchObject({ status: 'done', detail: 'Read all 3 new ideas', of: [3, 3] });
    // The trail says, idea by idea, what the AI found (new stars by kind), so the card can show it as it lands.
    const trail = step(after, 'understand').trail;
    expect(trail.map((e: any) => e.title)).toHaveLength(3);
    expect(trail[0].found.some((w: string) => /capabilit|pain point|system|link/.test(w))).toBe(true);
    expect(trail.every((e: any) => !e.failed)).toBe(true);
    const links = after.actions.filter((r: any) => r.action.t === 'graph_links');
    expect(links.map((r: any) => r.action.ideaId).sort()).toEqual(['CAFE-2026-001', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(links.every((r: any) => r.status === 'applied')).toBe(true);
    expect(step(after, 'graph').detail).toMatch(/from the form; \d+ links? added/);
    expect(step(after, 'check').status).toBe('done');
    const graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.some((e: any) => e.from === 'idea:CAFE-2026-001' && e.source.startsWith('ai:'))).toBe(true);

    // Undo of the import still removes all three ideas, and takes the AI's links on them back too.
    const imp = after.actions.find((r: any) => r.action.t === 'import_export');
    const undone = await json(await s.post(`/api/inbox/${item.id}/undo`, { recordId: imp.id }));
    expect(undone.item.actions.find((r: any) => r.id === imp.id).status).toBe('undone');
    expect(await ideaFolders(s.root)).toEqual([]);
    expect(undone.item.actions.filter((r: any) => r.action.t === 'graph_links').every((r: any) => r.status === 'undone')).toBe(true);
    const empty = await json(await fetch(`${s.base}/api/graph`));
    expect(empty.edges.filter((e: any) => e.source.startsWith('ai:'))).toEqual([]);
  });

  it('applying the one held item turns "Anything for you" to Done, so the badge stops counting it', async () => {
    const s = await server(triageConnector({
      what: 'Invoices need reading.', understood: ['Invoices need reading.'], uncertain: [], kind: 'update', ideaId: 'CAFE-2026-003', matchConfidence: 0.9,
      facts: { graph: { nodes: [{ type: 'Capability', label: 'Invoice reading' }], links: [{ from: 'idea', to: 'Invoice reading', rel: 'NEEDS', description: 'Reads invoices', confidence: 0.4 }] } },
    }));
    await s.drop('export.csv', await readFile(FIXTURE));
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Update on CAFE-2026-003: they need to read invoices.', name: 'update' }));
    const check = (it: any) => it.steps.find((x: any) => x.id === 'check');
    expect(check(item).status).toBe('needs-you');
    const held = item.actions.find((r: any) => r.held);
    const after = await json(await s.post(`/api/inbox/${item.id}/apply`, { actionIds: [held.id] }));
    expect(check(after.item ?? after)).toMatchObject({ status: 'done', detail: 'Done' });
  });

  it('a form export with no AI: ideas imported, understand says how to read them by hand, nothing left running', async () => {
    const s = await server(createConnector({ providers: [], settings: DEFAULT_SETTINGS }));
    const { item } = await s.drop('export.csv', await readFile(FIXTURE));
    expect(ideaReads.has(item.id)).toBe(false);
    const u = item.steps.find((x: any) => x.id === 'understand');
    expect(u.status).toBe('skipped');
    expect(u.detail).toMatch(/AI suggest links/);
    expect(item.steps.some((x: any) => x.status === 'running')).toBe(false);
  });

  it('a form export: an idea the AI cannot read is counted, the others still land', async () => {
    let calls = 0;
    const flaky: Provider = { ...fakeProvider(), complete: async (prompt, o) => (prompt.startsWith('TASK: extract') && ++calls === 2 ? 'not json' : fakeProvider().complete(prompt, o)) };
    const s = await server(createConnector({ providers: [flaky], settings: DEFAULT_SETTINGS }));
    const { item } = await s.drop('export.csv', await readFile(FIXTURE));
    await ideaReads.get(item.id);
    const after = (await s.inbox()).items.find((i: any) => i.id === item.id);
    const u = after.steps.find((x: any) => x.id === 'understand');
    expect(u.status).toBe('done');
    expect(u.detail).toBe("Read 2 of 3 new ideas; the AI couldn't read CAFE-2026-002 (use AI suggest links on it)");
    expect(u.trail.map((e: any) => !!e.failed)).toEqual([false, true, false]);
    expect(after.actions.filter((r: any) => r.action.t === 'graph_links' && r.status === 'applied')).toHaveLength(2);
  });

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
    expect(await exists(path.join(s.root, 'data', ...item.file.split('/')))).toBe(true);
  });

  it('Undo of an import keeps an idea the operator has worked in since, and says so (Review Focus 5)', async () => {
    const s = await server();
    const { item } = await s.drop('export.csv', await readFile(FIXTURE));
    await s.post('/api/ideas/CAFE-2026-002/tick', { step: 's2a', done: true });
    const r = await json(await s.post(`/api/inbox/${item.id}/undo`, { recordId: item.actions[0].id }));
    expect(r.note).toMatch(/CAFE-2026-002 has changed since the import; close it instead/);
    expect(r.item.actions[0]).toMatchObject({ status: 'undone', note: r.note });
    expect((await ideaFolders(s.root)).map((f) => f.slice(0, 13))).toEqual(['CAFE-2026-002']);
  });

  it('Review Focus 3: the same drop twice is a duplicate and applies nothing', async () => {
    const s = await server();
    const first = await s.drop('export.csv', await readFile(FIXTURE));
    const lines = await readFile(path.join(s.root, 'data', 'inbox', 'undo.jsonl'), 'utf8');
    const again = await s.drop('export-again.csv', await readFile(FIXTURE));
    expect(again.duplicate).toBe(true);
    expect(again.item.id).toBe(first.item.id);
    expect((await listIdeas(s.root)).ideas).toHaveLength(3);
    expect(await readFile(path.join(s.root, 'data', 'inbox', 'undo.jsonl'), 'utf8')).toBe(lines);
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
    await sentE2(s.root, 'CAFE-2026-001', ['How many requests a week?', 'Who does it today?']);
    const { item } = await s.drop('reply.eml', await readFile(FIX('reply.eml')));
    expect(item.triage.ideaId).toBe('CAFE-2026-001');
    const by = (t: string) => item.actions.find((r: any) => r.action.t === t);
    expect(by('file_email')).toMatchObject({ kind: 'safe', status: 'applied' });
    expect(by('reply_received')).toMatchObject({ kind: 'safe', status: 'applied' });
    expect(by('record_answers')).toMatchObject({ kind: 'safe', status: 'applied' });
    const g = by('graph_links');
    expect(g).toMatchObject({ kind: 'safe', status: 'applied' });

    const list = await s.inbox();
    expect(list.items[0].id).toBe(item.id);
    expect(list.counts).toEqual({ new: 0, ok: 0, held: 0, applied: 2 });

    let graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.find((e: any) => e.id === 'idea:CAFE-2026-001|REPLACES|painpoint:manual-request-triage')).toMatchObject({ confirmed: true });
    await s.post(`/api/inbox/${item.id}/undo`, { recordId: g.id });
    graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.some((e: any) => e.id === 'idea:CAFE-2026-001|REPLACES|painpoint:manual-request-triage')).toBe(false);
  });

  it('a link at 0.7 or above between known stars is Safe, shows in /api/graph, and Undo removes it', async () => {
    const s = await server(triageConnector({
      what: 'Invoices need reading.', understood: ['Invoices need reading.'], uncertain: [], kind: 'update', ideaId: 'CAFE-2026-003', matchConfidence: 0.9,
      facts: { graph: { nodes: [{ type: 'Capability', label: 'Invoice reading' }], links: [{ from: 'idea', to: 'Invoice reading', rel: 'NEEDS', description: 'Reads invoices', confidence: 0.8 }] } },
    }));
    await s.drop('export.csv', await readFile(FIXTURE));
    await pickTool(s.root, 'CAFE-2026-002', 'Invoice reading');
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Update on CAFE-2026-003: they want invoices read.', name: 'update' }));
    const g = item.actions.find((r: any) => r.action.t === 'graph_links');
    expect(g).toMatchObject({ kind: 'safe', status: 'applied' });
    const id = 'idea:CAFE-2026-003|NEEDS|capability:invoice-reading';
    let graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.find((e: any) => e.id === id)).toMatchObject({ confirmed: true });
    await s.post(`/api/inbox/${item.id}/undo`, { recordId: g.id });
    graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.some((e: any) => e.id === id)).toBe(false);
  });

  it('a link below 0.7 between existing stars is applied at once, confirmed; Undo removes it', async () => {
    const s = await server(triageConnector({
      what: 'Invoices may need reading.', understood: ['Invoices may need reading.'], uncertain: [], kind: 'update', ideaId: 'CAFE-2026-003', matchConfidence: 0.9,
      facts: { graph: { nodes: [{ type: 'Capability', label: 'Invoice reading' }], links: [{ from: 'idea', to: 'Invoice reading', rel: 'NEEDS', description: 'Maybe', confidence: 0.5 }] } },
    }));
    await s.drop('export.csv', await readFile(FIXTURE));
    await pickTool(s.root, 'CAFE-2026-002', 'Invoice reading');
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Update on CAFE-2026-003.', name: 'update' }));
    const g = item.actions.find((r: any) => r.action.t === 'graph_links');
    expect(g).toMatchObject({ kind: 'safe', status: 'applied', inverse: { t: 'remove-ai-links' } });
    const id = 'idea:CAFE-2026-003|NEEDS|capability:invoice-reading';
    let graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.find((e: any) => e.id === id)).toMatchObject({ confirmed: true });
    await s.post(`/api/inbox/${item.id}/undo`, { recordId: g.id });
    graph = await json(await fetch(`${s.base}/api/graph`));
    expect(graph.edges.some((e: any) => e.id === id)).toBe(false);
  });

  it('choose is refused once something was applied: undo it first', async () => {
    const s = await server();
    await s.drop('export.csv', await readFile(FIXTURE));
    const { item } = await s.drop('reply.eml', await readFile(FIX('reply.eml')));
    expect(item.actions.some((r: any) => r.status === 'applied')).toBe(true);
    const r = await s.post(`/api/inbox/${item.id}/choose`, { ideaId: 'CAFE-2026-002' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Undo what was done first');
    expect(await readdir(path.join(s.root, 'data', 'ideas', (await ideaFolders(s.root)).find((f) => f.startsWith('CAFE-2026-002'))!))).not.toContain('emails');
  });

  it('a card for an import that is gone gets a plain answer, not "inbox"', async () => {
    const s = await server();
    const r = await s.post('/api/inbox/in-000000000000/process');
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('No such import in-000000000000');
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
    // The run stops at understand (failed, the rest skipped): nothing is planned, so nothing is applied.
    expect(item.actions ?? []).toEqual([]);
    expect(item.steps.find((x: any) => x.id === 'understand')).toMatchObject({ status: 'failed', detail: expect.stringMatching(/timed out/) });
    expect(item.problems.join(' ')).toMatch(/by hand/);
    expect((await listIdeas(s.root)).ideas.find((i) => i.id === 'CAFE-2026-001')!.checklist.s2d).toBeUndefined();
  });

  it('dismiss sets it aside', async () => {
    const s = await server();
    const { item } = await json(await s.post('/api/inbox/drop', { text: 'Nothing much.' }));
    const d = await json(await s.post(`/api/inbox/${item.id}/dismiss`));
    expect(d.item.status).toBe('dismissed');
  });
});

describe('/api/inbox: file names (final review 1)', () => {
  it('a file name with non-Latin-1 characters arrives intact when the UI encodes it', async () => {
    const s = await server();
    const name = 'RE Café – update ’24 ✓.eml';
    const r = await fetch(`${s.base}/api/inbox/drop`, { method: 'POST', headers: { 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' }, body: await readFile(FIX('reply.eml')) });
    expect(r.status).toBe(200);
    const { item } = await json(r);
    expect(item.name).toBe(name);
    expect(item.file).toMatch(/^inbox\/2026-10-20-[^/]+\.eml$/);
  });

  it('a raw name that is not valid percent-encoding is kept as given, and paths are stripped', async () => {
    const s = await server();
    const { item } = await s.drop('100%-done.txt', Buffer.from('Nothing much.'));
    expect(item.name).toBe('100%-done.txt');
    const { item: other } = await s.drop(encodeURIComponent('../../evil.txt'), Buffer.from('Other.'));
    expect(other.name).toBe('evil.txt');
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

    const noRound = await s.post(`/api/inbox/${item.id}/draft-held-reply`);
    expect(noRound.status).toBe(400);
    expect((await json(noRound)).error).toBe('Create a round first (Rounds button)');
    await s.post('/api/rounds', { name: 'Autumn' });
    const drafted = await json(await s.post(`/api/inbox/${item.id}/draft-held-reply`));
    expect(drafted.email).toMatchObject({ template: 'PD', status: 'draft', key: 'rounds/ROUND-001/emails/001-PD.md' });
    expect(drafted.email.body).toMatch(/held-tracker\.csv/);
    const state = await json(await fetch(`${s.base}/api/state`));
    expect(state.outbox.some((m: any) => m.key === drafted.email.key)).toBe(true);

    const del = await s.post(`/api/inbox/${item.id}/delete`);
    expect(del.status).toBe(200);
    expect(await exists(path.join(s.root, 'data', ...item.file.split('/')))).toBe(false);
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
