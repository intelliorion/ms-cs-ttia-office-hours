import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import { paths } from '../workspace/paths';
import { appendHistory, writeFileAtomic } from '../workspace/files';
import { loadSteps, type StageNo } from '../rules/stages';
import { listIdeas, loadIdea, saveIdea, ideaDir, nextId, slugify } from '../ideas/store';
import { normalizeIdea, type Closure, type Idea } from '../ideas/idea';
import { setStage } from '../ideas/stage';
import { changes, type StageTarget } from '../ideas/suggest';
import { tick } from '../checklist/checklist';
import { currentRoundId } from '../round/store';
import { importExport } from '../import/importRows';
import { readTable } from '../import/readExport';
import { mapHeader } from '../import/columns';
import { draftEmail } from '../comms/outbox';
import { buildGraph } from '../graph/build';
import { appendAiLink, readAiLinks, setAiLinkStatus } from '../graph/store';
import { edgeId, CONFIRMED_AT, type AiLink } from '../graph/ontology';
import { planAiLinks } from '../ai/apply';
import type { ExtractOutput } from '../ai/tasks';
import { screen } from './screen';
import { displayName } from './match';
import type { TriageRecord } from './triage';
import type { InboxItem } from './store';

/**
 * Inbox actions. The AI only supplies facts (data); this file decides what can be done
 * with them and how sure the app must be first (Safe / Needs your OK). Every applied
 * action records a field-level inverse, so Undo changes back only what it changed.
 */

export type Action =
  | { t: 'file_email'; ideaId: string; direction: 'in' | 'out' }
  | { t: 'reply_received'; ideaId: string }
  | { t: 'record_answers'; ideaId: string; answers: { question: string; answer: string }[] }
  | { t: 'log_step'; ideaId: string; step: string; source: string }
  | { t: 'add_flag'; ideaId: string; text: string }
  | { t: 'name_builder'; ideaId: string; name: string }
  | { t: 'suggest_stage'; ideaId: string; stage?: StageNo; closeAs?: Closure }
  | { t: 'create_idea'; fields: { title: string; submitter?: string; challenge?: string } }
  | { t: 'graph_links'; ideaId: string; links: AiLink[] }
  | { t: 'import_export'; file: string }
  | { t: 'draft_email'; ideaId: string; template: string }
  | { t: 'ask_idea'; candidates: { id: string; title: string }[] };

export type Kind = 'safe' | 'ok' | 'held';

export type Inverse =
  | { t: 'remove-file'; files: string[]; onlyDraft?: true }
  | { t: 'untick'; ideaId: string; step: string; source: string }
  | { t: 'unset-field'; ideaId: string; field: 'answers'; entries: { question: string; source: string }[] }
  | { t: 'set-field'; ideaId: string; field: 'people.builder'; value: string | null; expect: string }
  | { t: 'set-field'; ideaId: string; field: 'stage'; value: StageTarget; expect: StageTarget }
  | { t: 'remove-flag'; ideaId: string; text: string }
  | { t: 'remove-ai-links'; edgeIds: string[] }
  | { t: 'remove-ideas'; ids: string[] };

export interface ActionRecord {
  id: string;
  action: Action;
  kind: Kind;
  status: 'applied' | 'pending' | 'undone' | 'failed';
  /** Plain-English line for the Inbox. */
  label: string;
  at?: string;
  undoneAt?: string;
  inverse?: Inverse;
  /** What an import did (created, duplicates, errors, flags). */
  result?: unknown;
  error?: string;
}

/** Steps a dropped item may tick by itself. */
export const SAFE_STEPS = ['s2d', 's3a', 's4b', 's4d'];

/** Code decides the kind; nothing the AI wrote changes it. */
export function kindOf(action: Action, ctx: { needsHand?: boolean } = {}): Kind {
  if (ctx.needsHand) return 'ok';
  switch (action.t) {
    case 'file_email': case 'reply_received': case 'record_answers': case 'import_export':
      return 'safe';
    case 'log_step':
      return SAFE_STEPS.includes(action.step) ? 'safe' : 'ok';
    case 'graph_links':
      return action.links.length > 0 && action.links.every((l) => !l.newNodes?.length && l.confidence >= CONFIRMED_AT) ? 'safe' : 'ok';
    default:
      return 'ok';
  }
}

const STAGE_HINT: Record<string, StageTarget> = {
  review: { stage: 2 }, design: { stage: 3 }, launch: { stage: 4 },
  'closed-reuse': { closeAs: 'reuse' }, 'closed-csic': { closeAs: 'csic' }, 'closed-notnow': { closeAs: 'notnow' },
};

