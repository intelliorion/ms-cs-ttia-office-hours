import { describe, it, expect, afterEach, vi } from 'vitest';
import { startServer, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { emptyDesign, readDesign, renderDesignMd, type DesignState } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { plainDiagram, basisOf } from '../src/design/diagram';
import { kitFiles } from '../src/design/kits';
import { flowOf } from '../src/design/kitFiles';
import { fitSampleToData, syntheticValue } from '../src/data/kitSample';
import { profileTable } from '../src/data/profile';
import { readCsv } from '../src/data/read';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import type { DataFile, DataState } from '../src/data/model';
import type { KitSample } from '../src/ai/tasks';
import { expenseCsv, rulesXlsx, outputCsv } from './dataFixtures';

const ID = 'CAFE-2026-004';
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

/** A server whose AI records every prompt, and an idea with a confirmed data understanding (or not). */
async function withData(confirm: boolean) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const prompts: string[] = [];
  const spy: Provider = { ...fakeProvider(), async complete(p, o) { prompts.push(p); return fakeProvider().complete(p, o); } };
  const s = await startServer('2026-10-20', { connector: createConnector({ providers: [spy], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = async (url: string, body: unknown = {}) => (await fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
  const drop = (name: string, bytes: Uint8Array | string, kind: string) => fetch(`${s.base}/api/ideas/${ID}/data/drop`, {
    method: 'POST', body: typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
    headers: { 'x-filename': encodeURIComponent(name), 'x-kind': kind, 'content-type': 'application/octet-stream' },
  }).then((r) => r.json());
  await saveIdea(s.root, sampleIdea({ id: ID, slug: 'expense-anomaly-finder', title: 'Expense anomaly finder', stage: 3, challenge: 'Claims are checked by hand.' }));
  await drop('expenses.csv', expenseCsv(30), 'input');
  await drop('caps.xlsx', await rulesXlsx(), 'rules');
  await drop('flagged.csv', outputCsv(), 'output');
  for (let k = 0; k < 4; k++) {
    const r = await post(`/api/ideas/${ID}/data/step`);
    if (r.step) await post(`/api/ideas/${ID}/data/answer`, { n: r.step.n, suggestedIndex: 0 });
    if (r.done) break;
  }
  if (confirm) expect((await post(`/api/ideas/${ID}/data/confirm`)).state.data.confirmedAt).toBe('2026-10-20');
  prompts.length = 0;
  return { ...s, post, prompts };
}

const dataBlock = (p: string) => JSON.parse(p.slice(p.lastIndexOf('<<<DATA') + 7, p.lastIndexOf('DATA>>>')));

describe('the confirmed data feeds the features, the tool and the design questions', () => {
  it('Suggest features and Suggest a tool read it; the design questions do too, and the input point is settled', async () => {
    const { post, prompts, root } = await withData(true);
    await post(`/api/ideas/${ID}/tools/features/suggest`, {});
    await post(`/api/ideas/${ID}/tools/suggest`, {});
    const [features, tool] = prompts;
    expect(features).toMatch(/^TASK: feature-list/);
    expect(dataBlock(features).data.files.map((f: any) => [f.name, f.kind])).toEqual([['expenses.csv', 'Sample input'], ['caps.xlsx', 'Rules or reference'], ['flagged.csv', 'Sample output (what it should produce)']]);
    expect(features).toMatch(/A sample output .* shows what the proof of concept must produce/);
    expect(dataBlock(tool).data.files[0].columns.map((c: any) => c.name)).toContain('policy_type');
    expect(tool).toMatch(/points to Dataiku/);
    await post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Weekend flag' }], tool: { tool: 'Dataiku' } });
    prompts.length = 0;
    await post(`/api/ideas/${ID}/design/step`, { force: true });
    expect(prompts[0]).toMatch(/^TASK: design-step/);
    expect(prompts[0]).toMatch(/never ask for columns, fields or codes DATA.data already names/);
    expect(dataBlock(prompts[0]).data.answers.length).toBeGreaterThan(0);
    const md = renderDesignMd({ id: ID, title: 'Expense anomaly finder', outcomes: [] } as any, await readDesign(root, ID));
    expect(md).toMatch(/## Input\n\nexpenses\.csv \(30 rows, 6 columns\): claim_id/);
    expect(md).toMatch(/## Output\n\nLike flagged\.csv: claim_id, flag_reason, amount_over/);
  });
  it('an understanding not confirmed yet is shown, never fed', async () => {
    const { post, prompts } = await withData(false);
    await post(`/api/ideas/${ID}/tools/features/suggest`, {});
    expect(dataBlock(prompts[0]).data).toBeUndefined();
    expect(prompts[0]).not.toMatch(/DATA\.data is the team/);
  });
});

const file = (over: Partial<DataFile>): DataFile => ({ id: 'f1', name: 'expenses.csv', file: 'f1-expenses.csv', kind: 'input', bytes: 1, type: 'table', at: '', steps: [], check: { status: 'clear', findings: [], masked: [], notes: [] }, ...over });
const confirmed = (files: DataFile[]): DataState => ({ files, steps: [], confirmedAt: '2026-10-20' });
const input = file({ tables: [profileTable(readCsv('e.csv', expenseCsv(30))[0], new Map(), [])], understanding: { what: 'Masked claims', columns: [{ name: 'amount', meaning: 'Claimed amount' }], points: [], rules: [], derivations: [], serves: [], issues: [], missing: [], looked: [], at: '' } });
const rules = file({ id: 'f2', name: 'policy caps.csv', file: 'f2-x', kind: 'rules', tables: [profileTable(readCsv('c.csv', 'policy_type,max_amount\nT,150\nM,40\n')[0], new Map(), [])] });
const output = file({ id: 'f3', name: 'flagged.csv', file: 'f3-x', kind: 'output', tables: [profileTable(readCsv('o.csv', outputCsv())[0], new Map(), [])] });
const doc = file({ id: 'f4', name: 'policy.pdf', file: 'f4-x', kind: 'process', type: 'document', doc: { chars: 10, words: 2, lines: 1, headings: [], tables: 0 }, understanding: { what: 'The expense policy', columns: [], points: [], rules: [], derivations: [], serves: [], issues: [], missing: [], looked: [], at: '' } });

describe('the diagram, the kits and design.md use the real data', () => {
  it('the plain diagram names the data lane from the files; its fingerprint only changes when there is confirmed data', () => {
    const base = { features: [{ name: 'Weekend flag' }], steps: [] };
    expect(basisOf({ ...base, data: { files: [input] } })).toBe(basisOf(base));
    const spec = plainDiagram({ ...base, data: confirmed([input, rules, output]) });
    expect(spec.nodes.filter((n) => n.lane === 'data').map((n) => n.label)).toEqual(['expenses.csv', 'policy caps.csv']);
    expect(spec.nodes.find((n) => n.id === 'output')!.label).toBe('Like flagged.csv');
    expect(spec.edges).toContainEqual({ from: 'rules1', to: 'f1', label: 'rules' });
    expect(plainDiagram({ ...base, data: { files: [input] } }).nodes[0].label).toBe('Sample input');
  });
  it('sample-data.csv has the sample input\'s columns, in order, and no value seen in the file', () => {
    const ai: KitSample = {
      name: 'Claims', columns: [{ name: 'claim_ref', kind: 'id', about: '' }, { name: 'amount', kind: 'money', about: '' }, { name: 'policy_type', kind: 'category', about: '' }],
      rows: [['X-1', input.tables![0].examples[0][4], 'T'], ['X-2', '99.10', 'M']],
      seeded: [{ label: 'Weekend', count: 3, row: ['X-9', '10', 'H'], expect: 'Flagged' }],
    };
    const { sample, fitted } = fitSampleToData(ai, confirmed([input]));
    expect(fitted).toBe(true);
    expect(sample.columns.map((c) => [c.name, c.kind])).toEqual([['claim_id', 'id'], ['claim_date', 'date'], ['employee_ref', 'category'], ['policy_type', 'category'], ['amount', 'money'], ['receipt', 'yes-no']]);
    expect(sample.columns[4].about).toBe('Claimed amount');
    const flat = sample.rows.flat();
    // The example amount the AI copied is replaced; its own made-up amount and the category codes stay.
    expect(sample.rows[0][4]).not.toBe(input.tables![0].examples[0][4]);
    expect(sample.rows[1][4]).toBe('99.10');
    expect(sample.rows.map((r) => r[3])).toEqual(['T', 'M']);
    for (const ex of input.tables![0].examples) expect(flat).not.toContain(ex[0]);
    expect(sample.seeded[0].row).toHaveLength(6);
    expect(fitSampleToData(ai, { ...confirmed([input]), confirmedAt: undefined }).fitted).toBe(false);
    expect(syntheticValue({ name: 'e', type: 'masked', masked: 'email', filled: 1, emptyPct: 0, distinct: 1 }, 1)).toBe('someone@example.com');
  });
  it('the Dataiku flow (no AI) names its datasets after the files, with their columns; the Copilot Studio knowledge lists the team\'s files', () => {
    const state: DesignState = {
      ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Flags claims over the cap.',
      features: [{ id: 'flag', name: 'Over-cap flag', flags: [] }],
      tool: { tool: 'Dataiku', pathway: pathwayOf('Dataiku'), by: 'operator', reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '' },
      steps: [], data: confirmed([input, rules, output, doc]),
    };
    const flow = flowOf({ idea: sampleIdea(), state, tool: 'Dataiku', built: state.features, outside: [], out: [], tasks: [], risks: [], mustShow: '' });
    expect(flow.datasets.map((d) => [d.name, d.kind])).toEqual([['expenses', 'input'], ['policy_caps', 'rules'], ['flagged', 'output']]);
    expect(flow.datasets[1].columns).toEqual([{ name: 'policy_type', type: 'string' }, { name: 'max_amount', type: 'double' }]);
    expect(flow.recipes[0].inputs).toEqual(['sample', 'rules1']);
    const studio = kitFiles(sampleIdea(), { ...state, tool: { ...state.tool!, tool: 'Copilot Studio' } }, { tasks: [], risks: [] });
    const knowledge = studio['kit/copilot-studio/knowledge.md'];
    expect(knowledge).toContain("## The team's own files");
    // Each with where it is kept, beside design.md.
    expect(knowledge).toContain('- **policy caps.csv** ([../../data-files/f2-x](../../data-files/f2-x), Rules or reference)');
    expect(knowledge).toContain('- **policy.pdf** ([../../data-files/f4-x](../../data-files/f4-x), Process document): The expense policy');
  });
  it('design.md says whether the data is confirmed, and shows each file', () => {
    const md = renderDesignMd(sampleIdea(), { ...emptyDesign(), data: { files: [input, { ...rules, check: { status: 'held', findings: [], masked: [], notes: [] } }], steps: [] } });
    expect(md).toContain('## Data');
    expect(md).toContain('Not confirmed yet: the understanding is still being worked out.');
    expect(md).toContain('### policy caps.csv (Rules or reference)\n\nHeld: it may hold personal data');
    expect(md).toContain('Masked claims. 30 rows, 6 columns.');
  });
});

