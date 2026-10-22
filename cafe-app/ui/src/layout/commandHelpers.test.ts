import { describe, it, expect } from 'vitest';
import { insertMention, mentionQuery, searchStars } from './commandHelpers';

const nodes = [
  { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Vendor contract summariser', attrs: { cafeId: 'CAFE-2026-001' } },
  { id: 'capability:contract-clause-finding', type: 'Capability', label: 'Contract clause finding' },
  { id: 'person:avery-chen', type: 'Person', label: 'Avery Chen' },
  { id: 'team:gss', type: 'Team', label: 'GSS' },
];

describe('@ mentions', () => {
  it('finds the "@query" before the caret; an email address is not a mention', () => {
    expect(mentionQuery('link @ven', 9)).toEqual({ start: 5, query: 'ven' });
    expect(mentionQuery('link @', 6)).toEqual({ start: 5, query: '' });
    expect(mentionQuery('mail a@b.com', 12)).toBeNull();
    expect(mentionQuery('no mention', 10)).toBeNull();
  });
  it('searches names and Café IDs: starts-with first, then by kind', () => {
    expect(searchStars(nodes, 'contract').map((h) => h.label)).toEqual(['Contract clause finding', 'Vendor contract summariser']);
    expect(searchStars(nodes, 'cafe-2026-001').map((h) => h.id)).toEqual(['idea:CAFE-2026-001']);
    expect(searchStars(nodes, 'chen').map((h) => h.label)).toEqual(['Avery Chen']);
    expect(searchStars(nodes, '').map((h) => h.type)).toEqual(['Idea', 'Team', 'Person', 'Capability']);
  });
  it('puts the full name in place of what was typed', () => {
    expect(insertMention('link @ven to GSS', 5, 9, 'Vendor contract summariser')).toEqual({ text: 'link @Vendor contract summariser to GSS', caret: 33 });
  });
});
