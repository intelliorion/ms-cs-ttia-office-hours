import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { listIdeas, ideaDir } from '../ideas/store';
import type { Idea } from '../ideas/idea';
import { STAGE_NAMES } from '../rules/stages';
import { triageTask, type Triage, type TriageInput } from '../ai/tasks';
import type { Connector } from '../ai/connector';
import { parseDrop } from './parse';
import { screenDrop, knownParticipants } from './screen';
import { getItem, updateItem, holdItem, type InboxItem } from './store';
import { matchIdea, displayName, ASK_BELOW, type MatchResult } from './match';

/** What triage stores on the item (item.triage). Task 3 builds actions from it. */
export interface TriageRecord {
  at: string;
  /** The deterministic match, before the AI had its say. */
  match: MatchResult;
  /** The idea to act on, or null when it must ask (ask: true). */
  ideaId: string | null;
  /** Final confidence: the deterministic one, lowered by the AI if it was less sure. */
  confidence: number;
  ask: boolean;
  /** Best guess when asking (deterministic or the AI's), never acted on without the operator. */
  suggested?: string;
  candidates: { id: string; title: string }[];
  notes: string[];
  /** A list export: no AI; Task 3 offers the import. */
  export?: true;
  /** The AI's checked output (facts only). */
  ai?: Triage;
  provider?: string;
  /** No AI, or the AI failed or answered out of schema: the operator does it by hand. */
  needsHand?: true;
  aiError?: string;
}

/** Below this the AI's own suggestion stays: it may lower confidence, never create certainty. */
export const AI_CEILING = 0.69;
const TRACKER_NAME = /tracker|roster|register|headcount/i;

/** The numbered questions in the last E2 we sent for this idea. */
export async function openQuestionsOf(root: string, ideaId: string): Promise<string[]> {
  const dir = path.join(await ideaDir(root, ideaId), 'emails');
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => /^\d{3}-E2\.md$/.test(n)).sort();
  let best: { at: string; body: string } | undefined;
  for (const n of names) {
    const text = (await fs.readFile(path.join(dir, n), 'utf8').catch(() => '')).replace(/\r\n/g, '\n');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    if (!m) continue;
    let meta: { status?: string; sentAt?: unknown } = {};
    try { meta = (YAML.parse(m[1]) ?? {}) as typeof meta; } catch { continue; }
    if (meta.status !== 'sent') continue;
    const at = `${String(meta.sentAt ?? '')}|${n}`;
    if (!best || at >= best.at) best = { at, body: m[2] };
  }
  if (!best) return [];
  return best.body.split('\n')
    .map((l) => /^\s*\d{1,2}[.)]\s+(.+?)\s*$/.exec(l)?.[1])
    .filter((q): q is string => !!q && !q.startsWith('['))
    .slice(0, 10);
}

const stageOf = (i: Idea) => (i.closed ? `Closed (${i.closed.as})` : STAGE_NAMES[i.stage]);

/** Combine the deterministic match with the AI's view. The AI may lower confidence, never raise it. */
function combine(match: MatchResult, ai: Triage | undefined, byId: Map<string, Idea>, notes: string[]) {
  let ideaId = match.ideaId ?? null;
  let confidence = match.confidence;
  const ids = [...match.candidates];
  if (match.how === 'chosen' && ideaId) {
    // The operator chose: the AI can't reopen "Which idea?", only leave a note.
    const aiId = ai?.ideaId ?? null;
    if (ai && aiId !== ideaId) notes.push(aiId ? `The AI thinks this may be about ${aiId}, but you chose ${ideaId}` : `The AI couldn't tell which idea this is about; you chose ${ideaId}`);
    else if (ai && ai.matchConfidence < ASK_BELOW) notes.push(`The AI was unsure this is about ${ideaId}, but you chose it`);
    return { ideaId, confidence: 1, ask: false, candidates: [{ id: ideaId, title: byId.get(ideaId)?.title ?? '' }] };
  }
  if (ai) {
    const aiId = ai.ideaId && byId.has(ai.ideaId) ? ai.ideaId : null;
    if (ideaId && aiId === ideaId) confidence = Math.min(confidence, ai.matchConfidence);
    else if (ideaId) {
      confidence = Math.min(confidence, ai.matchConfidence, AI_CEILING);
      if (aiId) ids.unshift(aiId);
      notes.push(aiId ? `The AI thinks this may be about ${aiId} instead` : "The AI couldn't tell which idea this is about");
    } else if (aiId) {
      ideaId = aiId;
      confidence = Math.min(ai.matchConfidence, AI_CEILING);
      ids.unshift(aiId);
    }
  }
  // Decide on the exact value, then round down for display (0.699 asks and shows 0.69).
  const ask = !ideaId || confidence < ASK_BELOW;
  confidence = Math.floor(confidence * 100 + 1e-9) / 100;
  if (ideaId) ids.unshift(ideaId);
  const candidates = [...new Set(ids)].filter((id) => byId.has(id)).slice(0, 5).map((id) => ({ id, title: byId.get(id)!.title }));
  return { ideaId: ask ? null : ideaId, confidence, ask, ...(ask && ideaId ? { suggested: ideaId } : {}), candidates };
}

