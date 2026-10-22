import { cafeIdOf } from '../popouts/ideaHelpers';

export type RightContext = { kind: 'overview' } | { kind: 'idea'; id: string } | { kind: 'star'; nodeId: string };

/** What the right side shows: the open idea, else the clicked star (an idea's star counts as its idea), else the overview. */
export function rightContext(s: { leftView: { kind: string; id?: string }; selectedId: string | null }, graph: { nodes: { id: string }[] } | null | undefined): RightContext {
  if (s.leftView.kind === 'idea' && s.leftView.id) return { kind: 'idea', id: s.leftView.id };
  const sel = s.selectedId;
  if (!sel || !graph?.nodes.some((n) => n.id === sel)) return { kind: 'overview' };
  const cafe = cafeIdOf(sel);
  return cafe ? { kind: 'idea', id: cafe } : { kind: 'star', nodeId: sel };
}

/**
 * The ideas a star touches: linked to it directly, or one star away (a team's ideas through its people, a system's
 * through the capabilities that use it). Nearest first, then by title.
 */
export function ideasAround(graph: { nodes: { id: string; type: string; label: string }[]; edges: { from: string; to: string }[] }, nodeId: string): { id: string; hops: 1 | 2 }[] {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
  for (const e of graph.edges) { add(e.from, e.to); add(e.to, e.from); }
  const type = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const found = new Map<string, 1 | 2>();
  for (const a of adj.get(nodeId) ?? []) {
    if (type.get(a) === 'Idea') { found.set(a, 1); continue; }
    // One star further, but never through another idea or a hub (the division, a round): those would pull in everything.
    if (['Entity', 'Round'].includes(type.get(a) ?? '')) continue;
    for (const b of adj.get(a) ?? []) if (b !== nodeId && type.get(b) === 'Idea' && !found.has(b)) found.set(b, 2);
  }
  return [...found].map(([id, hops]) => ({ id, hops }))
    .sort((x, y) => x.hops - y.hops || (label.get(x.id) ?? '').localeCompare(label.get(y.id) ?? ''));
}
