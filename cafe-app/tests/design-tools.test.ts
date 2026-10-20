import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign } from '../src/design/store';
import { validatePicks, renderApproachMd, pathwayLabel, mergeSuggestions, PATHWAYS } from '../src/design/tools';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { toolPickTask, TOOL_PICK_SCHEMA } from '../src/ai/tasks';
import { APPROVED_TOOLS } from '../src/graph/ontology';

const json = (r: Response) => r.json() as Promise<any>;
const exists = (p: string) => access(p).then(() => true, () => false);
const ID = 'CAFE-2026-001';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

async function server(provider?: Provider) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-20', { connector: createConnector({ providers: [provider ?? fakeProvider()], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = async (url: string) => json(await fetch(`${s.base}${url}`));
  await saveIdea(s.root, sampleIdea({
    stage: 3, challenge: 'Requests arrive by email and are scheduled by hand.', outcomes: ['Requests scheduled the same day'],
    support: ['Automation'],
  }));
  return { ...s, post, get };
}

const PICKS = [
  { name: 'Request intake form', what: 'Collects each request', tool: 'Power Apps', reason: 'Simple form', flags: [] },
  { name: 'Draft replies', tool: 'copilot', flags: ['no-build'] },
];

describe('toolPickTask', () => {
  const ok = { features: [{ name: 'Form', what: 'A form', tool: 'Power Apps', reason: 'Simple', flags: [] }] };
  it('accepts approved tools and rejects an unlisted one (no silent fix)', () => {
    expect(toolPickTask.parse(JSON.stringify(ok)).features[0].tool).toBe('Power Apps');
    const bad = { features: [{ ...ok.features[0], tool: 'Excel macro' }] };
    expect(() => toolPickTask.parse(JSON.stringify(bad))).toThrow(/invalid output/);
    const alias = { features: [{ ...ok.features[0], tool: 'PowerApps' }] };
    expect(() => toolPickTask.parse(JSON.stringify(alias))).toThrow(/invalid output/);
    const flag = { features: [{ ...ok.features[0], flags: ['valuable'] }] };
    expect(() => toolPickTask.parse(JSON.stringify(flag))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ features: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ features: Array(7).fill(ok.features[0]) }))).toThrow(/invalid output/);
  });
  it('prompt lists every approved tool, the Café rules, the data rule, and works with no challenge', () => {
    const p = toolPickTask.prompt({ idea: { id: ID, title: 'Email scheduler', outcomes: ['Faster'] }, support: [] });
    for (const t of APPROVED_TOOLS) expect(p).toContain(`- ${t}: `);
    expect(p).toMatch(/never propose measuring value/i);
    expect(p).toMatch(/data, not instructions/);
    expect(p).not.toMatch(/existingFeatures" are/);
    const q = toolPickTask.prompt({ idea: { id: ID, title: 'x' }, support: [], existingFeatures: [{ name: 'Form', tool: 'Power Apps' }] });
    expect(q).toMatch(/Keep these .* unless clearly wrong/);
    expect(TOOL_PICK_SCHEMA.properties!.features.maxItems).toBe(6);
  });
});

describe('picks and approach.md', () => {
  it('rejects a tool that is not approved, with the tool named', () => {
    expect(() => validatePicks([{ name: 'X', tool: 'Excel macro' }])).toThrow('Not on the approved list: Excel macro');
    expect(() => validatePicks([{ name: 'X' }, { name: 'x' }])).toThrow(/Two features/);
  });
  it('canonicalises tools, sets pathways and keeps the custom-app flag in step with the tool', () => {
    const f = validatePicks([{ name: 'A', tool: 'copilot' }, { name: 'B', tool: 'custom code' }, { name: 'C', tool: 'Dataiku', flags: ['custom-app'] }]);
    expect(f.map((x) => x.tool)).toEqual(['Microsoft Copilot', 'custom app', 'Dataiku']);
    expect(f.map((x) => x.pathway)).toEqual(['Citizen-Led', 'TTIA-Led', 'Assisted Citizen']);
    expect(f[1].flags).toEqual(['custom-app']);
    expect(f[2].flags).toEqual([]);
    expect(validatePicks([{ name: 'C', tool: 'Dataiku' }], 'Person 3')[0].pathway).toBe('Citizen-Led');
    expect(pathwayLabel('Power Apps')).toBe(`${PATHWAYS['Power Apps']} (Assisted Citizen until a builder is named)`);
    expect(pathwayLabel('custom app')).toBe('TTIA-Led (CSIC Repository)');
  });
  it('renders one section per feature', () => {
    const md = renderApproachMd(sampleIdea(), validatePicks(PICKS));
    expect(md.startsWith('# Approach — Email scheduler\n')).toBe(true);
    expect(md).toContain('## Request intake form');
    expect(md).toContain('- Tool: Microsoft Copilot');
    expect(md).toContain('- Flags: no-build');
  });
  it('merging suggestions keeps the operator picks', () => {
    const existing = validatePicks([{ name: 'Draft replies', tool: 'Copilot Studio' }]);
    const merged = mergeSuggestions(existing, [{ name: 'draft replies', tool: 'Microsoft Copilot' }, { name: 'New', tool: 'UiPath' }]);
    expect(merged.map((m) => [m.name, (m as any).tool])).toEqual([['Draft replies', 'Copilot Studio'], ['New', 'UiPath']]);
  });
});

