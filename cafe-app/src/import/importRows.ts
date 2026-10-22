import path from 'node:path';
import { readTable } from './readExport';
import { COLUMNS, mapHeader, parseSubmitter, parseTeam, splitMulti, type Field } from './columns';
import { listIdeas, nextId, saveIdea, slugify } from '../ideas/store';
import { normalizeIdea } from '../ideas/idea';
import { withTick } from '../checklist/checklist';
import { appendHistory } from '../workspace/files';
import type { StepDef } from '../rules/stages';
import type { Clock } from '../clock';

export interface ImportReport {
  created: { id: string; title: string }[];
  duplicates: { row: number; id: string; title: string }[];
  errors: { row: number; message: string }[];
  flags: { id: string; message: string }[];
  ignoredColumns: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const CUT_OFF = /…|\.{3}/;
const opt = (v: string) => (v ? v : undefined);
const MULTI = new Set<Field>(['outcomes', 'support']);

export async function importExport(
  root: string, file: string, opts: { clock: Clock; steps: StepDef[] },
): Promise<ImportReport> {
  const name = path.basename(file);
  const table = await readTable(file);
  const { index, unknown } = mapHeader(table.header);
  if (index.title === undefined) {
    throw new Error(`${name} has no Title column, so nothing was imported. Columns found: ${table.header.join(', ') || 'none'}`);
  }
  const { ideas, problems } = await listIdeas(root);
  const byKey = new Map(ideas.map((i) => [i.dedupe_key, i.id]));
  // Broken folders still hold their ID, so it must never be reissued.
  const ids = [...ideas.map((i) => i.id), ...problems.map((p) => p.folder.slice(0, 13))];
  const year = Number(opts.clock().slice(0, 4));
  const s1d = opts.steps.find((s) => s.id === 's1d');
  const report: ImportReport = { created: [], duplicates: [], errors: [], flags: [], ignoredColumns: unknown };

  for (const [i, row] of table.rows.entries()) {
    const rowNo = i + 2;
    if (row.every((c) => !c?.trim())) continue;
    const get = (f: Field) => {
      const ix = index[f];
      return ix === undefined ? '' : (row[ix] ?? '').trim();
    };
    const title = get('title');
    if (!title) {
      report.errors.push({ row: rowNo, message: 'Title is empty' });
      continue;
    }
    const submitter = parseSubmitter(get('submitter'));
    const key = `${norm(title)}|${norm(submitter.name ?? '')}`;
    const existing = byKey.get(key);
    if (existing) {
      report.duplicates.push({ row: rowNo, id: existing, title });
      continue;
    }

    const id = nextId(ids, year);
    ids.push(id);
    const team = parseTeam(get('team'));
    const participation = get('participation');
    const flags: string[] = [];
    for (const c of COLUMNS) {
      const v = get(c.field);
      if (!CUT_OFF.test(v)) continue;
      // Multi-select fields arrive as ";#A;#B;#"; show them the way the idea stores them.
      const shown = MULTI.has(c.field) ? splitMulti(v).join('; ') : v;
      flags.push(`Cut off in the export, check the full text: ${c.label} "${shown}"`);
    }
    if (/individual/i.test(participation) && team.length > 1) {
      flags.push(`Participation is Individual but ${team.length} people are listed`);
    }

    const source = `${name} row ${rowNo}`;
    const at = opts.clock();
    let idea = normalizeIdea({
      id, slug: slugify(title), title, round: '', stage: 1,
      entity: submitter.entity,
      function: opt(get('function')),
      region: opt(get('region')),
      participation: opt(participation),
      challenge: opt(get('challenge')),
      outcomes: splitMulti(get('outcomes')),
      current_process: opt(get('current_process')),
      support: splitMulti(get('support')),
      experimented: opt(get('experimented')),
      people: { submitter: submitter.name, team },
      flags,
      source: { file: name, row: rowNo },
      dedupe_key: key,
    });
    if (s1d) idea = withTick(idea, s1d, true, 'app', at, source);
    const dir = await saveIdea(root, idea);
    await appendHistory(dir, { at, action: 'created', by: 'app', source });
    if (s1d) await appendHistory(dir, { at, action: 'tick', by: 'app', step: 's1d', source });

    byKey.set(key, id);
    report.created.push({ id, title });
    for (const message of flags) report.flags.push({ id, message });
  }
  return report;
}
