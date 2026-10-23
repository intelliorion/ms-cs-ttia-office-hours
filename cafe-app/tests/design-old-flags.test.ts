import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, emptyDesign, renderDesignMd, type DesignState } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { validateFeatures, validateChoice, suggestFeatures, renderApproachMd, toolPickInput } from '../src/design/tools';
import { designStepInput } from '../src/design/brainstorm';
import { kitFiles } from '../src/design/kits';
import { featureListTask, toolPickTask, designStepTask, FEATURE_LIST_SCHEMA, FEATURE_FLAGS, FEATURE_ONLY_FLAGS, type DesignPlanOutput } from '../src/ai/tasks';
import { writeYaml } from '../src/workspace/files';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';

// The feature tag for what an existing thing already does was removed. Its flag and the name that came with it are
// spelled out here only because older records still carry them.
const OLD_FLAG = 'reuse-existing';
const OLD_FIELD = 'reuses';
const ID = 'CAFE-2026-001';
const PLAN: DesignPlanOutput = { tasks: [{ title: 'Build it', detail: 'd', tool: 'Dataiku', done_when: 'done' }], risks: [] };
const tool = (extra: object = {}) => ({
  tool: 'Dataiku', pathway: pathwayOf('Dataiku'), by: 'operator' as const, reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '2026-10-20', ...extra,
});
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

describe('the old reuse tag is gone', () => {
  it('no flag, no field, no prompt line for it', () => {
    expect(FEATURE_FLAGS as readonly string[]).not.toContain(OLD_FLAG);
    expect(FEATURE_ONLY_FLAGS as readonly string[]).not.toContain(OLD_FLAG);
    expect((FEATURE_LIST_SCHEMA as any).properties.features.items.properties[OLD_FIELD]).toBeUndefined();
    const p = featureListTask.prompt({ idea: { id: ID, title: 'T' }, support: [] });
    const t = toolPickTask.prompt({ idea: { id: ID, title: 'T' }, support: [], features: [{ name: 'Dup', [OLD_FIELD]: 'x' } as any] });
    for (const text of [p, t]) { expect(text).not.toContain(OLD_FLAG); expect(text).not.toContain(`"${OLD_FIELD}"`); }
  });

  it('sent rows and choices lose the flag and the field', () => {
    const [f] = validateFeatures([{ name: 'Dup', flags: [OLD_FLAG, 'personal-data'], [OLD_FIELD]: 'the sheet' } as any]);
    expect(f).toEqual({ id: 'dup', name: 'Dup', flags: ['personal-data'] });
    const c = validateChoice({ tool: 'Dataiku', flags: [OLD_FLAG], [OLD_FIELD]: 'the sheet' } as any, [], undefined, '2026-10-20');
    expect(c.flags).toEqual([]);
    expect(c).not.toHaveProperty(OLD_FIELD);
  });

  it('suggestFeatures drops the flag if an AI still gives it', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 3 }));
    const { features } = await suggestFeatures(root, ID, [], async () => ({ provider: 'fake', output: { features: [
      { name: 'Duplicate check', what: 'Finds duplicates', flags: [OLD_FLAG, 'personal-data'], [OLD_FIELD]: 'the sheet' } as any,
    ] } }));
    expect(features[0]).toEqual({ name: 'Duplicate check', what: 'Finds duplicates', flags: ['personal-data'] });
  });
});

describe('an older record with the old tag', () => {
  const oldDesign = {
    ...emptyDesign(), status: 'approved', approvedAt: '2026-10-19', summary: 'Shows it.',
    tool: tool({ flags: [OLD_FLAG], [OLD_FIELD]: 'the sheet' }),
    features: [
      { id: 'dup', name: 'Duplicate check', what: 'Finds duplicates', flags: [OLD_FLAG, 'personal-data'], [OLD_FIELD]: 'the check' },
      { id: 'weekend-check', name: 'Weekend check', flags: [OLD_FLAG] },
    ],
  };

  it('loads without error, the flag and the field dropped, and nothing downstream mentions them', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 3 }));
    await writeYaml(path.join(await ideaDir(root, ID), 'design.yaml'), oldDesign);
    const st: DesignState = await readDesign(root, ID);
    expect(st.features).toEqual([
      { id: 'dup', name: 'Duplicate check', what: 'Finds duplicates', flags: ['personal-data'] },
      { id: 'weekend-check', name: 'Weekend check', flags: [] },
    ]);
    expect(st.tool?.flags).toEqual([]);
    expect(st.tool).not.toHaveProperty(OLD_FIELD);
    const idea = await loadIdea(root, ID);
    const texts = [
      renderDesignMd(idea, st), renderApproachMd(idea, st),
      JSON.stringify(toolPickInput(idea, st)), JSON.stringify(designStepInput(idea, st)),
      designStepTask.prompt(designStepInput(idea, st)),
      ...Object.values(kitFiles(idea, { ...st, tool: { ...st.tool!, fit: [] } }, PLAN)),
    ];
    for (const text of texts) { expect(text).not.toContain(OLD_FLAG); expect(text).not.toMatch(/Reuses|Start from what exists/); }
  });

  it('saved again as it is: the approval stays (nothing changed but the dropped tag)', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    await saveIdea(s.root, sampleIdea({ stage: 3 }));
    await writeYaml(path.join(await ideaDir(s.root, ID), 'design.yaml'), oldDesign);
    const r = await fetch(`${s.base}/api/ideas/${ID}/tools`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: oldDesign.features, tool: oldDesign.tool }),
    });
    expect(r.status).toBe(200);
    const after = await readDesign(s.root, ID);
    expect(after.approvedAt).toBe('2026-10-19');
    expect(after.features.map((f) => f.flags)).toEqual([['personal-data'], []]);
    expect(JSON.stringify(after)).not.toContain(OLD_FLAG);
  });
});
