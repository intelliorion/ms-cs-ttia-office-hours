/**
 * The design diagram's layout, worked out in code: swim lanes stacked top to bottom, the parts placed left to right by
 * how far along the flow they are (the longest path to them), and each arrow as a smooth curve. Pure, so it is tested
 * on its own. The pack's DesignDiagram (ui) and the roadshow deck (src/roadshow) draw what it returns.
 */
import type { DiagramSpec, DiagramNode, LaneKind } from './diagram';

export const NODE_W = 176;
export const NODE_H = 62;
export const COL_GAP = 96;
export const ROW_GAP = 16;
export const LANE_PAD = 18;
export const LABEL_W = 132;
export const PAD = 16;

/** Lanes in reading order: the data goes in at the top, the build, the work outside it, then the people. */
const LANE_ORDER: Record<LaneKind, number> = { data: 0, tool: 1, outside: 2, person: 3 };

export interface PlacedLane { id: string; label: string; kind: LaneKind; y: number; h: number }
export interface PlacedNode extends DiagramNode { x: number; y: number; w: number; h: number; col: number }
export interface PlacedEdge { from: string; to: string; label?: string; d: string; lx: number; ly: number; back: boolean }
export interface Layout { width: number; height: number; lanes: PlacedLane[]; nodes: PlacedNode[]; edges: PlacedEdge[] }

/** Edges that close a loop (found by a walk in the spec's order): they are drawn, but do not push a part further right. */
function backEdges(spec: DiagramSpec): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of spec.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const walk = (n: string) => {
    state.set(n, 1);
    for (const m of out.get(n) ?? []) {
      if (state.get(m) === 1) back.add(`${n}>${m}`);
      else if (!state.has(m)) walk(m);
    }
    state.set(n, 2);
  };
  for (const n of spec.nodes) if (!state.has(n.id)) walk(n.id);
  return back;
}

/** Each part's column: 0 for a part nothing flows into, else one more than the furthest part that flows into it. */
export function columns(spec: DiagramSpec): Map<string, number> {
  const back = backEdges(spec);
  const fwd = spec.edges.filter((e) => !back.has(`${e.from}>${e.to}`));
  const col = new Map(spec.nodes.map((n) => [n.id, 0]));
  // A DAG: relaxing once per node is enough.
  for (let i = 0; i < spec.nodes.length; i++) {
    let moved = false;
    for (const e of fwd) {
      const c = col.get(e.from)! + 1;
      if (c > col.get(e.to)!) { col.set(e.to, c); moved = true; }
    }
    if (!moved) break;
  }
  return col;
}

const mid = (a: number, b: number, c: number, d: number) => (a + 3 * b + 3 * c + d) / 8;

