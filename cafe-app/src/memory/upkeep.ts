import type { TouchSource } from './touch';
import type { JobStatus } from './index';

/**
 * Upkeep: Deep read keeps its index current by itself, piece by piece, and knows when not to. Every trigger goes
 * through one pure `decide`, whose reason is kept in the memory state and shown in the pop-out. The rules, in order:
 * never before the operator's first run; never when the switch is off; never over an index built with another model;
 * never resume a pause; queue behind a running read; a renamed or merged star refreshes labels only; nothing changed →
 * nothing done; else read just the changed passages of just the touched ideas. Never the whole workspace.
 */
export interface UpkeepTrigger { sources: TouchSource[]; ideas: string[]; at: string }
export interface UpkeepIdea {
  id: string;
  /** The hashes of the idea's passages on disk now; empty when the idea is gone. */
  present: string[];
  /** The hashes the index holds for the idea. */
  indexed: string[];
}
export interface UpkeepState {
  hasIndex: boolean;
  /** The embedder the index was built with (unset until the first run). */
  indexEmbedder?: string;
  /** The embedder this process would use. */
  embedder: string;
  /** The per-workspace switch. */
  on: boolean;
  status: JobStatus;
  ideas: UpkeepIdea[];
}
export type UpkeepAct = 'read' | 'skip' | 'queue' | 'defer';
export interface UpkeepDecision {
  act: UpkeepAct;
  ideas: string[];
  why: string;
  /** Passages to embed (read) or that would be (queue); 0 otherwise. */
  passages: number;
  /** Refresh the star label vectors (a rename or merge). */
  labels?: true;
}

const short = (id: string) => id.replace(/^CAFE-/, '');
const list = (ids: string[]) => {
  const s = ids.map(short);
  return s.length <= 1 ? (s[0] ?? '') : `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`;
};

const SOURCE_WORDS: Record<Exclude<TouchSource, 'import' | 'stars'>, string> = {
  save: 'a save', design: 'the design was saved', email: 'an email', roadshow: 'the roadshow', handoff: 'the hand-off', history: 'the history', file: 'a file',
};
/** "after Import", "after a save", "after the design was saved and an email". */
export function sourceWords(sources: TouchSource[]): string {
  if (sources.includes('import')) return 'after Import';
  const words = [...new Set(sources.filter((s): s is keyof typeof SOURCE_WORDS => s in SOURCE_WORDS).map((s) => SOURCE_WORDS[s]))];
  return words.length ? `after ${list(words)}` : 'after a change';
}

export function decide(trigger: UpkeepTrigger, state: UpkeepState): UpkeepDecision {
  const ideas = trigger.ideas;
  const skip = (why: string, extra: Partial<UpkeepDecision> = {}): UpkeepDecision => ({ act: 'skip', ideas, why, passages: 0, ...extra });
  if (!state.hasIndex || !state.indexEmbedder) return skip('Deep read has not been run yet');
  if (!state.on) return skip('automatic upkeep is off');
  if (state.indexEmbedder !== state.embedder) return skip(`the index was built with another model (${state.indexEmbedder}): Rerun all to read with this one`);
  if (state.status === 'paused') return skip(`paused by you: ${list(ideas)} will be read at Continue`);
  if (state.status === 'running') return { act: 'queue', ideas, why: `a read is running: ${list(ideas)} will be checked when it ends`, passages: 0 };
  const labels = trigger.sources.includes('stars') ? { labels: true as const } : {};
  if (!ideas.length) return skip('star labels refreshed; no passage changed', labels);
  // Only what changed, and only if it changed: the touched ideas' passages against the index.
  const changed: string[] = []; let passages = 0; let dropped = 0; const gone: string[] = [];
  for (const id of ideas) {
    const i = state.ideas.find((x) => x.id === id) ?? { id, present: [], indexed: [] };
    const have = new Set(i.indexed); const now = new Set(i.present);
    const fresh = i.present.filter((h) => !have.has(h)).length;
    const lost = i.indexed.filter((h) => !now.has(h)).length;
    if (!fresh && !lost) continue;
    // A changed passage is one fresh and one lost: "dropped" counts only what went beyond that (an email removed, say).
    changed.push(id); passages += fresh; dropped += Math.max(0, lost - fresh);
    if (!i.present.length && i.indexed.length) gone.push(id);
  }
  if (!changed.length) return skip(`nothing changed in ${list(ideas)}`, labels);
  const why = gone.length === changed.length
    ? `${list(gone)} removed: its passages dropped`
    : `read ${list(changed)} ${sourceWords(trigger.sources)} · ${passages} passage${passages === 1 ? '' : 's'}${dropped ? ` · ${dropped} dropped` : ''}`;
  return { act: 'read', ideas: changed, why, passages, ...labels };
}

