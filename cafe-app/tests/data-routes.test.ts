import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign } from '../src/design/store';
import { pointOf } from '../src/design/points';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { readHistory } from '../src/workspace/files';
import { rebuildGraph } from '../src/graph/store';
import { expenseCsv, personalCsv, rulesXlsx, outputCsv, exampleEml } from './dataFixtures';

const ID = 'CAFE-2026-004';
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

async function server(provider?: Provider, settings = DEFAULT_SETTINGS) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-20', { connector: createConnector({ providers: [provider ?? fakeProvider()], settings }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = async (url: string, body: unknown = {}) => {
    const r = await fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  const drop = async (name: string, bytes: Uint8Array | string, kind = '', stream = false) => {
    const r = await fetch(`${s.base}/api/ideas/${ID}/data/drop`, {
      method: 'POST', body: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
      headers: { 'x-filename': encodeURIComponent(name), 'x-kind': kind, 'content-type': 'application/octet-stream', ...(stream ? { accept: 'application/x-ndjson' } : {}) },
    });
    if (stream) return { status: r.status, lines: (await r.text()).trim().split('\n').map((l) => JSON.parse(l)) } as any;
    return { status: r.status, body: await r.json() as any };
  };
  await saveIdea(s.root, sampleIdea({
    id: ID, slug: 'expense-anomaly-finder', title: 'Expense anomaly finder', stage: 3,
    challenge: 'Expense claims are checked against the policy by hand every week.', outcomes: ['Flag claims that break the policy'],
  }));
  return { ...s, post, drop };
}