const STEP_WORDS: Record<string, string> = { s2d: 'Answers received', s3a: 'Attendance confirmed', s4b: 'Slides and demo link received', s4d: 'Reuse write-up received' };

export function labelOf(a: Action): string {
  switch (a.t) {
    case 'file_email': return `File it in ${a.ideaId}`;
    case 'reply_received': return `Mark the reply as received on ${a.ideaId}`;
    case 'record_answers': return `Record ${a.answers.length} answer${a.answers.length === 1 ? '' : 's'} on ${a.ideaId}`;
    case 'log_step': return `Log "${STEP_WORDS[a.step] ?? a.step}" on ${a.ideaId}`;
    case 'add_flag': return `Add a flag on ${a.ideaId}: ${a.text}`;
    case 'name_builder': return `Name ${a.name} as the builder of ${a.ideaId}`;
    case 'suggest_stage': return a.closeAs ? `Close ${a.ideaId} (${a.closeAs})` : `Move ${a.ideaId} to stage ${a.stage}`;
    case 'create_idea': return `Create an idea: ${a.fields.title}`;
    case 'graph_links': {
      const n = a.links.length; const fresh = new Set(a.links.flatMap((l) => (l.newNodes ?? []).map((x) => x.label)));
      return `Add ${n} link${n === 1 ? '' : 's'} to the universe for ${a.ideaId}${fresh.size ? ` (new: ${[...fresh].join(', ')})` : ''}`;
    }
    case 'import_export': return 'Import the ideas in this export';
    case 'draft_email': return `Draft ${a.template} for ${a.ideaId}`;
    case 'ask_idea': return 'Which idea is this about?';
  }
}

const abs = (root: string, rel: string) => path.join(root, ...rel.split('/'));
const rel = (root: string, p: string) => path.relative(root, p).split(path.sep).join('/');
const exists = (p: string) => fs.access(p).then(() => true, () => false);
const key = (s: string) => s.trim().toLowerCase();

/** Rows of an export that look like a list of people rather than ideas: held, not imported. */
export async function screenExport(root: string, file: string, name: string): Promise<string[]> {
  const table = await readTable(abs(root, file));
  const { index } = mapHeader(table.header);
  const rows = table.rows.filter((r) => r.some((c) => c?.trim()));
  const reasons: string[] = [];
  const peopleCols = table.header.filter((h) => /\b(name|employee|staff|phone|mobile|e-?mail|id|number|dob|address)\b/i.test(h));
  if (index.title === undefined && index.submitter === undefined && peopleCols.length && rows.length >= 3) {
    reasons.push(`Lists ${rows.length} people by name (columns: ${peopleCols.join(', ')}), not ideas`);
  }
  if (!reasons.length && path.extname(file).toLowerCase() === '.xlsx') {
    const text = [table.header, ...rows].map((r) => r.join('\t')).join('\n');
    reasons.push(...screen(text, { fileName: name }).reasons);
  }
  return reasons;
}

/** Build the actions for a triaged item. Act only on a non-null ideaId; when asking, the only action is ask_idea. */
export async function planActions(root: string, item: InboxItem): Promise<{ actions: Action[]; hold?: string[] }> {
  const tr = item.triage as TriageRecord | undefined;
  if (item.status === 'held' || !tr) return { actions: [] };
  if (tr.export) {
    const hold = await screenExport(root, item.file, item.name);
    return hold.length ? { actions: [], hold } : { actions: [{ t: 'import_export', file: item.file }] };
  }
  if (tr.ask || !tr.ideaId) return { actions: [{ t: 'ask_idea', candidates: tr.candidates }] };
  const ideaId = tr.ideaId;
  const idea = await loadIdea(root, ideaId);
  const actions: Action[] = [{ t: 'file_email', ideaId, direction: 'in' }];
  const facts = tr.ai?.facts;
  if (!facts) return { actions };

  if (facts.answers?.length) actions.push({ t: 'record_answers', ideaId, answers: facts.answers.map(({ question, answer }) => ({ question, answer })) });
  if (facts.replyReceived === true && !idea.checklist.s2d?.done) actions.push({ t: 'reply_received', ideaId });
  if (facts.attendanceConfirmed === true && !idea.checklist.s3a?.done) actions.push({ t: 'log_step', ideaId, step: 's3a', source: item.file });
  for (const text of facts.newFlags ?? []) if (!idea.flags.includes(text)) actions.push({ t: 'add_flag', ideaId, text });
  const builder = typeof facts.builderNamed === 'string' ? facts.builderNamed.trim() : '';
  if (builder && builder !== (idea.people as { builder?: string }).builder) actions.push({ t: 'name_builder', ideaId, name: builder });
  const target = facts.stageHint ? STAGE_HINT[facts.stageHint] : undefined;
  if (target && changes(idea, target)) actions.push({ t: 'suggest_stage', ideaId, ...target });

  const { safe, ok } = await planGraph(root, item, idea, facts.graph, tr.provider ?? 'ai');
  if (safe.length) actions.push({ t: 'graph_links', ideaId, links: safe });
  if (ok.length) actions.push({ t: 'graph_links', ideaId, links: ok });
  return { actions };
}

