import { describe, it, expect } from 'vitest';
import { byMeaning, filterIdeas, stageKey, emailChips } from './filterIdeas';

const ideas: any[] = [
  { id: 'CAFE-2026-001', title: 'Email scheduler', function: 'BSI', stage: 1 },
  { id: 'CAFE-2026-002', title: 'RFx intake agent', function: 'GSS', stage: 2 },
  { id: 'CAFE-2026-003', title: 'Invoice checker', function: 'GSS', stage: 3, closed: { as: 'csic' } },
];

describe('filterIdeas', () => {
  it('returns everything with no query and no stages', () => expect(filterIdeas(ideas, '', [])).toHaveLength(3));
  it('matches id, title and function, ignoring case', () => {
    expect(filterIdeas(ideas, 'rfx', []).map((i) => i.id)).toEqual(['CAFE-2026-002']);
    expect(filterIdeas(ideas, '001', []).map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect(filterIdeas(ideas, 'gss', []).map((i) => i.id)).toEqual(['CAFE-2026-002', 'CAFE-2026-003']);
  });
  it('filters by stage, with closed as its own stage', () => {
    expect(filterIdeas(ideas, '', ['2']).map((i) => i.id)).toEqual(['CAFE-2026-002']);
    expect(filterIdeas(ideas, '', ['closed']).map((i) => i.id)).toEqual(['CAFE-2026-003']);
    expect(filterIdeas(ideas, '', ['1', '2']).map((i) => i.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-002']);
  });
  it('combines query and stages', () => expect(filterIdeas(ideas, 'gss', ['2'])).toHaveLength(1));
  it('stageKey', () => { expect(stageKey(ideas[2])).toBe('closed'); expect(stageKey(ideas[0])).toBe('1'); });
});

describe('emailChips', () => {
  it('shows sent mails with a date and unsent drafts', () => {
    const chips = emailChips({ id: 'X', sent: { E1: '2026-10-19' } } as any, [{ idea: 'X', template: 'E5', status: 'draft' }, { idea: 'Y', template: 'E2', status: 'draft' }, { idea: 'X', template: 'E1', status: 'sent' }] as any);
    expect(chips).toEqual(['E1 ✓ 19 Oct', 'E5 draft']);
  });
});

describe('byMeaning (Deep read)', () => {
  it('keeps the server\'s order, drops unknown ids, and obeys the stage chips; nothing without a ranking', () => {
    const ranked = [{ id: 'CAFE-2026-002' }, { id: 'CAFE-2026-999' }, { id: 'CAFE-2026-001' }];
    expect(byMeaning(ideas, ranked, []).map((i) => i.id)).toEqual(['CAFE-2026-002', 'CAFE-2026-001']);
    expect(byMeaning(ideas, ranked, [stageKey(ideas[0])]).map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect(byMeaning(ideas, null, [])).toEqual([]);
    expect(byMeaning(ideas, [], [])).toEqual([]);
  });
});
