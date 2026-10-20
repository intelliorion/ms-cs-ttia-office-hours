// Pure helpers for the Inbox pop-out. No React here, so they test in node.
// Everything the AI wrote (summary, answers, flags, names) is shown as plain text only.

export type InboxType = 'export' | 'email' | 'transcript' | 'document' | 'note' | 'unknown';
export type InboxStatus = 'new' | 'triaged' | 'applied' | 'held' | 'dismissed';

export interface ActionRecord {
  id: string;
  action: { t: string; ideaId?: string; candidates?: { id: string; title: string }[]; [k: string]: unknown };
  kind: 'safe' | 'ok' | 'held';
  status: 'applied' | 'pending' | 'undone' | 'failed';
  label: string;
  at?: string;
  undoneAt?: string;
  inverse?: unknown;
  result?: unknown;
  error?: string;
  note?: string;
}

export interface InboxItemView {
  id: string;
  file: string;
  name: string;
  type: InboxType;
  receivedAt: string;
  status: InboxStatus;
  meta?: { from?: string; subject?: string; date?: string; speakers?: string[]; attachments?: string[] };
  preview?: string;
  hold?: { reasons: string[] };
  triage?: {
    ideaId: string | null; confidence: number; ask: boolean; suggested?: string;
    candidates: { id: string; title: string }[]; notes: string[]; export?: true; needsHand?: true; aiError?: string;
    ai?: { summary?: string; kind?: string };
    match?: { how?: string };
  };
  actions?: ActionRecord[];
  problems?: string[];
}

export interface InboxCounts { new: number; ok: number; held: number; applied: number }
export interface InboxView { items: InboxItemView[]; counts: InboxCounts; problems: string[] }

/** How sure the match is, in a word. 0.7 is where the app stops asking. */
export function confidenceWord(n: number | null | undefined): 'sure' | 'likely' | 'unsure' {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'unsure';
  if (v >= 0.85) return 'sure';
  if (v >= 0.7) return 'likely';
  return 'unsure';
}

/**
 * An item's actions in the three groups the pop-out shows.
 * applied: done (Undo when it can be undone); ok: waiting for a Yes, failed ones included;
 * undone: already taken back. "Which idea?" is not an action here: the pop-out asks it on its own.
 */
export function groupActions(records: ActionRecord[] | undefined) {
  const list = (records ?? []).filter((r) => r.action?.t !== 'ask_idea');
  return {
    applied: list.filter((r) => r.status === 'applied'),
    ok: list.filter((r) => r.status === 'pending' || r.status === 'failed'),
    undone: list.filter((r) => r.status === 'undone'),
  };
}

/** Undo is offered only for an applied action that recorded how to take itself back. */
export const canUndo = (r: ActionRecord) => r.status === 'applied' && !!r.inverse;

/** The ids the Apply all button sends: pending or failed, never "Which idea?". */
export const applyableIds = (records: ActionRecord[] | undefined) => groupActions(records).ok.map((r) => r.id);

const TYPE_WORDS: Record<InboxType, string> = {
  export: 'Export', email: 'Email', transcript: 'Transcript', document: 'Document', note: 'Note', unknown: 'File',
};
export const typeWord = (t: string | undefined) => TYPE_WORDS[t as InboxType] ?? 'File';

const oneLine = (s: unknown, max = 160) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The item's one-line headline: the AI's summary, else the subject, else the start of the text, else the file name. */
export function itemHeadline(item: Pick<InboxItemView, 'name' | 'meta' | 'preview' | 'triage' | 'status' | 'type'>): string {
  if (item.status === 'held') return `${item.name} is held`;
  const summary = oneLine(item.triage?.ai?.summary);
  if (summary) return summary;
  const subject = oneLine(item.meta?.subject);
  if (subject) return subject;
  if (item.triage?.export) return `An export: ${item.name}`;
  const start = oneLine(item.preview, 120);
  return start || item.name || 'Untitled';
}

/** The Inbox (n) count: new, waiting for a Yes, and held. */
export const inboxCount = (c: InboxCounts | null | undefined) => (c ? c.new + c.ok + c.held : 0);

