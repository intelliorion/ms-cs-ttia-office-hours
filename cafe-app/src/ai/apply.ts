import { ALLOWED, NOT_APPROVED_NOTE, canonicalTool, edgeId, nodeId, type AiLink, type GEdge, type GNode, type NodeType } from '../graph/ontology';
import type { Idea } from '../ideas/idea';
import type { ExtractInput, ExtractOutput } from './tasks';

/** What the extract task is told already exists, so it reuses those labels. */
export function extractInput(idea: Idea, nodes: GNode[]): ExtractInput {
  const labels = (t: NodeType) => nodes.filter((n) => n.type === t).map((n) => n.label).slice(0, 200);
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    existing: { capabilities: labels('Capability'), systems: labels('System'), painPoints: labels('PainPoint') },
  };
}

/**
 * Turns checked extract output into pending AI links. A link is kept only if both
 * ends resolve (to the idea, a proposed node or an existing node), the relation's
 * ends have the right types, and the same link was not already there or removed.
 */
export function toAiLinks(
  ideaId: string, out: ExtractOutput,
  graph: { nodes: GNode[]; edges: GEdge[] }, previous: AiLink[], provider: string,
): AiLink[] {
  return planAiLinks(ideaId, out, graph, previous, provider).links;
}

/** The pending links plus the new nodes they would bring, which the operator must accept first. */
export function planAiLinks(
  ideaId: string, out: ExtractOutput,
  graph: { nodes: GNode[]; edges: GEdge[] }, previous: AiLink[], provider: string,
): { links: AiLink[]; newNodes: GNode[] } {
  const ideaNode = nodeId('Idea', ideaId);
  const key = (s: string) => s.trim().toLowerCase();
  const proposed = new Map<string, GNode>();
  for (const n of out.nodes) {
    const raw = n.label.trim();
    if (!raw || proposed.has(key(raw))) continue;
    // A Tool the Café approves takes its canonical label (so it merges with that star); any other
    // tool is kept, flagged, for the operator to decide.
    const canon = n.type === 'Tool' ? canonicalTool(raw) : undefined;
    const label = canon ?? raw;
    proposed.set(key(raw), {
      id: nodeId(n.type, label), type: n.type, label,
      ...(n.type === 'Tool' && !canon ? { attrs: { approved: false } } : {}),
    });
  }
  const existing = new Map<string, GNode>();
  for (const n of graph.nodes) if (n.type !== 'Idea' && n.type !== 'Person' && !existing.has(key(n.label))) existing.set(key(n.label), n);
  // A node is known only if something the operator stands behind put it there: the form
  // (and every idea), or an AI link the operator confirmed. Nodes that exist only because of
  // a still-pending AI link stay "new", so links to them stay unconfirmed too.
  const known = new Set<string>(graph.nodes.filter((n) => n.type === 'Idea').map((n) => n.id));
  for (const e of graph.edges) if (e.source.startsWith('form:')) { known.add(e.from); known.add(e.to); }
  for (const l of previous) if (l.status === 'confirmed') { known.add(l.from); known.add(l.to); }
  const seen = new Set([...graph.edges.map((e) => e.id), ...previous.map((l) => edgeId(l.from, l.rel, l.to))]);

  const resolve = (label: string): GNode | undefined => {
    if (key(label) === 'idea') return { id: ideaNode, type: 'Idea', label: 'idea' };
    return existing.get(key(label)) ?? proposed.get(key(label));
  };

  const links: AiLink[] = [];
  for (const l of out.links) {
    const from = resolve(l.from); const to = resolve(l.to);
    if (!from || !to) continue;
    const [ft, tt] = ALLOWED[l.rel];
    if (from.type !== ft || to.type !== tt) continue;
    const id = edgeId(from.id, l.rel, to.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const unapproved = [from, to].some((n) => n.type === 'Tool' && n.attrs?.approved === false);
    const newNodes = [from, to].filter((n) => n.type !== 'Idea' && !known.has(n.id));
    links.push({
      from: from.id, to: to.id, rel: l.rel, description: unapproved ? `${l.description}${NOT_APPROVED_NOTE}` : l.description, confidence: l.confidence,
      source: `ai:${provider}:challenge`, status: 'pending',
      ...(newNodes.length ? { newNodes } : {}),
    });
  }
  const newNodes = new Map<string, GNode>();
  for (const l of links) for (const n of l.newNodes ?? []) newNodes.set(n.id, n);
  return { links, newNodes: [...newNodes.values()] };
}
