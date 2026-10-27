import path from 'node:path';
import { paths } from '../workspace/paths';
import { readText, writeFileAtomic } from '../workspace/files';
import { rebuildGraph } from '../graph/store';
import { loadIdea } from '../ideas/store';
import { listIdeas } from '../ideas/store';
import { listRounds } from '../round/store';
import { agentTask, AGENT_MAX_STEPS, COMMAND_MAX, type AgentOutput, type AgentStepDone } from '../ai/tasks';
import type { Connector } from '../ai/connector';
import type { Clock } from '../clock';
import { nodeId, type GNode } from '../graph/ontology';
import { codeFor, hideNames, showNames, type Coded, type LegendEntry } from './names';
import { maskEmails } from '../data/check';
import { STAGE_NAMES } from '../rules/stages';
import { QUERY_SCHEMA, plainReply, revealDerived, runQuery, type Query, type QueryResult, type StepTrace } from './query';
import { validate } from '../ai/schema';
import { applyAction, resolveSteps, undoAction, type CommandAction, type CommandInverse } from './actions';
import { prepareMemory } from '../memory/lookup';
import { indexAvailable, summary as memorySummary } from '../memory/index';
import { loadRegistry } from '../graph/registryFile';
import { graphChanges } from '../graph/diff';

export interface ChatAction {
  id: string; label: string; action: CommandAction;
  status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed';
  inverse?: CommandInverse; note?: string;
}
/** One step the agent took for a message, as the operator sees it. */
export interface ChatStep { kind: 'search' | 'read'; text: string; found?: number }
/** One message and what came of it. The operator's own words stay here, on this machine; the AI only saw them with names coded. */
export interface ChatEntry {
  id: string; thread: string; at: string; ts: number; text: string; reply: string; provider?: string;
  /** The idea or star on screen when the message was sent. */
  about?: string;
  /** How the agent read the message: a change to make, a question to answer, or neither. */
  kind?: 'command' | 'question' | 'unclear';
  /** The steps the agent took: each search with how many stars it found, each idea it read. */
  steps?: ChatStep[];
  /** For a question: every star the searches found, lit in the universe. */
  highlight?: string[];
  /** For a question: how each search found its answer, step by step, with how many stars each step left. */
  trace?: StepTrace[][];
  /** Follow-up questions the agent suggests, as the operator would type them. */
  followups?: string[];
  actions: ChatAction[]; problems: string[]; error?: string;
  /** What the AI saw and said, in codes: the conversation it gets next time. */
  coded?: { text: string; reply: string; found?: string[] };
}
/** A conversation: its title, when it was last used, and the codes and last answer it carries forward. */
export interface ChatThread { id: string; title: string; started: string; updated: number; codes: [string, Coded][]; last: string[] }

const dir = (root: string) => paths(root).chat;
const logFile = (root: string) => path.join(dir(root), 'log.jsonl');
const threadsFile = (root: string) => path.join(dir(root), 'threads.json');

