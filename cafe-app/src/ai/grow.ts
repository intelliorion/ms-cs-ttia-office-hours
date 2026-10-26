import { loadIdea, listIdeas } from '../ideas/store';
import { rebuildGraph, readAiLinks, appendAiLink } from '../graph/store';
import { readDesign } from '../design/store';
import { checkProposals, type ConflictContext } from '../inbox/conflicts';
import { edgeId, type GEdge, type GNode } from '../graph/ontology';
import { extractTask } from './tasks';
import { extractInput, planAiLinks } from './apply';
import type { Connector } from './connector';
import type { ExtractInput, ExtractOutput } from './tasks';
import type { Idea } from '../ideas/idea';
import type { Coded } from '../command/names';
import { coder, codeAll, decodeValue, peopleFor, withNames } from '../review/suggestInput';
import { knownParticipants } from '../inbox/screen';
import { starMatcher } from '../memory/lookup';

/**
 * The extract input with names coded before the AI sees it, as every other AI call codes them (reviewInput's coder):
 * everyone the universe and the ideas know, everyone an import has named, and the names "first.last" addresses in
 * the idea give away; addresses become <email>. `existing` holds pain points, capabilities and systems, not people.
 */
export async function codedExtractInput(root: string, idea: Idea, nodes: GNode[]): Promise<{ input: ExtractInput; codes: Map<string, Coded> }> {
  const input = extractInput(idea, nodes);
  const people = withNames(await peopleFor(root, { nodes }, idea), await knownParticipants(root));
  const codes = new Map<string, Coded>();
  return { input: { ...input, idea: codeAll(input.idea, coder(people, codes)) }, codes };
}

/** Asks the AI to extract, names coded on the way out and put back in its reply. */
export async function extractCoded(root: string, ai: Connector, idea: Idea, nodes: GNode[]): Promise<{ provider: string; output: ExtractOutput }> {
  const { input, codes } = await codedExtractInput(root, idea, nodes);
  const out = await ai.runWith(extractTask, input);
  return { provider: out.provider, output: decodeValue(out.output, codes) };
}

export interface GrowResult {
  added: number;
  held: { rule: string; why: string }[];
  links: GEdge[];
  suggestions: { newNodes: GNode[] };
}

/**
 * Reads one idea again with the AI and adds what it finds: pain points, capabilities and systems, linked to the idea.
 * Links that clash with what the graph holds are kept waiting, as in the Import; a person never becomes a star.
 */
export async function growIdea(root: string, ai: Connector, id: string): Promise<GrowResult> {
  const idea = await loadIdea(root, id);
  const before = await rebuildGraph(root);
  const { provider, output } = await extractCoded(root, ai, idea, before.nodes);
  // Deep read, when it has run: a star that only differs in wording is reused; a near one is held for the operator.
  const matcher = await starMatcher(root, output.nodes.map((n) => n.label), before.nodes);
  const planned = planAiLinks(idea.id, output, before, (await readAiLinks(root)).links, provider, { status: 'confirmed', nearest: matcher?.nearest, reuseAt: matcher?.thresholds.reuse });
  const { ideas } = await listIdeas(root);
  const ctx: ConflictContext = {
    idea, ideas, nodes: before.nodes, peoplePresent: [], design: await readDesign(root, idea.id).catch(() => null),
    match: { ideaId: idea.id, confidence: 1, candidates: [idea.id] }, aiIdeaId: idea.id, screened: [], near: planned.near,
  };
  const { apply, hold } = checkProposals(ctx, [{ t: 'graph_links', ideaId: idea.id, links: planned.links }]);
  for (const a of apply) if (a.t === 'graph_links') for (const l of a.links) await appendAiLink(root, l);
  for (const h of hold) if (h.action.t === 'graph_links' && h.rule !== 'person-star') for (const l of h.action.links) await appendAiLink(root, { ...l, status: 'pending' });
  const after = await rebuildGraph(root);
  const ids = new Set(planned.links.map((l) => edgeId(l.from, l.rel, l.to)));
  const added = after.edges.filter((e) => ids.has(e.id));
  return { added: added.filter((e) => e.confirmed).length, held: hold.map(({ action: _a, ...h }) => h), links: added, suggestions: { newNodes: planned.newNodes } };
}