describe('Understand the data: one file through Read, Check, Profile, Understand, Saved', () => {
  it('a sample input: copied into the idea folder, profiled, understood by the AI after a closer look, and checked against the profile', async () => {
    const { root, drop } = await server();
    const r = await drop('expenses export.csv', expenseCsv(40), 'input');
    expect(r.status).toBe(200);
    const f = r.body.file;
    expect(f.steps.map((s: any) => [s.id, s.status])).toEqual([['read', 'done'], ['check', 'done'], ['profile', 'done'], ['understand', 'done'], ['saved', 'done']]);
    expect(f.steps[0].detail).toBe('Table: 40 rows, 6 columns');
    expect(f.steps[1].detail).toMatch(/No personal data found\. employee_ref looks masked/);
    // The fake asked to look at the code column first; the column it made up was dropped by the code.
    expect(f.understanding.looked).toEqual(['policy_type']);
    expect(f.understanding.columns.map((c: any) => c.name)).toEqual(['claim_id', 'claim_date', 'employee_ref', 'policy_type', 'amount', 'receipt']);
    expect(f.understanding.dropped).toEqual(['not_a_column']);
    expect(f.steps[3].detail).toMatch(/looked closer at policy_type first/);
    // The copy is in the idea folder's data-files/, and nowhere else.
    const dir = await ideaDir(root, ID);
    expect(await readdir(path.join(dir, 'data-files'))).toEqual(['f1-expenses export.csv']);
    expect(await readFile(path.join(dir, 'data-files', 'f1-expenses export.csv'), 'utf8')).toBe(expenseCsv(40));
    // design.md has the Data section, marked not confirmed.
    const md = await readFile(path.join(dir, 'design.md'), 'utf8');
    expect(md).toContain('## Data');
    expect(md).toContain('### expenses export.csv (Sample input)');
    expect(md).toMatch(/Not confirmed yet/);
    expect(md).toContain('- `policy_type` (category): The policy type of each row Codes: Each code is a kind of row');
    expect((await readHistory(dir)).some((h) => h.detail === 'Data dropped: expenses export.csv (Sample input)')).toBe(true);
  });

  it('streams the step cards as they happen when asked (ndjson), then the design', async () => {
    const { drop } = await server();
    const r = await drop('rules.xlsx', await rulesXlsx(), '', true);
    const progress = r.lines.filter((l: any) => l.type === 'progress');
    expect(progress.length).toBeGreaterThan(5);
    expect(progress[0].file.steps[0]).toMatchObject({ id: 'read', status: 'running' });
    const done = r.lines.at(-1);
    expect(done.type).toBe('done');
    // No kind given: guessed from the name.
    expect(done.data.file.kind).toBe('rules');
    expect(done.data.file.tables.map((t: any) => t.name)).toEqual(['caps', 'days']);
    expect(done.data.file.understanding.rules[0]).toEqual({ rule: 'max_amount per policy_type', columns: ['policy_type', 'max_amount'] });
  });

  it('personal data holds the file: nothing reaches the AI until the operator says it is masked or synthetic, and the flagged columns stay masked', async () => {
    const seen: string[] = [];
    const spy: Provider = { ...fakeProvider(), async complete(p, o) { seen.push(p); return fakeProvider().complete(p, o); } };
    const { root, drop, post } = await server(spy);
    const r = await drop('claims.csv', personalCsv(), 'input');
    const f = r.body.file;
    expect(f.check.status).toBe('held');
    expect(f.steps.map((s: any) => s.status)).toEqual(['done', 'needs-you', 'skipped', 'skipped', 'skipped']);
    expect(f.steps[1].detail).toMatch(/^Held: staff_email holds 6 email addresses; mobile holds 6 phone numbers/);
    expect(seen).toHaveLength(0);
    expect(f.tables).toBeUndefined();
    // The data questions and the confirmation wait for it.
    expect((await post(`/api/ideas/${ID}/data/confirm`)).body.error).toMatch(/not complete/);
    const go = await post(`/api/ideas/${ID}/data/f1/release`);
    expect(go.status).toBe(200);
    expect(go.body.file.check).toMatchObject({ status: 'released', releasedAt: '2026-10-20', masked: ['staff_email', 'mobile'] });
    expect(go.body.file.steps.map((s: any) => s.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    const prompt = seen.join('\n');
    expect(prompt).not.toMatch(/corp-mail|07700/);
    expect(prompt).toContain('"masked": "email"');
    expect(go.body.file.tables[0].columns.find((c: any) => c.name === 'staff_email')).toMatchObject({ type: 'masked', masked: 'email' });
    // Remove takes the copy out of the idea folder.
    await post(`/api/ideas/${ID}/data/f1/remove`);
    expect(await readdir(path.join(await ideaDir(root, ID), 'data-files'))).toEqual([]);
    expect((await readDesign(root, ID)).data?.files ?? []).toEqual([]);
  });

  it('refuses what is not a data file, and more than twelve', async () => {
    const { drop } = await server();
    expect((await drop('run.exe', 'MZ')).body.error).toMatch(/Can't read a \.exe/);
    expect((await drop('fake.xlsx', 'a,b\n1,2')).body.error).toMatch(/not a real \.xlsx/);
  });

  it('kind changes need Understand again; the operator\'s corrections win and are kept', async () => {
    const { root, drop, post } = await server();
    await drop('expenses.csv', expenseCsv(10), 'input');
    let d = (await post(`/api/ideas/${ID}/data/f1/kind`, { kind: 'today' })).body.state.data;
    expect(d.files[0]).toMatchObject({ kind: 'today', stale: true });
    expect((await post(`/api/ideas/${ID}/data/f1/kind`, { kind: 'nope' })).body.error).toMatch(/Pick what kind/);
    d = (await post(`/api/ideas/${ID}/data/f1/edit`, { what: 'Masked claims, October', columns: { amount: 'Claimed amount in GBP' } })).body.state.data;
    expect(d.files[0].edits).toMatchObject({ what: 'Masked claims, October', columns: { amount: 'Claimed amount in GBP' } });
    expect((await post(`/api/ideas/${ID}/data/f1/edit`, { columns: { nope: 'x' } })).body.error).toMatch(/no column nope/);
    const again = (await post(`/api/ideas/${ID}/data/f1/understand`)).body;
    expect(again.file.stale).toBeUndefined();
    expect(again.file.edits.columns.amount).toBe('Claimed amount in GBP');
    expect(await readFile(path.join(await ideaDir(root, ID), 'design.md'), 'utf8')).toContain('- `amount` (money): Claimed amount in GBP');
  });
});

describe('The data questions, the automatic updates and the one confirmation', () => {
  it('asks one question at a time until complete, applies what the answers imply, then the operator confirms and the data feeds the design', async () => {
    const { root, drop, post } = await server();
    await drop('expenses.csv', expenseCsv(40), 'input');
    await drop('policy caps.xlsx', await rulesXlsx(), 'rules');
    await drop('request.eml', exampleEml(), 'email');
    // No output sample: the first question is about the output.
    let r = await post(`/api/ideas/${ID}/data/step`);
    expect(r.body.step).toMatchObject({ n: 1, topic: 'output', suggested: expect.arrayContaining(['A list of flagged rows with a reason']) });
    expect((await post(`/api/ideas/${ID}/data/step`)).body.error).toMatch(/Answer data question 1 first/);
    await post(`/api/ideas/${ID}/data/answer`, { n: 1, suggestedIndex: 0 });
    r = await post(`/api/ideas/${ID}/data/step`);
    expect(r.body.step).toMatchObject({ n: 2, topic: 'volumes' });
    await post(`/api/ideas/${ID}/data/answer`, { n: 2, answer: 'About 1,000 rows a month from the Expense System export.' });
    // The answers save themselves on the idea.
    expect(((await loadIdea(root, ID)) as any).answers.filter((a: any) => a.source === 'data questions')).toHaveLength(2);
    r = await post(`/api/ideas/${ID}/data/step`);
    expect(r.body.done).toBe(true);
    // What the answers imply was applied by itself: a system the data comes from, linked in the universe; a fact saved.
    expect(r.body.applied.join(' ')).toMatch(/Sample data check uses data from Expense System/);
    const graph = await rebuildGraph(root);
    expect(graph.nodes.some((n) => n.type === 'System' && n.label === 'Expense System')).toBe(true);
    const idea = await loadIdea(root, ID) as any;
    expect(idea.updates.every((u: any) => u.from === 'data' && u.status === 'applied')).toBe(true);
    expect((await readHistory(await ideaDir(root, ID))).some((h) => /^Updated from the data answers: /.test(h.detail ?? ''))).toBe(true);
    let d = r.body.state.data;
    expect(d.summary.text).toMatch(/The data is understood/);
    expect(d.applied.length).toBeGreaterThan(0);
    expect(d.confirmedAt).toBeUndefined();
    // Not confirmed: the design points are not settled by the data yet.
    expect(pointOf(await readDesign(root, ID), 'input-shape')).toBeUndefined();
    d = (await post(`/api/ideas/${ID}/data/confirm`)).body.state.data;
    expect(d.confirmedAt).toBe('2026-10-20');
    const design = await readDesign(root, ID);
    expect(pointOf(design, 'input-shape')).toMatch(/^expenses\.csv \(40 rows, 6 columns\): claim_id, claim_date/);
    expect(pointOf(design, 'logic')).toBe('max_amount per policy_type');
    const learned = (await loadIdea(root, ID)).learned!.points.find((p) => p.topic === 'Data')!;
    expect(learned.text).toMatch(/^Sample input: expenses\.csv \(40 rows, 6 columns\)/);
    expect(await readFile(path.join(await ideaDir(root, ID), 'design.md'), 'utf8')).toMatch(/Confirmed by the operator on 2026-10-20/);
    // Dropping another file reopens it: a new confirmation is needed.
    d = (await drop('flagged.csv', outputCsv(), 'output')).body.state.data;
    expect(d.confirmedAt).toBeUndefined();
    expect(d.summary).toBeUndefined();
    expect(pointOf(await readDesign(root, ID), 'input-shape')).toBeUndefined();
  });

  it('"I don\'t know" puts the question in the questions email; the hand path needs no AI', async () => {
    const { drop, post } = await server();
    await drop('expenses.csv', expenseCsv(10), 'input');
    await post(`/api/ideas/${ID}/data/step`);
    const r = await post(`/api/ideas/${ID}/data/answer`, { n: 1, idk: true });
    expect(r.status).toBe(200);
    expect(r.body.emailKey).toBeTruthy();
    expect(r.body.state.data.steps[0].askedTeam).toBeTruthy();
    const q = (await post(`/api/ideas/${ID}/data/step`, { question: 'Which currency are the amounts in?', suggested: ['GBP', 'USD'] })).body;
    expect(q.step).toMatchObject({ n: 2, source: 'operator' });
    await post(`/api/ideas/${ID}/data/answer`, { n: 2, answer: 'GBP' });
    const fin = await post(`/api/ideas/${ID}/data/finish`, { summary: 'Masked October claims in GBP; the rule is the policy caps.' });
    expect(fin.body.state.data.summary.open.join(' ')).toMatch(/Asked the team/);
    expect((await post(`/api/ideas/${ID}/data/confirm`)).body.state.data.confirmedAt).toBe('2026-10-20');
  });
});

