import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { makeRegistry, defaultEntries } from '../src/graph/registry';
import { runQuery, plainReply, revealDerived, QUERY_GUIDE, type Query, type QueryMemory } from '../src/command/query';
import { sampleIdea } from './helpers';
import type { AiLink, OperatorEdit } from '../src/graph/ontology';

// Made-up people and ideas: "Person N" only.
const ideas = [
  sampleIdea({ id: 'CAFE-2026-001', title: 'Travel helper', function: 'GSS', entity: 'CS', dedupe_key: 'a', current_process: 'Staff email the travel desk and wait two days.',
    people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead', 'builder'] }, { name: 'Person 2', roles: ['sponsor'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', title: 'Policy bot', function: 'GSS', entity: 'CS', dedupe_key: 'b', current_process: 'A shared mailbox answers each question by hand.',
    people: { submitter: 'Person 3', team: [{ name: 'Person 2', roles: ['member'] }] } }),
  sampleIdea({ id: 'CAFE-2026-003', title: 'Notes to actions', function: 'BSI', entity: 'CS', dedupe_key: 'c', current_process: 'Someone types the actions up after each meeting.',
    people: { submitter: 'Person 4', team: [{ name: 'Person 3', roles: ['member'] }] } }),
  sampleIdea({ id: 'CAFE-2026-004', title: 'Desk finder', function: 'BSI', entity: 'CS', dedupe_key: 'd', current_process: 'People walk the floor to find a desk.',
    people: { submitter: 'Person 5', team: [{ name: 'Person 4', roles: ['member'] }] } }),
];
const ai = (from: string, rel: AiLink['rel'], to: string, type: 'Capability' | 'System' | 'PainPoint', label: string): AiLink =>
  ({ from, rel, to, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: to.startsWith(type.toLowerCase()) ? to : from, type, label }] });
const links: AiLink[] = [
  ai('idea:CAFE-2026-001', 'NEEDS', 'capability:policy-answers', 'Capability', 'Policy answers'),
  ai('idea:CAFE-2026-002', 'NEEDS', 'capability:policy-answers', 'Capability', 'Policy answers'),
  ai('idea:CAFE-2026-001', 'NEEDS', 'capability:text-extraction', 'Capability', 'Text extraction'),
  ai('idea:CAFE-2026-003', 'NEEDS', 'capability:text-extraction', 'Capability', 'Text extraction'),
  ai('idea:CAFE-2026-002', 'NEEDS', 'capability:record-update', 'Capability', 'Record update'),
  ai('idea:CAFE-2026-004', 'NEEDS', 'capability:record-update', 'Capability', 'Record update'),
  ai('idea:CAFE-2026-002', 'NEEDS', 'capability:gss-only', 'Capability', 'GSS only thing'),
  ai('capability:policy-answers', 'USES_DATA', 'system:travel-expense-policy', 'System', 'Travel & Expense policy'),
  ai('capability:policy-answers', 'USES_DATA', 'system:procurement-policy', 'System', 'Procurement policy'),
];
const edits: OperatorEdit[] = [{ id: 'op-1', at: '2026-10-26', status: 'active', t: 'alias', node: 'system:travel-expense-policy', label: 'travel policy', of: 'Travel & Expense policy' }];
const registry = makeRegistry(defaultEntries(), edits);
const graph = buildGraph(ideas, links, [], edits, { registry });
const codes: Record<string, string> = { I1: 'idea:CAFE-2026-001', I2: 'idea:CAFE-2026-002', I3: 'idea:CAFE-2026-003', I4: 'idea:CAFE-2026-004' };
const world = { graph, ideas, rounds: [], idOf: (c: string) => codes[c] };
const q = (steps: Query['steps'], extra: { last?: string[]; memory?: QueryMemory } = {}) => runQuery({ steps }, { ...world, ...extra });
const name = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