export function layout(spec: DiagramSpec): Layout {
  const col = columns(spec);
  const lanes = [...spec.lanes].map((l, i) => ({ l, i })).sort((a, b) => LANE_ORDER[a.l.kind] - LANE_ORDER[b.l.kind] || a.i - b.i).map((x) => x.l);
  // Parts in the same lane and column stack; the lane is as tall as its tallest stack.
  const slot = new Map<string, number>();
  const stacks = new Map<string, number>();
  for (const n of spec.nodes) {
    const k = `${n.lane}|${col.get(n.id)}`;
    slot.set(n.id, stacks.get(k) ?? 0);
    stacks.set(k, (stacks.get(k) ?? 0) + 1);
  }
  const placedLanes: PlacedLane[] = [];
  let y = PAD;
  for (const l of lanes) {
    const tallest = Math.max(1, ...spec.nodes.filter((n) => n.lane === l.id).map((n) => stacks.get(`${n.lane}|${col.get(n.id)}`) ?? 1));
    const h = tallest * NODE_H + (tallest - 1) * ROW_GAP + 2 * LANE_PAD;
    placedLanes.push({ id: l.id, label: l.label, kind: l.kind, y, h });
    y += h + 6;
  }
  const laneOf = new Map(placedLanes.map((l) => [l.id, l]));
  const nodes: PlacedNode[] = spec.nodes.map((n) => {
    const l = laneOf.get(n.lane)!;
    const stack = stacks.get(`${n.lane}|${col.get(n.id)}`) ?? 1;
    const block = stack * NODE_H + (stack - 1) * ROW_GAP;
    const top = l.y + (l.h - block) / 2 + slot.get(n.id)! * (NODE_H + ROW_GAP);
    return { ...n, col: col.get(n.id)!, x: PAD + LABEL_W + col.get(n.id)! * (NODE_W + COL_GAP), y: top, w: NODE_W, h: NODE_H };
  });
  const at = new Map(nodes.map((n) => [n.id, n]));
  const back = backEdges(spec);
  const edges: PlacedEdge[] = spec.edges.map((e) => {
    const a = at.get(e.from)!; const b = at.get(e.to)!;
    let p: [number, number, number, number, number, number, number, number];
    if (b.col > a.col) {
      // Forward: right side to left side.
      const x1 = a.x + a.w; const y1 = a.y + a.h / 2; const x2 = b.x; const y2 = b.y + b.h / 2; const dx = Math.max(32, (x2 - x1) / 2);
      p = [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2];
    } else if (b.col === a.col) {
      // Same column (another lane or stacked): bottom to top, or top to bottom.
      const down = b.y > a.y;
      const x1 = a.x + a.w / 2; const y1 = down ? a.y + a.h : a.y; const x2 = b.x + b.w / 2; const y2 = down ? b.y : b.y + b.h; const dy = Math.max(24, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
      p = [x1, y1, x1 + 30, y1 + dy, x2 + 30, y2 - dy, x2, y2];
    } else {
      // Backwards: out of the right side, round, into the left side.
      const x1 = a.x + a.w; const y1 = a.y + a.h / 2; const x2 = b.x; const y2 = b.y + b.h / 2;
      p = [x1, y1, x1 + 90, y1 + 70, x2 - 90, y2 + 70, x2, y2];
    }
    const [x1, y1, c1x, c1y, c2x, c2y, x2, y2] = p;
    return {
      from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), back: back.has(`${e.from}>${e.to}`) || b.col < a.col,
      d: `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`, lx: mid(x1, c1x, c2x, x2), ly: mid(y1, c1y, c2y, y2),
    };
  });
  const cols = Math.max(0, ...nodes.map((n) => n.col)) + 1;
  return { width: PAD * 2 + LABEL_W + cols * NODE_W + (cols - 1) * COL_GAP, height: y - 6 + PAD, lanes: placedLanes, nodes, edges };
}

/** A part's whole path: everything that flows into it and everything it flows into (loops stop where they started). */
export function pathOf(spec: Pick<DiagramSpec, 'edges'>, id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const edges = new Set<string>();
  const go = (dir: 'fwd' | 'back') => {
    const todo = [id]; const seen = new Set([id]);
    while (todo.length) {
      const n = todo.pop()!;
      for (const e of spec.edges) {
        const [here, there] = dir === 'fwd' ? [e.from, e.to] : [e.to, e.from];
        if (here !== n) continue;
        edges.add(`${e.from}>${e.to}`);
        nodes.add(there);
        if (!seen.has(there)) { seen.add(there); todo.push(there); }
      }
    }
  };
  go('fwd'); go('back');
  return { nodes, edges };
}

/** A label in at most `lines` lines of about `width` characters, the last cut with an ellipsis. */
export function wrap(text: string, width = 22, lines = 2): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= width) cur += ` ${w}`;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length <= lines) return out.map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l));
  const kept = out.slice(0, lines);
  const last = kept[lines - 1];
  kept[lines - 1] = `${last.length > width - 1 ? last.slice(0, width - 1) : last}…`;
  return kept;
}
