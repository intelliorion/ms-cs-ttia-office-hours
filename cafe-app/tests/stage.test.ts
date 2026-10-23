import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea, FIXTURE } from './helpers';
import { setStage } from '../src/ideas/stage';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { readHistory } from '../src/workspace/files';
import { importExport } from '../src/import/importRows';
import { saveReview } from '../src/review/review';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';

const clock = fixedClock('2026-10-19');
const ID = 'CAFE-2026-001';
const stageLog = async (root: string) => (await readHistory(await ideaDir(root, ID))).filter((h) => h.action === 'stage');

describe('setStage', () => {
  it('moves an idea forward, with no steps done, and logs it', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    expect((await setStage(root, ID, { stage: 3 }, clock)).stage).toBe(3);
    expect((await loadIdea(root, ID)).stage).toBe(3);
    expect(await stageLog(root)).toEqual([{ at: '2026-10-19', action: 'stage', by: 'operator', detail: 'Review and Select → Design series' }]);
  });

  it('moves an idea back', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 4 }));
    expect((await setStage(root, ID, { stage: 2 }, clock)).stage).toBe(2);
    expect((await stageLog(root)).at(-1)?.detail).toBe('Launch and Learn → Review and Select');
  });

  it('closes as csic: keeps the stage, sets a four-week follow-up and the route', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 2 }));
    const idea = await setStage(root, ID, { closeAs: 'csic' }, clock);
    expect(idea.stage).toBe(2);
    expect(idea.closed).toEqual({ as: 'csic', at: '2026-10-19', followUp: '2026-11-16' });
    expect(idea.route).toBe('CSIC Repository');
    expect((await stageLog(root)).at(-1)?.detail).toBe('Review and Select → Closed · Routed to CSIC');
  });

  it('closes as another closure without a follow-up', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 2 }));
    expect((await setStage(root, ID, { closeAs: 'notnow' }, clock)).closed).toEqual({ as: 'notnow', at: '2026-10-19' });
  });

  it('reopens a closed idea by setting its stage', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 2, closed: { as: 'reuse', at: '2026-10-01' } }));
    const idea = await setStage(root, ID, { stage: 2 }, clock);
    expect(idea.closed).toBeUndefined();
    expect((await loadIdea(root, ID)).closed).toBeUndefined();
    expect((await stageLog(root)).at(-1)?.detail).toBe('Closed · Reuse → Review and Select');
  });

  it('rejects an unknown stage or closure in plain English, and writes nothing', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    await expect(setStage(root, ID, { stage: 7 } as never, clock)).rejects.toThrow('Pick Review and Select, Design series or Launch and Learn, or a way to close it');
    await expect(setStage(root, ID, { closeAs: 'binned' } as never, clock)).rejects.toThrow('Pick Review and Select, Design series or Launch and Learn, or a way to close it');
    // Submit Idea (the old stage 1) is gone.
    await expect(setStage(root, ID, { stage: 1 } as never, clock)).rejects.toThrow('Pick Review and Select');
    await expect(setStage(root, ID, {} as never, clock)).rejects.toThrow('Pick Review and Select');
    expect(await stageLog(root)).toEqual([]);
  });

  it('does nothing, and logs nothing, when nothing changes', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea({ stage: 2 }));
    await setStage(root, ID, { stage: 2 }, clock);
    await setStage(root, ID, { closeAs: 'csic' }, clock);
    await setStage(root, ID, { closeAs: 'csic' }, fixedClock('2026-10-25'));
    expect((await loadIdea(root, ID)).closed?.at).toBe('2026-10-19');
    expect(await stageLog(root)).toHaveLength(1);
  });

  it('logs every change', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    for (const t of [{ stage: 3 }, { stage: 4 }, { closeAs: 'stop' }, { stage: 2 }] as const) await setStage(root, ID, t, clock);
    expect((await stageLog(root)).map((h) => h.detail)).toEqual([
      'Review and Select → Design series',
      'Design series → Launch and Learn',
      'Launch and Learn → Closed · Stopped, learning kept',
      'Closed · Stopped, learning kept → Review and Select',
    ]);
  });

  it('fills the follow-up date into the CSIC handoff once closed as csic', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock, steps });
    const r = await saveReview(root, 'CAFE-2026-002', { decision: 'csic', reason: 'Defined and sponsored.' }, { clock, steps });
    expect(await readFile(r.handoff!, 'utf8')).toContain('On [FOLLOW-UP DATE]: did it reach the CSIC Repository?');
    await setStage(root, 'CAFE-2026-002', { closeAs: 'csic' }, clock);
    expect(await readFile(path.join(await ideaDir(root, 'CAFE-2026-002'), 'csic-handoff.md'), 'utf8'))
      .toContain('On 16 November 2026: did it reach the CSIC Repository?');
  });
});
