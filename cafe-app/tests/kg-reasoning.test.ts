import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { DEFAULT_RULES, infer, readRuleList, type Rule } from '../src/graph/rules';
import { makeRegistry, defaultEntries } from '../src/graph/registry';
import { compileOntology, nameKey, nodeId, type AiLink, type OperatorEdit } from '../src/graph/ontology';
import { sampleIdea } from './helpers';

/**
 * The faults the adversarial test of 2026-10-30 found in the graph's reasoning, each pinned by the case that showed it.
 * Shaped like the practice workspace: invented people, the ideas' real shapes.
 */
const vendor = sampleIdea({
  id: 'CAFE-2026-001', slug: 'vendor', title: 'Vendor contract summariser', function: 'GSS', entity: 'CS', dedupe_key: 'a',
  people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', roles: ['lead'] }] }, features: ['Deadline tracking and alerting', 'Document text extraction'], tools: {},
});
const onboarding = sampleIdea({
  id: 'CAFE-2026-003', slug: 'onboarding', title: 'Onboarding checklist helper', function: 'BSI', entity: 'CS', dedupe_key: 'c',
  people: { submitter: 'Priya Nair', team: [] }, features: ['Document text extraction'], tools: {},
});
const travel = sampleIdea({
  id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'f',
  people: { submitter: 'Lucía Fernández', team: [] }, features: ['Policy question answering'], tools: { 'Policy question answering': 'Copilot Studio' },
});
const faq = sampleIdea({
  id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'g',
  people: { submitter: 'Kwame Mensah', team: [] }, features: ['Policy question answering', 'Document text extraction'], tools: {},
});
/** The hypothetical import: Avery Chen again, this time from BSI, picking Power Apps for two shared features. */
const lease = sampleIdea({
  id: 'CAFE-2026-008', slug: 'lease', title: 'Lease renewal radar', function: 'BSI', entity: 'CS', dedupe_key: 'h',
  people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', roles: ['lead'] }] },
  features: ['Deadline tracking and alerting', 'Document text extraction'], tools: { 'Deadline tracking and alerting': 'Power Apps', 'Document text extraction': 'Power Apps' },
});
const IDEAS = [vendor, onboarding, travel, faq, lease];
const rels = (g: { edges: { from: string; rel: string; to: string }[] }) => g.edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
const op = (n: number, e: Record<string, unknown>): OperatorEdit => ({ id: `op-${n}`, at: '2026-10-26', status: 'active', ...e } as OperatorEdit);

describe('fault 1: a tool pick stays with the idea whose design picked it', () => {
  const g = buildGraph(IDEAS, []);
  it('Power Apps is used by 008 alone, not by every idea that shares the features (it was 6 ideas, 5 of them false)', () => {
    expect(rels(g).filter((r) => r.endsWith('USES tool:power-apps'))).toEqual(['idea:CAFE-2026-008 USES tool:power-apps']);
  });
  it('Copilot Studio is used by 006, which picked it, and not by 007, which only shares Policy question answering', () => {
    expect(rels(g).filter((r) => r.endsWith('USES tool:copilot-studio'))).toEqual(['idea:CAFE-2026-006 USES tool:copilot-studio']);
  });
  it('two ideas that both picked the tool for the feature both use it; the BUILT_WITH fact carries both ideas', () => {
    const both = buildGraph([travel, { ...faq, tools: { 'Policy question answering': 'Copilot Studio' } }], []);
    expect(rels(both).filter((r) => r.endsWith('USES tool:copilot-studio')).sort()).toEqual(['idea:CAFE-2026-006 USES tool:copilot-studio', 'idea:CAFE-2026-007 USES tool:copilot-studio']);
    expect(both.edges.find((e) => e.rel === 'BUILT_WITH')?.ideas).toEqual(['CAFE-2026-006', 'CAFE-2026-007']);
  });
  it('a workspace file that names needs+built_with with no scope gets the built-in scope (same-idea), not a spread', () => {
    const file = readRuleList({ rules: [{ name: 'needs+built_with', chain: ['NEEDS', 'BUILT_WITH'], then: 'USES', enabled: true }] });
    expect(file.rules[0]).toMatchObject({ scope: 'same-idea' });
    expect(rels(buildGraph(IDEAS, [], [], [], { rules: file.rules })).filter((r) => r.includes(' USES '))).toEqual(['idea:CAFE-2026-006 USES tool:copilot-studio', 'idea:CAFE-2026-008 USES tool:power-apps']);
  });
});

