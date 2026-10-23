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

/** Ring colour of an idea star, by stage (2–4: Review and Select is the first) or closed. */
export const STAGE_RING: Record<string, string> = { 2: '#f5b36b', 3: '#7dd3cf', 4: '#e7d8b1', closed: '#5c6b6a' };
export const LINK_COLOUR = '#7dd3cf';
/** How strong a link in view is (a selected star's links, or links between lit stars): about half, so stars lead. */
export const LINK_IN_VIEW = 0.42;
export const UNCONFIRMED_COLOUR = '#f5b36b';
export const DIM = 0.12;

/**
 * The graph as drawn with some kinds of star switched off. Only the picture changes: the panels, the chat and
 * everything else keep the whole graph. Stars in keep (the ones picked) stay in view whatever their kind.
 */
export function visibleGraph<G extends Graph>(graph: G, hidden: readonly string[], keep: readonly string[] = []): G {
  if (!hidden.length) return graph;
  const off = new Set(hidden); const kept = new Set(keep);
  const nodes = graph.nodes.filter((n) => !off.has(n.type) || kept.has(n.id));
  const ids = new Set(nodes.map((n) => n.id));
  return { ...graph, nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

export function ringColour(node: GNode, ring: Record<string, string> = STAGE_RING): string {
  if (node.attrs?.closed) return ring.closed;
  return ring[String(node.attrs?.stage ?? 2)] ?? ring[2];
}

/** The scene's colours for a theme: Default is the night sky; Frost is baubles on a light winter morning. */
export interface ScenePalette {
  frost: boolean;
  /** Blueprint: wireframe stars on drafting blue, no glow. */
  blueprint?: boolean;
  /** Workshop: painted gears (tools are hammers) on pegboard, hardware-store orange. */
  workshop?: boolean;
  bg: string;
  link: string;
  /** Links in view (a selection's, or between lit stars). */
  linkHot: string;
  unconfirmed: string;
  /** Light backgrounds swallow thin lines: Frost draws them stronger. */
  linkBoost: number;
  ring: Record<string, string>;
}
export const NIGHT: ScenePalette = { frost: false, bg: '#07090b', link: LINK_COLOUR, linkHot: LINK_COLOUR, unconfirmed: UNCONFIRMED_COLOUR, linkBoost: 1, ring: STAGE_RING };
export const FROST: ScenePalette = {
  frost: true, bg: '#eef3f8', link: '#8a9bb0', linkHot: '#1f6f5c', unconfirmed: '#b8862b', linkBoost: 2.4,
  ring: { 2: '#b8862b', 3: '#1f6f5c', 4: '#7a5aa8', closed: '#a3b0bd' },
};
export const BLUEPRINT: ScenePalette = {
  frost: false, blueprint: true, bg: '#2b5f96', link: '#d6e6ff', linkHot: '#ffd166', unconfirmed: '#ffd166', linkBoost: 1.7,
  ring: { 2: '#ffd166', 3: '#8fdcff', 4: '#ffffff', closed: '#6f8db3' },
};
/** Blueprint draws each kind in its full colour (no lightening): solid stars that stand out on the blue. */
export const BLUEPRINT_TINT = 0;
export const WORKSHOP: ScenePalette = {
  frost: false, workshop: true, bg: '#efe3cf', link: '#4a3b2c', linkHot: '#f96302', unconfirmed: '#c77700', linkBoost: 2.2,
  ring: { 2: '#f96302', 3: '#2e7d32', 4: '#1f4e8c', closed: '#8a7f73' },
};
export const paletteFor = (theme?: string): ScenePalette =>
  (theme === 'frost' ? FROST : theme === 'blueprint' ? BLUEPRINT : theme === 'workshop' ? WORKSHOP : NIGHT);

/** The node itself plus its direct neighbours. */
export function neighbourhood(graph: Pick<Graph, 'edges'>, id: string): Set<string> {
  const out = new Set([id]);
  for (const e of graph.edges) {
    if (e.from === id) out.add(e.to);
    else if (e.to === id) out.add(e.from);
  }
  // An idea also keeps what its features stand on: the tool each is built with and the systems they use data from.
  if (id.startsWith('idea:')) {
    const first = new Set(out);
    for (const e of graph.edges) if ((e.rel === 'BUILT_WITH' || e.rel === 'USES_DATA') && first.has(e.from) && e.from !== id) out.add(e.to);
  }
  return out;
}

/** The stars an idea reaches through its features (tools, systems), each with how many of its features lead there. */
export function throughFeatures(graph: Pick<Graph, 'edges' | 'nodes'>, id: string): { node: GNode; rel: string; via: number }[] {
  const first = new Set(graph.edges.filter((e) => e.from === id && e.rel === 'NEEDS').map((e) => e.to));
  const seen = new Map<string, { node: GNode; rel: string; via: number }>();
  for (const e of graph.edges) {
    if ((e.rel !== 'BUILT_WITH' && e.rel !== 'USES_DATA') || !first.has(e.from)) continue;
    const node = graph.nodes.find((n) => n.id === e.to); if (!node) continue;
    const have = seen.get(node.id);
    if (have) have.via++; else seen.set(node.id, { node, rel: e.rel, via: 1 });
  }
  return [...seen.values()].sort((a, b) => b.via - a.via || a.node.label.localeCompare(b.node.label));
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

/** The Labels button: every label, the important ones without overlaps, or none. */
export type LabelMode = 'full' | 'smart' | 'none';
const LABEL_MODES: LabelMode[] = ['full', 'smart', 'none'];
export const DEFAULT_LABELS: LabelMode = 'smart';
export const nextLabelMode = (m: LabelMode): LabelMode => LABEL_MODES[(LABEL_MODES.indexOf(m) + 1) % LABEL_MODES.length];
export const labelModeText = (m: LabelMode) => `Labels: ${m[0].toUpperCase()}${m.slice(1)}`;
/** In Smart, a star with at least this many links is important enough to label, whatever its kind. */
export const SMART_LINKS = 4;
/**
 * Does this star want a label? The star under the pointer always does. None: only that and the picked star.
 * Full: every star. Smart: the picked star and what it links to, the big kinds (ideas, teams, the division, rounds,
 * tools), and any star with many links. Smart and None never let labels overlap; Full shows them all.
 */
export function wantsLabel(mode: LabelMode, node: Pick<GNode, 'type'>, links: number, s: { hover?: boolean; picked?: boolean; inView?: boolean }): boolean {
  if (s.hover) return true;
  if (mode === 'none') return !!s.picked;
  if (mode === 'full') return true;
  return !!s.picked || !!s.inView || labelAlways(node) || links >= SMART_LINKS;
}
export const labelsMayOverlap = (m: LabelMode) => m === 'full';

/** Star labels show in full up to this many characters; a longer one is cut with an ellipsis (the full text stays in the tooltip). */
export const LABEL_MAX = 40;
export const starLabel = (label: string) => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label);

/** A selected star wins; otherwise a lit set (the stars an answer rests on) shows the links between them. */
export function edgeStyle(edge: Pick<GEdge, 'from' | 'to' | 'confirmed'> & { rel?: string }, selected: string | null, lit?: Set<string> | null, dim = DIM, hood?: Set<string> | null) {
  const dashed = !edge.confirmed;
  if (selected) {
    const touches = edge.from === selected || edge.to === selected;
    // A selected idea's features keep their tool and system links in view too (no pulse: only the idea's own links travel).
    if (!touches && hood && (edge.rel === 'BUILT_WITH' || edge.rel === 'USES_DATA') && hood.has(edge.from) && hood.has(edge.to)) {
      return { opacity: LINK_IN_VIEW, dashed, pulse: false };
    }
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

/**
 * Flat view: pushes dots apart until none sits closer to another than both their gaps, keeping each inside the box.
 * Deterministic (same input, same picture); stops early once nothing moves.
 */
export function spreadApart(
  pts: ReadonlyMap<string, readonly [number, number]>, gap: (id: string) => number,
  box: { x0: number; y0: number; x1: number; y1: number }, rounds = 80,
): Map<string, [number, number]> {
  const ids = [...pts.keys()].sort();
  const p = ids.map((id) => [pts.get(id)![0], pts.get(id)![1]] as [number, number]);
  const g = ids.map(gap);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  for (let r = 0; r < rounds; r++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        let dx = p[j][0] - p[i][0], dy = p[j][1] - p[i][1];
        let d = Math.hypot(dx, dy);
        const need = g[i] + g[j];
        if (d >= need) continue;
        // Two dots on the same spot part along a fixed angle, so the result never depends on chance.
        if (d < 1e-6) { dx = Math.cos(i * 2.399 + j); dy = Math.sin(i * 2.399 + j); d = 1; }
        const push = (need - d) / 2, ux = dx / d, uy = dy / d;
        p[i][0] -= ux * push; p[i][1] -= uy * push; p[j][0] += ux * push; p[j][1] += uy * push;
        moved = true;
      }
    }
    for (const q of p) { q[0] = clamp(q[0], box.x0, box.x1); q[1] = clamp(q[1], box.y0, box.y1); }
    if (!moved) break;
  }
  return new Map(ids.map((id, i) => [id, p[i]]));
}

/** Flat view zoom: the point under the cursor stays put while the scale changes, between 0.5× and 8×. */
export const FLAT_ZOOM = { min: 0.5, max: 8 };
export function zoomAt(view: { k: number; x: number; y: number }, at: [number, number], centre: [number, number], factor: number) {
  const k = Math.min(FLAT_ZOOM.max, Math.max(FLAT_ZOOM.min, view.k * factor));
  const f = k / view.k;
  return { k, x: at[0] - centre[0] - (at[0] - centre[0] - view.x) * f, y: at[1] - centre[1] - (at[1] - centre[1] - view.y) * f };
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
