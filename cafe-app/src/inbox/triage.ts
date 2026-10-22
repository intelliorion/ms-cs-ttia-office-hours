import { parse as parseCsv } from 'csv-parse/sync';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { listIdeas, ideaDir } from '../ideas/store';
import type { Idea } from '../ideas/idea';
import { STAGE_NAMES } from '../rules/stages';
import { understandTask, lookTask, type Understanding, type TriageInput } from '../ai/tasks';
import { AiError } from '../ai/schema';
import { rebuildGraph } from '../graph/store';
import { nodeId } from '../graph/ontology';
import { CANNOT_LOOK, type Connector } from '../ai/connector';
import { parseDrop, type ParsedDrop } from './parse';
import { readPdfText } from './pdf';
import { screenDrop, knownParticipants } from './screen';
import { getItem, updateItem, holdItem, type InboxItem } from './store';
import { matchIdea, displayName, ASK_BELOW, type MatchResult, type MatchHow } from './match';

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
  ai?: Understanding;
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
function combine(match: MatchResult, ai: Understanding | undefined, byId: Map<string, Idea>, notes: string[]) {
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

/** What the screen made of the file, in a few words ("Email, 2 paragraphs, our earlier email quoted"). */
export function readDetail(parsed: ParsedDrop, aiMs?: number): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;
  const lines = parsed.text.split('\n').filter((l) => l.trim()).length;
  const { pages, words = 0 } = parsed.meta;
  if (parsed.meta.readBy === 'ai') {
    return `${pages ? 'Scanned PDF' : 'Picture'} read by the AI, ${((aiMs ?? 0) / 1000).toFixed(1)} s, ${n(words, 'word')}`;
  }
  if (parsed.type === 'document' && pages) return `PDF, ${n(pages, 'page')}, ${n(words, 'word')}`;
  switch (parsed.type) {
    case 'email': {
      const paras = parsed.text.split(/\n\s*\n/).filter((p) => p.trim()).length;
      return `Email, ${n(paras, 'paragraph')}${parsed.meta.quoted ? ', our earlier email quoted' : ''}`;
    }
    case 'export': {
      const rows = exportRows(parsed);
      return rows === undefined ? 'Form export' : `Form export, ${n(rows, 'row')}`;
    }
    case 'transcript': {
      const who = parsed.meta.speakers?.length ?? 0;
      return `Transcript, ${n(lines, 'line')}${who ? `, ${n(who, 'speaker')}` : ''}`;
    }
    case 'document': return `Document, ${n(lines, 'line')}`;
    default: return `Note, ${n(lines, 'line')}`;
  }
}

/** Data rows of a CSV export (the header not counted); undefined when the file can't be counted here (xlsx). */
/** Data rows in a CSV export (records, not lines: a real form cell often spans several lines). */
export function exportRows(parsed: ParsedDrop): number | undefined {
  if (parsed.type !== 'export' || parsed.screenText === undefined) return undefined;
  try {
    const records = parseCsv(parsed.screenText, { relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][];
    return Math.max(0, records.filter((r) => r.some((c) => c.trim())).length - 1);
  } catch {
    return Math.max(0, parsed.screenText.split('\n').filter((l) => l.trim()).length - 1);
  }
}

export const HOW_WORDS: Record<MatchHow, string> = { 'cafe-id': 'Café ID', title: 'title', sender: 'sender', chosen: 'your pick', none: 'nothing' };

export const NEEDS_CLAUDE = 'Reading pictures needs Claude Code (AI helper → provider)';
export const TEXT_NOT_KEPT = 'The text was not kept.';
/** A PDF with fewer non-space characters than this in its text layer is a scan: the AI reads it as a picture. */
export const SCANNED_BELOW = 40;

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean).length;
const unreadable = (reason: string): ParsedDrop => ({ type: 'unknown', text: '', meta: {}, unreadable: reason });

/**
 * A PDF's text by code; a picture (or a scanned PDF) by the AI looking at the stored file.
 * onStep tells the Read step what is happening while the AI runs. AI errors other than "can't look" are thrown.
 */
async function readPending(
  file: string, parsed: ParsedDrop, bytes: Uint8Array, ai: Connector | null | undefined, onStep?: (detail: string) => unknown,
): Promise<{ parsed: ParsedDrop; aiMs?: number }> {
  if (!parsed.meta.pending) return { parsed };
  let pages: number | undefined;
  if (parsed.meta.pending === 'pdf') {
    const r = await readPdfText(bytes);
    if ('error' in r) return { parsed: unreadable("Can't open this PDF (it may be protected)") };
    if (r.text.replace(/\s/g, '').length >= SCANNED_BELOW) return { parsed: { type: 'document', text: r.text, meta: { pages: r.pages, words: wordsOf(r.text) } } };
    pages = r.pages;
  }
  if (!ai) return { parsed: unreadable(NEEDS_CLAUDE) };
  await onStep?.(pages ? 'Scanned PDF: the AI is reading it…' : 'Picture: the AI is reading it…');
  let out: Awaited<ReturnType<Connector['look']>>;
  try {
    out = await ai.look(file, lookTask);
  } catch (e) {
    if (e instanceof AiError && (e.message === CANNOT_LOOK || e.message === 'No AI available')) return { parsed: unreadable(NEEDS_CLAUDE) };
    throw e;
  }
  const { text, notes, readable } = out.output;
  if (!readable || !text.trim()) return { parsed: unreadable(`Can't read this picture: ${notes.trim() || 'nothing in it to read'}`) };
  return {
    parsed: { type: 'note', text: text.trim(), meta: { readBy: 'ai', notes, words: wordsOf(text), ...(pages ? { pages } : {}) } },
    aiMs: out.ms,
  };
}

