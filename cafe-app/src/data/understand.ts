/**
 * The agentic "understand the data" process, one dropped file at a time, shown as step cards:
 *   Read       the file by code (the Import's readers; a spreadsheet or CSV as tables)
 *   Check      the Café data rule in code: personal or client data holds the file for the operator
 *   Profile    each column (or the document) by code, masked
 *   Understand the AI, names coded, with the Café data guide; it may first ask to look closer at a few columns
 *              (bounded: two looks), then answers; the code keeps only what the profile holds
 *   Saved      into the design's data section (design.yaml and design.md)
 * The copy of the file goes into the idea folder's data-files/ only. Nothing is sent to the AI before the check passes
 * (or the operator says it is masked or synthetic), and flagged columns stay masked even then.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import type { Connector } from '../ai/connector';
import { dataUnderstandTask, type DataUnderstandInput, type DataUnderstandOutput } from '../ai/tasks';
import { appendHistory, writeFileAtomic } from '../workspace/files';
import { ideaDir, loadIdea } from '../ideas/store';
import { knownParticipants } from '../inbox/screen';
import { reviewInput, codeValue } from '../review/suggestInput';
import { showNames, type Coded } from '../command/names';
import { readDesign, skillGuidance } from '../design/store';
export { guessKind } from './model';
import {
  columnsOf, DATA_FILES_MAX, guessKind, isUsable, DATA_STEP_ORDER, isDataKind, KIND_HINTS, KIND_LABELS, LIVE_RUNS, sizeWords, whatOf,
  type DataFile, type DataKind, type DataStepCard, type DataStepId, type DataUnderstanding, type FindingKind,
} from './model';
import { checkDataFile, dataTypeOf, readDataFile, type ReadResult } from './read';
import { checkRead, heldWords } from './check';
import { docExcerpt, lookAt, profileDoc, profileTable, type LookResult } from './profile';
import { copyName, copyPath, dataFolder, DataStepError, fileOf, nextFileId, readData, removeCopy, reopenData, updateData } from './store';

export type DataProgress = (event: { file: DataFile }) => void;
export const DATA_SOURCE = 'data questions';
/** How many times the AI may ask to look closer before it must answer. */
export const LOOK_ROUNDS = 2;

const ms = (t0: number) => Date.now() - t0;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What Read found, in a few words. */
export function readWords(r: ReadResult): string {
  if (r.tables?.length) {
    const what = r.tables.length > 1 ? `Workbook, ${plural(r.tables.length, 'sheet')}` : 'Table';
    const rows = r.tables.reduce((n, t) => n + t.total, 0);
    const cols = r.tables.reduce((n, t) => n + t.header.length, 0);
    return `${what}: ${plural(rows, 'row')}, ${plural(cols, 'column')}`;
  }
  const words = (r.text ?? '').split(/\s+/).filter(Boolean).length;
  if (r.meta.readBy === 'ai') return `${r.meta.pages ? 'Scanned PDF' : 'Picture'} read by the AI: ${plural(words, 'word')}`;
  if (r.type === 'email') return `Email${r.meta.attachments?.length ? ` with ${plural(r.meta.attachments.length, 'attachment')}` : ''}: ${plural(words, 'word')}`;
  return `${r.meta.pages ? `PDF, ${plural(r.meta.pages, 'page')}` : 'Document'}: ${plural(words, 'word')}`;
}

/** What Profile found, in a few words ("12 columns: 2 dates, 3 amounts, 4 categories; 2 issues"). */
export function profileWords(f: Pick<DataFile, 'tables' | 'doc'>): string {
  if (f.tables?.length) {
    const cols = columnsOf(f);
    const n = (t: string[], word: string, many?: string) => { const k = cols.filter((c) => t.includes(c.type)).length; return k ? plural(k, word, many) : ''; };
    const kinds = [n(['date', 'datetime'], 'date'), n(['money'], 'amount'), n(['number'], 'number'), n(['category', 'yes-no'], 'category', 'categories'), n(['id'], 'id'), n(['text'], 'text column'), n(['masked'], 'masked column')].filter(Boolean);
    const issues = f.tables.reduce((k, t) => k + t.issues.length, 0);
    return `${plural(cols.length, 'column')}: ${kinds.join(', ')}${issues ? `; ${plural(issues, 'issue')} found` : '; no issues found'}`;
  }
  if (f.doc) return `${plural(f.doc.words, 'word')}, ${plural(f.doc.headings.length, 'heading')}${f.doc.tables ? `, ${plural(f.doc.tables, 'table')}` : ''}`;
  return '';
}

