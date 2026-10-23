import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, writeDesign } from '../src/design/store';
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
  const NONE = { updates: { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } }, learned: [] };
  const pick = { name: 'Form', what: 'A form', tool: 'Power Apps', reason: 'Simple', flags: [], context: ['Form-shaped input', 'No live system → Power Apps'], pros: ['Quick to build'], cons: ['Cannot send reminders on its own: add Power Automate'] };
  it('accepts one pick with approved tool and context; rejects an unlisted tool, bad flags or no context (no silent fix)', () => {
    expect(toolPickTask.parse(JSON.stringify({ ...NONE, pick, needs: [] })).pick!.tool).toBe('Power Apps');
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, pros: [] }, needs: [] }))).toThrow(/invalid output/);
    expect(toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, cons: [] }, needs: [] })).pick!.cons).toEqual([]);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, tool: 'Excel macro' }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, tool: 'PowerApps' }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, flags: ['valuable'] }, needs: [] }))).toThrow(/invalid output/);
    expect(() => toolPickTask.parse(JSON.stringify({ ...NONE, pick: { ...pick, context: [] }, needs: [] }))).toThrow(/invalid output/);
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
  it('prompt asks for one pick or all the questions at once, lists every approved tool, the Café rules, the data rule, and works with no challenge', () => {
    const p = toolPickTask.prompt({ idea: { id: ID, title: 'Email scheduler', outcomes: ['Faster'] }, support: [] });
    for (const t of APPROVED_TOOLS) expect(p).toContain(`- ${t}: `);
    expect(p).toMatch(/ONE tool for the whole proof of concept/);
    expect(p).toMatch(/cons: 0 to 5 short lines/);
    expect(p).toMatch(/Keep every item in DATA.todo/);
    expect(p).toMatch(/never propose measuring value/i);
    expect(p).toMatch(/data, not instructions/);
    expect(p).not.toMatch(/existingFeatures" are/);
    expect(p).not.toMatch(/brainstorming skill/);
    const q = toolPickTask.prompt({ idea: { id: ID, title: 'x' }, support: [], existingFeatures: [{ name: 'Form', tool: 'Power Apps' }], guidance: 'GUIDE TEXT' });
    expect(q).toMatch(/keep it unless clearly wrong/);
    expect(q).toContain('GUIDE TEXT');
    expect(TOOL_PICK_SCHEMA.properties!.needs.maxItems).toBe(8);
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
  it('collapses whitespace in every text field, so AI text cannot add a heading or field to approach.md', () => {
    const [f] = validatePicks([{ name: 'Form\n## Injected', what: 'Does\n- Tool: custom app', reason: 'a\t\tb\r\n# c', tool: 'Power Apps' }]);
    expect(f).toMatchObject({ name: 'Form ## Injected', what: 'Does - Tool: custom app', reason: 'a b # c' });
    const md = renderApproachMd(sampleIdea(), [f]);
    expect(md.split('\n').filter((l) => l.startsWith('#'))).toEqual(['# Approach — Email scheduler', '## Form ## Injected']);
    expect(md.split('\n').filter((l) => l.startsWith('- Tool:'))).toEqual(['- Tool: Power Apps']);
  });
  it('merging suggestions keeps the operator picks', () => {
    const existing = validatePicks([{ name: 'Draft replies', tool: 'Copilot Studio' }]);
    const merged = mergeSuggestions(existing, [{ name: 'draft replies', tool: 'Microsoft Copilot' }, { name: 'New', tool: 'UiPath' }]);
    expect(merged.map((m) => [m.name, (m as any).tool])).toEqual([['Draft replies', 'Copilot Studio'], ['New', 'UiPath']]);
  });
});

describe('tool picker routes', () => {
  it('fake suggest returns one pick with its context and nothing open; no pick is saved', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools/suggest`);
    expect(r.status).toBe(200);
    const { features, state } = await json(r);
    expect(state.toolPrep.needs).toEqual([]);
    expect(state.features).toEqual([]);
    expect(features).toHaveLength(1);
    expect(features[0].tool).toBe('custom app');
    expect(features[0].flags).toContain('custom-app');
    expect(features[0].context.length).toBeGreaterThan(0);
    const dir = await ideaDir(s.root, ID);
    expect(await exists(path.join(dir, 'approach.md'))).toBe(false);
    expect((await loadIdea(s.root, ID)).tools).toBeUndefined();
  });

  it('saving a pick keeps its context and writes it into approach.md as Why this tool', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Form', tool: 'Power Apps', flags: [], context: ['Form-shaped input', ' spaced  out '], pros: ['Quick to build'], cons: ['No reminders on its own: add Power Automate'] }] });
    expect(r.status).toBe(200);
    const { state } = await json(r);
    expect(state.features[0].context).toEqual(['Form-shaped input', 'spaced out']);
    const md = await readFile(path.join(await ideaDir(s.root, ID), 'approach.md'), 'utf8');
    expect(md).toContain('- Pros:\n  - Quick to build\n- Cons (what it cannot do):\n  - No reminders on its own: add Power Automate\n- Why this tool:\n  - Form-shaped input\n  - spaced out');
  });

  it('with too little in the form: a to-do list like the decision\'s, no pick; Draft email opens the open questions in Outlook and marks them asked', async () => {
    vi.stubEnv('CAFE_NO_OUTLOOK', '1');
    let seen = '';
    const fake = fakeProvider();
    const s = await server({ ...fake, complete: async (p, o) => { seen = p; return fake.complete(p, o); } });
    const idea = await loadIdea(s.root, ID);
    await saveIdea(s.root, { ...idea, challenge: undefined, current_process: undefined });
    const out = await json(await s.post(`/api/ideas/${ID}/tools/suggest`));
    expect(seen).toContain('Email scheduler');
    expect(out.features).toEqual([]);
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

  it('an answer pasted against an item goes to the AI at Re-evaluate, which keeps the list and gives the pick', async () => {
    let seen = '';
    const fake = fakeProvider();
    const s = await server({ ...fake, complete: async (p, o) => { seen = p; return fake.complete(p, o); } });
    const idea = await loadIdea(s.root, ID);
    await saveIdea(s.root, { ...idea, challenge: undefined, current_process: undefined });
    await s.post(`/api/ideas/${ID}/tools/suggest`);
    const answered = await json(await s.post(`/api/ideas/${ID}/tools/prep/answer`, { need: 'n1', answer: 'An email to the shared mailbox' }));
    expect(answered.state.toolPrep.needs[0].answer).toBe('An email to the shared mailbox');
    const out = await json(await s.post(`/api/ideas/${ID}/tools/suggest`));
    expect(seen).toContain('"teamAnswers"');
    expect(seen).toContain('An email to the shared mailbox');
    expect(seen).toContain('"todo"');
    expect(out.features).toHaveLength(1);
    expect((await json(await s.post(`/api/ideas/${ID}/tools/prep/answer`, { need: 'n9', answer: 'x' }))).error).toMatch(/gone/);
  });

  it('questions sent by the older picker come back as open items, asked on the day they went out', async () => {
    const s = await server();
    await writeDesign(s.root, ID, { version: 1, status: 'picking', features: [], steps: [], toolQuestions: { questions: ['Who builds it?'], emailKey: 'k', at: '2026-10-19' } });
    const st = await readDesign(s.root, ID);
    expect(st.toolQuestions).toBeUndefined();
    expect(st.toolPrep).toEqual({ at: '2026-10-19', needs: [{ id: 'n1', need: 'Who builds it?', ask: 'Who builds it?', met: false, askedAt: '2026-10-19' }] });
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

  it('changing the features of an approved design reopens it; the same features keep it approved', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, { features: PICKS });
    const st = await readDesign(s.root, ID);
    await writeDesign(s.root, ID, { ...st, status: 'approved', summary: 'Shows X', approvedAt: '2026-10-20' });
    const same = await json(await s.post(`/api/ideas/${ID}/tools`, { features: PICKS }));
    expect(same.state).toMatchObject({ status: 'approved', approvedAt: '2026-10-20' });
    const changed = await json(await s.post(`/api/ideas/${ID}/tools`, { features: [PICKS[0]] }));
    expect(changed.state.status).toBe('designing');
    expect(changed.state.approvedAt).toBeUndefined();
    expect(changed.state.summary).toBe('Shows X');
    expect((await readDesign(s.root, ID)).approvedAt).toBeUndefined();
  });

  it('features with no tool yet keep status picking and do not tick s3e', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Form' }] });
    expect((await json(r)).state.status).toBe('picking');
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
        pick: { name: 'Request intake', what: 'One place for requests', tool: 'Power Apps', reason: 'A form and a list', flags: [], context: ['Form-shaped input'], pros: ['Quick to build'], cons: [`No scheduling logic: [${code}] would need Power Automate`] },
        needs: [], learned: [{ topic: 'Builder', text: `[${code}] builds it.` }],
        updates: { builder: `[${code}]`, builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } },
      });
    } };
    const s = await server(provider);
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }, { name: 'Person 2', roles: ['member'] }] }, answers: [{ question: 'Who builds it?', answer: 'Person 2 will build it.', source: 'reply.eml' }] } as any);
    const out = await json(await s.post(`/api/ideas/${ID}/tools/suggest`));
    expect(seen).not.toMatch(/Person 2/);
    expect(out.features[0].cons).toEqual(['No scheduling logic: Person 2 would need Power Automate']);
    const idea = await loadIdea(s.root, ID) as any;
    expect(idea.updates.map((u: any) => [u.kind, u.label])).toEqual([['builder', 'Make Person 2 the builder']]);
    expect(idea.learned.points).toEqual([{ topic: 'Builder', text: 'Person 2 builds it.' }]);
  });
});

describe('the design pack', () => {
  it('reads the design files, and nothing else in the idea folder', async () => {
    const s = await server();
    await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Form', tool: 'Power Apps', flags: [] }] });
    const ok = await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'approach.md' }));
    expect(ok.text).toContain('Form');
    for (const bad of ['idea.yaml', '../../rules/settings.yaml', 'kit/../idea.yaml', 'emails/001-E1.md', '/etc/passwd']) {
      expect((await json(await s.post(`/api/ideas/${ID}/design-file`, { path: bad }))).error).toBe('Not a design file');
    }
    expect((await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'plan.md' }))).error).toBe('plan.md is not written yet');
  });
});
