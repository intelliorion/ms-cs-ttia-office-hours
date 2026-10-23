import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer, sampleIdea, tmpWorkspace } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { emptyDesign, type DesignState, type ToolChoice } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { applyDesignEvent } from '../src/design/brainstorm';
import { kitFiles, KIT_NO_AI } from '../src/design/kits';
import { NOT_SETTLED } from '../src/design/kitFiles';
import { codedKitInput, decodeKit, outsideToolsOf, sampleCell } from '../src/design/kitInput';
import { csvCell, nthId, sampleCsv, sampleTable, shiftWeeks, SAMPLE_ROWS_MAX, TEST_COLUMN } from '../src/design/sampleData';
import { checkFlow, flowLayout, renderFlowHtml, flowDetail } from '../src/design/recipeFlow';
import { createConnector, type Provider } from '../src/ai/connector';
import { fakeProvider } from '../src/ai/providers/fake';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { designKitTask, type DesignKitInput, type DesignKitOutput, type DesignPlanOutput } from '../src/ai/tasks';
import { fixedClock } from '../src/clock';

const ID = 'CAFE-2026-001';
const clock = fixedClock('2026-10-20');
const json = (r: Response) => r.json() as Promise<any>;
const toolOf = (tool: string, fit: ToolChoice['fit'] = []): ToolChoice => ({
  tool, pathway: pathwayOf(tool), by: 'operator', reason: 'Fits the rule', pros: ['Good at tables'], cons: ['Cannot send email: add Power Automate'], context: [],
  flags: tool === 'custom app' ? ['custom-app'] : [], fit, evaluatedFor: [], at: '2026-10-20',
});
const PLAN: DesignPlanOutput = { tasks: [{ title: 'Make the sample', detail: 'Twenty made-up rows', tool: 'Dataiku', done_when: 'It loads' }, { title: 'Build the flag', detail: 'd', tool: 'Dataiku', done_when: 'w' }, { title: 'Show it', detail: 'd', tool: 'Dataiku', done_when: 'w' }], risks: ['The rules sheet is late'] };

