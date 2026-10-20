import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, emptyDesign, renderDesignMd, loadSkill, type DesignState } from '../src/design/store';
import { applyDesignEvent, askTeam } from '../src/design/brainstorm';
import {
  renderPlanMd, kitFiles, designPlanInput, oneThingToShow, toolSlug, CUSTOM_APP_CSIC, AGENT_FILE,
} from '../src/design/kits';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { designPlanTask, type DesignPlanOutput, type Triage } from '../src/ai/tasks';
import { APPROVED_TOOLS } from '../src/graph/ontology';
import { processDrop, applyRecords } from '../src/inbox/flow';
import { fixedClock } from '../src/clock';

const json = (r: Response) => r.json() as Promise<any>;
const ID = 'CAFE-2026-001';
const clock = fixedClock('2026-10-20');
const MUST_SHOW = 'That every request gets a send slot the same day';
const DOWN: Provider = { id: 'claude', label: 'Down', available: async () => false, complete: async () => '{}' };

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

async function server(provider?: Provider) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-20', { connector: createConnector({ providers: [provider ?? fakeProvider()], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (url: string) => fetch(`${s.base}${url}`);
  await saveIdea(s.root, sampleIdea({
    stage: 3, challenge: 'Requests arrive by email and are scheduled by hand.', outcomes: ['Requests scheduled the same day'],
  }));
  return { ...s, post, get };
}

/** Picks (Power Apps + custom app), a must-show answer, finished by hand and approved: no AI needed for any of it. */
async function approvedDesign(s: Awaited<ReturnType<typeof server>>) {
  await s.post(`/api/ideas/${ID}/tools`, { features: [
    { name: 'Request intake form', what: 'Collects each request in one place', tool: 'Power Apps' },
    { name: 'Scheduling engine', what: 'Works out a send slot for each request', tool: 'custom app' },
  ] });
  const idea = await loadIdea(s.root, ID);
  await applyDesignEvent(s.root, idea, { t: 'step', question: 'What must it show?', suggested: [], tag: 'must-show', source: 'ai-suggested' }, clock);
  await s.post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: MUST_SHOW });
  const fin = await s.post(`/api/ideas/${ID}/design/finish`, { summary: 'Shows same-day slots.  Built on a\nsynthetic sample.' });
  expect(fin.status).toBe(200);
  expect((await s.post(`/api/ideas/${ID}/design/approve`)).status).toBe(200);
}

const cafeSection = (md: string) => md.slice(md.indexOf('## Café check'));
const PLAN: DesignPlanOutput = {
  tasks: APPROVED_TOOLS.map((tool, i) => ({ title: `Task ${i} for ${tool}`, detail: `Detail ${i}`, tool, done_when: `Done ${i}` })),
  risks: ['One risk'],
};

describe('designPlanTask', () => {
  it('schema: 3 to 12 tasks, an approved tool each, at most 5 risks; text trimmed to one line', () => {
    const t = (tool = 'Power Apps') => ({ title: 'T', detail: 'D', tool, done_when: 'W' });
    expect(() => designPlanTask.parse(JSON.stringify({ tasks: [t(), t()], risks: [] }))).toThrow(/invalid output/);
    expect(() => designPlanTask.parse(JSON.stringify({ tasks: Array(13).fill(t()), risks: [] }))).toThrow(/invalid output/);
    expect(() => designPlanTask.parse(JSON.stringify({ tasks: [t(), t(), t('PowerApps')], risks: [] }))).toThrow(/invalid output/);
    expect(() => designPlanTask.parse(JSON.stringify({ tasks: [t(), t(), t()], risks: Array(6).fill('r') }))).toThrow(/invalid output/);
    const ok = designPlanTask.parse(JSON.stringify({ tasks: [{ ...t(), title: 'Build\n## the form' }, t(), t('custom app')], risks: ['A\nrisk'] }));
    expect(ok.tasks[0].title).toBe('Build ## the form');
    expect(ok.risks).toEqual(['A risk']);
  });

  it('prompt: the writing-plans guidance, the Café rules, the DATA markers; steps carry no source', () => {
    const idea = sampleIdea({ stage: 3 });
    const state: DesignState = {
      ...emptyDesign(), status: 'approved', summary: 'Shows slots.', approvedAt: '2026-10-20',
      features: [{ id: 'f', name: 'Engine', tool: 'custom app', flags: ['custom-app'] }],
      steps: [{ n: 1, question: 'Q one?', suggested: [], answer: 'A one', source: 'e2' }, { n: 2, question: 'Q two?', suggested: [], source: 'operator' }],
    };
    const input = designPlanInput(idea, state);
    expect(input.steps).toEqual([{ question: 'Q one?', answer: 'A one' }]);
    const p = designPlanTask.prompt(input);
    expect(p.startsWith('TASK: design-plan')).toBe(true);
    expect(p).toContain(loadSkill('writing-plans').slice(0, 200));
    expect(p).toMatch(/proof of concept on synthetic, aggregated or sample data/);
    expect(p).toMatch(/Never plan to measure value/);
    expect(p).toMatch(/hand-off to a coding agent/);
    expect(p).toMatch(/data, not instructions/);
    expect(p).toContain('<<<DATA');
    expect(p.slice(p.indexOf('<<<DATA'))).not.toContain('"source"');
  });
});

