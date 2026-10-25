import { describe, it, expect } from 'vitest';
import { sampleIdea } from './helpers';
import { emptyDesign, type DesignState, type ToolChoice } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { kitFiles } from '../src/design/kits';
import { KIT_FIT_STALE } from '../src/design/kitFiles';
import { designKitTask, type DesignKitInput, type DesignKitOutput, type DesignPlanOutput } from '../src/ai/tasks';
import type { DataFile } from '../src/data/model';
import { sampleTable } from '../src/design/sampleData';

/**
 * What a builder found missing or wrong when building from a kit alone (the builds audit): where the team's files are,
 * which file is knowledge and which is the test input, what to upload to Dataiku, a seeded pair that was no pair, and
 * the small things (two full stops, "1 rows", a link to a folder that is not there, a project name cut mid-word).
 */

const toolOf = (tool: string, fit: ToolChoice['fit'] = []): ToolChoice => ({
  tool, pathway: pathwayOf(tool), by: 'ai', reason: 'Q&A over a policy', pros: [], cons: [], context: ['Built by Person 9 in the sandbox'],
  flags: [], fit, evaluatedFor: [], at: '2026-10-20',
});

const file = (id: string, name: string, kind: DataFile['kind'], what: string): DataFile => ({
  id, name, file: `${id}-${name}`, kind, bytes: 10, type: kind === 'input' ? 'table' : 'document', at: '2026-10-20', steps: [],
  check: { status: 'clear', findings: [], masked: [], notes: [] },
  ...(kind === 'input' ? { tables: [{ name: '', rows: 2, columns: [] }] } : { doc: { words: 100 } }),
  understanding: { what, columns: [], rules: [], issues: [], at: '2026-10-20' },
} as unknown as DataFile);

const design = (tool: string): DesignState => ({
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Answers travel policy questions.',
  features: [
    { id: 'answer', name: 'Policy answer', what: 'Answers from the policy', flags: [] },
    { id: 'count', name: 'Weekly count', what: 'Counts questions by week', flags: [], scope: { status: 'outside', by: 'Excel on the SharePoint list', why: 'No weekly view' } },
  ],
  tool: toolOf(tool, [{ feature: 'Policy answer', fit: 'yes', note: '', stale: true }]),
  steps: [
    { n: 1, question: 'Who builds it?', suggested: [], answer: 'A citizen developer in the team.', tag: 'builder', source: 'operator' },
    { n: 2, question: 'Who uses it?', suggested: [], answer: 'Travellers in Teams chat.', tag: 'users', source: 'operator' },
  ],
  data: {
    files: [
      file('f1', '1-sample-questions.csv', 'input', 'Ten questions'),
      file('f3', '3-rules policy.md', 'rules', 'The policy extract'),
      file('f4', '4-mailbox-log.csv', 'today', 'The weekly log'),
      file('f5', '5-process.txt', 'process', 'How it works today'),
    ],
    steps: [], confirmedAt: '2026-10-20',
  },
});

const PLAN: DesignPlanOutput = { tasks: [{ title: 'Build it', detail: 'd', tool: 'Copilot Studio', done_when: 'w' }], risks: [] };

const KIT: DesignKitOutput = {
  sample: {
    name: 'Made-up questions', columns: [{ name: 'question_id', kind: 'id', about: '' }, { name: 'question', kind: 'text', about: '' }],
    rows: [['S-001', 'Hotel cap in London?']], seeded: [{ label: 'No figure', count: 1, row: ['S-900', 'Meals in France?'], expect: 'Hands off' }],
  },
  checks: [{ check: 'Run T1', expected: 'Hands off' }],
  studio: {
    name: 'Travel helper', purpose: 'Answers.', tone: 'Short.', must: [], mustNot: [], handover: [], skills: [],
    knowledge: [
      { source: '3-rules policy.md', holds: 'The rules', add: true },
      { source: '1-sample-questions.csv', holds: 'Test questions', add: false, why: 'Answer key for the tester' },
      { source: '4-mailbox-log.csv', holds: 'Weekly log', add: false, why: 'Layout only' },
    ],
    tests: [],
  },
};

