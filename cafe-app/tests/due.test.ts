import { describe, it, expect } from 'vitest';
import { sampleIdea } from './helpers';
import { overdue, needsE2R } from '../src/reminders/due';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';

const waiting = sampleIdea({ stage: 2, sent: { E2: '2026-10-19' }, due: { s2d: '2026-10-24' } });

describe('overdue', () => {
  it('is not overdue on the due date', () => expect(overdue(waiting, steps, '2026-10-24')).toEqual([]));

  it('shows how long the reply has been waiting', () => {
    const o = overdue(waiting, steps, '2026-10-26');
    expect(o).toEqual([{ step: 's2d', due: '2026-10-24', daysLate: 2, text: 'E2 sent 7 days ago · reply due 24 October 2026' }]);
    expect(needsE2R(o)).toBe(true);
  });

  it('stops once the answer is in, or the idea is closed', () => {
    const answered = { ...waiting, checklist: { s2d: { done: true, by: 'operator' as const, at: '2026-10-25' } } };
    expect(overdue(answered, steps, '2026-10-26')).toEqual([]);
    expect(overdue({ ...waiting, closed: { as: 'notnow', at: '2026-10-25' } }, steps, '2026-10-26')).toEqual([]);
  });
});
