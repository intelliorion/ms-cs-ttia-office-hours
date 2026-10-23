/**
 * "Understand the data": the design's data section, as stored in design.yaml (DesignState.data). Pure (no files), so
 * the server, design.md and the UI read it the same way. The dropped files' copies live in the idea folder's
 * data-files/; what is kept here is what the app made of them: the kind the operator picked, the step cards, the
 * personal-data check, the profile (code), the AI's understanding (checked against the profile), the operator's
 * corrections, the data questions and the one confirmation that makes it final.
 */

/** What a dropped file is, as the operator says in its drop-down. */
export const DATA_KINDS = ['input', 'output', 'today', 'rules', 'process', 'email', 'other'] as const;
export type DataKind = (typeof DATA_KINDS)[number];
export const KIND_LABELS: Record<DataKind, string> = {
  input: 'Sample input',
  output: 'Sample output (what it should produce)',
  today: "Today's output or report",
  rules: 'Rules or reference',
  process: 'Process document',
  email: 'Example email',
  other: 'Other',
};
/** One short line on each kind, for the drop-down's tooltip and the AI. */
export const KIND_HINTS: Record<DataKind, string> = {
  input: 'What the proof of concept reads: an export, a list, a form',
  output: 'What it should produce: the result as the team wants it',
  today: 'The report or result made by hand today',
  rules: 'A rules sheet, policy, lookup table or reference list',
  process: 'How the work is done today, written down',
  email: 'A request or message of the kind it handles',
  other: 'Anything else that helps',
};
/** The kind a file most likely is, from its name and type: the drop-down starts there; the operator decides. */
export function guessKind(name: string): DataKind {
  const n = name.toLowerCase();
  const ext = (/\.([a-z0-9]+)$/.exec(n)?.[1] ?? '');
  if (ext === 'eml' || ext === 'msg') return 'email';
  if (/rule|polic|lookup|mapping|reference|limits?|caps?\b|thresholds?/.test(n)) return 'rules';
  if (/today|current|manual|as[-_ ]is|report/.test(n)) return 'today';
  if (/output|result|expected|flagged|target|to[-_ ]be/.test(n)) return 'output';
  if (/process|procedure|how[-_ ]to|guide|sop|steps/.test(n)) return 'process';
  if (['csv', 'tsv', 'xlsx'].includes(ext)) return 'input';
  if (['pdf', 'docx', 'txt', 'md'].includes(ext)) return 'process';
  return 'other';
}

export const isDataKind = (k: unknown): k is DataKind => typeof k === 'string' && (DATA_KINDS as readonly string[]).includes(k);

/** The file types the Data step reads. */
export const DATA_EXTS = ['csv', 'tsv', 'xlsx', 'pdf', 'docx', 'txt', 'md', 'eml', 'msg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export const DATA_MAX_BYTES = 10 * 1024 * 1024;
export const DATA_FILES_MAX = 12;
/** The idea folder's sub-folder holding the copies. */
export const DATA_DIR = 'data-files';

export type DataStepId = 'read' | 'check' | 'profile' | 'understand' | 'saved';
export const DATA_STEP_ORDER: DataStepId[] = ['read', 'check', 'profile', 'understand', 'saved'];
export const DATA_STEP_WORDS: Record<DataStepId, string> = { read: 'Read', check: 'Check', profile: 'Profile', understand: 'Understand', saved: 'Saved' };
export type DataStepStatus = 'running' | 'done' | 'skipped' | 'needs-you' | 'failed';
export interface DataStepCard { id: DataStepId; status: DataStepStatus; detail: string; ms?: number }

export type ColType = 'id' | 'number' | 'money' | 'date' | 'datetime' | 'yes-no' | 'category' | 'text' | 'empty' | 'masked';
export interface ColumnProfile {
  name: string;
  type: ColType;
  /** Cells with a value, and the share left empty (0–100). */
  filled: number;
  emptyPct: number;
  distinct: number;
  min?: string;
  max?: string;
  mean?: number;
  /** The commonest values (low-cardinality columns only), masked. */
  top?: { value: string; count: number }[];
  /** The shape most values have ("AAA-9999"). */
  pattern?: string;
  /** Set when the check found personal data in it: what kind. Its values never reach the AI or the page. */
  masked?: FindingKind;
}
export interface TableProfile { name: string; rows: number; columns: ColumnProfile[]; examples: string[][]; issues: string[] }
export interface DocProfile { chars: number; words: number; lines: number; headings: string[]; tables: number; pages?: number; subject?: string; attachments?: string[]; readBy?: 'ai' }

export type FindingKind = 'email' | 'phone' | 'name' | 'id' | 'card' | 'bank' | 'sensitive';
export const FINDING_WORDS: Record<FindingKind, string> = {
  email: 'email addresses', phone: 'phone numbers', name: "people's names", id: 'employee or account numbers', card: 'card numbers', bank: 'bank account numbers', sensitive: 'sensitive personal details',
};
export interface Finding { kind: FindingKind; column?: string; count: number; why: string }
export interface DataCheck {
  /** clear: nothing found. held: found something, waiting for the operator. released: the operator said it is masked or synthetic. */
  status: 'clear' | 'held' | 'released';
  findings: Finding[];
  /** Columns whose values are masked in everything the AI sees (and on the page). */
  masked: string[];
  /** What the check noticed but did not hold for ("employee_id looks masked"). */
  notes: string[];
  releasedAt?: string;
}

export const COLUMN_ROLES = ['key', 'input', 'rule', 'output', 'date', 'amount', 'category', 'text', 'person', 'other'] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];
export interface ColumnMeaning { name: string; table?: string; meaning: string; role?: ColumnRole; codes?: string }
export interface DataUnderstanding {
  what: string;
  /** The kind the AI thinks the file is, when it differs from the operator's (a hint only). */
  kindHint?: DataKind;
  columns: ColumnMeaning[];
  /** For a document: the key facts it holds. */
  points: string[];
  rules: { rule: string; columns: string[] }[];
  /** For a sample output or today's output: how each output column derives from the input. */
  derivations: { output: string; from: string[]; how: string }[];
  /** The features it serves, by their names in the feature list. */
  serves: string[];
  issues: string[];
  missing: string[];
  /** Columns the AI asked to look at more closely before it answered. */
  looked: string[];
  /** What the code dropped from the AI's reply (a column not in the file). */
  dropped?: string[];
  at: string;
  provider?: string;
}
/** The operator's corrections: they win over the AI's words and survive "Understand again". */
export interface DataEdits { what?: string; columns?: Record<string, string>; at: string }

