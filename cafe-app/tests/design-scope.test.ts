import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, renderDesignMd, emptyDesign, type DesignState } from '../src/design/store';
import { planFeatureChanges } from '../src/design/scope';
import { toolsMap, neededFeatures, validateFeatures, renderApproachMd } from '../src/design/tools';
import { designStepInput, decodeStep } from '../src/design/brainstorm';
import { toolFeatures } from '../src/design/choice';
import { designPlanInput } from '../src/design/kits';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { designStepTask } from '../src/ai/tasks';
import { readHistory } from '../src/workspace/files';
import { rebuildGraph } from '../src/graph/store';

const ID = 'CAFE-2026-001';
const NO_UPDATES = { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } };
const json = (r: Response) => r.json() as Promise<any>;
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

const FEATURES = [
  { id: 'check', name: 'Weekend spend check', what: 'Flags weekend claims', flags: [] },
  { id: 'review', name: 'Flagged claims review list', what: 'A reviewer marks each flagged claim', flags: [] },
  { id: 'query', name: 'Claimant query drafting', what: 'Drafts the question email', flags: [] },
];
const TOOL = {
  tool: 'Dataiku', pathway: 'Citizen-Led' as const, by: 'operator' as const, reason: 'Joins the export and the rules', pros: [], cons: [], context: [], flags: [],
  fit: [
    { feature: 'Weekend spend check', fit: 'yes' as const, note: '' },
    { feature: 'Flagged claims review list', fit: 'partly' as const, note: 'Marking is clumsy' },
    { feature: 'Claimant query drafting', fit: 'partly' as const, note: 'Cannot send emails' },
  ],
  evaluatedFor: FEATURES.map((f) => f.name), at: '2026-10-20',
};
const state = (over: Partial<DesignState> = {}): DesignState => ({ ...emptyDesign(), status: 'designing', features: FEATURES.map((f) => ({ ...f })), tool: TOOL, ...over });

describe('the AI proposes feature changes; the code checks them', () => {
  it('the design-step reply may carry feature changes, from a fixed list of kinds', () => {
    const base = { done: false, question: 'Q?', suggested: ['A', 'B'], updates: NO_UPDATES, learned: [] };
    const out = designStepTask.parse(JSON.stringify({ ...base, features: [{ name: ' Claimant query drafting ', change: 'outside-tool', by: 'Microsoft Copilot + SharePoint', why: '' }] }));
    expect(out.features).toEqual([{ name: 'Claimant query drafting', change: 'outside-tool', by: 'Microsoft Copilot + SharePoint' }]);
    expect(() => designStepTask.parse(JSON.stringify({ ...base, features: [{ name: 'X', change: 'rename' }] }))).toThrow(/invalid output/);
    const p = designStepTask.prompt(designStepInput(sampleIdea(), state({ features: [{ ...FEATURES[0], scope: { status: 'out' } }] })));
    expect(p).toMatch(/"outside-tool" when an answer says it is done with another tool/);
    expect(p).toContain('"scope": "out of scope"');
  });

  it('only names on the list; drop, outside-tool (another tool, never the main one) and reword; no-ops skipped', () => {
    const { features, log } = planFeatureChanges(state(), [
      { name: 'Not a feature', change: 'drop' },
      { name: 'flagged claims REVIEW list', change: 'drop', why: 'Leave marking out' },
      { name: 'Claimant query drafting', change: 'outside-tool', by: 'Dataiku' },
      { name: 'Claimant query drafting', change: 'outside-tool' },
      { name: 'Claimant query drafting', change: 'outside-tool', by: 'Microsoft Copilot + SharePoint', why: 'Drafted with Copilot' },
      { name: 'Weekend spend check', change: 'reword', what: 'Flags weekend spend on weekday policies' },
      { name: 'Weekend spend check', change: 'reword', what: 'Flags weekend spend on weekday policies' },
    ], '2026-10-20', 4);
    expect(features[1].scope).toEqual({ status: 'out', at: '2026-10-20', why: 'Leave marking out', step: 4 });
    expect(features[2].scope).toEqual({ status: 'outside', by: 'Microsoft Copilot + SharePoint', at: '2026-10-20', why: 'Drafted with Copilot', step: 4 });
    expect(features[0]).toMatchObject({ what: 'Flags weekend spend on weekday policies' });
    expect(features[0].scope).toBeUndefined();
    expect(log).toHaveLength(3);
    expect(planFeatureChanges({ ...state(), features }, [{ name: 'Flagged claims review list', change: 'drop' }], 'x').log).toEqual([]);
  });

  it('the graph: out of scope is not NEEDed; outside is not BUILT_WITH the main tool (only with one approved other tool)', () => {
    const s = state({
      features: [
        FEATURES[0], { ...FEATURES[1], scope: { status: 'out' } },
        { ...FEATURES[2], scope: { status: 'outside', by: 'Microsoft Copilot + SharePoint' } },
      ],
    });
    expect(toolsMap(s)).toEqual({ 'Weekend spend check': 'Dataiku' });
    expect(neededFeatures(s)).toEqual(['Weekend spend check', 'Claimant query drafting']);
    const copilot = state({ features: [FEATURES[0], { ...FEATURES[2], scope: { status: 'outside', by: 'Microsoft Copilot' } }] });
    expect(toolsMap(copilot)).toEqual({ 'Weekend spend check': 'Dataiku', 'Claimant query drafting': 'Microsoft Copilot' });
    expect(toolFeatures(s).map((f) => f.tool)).toEqual(['Dataiku', undefined, 'Microsoft Copilot + SharePoint']);
    expect(designPlanInput(sampleIdea(), s).features.map((f) => f.name)).toEqual(['Weekend spend check', 'Claimant query drafting']);
  });

  it('design.md and approach.md show the updated list: struck through with why, or the other tool named', () => {
    const s = state({
      features: [
        FEATURES[0], { ...FEATURES[1], scope: { status: 'out', why: 'Leave marking out' } },
        { ...FEATURES[2], scope: { status: 'outside', by: 'Microsoft Copilot + SharePoint' } },
      ],
    });
    const md = renderDesignMd(sampleIdea(), s);
    expect(md).toContain('- ~~**Flagged claims review list**~~ — out of scope (Leave marking out)');
    expect(md).toContain('- **Claimant query drafting** (Microsoft Copilot + SharePoint, outside the Dataiku build): Drafts the question email');
    expect(md).not.toMatch(/Claimant query drafting\*\* \(Dataiku\)/);
    const ap = renderApproachMd(sampleIdea(), s);
    expect(ap).toContain('- ~~**Flagged claims review list**~~ — out of scope (Leave marking out)');
    expect(ap).toContain('| Claimant query drafting | Outside the build (Microsoft Copilot + SharePoint) |');
  });

  it('a save from the tool picker keeps the scope; a bad one is dropped', () => {
    const out = validateFeatures([
      { name: 'A', scope: { status: 'out', why: 'x' } },
      { name: 'B', scope: { status: 'outside' } },
      { name: 'C', scope: { status: 'gone' } },
    ]);
    expect(out[0].scope).toEqual({ status: 'out', why: 'x' });
    expect(out[1].scope).toBeUndefined();
    expect(out[2].scope).toBeUndefined();
  });

  it('decodes the people codes in the changes', () => {
    const codes = new Map([['P1', { id: 'person:person-1', type: 'Person', label: 'Person 1' }]]) as any;
    const out = decodeStep({ done: false, question: 'Q?', features: [{ name: 'X', change: 'drop', why: '[P1] said no' }] }, codes);
    expect(out.features![0].why).toBe('Person 1 said no');
  });
});

