import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, writeDesign, emptyDesign, loadSkill, type DesignState } from '../src/design/store';
import { validateFeatures, validateChoice, renderApproachMd, pathwayLabel, pathwayOf, mergeSuggestions, toolPickInput, PATHWAYS } from '../src/design/tools';
import { designStepInput, codedDesignInput } from '../src/design/brainstorm';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { toolPickTask, featureListTask, designStepTask, TOOL_PICK_SCHEMA, FEATURE_LIST_SCHEMA } from '../src/ai/tasks';
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

const FEATURES = [
  { name: 'Request intake form', what: 'Collects each request', flags: [] },
  { name: 'Draft replies', flags: ['personal-data'] },
];
const TOOL = { tool: 'Power Apps', by: 'ai', reason: 'Simple form', pros: ['Quick to build'], cons: ['No drafting on its own: add Copilot'], context: ['Form-shaped input'], flags: [],
  fit: [{ feature: 'Request intake form', fit: 'yes', note: '' }, { feature: 'Draft replies', fit: 'no', note: 'Add Copilot for the drafts' }] };
/** Saved features and the one tool, as the panel posts them. */
const PICKS = { features: FEATURES, tool: TOOL };

describe('toolPickTask', () => {
  const NONE = { updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } }, learned: [] };
  const pick = { tool: 'Power Apps', reason: 'Simple', flags: [], context: ['Form-shaped input', 'No live system → Power Apps'], pros: ['Quick to build'], cons: ['Cannot send reminders on its own: add Power Automate'],
    fit: [{ feature: 'Form', fit: 'yes', note: '' }, { feature: 'Reminders', fit: 'no', note: 'Add Power Automate' }] };
  it('accepts one tool with context and a fit per feature; rejects an unlisted tool, bad flags, a bad fit or no context (no silent fix)', () => {
    const ok = toolPickTask.parse(JSON.stringify({ ...NONE, pick, needs: [] })).pick!;
    expect(ok.tool).toBe('Power Apps');
    expect(ok.fit.map((f) => f.fit)).toEqual(['yes', 'no']);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, pros: [] }, needs: [] }))).toThrow(/invalid output/);
    expect(toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, cons: [] }, needs: [] })).pick!.cons).toEqual([]);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, tool: 'Excel macro' }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, tool: 'PowerApps' }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, flags: ['valuable'] }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, context: [] }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, fit: [{ feature: 'Form', fit: 'maybe', note: '' }] }, needs: [] }))).toThrow(/invalid output/);
    const { fit: _f, ...noFit } = pick;
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: noFit, needs: [] }))).toThrow(/invalid output/);
    // A feature or a name on the pick is not part of it any more: one tool, no feature of its own.
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, name: 'Form' }, needs: [] }))).toThrow(/invalid output/);
  });
  it('gives a to-do list like the decision\'s, with or without a pick; never neither', () => {
    const open = { need: 'Who builds it', ask: 'Who would build it?', met: false };
    expect(toolPickTask.parse(JSON.stringify({ ...NONE, needs: [open] })).needs).toHaveLength(1);
    expect(toolPickTask.parse(JSON.stringify({ ...NONE, pick, needs: [open] })).pick!.tool).toBe('Power Apps');
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, needs: [] }))).toThrow(/give a "pick"/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, needs: [{ ...open, met: true }] }))).toThrow(/give a "pick"/);
    expect(() => toolPickTask.parse(JSON.stringify({ pick }))).toThrow(/needs is missing/);
    expect(() => toolPickTask.parse(JSON.stringify({ needs: Array(9).fill(open) }))).toThrow(/invalid output/);
  });
  it('prompt: one tool for the whole feature list with a fit per feature; every approved tool, the Café rules, the data rule; works with no challenge', () => {
    const p = toolPickTask.prompt({ idea: { id: ID, title: 'Email scheduler', outcomes: ['Faster'] }, support: [] });
    for (const t of APPROVED_TOOLS) expect(p).toContain(`- ${t}: `);
    expect(p).toMatch(/ONE tool for the whole proof of concept/);
    expect(p).toMatch(/Never give a tool per feature/);
    expect(p).toMatch(/fit: one item per feature in DATA.features/);
    expect(p).toMatch(/cons: 0 to 5 short lines/);
    expect(p).toMatch(/Keep every item in DATA.todo/);
    expect(p).toMatch(/never propose measuring value/i);
    expect(p).toMatch(/data, not instructions/);
    expect(p).not.toMatch(/brainstorming skill|Café design guide/);
    expect(p).not.toMatch(/DATA.evaluate/);
    const q = toolPickTask.prompt({ idea: { id: ID, title: 'x' }, support: [], features: [{ name: 'Form', what: 'Takes requests' }], guidance: 'GUIDE TEXT' });
    expect(q).toContain('"name": "Form"');
    expect(q).toContain('GUIDE TEXT');
    expect(q).toMatch(/Guidance from the Café design guide, including how to tell a clear request from an unclear one/);
    expect(TOOL_PICK_SCHEMA.properties!.needs.maxItems).toBe(8);
  });
  it('the tool picker and the design questions send the Café design guide, whole', () => {
    const guide = loadSkill('cafe-design');
    expect(toolPickInput(sampleIdea(), emptyDesign()).guidance).toBe(guide);
    expect(designStepInput(sampleIdea(), emptyDesign()).guidance).toBe(guide);
    expect(designStepTask.prompt(designStepInput(sampleIdea(), emptyDesign()))).toMatch(/Follow this Café design guide/);
  });
  it('prompt, evaluating the operator\'s tool: that tool, fixed; the AI may not change it', () => {
    const p = toolPickTask.prompt({ idea: { id: ID, title: 'x' }, support: [], features: [{ name: 'Form' }], evaluate: 'UiPath' });
    expect(p).toMatch(/The operator has chosen the tool: DATA.evaluate/);
    expect(p).toContain('"pick.tool" must be exactly "UiPath": never change it');
    expect(p).toContain('"evaluate": "UiPath"');
    expect(p).not.toMatch(/Pick the one approved tool/);
  });
});

