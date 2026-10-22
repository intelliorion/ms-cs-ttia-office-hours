import { useMemo } from 'react';
import { useStageSize } from '../layout/Stage';
import { DIM, NODE_COLOURS, LINK_COLOUR, UNCONFIRMED_COLOUR, degrees, edgeStyle, extent, labelAlways, neighbourhood, ringColour, starSize, type Graph, type Vec3 } from './graphView';

interface Props {
  graph: Graph;
  layout: Record<string, Vec3>;
  selectedId: string | null;
  hoverId: string | null;
  labels: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

// The centre gap of the frame, below the title bar and above the pills; on a 1920×1080 frame x 500..1260, y 100..980.
// It leaves room on the right for labels and grows with the window.
const boxFor = (w: number, h: number) => ({ x: 500, y: 100, w: w - 1160, h: h - 200 });
const PAD = 50;
const RANK: Record<string, number> = { Idea: 0, Team: 1, Round: 1, Entity: 2, Tool: 3, Capability: 4, System: 5, PainPoint: 6, Support: 6, Person: 7 };

/** No WebGL: the same graph drawn flat in SVG, using x and y of the layout. */
export function Flat2D({ graph, layout, selectedId, hoverId, labels, onSelect, onHover }: Props) {
  const { w: stageW, h: stageH } = useStageSize();
  const BOX = boxFor(stageW, stageH);
  const { pts } = useMemo(() => {
    const ids = graph.nodes.map((n) => n.id).filter((id) => layout[id]);
    const box = extent(ids.map((id) => layout[id]));
    if (!box) return { pts: new Map<string, [number, number]>() };
    const { x0, x1, y0, y1 } = box;
    const k = Math.min((BOX.w - 2 * PAD) / Math.max(1, x1 - x0), (BOX.h - 2 * PAD) / Math.max(1, y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const pts = new Map(ids.map((id) => [id, [BOX.x + BOX.w / 2 + (layout[id][0] - cx) * k, BOX.y + BOX.h / 2 - (layout[id][1] - cy) * k] as [number, number]]));
    return { pts, k };
  }, [graph.nodes, layout, BOX.w, BOX.h]);
  const deg = useMemo(() => degrees(graph), [graph]);
  const hood = selectedId ? neighbourhood(graph, selectedId) : null;
  const lit = (id: string) => !hood || hood.has(id);
  // Labels never overlap: place them in priority order, skip any that would collide.
  const shown = new Set<string>();
  {
    const placed: number[][] = [];
    const want = graph.nodes.filter((n) => pts.has(n.id) && (labels || labelAlways(n) || n.id === hoverId || n.id === selectedId || hood?.has(n.id)));
    const score = (id: string, t: string) => (id === selectedId || id === hoverId ? -100 : 0) + (hood?.has(id) ? -50 : 0) + (RANK[t] ?? 9);
    for (const n of want.sort((a, b) => score(a.id, a.type) - score(b.id, b.type))) {
      const p = pts.get(n.id)!; const r = starSize(n, deg.get(n.id) ?? 0) * 3.2;
      const w = n.label.length * (n.type === 'Idea' ? 7.8 : 7); const h = n.type === 'Idea' ? 34 : 18;
      const b = [p[0] + r * 2 + 4, p[1] - 12, p[0] + r * 2 + 8 + w, p[1] - 12 + h];
      if (placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
      placed.push(b); shown.add(n.id);
    }
  }
  if (!pts.size) return <div className="flat2d-empty" data-testid="flat2d" />;
  return (
    <svg className="flat2d" viewBox={`0 0 ${stageW} ${stageH}`} width={stageW} height={stageH} onClick={() => onSelect(null)} data-testid="flat2d">
      <defs>
        <radialGradient id="halo"><stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="0.3" stopColor="#fff" stopOpacity="0.25" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        {Object.entries(NODE_COLOURS).map(([t, c]) => (
          <radialGradient key={t} id={`h-${t}`}><stop offset="0" stopColor={c} stopOpacity="0.85" /><stop offset="0.35" stopColor={c} stopOpacity="0.25" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient>
        ))}
      </defs>
      <g>
        {graph.edges.map((e) => {
          const a = pts.get(e.from), b = pts.get(e.to); if (!a || !b) return null;
          const s = edgeStyle(e, selectedId);
          return <line key={e.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={s.dashed ? UNCONFIRMED_COLOUR : LINK_COLOUR} strokeOpacity={s.pulse ? 0.9 : s.opacity * 1.6} strokeWidth={s.pulse ? 1.6 : 1} strokeDasharray={s.dashed ? '5 4' : undefined} />;
        })}
      </g>
      {graph.nodes.map((n) => {
        const p = pts.get(n.id); if (!p) return null;
        const r = starSize(n, deg.get(n.id) ?? 0) * 3.2;
        const o = lit(n.id) ? 1 : DIM;
        const hot = n.id === hoverId || n.id === selectedId;
        const showLabel = shown.has(n.id);
        return (
          <g key={n.id} opacity={o} style={{ cursor: 'pointer' }} data-id={n.id}
            onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)}
            onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}>
            <circle cx={p[0]} cy={p[1]} r={r * (hot ? 4.2 : 3.4)} fill={`url(#h-${n.type})`} />
            {n.type === 'Idea' && <circle cx={p[0]} cy={p[1]} r={r * 1.75} fill="none" stroke={ringColour(n)} strokeWidth={1.2} />}
            <circle cx={p[0]} cy={p[1]} r={r} fill={NODE_COLOURS[n.type]} />
            <circle cx={p[0]} cy={p[1]} r={r * 0.45} fill="#fff" opacity={hot ? 0.9 : 0.55} />
            {showLabel && (
              <text x={p[0] + r * 2 + 6} y={p[1] + 4} className={`flat-label${n.type === 'Idea' ? ' idea' : ''}`}>
                {n.label}
                {n.type === 'Idea' && <tspan x={p[0] + r * 2 + 6} dy={16} className="flat-sub">{n.attrs?.closed ? `Closed · ${n.attrs.closed}` : String(n.attrs?.stageLabel ?? '')}</tspan>}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
