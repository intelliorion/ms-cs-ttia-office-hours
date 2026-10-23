import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea } from './helpers';
import { saveIdea, ideaDir } from '../src/ideas/store';
import { readDesign, writeDesign, emptyDesign, renderDesignMd, type DesignState } from '../src/design/store';
import { designStepInput } from '../src/design/brainstorm';
import { designStepTask } from '../src/ai/tasks';
import { designReadiness, toolDataStale } from '../src/design/ready';
import { renderApproachMd } from '../src/design/tools';
import { readHistory } from '../src/workspace/files';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';

const ID = 'CAFE-2026-001';
const json = (r: Response) => r.json() as Promise<any>;
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

const FILE = {
  id: 'f1', name: 'requests.csv', file: 'f1-requests.csv', kind: 'input', bytes: 100, type: 'table', at: '2026-10-18',
  steps: [{ id: 'saved', status: 'done', detail: 'Saved' }], tables: [{ name: 'requests', rows: 20, columns: [], examples: [], issues: [] }],
};
const SUMMARY = { text: 'Requests in, slots out.', input: '', output: '', knowledge: '', rules: '', gapsClosed: [], open: [], at: '2026-10-19' };
const data = (over: any = {}) => ({ files: [FILE], steps: [], summary: SUMMARY, confirmedAt: '2026-10-19', ...over }) as any;
const tool = (over: any = {}) => ({
  tool: 'Power Apps', pathway: 'Assisted Citizen', by: 'ai', reason: 'Forms', pros: [], cons: [], context: [], flags: [],
  fit: [{ feature: 'Slot finder', fit: 'yes', note: '' }], evaluatedFor: ['Slot finder'], dataFor: '2026-10-19', at: '2026-10-19', ...over,
}) as any;
const ready = (over: Partial<DesignState> = {}): DesignState => ({
  ...emptyDesign(), status: 'designing', features: [{ id: 'f', name: 'Slot finder', flags: [] }], tool: tool(), data: data(), ...over,
});
const gaps = (s: Partial<DesignState>) => designReadiness(s as any).items.filter((x) => !x.ok).map((x) => x.key);

