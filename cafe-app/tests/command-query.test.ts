import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { runQuery, shortestPath, QUERY_GUIDE, queryGuide, type Query } from '../src/command/query';
import { sampleIdea } from './helpers';
import type { AiLink } from '../src/graph/ontology';

const ideas = [
  sampleIdea({ id: 'CAFE-2026-001', title: 'Travel policy assistant', function: 'GSS', region: 'APAC', entity: 'CS', stage: 3, round: 'ROUND-001', dedupe_key: 'a',
    people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }, { name: 'Person 2', roles: ['sponsor'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', title: 'Procurement FAQ bot', function: 'GSS', region: 'AMER', entity: 'CS', stage: 2, dedupe_key: 'b',
    people: { submitter: 'Person 3', team: [{ name: 'Person 3', roles: ['lead'] }, { name: 'Person 4', roles: ['member'] }] } }),
  sampleIdea({ id: 'CAFE-2026-003', title: 'Expense anomaly finder', function: 'BSI', region: 'EMEA', entity: 'CS', stage: 3, dedupe_key: 'c',
    people: { submitter: 'Person 5', team: [] } }),
];
const ai = (from: string, rel: AiLink['rel'], to: string, type: 'Capability' | 'System' | 'PainPoint', label: string): AiLink =>
  ({ from, rel, to, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: to.startsWith(type.toLowerCase()) ? to : from, type, label }] });
const links: AiLink[] = [
  ai('idea:CAFE-2026-001', 'NEEDS', 'capability:policy-q-a', 'Capability', 'Policy Q&A'),
  ai('idea:CAFE-2026-002', 'NEEDS', 'capability:policy-q-a', 'Capability', 'Policy Q&A'),
  ai('idea:CAFE-2026-003', 'NEEDS', 'capability:claim-scoring', 'Capability', 'Claim scoring'),
  { ...ai('capability:claim-scoring', 'USES_DATA', 'system:expense-export', 'System', 'Expense export') },
  ai('idea:CAFE-2026-001', 'REPLACES', 'painpoint:policy-emails', 'PainPoint', 'Policy emails'),
];
const graph = buildGraph(ideas, links, [{ id: 'ROUND-001', name: '2026 Q4', created: '2026-10-01' } as any]);
const codes: Record<string, string> = { I1: 'idea:CAFE-2026-001', I2: 'idea:CAFE-2026-002', I3: 'idea:CAFE-2026-003', S1: 'system:expense-export', T1: 'team:gss', P1: 'person:person-1', P2: 'person:person-2' };
const world = { graph, ideas, rounds: [{ id: 'ROUND-001', name: '2026 Q4', created: '2026-10-01' } as any], idOf: (c: string) => codes[c] };
const q = (steps: Query['steps']) => runQuery({ steps }, world);