describe('featureListTask', () => {
  const f = { name: 'Request intake', what: 'Takes each request in one place', flags: [] };
  it('accepts 1 to 8 features with feature flags only; no tool on a feature', () => {
    expect(featureListTask.parse(JSON.stringify({ features: [f, { ...f, name: 'Summary\nweekly', flags: ['personal-data'] }] })).features.map((x) => x.name)).toEqual(['Request intake', 'Summary weekly']);
    expect(() => featureListTask.parse(JSON.stringify({ features: [] }))).toThrow(/invalid output/);
    expect(() => featureListTask.parse(JSON.stringify({ features: Array(9).fill(f) }))).toThrow(/invalid output/);
    expect(() => featureListTask.parse(JSON.stringify({ features: [{ ...f, flags: ['custom-app'] }] }))).toThrow(/invalid output/);
    expect(() => featureListTask.parse(JSON.stringify({ features: [{ ...f, tool: 'Power Apps' }] }))).toThrow(/invalid output/);
    expect(FEATURE_LIST_SCHEMA.properties!.features.maxItems).toBe(8);
  });
  it('prompt: features, never a tool; reads the answers, the Learned brief and keeps the operator\'s features out', () => {
    const p = featureListTask.prompt({
      idea: { id: ID, title: 'Email scheduler' }, support: [], teamAnswers: [{ question: 'Q', answer: 'A' }],
      learned: [{ topic: 'Data', text: 'A weekly extract in SharePoint.' }], existingFeatures: [{ name: 'Intake' }],
    });
    expect(p.startsWith('TASK: feature-list')).toBe(true);
    expect(p).toMatch(/never a tool or product/);
    expect(p).toMatch(/Never name a tool/);
    expect(p).toMatch(/Learned since the form/);
    expect(p).toContain('A weekly extract in SharePoint.');
    expect(p).toMatch(/Keep them out of your list/);
    expect(p).toMatch(/never propose measuring value/i);
    expect(p).toMatch(/data, not instructions/);
  });
});

