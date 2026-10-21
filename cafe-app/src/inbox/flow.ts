import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Clock } from '../clock';
import type { Connector } from '../ai/connector';
import { paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { listIdeas } from '../ideas/store';
import { currentRoundId } from '../round/store';
import { loadTemplates, render } from '../comms/templates';
import { draftEmail, updateDraft, type EmailRecord } from '../comms/outbox';
import { saveDrop, getItem, updateItem, holdItem, deleteHeld, listItems, type InboxItem } from './store';
import { readAndScreen, matchStep, understandStep, readDetail, exportRows, HOW_WORDS, type TriageRecord, type MatchStep } from './triage';
import { matchIdea, displayName, ASK_BELOW } from './match';
import { kindOf, labelOf, planActions, applyAction, undoAction, logUndo, type Action, type ActionRecord } from './actions';
import { markStep, timed, skipRest, resetStepsFrom, stepOf, type Step, type StepId, type StepStatus } from './steps';
import { checkProposals, type ConflictContext } from './conflicts';
import { appendHistory, readHistory } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import { readDesign } from '../design/store';
import { rebuildGraph } from '../graph/store';

/** Route-level inbox operations. The server runs every one of these behind its POST lock. */

const recordsOf = (item: InboxItem) => (item.actions ?? []) as ActionRecord[];

async function load(root: string, id: string): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No inbox item ${id}`);
  return item;
}

/** triaged while anything waits (Which idea?, an OK, a failure); applied when nothing does. */
function statusOf(item: InboxItem, records: ActionRecord[]): InboxItem['status'] {
  if (item.status === 'held' || item.status === 'dismissed') return item.status;
  const tr = item.triage as TriageRecord | undefined;
  const waiting = records.some((r) => r.status === 'pending' || r.status === 'failed') || !!tr?.ask || records.length === 0;
  return waiting ? 'triaged' : 'applied';
}

async function save(root: string, item: InboxItem, records: ActionRecord[]): Promise<InboxItem> {
  return updateItem(root, item.id, { actions: records, status: statusOf(item, records) });
}

/** Apply one record, then save the sidecar at once, so an applied action always has its inverse on disk. */
async function applyOne(root: string, item: InboxItem, records: ActionRecord[], i: number, clock: Clock): Promise<void> {
  try {
    records[i] = await applyAction(root, item, records[i], clock);
  } catch (e) {
    records[i] = { ...records[i], status: 'failed', error: (e as Error).message };
  }
  await updateItem(root, item.id, { actions: [...records] });
  if (records[i].status === 'applied') {
    await logUndo(root, { op: 'apply', item: item.id, record: records[i].id, t: records[i].action.t, inverse: records[i].inverse });
  }
}

/** "3 answers recorded, reply received, email filed": what the context step did, in this order. */
function contextDetail(records: ActionRecord[]): string {
  const of = (t: Action['t']) => records.filter((r) => r.action.t === t);
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  const parts: string[] = [];
  const answers = of('record_answers').reduce((k, r) => k + (r.action as Extract<Action, { t: 'record_answers' }>).answers.length, 0);
  if (answers) parts.push(`${n(answers, 'answer')} recorded`);
  if (of('reply_received').length) parts.push('reply received');
  if (of('name_builder').length) parts.push('builder named');
  if (of('add_flag').length) parts.push(`${n(of('add_flag').length, 'flag')} added`);
  for (const r of of('log_step')) parts.push(`step ${(r.action as Extract<Action, { t: 'log_step' }>).step} ticked`);
  for (const r of of('import_export')) {
    const created = (r.result as { created?: unknown[] } | undefined)?.created?.length ?? 0;
    parts.push(`imported ${n(created, 'idea')}`);
  }
  // An email is filed under the idea's emails/ folder, anything else under notes/.
  const filed = of('file_email');
  if (filed.length) parts.push(filed.some((r) => (r.inverse as { files?: string[] } | undefined)?.files?.some((f) => f.includes('/emails/'))) ? 'email filed' : 'note filed');
  const out = parts.join(', ') || 'Updated';
  return out[0].toUpperCase() + out.slice(1);
}

/** "2 links added, 1 new star (Capability: Slot finding)". */
function graphDetail(records: ActionRecord[]): string {
  const links = records.flatMap((r) => (r.action.t === 'graph_links' ? r.action.links : []));
  const stars = new Map<string, string>();
  for (const l of links) for (const x of l.newNodes ?? []) stars.set(x.id, `${x.type}: ${x.label}`);
  const names = [...stars.values()];
  const head = `${links.length} link${links.length === 1 ? '' : 's'} added`;
  if (!names.length) return head;
  return `${head}, ${names.length} new star${names.length === 1 ? '' : 's'} (${names.slice(0, 2).join(', ')}${names.length > 2 ? ', …' : ''})`;
}

/** A waiting proposal in a few words that never carry a name (a step's detail is shown before anyone opens it). */
function waitingWords(a: Action): string {
  switch (a.t) {
    case 'name_builder': return 'a builder is named';
    case 'record_answers': return 'answers to record';
    case 'log_step': return 'a step to tick';
    case 'suggest_stage': return 'a stage move to confirm';
    case 'add_flag': return 'a flag to add';
    case 'graph_links': return 'links to add';
    case 'draft_email': return 'an email to draft';
    default: return a.t;
  }
}

/** What the conflict rules check against: the idea, every idea, the universe, the people in the file, the design. */
async function conflictContext(root: string, item: InboxItem, tr: TriageRecord, m: MatchStep, screened: string[]): Promise<ConflictContext> {
  const idea = tr.ideaId ? m.byId.get(tr.ideaId) ?? null : null;
  const meta = item.meta ?? {};
  const peoplePresent = [...new Set([...(meta.to ?? []), ...(meta.cc ?? []), ...(meta.speakers ?? []), ...(meta.from ? [meta.from] : [])].map(displayName).filter(Boolean))];
  return {
    idea, ideas: m.ideas, nodes: (await rebuildGraph(root)).nodes, peoplePresent,
    design: idea ? await readDesign(root, idea.id).catch(() => null) : null,
    match: { ideaId: m.match.ideaId ?? null, confidence: m.match.confidence, candidates: m.match.candidates },
    aiIdeaId: tr.ai?.ideaId ?? null, screened,
  };
}

async function sizeOf(root: string, item: InboxItem): Promise<number> {
  try { return (await fs.stat(path.join(root, ...item.file.split('/')))).size; } catch { return item.text?.length ?? 0; }
}

/**
 * The run, step by step (receive, read, screen, match, understand, context, graph, check), each written to the
 * sidecar as it ends. The conflict rules hold only the items that clash; everything else Safe is applied at once.
 * Failures end the run with the rest skipped and a "do it by hand" problem; nothing is thrown.
 * opts.from 'match': a re-run of steps 4–8 (read and screen are not recorded again).
 */
export async function processItem(
  root: string, id: string, connector: Connector | null | undefined, clock: Clock, opts: { ideaId?: string; from?: 'match' } = {},
): Promise<InboxItem> {
  const first = await load(root, id);
  if (first.status === 'held') return first;
  if (!stepOf(first, 'receive')) {
    await markStep(root, id, { id: 'receive', status: 'done', detail: `${first.name}, ${Math.max(1, Math.round((await sizeOf(root, first)) / 1024))} KB` });
  }
  const fail = async (after: StepId, msg: string) => {
    await skipRest(root, id, after, 'after a failure');
    const had = (await load(root, id)).problems ?? [];
    return updateItem(root, id, { status: 'triaged', problems: had.includes(msg) ? had : [...had, msg] });
  };

  // 2 read, 3 screen (not recorded again on a re-run from match)
  let rs: Awaited<ReturnType<typeof readAndScreen>>;
  try {
    rs = opts.from === 'match'
      ? await readAndScreen(root, id)
      : await timed(root, id, 'read', 'Reading the file…', async () => { const r = await readAndScreen(root, id); return { value: r, detail: readDetail(r.parsed) }; });
  } catch (e) { return fail('read', `Couldn't read this one (${(e as Error).message}), so do it by hand`); }
  // A re-run honours the screen as a first run does: a file that now fails it is held, and nothing else runs.
  if (rs.screened.hold) {
    await markStep(root, id, { id: 'screen', status: 'needs-you', detail: rs.screened.reasons[0] ?? 'Held for you to check' });
    await skipRest(root, id, 'screen', 'held at the screen');
    return holdItem(root, id, rs.screened.reasons, rs.parsed.meta);
  }
  if (opts.from !== 'match') {
    await markStep(root, id, { id: 'screen', status: 'done', detail: rs.screened.reasons.length ? `Flagged: ${rs.screened.reasons[0]}` : 'No personal data' });
  }
  const item = rs.item;

  // 4 match
  let m: MatchStep;
  try { m = await matchStep(root, item, rs.parsed, opts); } catch (e) { return fail('match', `Couldn't match this one (${(e as Error).message}), so do it by hand`); }
  const isExport = rs.parsed.type === 'export';
  await markStep(root, id, {
    id: 'match', status: 'done',
    detail: isExport ? `A form export: ${exportRows(rs.parsed) ?? 'some'} rows` : m.match.ideaId ? `${m.match.ideaId} by ${HOW_WORDS[m.match.how]}` : 'No idea matched yet',
  });

  // 5 understand
  let tr: TriageRecord;
  try {
    tr = await timed(root, id, 'understand', 'Asking the AI…', async () => {
      const t = await understandStep(root, item, rs.parsed, m, connector);
      const status: StepStatus = t.export ? 'skipped' : t.ai ? 'done' : t.aiError ? 'failed' : 'skipped';
      const detail = t.export ? 'A form export: no AI needed' : t.ai ? t.ai.what : t.aiError ? `The AI couldn't help (${t.aiError})` : 'No AI connected: facts by hand';
      return { value: t, detail, status };
    });
  } catch (e) { return fail('understand', `Couldn't sort this one (${(e as Error).message}), so do it by hand`); }
  if (tr.aiError) return fail('understand', `The AI couldn't help (${tr.aiError}), so do this one by hand`);
  if (tr.ask) {
    await markStep(root, id, { id: 'match', status: 'needs-you', detail: `Could be ${tr.candidates.slice(0, 2).map((c) => c.id).join(' or ') || 'any idea'}: pick one` });
    // The AI did run: understand keeps its record; only what follows waits for the pick.
    await skipRest(root, id, 'understand', 'waiting for your pick');
  }

  // plan → conflicts → 6 context, 7 graph, 8 check
  const triaged = await load(root, id);
  let plan: Awaited<ReturnType<typeof planActions>>;
  try { plan = await planActions(root, triaged); } catch (e) { return fail('understand', `Couldn't plan what to do (${(e as Error).message}), so do it by hand`); }
  if (plan.hold) {
    await markStep(root, id, { id: 'context', status: 'needs-you', detail: plan.hold[0] });
    await skipRest(root, id, 'context', 'held');
    return holdItem(root, id, plan.hold);
  }
  const ctx = await conflictContext(root, triaged, tr, m, rs.screened.reasons);
  const { apply, hold } = checkProposals(ctx, plan.actions);
  const kept = recordsOf(triaged).filter((r) => r.status !== 'pending' && r.action.t !== 'ask_idea');
  // Kept records (applied, undone, dropped by you) are not proposed again, nor is what a resolve rewrote.
  const seen = new Set(kept.flatMap((r) => [JSON.stringify(r.action), ...(r.resolvedFrom ? [JSON.stringify(r.resolvedFrom)] : [])]));
  let n = kept.reduce((mx, r) => Math.max(mx, Number(r.id.slice(1)) || 0), 0);
  const needsHand = !!tr.needsHand;
  const fresh: ActionRecord[] = [
    ...apply.filter((a) => !seen.has(JSON.stringify(a))).map((action) => ({ id: `a${++n}`, action, kind: kindOf(action, { needsHand }), status: 'pending' as const, label: labelOf(action) })),
    ...hold.filter((h) => !seen.has(JSON.stringify(h.action))).map((h) => ({
      id: `a${++n}`, action: h.action, kind: 'ok' as const, status: 'pending' as const, label: labelOf(h.action),
      held: { rule: h.rule, why: h.why, ...(h.existing ? { existing: h.existing } : {}), ...(h.node ? { node: h.node } : {}) },
    })),
  ];
  const records = [...kept, ...fresh];
  await updateItem(root, id, { actions: [...records] });
  if (tr.ask) return save(root, triaged, records);
  for (let i = kept.length; i < records.length; i++) if (records[i].kind === 'safe') await applyOne(root, triaged, records, i, clock);
  // Everything applied on this item so far (a re-run keeps what an earlier run applied, and says so).
  const applied = records.filter((r) => r.status === 'applied');
  const ctxApplied = applied.filter((r) => r.action.t !== 'graph_links');
  const graphApplied = applied.filter((r) => r.action.t === 'graph_links');
  await markStep(root, id, { id: 'context', status: ctxApplied.length ? 'done' : 'skipped', detail: ctxApplied.length ? contextDetail(ctxApplied) : 'Nothing to update' });
  await markStep(root, id, { id: 'graph', status: graphApplied.length ? 'done' : 'skipped', detail: graphApplied.length ? graphDetail(graphApplied) : 'No graph facts' });
  const waiting = records.filter((r) => r.status === 'pending' && r.kind === 'ok');
  const w = waiting.length;
  await markStep(root, id, {
    id: 'check', status: w ? 'needs-you' : 'done',
    detail: w ? `${w} item${w === 1 ? '' : 's'} wait${w === 1 ? 's' : ''}: ${waiting[0].held?.why ?? waitingWords(waiting[0].action)}` : 'Done',
  });
  if (tr.ai?.understood?.length && tr.ideaId) {
    // Once per file and understanding: a re-run that understood the same thing adds no second line.
    const dir = await ideaDir(root, tr.ideaId);
    const detail = `Understood: ${tr.ai.understood.join(' · ')}`;
    const last = (await readHistory(dir)).filter((h) => h.source === triaged.file && String(h.detail ?? '').startsWith('Understood: ')).at(-1);
    if (last?.detail !== detail) await appendHistory(dir, { at: clock(), action: 'inbox', by: 'app', detail, source: triaged.file });
  }
  return save(root, triaged, records);
}

