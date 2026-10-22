import path from 'node:path';
import { readText, writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from '../graph/store';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { answerTask, commandTask, COMMAND_MAX, type AnswerInput } from '../ai/tasks';
import type { Connector } from '../ai/connector';
import type { Clock } from '../clock';
import { codeFor, hideNames, showNames } from './names';
import { STAGE_NAMES } from '../rules/stages';
import { QUERY_SCHEMA, runQuery, type Query, type QueryResult, type StepTrace } from './query';
import { validate } from '../ai/schema';
import { applyAction, resolveSteps, undoAction, type CommandAction, type CommandInverse } from './actions';

export interface ChatAction {
  id: string; label: string; action: CommandAction;
  status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed';
  inverse?: CommandInverse; note?: string;
}
/** One command and what came of it. The operator's own words stay here, on this machine; the AI only saw them with names coded. */
export interface ChatEntry {
  id: string; at: string; text: string; reply: string; provider?: string;
  /** The idea or star on screen when the message was sent. */
  about?: string;
  /** How the agent read the message: a change to make, a question to answer, or neither. */
  kind?: 'command' | 'question' | 'unclear';
  /** For a question: every star the queries passed through, lit in the universe. */
  highlight?: string[];
  /** For a question: how each query found its answer, step by step, with how many stars each step left. */
  trace?: StepTrace[][];
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
/** How many stars of each query the AI sees when it words an answer; the total is always given. */
const ANSWER_STARS = 60;
/** How many stars light up at most. */
const LIT_MAX = 150;

export async function runCommand(root: string, text: string, ai: Connector, clock: Clock, focusId?: string, mentionIds: string[] = []): Promise<ChatEntry> {
  const command = text.trim().slice(0, COMMAND_MAX);
  if (!command) throw new Error('Type a command first');
  const all = await readChat(root);
  const id = `c${Math.max(0, ...all.map((e) => Number(e.id.slice(1)) || 0)) + 1}`;
  const graph = await rebuildGraph(root);
  const [{ ideas }, rounds] = await Promise.all([listIdeas(root), listRounds(root)]);
  // @mentions name a star exactly: each "@Label" becomes that star's code, whatever else the text matches.
  const mentioned = [...new Set(mentionIds)].map((mid) => graph.nodes.find((n) => n.id === mid)).filter((n): n is NonNullable<typeof n> => !!n);
  let pre = command;
  mentioned.forEach((n, i) => { pre = pre.split(`@${n.label}`).join(`\u0000${i}\u0000`); });
  const hidden = hideNames(pre, graph.nodes);
  mentioned.forEach((n, i) => {
    const known = [...hidden.codes].find(([, v]) => v.id === n.id)?.[0];
    const code = known ?? codeFor(hidden.codes, n);
    if (!known) hidden.legend.push(n.type === 'Person' ? { code, type: n.type } : { code, type: n.type, label: n.label });
    hidden.text = hidden.text.split(`\u0000${i}\u0000`).join(`[${code}]`);
  });
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].sort();
  const vocabulary = {
    stages: Object.values(STAGE_NAMES), functions: uniq(ideas.map((i) => i.function)), regions: uniq(ideas.map((i) => i.region)), rounds: rounds.map((r) => r.name),
  };
  // What the operator has on screen, so "this" and "it" mean something; a person stays a code.
  const focusNode = focusId ? graph.nodes.find((n) => n.id === focusId) : undefined;
  let focus: string | undefined;
  if (focusNode) {
    const known = [...hidden.codes].find(([, v]) => v.id === focusNode.id)?.[0];
    focus = known ?? codeFor(hidden.codes, focusNode);
    if (!known) hidden.legend.push(focusNode.type === 'Person' ? { code: focus, type: focusNode.type } : { code: focus, type: focusNode.type, label: focusNode.label });
  }
  const entry: ChatEntry = { id, at: clock(), text: command, reply: '', actions: [], problems: [], ...(focusNode ? { about: focusNode.label } : {}) };
  try {
    const { provider, output } = await ai.runWith(commandTask, { command: hidden.text, stars: hidden.legend, vocabulary, ...(focus ? { focus } : {}) });
    entry.provider = provider;
    entry.kind = output.kind;
    entry.reply = showNames(output.reply, hidden.codes);
    if (output.kind === 'command') {
      const { proposals, problems } = resolveSteps(output.actions, { codes: hidden.codes, graph, ideas, rounds });
      entry.actions = proposals.map((p, i) => ({ id: `a${i + 1}`, label: p.label, action: p.action, status: 'proposed' }));
      entry.problems = problems;
    } else if (output.kind === 'question') {
      // The answer comes from the graph: the app runs the AI's queries, and the AI only words what they found.
      // A question never changes anything: any actions sent with it are dropped.
      const queries = (output.queries ?? []).filter((q): q is Query => validate(QUERY_SCHEMA, q).length === 0);
      const bad = (output.queries?.length ?? 0) - queries.length;
      if (bad) entry.problems.push(`${bad} of the AI's searches ${bad === 1 ? 'was' : 'were'} malformed and left out.`);
      if (!queries.length) { entry.problems = [...entry.problems, "I couldn't turn that into a search of the universe. Try naming the stars or ideas you mean."]; return finish(root, all, entry); }
      const idOf = (c: string) => hidden.codes.get(c.replace(/^\[|\]$/g, ''))?.id;
      const results: QueryResult[] = queries.map((q) => runQuery(q, { graph, ideas, rounds, idOf }));
      entry.trace = results.map((r) => r.trace);
      entry.highlight = [...new Set(results.flatMap((r) => r.touched))].slice(0, LIT_MAX);
      const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
      const coded = (sid: string) => codeFor(hidden.codes, nodes.get(sid)!);
      const legend = (sid: string) => { const n = nodes.get(sid)!; const c = coded(sid); return n.type === 'Person' ? { code: c, type: n.type } : { code: c, type: n.type, label: n.label }; };
      const answerIn: AnswerInput = {
        question: hidden.text,
        results: results.map((r) => ({
          stars: r.final.slice(0, ANSWER_STARS).map(legend), total: r.final.length,
          ...(r.ranked ? { ranked: r.ranked.map((x) => ({ code: coded(x.id), links: x.n })) } : {}),
          ...(r.counts ? { counts: r.counts } : {}),
          ...(r.path ? { path: r.path.map(coded) } : {}),
        })),
      };
      const answered = await ai.runWith(answerTask, answerIn);
      entry.reply = showNames(answered.output.answer, hidden.codes);
    }
  } catch (e) {
    entry.error = `The AI couldn't read that (${(e as Error).message}). Try again, or make the change by hand.`;
  }
  return finish(root, all, entry);
}

/** Only the latest command is shown, so nothing earlier may sit waiting out of sight. */
async function finish(root: string, all: ChatEntry[], entry: ChatEntry): Promise<ChatEntry> {
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
export async function doActions(root: string, id: string, actionId: string | undefined, clock: Clock, ai?: Connector): Promise<ChatEntry> {
  const entry = await entryOf(root, id);
  for (const a of entry.actions) {
    if (a.status !== 'proposed' || (actionId && a.id !== actionId)) continue;
    try {
      const r = await applyAction(root, a.action, clock, ai);
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
