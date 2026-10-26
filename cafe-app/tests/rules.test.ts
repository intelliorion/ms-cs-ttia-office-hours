import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { buildGraph } from '../src/graph/build';
import { DEFAULT_RULES, infer, parseRules, loadRules, type Rule } from '../src/graph/rules';
import { ALLOWED, DERIVED_RELATIONS, edgeId, type AiLink, type OperatorEdit } from '../src/graph/ontology';
import { rebuildGraph } from '../src/graph/store';
import { saveIdea } from '../src/ideas/store';
import { writeYaml, writeFileAtomic } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import { tmpWorkspace, sampleIdea } from './helpers';

// Shaped like the practice data (npm run test-data): invented people, three of the eight ideas.
const expense = sampleIdea({
  id: 'CAFE-2026-004', slug: 'expense', title: 'Expense anomaly finder', function: 'GSS', entity: 'CS', region: 'EMEA', dedupe_key: 'd',
  people: { submitter: 'Ingrid Solberg', team: [{ name: 'Ingrid Solberg', roles: ['lead'] }, { name: 'Noor El-Sayed', roles: ['sponsor'] }] },
  use_case_category: ['Anomaly detection'], features: ['Duplicate claim spotting'], tools: { 'Duplicate claim spotting': 'Dataiku' },
});
const travel = sampleIdea({
  id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', region: 'APAC', dedupe_key: 'f',
  people: { submitter: 'Lucía Fernández', team: [] }, use_case_category: ['Knowledge assistant'],
});
const faq = sampleIdea({
  id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', region: 'AMER', dedupe_key: 'g',
  people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', roles: ['lead'] }] }, use_case_category: ['Knowledge assistant'],
});
const ai = (idea: string, from: string, rel: AiLink['rel'], to: string, newNode: { type: 'Capability' | 'System' | 'PainPoint'; id: string; label: string } | null, confidence = 0.9, status: AiLink['status'] = 'confirmed'): AiLink =>
  ({ from, rel, to, description: '', source: `ai:fake:${idea}`, confidence, status, idea: idea.replace(/^idea:/, ''), ...(newNode ? { newNodes: [newNode] } : {}) });
const LINKS: AiLink[] = [
  ai('CAFE-2026-006', 'idea:CAFE-2026-006', 'NEEDS', 'capability:policy-q-a', { type: 'Capability', id: 'capability:policy-q-a', label: 'Policy Q&A' }),
  ai('CAFE-2026-006', 'capability:policy-q-a', 'USES_DATA', 'system:travel-expense-policy', { type: 'System', id: 'system:travel-expense-policy', label: 'Travel & Expense policy' }, 0.8),
  ai('CAFE-2026-007', 'idea:CAFE-2026-007', 'NEEDS', 'capability:policy-q-a', null),
  ai('CAFE-2026-007', 'capability:policy-q-a', 'USES_DATA', 'system:procurement-policy', { type: 'System', id: 'system:procurement-policy', label: 'Procurement policy' }, 0.7),
];
const rels = (g: { edges: { from: string; rel: string; to: string }[] }) => g.edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
const derived = (g: { edges: any[] }) => g.edges.filter((e) => e.derived);
const only = (name: string): Rule[] => DEFAULT_RULES.map((r) => ({ ...r, enabled: r.name === name }));

describe('the ontology knows the derived relations', () => {
  it('lists them with their allowed ends', () => {
    expect(DERIVED_RELATIONS).toEqual(['DEPENDS_ON', 'USES', 'OWNS', 'SIMILAR_TO']);
    expect(ALLOWED.DEPENDS_ON).toEqual(['Idea', 'System']); expect(ALLOWED.USES).toEqual(['Idea', 'Tool']);
    expect(ALLOWED.OWNS).toEqual(['Team', 'Idea']); expect(ALLOWED.SIMILAR_TO).toEqual(['Idea', 'Idea']);
  });
  it('an AI edge carries the idea it was extracted for; a form edge and an operator link do not need to', () => {
    const g = buildGraph([travel], LINKS);
    expect(g.edges.find((e) => e.id === 'capability:policy-q-a|USES_DATA|system:travel-expense-policy')?.idea).toBe('CAFE-2026-006');
    expect(g.edges.find((e) => e.rel === 'SUBMITTED')?.idea).toBeUndefined();
  });
});