/**
 * Store a drop; a repeat (same bytes) returns the first item with only a "Same file" receive step and does
 * nothing else, unless that item never got past "new" (sorting was interrupted): then it is sorted now.
 * The answer is the item as the Inbox shows it (a preview, never the full text or the quoted thread).
 */
export async function processDrop(
  root: string, name: string, data: Uint8Array | string, connector: Connector | null | undefined, clock: Clock,
): Promise<{ item: InboxItem & { preview?: string }; duplicate?: true }> {
  const saved = await saveDrop(root, name, data, clock);
  if (saved.duplicate && saved.status !== 'new') {
    const { duplicate: _d, ...item } = saved;
    const receive: Step = { id: 'receive', status: 'done', at: new Date().toISOString(), detail: `Same file as ${item.name} (dropped ${item.receivedAt.slice(0, 10)})` };
    return { item: { ...viewOf(item), steps: [receive] }, duplicate: true };
  }
  return { item: viewOf(await processItem(root, saved.id, connector, clock)) };
}

/** Run steps 4–8 again (a new pick, or after a fix); what was applied stays applied and is not done twice. */
export async function reprocessItem(
  root: string, id: string, connector: Connector | null | undefined, clock: Clock, opts: { ideaId?: string } = {},
): Promise<InboxItem> {
  const item = await load(root, id);
  if (item.status === 'held') throw new Error('A held item is not read: delete it or draft a reply');
  await resetStepsFrom(root, id, 'match');
  return processItem(root, id, connector, clock, { ...opts, from: 'match' });
}