/** People named in the item (To, Cc, From, speakers) and on the idea never become nodes: links touching them are dropped. */
async function planGraph(root: string, item: InboxItem, idea: Idea, out: ExtractOutput | undefined, provider: string) {
  if (!out) return { safe: [], ok: [] };
  const m = item.meta ?? {};
  const people = new Set([...(m.to ?? []), ...(m.cc ?? []), ...(m.speakers ?? []), ...(m.from ? [m.from] : [])]
    .map(displayName).concat(idea.people.submitter ?? '', ...idea.people.team.map((p) => p.name)).map(key).filter(Boolean));
  const isPerson = (label: string) => people.has(key(label));
  const filtered: ExtractOutput = {
    nodes: out.nodes.filter((n) => !isPerson(n.label)),
    links: out.links.filter((l) => !isPerson(l.from) && !isPerson(l.to)),
  };
  const { ideas } = await listIdeas(root);
  const previous = (await readAiLinks(root)).links;
  const { links } = planAiLinks(idea.id, filtered, buildGraph(ideas, previous), previous, provider);
  const sourced = links.map((l) => ({ ...l, source: `ai:${provider}:${item.file}` }));
  return {
    safe: sourced.filter((l) => !l.newNodes?.length && l.confidence >= CONFIRMED_AT),
    ok: sourced.filter((l) => l.newNodes?.length || l.confidence < CONFIRMED_AT),
  };
}

async function freeBase(dir: string, base: string, exts: string[]): Promise<string> {
  for (let n = 1; ; n++) {
    const b = `${base}${n === 1 ? '' : `-${n}`}`;
    if (!(await Promise.all(exts.map((e) => exists(path.join(dir, b + e))))).some(Boolean)) return b;
  }
}

async function history(root: string, ideaId: string, at: string, detail: string, source: string, action = 'inbox') {
  await appendHistory(await ideaDir(root, ideaId), { at, action, by: 'app', detail, source });
}

type Applied = { inverse?: Inverse; result?: unknown };

/** Apply one pending action. Returns the record with its inverse; throws on failure (the caller marks it failed). */
export async function applyAction(root: string, item: InboxItem, record: ActionRecord, clock: Clock): Promise<ActionRecord> {
  if (record.status !== 'pending' && record.status !== 'failed') throw new Error(`That one is already ${record.status}`);
  const done = await run(root, item, record.action, clock);
  const { error: _e, ...rest } = record;
  return { ...rest, status: 'applied', at: `${clock()}T${new Date().toISOString().slice(11)}`, ...done };
}