/** The ideas to offer under "Which idea?": the ask action's candidates, else the triage's. */
export function askCandidates(item: Pick<InboxItemView, 'actions' | 'triage'>): { id: string; title: string }[] {
  const ask = (item.actions ?? []).find((r) => r.action?.t === 'ask_idea' && r.status === 'pending');
  const c = (ask?.action.candidates as { id: string; title: string }[] | undefined) ?? item.triage?.candidates ?? [];
  return c.filter((x) => x && x.id);
}

/** Is the item asking which idea it belongs to? */
export const isAsking = (item: Pick<InboxItemView, 'status' | 'triage' | 'actions'>) =>
  item.status !== 'held' && item.status !== 'dismissed'
  && (!!item.triage?.ask || (item.actions ?? []).some((r) => r.action?.t === 'ask_idea' && r.status === 'pending'));

/** A day in plain form, e.g. 20 Oct 2026. Unknown dates come back as given. */
export function dayOf(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon} ${m[1]}` : iso;
}

/** What to say when the same file is dropped again. */
export const duplicateNotice = (item: Pick<InboxItemView, 'name' | 'receivedAt'>) => `Already dropped on ${dayOf(item.receivedAt)}: ${item.name}`;

/** Problems to list under "Working by hand": the app's notes and anything that could not be read. */
export function handProblems(item: Pick<InboxItemView, 'triage' | 'problems'>): string[] {
  return [...new Set([...(item.triage?.notes ?? []), ...(item.problems ?? [])].map((s) => oneLine(s, 300)).filter((s) => s && !/^no ai: working by hand\.?$/i.test(s)))];
}

/** Needs a hand: no AI answer, or the app could not sort it. */
export const needsHand = (item: Pick<InboxItemView, 'triage' | 'problems' | 'status'>) =>
  item.status !== 'held' && (!!item.triage?.needsHand || (!item.triage && (item.problems?.length ?? 0) > 0));

/** HTTP headers carry Latin-1 only, so the file name goes up percent-encoded; the server decodes it. */
export const filenameHeader = (name: string) => encodeURIComponent(name);

/** The server's limit for one request. */
export const MAX_DROP_BYTES = 20 * 1024 * 1024;

/** Said instead of sending a file the server would refuse; null when it's small enough. */
export const tooLargeNotice = (file: { name: string; size: number }) =>
  file.size > MAX_DROP_BYTES ? `${file.name} is too large to drop (over 20 MB). Save a smaller copy and drop that.` : null;

/** What happened to one file of a drop. */
export type DropOutcome =
  | { kind: 'added'; name: string }
  | { kind: 'duplicate' | 'too-large' | 'failed'; name: string; text: string };

/** One notice for a whole drop, so a later file never hides what happened to an earlier one. */
export function dropSummary(outcomes: DropOutcome[]): { text: string; kind: 'ok' | 'error' } | null {
  if (!outcomes.length) return null;
  const bad = outcomes.some((o) => o.kind === 'too-large' || o.kind === 'failed');
  if (outcomes.length === 1) {
    const [o] = outcomes;
    if (o.kind === 'added') return { text: `${o.name} is in the Inbox.`, kind: 'ok' };
    return { text: o.kind === 'duplicate' ? `${o.text}. Nothing was done again.` : o.text, kind: bad ? 'error' : 'ok' };
  }
  const of = (k: DropOutcome['kind']) => outcomes.filter((o) => o.kind === k);
  const parts: string[] = [];
  if (of('added').length) parts.push(`${of('added').length} added`);
  const list = (k: DropOutcome['kind'], words: string, detail = false) => {
    const xs = of(k);
    if (xs.length) parts.push(`${xs.length} ${words}: ${xs.map((o) => (detail && 'text' in o ? `${o.name} (${o.text})` : o.name)).join(', ')}`);
  };
  list('duplicate', 'already dropped');
  list('too-large', 'too large');
  list('failed', 'not added', true);
  return { text: `${parts.join(', ')}.`, kind: bad ? 'error' : 'ok' };
}