async function mark(root: string, id: string, fid: string, card: DataStepCard, progress?: DataProgress, extra?: (f: DataFile) => void): Promise<DataFile> {
  const { out } = await updateData(root, id, (data) => {
    const f = fileOf(data, fid);
    const i = f.steps.findIndex((s) => s.id === card.id);
    if (i >= 0) f.steps[i] = card; else f.steps.push(card);
    f.steps.sort((a, b) => DATA_STEP_ORDER.indexOf(a.id) - DATA_STEP_ORDER.indexOf(b.id));
    extra?.(f);
    return structuredClone(f);
  });
  progress?.({ file: out });
  return out;
}

async function skipFrom(root: string, id: string, fid: string, after: DataStepId, detail: string, progress?: DataProgress): Promise<void> {
  for (const sid of DATA_STEP_ORDER.slice(DATA_STEP_ORDER.indexOf(after) + 1)) await mark(root, id, fid, { id: sid, status: 'skipped', detail }, progress);
}

/**
 * A dropped file: checked by name, size and first bytes, copied into the idea folder's data-files/, then run through
 * the steps. The operator's kind is kept (a guess from the name when none is given).
 */
export async function dropDataFile(
  root: string, id: string, name: string, bytes: Uint8Array, kind: unknown, ai: Connector | null | undefined, clock: Clock, progress?: DataProgress,
): Promise<DataFile> {
  const clean = path.basename(name.replace(/\\/g, '/')).trim();
  if (!clean) throw new DataStepError('The file needs a name');
  const ext = checkDataFile(clean, bytes);
  const idea = await loadIdea(root, id);
  if (idea.closed) throw new DataStepError('This idea is closed');
  const { out: rec } = await updateData(root, id, (data) => {
    if (data.files.length >= DATA_FILES_MAX) throw new DataStepError(`At most ${DATA_FILES_MAX} files per idea: remove one first`);
    const fid = nextFileId(data);
    LIVE_RUNS.add(`${id}/${fid}`);
    const f: DataFile = {
      id: fid, name: clean, file: copyName(fid, clean), kind: isDataKind(kind) ? kind : guessKind(clean), bytes: bytes.length,
      type: dataTypeOf(ext), at: clock(), steps: [{ id: 'read', status: 'running', detail: 'Reading the file…' }],
    };
    data.files.push(f);
    // Not reopened yet: a file changes what the data holds only once it is read and saved (the end of runSteps). A
    // file held at the check, or one that could not be read, leaves the confirmed understanding as it was.
    return f;
  });
  try {
    await fs.mkdir(await dataFolder(root, id), { recursive: true });
    await writeFileAtomic(await copyPath(root, id, rec.file), bytes);
    await appendHistory(await ideaDir(root, id), { at: clock(), action: 'data', by: 'operator', detail: `Data dropped: ${clean} (${KIND_LABELS[rec.kind]})`, source: `data-files/${rec.file}` });
    progress?.({ file: rec });
  } catch (e) { LIVE_RUNS.delete(`${id}/${rec.id}`); throw e; }
  return runDataFile(root, id, rec.id, 'read', ai, clock, progress);
}

/**
 * Runs a file's steps from `from` on (read again each time; nothing it read is kept but the profile). A hold at the
 * check stops the run; Continue (releaseDataFile) runs it again from the profile.
 */
export async function runDataFile(
  root: string, id: string, fid: string, from: 'read' | 'profile' | 'understand', ai: Connector | null | undefined, clock: Clock, progress?: DataProgress,
): Promise<DataFile> {
  // While it runs, its "running" steps are this process's own (a restart shows them as stopped: settleInterrupted).
  LIVE_RUNS.add(`${id}/${fid}`);
  try { return await runSteps(root, id, fid, from, ai, clock, progress); } finally { LIVE_RUNS.delete(`${id}/${fid}`); }
}

