import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, writeDesign, emptyDesign, renderDesignMd, type DesignState } from '../src/design/store';
import { pathwayOf, withReuse, REUSE_NOT_NAMED } from '../src/design/choice';
import { validateFeatures, validateChoice, suggestFeatures, renderApproachMd } from '../src/design/tools';
import { designStepInput } from '../src/design/brainstorm';
import { kitFiles } from '../src/design/kits';
import { featureListTask, toolPickTask, designStepTask, FEATURE_LIST_SCHEMA, type DesignPlanOutput } from '../src/ai/tasks';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';

const ID = 'CAFE-2026-001';
const SHEET = "the team's rules spreadsheet";
const PLAN: DesignPlanOutput = { tasks: [{ title: 'Build it', detail: 'd', tool: 'Dataiku', done_when: 'done' }], risks: [] };
const tool = (extra: object = {}) => ({
  tool: 'Dataiku', pathway: pathwayOf('Dataiku'), by: 'operator' as const, reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '2026-10-20', ...extra,
});
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

describe('the reuse flag says what it reuses', () => {
  it('a flag with nothing named is dropped; a name without the flag is dropped; the name is one line of at most 80', () => {
    expect(withReuse(['reuse-existing'], '')).toEqual({ flags: [] });
    expect(withReuse(['personal-data'], SHEET)).toEqual({ flags: ['personal-data'] });
    const [a, b, c] = validateFeatures([
      { name: 'Weekend check', flags: ['reuse-existing'] },
      { name: 'Duplicate check', flags: ['reuse-existing', 'personal-data'], reuses: "EKG Expenses'\nduplicate check" },
      { name: 'Report', flags: [], reuses: 'Something' },
    ]);
    expect(a.flags).toEqual([]);
    expect(a.reuses).toBeUndefined();
    expect(b).toMatchObject({ flags: ['reuse-existing', 'personal-data'], reuses: "EKG Expenses' duplicate check" });
    expect(c.reuses).toBeUndefined();
    expect(validateFeatures([{ name: 'X', flags: ['reuse-existing'], reuses: 'y'.repeat(200) }])[0].reuses).toHaveLength(80);
  });

  it('the tool choice: the same rule', () => {
    expect(validateChoice({ tool: 'Dataiku', flags: ['reuse-existing'] }, [], undefined, '2026-10-20').flags).toEqual([]);
    const t = validateChoice({ tool: 'Dataiku', flags: ['reuse-existing'], reuses: SHEET }, [], undefined, '2026-10-20');
    expect(t).toMatchObject({ flags: ['reuse-existing'], reuses: SHEET });
  });

  it('the prompts: name it in "reuses" or leave the flag off, and never on a feature that still has to be built', () => {
    const p = featureListTask.prompt({ idea: { id: ID, title: 'T' }, support: [] });
    expect(p).toMatch(/"reuse-existing" only when something that already exists .* already does THIS feature or part of it/);
    expect(p).toMatch(/name the existing thing in "reuses" \(at most 80 characters/);
    expect(p).toMatch(/Never put it on a feature that still has to be built/);
    expect(p).not.toMatch(/"reuse-existing" when something that already exists could do it/);
    expect((FEATURE_LIST_SCHEMA as any).properties.features.items.properties.reuses).toEqual({ type: 'string', maxLength: 80 });
    const out = featureListTask.parse(JSON.stringify({ features: [{ name: 'Dup', what: 'x', flags: ['reuse-existing'], reuses: `the\n${'z'.repeat(100)}` }] }));
    expect(out.features[0].reuses).toHaveLength(80);
    const t = toolPickTask.prompt({ idea: { id: ID, title: 'T' }, support: [], features: [{ name: 'Dup', reuses: SHEET }] });
    expect(t).toMatch(/"reuse-existing" \(on the pick\) only when something that already exists/);
    expect(t).toContain(`"reuses": "${SHEET}"`);
    expect(t).toMatch(/is done \(wholly or in part\) by that existing thing/);
    expect(t).not.toMatch(/"reuse-existing" when something that already exists could do it/);
  });

  it('suggestFeatures drops the flag the AI gave without a name and keeps the named one', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 3 }));
    const { features } = await suggestFeatures(root, ID, [], async () => ({ provider: 'fake', output: { features: [
      { name: 'Weekend spend anomaly check', what: 'Flags weekend spend', flags: ['reuse-existing'] },
      { name: 'Duplicate check', what: 'Finds duplicates', flags: ['reuse-existing'], reuses: "EKG Expenses' duplicate check" },
    ] } }));
    expect(features[0]).toMatchObject({ name: 'Weekend spend anomaly check', flags: [] });
    expect((features[0] as any).reuses).toBeUndefined();
    expect(features[1]).toMatchObject({ flags: ['reuse-existing'], reuses: "EKG Expenses' duplicate check" });
  });

  it('passed on: into the design questions and the kit README ("Start from …")', () => {
    const state: DesignState = {
      ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Shows it.', tool: tool(),
      features: [{ id: 'dup', name: 'Duplicate check', what: 'Finds duplicates', flags: ['reuse-existing'], reuses: SHEET }, { id: 'w', name: 'Weekend check', flags: [] }],
    };
    const input = designStepInput(sampleIdea({ stage: 3 }), state);
    expect(input.features[0]).toMatchObject({ name: 'Duplicate check', reuses: SHEET });
    expect(input.features[1].reuses).toBeUndefined();
    expect(designStepTask.prompt(input)).toMatch(/A feature with "reuses" is done, wholly or in part, by that existing thing: ask how the proof of concept uses it/);
    const readme = kitFiles(sampleIdea({ stage: 3 }), state, PLAN)['kit/dataiku/README.md'];
    expect(readme).toContain('## Start from what exists');
    expect(readme).toContain(`- Start from ${SHEET} for **Duplicate check**`);
    expect(readme).not.toMatch(/Start from .* for \*\*Weekend check\*\*/);
    expect(renderDesignMd(sampleIdea(), state)).toContain(`[reuses ${SHEET}]`);
  });

  it('an older record with the bare flag: read and shown as not named, kept on save (no reopened approval), cleared by suggesting again', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await saveIdea(s.root, sampleIdea({ stage: 3 }));
    const old = { id: 'weekend-check', name: 'Weekend check', flags: ['reuse-existing'] };
    await writeDesign(s.root, ID, { ...emptyDesign(), status: 'approved', approvedAt: '2026-10-19', summary: 'Shows it.', tool: tool(), features: [old] });
    const st = await readDesign(s.root, ID);
    expect(st.features[0]).toEqual(old);
    expect(renderDesignMd(await loadIdea(s.root, ID), st)).toContain(`[${REUSE_NOT_NAMED.toLowerCase()}]`);
    expect(renderApproachMd(await loadIdea(s.root, ID), st)).toContain(REUSE_NOT_NAMED.toLowerCase());
    // Saved again as it is: the flag stays and the approval with it.
    const r = await post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Weekend check', flags: ['reuse-existing'] }], tool: tool() });
    expect(r.status).toBe(200);
    const after = await readDesign(s.root, ID);
    expect(after.features[0].flags).toEqual(['reuse-existing']);
    expect(after.approvedAt).toBe('2026-10-19');
    // A new feature sent with a bare flag loses it.
    const r2 = await post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Weekend check', flags: ['reuse-existing'] }, { name: 'New one', flags: ['reuse-existing'] }], tool: tool() });
    expect((await r2.json() as any).state.features[1].flags).toEqual([]);
    // Suggesting again sends the saved list without the unnamed flag.
    const sug = await post(`/api/ideas/${ID}/tools/features/suggest`, {});
    const body = await sug.json() as any;
    expect(body.features.find((f: any) => f.name === 'Weekend check').flags).toEqual([]);
    expect(await readFile(path.join(await ideaDir(s.root, ID), 'approach.md'), 'utf8')).toBeTruthy();
  });
});