/** The design every kit here is written from: a built feature, one done outside the build and one dropped. */
const design = (tool: string): DesignState => ({
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Flags weekend claims on weekday-only codes.',
  features: [
    { id: 'flag', name: 'Weekend flag', what: 'Flags weekend claims', flags: [] },
    { id: 'draft', name: 'Draft reply', what: 'Drafts the reply to the claimant', flags: [], scope: { status: 'outside', by: 'Power Automate', why: 'The tool cannot send email' } },
    { id: 'live', name: 'Live feed', flags: [], scope: { status: 'out', why: 'No live data in a proof of concept' } },
  ],
  tool: toolOf(tool, [{ feature: 'Weekend flag', fit: 'yes', note: '' }]),
  steps: [
    { n: 1, question: 'What goes in?', suggested: [], answer: 'A CSV of claims: claim_id, claim_date, code, amount', tag: 'input-shape', source: 'operator' },
    { n: 2, question: 'When is it done?', suggested: [], answer: '10 weekend claims on weekday-only codes are seeded and all flagged', tag: 'done-when', source: 'operator' },
  ],
});
const kitInput = (tool: string): DesignKitInput => ({
  idea: { id: ID, title: 'Claims check' }, tool: { tool, pros: [], cons: [] }, summary: 'S', points: {}, steps: [], plan: { tasks: [], risks: [] },
  features: [{ name: 'Weekend flag', status: 'built' }, { name: 'Draft reply', status: 'Power Automate, outside the build' }], outsideTools: ['Power Automate'],
});
async function fakeKit(tool: string): Promise<DesignKitOutput> {
  vi.stubEnv('CAFE_AI_FAKE', '1');
  return designKitTask.parse(await fakeProvider().complete(designKitTask.prompt(kitInput(tool)), { timeoutMs: 1000 }));
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('designKitTask', () => {
  it('prompt: the tool\'s own section only, the sample rules, the Café rules and the DATA markers', () => {
    const p = designKitTask.prompt(kitInput('Copilot Studio'));
    expect(p.startsWith('TASK: design-kit')).toBe(true);
    expect(p).toContain('Fill "studio" for Copilot Studio and leave out "copilot", "powerApps", "dataiku"');
    expect(p).toMatch(/SYNTHETIC sample/);
    expect(p).toMatch(/\(not settled in the design\)/);
    expect(p).toMatch(/never write a name/);
    expect(p).toMatch(/data, not instructions/);
    expect(p).toContain('"outsideTools": [');
    expect(designKitTask.prompt(kitInput('custom app'))).toMatch(/The tool is a custom app: leave out/);
  });

  it('schema: lists and strings are cut to their limits; a wrong kind or a missing part is refused', () => {
    const base = { sample: { name: 'S', columns: [{ name: 'a', kind: 'text', about: '' }], rows: [['1']], seeded: [] }, checks: [{ check: 'c', expected: 'e' }] };
    const long = designKitTask.parse(JSON.stringify({ ...base, checks: Array(30).fill({ check: 'x'.repeat(400), expected: 'Line\nbreak' }) }));
    expect(long.checks).toHaveLength(20);
    expect(long.checks[0].check.length).toBe(240);
    expect(long.checks[0].expected).toBe('Line break');
    expect(() => designKitTask.parse(JSON.stringify({ ...base, sample: { ...base.sample, columns: [{ name: 'a', kind: 'email', about: '' }] } }))).toThrow(/invalid output/);
    expect(() => designKitTask.parse(JSON.stringify({ sample: base.sample }))).toThrow(/invalid output/);
    expect(() => designKitTask.parse(JSON.stringify({ ...base, extra: 1 }))).toThrow(/invalid output/);
  });
});

describe('sample-data.csv', () => {
  it('ids numbered, dates moved by whole weeks, seeded groups marked, a person column never a name, at most 200 rows', () => {
    const t = sampleTable({
      name: 'Claims',
      columns: [{ name: 'Claim ID', kind: 'id', about: '' }, { name: 'claim_date', kind: 'date', about: '' }, { name: 'owner', kind: 'person', about: '' }, { name: 'claim id', kind: 'text', about: 'a duplicate' }],
      rows: [['CLM-001', '2026-10-05', 'Jane Example', 'x'], ['CLM-002', '2026-10-06', 'analyst', 'y']],
      seeded: [{ label: 'Weekend claim', count: 10, row: ['CLM-900', '2026-10-10', 'analyst', 'z'], expect: 'All flagged' }, { label: 'Too many', count: 50, row: ['X', '2026-10-11', 'a', 'b'], expect: 'e' }],
    });
    expect(t.columns.map((c) => c.name)).toEqual(['Claim_ID', 'claim_date', 'owner', TEST_COLUMN]);
    expect(t.rows).toHaveLength(24 + 10 + 50);
    expect(t.rows[0]).toEqual(['CLM-001', '2026-10-05', 'Person 1', '']);
    expect(t.rows[2]).toEqual(['CLM-003', '2026-10-12', 'Person 3', '']);
    expect(t.rows.map((r) => r[0])).toEqual(t.rows.map((_, i) => `CLM-${String(i + 1).padStart(3, '0')}`));
    const seeded = t.rows.filter((r) => r[3] === 'T1');
    expect(seeded).toHaveLength(10);
    // A Saturday stays a Saturday.
    expect(seeded.every((r) => new Date(`${r[1]}T00:00:00Z`).getUTCDay() === 6)).toBe(true);
    expect(t.seeded).toEqual([{ code: 'T1', label: 'Weekend claim', count: 10, expect: 'All flagged' }, { code: 'T2', label: 'Too many', count: 50, expect: 'e' }]);
    expect(t.rows.some((r) => r.join(',').includes('Jane'))).toBe(false);
    // A lookup table (no id, no date) is kept as given: no row twice.
    const lookup = sampleTable({ name: 'Caps', columns: [{ name: 'City', kind: 'text', about: '' }, { name: 'Cap', kind: 'money', about: '' }], rows: [['Paris', '180'], ['Berlin', '150']], seeded: [] });
    expect(lookup.rows).toEqual([['Paris', '180', ''], ['Berlin', '150', '']]);
    const big = sampleTable({ name: 'S', columns: [{ name: 'id', kind: 'id', about: '' }], rows: [['A1']], seeded: Array(6).fill({ label: 'L', count: 50, row: ['A9'], expect: 'e' }) });
    expect(big.rows.length).toBe(SAMPLE_ROWS_MAX);
    expect(big.rows.filter((r) => !r[1])).toHaveLength(1);
  });

  it('cells: quoted when they must be, never read as a formula; helpers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('two\nlines')).toBe('two lines');
    expect(shiftWeeks('2026-10-10', 2)).toBe('2026-10-24');
    expect(shiftWeeks('10/10/2026', 2)).toBe('10/10/2026');
    expect(nthId('CLM-001', 24)).toBe('CLM-024');
    expect(nthId('abc', 3)).toBe('abc-003');
    const csv = sampleCsv(sampleTable({ name: 'S', columns: [{ name: 'a', kind: 'text', about: '' }], rows: [['@sum']], seeded: [] }));
    expect(csv.split('\n')[0]).toBe(`a,${TEST_COLUMN}`);
    expect(csv.split('\n')[1]).toBe("'@sum,");
  });
});