describe('the feature list follows the design (fake AI)', () => {
  it('an answer that leaves a feature out, then one that moves it to Copilot: applied at once, logged, graph right', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await saveIdea(s.root, sampleIdea({ stage: 3, challenge: 'Claims are checked by hand.' }));
    expect((await post(`/api/ideas/${ID}/tools`, { features: FEATURES, tool: TOOL })).status).toBe(200);

    await post(`/api/ideas/${ID}/design/step`);
    await post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Leave marking out; just show the flagged list' });
    const r2 = await json(await post(`/api/ideas/${ID}/design/step`));
    expect(r2.featureChanges).toEqual(['Flagged claims review list: out of scope (Left out of the proof of concept)']);
    let st = await readDesign(s.root, ID);
    expect(st.features[1].scope).toMatchObject({ status: 'out', step: 1 });
    expect(r2.designMd).toContain('~~**Flagged claims review list**~~ — out of scope');

    await post(`/api/ideas/${ID}/design/answer`, { n: 2, answer: 'Draft with Copilot and log answers in a SharePoint list' });
    const r3 = await json(await post(`/api/ideas/${ID}/design/step`));
    expect(r3.featureChanges).toEqual(['Claimant query drafting: done with Microsoft Copilot, outside the Dataiku build']);
    st = await readDesign(s.root, ID);
    expect(st.features[2].scope).toMatchObject({ status: 'outside', by: 'Microsoft Copilot', step: 2 });

    const idea = await loadIdea(s.root, ID);
    expect(idea.features).toEqual(['Weekend spend check', 'Claimant query drafting']);
    expect(idea.tools).toEqual({ 'Weekend spend check': 'Dataiku', 'Claimant query drafting': 'Microsoft Copilot' });
    const edges = (await rebuildGraph(s.root)).edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
    expect(edges).not.toContain(`idea:${ID} NEEDS capability:flagged-claims-review-list`);
    expect(edges).not.toContain('capability:claimant-query-drafting BUILT_WITH tool:dataiku');
    expect(edges).toContain('capability:weekend-spend-check BUILT_WITH tool:dataiku');

    const dir = await ideaDir(s.root, ID);
    const approach = await readFile(path.join(dir, 'approach.md'), 'utf8');
    expect(approach).toContain('~~**Flagged claims review list**~~');
    const hist = (await readHistory(dir)).filter((h) => h.action === 'design-feature').map((h) => h.detail);
    expect(hist).toHaveLength(2);
    expect(idea.stage).toBe(3);
  });
});
