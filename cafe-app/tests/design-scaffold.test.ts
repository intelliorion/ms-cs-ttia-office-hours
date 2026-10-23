import { describe, it, expect, afterEach, vi } from 'vitest';
import vm from 'node:vm';
import { sampleIdea } from './helpers';
import { emptyDesign, type DesignState } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { kitFiles } from '../src/design/kits';
import { fnName, renderScaffold, scaffoldOf, SCAFFOLD_FILES } from '../src/design/scaffold';
import type { SampleTable } from '../src/design/sampleData';
import { fakeProvider } from '../src/ai/providers/fake';
import { designKitTask, type DesignKitInput, type DesignPlanOutput } from '../src/ai/tasks';

afterEach(() => vi.unstubAllEnvs());

const SAMPLE: SampleTable = {
  columns: [{ name: 'claim_id', kind: 'id', about: '' }, { name: 'claim_date', kind: 'date', about: '' }, { name: 'amount', kind: 'money', about: '' }, { name: 'test_case', kind: 'text', about: '' }],
  rows: [], seeded: [],
};
const FEATURES = [{ id: 'flag', name: 'Weekend flag', what: 'Flags weekend claims', flags: [] }, { id: 'list', name: 'Flagged list', what: 'Shows the flagged claims', flags: [] }];
const state = (over: Partial<DesignState> = {}): DesignState => ({
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Flags weekend claims.', features: FEATURES,
  tool: { tool: 'custom app', pathway: pathwayOf('custom app'), by: 'operator', reason: '', pros: [], cons: [], context: [], flags: ['custom-app'], fit: [], evaluatedFor: [], at: '2026-10-20' },
  steps: [
    { n: 1, question: 'What is the rule?', suggested: [], answer: 'Flag a claim when claim_date is a Saturday or Sunday', tag: 'logic', source: 'operator' },
    { n: 2, question: 'Any cap?', suggested: [], answer: 'Flag an amount over 500', tag: 'logic', source: 'operator' },
  ],
  ...over,
});

/** Runs app.js against a stub page: what it defines, and the boxes it drew into. */
function runApp(code: string) {
  const boxes: Record<string, { innerHTML: string }> = {};
  const el = () => ({ addEventListener() {}, textContent: '', dataset: {}, classList: { toggle() {} } });
  const document = {
    getElementById: () => el(),
    querySelectorAll: () => [],
    querySelector: (sel: string) => (boxes[sel] ??= { innerHTML: '' }),
  };
  const ctx = vm.createContext({ document, FileReader: class {} });
  vm.runInContext(`${code}\nthis.parseCsv = parseCsv; this.runRules = runRules; this.SCREENS = SCREENS;`, ctx);
  return { ctx: ctx as any, boxes };
}