export async function readChat(root: string): Promise<ChatEntry[]> {
  const out: ChatEntry[] = [];
  for (const line of ((await readText(logFile(root))) ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { const e = JSON.parse(line) as ChatEntry; out.push({ ...e, thread: e.thread ?? 't0', ts: e.ts ?? 0 }); } catch { /* skipped */ }
  }
  return out;
}
async function writeChat(root: string, entries: ChatEntry[]): Promise<void> {
  await writeFileAtomic(logFile(root), entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}
async function save(root: string, entry: ChatEntry): Promise<ChatEntry> {
  const all = await readChat(root);
  const i = all.findIndex((e) => e.id === entry.id);
  if (i === -1) all.push(entry); else all[i] = entry;
  await writeChat(root, all);
  return entry;
}
export async function readThreads(root: string): Promise<ChatThread[]> {
  try { const v = JSON.parse((await readText(threadsFile(root))) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
async function saveThread(root: string, t: ChatThread): Promise<void> {
  const all = (await readThreads(root)).filter((x) => x.id !== t.id);
  await writeFileAtomic(threadsFile(root), JSON.stringify([...all, t], null, 1));
}

/** The conversations, most recent first, for the list; and one conversation with its messages. */
export async function listThreads(root: string): Promise<{ id: string; title: string; updated: number; count: number }[]> {
  const [threads, entries] = await Promise.all([readThreads(root), readChat(root)]);
  return threads.sort((a, b) => b.updated - a.updated).slice(0, 30)
    .map((t) => ({ id: t.id, title: t.title, updated: t.updated, count: entries.filter((e) => e.thread === t.id).length }));
}
export async function readThread(root: string, id: string): Promise<{ thread: { id: string; title: string } | null; entries: ChatEntry[] }> {
  const t = (await readThreads(root)).find((x) => x.id === id);
  return { thread: t ? { id: t.id, title: t.title } : null, entries: t ? (await readChat(root)).filter((e) => e.thread === id) : [] };
}

/** How many earlier exchanges the agent sees with each message. */
const HISTORY = 6;
/** How many stars of a search the agent sees; the total is always given. */
const RESULT_STARS = 60;
/** How many stars light up at most. */
const LIT_MAX = 150;
/** How much of a passage the agent sees. */
const HIT_MAX = 500;

export type Progress = { stage: 'thinking'; step: number } | { stage: 'step'; step: ChatStep };
export interface RunOptions {
  /** What is on screen: one star ("this"), or several picked with Ctrl/⌘+click ("these"). */
  focus?: string | string[]; mentions?: string[];
  /** The conversation to continue; a new one is started when it is absent or unknown. */
  thread?: string;
  progress?: (p: Progress) => void;
  /** Set when the operator presses Stop: the agent finishes the step it is on and stops. */
  stopped?: () => boolean;
}

/**
 * The Café assistant. Names the app knows are coded before the AI sees anything; the agent then works in steps:
 * it searches the knowledge graph or reads an idea's text, sees what came back, and decides the next step, until it
 * answers, proposes changes (each checked by the app and waiting for Do it) or asks what was meant. Nothing changes here.
 */
export async function runCommand(root: string, text: string, ai: Connector, clock: Clock, opts: RunOptions = {}): Promise<ChatEntry> {
  const message = text.trim().slice(0, COMMAND_MAX);
  if (!message) throw new Error('Type a message first');
  const all = await readChat(root);
  const threads = await readThreads(root);
  const now = Date.now();
  const thread: ChatThread = threads.find((t) => t.id === opts.thread)
    ?? { id: `t${Math.max(0, ...threads.map((t) => Number(t.id.slice(1)) || 0)) + 1}`, title: message.slice(0, 60), started: clock(), updated: now, codes: [], last: [] };
  const id = `c${Math.max(0, ...all.map((e) => Number(e.id.slice(1)) || 0)) + 1}`;
  const graph = await rebuildGraph(root);
  const [{ ideas }, rounds] = await Promise.all([listIdeas(root), listRounds(root)]);
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  // Names to code: every star, plus people the ideas' records name who are not stars yet (a builder named in an email).
  const known = new Set(graph.nodes.filter((n) => n.type === 'Person').map((n) => n.label));
  const extraPeople: GNode[] = [...new Set(ideas.flatMap((i) => [i.people.submitter, ...i.people.team.map((p) => p.name)]))]
    .filter((x): x is string => !!x?.trim() && !known.has(x)).map((label) => ({ id: nodeId('Person', label), type: 'Person', label }));
  // A person picked with @ as "＋ New person" is coded like any other, so their name never reaches the AI.
  const newPeople: GNode[] = (opts.mentions ?? []).filter((m) => m.startsWith('new-person:'))
    .map((m) => m.slice('new-person:'.length).trim()).filter((x) => x && !known.has(x))
    .map((label) => ({ id: nodeId('Person', label), type: 'Person', label }));
  const codable = [...graph.nodes, ...extraPeople, ...newPeople];
  for (const n of [...extraPeople, ...newPeople]) if (!nodes.has(n.id)) nodes.set(n.id, n);

  // @mentions name a star exactly: each "@Label" becomes that star's code, whatever else the text matches.
  const mentioned = [...new Set(opts.mentions ?? [])].map((m) => nodes.get(m.startsWith('new-person:') ? nodeId('Person', m.slice('new-person:'.length).trim()) : m)).filter((n): n is GNode => !!n);
  let pre = message;
  mentioned.forEach((n, i) => { pre = pre.split(`@${n.label}`).join(`\u0000${i}\u0000`); });
  // The conversation's codes carry forward, so a star keeps its code from message to message.
  // Email addresses go as <email> first, as in every other AI call (the data step's mask).
  const hidden = hideNames(maskEmails(pre), codable, { seed: new Map(thread.codes) });
  const legendOf = (n: GNode): LegendEntry => {
    const code = codeFor(hidden.codes, n);
    return n.type === 'Person' ? { code, type: n.type } : { code, type: n.type, label: n.label };
  };
  const addToLegend = (n: GNode) => {
    const e = legendOf(n);
    if (!hidden.legend.some((x) => x.code === e.code)) hidden.legend.push(e);
    return e.code;
  };
  mentioned.forEach((n, i) => { hidden.text = hidden.text.split(`\u0000${i}\u0000`).join(`[${addToLegend(n)}]`); });
  const focusNodes = (Array.isArray(opts.focus) ? opts.focus : opts.focus ? [opts.focus] : []).map((f) => nodes.get(f)).filter((n): n is GNode => !!n);
  const focusNode = focusNodes.length === 1 ? focusNodes[0] : undefined;
  const focusCodes = focusNodes.map(addToLegend);
  const focus = focusCodes.length > 1 ? focusCodes : focusCodes[0];
  /** An idea's text, with every name the app knows swapped for the conversation's code. */
  const coded = (s: unknown) => {
    const t = String(s ?? '');
    if (!t) return t;
    const h = hideNames(maskEmails(t), codable, { seed: hidden.codes });
    for (const [c, v] of h.codes) if (!hidden.codes.has(c)) hidden.codes.set(c, v);
    return h.text;
  };

  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))].sort();
  const vocabulary = {
    stages: Object.values(STAGE_NAMES), functions: uniq(ideas.map((i) => i.function)), regions: uniq(ideas.map((i) => i.region)), rounds: rounds.map((r) => r.name),
  };
  // Deep read: when its index exists the agent is told where it stands (the search and similar steps work, and are prepared per query);
  // the summary is file reads only, once per message, and names the ideas whose text changed since they were read.
  const available = await indexAvailable(root);
  const mem = available ? await memorySummary(root) : undefined;
  const staleIdeas = new Set((mem?.ideas ?? []).filter((i) => i.status !== 'read').map((i) => i.id));
  const lastRead = (mem?.ideas ?? []).map((i) => i.lastRead).filter((t): t is string => !!t).sort().at(-1);
  const deepRead = { on: available, percent: mem?.percent ?? 0, staleIdeas: staleIdeas.size, ...(lastRead ? { lastRead } : {}) };
  const history = all.filter((e) => e.thread === thread.id && e.coded).slice(-HISTORY)
    .map((e) => ({ operator: e.coded!.text, agent: e.coded!.reply, ...(e.coded!.found?.length ? { found: e.coded!.found } : {}) }));

  const entry: ChatEntry = {
    id, thread: thread.id, at: clock(), ts: now, text: message, reply: '', actions: [], problems: [], steps: [],
    ...(focusNode ? { about: focusNode.label } : focusNodes.length > 1 ? { about: `${focusNodes.length} selected: ${focusNodes.map((n) => n.label).join(', ')}` } : {}),
  };
  const done: AgentStepDone[] = [];
  const results: QueryResult[] = [];
  /** The trace, step by step in order: each search's lines, and a line for each step that was not run or was sent back. */
  const traces: { trace: StepTrace[]; aside?: QueryResult['aside'] }[] = [];
  /** A step that was not run: the AI is told why, and the trace says so in the same words. */
  const refuse = (did: AgentStepDone['did'], thought: string, error: string) => {
    done.push({ did, thought, result: { error } });
    traces.push({ trace: [{ text: `Not run: ${error}`, size: 0 }] });
  };
  /** Each check that sends a final answer back runs once per message. */
  const sentBack = new Set<'steps' | 'team'>();
  const label = (id: string) => nodes.get(id)?.label ?? id;
  const codeName = (id: string) => { const n = nodes.get(id); return n ? `[${codeFor(hidden.codes, n)}]` : id; };
  /** A final answer sent back: the AI sees why as a step that was not run, the trace says it was asked again. */
  const refuseFinal = (error: string, line: string) => {
    done.push({ did: 'search', thought: 'Answer sent back by the app', result: { error } });
    traces.push({ trace: [{ text: `Asked again: ${line}`, size: 0 }] });
  };
  /** The team stars a coded text names that no step of this message returned (nor the message itself named). */
  const teamsNotReturned = (text: string): string[] => {
    const seen = new Set<string>();
    for (const r of results) {
      for (const id of [...r.touched, ...r.final]) seen.add(id);
      for (const g of r.groups ?? []) { seen.add(g.from); g.to.forEach((t) => seen.add(t)); }
      for (const p of r.people ?? []) p.teams.forEach((t) => seen.add(t));
      for (const x of r.reasons ?? []) { seen.add(x.from); seen.add(x.to); }
    }
    for (const n of focusNodes) seen.add(n.id);
    const named = new Set([...hidden.text.matchAll(/\[([A-Z]+\d+)\]/g)].map((m) => hidden.codes.get(m[1])?.id));
    return [...new Set([...text.matchAll(/\[([A-Z]+\d+)\]/g)].map((m) => hidden.codes.get(m[1])?.id).filter((id): id is string => !!id))]
      .filter((id) => nodes.get(id)?.type === 'Team' && !seen.has(id) && !named.has(id));
  };
  /** The queries run for this message, so an identical one is not run again. */
  const ran: string[] = [];
  let lastFound: string[] = thread.last;
  let finalReply = '';
  try {
    for (let step = 0; ; step++) {
      if (opts.stopped?.()) { entry.error = 'Stopped. Nothing was changed.'; break; }
      const left = AGENT_MAX_STEPS - step;
      if (left <= 0) { entry.problems.push('I ran out of steps before I could finish. Try asking a narrower question.'); break; }
      opts.progress?.({ stage: 'thinking', step });
      const ask = (stepsLeft: number, note?: string) => ai.runWith(agentTask, {
        ...(history.length ? { history } : {}), message: hidden.text, ...(focus ? { focus } : {}),
        stars: hidden.legend, vocabulary, steps: done, stepsLeft, deepRead, ...(note ? { note } : {}),
      });
      const asked = await ask(left);
      const provider = asked.provider;
      let output: AgentOutput = asked.output;
      entry.provider = provider;
      // An answer with no reply: asked once more for the reply alone, from the steps already run (no new steps).
      const silent = (o: AgentOutput) => (o.next === 'answer' || o.next === 'clarify' ? !o.reply?.trim() : o.next === 'propose' ? !o.reply?.trim() && !o.answer?.trim() : false);
      if (silent(output)) {
        const again = (await ask(1, `your last step chose ${output.next} with no reply. Write the reply now from the steps already run; take no new step.`)).output;
        if (again.next === output.next || again.next === 'answer') output = again;
      }
      // A final answer that claims the step budget is spent while steps remain: sent back once, to take the step it skipped.
      if (output.next === 'answer' && left > 1 && !sentBack.has('steps') && /\b(ran|run|running) out of steps\b|\bstep limit\b|\bno steps left\b|\bout of steps\b/i.test(output.reply ?? '')) {
        sentBack.add('steps');
        refuseFinal(`You have ${left - 1} steps left: you did not run out of steps. Take the step you skipped, then answer.`, `the answer said it ran out of steps with ${left - 1} left`);
        continue;
      }
      // A reply that names a team no step returned: sent back once to follow OWNS (the team comes from a step, never from memory).
      const unreturned = output.next === 'answer' ? teamsNotReturned(`${output.reply ?? ''}`) : [];
      if (unreturned.length && !sentBack.has('team')) {
        sentBack.add('team');
        if (left > 1) {
          refuseFinal(`Your reply names ${unreturned.map((t) => `[${codeFor(hidden.codes, nodes.get(t)!)}]`).join(', ')}, which no step returned: follow OWNS (dir in, type Team) from the ideas before saying which team owns them.`, `the answer named ${unreturned.map(label).join(', ')}, which no step returned`);
          continue;
        }
        traces.push({ trace: [{ text: `Not from a step: the reply names ${unreturned.map(label).join(', ')}, which no step in this message returned`, size: 0 }] });
      }
      const thought = showNames(output.thought, hidden.codes);

      if (output.next === 'search') {
        const errs = validate(QUERY_SCHEMA, output.query);
        if (errs.length) { refuse('search', output.thought, `The query was malformed: ${errs.slice(0, 3).join('; ')}`); continue; }
        // The same steps again: not run, not traced twice; the agent is told its result is already in steps.
        const key = JSON.stringify(output.query);
        if (ran.includes(key)) { refuse('search', output.thought, 'You already ran this exact search: its result is in steps above. Use it, or search differently (one hop more, or a search of the text).'); continue; }
        ran.push(key);
        const memory = available ? await prepareMemory(root, output.query as Query, graph) : undefined;
        const r = runQuery(output.query as Query, { graph, ideas, rounds, idOf: (c) => hidden.codes.get(c.replace(/^\[|\]$/g, ''))?.id, last: lastFound, ...(memory ? { memory } : {}) });
        // A hit from an idea whose text changed since it was read: said in the trace; upkeep re-reads it, never this reply.
        const stale = [...new Set((r.hits ?? []).map((h) => h.ideaId).filter((id) => staleIdeas.has(id)))];
        for (const id of stale) r.trace.push({ text: `${id.replace(/^CAFE-/, '')} changed since it was read`, size: 1 });
        results.push(r);
        traces.push({ trace: r.trace, ...(r.aside ? { aside: r.aside } : {}) });
        lastFound = r.final;
        const s: ChatStep = { kind: 'search', text: thought, found: r.final.length };
        entry.steps!.push(s); opts.progress?.({ stage: 'step', step: s });
        done.push({
          did: 'search', thought: output.thought,
          result: {
            stars: r.final.slice(0, RESULT_STARS).map((sid) => legendOf(nodes.get(sid)!)), total: r.final.length,
            ...(r.ranked ? { ranked: r.ranked.map((x) => ({ code: codeFor(hidden.codes, nodes.get(x.id)!), count: x.n })) } : {}),
            ...(r.counts ? { counts: r.counts } : {}),
            // A grouped follow: which stars each star of the set reached, so the reply can answer per capability.
            ...(r.groups ? { groups: r.groups.map((g) => ({ from: codeFor(hidden.codes, nodes.get(g.from)!), to: g.to.map((id) => codeFor(hidden.codes, nodes.get(id)!)) })) } : {}),
            ...(r.path ? { path: r.path.map((sid) => codeFor(hidden.codes, nodes.get(sid)!)) } : {}),
            // Why each derived link held (SIMILAR_TO: the shared stars), so the reply can give the reason, not just the pair.
            ...(r.reasons ? { reasons: r.reasons.map((x) => ({ from: codeFor(hidden.codes, nodes.get(x.from)!), to: codeFor(hidden.codes, nodes.get(x.to)!), rel: x.rel, why: coded(x.why) })) } : {}),
            // A role step's facts: each person's role word per idea and their team, so the reply can state them, never guess.
            ...(r.people ? { people: r.people.map((p) => ({ code: codeFor(hidden.codes, nodes.get(p.id)!), roles: p.roles.map((x) => ({ idea: codeFor(hidden.codes, nodes.get(x.idea)!), role: x.role })), team: p.teams.map((t) => codeFor(hidden.codes, nodes.get(t)!)).join(', ') || 'no team recorded' })) } : {}),
            // Deep read's passages, names coded like an idea's text, with the idea and section each came from.
            ...(r.hits ? { hits: r.hits.slice(0, 12).map((h) => ({ idea: codeFor(hidden.codes, nodes.get(`idea:${h.ideaId}`)!), section: h.section, text: coded(h.text).slice(0, HIT_MAX) })) } : {}),
            ...(stale.length ? { stale: stale.map((id) => codeFor(hidden.codes, nodes.get(`idea:${id}`)!)) } : {}),
            // A scoped search's reading of the records (current process …) for the ideas with no such passage: quote each.
            ...(r.records ? { records: r.records.map((x) => ({ idea: codeFor(hidden.codes, nodes.get(x.idea)!), field: x.field, text: coded(x.text).slice(0, HIT_MAX) })) } : {}),
          },
        });
      } else if (output.next === 'read_idea') {
        const ideaId = output.idea ? hidden.codes.get(output.idea.replace(/^\[|\]$/g, ''))?.id : undefined;
        const idea = ideas.find((i) => `idea:${i.id}` === ideaId);
        if (!idea) { refuse('read_idea', output.thought, 'No idea has that code.'); continue; }
        const s: ChatStep = { kind: 'read', text: thought };
        entry.steps!.push(s); opts.progress?.({ stage: 'step', step: s });
        done.push({
          did: 'read_idea', thought: output.thought,
          result: {
            idea: codeFor(hidden.codes, nodes.get(`idea:${idea.id}`)!), title: idea.title, challenge: coded(idea.challenge), current_process: coded(idea.current_process),
            outcomes: idea.outcomes, business_impact: coded(idea.business_impact), beneficiaries: idea.beneficiaries, additional_context: coded(idea.additional_context),
            answers: ((idea as { answers?: { question: string; answer: string }[] }).answers ?? []).slice(-20).map((a) => ({ question: a.question, answer: coded(a.answer) })),
          },
        });
      } else {
        finalReply = output.reply ?? '';
        // A message with a question in it as well: the answer to the question, kept apart from what the AI says about the change.
        const answer = output.next === 'propose' && output.answer ? showNames(output.answer, hidden.codes).trim() : '';
        // Never the planner's note: with no reply after asking again, a plain reply from what the steps found.
        if (!finalReply.trim() && !(output.next === 'propose' && output.answer?.trim())) {
          finalReply = plainReply(results, codeName, coded) || (output.next === 'clarify' ? 'What would you like me to change, or what would you like to know?' : 'I could not put the answer into words; the steps above show what the graph holds.');
        }
        entry.reply = showNames(finalReply, hidden.codes);
        if (output.next === 'answer') {
          entry.kind = 'question';
          if (output.followups?.length) entry.followups = output.followups.map((f) => showNames(f, hidden.codes));
        } else if (output.next === 'propose') {
          // The AI proposes; the app checks every action against the graph and the ideas before it shows a card.
          entry.kind = 'command';
          const { proposals, problems } = resolveSteps(output.actions ?? [], { codes: hidden.codes, graph: { nodes: [...nodes.values()], edges: graph.edges }, ideas, rounds, registry: await loadRegistry(root), ...(focusNode?.type === 'Idea' ? { focusIdea: focusNode.id.slice(5) } : {}) });
          entry.actions = proposals.map((p, i) => ({ id: `a${i + 1}`, label: p.label, action: p.action, status: 'proposed' }));
          entry.problems.push(...problems);
          // Nothing to apply: the reply is the question's answer (when the message asked one) and then what stood in the way, never the AI's sentence claiming a change it did not propose.
          if (!proposals.length && problems.length) entry.reply = [answer, ...problems].filter(Boolean).join(' ');
          // The resolver changed what the AI asked for (an add became a link): said after the AI's words and the answer, so the cards never contradict them.
          else entry.reply = [entry.reply.trim(), answer, ...proposals.map((p) => p.note).filter((n): n is string => !!n)].filter(Boolean).join(' ');
          if (answer) finalReply = [finalReply, output.answer].filter(Boolean).join(' ');
        } else {
          entry.kind = 'unclear';
        }
        break;
      }
    }
  } catch (e) {
    entry.error = `The AI couldn't finish that (${(e as Error).message}). Try again, or make the change by hand.`;
  }
  // The derived links the reply relies on (both ends named in it) come back from behind "and N more".
  if (traces.length) entry.trace = traces.map((t) => revealDerived(t.trace, t.aside, entry.reply, label));
  if (results.length) entry.highlight = [...new Set(results.flatMap((r) => r.touched))].slice(0, LIT_MAX);
  entry.coded = { text: hidden.text, reply: finalReply, ...(results.length ? { found: lastFound.slice(0, RESULT_STARS).map((sid) => codeFor(hidden.codes, nodes.get(sid)!)) } : {}) };
  await saveThread(root, { ...thread, updated: now, codes: [...hidden.codes], last: lastFound });
  // Changes left waiting in other conversations are not shown any more: cancel them, saying why.
  for (const old of all) if (old.thread !== thread.id) for (const a of old.actions) if (a.status === 'proposed') { a.status = 'cancelled'; a.note = 'A new conversation replaced it'; }
  await writeChat(root, all);
  return save(root, entry);
}

async function entryOf(root: string, id: string): Promise<ChatEntry> {
  const e = (await readChat(root)).find((x) => x.id === id);
  if (!e) throw new Error(`No message ${id}`);
  return e;
}

/** Does one proposed action, or all of them when no action id is given. */
/** What a Do or an Undo changed in the graph, and one line for the operator. Returned with the entry, never logged. */
export interface Changed { nodes: string[]; edges: string[]; note: string }
const ROLE_TITLE: Record<string, string> = { lead: 'Lead', builder: 'Builder', sponsor: 'Sponsor', member: 'Member' };
/** "Alex Wang → Lead on Procurement FAQ bot" for a role; the card's own words for anything else. */
async function changeLine(root: string, a: ChatAction): Promise<string> {
  const x = a.action;
  if (x.t !== 'role') return a.label;
  const title = (await loadIdea(root, x.ideaId).catch(() => undefined))?.title ?? x.ideaId;
  if (x.role === null) return `${x.person} off ${title}`;
  return x.drop ? `${x.person} no longer ${x.role} on ${title}` : `${x.person} → ${ROLE_TITLE[x.role] ?? x.role} on ${title}`;
}

export async function doActions(root: string, id: string, actionId: string | undefined, clock: Clock, ai?: Connector): Promise<ChatEntry & { changed: Changed }> {
  const entry = await entryOf(root, id);
  const before = await rebuildGraph(root);
  const lines: string[] = [];
  for (const a of entry.actions) {
    if (a.status !== 'proposed' || (actionId && a.id !== actionId)) continue;
    try {
      const r = await applyAction(root, a.action, clock, ai);
      a.status = 'done'; a.inverse = r.inverse; if (r.note) a.note = r.note;
      lines.push(await changeLine(root, a));
    } catch (e) { a.status = 'failed'; a.note = (e as Error).message; }
  }
  const after = await rebuildGraph(root);
  const saved = await save(root, entry);
  return { ...saved, changed: { ...graphChanges(before, after), note: lines.length ? `Updated: ${lines.join('; ')}` : '' } };
}

export async function cancelActions(root: string, id: string, actionId: string | undefined): Promise<ChatEntry> {
  const entry = await entryOf(root, id);
  for (const a of entry.actions) if (a.status === 'proposed' && (!actionId || a.id === actionId)) a.status = 'cancelled';
  return save(root, entry);
}

export async function undoChatAction(root: string, id: string, actionId: string, clock: Clock): Promise<ChatEntry & { changed: Changed }> {
  const entry = await entryOf(root, id);
  const a = entry.actions.find((x) => x.id === actionId);
  if (!a || a.status !== 'done') throw new Error('Only a done action can be undone');
  if (!a.inverse) throw new Error(a.note ?? 'This one cannot be undone here');
  const before = await rebuildGraph(root);
  const kept = await undoAction(root, a.inverse, clock);
  if (kept) a.note = kept; else a.status = 'undone';
  const after = await rebuildGraph(root);
  const saved = await save(root, entry);
  return { ...saved, changed: { ...graphChanges(before, after), note: kept ? '' : `Undone: ${a.label}` } };
}