export type Resolve = 'use-existing' | 'take-file';

/** A held graph_links record as the operator settled it: onto the existing star, or as the file has it. Confirmed either way. */
function resolved(r: ActionRecord, how: Resolve | undefined): ActionRecord {
  if (r.action.t !== 'graph_links') return r;
  const existing = r.held?.existing;
  const links = r.action.links.map((l) => {
    if (how === 'use-existing' && existing) {
      // Only the end that matched the existing star is rewritten; any other new star stays new.
      // (A record held before the matched star was stored: the new "to" end, else the new "from" end.)
      const fresh = new Set((l.newNodes ?? []).map((x) => x.id));
      const node = r.held?.node ?? (fresh.has(l.to) ? l.to : l.from);
      const others = (l.newNodes ?? []).filter((x) => x.id !== node);
      const { newNodes: _n, ...rest } = l;
      return {
        ...rest, ...(others.length ? { newNodes: others } : {}),
        from: l.from === node ? existing : l.from, to: l.to === node ? existing : l.to, status: 'confirmed' as const,
      };
    }
    return { ...l, status: 'confirmed' as const };
  });
  const action = { ...r.action, links };
  // What was proposed stays on the record, so a re-run doesn't propose it again.
  return { ...r, action, label: labelOf(action), resolvedFrom: r.resolvedFrom ?? r.action };
}