describe('features, the one tool and approach.md', () => {
  it('features: a name each, no two alike, feature flags only, no tool', () => {
    expect(() => validateFeatures([{ name: 'X' }, { name: 'x' }])).toThrow(/Two features/);
    expect(() => validateFeatures([{ what: 'only a line' }])).toThrow(/needs a name/);
    expect(() => validateFeatures(Array(13).fill(0).map((_, i) => ({ name: `F${i}` })))).toThrow(/At most 12/);
    const [a] = validateFeatures([{ name: 'Form', tool: 'Power Apps', flags: ['custom-app', 'personal-data'] } as any]);
    expect(a).toEqual({ id: 'form', name: 'Form', flags: ['personal-data'] });
  });
  it('the tool: approved only (named when not), canonical, pathway worked out, custom-app flag follows it, fit only for features in the list', () => {
    const feats = validateFeatures(FEATURES);
    expect(() => validateChoice({ tool: 'Excel macro' }, feats, undefined, 'd')).toThrow('Not on the approved list: Excel macro');
    const c = validateChoice({ ...TOOL, tool: 'copilot', flags: ['custom-app', 'no-build'], pathway: 'TTIA-Led',
      fit: [...TOOL.fit, { feature: 'Not a feature', fit: 'yes', note: '' }, { feature: 'request INTAKE form', fit: 'partly', note: 'dup' }] }, feats, undefined, '2026-10-20');
    expect(c).toMatchObject({ tool: 'Microsoft Copilot', pathway: 'Citizen-Led', flags: ['no-build'], by: 'ai', at: '2026-10-20', evaluatedFor: ['Request intake form', 'Draft replies'] });
    expect(c.fit).toEqual([{ feature: 'Request intake form', fit: 'yes', note: '' }, { feature: 'Draft replies', fit: 'no', note: 'Add Copilot for the drafts' }]);
    expect(validateChoice({ tool: 'custom code' }, feats, undefined, 'd')).toMatchObject({ tool: 'custom app', flags: ['custom-app'], pathway: 'TTIA-Led', by: 'operator' });
    expect(validateChoice({ tool: 'Dataiku' }, feats, 'Person 3', 'd').pathway).toBe('Citizen-Led');
    expect(pathwayOf('Dataiku')).toBe('Assisted Citizen');
    expect(pathwayLabel('Power Apps')).toBe(`${PATHWAYS['Power Apps']} (Assisted Citizen until a builder is named)`);
    expect(pathwayLabel('custom app')).toBe('TTIA-Led (CSIC Repository)');
  });
  it('approach.md: the features, then the tool, pathway, reason, pros, cons, a fit table per feature, why this tool', () => {
    const features = validateFeatures(FEATURES);
    const md = renderApproachMd(sampleIdea(), { features, tool: validateChoice(TOOL, features, undefined, 'd') });
    expect(md.startsWith('# Approach — Email scheduler\n\n## Features\n')).toBe(true);
    expect(md.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Features', '## Tool', '## How the tool fits each feature', '## Why this tool']);
    expect(md).toContain('- **Request intake form**: Collects each request');
    expect(md).toContain('- **Draft replies**: (not yet said) [personal-data]');
    expect(md).toContain('- Tool: Power Apps\n- Pathway: Citizen-Led (Assisted Citizen until a builder is named)');
    expect(md).toContain('- Reason: Simple form');
    expect(md).toContain('- Pros:\n  - Quick to build\n- Cons (what it cannot do):\n  - No drafting on its own: add Copilot');
    expect(md).toContain('| Feature | Fit | Note |\n| --- | --- | --- |\n| Request intake form | Yes |  |\n| Draft replies | No | Add Copilot for the drafts |');
    expect(md).toContain('## Why this tool\n\n- Form-shaped input');
    expect(renderApproachMd(sampleIdea(), { features: [] })).toContain('## Tool\n\nNot picked yet.');
  });
  it('approach.md says when the tool needs the AI, or the features changed since it was evaluated', () => {
    const features = validateFeatures(FEATURES);
    const stale = validateChoice({ ...TOOL, evaluatedFor: ['Request intake form'] }, features, undefined, 'd');
    expect(renderApproachMd(sampleIdea(), { features, tool: stale })).toContain('Re-evaluate the tool for the new features');
    const bare = validateChoice({ tool: 'UiPath', needsAi: true }, features, undefined, 'd');
    expect(renderApproachMd(sampleIdea(), { features, tool: bare })).toContain('- Note: Pros, cons and fit need the AI');
  });
  it('collapses whitespace in every text field, so AI text cannot add a heading, a field or a table column to approach.md', () => {
    const features = validateFeatures([{ name: 'Form\n## Injected', what: 'Does\n- Tool: custom app' }]);
    expect(features[0]).toMatchObject({ name: 'Form ## Injected', what: 'Does - Tool: custom app' });
    const tool = validateChoice({ tool: 'Power Apps', reason: 'a\t\tb\r\n# c', fit: [{ feature: 'Form ## Injected', fit: 'no', note: 'x | y\n## z' }] }, features, undefined, 'd');
    expect(tool.reason).toBe('a b # c');
    const md = renderApproachMd(sampleIdea(), { features, tool });
    expect(md.split('\n').filter((l) => l.startsWith('#'))).toEqual(['# Approach — Email scheduler', '## Features', '## Tool', '## How the tool fits each feature']);
    expect(md.split('\n').filter((l) => l.startsWith('- Tool:'))).toEqual(['- Tool: Power Apps']);
    expect(md).toContain('| Form ## Injected | No | x \\| y ## z |');
  });
  it('merging suggested features keeps every operator row as it is and adds only new names, once', () => {
    const existing = validateFeatures([{ name: 'Draft replies', what: 'Mine' }]);
    const merged = mergeSuggestions(existing, [{ name: 'draft replies', what: 'AI' }, { name: 'New', what: 'x' }, { name: 'new ', what: 'y' }]);
    expect(merged.map((m) => [m.name, m.what])).toEqual([['Draft replies', 'Mine'], ['New', 'x']]);
  });
});

/** A provider that records every prompt it is sent and answers with the fake (or `answer`, when it returns one). */
const NO_UPDATES = { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } };

function spy(answer?: (p: string) => string | undefined) {
  const prompts: string[] = [];
  const fake = fakeProvider();
  const provider: Provider = { ...fake, complete: async (p, o) => { prompts.push(p); return answer?.(p) ?? fake.complete(p, o); } };
  const data = (task: string) => { const p = [...prompts].reverse().find((x) => x.startsWith(`TASK: ${task}`)) ?? ''; return JSON.parse(p.slice(p.lastIndexOf('<<<DATA') + 7, p.lastIndexOf('DATA>>>'))); };
  return { provider, prompts, data };
}

