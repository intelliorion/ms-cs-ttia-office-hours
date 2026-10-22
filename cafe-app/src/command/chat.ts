import path from 'node:path';
import { readText, writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from '../graph/store';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { commandTask, COMMAND_MAX } from '../ai/tasks';
import type { Connector } from '../ai/connector';
import type { Clock } from '../clock';
import { hideNames, showNames } from './names';
import { STAGE_NAMES } from '../rules/stages';
import { nodeId } from '../graph/ontology';

/** Enough for a programme's universe; past this a question is answered from the first stars and links only. */
const MAX_STARS = 1500;
const MAX_LINKS = 4000;
import { applyAction, resolveSteps, undoAction, type CommandAction, type CommandInverse } from './actions';

export interface ChatAction {
  id: string; label: string; action: CommandAction;
  status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed';
  inverse?: CommandInverse; note?: string;
}
/** One command and what came of it. The operator's own words stay here, on this machine; the AI only saw them with names coded. */
export interface ChatEntry {
  id: string; at: string; text: string; reply: string; provider?: string;
  /** How the agent read the message: a change to make, a question to answer, or neither. */
  kind?: 'command' | 'question' | 'unclear';
  /** For a question: the stars the answer rests on, lit in the universe. */
  highlight?: string[];
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
  // Every star gets a code, so a question can be answered from the whole universe; people stay codes only.
  const hidden = hideNames(command, graph.nodes, { all: true });
  const codeOf = new Map([...hidden.codes].map(([c, v]) => [v.id, c]));
  const roundName = new Map(rounds.map((r) => [r.id, r.name]));
  const input = {
    command: hidden.text, stars: hidden.legend.slice(0, MAX_STARS),
    links: graph.edges.slice(0, MAX_LINKS).flatMap((e) => (codeOf.has(e.from) && codeOf.has(e.to) ? [[codeOf.get(e.from)!, e.rel, codeOf.get(e.to)!] as [string, string, string]] : [])),
    ideas: ideas.flatMap((i) => {
      const code = codeOf.get(`idea:${i.id}`);
      if (!code) return [];
      // Roles live on the idea, not on the links: the submitter, then each team member with their role, people as codes.
      const people = [
        ...(i.people.submitter ? [{ name: i.people.submitter, role: 'submitter' }] : []),
        ...i.people.team.map((p) => ({ name: p.name, role: p.role })),
      ].flatMap((p) => { const pc = codeOf.get(nodeId('Person', p.name)); return pc ? [{ code: pc, role: p.role }] : []; });
      return [{ code, stage: STAGE_NAMES[i.stage], function: i.function, region: i.region, round: roundName.get(i.round), people }];
    }),
  };
  const entry: ChatEntry = { id, at: clock(), text: command, reply: '', actions: [], problems: [] };
  try {
    const { provider, output } = await ai.runWith(commandTask, input);
    entry.provider = provider;
    entry.kind = output.kind;
    entry.reply = showNames(output.reply, hidden.codes);
    if (output.kind === 'command') {
      const { proposals, problems } = resolveSteps(output.actions, { codes: hidden.codes, graph, ideas, rounds });
      entry.actions = proposals.map((p, i) => ({ id: `a${i + 1}`, label: p.label, action: p.action, status: 'proposed' }));
      entry.problems = problems;
    } else if (output.kind === 'question') {
      // A question never changes anything: any actions the AI sent with it are dropped. Only stars that exist are lit.
      const ids = new Set(graph.nodes.map((n) => n.id));
      const idOf = (c: string) => hidden.codes.get(c.replace(/^\[|\]$/g, ''))?.id;
      const lit = (output.highlight ?? []).map(idOf);
      // "Related to X": X and every star linked to it, worked out here so the list is complete.
      for (const centre of (output.around ?? []).map(idOf)) {
        if (!centre) continue;
        lit.push(centre);
        for (const e of graph.edges) { if (e.from === centre) lit.push(e.to); else if (e.to === centre) lit.push(e.from); }
      }
      entry.highlight = [...new Set(lit.filter((x): x is string => !!x && ids.has(x)))];
    }
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
