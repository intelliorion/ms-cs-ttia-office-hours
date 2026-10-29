/** What GET /api/memory returns: the model, the job and what has been read. */
export type DeepReadStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export interface DeepReadDecision { act: 'read' | 'skip' | 'queue' | 'defer'; ideas: string[]; why: string; at: string }
export interface DeepReadJob {
  status: DeepReadStatus; embedder?: string; done: number; total: number; startedAt?: string;
  lastRun?: { at: string; ms: number; chunks: number; ideas: number }; error?: string;
  /** What upkeep last decided, and why. */
  lastDecision?: DeepReadDecision;
}
export type IdeaStatus = 'read' | 'stale' | 'new';
export interface DeepReadIdea {
  id: string; title: string; chunks: number; embedded: number; status: IdeaStatus;
  kinds: Record<string, { chunks: number; embedded: number }>;
  lastRead?: string;
}
export interface DeepReadUpkeep { on: boolean; pending: number; waiting: boolean; /** What start-up decided. */ startup?: DeepReadDecision | Omit<DeepReadDecision, 'at'> }
export interface DeepReadSummary {
  chunks: number; embedded: number; percent: number;
  kinds: Record<string, { chunks: number; embedded: number }>;
  ideas: DeepReadIdea[]; available: boolean; otherModel?: string;
}
export interface DeepReadModel {
  id: string; dir: string; cached: boolean;
  /** CAFE_MODEL_OFFLINE: no host is ever contacted. */
  offline?: boolean;
  /** The firm mirror's base URL, when one is set. */
  mirror?: string;
  /** Where the files came from, when recorded: hub, mirror or import. */
  source?: 'hub' | 'mirror' | 'import';
  /** The model is not here and cannot be downloaded: the one message naming the three ways in. */
  help?: string;
}
export interface DeepReadView { model: DeepReadModel; job: DeepReadJob; summary: DeepReadSummary; upkeep: DeepReadUpkeep }