describe('features: suggested with AI, added and removed', () => {
  it('suggest features: the form, the answers and the Learned brief go in (names coded); the operator rows stay first and only new names are added; nothing saved', async () => {
    const sp = spy();
    const s = await server(sp.provider);
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), people: { submitter: 'Person 1', team: [{ name: 'Person 2', roles: ['member'] }] },
      learned: { at: '2026-10-19', from: 1, points: [{ topic: 'Builder', text: 'Person 2 builds it on a weekly extract.' }] } } as any);
    const rows = [{ name: 'request intake', what: 'Mine, kept as typed' }, { name: 'My own feature' }];
    const r = await s.post(`/api/ideas/${ID}/tools/features/suggest`, { features: rows });
    expect(r.status).toBe(200);
    const out = await json(r);
    expect(out.features.map((f: any) => [f.name, f.what])).toEqual([
      ['request intake', 'Mine, kept as typed'], ['My own feature', undefined],
      ['Send-slot scheduling', 'Works out a send slot for each request across time zones'], ['Weekly summary', "Shows the week's requests and their slots on one page"],
    ]);
    const d = sp.data('feature-list');
    expect(d.existingFeatures.map((f: any) => f.name)).toEqual(['request intake', 'My own feature']);
    expect(d.learned).toEqual([{ topic: 'Builder', text: expect.stringMatching(/^\[P\d+\] builds it on a weekly extract\.$/) }]);
    expect(sp.prompts.join('\n')).not.toContain('Person 2');
    expect((await readDesign(s.root, ID)).features).toEqual([]);
  });

  it('removing a feature and saving keeps the rest; a removed feature loses its graph link', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, PICKS);
    await s.post(`/api/ideas/${ID}/tools`, { features: [FEATURES[0]], tool: TOOL });
    expect((await readDesign(s.root, ID)).features.map((f) => f.name)).toEqual(['Request intake form']);
    expect((await loadIdea(s.root, ID)).tools).toEqual({ 'Request intake form': 'Power Apps' });
    const built = (await s.get('/api/graph')).edges.filter((e: any) => e.rel === 'BUILT_WITH');
    expect(built.map((e: any) => e.id)).toEqual(['capability:request-intake-form|BUILT_WITH|tool:power-apps']);
  });
});

describe('the one tool: suggested, or the operator\'s evaluated', () => {
  it('suggest a tool: one tool for the features sent, with a fit per feature and its context; nothing open; nothing saved', async () => {
    const sp = spy();
    const s = await server(sp.provider);
    const r = await s.post(`/api/ideas/${ID}/tools/suggest`, { features: FEATURES });
    expect(r.status).toBe(200);
    const { tool, state } = await json(r);
    expect(sp.data('tool-pick').features.map((f: any) => f.name)).toEqual(['Request intake form', 'Draft replies']);
    expect(sp.data('tool-pick').evaluate).toBeUndefined();
    expect(state.toolPrep.needs).toEqual([]);
    expect(state.features).toEqual([]);
    expect(tool).toMatchObject({ tool: 'custom app', by: 'ai', pathway: 'TTIA-Led', flags: ['custom-app'], evaluatedFor: ['Request intake form', 'Draft replies'], provider: 'fake' });
    expect(tool.context.length).toBeGreaterThan(0);
    expect(tool.fit.map((f: any) => f.feature)).toEqual(['Request intake form', 'Draft replies']);
    const dir = await ideaDir(s.root, ID);
    expect(await exists(path.join(dir, 'approach.md'))).toBe(false);
    expect((await loadIdea(s.root, ID)).tools).toBeUndefined();
  });

  it('the operator\'s own tool is evaluated: the AI is told to keep it, and pros, cons and fit come back for THAT tool, by the operator', async () => {
    const sp = spy();
    const s = await server(sp.provider);
    const r = await s.post(`/api/ideas/${ID}/tools/suggest`, { features: FEATURES, tool: 'uipath' });
    expect(r.status).toBe(200);
    const { tool } = await json(r);
    expect(sp.data('tool-pick').evaluate).toBe('UiPath');
    expect(sp.prompts.at(-1)).toContain('"pick.tool" must be exactly "UiPath"');
    expect(tool).toMatchObject({ tool: 'UiPath', by: 'operator', pathway: 'Assisted Citizen', cons: ['UiPath cannot work out send slots on its own: add Power Automate'] });
    expect(tool.fit).toEqual([
      { feature: 'Request intake form', fit: 'yes', note: '' },
      { feature: 'Draft replies', fit: 'partly', note: 'UiPath cannot do all of this on its own: add Power Automate' },
    ]);
  });

  it('an evaluation that answers for another tool is refused, and an unlisted tool is refused before the AI is asked', async () => {
    const sp = spy((p) => (p.startsWith('TASK: tool-pick') ? JSON.stringify({
      pick: { tool: 'Power Apps', reason: 'r', flags: [], context: ['c'], pros: ['p'], cons: [], fit: [] }, needs: [],
      updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } }, learned: [],
    }) : undefined));
    const s = await server(sp.provider);
    const r = await s.post(`/api/ideas/${ID}/tools/suggest`, { features: FEATURES, tool: 'Dataiku' });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Working by hand: The AI answered for Power Apps, not Dataiku. Try again.');
    const n = sp.prompts.length;
    const bad = await s.post(`/api/ideas/${ID}/tools/suggest`, { features: FEATURES, tool: 'Excel macro' });
    expect((await json(bad)).error).toBe('Working by hand: Not on the approved list: Excel macro');
    expect(sp.prompts.length).toBe(n);
  });

  it('saving keeps the tool with its pros, cons, context and fit, and writes them into approach.md', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: FEATURES, tool: { ...TOOL, context: ['Form-shaped input', ' spaced  out '] } });
    expect(r.status).toBe(200);
    const { state } = await json(r);
    expect(state.tool).toMatchObject({ tool: 'Power Apps', context: ['Form-shaped input', 'spaced out'], pros: ['Quick to build'], evaluatedFor: ['Request intake form', 'Draft replies'], at: '2026-10-20' });
    expect(state.features.map((f: any) => Object.keys(f).includes('tool'))).toEqual([false, false]);
    const md = await readFile(path.join(await ideaDir(s.root, ID), 'approach.md'), 'utf8');
    expect(md).toContain('- Pros:\n  - Quick to build\n- Cons (what it cannot do):\n  - No drafting on its own: add Copilot');
    expect(md).toContain('## Why this tool\n\n- Form-shaped input\n- spaced out');
    expect(md).toContain('| Draft replies | No | Add Copilot for the drafts |');
  });

  it('with too little in the form: a to-do list like the decision\'s, no tool; Draft email opens the open questions in Outlook and marks them asked', async () => {
    vi.stubEnv('CAFE_NO_OUTLOOK', '1');
    const sp = spy();
    const s = await server(sp.provider);
    const idea = await loadIdea(s.root, ID);
    await saveIdea(s.root, { ...idea, challenge: undefined, current_process: undefined });
    const out = await json(await s.post(`/api/ideas/${ID}/tools/suggest`));
    expect(sp.prompts.at(-1)).toContain('Email scheduler');
    expect(out.tool).toBeUndefined();
    const needs = out.state.toolPrep.needs;
    expect(needs.map((n: any) => [n.id, n.met])).toEqual([['n1', false], ['n2', false], ['n3', false], ['n4', false]]);
    // Nothing goes to the team until Draft email.
    expect((await s.get('/api/state')).outbox.filter((m: any) => m.template === 'E2')).toEqual([]);
    await s.post('/api/settings', { operatorName: 'Café operator' });
    const sent = await json(await s.post(`/api/ideas/${ID}/tools/prep/email`));
    expect(sent.email).toMatchObject({ template: 'E2', status: 'sent' });
    for (const n of needs) expect(sent.email.body).toContain(n.ask);
    expect(sent.file).toMatch(/^data\/exports\/outlook\/.+\.eml$/);
    expect((await readDesign(s.root, ID)).toolPrep!.needs.every((n) => n.askedAt === '2026-10-20')).toBe(true);
    // Its Undo: not sent, not asked.
    await s.post('/api/outbox/unopen', { key: sent.email.key });
    expect((await readDesign(s.root, ID)).toolPrep!.needs.some((n) => n.askedAt)).toBe(false);
  });

  it('an answer pasted against an item goes to the AI at Re-evaluate, which keeps the list and gives the tool', async () => {
    const sp = spy();
    const s = await server(sp.provider);
    const idea = await loadIdea(s.root, ID);
    await saveIdea(s.root, { ...idea, challenge: undefined, current_process: undefined });
    await s.post(`/api/ideas/${ID}/tools/suggest`);
    const answered = await json(await s.post(`/api/ideas/${ID}/tools/prep/answer`, { need: 'n1', answer: 'An email to the shared mailbox' }));
    expect(answered.state.toolPrep.needs[0].answer).toBe('An email to the shared mailbox');
    const out = await json(await s.post(`/api/ideas/${ID}/tools/suggest`));
    const seen = sp.prompts.at(-1)!;
    expect(seen).toContain('"teamAnswers"');
    expect(seen).toContain('An email to the shared mailbox');
    expect(seen).toContain('"todo"');
    expect(out.tool.tool).toBe('custom app');
    expect((await json(await s.post(`/api/ideas/${ID}/tools/prep/answer`, { need: 'n9', answer: 'x' }))).error).toMatch(/gone/);
  });

  it('questions sent by the older picker come back as open items, asked on the day they went out', async () => {
    const s = await server();
    await writeDesign(s.root, ID, { version: 1, status: 'picking', features: [], steps: [], toolQuestions: { questions: ['Who builds it?'], emailKey: 'k', at: '2026-10-19' } });
    const st = await readDesign(s.root, ID);
    expect(st.toolQuestions).toBeUndefined();
    expect(st.toolPrep).toEqual({ at: '2026-10-19', needs: [{ id: 'n1', need: 'Who builds it?', ask: 'Who builds it?', met: false, askedAt: '2026-10-19' }] });
  });
});

