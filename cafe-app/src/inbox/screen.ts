import { listIdeas } from '../ideas/store';
import { PERSON_NAME, type InboxMeta, type ParsedDrop } from './parse';

/** Personal-data screen. Code rules only, no AI: anything it flags is held and never read further. */

export interface ScreenMeta extends Pick<InboxMeta, 'from' | 'to' | 'cc' | 'attachments'> {
  fileName?: string;
  /** Submitter and team names across every idea; mentioning them is fine. */
  knownParticipants?: string[];
}

export interface ScreenResult {
  hold: boolean;
  reasons: string[];
}

const ROLE_MAILBOXES = /^(no-?reply|do-?not-?reply|info|admin|support|help|helpdesk|team|cafe|office|enquiries|contact|service|mailbox|postmaster|notifications?)$/i;
const SENSITIVE: [RegExp, string][] = [
  [/\bsalar(y|ies)\b/i, 'salary'],
  [/\bpassports?\b/i, 'passport'],
  [/\bdate of birth\b|\bD\.?O\.?B\b/i, 'date of birth'],
  [/\bnational insurance (number|no)\b/i, 'national insurance number'],
  [/\bsocial security (number|no)\b/i, 'social security number'],
];
const NAME_HEADER = /^(full |first |last )?name$|^(employee|staff|client|customer)( name)?$/i;
const TRACKER_FILE = /tracker|roster|register|headcount/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ADDRESS_HEADER = /^\s*(?:>\s*)*(From|To|Cc|Bcc|Reply-To|Sent|Subject|Date):/i;
// Shapes that look like phone numbers but are not: dates, times, date-times, dotted quads (IP addresses, versions)
const NOT_PHONES = [
  /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/g,
];

/** Text with the addresses on quoted From/To/Cc header lines (and their wrapped continuations) removed. */
function withoutAddressHeaders(lines: string[]): string {
  let inHeader = false;
  return lines
    .map((l) => {
      const m = l.match(ADDRESS_HEADER);
      if (m) inHeader = /^(From|To|Cc|Bcc|Reply-To)$/i.test(m[1]);
      else if (!/^\s/.test(l) || !l.trim()) inHeader = false;
      return inHeader ? l.replace(EMAIL, ' ') : l;
    })
    .join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const distinct = (xs: string[]) => [...new Set(xs)];

function cellsOf(line: string): { delim: string; cells: string[] } | undefined {
  for (const delim of ['\t', '|', ',']) {
    if (!line.includes(delim)) continue;
    let cells = line.split(delim).map((c) => c.trim().replace(/^"(.*)"$/, '$1'));
    if (delim === '|') cells = cells.filter((c, i) => c !== '' || (i > 0 && i < cells.length - 1));
    if (cells.length >= 2) return { delim, cells };
  }
  return undefined;
}

function nameTable(lines: string[], known: Set<string>): { rows: number; clients: boolean } | undefined {
  let best: { rows: number; clients: boolean } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const head = cellsOf(lines[i]);
    const col = head?.cells.findIndex((c) => NAME_HEADER.test(c)) ?? -1;
    if (!head || col < 0) continue;
    let rows = 0;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[\s|:+-]+$/.test(lines[j]) && lines[j].includes('-')) continue; // markdown separator row
      const row = cellsOf(lines[j]);
      if (!row || row.delim !== head.delim) break;
      const name = row.cells[col] ?? '';
      if (name && !known.has(norm(name))) rows++;
    }
    const clients = /client|customer/i.test(head.cells[col]);
    if (!best || rows > best.rows) best = { rows, clients };
  }
  return best;
}

export function screen(text: string, meta: ScreenMeta = {}): ScreenResult {
  const reasons: string[] = [];
  const known = new Set((meta.knownParticipants ?? []).map(norm));
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const headerAddrs = new Set(
    [meta.from, ...(meta.to ?? []), ...(meta.cc ?? [])].join(' ').toLowerCase().match(/[\w.%+-]+@[\w.-]+/g) ?? [],
  );
  const emails = distinct((withoutAddressHeaders(lines).match(EMAIL) ?? []).map((e) => e.toLowerCase())).filter((e) => {
    const local = e.split('@')[0];
    return !headerAddrs.has(e) && !ROLE_MAILBOXES.test(local) && !known.has(norm(local));
  });
  if (emails.length >= 5) reasons.push(`Has ${emails.length} personal email addresses`);

  const table = nameTable(lines, known);
  if (table && table.rows >= 3) reasons.push(`Lists ${table.rows} ${table.clients ? 'clients' : 'people'} by name`);

  const ids = distinct(text.match(/\b[A-Z]{1,3}\d{5,}\b/g) ?? []);
  if (ids.length >= 3) reasons.push(`Has ${ids.length} employee or ID numbers`);

  const phoneText = NOT_PHONES.reduce((t, re) => t.replace(re, ' ; '), text);
  const phones = distinct(
    (phoneText.match(/(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,5}\)[ .-]?)?\d{2,5}(?:[ .-]\d{2,5}){1,4}(?![\w])/g) ?? [])
      .map((p) => p.replace(/\D/g, ''))
      .filter((d) => d.length >= 9 && d.length <= 15),
  );
  if (phones.length >= 3) reasons.push(`Has ${phones.length} phone numbers`);

  const words = SENSITIVE.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (words.length) reasons.push(`Mentions ${words.join(', ')}`);

  const fileNames = [meta.fileName ?? '', ...(meta.attachments ?? [])];
  if (fileNames.some((n) => TRACKER_FILE.test(n))) {
    const names = lines.map((l) => (cellsOf(l)?.cells[0] ?? l).trim()).filter((c) => PERSON_NAME.test(c) && !known.has(norm(c)));
    if (names.length >= 10) reasons.push(`Looks like a tracker with ${names.length} names in it`);
  }

  return { hold: reasons.length > 0, reasons };
}

/** Screen a parsed drop: unreadable files are held; exports are screened on their raw text. */
export function screenDrop(name: string, parsed: ParsedDrop, knownParticipants: string[]): ScreenResult {
  if (parsed.unreadable) return { hold: true, reasons: [parsed.unreadable] };
  const text = [parsed.screenText ?? parsed.text, parsed.meta.quoted ?? ''].filter(Boolean).join('\n');
  return screen(text, { ...parsed.meta, fileName: name, knownParticipants });
}

/** Every submitter and team member name across ideas, in first-seen order. */
export async function knownParticipants(root: string): Promise<string[]> {
  const { ideas } = await listIdeas(root);
  const names = ideas.flatMap((i) => [i.people.submitter ?? '', ...i.people.team.map((p) => p.name)]).map((n) => n.trim()).filter(Boolean);
  return distinct(names);
}