/** The ring's share, 0..1: what the job has done while it runs, else what the summary says is read. */
export function ringShare(v: DeepReadView | null): number {
  if (!v) return 0;
  if (v.job.status === 'running' && v.job.total > 0) return Math.min(1, v.job.done / v.job.total);
  return Math.min(1, v.summary.percent / 100);
}
/** The percentage beside the title-bar button: none until something has been read. */
export function ringLabel(v: DeepReadView | null): string {
  if (!v) return '';
  if (v.job.status === 'running') return `${Math.floor(ringShare(v) * 100)}%`;
  return v.summary.available ? `${v.summary.percent}%` : '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "26 Oct 14:02" from an ISO time, in this browser's zone. */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
}
/** "48 s", "3 min 05 s", "under a second". */
export function tookText(ms: number): string {
  if (ms < 1000) return 'under a second';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** The one line under the ring: what the job is doing, or when it last read and how long it took. */
export function statusLine(v: DeepReadView): string {
  const { job, summary } = v;
  if (summary.otherModel) return `Read with another model (${summary.otherModel}). Rerun all to read with this one.`;
  switch (job.status) {
    case 'running': return job.total ? `Reading ${job.done} of ${job.total} passages…` : 'Reading…';
    case 'paused': return `Paused at ${job.done} of ${job.total}`;
    case 'error': return v.model.help && job.error === v.model.help ? 'Could not start: the model is not on this machine (see below)' : `Could not finish: ${job.error ?? 'unknown error'}`;
    default: {
      const changed = summary.ideas.filter((i) => i.status !== 'read').length;
      const since = changed ? ` · ${changed} idea${changed === 1 ? '' : 's'} changed since` : '';
      if (!job.lastRun) {
        // Read by upkeep alone: it arms itself once the model is here, so a workspace can be read with no Run pressed.
        if (summary.available && job.lastDecision?.act === 'read') return `Kept current on its own · last read ${whenText(job.lastDecision.at)}${since}`;
        if (!summary.chunks) return 'Nothing to read yet: import some ideas first';
        return v.model.cached ? 'Not read yet' : v.model.help ? 'Not read yet: the model is not on this machine (see below)' : 'Not read yet: press Run once to download the model';
      }
      return `Read ${whenText(job.lastRun.at)} in ${tookText(job.lastRun.ms)}${since}`;
    }
  }
}

export type DeepReadButton = 'run' | 'pause' | 'continue' | 'rerun';
/** The controls for the state: Run · Pause · Continue · Rerun all. Never a Yes/No. */
export function buttonsFor(v: DeepReadView): { id: DeepReadButton; label: string; primary?: boolean; disabled?: boolean }[] {
  const { job, summary } = v;
  if (job.status === 'running') return [{ id: 'pause', label: 'Pause' }];
  if (summary.otherModel) return [{ id: 'rerun', label: 'Rerun all', primary: true }];
  if (job.status === 'paused') return [{ id: 'continue', label: 'Continue', primary: true }, { id: 'rerun', label: 'Rerun all' }];
  const nothing = summary.chunks === 0;
  const upToDate = summary.available && summary.percent === 100;
  const run = { id: 'run' as const, label: summary.available ? 'Read what changed' : 'Run', primary: !upToDate, disabled: nothing || upToDate };
  return summary.available || job.status === 'error' ? [run, { id: 'rerun', label: 'Rerun all', disabled: nothing }] : [run];
}

export const KIND_LABELS: [string, string][] = [['submission', 'Submissions'], ['email', 'Emails'], ['design', 'Designs'], ['review', 'Reviews'], ['roadshow', 'Roadshows'], ['other', 'Notes, hand-offs, history']];
/** "Submissions 12 of 12" per kind, only the kinds the workspace has. */
export function kindCounts(summary: DeepReadSummary): { label: string; embedded: number; chunks: number }[] {
  return KIND_LABELS.map(([k, label]) => ({ label, ...(summary.kinds[k] ?? { chunks: 0, embedded: 0 }) })).filter((x) => x.chunks > 0);
}

export const IDEA_STATUS: Record<DeepReadIdea['status'], string> = { read: 'read', stale: 'changed since', new: 'not yet' };

/** The short blocks the pop-out shows: what it is for, in the app's voice. */
export const COPY: { title: string; text: string }[] = [
  { title: 'Why', text: 'The universe holds names: ideas, people, capabilities, systems. Everything long (the challenge, the emails, the answers, the design, the review, the roadshow) stays in each idea\'s folder, unread. Deep read reads it once and keeps a map of what it says.' },
  { title: 'Without it', text: 'The assistant answers from the stars alone: labels, not what people wrote. "What did teams say about data access" finds nothing. Ideas and capabilities that mean the same thing in different words stay apart, and twins pile up.' },
  { title: 'What it reads', text: 'Submissions (challenge, process, impact, context, the team\'s answers), the emails sent and filed, the review and its to-do list, the design and the approach, the roadshow script, the CSIC hand-off and the history.' },
  { title: 'Stays here', text: 'Everything stays on this machine. A small reading model (about 23 MB) is downloaded once, on the first Run; after that nothing goes out. No text is sent anywhere, and people\'s names are coded before any AI sees a passage, exactly as today.' },
  { title: 'When it is on', text: 'The assistant can search what people wrote and say which passage it read. The ideas search finds by meaning when the words differ. A star the AI proposes is matched to one you already have before a twin is made. It is a reading index, not understanding: the app works the same without it.' },
];

/* ---------- The dashboard: where things stand ---------- */

export interface Dashboard {
  total: number; read: number; stale: number; new: number;
  /** Each group's share of the ideas, whole percentages that add up to 100 (0 with no ideas). */
  shares: Record<IdeaStatus, number>;
  /** Passages still to read, and their share of all passages. */
  toGo: number; toGoPercent: number;
}
const STATUS_ORDER: IdeaStatus[] = ['new', 'stale', 'read'];

export function dashboard(summary: DeepReadSummary): Dashboard {
  const counts: Record<IdeaStatus, number> = { read: 0, stale: 0, new: 0 };
  for (const i of summary.ideas) counts[i.status]++;
  const total = summary.ideas.length;
  const shares: Record<IdeaStatus, number> = { read: 0, stale: 0, new: 0 };
  if (total) {
    for (const k of STATUS_ORDER) shares[k] = Math.floor((counts[k] / total) * 100);
    // The floors fall short of 100: the largest group takes the remainder (the first of equals).
    const left = 100 - shares.read - shares.stale - shares.new;
    const biggest = (['read', 'stale', 'new'] as IdeaStatus[]).reduce((b, k) => (counts[k] > counts[b] ? k : b));
    shares[biggest] += left;
  }
  const toGo = Math.max(0, summary.chunks - summary.embedded);
  return { total, read: counts.read, stale: counts.stale, new: counts.new, shares, toGo, toGoPercent: summary.chunks ? Math.ceil((toGo / summary.chunks) * 100) : 0 };
}

/** Not yet first, then changed since, then read; by ID within a group. */
export function sortIdeas(ideas: DeepReadIdea[]): DeepReadIdea[] {
  return [...ideas].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.id.localeCompare(b.id));
}
export type IdeaFilter = 'all' | IdeaStatus;
export const FILTERS: { id: IdeaFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'new', label: 'Not yet' }, { id: 'stale', label: 'Changed since' }, { id: 'read', label: 'Read' }];
/** The rows for a chip and a search (ID or title), in dashboard order. */
export function filterIdeas(ideas: DeepReadIdea[], filter: IdeaFilter, q: string): DeepReadIdea[] {
  const t = q.trim().toLowerCase();
  return sortIdeas(ideas).filter((i) => (filter === 'all' || i.status === filter) && (!t || i.id.toLowerCase().includes(t) || i.title.toLowerCase().includes(t)));
}
const KIND_WORDS: Record<string, string> = { submission: 'submission', email: 'emails', design: 'design', review: 'review', roadshow: 'roadshow', other: 'notes' };
/** "emails, design": the kinds of an idea with passages still to read. */
export function staleKinds(idea: DeepReadIdea): string {
  return Object.keys(KIND_WORDS).filter((k) => { const c = idea.kinds[k]; return c && c.embedded < c.chunks; }).map((k) => KIND_WORDS[k]).join(', ');
}
/** The by-kind bars: read ÷ present per kind, only the kinds the workspace has. */
export const kindBars = kindCounts;

