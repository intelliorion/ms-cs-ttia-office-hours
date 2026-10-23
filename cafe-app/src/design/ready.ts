/**
 * Ready for the design? The check the Design section shows before its first question, and the design-step route
 * applies: the data understood and confirmed, at least one feature, one approved tool whose evaluation is up to date
 * and whose to-do list is clear, and nothing waiting. The code decides; nothing here asks the AI. Pure (no files), so
 * the server and the page read it the same way. Data and Features & tool can be done in either order: the suggested
 * next step is the first gap that can be worked on now, in the order data, features, tool, waiting.
 */
import { inScope, outOfDate, type ToolChoice } from './choice';
import { awaitsReevaluation, isOpenNeed, type EmailAnswer } from '../review/needs';
import { retiredToolNote } from '../graph/ontology';
import { isUsable, type DataState } from '../data/model';
import type { PrepNeed } from '../ideas/idea';

/** Where a "Go to" button takes the operator: the data step, or the features or the tool in Features and tool. */
export type ReadyTarget = 'data' | 'features' | 'tool';
export type ReadyKey = 'data' | 'features' | 'tool' | 'waiting';

export interface ReadyItem {
  key: ReadyKey;
  /** The item, as the checklist names it. */
  label: string;
  ok: boolean;
  /** When ok: what is there. Otherwise: what is missing, one plain line. */
  text: string;
  /** When not ok: the gap in a few words, for "The design will miss: …" and "Designed before: …". */
  gap?: string;
  /** When not ok: what to do next, after "Next: <step> — ". */
  todo?: string;
  go: ReadyTarget;
  /** The only thing left is a reply from the team: other gaps are suggested first. */
  waitsOnTeam?: boolean;
}

export interface Readiness {
  ready: boolean;
  items: ReadyItem[];
  /** The gaps, in a few words each (empty when ready). */
  missing: string[];
  /** The step to do next, when something is missing. */
  next?: { go: ReadyTarget; text: string };
}

/** The design's state as the check reads it (DesignState, or the page's copy of it). */
export interface ReadyState {
  features?: { name: string; scope?: { status: string } }[];
  tool?: Pick<ToolChoice, 'tool' | 'evaluatedFor' | 'fit' | 'needsAi' | 'at'> & { dataFor?: string };
  toolPrep?: { needs?: PrepNeed[] };
  data?: DataState;
}

/** The step names the suggestion line uses. */
export const STEP_WORDS: Record<ReadyTarget, string> = { data: 'understand the data', features: 'features and tool', tool: 'features and tool' };

/** Said wherever the tool was evaluated before the data was confirmed (or before it was confirmed again). */
export const DATA_STALE_NOTE = 'The data was confirmed after the tool was evaluated: its fit may not hold for the data.';

/**
 * True when the tool's evaluation did not see the confirmed data as it is now. `dataFor` is the confirmation the
 * evaluation read ('' for none); an older choice without it counts as seeing data confirmed on or before its own date.
 * A tool still waiting for its first evaluation (needsAi) says so already.
 */