describe('needs+uses_data: Idea NEEDS Capability, Capability USES_DATA System → Idea DEPENDS_ON System', () => {
  const g = buildGraph([expense, travel, faq], LINKS, [], [], { rules: only('needs+uses_data') });
  it('derives the dependency for the idea the data was extracted for, looking derived', () => {
    const e = g.edges.find((x) => x.id === 'idea:CAFE-2026-006|DEPENDS_ON|system:travel-expense-policy')!;
    expect(e).toMatchObject({
      source: 'rule:needs+uses_data', confidence: 0.8, confirmed: true, description: 'via Policy Q&A',
      derived: { rule: 'needs+uses_data', inputs: ['idea:CAFE-2026-006|NEEDS|capability:policy-q-a', 'capability:policy-q-a|USES_DATA|system:travel-expense-policy'] },
    });
    expect(rels(g)).toContain('idea:CAFE-2026-007 DEPENDS_ON system:procurement-policy');
  });
  it('the scope the simulation caught: 007 shares the capability with 006 but does not depend on the travel policy', () => {
    expect(rels(g)).not.toContain('idea:CAFE-2026-007 DEPENDS_ON system:travel-expense-policy');
    expect(rels(g)).not.toContain('idea:CAFE-2026-006 DEPENDS_ON system:procurement-policy');
  });
  it('an operator link made with no idea on screen is shared knowledge: it chains with every idea that needs the capability', () => {
    const edits: OperatorEdit[] = [
      { id: 'op-1', at: '2026-10-26', status: 'active', t: 'add', node: 'system:policy-portal', type: 'System', label: 'Policy portal' },
      { id: 'op-2', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:policy-q-a', rel: 'USES_DATA', to: 'system:policy-portal' },
    ];
    const r = rels(buildGraph([expense, travel, faq], LINKS, [], edits, { rules: only('needs+uses_data') }));
    expect(r).toContain('idea:CAFE-2026-006 DEPENDS_ON system:policy-portal');
    expect(r).toContain('idea:CAFE-2026-007 DEPENDS_ON system:policy-portal');
  });
  it('an operator link made with an idea on screen is that idea\'s', () => {
    const edits: OperatorEdit[] = [
      { id: 'op-1', at: '2026-10-26', status: 'active', t: 'add', node: 'system:policy-portal', type: 'System', label: 'Policy portal' },
      { id: 'op-2', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:policy-q-a', rel: 'USES_DATA', to: 'system:policy-portal', idea: 'CAFE-2026-007' },
    ];
    const r = rels(buildGraph([expense, travel, faq], LINKS, [], edits, { rules: only('needs+uses_data') }));
    expect(r).not.toContain('idea:CAFE-2026-006 DEPENDS_ON system:policy-portal');
    expect(r).toContain('idea:CAFE-2026-007 DEPENDS_ON system:policy-portal');
  });
  it('is never confirmed unless every input is, and takes the lowest confidence', () => {
    const links = [...LINKS.slice(0, 1), { ...LINKS[1], status: 'pending' as const, confidence: 0.55 }];
    const e = buildGraph([travel], links, [], [], { rules: only('needs+uses_data') }).edges.find((x) => x.rel === 'DEPENDS_ON')!;
    expect(e).toMatchObject({ confirmed: false, confidence: 0.55 });
  });
});

describe('needs+built_with: Idea NEEDS Capability, Capability BUILT_WITH Tool → Idea USES Tool', () => {
  it('derives from the tool picker\'s form links, with no scope: a capability\'s tool is shared', () => {
    const other = sampleIdea({ ...faq, features: ['Duplicate claim spotting'], tools: {} });
    const g = buildGraph([expense, other], [], [], [], { rules: only('needs+built_with') });
    expect(rels(g)).toContain('idea:CAFE-2026-004 USES tool:dataiku');
    expect(rels(g)).toContain('idea:CAFE-2026-007 USES tool:dataiku');
    expect(g.edges.find((e) => e.rel === 'USES')).toMatchObject({ source: 'rule:needs+built_with', confirmed: true, confidence: 1, description: 'via Duplicate claim spotting' });
  });
});

describe('member+submitted: Team HAS_MEMBER Person, Person SUBMITTED Idea → Team OWNS Idea', () => {
  it('a team owns the ideas its members submitted', () => {
    const g = buildGraph([expense, travel, faq], [], [], [], { rules: only('member+submitted') });
    expect(derived(g).map((e) => `${e.from} ${e.rel} ${e.to}`).sort()).toEqual([
      'team:gss OWNS idea:CAFE-2026-004', 'team:gss OWNS idea:CAFE-2026-006', 'team:gss OWNS idea:CAFE-2026-007',
    ]);
    expect(derived(g)[0].derived.inputs).toEqual(['team:gss|HAS_MEMBER|person:ingrid-solberg', 'person:ingrid-solberg|SUBMITTED|idea:CAFE-2026-004']);
  });
});

describe('shared-stars: two ideas sharing two or more stars → SIMILAR_TO', () => {
  it('006 and 007 share Policy Q&A and the category: similar at 2/3, with the shared stars as the why', () => {
    const g = buildGraph([expense, travel, faq], LINKS, [], [], { rules: only('shared-stars') });
    const sim = derived(g);
    expect(sim).toHaveLength(1);
    expect(sim[0]).toMatchObject({
      id: 'idea:CAFE-2026-006|SIMILAR_TO|idea:CAFE-2026-007', source: 'rule:shared-stars', confidence: 0.67, confirmed: true, description: 'share Knowledge assistant, Policy Q&A',
    });
    expect(sim[0].derived.inputs.sort()).toEqual([
      'idea:CAFE-2026-006|IN_CATEGORY|category:knowledge-assistant', 'idea:CAFE-2026-006|NEEDS|capability:policy-q-a',
      'idea:CAFE-2026-007|IN_CATEGORY|category:knowledge-assistant', 'idea:CAFE-2026-007|NEEDS|capability:policy-q-a',
    ]);
  });
  it('one shared star is not enough; three or more is full confidence; min is read from the rule', () => {
    const g1 = buildGraph([travel, { ...faq, use_case_category: [] }], LINKS, [], [], { rules: only('shared-stars') });
    expect(derived(g1)).toEqual([]);
    const loose = DEFAULT_RULES.map((r) => (r.name === 'shared-stars' ? { ...r, min: 1 } : { ...r, enabled: false }));
    expect(derived(buildGraph([travel, { ...faq, use_case_category: [] }], LINKS, [], [], { rules: loose }))).toHaveLength(1);
    const three = [...LINKS, ai('CAFE-2026-006', 'idea:CAFE-2026-006', 'REPLACES', 'painpoint:policy-emails', { type: 'PainPoint', id: 'painpoint:policy-emails', label: 'Policy emails' }), ai('CAFE-2026-007', 'idea:CAFE-2026-007', 'REPLACES', 'painpoint:policy-emails', null)];
    expect(derived(buildGraph([travel, faq], three, [], [], { rules: only('shared-stars') }))[0].confidence).toBe(1);
  });
});

describe('the rules as a whole', () => {
  it('a disabled rule derives nothing; all four run by default; a derived edge never replaces a stated one', () => {
    const off = DEFAULT_RULES.map((r) => ({ ...r, enabled: false }));
    expect(derived(buildGraph([expense, travel, faq], LINKS, [], [], { rules: off }))).toEqual([]);
    const g = buildGraph([expense, travel, faq], LINKS);
    expect(new Set(derived(g).map((e) => e.rel))).toEqual(new Set(['DEPENDS_ON', 'USES', 'OWNS', 'SIMILAR_TO']));
    expect(g.edges.filter((e) => !e.derived)).toEqual(buildGraph([expense, travel, faq], LINKS, [], [], { rules: off }).edges);
    // The operator stated the dependency: the stated edge stays, the rule adds nothing on top of it.
    const stated: OperatorEdit[] = [{ id: 'op-1', at: '2026-10-26', status: 'active', t: 'link', from: 'idea:CAFE-2026-006', rel: 'DEPENDS_ON', to: 'system:travel-expense-policy' }];
    const e = buildGraph([travel], LINKS, [], stated).edges.find((x) => x.id === edgeId('idea:CAFE-2026-006', 'DEPENDS_ON', 'system:travel-expense-policy'))!;
    expect(e.source).toBe('operator'); expect(e.derived).toBeUndefined();
  });
  it('infer is pure: the same input gives the same edges, in id order', () => {
    const g = buildGraph([expense, travel, faq], LINKS, [], [], { rules: [] });
    const a = infer(g.nodes, g.edges, DEFAULT_RULES); const b = infer(g.nodes, g.edges, DEFAULT_RULES);
    expect(a).toEqual(b);
    expect(a.map((e) => e.id)).toEqual([...a.map((e) => e.id)].sort());
  });
  it('parseRules: a chain or shared-stars rule in the file\'s words; unknown relations and malformed rules are dropped', () => {
    const rules = parseRules({ rules: [
      { name: 'x', chain: ['NEEDS', 'USES_DATA'], then: 'DEPENDS_ON', scope: 'same-idea', enabled: true },
      { name: 'y', chain: ['NEEDS', 'NOPE'], then: 'DEPENDS_ON' },
      { name: 'z', kind: 'shared-stars', min: 3 },
      { name: 'w', then: 'USES' },
      'not a rule',
    ] });
    expect(rules).toEqual([
      { name: 'x', kind: 'chain', chain: ['NEEDS', 'USES_DATA'], then: 'DEPENDS_ON', scope: 'same-idea', enabled: true },
      { name: 'z', kind: 'shared-stars', then: 'SIMILAR_TO', min: 3, enabled: true },
    ]);
    expect(parseRules(null)).toEqual(DEFAULT_RULES);
    expect(parseRules({ rules: 'nope' })).toEqual(DEFAULT_RULES);
  });
  it('init writes rules/inference.yaml with the four rules; a rule switched off there derives nothing; a broken file means the defaults', async () => {
    const root = await tmpWorkspace();
    const file = YAML.parse(await readFile(path.join(root, 'rules', 'inference.yaml'), 'utf8'));
    expect(file.rules.map((r: any) => r.name)).toEqual(['needs+uses_data', 'needs+built_with', 'member+submitted', 'shared-stars']);
    expect(await loadRules(root)).toEqual(DEFAULT_RULES);
    for (const i of [expense, travel, faq]) await saveIdea(root, i);
    expect(derived(await rebuildGraph(root)).some((e) => e.rel === 'OWNS')).toBe(true);
    // edges.jsonl, the derived file, carries them flagged.
    const lines = (await readFile(path.join(paths(root).graph, 'edges.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.some((e) => e.derived?.rule === 'member+submitted')).toBe(true);
    await writeYaml(paths(root).inference, { rules: file.rules.map((r: any) => (r.name === 'member+submitted' ? { ...r, enabled: false } : r)) });
    expect(derived(await rebuildGraph(root)).some((e) => e.rel === 'OWNS')).toBe(false);
    await writeFileAtomic(paths(root).inference, 'rules: [a: {');
    expect(await loadRules(root)).toEqual(DEFAULT_RULES);
  });
});

import { BundleCache, ideaBundle } from '../src/graph/build';
import { appendAiLink } from '../src/graph/store';
import { appendEdit, readEdits, setEditStatus } from '../src/graph/operator';
import { listIdeas } from '../src/ideas/store';
import { listRounds } from '../src/round/store';
import { readAiLinks } from '../src/graph/store';
import { registryFrom } from '../src/graph/registryFile';
import { touched } from '../src/memory/touch';

describe('incremental: per-idea bundles cached by content, folded operator log', () => {
  it('ideaBundle is pure and the cache serves an unchanged idea again', () => {
    const cache = new BundleCache();
    const a = buildGraph([expense, travel, faq], LINKS, [], [], { cache });
    expect(cache.misses).toBe(3); expect(cache.hits).toBe(0);
    const b = buildGraph([expense, travel, faq], LINKS, [], [], { cache });
    expect(cache.hits).toBe(3);
    expect(b).toEqual(a);
    expect(b).toEqual(buildGraph([expense, travel, faq], LINKS));
    expect(ideaBundle(expense)).toEqual(ideaBundle({ ...expense }));
    // An edited field is a new bundle; the others are served from the cache.
    buildGraph([{ ...expense, title: 'Expense anomaly spotter' }, travel, faq], LINKS, [], [], { cache });
    expect(cache.misses).toBe(4); expect(cache.hits).toBe(5);
  });
  it('after every kind of change the incremental rebuild equals a full build, edge for edge', async () => {
    const root = await tmpWorkspace();
    const full = async () => {
      const [{ ideas }, { links }, rounds, edits] = await Promise.all([listIdeas(root), readAiLinks(root), listRounds(root), readEdits(root)]);
      return buildGraph(ideas, links, rounds, edits, { registry: await registryFrom(root, edits), rules: await loadRules(root) });
    };
    const same = async () => { const inc = await rebuildGraph(root); const f = await full(); expect(inc.nodes).toEqual(f.nodes); expect(inc.edges).toEqual(f.edges); return inc; };
    for (const i of [expense, travel]) await saveIdea(root, i);
    await same();
    await saveIdea(root, faq); await same();                                                          // a new idea
    await saveIdea(root, { ...faq, use_case_category: ['Knowledge assistant', 'FAQ'] }); await same(); // an edited field
    for (const l of LINKS) await appendAiLink(root, l);
    await same();                                                                                     // AI links
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'rename', node: 'capability:policy-q-a', label: 'Policy questions' }); await same(); // an operator edit
    await appendEdit(root, { id: 'op-2', at: '2026-10-26', status: 'active', t: 'alias', node: 'capability:policy-q-a', label: 'Policy lookup', of: 'Policy questions' });
    await saveIdea(root, { ...expense, features: ['Policy lookup'] }); await same();                   // an alias in use
    await setEditStatus(root, 'op-1', 'undone'); await same();                                        // a rewritten log
    await writeYaml(paths(root).inference, { rules: DEFAULT_RULES.map((r) => ({ ...r, enabled: r.name !== 'needs+uses_data' })) });
    const g = await same();                                                                           // a rule off
    expect(g.edges.some((e) => e.rel === 'DEPENDS_ON')).toBe(false);
    expect(g.edges.some((e) => e.rel === 'OWNS')).toBe(true);
    // A touch from Deep read's bus drops the idea's bundle; the graph is the same after.
    touched(root, ['CAFE-2026-004'], 'save'); await same();
  });
  it('readEdits folds appended lines and re-reads a rewritten file', async () => {
    const root = await tmpWorkspace();
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'rename', node: 'team:gss', label: 'G' });
    expect((await readEdits(root)).map((e) => e.id)).toEqual(['op-1']);
    await appendEdit(root, { id: 'op-2', at: '2026-10-26', status: 'active', t: 'rename', node: 'team:gss', label: 'H' });
    expect((await readEdits(root)).map((e) => e.id)).toEqual(['op-1', 'op-2']);
    await setEditStatus(root, 'op-1', 'undone');
    expect((await readEdits(root)).map((e) => e.status)).toEqual(['undone', 'active']);
    await writeFileAtomic(path.join(paths(root).graph, 'operator.jsonl'), '');
    expect(await readEdits(root)).toEqual([]);
  });
});