describe('saving the features and the tool', () => {
  it('save writes approach.md, ticks s3e, sets status and links the features the tool covers, once after two saves', async () => {
    const s = await server();
    const r1 = await s.post(`/api/ideas/${ID}/tools`, PICKS);
    expect(r1.status).toBe(200);
    const body = await json(r1);
    expect(body.state.status).toBe('designing');
    expect(body.designMd).toContain('## Features and tools');
    expect(body.designMd).toContain('One tool for the whole proof of concept: **Power Apps**');
    const dir = await ideaDir(s.root, ID);
    expect(await readFile(path.join(dir, 'approach.md'), 'utf8')).toContain('# Approach — Email scheduler');
    expect(await exists(path.join(dir, 'design.md'))).toBe(true);
    const idea = await loadIdea(s.root, ID);
    expect(idea.checklist.s3e).toMatchObject({ done: true, by: 'app', source: 'approach.md' });
    // Draft replies is a "no" in the fit: needed by the idea, not built with Power Apps.
    expect(idea.tools).toEqual({ 'Request intake form': 'Power Apps' });
    expect(idea.features).toEqual(['Request intake form', 'Draft replies']);
    expect((await readDesign(s.root, ID)).features).toHaveLength(2);

    const r2 = await s.post(`/api/ideas/${ID}/tools`, PICKS);
    expect(r2.status).toBe(200);
    const g = await s.get('/api/graph');
    const built = g.edges.filter((e: any) => e.rel === 'BUILT_WITH');
    expect(built).toHaveLength(1);
    for (const e of built) expect(e).toMatchObject({ confidence: 1, confirmed: true, source: `form:${ID}:approach.md` });
    const needs = g.edges.filter((e: any) => e.rel === 'NEEDS' && e.source === `form:${ID}:approach.md`);
    expect(needs).toHaveLength(2);
    const history = await s.get(`/api/ideas/${ID}/history`);
    expect(history.filter((h: any) => h.step === 's3e')).toHaveLength(1);

    const d = await s.get(`/api/ideas/${ID}/design`);
    expect(d.state.features.map((f: any) => f.name)).toEqual(['Request intake form', 'Draft replies']);
    expect(d.state.tool.tool).toBe('Power Apps');
    expect(d.designMd).toContain('Request intake form');
  });

  it('changing the tool replaces its BUILT_WITH links', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, PICKS);
    await s.post(`/api/ideas/${ID}/tools`, { features: FEATURES, tool: { ...TOOL, tool: 'Copilot Studio', by: 'operator' } });
    const g = await s.get('/api/graph');
    const built = g.edges.filter((e: any) => e.rel === 'BUILT_WITH').map((e: any) => e.id).sort();
    expect(built).toEqual(['capability:request-intake-form|BUILT_WITH|tool:copilot-studio']);
  });

  it('an older client\'s body (a tool on each feature) saves as one tool, the most common', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: [
      { name: 'Form', tool: 'Power Apps', reason: 'A form', pros: ['Quick'] }, { name: 'Engine', tool: 'custom code' }, { name: 'List', tool: 'power apps' },
    ] });
    expect(r.status).toBe(200);
    const { state } = await json(r);
    expect(state.tool).toMatchObject({ tool: 'Power Apps', by: 'operator', reason: 'A form', pros: ['Quick'] });
    expect(state.tool.fit.find((f: any) => f.feature === 'Engine')).toMatchObject({ fit: 'partly', note: 'Was picked for custom app before the one-tool picker' });
    expect((await loadIdea(s.root, ID)).tools).toEqual({ Form: 'Power Apps', Engine: 'Power Apps', List: 'Power Apps' });
  });

  it('refuses an unlisted tool with 400 and saves nothing (in either body)', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'X' }], tool: { tool: 'Excel macro' } });
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Not on the approved list: Excel macro');
    expect((await json(await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'X', tool: 'Excel macro' }] }))).error).toBe('Not on the approved list: Excel macro');
    expect(await exists(path.join(await ideaDir(s.root, ID), 'design.yaml'))).toBe(false);
  });

  it('changing the features or the tool of an approved design reopens it; the same features and tool keep it approved', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, PICKS);
    const st = await readDesign(s.root, ID);
    await writeDesign(s.root, ID, { ...st, status: 'approved', summary: 'Shows X', approvedAt: '2026-10-20' });
    const same = await json(await s.post(`/api/ideas/${ID}/tools`, { features: FEATURES, tool: st.tool }));
    expect(same.state).toMatchObject({ status: 'approved', approvedAt: '2026-10-20' });
    const changed = await json(await s.post(`/api/ideas/${ID}/tools`, { features: [FEATURES[0]], tool: st.tool }));
    expect(changed.state.status).toBe('designing');
    expect(changed.state.approvedAt).toBeUndefined();
    expect(changed.state.summary).toBe('Shows X');
    expect((await readDesign(s.root, ID)).approvedAt).toBeUndefined();
  });

  it('features with no tool yet keep status picking and do not tick s3e', async () => {
    const s = await server();
    const r = await json(await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Form' }] }));
    expect(r.state.status).toBe('picking');
    expect(r.state.tool).toBeUndefined();
    expect((await loadIdea(s.root, ID)).checklist.s3e).toBeUndefined();
  });
});

