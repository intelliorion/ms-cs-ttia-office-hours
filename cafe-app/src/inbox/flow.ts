import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Clock } from '../clock';
import type { Connector } from '../ai/connector';
import { dataKey, fromDataKey, paths } from '../workspace/paths';
import { writeFileAtomic } from '../workspace/files';
import { listIdeas } from '../ideas/store';
import { currentRoundId, NO_ROUND } from '../round/store';
import { loadTemplates, render } from '../comms/templates';
import { draftEmail, updateDraft, type EmailRecord } from '../comms/outbox';
import { saveDrop, getItem, updateItem, holdItem, deleteHeld, listItems, type InboxItem } from './store';
import { readAndScreen, matchStep, understandStep, readDetail, exportRows, HOW_WORDS, TEXT_NOT_KEPT, type TriageRecord, type MatchStep } from './triage';
import { matchIdea, displayName, ASK_BELOW } from './match';
import { kindOf, labelOf, planActions, applyAction, undoAction, logUndo, fingerprint, type Action, type ActionRecord } from './actions';
import { markStep, timed, skipRest, resetStepsFrom, stepOf, type Step, type StepId, type StepStatus, type TrailEntry } from './steps';
import { checkProposals, type ConflictContext } from './conflicts';
import { appendHistory, readHistory } from '../workspace/files';
import { ideaDir } from '../ideas/store';
import { readDesign } from '../design/store';
import { rebuildGraph, readAiLinks } from '../graph/store';
import { extractTask } from '../ai/tasks';
import { extractInput, planAiLinks } from '../ai/apply';
import { loadIdea } from '../ideas/store';

/** Route-level inbox operations. The server runs every one of these behind its POST lock. */

const recordsOf = (item: InboxItem) => (item.actions ?? []) as ActionRecord[];

