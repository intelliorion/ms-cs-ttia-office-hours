import path from 'node:path';
import { readText, writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from '../graph/store';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { commandTask, COMMAND_MAX } from '../ai/tasks';
import type { Connector } from '../ai/connector';
import type { Clock } from '../clock';
import { hideNames, showNames } from './names';
import { applyAction, resolveSteps, undoAction, type CommandAction, type CommandInverse } from './actions';

export interface ChatAction {
  id: string; label: string; action: CommandAction;
  status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed';
  inverse?: CommandInverse; note?: string;
}
/** One command and what came of it. The operator's own words stay here, on this machine; the AI only saw them with names coded. */
export interface ChatEntry {
  id: string; at: string; text: string; reply: string; provider?: string;
  actions: ChatAction[]; problems: string[]; error?: string;
}

const file = (root: string) => path.join(root, 'chat', 'log.jsonl');

export async function readChat(root: string): Promise<ChatEntry[]> {
  const out: ChatEntry[] = [];
  for (const line of ((await readText(file(root))) ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as ChatEntry); } catch { /* skipped */ }
  }
  return out;
}
async function writeChat(root: string, entries: ChatEntry[]): Promise<void> {
  await writeFileAtomic(file(root), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}
async function save(root: string, entry: ChatEntry): Promise<ChatEntry> {
  const all = await readChat(root);
  const i = all.findIndex((e) => e.id === entry.id);
  if (i === -1) all.push(entry); else all[i] = entry;
  await writeChat(root, all);
  return entry;
}

/**
 * Runs a command: names the app knows are coded before the AI sees the text, the AI proposes steps, the app checks
 * each one and records proposals for the operator to do or cancel. Nothing changes here.
 */
export async function runCommand(root: string, text: string, ai: Connector, clock: Clock): Promise<ChatEntry> {
  const command = text.trim().slice(0, COMMAND_MAX);
  if (!command) throw new Error('Type a command first');
  const all = await readChat(root);
  const id = `c${Math.max(0, ...all.map((e) => Number(e.id.slice(1)) || 0)) + 1}`;
  const graph = await rebuildGraph(root);
  const [{ ideas }, rounds] = await Promise.all([listIdeas(root), listRounds(root)]);
  const hidden = hideNames(command, graph.nodes);
  const entry: ChatEntry = { id, at: clock(), text: command, reply: '', actions: [], problems: [] };
  try {
    const { provider, output } = await ai.runWith(commandTask, { command: hidden.text, stars: hidden.legend });
    const { proposals, problems } = resolveSteps(output.actions, { codes: hidden.codes, graph, ideas, rounds });
    entry.provider = provider;
    entry.reply = showNames(output.reply, hidden.codes);
    entry.actions = proposals.map((p, i) => ({ id: `a${i + 1}`, label: p.label, action: p.action, status: 'proposed' }));
    entry.problems = problems;
  } catch (e) {
    entry.error = `The AI couldn't read that (${(e as Error).message}). Try again, or make the change by hand.`;
  }
  // Only the latest command is shown, so nothing earlier may sit waiting out of sight.
  for (const old of all) for (const a of old.actions) if (a.status === 'proposed') { a.status = 'cancelled'; a.note = 'A newer command replaced it'; }
  await writeChat(root, all);
  return save(root, entry);
}

async function entryOf(root: string, id: string): Promise<ChatEntry> {
  const e = (await readChat(root)).find((x) => x.id === id);
  if (!e) throw new Error(`No command ${id}`);
  return e;
}

/** Does one proposed action, or all of them when no action id is given. */
export async function doActions(root: string, id: string, actionId: string | undefined, clock: Clock): Promise<ChatEntry> {
  const entry = await entryOf(root, id);
  for (const a of entry.actions) {
    if (a.status !== 'proposed' || (actionId && a.id !== actionId)) continue;
    try {
      const r = await applyAction(root, a.action, clock);
      a.status = 'done'; a.inverse = r.inverse; if (r.note) a.note = r.note;
    } catch (e) { a.status = 'failed'; a.note = (e as Error).message; }
  }
  await rebuildGraph(root);
  return save(root, entry);
}

export async function cancelActions(root: string, id: string, actionId: string | undefined): Promise<ChatEntry> {
  const entry = await entryOf(root, id);
  for (const a of entry.actions) if (a.status === 'proposed' && (!actionId || a.id === actionId)) a.status = 'cancelled';
  return save(root, entry);
}

export async function undoChatAction(root: string, id: string, actionId: string, clock: Clock): Promise<ChatEntry> {
  const entry = await entryOf(root, id);
  const a = entry.actions.find((x) => x.id === actionId);
  if (!a || a.status !== 'done') throw new Error('Only a done action can be undone');
  if (!a.inverse) throw new Error(a.note ?? 'This one cannot be undone here');
  const kept = await undoAction(root, a.inverse, clock);
  if (kept) a.note = kept; else a.status = 'undone';
  await rebuildGraph(root);
  return save(root, entry);
}