describe('the knowledge-graph query', () => {
  it('ideas that need a capability using the expense export: three hops, every star on the way lit', () => {
    const r = q([{ op: 'stars', codes: ['S1'] }, { op: 'follow', rel: 'USES_DATA', dir: 'in', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea' }]);
    expect(r.final).toEqual(['idea:CAFE-2026-003']);
    expect(r.touched.sort()).toEqual(['capability:claim-scoring', 'idea:CAFE-2026-003', 'system:expense-export']);
    expect(r.trace.map((t) => t.size)).toEqual([1, 1, 1]);
    expect(r.trace[0].text).toBe('Start from Expense export');
    expect(r.trace[1].text).toBe('Follow uses data links to capabilities');
  });

  it('the most needed capability, by counting links', () => {
    const r = q([{ op: 'stars', type: 'Capability' }, { op: 'rank', rel: 'NEEDS', dir: 'in', limit: 1 }]);
    expect(r.ranked).toEqual([{ id: 'capability:policy-q-a', n: 2 }]);
    // The scan it started from ("every capability") is not lit: only what it found.
    expect(r.touched).toEqual(['capability:policy-q-a']);
    expect(r.trace[0].text).toBe('Start from every capability');
  });

  it('ideas by stage and function, counted', () => {
    const r = q([{ op: 'stars', type: 'Idea', function: 'GSS' }, { op: 'count_by', by: 'stage' }]);
    expect(r.final).toHaveLength(2);
    expect(r.counts).toEqual({ 'Design series': 1, 'Review and Select': 1 });
    expect(q([{ op: 'stars', type: 'Idea', round: '2026 Q4' }]).final).toEqual(['idea:CAFE-2026-001']);
  });

  it('roles come from the ideas\' records: the leads of the policy ideas; and back from a person to their ideas', () => {
    const r = q([{ op: 'stars', type: 'Capability', match: 'policy' }, { op: 'follow', rel: 'NEEDS', type: 'Idea' }, { op: 'role', role: 'lead' }]);
    expect(r.final.sort()).toEqual(['person:person-1', 'person:person-3']);
    expect(q([{ op: 'stars', codes: ['P1'] }, { op: 'role' }]).final).toEqual(['idea:CAFE-2026-001']);
  });

  it('a role step hands over the facts about each person: the role word per idea, and the team or none', () => {
    // From a person: their roles on the ideas found, and the team they submitted from.
    expect(q([{ op: 'stars', codes: ['P1'] }, { op: 'role' }]).people).toEqual([
      { id: 'person:person-1', roles: [{ idea: 'idea:CAFE-2026-001', role: 'submitter' }, { idea: 'idea:CAFE-2026-001', role: 'lead' }], teams: ['team:gss'] },
    ]);
    // A sponsor who never submitted has no team recorded.
    expect(q([{ op: 'stars', codes: ['P2'] }, { op: 'role' }]).people).toEqual([
      { id: 'person:person-2', roles: [{ idea: 'idea:CAFE-2026-001', role: 'sponsor' }], teams: [] },
    ]);
    // From ideas: the people found, with every role they have on those ideas, even when the step asked for one.
    const r = q([{ op: 'stars', codes: ['I2'] }, { op: 'role', role: 'lead' }]);
    expect(r.people).toEqual([{ id: 'person:person-3', roles: [{ idea: 'idea:CAFE-2026-002', role: 'submitter' }, { idea: 'idea:CAFE-2026-002', role: 'lead' }], teams: ['team:gss'] }]);
    expect(q([{ op: 'stars', codes: ['I1'] }, { op: 'follow' }]).people).toBeUndefined();
  });

  it('a follow over a derived relation hands over why each link holds: the chain star of DEPENDS_ON', () => {
    // (These ideas share one star only, so no SIMILAR_TO is derived here; the shared-stars reason is covered by the assistant's test.)
    expect(q([{ op: 'stars', codes: ['S1'] }, { op: 'follow', rel: 'DEPENDS_ON', dir: 'in', type: 'Idea' }]).reasons).toEqual([
      { from: 'idea:CAFE-2026-003', to: 'system:expense-export', rel: 'DEPENDS_ON', why: 'via Claim scoring' },
    ]);
    expect(q([{ op: 'stars', codes: ['I1'] }, { op: 'follow', rel: 'NEEDS' }]).reasons).toBeUndefined();
  });

  it('shared: GSS ideas that also replace a pain point', () => {
    const r = q([{ op: 'stars', type: 'Idea', function: 'GSS' }, { op: 'intersect', with: [{ op: 'stars', type: 'PainPoint' }, { op: 'follow', rel: 'REPLACES', type: 'Idea' }] }]);
    expect(r.final).toEqual(['idea:CAFE-2026-001']);
    // Only the chain is lit, not the inner search's pain points.
    expect(r.touched.sort()).toEqual(['idea:CAFE-2026-001']);
    // Nothing found: nothing lit.
    expect(q([{ op: 'stars', type: 'Idea', function: 'GSS' }, { op: 'filter', function: 'BSI' }]).touched).toEqual([]);
  });

  it('path between two stars; unknown codes find nothing, not a guess', () => {
    const r = q([{ op: 'path', codes: ['I1', 'I2'] }]);
    expect(r.path).toEqual(['idea:CAFE-2026-001', 'capability:policy-q-a', 'idea:CAFE-2026-002']);
    expect(q([{ op: 'stars', codes: ['Z9'] }]).final).toEqual([]);
    expect(shortestPath([], 'a', 'b')).toEqual([]);
  });
});

describe('the query over derived relations', () => {
  it('follow with a derived rel walks the rule\'s edges and the trace says what derived them', () => {
    const r = q([{ op: 'stars', codes: ['S1'] }, { op: 'follow', rel: 'DEPENDS_ON', dir: 'in', type: 'Idea' }]);
    expect(r.final).toEqual(['idea:CAFE-2026-003']);
    expect(r.trace.map((t) => t.text)).toEqual([
      'Start from Expense export',
      'Follow depends on links to ideas',
      'Expense anomaly finder depends on Expense export: derived by needs+uses_data from Expense anomaly finder NEEDS Claim scoring, Claim scoring USES_DATA Expense export',
    ]);
    expect(r.trace[2].size).toBe(1);
  });
  it('follow with no rel keeps to what was stated: a derived link is not a neighbour', () => {
    const r = q([{ op: 'stars', codes: ['S1'] }, { op: 'follow' }]);
    expect(r.final).toEqual(['capability:claim-scoring']);
    // The shortest chain goes through the capability, never over the derived DEPENDS_ON shortcut.
    expect(q([{ op: 'path', codes: ['I3', 'S1'] }]).path).toEqual(['idea:CAFE-2026-003', 'capability:claim-scoring', 'system:expense-export']);
  });
  it('rank by a derived rel counts derived links; rank with no rel does not', () => {
    const r = q([{ op: 'stars', type: 'System' }, { op: 'rank', rel: 'DEPENDS_ON', dir: 'in', limit: 1 }]);
    expect(r.ranked).toEqual([{ id: 'system:expense-export', n: 1 }]);
    expect(q([{ op: 'stars', type: 'System' }, { op: 'rank', limit: 1 }]).ranked).toEqual([{ id: 'system:expense-export', n: 1 }]);
    expect(graph.edges.filter((e) => e.rel === 'OWNS').length).toBe(3);
    expect(q([{ op: 'stars', codes: ['T1'] }, { op: 'follow', rel: 'OWNS', type: 'Idea' }]).final.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002']);
  });
  it('the guide names the derived relations', () => {
    expect(QUERY_GUIDE.join('\n')).toMatch(/Derived by the rules.*DEPENDS_ON/);
  });
  it('the guide answers ownership over the derived OWNS link, never through a lead\'s team', () => {
    const guide = QUERY_GUIDE.join('\n');
    expect(guide).toMatch(/Which team owns, whose idea, which function or team is behind \[I1\]: follow OWNS \(dir in, type Team\) from the idea; it is derived from the submitter's team, so it exists even when no lead is recorded/);
    expect(guide).toMatch(/Do not work ownership out through a lead's HAS_MEMBER link/);
    expect(guide).toContain('- which team owns [I1]: [{"op":"stars","codes":["I1"]},{"op":"follow","rel":"OWNS","dir":"in","type":"Team"}]');
    expect(guide).toContain('what does [T1] own: [{"op":"stars","codes":["T1"]},{"op":"follow","rel":"OWNS","dir":"out","type":"Idea"}]');
  });
  it('the guide sends an impact question about a system or tool through DEPENDS_ON or USES first, search second', () => {
    const guide = QUERY_GUIDE.join('\n');
    expect(guide).toMatch(/affected, needs rework, depends on, breaks, or would be hit if a system, data source or tool changes, is retired or is rewritten/);
    expect(guide).toMatch(/follow DEPENDS_ON or USES \(dir in\) to the ideas\. Use search only afterwards/);
    expect(guide).toContain('- which ideas would need rework if [S1] changes: [{"op":"stars","codes":["S1"]},{"op":"follow","rel":"DEPENDS_ON","dir":"in","type":"Idea"}]');
    expect(guide).toMatch(/if \[T1\] is retired: \[\{"op":"stars","codes":\["T1"\]\},\{"op":"follow","rel":"USES","dir":"in","type":"Idea"\}\]/);
  });
  it('the guide plans a "similar ideas" question over SIMILAR_TO first, Deep read second, and says which is fact and which is reading', () => {
    const guide = QUERY_GUIDE.join('\n');
    expect(guide).toContain('- which ideas are similar to [I1]: [{"op":"stars","codes":["I1"]},{"op":"follow","rel":"SIMILAR_TO","type":"Idea"}]');
    expect(guide).toMatch(/then, for more candidates.*\{"op":"similar","codes":\["I1"\],"limit":5\}/);
    expect(guide).toMatch(/similar, like, same as, overlaps with.*SIMILAR_TO first/);
    expect(guide).toMatch(/SIMILAR_TO hits are facts with reasons/);
    expect(guide).toMatch(/a similar step after it adds readings with a score/);
  });
  it('the guide shows how to answer "who is [P1]": role for the roles per idea, follow HAS_MEMBER for the team', () => {
    const guide = QUERY_GUIDE.join('\n');
    expect(guide).toContain('- who is [P1]: [{"op":"stars","codes":["P1"]},{"op":"role"}]');
    expect(guide).toMatch(/who is \[P1\].*\{"op":"follow","rel":"HAS_MEMBER","dir":"in","type":"Team"\}/);
    expect(guide).toMatch(/question about a person, always use role/);
    expect(guide).toContain('no team recorded');
  });
});

describe('a shared capability and which ideas need each: the grouped follow', () => {
  it('follow with group keeps which star each result came from, in the result and the trace', () => {
    const r = q([{ op: 'stars', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true }]);
    expect(r.final.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
    // The groups follow the set's order (the capabilities as the graph lists them), each with the ideas it reached.
    expect(r.groups).toEqual([
      { from: 'capability:claim-scoring', to: ['idea:CAFE-2026-003'] },
      { from: 'capability:policy-q-a', to: ['idea:CAFE-2026-001', 'idea:CAFE-2026-002'] },
    ]);
    expect(r.trace.map((t) => t.text)).toEqual([
      'Start from every capability', 'Follow needs links to ideas, per capability',
      'Claim scoring: Expense anomaly finder', 'Policy Q&A: Travel policy assistant, Procurement FAQ bot',
    ]);
    expect(r.trace.map((t) => t.size)).toEqual([2, 3, 1, 2]);
  });
  it('a star that reaches nothing has no group; without group the result carries none', () => {
    expect(q([{ op: 'stars', codes: ['S1'] }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true }]).groups).toEqual([]);
    expect(q([{ op: 'stars', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea' }]).groups).toBeUndefined();
  });
  it('the guide plans a "shared by two teams" question as one query that groups the ideas per capability, then a search kept to those ideas', () => {
    const guide = QUERY_GUIDE.join('\n');
    expect(guide).toMatch(/With group: true the result also lists groups/);
    expect(guide).toMatch(/shared by two teams or functions, and which ideas: start from one side's ideas \(stars type Idea with function, or the team star then follow OWNS dir out\)/);
    expect(guide).toMatch(/follow NEEDS to capabilities, intersect with the same steps for the other side, then follow NEEDS \(dir in, type Idea\) with group: true, all in ONE query/);
    expect(guide).toMatch(/Never run the same steps twice/);
    expect(guide).toContain('- capabilities shared by GSS and BSI ideas, and which ideas need each: [{"op":"stars","type":"Idea","function":"GSS"},{"op":"follow","rel":"NEEDS","type":"Capability"},{"op":"intersect","with":[{"op":"stars","type":"Idea","function":"BSI"},{"op":"follow","rel":"NEEDS","type":"Capability"}]},{"op":"follow","rel":"NEEDS","dir":"in","type":"Idea","group":true}]');
    expect(guide).toMatch(/what the submitters WROTE \(current process, challenge, answers\).*\[\{"op":"search","match":"current process","last":true,"limit":8\}\]/);
    // With Deep read off the search part is gone and the rest stays.
    const off = queryGuide(false).join('\n');
    expect(off).toContain('"group":true}]');
    expect(off).not.toMatch(/"op":"search"/);
  });
});