describe('the readiness check (code decides)', () => {
  it('a fresh idea: every item missing, the data suggested first', () => {
    const r = designReadiness(emptyDesign());
    expect(r.ready).toBe(false);
    expect(r.items.map((x) => [x.key, x.ok])).toEqual([['data', false], ['features', false], ['tool', false], ['waiting', true]]);
    expect(r.missing).toEqual(['the confirmed data', 'the feature list', 'a picked tool']);
    expect(r.next).toEqual({ go: 'data', text: 'Next: understand the data — drop the sample input and output.' });
  });
  it('all clear: ready, nothing missing, no next step', () => {
    const r = designReadiness(ready());
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.next).toBeUndefined();
    expect(r.items.every((x) => x.ok)).toBe(true);
  });
  it('the data: no file, not complete, complete but not confirmed, an open data question', () => {
    expect(designReadiness(ready({ data: undefined })).items[0].text).toMatch(/No data yet/);
    expect(designReadiness(ready({ data: data({ confirmedAt: undefined, summary: undefined }) })).next!.text).toBe('Next: understand the data — ask the next data question, or finish it by hand.');
    expect(designReadiness(ready({ data: data({ confirmedAt: undefined }) })).next!.text).toBe('Next: understand the data — check the understanding and press Looks right.');
    const q = designReadiness(ready({ data: data({ confirmedAt: undefined, summary: undefined, steps: [{ n: 2, question: 'Which columns?', suggested: [], source: 'ai-suggested' }] }) }));
    expect(q.next!.text).toBe('Next: understand the data — answer data question D2.');
    // A held file is not part of the understanding: alone it is no data.
    expect(gaps(ready({ data: data({ files: [{ ...FILE, check: { status: 'held', findings: [], masked: [], notes: [] } }] }) }))).toEqual(['data']);
  });
  it('the tool: none, not evaluated, features changed, fit changed by the design, a to-do item open or answered', () => {
    expect(designReadiness(ready({ tool: undefined })).next!.text).toBe('Next: features and tool — pick the one tool.');
    expect(designReadiness(ready({ tool: tool({ needsAi: true }) })).items[2].gap).toBe("the tool's evaluation");
    expect(designReadiness(ready({ features: [{ id: 'f', name: 'Slot finder', flags: [] }, { id: 'g', name: 'Reminders', flags: [] }] })).next!.text)
      .toBe('Next: features and tool — re-evaluate Power Apps for the new features.');
    expect(gaps(ready({ tool: tool({ fit: [{ feature: 'Slot finder', fit: 'yes', note: '', stale: true }] }) }))).toEqual(['tool']);
    const need = { id: 'n1', need: 'Volumes', ask: 'How many requests a week?', met: false };
    expect(designReadiness(ready({ toolPrep: { at: '2026-10-19', needs: [need] } })).next!.text).toBe("Next: features and tool — clear the tool's to-do list: Volumes.");
    expect(designReadiness(ready({ toolPrep: { at: '2026-10-19', needs: [{ ...need, answer: 'About 50' }] } })).items[2].text).toMatch(/1 answer in, not checked yet/);
    // An emailed answer counts as in.
    expect(designReadiness(ready({ toolPrep: { at: '2026-10-19', needs: [need] } }), { answers: [{ question: 'How many requests a week?', answer: '50' }] }).items[2].todo).toMatch(/re-evaluate/);
    expect(gaps(ready({ toolPrep: { at: '2026-10-19', needs: [{ ...need, met: true }] } }))).toEqual([]);
    expect(designReadiness(ready({ tool: tool({ tool: 'UiPath' }) })).items[2].todo).toBe('pick another tool');
  });
  it('the order fits the idea: a gap that only waits on the team comes after one that can be done now', () => {
    const asked = { n: 1, question: 'Which columns?', suggested: [], source: 'ai-suggested', askedTeam: { emailKey: 'k' } };
    const r = designReadiness(ready({ features: [], tool: undefined, data: data({ steps: [asked] }) }));
    expect(r.items.find((x) => x.key === 'waiting')).toMatchObject({ ok: false, waitsOnTeam: true });
    expect(r.next!.go).toBe('features');
    // Only the team's reply left: that is the next step.
    expect(designReadiness(ready({ data: data({ steps: [asked] }) })).next!.text).toBe("Next: understand the data — wait for the team's reply to D1, or answer it yourself.");
  });
  it('features first, data later: confirming the data puts the tool evaluation out of date until it is evaluated again', () => {
    const before = ready({ data: undefined, tool: tool({ dataFor: '' }) });
    expect(toolDataStale(before)).toBe(false);
    const after = { ...before, data: data({ confirmedAt: '2026-10-20' }) };
    expect(toolDataStale(after)).toBe(true);
    expect(designReadiness(after).next!.text).toBe('Next: features and tool — re-evaluate Power Apps with the confirmed data.');
    expect(renderApproachMd(sampleIdea() as any, after)).toMatch(/The data was confirmed after the tool was evaluated/);
    expect(toolDataStale({ ...after, tool: tool({ dataFor: '2026-10-20' }) })).toBe(false);
    // Data first: the evaluation saw it.
    expect(toolDataStale(ready())).toBe(false);
    // An older choice (no dataFor) evaluated on or after the confirmation saw it; one before did not.
    expect(toolDataStale(ready({ tool: tool({ dataFor: undefined, at: '2026-10-19' }) }))).toBe(false);
    expect(toolDataStale(ready({ tool: tool({ dataFor: undefined, at: '2026-10-18' }) }))).toBe(true);
  });
});

async function server(state: DesignState) {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
  close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
  const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await saveIdea(s.root, sampleIdea({ stage: 3, challenge: 'Requests arrive by email.', outcomes: ['Same-day scheduling'] }) as any);
  await writeDesign(s.root, ID, state);
  return { ...s, post };
}

