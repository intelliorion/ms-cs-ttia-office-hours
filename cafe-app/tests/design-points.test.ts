import { describe, it, expect, afterEach, vi } from 'vitest';
import { startServer, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { readDesign, renderDesignMd, emptyDesign, loadSkill, type DesignState } from '../src/design/store';
import { reduceDesign } from '../src/design/brainstorm';
import { BUILD_TAGS, DESIGN_TAGS, openBuildPoints, pointOf } from '../src/design/points';
import { createConnector } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { designStepTask, DESIGN_STEP_SCHEMA } from '../src/ai/tasks';
import { fixedClock } from '../src/clock';

const ID = 'CAFE-2026-001';
const clock = fixedClock('2026-10-20');
const NO_UPDATES = { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } };
const json = (r: Response) => r.json() as Promise<any>;
let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); close = undefined; vi.unstubAllEnvs(); });

const idea = sampleIdea({ stage: 3, title: 'Expense check', outcomes: [] });
const design = (over: Partial<DesignState> = {}): DesignState => ({ ...emptyDesign(), status: 'designing', ...over });

describe('the build points', () => {
  it('are design tags the AI may use, after the five points', () => {
    expect(DESIGN_TAGS).toEqual(['must-show', 'smallest-input', 'users', 'replaces', 'builder', 'input-shape', 'logic', 'output', 'done-when', 'environment']);
    expect((DESIGN_STEP_SCHEMA.properties!.tag.enum as unknown[])).toEqual([...DESIGN_TAGS, null]);
    const ok = designStepTask.parse(JSON.stringify({ done: false, question: 'Which columns?', suggested: ['A', 'B'], tag: 'output', updates: NO_UPDATES, learned: [] }));
    expect(ok.tag).toBe('output');
  });

  it('the prompt asks for the build points concretely, in about 8 questions, and for "settled" when done', () => {
    const p = designStepTask.prompt({ idea: { id: ID, title: 'x' }, features: [], stepsSoFar: [], guidance: loadSkill('cafe-design') });
    for (const t of BUILD_TAGS) expect(p).toContain(`tag "${t}"`);
    expect(p).toMatch(/about 8 questions/);
    expect(p).toMatch(/five points AND the five build points/);
    expect(p).toMatch(/settled: for each point no question/);
    expect(loadSkill('cafe-design')).toMatch(/\*\*Done when\*\*: a seeded sample/);
  });

  it('a done reply carries what the earlier answers settle: design tags only, one line each; anything else is dropped', () => {
    const out = designStepTask.parse(JSON.stringify({
      done: true, summary: 'Shows X', updates: NO_UPDATES, learned: [],
      settled: { 'input-shape': 'A CSV of\nclaims', logic: '  ', budget: 'ignored' },
    }));
    expect(out.settled).toEqual({ 'input-shape': 'A CSV of claims' });
    const open = designStepTask.parse(JSON.stringify({ done: false, question: 'Q?', updates: NO_UPDATES, learned: [], settled: { logic: 'x' } }));
    expect(open.settled).toBeUndefined();
  });

  it('a point is read from its tagged answers (several join), else from settled; a new question clears settled', () => {
    const steps = [
      { n: 1, question: 'Rule?', suggested: [], source: 'operator' as const, tag: 'logic' as const, answer: 'Weekend dates on weekday policies' },
      { n: 2, question: 'Exceptions?', suggested: [], source: 'operator' as const, tag: 'logic' as const, answer: 'Travel days are fine' },
    ];
    const s = design({ steps, settled: { output: 'A flagged list in Excel', logic: 'not used' } });
    expect(pointOf(s, 'logic')).toBe('Weekend dates on weekday policies; Travel days are fine');
    expect(pointOf(s, 'output')).toBe('A flagged list in Excel');
    expect(openBuildPoints(s)).toEqual(['input-shape', 'done-when', 'environment']);
    const done = reduceDesign(s, { t: 'done', summary: 'Shows it', settled: { environment: 'The team project', nope: 'x' } }, clock).state;
    expect(done.settled).toEqual({ environment: 'The team project' });
    const reopened = reduceDesign(done, { t: 'step', question: 'One more?', suggested: [], source: 'operator' }, clock).state;
    expect(reopened.settled).toBeUndefined();
    expect(reopened.summary).toBeUndefined();
  });

  it('design.md has a section for each build point, "(not yet answered)" where open, and the smallest input from settled', () => {
    const md = renderDesignMd(idea, design({
      summary: 'Shows the check on a sample.',
      settled: { 'smallest-input': 'A masked export of one month', 'input-shape': 'CSV: claim id, date, policy, amount', 'done-when': 'Five planted claims all flagged' },
    }));
    expect(md).toMatch(/## Smallest input\n\nA masked export of one month/);
    expect(md).toMatch(/## Input\n\nCSV: claim id, date, policy, amount/);
    expect(md).toMatch(/## Logic\n\n\(not yet answered\)/);
    expect(md).toMatch(/## Done when\n\nFive planted claims all flagged/);
    expect(md).toMatch(/## Environment\n\n\(not yet answered\)/);
    expect(md).toMatch(/- \*\*Who uses it\*\*: \(not yet answered\)/);
  });
});

describe('the design runs until it is build-ready (fake AI)', () => {
  it('the done reply\'s settled points land in design.yaml and design.md', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await saveIdea(s.root, sampleIdea({ stage: 3, challenge: 'Requests arrive by email.' }));
    for (let n = 1; n <= 3; n++) {
      await post(`/api/ideas/${ID}/design/step`);
      await post(`/api/ideas/${ID}/design/answer`, { n, suggestedIndex: 0 });
    }
    const done = await json(await post(`/api/ideas/${ID}/design/step`));
    expect(done.state.summary).toBeTruthy();
    const st = await readDesign(s.root, ID);
    expect(Object.keys(st.settled ?? {})).toEqual(['input-shape', 'logic', 'output', 'done-when', 'environment']);
    expect(done.designMd).toMatch(/## Input\n\nTwenty made-up requests in one sheet/);
    expect(done.designMd).toMatch(/## Done when\n\nFive planted requests/);
    expect(done.designMd).not.toMatch(/## (Input|Logic|Output|Done when|Environment)\n\n\(not yet answered\)/);
  });
});