async function load(root: string, id: string): Promise<InboxItem> {
  const item = await getItem(root, id);
  if (!item) throw new Error(`No such import ${id}`);
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
  const saved = await updateItem(root, item.id, { actions: records, status: statusOf(item, records) });
  // A settled card says so: once the operator applies or drops what waited, "Anything for you" turns Done (and back).
  const check = stepOf(saved, 'check');
  if (check && (check.status === 'needs-you' || check.status === 'done')) {
    const waiting = records.filter((r) => r.status === 'pending' && r.kind === 'ok');
    const w = waiting.length;
    const detail = w ? `${w} item${w === 1 ? '' : 's'} wait${w === 1 ? 's' : ''}: ${waiting[0].held?.why ?? waitingWords(waiting[0].action)}` : 'Done';
    if (detail !== check.detail) return markStep(root, item.id, { id: 'check', status: w ? 'needs-you' : 'done', detail });
  }
  return saved;
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
  try { return (await fs.stat(fromDataKey(root, item.file))).size; } catch { return item.text?.length ?? 0; }
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

  // 2 read, 3 screen (not recorded again on a re-run from match; Run again looks at a picture again, a pick does not)
  // While the AI looks at a picture, the running Read step says so.
  const reading = (detail: string) => markStep(root, id, { id: 'read', status: 'running', detail });
  let rs: Awaited<ReturnType<typeof readAndScreen>>;
  try {
    rs = opts.from === 'match'
      ? await readAndScreen(root, id, connector, undefined, { reuseRead: !!opts.ideaId })
      : await timed(root, id, 'read', 'Reading the file…', async () => {
        const r = await readAndScreen(root, id, connector, reading);
        return { value: r, detail: readDetail(r.parsed, r.aiMs) };
      });
  } catch (e) { return fail('read', `Couldn't read this one (${(e as Error).message}), so do it by hand`); }
  // A re-run honours the screen as a first run does: a file that now fails it is held, and nothing else runs.
  if (rs.screened.hold) {
    const why = rs.screened.reasons[0] ?? 'Held for you to check';
    // A picture's transcription is never stored when it is held, and the detail says so.
    const detail = rs.parsed.meta.readBy === 'ai' ? `${why.replace(/\.?$/, '.')} ${TEXT_NOT_KEPT}` : why;
    await markStep(root, id, { id: 'screen', status: 'needs-you', detail });
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
  const graphBefore = isExport ? await rebuildGraph(root) : null;
  for (let i = kept.length; i < records.length; i++) if (records[i].kind === 'safe') await applyOne(root, triaged, records, i, clock);
  // Everything applied on this item so far (a re-run keeps what an earlier run applied, and says so).
  const applied = records.filter((r) => r.status === 'applied');
  const ctxApplied = applied.filter((r) => r.action.t !== 'graph_links');
  const graphApplied = applied.filter((r) => r.action.t === 'graph_links');
  await markStep(root, id, { id: 'context', status: ctxApplied.length ? 'done' : 'skipped', detail: ctxApplied.length ? contextDetail(ctxApplied) : 'Nothing to update' });
  // An export draws its stars from the form's columns (ideas, teams, people, support asked for): count those too.
  const drawn = graphBefore ? graphDrawn(graphBefore, await rebuildGraph(root)) : null;
  const graphLine = [drawn?.line, graphApplied.length ? graphDetail(graphApplied) : ''].filter(Boolean).join('; ');
  await markStep(root, id, { id: 'graph', status: graphLine ? 'done' : 'skipped', detail: graphLine || 'No graph facts' });
  const created = isExport ? createdIdeas(records) : [];
  if (created.length && connector && (await connector.status()).provider) {
    // The AI reads each new idea's challenge, process and outcomes in the background; the card shows it go.
    await markStep(root, id, { id: 'understand', status: 'running', detail: `Reading the ${created.length} new idea${created.length === 1 ? '' : 's'}…` });
    await markStep(root, id, { id: 'check', status: 'running', detail: 'Waiting for the AI to finish reading' });
    const done = save(root, triaged, records);
    const job = (async () => { await done; await readNewIdeas(root, id, created, connector, clock, drawn?.line ?? ''); })()
      .catch(() => undefined).finally(() => ideaReads.delete(id));
    ideaReads.set(id, job);
    return done;
  }
  if (isExport && created.length) {
    await markStep(root, id, { id: 'understand', status: 'skipped', detail: 'No AI connected: open an idea and use AI suggest links to read it' });
  }
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
 * The answer is the item as the Import shows it (a preview, never the full text or the quoted thread).
 */
/** Background reads of a form export's new ideas, by Import item id (tests and the server await or watch these). */
export const ideaReads = new Map<string, Promise<void>>();

/** The ids an applied form import created. */
function createdIdeas(records: ActionRecord[]): string[] {
  const r = records.find((x) => x.action.t === 'import_export' && x.status === 'applied');
  const report = r?.result as { created?: { id: string }[] } | undefined;
  return (report?.created ?? []).map((c) => c.id);
}

/** What an import added to the graph by itself: "28 stars and 42 links from the form". */
function graphDrawn(before: { nodes: { id: string }[]; edges: { id: string }[] }, after: { nodes: { id: string }[]; edges: { id: string }[] }) {
  const had = new Set(before.nodes.map((n) => n.id)); const hadE = new Set(before.edges.map((e) => e.id));
  const stars = after.nodes.filter((n) => !had.has(n.id)).length; const links = after.edges.filter((e) => !hadE.has(e.id)).length;
  if (!stars && !links) return null;
  return { stars, links, line: `${stars} star${stars === 1 ? '' : 's'} and ${links} link${links === 1 ? '' : 's'} from the form` };
}

/** "2 pain points", "3 capabilities", "1 system": the new stars the AI's links brought, by kind; else the link count. */
function foundWords(records: ActionRecord[]): string[] {
  const links = records.flatMap((r) => (r.action.t === 'graph_links' ? r.action.links : []));
  const by = new Map<string, Set<string>>();
  for (const l of links) for (const x of l.newNodes ?? []) { if (!by.has(x.type)) by.set(x.type, new Set()); by.get(x.type)!.add(x.id); }
  const word: Record<string, [string, string]> = { PainPoint: ['pain point', 'pain points'], Capability: ['capability', 'capabilities'], System: ['system', 'systems'] };
  const out = [...by.entries()].map(([t, ids]) => `${ids.size} ${(word[t] ?? [t.toLowerCase(), `${t.toLowerCase()}s`])[ids.size === 1 ? 0 : 1]}`);
  if (!out.length && links.length) out.push(`${links.length} link${links.length === 1 ? '' : 's'} to stars already there`);
  return out;
}

/**
 * Step 5 for a form export: the AI reads each new idea's challenge, current process and outcomes, and its pain points,
 * capabilities, tools and systems go into the universe confirmed, under the same conflict rules as any dropped file.
 * One idea at a time; the card's steps say how far it has got. An idea the AI could not read is counted, not fatal.
 */
export async function readNewIdeas(root: string, id: string, ideaIds: string[], connector: Connector, clock: Clock, formLine = ''): Promise<void> {
  const n = ideaIds.length; let read = 0; const failed: string[] = [];
  const trail: TrailEntry[] = []; const since = new Date().toISOString(); const t0 = Date.now();
  for (const [k, ideaId] of ideaIds.entries()) {
    const idea = await loadIdea(root, ideaId).catch(() => null);
    if (!idea) { failed.push(ideaId); trail.push({ title: ideaId, found: [], failed: true }); continue; }
    await markStep(root, id, { id: 'understand', status: 'running', detail: `Reading ${idea.title}`, of: [k + 1, n], trail: [...trail], since });
    await markStep(root, id, { id: 'check', status: 'running', detail: 'Waiting for the AI to finish reading' });
    const entry: TrailEntry = { title: idea.title, found: [] };
    try {
      const before = await rebuildGraph(root);
      const { provider, output } = await connector.runWith(extractTask, extractInput(idea, before.nodes));
      const planned = planAiLinks(idea.id, output, before, (await readAiLinks(root)).links, provider, { status: 'confirmed' });
      if (planned.links.length) {
        const item = await load(root, id);
        const { ideas } = await listIdeas(root);
        const ctx: ConflictContext = {
          idea, ideas, nodes: before.nodes, peoplePresent: [], design: await readDesign(root, idea.id).catch(() => null),
          match: { ideaId: idea.id, confidence: 1, candidates: [idea.id] }, aiIdeaId: idea.id, screened: [],
        };
        const { apply, hold } = checkProposals(ctx, [{ t: 'graph_links', ideaId: idea.id, links: planned.links }]);
        const records = [...recordsOf(item)];
        let m = records.reduce((mx, r) => Math.max(mx, Number(r.id.slice(1)) || 0), 0);
        const start = records.length;
        for (const action of apply) records.push({ id: `a${++m}`, action, kind: kindOf(action), status: 'pending', label: labelOf(action) });
        for (const h of hold) {
          records.push({
            id: `a${++m}`, action: h.action, kind: 'ok', status: 'pending', label: labelOf(h.action),
            held: { rule: h.rule, why: h.why, ...(h.existing ? { existing: h.existing } : {}), ...(h.node ? { node: h.node } : {}) },
          });
        }
        await updateItem(root, id, { actions: [...records] });
        for (let i = start; i < records.length; i++) if (records[i].kind === 'safe') await applyOne(root, item, records, i, clock);
        entry.found = foundWords(records.slice(start).filter((r) => r.status === 'applied'));
        if (hold.length) entry.held = hold.length;
      }
      read++;
    } catch {
      failed.push(ideaId);
      entry.failed = true;
    }
    trail.push(entry);
    await markStep(root, id, { id: 'understand', status: 'running', detail: k + 1 < n ? 'Moving to the next idea' : 'Finishing up', of: [k + 1, n], trail: [...trail], since });
    const sofar = recordsOf(await load(root, id)).filter((r) => r.status === 'applied' && r.action.t === 'graph_links');
    await markStep(root, id, { id: 'graph', status: 'running', detail: [formLine, sofar.length ? graphDetail(sofar) : ''].filter(Boolean).join('; ') || 'Reading…' });
  }
  const item = await load(root, id);
  const records = [...recordsOf(item)];
  // The AI's links wrote a history line in each idea; the import's Undo compares fingerprints, so take them again now.
  const imp = records.findIndex((r) => r.action.t === 'import_export' && r.status === 'applied' && r.inverse?.t === 'remove-ideas');
  if (imp >= 0) {
    const inv = records[imp].inverse as Extract<NonNullable<ActionRecord['inverse']>, { t: 'remove-ideas' }>;
    const prints: Record<string, string> = { ...inv.prints };
    for (const ideaId of inv.ids) { const dir = await ideaDir(root, ideaId).catch(() => undefined); if (dir) prints[ideaId] = await fingerprint(dir); }
    records[imp] = { ...records[imp], inverse: { ...inv, prints } };
    await updateItem(root, id, { actions: [...records] });
  }
  const ai = records.filter((r) => r.status === 'applied' && r.action.t === 'graph_links');
  await markStep(root, id, {
    id: 'understand', status: read ? 'done' : 'failed', ms: Date.now() - t0, of: [n, n], trail,
    detail: read === n ? `Read all ${n} new idea${n === 1 ? '' : 's'}` : `Read ${read} of ${n} new ideas; the AI couldn't read ${failed.join(', ')} (use AI suggest links on ${failed.length === 1 ? 'it' : 'them'})`,
  });
  const graphLine = [formLine, ai.length ? graphDetail(ai) : ''].filter(Boolean).join('; ');
  await markStep(root, id, { id: 'graph', status: graphLine ? 'done' : 'skipped', detail: graphLine || 'No graph facts' });
  const waiting = records.filter((r) => r.status === 'pending' && r.kind === 'ok');
  const w = waiting.length;
  await markStep(root, id, {
    id: 'check', status: w ? 'needs-you' : 'done',
    detail: w ? `${w} item${w === 1 ? '' : 's'} wait${w === 1 ? 's' : ''}: ${waiting[0].held?.why ?? waitingWords(waiting[0].action)}` : 'Done',
  });
  await save(root, item, records);
}

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
  // Undoing a form import also takes back the AI's links on the ideas it removed (they would point at nothing).
  if (records[i].action.t === 'import_export') {
    for (let j = 0; j < records.length; j++) {
      const r = records[j];
      if (r.status !== 'applied' || r.action.t !== 'graph_links') continue;
      if (await ideaDir(root, r.action.ideaId).then(() => true, () => false)) continue;
      try {
        records[j] = await undoAction(root, { ...item, actions: records }, r.id, clock);
        await updateItem(root, item.id, { actions: [...records] });
        await logUndo(root, { op: 'undo', item: item.id, record: r.id, t: r.action.t, inverse: records[j].inverse });
      } catch { /* a link someone else also added stays */ }
    }
  }
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
  if (!round) throw new Error(NO_ROUND);
  const dir = path.join(paths(root).rounds, round, 'emails');
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => /^\d{3}-[A-Z0-9]+\.md$/.test(n)).sort();
  const r = render(tpl, {});
  const rec: Omit<EmailRecord, 'key' | 'body'> = {
    template: 'PD', round, status: 'draft', created: clock(), to: r.to, subject: r.subject.replace(/^\[CAFE ID\]:\s*/, ''),
  };
  const body = r.body.replaceAll('[FILE NAME]', item.name);
  const file = path.join(dir, `${String(names.length + 1).padStart(3, '0')}-PD.md`);
  await writeFileAtomic(file, `---\n${YAML.stringify(rec)}---\n${body}\n`);
  return { ...rec, key: dataKey(root, file), body };
}

