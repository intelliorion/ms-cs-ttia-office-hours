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
import { DATA_EXTS, dataMaxBytes, type DataFile } from './model';
import { cfbKind, isZip, zipNames } from './ooxml';
import { DeckError, readPptx, type DeckMeta } from './pptx';

export class DataError extends Error {}

export interface ReadTable { name: string; header: string[]; rows: string[][]; total: number }
export interface ReadResult {
  type: DataFile['type'];
  tables?: ReadTable[];
  text?: string;
  meta: Pick<InboxMeta, 'pages' | 'subject' | 'from' | 'to' | 'cc' | 'attachments' | 'readBy' | 'words'>;
  /** Why it cannot be read at all (a protected PDF, a picture with no AI). */
  unreadable?: string;
  /** A PowerPoint deck: what was found on its slides. Its tables and charts are in `tables`, its slides' text in `text`. */
  deck?: DeckMeta;
  /** What the reader noticed but read anyway (a deck read as plain text). */
  problems?: string[];
}

/** Rows read from one table; the rest are counted, not read. */
export const ROWS_READ_MAX = 50_000;
export const SHEETS_MAX = 5;
export const COLUMNS_MAX = 80;

export const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
const ONLY = `Drop a ${DATA_EXTS.map((e) => `.${e}`).join(', ')} file`;

const PASSWORD = (what: string) => `This ${what} is protected with a password: open it, remove the password (File > Info > Protect), save it and drop it again`;
const OLD_OFFICE: Record<string, string> = {
  xls: 'Old .xls workbooks are not read: save it as .xlsx and drop it again',
  ppt: 'Old .ppt presentations are not read: open it in PowerPoint, save it as .pptx (File > Save As > PowerPoint Presentation) and drop it again',
  doc: 'Old .doc documents are not read: open it in Word, save it as .docx and drop it again',
};
/** What each Office format must hold in its zip: the part only that format has. */
const OOXML_PART: Record<string, { part: string; what: string }> = {
  pptx: { part: 'ppt/presentation.xml', what: 'presentation' }, docx: { part: 'word/document.xml', what: 'document' }, xlsx: { part: 'xl/workbook.xml', what: 'workbook' },
};

/**
 * Name, size, then the contents: a file that is not what its name says is refused before it is read further. An
 * Office file is told apart by what is inside it: a zip holding its own main part (a .pptx has ppt/presentation.xml),
 * a password-protected one (an encrypted package in an OLE container), or an old binary one renamed.
 */
export function checkDataFile(name: string, bytes: Uint8Array): string {
  const ext = extOf(name);
  if (!(DATA_EXTS as readonly string[]).includes(ext)) {
    if (OLD_OFFICE[ext]) throw new DataError(OLD_OFFICE[ext]);
    throw new DataError(`Can't read a .${ext || '(no extension)'} file. ${ONLY}`);
  }
  if (!bytes.length) throw new DataError('That file is empty');
  const max = dataMaxBytes(ext);
  if (bytes.length > max) throw new DataError(`That file is over ${max / 1048576} MB: ${ext === 'pptx' ? 'compress its pictures (File > Compress Pictures) or drop a smaller copy' : 'drop a smaller sample'}`);
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => bytes[i + k] === x);
  const office = OOXML_PART[ext];
  if (office) {
    const cfb = cfbKind(bytes);
    if (cfb === 'encrypted') throw new DataError(PASSWORD(office.what));
    if (cfb === 'ppt' || cfb === 'doc' || cfb === 'xls') throw new DataError(`${OLD_OFFICE[cfb].replace(/ are not read:/, ' renamed .' + ext + ' are not read:')}`);
    if (!isZip(bytes)) throw new DataError(`That file is not a real .${ext}: its contents do not match its name`);
    // The .pptx is sniffed by its parts, not only its first bytes (a zip of anything starts the same way).
    if (ext === 'pptx') {
      const names = zipNames(bytes);
      if (!names) throw new DataError('That .pptx is damaged: it could not be opened. Open it in PowerPoint, save it again and drop it again');
      if (!names.includes(office.part)) {
        const other = Object.entries(OOXML_PART).find(([, o]) => names.includes(o.part));
        throw new DataError(other ? `That file is a ${other[1].what} (.${other[0]}), not a presentation: rename it .${other[0]}` : 'That file is not a real .pptx: it has no slides in it');
      }
    }
    return ext;
  }
  const ok = ext === 'pdf' ? at(0, 0x25, 0x50, 0x44, 0x46)
    : ext === 'msg' ? at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
      : ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? Boolean(imageKind(bytes))
        // Text files: no NUL byte at the start (a binary file renamed .csv is not read).
        : !bytes.subarray(0, 8192).includes(0);
  if (!ok) throw new DataError(`That file is not a real .${ext}: its contents do not match its name`);
  return ext;
}

const typeOf = (ext: string): DataFile['type'] => (['csv', 'tsv', 'xlsx'].includes(ext) ? 'table' : ext === 'pptx' ? 'presentation'
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
  if (ext === 'pptx') {
    let deck: ReturnType<typeof readPptx>;
    try { deck = readPptx(bytes); } catch (e) { return { type, meta: {}, unreadable: e instanceof DeckError ? e.message : `Couldn't open this presentation (${(e as Error).message})` }; }
    if (!deck.text.replace(/^## Slide \d+.*$/gm, '').trim() && !deck.tables.length) {
      return { type, meta: {}, deck: deck.meta, unreadable: `No text, table or chart found on any slide${deck.meta.hidden ? ` (${deck.meta.hidden} hidden slide${deck.meta.hidden === 1 ? ' was' : 's were'} skipped)` : ''}` };
    }
    return { type, ...(deck.tables.length ? { tables: deck.tables } : {}), text: deck.text, meta: {}, deck: deck.meta, ...(deck.problems.length ? { problems: deck.problems } : {}) };
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
