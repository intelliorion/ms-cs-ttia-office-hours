/**
 * The confirmed data as the later steps read it (the features, the tool, the design questions, the diagram, the kits
 * and the roadshow): each usable file with its kind, what it is, its columns and their meanings, its rules and
 * derivations, plus the data questions' answers. Nothing until the operator has confirmed it.
 */
import type { Coded } from '../command/names';
import type { DataBrief } from '../ai/tasks';
import { codeValue } from '../review/suggestInput';
import { columnsOf, isUsable, KIND_LABELS, meaningOf, sizeWords, whatOf, type DataFile, type DataState } from './model';

/** A file as the AI and the later steps read it: kind, what it is, columns with their meanings, rules and derivations. */
export function fileBrief(f: DataFile): DataBrief['files'][number] {
  const u = f.understanding;
  return {
    name: f.name, kind: KIND_LABELS[f.kind], what: whatOf(f) ?? '', size: sizeWords(f),
    columns: columnsOf(f).map((c) => {
      const codes = u?.columns.find((x) => x.name === c.name)?.codes;
      return { name: c.name, type: c.type, ...(meaningOf(f, c.name) ? { meaning: meaningOf(f, c.name) } : {}), ...(codes ? { codes } : {}) };
    }),
    ...(u?.points.length ? { points: u.points } : {}),
    ...(u?.rules.length ? { rules: u.rules.map((r) => `${r.rule}${r.columns.length ? ` (${r.columns.join(', ')})` : ''}`) } : {}),
    ...(u?.derivations.length ? { derivations: u.derivations.map((x) => `${x.output} = ${x.how}${x.from.length ? ` (from ${x.from.join(', ')})` : ''}`) } : {}),
    ...([...(f.tables?.flatMap((t) => t.issues) ?? []), ...(u?.issues ?? [])].length ? { issues: [...(f.tables?.flatMap((t) => t.issues) ?? []), ...(u?.issues ?? [])].slice(0, 6) } : {}),
  };
}

/** The confirmed data, for the features, the tool, the design, the diagram, the kits and the roadshow. Undefined until confirmed. */
export function dataBrief(d: DataState | undefined): DataBrief | undefined {
  if (!d?.confirmedAt) return undefined;
  const files = d.files.filter(isUsable).map(fileBrief);
  const answers = d.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: s.question, answer: s.answer!.trim() }));
  if (!files.length && !answers.length) return undefined;
  return {
    files,
    ...(d.summary ? { summary: { input: d.summary.input, output: d.summary.output, knowledge: d.summary.knowledge, rules: d.summary.rules } } : {}),
    ...(answers.length ? { answers } : {}),
  };
}

/** The confirmed data brief with people coded (for a task whose other texts were coded with `codes`). */
export async function codedDataBrief(root: string, id: string, d: DataState | undefined, codes: Map<string, Coded>): Promise<{ data?: DataBrief }> {
  const b = dataBrief(d);
  return b ? { data: await codeValue(root, id, b, codes) } : {};
}

