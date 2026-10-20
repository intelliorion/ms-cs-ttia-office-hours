// Pure helpers for the title-bar pop-outs. No React here, so they test in node.
import UNBLOCK from './unblock.json';

export interface ImportReport {
  created: { id: string; title: string }[];
  duplicates: { row: number; id: string; title: string }[];
  errors: { row: number; message: string }[];
  flags: { id: string; message: string }[];
  ignoredColumns: string[];
}
export interface ReportLine { kind: 'ok' | 'skip' | 'error' | 'note' | 'flag'; text: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The import report in plain words, one line each. */
export function importReportLines(r: ImportReport): ReportLine[] {
  const lines: ReportLine[] = [];
  lines.push({ kind: 'ok', text: r.created.length ? `${plural(r.created.length, 'new idea')} added` : 'No new ideas added' });
  for (const c of r.created) lines.push({ kind: 'ok', text: `${c.id}: ${c.title || 'Untitled idea'}` });
  if (r.duplicates.length) lines.push({ kind: 'skip', text: `${plural(r.duplicates.length, 'row')} skipped because ${r.duplicates.length === 1 ? 'it is' : 'they are'} already in the Café` });
  for (const d of r.duplicates) lines.push({ kind: 'skip', text: `Row ${d.row} skipped: already ${d.id}${d.title ? ` (${d.title})` : ''}` });
  if (r.errors.length) lines.push({ kind: 'error', text: `${plural(r.errors.length, 'row')} could not be read` });
  for (const e of r.errors) lines.push({ kind: 'error', text: `Row ${e.row} not read: ${e.message}` });
  if (r.ignoredColumns.length) lines.push({ kind: 'note', text: `${plural(r.ignoredColumns.length, 'column')} not used: ${r.ignoredColumns.join(', ')}` });
  for (const f of r.flags) lines.push({ kind: 'flag', text: `${f.id}: ${f.message}` });
  return lines;
}

/** Which emails each field is needed for, and a hint for fields no email uses yet. Table lives in unblock.json; a server test checks it against the templates. */
export function roundFieldsUnblock(field: string): string {
  const u = (UNBLOCK as Record<string, { emails: string[] | 'all'; hint?: string }>)[field];
  if (!u) return '';
  if (u.emails === 'all') return 'Needed for every email';
  return u.emails.length ? `Needed for ${u.emails.join(', ')}` : u.hint ?? '';
}

/** Outbox items grouped for the pop-out, newest first inside each group. */
export function groupOutbox<T extends { status: string; created?: string }>(items: T[]) {
  const byNew = (a: T, b: T) => String(b.created ?? '').localeCompare(String(a.created ?? ''));
  const pick = (s: string) => items.filter((m) => m.status === s).sort(byNew);
  return { draft: pick('draft'), approved: pick('approved'), sent: pick('sent') };
}

/** Last part of a path, so notices never show where the app keeps things. */
export const baseName = (p: string) => String(p).split(/[\\/]/).filter(Boolean).pop() ?? '';

/** Unsent emails: drafts and approved ones. */
export const unsentCount = (outbox: { status: string }[] | undefined) => (outbox ?? []).filter((m) => m.status !== 'sent').length;

/** The title bar's subtitle: the round and today's date. */
export const titleSub = (state: { today?: string; round?: { id?: string } } | null | undefined): string =>
  ['Operator console', state?.round?.id, state?.today].filter(Boolean).join(' · ');
