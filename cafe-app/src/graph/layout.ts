import path from 'node:path';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force-3d';
import { paths } from '../workspace/paths';
import { writeFileAtomic, readText } from '../workspace/files';
import type { GEdge, GNode } from './ontology';

export type Layout = Record<string, [number, number, number]>;
type SimNode = { id: string; x: number; y: number; z: number; fx?: number; fy?: number; fz?: number };

// Deterministic pseudo-random start positions from the node id, so a fresh layout is repeatable.
function seeded(id: string): [number, number, number] {
  let h = 2166136261;
  for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const r = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
  return [(r() - 0.5) * 200, (r() - 0.5) * 200, (r() - 0.5) * 200];
}

export function computeLayout(nodes: GNode[], edges: GEdge[], pinned: Layout): Layout {
  const sim: SimNode[] = nodes.map((n) => {
    const p = pinned[n.id] ?? seeded(n.id);
    const s: SimNode = { id: n.id, x: p[0], y: p[1], z: p[2] };
    if (pinned[n.id]) { s.fx = p[0]; s.fy = p[1]; s.fz = p[2]; }
    return s;
  });
  const byId = new Map(sim.map((s) => [s.id, s]));
  const links = edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ source: e.from, target: e.to }));
  // New nodes start next to a pinned neighbour, so they appear where they belong.
  for (const s of sim) {
    if (s.fx !== undefined) continue;
    const nb = links.find((l) => l.source === s.id || l.target === s.id);
    const other = nb ? byId.get(nb.source === s.id ? nb.target : nb.source) : undefined;
    if (other?.fx !== undefined) { s.x = other.x + 12; s.y = other.y + 8; s.z = other.z - 10; }
  }
  const f = forceSimulation(sim, 3).stop()
    .force('link', forceLink(links).id((d: SimNode) => d.id).distance(40).strength(0.6))
    .force('charge', forceManyBody().strength(-120))
    .force('collide', forceCollide(8))
    .force('center', forceCenter(0, 0, 0));
  for (let i = 0; i < 300; i++) f.tick();
  const out: Layout = {};
  for (const s of sim) out[s.id] = [round(s.x), round(s.y), round(s.z)];
  return out;
}
const round = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

export async function layoutFor(root: string, graph: { nodes: GNode[]; edges: GEdge[] }): Promise<Layout> {
  const fileName = path.join(paths(root).graph, 'layout.json');
  const cached = (JSON.parse((await readText(fileName)) ?? '{}') as Layout);
  const ids = new Set(graph.nodes.map((n) => n.id));
  const pinned: Layout = Object.fromEntries(Object.entries(cached).filter(([id]) => ids.has(id)));
  const allPinned = graph.nodes.every((n) => pinned[n.id]);
  const layout = allPinned ? pinned : computeLayout(graph.nodes, graph.edges, pinned);
  if (!allPinned || Object.keys(cached).length !== Object.keys(layout).length) await writeFileAtomic(fileName, JSON.stringify(layout));
  return layout;
}
