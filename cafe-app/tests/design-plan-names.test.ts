import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { applyDesignEvent } from '../src/design/brainstorm';
import { emptyDesign, type DesignState } from '../src/design/store';
import { codedPlanInput, decodePlan } from '../src/design/kitInput';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { designPlanTask } from '../src/ai/tasks';
import { pathwayOf } from '../src/design/choice';
import { fixedClock } from '../src/clock';

const ID = 'CAFE-2026-001';
const clock = fixedClock('2026-10-20');
// Made-up people: the submitter and a builder named in the team.
const PEOPLE = { submitter: 'Person 7', team: [{ name: 'Person 8', roles: ['builder' as const] }] };
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

const state = (): DesignState => ({
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Person 8 builds a check that Person 7 runs weekly.',
  tool: { tool: 'Dataiku', pathway: pathwayOf('Dataiku'), by: 'operator', reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '2026-10-20' },
  features: [{ id: 'w', name: 'Weekend flag', what: 'Person 7 gets the flagged list', flags: [] }],
  steps: [{ n: 1, question: 'Does Person 8 have access to Dataiku?', answer: 'Yes, Person 8 has a project', suggested: [], source: 'operator' }],
});

describe('the design-plan task codes names', () => {
  it('codedPlanInput: no name in the prompt; decodePlan puts them back', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 3, people: PEOPLE, challenge: 'Person 7 checks weekend claims by hand.' }));
    const { input, codes } = await codedPlanInput(root, await loadIdea(root, ID), state());
    const prompt = designPlanTask.prompt(input);
    for (const name of ['Person 7', 'Person 8']) expect(prompt).not.toContain(name);
    expect(input.summary).toMatch(/^\[P\d\] builds a check that \[P\d\] runs weekly\.$/);
    expect(input.features[0]).toMatchObject({ name: 'Weekend flag', tool: 'Dataiku', what: expect.stringMatching(/^\[P\d\] gets the flagged list$/) });
    expect(input.steps[0].question).toMatch(/^Does \[P\d\] have access to Dataiku\?$/);
    expect(input.idea.challenge).not.toContain('Person 7');
    const code = input.summary.slice(1, 3);
    const back = decodePlan({ tasks: [{ title: `Ask [${code}] for access`, detail: 'd', tool: 'Dataiku', done_when: `[${code}] confirms; [Z9] too` }], risks: [`[${code}] is away`] }, codes);
    expect(back.tasks[0]).toEqual({ title: 'Ask Person 8 for access', detail: 'd', tool: 'Dataiku', done_when: 'Person 8 confirms; the team too' });
    expect(back.risks).toEqual(['Person 8 is away']);
  });

  it('the plan route: the prompt it sends holds no name; plan.md gets the names back', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const fake = fakeProvider();
    const prompts: string[] = [];
    const spy: Provider = {
      ...fake,
      async complete(prompt, opts) {
        if (!prompt.startsWith('TASK: design-plan')) return fake.complete(prompt, opts);
        prompts.push(prompt);
        const code = /\[(P\d+)\]/.exec(prompt.slice(prompt.indexOf('<<<DATA')))?.[1] ?? 'P1';
        return JSON.stringify({ tasks: [
          { title: 'Make the sample', detail: 'Twenty rows', tool: 'Dataiku', done_when: 'It loads' },
          { title: `Give [${code}] the project`, detail: 'Access first', tool: 'Dataiku', done_when: 'Access works' },
          { title: 'Build the flag', detail: 'One recipe', tool: 'Dataiku', done_when: 'Weekends flagged' },
        ], risks: [`[${code}] may not have access`] });
      },
    };
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [spy], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await saveIdea(s.root, sampleIdea({ stage: 3, people: PEOPLE, challenge: 'Person 7 checks weekend claims by hand.' }));
    await post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Weekend flag', what: 'Person 7 gets the flagged list' }], tool: { tool: 'Dataiku', by: 'operator', reason: 'Tables' } });
    await applyDesignEvent(s.root, await loadIdea(s.root, ID), { t: 'step', question: 'Does Person 8 have access to Dataiku?', suggested: [], source: 'operator' }, clock);
    await post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Yes, Person 8 has a project' });
    await post(`/api/ideas/${ID}/design/finish`, { force: true, summary: 'Person 8 builds a check that Person 7 runs weekly.' });
    expect((await post(`/api/ideas/${ID}/design/approve`)).status).toBe(200);
    expect((await post(`/api/ideas/${ID}/plan`)).status).toBe(200);
    expect(prompts).toHaveLength(1);
    const data = prompts[0].slice(prompts[0].indexOf('<<<DATA'));
    for (const name of ['Person 7', 'Person 8']) expect(data).not.toContain(name);
    expect(data).toMatch(/\[P\d\] builds a check/);
    const md = await readFile(path.join(await ideaDir(s.root, ID), 'plan.md'), 'utf8');
    expect(md).toMatch(/Give Person [78] the project/);
    expect(md).not.toMatch(/\[P\d\]/);
  });
});