export async function applyRecords(
  root: string, id: string, actionIds: string[], clock: Clock, resolve: Record<string, Resolve> = {},
): Promise<InboxItem> {
  const item = await load(root, id);
  if (item.status === 'held') throw new Error('A held item has nothing to apply: delete it or draft a reply asking for counts');
  const records = [...recordsOf(item)];
  if (!actionIds.length) throw new Error('Pick something to apply');
  for (const aid of actionIds) {
    const i = records.findIndex((r) => r.id === aid);
    if (i < 0) throw new Error(`No action ${aid} on this item`);
    if (records[i].status === 'applied' || records[i].status === 'undone') throw new Error(`That one is already ${records[i].status}`);
    if (records[i].action.t === 'ask_idea') throw new Error('Choose the idea first');
  }
  for (const aid of actionIds) {
    const i = records.findIndex((r) => r.id === aid);
    if (records[i].action.t === 'graph_links' && (resolve[aid] || records[i].held)) records[i] = resolved(records[i], resolve[aid]);
    await applyOne(root, item, records, i, clock);
  }
  return save(root, item, records);
}

/** The operator said no to one waiting record: it is kept on the item as dropped, and nothing is changed. */
export async function dropRecord(root: string, id: string, actionId: string): Promise<InboxItem> {
  const item = await load(root, id);
  const records = [...recordsOf(item)];
  const i = records.findIndex((r) => r.id === actionId);
  if (i < 0) throw new Error(`No action ${actionId} on this item`);
  if (records[i].status !== 'pending') throw new Error(`That one is already ${records[i].status}`);
  records[i] = { ...records[i], status: 'undone', note: 'Dropped by you', undoneAt: new Date().toISOString() };
  return save(root, item, records);
}

