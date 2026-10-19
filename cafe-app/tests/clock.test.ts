import { describe, it, expect } from 'vitest';
import { plusDays, daysBetween, formatDate, fixedClock } from '../src/clock';

describe('clock', () => {
  it('adds days across a month end', () => expect(plusDays('2026-10-30', 5)).toBe('2026-11-04'));
  it('counts days between dates', () => expect(daysBetween('2026-10-19', '2026-10-26')).toBe(7));
  it('formats dates in plain English', () => expect(formatDate('2026-10-19')).toBe('19 October 2026'));
  it('fixed clock returns its date', () => expect(fixedClock('2026-10-19')()).toBe('2026-10-19'));
});
