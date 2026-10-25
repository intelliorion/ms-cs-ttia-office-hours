import { loadIdea } from '../ideas/store';
import { listItems } from '../inbox/store';
import { rebuildGraph } from '../graph/store';
import { hideNames, showNames, type Coded } from '../command/names';
import { maskEmails } from '../data/check';
import { extractInput } from '../ai/apply';
import { STAGE_NAMES } from '../rules/stages';
import type { ReviewSuggestInput } from '../ai/tasks';
import type { Idea } from '../ideas/idea';
import { nodeId, type GNode } from '../graph/ontology';
import { importedNames, namesInAddresses } from '../inbox/names';
import { builderOf } from '../ideas/people';

/** What review needs from the graph: the idea's pain points, capabilities and systems (systems through its capabilities). */
const KINDS = new Set(['PainPoint', 'Capability', 'System']);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything the decision suggestion should read, not only the form: the team's email answers, a builder named, a
 * reply or attendance, flags, and what the knowledge graph holds for the idea. People's names are coded throughout.
 * `basis` says, in the app's words, what the suggestion was based on, so a new email visibly changes it.
 */
export async function reviewInput(
  root: string, id: string, added: { question: string; answer: string }[] = [], opts: { skipSource?: string } = {},
): Promise<{ input: ReviewSuggestInput; basis: string; waiting: number; codes: Map<string, Coded> }> {
  const loaded = await loadIdea(root, id) as Idea & { answers?: { question: string; answer: string; source?: string }[] };
  // The design questions read their own answers as steps: their copies on the idea are left out for them.
  const idea = opts.skipSource ? { ...loaded, answers: (loaded.answers ?? []).filter((a) => a.source !== opts.skipSource) } : loaded;
  const graph = await rebuildGraph(root);
  const people = await peopleFor(root, graph, idea);
  // One code list for the whole suggestion, so a person has the same code in every text, and the reply can be decoded.
  const codes = new Map<string, Coded>();
  const coded = coder(people, codes);
  const text = extractInput(idea, []).idea;
  const ideaText = {
    ...text, challenge: coded(text.challenge), current_process: coded(text.current_process),
    business_impact: coded(text.business_impact), additional_context: coded(text.additional_context),
  };

  // The team's emailed answers, then what the operator pasted against the to-do list.
  const answers = [...(idea.answers ?? []).slice(-20), ...added].map((a) => ({ question: a.question, answer: coded(a.answer)! }));
  const emailed = (idea.answers ?? []).slice(-20).length;
  const progress = {
    builderNamed: !!builderOf(idea),
    replyReceived: !!idea.checklist.s2d?.done,
    attendanceConfirmed: !!idea.checklist.s3a?.done,
  };
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const me = `idea:${idea.id}`;
  const linked = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === me && KINDS.has(nodes.get(e.to)?.type ?? '')) linked.add(e.to);
    if (e.to === me && KINDS.has(nodes.get(e.from)?.type ?? '')) linked.add(e.from);
  }
  for (const e of graph.edges) if (linked.has(e.from) && e.rel === 'USES_DATA') linked.add(e.to);
  const ideasOf = (sid: string) => new Set(graph.edges.flatMap((e) => (e.to === sid && nodes.get(e.from)?.type === 'Idea' ? [e.from] : e.from === sid && nodes.get(e.to)?.type === 'Idea' ? [e.to] : [])));
  const graphFacts = [...linked].map((sid) => {
    const n = nodes.get(sid)!;
    const others = [...ideasOf(sid)].filter((x) => x !== me).length;
    return { type: n.type, label: n.label, ...(others ? { alsoNeededBy: others } : {}) };
  });

  const input: ReviewSuggestInput = {
    idea: ideaText,
    form: {
      support: idea.support, maturity: idea.maturity, use_case_category: idea.use_case_category, experimented: idea.experimented,
      participation: idea.participation, function: idea.function, region: idea.region, stage: STAGE_NAMES[idea.stage],
    },
    ...(answers.length ? { answers } : {}),
    progress,
    ...(idea.flags.length ? { flags: idea.flags } : {}),
    ...(graphFacts.length ? { graph: graphFacts } : {}),
  };
  const parts = [
    'the form',
    emailed ? plural(emailed, 'email answer') : '',
    progress.builderNamed ? 'a builder named' : '',
    progress.replyReceived ? 'a reply received' : '',
    progress.attendanceConfirmed ? 'attendance confirmed' : '',
    idea.flags.length ? plural(idea.flags.length, 'flag') : '',
    graphFacts.length ? plural(graphFacts.length, 'graph link') : '',
  ].filter(Boolean);
  // What an imported email found but the operator has not said yes to yet: not part of the idea, so not read; say so.
  const waiting = (await listItems(root)).flatMap((i) => (i.actions ?? []) as { status?: string; action?: { ideaId?: string } }[])
    .filter((r) => r.status === 'pending' && r.action?.ideaId === idea.id).length;
  const basis = `Based on ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}`
    + (waiting ? `. ${plural(waiting, 'change')} from the Import still wait${waiting === 1 ? 's' : ''} for your Yes and ${waiting === 1 ? 'is' : 'are'} not read yet` : '');
  return { input, basis, waiting, codes };
}

