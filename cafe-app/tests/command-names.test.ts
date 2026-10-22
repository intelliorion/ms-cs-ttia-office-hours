import { describe, it, expect } from 'vitest';
import { hideNames, showNames } from '../src/command/names';
import type { GNode } from '../src/graph/ontology';

const nodes: GNode[] = [
  { id: 'person:avery-chen', type: 'Person', label: 'Avery Chen' },
  { id: 'person:zainab-okafor', type: 'Person', label: 'Zainab Okafor' },
  { id: 'person:avery-stone', type: 'Person', label: 'Avery Stone' },
  { id: 'team:bsi', type: 'Team', label: 'BSI' },
  { id: 'team:gss', type: 'Team', label: 'GSS' },
  { id: 'entity:cs', type: 'Entity', label: 'Corporate Services (CS)' },
  { id: 'idea:CAFE-2026-006', type: 'Idea', label: 'Travel policy assistant', attrs: { cafeId: 'CAFE-2026-006' } },
  { id: 'idea:CAFE-2026-007', type: 'Idea', label: 'Procurement FAQ bot', attrs: { cafeId: 'CAFE-2026-007' } },
  { id: 'capability:policy-q-a', type: 'Capability', label: 'Policy Q&A' },
  { id: 'round:round-001', type: 'Round', label: '2026 Q4', attrs: { roundId: 'ROUND-001' } },
];

describe('hiding names from the AI', () => {
  it('swaps known people for codes; the AI never sees a person\'s name', () => {
    const h = hideNames('link Avery Chen to BSI as a member', nodes);
    expect(h.text).toBe('link [P1] to [T1] as a member');
    expect(JSON.stringify(h.legend)).not.toMatch(/Avery|Chen/);
    expect(h.legend).toContainEqual({ code: 'P1', type: 'Person' });
    expect(h.legend).toContainEqual({ code: 'T1', type: 'Team', label: 'BSI' });
    expect(h.codes.get('P1')).toMatchObject({ id: 'person:avery-chen' });
  });

  it('reads "Last, First", any case, and a first name only when it is unique', () => {
    expect(hideNames('add okafor, zainab to gss', nodes).text).toBe('add [P1] to [T1]');
    expect(hideNames('Zainab joins GSS', nodes).text).toBe('[P1] joins [T1]');
    // Two Averys: a bare "Avery" is ambiguous and stays as typed.
    expect(hideNames('Avery joins GSS', nodes).text).toBe('Avery joins [T1]');
  });

  it('ideas by title or Café ID, rounds by name or ID; every idea, team and round is listed for the AI', () => {
    const h = hideNames('put CAFE-2026-006 and the procurement faq bot in ROUND-001', nodes);
    expect(h.text).toBe('put [I1] and the [I2] in [R1]');
    const types = h.legend.map((l) => l.type);
    expect(types.filter((t) => t === 'Idea')).toHaveLength(2);
    expect(types).toContain('Team');
    expect(types).toContain('Round');
    expect(h.legend).not.toContainEqual(expect.objectContaining({ type: 'Capability' }));
  });

  it('does not match inside a longer word', () => {
    expect(hideNames('the BSIX team', nodes).text).toBe('the BSIX team');
  });

  it('shows the real names again in the AI\'s reply', () => {
    const h = hideNames('link Avery Chen to BSI', nodes);
    expect(showNames('Linked [P1] to [T1]. [Q9] is unknown.', h.codes)).toBe('Linked Avery Chen to BSI. [Q9] is unknown.');
    // The AI sometimes drops the brackets; a bare code the app gave out is still put back, other words are left alone.
    expect(showNames('Linking P1 to team T1; Q9 and MP3 stay.', h.codes)).toBe('Linking Avery Chen to team BSI; Q9 and MP3 stay.');
    // A code written next to its own label reads once.
    expect(showNames('[T1] (BSI) and [P1] Avery Chen, then BSI "BSI".', h.codes)).toBe('BSI and Avery Chen, then BSI.');
  });
});
