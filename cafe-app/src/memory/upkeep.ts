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
    changed.push(id); passages += fresh; dropped += lost;
    if (!i.present.length && i.indexed.length) gone.push(id);
  }
  if (!changed.length) return skip(`nothing changed in ${list(ideas)}`, labels);
  const why = gone.length === changed.length
    ? `${list(gone)} removed: its passages dropped`
    : `read ${list(changed)} ${sourceWords(trigger.sources)} · ${passages} passage${passages === 1 ? '' : 's'}${dropped ? ` · ${dropped} dropped` : ''}`;
  return { act: 'read', ideas: changed, why, passages, ...labels };
}