export async function undoRecord(root: string, id: string, recordId: string, clock: Clock): Promise<InboxItem> {
  const item = await load(root, id);
  const records = [...recordsOf(item)];
  const i = records.findIndex((r) => r.id === recordId);
  records[i] = await undoAction(root, item, recordId, clock);
  await updateItem(root, item.id, { actions: [...records] });
  await logUndo(root, { op: 'undo', item: item.id, record: recordId, t: records[i].action.t, inverse: records[i].inverse });
  return save(root, item, records);
}

export async function chooseIdea(root: string, id: string, ideaId: string, connector: Connector | null | undefined, clock: Clock): Promise<InboxItem> {
  const item = await load(root, id);
  if (item.status === 'held') throw new Error('A held item is not read, so it has no idea to choose');
  // Choosing again after something was applied would file it twice or act on the wrong idea.
  if (recordsOf(item).some((r) => r.status === 'applied')) throw new Error('Undo what was done first');
  const { ideas } = await listIdeas(root);
  if (!ideas.some((i) => i.id === ideaId)) throw new Error(`No idea ${ideaId}`);
  return reprocessItem(root, id, connector, clock, { ideaId });
}

export async function dismissItem(root: string, id: string): Promise<InboxItem> {
  const item = await load(root, id);
  if (item.status === 'held') throw new Error('Delete a held item, or draft a reply asking for counts');
  return updateItem(root, id, { status: 'dismissed' });
}

