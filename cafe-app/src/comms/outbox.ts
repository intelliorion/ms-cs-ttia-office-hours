import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { plusDays, type Clock } from '../clock';
import { paths } from '../workspace/paths';
import { writeFileAtomic, readText, appendHistory } from '../workspace/files';
import { loadTemplates, render, fillText, analyse } from './templates';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { currentRoundId, loadRound, loadSettings, NO_ROUND } from '../round/store';
import { TOKENS, type Round } from '../round/round';
import { withTick } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';
import { suggestion, type StageTarget, type Suggest } from '../ideas/suggest';

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
}

export interface OutboxItem extends EmailRecord {
  view: { to: string; subject: string; body: string };
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
  return path.join(root, ...key.split('/'));
}

const keyOf = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

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

export async function draftEmail(
  root: string, input: { template: string; ideaId?: string }, clock: Clock,
): Promise<EmailRecord> {
  const tpl = (await loadTemplates(root))[input.template];
  if (!tpl) throw new Error(`No template ${input.template}`);
  if (tpl.to !== 'list' && !input.ideaId) throw new Error(`${tpl.id} is about one idea; pick the idea first`);
  const idea = input.ideaId ? await loadIdea(root, input.ideaId) : undefined;
  // An idea's emails follow the idea's own round, which may be none yet; a round-wide email needs a round.
  const round = idea ? idea.round : await currentRoundId(root);
  if (!idea && !round) throw new Error(NO_ROUND);
  const dir = idea ? path.join(await ideaDir(root, idea.id), 'emails') : path.join(paths(root).rounds, round!, 'emails');
  const { records, count } = await recordsIn(root, dir);
  const existing = records.find((r) => r.template === tpl.id && r.status !== 'sent');
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
