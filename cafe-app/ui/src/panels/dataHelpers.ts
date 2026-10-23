/** The Data step's words and small rules, kept apart from the section so they can be tested on their own. */
import { DATA_EXTS, DATA_STEP_ORDER, DATA_STEP_WORDS, KIND_LABELS, TOPIC_WORDS, columnsOf, guessKind, meaningOf, sizeWords, whatOf } from '../../../src/data/model';

export { DATA_EXTS, DATA_STEP_ORDER, DATA_STEP_WORDS, KIND_LABELS, TOPIC_WORDS, columnsOf, guessKind, meaningOf, sizeWords, whatOf };

/** A column's meaning with its codes after it, as one sentence then the codes ("The policy. Codes: T travel"). */
export const meaningWithCodes = (meaning: string, codes?: string) =>
  (codes ? `${meaning}${/[.!?:)]$/.test(meaning) ? '' : '.'} Codes: ${codes}` : meaning);

/** Where an earlier answer came from, in words: a file by its name, the app's own sources as they are. */
export const sourceWords = (source: string) => String(source).split(/[\\/]/).pop() ?? source;
export const DATA_KIND_OPTIONS = Object.entries(KIND_LABELS) as [string, string][];
export const ACCEPT = DATA_EXTS.map((e) => `.${e}`).join(',');

/** A step card's look: the Import's dot styles. */
export const glyphOf = (status?: string) =>
  status === 'done' ? 'ok' : status === 'running' ? 'run' : status === 'needs-you' ? 'you' : status === 'failed' ? 'bad' : status === 'skipped' ? 'skip' : 'todo';

/** All five cards of a file, in order, a step not reached yet as "todo". */
export function stepCards(file: { steps?: { id: string; status: string; detail: string; ms?: number }[] }) {
  return DATA_STEP_ORDER.map((id) => {
    const s = (file.steps ?? []).find((x) => x.id === id);
    return { id, word: DATA_STEP_WORDS[id], status: s?.status ?? 'todo', detail: s?.detail ?? '', ms: s?.ms };
  });
}

/** The card whose words show under the dots: the one running, else the one that needs the operator, else the last one reached. */
export function currentCard(file: { steps?: { id: string; status: string; detail: string }[] }) {
  const cards = stepCards(file).filter((c) => c.status !== 'todo');
  // Once saved, what the AI understood says more than "saved".
  return cards.find((c) => c.status === 'running') ?? cards.find((c) => c.status === 'needs-you' || c.status === 'failed')
    ?? [...cards].reverse().find((c) => c.status !== 'skipped' && c.id !== 'saved') ?? cards.at(-1);
}

/** The files as stored, with the live copies streamed in while a run goes on (a new file is added at the end). */
export function mergeFiles(stored: any[], live: Record<string, any>): any[] {
  const out = stored.map((f) => live[f.id] ?? f);
  for (const [id, f] of Object.entries(live)) if (!stored.some((x) => x.id === id)) out.push(f);
  return out;
}

/** Where the data stands, for the section's heading. */
export function dataPhase(d: { files?: any[]; steps?: any[]; summary?: unknown; confirmedAt?: string } | undefined): { word: string; kind: 'none' | 'working' | 'complete' | 'confirmed' } {
  if (!d || (!d.files?.length && !d.steps?.length)) return { word: 'no data yet', kind: 'none' };
  if (d.confirmedAt) return { word: `confirmed ${d.confirmedAt}`, kind: 'confirmed' };
  if (d.summary) return { word: 'complete, not confirmed', kind: 'complete' };
  const n = d.files?.length ?? 0;
  return { word: `${n} file${n === 1 ? '' : 's'}, not confirmed`, kind: 'working' };
}

/** A file's columns as the card lists them: name, type and meaning (the operator's when they wrote one). */
export function columnRows(f: any): { name: string; type: string; meaning: string; mine: boolean; codes?: string }[] {
  return columnsOf(f).map((c) => ({
    name: c.name, type: c.type, meaning: meaningOf(f, c.name) ?? '', mine: Boolean(f.edits?.columns?.[c.name]),
    ...(f.understanding?.columns?.find((x: any) => x.name === c.name)?.codes ? { codes: f.understanding.columns.find((x: any) => x.name === c.name).codes } : {}),
  }));
}

export const isRunning = (f: any) => (f.steps ?? []).some((s: any) => s.status === 'running');