/** Everyone the graph knows, plus everyone the idea's own record names (a builder named in an email may not be a star yet). */
export function peopleOf(graph: { nodes: GNode[] }, idea: Pick<Idea, 'people'>): GNode[] {
  const known = new Set(graph.nodes.filter((n) => n.type === 'Person').map((n) => n.label));
  const named = [idea.people.submitter, ...idea.people.team.map((p) => p.name)].filter((x): x is string => !!x?.trim());
  return [
    ...graph.nodes.filter((n) => n.type === 'Person'),
    ...named.filter((x) => !known.has(x)).map((label) => ({ id: nodeId('Person', label), type: 'Person' as const, label })),
  ];
}

/**
 * Everyone to code for an idea: peopleOf, plus every person an import has named (a sender or a cc the universe
 * never took in) and the names "first.last" addresses in the idea give away.
 */
export async function peopleFor(root: string, graph: { nodes: GNode[] }, idea: Pick<Idea, 'people'>): Promise<GNode[]> {
  return withNames(peopleOf(graph, idea), [...await importedNames(root), ...namesInAddresses(JSON.stringify(idea))]);
}

/**
 * A text with the people coded, adding to `codes` (one list for a whole call, so a person keeps one code). Email
 * addresses go first, as <email> (the data step's mask), so an address never reaches the AI, a known person's or not.
 */
export function coder(people: GNode[], codes: Map<string, Coded>) {
  return <S extends string | undefined>(s: S): S => {
    if (!s) return s;
    const h = hideNames(maskEmails(s), people, { seed: codes });
    for (const [c, v] of h.codes) if (!codes.has(c)) codes.set(c, v);
    return h.text as S;
  };
}

/** Every string in a value with the people coded (the idea's people, everyone in the graph), adding to `codes`. */
export async function codeValue<T>(root: string, id: string, value: T, codes: Map<string, Coded>): Promise<T> {
  const idea = await loadIdea(root, id);
  return codeAll(value, coder(await peopleFor(root, await rebuildGraph(root), idea), codes));
}

/** People plus names the app has only seen (an email's sender, a cc, a speaker), as people stars for the coder. */
export function withNames(people: GNode[], names: string[]): GNode[] {
  const have = new Set(people.map((n) => n.label.trim().toLowerCase()));
  const extra: GNode[] = [];
  for (const raw of names) {
    const label = raw.replace(/\s+/g, ' ').trim();
    if (label.length < 3 || label.includes('@') || have.has(label.toLowerCase())) continue;
    have.add(label.toLowerCase());
    extra.push({ id: nodeId('Person', label), type: 'Person', label });
  }
  return [...people, ...extra];
}

/** Every string in the AI's reply with the codes turned back into names, so what is stored reads as before. */
export function decodeValue<T>(v: T, codes: Map<string, Coded>): T {
  const walk = (x: unknown): unknown => (typeof x === 'string' ? showNames(x, codes) : Array.isArray(x) ? x.map(walk)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x);
  return walk(v) as T;
}

/** Every string in a value coded with `code` (keys and other values as they are). */
export function codeAll<T>(v: T, code: (s: string) => string): T {
  const walk = (x: unknown): unknown => (typeof x === 'string' ? code(x) : Array.isArray(x) ? x.map(walk)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)])) : x);
  return walk(v) as T;
}