describe('tool picker answers, taken in like the decision\'s', () => {
  it('names are coded on the way to the AI; its proposed updates join the idea\'s one list and its brief goes on the idea', async () => {
    let seen = '';
    const fake = fakeProvider();
    const provider: Provider = { ...fake, complete: async (p, o) => {
      seen = p;
      if (!p.startsWith('TASK: tool-pick')) return fake.complete(p, o);
      const code = /\[(P\d+)\]/.exec(p.slice(p.lastIndexOf('"teamAnswers"')))?.[1];
      return JSON.stringify({
        pick: { tool: 'Power Apps', reason: 'A form and a list', flags: [], context: ['Form-shaped input'], pros: ['Quick to build'], cons: [`No scheduling logic: [${code}] would need Power Automate`],
          fit: [{ feature: 'Intake', fit: 'partly', note: `[${code}] adds the slots by hand` }] },
        needs: [], learned: [{ topic: 'Builder', text: `[${code}] builds it.` }],
        updates: { builder: `[${code}]`, builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } },
      });
    } };
    const s = await server(provider);
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }, { name: 'Person 2', roles: ['member'] }] }, answers: [{ question: 'Who builds it?', answer: 'Person 2 will build it.', source: 'reply.eml' }] } as any);
    const out = await json(await s.post(`/api/ideas/${ID}/tools/suggest`, { features: [{ name: 'Intake' }] }));
    expect(seen).not.toMatch(/Person 2/);
    expect(out.tool.cons).toEqual(['No scheduling logic: Person 2 would need Power Automate']);
    expect(out.tool.fit).toEqual([{ feature: 'Intake', fit: 'partly', note: 'Person 2 adds the slots by hand' }]);
    const idea = await loadIdea(s.root, ID) as any;
    expect(idea.updates.map((u: any) => [u.kind, u.label])).toEqual([['builder', 'Make Person 2 the builder']]);
    expect(idea.learned.points).toEqual([{ topic: 'Builder', text: 'Person 2 builds it.' }]);
  });
});

