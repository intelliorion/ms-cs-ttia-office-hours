import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { plusDays, type Clock } from '../clock';
import { dataKey, fromDataKey, paths } from '../workspace/paths';
import { writeFileAtomic, readText, appendHistory } from '../workspace/files';
import { loadTemplates, render, fillText, analyse } from './templates';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { currentRoundId, listRounds, loadRound, loadSettings, NO_ROUND } from '../round/store';
import { TOKENS, type Round } from '../round/round';
import { withTick } from '../checklist/checklist';
import { loadSteps, type StepDef } from '../rules/stages';
import { suggestion, type StageTarget, type Suggest } from '../ideas/suggest';
import { toEml, emlName } from './eml';

export type EmailStatus = 'draft' | 'approved' | 'sent';

export interface EmailRecord {
  key: string;
  template: string;
  idea?: string;
  round: string;
  status: EmailStatus;
  created: string;
  approvedAt?: string;
  sentAt?: string;
  to: string;
  subject: string;
  body: string;
  /** Set when it was opened in Outlook (and so counted as sent): what Undo puts back. */
  opened?: { approved: boolean; sent?: string; due?: string; ticked?: string };
}

export interface OutboxItem extends EmailRecord {
  view: { to: string; subject: string; body: string };
  /** The stage the email belongs to (from its template's step); none for a round email. */
  stage?: number;
  /** Unsent, but a newer unsent email of the same stage has taken its place (made before one-per-stage). */
  superseded?: boolean;
  missingSettings: { token: string; label: string }[];
  contentPlaceholders: string[];
}

/** The move a sent email suggests. The operator decides; nothing moves on its own. */
export const SENT_SUGGESTS: Record<string, StageTarget> = {
  E3: { stage: 3 }, E4: { closeAs: 'reuse' }, E5: { closeAs: 'csic' }, E6: { closeAs: 'notnow' }, E10: { stage: 4 },
};

export class MissingSettingsError extends Error {
  constructor(public readonly labels: string[]) {
    super(`Set first: ${labels.join(', ')}`);
  }
}

const KEY_PATTERN = /^(ideas|rounds)\/[A-Za-z0-9._-]+\/emails\/\d{3}-[A-Z0-9]+\.md$/;
const FILE_PATTERN = /^\d{3}-[A-Z0-9]+\.md$/;

function fileOf(root: string, key: string): string {
  if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error(`Not an Outbox item: ${key}`);
  return fromDataKey(root, key);
}

const keyOf = (root: string, file: string) => dataKey(root, file);

function serialize(r: EmailRecord): string {
  const { key: _key, body, ...meta } = r;
  return `---\n${YAML.stringify(meta)}---\n${body}\n`;
}

function parseRecord(text: string, key: string): EmailRecord {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error(`${key}: missing front matter`);
  return { ...(YAML.parse(m[1]) as Omit<EmailRecord, 'key' | 'body'>), key, body: m[2].replace(/\n$/, '') };
}

async function load(root: string, key: string): Promise<EmailRecord> {
  const text = await readText(fileOf(root, key));
  if (text === undefined) throw new Error(`No Outbox item ${key}`);
  return parseRecord(text, key);
}

const save = (root: string, r: EmailRecord) => writeFileAtomic(fileOf(root, r.key), serialize(r));

export interface OutboxProblem {
  file: string;
  message: string;
}

/** Reads every email in a folder; a file that cannot be read is reported, not thrown. */
async function recordsIn(root: string, dir: string): Promise<{ records: EmailRecord[]; problems: OutboxProblem[]; count: number }> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => FILE_PATTERN.test(n)).sort();
  const records: EmailRecord[] = [];
  const problems: OutboxProblem[] = [];
  for (const n of names) {
    const key = keyOf(root, path.join(dir, n));
    try {
      records.push(await load(root, key));
    } catch (e) {
      problems.push({ file: key, message: (e as Error).message });
    }
  }
  return { records, problems, count: names.length };
}

