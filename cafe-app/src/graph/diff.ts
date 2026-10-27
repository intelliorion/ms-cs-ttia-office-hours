import type { GEdge, GNode } from './ontology';

/**
 * What one change did to the graph, for the universe to show it: the stars that are new or renamed and the ends of
 * every thread that came or went, and the threads that are new or changed (a relation is part of an edge's id, so a
 * role swapped between two stars already linked is a new thread, never "nothing"). Links a rule derived are left out:
 * they follow from the change, they are not it. Sorted, so the answer does not depend on build order.
 */
export function graphChanges(before: { nodes: GNode[]; edges: GEdge[] }, after: { nodes: GNode[]; edges: GEdge[] }): { nodes: string[]; edges: string[] } {
  const stated = (es: GEdge[]) => es.filter((e) => !e.derived);
  const was = new Map(stated(before.edges).map((e) => [e.id, e]));
  const now = new Map(stated(after.edges).map((e) => [e.id, e]));
  const oldNodes = new Map(before.nodes.map((n) => [n.id, n]));
  const nodes = new Set<string>(); const edges = new Set<string>();
  for (const [id, e] of now) {
    const old = was.get(id);
    if (old && old.confirmed === e.confirmed && old.description === e.description) continue;
    edges.add(id); nodes.add(e.from); nodes.add(e.to);
  }
  for (const [id, e] of was) if (!now.has(id)) { nodes.add(e.from); nodes.add(e.to); }
  for (const n of after.nodes) { const o = oldNodes.get(n.id); if (!o || o.label !== n.label) nodes.add(n.id); }
  // A star that went has nothing left to light.
  const present = new Set(after.nodes.map((n) => n.id));
  return { nodes: [...nodes].filter((id) => present.has(id)).sort(), edges: [...edges].sort() };
}