describe('fault 2: a team owns the ideas its record names, one owner when the record names one', () => {
  const owners = (g: { edges: { from: string; rel: string; to: string }[] }, idea: string) => g.edges.filter((e) => e.rel === 'OWNS' && e.to === `idea:${idea}`).map((e) => e.from).sort();
  const g = buildGraph(IDEAS, []);
  it('Avery Chen submitted 001 from GSS and 008 from BSI: 001 is GSS\'s alone, 008 BSI\'s alone (it was both teams for both)', () => {
    expect(owners(g, 'CAFE-2026-001')).toEqual(['team:gss']);
    expect(owners(g, 'CAFE-2026-008')).toEqual(['team:bsi']);
  });
  it('an operator HAS_MEMBER with no idea does not add an owner to an idea whose record names its team', () => {
    const g2 = buildGraph(IDEAS, [], [], [op(10, { t: 'link', from: 'team:bsi', rel: 'HAS_MEMBER', to: 'person:kwame-mensah' })]);
    expect(owners(g2, 'CAFE-2026-007')).toEqual(['team:gss']);
  });
  it('an idea whose record names no team falls back to its submitter\'s teams, and says which derivation it is', () => {
    const none = sampleIdea({ id: 'CAFE-2026-009', slug: 'none', title: 'No function', function: undefined, entity: 'CS', dedupe_key: 'i', people: { submitter: 'Avery Chen', team: [] } });
    const g3 = buildGraph([...IDEAS, none], []);
    expect(owners(g3, 'CAFE-2026-009')).toEqual(['team:bsi', 'team:gss']);
    expect(g3.edges.find((e) => e.id === 'team:gss|OWNS|idea:CAFE-2026-009')?.ideas).toBeUndefined();
    expect(g3.edges.find((e) => e.id === 'team:gss|OWNS|idea:CAFE-2026-001')?.ideas).toEqual(['CAFE-2026-001']);
  });
});