export function toolDataStale(state: Pick<ReadyState, 'tool' | 'data'>): boolean {
  const t = state.tool;
  const confirmed = state.data?.confirmedAt;
  if (!t || !confirmed || t.needsAi) return false;
  if (t.dataFor === undefined) return !t.at || t.at < confirmed;
  return t.dataFor !== confirmed;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isReading = (f: DataState['files'][number]) => f.steps.some((s) => s.status === 'running');

function dataItem(d: DataState | undefined): ReadyItem {
  const base = { key: 'data' as const, label: 'The data', go: 'data' as const };
  const files = d?.files ?? [];
  const usable = files.filter(isUsable);
  if (d?.confirmedAt && usable.length) return { ...base, ok: true, text: `Understood and confirmed on ${d.confirmedAt} (${plural(usable.length, 'file')}).` };
  const gap = 'the confirmed data';
  if (!usable.length) {
    return files.some(isReading)
      ? { ...base, ok: false, gap, text: 'A file is still being read.', todo: 'wait for the file to finish reading' }
      : { ...base, ok: false, gap, text: 'No data yet: no sample input or output has been dropped.', todo: 'drop the sample input and output' };
  }
  const stale = files.find((f) => f.stale);
  if (stale) return { ...base, ok: false, gap, text: `Not confirmed: ${stale.name} changed kind since it was understood.`, todo: `understand ${stale.name} again` };
  const open = (d?.steps ?? []).find((s) => !s.answer?.trim() && !s.askedTeam);
  if (open) return { ...base, ok: false, gap, text: `Not confirmed: data question D${open.n} waits for an answer.`, todo: `answer data question D${open.n}` };
  if (!d?.summary) return { ...base, ok: false, gap, text: 'Not confirmed: the understanding is not complete yet.', todo: 'ask the next data question, or finish it by hand' };
  return { ...base, ok: false, gap, text: 'Not confirmed: the understanding is complete, but Looks right has not been pressed.', todo: 'check the understanding and press Looks right' };
}

function featuresItem(features: ReadyState['features']): ReadyItem {
  const n = (features ?? []).filter((f) => inScope(f as { scope?: { status: 'out' | 'outside' } })).length;
  const base = { key: 'features' as const, label: 'The features', go: 'features' as const };
  return n ? { ...base, ok: true, text: `${plural(n, 'feature')} listed.` }
    : { ...base, ok: false, gap: 'the feature list', text: 'No features yet.', todo: 'list what the proof of concept must do' };
}

function toolItem(s: ReadyState, answers: EmailAnswer[]): ReadyItem {
  const base = { key: 'tool' as const, label: 'The tool', go: 'tool' as const };
  const t = s.tool;
  if (!t) return { ...base, ok: false, gap: 'a picked tool', text: 'No tool picked yet.', todo: 'pick the one tool' };
  const retired = retiredToolNote(t.tool);
  if (retired) return { ...base, ok: false, gap: 'an approved tool', text: `${retired}.`, todo: 'pick another tool' };
  if (t.needsAi) return { ...base, ok: false, gap: "the tool's evaluation", text: `${t.tool} has not been evaluated: no pros, cons or fit yet.`, todo: `evaluate ${t.tool} with the AI (Re-evaluate)` };
  const gap = 'an up-to-date tool evaluation';
  if (outOfDate(s.features ?? [], t)) return { ...base, ok: false, gap, text: 'The features changed since the tool was evaluated.', todo: `re-evaluate ${t.tool} for the new features` };
  if (t.fit.some((x) => x.stale)) return { ...base, ok: false, gap, text: 'The design changed what some features do since the tool was evaluated.', todo: `re-evaluate ${t.tool}` };
  if (toolDataStale(s)) return { ...base, ok: false, gap, text: DATA_STALE_NOTE, todo: `re-evaluate ${t.tool} with the confirmed data` };
  const needs = s.toolPrep?.needs ?? [];
  const open = needs.filter((x) => isOpenNeed(x, answers));
  const back = needs.filter((x) => awaitsReevaluation(x, answers));
  if (open.length) {
    const asked = open.every((x) => x.askedAt);
    return {
      ...base, ok: false, gap: "the tool's to-do list", text: `What you need: ${plural(open.length, 'item')} open (${open[0].need})${asked ? ', asked the team' : ''}.`,
      todo: asked ? "wait for the team's reply to the tool's questions, or paste the answers" : `clear the tool's to-do list: ${open[0].need}`,
      ...(asked ? { waitsOnTeam: true } : {}),
    };
  }
  if (back.length) return { ...base, ok: false, gap: "the tool's to-do list", text: `What you need: ${plural(back.length, 'answer')} in, not checked yet.`, todo: `re-evaluate ${t.tool} to check the answers` };
  return { ...base, ok: true, text: `${t.tool}, evaluated for the features${needs.length ? ', its to-do list clear' : ''}.` };
}

function waitingItem(d: DataState | undefined): ReadyItem {
  const base = { key: 'waiting' as const, label: 'Nothing waiting', go: 'data' as const };
  const reading = (d?.files ?? []).find(isReading);
  if (reading) return { ...base, ok: false, gap: 'a file still being read', text: `${reading.name} is still being read.`, todo: `wait for ${reading.name} to finish reading` };
  const withTeam = (d?.steps ?? []).filter((s) => !s.answer?.trim() && s.askedTeam);
  if (withTeam.length) {
    const ns = withTeam.map((s) => `D${s.n}`).join(', ');
    const one = withTeam.length === 1;
    return {
      ...base, ok: false, waitsOnTeam: true, gap: `the team's answer to data question${one ? '' : 's'} ${ns}`,
      text: `Data question${one ? '' : 's'} ${ns} ${one ? 'is' : 'are'} with the team (E2): waiting for the reply.`,
      todo: `wait for the team's reply to ${ns}, or answer ${one ? 'it' : 'them'} yourself`,
    };
  }
  return { ...base, ok: true, text: 'No data question or file waiting.' };
}

/** The check. `answers`: the team's emailed answers on the idea (they can clear a to-do item). */
export function designReadiness(state: ReadyState, opts: { answers?: EmailAnswer[] } = {}): Readiness {
  const items = [dataItem(state.data), featuresItem(state.features), toolItem(state, opts.answers ?? []), waitingItem(state.data)];
  const gaps = items.filter((x) => !x.ok);
  const missing = [...new Set(gaps.map((x) => x.gap!))];
  const first = gaps.find((x) => !x.waitsOnTeam) ?? gaps[0];
  return {
    ready: gaps.length === 0, items, missing,
    ...(first ? { next: { go: first.go, text: `Next: ${STEP_WORDS[first.go]} — ${first.todo}.` } } : {}),
  };
}

/** "Designed before: …", for design.md, the design pack and the history. */
export const designedBeforeText = (missing: string[]) => `Designed before: ${missing.join('; ')}. The design was started anyway, without them.`;
