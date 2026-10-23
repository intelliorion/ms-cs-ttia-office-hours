import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, renderDesignMd } from '../src/design/store';
import { renderApproachMd } from '../src/design/tools';
import { writeYaml } from '../src/workspace/files';
import { rebuildGraph } from '../src/graph/store';
import { APPROVED_TOOLS, canonicalTool, noLongerApproved, retiredToolNote } from '../src/graph/ontology';
import { TOOL_GUIDE } from '../src/ai/tasks';
import { kitFiles } from '../src/design/kits';

const ID = 'CAFE-2026-001';
const json = (r: Response) => r.json() as Promise<any>;
const NOTE = 'UiPath is no longer on the approved list: pick another tool';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; });

async function server() {
  const s = await startServer('2026-10-20');
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ...s, post };
}

describe('UiPath is off the approved list', () => {
  it('is gone from the list, the aliases and the tool guide', () => {
    expect(APPROVED_TOOLS).not.toContain('UiPath');
    expect(canonicalTool('UiPath')).toBeUndefined();
    expect(canonicalTool('ui path')).toBeUndefined();
    expect(Object.keys(TOOL_GUIDE)).not.toContain('UiPath');
    expect(noLongerApproved('UiPath')).toBe(NOTE);
    expect(retiredToolNote('UiPath')).toBe(NOTE);
    expect(retiredToolNote('Dataiku')).toBeUndefined();
    expect(retiredToolNote(undefined)).toBeUndefined();
  });

  it('an older record that chose UiPath loads as it is, says it is no longer approved, and needs a new pick', async () => {
    const s = await server();
    const idea = sampleIdea({ stage: 3, features: ['Copy the forms'], tools: { 'Copy the forms': 'UiPath' } } as any);
    await saveIdea(s.root, idea);
    const dir = await ideaDir(s.root, ID);
    await writeYaml(path.join(dir, 'design.yaml'), {
      version: 1, status: 'approved', approvedAt: '2026-10-01', summary: 'Copies the forms.',
      features: [{ id: 'copy', name: 'Copy the forms', flags: [] }],
      tool: { tool: 'UiPath', pathway: 'Citizen-Led', by: 'operator', reason: 'Clicks', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: ['Copy the forms'], at: '2026-10-01' },
      steps: [],
    });
    // Loaded as it was: never swapped for another tool.
    const state = await readDesign(s.root, ID);
    expect(state.tool?.tool).toBe('UiPath');
    expect(renderDesignMd(idea, state)).toContain(`**${NOTE}.**`);
    expect(renderApproachMd(idea, state)).toContain(`- Note: ${NOTE}.`);
    // No kit for it, and neither the approval nor the plan goes ahead until a new tool is picked.
    expect(kitFiles(idea, state, { tasks: [], risks: [] })).toEqual({});
    const a = await s.post(`/api/ideas/${ID}/design/approve`);
    expect(a.status).toBe(400);
    expect((await json(a)).error).toBe(NOTE);
    const p = await s.post(`/api/ideas/${ID}/plan`);
    expect(p.status).toBe(400);
    expect((await json(p)).error).toBe(NOTE);
    // Saving it again is refused: the picker needs an approved tool.
    const save = await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Copy the forms' }], tool: { tool: 'UiPath', by: 'operator' } });
    expect(save.status).toBe(400);
    expect((await json(save)).error).toBe('Not on the approved list: UiPath');
    expect((await readDesign(s.root, ID)).tool?.tool).toBe('UiPath');
    // The graph keeps the Tool star, marked as not on the approved list.
    const g = await rebuildGraph(s.root);
    expect(g.nodes.some((n) => n.id === 'tool:uipath' && n.label === 'UiPath')).toBe(true);
    const e = g.edges.find((x) => x.rel === 'BUILT_WITH' && x.to === 'tool:uipath');
    expect(e?.description).toBe('Tool pick — not on the approved list');
    expect((await loadIdea(s.root, ID)).tools).toEqual({ 'Copy the forms': 'UiPath' });
  });

  it('an older record with a tool on each feature (UiPath) loads with UiPath as its one tool, still not swapped', async () => {
    const s = await server();
    await saveIdea(s.root, sampleIdea({ stage: 3 }));
    await writeYaml(path.join(await ideaDir(s.root, ID), 'design.yaml'), {
      version: 1, status: 'designing', steps: [],
      features: [{ id: 'a', name: 'A', tool: 'UiPath', flags: [] }, { id: 'b', name: 'B', tool: 'UiPath', flags: [] }],
    });
    const state = await readDesign(s.root, ID);
    expect(state.tool?.tool).toBe('UiPath');
    expect(state.features.map((f) => f.name)).toEqual(['A', 'B']);
  });
});
