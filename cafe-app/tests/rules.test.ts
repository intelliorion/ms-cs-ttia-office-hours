import { describe, it, expect } from 'vitest';
import { DEFAULT_STEPS, STAGE_NAMES, validateSteps } from '../src/rules/stages';
import { resolveToken, TOKENS, DEFAULT_SETTINGS } from '../src/round/round';
import { normalizeIdea } from '../src/ideas/idea';

describe('steps', () => {
  it('has 25 steps, 14 needed, in four stages', () => {
    expect(DEFAULT_STEPS).toHaveLength(25);
    expect(DEFAULT_STEPS.filter((s) => s.needed)).toHaveLength(14);
    expect([1, 2, 3, 4].map((n) => DEFAULT_STEPS.filter((s) => s.stage === n).length)).toEqual([5, 6, 9, 5]);
    expect(STAGE_NAMES[3]).toBe('Design series');
  });

  it('rejects duplicate step ids', () => {
    expect(() => validateSteps([...DEFAULT_STEPS, DEFAULT_STEPS[0]])).toThrow(/duplicate step id s1a/);
  });

  it('rejects a step with a bad stage', () => {
    expect(() => validateSteps([{ ...DEFAULT_STEPS[0], stage: 7 }])).toThrow(/stage/);
  });
});

describe('tokens', () => {
  const round = { id: 'ROUND-2026-Q4', reviewBy: '2026-11-02', deadline: '' };
  const settings = { ...DEFAULT_SETTINGS, csicLink: 'https://csic.example/intake' };

  it('fills a set date in plain English', () => expect(resolveToken('[REVIEW DATE]', round, settings)).toBe('2 November 2026'));
  it('fills a set link', () => expect(resolveToken('[CSIC REPOSITORY INTAKE LINK]', round, settings)).toBe('https://csic.example/intake'));
  it('leaves an empty value unresolved', () => expect(resolveToken('[DEADLINE]', round, settings)).toBeUndefined());
  it('leaves an unset value unresolved', () => expect(resolveToken('[FORM LINK]', round, settings)).toBeUndefined());
  it('knows the seven setting tokens', () => expect(Object.keys(TOKENS)).toHaveLength(7));
});

describe('normalizeIdea', () => {
  it('fills defaults for a hand-written idea', () => {
    const idea = normalizeIdea({ id: 'CAFE-2026-001', title: 'Email scheduler', stage: 9 as never });
    expect(idea.stage).toBe(1);
    expect(idea.checklist).toEqual({});
    expect(idea.people.team).toEqual([]);
    expect(idea.flags).toEqual([]);
  });
});
