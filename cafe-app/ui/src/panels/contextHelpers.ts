import { cafeIdOf } from '../popouts/ideaHelpers';

export type RightContext = { kind: 'overview' } | { kind: 'idea'; id: string } | { kind: 'star'; nodeId: string } | { kind: 'multi'; ids: string[] };

/** What the right side shows: the open idea, else the clicked star (an idea's star counts as its idea), else the overview. */
export function rightContext(s: { leftView: { kind: string; id?: string }; selectedId: string | null; selectedIds?: string[] }, graph: { nodes: { id: string }[] } | null | undefined): RightContext {
  const many = (s.selectedIds ?? []).filter((id) => graph?.nodes.some((n) => n.id === id));
  if (many.length >= 2) return { kind: 'multi', ids: many };
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

/**
 * What several picked stars have in common: every other star linked to two or more of them, most shared first,
 * with which of the picked ones it links to.
 */
export function inCommon(graph: { nodes: { id: string; label: string }[]; edges: { from: string; to: string }[] }, ids: string[]): { id: string; with: string[] }[] {
  const picked = new Set(ids);
  const by = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
      if (!picked.has(a) || picked.has(b)) continue;
      const s = by.get(b) ?? new Set<string>(); s.add(a); by.set(b, s);
    }
  }
  const label = new Map(graph.nodes.map((n) => [n.id, n.label]));
  return [...by].filter(([, s]) => s.size >= 2).map(([id, s]) => ({ id, with: ids.filter((x) => s.has(x)) }))
    .sort((a, b) => b.with.length - a.with.length || (label.get(a.id) ?? '').localeCompare(label.get(b.id) ?? ''));
}