describe('rank counts distinct stars and keeps ties at the cut-off', () => {
  it('who is on the most ideas: distinct ideas per person, never links (a lead who builds has three links to one idea)', () => {
    const r = q([{ op: 'stars', type: 'Person' }, { op: 'rank', type: 'Idea', limit: 1 }]);
    // Person 1 has three links (SUBMITTED, LEADS, BUILDS) to one idea; Person 2, 3 and 4 are each on two ideas.
    expect(r.ranked).toEqual([{ id: 'person:person-2', n: 2 }, { id: 'person:person-3', n: 2 }, { id: 'person:person-4', n: 2 }]);
    expect(r.trace.at(-1)!.text).toBe('Rank by distinct ideas linked, top 1 (3 with ties)');
  });
  it('a tie at the cut-off keeps every star tied with the last one kept', () => {
    const r = q([{ op: 'stars', type: 'Capability' }, { op: 'rank', rel: 'NEEDS', dir: 'in', limit: 1 }]);
    expect(r.ranked!.map((x) => x.n)).toEqual([2, 2, 2]);
    expect(r.final).toHaveLength(3);
  });
  it('the guide counts distinct ideas per person and shows the example', () => {
    const guide = QUERY_GUIDE.join('\n');
    expect(guide).toMatch(/rank: order the set by how many distinct stars each is linked to/);
    expect(guide).toMatch(/every star tied with the last one kept/);
    expect(guide).toContain('- who is on the most ideas, and in which roles: [{"op":"stars","type":"Person"},{"op":"rank","type":"Idea","limit":3},{"op":"role"}]');
  });
});

describe('an exact name wins over the nearest ones', () => {
  const near: QueryMemory = { search: () => [], similar: () => [], nearestLabels: () => [{ id: 'system:travel-expense-policy', score: 0.9 }, { id: 'system:procurement-policy', score: 0.8 }] };
  it('"travel policy" is an alias of Travel & Expense policy: the step starts from that star only', () => {
    const r = q([{ op: 'stars', type: 'System', match: 'travel policy' }], { memory: near });
    expect(r.final).toEqual(['system:travel-expense-policy']);
    expect(r.trace[0].text).toBe('Start from every system or data named like "travel policy" (exactly: Travel & Expense policy, known as "travel policy")');
  });
  it('an exact label wins over labels that merely contain the words', () => {
    expect(q([{ op: 'stars', type: 'System', match: 'Procurement policy' }]).final).toEqual(['system:procurement-policy']);
    // No exact hit: the nearest labels, as before.
    expect(q([{ op: 'stars', type: 'System', match: 'policy rules' }], { memory: near }).final).toEqual(['system:travel-expense-policy', 'system:procurement-policy']);
  });
});

