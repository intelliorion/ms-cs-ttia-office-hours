import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { fakeEmbedder, type Embedder } from '../src/memory/embed';
import { createDeepRead, BATCH } from '../src/memory/job';
import { readIndex, readState, summary } from '../src/memory/index';

const FAKE = { ...process.env, CAFE_EMBED_FAKE: '1' };
const clock = () => '2026-10-26T09:00:00.000Z';
/** Polls the state until the test's condition holds (the loop runs in the background). */
async function until(root: string, ok: (s: { done: number; status: string }) => boolean) {
  for (let i = 0; i < 500; i++) { const s = await readState(root); if (ok(s)) return s; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('state never reached');
}

async function ideas(root: string, n: number) {
  for (let i = 1; i <= n; i++) {
    await saveIdea(root, sampleIdea({ id: `CAFE-2026-${String(i).padStart(3, '0')}`, title: `Idea ${i}`, challenge: `Challenge number ${i} about contracts.`, current_process: `Process ${i} by hand.`, dedupe_key: `k${i}` }));
  }
}

/** An embedder that waits for a release between batches, so a run can be paused mid-way. */
function slowEmbedder(): Embedder & { release(): void; calls: number } {
  const base = fakeEmbedder();
  let next: (() => void) | undefined; let pending = 0;
  const e = {
    ...base, calls: 0,
    // A release before the embedder is waiting is kept for its next batch.
    release: () => { if (next) { next(); next = undefined; } else pending++; },
    embed: async (t: string[]) => { e.calls++; if (pending > 0) pending--; else await new Promise<void>((r) => { next = r; }); return base.embed(t); },
  };
  return e;
}

describe('the Deep read job', () => {
  it('runs to 100 %: every passage embedded, the state done with the last run, the index written', async () => {
    const root = await tmpWorkspace();
    await ideas(root, 3);
    const job = createDeepRead(root, fakeEmbedder, clock);
    const first = await job.run();
    expect(['running', 'done']).toContain(first.status);
    await job.idle();
    const state = await readState(root);
    expect(state).toMatchObject({ status: 'done', embedder: 'fake', done: 6, total: 6, lastRun: { at: clock(), chunks: 6, ideas: 3 } });
    expect(state.startedAt).toBeUndefined();
    expect(await readIndex(root)).toHaveLength(6);
    const s = await summary(root, FAKE);
    expect(s).toMatchObject({ percent: 100, available: true });
    expect(s.ideas.every((i) => i.status === 'read')).toBe(true);
  });

  it('is incremental: a second run embeds only what changed and drops what is gone', async () => {
    const root = await tmpWorkspace();
    await ideas(root, 2);
    let calls: string[] = [];
    const counting = (): Embedder => ({ ...fakeEmbedder(), embed: async (t) => { calls.push(...t); return fakeEmbedder().embed(t); } });
    const job = createDeepRead(root, counting, clock);
    await job.run(); await job.idle();
    expect(calls).toHaveLength(4);
    calls = [];
    await saveIdea(root, sampleIdea({ id: 'CAFE-2026-001', title: 'Idea 1', challenge: 'A new challenge.', dedupe_key: 'k1' }));
    await job.run(); await job.idle();
    // Only the changed title+challenge passage; the dropped current_process row is gone.
    expect(calls).toEqual(['Idea 1\nA new challenge.']);
    const rows = await readIndex(root);
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.text === 'Process 1 by hand.')).toBe(false);
    expect((await readState(root)).done).toBe(3);
  });

  it('pauses at a batch boundary and continues from there; rerun drops the index first', async () => {
    const root = await tmpWorkspace();
    await ideas(root, BATCH + 2); // 2 passages each: three batches
    const slow = slowEmbedder();
    const job = createDeepRead(root, () => slow, clock);
    const started = await job.run();
    expect(started.status).toBe('running');
    // One batch through, then pause: the loop stops before the next batch.
    slow.release();
    await until(root, (s) => s.done >= BATCH);
    await job.pause();
    slow.release();
    await job.idle();
    let state = await readState(root);
    expect(state.status).toBe('paused');
    expect(state.done).toBe(BATCH * 2);
    expect(state.total).toBe((BATCH + 2) * 2);
    expect(state.startedAt).toBe(clock());
    // Continue: the kept rows are not embedded again.
    const before = slow.calls;
    const cont = await job.continue();
    expect(cont.status).toBe('running');
    slow.release();
    await job.idle();
    state = await readState(root);
    expect(state.status).toBe('done');
    expect(state.done).toBe((BATCH + 2) * 2);
    expect(slow.calls - before).toBe(1);
    // Rerun all: the index goes and everything is embedded again.
    const fast = createDeepRead(root, fakeEmbedder, clock);
    await fast.rerun(); await fast.idle();
    state = await readState(root);
    expect(state).toMatchObject({ status: 'done', done: (BATCH + 2) * 2 });
    expect((await readIndex(root)).length).toBe((BATCH + 2) * 2);
  });

  it('a failing embedder leaves the state in error with the reason, and a run while running is a no-op', async () => {
    const root = await tmpWorkspace();
    await ideas(root, 1);
    const broken = (): Embedder => ({ name: 'fake', dims: 1, embed: async () => { throw new Error('The model could not be downloaded'); } });
    const job = createDeepRead(root, broken, clock);
    await job.run(); await job.idle();
    expect(await readState(root)).toMatchObject({ status: 'error', error: 'The model could not be downloaded', done: 0, total: 2 });
    const slow = slowEmbedder();
    const job2 = createDeepRead(root, () => slow, clock);
    await job2.run();
    await job2.run();
    slow.release();
    await job2.idle();
    expect(slow.calls).toBe(1);
    expect((await readState(root)).status).toBe('done');
  });
});