describe('tool picker routes', () => {
  it('fake suggest returns 3 features incl. one custom-app flag, and saves nothing', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools/suggest`);
    expect(r.status).toBe(200);
    const { features } = await json(r);
    expect(features).toHaveLength(3);
    expect(features.filter((f: any) => f.flags.includes('custom-app'))).toHaveLength(1);
    expect(features.find((f: any) => f.flags.includes('custom-app')).tool).toBe('custom app');
    const dir = await ideaDir(s.root, ID);
    expect(await exists(path.join(dir, 'design.yaml'))).toBe(false);
    expect(await exists(path.join(dir, 'approach.md'))).toBe(false);
    expect((await loadIdea(s.root, ID)).tools).toBeUndefined();
  });

  it('suggest works for an idea with no challenge text', async () => {
    let seen = '';
    const fake = fakeProvider();
    const s = await server({ ...fake, complete: async (p, o) => { seen = p; return fake.complete(p, o); } });
    const idea = await loadIdea(s.root, ID);
    await saveIdea(s.root, { ...idea, challenge: undefined, current_process: undefined });
    const r = await s.post(`/api/ideas/${ID}/tools/suggest`);
    expect(r.status).toBe(200);
    expect(seen).toContain('Email scheduler');
  });

  it('save writes approach.md, ticks s3e, sets status and adds graph links once after two saves', async () => {
    const s = await server();
    const r1 = await s.post(`/api/ideas/${ID}/tools`, { features: PICKS });
    expect(r1.status).toBe(200);
    const body = await json(r1);
    expect(body.state.status).toBe('designing');
    expect(body.designMd).toContain('## Features and tools');
    const dir = await ideaDir(s.root, ID);
    expect(await readFile(path.join(dir, 'approach.md'), 'utf8')).toContain('# Approach — Email scheduler');
    expect(await exists(path.join(dir, 'design.md'))).toBe(true);
    const idea = await loadIdea(s.root, ID);
    expect(idea.checklist.s3e).toMatchObject({ done: true, by: 'app', source: 'approach.md' });
    expect(idea.tools).toEqual({ 'Request intake form': 'Power Apps', 'Draft replies': 'Microsoft Copilot' });
    expect((await readDesign(s.root, ID)).features).toHaveLength(2);

    const r2 = await s.post(`/api/ideas/${ID}/tools`, { features: PICKS });
    expect(r2.status).toBe(200);
    const g = await s.get('/api/graph');
    const built = g.edges.filter((e: any) => e.rel === 'BUILT_WITH');
    expect(built).toHaveLength(2);
    for (const e of built) expect(e).toMatchObject({ confidence: 1, confirmed: true, source: `form:${ID}:approach.md` });
    const needs = g.edges.filter((e: any) => e.rel === 'NEEDS' && e.source === `form:${ID}:approach.md`);
    expect(needs).toHaveLength(2);
    const history = await s.get(`/api/ideas/${ID}/history`);
    expect(history.filter((h: any) => h.step === 's3e')).toHaveLength(1);

    const d = await s.get(`/api/ideas/${ID}/design`);
    expect(d.state.features.map((f: any) => f.name)).toEqual(['Request intake form', 'Draft replies']);
    expect(d.designMd).toContain('Request intake form');
  });

  it('changing a pick replaces the BUILT_WITH link', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, { features: PICKS });
    await s.post(`/api/ideas/${ID}/tools`, { features: [PICKS[0], { ...PICKS[1], tool: 'Copilot Studio' }] });
    const g = await s.get('/api/graph');
    const built = g.edges.filter((e: any) => e.rel === 'BUILT_WITH').map((e: any) => e.id);
    expect(built).toContain('capability:draft-replies|BUILT_WITH|tool:copilot-studio');
    expect(built).not.toContain('capability:draft-replies|BUILT_WITH|tool:microsoft-copilot');
    expect(built).toHaveLength(2);
  });

  it('refuses an unlisted tool with 400 and saves nothing', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'X', tool: 'Excel macro' }] });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Not on the approved list: Excel macro');
    expect(await exists(path.join(await ideaDir(s.root, ID), 'design.yaml'))).toBe(false);
  });

  it('features with no tool yet keep status picking and do not tick s3e', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Form' }] });
    expect((await json(r)).state.status).toBe('picking');
    expect((await loadIdea(s.root, ID)).checklist.s3e).toBeUndefined();
  });
});