export interface DataFile {
  id: string;
  name: string;
  /** The copy's name inside data-files/. */
  file: string;
  kind: DataKind;
  bytes: number;
  type: 'table' | 'document' | 'email' | 'picture';
  at: string;
  steps: DataStepCard[];
  check?: DataCheck;
  tables?: TableProfile[];
  doc?: DocProfile;
  understanding?: DataUnderstanding;
  edits?: DataEdits;
  /** The kind changed after it was understood: Understand again. */
  stale?: true;
  /** Why it could not be read at all. */
  unreadable?: string;
}

export const DATA_TOPICS = ['input', 'output', 'knowledge', 'rules', 'volumes', 'codes', 'other'] as const;
export type DataTopic = (typeof DATA_TOPICS)[number];
export const TOPIC_WORDS: Record<DataTopic, string> = {
  input: 'The input', output: 'The output', knowledge: 'Reference and knowledge', rules: 'The rules', volumes: 'Volumes', codes: 'Columns and codes', other: 'Other',
};
export interface DataQuestion {
  n: number;
  question: string;
  why?: string;
  suggested: string[];
  topic?: DataTopic;
  source: 'operator' | 'e2' | 'ai-suggested';
  answer?: string;
  askedTeam?: { emailKey: string };
}
export interface DataSummary {
  text: string;
  input: string;
  output: string;
  knowledge: string;
  rules: string;
  gapsClosed: string[];
  /** What the code still sees open when the AI said complete (asked the team, or never asked). */
  open: string[];
  at: string;
  provider?: string;
}
/** What the data answers changed in the record by themselves (no Yes/No): shown read-only, logged in history. */
export interface DataApplied { at: string; kind: string; label: string; key: string }

export interface DataState {
  files: DataFile[];
  steps: DataQuestion[];
  /** The AI said the understanding is complete. */
  summary?: DataSummary;
  /** The operator's one confirmation ("Looks right"): only then is the data final and fed forward. */
  confirmedAt?: string;
  /** The design points the confirmed data settles (input-shape, output, logic), written at confirmation. */
  points?: Partial<Record<'input-shape' | 'output' | 'logic', string>>;
  applied?: DataApplied[];
  /** Gaps the team's earlier answers settle (the AI names them, the code checks the words are in that answer). */
  settled?: DataSettled[];
}

/** A topic an earlier answer on the idea settles: the answer's words, the question it answered and where it came from. */
export interface DataSettled { topic: DataTopic; answer: string; question: string; source?: string }

