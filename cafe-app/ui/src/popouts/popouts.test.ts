import { describe, it, expect } from 'vitest';
import { importReportLines, roundFieldsUnblock, groupOutbox, baseName, unsentCount } from './titleHelpers';

describe('importReportLines', () => {
  it('words new ideas, skipped rows, unread rows, unused columns and flags', () => {
    const lines = importReportLines({
      created: [{ id: 'CAFE-2026-001', title: 'Faster onboarding' }],
      duplicates: [{ row: 3, id: 'CAFE-2026-000', title: 'Old one' }],
      errors: [{ row: 5, message: 'No title' }],
      flags: [{ id: 'CAFE-2026-001', message: 'Cut off in the export' }],
      ignoredColumns: ['Colour', 'Mood'],
    }).map((l) => l.text);
    expect(lines).toContain('1 new idea added');
    expect(lines).toContain('CAFE-2026-001: Faster onboarding');
    expect(lines).toContain('1 row skipped because it is already in the Café');
    expect(lines).toContain('Row 3 skipped: already CAFE-2026-000 (Old one)');
    expect(lines).toContain('Row 5 not read: No title');
    expect(lines).toContain('2 columns not used: Colour, Mood');
    expect(lines).toContain('CAFE-2026-001: Cut off in the export');
  });
  it('says plainly when nothing was added', () => {
    const lines = importReportLines({ created: [], duplicates: [], errors: [], flags: [], ignoredColumns: [] });
    expect(lines).toEqual([{ kind: 'ok', text: 'No new ideas added' }]);
  });
});

describe('roundFieldsUnblock', () => {
  it('maps each field to the emails it unblocks', () => {
    expect(roundFieldsUnblock('deadline')).toBe('Needed for E0, E0B');
    expect(roundFieldsUnblock('reviewBy')).toBe('Needed for E1');
    expect(roundFieldsUnblock('seriesStart')).toBe('Needed for E3, E7');
    expect(roundFieldsUnblock('roadshow')).toBe('Needed for E10');
    expect(roundFieldsUnblock('formLink')).toBe('Needed for E0, E0B');
    expect(roundFieldsUnblock('csicLink')).toBe('Needed for E5, E9, E11');
    expect(roundFieldsUnblock('teamsLink')).toBe('Needed for E7, E10');
    expect(roundFieldsUnblock('distList')).toBe('Needed for E0, E0B');
    expect(roundFieldsUnblock('operatorName')).toBe('Needed for every email');
    expect(roundFieldsUnblock('open')).toBe('');
  });
});

describe('groupOutbox', () => {
  it('groups by status, newest first', () => {
    const g = groupOutbox([
      { key: 'a', status: 'sent', created: '2026-10-01' }, { key: 'b', status: 'draft', created: '2026-10-02' },
      { key: 'c', status: 'draft', created: '2026-10-05' }, { key: 'd', status: 'approved', created: '2026-10-03' },
    ]);
    expect(g.draft.map((m) => m.key)).toEqual(['c', 'b']);
    expect(g.approved.map((m) => m.key)).toEqual(['d']);
    expect(g.sent.map((m) => m.key)).toEqual(['a']);
  });
});

describe('small helpers', () => {
  it('shows only the file name', () => {
    expect(baseName('/Users/me/cafe/exports/review-pack.md')).toBe('review-pack.md');
    expect(baseName('C:\\x\\status.csv')).toBe('status.csv');
  });
  it('counts unsent emails', () => {
    expect(unsentCount([{ status: 'draft' }, { status: 'approved' }, { status: 'sent' }])).toBe(2);
    expect(unsentCount(undefined)).toBe(0);
  });
});