async function runSteps(
  root: string, id: string, fid: string, from: 'read' | 'profile' | 'understand', ai: Connector | null | undefined, clock: Clock, progress?: DataProgress,
): Promise<DataFile> {
  const data0 = (await readData(root, id));
  let f = fileOf(data0, fid);
  const file = await copyPath(root, id, f.file);
  const bytes = new Uint8Array(await fs.readFile(file).catch(() => { throw new DataStepError('The copy of this file is gone: remove it and drop it again'); }));
  let t0 = Date.now();
  if (from === 'read') await mark(root, id, fid, { id: 'read', status: 'running', detail: 'Reading the file…' }, progress);
  let read: ReadResult;
  try {
    read = await readDataFile(file, f.name, bytes, ai, (detail) => from === 'read' && mark(root, id, fid, { id: 'read', status: 'running', detail }, progress));
  } catch (e) {
    await mark(root, id, fid, { id: 'read', status: 'failed', detail: (e as Error).message, ms: ms(t0) }, progress);
    await skipFrom(root, id, fid, 'read', 'not read');
    return fileOf((await readData(root, id)), fid);
  }
  if (read.unreadable) {
    f = await mark(root, id, fid, { id: 'read', status: 'needs-you', detail: read.unreadable, ms: ms(t0) }, progress, (x) => { x.unreadable = read.unreadable; });
    await skipFrom(root, id, fid, 'read', 'not read', progress);
    return fileOf((await readData(root, id)), fid);
  }
  if (from === 'read') await mark(root, id, fid, { id: 'read', status: 'done', detail: readWords(read), ms: ms(t0) }, progress, (x) => { delete x.unreadable; });
  const known = await knownParticipants(root);

  // Check: the Café data rule, in code. A file already released by the operator stays released.
  t0 = Date.now();
  if (from === 'read') {
    const found = checkRead(read, f.name, known);
    const before = f.check?.status === 'released' ? f.check : undefined;
    const check = before && found.status === 'held' ? { ...found, status: 'released' as const, releasedAt: before.releasedAt } : found;
    f = await mark(root, id, fid, check.status === 'held'
      ? { id: 'check', status: 'needs-you', detail: `Held: ${heldWords(check)}. Say it is masked or synthetic to go on, or remove it.`, ms: ms(t0) }
      : { id: 'check', status: 'done', detail: check.status === 'released' ? `Masked or synthetic, you said. ${check.masked.length ? `Kept masked for the AI: ${check.masked.join(', ')}` : 'Personal-looking values stay masked for the AI'}` : ['No personal data found', ...check.notes].join('. '), ms: ms(t0) },
    progress, (x) => { x.check = check; });
    if (check.status === 'held') {
      await skipFrom(root, id, fid, 'check', 'waiting: masked or synthetic?', progress);
      return fileOf((await readData(root, id)), fid);
    }
  }
  if (f.check?.status === 'held') throw new DataStepError('This file is held: say it is masked or synthetic first, or remove it');

  // Profile: by code, masked.
  t0 = Date.now();
  const masked = new Map<string, FindingKind>();
  for (const fd of f.check?.findings ?? []) if (fd.column) masked.set(fd.column.replace(/^.*?: /, ''), fd.kind);
  for (const c of f.check?.masked ?? []) if (!masked.has(c)) masked.set(c, 'sensitive');
  if (from !== 'understand') {
    await mark(root, id, fid, { id: 'profile', status: 'running', detail: 'Profiling…' }, progress);
    const tables = read.tables?.map((t) => profileTable(t, masked, known));
    const doc = read.tables?.length ? undefined : profileDoc(read);
    f = await mark(root, id, fid, { id: 'profile', status: 'done', detail: profileWords({ tables, doc }), ms: ms(t0) }, progress, (x) => {
      if (tables) { x.tables = tables; delete x.doc; } else { x.doc = doc; delete x.tables; }
    });
  }

  // Understand: the AI, names coded, with closer looks when it asks for them.
  t0 = Date.now();
  if (!ai) {
    await mark(root, id, fid, { id: 'understand', status: 'skipped', detail: 'No AI connected: write what it is and what the columns mean with Edit understanding' }, progress);
  } else {
    await mark(root, id, fid, { id: 'understand', status: 'running', detail: 'Asking the AI…' }, progress);
    try {
      const u = await understandWithAi(root, id, fid, read, masked, known, ai, clock, (detail) => mark(root, id, fid, { id: 'understand', status: 'running', detail }, progress));
      const looked = u.looked.length ? ` (looked closer at ${u.looked.join(', ')} first)` : '';
      const hint = u.kindHint ? ` It looks like ${KIND_LABELS[u.kindHint].toLowerCase()} to the AI.` : '';
      f = await mark(root, id, fid, { id: 'understand', status: 'done', detail: `${u.what}${looked}.${hint}`.replace(/\.\./g, '.'), ms: ms(t0) }, progress, (x) => { x.understanding = u; delete x.stale; });
    } catch (e) {
      await mark(root, id, fid, { id: 'understand', status: 'failed', detail: `The AI couldn't help (${(e as Error).message}): try Understand again, or write it with Edit understanding`, ms: ms(t0) }, progress);
    }
  }
  await mark(root, id, fid, { id: 'saved', status: 'done', detail: `Saved in the design; the copy is data-files/${f.file}` }, progress, () => undefined);
  const { data } = await updateData(root, id, (d) => reopenData(d, { summary: true }));
  return fileOf(data, fid);
}