async function run(root: string, item: InboxItem, a: Action, clock: Clock): Promise<Applied> {
  const at = clock();
  switch (a.t) {
    case 'file_email': {
      const isEmail = item.type === 'email';
      const dir = path.join(await ideaDir(root, a.ideaId), ...(isEmail ? ['emails', a.direction] : ['notes']));
      const ext = path.extname(item.file).toLowerCase() || '.txt';
      const title = item.meta?.subject || path.basename(item.name, path.extname(item.name));
      const base = await freeBase(dir, `${at}-${slugify(title)}`, [ext, '.summary.md']);
      const copy = path.join(dir, base + ext);
      const summary = path.join(dir, `${base}.summary.md`);
      await writeFileAtomic(copy, await fs.readFile(abs(root, item.file)));
      const m = item.meta ?? {};
      const head = [`# ${title}`, '', ...(m.from ? [`From: ${m.from}`] : []), ...(m.subject ? [`Subject: ${m.subject}`] : []),
        ...(m.date ? [`Date: ${m.date}`] : []), `Source: ${item.file}`, ''];
      await writeFileAtomic(summary, [...head, ...(item.text ?? '').split('\n').slice(0, 40)].join('\n') + '\n');
      await history(root, a.ideaId, at, `${isEmail ? 'Email' : 'Note'} filed as ${rel(root, copy)}`, item.file);
      return { inverse: { t: 'remove-file', files: [rel(root, copy), rel(root, summary)] } };
    }
    case 'reply_received':
    case 'log_step': {
      const step = a.t === 'reply_received' ? 's2d' : a.step;
      await tick(root, a.ideaId, step, true, { by: 'app', source: item.file, clock, steps: await loadSteps(root) });
      return { inverse: { t: 'untick', ideaId: a.ideaId, step, source: item.file } };
    }
    case 'record_answers': {
      const idea = await loadIdea(root, a.ideaId) as Idea & { answers?: { question: string; answer: string; source: string }[] };
      const have = idea.answers ?? [];
      const fresh = a.answers.filter((x) => !have.some((h) => h.question === x.question && h.source === item.file))
        .map((x) => ({ question: x.question, answer: x.answer, source: item.file }));
      await saveIdea(root, { ...idea, answers: [...have, ...fresh] } as Idea);
      await history(root, a.ideaId, at, `${fresh.length} answer${fresh.length === 1 ? '' : 's'} recorded`, item.file);
      return { inverse: { t: 'unset-field', ideaId: a.ideaId, field: 'answers', entries: fresh.map((x) => ({ question: x.question, source: x.source })) } };
    }
    case 'add_flag': {
      const idea = await loadIdea(root, a.ideaId);
      if (idea.flags.includes(a.text)) return {};
      await saveIdea(root, { ...idea, flags: [...idea.flags, a.text] });
      await history(root, a.ideaId, at, `Flag added: ${a.text}`, item.file);
      return { inverse: { t: 'remove-flag', ideaId: a.ideaId, text: a.text } };
    }
    case 'name_builder': {
      const idea = await loadIdea(root, a.ideaId);
      const people = idea.people as Idea['people'] & { builder?: string };
      await saveIdea(root, { ...idea, people: { ...people, builder: a.name } as Idea['people'] });
      await history(root, a.ideaId, at, `Builder named: ${a.name}`, item.file);
      return { inverse: { t: 'set-field', ideaId: a.ideaId, field: 'people.builder', value: people.builder ?? null, expect: a.name } };
    }
    case 'suggest_stage': {
      const idea = await loadIdea(root, a.ideaId);
      const before: StageTarget = idea.closed ? { closeAs: idea.closed.as } : { stage: idea.stage };
      const target: StageTarget = a.closeAs ? { closeAs: a.closeAs } : { stage: a.stage as StageNo };
      await setStage(root, a.ideaId, target, clock);
      return { inverse: { t: 'set-field', ideaId: a.ideaId, field: 'stage', value: before, expect: target } };
    }
    case 'create_idea': {
      const { ideas, problems } = await listIdeas(root);
      const id = nextId([...ideas.map((i) => i.id), ...problems.map((p) => p.folder.slice(0, 13))], Number(at.slice(0, 4)));
      const title = a.fields.title.trim();
      if (!title) throw new Error('An idea needs a title');
      const idea = normalizeIdea({
        id, slug: slugify(title), title, round: await currentRoundId(root), stage: 1,
        ...(a.fields.challenge ? { challenge: a.fields.challenge } : {}),
        people: { submitter: a.fields.submitter, team: [] }, dedupe_key: `${key(title)}|${key(a.fields.submitter ?? '')}`,
      });
      const dir = await saveIdea(root, idea);
      await appendHistory(dir, { at, action: 'created', by: 'app', source: item.file });
      return { inverse: { t: 'remove-ideas', ids: [id] } };
    }
    case 'graph_links': {
      const had = new Set((await readAiLinks(root)).links.map((l) => edgeId(l.from, l.rel, l.to)));
      const added: string[] = [];
      for (const l of a.links) {
        const id = edgeId(l.from, l.rel, l.to);
        if (had.has(id)) continue;
        await appendAiLink(root, l);
        had.add(id); added.push(id);
      }
      if (added.length) await history(root, a.ideaId, at, `${added.length} link${added.length === 1 ? '' : 's'} added to the universe`, item.file);
      return added.length ? { inverse: { t: 'remove-ai-links', edgeIds: added } } : {};
    }
    case 'import_export': {
      const hold = await screenExport(root, a.file, item.name);
      if (hold.length) throw new Error(`Not imported: ${hold.join('; ')}`);
      const report = await importExport(root, abs(root, a.file), { clock, steps: await loadSteps(root) });
      return { inverse: { t: 'remove-ideas', ids: report.created.map((c) => c.id) }, result: report };
    }
    case 'draft_email': {
      const email = await draftEmail(root, { template: a.template, ideaId: a.ideaId }, clock);
      return { inverse: { t: 'remove-file', files: [email.key], onlyDraft: true }, result: { key: email.key } };
    }
    case 'ask_idea':
      throw new Error('Choose the idea first');
  }
}

