import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readDesign, writeDesign, emptyDesign } from '../src/design/store';
import { applyDesignEvents } from '../src/design/brainstorm';
import { readHistory } from '../src/workspace/files';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { fixedClock } from '../src/clock';

const ID = 'CAFE-2026-001';
const clock = fixedClock('2026-10-20');
const json = (r: Response) => r.json() as Promise<any>;
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

const TOOL = { tool: 'Power Apps', pathway: 'Citizen-Led', by: 'operator', reason: 'Forms and a list', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '2026-10-19' };

async function server(stage: 3 | 4 = 3) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await saveIdea(s.root, sampleIdea({ stage, challenge: 'Requests arrive by email.', outcomes: ['Same-day scheduling'] }) as any);
  // An approved design with two answered questions, a diagram and an answer the team sent by email.
  await writeDesign(s.root, ID, {
    ...emptyDesign(), status: 'picking', tool: TOOL as any,
    features: [{ id: 'f1', name: 'Slot finder', flags: [] }, { id: 'f2', name: 'Weekly report', flags: [], scope: { status: 'out', why: 'Later' } as any }],
  });
  const idea = await loadIdea(s.root, ID);
  await saveIdea(s.root, { ...idea, answers: [{ question: 'Who books?', answer: 'Person 1', source: 'E2' }] } as any);
  await applyDesignEvents(s.root, await loadIdea(s.root, ID), [
    { t: 'step', question: 'What must it show?', suggested: [], source: 'operator' },
    { t: 'answer', n: 1, answer: 'Same-day slots', source: 'operator' },
    { t: 'step', question: 'Who uses it?', suggested: [], source: 'operator' },
    { t: 'answer', n: 2, answer: 'The scheduling team', source: 'operator' },
    { t: 'done', summary: 'Shows same-day slots.', settled: { builder: 'The team builds it' } },
    { t: 'approve' },
  ], clock);
  const d = await readDesign(s.root, ID);
  await writeDesign(s.root, ID, { ...d, diagram: { spec: { lanes: [{ id: 'l', label: 'Team' }], nodes: [{ id: 'n', lane: 'l', label: 'Slots' }], edges: [] }, by: 'ai', at: '2026-10-20', basis: 'x' } as any });
  return { ...s, post };
}

describe('Redesign', () => {
  it('clears the questions, answers, summary, settled points, approval and diagram; keeps the features and the tool', async () => {
    const s = await server();
    expect((await readDesign(s.root, ID)).diagram).toBeDefined();
    expect(((await loadIdea(s.root, ID)) as any).answers.filter((a: any) => a.source === 'design questions')).toHaveLength(2);
    const r = await s.post(`/api/ideas/${ID}/design/redesign`);
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.planStale).toBe(false);
    const st = await readDesign(s.root, ID);
    expect(st.steps).toEqual([]);
    for (const k of ['summary', 'settled', 'approvedAt', 'diagram', 'planStale'] as const) expect(st[k]).toBeUndefined();
    expect(st.status).toBe('picking');
    expect(st.tool?.tool).toBe('Power Apps');
    expect(st.features.map((f) => f.name)).toEqual(['Slot finder', 'Weekly report']);
    expect(st.features[1].scope?.status).toBe('out');
    // The design's own answers leave the idea; the team's answer stays.
    const idea = (await loadIdea(s.root, ID)) as any;
    expect(idea.answers).toEqual([{ question: 'Who books?', answer: 'Person 1', source: 'E2' }]);
    expect(idea.stage).toBe(3);
    // design.md is rewritten; the history says so.
    const md = await readFile(path.join(await ideaDir(s.root, ID), 'design.md'), 'utf8');
    expect(md).not.toMatch(/Same-day slots|Approved on/);
    expect(md).toMatch(/Slot finder/);
    const h = await readHistory(await ideaDir(s.root, ID));
    expect(h.at(-1)).toMatchObject({ action: 'design', detail: 'Design started again', by: 'operator' });
  });

  it('leaves plan.md and the kit files alone and marks the plan out of date until it is written again', async () => {
    const s = await server();
    const dir = await ideaDir(s.root, ID);
    await writeFile(path.join(dir, 'plan.md'), '# Plan\n');
    await mkdir(path.join(dir, 'kit', 'power-apps'), { recursive: true });
    await writeFile(path.join(dir, 'kit', 'power-apps', 'README.md'), 'kit\n');
    const body = await json(await s.post(`/api/ideas/${ID}/design/redesign`));
    expect(body.planStale).toBe(true);
    expect(body.state.planStale).toBe('2026-10-20');
    expect(await readFile(path.join(dir, 'plan.md'), 'utf8')).toBe('# Plan\n');
    expect(await readFile(path.join(dir, 'kit', 'power-apps', 'README.md'), 'utf8')).toBe('kit\n');
    expect((await readHistory(dir)).at(-1)?.detail).toMatch(/^Design started again; the plan and kits are out of date/);
    // A new design, approved, and the plan written again: no longer out of date.
    await s.post(`/api/ideas/${ID}/design/step`, { force: true, question: 'What must it show?' });
    await s.post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Slots' });
    await s.post(`/api/ideas/${ID}/design/finish`, { force: true, summary: 'Shows slots.' });
    expect((await s.post(`/api/ideas/${ID}/design/approve`)).status).toBe(200);
    expect((await readDesign(s.root, ID)).planStale).toBe('2026-10-20');
    expect((await s.post(`/api/ideas/${ID}/plan`)).status).toBe(200);
    expect((await readDesign(s.root, ID)).planStale).toBeUndefined();
  });

  it('only in the Design series, only with questions; never moves the stage', async () => {
    const s = await server(4);
    const r = await s.post(`/api/ideas/${ID}/design/redesign`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toMatch(/Design series only/);
    expect((await loadIdea(s.root, ID)).stage).toBe(4);
    expect((await readDesign(s.root, ID)).summary).toBe('Shows same-day slots.');
    await saveIdea(s.root, { ...(await loadIdea(s.root, ID)), stage: 3 } as any);
    expect((await s.post(`/api/ideas/${ID}/design/redesign`)).status).toBe(200);
    const again = await s.post(`/api/ideas/${ID}/design/redesign`);
    expect(again.status).toBe(400);
    expect((await json(again)).error).toMatch(/nothing to start again/);
  });
});