/* ---------- The runner ---------- */

import { chunkIdea } from './chunks';
import { loadIdea, ideaDir } from '../ideas/store';
import { labelVectors, readIndex, readState, updateState, writeIndex, type IndexRow, type MemoryState } from './index';
import { embedderName, type Embedder } from './embed';
import { onTouched } from './touch';
import type { DeepRead } from './job';
import type { GNode } from '../graph/ontology';

export interface UpkeepOptions {
  job: DeepRead;
  embedder: () => Embedder;
  env?: NodeJS.ProcessEnv;
  clock?: () => string;
  /** Quiet time after the last touch before a flush (5 s), and the longest a touch may wait (30 s). */
  quietMs?: number;
  maxMs?: number;
  /** The per-workspace switch, read at each flush. */
  on: () => Promise<boolean>;
  /** The stars, for the label refresh after a rename or merge. */
  nodes: () => Promise<Pick<GNode, 'id' | 'type' | 'label'>[]>;
}
export interface Upkeep {
  touch(ideas: string[], source: TouchSource): void;
  /** Touches are pending and the timer is set ("waiting for changes to settle"). */
  waiting(): boolean;
  pending(): number;
  /** The last decision this process made, on disk or not (before the first run nothing is written). */
  last(): UpkeepDecision | undefined;
  /** Settles when nothing is pending or running. The run and rerun routes wait on it so two writers never meet. */
  settle(): Promise<void>;
  idle(): Promise<void>;
  close(): void;
}

export const UPKEEP_QUIET_MS = 5000;
export const UPKEEP_MAX_MS = 30_000;
const BATCH = 16;