describe('the design-step route applies the same check', () => {
  it('with gaps and no force: refused with the missing list; nothing is asked or saved', async () => {
    const s = await server(ready({ data: undefined }));
    const r = await s.post(`/api/ideas/${ID}/design/step`);
    expect(r.status).toBe(400);
    const body = await json(r);
    expect(body.error).toMatch(/^Not ready for the design: missing the confirmed data\. Do those first, or press Design anyway\.$/);
    expect(body.missing).toEqual(['the confirmed data']);
    expect((await s.post(`/api/ideas/${ID}/design/step`, { question: 'What must it show?' })).status).toBe(400);
    expect((await s.post(`/api/ideas/${ID}/design/finish`, { summary: 'Shows slots.' })).status).toBe(400);
    expect((await readDesign(s.root, ID)).steps).toEqual([]);
  });
  it('Design anyway (force): recorded with what was missing, in design.yaml, design.md and the history; the questions aim at the gaps', async () => {
    const s = await server(ready({ data: undefined, features: [], tool: undefined }));
    const r = await json(await s.post(`/api/ideas/${ID}/design/step`, { force: true }));
    expect(r.step.n).toBe(1);
    const st = await readDesign(s.root, ID);
    expect(st.forcedAt).toBe('2026-10-20');
    expect(st.forcedMissing).toEqual(['the confirmed data', 'the feature list', 'a picked tool']);
    const md = await readFile(path.join(await ideaDir(s.root, ID), 'design.md'), 'utf8');
    expect(md).toContain('**Designed before: the confirmed data; the feature list; a picked tool. The design was started anyway, without them.** (Design anyway, 2026-10-20.)');
    const h = await readHistory(await ideaDir(s.root, ID));
    expect(h.find((x: any) => x.detail?.startsWith('Design anyway'))).toMatchObject({ action: 'design', by: 'operator', detail: 'Design anyway: started before the confirmed data; the feature list; a picked tool' });
    // The next question is not checked again (the design has started); the gaps ride along to the AI.
    await s.post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Slots' });
    expect((await s.post(`/api/ideas/${ID}/design/step`)).status).toBe(200);
    const input = designStepInput(sampleIdea() as any, await readDesign(s.root, ID));
    expect(input.missing).toEqual(['the confirmed data', 'the feature list', 'a picked tool']);
    expect(designStepTask.prompt(input)).toMatch(/"missing" is what was not there when the operator started the design anyway/);
    expect(designStepTask.prompt(designStepInput(sampleIdea() as any, ready()))).not.toMatch(/"missing" is what/);
    // Redesign starts again: the new design meets the check again.
    await s.post(`/api/ideas/${ID}/design/redesign`);
    const again = await readDesign(s.root, ID);
    expect(again.forcedAt).toBeUndefined();
    expect(again.forcedMissing).toBeUndefined();
    expect((await s.post(`/api/ideas/${ID}/design/step`)).status).toBe(400);
  });
  it('all clear: the design starts with no force and nothing is recorded as forced', async () => {
    const s = await server(ready());
    const r = await s.post(`/api/ideas/${ID}/design/step`);
    expect(r.status).toBe(200);
    expect((await readDesign(s.root, ID)).forcedAt).toBeUndefined();
    expect(renderDesignMd(sampleIdea() as any, await readDesign(s.root, ID))).not.toMatch(/Designed before/);
  });
  it('an evaluation records the data it saw: none, then the confirmation', async () => {
    const s = await server(ready({ data: undefined }));
    const r = await json(await s.post(`/api/ideas/${ID}/tools/suggest`, {}));
    expect(r.tool.dataFor).toBe('');
    await writeDesign(s.root, ID, ready());
    expect((await json(await s.post(`/api/ideas/${ID}/tools/suggest`, {}))).tool.dataFor).toBe('2026-10-19');
    // Saved as sent: the save keeps it, so the design does not see a changed tool.
    await s.post(`/api/ideas/${ID}/tools`, { features: [{ name: 'Slot finder' }], tool: r.tool });
    expect((await readDesign(s.root, ID)).tool!.dataFor).toBe('');
  });
  it('force on an idea that is ready records nothing', async () => {
    const s = await server(ready());
    await s.post(`/api/ideas/${ID}/design/step`, { force: true, question: 'What must it show?' });
    expect((await readDesign(s.root, ID)).forcedAt).toBeUndefined();
  });
});