/**
 * Steps 2 and 3: read a fresh parse of the stored file and screen it. Nothing is written.
 * A picture or a scanned PDF is read by the AI (ai.look); when the screen then holds it, its reasons say the text was not kept.
 */
export async function readAndScreen(
  root: string, id: string, ai: Connector | null | undefined, onStep?: (detail: string) => unknown, opts: { reuseRead?: boolean } = {},
) {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No such import ${id}`);
  const file = path.join(root, ...item.file.split('/'));
  const bytes = new Uint8Array(await fs.readFile(file));
  // A pick ("Which idea?") keeps the transcription the operator was shown; only Run again has the AI look again.
  const stored = opts.reuseRead && item.meta?.readBy === 'ai' && item.text ? { type: 'note' as const, text: item.text, meta: item.meta } : null;
  const { parsed, aiMs } = stored ? { parsed: stored as ParsedDrop, aiMs: undefined } : await readPending(file, parseDrop(path.basename(item.file), bytes), bytes, ai, onStep);
  const screened = screenDrop(item.name, parsed, await knownParticipants(root));
  if (!screened.hold && parsed.type === 'export' && parsed.screenText === undefined && TRACKER_NAME.test(item.name)) {
    screened.hold = true;
    screened.reasons.push("Looks like a tracker and this kind of file can't be checked yet, so it's held for you to check by hand");
  }
  if (screened.hold && parsed.meta.readBy === 'ai') screened.reasons.push(TEXT_NOT_KEPT);
  return { item, parsed, screened, aiMs };
}

export interface MatchStep { match: MatchResult; ideas: Idea[]; byId: Map<string, Idea> }

/** Step 4: the deterministic match (or the operator's choice). Nothing is written. */
export async function matchStep(root: string, item: InboxItem, parsed: ParsedDrop, opts: { ideaId?: string } = {}): Promise<MatchStep> {
  const { ideas } = await listIdeas(root);
  const byId = new Map(ideas.map((i) => [i.id, i]));
  const fresh: InboxItem = { ...item, type: parsed.type, text: parsed.text, meta: parsed.meta };
  const chosen = opts.ideaId && byId.has(opts.ideaId) ? opts.ideaId : undefined;
  const match: MatchResult = chosen ? { ideaId: chosen, confidence: 1, how: 'chosen', candidates: [chosen] } : matchIdea(fresh, ideas);
  return { match, ideas, byId };
}

/**
 * Step 5: (not for exports) ask the AI for facts. Writes what was read (type, text, meta, problems) and
 * item.triage; never applies anything. Returns the TriageRecord.
 */
export async function understandStep(
  root: string, item: InboxItem, parsed: ParsedDrop, m: MatchStep, connector: Connector | null | undefined,
): Promise<TriageRecord> {
  const at = new Date().toISOString();
  const { match, byId } = m;
  // The screen passed: only now are the text and what was read from it stored.
  const read: Partial<InboxItem> = {
    type: parsed.type, text: parsed.text, meta: parsed.meta,
    ...(parsed.problems?.length ? { problems: [...new Set([...(item.problems ?? []), ...parsed.problems])] } : {}),
  };

  // Exports never go to the AI: they are imported.
  if (parsed.type === 'export') {
    const triage: TriageRecord = {
      at, match: { confidence: 0, how: 'none', candidates: [] }, ideaId: null, confidence: 0, ask: false,
      candidates: [], notes: ['A list export: import it to add or update ideas'], export: true,
    };
    await updateItem(root, item.id, { ...read, type: 'export', status: 'triaged', triage });
    return triage;
  }

  const notes = match.note ? [match.note] : [];

  // The AI: facts only, checked against the schema.
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
  // What the universe already holds (the matched idea's own stars first) and what the team already answered.
  if (connector) {
    const g = await rebuildGraph(root).catch(() => ({ nodes: [], edges: [] }));
    const near = new Set<string>();
    const me = idea ? nodeId('Idea', idea.id) : '';
    if (idea) for (const e of g.edges) { if (e.from === me) near.add(e.to); else if (e.to === me) near.add(e.from); }
    const stars = g.nodes.filter((n) => n.type !== 'Idea' && n.type !== 'Person');
    input.knownStars = [...stars.filter((n) => near.has(n.id)), ...stars.filter((n) => !near.has(n.id))]
      .slice(0, 60).map((n) => ({ type: n.type, label: n.label.slice(0, 60) }));
    input.teamAnswers = ((idea as (Idea & { answers?: { question: string; answer: string }[] }) | undefined)?.answers ?? []).slice(0, 12);
  }

  let ai: Understanding | undefined; let provider: string | undefined; let aiError: string | undefined;
  const status = connector ? await connector.status().catch(() => ({ provider: null })) : { provider: null };
  if (connector && status.provider) {
    try {
      const out = await connector.runWith(understandTask, input);
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
  await updateItem(root, item.id, { ...read, status: 'triaged', triage });
  return triage;
}

/**
 * Triage one dropped item: screen a fresh parse first (held → stop, nothing else reads it),
 * then match, then (not for exports) ask the AI for facts. Stores item.triage; never applies anything.
 * opts.ideaId: the operator chose the idea ("Which idea?"), so the match is certain.
 */
export async function triageItem(
  root: string, id: string, connector: Connector | null | undefined, opts: { ideaId?: string } = {},
): Promise<InboxItem> {
  const { item, parsed, screened } = await readAndScreen(root, id, connector);
  if (item.status === 'held') return item;
  if (screened.hold) return holdItem(root, id, screened.reasons, parsed.meta);
  const m = await matchStep(root, item, parsed, opts);
  await understandStep(root, item, parsed, m, connector);
  return (await getItem(root, id))!;
}