/** The operator says a held file is masked or synthetic: it goes on from the profile, the flagged columns still masked. */
export async function releaseDataFile(root: string, id: string, fid: string, ai: Connector | null | undefined, clock: Clock, progress?: DataProgress): Promise<DataFile> {
  const { out: f } = await updateData(root, id, (data) => {
    const x = fileOf(data, fid);
    if (x.check?.status !== 'held') throw new DataStepError('This file is not held');
    x.check = { ...x.check, status: 'released', releasedAt: clock() };
    const i = x.steps.findIndex((s) => s.id === 'check');
    const card: DataStepCard = { id: 'check', status: 'done', detail: `Masked or synthetic, you said. ${x.check.masked.length ? `Kept masked for the AI: ${x.check.masked.join(', ')}` : 'Personal-looking values stay masked for the AI'}` };
    if (i >= 0) x.steps[i] = card; else x.steps.push(card);
    return structuredClone(x);
  });
  progress?.({ file: f });
  await appendHistory(await ideaDir(root, id), { at: clock(), action: 'data', by: 'operator', detail: `Data file said to be masked or synthetic: ${f.name} (${heldWords(f.check!)})`, source: `data-files/${f.file}` });
  return runDataFile(root, id, fid, 'profile', ai, clock, progress);
}

/**
 * Remove a file: its copy goes from the idea folder and its record from the design. The understanding is reopened when
 * the file was part of it (read and saved); a held or unreadable file never was, so the confirmation stays.
 */
export async function removeDataFile(root: string, id: string, fid: string, clock: Clock) {
  const { out: f, state } = await updateData(root, id, (data) => {
    const x = fileOf(data, fid);
    data.files = data.files.filter((y) => y.id !== fid);
    if (fedUnderstanding(x)) reopenData(data, { summary: true });
    return x;
  });
  await removeCopy(root, id, f.file);
  await appendHistory(await ideaDir(root, id), { at: clock(), action: 'data', by: 'operator', detail: `Data file removed: ${f.name}` });
  return state;
}

/** Whether a file is part of the understanding: it got past the check and was saved into the design. */
const fedUnderstanding = (f: DataFile) => f.check?.status !== 'held' && f.steps.some((s) => s.id === 'saved' && s.status === 'done');

/** The operator's kind for a file. A changed kind needs Understand again (the AI read it as the old one). */
export async function setDataKind(root: string, id: string, fid: string, kind: unknown) {
  if (!isDataKind(kind)) throw new DataStepError('Pick what kind of data it is');
  return (await updateData(root, id, (data) => {
    const f = fileOf(data, fid);
    if (f.kind === kind) return;
    f.kind = kind;
    if (f.understanding) f.stale = true;
    reopenData(data, { summary: true });
  })).state;
}