describe('the design questions build on the features and the tool', () => {
  const state = (): DesignState => ({
    ...emptyDesign(), status: 'designing',
    features: validateFeatures(FEATURES),
    tool: validateChoice(TOOL, validateFeatures(FEATURES), undefined, '2026-10-20'),
  });
  it('the input carries the features (each with the one tool), the tool, its cons and the features it does not fully cover', () => {
    const input = designStepInput(sampleIdea(), state());
    expect(input.features).toEqual([{ name: 'Request intake form', what: 'Collects each request', tool: 'Power Apps' }, { name: 'Draft replies', tool: 'Power Apps' }]);
    expect(input.tool).toEqual({ tool: 'Power Apps', pathway: 'Assisted Citizen', cons: ['No drafting on its own: add Copilot'], gaps: [{ feature: 'Draft replies', fit: 'no', note: 'Add Copilot for the drafts' }] });
    const p = designStepTask.prompt({ ...input, learned: [{ topic: 'Data', text: 'A weekly extract.' }] });
    expect(p).toMatch(/Do not ask which tool to use/);
    expect(p).toMatch(/how to cover each feature in "tool.gaps"/);
    expect(p).toMatch(/Never ask anything they already answer/);
    expect(p).toContain('Add Copilot for the drafts');
    expect(p).toContain('A weekly extract.');
    expect(designStepTask.prompt(designStepInput(sampleIdea(), { ...state(), tool: undefined }))).toMatch(/No tool is chosen yet/);
  });
  it('the brief and the answers go in with names coded; the route sends them and decodes the question', async () => {
    const sp = spy((p) => (p.startsWith('TASK: design-step') ? JSON.stringify({
      done: false, question: `Can ${/\[(P\d+)\]/.exec(p.slice(p.lastIndexOf('"learned"')))?.[1] ? `[${/\[(P\d+)\]/.exec(p.slice(p.lastIndexOf('"learned"')))![1]}]` : 'someone'} draft the replies by hand?`,
      suggested: ['Yes', 'No'], why: 'The tool cannot draft.', tag: null, updates: NO_UPDATES, learned: [],
    }) : undefined));
    const s = await server(sp.provider);
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), people: { submitter: 'Person 1', team: [{ name: 'Person 2', roles: ['member'] }] },
      answers: [{ question: 'Who?', answer: 'Person 2 builds.', source: 'r.eml' }],
      learned: { at: '2026-10-19', from: 1, points: [{ topic: 'Builder', text: 'Person 2 builds it.' }] } } as any);
    await s.post(`/api/ideas/${ID}/tools`, PICKS);
    const { input } = await codedDesignInput(s.root, await loadIdea(s.root, ID), await readDesign(s.root, ID));
    expect(input.learned![0].text).toMatch(/^\[P\d+\] builds it\.$/);
    expect(input.teamAnswers![0].answer).toMatch(/^\[P\d+\] builds\.$/);
    const r = await json(await s.post(`/api/ideas/${ID}/design/step`));
    const d = sp.data('design-step');
    expect(d.tool.gaps).toEqual([{ feature: 'Draft replies', fit: 'no', note: 'Add Copilot for the drafts' }]);
    expect(d.features.map((f: any) => f.name)).toEqual(['Request intake form', 'Draft replies']);
    expect(sp.prompts.at(-1)).not.toContain('Person 2');
    expect(r.step.question).toBe('Can Person 2 draft the replies by hand?');
  });
});

