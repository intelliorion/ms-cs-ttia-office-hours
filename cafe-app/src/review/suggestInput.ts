import { loadIdea } from '../ideas/store';
import { listItems } from '../inbox/store';
import { rebuildGraph } from '../graph/store';
import { hideNames, type Coded } from '../command/names';
import { extractInput } from '../ai/apply';
import { STAGE_NAMES } from '../rules/stages';
import type { ReviewSuggestInput } from '../ai/tasks';
import type { Idea } from '../ideas/idea';
import { nodeId, type GNode } from '../graph/ontology';
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
  const people = peopleOf(graph, idea);
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

/** A text with the people coded, adding to `codes` (one list for a whole call, so a person keeps one code). */
export function coder(people: GNode[], codes: Map<string, Coded>) {
  return <S extends string | undefined>(s: S): S => {
    if (!s) return s;
    const h = hideNames(s, people, { seed: codes });
    for (const [c, v] of h.codes) if (!codes.has(c)) codes.set(c, v);
    return h.text as S;
  };
}

/** Every string in a value with the people coded (the idea's people, everyone in the graph), adding to `codes`. */
export async function codeValue<T>(root: string, id: string, value: T, codes: Map<string, Coded>): Promise<T> {
  const idea = await loadIdea(root, id);
  const code = coder(peopleOf(await rebuildGraph(root), idea), codes);
  const walk = (v: unknown): unknown => (typeof v === 'string' ? code(v) : Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk(value) as T;
}