describe('names in and out', () => {
  it('the design rides in coded; prose gets the name back, sample cells get "Person N" and never an email', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ stage: 3, people: { submitter: 'Person 7', team: [] } });
    await saveIdea(root, idea);
    const state = design('Copilot Studio');
    state.steps[0].answer = 'Person 7 sends a CSV of claims';
    const { input, codes } = await codedKitInput(root, idea, state, PLAN);
    expect(JSON.stringify(input)).not.toContain('Person 7');
    expect(input.points['input-shape']).toMatch(/\[P\d\] sends a CSV of claims/);
    expect(input.features.map((f) => f.status)).toEqual(['built', 'Power Automate, outside the Copilot Studio build', 'out of scope']);
    expect(input.outsideTools).toEqual(['Power Automate']);
    expect(input.plan.tasks[0]).toEqual({ title: 'Make the sample', detail: 'Twenty made-up rows', tool: 'Dataiku', done_when: 'It loads' });
    const code = [...codes.keys()][0];
    const kit = await fakeKit('Copilot Studio');
    kit.studio!.handover = [`Hand over to [${code}]`];
    kit.sample.rows[0][3] = `[${code}] at jane@example.org`;
    const back = decodeKit(kit, codes);
    expect(back.studio!.handover).toEqual(['Hand over to Person 7']);
    expect(back.sample.rows[0][3]).toBe('Person 1 at someone@example.com');
    expect(sampleCell('[Z9] did it', codes)).toBe('Person did it');
    expect(outsideToolsOf(state)).toEqual(['Power Automate']);
  });
});