const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The operator's corrections (what it is, and column meanings): saved as theirs; the confirmation is needed again. */
export async function editDataFile(root: string, id: string, fid: string, body: { what?: unknown; columns?: unknown }, clock: Clock) {
  return (await updateData(root, id, (data) => {
    const f = fileOf(data, fid);
    const names = new Set(columnsOf(f).map((c) => c.name));
    const edits = { ...(f.edits ?? {}), at: clock() } as NonNullable<DataFile['edits']>;
    if (body.what !== undefined) { const w = one(body.what, 200); if (w) edits.what = w; else delete edits.what; }
    if (body.columns !== undefined) {
      if (!body.columns || typeof body.columns !== 'object' || Array.isArray(body.columns)) throw new DataStepError('Send the column meanings as name → meaning');
      const cols = { ...(edits.columns ?? {}) };
      for (const [k, v] of Object.entries(body.columns as Record<string, unknown>)) {
        if (!names.has(k)) throw new DataStepError(`There is no column ${k} in ${f.name}`);
        const m = one(v, 200);
        if (m) cols[k] = m; else delete cols[k];
      }
      if (Object.keys(cols).length) edits.columns = cols; else delete edits.columns;
    }
    f.edits = edits;
    reopenData(data);
  })).state;
}

/* ---------- the AI's part ---------- */

const decodeAll = <T>(v: T, codes: Map<string, Coded>): T => {
  const walk = (x: unknown): unknown => (typeof x === 'string' ? showNames(x, codes) : Array.isArray(x) ? x.map(walk)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x);
  return walk(v) as T;
};

