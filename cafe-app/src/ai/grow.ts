import { loadIdea, listIdeas } from '../ideas/store';
import { rebuildGraph, readAiLinks, appendAiLink } from '../graph/store';
import { readDesign } from '../design/store';
import { checkProposals, type ConflictContext } from '../inbox/conflicts';
import { edgeId, type GEdge, type GNode } from '../graph/ontology';
import { extractTask } from './tasks';
import { extractInput, planAiLinks } from './apply';
import type { Connector } from './connector';

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
  const { provider, output } = await ai.runWith(extractTask, extractInput(idea, before.nodes));
  const planned = planAiLinks(idea.id, output, before, (await readAiLinks(root)).links, provider, { status: 'confirmed' });
  const { ideas } = await listIdeas(root);
  const ctx: ConflictContext = {
    idea, ideas, nodes: before.nodes, peoplePresent: [], design: await readDesign(root, idea.id).catch(() => null),
    match: { ideaId: idea.id, confidence: 1, candidates: [idea.id] }, aiIdeaId: idea.id, screened: [],
  };
  const { apply, hold } = checkProposals(ctx, [{ t: 'graph_links', ideaId: idea.id, links: planned.links }]);
  for (const a of apply) if (a.t === 'graph_links') for (const l of a.links) await appendAiLink(root, l);
  for (const h of hold) if (h.action.t === 'graph_links' && h.rule !== 'person-star') for (const l of h.action.links) await appendAiLink(root, { ...l, status: 'pending' });
  const after = await rebuildGraph(root);
  const ids = new Set(planned.links.map((l) => edgeId(l.from, l.rel, l.to)));
  const added = after.edges.filter((e) => ids.has(e.id));
  return { added: added.filter((e) => e.confirmed).length, held: hold.map(({ action: _a, ...h }) => h), links: added, suggestions: { newNodes: planned.newNodes } };
}
