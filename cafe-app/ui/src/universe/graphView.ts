// Pure helpers for drawing the knowledge graph. No three.js here, so they test in node.
import { NODE_COLOURS, type GEdge, type GNode, type NodeType } from '../../../src/graph/ontology';

export { NODE_COLOURS };
export type { GEdge, GNode, NodeType };
export type Vec3 = [number, number, number];
export interface Graph { nodes: GNode[]; edges: GEdge[]; layout?: Record<string, Vec3>; unconfirmed?: number }

const BASE_SIZE: Record<NodeType, number> = {
  Idea: 2.6, Team: 2.2, Entity: 2.4, Tool: 1.8, Capability: 1.6, System: 1.6, PainPoint: 1.4, Person: 1.0,
};
const ALWAYS: NodeType[] = ['Idea', 'Team', 'Tool', 'Entity'];

/** Ring colour of an idea star, by stage (1–4) or closed. */
export const STAGE_RING: Record<string, string> = { 1: '#9fb0ae', 2: '#f5b36b', 3: '#7dd3cf', 4: '#e7d8b1', closed: '#5c6b6a' };
export const LINK_COLOUR = '#7dd3cf';
export const UNCONFIRMED_COLOUR = '#f5b36b';
export const DIM = 0.12;

export function ringColour(node: GNode): string {
  if (node.attrs?.closed) return STAGE_RING.closed;
  return STAGE_RING[String(node.attrs?.stage ?? 1)] ?? STAGE_RING[1];
}

/** The node itself plus its direct neighbours. */
export function neighbourhood(graph: Pick<Graph, 'edges'>, id: string): Set<string> {
  const out = new Set([id]);
  for (const e of graph.edges) {
    if (e.from === id) out.add(e.to);
    else if (e.to === id) out.add(e.from);
  }
  return out;
}

export function degrees(graph: Pick<Graph, 'edges'>): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of graph.edges) { d.set(e.from, (d.get(e.from) ?? 0) + 1); d.set(e.to, (d.get(e.to) ?? 0) + 1); }
  return d;
}

export function starSize(node: Pick<GNode, 'type'>, degree: number): number {
  return Math.min(4, Math.round(((BASE_SIZE[node.type] ?? 1) + 0.15 * degree) * 1000) / 1000);
}

export const labelAlways = (node: Pick<GNode, 'type'>) => ALWAYS.includes(node.type);

export function edgeStyle(edge: Pick<GEdge, 'from' | 'to' | 'confirmed'>, selected: string | null) {
  const dashed = !edge.confirmed;
  if (selected) {
    const touches = edge.from === selected || edge.to === selected;
    return { opacity: touches ? 0.9 : 0.04, dashed, pulse: touches };
  }
  return { opacity: dashed ? 0.35 : 0.18, dashed, pulse: false };
}

/** Centre and radius (to the 95th percentile, so one stray star does not shrink the view). */
export function bounds(layout: Record<string, Vec3>): { centre: Vec3; radius: number } {
  const ps = Object.values(layout);
  if (!ps.length) return { centre: [0, 0, 0], radius: 60 };
  const c: Vec3 = [0, 0, 0];
  for (const p of ps) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= ps.length; c[1] /= ps.length; c[2] /= ps.length;
  const ds = ps.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
  const r = ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))];
  return { centre: c, radius: Math.max(40, r) };
}

/** A stable 0..1 number per id (for twinkle phase). */
export function phase(id: string): number {
  let h = 2166136261;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
