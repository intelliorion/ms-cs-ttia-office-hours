import { useEffect, useMemo, useRef, useState } from 'react';
import { readFlat, saveFlat } from './viewMemory';
import { useStageSize } from '../layout/Stage';
import {
  DIM, dimFromHide, NODE_COLOURS, LINK_COLOUR, UNCONFIRMED_COLOUR, degrees, edgeStyle, extent, labelSpotVisible, labelsMayOverlap, neighbourhood, ringColour,
  paletteFor, spreadApart, starSize, wantsLabel, zoomAt, type Graph, type LabelMode, type Vec3,
} from './graphView';
import { GEAR_TEETH, gearPath } from './workshopShapes';

interface Props {
  graph: Graph;
  layout: Record<string, Vec3>;
  selectedId: string | null;
  highlight?: string[] | null;
  hideUnlit?: number;
  hoverId: string | null;
  labels: LabelMode;
  focus?: boolean;
  viewNonce?: number;
  onSelect: (id: string | null, additive?: boolean) => void;
  selectedIds?: string[];
  onHover: (id: string | null) => void;
  theme?: string;
}

// The centre gap of the frame, below the title bar and above the pills; on a 1920×1080 frame x 500..1260, y 100..980.
// It leaves room on the right for labels and grows with the window. Focus hides the panels, so the whole stage is used.
const boxFor = (w: number, h: number, focus: boolean) => (focus ? { x: 80, y: 90, w: w - 160, h: h - 190 } : { x: 500, y: 100, w: w - 1160, h: h - 200 });
const PAD = 40;
const RANK: Record<string, number> = { Idea: 0, Team: 1, Round: 1, Entity: 2, Tool: 3, Capability: 4, System: 5, PainPoint: 6, Support: 6, Outcome: 6, Beneficiary: 6, Category: 6, Person: 7 };
const radius = (n: Graph['nodes'][number], links: number) => starSize(n, links) * 3.2;

