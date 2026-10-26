import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/graph/build';
import { runQuery, type Query, type QueryWorld } from '../src/command/query';
import { sampleIdea } from './helpers';
import type { AiLink, GNode } from '../src/graph/ontology';
import { fakeVector } from '../src/memory/embed';
import { hashOf } from '../src/memory/chunks';
import type { IndexRow } from '../src/memory/index';
import { queryMemory, THRESHOLDS } from '../src/memory/lookup';

const ideas = [
  sampleIdea({ id: 'CAFE-2026-001', title: 'Vendor contract summariser', function: 'GSS', region: 'EMEA', entity: 'CS', stage: 2, dedupe_key: 'a' }),
  sampleIdea({ id: 'CAFE-2026-002', title: 'Desk booking assistant', function: 'BSI', region: 'AMER', entity: 'CS', stage: 2, dedupe_key: 'b' }),
  sampleIdea({ id: 'CAFE-2026-003', title: 'Expense anomaly finder', function: 'GSS', region: 'EMEA', entity: 'CS', stage: 3, dedupe_key: 'c' }),
];
const ai = (from: string, to: string, type: 'Capability' | 'System', label: string): AiLink =>
  ({ from, rel: type === 'Capability' ? 'NEEDS' : 'USES_DATA', to, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed', newNodes: [{ id: to, type, label }] });
const links: AiLink[] = [
  ai('idea:CAFE-2026-001', 'capability:invoice-matching', 'Capability', 'Invoice matching'),
  ai('idea:CAFE-2026-002', 'capability:desk-finding', 'Capability', 'Desk finding'),
  ai('idea:CAFE-2026-003', 'capability:claim-scoring', 'Capability', 'Claim scoring'),
  ai('capability:claim-scoring', 'system:expense-export', 'System', 'Expense export'),
];
const graph = buildGraph(ideas, links, []);
const codes: Record<string, string> = { I1: 'idea:CAFE-2026-001', I2: 'idea:CAFE-2026-002', C1: 'capability:invoice-matching' };

/** Passages as Deep read would keep them, embedded with the fake. */
const row = (ideaId: string, section: string, text: string): IndexRow => ({ id: `${ideaId}:idea.yaml:${section}:0`, ideaId, file: 'idea.yaml', section, kind: 'submission', text, hash: hashOf(section, text), vector: fakeVector(text) });
const rows = [
  row('CAFE-2026-001', 'title+challenge', 'Vendor contract summariser\nVendor contracts and renewal dates are missed; the notice period passes.'),
  row('CAFE-2026-001', 'answers', 'Q: Where is the data?\nA: Data access is through the contract register export, a weekly spreadsheet.'),
  row('CAFE-2026-002', 'title+challenge', 'Desk booking assistant\nDesks are double booked every morning and nobody can see what is free.'),
  row('CAFE-2026-003', 'title+challenge', 'Expense anomaly finder\nDuplicate expense claims are caught only by chance; data access to the expense export is slow.'),
];
const texts = ['data access', 'renewal dates in vendor contracts', 'matching invoices', 'desk', 'nothing like this at all zzz'];
const byText = new Map(texts.map((t) => [t, fakeVector(t)]));
const labels = new Map(graph.nodes.filter((n: GNode) => n.type !== 'Person').map((n: GNode) => [n.id, fakeVector(n.label)]));
const memory = queryMemory(rows, byText, labels, graph.nodes, THRESHOLDS.fake);
const base: QueryWorld = { graph, ideas, rounds: [], idOf: (c: string) => codes[c] };
const withMemory = (steps: Query['steps']) => runQuery({ steps }, { ...base, memory });
const without = (steps: Query['steps']) => runQuery({ steps }, base);

describe('search: what people wrote', () => {
  it('finds the ideas whose passages are nearest, best first, with the hits and a trace naming the search', () => {
    const r = withMemory([{ op: 'search', match: 'data access', limit: 3 }]);
    expect(r.final.slice(0, 2).sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-003']);
    expect(r.hits!.length).toBeGreaterThan(0);
    expect(r.hits![0]).toMatchObject({ ideaId: expect.stringMatching(/CAFE-2026-00[13]/), section: expect.any(String), text: expect.stringContaining('ata access') });
    expect(r.trace).toEqual([{ text: 'Search what people wrote for "data access"', size: r.final.length }]);
    // Lit stars are the ideas the hits came from.
    expect(r.touched.sort()).toEqual([...r.final].sort());
  });
  it('narrows by function like any idea step, and finds nothing for text unlike anything', () => {
    const r = withMemory([{ op: 'search', match: 'data access', function: 'BSI' }]);
    expect(r.final).toEqual([]);
    expect(withMemory([{ op: 'search', match: 'nothing like this at all zzz' }]).final).toEqual([]);
  });
  it('without Deep read the step finds nothing and says why', () => {
    const r = without([{ op: 'search', match: 'data access' }]);
    expect(r.final).toEqual([]);
    expect(r.hits).toBeUndefined();
    expect(r.trace).toEqual([{ text: 'Deep read has not run: nothing to search', size: 0 }]);
  });
});

describe('similar: the nearest stars by meaning', () => {
  it('from an idea, the nearest other ideas; from text, the nearest ideas; from a capability, capabilities', () => {
    const r = withMemory([{ op: 'similar', codes: ['I1'], limit: 1 }]);
    expect(r.final).toEqual(['idea:CAFE-2026-003']);
    expect(r.trace[0].text).toBe('Nearest ideas to Vendor contract summariser');
    expect(withMemory([{ op: 'similar', match: 'renewal dates in vendor contracts', limit: 1 }]).final).toEqual(['idea:CAFE-2026-001']);
    const c = withMemory([{ op: 'similar', codes: ['C1'], limit: 5 }]);
    expect(c.final.every((id) => id.startsWith('capability:') && id !== 'capability:invoice-matching')).toBe(true);
    expect(c.trace[0].text).toBe('Nearest capabilities to Invoice matching');
  });
  it('without Deep read it finds nothing', () => {
    expect(without([{ op: 'similar', codes: ['I1'] }])).toMatchObject({ final: [], trace: [{ text: 'Deep read has not run: nothing to compare', size: 0 }] });
  });
});

describe('match falls back to the nearest labels', () => {
  it('a match no label contains keeps the nearest stars by meaning and says so in the trace', () => {
    const r = withMemory([{ op: 'stars', type: 'Capability', match: 'matching invoices' }]);
    expect(r.final).toEqual(['capability:invoice-matching']);
    expect(r.trace[0].text).toBe('Start from every capability named like "matching invoices" (nearest: Invoice matching)');
    const f = withMemory([{ op: 'stars', type: 'Capability' }, { op: 'filter', match: 'matching invoices' }]);
    expect(f.final).toEqual(['capability:invoice-matching']);
    expect(f.trace[1].text).toBe('Keep stars named like "matching invoices" (nearest: Invoice matching)');
  });
  it('a substring hit wins as before; people are never nearest; without Deep read the trace is as it was', () => {
    const hit = withMemory([{ op: 'stars', type: 'Capability', match: 'desk' }]);
    expect(hit.final).toEqual(['capability:desk-finding']);
    expect(hit.trace[0].text).toBe('Start from every capability named like "desk"');
    const none = without([{ op: 'stars', type: 'Capability', match: 'matching invoices' }]);
    expect(none.final).toEqual([]);
    expect(none.trace[0].text).toBe('Start from every capability named like "matching invoices"');
    expect(withMemory([{ op: 'stars', type: 'Person', match: 'matching invoices' }]).final).toEqual([]);
  });
  it('every other step gives the same answer with or without Deep read', () => {
    const qs: Query['steps'][] = [
      [{ op: 'stars', codes: ['I1'] }, { op: 'follow' }],
      [{ op: 'stars', type: 'Capability' }, { op: 'rank', rel: 'NEEDS', dir: 'in', limit: 2 }],
      [{ op: 'stars', type: 'Idea', function: 'GSS' }, { op: 'count_by', by: 'stage' }],
      [{ op: 'path', codes: ['I1', 'I2'] }],
    ];
    for (const q of qs) expect(withMemory(q)).toEqual(without(q));
  });
});