/** The stage an email belongs to, from its template's step (the reminder E2R goes with E2). None for an email with no step. */
export function templateStage(templates: Record<string, { step?: string }>, steps: StepDef[], id: string): number | undefined {
  const step = templates[id === 'E2R' ? 'E2' : id]?.step;
  return step ? steps.find((s) => s.id === step)?.stage : undefined;
}

export async function draftEmail(
  root: string, input: { template: string; ideaId?: string; round?: string }, clock: Clock,
): Promise<EmailRecord> {
  const templates = await loadTemplates(root);
  const tpl = templates[input.template];
  if (!tpl) throw new Error(`No template ${input.template}`);
  if (tpl.to !== 'list' && !input.ideaId) throw new Error(`${tpl.id} is about one idea; pick the idea first`);
  const idea = input.ideaId ? await loadIdea(root, input.ideaId) : undefined;
  // An idea's emails follow the idea's own round, which may be none yet; a round-wide email goes to the round asked
  // for, else the current one.
  if (!idea && input.round && !(await listRounds(root)).some((r) => r.id === input.round)) throw new Error(`No round ${input.round}`);
  const round = idea ? idea.round : input.round || await currentRoundId(root);
  if (!idea && !round) throw new Error(NO_ROUND);
  const dir = idea ? path.join(await ideaDir(root, idea.id), 'emails') : path.join(paths(root).rounds, round!, 'emails');
  const { records, count } = await recordsIn(root, dir);
  const existing = records.find((r) => r.template === tpl.id && r.status !== 'sent');
  // One unsent email per stage: a newer one (another decision, say) replaces what was waiting from the same stage.
  if (idea && !existing) {
    const steps = await loadSteps(root);
    const stage = templateStage(templates, steps, tpl.id);
    const stale = stage === undefined ? [] : records.filter((r) => r.status !== 'sent' && r.template !== tpl.id && templateStage(templates, steps, r.template) === stage);
    for (const r of stale) {
      await fs.unlink(fileOf(root, r.key)).catch(() => undefined);
      await appendHistory(await ideaDir(root, idea.id), { at: clock(), action: 'replaced', by: 'app', detail: `${r.template} replaced by ${tpl.id}`, source: r.key });
    }
  }
  if (existing) {
    // An idea may have changed round since this draft was made; the draft follows it.
    if (idea && existing.status === 'draft' && existing.round !== round) {
      const moved = { ...existing, round: round ?? '' };
      await save(root, moved);
      return moved;
    }
    return existing;
  }

  const seq = String(count + 1).padStart(3, '0');
  const r = render(tpl, { idea });
  const rec: EmailRecord = {
    key: keyOf(root, path.join(dir, `${seq}-${tpl.id}.md`)),
    template: tpl.id,
    ...(idea ? { idea: idea.id } : {}),
    round: round ?? '',
    status: 'draft',
    created: clock(),
    to: r.to,
    subject: r.subject,
    body: r.body,
  };
  await save(root, rec);
  if (idea) await appendHistory(await ideaDir(root, idea.id), { at: clock(), action: 'draft', by: 'app', detail: tpl.id, source: rec.key });
  return rec;
}

export const NO_ROUND_NOTE = 'Put this idea in a round to fill the dates';

/** The round whose dates fill an email: an idea's draft follows the idea's round now; anything else keeps its own. */
async function roundOf(root: string, r: EmailRecord): Promise<string> {
  if (!r.idea || r.status !== 'draft') return r.round;
  return loadIdea(root, r.idea).then((i) => i.round, () => r.round);
}