/** The AI's reply kept to what the file holds: real columns only, rules and derivations on real columns, real features. */
export function checkUnderstanding(
  out: DataUnderstandOutput, f: Pick<DataFile, 'kind' | 'tables'>, otherColumns: string[], features: string[], at: string, provider: string, looked: string[],
): DataUnderstanding {
  const own = new Map(columnsOf(f).map((c) => [c.name.toLowerCase(), c]));
  const any = new Map([...otherColumns, ...own.values()].map((c) => (typeof c === 'string' ? [c.toLowerCase(), c] : [c.name.toLowerCase(), c.name])));
  const strip = (n: string) => n.trim().replace(/^[^:!.]{1,40}[:!.]\s*(?=\S)/, '');
  const find = <V>(m: Map<string, V>, n: string) => m.get(n.trim().toLowerCase()) ?? m.get(strip(n).toLowerCase());
  const dropped: string[] = [];
  const seen = new Set<string>();
  const columns: DataUnderstanding['columns'] = [];
  // A document or a picture has no profiled columns: a table the AI read in it (a report's columns) is one of its
  // facts, not a column the code drops as "not in the file".
  const docColumns = own.size ? [] : out.columns.map((c) => one(c.name, 40)).filter(Boolean);
  for (const c of own.size ? out.columns : []) {
    const hit = find(own, c.name);
    if (!hit) { dropped.push(c.name); continue; }
    const key = `${hit.table}\u0001${hit.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({ name: hit.name, ...(hit.table ? { table: hit.table } : {}), meaning: one(c.meaning, 200), ...(c.role ? { role: c.role } : {}), ...(c.codes?.trim() ? { codes: one(c.codes, 240) } : {}) });
  }
  const real = (xs: string[]) => [...new Set(xs.map((x) => find(any, x)).filter((x): x is string => !!x))];
  const feats = new Map(features.map((n) => [n.toLowerCase(), n]));
  const derivations = out.derivations.flatMap((d) => {
    const o = find(own, d.output);
    if (!o) { dropped.push(d.output); return []; }
    return [{ output: o.name, from: real(d.from), how: one(d.how, 240) }];
  });
  return {
    what: one(out.what, 200),
    ...(out.kindHint && out.kindHint !== f.kind ? { kindHint: out.kindHint } : {}),
    columns,
    points: [...out.points.map((p) => one(p, 200)).filter(Boolean), ...(docColumns.length ? [one(`Columns of the table in it: ${docColumns.join(', ')}`, 200)] : [])],
    rules: out.rules.map((r) => ({ rule: one(r.rule, 240), columns: real(r.columns) })).filter((r) => r.rule),
    derivations,
    serves: [...new Set(out.serves.map((s) => feats.get(s.trim().toLowerCase())).filter((x): x is string => !!x))],
    issues: out.issues.map((x) => one(x, 200)).filter(Boolean),
    missing: out.missing.map((x) => one(x, 200)).filter(Boolean),
    looked,
    ...(dropped.length ? { dropped: [...new Set(dropped)].slice(0, 20) } : {}),
    at, provider,
  };
}

async function understandWithAi(
  root: string, id: string, fid: string, read: ReadResult, masked: Map<string, FindingKind>, known: string[], ai: Connector, clock: Clock,
  onStep: (detail: string) => unknown,
): Promise<DataUnderstanding> {
  const state = await readDesign(root, id);
  const data = state.data ?? { files: [], steps: [] };
  const f = fileOf(data, fid);
  // The other files as far as they are known: a held or unreadable one says nothing yet.
  const others = data.files.filter((x) => x.id !== fid && isUsable(x));
  // The idea's text coded as the decision codes it; everything about the file coded with the same list.
  const { input: seen, codes } = await reviewInput(root, id);
  const features = state.features.map((x) => ({ name: x.name, ...(x.what ? { what: x.what } : {}) }));
  const fileView: DataUnderstandInput['file'] = {
    name: f.name, kind: KIND_LABELS[f.kind], kindHint: Object.entries(KIND_HINTS).map(([k, v]) => `${KIND_LABELS[k as DataKind]}: ${v}`).join('; '),
    type: f.type, size: sizeWords(f),
    ...(f.tables?.length ? {
      tables: f.tables.map((t) => ({
        name: t.name, rows: t.rows, examples: [t.columns.map((c) => c.name), ...t.examples], issues: t.issues,
        columns: t.columns.map(({ name, type, emptyPct, distinct, min, max, mean, top, pattern, masked: m }) => ({
          name, type, emptyPct, distinct, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(mean !== undefined ? { mean } : {}),
          ...(top ? { top } : {}), ...(pattern ? { pattern } : {}), ...(m ? { masked: m } : {}),
        })),
      })),
    } : {}),
    ...(f.doc ? { doc: { words: f.doc.words, headings: f.doc.headings, tables: f.doc.tables, ...(f.doc.pages ? { pages: f.doc.pages } : {}), ...(f.doc.subject ? { subject: f.doc.subject } : {}), ...(f.doc.attachments ? { attachments: f.doc.attachments } : {}), text: docExcerpt(read.text ?? '', known) } } : {}),
  };
  const base: Omit<DataUnderstandInput, 'looks' | 'lookAllowed'> = await codeValue(root, id, {
    idea: { ...seen.idea, business_impact: undefined },
    ...(features.length ? { features } : {}),
    file: fileView,
    ...(others.length ? { otherFiles: others.map((o) => ({ name: o.name, kind: KIND_LABELS[o.kind], ...(whatOf(o) ? { what: whatOf(o) } : {}), columns: columnsOf(o).map((c) => c.name) })) } : {}),
    ...(f.edits && (f.edits.what || f.edits.columns) ? { corrections: { ...(f.edits.what ? { what: f.edits.what } : {}), ...(f.edits.columns ? { columns: f.edits.columns } : {}) } } : {}),
    guidance: '',
  }, codes);
  base.guidance = skillGuidance('cafe-data');
  const looks: LookResult[] = [];
  const looked: string[] = [];
  for (let round = 0; ; round++) {
    const lookAllowed = round < LOOK_ROUNDS && Boolean(read.tables?.length);
    const { provider, output } = await ai.runWith(dataUnderstandTask, { ...base, lookAllowed, ...(looks.length ? { looks: await codeValue(root, id, looks, codes) } : {}) });
    const asks = lookAllowed ? output.look.map((l) => l.column) : [];
    const fresh = asks.flatMap((c) => {
      for (const t of read.tables ?? []) {
        const hit = lookAt(t, c, masked.get(t.header.find((h) => h.toLowerCase() === c.trim().toLowerCase()) ?? ''), known);
        if (hit && !looked.includes(hit.column)) return [hit];
      }
      return [];
    });
    if (fresh.length) {
      looks.push(...fresh); looked.push(...fresh.map((l) => l.column));
      await onStep(`Looking closer at ${fresh.map((l) => l.column).join(', ')}…`);
      continue;
    }
    const decoded = decodeAll(output, codes);
    const otherColumns = others.flatMap((o) => columnsOf(o).map((c) => c.name));
    return checkUnderstanding(decoded, f, otherColumns, features.map((x) => x.name), clock(), provider, looked);
  }
}