describe('the custom app starter scaffold', () => {
  it('without the kit AI: one screen per built feature with the sample\'s columns, one rule stub per logic answer', () => {
    const s = scaffoldOf(state(), FEATURES, SAMPLE);
    expect(s.screens.map((x) => [x.id, x.name, x.columns.join(',')])).toEqual([
      ['weekend-flag', 'Weekend flag', 'claim_id,claim_date,amount'], ['flagged-list', 'Flagged list', 'claim_id,claim_date,amount'],
    ]);
    expect(s.rules.map((r) => [r.fn, r.logic, r.columns])).toEqual([
      ['rule1', 'Flag a claim when claim_date is a Saturday or Sunday', ['claim_date']], ['rule2', 'Flag an amount over 500', ['amount']],
    ]);
  });

  it('the AI\'s screens and rules are checked: unknown features and columns dropped, names made safe function names', () => {
    const s = scaffoldOf(state(), FEATURES, SAMPLE, {
      screens: [
        { name: 'Flagged claims', feature: 'weekend FLAG', shows: 'The flagged claims', columns: ['CLAIM_ID', 'not_a_column', 'amount'], action: 'Export' },
        { name: 'Made up', feature: 'Not a feature', shows: '', columns: [] },
      ],
      rules: [{ name: 'Weekend claim!', logic: 'claim_date on a Saturday or Sunday', columns: ['claim_date', 'nope'], feature: 'Weekend flag' }, { name: 'render', logic: 'x', columns: [] }],
    });
    expect(s.screens).toEqual([{ id: 'flagged-claims', name: 'Flagged claims', feature: 'Weekend flag', shows: 'The flagged claims', columns: ['claim_id', 'amount'], action: 'Export' }]);
    expect(s.rules.map((r) => [r.fn, r.columns, r.feature])).toEqual([['weekendClaim', ['claim_date'], 'Weekend flag'], ['render2', [], undefined]]);
    const used = new Set<string>();
    expect([fnName('3 day rule', used), fnName('3 day rule', used), fnName('!!!', used)]).toEqual(['rule3DayRule', 'rule3DayRule2', 'rule']);
  });

  it('the files are plain, escaped and run: index.html loads app.js; app.js reads a CSV and every stub flags nothing yet', () => {
    const s = scaffoldOf(state(), FEATURES, SAMPLE, {
      screens: [{ name: 'A <b>bold</b> screen', shows: '"Quoted" & </script>', columns: ['claim_id'] }],
      rules: [{ name: 'Weekend', logic: 'Ends a comment */ here', columns: [] }],
    });
    const files = renderScaffold('Claims <check>', 'CAFE-2026-001', s, SAMPLE.columns.map((c) => c.name));
    expect(Object.keys(files)).toEqual([...SCAFFOLD_FILES]);
    const html = files['app/index.html'];
    expect(html).toContain('<title>Claims &lt;check&gt; — starter</title>');
    expect(html).toContain('<h2>A &lt;b&gt;bold&lt;/b&gt; screen</h2>');
    expect(html).toContain('&quot;Quoted&quot; &amp; &lt;/script&gt;');
    expect(html).toContain('<script src="app.js"></script>');
    expect(html).not.toMatch(/https?:\/\//);
    const app = files['app/app.js'];
    expect(app).not.toMatch(/fetch\(|XMLHttpRequest|https?:\/\/|localStorage/);
    expect(app).toContain('// TODO: write this rule from the design.');
    expect(app).not.toContain('</script');
    const { ctx, boxes } = runApp(app);
    expect(ctx.SCREENS[0].name).toBe('A <b>bold</b> screen');
    const rows = ctx.parseCsv('claim_id,claim_date,amount\nC-1,2026-10-10,"1,200"\r\nC-2,2026-10-12,80\n');
    expect(rows).toEqual([{ claim_id: 'C-1', claim_date: '2026-10-10', amount: '1,200' }, { claim_id: 'C-2', claim_date: '2026-10-12', amount: '80' }]);
    expect(ctx.runRules(rows[0])).toEqual({ flagged: false, reason: '' });
    expect(Object.values(boxes)[0].innerHTML).toContain('Load the sample');
  });

  it('the custom app kit carries the scaffold; the README says how to run it and the agent starts from it', async () => {
    vi.stubEnv('CAFE_AI_FAKE', '1');
    const input: DesignKitInput = {
      idea: { id: 'CAFE-2026-001', title: 'Claims check' }, tool: { tool: 'custom app', pros: [], cons: [] }, summary: 'S', points: {}, steps: [], plan: { tasks: [], risks: [] },
      features: [{ name: 'Weekend flag', status: 'built' }], outsideTools: [],
    };
    const kit = designKitTask.parse(await fakeProvider().complete(designKitTask.prompt(input), { timeoutMs: 1000 }));
    expect(kit.customApp?.rules[0].name).toBe('Weekend request');
    const plan: DesignPlanOutput = { tasks: [{ title: 'Build it', detail: 'd', tool: 'custom app', done_when: 'w' }], risks: [] };
    const idea = sampleIdea({ id: 'CAFE-2026-001', title: 'Claims check' });
    const files = kitFiles(idea, state({ features: [FEATURES[0]] }), plan, kit);
    const readme = files['kit/custom-app/README.md'];
    expect(readme).toContain('## Run the starter');
    expect(readme).toContain('1. Open [app/index.html](app/index.html) in a browser');
    expect(readme).toMatch(/\d\. \[app\/index\.html\]\(app\/index\.html\): the starter/);
    const agent = files['kit/custom-app/BUILD-WITH-AGENT.md'];
    expect(agent).toContain('Start from the scaffold in app/');
    expect(agent).toContain('- weekendRequest: Flag a request when received_on is a Saturday or Sunday');
    expect(files['kit/custom-app/app/app.js']).toContain('function weekendRequest(row)');
    // The fake's screen columns are the sample's: kept.
    expect(files['kit/custom-app/app/app.js']).toMatch(/"columns":\["request_id","received_on","desk","amount"\]/);
  });
});
