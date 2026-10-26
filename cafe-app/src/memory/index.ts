import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import { chunkWorkspace, type Chunk, type ChunkKind } from './chunks';
import { cosine, embedderName, meanVector, type Embedder } from './embed';
import type { GNode } from '../graph/ontology';

/**
 * The reading index: data/memory/index.jsonl (one line per passage, with its vector), state.json (the job and the last
 * run) and labels.jsonl (star labels embedded on demand). All of it is rebuilt from the idea folders by a Run, so
 * data/ stays deletable.
 */
export interface IndexRow extends Chunk { vector: number[] }
export type JobStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export interface MemoryState {
  status: JobStatus;
  /** The embedder the index was built with. */
  embedder?: string;
  done: number;
  total: number;
  startedAt?: string;
  lastRun?: { at: string; ms: number; chunks: number; ideas: number };
  error?: string;
  /** Ideas whose passages changed since they were read (as of the last summary). */
  stale: string[];
}
export const EMPTY_STATE: MemoryState = { status: 'idle', done: 0, total: 0, stale: [] };

export const memoryDir = (root: string) => paths(root).memory;
const indexFile = (root: string) => path.join(memoryDir(root), 'index.jsonl');
const stateFile = (root: string) => path.join(memoryDir(root), 'state.json');
const labelsFile = (root: string) => path.join(memoryDir(root), 'labels.jsonl');