export const emptyData = (): DataState => ({ files: [], steps: [] });

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A stored data section made safe (older or hand-edited design.yaml); undefined when there is nothing in it. */
export function dataOf(raw: unknown): DataState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Partial<DataState>;
  const files = arr<DataFile>(r.files).filter((f) => f && typeof f.id === 'string' && typeof f.file === 'string').map((f) => ({
    ...f, kind: isDataKind(f.kind) ? f.kind : 'other' as DataKind, steps: arr<DataStepCard>(f.steps), name: str(f.name) || f.file,
  }));
  const steps = arr<DataQuestion>(r.steps).filter((s) => s && Number.isInteger(s.n) && typeof s.question === 'string').map((s) => ({ ...s, suggested: arr<string>(s.suggested) }));
  if (!files.length && !steps.length && !r.summary && !r.applied?.length) return undefined;
  return {
    files, steps,
    ...(r.summary && typeof r.summary === 'object' ? { summary: { ...r.summary, gapsClosed: arr<string>(r.summary.gapsClosed), open: arr<string>(r.summary.open) } } : {}),
    ...(r.confirmedAt ? { confirmedAt: String(r.confirmedAt) } : {}),
    ...(r.points && typeof r.points === 'object' ? { points: r.points } : {}),
    ...(r.applied?.length ? { applied: arr<DataApplied>(r.applied) } : {}),
    ...(r.settled?.length ? { settled: arr<DataSettled>(r.settled).filter((x) => x && typeof x.answer === 'string' && typeof x.topic === 'string') } : {}),
  };
}

/** The meaning of a column as shown: the operator's correction, else the AI's. */
export function meaningOf(f: Pick<DataFile, 'understanding' | 'edits'>, column: string): string | undefined {
  const own = f.edits?.columns?.[column];
  if (own?.trim()) return own.trim();
  return f.understanding?.columns.find((c) => c.name === column)?.meaning;
}
/** The one line on what the file is, as shown: the operator's, else the AI's. */
export const whatOf = (f: Pick<DataFile, 'understanding' | 'edits'>): string | undefined => f.edits?.what?.trim() || f.understanding?.what;

/** Every column of a file, across its tables, in order. */
export const columnsOf = (f: Pick<DataFile, 'tables'>): (ColumnProfile & { table: string })[] =>
  (f.tables ?? []).flatMap((t) => t.columns.map((c) => ({ ...c, table: t.name })));

/** Whether a file is done enough to count: read, not held, profiled. */
export const isUsable = (f: DataFile) => !f.unreadable && f.check?.status !== 'held' && Boolean(f.tables?.length || f.doc);

/** Whether the data is confirmed and so final (fed to the features, the tool, the design, the kits and the roadshow). */
export const isConfirmed = (d: DataState | undefined): d is DataState & { confirmedAt: string } => Boolean(d?.confirmedAt);

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "1,000 rows, 12 columns" or "3 pages, 820 words". */
export function sizeWords(f: Pick<DataFile, 'tables' | 'doc'>): string {
  if (f.tables?.length) {
    const rows = f.tables.reduce((n, t) => n + t.rows, 0);
    const cols = f.tables.reduce((n, t) => n + t.columns.length, 0);
    return `${f.tables.length > 1 ? `${plural(f.tables.length, 'sheet')}, ` : ''}${plural(rows, 'row')}, ${plural(cols, 'column')}`;
  }
  if (f.doc) return [f.doc.pages ? plural(f.doc.pages, 'page') : '', plural(f.doc.words, 'word')].filter(Boolean).join(', ');
  return '';
}

/**
 * The design points the confirmed data settles, in code: the input (each sample input's columns and rows), the output
 * (the sample output's columns, else today's) and the logic (the rules the understanding found). Never invented: a
 * point the data does not hold is left out.
 */
export function dataPoints(d: DataState): Partial<Record<'input-shape' | 'output' | 'logic', string>> {
  const usable = d.files.filter(isUsable);
  const cols = (f: DataFile) => columnsOf(f).filter((c) => c.type !== 'empty').map((c) => c.name);
  const list = (xs: string[], max = 14) => `${xs.slice(0, max).join(', ')}${xs.length > max ? ` and ${xs.length - max} more` : ''}`;
  const out: Partial<Record<'input-shape' | 'output' | 'logic', string>> = {};
  const inputs = usable.filter((f) => f.kind === 'input' && f.tables?.length);
  if (inputs.length) {
    out['input-shape'] = inputs.map((f) => {
      const masked = (f.check?.masked ?? []).length ? `; masked: ${list(f.check!.masked, 6)}` : '';
      return `${f.name} (${sizeWords(f)}): ${list(cols(f))}${masked}`;
    }).join('. ').slice(0, 300);
  }
  const output = usable.find((f) => f.kind === 'output' && f.tables?.length) ?? usable.find((f) => f.kind === 'today' && f.tables?.length);
  if (output) out.output = `Like ${output.name}: ${list(cols(output))}`.slice(0, 300);
  const rules = usable.flatMap((f) => f.understanding?.rules.map((r) => r.rule) ?? []);
  if (rules.length) out.logic = rules.slice(0, 4).map((r) => r.replace(/[.;\s]+$/, '')).join('; ').slice(0, 300);
  return out;
}