export interface InboxView {
  items: (InboxItem & { preview?: string; previewCut?: true })[];
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

/** How much of an item's text the Import shows; previewCut says there is more in the file. */
export const PREVIEW_CHARS = 400;

/** An item without its full text (a short preview instead) or the quoted thread; a stranded running step reads as failed (report only). */
export function viewOf({ text, meta, ...rest }: InboxItem, now = Date.now()): InboxItem & { preview?: string; previewCut?: true } {
  const { quoted: _q, ...m } = meta ?? {};
  // Nothing left waiting (an older card saved before the check refreshed itself) reads as Done.
  const settled = !((rest.actions ?? []) as ActionRecord[]).some((r) => r.status === 'pending' && r.kind === 'ok');
  const steps = rest.steps?.map((s) => (s.status === 'running' && now - Date.parse(s.at) > STRANDED_MS ? { ...s, status: 'failed' as const, detail: 'interrupted' }
    : s.id === 'check' && s.status === 'needs-you' && settled && rest.status !== 'held' ? { ...s, status: 'done' as const, detail: 'Done' } : s));
  const cut = !!text && text.length > PREVIEW_CHARS;
  return {
    ...rest, ...(steps ? { steps } : {}), ...(meta ? { meta: m } : {}),
    ...(text ? { preview: text.slice(0, PREVIEW_CHARS) } : {}), ...(cut ? { previewCut: true as const } : {}),
  };
}