/** No WebGL (or Quality: Flat): the same graph drawn flat in SVG, dots pushed apart so none crowd; wheel zooms, drag pans. */
export function Flat2D({ graph, layout, selectedId, selectedIds = [], highlight = null, hideUnlit, hoverId, labels, focus = false, viewNonce = 0, onSelect, onHover, theme }: Props) {
  const pal = paletteFor(theme);
  const frost = pal.frost;
  const draft = !!pal.blueprint;
  const shop = !!pal.workshop;
  /** How far right of its dot a label starts, as a radius: Frost's baubles are bigger, and an idea's ring wider still. */
  const labelGap = (n: Graph['nodes'][number], links: number) => radius(n, links) * (frost || draft || shop ? (n.type === 'Idea' ? 1.55 : 1.0) : 1);
  const { w: stageW, h: stageH } = useStageSize();
  const BOX = boxFor(stageW, stageH, focus);
  const deg = useMemo(() => degrees(graph), [graph]);
  const base = useMemo(() => {
    const ids = graph.nodes.map((n) => n.id).filter((id) => layout[id]);
    const box = extent(ids.map((id) => layout[id]));
    if (!box) return new Map<string, [number, number]>();
    const { x0, x1, y0, y1 } = box;
    const k = Math.min((BOX.w - 2 * PAD) / Math.max(1, x1 - x0), (BOX.h - 2 * PAD) / Math.max(1, y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fitted = new Map(ids.map((id) => [id, [BOX.x + BOX.w / 2 + (layout[id][0] - cx) * k, BOX.y + BOX.h / 2 - (layout[id][1] - cy) * k] as [number, number]]));
    // Each dot keeps clear of its neighbours by its glow plus a margin, so the picture reads as dots, not a clump.
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const gap = (id: string) => radius(byId.get(id)!, deg.get(id) ?? 0) * 1.7 + 9;
    return spreadApart(fitted, gap, { x0: BOX.x + PAD / 2, y0: BOX.y + PAD / 2, x1: BOX.x + BOX.w - PAD / 2, y1: BOX.y + BOX.h - PAD / 2 });
  }, [graph.nodes, layout, BOX.x, BOX.y, BOX.w, BOX.h, deg]);

  // Zoom and pan: positions move, dots and labels keep their size, so zooming in opens the picture up.
  // Where the operator left it (remembered across a theme change and a reload); Reset view starts it again.
  const [view, setView] = useState(() => readFlat() ?? { k: 1, x: 0, y: 0 });
  const firstNonce = useRef(viewNonce);
  useEffect(() => { if (viewNonce !== firstNonce.current) setView({ k: 1, x: 0, y: 0 }); }, [viewNonce]);
  useEffect(() => { saveFlat(view); }, [view]);
  const centre: [number, number] = [BOX.x + BOX.w / 2, BOX.y + BOX.h / 2];
  const pts = useMemo(() => new Map([...base].map(([id, p]) => [id, [centre[0] + (p[0] - centre[0]) * view.k + view.x, centre[1] + (p[1] - centre[1]) * view.k + view.y] as [number, number]])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, view, centre[0], centre[1]]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  /** A pointer position in the drawing's own units (the stage may be scaled to fit the window). */
  const toSvg = (cx: number, cy: number): [number, number] => {
    const m = svg.current?.getScreenCTM?.();
    if (!m) return [cx, cy];
    return [(cx - m.e) / m.a, (cy - m.f) / m.d];
  };
  useEffect(() => {
    const el = svg.current; if (!el) return;
    // Not passive, so the page itself never scrolls while zooming.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = toSvg(e.clientX, e.clientY);
      setView((v) => zoomAt(v, at, centre, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const litSet = highlight?.length ? new Set(highlight) : selectedIds.length >= 2 ? new Set(selectedIds.flatMap((id) => [...neighbourhood(graph, id)])) : null;
  const hood = litSet ?? (selectedId ? neighbourhood(graph, selectedId) : null);
  const dim = hood && hideUnlit !== undefined ? dimFromHide(hideUnlit) : DIM;
  const lit = (id: string) => !hood || hood.has(id);
  const picked = (id: string) => id === selectedId || selectedIds.includes(id);
  // Smart and None: labels never overlap (placed in priority order, any that would collide is skipped). Full: all of them.
  const shown = new Set<string>();
  {
    const placed: number[][] = [];
    const overlaps = !labelsMayOverlap(labels);
    const want = graph.nodes.filter((n) => pts.has(n.id) && (lit(n.id) || dim > 0)
      && wantsLabel(labels, n, deg.get(n.id) ?? 0, { hover: n.id === hoverId, picked: picked(n.id), inView: !!hood?.has(n.id) }));
    const score = (id: string, t: string) => (picked(id) || id === hoverId ? -100 : 0) + (hood?.has(id) ? -50 : 0) + (RANK[t] ?? 9) - (deg.get(id) ?? 0) / 100;
    for (const n of want.sort((a, b) => score(a.id, a.type) - score(b.id, b.type))) {
      const p = pts.get(n.id)!; const r = labelGap(n, deg.get(n.id) ?? 0);
      if (p[0] < -50 || p[0] > stageW + 50 || p[1] < -50 || p[1] > stageH + 50) continue;
      const w = n.label.length * (n.type === 'Idea' ? 7.8 : 7); const h = n.type === 'Idea' ? 34 : 18;
      const b = [p[0] + r * 2 + 4, p[1] - 12, p[0] + r * 2 + 8 + w, p[1] - 12 + h];
      // Never under the side panels (Focus hides them), the title bar or the buttons at the bottom.
      if (!labelSpotVisible(b[0], b[2], stageW, !focus, stageW) || b[1] < 76 || b[3] > stageH - 100) continue;
      if (overlaps && placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
      placed.push(b); shown.add(n.id);
    }
  }
  if (!pts.size) return <div className="flat2d-empty" data-testid="flat2d" />;
  return (
    <svg ref={svg} className={`flat2d${drag.current?.moved ? ' panning' : ''}`} viewBox={`0 0 ${stageW} ${stageH}`} width={stageW} height={stageH} data-testid="flat2d" data-zoom={view.k.toFixed(2)}
      onPointerDown={(e) => { if (e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; dragged.current = false; }}
      onPointerMove={(e) => {
        const d = drag.current; if (!d) return;
        const [ax, ay] = toSvg(d.x, d.y); const [bx, by] = toSvg(e.clientX, e.clientY);
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
        if (!d.moved) { d.moved = true; dragged.current = true; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }
        setView((v) => ({ ...v, x: d.vx + bx - ax, y: d.vy + by - ay }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; }}
      onClick={() => { if (!dragged.current) onSelect(null); dragged.current = false; }}>
      <defs>
        <radialGradient id="halo"><stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="0.3" stopColor="#fff" stopOpacity="0.25" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        {Object.entries(NODE_COLOURS).map(([t, c]) => (
          <radialGradient key={t} id={`h-${t}`}><stop offset="0" stopColor={c} stopOpacity="0.85" /><stop offset="0.35" stopColor={c} stopOpacity="0.25" /><stop offset="1" stopColor={c} stopOpacity="0" /></radialGradient>
        ))}
        {/* Frost: a glossy bauble, lit from the upper left. */}
        {frost && Object.entries(NODE_COLOURS).map(([t, c]) => (
          <radialGradient key={`b-${t}`} id={`b-${t}`} cx="0.5" cy="0.5" r="0.62" fx="0.34" fy="0.3">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" /><stop offset="0.22" stopColor={c} /><stop offset="0.85" stopColor={c} /><stop offset="1" stopColor="#1b2a3a" stopOpacity="0.55" />
          </radialGradient>
        ))}
        {shop && <linearGradient id="steel" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#e3e8ec" /><stop offset="0.5" stopColor="#9aa3ab" /><stop offset="1" stopColor="#4d555c" /></linearGradient>}
        {shop && <linearGradient id="wood" x1="0" x2="1"><stop offset="0" stopColor="#8a5a2b" /><stop offset="0.5" stopColor="#c08a52" /><stop offset="1" stopColor="#8a5a2b" /></linearGradient>}
        {frost && <linearGradient id="cap" x1="0" x2="1"><stop offset="0" stopColor="#8a6a26" /><stop offset="0.45" stopColor="#e6c873" /><stop offset="1" stopColor="#8a6a26" /></linearGradient>}
      </defs>
      <g>
        {graph.edges.map((e) => {
          const a = pts.get(e.from), b = pts.get(e.to); if (!a || !b) return null;
          const s = edgeStyle(e, litSet ? null : selectedId, litSet, dim);
          const hotLink = s.pulse || (!!litSet && litSet.has(e.from) && litSet.has(e.to));
          const stroke = frost || draft || shop ? (s.dashed ? pal.unconfirmed : hotLink ? pal.linkHot : pal.link) : s.dashed ? UNCONFIRMED_COLOUR : LINK_COLOUR;
          return <line key={e.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke} strokeOpacity={Math.min(1, (s.pulse ? 0.9 : s.opacity * 1.6) * (frost ? 1.5 : draft ? 1.3 : 1))} strokeWidth={s.pulse ? 1.6 : 1} strokeDasharray={s.dashed ? '5 4' : undefined} />;
        })}
      </g>
      {graph.nodes.map((n) => {
        const p = pts.get(n.id); if (!p) return null;
        const r = radius(n, deg.get(n.id) ?? 0);
        const o = lit(n.id) ? 1 : dim;
        if (o <= 0) return null;
        const hot = n.id === hoverId || n.id === selectedId;
        // Without a glow around it a bauble needs more body to read.
        const rb = r * 1.7;
        const showLabel = shown.has(n.id);
        return (
          <g key={n.id} opacity={o} style={{ cursor: 'pointer' }} data-id={n.id}
            onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)}
            onClick={(e) => { e.stopPropagation(); if (dragged.current) { dragged.current = false; return; } onSelect(n.id, e.ctrlKey || e.metaKey); }}>
            {shop ? (
              <>
                {/* A painted gear in the kind's colour, its centre hole showing the pegboard; a tool is a hammer.
                    Ideas get their stage ring outside the teeth. */}
                {n.type === 'Idea' && <circle cx={p[0]} cy={p[1]} r={rb * 1.6} fill="none" stroke={ringColour(n, pal.ring)} strokeWidth={2} />}
                {n.type === 'Tool' ? (
                  <g transform={`rotate(-26 ${p[0]} ${p[1]})`}>
                    <rect x={p[0] - rb * 0.13} y={p[1] - rb * 0.45} width={rb * 0.26} height={rb * 1.55} rx={rb * 0.08} fill="url(#wood)" stroke="#4a3b2c" strokeWidth={0.8} />
                    <rect x={p[0] - rb * 0.62} y={p[1] - rb * 0.95} width={rb * 1.3} height={rb * 0.5} rx={rb * 0.06} fill="url(#steel)" stroke="#2f343a" strokeWidth={0.8} />
                  </g>
                ) : (
                  <path d={gearPath(p[0], p[1], rb * (hot ? 1.18 : 1.05), GEAR_TEETH, (deg.get(n.id) ?? 0) * 0.3)} fill={NODE_COLOURS[n.type]} fillRule="evenodd"
                    stroke="#3a2f24" strokeWidth={hot ? 1.8 : 1} />
                )}
              </>
            ) : draft ? (
              <>
                {/* A drafted circle: the kind's colour as a pencil ring with centre marks; ideas get a dashed stage ring. */}
                {n.type === 'Idea' && <circle cx={p[0]} cy={p[1]} r={rb * 1.6} fill="none" stroke={ringColour(n, pal.ring)} strokeWidth={1.2} strokeDasharray="4 3" />}
                <circle cx={p[0]} cy={p[1]} r={rb * (hot ? 1.15 : 1)} fill={NODE_COLOURS[n.type]} stroke="#ffffff" strokeWidth={hot ? 2.2 : 1.3} />
                <line x1={p[0] - rb * 0.55} y1={p[1]} x2={p[0] + rb * 0.55} y2={p[1]} stroke="#ffffff" strokeWidth={0.8} opacity={0.75} />
                <line x1={p[0]} y1={p[1] - rb * 0.55} x2={p[0]} y2={p[1] + rb * 0.55} stroke="#ffffff" strokeWidth={0.8} opacity={0.75} />
              </>
            ) : frost ? (
              <>
                {n.type === 'Idea' && <circle cx={p[0]} cy={p[1]} r={rb * 1.75} fill="none" stroke={ringColour(n, pal.ring)} strokeWidth={1.4} />}
                <ellipse cx={p[0]} cy={p[1] + rb * 1.15} rx={rb * 0.9} ry={rb * 0.28} fill="#1b2a3a" opacity={0.12} />
                <rect x={p[0] - rb * 0.3} y={p[1] - rb * 1.22} width={rb * 0.6} height={rb * 0.34} rx={rb * 0.08} fill="url(#cap)" />
                <circle cx={p[0]} cy={p[1]} r={rb * (hot ? 1.15 : 1)} fill={`url(#b-${n.type})`} stroke={hot ? '#1f6f5c' : 'none'} strokeWidth={1.5} />
              </>
            ) : (
              <>
                <circle cx={p[0]} cy={p[1]} r={r * (hot ? 4.2 : 3.4)} fill={`url(#h-${n.type})`} />
                {n.type === 'Idea' && <circle cx={p[0]} cy={p[1]} r={r * 1.75} fill="none" stroke={ringColour(n)} strokeWidth={1.2} />}
                <circle cx={p[0]} cy={p[1]} r={r} fill={NODE_COLOURS[n.type]} />
                <circle cx={p[0]} cy={p[1]} r={r * 0.45} fill="#fff" opacity={hot ? 0.9 : 0.55} />
              </>
            )}
            {showLabel && (
              <text x={p[0] + labelGap(n, deg.get(n.id) ?? 0) * 2 + 6} y={p[1] + 4} className={`flat-label${n.type === 'Idea' ? ' idea' : ''}`}>
                {n.label}
                {n.type === 'Idea' && <tspan x={p[0] + labelGap(n, deg.get(n.id) ?? 0) * 2 + 6} dy={16} className="flat-sub">{n.attrs?.closed ? `Closed · ${n.attrs.closed}` : String(n.attrs?.stageLabel ?? '')}</tspan>}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
