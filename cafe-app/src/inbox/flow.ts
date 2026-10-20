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
import { triageItem, type TriageRecord } from './triage';
import { matchIdea, ASK_BELOW } from './match';
import { kindOf, labelOf, planActions, applyAction, undoAction, logUndo, type ActionRecord } from './actions';

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

/** Triage, plan the actions and apply the Safe ones. AI failures leave it needing a hand; nothing is thrown. */
export async function processItem(
  root: string, id: string, connector: Connector | null | undefined, clock: Clock, opts: { ideaId?: string } = {},
): Promise<InboxItem> {
  let item: InboxItem;
  try {
    item = await triageItem(root, id, connector, opts);
  } catch (e) {
    const before = await load(root, id);
    return updateItem(root, id, { status: 'triaged', problems: [...(before.problems ?? []), `Couldn't sort this one (${(e as Error).message}), so do it by hand`] });
  }
  if (item.status === 'held') return item;
  let plan: Awaited<ReturnType<typeof planActions>>;
  try {
    plan = await planActions(root, item);
  } catch (e) {
    return updateItem(root, id, { status: 'triaged', problems: [...(item.problems ?? []), `Couldn't plan what to do (${(e as Error).message}), so do it by hand`] });
  }
  if (plan.hold) return holdItem(root, id, plan.hold);

  const kept = recordsOf(item).filter((r) => r.status !== 'pending' && r.action.t !== 'ask_idea');
  let n = kept.reduce((m, r) => Math.max(m, Number(r.id.slice(1)) || 0), 0);
  const needsHand = !!(item.triage as TriageRecord | undefined)?.needsHand;
  const fresh: ActionRecord[] = plan.actions.map((action) => ({
    id: `a${++n}`, action, kind: kindOf(action, { needsHand }), status: 'pending', label: labelOf(action),
  }));
  const records = [...kept, ...fresh];
  await updateItem(root, id, { actions: [...records] });
  for (let i = kept.length; i < records.length; i++) if (records[i].kind === 'safe') await applyOne(root, item, records, i, clock);
  return save(root, item, records);
}

/** Store a drop; a repeat (same bytes) returns the first item and does nothing else. */
export async function processDrop(
  root: string, name: string, data: Uint8Array | string, connector: Connector | null | undefined, clock: Clock,
): Promise<{ item: InboxItem; duplicate?: true }> {
  const saved = await saveDrop(root, name, data, clock);
  if (saved.duplicate) return { item: saved, duplicate: true };
  return { item: await processItem(root, saved.id, connector, clock) };
}

export async function applyRecords(root: string, id: string, actionIds: string[], clock: Clock): Promise<InboxItem> {
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
  for (const aid of actionIds) await applyOne(root, item, records, records.findIndex((r) => r.id === aid), clock);
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
  return processItem(root, id, connector, clock, { ideaId });
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
  const items = all.map(({ text, meta, ...rest }) => {
    const { quoted: _q, ...m } = meta ?? {};
    return { ...rest, ...(meta ? { meta: m } : {}), ...(text ? { preview: text.slice(0, 400) } : {}) };
  });
  return { items, counts, problems };
}
