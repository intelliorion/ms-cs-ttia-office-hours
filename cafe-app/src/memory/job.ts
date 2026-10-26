import { chunkWorkspace } from './chunks';
import { dropIndex, readIndex, readState, updateState, writeIndex, type IndexRow, type MemoryState } from './index';
import type { Embedder } from './embed';

/**
 * The Deep read job: one per server, one run at a time, in the background (a request starts it and returns; the
 * pop-out polls). Incremental: a passage whose hash is in the index is kept, a changed or new one is embedded, a gone
 * one is dropped. The index and the state are written after every batch, so Pause, a crash or Ctrl+C lose at most one
 * batch, and Continue picks up where it was. Every state write is a patch of the job's own fields through updateState:
 * upkeep writes lastDecision and stale to the same file, and neither may hand back the other's stale copy.
 */
export interface DeepRead {
  run(): Promise<MemoryState>;
  pause(): Promise<MemoryState>;
  /** Continue is a run: the plan is made again, so anything changed while paused is read too. */
  continue(): Promise<MemoryState>;
  rerun(): Promise<MemoryState>;
  status(): Promise<MemoryState>;
  /** Settles when the current run has stopped (done, paused or failed). Tests wait on it. */
  idle(): Promise<void>;
}

export const BATCH = 16;

export function createDeepRead(root: string, embedder: () => Embedder, clock: () => string = () => new Date().toISOString()): DeepRead {
  let running: Promise<void> | null = null;
  let pauseAsked = false;

  /** The job's own fields, over whatever is on disk now. */
  const patch = (p: Partial<MemoryState>) => updateState(root, (s) => ({ ...s, ...p }));

  const loop = async (first: MemoryState): Promise<void> => {
    const t0 = Date.now();
    try {
      const emb = embedder();
      const { chunks, ideas } = await chunkWorkspace(root);
      const before = await readIndex(root);
      const wanted = new Map(chunks.map((c) => [c.hash, c]));
      // Kept: rows whose passage is still there, unchanged, from the same embedder.
      const kept = first.embedder && first.embedder !== emb.name ? [] : before.filter((r) => wanted.has(r.hash));
      const have = new Set(kept.map((r) => r.hash));
      const todo = chunks.filter((c) => !have.has(c.hash));
      let rows: IndexRow[] = kept;
      await patch({ embedder: emb.name, done: kept.length, total: chunks.length });
      for (let i = 0; i < todo.length; i += BATCH) {
        if (pauseAsked) { await patch({ status: 'paused' }); return; }
        const batch = todo.slice(i, i + BATCH);
        const vectors = await emb.embed(batch.map((c) => c.text));
        rows = [...rows, ...batch.map((c, k) => ({ ...c, vector: vectors[k], at: clock() }))];
        await writeIndex(root, rows);
        await patch({ done: rows.length });
      }
      if (!todo.length) await writeIndex(root, rows);
      const lastRun = { at: clock(), ms: Date.now() - t0, chunks: rows.length, ideas: ideas.length };
      await updateState(root, ({ startedAt: _, ...s }) => ({ ...s, status: 'done', done: rows.length, lastRun }));
    } catch (e) {
      await patch({ status: 'error', error: (e as Error).message });
    }
  };

  const start = async (): Promise<MemoryState> => {
    if (!running) {
      pauseAsked = false;
      // "running" is on disk before the caller gets its answer; the loop fills in the counts as it plans. A run clears the
      // stale list (it reads everything); upkeep's lastDecision stays.
      const first = await updateState(root, ({ error: _, ...prior }) => ({ ...prior, status: 'running', startedAt: prior.status === 'paused' && prior.startedAt ? prior.startedAt : clock(), stale: [] }));
      running = loop(first).finally(() => { running = null; });
    }
    return readState(root);
  };

  return {
    run: start,
    continue: start,
    async pause() {
      if (running) pauseAsked = true;
      // The loop writes "paused" at its next batch boundary; the caller sees it then (the pop-out polls).
      return readState(root);
    },
    async rerun() {
      if (running) { pauseAsked = true; await running; }
      await dropIndex(root);
      return start();
    },
    status: () => readState(root),
    idle: async () => { await running; },
  };
}
