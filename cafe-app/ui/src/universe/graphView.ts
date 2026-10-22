// Pure helpers for drawing the knowledge graph. No three.js here, so they test in node.
import { NODE_COLOURS, type GEdge, type GNode, type NodeType } from '../../../src/graph/ontology';

export { NODE_COLOURS };
export type { GEdge, GNode, NodeType };
export type Vec3 = [number, number, number];
export interface Graph { nodes: GNode[]; edges: GEdge[]; layout?: Record<string, Vec3>; unconfirmed?: number }

const BASE_SIZE: Record<NodeType, number> = {
  Idea: 2.6, Team: 2.2, Entity: 2.4, Tool: 1.8, Capability: 1.6, System: 1.6, PainPoint: 1.4, Person: 1.0, Round: 2.4, Support: 1.4,
  Outcome: 1.4, Beneficiary: 1.4, Category: 1.6,
};
const ALWAYS: NodeType[] = ['Idea', 'Team', 'Tool', 'Entity', 'Round'];

/** Ring colour of an idea star, by stage (1–4) or closed. */
export const STAGE_RING: Record<string, string> = { 1: '#9fb0ae', 2: '#f5b36b', 3: '#7dd3cf', 4: '#e7d8b1', closed: '#5c6b6a' };
export const LINK_COLOUR = '#7dd3cf';
/** How strong a link in view is (a selected star's links, or links between lit stars): about half, so stars lead. */
export const LINK_IN_VIEW = 0.42;
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

/** The division and its teams have fixed sizes, a step above everything else, so they are easy to catch. */
const FIXED_SIZE: Partial<Record<NodeType, number>> = { Entity: 6.0, Team: 5.0 };
/** Every other star grows with its links up to this, which stays below a team. */
const MAX_SIZE = 3.5;

export function starSize(node: Pick<GNode, 'type'>, degree: number): number {
  const fixed = FIXED_SIZE[node.type];
  if (fixed) return fixed;
  return Math.min(MAX_SIZE, Math.round(((BASE_SIZE[node.type] ?? 1) + 0.15 * degree) * 1000) / 1000);
}

export const labelAlways = (node: Pick<GNode, 'type'>) => ALWAYS.includes(node.type);

/** Star labels show in full up to this many characters; a longer one is cut with an ellipsis (the full text stays in the tooltip). */
export const LABEL_MAX = 40;
export const starLabel = (label: string) => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label);

/** A selected star wins; otherwise a lit set (the stars an answer rests on) shows the links between them. */
export function edgeStyle(edge: Pick<GEdge, 'from' | 'to' | 'confirmed'>, selected: string | null, lit?: Set<string> | null, dim = DIM) {
  const dashed = !edge.confirmed;
  if (selected) {
    const touches = edge.from === selected || edge.to === selected;
    // Links in view stay quieter than the stars they join: the eye goes to the stars first.
    return { opacity: touches ? LINK_IN_VIEW : dim / 3, dashed, pulse: touches };
  }
  // The rest fade with the stars: at the default dim a faint 0.03, gone entirely when the rest are hidden.
  if (lit) return { opacity: lit.has(edge.from) && lit.has(edge.to) ? LINK_IN_VIEW : 0.25 * dim, dashed, pulse: false };
  return { opacity: dashed ? 0.35 : 0.18, dashed, pulse: false };
}

/** How bright the stars outside a highlight are, from how much of them is hidden (0.5 to 1). */
export const dimFromHide = (hide: number) => Math.max(0, Math.min(1, 1 - hide));

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

/** The x/y box around some points, or null when there are none (no Math.min of nothing). */
export function extent(points: ReadonlyArray<readonly [number, number, ...number[]]>): { x0: number; x1: number; y0: number; y1: number } | null {
  if (!points.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
}

/** The design frame is 1920 wide: the Ideas panel covers x < 480 and the Pipeline and Demand panels the last 480. */
export const STAGE_W = 1920;
export const CLEAR_LEFT = 480;
export const CLEAR_RIGHT = 1440;
const SIDE = 480;
/**
 * Can a label sit at this box (left and right edges, in canvas pixels)? With the side panels showing, only inside the
 * centre gap between them; with Focus on (or on a narrow window, where the panels are drawers) the whole stage.
 * On a wider window the frame grows, so the right panels sit at stageW - 480 rather than 1440.
 */
export function labelSpotVisible(x0: number, x1: number, canvasWidth: number, panels: boolean, stageW = STAGE_W): boolean {
  if (!panels) return true;
  const k = canvasWidth > 0 ? stageW / canvasWidth : 1;
  return x0 * k >= CLEAR_LEFT && x1 * k <= stageW - SIDE;
}
