import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { runQuery, shortestPath, type Query } from '../src/command/query';
import { sampleIdea } from './helpers';
import type { AiLink } from '../src/graph/ontology';

const ideas = [
  sampleIdea({ id: 'CAFE-2026-001', title: 'Travel policy assistant', function: 'GSS', region: 'APAC', entity: 'CS', stage: 1, round: 'ROUND-001', dedupe_key: 'a',
    people: { submitter: 'Person 1', team: [{ name: 'Person 1', role: 'lead' }, { name: 'Person 2', role: 'sponsor' }] } }),
  sampleIdea({ id: 'CAFE-2026-002', title: 'Procurement FAQ bot', function: 'GSS', region: 'AMER', entity: 'CS', stage: 2, dedupe_key: 'b',
    people: { submitter: 'Person 3', team: [{ name: 'Person 3', role: 'lead' }, { name: 'Person 4', role: 'member' }] } }),
  sampleIdea({ id: 'CAFE-2026-003', title: 'Expense anomaly finder', function: 'BSI', region: 'EMEA', entity: 'CS', stage: 1, dedupe_key: 'c',
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
const codes: Record<string, string> = { I1: 'idea:CAFE-2026-001', I2: 'idea:CAFE-2026-002', S1: 'system:expense-export', T1: 'team:gss', P1: 'person:person-1' };
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
    expect(r.counts).toEqual({ 'Submit Idea': 1, 'Review and Select': 1 });
    expect(q([{ op: 'stars', type: 'Idea', round: '2026 Q4' }]).final).toEqual(['idea:CAFE-2026-001']);
  });

  it('roles come from the ideas\' records: the leads of the policy ideas; and back from a person to their ideas', () => {
    const r = q([{ op: 'stars', type: 'Capability', match: 'policy' }, { op: 'follow', rel: 'NEEDS', type: 'Idea' }, { op: 'role', role: 'lead' }]);
    expect(r.final.sort()).toEqual(['person:person-1', 'person:person-3']);
    expect(q([{ op: 'stars', codes: ['P1'] }, { op: 'role' }]).final).toEqual(['idea:CAFE-2026-001']);
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
