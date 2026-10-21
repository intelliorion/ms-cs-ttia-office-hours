// cafe-app/tests/inbox-conflicts.test.ts
import { describe, it, expect } from 'vitest';
import { checkProposals, normaliseLabel, sameLabel, wordOverlap, type ConflictContext } from '../src/inbox/conflicts';
import type { Action } from '../src/inbox/actions';
import type { AiLink } from '../src/graph/ontology';
import { sampleIdea } from './helpers';

const link = (over: Partial<AiLink> = {}): AiLink => ({
  from: 'idea:CAFE-2026-001', to: 'capability:slot-finding', rel: 'NEEDS', description: 'd', source: 'ai:fake:reply.eml', confidence: 0.9, status: 'pending', ...over,
});
const ctx = (over: Partial<ConflictContext> = {}): ConflictContext => ({
  idea: sampleIdea({ id: 'CAFE-2026-001', people: { team: [{ name: 'Person 1', role: 'lead' }], builder: 'Person 1' } as any }),
  ideas: [sampleIdea({ id: 'CAFE-2026-001' }), sampleIdea({ id: 'CAFE-2026-003', title: 'Invoice checker' })],
  nodes: [{ id: 'capability:slot-finding', type: 'Capability', label: 'Slot finding' }, { id: 'tool:power-apps', type: 'Tool', label: 'Power Apps' }],
  peoplePresent: ['Person 2'],
  design: null,
  match: { ideaId: 'CAFE-2026-001', confidence: 1, candidates: ['CAFE-2026-001'] },
  aiIdeaId: 'CAFE-2026-001',
  screened: [],
  ...over,
});

describe('normaliseLabel and wordOverlap', () => {
  it('lower-cases, strips punctuation and stop words, singularises', () => {
    expect(normaliseLabel('The Shared Mailboxes!')).toBe('shared mailboxes');
    expect(normaliseLabel('Slot-finding')).toBe('slot finding');
    for (const [x, y] of [['Slot templates', 'Slot template'], ['Processes', 'Process'], ['Queries', 'Query'], ['Analyses', 'Analysis'], ['Cases', 'Case'], ['Databases', 'Database'], ['Mailboxes', 'Mailbox']]) expect(sameLabel(x, y)).toBe(true);
    expect(sameLabel('Status', 'Statue')).toBe(false);
  });
  it('overlap is the share of words in common over the shorter label', () => {
    expect(wordOverlap('Request intake form', 'Request intake')).toBeCloseTo(2 / 3);
    expect(wordOverlap('Approval', 'Approval workflow')).toBe(0.5);
    expect(wordOverlap('Slot findings', 'Slot finding')).toBe(1);
    expect(wordOverlap('Manual request triage', 'Request sorting by hand')).toBeCloseTo(1 / 3);
  });
});

describe('checkProposals', () => {
  it('applies a plain link between known stars', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [link()] };
    expect(checkProposals(ctx(), [a])).toEqual({ apply: [a], hold: [] });
  });
  it('low-confidence: holds a link under 0.5, keeps the rest of the same action', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [link(), link({ to: 'tool:power-apps', rel: 'BUILT_WITH', confidence: 0.42 })] };
    const r = checkProposals(ctx(), [a]);
    expect((r.apply[0] as any).links).toHaveLength(1);
    expect(r.hold).toHaveLength(1);
    expect(r.hold[0]).toMatchObject({ rule: 'low-confidence', why: 'The AI was not sure (42%)' });
    expect((r.hold[0].action as any).links).toHaveLength(1);
  });
  it('person-star: holds a new Person node, or a label naming someone present', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [
      link({ to: 'person:person-2', newNodes: [{ id: 'person:person-2', type: 'Person', label: 'Person 2' }] }),
      link({ to: 'capability:person-2-s-desk', newNodes: [{ id: 'capability:person-2-s-desk', type: 'Capability', label: 'Person 2' }] }),
    ] };
    const r = checkProposals(ctx(), [a]);
    expect(r.apply).toEqual([]);
    expect(r.hold.map((h) => h.rule)).toEqual(['person-star', 'person-star']);
    expect(r.hold[0].why).toBe('People come from the form only, never from text');
  });
  it('near-duplicate-star: holds a new node whose label normalises to an existing one and names it', () => {
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [
      link({ to: 'capability:slot-findings', newNodes: [{ id: 'capability:slot-findings', type: 'Capability', label: 'Slot findings' }] }),
    ] };
    const r = checkProposals(ctx(), [a]);
    expect(r.hold[0]).toMatchObject({ rule: 'near-duplicate-star', why: 'Looks like Slot finding: merge or keep both?', existing: 'capability:slot-finding' });
  });
  it('contradicts-fact: a different builder waits; the same builder does not', () => {
    const other: Action = { t: 'name_builder', ideaId: 'CAFE-2026-001', name: 'Person 2' };
    const same: Action = { t: 'name_builder', ideaId: 'CAFE-2026-001', name: 'Person 1' };
    const r = checkProposals(ctx(), [other, same]);
    expect(r.apply).toEqual([same]);
    expect(r.hold[0]).toMatchObject({ rule: 'contradicts-fact', why: 'A second builder is named: the form names one already' });
  });
  it('contradicts-fact: a stage hint behind the idea or into a closure waits; forward does not', () => {
    const c = ctx({ idea: sampleIdea({ id: 'CAFE-2026-001', stage: 3 }) });
    const back: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', stage: 2 };
    const close: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', closeAs: 'csic' };
    const fwd: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', stage: 4 };
    const same: Action = { t: 'suggest_stage', ideaId: 'CAFE-2026-001', stage: 3 };
    const r = checkProposals(c, [back, close, same, fwd]);
    expect(r.apply).toEqual([same, fwd]);
    expect(r.hold.map((h) => h.rule)).toEqual(['contradicts-fact', 'contradicts-fact']);
  });
  it('two-ideas: holds everything but the filing when the match is split', () => {
    const c = ctx({ match: { ideaId: 'CAFE-2026-001', confidence: 0.9, candidates: ['CAFE-2026-001', 'CAFE-2026-003'] }, aiIdeaId: 'CAFE-2026-003' });
    const file: Action = { t: 'file_email', ideaId: 'CAFE-2026-001', direction: 'in' };
    const ans: Action = { t: 'record_answers', ideaId: 'CAFE-2026-001', answers: [{ question: 'q', answer: 'a' }] };
    const r = checkProposals(c, [file, ans]);
    expect(r.apply).toEqual([file]);
    expect(r.hold[0]).toMatchObject({ rule: 'two-ideas', why: 'This could belong to CAFE-2026-001 or CAFE-2026-003' });
  });
  it('duplicate-idea: a created idea whose title matches an existing one waits', () => {
    const a: Action = { t: 'create_idea', fields: { title: 'Invoice Checker' } };
    const r = checkProposals(ctx(), [a]);
    expect(r.hold[0]).toMatchObject({ rule: 'duplicate-idea', why: 'Looks like CAFE-2026-003 (same title)', existing: 'CAFE-2026-003' });
  });
  it('screened: when the screen flagged the file, every graph and fact action waits with the screen reason', () => {
    const c = ctx({ screened: ['Mentions a phone number'] });
    const a: Action = { t: 'graph_links', ideaId: 'CAFE-2026-001', links: [link()] };
    const r = checkProposals(c, [a, { t: 'file_email', ideaId: 'CAFE-2026-001', direction: 'in' }]);
    expect(r.apply.map((x) => x.t)).toEqual(['file_email']);
    expect(r.hold[0]).toMatchObject({ rule: 'screened', why: 'Mentions a phone number' });
  });
});