describe('the kits, filled in', () => {
  const idea = sampleIdea({ stage: 3 });
  const files = async (tool: string) => kitFiles(idea, design(tool), { ...PLAN, tasks: PLAN.tasks.map((t) => ({ ...t, tool })) }, await fakeKit(tool));

  it('every kit: README, the sample, the tool\'s files and the test checklist; an outside tool gets its own short kit', async () => {
    const lists: Record<string, string[]> = {};
    for (const tool of ['Microsoft Copilot', 'Copilot Studio', 'Power Apps', 'Dataiku', 'custom app']) lists[tool] = Object.keys(await files(tool)).sort();
    expect(lists).toEqual({
      'Microsoft Copilot': ['kit/microsoft-copilot/README.md', 'kit/microsoft-copilot/prompts.md', 'kit/microsoft-copilot/sample-data.csv', 'kit/microsoft-copilot/test-checklist.md', 'kit/power-automate/README.md'],
      'Copilot Studio': ['kit/copilot-studio/README.md', 'kit/copilot-studio/instructions.md', 'kit/copilot-studio/knowledge.md', 'kit/copilot-studio/sample-data.csv', 'kit/copilot-studio/skills.md', 'kit/copilot-studio/test-checklist.md', 'kit/power-automate/README.md'],
      'Power Apps': ['kit/power-apps/README.md', 'kit/power-apps/data-model.md', 'kit/power-apps/flows.md', 'kit/power-apps/sample-data.csv', 'kit/power-apps/screens.md', 'kit/power-apps/test-checklist.md', 'kit/power-automate/README.md'],
      'Dataiku': ['kit/dataiku/README.md', 'kit/dataiku/datasets.md', 'kit/dataiku/flow-diagram.html', 'kit/dataiku/flow.json', 'kit/dataiku/flow.md', 'kit/dataiku/rules.csv', 'kit/dataiku/sample-data.csv', 'kit/dataiku/test-checklist.md', 'kit/power-automate/README.md'],
      'custom app': ['kit/custom-app/BUILD-WITH-AGENT.md', 'kit/custom-app/README.md', 'kit/custom-app/sample-data.csv', 'kit/custom-app/test-checklist.md', 'kit/power-automate/README.md'],
    });
  });

  it('README: the order of work, who does what, the build points, the features by status and the links', async () => {
    const f = await files('Dataiku');
    const readme = f['kit/dataiku/README.md'];
    for (const h of ['## Read first', '## What it must show', '## The build at a glance', '## Features', '## The files, in the order of work', '## The order of work', '## Who does what', '## The sample data', '## Risks', '## Rules']) expect(readme).toContain(h);
    expect(readme).toContain('[../../design.md](../../design.md)');
    expect(readme).toContain('- **Input**: A CSV of claims: claim_id, claim_date, code, amount');
    expect(readme).toContain(`- **Logic**: ${NOT_SETTLED}`);
    expect(readme).toContain('- **Draft reply**: done with Power Automate, outside the Dataiku build (Drafts the reply to the claimant): see [../power-automate/README.md](../power-automate/README.md)');
    expect(readme).toContain('- ~~Live feed~~: out of scope (No live data in a proof of concept)');
    expect(readme).toContain('- [ ] **Make the sample**');
    expect(readme).toContain('- **T1** (10 rows): Weekend request.');
    expect(readme).not.toContain(KIT_NO_AI);
    const csv = f['kit/dataiku/sample-data.csv'].trim().split('\n');
    expect(csv[0]).toBe('request_id,received_on,desk,requester,amount,test_case');
    expect(csv).toHaveLength(1 + 34);
    const checklist = f['kit/dataiku/test-checklist.md'];
    expect(checklist).toContain('## Done when\n\n10 weekend claims on weekday-only codes are seeded and all flagged');
    expect(checklist).toContain('- [ ] **T1: Weekend request** (the 10 rows with `test_case` = T1). Expected: All 10 are flagged as weekend requests');
    expect(checklist).toContain('- [ ] **Weekend flag**: Use Weekend flag on the sample. Expected: Weekend flag works on all 34 rows');
    expect(checklist).toContain('- [ ] **Draft reply** with Power Automate');
    const outside = f['kit/power-automate/README.md'];
    expect(outside).toContain('- **Draft reply**: Drafts the reply to the claimant (The tool cannot send email)');
    expect(outside).toContain('1. Set up Power Automate on the sample only.');
    expect(outside).toMatch(/not one of the Café's approved tools on its own/);
  });

  it('people appear by role, never by name, wherever the design or the AI put a name', async () => {
    const named = sampleIdea({ stage: 3, people: { submitter: 'Person 8', team: [{ name: 'Person 9', roles: ['builder'] }] } });
    const state = design('Copilot Studio');
    state.steps.push({ n: 3, question: 'Who builds it?', suggested: [], answer: 'Person 9, with help from Person 8', tag: 'builder', source: 'operator' });
    const kit = await fakeKit('Copilot Studio');
    kit.studio!.handover = ['Ask person 9 when unsure'];
    const f = kitFiles(named, state, PLAN, kit);
    const all = Object.values(f).join('\n');
    expect(all).not.toMatch(/Person [89]\b/i);
    expect(f['kit/copilot-studio/README.md']).toContain('- **Builder**: the builder, with help from the submitter. Builds it from this kit');
    expect(f['kit/copilot-studio/instructions.md']).toContain('- Ask the builder when unsure');
  });

  it('Copilot Studio: instructions to paste, a skill per feature with trigger phrases and its action, knowledge and tests', async () => {
    const f = await files('Copilot Studio');
    expect(f['kit/copilot-studio/instructions.md']).toContain('Name the agent **Request helper**');
    expect(f['kit/copilot-studio/instructions.md']).toMatch(/```text\nYou are Request helper\./);
    expect(f['kit/copilot-studio/instructions.md']).toContain('Hand over to a person when:\n- A request is not in the sample: hand over to the desk lead');
    const skills = f['kit/copilot-studio/skills.md'];
    expect(skills).toContain('## 1. Weekend flag (feature: Weekend flag)');
    expect(skills).toContain('- "Which requests came in at the weekend?"');
    expect(skills).toContain('**Action or connector**: none');
    expect(skills).toContain('## Not in this agent');
    const knowledge = f['kit/copilot-studio/knowledge.md'];
    expect(knowledge).toMatch(/1\. \*\*sample-data\.csv\*\* \(this folder\): Synthetic requests, 34 made-up rows/);
    expect(knowledge).toContain('- **The live request mailbox**: Real data: never in a proof of concept');
    expect(knowledge).toContain('- [ ] "Which requests came in at the weekend?" Expected: REQ-025 to REQ-034');
  });

  it('Microsoft Copilot prompts, Power Apps lists, screens with formulas and flows', async () => {
    const c = await files('Microsoft Copilot');
    expect(c['kit/microsoft-copilot/prompts.md']).toContain('Expected answer: The 10 requests REQ-025 to REQ-034');
    expect(c['kit/microsoft-copilot/prompts.md']).toContain('The sample\'s columns: `request_id`');
    const p = await files('Power Apps');
    expect(p['kit/power-apps/data-model.md']).toContain('| received_on | Date only |');
    expect(p['kit/power-apps/screens.md']).toContain('tglWeekend: Filter(Requests, Weekday(received_on) in [1, 7])');
    expect(p['kit/power-apps/flows.md']).toContain('## Flow 1: Weekly summary');
  });

  it('Dataiku: each recipe\'s steps, the schemas, the rules sheet, flow.json and a self-contained diagram', async () => {
    const f = await files('Dataiku');
    expect(f['kit/dataiku/flow.md']).toContain('## 3. Weekend flag (prepare recipe), feature: Weekend flag');
    expect(f['kit/dataiku/flow.md']).toContain('1. Formula: is_weekend = weekday(received_on) >= 6');
    expect(f['kit/dataiku/datasets.md']).toContain('## requests_sample (input dataset)');
    expect(f['kit/dataiku/rules.csv']).toBe('desk,weekend_ok\nEMEA,false\nAMER,false\nAPAC,true\n');
    const flow = JSON.parse(f['kit/dataiku/flow.json']);
    expect(flow.recipes.map((r: any) => r.id)).toEqual(['r1', 'r2']);
    expect(flow.dashboard.name).toBe('Weekend requests');
    const html = f['kit/dataiku/flow-diagram.html'];
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/<script[^>]+src=|<link /);
    expect(html.match(/class="rf-node rf-recipe"/g)).toHaveLength(2);
  });
});

describe('the recipe flow', () => {
  it('keeps only what holds together: known datasets, a feature that exists, a dashboard on a used dataset', () => {
    const flow = checkFlow({
      datasets: [{ id: 'a', name: 'in', kind: 'input', about: '', columns: [] }, { id: 'b', name: 'out', kind: 'output', about: '', columns: [] }, { id: 'a', name: 'clash', kind: 'weird', about: '', columns: [] }, { id: 'z', name: 'unused', kind: 'input', about: '', columns: [] }],
      recipes: [
        { id: 'r1', name: 'Flag', kind: 'prepare', inputs: ['a'], outputs: ['b'], steps: ['s'], feature: 'weekend FLAG' },
        { id: 'r2', name: 'Ghost', kind: 'join', inputs: ['nope'], outputs: ['b'], steps: [] },
        { id: 'r3', name: 'Again', kind: 'filter', inputs: ['b'], outputs: ['b'], steps: [], feature: 'Not a feature' },
      ],
      dashboard: { name: 'Board', shows: ['x'], from: ['b', 'nope'] },
    }, 'Project', ['Weekend flag'])!;
    expect(flow.recipes.map((r) => r.name)).toEqual(['Flag']);
    expect(flow.recipes[0].feature).toBe('Weekend flag');
    expect(flow.datasets.map((d) => d.id)).toEqual(['a', 'b']);
    expect(flow.dashboard).toEqual({ id: 'dashboard', name: 'Board', shows: ['x'], from: ['b'] });
    expect(checkFlow({ datasets: [], recipes: [] }, 'P')).toBeUndefined();
    // A step that names a dataset by its code names it by its name.
    const coded = checkFlow({
      datasets: [{ id: 'EXP1', name: 'expense_export', kind: 'input', about: '', columns: [] }, { id: 'OUT', name: 'flags', kind: 'output', about: '', columns: [] }],
      recipes: [{ id: 'R1', name: 'Flag', kind: 'prepare', inputs: ['EXP1'], outputs: ['OUT'], steps: ['Read EXP1 and write OUT; EXP10 and output stay; see R1'] }],
    }, 'P')!;
    expect(coded.recipes[0].steps).toEqual(['Read expense_export and write flags; EXP10 and output stay; see Flag']);
    const L = flowLayout(flow);
    const at = new Map(L.nodes.map((n) => [n.id, n]));
    expect(at.get('a')!.col).toBe(0);
    expect(at.get('r1')!.col).toBe(1);
    expect(at.get('b')!.col).toBe(2);
    expect(at.get('dashboard')!.col).toBe(3);
    expect(L.edges).toHaveLength(3);
    expect(flowDetail(flow, 'r1')!.lines.find((l) => l.label === 'Steps')!.items).toEqual(['s']);
    // A rules sheet read only by a later recipe sits just before it, not at the far left.
    const late = flowLayout(checkFlow({
      datasets: ['in', 'mid', 'rules', 'out'].map((id) => ({ id, name: id, kind: id === 'rules' ? 'rules' : 'intermediate', about: '', columns: [] })),
      recipes: [{ id: 'p', name: 'P', kind: 'prepare', inputs: ['in'], outputs: ['mid'], steps: [] }, { id: 'j', name: 'J', kind: 'join', inputs: ['mid', 'rules'], outputs: ['out'], steps: [] }],
    }, 'P')!);
    const c = new Map(late.nodes.map((n) => [n.id, n.col]));
    expect([c.get('in'), c.get('p'), c.get('mid'), c.get('rules'), c.get('j')]).toEqual([0, 1, 2, 2, 3]);
  });

  it('flow-diagram.html escapes every text, inside the SVG and the script', () => {
    const flow = checkFlow({
      datasets: [{ id: 'a', name: '<img src=x onerror=alert(1)>', kind: 'input', about: '</script><script>alert(2)</script>', columns: [] }, { id: 'b', name: 'out', kind: 'output', about: '', columns: [] }],
      recipes: [{ id: 'r', name: 'R & D', kind: 'prepare', inputs: ['a'], outputs: ['b'], steps: [] }],
    }, 'P')!;
    const html = renderFlowHtml(flow, 'Title <b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('Title &lt;b&gt;');
    expect(html).toContain('R &amp; D');
  });
});

describe('the plan route writes the filled-in kits', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => { await close?.(); close = undefined; });
  async function server(provider: Provider) {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const s = await startServer('2026-10-20', { connector: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) });
    close = async () => { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); };
    const post = (url: string, body: unknown = {}) => fetch(`${s.base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await saveIdea(s.root, sampleIdea({ stage: 3, challenge: 'Weekend claims slip through.' }));
    await post(`/api/ideas/${ID}/tools`, {
      features: [{ name: 'Weekend flag', what: 'Flags weekend claims' }, { name: 'Draft reply', what: 'Drafts the reply', scope: { status: 'outside', by: 'Power Automate' } }],
      tool: { tool: 'Dataiku', by: 'operator', reason: 'Tables and rules' },
    });
    const idea = await loadIdea(s.root, ID);
    await applyDesignEvent(s.root, idea, { t: 'step', question: 'What must it show?', suggested: [], tag: 'must-show', source: 'ai-suggested' }, clock);
    await post(`/api/ideas/${ID}/design/answer`, { n: 1, answer: 'Every weekend claim flagged' });
    await post(`/api/ideas/${ID}/design/finish`, { summary: 'Flags weekend claims.' });
    expect((await post(`/api/ideas/${ID}/design/approve`)).status).toBe(200);
    return { ...s, post };
  }

  it('a Dataiku design: the whole kit, the outside tool\'s kit, and the pack may read the csv and the diagram (kit/ only)', async () => {
    const s = await server(fakeProvider());
    const r = await json(await s.post(`/api/ideas/${ID}/plan`));
    expect(r.note).toBeUndefined();
    expect(r.files).toEqual(['kit/dataiku/README.md', 'kit/dataiku/datasets.md', 'kit/dataiku/flow-diagram.html', 'kit/dataiku/flow.json', 'kit/dataiku/flow.md', 'kit/dataiku/rules.csv', 'kit/dataiku/sample-data.csv', 'kit/dataiku/test-checklist.md', 'kit/power-automate/README.md', 'plan.md']);
    const html = await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'kit/dataiku/flow-diagram.html' }));
    expect(html.text).toContain('<svg');
    expect((await json(await s.post(`/api/ideas/${ID}/design-file`, { path: 'kit/dataiku/sample-data.csv' }))).text).toMatch(/^request_id,/);
    expect((await s.post(`/api/ideas/${ID}/design-file`, { path: 'design.html' })).status).toBe(400);
    expect((await s.post(`/api/ideas/${ID}/design-file`, { path: 'kit/../idea.yaml' })).status).toBe(400);
    expect((await loadIdea(s.root, ID)).stage).toBe(3);
  });

  it('when the kit AI fails, the kits are still written from the design alone, and say so', async () => {
    const fake = fakeProvider();
    const s = await server({ ...fake, complete: async (p: string, o: { timeoutMs: number }) => (p.startsWith('TASK: design-kit') ? 'no json here' : fake.complete(p, o)) });
    const r = await json(await s.post(`/api/ideas/${ID}/plan`));
    expect(r.note).toBe(KIT_NO_AI);
    expect(r.files).toContain('kit/dataiku/flow-diagram.html');
    expect(r.files).not.toContain('kit/dataiku/sample-data.csv');
    const readme = await readFile(path.join(await ideaDir(s.root, ID), 'kit', 'dataiku', 'README.md'), 'utf8');
    expect(readme).toContain(KIT_NO_AI);
  });
});
