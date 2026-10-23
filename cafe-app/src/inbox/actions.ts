import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock } from '../clock';
import { dataKey, fromDataKey, paths } from '../workspace/paths';
import { appendHistory, readText, writeFileAtomic } from '../workspace/files';
import { FIRST_STAGE, STAGE_NAMES, loadSteps, type StageNo } from '../rules/stages';
import { listIdeas, loadIdea, saveIdea, ideaDir, nextId, slugify } from '../ideas/store';
import { normalizeIdea, type Closure, type Idea, type Person } from '../ideas/idea';
import { hasRole, personOn, withAddedRole, withoutRole } from '../ideas/people';
import { setStage } from '../ideas/stage';
import { changes, type StageTarget } from '../ideas/suggest';
import { tick } from '../checklist/checklist';
import { loadSettings } from '../round/store';
import { renderHandoff } from '../review/review';
import { importExport } from '../import/importRows';
import { readTable } from '../import/readExport';
import { mapHeader } from '../import/columns';
import { draftEmail } from '../comms/outbox';
import { buildGraph } from '../graph/build';
import { appendAiLink, readAiLinks, setAiLinkStatus } from '../graph/store';
import { edgeId, type AiLink } from '../graph/ontology';
import { planAiLinks } from '../ai/apply';
import type { ExtractOutput } from '../ai/tasks';
import { screen } from './screen';
import { displayName } from './match';
import { SIGNATURE } from '../comms/templates';
import { openQuestionsOf, type TriageRecord } from './triage';
import { fillDesignAnswers } from '../design/brainstorm';
import { sameQuestion } from './question';

export { sameQuestion };
import type { InboxItem } from './store';

/**
 * Import actions. The AI only supplies facts (data); this file decides what can be done
 * with them and how sure the app must be first (Safe / Needs your OK). Every applied
 * action records a field-level inverse, so Undo changes back only what it changed.
 */

export type Action =
  | { t: 'file_email'; ideaId: string; direction: 'in' | 'out' }
  | { t: 'reply_received'; ideaId: string }
  /** why: set by code when the AI's facts alone aren't enough (e.g. a question we never sent); it then waits for a Yes. */
  | { t: 'record_answers'; ideaId: string; answers: { question: string; answer: string }[]; why?: string }
  | { t: 'log_step'; ideaId: string; step: string; source: string; why?: string }
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
  /** The idea's team as it was, and as the action left it; a team changed since is kept. */
  | { t: 'set-team'; ideaId: string; before: Person[]; after: Person[] }
  /** Older records: the builder was its own field. Undone as roles now. */
  | { t: 'set-field'; ideaId: string; field: 'people.builder'; value: string | null; expect: string }
  | { t: 'set-field'; ideaId: string; field: 'stage'; value: Where; expect: Where }
  | { t: 'remove-flag'; ideaId: string; text: string }
  /** was: each link's status when it was added; a link whose status has changed since (e.g. confirmed) is kept. */
  | { t: 'remove-ai-links'; edgeIds: string[]; was?: Record<string, AiLink['status']> }
  /** prints: a fingerprint of each folder when it was created; a folder changed since is kept. */
  | { t: 'remove-ideas'; ids: string[]; prints?: Record<string, string> };

/** Where an idea is, field by field: what a stage change touches. */
export interface Where { stage: StageNo; closed?: Idea['closed']; route?: string }

export interface ActionRecord {
  id: string;
  action: Action;
  kind: Kind;
  status: 'applied' | 'pending' | 'undone' | 'failed';
  /** Plain-English line for the Import. */
  label: string;
  at?: string;
  undoneAt?: string;
  /** Plain English, set by Undo when part of it was kept (e.g. "CAFE-2026-002 has changed since the import; close it instead"). */
  note?: string;
  inverse?: Inverse;
  /** Set when the conflict rules held this back: which rule and why, in plain English. */
  held?: { rule: string; why: string; existing?: string; node?: string };
  /** Set when the operator resolved a held record (e.g. onto an existing star): the action as it was proposed. */
  resolvedFrom?: Action;
  /** What an import did (created, duplicates, errors, flags). */
  result?: unknown;
  error?: string;
}

