import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import * as checklist from '../src/checklist/checklist';
import { stepStatus, tick } from '../src/checklist/checklist';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { readHistory } from '../src/workspace/files';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');
const done = (by: 'app' | 'operator' = 'operator') => ({ done: true, by, at: '2026-10-19' });

describe('stepStatus', () => {
  it('marks later stages not applicable once closed', () => {
    const idea = sampleIdea({ stage: 2, closed: { as: 'csic', at: '2026-10-19' }, checklist: { s1d: done('app') } });
    expect(stepStatus(idea, steps.find((s) => s.id === 's3a')!)).toBe('n/a');
    expect(stepStatus(idea, steps.find((s) => s.id === 's1d')!)).toBe('done');
    expect(stepStatus(idea, steps.find((s) => s.id === 's2a')!)).toBe('open');
  });
});

describe('tick (the quiet background log)', () => {
  it('logs a tick once, however often it is clicked', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea());
    await tick(root, 'CAFE-2026-001', 's1a', true, { by: 'operator', clock, steps });
    await tick(root, 'CAFE-2026-001', 's1a', true, { by: 'operator', clock, steps });
    expect((await readHistory(dir)).filter((h) => h.action === 'tick')).toHaveLength(1);
    expect((await loadIdea(root, 'CAFE-2026-001')).checklist.s1a.by).toBe('operator');
  });

  it('records the source of an app tick and logs an untick', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea());
    await tick(root, 'CAFE-2026-001', 's1d', true, { by: 'app', source: 'export.csv row 2', clock, steps });
    expect((await readHistory(dir)).at(-1)).toMatchObject({ action: 'tick', by: 'app', step: 's1d', source: 'export.csv row 2' });
    const ticked = await loadIdea(root, 'CAFE-2026-001');
    expect(ticked.checklist.s1d).toMatchObject({ done: true, by: 'app', source: 'export.csv row 2' });
    await tick(root, 'CAFE-2026-001', 's1d', false, { by: 'operator', clock, steps });
    expect((await readHistory(dir)).at(-1)).toMatchObject({ action: 'untick', step: 's1d' });
    expect((await loadIdea(root, 'CAFE-2026-001')).checklist.s1d.done).toBe(false);
  });

  it('refuses an unknown step', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    await expect(tick(root, 'CAFE-2026-001', 's9z', true, { by: 'operator', clock, steps })).rejects.toThrow('Unknown step s9z');
  });
});

describe('the old gate', () => {
  it('is gone: no advance, no missingToAdvance, no progress counts', () => {
    expect(Object.keys(checklist)).not.toContain('advance');
    expect(Object.keys(checklist)).not.toContain('missingToAdvance');
    expect(Object.keys(checklist)).not.toContain('progress');
  });
});