describe('a search kept to the previous answer reads its ideas', () => {
  const hit = (ideaId: string, section: string, text: string) => ({ ideaId, score: 0.5, hits: [{ ideaId, section, file: 'x', text, score: 0.5 }] });
  it('scopes to the ideas of the previous answer even when its stars are capabilities, and searches past the global top', () => {
    // The global top two are BSI ideas; the previous answer (a capability) leads to the GSS ideas.
    const memory: QueryMemory = {
      search: (_t, limit) => [hit('CAFE-2026-003', 'challenge', 'x'), hit('CAFE-2026-004', 'challenge', 'y'), hit('CAFE-2026-001', 'current_process', 'Staff email the travel desk.'), hit('CAFE-2026-002', 'challenge', 'z')].slice(0, limit),
      similar: () => [], nearestLabels: () => [],
    };
    const r = q([{ op: 'search', match: 'current process', last: true, limit: 2 }], { memory, last: ['capability:policy-answers'] });
    expect(r.final.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002']);
    expect(r.trace[0].text).toBe('Search what people wrote for "current process", among the ideas of the previous answer (2)');
  });
  it('for "current process", each scoped idea with no such passage is read from its record, so the reply can quote every submitter', () => {
    const r = q([{ op: 'search', match: 'current process', last: true }], { last: ['idea:CAFE-2026-001', 'idea:CAFE-2026-003'] });
    expect(r.records).toEqual([
      { idea: 'idea:CAFE-2026-001', field: 'current_process', text: 'Staff email the travel desk and wait two days.' },
      { idea: 'idea:CAFE-2026-003', field: 'current_process', text: 'Someone types the actions up after each meeting.' },
    ]);
    expect(r.final.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-003']);
    expect(r.trace.map((t) => t.text)).toContain('Read current process from the records of 2 ideas');
  });
});

describe('the shared capabilities are what lights up, not one side\'s', () => {
  it('an intersect takes the stars it dropped out of the lit set', () => {
    const r = q([
      { op: 'stars', type: 'Idea', function: 'GSS' }, { op: 'follow', rel: 'NEEDS', type: 'Capability' },
      { op: 'intersect', with: [{ op: 'stars', type: 'Idea', function: 'BSI' }, { op: 'follow', rel: 'NEEDS', type: 'Capability' }] },
      { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true },
    ]);
    expect(r.touched).not.toContain('capability:gss-only');
    expect(r.touched).not.toContain('capability:policy-answers');
    expect(r.touched).toContain('capability:text-extraction');
    expect(r.touched).toContain('capability:record-update');
  });
  it('a grouped follow over a derived rel leaves no empty line in the trace', () => {
    const r = q([{ op: 'stars', type: 'System' }, { op: 'follow', rel: 'DEPENDS_ON', dir: 'in', type: 'Idea', group: true }]);
    expect(r.trace.every((t) => t.text.trim())).toBe(true);
  });
});

describe('what the reply relies on stays in the trace', () => {
  it('derived links past the cut are kept aside with their ends', () => {
    const r = q([{ op: 'stars', type: 'Idea' }, { op: 'follow', rel: 'SIMILAR_TO', type: 'Idea' }, { op: 'follow', rel: 'OWNS', dir: 'in', type: 'Team' }]);
    expect(r.aside ?? []).toEqual([]);
    const all = q([{ op: 'stars', type: 'Idea' }, { op: 'follow', rel: 'OWNS', dir: 'in', type: 'Team' }, { op: 'follow', rel: 'OWNS', type: 'Idea' }, { op: 'follow', rel: 'DEPENDS_ON', type: 'System' }]);
    const more = all.trace.findIndex((t) => /more derived links/.test(t.text));
    if (more !== -1) expect(all.aside!.some((a) => a.at === more && a.lines.every((l) => l.ends.length === 2))).toBe(true);
  });
  it('come back when the reply names both ends; the rest stay cut', () => {
    const trace = [{ text: 'Follow', size: 7 }, { text: 'a', size: 1 }, { text: 'and 2 more derived links', size: 2 }];
    const aside = [{ at: 2, lines: [
      { text: 'Policy bot depends on Procurement policy: derived by …', size: 1, ends: ['idea:CAFE-2026-002', 'system:procurement-policy'] as [string, string] },
      { text: 'Travel helper depends on X', size: 1, ends: ['idea:CAFE-2026-001', 'system:x'] as [string, string] },
    ] }];
    expect(revealDerived(trace, aside, 'Policy bot depends on Procurement policy.', name).map((t) => t.text))
      .toEqual(['Follow', 'a', 'Policy bot depends on Procurement policy: derived by …', 'and 1 more derived links']);
    expect(revealDerived(trace, aside, 'Nothing named.', name).map((t) => t.text)).toEqual(['Follow', 'a', 'and 2 more derived links']);
  });
});

describe('a plain reply from the steps when the AI gives none', () => {
  it('groups, a ranked list and the records, with "From the graph:" in front', () => {
    const grouped = q([{ op: 'stars', type: 'Capability', match: 'Record update' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true }]);
    expect(plainReply([grouped], name)).toBe('From the graph: Record update: Policy bot, Desk finder.');
    const ranked = q([{ op: 'stars', type: 'Person' }, { op: 'rank', type: 'Idea', limit: 1 }]);
    expect(plainReply([ranked], name)).toBe('From the graph: Person 2 (2), Person 3 (2), Person 4 (2).');
    const read = q([{ op: 'search', match: 'current process', last: true }], { last: ['idea:CAFE-2026-004'] });
    expect(plainReply([grouped, read], name)).toBe('From the graph: Record update: Policy bot, Desk finder. Desk finder (current process): "People walk the floor to find a desk."');
    expect(plainReply([], name)).toBe('');
  });
});