/** Steps a dropped item may tick by itself. */
export const SAFE_STEPS = ['s2d', 's3a', 's4b', 's4d'];

/** Code decides the kind; nothing the AI wrote changes it. */
export function kindOf(action: Action, ctx: { needsHand?: boolean } = {}): Kind {
  if (ctx.needsHand) return 'ok';
  if ('why' in action && action.why) return 'ok';
  switch (action.t) {
    case 'file_email': case 'reply_received': case 'record_answers': case 'import_export':
      return 'safe';
    case 'log_step':
      return SAFE_STEPS.includes(action.step) ? 'safe' : 'ok';
    case 'graph_links':
      return 'safe';
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
    case 'record_answers': return `Save ${a.answers.length} answer${a.answers.length === 1 ? '' : 's'} on ${a.ideaId}${a.why ? ` (${a.why})` : ''}`;
    case 'log_step': return `Log "${STEP_WORDS[a.step] ?? a.step}" on ${a.ideaId}${a.why ? ` (${a.why})` : ''}`;
    case 'add_flag': return `Add a flag on ${a.ideaId}: ${a.text}`;
    case 'name_builder': return `Name ${a.name} as the builder of ${a.ideaId}`;
    case 'suggest_stage': return a.closeAs ? `Close ${a.ideaId} (${a.closeAs})` : `Move ${a.ideaId} to ${STAGE_NAMES[a.stage!]}`;
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

const abs = (root: string, rel: string) => fromDataKey(root, rel);
const rel = (root: string, p: string) => dataKey(root, p);
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
  const direction = await directionOf(root, item);
  const actions: Action[] = [{ t: 'file_email', ideaId, direction }];
  const facts = tr.ai?.facts;
  // Our own email is only filed: what we wrote is not news about the idea (no flags, stage, links or answers from it).
  if (!facts || direction === 'out') return { actions };

  // The AI's facts alone never make a Safe write: an answer is Safe only against a question we sent,
  // a reply only when we asked (E2 or E2R sent), attendance only when we invited (E3 sent).
  if (facts.answers?.length) {
    const asked = await openQuestionsOf(root, ideaId);
    const all = facts.answers.map(({ question, answer }) => ({ question, answer }));
    const ours = all.filter((x) => asked.some((q) => sameQuestion(x.question, q)));
    const other = all.filter((x) => !ours.includes(x));
    if (ours.length) actions.push({ t: 'record_answers', ideaId, answers: ours });
    if (other.length) actions.push({ t: 'record_answers', ideaId, answers: other, why: 'question not one we sent' });
  }
  const asked = !!(idea.sent?.E2 || idea.sent?.E2R);
  if (facts.replyReceived === true && asked && !idea.checklist.s2d?.done) actions.push({ t: 'reply_received', ideaId });
  if (facts.attendanceConfirmed === true && !idea.checklist.s3a?.done) {
    actions.push({ t: 'log_step', ideaId, step: 's3a', source: item.file, ...(idea.sent?.E3 ? {} : { why: 'no invitation was sent' }) });
  }
  for (const text of facts.newFlags ?? []) if (!idea.flags.includes(text)) actions.push({ t: 'add_flag', ideaId, text });
  const builder = typeof facts.builderNamed === 'string' ? facts.builderNamed.trim() : '';
  if (builder && !hasRole(personOn(idea, builder), 'builder')) actions.push({ t: 'name_builder', ideaId, name: builder });
  const target = facts.stageHint ? STAGE_HINT[facts.stageHint] : undefined;
  if (target && changes(idea, target)) actions.push({ t: 'suggest_stage', ideaId, ...target });

  const { links } = await planGraph(root, item, idea, facts.graph, tr.provider ?? 'ai');
  if (links.length) actions.push({ t: 'graph_links', ideaId, links });
  return { actions };
}

/** From the operator (the first line of the signature, settings.operatorName) → out; anyone else → in. */
export async function directionOf(root: string, item: InboxItem): Promise<'in' | 'out'> {
  const me = key(((await loadSettings(root)).operatorName ?? '').split('\n')[0]);
  const rawFrom = item.meta?.from ?? '';
  const from = key(displayName(rawFrom));
  if (me && from && from === me) return 'out';
  const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’‘`]/g, "'");
  if (/creators'? ?cafe|cafe@/.test(plain(rawFrom))) return 'out';
  // Our signature counts only in the new text: a submitter may quote it below their reply
  const sig = plain(SIGNATURE).trim().replace(/^.*\n/s, '').replace(/\s+/g, ' ');
  const own = plain(item.text ?? '').replace(/\s+/g, ' ');
  return own.includes(sig) ? 'out' : 'in';
}

/** People named in the item (To, Cc, From, speakers) and on the idea never become nodes: links touching them are dropped. */
async function planGraph(root: string, item: InboxItem, idea: Idea, out: ExtractOutput | undefined, provider: string) {
  if (!out) return { links: [] as AiLink[] };
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
  const { links } = planAiLinks(idea.id, filtered, buildGraph(ideas, previous), previous, provider, { status: 'confirmed' });
  const sourced = links.map((l) => ({ ...l, source: `ai:${provider}:${item.file}` }));
  return { links: sourced };
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
      // Design questions we asked the team in an E2 ("I don't know") are filled from the matching answers,
      // against the idea as it is now saved.
      await fillDesignAnswers(root, await loadIdea(root, a.ideaId), a.answers, clock);
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
      // The builder role goes on the person (added to the team when new); their other roles stay.
      const before = idea.people.team;
      const after = withAddedRole(before, a.name, 'builder');
      await saveIdea(root, { ...idea, people: { ...idea.people, team: after } });
      await history(root, a.ideaId, at, `Builder named: ${a.name}`, item.file);
      return { inverse: { t: 'set-team', ideaId: a.ideaId, before, after } };
    }
    case 'suggest_stage': {
      const before = whereOf(await loadIdea(root, a.ideaId));
      const target: StageTarget = a.closeAs ? { closeAs: a.closeAs } : { stage: a.stage as StageNo };
      const after = whereOf(await setStage(root, a.ideaId, target, clock));
      return { inverse: { t: 'set-field', ideaId: a.ideaId, field: 'stage', value: before, expect: after } };
    }
    case 'create_idea': {
      const { ideas, problems } = await listIdeas(root);
      const id = nextId([...ideas.map((i) => i.id), ...problems.map((p) => p.folder.slice(0, 13))], Number(at.slice(0, 4)));
      const title = a.fields.title.trim();
      if (!title) throw new Error('An idea needs a title');
      const idea = normalizeIdea({
        id, slug: slugify(title), title, round: '', stage: FIRST_STAGE,
        ...(a.fields.challenge ? { challenge: a.fields.challenge } : {}),
        people: { submitter: a.fields.submitter, team: [] }, dedupe_key: `${key(title)}|${key(a.fields.submitter ?? '')}`,
      });
      const dir = await saveIdea(root, idea);
      await appendHistory(dir, { at, action: 'created', by: 'app', source: item.file });
      return { inverse: { t: 'remove-ideas', ids: [id], prints: { [id]: await fingerprint(dir) } } };
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
      const was = Object.fromEntries(added.map((id) => [id, a.links.find((l) => edgeId(l.from, l.rel, l.to) === id)!.status]));
      return added.length ? { inverse: { t: 'remove-ai-links', edgeIds: added, was } } : {};
    }
    case 'import_export': {
      const hold = await screenExport(root, a.file, item.name);
      if (hold.length) throw new Error(`Not imported: ${hold.join('; ')}`);
      const report = await importExport(root, abs(root, a.file), { clock, steps: await loadSteps(root) });
      const prints: Record<string, string> = {};
      for (const c of report.created) prints[c.id] = await fingerprint(await ideaDir(root, c.id));
      return { inverse: { t: 'remove-ideas', ids: report.created.map((c) => c.id), prints }, result: report };
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
  const out = inv ? await replay(root, item, inv, clock) : { did: 0, kept: [] as string[] };
  // Nothing could be changed back, only kept: stay applied and say why.
  if (out.did === 0 && out.kept.length) throw new Error(out.kept.join('; '));
  const ideaId = 'ideaId' in record.action ? record.action.ideaId : undefined;
  if (ideaId && inv && inv.t !== 'untick') await history(root, ideaId, at, `Undone: ${record.label}`, item.file, 'inbox-undo').catch(() => undefined);
  return {
    ...record, status: 'undone', undoneAt: `${at}T${new Date().toISOString().slice(11)}`,
    ...(out.kept.length ? { note: out.kept.join('; ') } : {}),
  };
}

const safeRel = (root: string, f: string) => {
  const p = path.resolve(abs(root, f));
  const { ideas, rounds } = paths(root);
  if (f.includes('..') || !(p.startsWith(path.resolve(ideas) + path.sep) || p.startsWith(path.resolve(rounds) + path.sep))) {
    throw new Error(`Won't remove ${f}`);
  }
  return p;
};