const ACT_WORDS: Record<DeepReadDecision['act'], string> = { read: '', skip: 'skipped, ', queue: 'queued, ', defer: 'deferred, ' };
/** "Last: read 2026-003 after Import · 3 passages · 26 Oct 14:02", "Last: skipped, nothing changed in 2026-003 · 26 Oct 14:02". */
export function decisionLine(d: DeepReadDecision | undefined): string {
  if (!d) return '';
  return `Last: ${ACT_WORDS[d.act]}${d.why} · ${whenText(d.at)}`;
}
/** The title-bar dot: something is changed since or not yet, once there is an index. */
export function attention(v: DeepReadView | null): boolean {
  return !!v && v.summary.available && v.summary.ideas.some((i) => i.status !== 'read');
}
export const toRead = (v: DeepReadView | null): number => (v ? v.summary.ideas.filter((i) => i.status !== 'read').length : 0);

export const KEEPS_CURRENT = 'Deep read keeps itself current once the model is on this machine: at start-up and after an Import or a save it reads only what is new or changed in the ideas that changed, never the whole workspace, never while you have it paused, and it never downloads the model itself (your first Run does). When nothing changed it does nothing, and says so.';
export const MODEL_MISSING_LINE = 'The model is not on this machine yet: press Run once to download it. After that Deep read keeps itself current.';
/** The footer's word on where the model comes from. */
export function modelLine(m: DeepReadModel): string {
  if (m.id === 'fake') return ' (the test stub: nothing is downloaded)';
  if (m.cached) return m.source === 'import' ? ', on this machine (imported)' : m.source === 'mirror' ? ', on this machine (from the firm mirror)' : ', on this machine';
  if (m.offline) return ', not on this machine (downloads are off)';
  return m.mirror ? `, downloaded on the first Run from ${m.mirror}` : ', downloaded on the first Run';
}
