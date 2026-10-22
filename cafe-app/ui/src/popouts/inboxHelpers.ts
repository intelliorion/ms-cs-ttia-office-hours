// Pure helpers for the Import pop-out. No React here, so they test in node.
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
  /** Set when the app held this proposal back because it conflicts with what the Café already knows. */
  held?: Held;
}

/** Why a proposal waits for the operator: the rule that caught it, in words, and the star it looks like (if any). */
export interface Held { rule: string; why: string; existing?: string }

export interface InboxItemView {
  id: string;
  file: string;
  name: string;
  type: InboxType;
  receivedAt: string;
  status: InboxStatus;
  meta?: { from?: string; subject?: string; date?: string; speakers?: string[]; attachments?: string[]; pages?: number; words?: number; readBy?: 'ai'; notes?: string };
  preview?: string;
  /** The text is longer than the preview: the rest is in the file. */
  previewCut?: true;
  hold?: { reasons: string[] };
  steps?: Step[];
  triage?: {
    ideaId: string | null; confidence: number; ask: boolean; suggested?: string;
    candidates: { id: string; title: string }[]; notes: string[]; export?: true; needsHand?: true; aiError?: string;
    ai?: { what?: string; summary?: string; kind?: string; understood?: string[]; uncertain?: string[] };
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

const TYPE_WORDS: Record<InboxType | 'picture', string> = {
  export: 'Export', email: 'Email', transcript: 'Transcript', document: 'Document', note: 'Note', unknown: 'File', picture: 'Picture',
};
export const typeWord = (t: string | undefined) => TYPE_WORDS[t as InboxType] ?? 'File';

/**
 * A picture (or a scanned PDF) the AI read: meta.readBy is set only once the read is done, so a picture still being
 * read is not one yet, and a picture held at the screen (its text not kept) still is. The chip and the filter agree.
 */
export const isPicture = (i: Pick<InboxItemView, 'meta'>) => i.meta?.readBy === 'ai';
/** The kind shown on a card or a history row: 'picture' for a picture the AI read, else the item's type. */
export const kindOf = (i: Pick<InboxItemView, 'type' | 'meta'>): InboxType | 'picture' => (isPicture(i) ? 'picture' : i.type);
/** As kindOf, but a held file reads as a plain file unless it is a picture the AI read. */
export const shownKind = (i: Pick<InboxItemView, 'type' | 'meta' | 'status'>): InboxType | 'picture' =>
  i.status === 'held' && !isPicture(i) ? 'unknown' : kindOf(i);

const oneLine = (s: unknown, max = 160) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** The item's one-line headline: the AI's summary, else the subject, else the start of the text, else the file name. */
export function itemHeadline(item: Pick<InboxItemView, 'name' | 'meta' | 'preview' | 'triage' | 'status' | 'type'>): string {
  if (item.status === 'held') return `${item.name} is held`;
  const summary = oneLine(item.triage?.ai?.what ?? item.triage?.ai?.summary);
  if (summary) return summary;
  const subject = oneLine(item.meta?.subject);
  if (subject) return subject;
  if (item.triage?.export) return `An export: ${item.name}`;
  const start = oneLine(item.preview, 120);
  return start || item.name || 'Untitled';
}

/** The Import (n) count: new, waiting for a Yes, and held. */
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A stamp with a time is read in local time; a bare date (2026-10-20) is taken as written. Null when it is neither. */
const localDate = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!/^\d{4}-\d{2}-\d{2}T/.test(iso)) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** The local calendar day of a date, as a sortable key. */
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** A day in plain form (local time), e.g. 20 Oct 2026. Unknown dates come back as given. */
export function dayOf(iso: string | undefined): string {
  if (!iso) return '';
  const d = localDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : iso;
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
    if (o.kind === 'added') return { text: `${o.name} imported.`, kind: 'ok' };
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

// ---- The agentic Import: eight recorded steps per item, conflicts held per action, a full history. ----

/** Mirrors the server's step log (src/inbox/steps.ts). */
export type StepId = 'receive' | 'read' | 'screen' | 'match' | 'understand' | 'context' | 'graph' | 'check';
export type StepStatus = 'running' | 'done' | 'skipped' | 'needs-you' | 'failed';
export interface TrailEntry { title: string; found: string[]; held?: number; failed?: true }
export interface Step { id: StepId; status: StepStatus; at: string; detail: string; ms?: number; of?: [number, number]; trail?: TrailEntry[]; since?: string }
export const STEP_ORDER: StepId[] = ['receive', 'read', 'screen', 'match', 'understand', 'context', 'graph', 'check'];
/** What each step is called on the card: what it does, in plain words. */
export const STEP_WORDS: Record<StepId, string> = {
  receive: 'Save', read: 'Read', screen: 'Privacy check', match: 'Find the idea', understand: 'AI reads', context: 'Update the idea', graph: 'Grow the universe', check: 'Anything for you',
};
/** One sentence per step: what happens there and who does it (shown on hover). */
export const STEP_WHAT: Record<StepId, string> = {
  receive: 'The app keeps a copy of the file.',
  read: 'The app pulls the text out of the file. For a picture or a scanned PDF, the AI reads it instead.',
  screen: 'The app looks for names with ids, phones or emails. If it finds them it stops here, and the AI never sees the file.',
  match: 'The app works out which idea this is about: by Café ID, the title in the subject, or the sender.',
  understand: 'The AI reads the text and says what it is about, and which facts and stars it holds. It proposes; the app decides.',
  context: 'The app writes the facts into the idea: answers, builder, flags.',
  graph: 'The app adds the new stars and links to the universe.',
  check: 'The app holds anything that clashes with what is already known, and tells you.',
};

/** Who does a step on this item: the AI only reads (step 5, and step 2 for a picture); the app does the rest. */
export function stepWho(id: StepId, item: Pick<InboxItemView, 'meta' | 'steps'>): 'ai' | 'app' {
  if (id === 'understand') return 'ai';
  if (id === 'read') {
    const d = item.steps?.find((x) => x.id === 'read')?.detail ?? '';
    return item.meta?.readBy === 'ai' || /the AI/.test(d) ? 'ai' : 'app';
  }
  return 'app';
}

const APP_NOW: Record<StepId, [string, string]> = {
  receive: ['Saving a copy', 'The file is kept as it came, so nothing is lost.'],
  read: ['Pulling the text out', 'Opening the file and reading its text and tables.'],
  screen: ['Checking for personal data', 'Before any AI sees it: names with ids, phone numbers, emails.'],
  match: ['Finding the idea', 'By Café ID, the title in the subject, or the sender.'],
  understand: ['Reading', ''],
  context: ['Updating the idea', 'Writing the answers and facts into the idea.'],
  graph: ['Growing the universe', 'Adding the new stars and links.'],
  check: ['Checking for clashes', 'Comparing what came in with what the app already knows.'],
};

export interface NowLine { who: 'ai' | 'app'; step: StepId; head: string; sub: string; of?: [number, number]; secs: number }

/**
 * The sentence for the card's Now strip: what is happening this moment, and who is doing it. The AI's step wins over
 * the app's waiting steps (a form export's check waits while the AI reads). null when nothing runs.
 */
export function nowLine(item: Pick<InboxItemView, 'steps' | 'meta' | 'type' | 'triage'>, now: number, ideaTitle?: (id: string) => string): NowLine | null {
  const running = (item.steps ?? []).filter((x) => x.status === 'running');
  if (!running.length) return null;
  const s = running.find((x) => x.id === 'understand') ?? running.find((x) => stepWho(x.id, item) === 'ai') ?? running[0];
  const secs = Math.max(0, Math.round((now - Date.parse(s.since ?? s.at)) / 1000));
  const who = stepWho(s.id, item);
  if (s.id === 'understand') {
    if (s.of) {
      const title = s.detail.startsWith('Reading ') ? s.detail.slice(8) : '';
      return {
        who, step: s.id, of: s.of, secs,
        head: title ? `The AI is reading “${title}”` : `The AI is reading the new ideas`,
        sub: 'Finding the pain points, capabilities and systems in its challenge, current process and outcomes.',
      };
    }
    if (item.type === 'export') return { who, step: s.id, secs, head: 'The AI is getting ready to read the new ideas', sub: 'One idea at a time; each one lands in the universe as it is read.' };
    const idea = item.triage?.ideaId && ideaTitle ? ideaTitle(item.triage.ideaId) : '';
    return { who, step: s.id, secs, head: 'The AI is reading this file', sub: `Working out what it says${idea ? ` about “${idea}”` : ''}, and which facts and stars it holds.` };
  }
  if (s.id === 'read' && who === 'ai') return { who, step: s.id, secs, head: 'The AI is looking at the picture', sub: 'Writing out every line of text it can see, then saying in two sentences what it shows.' };
  const [head, sub] = APP_NOW[s.id];
  return { who, step: s.id, secs, head, sub };
}
/** The CSS suffix of a step's dot. */
export const stepGlyph = (s: StepStatus | 'todo') => ({ running: 'run', done: 'ok', skipped: 'skip', 'needs-you': 'you', failed: 'bad', todo: 'todo' } as const)[s];

/** Is any step of this item still running? */
export const isRunning = (i: Pick<InboxItemView, 'steps'>) => !!i.steps?.some((s) => s.status === 'running');

/** Poll the Import only while some item has a step running. */
export const shouldPoll = (v: { items: { steps?: Step[] }[] } | null | undefined) => !!v?.items.some((i) => i.steps?.some((s) => s.status === 'running'));

/** Waits on the operator: a step that needs them, or a held proposal. Held files and dismissed items are counted apart. */
export const needsYou = (i: Pick<InboxItemView, 'steps' | 'actions' | 'status'>) =>
  i.status !== 'dismissed' && i.status !== 'held'
  && (!!i.steps?.some((s) => s.status === 'needs-you') || (i.actions ?? []).some((a) => a.status === 'pending' && !!a.held));

/** Shown in the middle zone: running, needs you, or a held file waiting for a reply or a delete. */
export const inFlight = (i: InboxItemView) => isRunning(i) || needsYou(i) || i.status === 'held';

/** Has any step or action of this item failed? */
export const hasFailed = (i: Pick<InboxItemView, 'steps' | 'actions'>) =>
  !!i.steps?.some((s) => s.status === 'failed') || (i.actions ?? []).some((a) => a.status === 'failed');

export type Chip = 'all' | 'needs-you' | 'held' | 'done' | 'failed' | 'dismissed' | 'picture';
export const CHIPS: { id: Chip; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'needs-you', label: 'Needs you' }, { id: 'held', label: 'Held' },
  { id: 'done', label: 'Done' }, { id: 'failed', label: 'Failed' }, { id: 'dismissed', label: 'Dismissed' }, { id: 'picture', label: 'Pictures' },
];

/** The history filter: a chip, then a search over the file name, the idea's id and title, and the headline. */
export function filterItems(items: InboxItemView[], chip: Chip, q: string, ideaTitle?: (id: string) => string): InboxItemView[] {
  const byChip = items.filter((i) => chip === 'all' ? true
    : chip === 'needs-you' ? needsYou(i)
    : chip === 'held' ? i.status === 'held'
    : chip === 'done' ? i.status === 'applied'
    : chip === 'failed' ? hasFailed(i)
    : chip === 'picture' ? isPicture(i)
    : i.status === 'dismissed');
  const k = q.trim().toLowerCase();
  const title = (i: InboxItemView) => (i.triage?.ideaId && ideaTitle ? ideaTitle(i.triage.ideaId) : '');
  return k ? byChip.filter((i) => `${i.name} ${i.triage?.ideaId ?? ''} ${title(i)} ${itemHeadline(i)}`.toLowerCase().includes(k)) : byChip;
}

/** Items newest first, grouped by day: Today, Yesterday, then dates. */
export function groupByDay(items: InboxItemView[], now = new Date()): { label: string; items: InboxItemView[] }[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const label = (iso: string) => {
    const d = localDate(iso);
    if (!d) return iso || 'Undated';
    const k = dayKey(d);
    return k === today ? 'Today' : k === yesterday ? 'Yesterday' : dayOf(iso);
  };
  const at = (i: InboxItemView) => localDate(i.receivedAt ?? '')?.getTime() ?? 0;
  const out: { label: string; items: InboxItemView[] }[] = [];
  for (const i of [...items].sort((a, b) => at(b) - at(a))) {
    const l = label(i.receivedAt ?? '');
    const g = out.at(-1); if (g && g.label === l) g.items.push(i); else out.push({ label: l, items: [i] });
  }
  return out;
}

/** The one-line result of an item: step 8's detail, else the hold reason, else the last step's detail. */
export function resultLine(i: Pick<InboxItemView, 'steps' | 'status' | 'hold'>): string {
  const check = i.steps?.find((s) => s.id === 'check');
  if (check?.status === 'done' || check?.status === 'needs-you') return check.detail;
  if (i.status === 'held' && i.hold?.reasons?.length) return i.hold.reasons[0];
  return i.steps?.at(-1)?.detail ?? '';
}

/** The status chip of a history row. */
export function statusWord(i: InboxItemView): { word: string; tone: 'run' | 'you' | 'held' | 'bad' | 'ok' | 'off' } {
  if (i.status === 'dismissed') return { word: 'Dismissed', tone: 'off' };
  if (isRunning(i)) return { word: 'Running', tone: 'run' };
  if (i.status === 'held') return { word: 'Held', tone: 'held' };
  if (needsYou(i)) return { word: 'Needs you', tone: 'you' };
  if (hasFailed(i)) return { word: 'Failed', tone: 'bad' };
  return { word: 'Done', tone: 'ok' };
}

/** The operator acted on this item: applied or undid a proposal that waited for them, or picked the idea. */
export const byYou = (i: Pick<InboxItemView, 'actions'>) =>
  (i.actions ?? []).some((a) => (a.kind === 'ok' && a.status === 'applied') || a.status === 'undone');

/** A time of day in local time, e.g. 09:41; empty for a bare date or anything unreadable. */
export const timeOf = (iso: string | undefined) => {
  if (!iso || !/T/.test(iso)) return '';
  const d = localDate(iso);
  return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
};

export interface HeldChoice { label: string; kind: 'apply' | 'drop'; resolve?: 'use-existing' | 'take-file' }
/** The choices offered for a held proposal, per conflict rule. */
export function heldChoices(h: Held): HeldChoice[] {
  switch (h.rule) {
    case 'near-duplicate-star': return [{ label: 'Use the existing star', kind: 'apply', resolve: 'use-existing' }, { label: 'Keep both', kind: 'apply', resolve: 'take-file' }, { label: 'No', kind: 'drop' }];
    case 'contradicts-fact': return [{ label: "Keep the form's value", kind: 'drop' }, { label: "Take the file's value", kind: 'apply', resolve: 'take-file' }];
    // People come from the form only: a person is never added as a star.
    case 'person-star': return [{ label: 'No', kind: 'drop' }];
    default: return [{ label: 'Yes', kind: 'apply' }, { label: 'No', kind: 'drop' }];
  }
}

/** The rule that held a proposal, as a short tag. */
export const RULE_WORDS: Record<string, string> = {
  'contradicts-fact': 'Contradiction', 'person-star': 'A person', 'near-duplicate-star': 'Looks the same', 'low-confidence': 'Not sure',
  'two-ideas': 'Two ideas', 'duplicate-idea': 'Duplicate idea', screened: 'Screened',
};

/**
 * The finished card's one line: what the AI did and what the universe gained, then whether anything waits.
 * "AI: Read all 7 new ideas · Universe: 30 stars and 41 links from the form; 15 links added · Done"
 */
export function summaryLine(item: Pick<InboxItemView, 'steps'>): string | null {
  const st = (id: StepId) => item.steps?.find((x) => x.id === id);
  if (!item.steps?.length || item.steps.some((x) => x.status === 'running')) return null;
  const u = st('understand'); const g = st('graph'); const c = st('check');
  const parts: string[] = [];
  if (u && u.status !== 'skipped' && u.detail) parts.push(`AI: ${u.detail}`);
  if (g && g.status === 'done' && g.detail) parts.push(`Universe: ${g.detail}`);
  if (c?.detail) parts.push(c.detail);
  return parts.length ? parts.join(' · ') : null;
}
