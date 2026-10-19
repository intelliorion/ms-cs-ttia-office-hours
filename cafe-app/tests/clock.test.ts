import { describe, it, expect, vi } from 'vitest';
import { plusDays, daysBetween, formatDate, fixedClock, localIso, systemClock } from '../src/clock';

describe('clock', () => {
  it('adds days across a month end', () => expect(plusDays('2026-10-30', 5)).toBe('2026-11-04'));
  it('counts days between dates', () => expect(daysBetween('2026-10-19', '2026-10-26')).toBe(7));
  it('formats dates in plain English', () => expect(formatDate('2026-10-19')).toBe('19 October 2026'));
  it('fixed clock returns its date', () => expect(fixedClock('2026-10-19')()).toBe('2026-10-19'));
  it('uses the local calendar date, not the UTC one', () => {
    expect(localIso(new Date(2026, 9, 19, 23, 30))).toBe('2026-10-19');
    expect(localIso(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
  });
  it('lets CAFE_TODAY override the system clock', () => {
    vi.stubEnv('CAFE_TODAY', '2030-01-02');
    expect(systemClock()).toBe('2030-01-02');
    vi.unstubAllEnvs();
    expect(systemClock()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
