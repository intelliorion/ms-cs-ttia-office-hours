/**
 * The kit's sample-data.csv, made in code from the AI's column list, its few example rows and the seeded test groups:
 * the example rows repeated (ids numbered, dates moved by whole weeks so a weekday stays a weekday), then each seeded
 * group as many times as the design says. Synthetic only: a person column holds "Person 1", "Person 2"; never more
 * than SAMPLE_ROWS_MAX rows.
 */
import type { KitColumnKind, KitSample } from '../ai/tasks';

export const SAMPLE_FILE = 'sample-data.csv';
/** The column that marks a seeded test row (T1, T2 … as in test-checklist.md); empty on an ordinary row. */
export const TEST_COLUMN = 'test_case';
export const SAMPLE_ROWS_MAX = 200;
/** How many ordinary rows the example rows make, when they are records (an id or a date column). */
export const ORDINARY_ROWS = 24;

export interface SampleTable { columns: { name: string; kind: KitColumnKind; about: string }[]; rows: string[][]; seeded: { code: string; label: string; count: number; expect: string }[] }

const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A column name a spreadsheet and a Dataiku dataset both take: letters, digits and underscores. */
export const columnName = (name: string) => one(name, 40).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'column';

/** A cell for a CSV: one line, quoted when it must be, and never read as a formula by a spreadsheet. */
export function csvCell(v: string): string {
  let s = one(v, 80);
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A YYYY-MM-DD date moved by whole weeks (a weekday stays the same weekday); anything else as it is. */
export function shiftWeeks(value: string, weeks: number): string {
  const m = ISO.exec(value.trim());
  if (!m || !weeks) return value;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) return value;
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 10);
}

/** The n-th id from an example id: its prefix and the number, as wide as the example's ("CLM-001" → "CLM-024"). */
export function nthId(example: string, n: number): string {
  const m = /^(.*?)(\d+)$/.exec(example.trim());
  if (!m) return `${example.trim() || 'R'}-${String(n).padStart(3, '0')}`;
  return `${m[1]}${String(n).padStart(m[2].length, '0')}`;
}

/** The rows as the AI gave them, fitted to the columns (padded or cut), with a person column made safe. */
function fit(row: string[], columns: SampleTable['columns'], n: number): string[] {
  return columns.map((c, i) => (c.kind === 'person' ? `Person ${((n - 1) % 5) + 1}` : one(row[i], 80)));
}

/** The table behind sample-data.csv: unique column names, ordinary rows, then the seeded groups (T1, T2 …), at most SAMPLE_ROWS_MAX rows. */
export function sampleTable(sample: KitSample): SampleTable {
  const seen = new Set<string>();
  const keep: number[] = [];
  const columns: SampleTable['columns'] = [];
  sample.columns.forEach((c, i) => {
    const name = columnName(c.name);
    if (seen.has(name.toLowerCase()) || name.toLowerCase() === TEST_COLUMN) return;
    seen.add(name.toLowerCase()); keep.push(i);
    columns.push({ name, kind: c.kind, about: one(c.about, 160) });
  });
  const pick = (row: string[]) => keep.map((i) => row[i] ?? '');
  const examples = sample.rows.map(pick).filter((r) => r.some((x) => one(x, 80)));
  // A group with its own rows (a duplicate pair, a split) is those rows, as they are; else its one row, `count` times.
  const groups = sample.seeded.map((g, i) => {
    const own = (g.rows ?? []).map(pick).filter((r) => r.some((x) => one(x, 80)));
    return { ...g, code: `T${i + 1}`, row: pick(g.row), own, count: own.length || g.count };
  });
  const seededRows = Math.min(groups.reduce((s, g) => s + g.count, 0), SAMPLE_ROWS_MAX - (examples.length ? 1 : 0));
  const idCols = columns.map((c, i) => (c.kind === 'id' ? i : -1)).filter((i) => i >= 0);
  const dateCols = columns.map((c, i) => (c.kind === 'date' ? i : -1)).filter((i) => i >= 0);
  // Records (an id or a date to tell them apart) are repeated up to ORDINARY_ROWS; a lookup table (hotel caps by
  // city) is kept as given, so no row is there twice.
  const repeat = idCols.length > 0 || dateCols.length > 0;
  const ordinary = !examples.length ? 0 : repeat ? Math.max(examples.length, Math.min(ORDINARY_ROWS, SAMPLE_ROWS_MAX - seededRows)) : Math.min(examples.length, SAMPLE_ROWS_MAX - seededRows);
  const rows: string[][] = [];
  const firstId = new Map(idCols.map((i) => [i, examples[0]?.[i] || groups[0]?.row[i] || 'R-001']));
  const add = (src: string[], weeks: number, code: string) => {
    const n = rows.length + 1;
    const r = fit(src, columns, n);
    for (const i of idCols) r[i] = nthId(firstId.get(i)!, n);
    for (const i of dateCols) r[i] = shiftWeeks(r[i], weeks);
    rows.push([...r, code]);
  };
  for (let k = 0; k < ordinary; k++) add(examples[k % examples.length], Math.floor(k / examples.length), '');
  const seeded: SampleTable['seeded'] = [];
  for (const g of groups) {
    const room = SAMPLE_ROWS_MAX - rows.length;
    const count = Math.min(g.count, room);
    if (count <= 0) break;
    // Copies of one row move by whole weeks (ten weekend claims on ten Saturdays); a group's own rows keep their dates.
    for (let k = 0; k < count; k++) { if (g.own.length) add(g.own[k], 0, g.code); else add(g.row, k, g.code); }
    seeded.push({ code: g.code, label: one(g.label, 100), count, expect: one(g.expect, 240) });
  }
  return { columns: [...columns, { name: TEST_COLUMN, kind: 'category', about: 'Empty on an ordinary row; T1, T2 … on a seeded test row (see test-checklist.md).' }], rows, seeded };
}

/** sample-data.csv itself. */
export const sampleCsv = (t: SampleTable): string => `${[t.columns.map((c) => csvCell(c.name)), ...t.rows.map((r) => r.map(csvCell))].map((r) => r.join(',')).join('\n')}\n`;