export async function readIndex(root: string): Promise<IndexRow[]> {
  const out: IndexRow[] = [];
  for (const line of ((await readText(indexFile(root))) ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line) as IndexRow; if (r.id && Array.isArray(r.vector)) out.push(r); } catch { /* a cut line: skipped */ }
  }
  return out;
}
export async function writeIndex(root: string, rows: IndexRow[]): Promise<void> {
  await writeFileAtomic(indexFile(root), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
export async function readState(root: string): Promise<MemoryState> {
  try { const v = JSON.parse((await readText(stateFile(root))) ?? ''); return { ...EMPTY_STATE, ...v, stale: Array.isArray(v.stale) ? v.stale : [] }; } catch { return { ...EMPTY_STATE }; }
}
export async function writeState(root: string, state: MemoryState): Promise<void> {
  await writeFileAtomic(stateFile(root), JSON.stringify(state, null, 1));
}
/** Rerun all: the index and the labels go; the state keeps nothing of the last run. */
export async function dropIndex(root: string): Promise<void> {
  await fs.rm(indexFile(root), { force: true });
  await fs.rm(labelsFile(root), { force: true });
  await writeState(root, { ...EMPTY_STATE });
}

/** Is there an index this process can use: built with the embedder in use now, with at least one passage? */
export async function indexAvailable(root: string, env = process.env): Promise<boolean> {
  const state = await readState(root);
  if (!state.embedder || state.embedder !== embedderName(env)) return false;
  const text = await readText(indexFile(root));
  return !!text && text.trim().length > 0;
}

export interface IdeaRead { id: string; title: string; chunks: number; embedded: number; status: 'read' | 'stale' | 'new' }
export interface MemorySummary {
  chunks: number; embedded: number; percent: number;
  kinds: Record<ChunkKind, { chunks: number; embedded: number }>;
  ideas: IdeaRead[];
  /** The index exists, was built with the embedder in use, and has at least one passage. */
  available: boolean;
  /** The index was built with another embedder: everything counts as unread until Rerun all. */
  otherModel?: string;
}

const KINDS: ChunkKind[] = ['submission', 'email', 'design', 'review', 'roadshow', 'other'];

/** What is read and what is not, from the workspace's passages against the index. File reads only; no model. */
export async function summary(root: string, env = process.env): Promise<MemorySummary> {
  const [{ chunks, ideas }, rows, state] = await Promise.all([chunkWorkspace(root), readIndex(root), readState(root)]);
  const sameModel = !state.embedder || state.embedder === embedderName(env);
  const have = new Set(sameModel ? rows.map((r) => r.hash) : []);
  const kinds = Object.fromEntries(KINDS.map((k) => [k, { chunks: 0, embedded: 0 }])) as MemorySummary['kinds'];
  const per = new Map(ideas.map((i) => [i.id, { id: i.id, title: i.title, chunks: 0, embedded: 0 }]));
  let embedded = 0;
  for (const c of chunks) {
    const hit = have.has(c.hash);
    kinds[c.kind].chunks++;
    const p = per.get(c.ideaId); if (p) p.chunks++;
    if (hit) { embedded++; kinds[c.kind].embedded++; if (p) p.embedded++; }
  }
  const everRead = new Set(sameModel ? rows.map((r) => r.ideaId) : []);
  const list: IdeaRead[] = [...per.values()].map((p) => ({ ...p, status: p.chunks === p.embedded && p.chunks > 0 ? 'read' : everRead.has(p.id) ? 'stale' : 'new' }));
  return {
    chunks: chunks.length, embedded, percent: chunks.length ? Math.floor((embedded / chunks.length) * 100) : 0,
    kinds, ideas: list, available: sameModel && rows.length > 0,
    ...(sameModel ? {} : { otherModel: state.embedder }),
  };
}

export interface Hit { ideaId: string; section: string; file: string; text: string; score: number }

/** The passages nearest a vector, best first. */
export function nearestChunks(rows: IndexRow[], vector: number[], k: number, min = 0): Hit[] {
  return rows.map((r) => ({ ideaId: r.ideaId, section: r.section, file: r.file, text: r.text, score: cosine(r.vector, vector) }))
    .filter((h) => h.score >= min).sort((a, b) => b.score - a.score).slice(0, k);
}

/** Hits grouped by idea, best idea first (an idea scores by its best passage); each idea keeps its best few passages. */
export function groupByIdea(hits: Hit[], perIdea = 2): { ideaId: string; score: number; hits: Hit[] }[] {
  const by = new Map<string, Hit[]>();
  for (const h of hits) { const l = by.get(h.ideaId); if (l) { if (l.length < perIdea) l.push(h); } else by.set(h.ideaId, [h]); }
  return [...by.entries()].map(([ideaId, hs]) => ({ ideaId, score: hs[0].score, hits: hs })).sort((a, b) => b.score - a.score);
}

/** Each idea's centre: the mean of its passages' vectors. */
export function ideaCentroids(rows: IndexRow[]): Map<string, number[]> {
  const by = new Map<string, number[][]>();
  for (const r of rows) { const l = by.get(r.ideaId); if (l) l.push(r.vector); else by.set(r.ideaId, [r.vector]); }
  return new Map([...by.entries()].map(([id, vs]) => [id, meanVector(vs)]));
}

export const labelKey = (type: string, label: string) => createHash('sha1').update(`${type}\n${label.trim().toLowerCase()}`).digest('hex');

/**
 * Vectors for star labels, from the cache or embedded now and appended to it. People are never embedded (their labels
 * are names). The map is keyed by node id.
 */
export async function labelVectors(root: string, embedder: Embedder, nodes: GNode[]): Promise<Map<string, number[]>> {
  const cache = new Map<string, number[]>();
  for (const line of ((await readText(labelsFile(root))) ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line) as { key: string; vector: number[] }; if (r.key && Array.isArray(r.vector)) cache.set(r.key, r.vector); } catch { /* skipped */ }
  }
  const wanted = nodes.filter((n) => n.type !== 'Person' && n.label.trim());
  const missing = wanted.filter((n) => !cache.has(labelKey(n.type, n.label)));
  if (missing.length) {
    const uniq = [...new Map(missing.map((n) => [labelKey(n.type, n.label), n])).values()];
    const vectors = await embedder.embed(uniq.map((n) => n.label));
    const lines: string[] = [];
    uniq.forEach((n, i) => { const key = labelKey(n.type, n.label); cache.set(key, vectors[i]); lines.push(JSON.stringify({ key, vector: vectors[i] })); });
    await fs.mkdir(memoryDir(root), { recursive: true });
    await fs.appendFile(labelsFile(root), lines.join('\n') + '\n', 'utf8');
  }
  return new Map(wanted.map((n) => [n.id, cache.get(labelKey(n.type, n.label))!]));
}
