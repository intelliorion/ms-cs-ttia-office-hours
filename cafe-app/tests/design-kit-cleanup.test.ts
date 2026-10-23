import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, ideaDir } from '../src/ideas/store';
import { emptyDesign, type DesignState, type ToolChoice } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { writePlan, readPlan, removeOlderKitFiles, WRITTEN_FILE } from '../src/design/kits';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { readHistory } from '../src/workspace/files';
import type { DesignPlanOutput } from '../src/ai/tasks';

const ID = 'CAFE-2026-001';
const toolOf = (tool: string): ToolChoice => ({
  tool, pathway: pathwayOf(tool), by: 'operator', reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '2026-10-20',
});
const state = (tool: string): DesignState => ({
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Flags weekend claims.',
  features: [{ id: 'flag', name: 'Weekend flag', what: 'Flags weekend claims', flags: [] }], tool: toolOf(tool), steps: [],
});
const PLAN: DesignPlanOutput = { tasks: [], risks: [] };
const there = (f: string) => access(f).then(() => true, () => false);

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

describe('kit files the app wrote before', () => {
  it('writing again takes away only the app\'s own files the new layout does not write, and a folder it leaves empty', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ id: ID });
    await saveIdea(root, idea);
    const dir = await ideaDir(root, ID);
    const first = await writePlan(root, idea, state('Power Apps'), PLAN);
    expect(first.removed).toEqual([]);
    const list = JSON.parse(await readFile(path.join(dir, ...WRITTEN_FILE.split('/')), 'utf8'));
    expect(list.files).toEqual(first.files.filter((f) => f.startsWith('kit/')));
    // The operator's own note in the old tool's folder, and the agent's work in it, stay.
    await writeFile(path.join(dir, 'kit', 'power-apps', 'notes.md'), 'Mine\n');
    // The tool changes: the Power Apps kit files the app wrote go; the note keeps its folder.
    const second = await writePlan(root, idea, state('Copilot Studio'), PLAN);
    expect(second.removed).toEqual(['kit/power-apps/README.md', 'kit/power-apps/data-model.md', 'kit/power-apps/screens.md', 'kit/power-apps/test-checklist.md']);
    expect(await readdir(path.join(dir, 'kit', 'power-apps'))).toEqual(['notes.md']);
    // Once more with another tool: the Copilot Studio folder had only app files, so it goes whole.
    const third = await writePlan(root, idea, state('Microsoft Copilot'), PLAN);
    expect(third.removed).toContain('kit/copilot-studio/skills.md');
    expect(await there(path.join(dir, 'kit', 'copilot-studio'))).toBe(false);
    expect(await readFile(path.join(dir, 'kit', 'power-apps', 'notes.md'), 'utf8')).toBe('Mine\n');
    // The list itself is not one of the pack's files.
    expect((await readPlan(root, ID)).files).not.toContain(WRITTEN_FILE);
  });

  it('an idea written before the list: names the kits used to have are "older kit files" (kept until the operator removes them); nothing else is', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ id: ID });
    await saveIdea(root, idea);
    const dir = await ideaDir(root, ID);
    await mkdir(path.join(dir, 'kit', 'copilot-studio'), { recursive: true });
    await mkdir(path.join(dir, 'kit', 'custom-app'), { recursive: true });
    await writeFile(path.join(dir, 'kit', 'copilot-studio', 'topics.md'), 'old outline\n');
    await writeFile(path.join(dir, 'kit', 'copilot-studio', 'my-notes.md'), 'mine\n');
    await writeFile(path.join(dir, 'kit', 'custom-app', 'RUN.md'), 'the agent wrote this\n');
    const out = await writePlan(root, idea, state('Copilot Studio'), PLAN);
    expect(out.removed).toEqual([]);
    expect(out.older).toEqual(['kit/copilot-studio/topics.md']);
    expect((await readPlan(root, ID)).older).toEqual(['kit/copilot-studio/topics.md']);
    // Writing again keeps them listed, still not removed.
    expect((await writePlan(root, idea, state('Copilot Studio'), PLAN)).older).toEqual(['kit/copilot-studio/topics.md']);
    expect(await there(path.join(dir, 'kit', 'copilot-studio', 'topics.md'))).toBe(true);
    expect(await removeOlderKitFiles(root, ID)).toEqual({ removed: ['kit/copilot-studio/topics.md'] });
    expect(await there(path.join(dir, 'kit', 'copilot-studio', 'topics.md'))).toBe(false);
    expect(await readFile(path.join(dir, 'kit', 'copilot-studio', 'my-notes.md'), 'utf8')).toBe('mine\n');
    expect(await readFile(path.join(dir, 'kit', 'custom-app', 'RUN.md'), 'utf8')).toBe('the agent wrote this\n');
    expect((await readPlan(root, ID)).older).toBeUndefined();
  });

  it('a list edited to point outside kit/ removes nothing there', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ id: ID });
    await saveIdea(root, idea);
    const dir = await ideaDir(root, ID);
    await writePlan(root, idea, state('Power Apps'), PLAN);
    await writeFile(path.join(dir, ...WRITTEN_FILE.split('/')), JSON.stringify({ files: ['idea.yaml', 'kit/../idea.yaml', 'design.md'], older: ['plan.md'] }));
    const out = await writePlan(root, idea, state('Power Apps'), PLAN);
    expect(out.removed).toEqual([]);
    expect(await there(path.join(dir, 'idea.yaml'))).toBe(true);
    expect((await removeOlderKitFiles(root, ID)).removed).toEqual([]);
    expect(await there(path.join(dir, 'plan.md'))).toBe(true);
  });

  it('the route: Remove older kit files is the operator\'s, logged in the idea\'s history', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const idea = sampleIdea({ id: ID });
    await saveIdea(s.root, idea);
    const dir = await ideaDir(s.root, ID);
    await mkdir(path.join(dir, 'kit', 'uipath'), { recursive: true });
    await writeFile(path.join(dir, 'kit', 'uipath', 'process.md'), 'old\n');
    await writePlan(s.root, idea, state('Dataiku'), PLAN);
    const r = await (await fetch(`${s.base}/api/ideas/${ID}/plan/remove-older`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as any;
    expect(r.removed).toEqual(['kit/uipath/process.md']);
    expect(r.files).not.toContain('kit/uipath/process.md');
    expect((await readHistory(dir)).at(-1)).toMatchObject({ action: 'kit-cleanup', by: 'operator', detail: 'Older kit files removed: kit/uipath/process.md' });
  });
});
