import { describe, it, expect } from 'vitest';
import { parseTeam } from '../src/import/columns';
import { normalizePeople, addPerson, withRole, withoutRole, builderOf, rolesText } from '../src/ideas/people';
import { buildGraph } from '../src/graph/build';
import { sampleIdea } from './helpers';

describe('one person, several roles', () => {
  it('the form can give someone more than one role, in any of the ways people type it', () => {
    expect(parseTeam('Person 1 (Lead, Builder); Person 2 - Lead & Sponsor; Builder: Person 3; Person 4 (Building services)')).toEqual([
      { name: 'Person 1', roles: ['lead', 'builder'], note: 'Lead, Builder' },
      { name: 'Person 2', roles: ['lead', 'sponsor'], note: 'Lead & Sponsor' },
      { name: 'Person 3', roles: ['builder'], note: 'Builder' },
      { name: 'Person 4', roles: ['member'], note: 'Building services' },
    ]);
  });

  it('the same person on two lines is one person with both roles', () => {
    expect(parseTeam('Person 1 (Lead)\nPerson 1 (Developer)')).toEqual([{ name: 'Person 1', roles: ['lead', 'builder'], note: 'Lead; Developer' }]);
  });

  it('older records come in the new shape: one role each, a person twice, the separate builder field', () => {
    expect(normalizePeople({
      submitter: 'Person 1',
      team: [{ name: 'Person 1', role: 'lead', note: 'Lead' }, { name: 'Person 2', role: 'member' }, { name: 'person 1', role: 'sponsor' }],
      builder: 'Person 2',
    })).toEqual({
      submitter: 'Person 1',
      team: [{ name: 'Person 1', roles: ['lead', 'sponsor'], note: 'Lead' }, { name: 'Person 2', roles: ['builder'], added: ['builder'] }],
    });
    expect(normalizePeople({ builder: 'Person 9' })).toEqual({ team: [{ name: 'Person 9', roles: ['builder'], added: ['builder'], joined: true }] });
    expect(normalizePeople(undefined)).toEqual({ team: [] });
  });

  it('a role is added to the ones a person has, and taken off on its own; member only when nothing else', () => {
    let team = addPerson([], { name: 'Person 1', roles: ['member'] });
    team = withRole(team, 'Person 1', 'lead');
    team = withRole(team, 'Person 1', 'builder');
    expect(team).toEqual([{ name: 'Person 1', roles: ['lead', 'builder'] }]);
    expect(rolesText(team[0].roles)).toBe('lead and builder');
    team = withoutRole(withoutRole(team, 'Person 1', 'lead'), 'Person 1', 'builder');
    expect(team).toEqual([{ name: 'Person 1', roles: ['member'] }]);
  });

  it('the graph has one link per role, so a lead who builds it shows both', () => {
    const idea = sampleIdea({ id: 'CAFE-2026-001', people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead', 'builder'] }, { name: 'Person 2', roles: ['member'] }] } });
    expect(builderOf(idea)).toBe('Person 1');
    const rels = buildGraph([idea], []).edges.filter((e) => e.to === 'idea:CAFE-2026-001' && e.from.startsWith('person:')).map((e) => `${e.from} ${e.rel}`).sort();
    expect(rels).toEqual(['person:person-1 BUILDS', 'person:person-1 LEADS', 'person:person-1 SUBMITTED', 'person:person-2 RELATED']);
  });
});