describe('fault 3: a capability-level fact with no idea does not spread across the workspace', () => {
  const AI: AiLink[] = [
    { from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:travel-expense-policy', description: 'policy', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', idea: 'CAFE-2026-006', newNodes: [{ id: 'system:travel-expense-policy', type: 'System', label: 'Travel & Expense policy' }] },
  ];
  it('op-9 (no idea) no longer makes 007 depend on the T&E policy; 006, whose own read found it, still does', () => {
    const g = buildGraph(IDEAS, AI, [], [op(9, { t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:travel-expense-policy' })]);
    expect(rels(g).filter((r) => r.endsWith('DEPENDS_ON system:travel-expense-policy'))).toEqual(['idea:CAFE-2026-006 DEPENDS_ON system:travel-expense-policy']);
  });
  it('an idea that confirms the fact by its own facts (006 reads the policy through Document text extraction) gets op-9 as one more way; 007 gets nothing', () => {
    const own: AiLink = { from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:travel-expense-policy', description: 'reads the PDF', source: 'ai:fake:challenge', confidence: 0.85, status: 'confirmed', idea: 'CAFE-2026-006', newNodes: [{ id: 'system:travel-expense-policy', type: 'System', label: 'Travel & Expense policy' }] };
    const t2 = sampleIdea({ ...travel, features: ['Policy question answering', 'Document text extraction'] });
    const g = buildGraph([vendor, onboarding, t2, faq, lease], [own], [], [
      op(9, { t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:travel-expense-policy' }),
    ]);
    expect(rels(g).filter((r) => r.endsWith('DEPENDS_ON system:travel-expense-policy'))).toEqual(['idea:CAFE-2026-006 DEPENDS_ON system:travel-expense-policy']);
    expect(g.edges.find((e) => e.id === 'idea:CAFE-2026-006|DEPENDS_ON|system:travel-expense-policy')!.derived).toEqual({
      rule: 'needs+uses_data',
      inputs: ['idea:CAFE-2026-006|NEEDS|capability:document-text-extraction', 'capability:document-text-extraction|USES_DATA|system:travel-expense-policy'],
      alternatives: [['idea:CAFE-2026-006|NEEDS|capability:policy-question-answering', 'capability:policy-question-answering|USES_DATA|system:travel-expense-policy']],
    });
  });
  it('the same link stamped for 007 makes 007 depend on it too, and the stored fact then carries both ideas', () => {
    const g = buildGraph(IDEAS, AI, [], [op(9, { t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:travel-expense-policy', idea: 'CAFE-2026-007' })]);
    expect(rels(g).filter((r) => r.endsWith('DEPENDS_ON system:travel-expense-policy')).sort()).toEqual(['idea:CAFE-2026-006 DEPENDS_ON system:travel-expense-policy', 'idea:CAFE-2026-007 DEPENDS_ON system:travel-expense-policy']);
    expect(g.edges.find((e) => e.rel === 'USES_DATA')).toMatchObject({ ideas: ['CAFE-2026-006', 'CAFE-2026-007'], source: 'ai:fake:challenge' });
  });
});

describe('fault 6: derived relations and ids that lie about their kind are refused at build', () => {
  it('a hand-stored DEPENDS_ON, OWNS, SIMILAR_TO or USES in operator.jsonl is not in the graph as stored', () => {
    const edits = [
      op(1, { t: 'link', from: 'idea:CAFE-2026-003', rel: 'DEPENDS_ON', to: 'system:expense-system' }),
      op(2, { t: 'add', node: 'system:expense-system', type: 'System', label: 'Expense system' }),
      op(3, { t: 'link', from: 'idea:CAFE-2026-003', rel: 'DEPENDS_ON', to: 'system:expense-system' }),
      op(4, { t: 'link', from: 'team:bsi', rel: 'OWNS', to: 'idea:CAFE-2026-007' }),
      op(5, { t: 'link', from: 'idea:CAFE-2026-003', rel: 'SIMILAR_TO', to: 'idea:CAFE-2026-008' }),
    ];
    const g = buildGraph(IDEAS, [], [], edits);
    expect(rels(g)).not.toContain('idea:CAFE-2026-003 DEPENDS_ON system:expense-system');
    expect(rels(g)).not.toContain('team:bsi OWNS idea:CAFE-2026-007');
    expect(g.edges.filter((e) => ['DEPENDS_ON', 'OWNS', 'SIMILAR_TO', 'USES'].includes(e.rel)).every((e) => e.derived)).toBe(true);
  });
  it('an add whose id is not its type\'s (capability:sneaky as a Person), or of an unknown type, makes no star; an AI new star likewise', () => {
    const g = buildGraph(IDEAS, [
      { from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'idea:FAKE-1', description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', idea: 'CAFE-2026-003', newNodes: [{ id: 'idea:FAKE-1', type: 'Capability', label: 'Fake' }] },
    ], [], [op(1, { t: 'add', node: 'capability:sneaky', type: 'Person', label: 'Sneaky' }), op(2, { t: 'add', node: 'robot:r2', type: 'Robot', label: 'R2' })]);
    expect(g.nodes.map((n) => n.id)).not.toContain('capability:sneaky');
    expect(g.nodes.map((n) => n.id)).not.toContain('robot:r2');
    expect(g.nodes.map((n) => n.id)).not.toContain('idea:FAKE-1');
  });
});

describe('fault 9: rules files as people write them', () => {
  it('enabled: no, off, false and 0 all switch a rule off; yes, on and nothing keep it on; anything else is a problem and off', () => {
    for (const v of ['no', 'off', 'false', false, 0, 'NO']) expect(readRuleList({ rules: [{ name: 'shared-stars', kind: 'shared-stars', enabled: v }] }).rules[0].enabled).toBe(false);
    for (const v of ['yes', 'on', true, undefined]) expect(readRuleList({ rules: [{ name: 'shared-stars', kind: 'shared-stars', enabled: v }] }).rules[0].enabled).toBe(true);
    const odd = readRuleList({ rules: [{ name: 'shared-stars', kind: 'shared-stars', enabled: 'maybe' }] });
    expect(odd.rules[0].enabled).toBe(false);
    expect(odd.problems.filter((r) => !/the built-in rule/.test(r))).toEqual(['inference.yaml: shared-stars: enabled: "maybe" is not yes or no (the rule is off until it is fixed)']);
  });
  it('a chain whose types do not line up with its result is dropped and said so', () => {
    const bad = readRuleList({ rules: [{ name: 'x', chain: ['HAS_MEMBER', 'LEADS', 'NEEDS'], then: 'OWNS' }] });
    // The built-in rules the file does not list still run (item 13 of round 5): only the file's own rule is dropped.
    expect(bad.rules.map((r) => r.name)).toEqual(['needs+uses_data', 'needs+built_with', 'member+submitted', 'shared-stars']);
    expect(bad.problems[0]).toBe('inference.yaml: x: the chain goes Team → Capability but OWNS goes Team → Idea (dropped)');
    expect(readRuleList({ rules: [{ name: 'y', chain: ['NEEDS', 'DEPENDS_ON'], then: 'USES' }] }).problems.slice(0, 1)).toEqual(['inference.yaml: y: DEPENDS_ON is derived: rules read stored facts only (dropped)']);
    expect(readRuleList({ rules: [{ name: 'z', chain: ['NEEDS', 'SUBMITTED'], then: 'USES' }] }).problems.slice(0, 1)).toEqual(['inference.yaml: z: NEEDS ends at Capability but SUBMITTED starts at Person (dropped)']);
  });
  it('n-step chains run: a three-step chain derives along every link, scoped to the one idea all three are stated for', () => {
    // A workspace ontology may give a derived relation another pair: USES as Team → Capability ("the team's ideas need it").
    const { schema } = compileOntology({ relations: { USES: { from: 'Team', to: 'Capability' } } });
    {
      const r = readRuleList({ rules: [{ name: 'team-needs', chain: ['HAS_MEMBER', 'SUBMITTED', 'NEEDS'], then: 'USES' }] }, schema);
      expect(r.problems.filter((x) => !/the built-in rule/.test(x))).toEqual([]);
      expect(r.rules[0]).toMatchObject({ chain: ['HAS_MEMBER', 'SUBMITTED', 'NEEDS'], scope: 'same-idea' });
      const g = buildGraph(IDEAS, [], [], [], { rules: [] });
      const out = infer(g.nodes, g.edges, r.rules, schema);
      // Avery Chen is in GSS (001) and BSI (008): GSS needs 001's capabilities, BSI 008's, never crossed.
      const gss = out.find((e) => e.id === 'team:gss|USES|capability:deadline-tracking-alerting')!;
      expect(gss.derived).toMatchObject({ rule: 'team-needs', inputs: ['team:gss|HAS_MEMBER|person:avery-chen', 'person:avery-chen|SUBMITTED|idea:CAFE-2026-001', 'idea:CAFE-2026-001|NEEDS|capability:deadline-tracking-alerting'] });
      expect(gss.description).toBe('via Avery Chen and Vendor contract summariser');
      expect(out.find((e) => e.id === 'team:bsi|USES|capability:deadline-tracking-alerting')!.derived!.inputs[1]).toBe('person:avery-chen|SUBMITTED|idea:CAFE-2026-008');
      expect(out.some((e) => e.id === 'team:bsi|USES|capability:policy-question-answering')).toBe(false);
      // The built-in ontology, read at the same time, is untouched: USES stays Idea → Tool there.
      expect(readRuleList({ rules: [{ name: 'team-needs', chain: ['HAS_MEMBER', 'SUBMITTED', 'NEEDS'], then: 'USES' }] }).problems.filter((x) => !/the built-in rule/.test(x))).toHaveLength(1);
    }
  });
  it('every derivation of an edge is kept: the surest as inputs, the rest as alternatives', () => {
    const two = sampleIdea({ ...faq, features: ['Policy question answering', 'Document text extraction'] });
    const links: AiLink[] = [
      { from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:email', description: '', source: 'ai:fake:challenge', confidence: 0.6, status: 'confirmed', idea: 'CAFE-2026-007', newNodes: [{ id: 'system:email', type: 'System', label: 'Email' }] },
      { from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', idea: 'CAFE-2026-007' },
    ];
    const e = buildGraph([two], links).edges.find((x) => x.id === 'idea:CAFE-2026-007|DEPENDS_ON|system:email')!;
    expect(e.derived).toEqual({
      rule: 'needs+uses_data',
      inputs: ['idea:CAFE-2026-007|NEEDS|capability:document-text-extraction', 'capability:document-text-extraction|USES_DATA|system:email'],
      alternatives: [['idea:CAFE-2026-007|NEEDS|capability:policy-question-answering', 'capability:policy-question-answering|USES_DATA|system:email']],
    });
    expect(e.confidence).toBe(0.9);
  });
});

describe('fault 10: identity keeps distinct names apart and finds the same name in other words', () => {
  it('C++, C# and C are three stars', () => {
    expect(new Set(['C++ coding', 'C# coding', 'C coding'].map((x) => nodeId('Capability', x))).size).toBe(3);
    expect(nodeId('System', 'Travel & Expense policy')).toBe('system:travel-expense-policy');
    expect(nodeId('Category', 'Knowledge & Q&A')).toBe('category:knowledge-q-a');
  });
  it('"Travel and Expense policy" and "T and E policy" resolve like "Travel & Expense policy" and "T&E policy"', () => {
    const reg = makeRegistry({ ...defaultEntries(), System: [{ id: 'system:travel-expense-policy', label: 'Travel & Expense policy', aliases: ['T&E policy', 'travel policy'] }] }, []);
    for (const w of ['Travel and Expense policy', 'T and E policy', 'T + E policy', 'T&E Policy', 'travel  policy']) expect(reg.resolve('System', w)?.id).toBe('system:travel-expense-policy');
    expect(reg.resolve('System', 'Travel policy PDF')).toBeUndefined();
    expect(nameKey('C++')).not.toBe(nameKey('C#'));
  });
  it('an alias the operator gives a category or an outcome holds at the next build', () => {
    const idea = sampleIdea({ ...travel, use_case_category: ['FAQ bots'], outcomes: ['Save time'] });
    const edits = [op(1, { t: 'alias', node: 'category:knowledge-q-a', label: 'FAQ bots', of: 'Knowledge & Q&A' }), op(2, { t: 'alias', node: 'outcome:save-time', label: 'Time saving', of: 'Save time' })];
    const other = sampleIdea({ ...faq, use_case_category: ['Knowledge & Q&A'], outcomes: ['Time saving'] });
    const { registry } = { registry: makeRegistry(defaultEntries(), edits) };
    const g = buildGraph([idea, other], [], [], edits, { registry });
    expect(rels(g)).toContain('idea:CAFE-2026-006 IN_CATEGORY category:knowledge-q-a');
    expect(rels(g)).toContain('idea:CAFE-2026-007 WANTS outcome:save-time');
    expect(g.nodes.find((n) => n.id === 'category:knowledge-q-a')?.label).toBe('Knowledge & Q&A');
  });
});

describe('the defaults', () => {
  it('scope each chain rule: same-idea for the data and the tool, same-idea-first for ownership', () => {
    expect(DEFAULT_RULES.map((r) => (r.kind === 'chain' ? `${r.name}:${r.scope}` : r.name))).toEqual(['needs+uses_data:same-idea', 'needs+built_with:same-idea', 'member+submitted:same-idea-first', 'shared-stars']);
  });
});
