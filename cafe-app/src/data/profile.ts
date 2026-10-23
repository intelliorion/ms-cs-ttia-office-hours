/**
 * The Data step's Profile, in code (no AI): for a table, each column's type, how full it is, distinct values, the range
 * of numbers and dates, the commonest values of a low-cardinality column, the shape of its values and a few example rows;
 * plus what the code sees wrong (empty columns, repeated ids, mixed values). For a document: its length, headings and
 * tables. Every value shown is masked first (maskText, the people's names, and whole flagged columns), so the profile is
 * what the AI and the page may see. `lookAt` is the closer look the AI may ask for before it answers.
 */
import type { ColType, ColumnProfile, DocProfile, FindingKind, TableProfile } from './model';
import { maskNames, maskText } from './check';
import type { ReadResult, ReadTable } from './read';

const NUMBER = /^[-+]?\(?[$£€]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\)?%?$/;
const CURRENCY = /[$£€]/;
const MONEY_HEADER = /(amount|cost|price|total|value|fee|spend|charge|gbp|usd|eur|net|gross|vat|tax)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DMY_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/;
const YES_NO = new Set(['y', 'n', 'yes', 'no', 'true', 'false', 't', 'f']);
const ID_HEADER = /(^|[\s_-])(id|ref|reference|number|no|key|code)$/i;
export const CATEGORY_MAX = 25;
const TOP_MAX = 8;
const EXAMPLES = 3;

const num = (v: string) => Number(v.replace(/[$£€,%\s()]/g, '').replace(/^\+/, ''));
/** The shape of a value: letters as A, digits as 9, the rest kept ("CLM-0042" → "AAA-9999"). */
export const shapeOf = (v: string) => v.replace(/[A-Za-z]/g, 'A').replace(/\d/g, '9').slice(0, 24);

/** The text any value is shown as: masked for email, phone, card, bank and the known names. */
export const showValue = (v: string, known: string[]) => maskNames(maskText(v), known).slice(0, 80);

function typeOfColumn(header: string, filled: string[], distinct: number): ColType {
  if (!filled.length) return 'empty';
  const share = (test: (v: string) => boolean) => filled.filter(test).length / filled.length;
  if (share((v) => DATETIME.test(v)) >= 0.9) return 'datetime';
  if (share((v) => ISO_DATE.test(v) || DMY_DATE.test(v)) >= 0.9) return 'date';
  if (share((v) => YES_NO.has(v.toLowerCase())) >= 0.95 && distinct <= 4) return 'yes-no';
  if (share((v) => NUMBER.test(v)) >= 0.9) {
    if (ID_HEADER.test(header) && distinct >= filled.length * 0.9) return 'id';
    if (share((v) => /^[01]$/.test(v)) === 1 && /^(is|has|flag)/i.test(header)) return 'yes-no';
    return filled.some((v) => CURRENCY.test(v)) || MONEY_HEADER.test(header) ? 'money' : 'number';
  }
  if (distinct >= filled.length * 0.95 && filled.length >= 3 && share((v) => /\d/.test(v) && v.length <= 24 && !/\s{2,}/.test(v)) >= 0.9) return 'id';
  if (ID_HEADER.test(header) && distinct >= filled.length * 0.9) return 'id';
  if (distinct <= CATEGORY_MAX && distinct < Math.max(3, filled.length * 0.6)) return 'category';
  return 'text';
}

const dateKey = (v: string) => {
  if (ISO_DATE.test(v) || DATETIME.test(v)) return v.slice(0, 16);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (!m) return v;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
};

