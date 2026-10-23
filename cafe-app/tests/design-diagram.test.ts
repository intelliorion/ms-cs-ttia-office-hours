import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { startServer, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { readDesign, writeDesign, emptyDesign, type DesignState } from '../src/design/store';
import { basisOf, checkDiagram, diagramOf, isStale, plainDiagram, DiagramError, NODES_MAX } from '../src/design/diagram';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { designDiagramTask, DESIGN_DIAGRAM_SCHEMA } from '../src/ai/tasks';

const ID = 'CAFE-2026-001';
const json = (r: Response) => r.json() as Promise<any>;
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

const FEATURES = [
  { id: 'a', name: 'Weekend spend check', what: 'Flags weekend claims', flags: [] },
  { id: 'b', name: 'Flagged claims review list', flags: [], scope: { status: 'out' as const, why: 'Leave marking out' } },
  { id: 'c', name: 'Claimant query drafting', flags: [], scope: { status: 'outside' as const, by: 'Microsoft Copilot + SharePoint' } },
];
const design = (over: Partial<DesignState> = {}): DesignState => ({
  ...emptyDesign(), status: 'designing', features: FEATURES,
  steps: [
    { n: 1, question: 'Who reads the list?', suggested: [], source: 'operator', tag: 'users', answer: 'A controls lead' },
    { n: 2, question: 'Which columns?', suggested: [], source: 'operator', tag: 'output', answer: 'Claim id, rule, amount' },
  ],
  summary: 'Shows the check.', ...over,
});

describe('the diagram spec is checked against the design', () => {
  const spec = {
    lanes: [{ id: 'data', label: 'Data', kind: 'data' }, { id: 'tool', label: 'Dataiku', kind: 'tool' }, { id: 'tool', label: 'Dup', kind: 'tool' }, { id: 'x', label: 'Bad', kind: 'cloud' }, { id: 'empty', label: 'Nobody', kind: 'person' }],
    nodes: [
      { id: 'in', lane: 'data', label: 'Export', kind: 'input', step: 9 },
      { id: 'chk', lane: 'tool', label: 'Check', kind: 'step', feature: 'weekend SPEND check', step: 2, detail: 'Weekend\ndates' },
      { id: 'chk', lane: 'tool', label: 'Dup id', kind: 'step' },
      { id: 'lost', lane: 'nowhere', label: 'Lost', kind: 'step' },
      { id: 'out', lane: 'tool', label: 'Flagged list', kind: 'output', feature: 'Not a feature' },
    ],
    edges: [{ from: 'in', to: 'chk', label: 'claims' }, { from: 'chk', to: 'out' }, { from: 'chk', to: 'out' }, { from: 'out', to: 'out' }, { from: 'out', to: 'lost' }],
  };
  it('keeps what fits: known lanes and features (named as the list names them), real questions, arrows between parts', () => {
    const out = checkDiagram(spec, design());
    expect(out.lanes.map((l) => l.id)).toEqual(['data', 'tool']);
    expect(out.nodes.map((n) => n.id)).toEqual(['in', 'chk', 'out']);
    expect(out.nodes[0].step).toBeUndefined();
    expect(out.nodes[1]).toMatchObject({ feature: 'Weekend spend check', step: 2, detail: 'Weekend dates' });
    expect(out.nodes[2].feature).toBeUndefined();
    expect(out.edges).toEqual([{ from: 'in', to: 'chk', label: 'claims' }, { from: 'chk', to: 'out' }]);
    expect(() => checkDiagram({ lanes: spec.lanes, nodes: [] }, design())).toThrow(DiagramError);
  });
  it('the AI task: a schema with size caps, the prompt asks for lanes, kinds and no names', () => {
    const big = { lanes: [{ id: 't', label: 'T', kind: 'tool' }], nodes: Array.from({ length: NODES_MAX + 1 }, (_, i) => ({ id: `n${i}`, lane: 't', label: 'x', kind: 'step' })), edges: [] };
    expect(() => designDiagramTask.parse(JSON.stringify(big))).toThrow(/invalid output/);
    expect(DESIGN_DIAGRAM_SCHEMA.required).toEqual(['lanes', 'nodes', 'edges']);
    const p = designDiagramTask.prompt({ idea: { id: ID, title: 'x' }, features: [], steps: [], points: {}, outsideTools: [] });
    expect(p.startsWith('TASK: design-diagram')).toBe(true);
    expect(p).toMatch(/never write a name/);
    expect(p).toMatch(/kind "outside"/);
  });
  it('goes out of date when the design changes', () => {
    const d = design();
    const stored = { spec: plainDiagram(d), by: 'ai' as const, at: '2026-10-20', basis: basisOf(d) };
    expect(isStale(stored, d)).toBe(false);
    expect(isStale(stored, { ...d, steps: [{ ...d.steps[0], answer: 'A reviewer' }, d.steps[1]] })).toBe(true);
    expect(isStale(undefined, d)).toBe(false);
    expect(diagramOf({ spec: { lanes: [], nodes: [] } })).toBeUndefined();
  });
  it('with no AI the app draws a plain one: input, the built features, output, people; outside tools in their lane; out of scope left out', () => {
    const p = plainDiagram({ ...design(), tool: { tool: 'Dataiku', fit: [] } });
    expect(p.lanes.map((l) => l.kind)).toEqual(['data', 'tool', 'outside', 'person']);
    expect(p.lanes[1].label).toBe('Dataiku');
    const labels = p.nodes.map((n) => n.label);
    expect(labels).toContain('Weekend spend check');
    expect(labels).toContain('Claimant query drafting');
    expect(labels).not.toContain('Flagged claims review list');
    expect(p.nodes.find((n) => n.id === 'users')).toMatchObject({ label: 'A controls lead', step: 1 });
    expect(p.nodes.find((n) => n.id === 'output')).toMatchObject({ detail: 'Claim id, rule, amount', step: 2 });
    expect(checkDiagram(p, design())).toEqual(p);
    const empty = plainDiagram({ features: [], steps: [] });
    expect(empty.nodes.length).toBeGreaterThan(2);
  });
});

describe('drawn when the design completes, and on Redraw', () => {
  async function server(provider: Provider) {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await saveIdea(s.root, sampleIdea({ stage: 3, challenge: 'Person 1 sorts requests by hand.' }));
    await post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Request intake form', flags: [] }], tool: { tool: 'Power Apps', by: 'operator', fit: [{ feature: 'Request intake form', fit: 'yes', note: '' }] } });
    return { ...s, post };
  }
  const finish = async (s: Awaited<ReturnType<typeof server>>) => {
    for (let n = 1; n <= 3; n++) {
      await s.post(`/api/ideas/${ID}/design/step`, { force: true });
      await s.post(`/api/ideas/${ID}/design/answer`, { n, answer: n === 3 ? 'Person 1 builds it' : 'A sample sheet' });
    }
    return json(await s.post(`/api/ideas/${ID}/design/step`, { force: true }));
  };

  it('the done step draws it (names coded on the way out), stores it with its basis; Redraw draws again', async () => {
    const prompts: string[] = [];
    const fake = fakeProvider();
    const spy: Provider = { ...fake, complete: async (p, o) => { prompts.push(p); return fake.complete(p, o); } };
    const s = await server(spy);
    const done = await finish(s);
    expect(done.state.diagram).toMatchObject({ by: 'ai', provider: 'fake' });
    expect(done.state.diagram.spec.nodes.map((n: any) => n.label)).toContain('Request intake form');
    const st = await readDesign(s.root, ID);
    expect(st.diagram!.basis).toBe(basisOf(st));
    const asked = prompts.find((p) => p.startsWith('TASK: design-diagram'))!;
    expect(asked).toBeTruthy();
    expect(asked).not.toContain('Person 1');
    expect(asked).toMatch(/\[P\d+\] builds it/);

    await writeDesign(s.root, ID, { ...st, diagram: undefined });
    const again = await json(await s.post(`/api/ideas/${ID}/design/diagram`));
    expect(again.state.diagram.by).toBe('ai');
    // The diagram is a file too, beside design.md, and opens as a page.
    const { readFile } = await import('node:fs/promises');
    const { ideaDir } = await import('../src/ideas/store');
    const html = await readFile(path.join(await ideaDir(s.root, ID), 'design-diagram.html'), 'utf8');
    expect(html).toContain('<svg class="diagram"');
    expect(html).toContain('Request intake form');
    const page = await fetch(`${s.base}/api/ideas/${ID}/design/view/design-diagram.html`);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect(await page.text()).toBe(html);
    expect((await fetch(`${s.base}/api/ideas/${ID}/design/view/idea.yaml`)).status).toBe(400);
  });

  it('an AI that cannot draw leaves the design done with no diagram; Redraw says so', async () => {
    const fake = fakeProvider();
    const broken: Provider = { ...fake, complete: async (p, o) => (p.startsWith('TASK: design-diagram') ? 'no json here' : fake.complete(p, o)) };
    const s = await server(broken);
    const done = await finish(s);
    expect(done.state.summary).toBeTruthy();
    expect(done.state.diagram).toBeUndefined();
    // It says so, rather than failing quietly: in the reply and in the idea's history.
    expect(done.diagramError).toBeTruthy();
    const history = await (await fetch(`${s.base}/api/ideas/${ID}/history`)).json() as any[];
    expect(history.some((h: any) => /Diagram not drawn/.test(h.detail ?? ''))).toBe(true);
    const r = await s.post(`/api/ideas/${ID}/design/diagram`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/Working by hand/);
  });

  it('a drawing that fails once is tried again at once', async () => {
    const fake = fakeProvider();
    let tries = 0;
    const flaky: Provider = { ...fake, complete: async (p, o) => (p.startsWith('TASK: design-diagram') && tries++ === 0 ? 'no json here' : fake.complete(p, o)) };
    const s = await server(flaky);
    const done = await finish(s);
    expect(done.state.diagram?.by).toBe('ai');
    expect(done.diagramError).toBeUndefined();
  });

  it('Redraw needs a finished design', async () => {
    const s = await server(fakeProvider());
    const r = await s.post(`/api/ideas/${ID}/design/diagram`);
    expect((await json(r)).error).toMatch(/Finish the design first/);
  });
});