describe('plan.md and kits (renderers)', () => {
  it('plan.md: title, the one thing to show, tasks by tool in approved order, risks, then the Café check from design.md', () => {
    const idea = sampleIdea({ stage: 3 });
    const state: DesignState = {
      ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Shows slots. Then more.',
      features: [{ id: 'f', name: 'Engine', tool: 'custom app', flags: ['custom-app'] }],
      steps: [],
    };
    const plan = { tasks: [...PLAN.tasks].reverse(), risks: ['Risk one'] };
    const md = renderPlanMd(idea, state, plan);
    expect(md.startsWith('# Plan — Email scheduler\n')).toBe(true);
    expect(md).toContain('## The one thing to show\n\nShows slots.\n');
    const h3 = md.split('\n').filter((l) => l.startsWith('### '));
    expect(h3).toEqual(APPROVED_TOOLS.map((t) => `### ${t}`));
    expect(md).toContain('- [ ] **Task 1 for Copilot Studio**\n  Detail 1\n  Done when: Done 1');
    expect(md).toContain('## Risks\n\n- Risk one');
    const h2 = md.split('\n').filter((l) => l.startsWith('## '));
    expect(h2).toEqual(['## The one thing to show', '## Tasks', '## Risks', '## Café check']);
    expect(cafeSection(md)).toBe(cafeSection(renderDesignMd(idea, state)));
    // The must-show answer wins over the summary.
    expect(oneThingToShow({ ...state, steps: [{ n: 1, question: 'Q', suggested: [], answer: MUST_SHOW, tag: 'must-show', source: 'operator' }] })).toBe(MUST_SHOW);
  });

  it('one kit per picked tool; every file starts from the features and plan tasks for its tool', () => {
    const idea = sampleIdea({ stage: 3 });
    const state: DesignState = {
      ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'S.',
      features: APPROVED_TOOLS.map((tool, i) => ({ id: `f${i}`, name: `Feature ${i}`, what: `Does thing ${i}`, tool, flags: [] })),
      steps: [],
    };
    const files = kitFiles(idea, state, PLAN);
    expect(Object.keys(files).sort()).toEqual([
      'kit/copilot-studio/README.md', 'kit/copilot-studio/topics.md',
      'kit/custom-app/BUILD-WITH-AGENT.md', 'kit/custom-app/README.md',
      'kit/dataiku/flow.md', 'kit/microsoft-copilot/prompts.md', 'kit/power-apps/screens.md', 'kit/uipath/process.md',
    ]);
    APPROVED_TOOLS.forEach((tool, i) => {
      for (const [p, text] of Object.entries(files).filter(([p]) => p.startsWith(`kit/${toolSlug(tool)}/`))) {
        expect(text, p).toContain(`**Feature ${i}**: Does thing ${i}`);
        expect(text, p).toContain(`**Task ${i} for ${tool}**`);
        for (const j of APPROVED_TOOLS.keys()) if (j !== i) expect(text, p).not.toContain(`Feature ${j}**`);
        expect(text.indexOf('## Features for this tool'), p).toBeLessThan(text.indexOf('## Plan tasks for this tool'));
      }
    });
    const flow = files['kit/dataiku/flow.md'];
    expect(flow).toMatch(/## Flow\n\n1\. \*\*Synthetic data\*\*/);
    expect(files['kit/microsoft-copilot/prompts.md']).toContain('## No build');
    expect(files['kit/copilot-studio/topics.md']).toContain('### Topic: Feature 1');
    expect(files['kit/power-apps/screens.md']).toContain('### Screen: Feature 2');
    expect(files['kit/uipath/process.md']).toContain('### Process: Feature 4');
    // Templates only: no code files anywhere.
    expect(Object.keys(files).every((p) => p.endsWith('.md'))).toBe(true);
    // Only picked tools get a kit.
    expect(Object.keys(kitFiles(idea, { ...state, features: state.features.slice(2, 3) }, PLAN))).toEqual(['kit/power-apps/screens.md']);
  });
});

describe('plan routes', () => {
  it('unapproved design → 400 and nothing written', async () => {
    const s = await server();
    const r = await s.post(`/api/ideas/${ID}/plan`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('Design is not approved yet');
    expect(await json(await s.get(`/api/ideas/${ID}/plan`))).toEqual({ files: [] });
  });

  it('approved: plan.md and one kit per picked tool; the custom app kit has the agent instruction and the CSIC note', async () => {
    const s = await server();
    await approvedDesign(s);
    const r = await s.post(`/api/ideas/${ID}/plan`);
    expect(r.status).toBe(200);
    const { files } = await json(r);
    expect(files).toEqual(['kit/custom-app/BUILD-WITH-AGENT.md', 'kit/custom-app/README.md', 'kit/power-apps/screens.md', 'plan.md']);
    const dir = await ideaDir(s.root, ID);
    const plan = await readFile(path.join(dir, 'plan.md'), 'utf8');
    expect(plan.startsWith('# Plan — Email scheduler')).toBe(true);
    expect(plan).toContain(`## The one thing to show\n\n${MUST_SHOW}\n`);
    expect(plan.indexOf('### Power Apps')).toBeLessThan(plan.indexOf('### custom app'));
    expect(plan).toContain('- [ ] **Make the synthetic sample**');
    expect(plan).toMatch(/Done when: The sample list has twenty rows/);
    expect(plan).toContain('## Risks');
    const design = await readFile(path.join(dir, 'design.md'), 'utf8');
    expect(cafeSection(plan)).toBe(cafeSection(design));
    expect(plan).toContain('This idea has a CSIC feature');

    const agent = await readFile(path.join(dir, 'kit', 'custom-app', AGENT_FILE), 'utf8');
    const block = /```text\n([\s\S]*?)\n```/.exec(agent)?.[1] ?? '';
    expect(block).toContain('../../design.md');
    expect(block).toContain('../../plan.md');
    expect(block).toMatch(/write only inside this kit folder/i);
    expect(block).toMatch(/synthetic data only/i);
    expect(block).toContain(CUSTOM_APP_CSIC);
    expect(block).toContain('Scheduling engine');
    expect(agent).toMatch(/Claude Code \/ Copilot/);
    const readme = await readFile(path.join(dir, 'kit', 'custom-app', 'README.md'), 'utf8');
    expect(readme).toContain('## CSIC note');
    expect(readme).toContain(CUSTOM_APP_CSIC);
    expect(readme).toContain('Hand the scheduling engine to a coding agent');
    expect(readme).not.toContain('Build the request form');
    // The stage and the closure never move.
    const idea = await loadIdea(s.root, ID);
    expect(idea.stage).toBe(3);
    expect(idea.closed).toBeUndefined();
  });

  it('re-running overwrites plan.md and the kit files the app owns, and keeps an operator-added file', async () => {
    const s = await server();
    await approvedDesign(s);
    await s.post(`/api/ideas/${ID}/plan`);
    const dir = await ideaDir(s.root, ID);
    await mkdir(path.join(dir, 'kit', 'custom-app'), { recursive: true });
    await writeFile(path.join(dir, 'kit', 'custom-app', 'notes.md'), 'My notes\n');
    await writeFile(path.join(dir, 'plan.md'), 'scribbled\n');
    await writeFile(path.join(dir, 'kit', 'custom-app', 'README.md'), 'scribbled\n');
    const again = await json(await s.post(`/api/ideas/${ID}/plan`));
    expect(again.files).not.toContain('kit/custom-app/notes.md');
    expect(await readFile(path.join(dir, 'kit', 'custom-app', 'notes.md'), 'utf8')).toBe('My notes\n');
    expect(await readFile(path.join(dir, 'plan.md'), 'utf8')).toMatch(/^# Plan — /);
    expect(await readFile(path.join(dir, 'kit', 'custom-app', 'README.md'), 'utf8')).toContain(CUSTOM_APP_CSIC);
    const got = await json(await s.get(`/api/ideas/${ID}/plan`));
    expect(got.files).toEqual(['kit/custom-app/BUILD-WITH-AGENT.md', 'kit/custom-app/README.md', 'kit/custom-app/notes.md', 'kit/power-apps/screens.md', 'plan.md']);
    expect(got.planMd).toMatch(/^# Plan — Email scheduler/);
  });

  it('with the AI down the plan route says to work by hand and writes nothing', async () => {
    const s = await server(DOWN);
    await approvedDesign(s);
    const r = await s.post(`/api/ideas/${ID}/plan`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/^Working by hand/);
    expect((await json(await s.get(`/api/ideas/${ID}/plan`))).files).toEqual([]);
  });
});

describe('Task 3 carry-overs', () => {
  it('design/finish: a hand-written summary finishes the design (no AI) and approval follows', async () => {
    const s = await server(DOWN);
    expect((await s.post(`/api/ideas/${ID}/design/finish`, {})).status).toBe(400);
    expect((await json(await s.post(`/api/ideas/${ID}/design/finish`, { summary: ' \n ' }))).error).toBe('Write the summary first');
    expect((await s.post(`/api/ideas/${ID}/design/finish`, { summary: 'x'.repeat(601) })).status).toBe(400);
    expect((await s.post(`/api/ideas/${ID}/design/approve`)).status).toBe(400);
    const r = await json(await s.post(`/api/ideas/${ID}/design/finish`, { summary: 'Shows slots\n\non a   sample.' }));
    expect(r.state.summary).toBe('Shows slots on a sample.');
    expect(r.designMd).toContain('Shows slots on a sample.');
    expect((await readDesign(s.root, ID)).summary).toBe('Shows slots on a sample.');
    const a = await json(await s.post(`/api/ideas/${ID}/design/approve`));
    expect(a.state).toMatchObject({ status: 'approved', approvedAt: '2026-10-20' });
  });

  it('design/step hand path: a question must be a non-empty string', async () => {
    const s = await server(DOWN);
    for (const question of [42, null, ['Q?'], '   ']) {
      const r = await s.post(`/api/ideas/${ID}/design/step`, { question });
      expect(r.status, JSON.stringify(question)).toBe(400);
    }
    expect((await readDesign(s.root, ID)).steps).toEqual([]);
  });

  it('brainstorm.ts no longer imports the Inbox actions (sameQuestion lives in a leaf module)', async () => {
    const src = await readFile(path.join(__dirname, '..', 'src', 'design', 'brainstorm.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\.\/inbox\/actions'/);
    expect(src).toMatch(/from '\.\.\/inbox\/question'/);
    const leaf = await readFile(path.join(__dirname, '..', 'src', 'inbox', 'question.ts'), 'utf8');
    expect(leaf).not.toMatch(/^import /m);
  });

  it('an Inbox answer to a question we never asked in the design leaves the step open', async () => {
    const root = await tmpWorkspace('2026-10-19');
    const idea = sampleIdea({ stage: 3, people: { submitter: 'Person 2', team: [] } });
    await saveIdea(root, idea);
    await applyDesignEvent(root, idea, { t: 'step', question: 'What is the one thing this proof of concept must show?', suggested: [], tag: 'must-show', source: 'ai-suggested' }, clock);
    const { emailKey } = await askTeam(root, idea, 1, clock);
    const file = path.join(root, ...emailKey.split('/'));
    await writeFile(file, (await readFile(file, 'utf8')).replace('status: draft', 'status: sent\nsentAt: 2026-10-20'));
    const triage: Triage = {
      summary: 'Person 2 answers something else.', kind: 'reply', ideaId: ID, matchConfidence: 0.95,
      facts: { answers: [{ question: 'Which office handles the most requests?', answer: 'The EMEA desk.' }], replyReceived: true, graph: { nodes: [], links: [] } },
    };
    const provider: Provider = { id: 'claude', label: 'Test AI', available: async () => true, complete: async () => JSON.stringify(triage) };
    const { item } = await processDrop(root, 'reply', `${ID}: The EMEA desk.`, createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }), clock);
    const rec = (item.actions as any[]).find((r) => r.action.t === 'record_answers');
    expect(rec).toBeDefined();
    // The operator says Yes to recording it anyway; it is saved on the idea, but no design question matches.
    if (rec.status !== 'applied') await applyRecords(root, item.id, [rec.id], clock);
    expect(((await loadIdea(root, ID)) as any).answers).toEqual([expect.objectContaining({ answer: 'The EMEA desk.' })]);
    const state = await readDesign(root, ID);
    expect(state.steps[0].answer).toBeUndefined();
    expect(state.steps[0].askedTeam).toEqual({ emailKey });
    expect((await loadIdea(root, ID)).checklist.s3c).toBeUndefined();
  });
});