/**
 * Triage one dropped item: screen a fresh parse first (held → stop, nothing else reads it),
 * then match, then (not for exports) ask the AI for facts. Stores item.triage; never applies anything.
 * opts.ideaId: the operator chose the idea ("Which idea?"), so the match is certain.
 */
export async function triageItem(
  root: string, id: string, connector: Connector | null | undefined, opts: { ideaId?: string } = {},
): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No inbox item ${id}`);
  if (item.status === 'held') return item;

  // 1. Screen before anything else reads the text.
  const bytes = new Uint8Array(await fs.readFile(path.join(root, ...item.file.split('/'))));
  const parsed = parseDrop(path.basename(item.file), bytes);
  const screened = screenDrop(item.name, parsed, await knownParticipants(root));
  if (!screened.hold && parsed.type === 'export' && parsed.screenText === undefined && TRACKER_NAME.test(item.name)) {
    screened.hold = true;
    screened.reasons.push("Looks like a tracker and this kind of file can't be checked yet, so it's held for you to check by hand");
  }
  if (screened.hold) return holdItem(root, id, screened.reasons);

  const at = new Date().toISOString();
  const { ideas } = await listIdeas(root);
  const byId = new Map(ideas.map((i) => [i.id, i]));
  const fresh: InboxItem = { ...item, type: parsed.type, text: parsed.text, meta: parsed.meta };

  // 2. Exports never go to the AI: Task 3 imports them.
  if (parsed.type === 'export') {
    const triage: TriageRecord = {
      at, match: { confidence: 0, how: 'none', candidates: [] }, ideaId: null, confidence: 0, ask: false,
      candidates: [], notes: ['A list export: import it to add or update ideas'], export: true,
    };
    return updateItem(root, id, { type: 'export', status: 'triaged', triage });
  }

  // 3. Deterministic match (or the operator's choice).
  const chosen = opts.ideaId && byId.has(opts.ideaId) ? opts.ideaId : undefined;
  const match: MatchResult = chosen ? { ideaId: chosen, confidence: 1, how: 'chosen', candidates: [chosen] } : matchIdea(fresh, ideas);
  const notes = match.note ? [match.note] : [];

  // 4. The AI: facts only, checked against the schema.
  const idea = match.ideaId ? byId.get(match.ideaId) : undefined;
  const meta = parsed.meta;
  // Display names only: addresses never go to the AI.
  const peoplePresent = [...new Set([...(meta.to ?? []), ...(meta.cc ?? []), ...(meta.speakers ?? [])].map(displayName).filter(Boolean))];
  const input: TriageInput = {
    item: {
      type: parsed.type, text: parsed.text,
      ...(meta.subject ? { subject: meta.subject } : {}),
      ...(meta.from && displayName(meta.from) ? { from: displayName(meta.from) } : {}),
      ...(meta.quoted ? { quoted: meta.quoted } : {}),
      ...(peoplePresent.length ? { peoplePresent } : {}),
    },
    ...(idea ? {
      idea: {
        id: idea.id, title: idea.title, challenge: idea.challenge, stage: stageOf(idea),
        openQuestions: await openQuestionsOf(root, idea.id),
        waitingReply: !!idea.sent?.E2 && !idea.checklist?.s2d?.done,
      },
    } : {}),
    candidates: match.candidates.filter((c) => c !== idea?.id).map((c) => ({ id: c, title: byId.get(c)?.title ?? '' })),
  };

  let ai: Triage | undefined; let provider: string | undefined; let aiError: string | undefined;
  const status = connector ? await connector.status().catch(() => ({ provider: null })) : { provider: null };
  if (connector && status.provider) {
    try {
      const out = await connector.runWith(triageTask, input);
      ai = out.output; provider = out.label;
    } catch (e) {
      aiError = (e as Error).message || 'The AI call failed';
    }
  }
  if (!ai) notes.push(aiError ? `The AI couldn't help (${aiError}), so do this one by hand` : 'No AI: working by hand');

  const triage: TriageRecord = {
    at, match, ...combine(match, ai, byId, notes), notes,
    ...(ai ? { ai, provider } : { needsHand: true as const }),
    ...(aiError ? { aiError } : {}),
  };
  return updateItem(root, id, { status: 'triaged', triage });
}