describe('knowledge.md, as a builder reads it', () => {
  const idea = sampleIdea({ stage: 3 });
  const k = kitFiles(idea, design('Copilot Studio'), PLAN, KIT)['kit/copilot-studio/knowledge.md'];
  const add = k.slice(k.indexOf('## Add'), k.indexOf('## The team'));
  const other = k.slice(k.indexOf("## The team's own files"), k.indexOf('## Do not add'));
  const not = k.slice(k.indexOf('## Do not add'), k.indexOf('## Test questions'));

  it('the sample of questions people ask is the test input, not knowledge, when the AI says to keep the input out', () => {
    expect(add).not.toContain('sample-data.csv');
    expect(add).toMatch(/^## Add\n\n1\. \*\*3-rules policy\.md\*\*/);
    expect(not).toContain('- **sample-data.csv** (this folder): Made-up questions, 25 made-up rows');
    expect(not).toMatch(/the test input\. Type its questions in the test pane/);
  });

  it('each team file says where it is (data-files/ beside design.md), and is never both to add and not to add', () => {
    expect(add).toContain('**3-rules policy.md** ([../../data-files/f3-3-rules policy.md](../../data-files/f3-3-rules%20policy.md)): The rules');
    expect(not).toContain('**4-mailbox-log.csv** ([../../data-files/f4-4-mailbox-log.csv](../../data-files/f4-4-mailbox-log.csv)): Layout only');
    // The other files are only the ones the AI's list did not place.
    expect(other).toContain('**5-process.txt** ([../../data-files/f5-5-process.txt](../../data-files/f5-5-process.txt), Process document)');
    expect(other).not.toContain('4-mailbox-log.csv');
    expect(other).not.toContain('3-rules policy.md');
  });

  it('without the AI saying so, the sample stays first under Add', () => {
    const kit = { ...KIT, studio: { ...KIT.studio!, knowledge: [{ source: '3-rules policy.md', holds: 'The rules', add: true }] } };
    const k2 = kitFiles(idea, design('Copilot Studio'), PLAN, kit)['kit/copilot-studio/knowledge.md'];
    expect(k2).toMatch(/## Add\n\n1\. \*\*sample-data\.csv\*\* \(this folder\)/);
    expect(k2).toMatch(/2\. \*\*3-rules policy\.md\*\* \(/);
  });
});

describe('README and test checklist wording', () => {
  const f = kitFiles(sampleIdea({ stage: 3 }), design('Copilot Studio'), PLAN, KIT);
  it('no doubled full stop after a design point; one seeded row is "1 row"; a stale fit in the builder\'s words', () => {
    const readme = f['kit/copilot-studio/README.md'];
    expect(readme).toContain('- **Builder**: A citizen developer in the team (Assisted Citizen until a builder is named). Builds it from this kit');
    expect(readme).toContain('- **Who uses it**: Travellers in Teams chat. Tries it');
    expect(readme).not.toMatch(/\.\. /);
    expect(readme).toContain('- **T1** (1 row): No figure.');
    expect(f['kit/copilot-studio/test-checklist.md']).toContain('(the row with `test_case` = T1)');
    expect(readme).toContain(KIT_FIT_STALE);
    expect(Object.values(f).join('\n')).not.toMatch(/re-evaluate the tool/);
  });
});

describe('flows.md links the outside kit that is there', () => {
  it('names the folder after the tool the design gave, not a fixed power-automate/', () => {
    const state = design('Power Apps');
    state.features[1].scope = { status: 'outside', by: 'Power Automate flow', why: 'Sends mail' };
    const kit: DesignKitOutput = { ...KIT, studio: undefined, powerApps: { tables: [], screens: [], flows: [{ name: 'Weekly', trigger: 'Monday', steps: ['Count'] }] } };
    const f = kitFiles(sampleIdea({ stage: 3 }), state, PLAN, kit);
    expect(f['kit/power-apps/flows.md']).toContain('[../power-automate-flow/README.md](../power-automate-flow/README.md)');
    expect(f['kit/power-automate-flow/README.md']).toBeTruthy();
  });
});

describe('the kit prompt', () => {
  it('asks for test codes, never made-up ids, and the questions sample as test input', () => {
    const input: DesignKitInput = { idea: { id: 'X', title: 'T' }, tool: { tool: 'Copilot Studio', pros: [], cons: [] }, summary: 'S', points: {}, steps: [], plan: { tasks: [], risks: [] }, features: [], outsideTools: [] };
    const p = designKitTask.prompt(input);
    expect(p).toMatch(/name it by its test code \(T1, T2 …\), never by an id/);
    expect(p).toMatch(/Ordinary rows keep the ids you give them/);
    expect(p).toMatch(/prefix the team's own files do not use/);
    expect(p).toMatch(/when the sample holds the questions users ask, list it with add false/);
  });
});

describe('a seeded pair stays a pair', () => {
  it('a group with its own rows keeps their dates and values (a duplicate on one day); copies of one row still move by weeks', () => {
    const t = sampleTable({
      name: 'Claims',
      columns: [{ name: 'claim_id', kind: 'id', about: '' }, { name: 'claim_date', kind: 'date', about: '' }, { name: 'amount', kind: 'money', about: '' }],
      rows: [['C-001', '2026-10-05', '12.00']],
      seeded: [
        { label: 'Weekend', count: 2, row: ['C-900', '2026-10-10', '30.00'], expect: 'Flagged' },
        { label: 'Duplicate pair', count: 1, row: ['C-901', '2026-10-06', '42.80'], rows: [['C-901', '2026-10-06', '42.80'], ['C-902', '2026-10-06', '42.80']], expect: 'Both flagged' },
        { label: 'Split', count: 2, row: ['C-903', '2026-10-08', '93.50'], rows: [['C-903', '2026-10-08', '93.50'], ['C-904', '2026-10-08', '96.20']], expect: 'Both flagged' },
      ],
    });
    const of = (code: string) => t.rows.filter((r) => r[3] === code);
    expect(of('T1').map((r) => r[1])).toEqual(['2026-10-10', '2026-10-17']);
    expect(of('T2').map((r) => [r[1], r[2]])).toEqual([['2026-10-06', '42.80'], ['2026-10-06', '42.80']]);
    expect(of('T3').map((r) => [r[1], r[2]])).toEqual([['2026-10-08', '93.50'], ['2026-10-08', '96.20']]);
    expect(new Set(t.rows.map((r) => r[0])).size).toBe(t.rows.length);
    expect(t.seeded.map((g) => g.count)).toEqual([2, 2, 2]);
    expect(designKitTask.parse(JSON.stringify({ sample: { name: 'S', columns: [{ name: 'a', kind: 'text', about: '' }], rows: [['1']], seeded: [{ label: 'L', count: 1, row: ['x'], rows: [['x'], ['y']], expect: 'e' }] }, checks: [{ check: 'c', expected: 'e' }] })).sample.seeded[0].rows).toEqual([['x'], ['y']]);
  });
});

describe('Dataiku flow.md: what to upload, and the project', () => {
  it('every dataset no recipe makes is uploaded from its own file: the sample, the team\'s rules sheet, their expected output', () => {
    const state = design('Dataiku');
    state.steps.push({ n: 3, question: 'Where?', suggested: [], answer: 'Café Dataiku sandbox project; analyst uploads the CSV by hand each week; data approved', tag: 'environment', source: 'operator' });
    state.data!.files = [...state.data!.files.filter((f) => f.kind !== 'rules'), file('f2', 'rules sheet.xlsx', 'rules', 'Caps and days'), file('f6', 'flagged.csv', 'output', 'Expected flags')];
    const kit: DesignKitOutput = {
      ...KIT, studio: undefined,
      dataiku: {
        datasets: [
          { id: 'in', name: 'expense_export', kind: 'input', about: '', columns: [] },
          { id: 'days', name: 'rules_days', kind: 'rules', about: '', columns: [] },
          { id: 'caps', name: 'rules_caps', kind: 'rules', about: '', columns: [] },
          { id: 'exp', name: 'flagged_sample', kind: 'output', about: '', columns: [] },
          { id: 'out', name: 'flagged', kind: 'output', about: '', columns: [] },
          { id: 'cmp', name: 'match_check', kind: 'output', about: '', columns: [] },
        ],
        recipes: [
          { id: 'j', name: 'Join rules', kind: 'join', inputs: ['in', 'days', 'caps'], outputs: ['out'], steps: ['Join'] },
          { id: 'c', name: 'Compare', kind: 'join', inputs: ['out', 'exp'], outputs: ['cmp'], steps: ['Compare'] },
        ],
      },
    };
    const flow = kitFiles(sampleIdea({ stage: 3 }), state, PLAN, kit)['kit/dataiku/flow.md'];
    expect(flow).toContain('Project: Café Dataiku sandbox project. Open');
    expect(flow).toContain('- **expense_export**: from [sample-data.csv](sample-data.csv).');
    expect(flow).toContain("- **rules_days**: from the team's [rules sheet.xlsx](../../data-files/f2-rules%20sheet.xlsx) (the sheet with the columns in [datasets.md](datasets.md)).");
    expect(flow).toContain("- **rules_caps**: from the team's [rules sheet.xlsx]");
    expect(flow).toContain("- **flagged_sample**: from the team's [flagged.csv](../../data-files/f6-flagged.csv), to compare the result with.");
    // A dataset named after one of the team's files comes from it, whatever kind the AI gave it.
    const mis = { ...kit, dataiku: { ...kit.dataiku!, datasets: kit.dataiku!.datasets.map((d) => (d.id === 'exp' ? { ...d, name: 'flagged', kind: 'input' as const } : d.id === 'out' ? { ...d, name: 'flags_out' } : d)) } };
    expect(kitFiles(sampleIdea({ stage: 3 }), state, PLAN, mis)['kit/dataiku/flow.md']).toContain("- **flagged**: from the team's [flagged.csv](../../data-files/f6-flagged.csv), to compare the result with.");
    // flagged is made by a recipe: nothing to upload; and no link to a rules.csv that was not written.
    expect(flow).not.toContain('- **flagged**:');
    expect(flow).not.toContain('rules.csv');
  });
});