async function viewOf(root: string, stored: EmailRecord): Promise<OutboxItem> {
  const r = { ...stored, round: await roundOf(root, stored) };
  // No round yet: the round's dates stay as tokens, and the note says how to fill them.
  const round: Partial<Round> = r.round ? await loadRound(root, r.round).catch(() => ({})) : {};
  const ctx = { round, settings: await loadSettings(root) };
  const view = { to: fillText(r.to, ctx), subject: fillText(r.subject, ctx), body: fillText(r.body, ctx) };
  const found = analyse(view);
  if (r.round) return { ...r, view, ...found };
  // The round's dates become one note, in the place of the first of them.
  const firstDate = found.missingSettings.find((m) => TOKENS[m.token]?.from === 'round');
  const missingSettings = found.missingSettings
    .filter((m) => m === firstDate || TOKENS[m.token]?.from !== 'round')
    .map((m) => (m === firstDate ? { ...m, label: NO_ROUND_NOTE } : m));
  return { ...r, view, ...found, missingSettings };
}

export async function listOutbox(root: string): Promise<OutboxItem[]> {
  return (await listOutboxChecked(root)).items;
}

export async function listOutboxChecked(root: string): Promise<{ items: OutboxItem[]; problems: OutboxProblem[] }> {
  const p = paths(root);
  const items: OutboxItem[] = [];
  const problems: OutboxProblem[] = [];
  for (const base of [p.ideas, p.rounds]) {
    for (const name of (await fs.readdir(base).catch(() => [] as string[])).sort()) {
      const found = await recordsIn(root, path.join(base, name, 'emails'));
      problems.push(...found.problems);
      for (const r of found.records) items.push(await viewOf(root, r));
    }
  }
  // One unsent email per stage: an older one still waiting from before that rule is marked, newest wins.
  const templates = await loadTemplates(root);
  const steps = await loadSteps(root);
  const newest = new Map<string, OutboxItem>();
  for (const m of items) {
    const stage = m.idea ? templateStage(templates, steps, m.template) : undefined;
    if (stage !== undefined) m.stage = stage;
    if (!m.idea || stage === undefined || m.status === 'sent') continue;
    const k = `${m.idea}|${stage}`; const was = newest.get(k);
    if (!was || `${m.created}|${m.key}` > `${was.created}|${was.key}`) { if (was) was.superseded = true; newest.set(k, m); } else m.superseded = true;
  }
  const order: Record<EmailStatus, number> = { draft: 0, approved: 1, sent: 2 };
  items.sort((a, b) => order[a.status] - order[b.status] || a.created.localeCompare(b.created) || a.key.localeCompare(b.key));
  return { items, problems };
}

export async function approve(root: string, key: string, clock: Clock): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status !== 'draft') return r;
  const item = await viewOf(root, r);
  if (item.missingSettings.length) throw new MissingSettingsError(item.missingSettings.map((m) => m.label));
  // Approval freezes the text and the round it was filled from.
  const next: EmailRecord = { ...r, round: item.round, ...item.view, status: 'approved', approvedAt: clock() };
  await save(root, next);
  return next;
}

export async function markSent(
  root: string, key: string, clock: Clock, steps: StepDef[],
): Promise<EmailRecord & { suggest?: Suggest }> {
  const r = await load(root, key);
  if (r.status === 'sent') return r;
  if (r.status !== 'approved') throw new Error('Approve the email before marking it as sent');
  const today = clock();
  let suggest: Suggest | undefined;
  if (r.idea) {
    const tpl = (await loadTemplates(root))[r.template];
    const dir = await ideaDir(root, r.idea);
    let idea = await loadIdea(root, r.idea);
    let ticked: string | undefined;
    idea = { ...idea, sent: { ...idea.sent, [r.template]: today } };
    if (r.template === 'E2' || r.template === 'E2R') idea = { ...idea, due: { ...idea.due, s2d: plusDays(today, 5) } };
    const step = tpl?.step ? steps.find((s) => s.id === tpl.step) : undefined;
    if (step && !idea.checklist[step.id]?.done) {
      idea = withTick(idea, step, true, 'app', today, key);
      ticked = step.id;
    }
    await saveIdea(root, idea);
    if (ticked) await appendHistory(dir, { at: today, action: 'tick', by: 'app', step: ticked, source: key });
    await appendHistory(dir, { at: today, action: 'sent', by: 'operator', detail: r.template, source: key });
    suggest = suggestion(idea, SENT_SUGGESTS[r.template]);
  }
  const next: EmailRecord = { ...r, status: 'sent', sentAt: today };
  await save(root, next);
  return suggest ? { ...next, suggest } : next;
}

