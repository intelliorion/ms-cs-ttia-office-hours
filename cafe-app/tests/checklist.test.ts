import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { progress, missingToAdvance, stepStatus, tick, advance, closeIdea } from '../src/checklist/checklist';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readHistory } from '../src/workspace/files';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');
const done = (by: 'app' | 'operator' = 'operator') => ({ done: true, by, at: '2026-10-19' });

describe('progress', () => {
  it('counts a fresh idea', () => {
    expect(progress(sampleIdea(), steps).label).toBe('Submit Idea · 0 of 25');
  });

  it('marks later stages not applicable once closed', () => {
    const idea = sampleIdea({ stage: 2, closed: { as: 'csic', at: '2026-10-19' }, checklist: { s1d: done('app') } });
    expect(stepStatus(idea, steps.find((s) => s.id === 's3a')!)).toBe('n/a');
    expect(progress(idea, steps).label).toBe('Closed · Routed to CSIC · 1 of 11');
  });

  it('ignores step ids it does not know', () => {
    const idea = sampleIdea({ checklist: { s9z: done(), s1a: done() } });
    expect(progress(idea, steps).done).toBe(1);
  });

  it('lists the needed steps still open in this stage', () => {
    expect(missingToAdvance(sampleIdea(), steps).map((s) => s.id)).toEqual(['s1a', 's1b', 's1d', 's1e']);
  });
});

describe('tick and advance', () => {
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

  it('will not advance while needed steps are open', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    await expect(advance(root, 'CAFE-2026-001', steps, clock)).rejects.toThrow(/Still needed before Review and Select/);
  });

  it('advances once the needed steps are done, and logs it', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea({ checklist: { s1a: done(), s1b: done(), s1d: done('app'), s1e: done('app') } }));
    expect((await advance(root, 'CAFE-2026-001', steps, clock)).stage).toBe(2);
    expect((await readHistory(dir)).at(-1)).toMatchObject({ action: 'advance', detail: 'Review and Select' });
  });

  it('closes an idea with a follow-up date', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 2 }));
    const idea = await closeIdea(root, 'CAFE-2026-001', 'csic', clock, '2026-11-16');
    expect(idea.closed).toEqual({ as: 'csic', at: '2026-10-19', followUp: '2026-11-16' });
    await expect(advance(root, 'CAFE-2026-001', steps, clock)).rejects.toThrow('is closed');
    expect((await readHistory(await ideaDir(root, 'CAFE-2026-001'))).at(-1)).toMatchObject({ action: 'close', detail: 'Routed to CSIC' });
  });
});
