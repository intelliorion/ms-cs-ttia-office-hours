import { AI_NODE_TYPES, AI_RELATIONS, ALLOWED, NOT_APPROVED_NOTE, canonicalTool, edgeId, nodeId, type AiLink, type GEdge, type GNode, type NodeType } from '../graph/ontology';
import type { Idea } from '../ideas/idea';
import type { ExtractInput, ExtractOutput } from './tasks';
import type { NearestStar } from '../memory/lookup';
import type { Registry } from '../graph/registry';
import { DEFAULT_REGISTRY } from '../graph/build';

/** Deep read: a proposed label this close (cosine) to an existing star of the same type reuses that star. */
export const REUSE_AT = 0.85;

/** Words that carry no meaning when two capability labels are compared ("in", "for"). */
const STOP = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'via']);
const tokens = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const contentWords = (s: string) => tokens(s).filter((w) => !STOP.has(w));

/** What the extract task is told already exists, so it keeps to those labels. */
export function extractInput(idea: Idea, nodes: GNode[]): ExtractInput {
  const labels = (t: NodeType) => nodes.filter((n) => n.type === t).map((n) => n.label).slice(0, 200);
  return {
    idea: {
      id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes,
      // Maturity and use case category are the form's labels for the idea, not text to find pain points or capabilities in.
      business_impact: idea.business_impact, beneficiaries: idea.beneficiaries, additional_context: idea.additional_context,
    },
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

/**
 * The pending links plus the new nodes they would bring, which the operator must accept first. With Deep read's
 * `nearest` (undefined when there is no index): a proposed label at or above `reuseAt` to an existing star of its type
 * uses that star; one below it but still near is kept as a new star and listed in `near` (new star id → the existing
 * one), for the conflict rules to hold as a near duplicate. Without `nearest` nothing here changes.
 */
export function planAiLinks(
  ideaId: string, out: ExtractOutput,
  graph: { nodes: GNode[]; edges: GEdge[] }, previous: AiLink[], provider: string,
  opts: { status?: AiLink['status']; nearest?: NearestStar; reuseAt?: number; registry?: Registry } = {},
): { links: AiLink[]; newNodes: GNode[]; near: Record<string, string> } {
  const ideaNode = nodeId('Idea', ideaId);
  const key = (s: string) => s.trim().toLowerCase();
  const proposed = new Map<string, GNode>();
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  /** Labels the registry settled: a star's own name or alias, never second-guessed by Deep read's nearest. */
  const settled = new Set<string>();
  // The AI never picks a tool: a Tool star comes only from the operator's tool pick (approach.md), later in the app.
  // Nor any star or link the form owns (people, support, outcomes, beneficiaries, categories): only what it may suggest.
  out = {
    ...out,
    nodes: out.nodes.filter((n) => n.type !== 'Tool' && AI_NODE_TYPES.includes(n.type)),
    links: out.links.filter((l) => l.rel !== 'BUILT_WITH' && AI_RELATIONS.includes(l.rel)),
  };
  for (const n of out.nodes) {
    const raw = n.label.trim();
    if (!raw || proposed.has(key(raw))) continue;
    // A Tool the Café approves takes its canonical label (so it merges with that star); any other
    // tool is kept, flagged, for the operator to decide.
    // The registry first: a label it knows (by name or alias) is that star, born here with its registered label if new.
    const hit = registry.resolve(n.type, raw);
    if (hit) { proposed.set(key(raw), byId.get(hit.id) ?? { id: hit.id, type: n.type, label: hit.label }); settled.add(key(raw)); continue; }
    const canon = n.type === 'Tool' ? canonicalTool(raw) : undefined;
    const label = canon ?? raw;
    proposed.set(key(raw), {
      id: nodeId(n.type, label), type: n.type, label,
      ...(n.type === 'Tool' && !canon ? { attrs: { approved: false } } : {}),
    });
  }
  const existing = new Map<string, GNode>();
  for (const n of graph.nodes) if (n.type !== 'Idea' && n.type !== 'Person' && !existing.has(key(n.label))) existing.set(key(n.label), n);
  // Deep read: a proposed star that only differs in wording from one already there ("Match invoices" / "Invoice
  // matching") reuses it; one merely near it is kept, marked, so the operator is asked "merge or keep both?".
  const near: Record<string, string> = {};
  if (opts.nearest) {
    for (const [k, p] of [...proposed.entries()]) {
      if (existing.has(k) || settled.has(k)) continue;
      const hit = opts.nearest(p.type, p.label);
      if (!hit || hit.node.id === p.id) continue;
      if (hit.score >= (opts.reuseAt ?? REUSE_AT)) proposed.set(k, hit.node);
      else near[p.id] = hit.node.id;
    }
  }
  // A capability named more specifically than a star already there ("Policy question answering for travel" ⊇ "Policy
  // question answering") is that star, and the extra words go into the description. Conservative: only a Capability,
  // only a word superset (stop words aside) of a star with two or more words, so "Reporting" absorbs nothing.
  const folded = new Map<string, string>();
  const stars = graph.nodes.filter((n) => n.type === 'Capability')
    .map((n) => ({ node: n, all: new Set(tokens(n.label)), words: new Set(contentWords(n.label)) })).filter((c) => c.words.size >= 2);
  for (const [k, p] of [...proposed.entries()]) {
    if (p.type !== 'Capability' || existing.has(k) || settled.has(k) || byId.has(p.id)) continue;
    const mine = new Set(contentWords(p.label));
    const hit = stars.filter((c) => [...c.words].every((w) => mine.has(w))).sort((a, b) => b.words.size - a.words.size)[0];
    if (!hit) continue;
    proposed.set(k, hit.node);
    // The words the star does not have, lower-cased for a description fragment (an acronym keeps its capitals).
    const extra = p.label.split(/[^\p{L}\p{N}]+/u).filter((w) => w && !hit.all.has(w.toLowerCase()))
      .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()));
    if (extra.length) folded.set(k, extra.join(' '));
  }
  // A node is known only if something the operator stands behind put it there: the form
  // (and every idea), or an AI link the operator confirmed. Nodes that exist only because of
  // a still-pending AI link stay "new", so links to them stay unconfirmed too.
  const known = new Set<string>(graph.nodes.filter((n) => n.type === 'Idea').map((n) => n.id));
  for (const e of graph.edges) if (e.source.startsWith('form:') || e.source === 'operator') { known.add(e.from); known.add(e.to); }
  for (const l of previous) if (l.status === 'confirmed') { known.add(l.from); known.add(l.to); }
  const seen = new Set([...graph.edges.map((e) => e.id), ...previous.map((l) => edgeId(l.from, l.rel, l.to))]);

  const resolve = (label: string): GNode | undefined => {
    if (key(label) === 'idea') return { id: ideaNode, type: 'Idea', label: 'idea' };
    const k = key(label);
    return settled.has(k) ? proposed.get(k) : existing.get(k) ?? proposed.get(k);
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
    const extra = [l.from, l.to].map((x) => folded.get(key(x))).filter((x): x is string => !!x);
    const description = `${l.description}${extra.length ? ` (${extra.join(', ')})` : ''}${unapproved ? NOT_APPROVED_NOTE : ''}`;
    links.push({
      from: from.id, to: to.id, rel: l.rel, description, confidence: l.confidence,
      source: `ai:${provider}:challenge`, status: opts.status ?? 'pending', idea: ideaId,
      ...(newNodes.length ? { newNodes } : {}),
    });
  }
  const newNodes = new Map<string, GNode>();
  for (const l of links) for (const n of l.newNodes ?? []) newNodes.set(n.id, n);
  const kept = new Set(newNodes.keys());
  return { links, newNodes: [...newNodes.values()], near: Object.fromEntries(Object.entries(near).filter(([id]) => kept.has(id))) };
}