describe('design answers save themselves', () => {
  it('every design answer goes on the idea at once (nothing to say yes to); names coded on the way out; the brief goes on the idea', async () => {
    const sp = spy((p) => {
      if (!p.startsWith('TASK: design-step')) return undefined;
      const code = /\[(P\d+)\]/.exec(p.slice(p.lastIndexOf('"stepsSoFar"')))?.[1];
      return JSON.stringify({
        done: false, question: 'What is the smallest input?', suggested: ['A sample', 'A count'], tag: 'smallest-input',
        updates: { ...NO_UPDATES, builder: `[${code}]` },
        learned: [{ topic: 'Builder', text: `[${code}] builds it in Power Apps.` }],
      });
    });
    const s = await server(sp.provider);
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }, { name: 'Person 2', roles: ['member'] }] } } as any);
    await s.post(`/api/ideas/${ID}/tools`, PICKS);
    await s.post(`/api/ideas/${ID}/design/step`, { question: 'Who builds it?', suggested: [] });
    await s.post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Person 2 will build it in Power Apps.' });
    // The answer is on the idea already, with the question, from the design questions.
    expect((await loadIdea(s.root, ID) as any).answers).toEqual([{ question: 'Who builds it?', answer: 'Person 2 will build it in Power Apps.', source: 'design questions' }]);
    const r = await json(await s.post(`/api/ideas/${ID}/design/step`));
    expect(r.step.question).toBe('What is the smallest input?');
    const d = sp.data('design-step');
    expect(d.stepsSoFar[0].answer).toMatch(/^\[P\d+\] will build it in Power Apps\.$/);
    expect(sp.prompts.at(-1)).not.toContain('Person 2');
    expect(sp.prompts.at(-1)).toMatch(/updates: what DATA.stepsSoFar and DATA.teamAnswers change/);
    // The design's own answers ride in as its steps, not again as team answers.
    expect(d.teamAnswers ?? []).toEqual([]);
    const idea = await loadIdea(s.root, ID) as any;
    expect(idea.updates ?? []).toEqual([]);
    expect(idea.learned.points).toEqual([{ topic: 'Builder', text: 'Person 2 builds it in Power Apps.' }]);
    expect(idea.learned.from).toBe(1);
    // A changed answer changes the copy on the idea; nothing is proposed.
    await s.post(`/api/ideas/${ID}/design/answer`, { n: 2, answer: 'A sample' });
    await s.post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Person 2, in Power Apps.' });
    const after = await loadIdea(s.root, ID) as any;
    expect(after.answers.map((a: any) => a.answer)).toEqual(['Person 2, in Power Apps.', 'A sample']);
    expect(after.updates ?? []).toEqual([]);
  });
});

describe('the design pack', () => {
  it('reads the design files, and nothing else in the idea folder', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Form' }], tool: { tool: 'Power Apps' } });
    const ok = await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'approach.md' }));
    expect(ok.text).toContain('Form');
    for (const bad of ['idea.yaml', '../../rules/settings.yaml', 'kit/../idea.yaml', 'emails/001-E1.md', '/etc/passwd']) {
      expect((await json(await s.post(`/api/ideas/${ID}/design-file`, { path: bad }))).error).toBe('Not a design file');
    }
    expect((await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'plan.md' }))).error).toBe('plan.md is not written yet');
  });
});

describe('saved features and tool in the universe', () => {
  const tool = (fit: { feature: string; fit: 'yes' | 'partly' | 'no' }[]) => ({
    tool: 'Dataiku', reason: 'Rule checks over an export', pros: ['Works on exports'], cons: ['Cannot email people'], context: ['Export input'], flags: [],
    fit: fit.map((f) => ({ ...f, note: f.fit === 'no' ? 'Needs Power Automate' : '' })),
  });
  const features = [{ name: 'Weekend spend check', what: 'Flags weekend spend' }, { name: 'Claimant query emails', what: 'Emails the claimant' }];

  it('a feature the tool cannot do is needed by the idea but not built with the tool', async () => {
    const s = await server();
    const r = await json(await s.post(`/api/ideas/${ID}/tools`, { features, tool: tool([{ feature: 'Weekend spend check', fit: 'yes' }, { feature: 'Claimant query emails', fit: 'no' }]) }));
    expect(r.error).toBeUndefined();
    const idea = await loadIdea(s.root, ID);
    expect(idea.tools).toEqual({ 'Weekend spend check': 'Dataiku' });
    expect(idea.features).toEqual(['Weekend spend check', 'Claimant query emails']);
    const { rebuildGraph } = await import('../src/graph/store');
    const rels = (await rebuildGraph(s.root)).edges.map((e) => `${e.from} ${e.rel} ${e.to} ${e.description}`);
    expect(rels).toContain(`idea:${ID} NEEDS capability:claimant-query-emails Feature, not covered by the tool`);
    expect(rels).toContain('capability:weekend-spend-check BUILT_WITH tool:dataiku Tool pick');
    expect(rels.some((r) => r.startsWith('capability:claimant-query-emails BUILT_WITH'))).toBe(false);
  });

  it('a saved feature that looks like a star the idea already has is listed, and Merge moves its links', async () => {
    const s = await server();
    const { appendAiLink, rebuildGraph } = await import('../src/graph/store');
    await appendAiLink(s.root, { from: `idea:${ID}`, rel: 'NEEDS', to: 'capability:weekend-spend-policy-check', description: 'x', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', newNodes: [{ id: 'capability:weekend-spend-policy-check', type: 'Capability', label: 'Weekend spend policy check' }] });
    const r = await json(await s.post(`/api/ideas/${ID}/tools`, { features, tool: tool([{ feature: 'Weekend spend check', fit: 'yes' }, { feature: 'Claimant query emails', fit: 'yes' }]) }));
    expect(r.similar).toEqual([{ feature: 'Weekend spend check', featureId: 'capability:weekend-spend-check', star: 'Weekend spend policy check', starId: 'capability:weekend-spend-policy-check' }]);
    const m = await json(await s.post('/api/graph/merge', { from: r.similar[0].starId, into: r.similar[0].featureId }));
    expect(m).toMatchObject({ merged: true, from: 'Weekend spend policy check', into: 'Weekend spend check' });
    const g = await rebuildGraph(s.root);
    expect(g.nodes.some((n) => n.id === 'capability:weekend-spend-policy-check')).toBe(false);
    expect((await json(await s.post('/api/graph/merge', { from: 'capability:nope', into: r.similar[0].featureId }))).error).toBe('Those two stars cannot be merged');
  });
});