export async function updateDraft(
  root: string, key: string, patch: { subject?: unknown; body?: unknown },
): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status !== 'draft') throw new Error('Only drafts can be edited');
  const next: EmailRecord = {
    ...r,
    ...(typeof patch.subject === 'string' ? { subject: patch.subject } : {}),
    ...(typeof patch.body === 'string' ? { body: patch.body } : {}),
  };
  await save(root, next);
  return next;
}

/**
 * Open in Outlook: approve the email (its text and the round's dates are fixed), hand it back as an Outlook draft
 * file, and count it as sent, since the app cannot see Outlook. What it changed is kept on the email for Undo.
 */
export async function openEmail(
  root: string, key: string, clock: Clock, steps: StepDef[],
): Promise<{ email: EmailRecord; eml: string; filename: string; suggest?: Suggest }> {
  let r = await load(root, key);
  if (r.status === 'sent') {
    // Already sent: open it again for reference, with nothing counted twice.
    return { email: r, eml: toEml(r), filename: emlName(r.template, r.subject) };
  }
  const approved = r.status === 'approved';
  const before = r.idea ? await loadIdea(root, r.idea) : undefined;
  if (!approved) r = await approve(root, key, clock);
  const sent = await markSent(root, key, clock, steps);
  const { suggest, ...email } = sent;
  let opened: NonNullable<EmailRecord['opened']> = { approved };
  if (before && r.idea) {
    const after = await loadIdea(root, r.idea);
    const ticked = Object.keys(after.checklist).find((k) => after.checklist[k]?.done && !before.checklist[k]?.done && after.checklist[k]?.source === key);
    opened = {
      approved,
      ...(before.sent[r.template] ? { sent: before.sent[r.template] } : {}),
      ...(before.due.s2d ? { due: before.due.s2d } : {}),
      ...(ticked ? { ticked } : {}),
    };
  }
  const saved: EmailRecord = { ...email, opened };
  await save(root, saved);
  return { email: saved, eml: toEml(saved), filename: emlName(saved.template, saved.subject), ...(suggest ? { suggest } : {}) };
}

/** Undo "opened in Outlook": the email is a draft again (or approved, if it was), and the idea is as it was. */
export async function unopenEmail(root: string, key: string, clock: Clock): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status !== 'sent' || !r.opened) throw new Error('Only an email just opened in Outlook can be undone');
  const { opened, sentAt: _s, ...rest } = r;
  const next: EmailRecord = opened.approved ? { ...rest, status: 'approved' } : (({ approvedAt: _a, ...d }) => ({ ...d, status: 'draft' as const }))(rest);
  if (r.idea) {
    const idea = await loadIdea(root, r.idea);
    const sent = { ...idea.sent };
    if (opened.sent) sent[r.template] = opened.sent; else delete sent[r.template];
    const due = { ...idea.due };
    if (r.template === 'E2' || r.template === 'E2R') { if (opened.due) due.s2d = opened.due; else delete due.s2d; }
    const checklist = { ...idea.checklist };
    if (opened.ticked && checklist[opened.ticked]?.source === key) delete checklist[opened.ticked];
    await saveIdea(root, { ...idea, sent, due, checklist });
    await appendHistory(await ideaDir(root, r.idea), { at: clock(), action: 'unsent', by: 'operator', detail: r.template, source: key });
  }
  await save(root, next);
  return next;
}