export async function deleteItem(root: string, id: string): Promise<{ ok: true; id: string }> {
  await deleteHeld(root, id);
  return { ok: true, id };
}

/** The data-held reply (PD): for the idea when the subject or file name names one, else a round-level draft. */
export async function draftHeldReply(root: string, id: string, clock: Clock, chosen?: string): Promise<{ email: EmailRecord }> {
  const item = await load(root, id);
  if (item.status !== 'held') throw new Error('Only held items get the data-held reply');
  const { ideas } = await listIdeas(root);
  const m = matchIdea({ ...item, text: '' }, ideas);
  const ideaId = chosen && ideas.some((i) => i.id === chosen) ? chosen : m.ideaId && m.confidence >= ASK_BELOW ? m.ideaId : undefined;
  if (ideaId) {
    const email = await draftEmail(root, { template: 'PD', ideaId }, clock);
    if (email.status !== 'draft' || !email.body.includes('[FILE NAME]')) return { email };
    return { email: await updateDraft(root, email.key, { body: email.body.replaceAll('[FILE NAME]', item.name) }) };
  }
  return { email: await roundDraft(root, item, clock) };
}

/** draftEmail refuses PD without an idea, so the round-level copy is written here in the Outbox's own format. */
async function roundDraft(root: string, item: InboxItem, clock: Clock): Promise<EmailRecord> {
  const tpl = (await loadTemplates(root)).PD;
  if (!tpl) throw new Error('No template PD');
  const round = await currentRoundId(root);
  const dir = path.join(paths(root).rounds, round, 'emails');
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => /^\d{3}-[A-Z0-9]+\.md$/.test(n)).sort();
  const r = render(tpl, {});
  const rec: Omit<EmailRecord, 'key' | 'body'> = {
    template: 'PD', round, status: 'draft', created: clock(), to: r.to, subject: r.subject.replace(/^\[CAFE ID\]:\s*/, ''),
  };
  const body = r.body.replaceAll('[FILE NAME]', item.name);
  const file = path.join(dir, `${String(names.length + 1).padStart(3, '0')}-PD.md`);
  await writeFileAtomic(file, `---\n${YAML.stringify(rec)}---\n${body}\n`);
  return { ...rec, key: path.relative(root, file).split(path.sep).join('/'), body };
}

export interface InboxView {
  items: (InboxItem & { preview?: string })[];
  counts: { new: number; ok: number; held: number; applied: number };
  problems: string[];
}

/** Items newest first, without their full text (a short preview instead), and the counts for the title bar. */
export async function inboxView(root: string): Promise<InboxView> {
  const problems: string[] = [];
  const all = await listItems(root, problems);
  const counts = { new: 0, ok: 0, held: 0, applied: 0 };
  for (const i of all) {
    if (i.status === 'new') counts.new++;
    else if (i.status === 'triaged') counts.ok++;
    else if (i.status === 'held') counts.held++;
    else if (i.status === 'applied') counts.applied++;
  }
  return { items: all.map((i) => viewOf(i)), counts, problems };
}

/** A step still "running" after this long was cut off (the server stopped mid-run): it is reported as failed. */
export const STRANDED_MS = 180_000;

/** An item without its full text (a short preview instead) or the quoted thread; a stranded running step reads as failed (report only). */
export function viewOf({ text, meta, ...rest }: InboxItem, now = Date.now()): InboxItem & { preview?: string } {
  const { quoted: _q, ...m } = meta ?? {};
  const steps = rest.steps?.map((s) => (s.status === 'running' && now - Date.parse(s.at) > STRANDED_MS ? { ...s, status: 'failed' as const, detail: 'interrupted' } : s));
  return { ...rest, ...(steps ? { steps } : {}), ...(meta ? { meta: m } : {}), ...(text ? { preview: text.slice(0, 400) } : {}) };
}