export function createUpkeep(root: string, opts: UpkeepOptions): Upkeep {
  const env = opts.env ?? process.env;
  const clock = opts.clock ?? (() => new Date().toISOString());
  const quietMs = opts.quietMs ?? UPKEEP_QUIET_MS;
  const maxMs = opts.maxMs ?? UPKEEP_MAX_MS;
  const pending = new Map<string, Set<TouchSource>>();
  let stars = false;
  let timer: NodeJS.Timeout | undefined;
  let firstAt: number | undefined;
  let working: Promise<void> | null = null;
  let last: UpkeepDecision | undefined;

  const schedule = () => {
    firstAt ??= Date.now();
    if (timer) clearTimeout(timer);
    const left = maxMs - (Date.now() - firstAt);
    timer = setTimeout(fire, Math.max(0, Math.min(quietMs, left)));
  };
  const fire = () => {
    timer = undefined;
    if (working) { schedule(); return; }
    const take = new Map(pending); const withStars = stars;
    pending.clear(); stars = false; firstAt = undefined;
    working = flush(take, withStars).catch(() => undefined).finally(() => { working = null; if (pending.size || stars) schedule(); });
  };

  // Upkeep's fields only, lastDecision and stale, patched over the state as it is at the write (the job loop writes
  // status to the same file; a copy read earlier is never written back).
  const record = async (d: UpkeepDecision, patch: (s: MemoryState) => Pick<Partial<MemoryState>, 'stale'> = () => ({})) => {
    await updateState(root, (s) => ({ ...s, ...patch(s), lastDecision: { act: d.act, ideas: d.ideas, why: d.why, at: clock() } }));
  };
  const refreshLabels = async () => { await labelVectors(root, opts.embedder(), (await opts.nodes()) as GNode[]); };

  const flush = async (take: Map<string, Set<TouchSource>>, withStars: boolean, folded = false): Promise<void> => {
    const [state, rows, on] = await Promise.all([readState(root), readIndex(root), opts.on()]);
    const sources = [...new Set([...withStars ? ['stars' as const] : [], ...[...take.values()].flatMap((s) => [...s])])];
    const ids = [...take.keys()];
    // Only the touched ideas are chunked (file reads only); the index rows of each give what is already read.
    const present = new Map<string, { hash: string; row: Omit<IndexRow, 'vector'> }[]>();
    for (const id of ids) {
      const idea = await loadIdea(root, id).catch(() => undefined);
      const chunks = idea ? await chunkIdea(root, idea, await ideaDir(root, id)) : [];
      present.set(id, chunks.map((c) => ({ hash: c.hash, row: c })));
    }
    const d = decide(
      { sources, ideas: ids, at: clock() },
      { hasIndex: rows.length > 0, indexEmbedder: state.embedder, embedder: embedderName(env), on, status: state.status, ideas: ids.map((id) => ({ id, present: present.get(id)!.map((p) => p.hash), indexed: rows.filter((r) => r.ideaId === id).map((r) => r.hash) })) },
    );
    last = d;
    // Before the first run nothing is written: an operator who never uses Deep read has no memory folder at all.
    if (!rows.length || !state.embedder) return;
    if (d.act === 'queue') {
      await record(d);
      await opts.job.idle();
      if (!folded) await flush(take, withStars, true);
      return;
    }
    if (d.act === 'skip') {
      if (d.labels) await refreshLabels();
      await record(d, (s) => (state.status === 'paused' ? { stale: [...new Set([...s.stale, ...d.ideas])] } : {}));
      return;
    }
    try {
      const have = new Set(rows.map((r) => r.hash));
      const todo = d.ideas.flatMap((id) => present.get(id)!.filter((p) => !have.has(p.hash)).map((p) => p.row));
      const emb = opts.embedder();
      const fresh: IndexRow[] = [];
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        const vectors = await emb.embed(batch.map((c) => c.text));
        fresh.push(...batch.map((c, k) => ({ ...c, vector: vectors[k], at: clock() })));
      }
      const keep = new Set(d.ideas.flatMap((id) => present.get(id)!.map((p) => p.hash)));
      const touchedIds = new Set(d.ideas);
      const next = [...rows.filter((r) => !touchedIds.has(r.ideaId) || keep.has(r.hash)), ...fresh];
      await writeIndex(root, next);
      if (d.labels) await refreshLabels();
      await record(d, (s) => ({ stale: s.stale.filter((id) => !touchedIds.has(id)) }));
    } catch (e) {
      await record({ ...d, act: 'defer', why: `could not read ${d.ideas.map((id) => id.replace(/^CAFE-/, '')).join(', ')}: ${(e as Error).message}; will try again at the next change` });
    }
  };

  const touch = (ideas: string[], source: TouchSource) => {
    if (source === 'stars') stars = true;
    for (const id of ideas) { const s = pending.get(id); if (s) s.add(source); else pending.set(id, new Set([source])); }
    schedule();
  };
  const off = onTouched((t) => { if (t.root === root) touch(t.ideas, t.source); });
  const idle = async () => {
    for (;;) {
      if (working) { await working; continue; }
      if (!timer && !pending.size && !stars) return;
      if (timer) { clearTimeout(timer); timer = undefined; fire(); continue; }
      await new Promise((r) => setTimeout(r, 2));
    }
  };
  return {
    touch,
    waiting: () => !!timer || !!working || pending.size > 0,
    pending: () => pending.size,
    last: () => last,
    settle: idle,
    idle,
    close: () => { off(); if (timer) clearTimeout(timer); timer = undefined; pending.clear(); stars = false; },
  };
}
