import { describe, it, expect } from 'vitest';
import { starProfile } from './starProfile';
import { leftStar } from './IdeasPane';

const graph = {
  nodes: [
    { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Desk booking' },
    { id: 'idea:CAFE-2026-002', type: 'Idea', label: 'FAQ bot' },
    { id: 'person:p1', type: 'Person', label: 'Person 1' },
    { id: 'team:gss', type: 'Team', label: 'GSS' },
    { id: 'tool:pa', type: 'Tool', label: 'Power Apps', attrs: { approved: true } },
    { id: 'capability:c', type: 'Capability', label: 'Booking' },
  ],
  edges: [
    { from: 'person:p1', rel: 'SUBMITTED', to: 'idea:CAFE-2026-001' },
    { from: 'person:p1', rel: 'LEADS', to: 'idea:CAFE-2026-001' },
    { from: 'person:p1', rel: 'BUILDS', to: 'idea:CAFE-2026-002' },
    { from: 'team:gss', rel: 'HAS_MEMBER', to: 'person:p1' },
    { from: 'capability:c', rel: 'BUILT_WITH', to: 'tool:pa' },
    { from: 'idea:CAFE-2026-001', rel: 'NEEDS', to: 'capability:c' },
  ],
};
const state = {
  ideas: [
    { id: 'CAFE-2026-001', title: 'Desk booking', people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }] } },
    { id: 'CAFE-2026-002', title: 'FAQ bot', people: { submitter: 'Person 9', team: [{ name: 'person 1', roles: ['builder'] }] } },
  ],
};

describe('a star in the left panel', () => {
  it('a person: what they are, their roles on each idea, their team', () => {
    const p = starProfile(graph, state, 'person:p1')!;
    expect(p).toMatchObject({ kind: 'Person', label: 'Person 1' });
    expect(p.roles).toEqual([
      { ideaId: 'CAFE-2026-001', title: 'Desk booking', roles: ['Submitter', 'Lead'] },
      { ideaId: 'CAFE-2026-002', title: 'FAQ bot', roles: ['Builder'] },
    ]);
    expect(p.facts).toEqual([['Ideas', '2'], ['Links', '4']]);
    expect(p.groups).toEqual([{ type: 'Team', kind: 'Team', items: [{ id: 'team:gss', label: 'GSS', rel: 'HAS_MEMBER' }] }]);
  });

  it('a tool: whether it is approved, and the capabilities it builds; ideas are left to the right panel', () => {
    const p = starProfile(graph, state, 'tool:pa')!;
    expect(p.facts[0]).toEqual(['On the approved list', 'Yes']);
    expect(p.groups.map((g) => g.type)).toEqual(['Capability']);
    expect(p.roles).toEqual([]);
  });

  it('an idea or an unknown star has no profile', () => {
    expect(starProfile(graph, state, 'idea:CAFE-2026-001')).toBeNull();
    expect(starProfile(graph, state, 'team:nope')).toBeNull();
  });

  it('shows only for one picked star while no idea is open', () => {
    const s = (o: object) => ({ leftView: { kind: 'list' }, selectedId: 'team:gss', selectedIds: [], ...o });
    expect(leftStar(s({}), graph)).toBe('team:gss');
    expect(leftStar(s({ selectedId: 'idea:CAFE-2026-001' }), graph)).toBeNull();
    expect(leftStar(s({ leftView: { kind: 'idea' } }), graph)).toBeNull();
    expect(leftStar(s({ selectedIds: ['team:gss', 'tool:pa'] }), graph)).toBeNull();
    expect(leftStar(s({ selectedId: null }), graph)).toBeNull();
  });
});