/** Replays a record's inverse. Only what the action changed is changed back. */
export async function undoAction(root: string, item: InboxItem, recordId: string, clock: Clock): Promise<ActionRecord> {
  const record = ((item.actions ?? []) as ActionRecord[]).find((r) => r.id === recordId);
  if (!record) throw new Error(`No action ${recordId} on this item`);
  if (record.status === 'undone') throw new Error('That one is already undone');
  if (record.status !== 'applied') throw new Error('There is nothing to undo yet');
  const inv = record.inverse;
  const at = clock();
  if (inv) await replay(root, item, inv, clock);
  const ideaId = 'ideaId' in record.action ? record.action.ideaId : undefined;
  if (ideaId && inv && inv.t !== 'untick') await history(root, ideaId, at, `Undone: ${record.label}`, item.file, 'inbox-undo').catch(() => undefined);
  return { ...record, status: 'undone', undoneAt: `${at}T${new Date().toISOString().slice(11)}` };
}

const safeRel = (root: string, f: string) => {
  const p = path.resolve(abs(root, f));
  const base = path.resolve(root);
  if (f.includes('..') || !(p.startsWith(path.join(base, 'ideas') + path.sep) || p.startsWith(path.join(base, 'rounds') + path.sep))) {
    throw new Error(`Won't remove ${f}`);
  }
  return p;
};

async function replay(root: string, item: InboxItem, inv: Inverse, clock: Clock): Promise<void> {
  switch (inv.t) {
    case 'remove-file':
      for (const f of inv.files) {
        const p = safeRel(root, f);
        if (inv.onlyDraft && !/\nstatus: draft\n/.test(await fs.readFile(p, 'utf8').catch(() => ''))) continue;
        await fs.rm(p, { force: true });
      }
      return;
    case 'untick': {
      const idea = await loadIdea(root, inv.ideaId);
      const s = idea.checklist[inv.step];
      if (s?.done && s.source === inv.source) {
        await tick(root, inv.ideaId, inv.step, false, { by: 'app', source: inv.source, clock, steps: await loadSteps(root) });
      }
      return;
    }
    case 'unset-field': {
      const idea = await loadIdea(root, inv.ideaId) as Idea & { answers?: { question: string; source: string }[] };
      const drop = (x: { question: string; source: string }) => inv.entries.some((e) => e.question === x.question && e.source === x.source);
      const answers = (idea.answers ?? []).filter((x) => !drop(x));
      const { answers: _old, ...rest } = idea;
      await saveIdea(root, (answers.length ? { ...rest, answers } : rest) as Idea);
      return;
    }
    case 'remove-flag': {
      const idea = await loadIdea(root, inv.ideaId);
      await saveIdea(root, { ...idea, flags: idea.flags.filter((f) => f !== inv.text) });
      return;
    }
    case 'set-field': {
      const idea = await loadIdea(root, inv.ideaId);
      if (inv.field === 'people.builder') {
        const { builder, ...people } = idea.people as Idea['people'] & { builder?: string };
        if (builder !== inv.expect) return;
        await saveIdea(root, { ...idea, people: (inv.value ? { ...people, builder: inv.value } : people) as Idea['people'] });
      } else {
        const now: StageTarget = idea.closed ? { closeAs: idea.closed.as } : { stage: idea.stage };
        if (JSON.stringify(now) !== JSON.stringify(inv.expect)) return;
        await setStage(root, inv.ideaId, inv.value, clock);
      }
      return;
    }
    case 'remove-ai-links':
      for (const id of inv.edgeIds) await setAiLinkStatus(root, id, 'removed').catch(() => undefined);
      return;
    case 'remove-ideas':
      for (const id of inv.ids) {
        const dir = await ideaDir(root, id).catch(() => undefined);
        if (dir) await fs.rm(dir, { recursive: true, force: true });
      }
      return;
  }
}

/** undo.jsonl: an append-only log of every apply and undo (like history.log, the one non-atomic write). */
export async function logUndo(root: string, entry: { op: 'apply' | 'undo'; item: string; record: string; t: string; inverse?: Inverse }): Promise<void> {
  await fs.mkdir(paths(root).inbox, { recursive: true });
  await fs.appendFile(path.join(paths(root).inbox, 'undo.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
}
