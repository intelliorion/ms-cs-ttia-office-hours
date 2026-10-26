import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import type { Idea } from '../ideas/idea';

/**
 * What the AI last read of each idea (data/graph/ai-reads.json): when, and a hash of the text it was given. The idea
 * panel compares the hash with the text now to say "changed since the AI last read it"; the app never re-reads on
 * its own, the operator presses Read again.
 */
export interface AiRead { at: string; hash: string }
const file = (root: string) => path.join(paths(root).graph, 'ai-reads.json');

function fnv1a32(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** The hash of the fields extraction reads (extractInput's idea text), so a change elsewhere is no change. */
export const extractTextHash = (idea: Idea): string =>
  fnv1a32(JSON.stringify([idea.title, idea.challenge, idea.current_process, idea.outcomes, idea.business_impact, idea.beneficiaries, idea.additional_context]));

export async function aiReads(root: string): Promise<Record<string, AiRead>> {
  try { const v = JSON.parse((await readText(file(root))) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export async function noteAiRead(root: string, idea: Idea, at = new Date().toISOString()): Promise<void> {
  const all = await aiReads(root);
  all[idea.id] = { at, hash: extractTextHash(idea) };
  await writeFileAtomic(file(root), JSON.stringify(all, null, 1));
}

/** For the state: when the AI read the idea and whether its text changed since; undefined when it never did. */
export const aiReadOf = (reads: Record<string, AiRead>, idea: Idea): { at: string; changed: boolean } | undefined => {
  const r = reads[idea.id];
  return r ? { at: r.at, changed: r.hash !== extractTextHash(idea) } : undefined;
};
