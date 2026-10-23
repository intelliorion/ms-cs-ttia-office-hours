/**
 * The Data step's Read: a dropped file checked by name, size and first bytes before anything else is read, then read
 * by code with the Import's readers (email, Word, text, PDF; a picture or a scanned PDF by the AI looking at the copy)
 * and, for a spreadsheet or CSV, as tables: every sheet with its header row and its rows as text.
 */
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { parseDrop, type InboxMeta } from '../inbox/parse';
import { readPending } from '../inbox/triage';
import { imageKind } from '../roadshow/photos';
import type { Connector } from '../ai/connector';
import { DATA_EXTS, DATA_MAX_BYTES, type DataFile } from './model';

export class DataError extends Error {}

export interface ReadTable { name: string; header: string[]; rows: string[][]; total: number }
export interface ReadResult {
  type: DataFile['type'];
  tables?: ReadTable[];
  text?: string;
  meta: Pick<InboxMeta, 'pages' | 'subject' | 'from' | 'to' | 'cc' | 'attachments' | 'readBy' | 'words'>;
  /** Why it cannot be read at all (a protected PDF, a picture with no AI). */
  unreadable?: string;
}

/** Rows read from one table; the rest are counted, not read. */
export const ROWS_READ_MAX = 50_000;
export const SHEETS_MAX = 5;
export const COLUMNS_MAX = 80;

export const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
const ONLY = `Drop a ${DATA_EXTS.map((e) => `.${e}`).join(', ')} file`;

/** Name, size, then the first bytes: a file that is not what its name says is refused before it is read further. */
export function checkDataFile(name: string, bytes: Uint8Array): string {
  const ext = extOf(name);
  if (!(DATA_EXTS as readonly string[]).includes(ext)) {
    if (ext === 'xls') throw new DataError('Old .xls workbooks are not read: save it as .xlsx and drop it again');
    throw new DataError(`Can't read a .${ext || '(no extension)'} file. ${ONLY}`);
  }
  if (!bytes.length) throw new DataError('That file is empty');
  if (bytes.length > DATA_MAX_BYTES) throw new DataError('That file is over 10 MB: drop a smaller sample');
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => bytes[i + k] === x);
  const zip = at(0, 0x50, 0x4b, 0x03, 0x04);
  const ok = ext === 'xlsx' || ext === 'docx' ? zip
    : ext === 'pdf' ? at(0, 0x25, 0x50, 0x44, 0x46)
      : ext === 'msg' ? at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
        : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? Boolean(imageKind(bytes))
          // Text files: no NUL byte at the start (a binary file renamed .csv is not read).
          : !bytes.subarray(0, 8192).includes(0);
  if (!ok) throw new DataError(`That file is not a real .${ext}: its contents do not match its name`);
  return ext;
}

const typeOf = (ext: string): DataFile['type'] => (['csv', 'tsv', 'xlsx'].includes(ext) ? 'table'
  : ['eml', 'msg'].includes(ext) ? 'email' : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? 'picture' : 'document');
export { typeOf as dataTypeOf };

/** Header names made usable: trimmed, one line, never empty, never twice. */
export function cleanHeader(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.slice(0, COLUMNS_MAX).map((h, i) => {
    let name = String(h ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || `column_${i + 1}`;
    const k = name.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) name = `${name}_${n}`;
    return name;
  });
}

/** Rows to a table: the first row with two or more values is the header; empty rows are skipped. */
export function toTable(name: string, all: string[][]): ReadTable | undefined {
  const rows = all.map((r) => r.map((c) => String(c ?? '').trim()));
  const start = rows.findIndex((r) => r.filter(Boolean).length >= 2);
  if (start < 0) return undefined;
  const header = cleanHeader(rows[start]);
  const body = rows.slice(start + 1).filter((r) => r.some(Boolean));
  return { name, header, rows: body.slice(0, ROWS_READ_MAX).map((r) => header.map((_, i) => r[i] ?? '')), total: body.length };
}