function counts(values: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function profileColumn(name: string, values: string[], rows: number, masked: FindingKind | undefined, known: string[]): { col: ColumnProfile; issues: string[] } {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  const freq = counts(filled);
  const distinct = freq.length;
  const emptyPct = rows ? Math.round(((rows - filled.length) / rows) * 100) : 0;
  const issues: string[] = [];
  if (masked) {
    return { col: { name, type: 'masked', filled: filled.length, emptyPct, distinct, masked }, issues };
  }
  const type = typeOfColumn(name, filled, distinct);
  const col: ColumnProfile = { name, type, filled: filled.length, emptyPct, distinct };
  if (type === 'number' || type === 'money') {
    const nums = filled.filter((v) => NUMBER.test(v)).map(num).filter(Number.isFinite);
    if (nums.length) {
      col.min = String(Math.min(...nums)); col.max = String(Math.max(...nums));
      col.mean = Math.round((nums.reduce((s, x) => s + x, 0) / nums.length) * 100) / 100;
    }
    const odd = filled.length - nums.length;
    if (odd) issues.push(`${name}: ${odd} value${odd === 1 ? ' is' : 's are'} not a number`);
  }
  if (type === 'date' || type === 'datetime') {
    const keys = filled.map(dateKey).sort();
    col.min = keys[0]; col.max = keys[keys.length - 1];
  }
  if (type === 'category' || type === 'yes-no') col.top = freq.slice(0, TOP_MAX).map(([value, count]) => ({ value: showValue(value, known), count }));
  if (type === 'id' || type === 'text' || type === 'category') {
    const shapes = counts(filled.map(shapeOf));
    if (shapes[0] && shapes[0][1] >= filled.length * 0.8 && type !== 'text') col.pattern = shapes[0][0];
  }
  if (type === 'id' && distinct < filled.length) issues.push(`${name}: ${filled.length - distinct} repeated value${filled.length - distinct === 1 ? '' : 's'}`);
  if (emptyPct >= 20 && filled.length) issues.push(`${name}: ${emptyPct}% empty`);
  if (!filled.length) issues.push(`${name}: empty in every row`);
  return { col, issues };
}

/** One table's profile. `masked` maps a flagged column to what the check found in it. */
export function profileTable(t: ReadTable, masked: Map<string, FindingKind>, known: string[]): TableProfile {
  const columns: ColumnProfile[] = []; const issues: string[] = [];
  t.header.forEach((h, i) => {
    const r = profileColumn(h, t.rows.map((row) => row[i] ?? ''), t.rows.length, masked.get(h), known);
    columns.push(r.col); issues.push(...r.issues);
  });
  const examples = t.rows.slice(0, EXAMPLES).map((row) => t.header.map((h, i) => {
    const kind = masked.get(h);
    return kind ? `<${kind}>` : showValue(row[i] ?? '', known);
  }));
  const dup = t.rows.length - new Set(t.rows.map((r) => r.join('\u0001'))).size;
  if (dup > 0) issues.push(`${dup} row${dup === 1 ? ' is' : 's are'} an exact repeat of another`);
  return { name: t.name, rows: t.total, columns, examples, issues: issues.slice(0, 12) };
}

const HEADING = /^(#{1,4}\s+\S.*|\d{1,2}(\.\d{1,2})*[.)]?\s+[A-Z].{2,70}|[A-Z][A-Za-z0-9 ,&/'()-]{2,70}:?)$/;

export function profileDoc(r: ReadResult): DocProfile {
  const text = r.text ?? '';
  const lines = text.split('\n');
  const headings = lines.map((l) => l.trim()).filter((l) => l && l.length <= 72 && HEADING.test(l) && !/[.,;]$/.test(l) && l.split(/\s+/).length <= 10)
    .map((l) => l.replace(/^#+\s*/, '')).slice(0, 20);
  // A table in a document: three or more lines in a row with the same number (2+) of tabs or pipes.
  let tables = 0; let run = 0; let last = -1;
  for (const l of lines) {
    const cells = (l.match(/\t|\|/g) ?? []).length;
    if (cells >= 2 && cells === last) { run++; if (run === 2) tables++; } else run = 0;
    last = cells;
  }
  return {
    chars: text.length, words: text.split(/\s+/).filter(Boolean).length, lines: lines.filter((l) => l.trim()).length, headings, tables,
    ...(r.meta.pages ? { pages: r.meta.pages } : {}), ...(r.meta.subject ? { subject: maskText(r.meta.subject) } : {}),
    ...(r.meta.attachments?.length ? { attachments: r.meta.attachments.slice(0, 10) } : {}), ...(r.meta.readBy ? { readBy: r.meta.readBy } : {}),
  };
}

/** What the AI may see of a document: masked, the known names masked, cut to `max` characters on a line. */
export function docExcerpt(text: string, known: string[], max = 12_000): string {
  const m = maskNames(maskText(text), known);
  if (m.length <= max) return m;
  const cut = m.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf('\n'), max - 200))}\n…(cut: ${m.length - max} more characters)`;
}

export interface LookResult { column: string; table: string; values: { value: string; count: number }[]; shapes: { shape: string; count: number }[]; lengths: [number, number]; note?: string }

/** A closer look at one column, for the AI: its commonest values (up to 30) and value shapes, masked. */
export function lookAt(t: ReadTable, column: string, masked: FindingKind | undefined, known: string[]): LookResult | undefined {
  const i = t.header.findIndex((h) => h.toLowerCase() === column.trim().toLowerCase());
  if (i < 0) return undefined;
  const name = t.header[i];
  if (masked) return { column: name, table: t.name, values: [], shapes: [], lengths: [0, 0], note: `Masked: it holds ${masked}; its values are never shown` };
  const filled = t.rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
  const lens = filled.map((v) => v.length);
  return {
    column: name, table: t.name,
    values: counts(filled).slice(0, 30).map(([value, count]) => ({ value: showValue(value, known), count })),
    shapes: counts(filled.map(shapeOf)).slice(0, 5).map(([shape, count]) => ({ shape, count })),
    lengths: [lens.length ? Math.min(...lens) : 0, lens.length ? Math.max(...lens) : 0],
  };
}
