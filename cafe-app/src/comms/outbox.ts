import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { plusDays, type Clock } from '../clock';
import { paths } from '../workspace/paths';
import { writeFileAtomic, readText, appendHistory } from '../workspace/files';
import { loadTemplates, render, fillText, analyse } from './templates';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { currentRoundId, loadRound, loadSettings } from '../round/store';
import { withTick } from '../checklist/checklist';
import type { StepDef } from '../rules/stages';

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

async function recordsIn(root: string, dir: string): Promise<EmailRecord[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => FILE_PATTERN.test(n)).sort();
  const out: EmailRecord[] = [];
  for (const n of names) out.push(await load(root, keyOf(root, path.join(dir, n))));
  return out;
}

export async function draftEmail(
  root: string, input: { template: string; ideaId?: string }, clock: Clock,
): Promise<EmailRecord> {
  const tpl = (await loadTemplates(root))[input.template];
  if (!tpl) throw new Error(`No template ${input.template}`);
  if (tpl.to !== 'list' && !input.ideaId) throw new Error(`${tpl.id} is about one idea; pick the idea first`);
  const idea = input.ideaId ? await loadIdea(root, input.ideaId) : undefined;
  const round = idea?.round || (await currentRoundId(root));
  const dir = idea ? path.join(await ideaDir(root, idea.id), 'emails') : path.join(paths(root).rounds, round, 'emails');
  const records = await recordsIn(root, dir);
  const existing = records.find((r) => r.template === tpl.id && r.status !== 'sent');
  if (existing) return existing;

  const seq = String(records.length + 1).padStart(3, '0');
  const r = render(tpl, { idea });
  const rec: EmailRecord = {
    key: keyOf(root, path.join(dir, `${seq}-${tpl.id}.md`)),
    template: tpl.id,
    ...(idea ? { idea: idea.id } : {}),
    round,
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

async function viewOf(root: string, r: EmailRecord): Promise<OutboxItem> {
  const ctx = { round: await loadRound(root, r.round), settings: await loadSettings(root) };
  const view = { to: fillText(r.to, ctx), subject: fillText(r.subject, ctx), body: fillText(r.body, ctx) };
  return { ...r, view, ...analyse(view) };
}

export async function listOutbox(root: string): Promise<OutboxItem[]> {
  const p = paths(root);
  const items: OutboxItem[] = [];
  for (const base of [p.ideas, p.rounds]) {
    for (const name of (await fs.readdir(base).catch(() => [] as string[])).sort()) {
      for (const r of await recordsIn(root, path.join(base, name, 'emails'))) items.push(await viewOf(root, r));
    }
  }
  const order: Record<EmailStatus, number> = { draft: 0, approved: 1, sent: 2 };
  return items.sort((a, b) => order[a.status] - order[b.status] || a.created.localeCompare(b.created) || a.key.localeCompare(b.key));
}

export async function approve(root: string, key: string, clock: Clock): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status !== 'draft') return r;
  const item = await viewOf(root, r);
  if (item.missingSettings.length) throw new MissingSettingsError(item.missingSettings.map((m) => m.label));
  const next: EmailRecord = { ...r, ...item.view, status: 'approved', approvedAt: clock() };
  await save(root, next);
  return next;
}

export async function markSent(root: string, key: string, clock: Clock, steps: StepDef[]): Promise<EmailRecord> {
  const r = await load(root, key);
  if (r.status === 'sent') return r;
  if (r.status !== 'approved') throw new Error('Approve the email before marking it as sent');
  const today = clock();
  if (r.idea) {
    const tpl = (await loadTemplates(root))[r.template];
    const dir = await ideaDir(root, r.idea);
    let idea = await loadIdea(root, r.idea);
    idea = { ...idea, sent: { ...idea.sent, [r.template]: today } };
    if (r.template === 'E2' || r.template === 'E2R') idea = { ...idea, due: { ...idea.due, s2d: plusDays(today, 5) } };
    const step = tpl?.step ? steps.find((s) => s.id === tpl.step) : undefined;
    if (step && !idea.checklist[step.id]?.done) {
      idea = withTick(idea, step, true, 'app', today, key);
      await appendHistory(dir, { at: today, action: 'tick', by: 'app', step: step.id, source: key });
    }
    await saveIdea(root, idea);
    await appendHistory(dir, { at: today, action: 'sent', by: 'operator', detail: r.template, source: key });
  }
  const next: EmailRecord = { ...r, status: 'sent', sentAt: today };
  await save(root, next);
  return next;
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