/** The delimiter a CSV uses: the one that splits its first lines most evenly. */
export function delimiterOf(text: string, ext: string): string {
  if (ext === 'tsv') return '\t';
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  let best = ','; let score = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    if (min > score) { score = min; best = d; }
  }
  return best;
}

export function readCsv(name: string, text: string, ext = 'csv'): ReadTable[] {
  const records = parseCsv(text, { bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, delimiter: delimiterOf(text, ext) }) as string[][];
  const t = toTable('', records);
  return t ? [t] : [];
}

/** A cell as text: a date as YYYY-MM-DD (with the time when it has one), a formula as its result, rich text as its text. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  if (typeof v === 'object') {
    const o = v as { result?: ExcelJS.CellValue; richText?: { text: string }[]; text?: string; hyperlink?: string; error?: string };
    if ('result' in o) return cellText(o.result ?? null);
    if (o.richText) return o.richText.map((x) => x.text).join('');
    if (typeof o.text === 'string') return o.text;
    if (o.error) return '';
    return '';
  }
  return String(v);
}

export async function readXlsx(bytes: Uint8Array): Promise<ReadTable[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  const out: ReadTable[] = [];
  for (const ws of wb.worksheets) {
    if (out.length >= SHEETS_MAX) break;
    const all: string[][] = [];
    const width = Math.min(ws.columnCount, COLUMNS_MAX);
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (all.length > ROWS_READ_MAX + 50) return;
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
      all.push(cells);
    });
    const t = toTable(ws.name, all);
    if (t) out.push({ ...t, total: Math.max(t.total, ws.actualRowCount - 1) });
  }
  return out;
}

/**
 * Reads a dropped file (its copy is at `file`, for the AI to look at a picture). Spreadsheets and CSVs as tables;
 * everything else as text with what the Import's readers found (an email's subject and attachments, a PDF's pages).
 */
export async function readDataFile(file: string, name: string, bytes: Uint8Array, ai?: Connector | null, onStep?: (detail: string) => unknown): Promise<ReadResult> {
  const ext = checkDataFile(name, bytes);
  const type = typeOf(ext);
  if (ext === 'csv' || ext === 'tsv') {
    const text = new TextDecoder('utf-8').decode(bytes);
    const tables = readCsv(name, text, ext);
    return tables.length ? { type, tables, meta: {} } : { type, meta: {}, unreadable: 'No table found: the file needs a header row and at least one row' };
  }
  if (ext === 'xlsx') {
    let tables: ReadTable[];
    try { tables = await readXlsx(bytes); } catch (e) { return { type, meta: {}, unreadable: `Couldn't open this workbook (${(e as Error).message})` }; }
    return tables.length ? { type, tables, meta: {} } : { type, meta: {}, unreadable: 'No table found in any sheet: each needs a header row' };
  }
  const first = parseDrop(name, bytes);
  if (first.unreadable) return { type, meta: {}, unreadable: first.unreadable };
  const { parsed } = await readPending(file, first, bytes, ai, onStep);
  if (parsed.unreadable) return { type, meta: {}, unreadable: parsed.unreadable };
  if (parsed.problems?.length && !parsed.text.trim()) return { type, meta: {}, unreadable: parsed.problems[0] };
  const m = parsed.meta;
  const text = [parsed.text, m.quoted ? `\n(earlier message)\n${m.quoted}` : ''].join('').trim();
  if (!text) return { type, meta: {}, unreadable: 'There is no text in it to read' };
  return {
    type, text,
    meta: {
      ...(m.pages ? { pages: m.pages } : {}), ...(m.subject ? { subject: m.subject } : {}), ...(m.from ? { from: m.from } : {}),
      ...(m.to?.length ? { to: m.to } : {}), ...(m.cc?.length ? { cc: m.cc } : {}), ...(m.attachments?.length ? { attachments: m.attachments } : {}),
      ...(m.readBy ? { readBy: m.readBy } : {}),
    },
  };
}