export function whereOf(idea: Idea): Where {
  return { stage: idea.stage, ...(idea.closed ? { closed: idea.closed } : {}), ...(idea.route !== undefined ? { route: idea.route } : {}) };
}
const sameWhere = (a: Where, b: Where) =>
  a.stage === b.stage && JSON.stringify(a.closed ?? null) === JSON.stringify(b.closed ?? null) && (a.route ?? null) === (b.route ?? null);

/** A folder's fingerprint: its file names plus the bytes of each file. Any later edit, tick or added file changes it. */
export async function fingerprint(dir: string): Promise<string> {
  const h = createHash('sha256');
  const walk = async (d: string, pre: string): Promise<void> => {
    for (const e of (await fs.readdir(d, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name))) {
      const p = path.join(d, e.name);
      h.update(`${pre}${e.name}${e.isDirectory() ? '/' : ''}\0`);
      if (e.isDirectory()) await walk(p, `${pre}${e.name}/`);
      else h.update(await fs.readFile(p));
    }
  };
  await walk(dir, '');
  return h.digest('hex');
}

type Replayed = { did: number; kept: string[] };

async function replay(root: string, _item: InboxItem, inv: Inverse, clock: Clock): Promise<Replayed> {
  const out: Replayed = { did: 0, kept: [] };
  switch (inv.t) {
    case 'remove-file':
      for (const f of inv.files) {
        const p = safeRel(root, f);
        if (inv.onlyDraft && !/\nstatus: draft\n/.test(await fs.readFile(p, 'utf8').catch(() => ''))) {
          out.kept.push(`${f} is no longer a draft, so it was kept`);
          continue;
        }
        await fs.rm(p, { force: true });
        out.did++;
      }
      return out;
    case 'untick': {
      const idea = await loadIdea(root, inv.ideaId);
      const s = idea.checklist[inv.step];
      // Ticked by someone else since (or already open): nothing of ours to change back.
      if (s?.done && s.source === inv.source) {
        await tick(root, inv.ideaId, inv.step, false, { by: 'app', source: inv.source, clock, steps: await loadSteps(root) });
      }
      out.did++;
      return out;
    }
    case 'unset-field': {
      const idea = await loadIdea(root, inv.ideaId) as Idea & { answers?: { question: string; source: string }[] };
      const drop = (x: { question: string; source: string }) => inv.entries.some((e) => e.question === x.question && e.source === x.source);
      const answers = (idea.answers ?? []).filter((x) => !drop(x));
      const { answers: _old, ...rest } = idea;
      await saveIdea(root, (answers.length ? { ...rest, answers } : rest) as Idea);
      out.did++;
      return out;
    }
    case 'set-team': {
      const idea = await loadIdea(root, inv.ideaId);
      if (JSON.stringify(idea.people.team) !== JSON.stringify(inv.after)) { out.kept.push(`The team of ${inv.ideaId} has changed since, so it was kept`); return out; }
      await saveIdea(root, { ...idea, people: { ...idea.people, team: inv.before } });
      out.did++;
      return out;
    }
    case 'remove-flag': {
      const idea = await loadIdea(root, inv.ideaId);
      await saveIdea(root, { ...idea, flags: idea.flags.filter((f) => f !== inv.text) });
      out.did++;
      return out;
    }
    case 'set-field': {
      const idea = await loadIdea(root, inv.ideaId);
      if (inv.field === 'people.builder') {
        if (!hasRole(personOn(idea, inv.expect), 'builder')) { out.kept.push(`The builder of ${inv.ideaId} has changed since, so it was kept`); return out; }
        let team = withoutRole(idea.people.team, inv.expect, 'builder');
        if (inv.value) team = withAddedRole(team, inv.value, 'builder');
        await saveIdea(root, { ...idea, people: { ...idea.people, team } });
        out.did++;
        return out;
      }
      if (!sameWhere(whereOf(idea), inv.expect)) {
        out.kept.push(`${inv.ideaId} has moved since, so its stage was kept; set it by hand`);
        return out;
      }
      const { closed: _c, route: _r, ...rest } = idea;
      const prev: Idea = { ...rest, stage: inv.value.stage, ...(inv.value.closed ? { closed: inv.value.closed } : {}), ...(inv.value.route !== undefined ? { route: inv.value.route } : {}) };
      const dir = await saveIdea(root, prev);
      await appendHistory(dir, { at: clock(), action: 'stage', by: 'operator', detail: 'Undone in the Import' });
      const handoff = path.join(dir, 'csic-handoff.md');
      if ((await readText(handoff)) !== undefined) await writeFileAtomic(handoff, renderHandoff(prev, await loadSettings(root)));
      out.did++;
      return out;
    }
    case 'remove-ai-links': {
      const now = new Map((await readAiLinks(root)).links.map((l) => [edgeId(l.from, l.rel, l.to), l.status]));
      for (const id of inv.edgeIds) {
        const status = now.get(id);
        if (!status || status === 'removed') continue;
        if (inv.was?.[id] && status !== inv.was[id]) { out.kept.push(`Kept the link ${id.split('|').join(' ')}: you ${status} it since`); continue; }
        await setAiLinkStatus(root, id, 'removed');
        out.did++;
      }
      return out;
    }
    case 'remove-ideas':
      for (const id of inv.ids) {
        const dir = await ideaDir(root, id).catch(() => undefined);
        if (!dir) continue;
        if (inv.prints?.[id] && (await fingerprint(dir)) !== inv.prints[id]) {
          out.kept.push(`${id} has changed since the import; close it instead`);
          continue;
        }
        await fs.rm(dir, { recursive: true, force: true });
        out.did++;
      }
      return out;
  }
}

/** undo.jsonl: an append-only log of every apply and undo (like history.log, the one non-atomic write). */
export async function logUndo(root: string, entry: { op: 'apply' | 'undo'; item: string; record: string; t: string; inverse?: Inverse }): Promise<void> {
  // A log failure never turns a done action into a failed one.
  try {
    await fs.mkdir(paths(root).inbox, { recursive: true });
    await fs.appendFile(path.join(paths(root).inbox, 'undo.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch { /* the inverse is on the item; the log is a convenience */ }
}
