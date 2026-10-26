/** What GET /api/memory returns: the model, the job and what has been read. */
export type DeepReadStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';
export interface DeepReadJob {
  status: DeepReadStatus; embedder?: string; done: number; total: number; startedAt?: string;
  lastRun?: { at: string; ms: number; chunks: number; ideas: number }; error?: string;
}
export interface DeepReadIdea { id: string; title: string; chunks: number; embedded: number; status: 'read' | 'stale' | 'new' }
export interface DeepReadSummary {
  chunks: number; embedded: number; percent: number;
  kinds: Record<string, { chunks: number; embedded: number }>;
  ideas: DeepReadIdea[]; available: boolean; otherModel?: string;
}
export interface DeepReadView { model: { id: string; dir: string; cached: boolean }; job: DeepReadJob; summary: DeepReadSummary }

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
    case 'error': return `Could not finish: ${job.error ?? 'unknown error'}`;
    default: {
      if (!job.lastRun) return summary.chunks ? 'Not read yet' : 'Nothing to read yet: import some ideas first';
      const changed = summary.ideas.filter((i) => i.status !== 'read').length;
      return `Read ${whenText(job.lastRun.at)} in ${tookText(job.lastRun.ms)}${changed ? ` · ${changed} idea${changed === 1 ? '' : 's'} changed since` : ''}`;
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
