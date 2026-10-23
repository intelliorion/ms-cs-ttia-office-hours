import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DiagramSpec, NodeKind } from '../../../src/design/diagram';
import { layout, pathOf, wrap, type PlacedNode } from './diagramLayout';

const KIND_WORD: Record<NodeKind, string> = { input: 'Input', step: 'Step', output: 'Output', person: 'Person', store: 'Store', gap: 'Gap' };
const FIT_WORD: Record<string, string> = { yes: 'The tool does it', partly: 'The tool does it only partly', no: "The tool can't do it" };
const ZOOMS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
const LABEL_TAB = 120;

export interface DiagramContext {
  features: { name: string; what?: string; scope?: { status: 'out' | 'outside'; by?: string; why?: string } }[];
  fit: { feature: string; fit: string; note?: string }[];
  steps: { n: number; question: string; answer?: string }[];
  tool?: string;
}

/** How a part stands against the tool: a feature the tool fits only partly or not at all is a gap; so is a "gap" part. */
export function gapOf(n: Pick<PlacedNode, 'kind' | 'feature'>, ctx: DiagramContext): { fit?: string; note?: string; scope?: string } | null {
  const f = n.feature ? ctx.features.find((x) => x.name.toLowerCase() === n.feature!.toLowerCase()) : undefined;
  if (f?.scope) return { scope: f.scope.status === 'out' ? `Out of scope${f.scope.why ? `: ${f.scope.why}` : ''}` : `Done with ${f.scope.by}, outside the ${ctx.tool ?? 'main'} build` };
  const x = n.feature ? ctx.fit.find((y) => y.feature.toLowerCase() === n.feature!.toLowerCase()) : undefined;
  if (x && x.fit !== 'yes') return { fit: x.fit, ...(x.note ? { note: x.note } : {}) };
  if (n.kind === 'gap') return { fit: 'no' };
  return null;
}

/**
 * The design as an interactive diagram: swim lanes, rounded parts coloured by kind (theme colours), arrows with
 * labels. Hover a part to light its whole path; click it for its card (what it does, its feature and fit, the
 * question that set it). Zoom in and out, or fit it to the box; the box scrolls (and drags) when the diagram is wider.
 */
export function DesignDiagram({ spec, ctx }: { spec: DiagramSpec; ctx: DiagramContext }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const L = useMemo(() => layout(spec), [spec]);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const fitZoom = () => {
    const w = box.current?.clientWidth ?? 0;
    if (!w) return 1;
    // Fit to the width, but never so small a phone can't read it: then the box scrolls.
    return Math.max(0.6, Math.min(1.25, (w - 8) / L.width));
  };
  useEffect(() => { setZoom(fitZoom()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [L.width]);
  const lit = hover ?? picked;
  const path = useMemo(() => (lit ? pathOf(spec, lit) : null), [spec, lit]);
  /** The next step up or down from where the zoom is now (it may sit between steps after Fit). */
  const step = (dir: 1 | -1) => setZoom((z) => (dir === 1 ? ZOOMS.find((x) => x > z + 0.001) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((x) => x < z - 0.001) ?? ZOOMS[0]));
  const node = picked ? L.nodes.find((n) => n.id === picked) : undefined;
  const lanes = new Map(L.lanes.map((l) => [l.id, l]));

  return (
    <div className="dd" data-testid="design-diagram">
      <div className="dd-tools">
        <div className="dd-legend" aria-label="Kinds of part">
          {(['input', 'store', 'step', 'output', 'person', 'gap'] as NodeKind[]).filter((k) => spec.nodes.some((n) => n.kind === k)).map((k) => (
            <span key={k} className={`dd-chip k-${k}`}>{KIND_WORD[k]}</span>
          ))}
        </div>
        <div className="dd-zoom">
          <button className="btn sm ghost" data-action="diagram-zoom-out" aria-label="Zoom out" onClick={() => step(-1)}>−</button>
          <span className="dd-pct" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button className="btn sm ghost" data-action="diagram-zoom-in" aria-label="Zoom in" onClick={() => step(1)}>+</button>
          <button className="btn sm ghost" data-action="diagram-fit" onClick={() => setZoom(fitZoom())}>Fit</button>
        </div>
      </div>
      <div className="dd-stage">
        <div className="dd-box" ref={box}
          onPointerDown={(e) => { if (e.button !== 0 || !box.current) return; drag.current = { x: e.clientX, y: e.clientY, l: box.current.scrollLeft, t: box.current.scrollTop, moved: false }; }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d || !box.current) return;
            const dx = e.clientX - d.x; const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
            if (d.moved) { box.current.scrollLeft = d.l - dx; box.current.scrollTop = d.t - dy; }
          }}
          onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
          onPointerLeave={() => { drag.current = null; }}>
          <svg className="dd-svg" width={Math.round(L.width * zoom)} height={Math.round(L.height * zoom)} viewBox={`0 0 ${L.width} ${L.height}`}
            role="img" aria-label={`Design diagram: ${spec.nodes.length} parts in ${spec.lanes.length} lanes`}>
            <defs>
              <marker id={`a${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="dd-head" />
              </marker>
              <marker id={`h${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="dd-head on" />
              </marker>
            </defs>
            {L.lanes.map((l, i) => (
              <g key={l.id} className={`dd-lane lk-${l.kind}${i % 2 ? ' alt' : ''}`}>
                <rect x={6} y={l.y} width={L.width - 12} height={l.h} rx={12} />
                <rect className="dd-lane-tab" x={6} y={l.y} width={LABEL_TAB} height={l.h} rx={12} />
                <text x={18} y={l.y + 22} className="dd-lane-k">{l.kind === 'tool' ? 'THE BUILD' : l.kind === 'outside' ? 'OUTSIDE' : l.kind === 'person' ? 'PEOPLE' : 'DATA'}</text>
                {wrap(l.label, 15, 3).map((t, k) => <text key={k} x={18} y={l.y + 42 + k * 16} className="dd-lane-t">{t}</text>)}
              </g>
            ))}
            {L.edges.map((e) => {
              const on = path?.edges.has(`${e.from}>${e.to}`);
              return (
                <g key={`${e.from}>${e.to}`} className={`dd-edge${on ? ' on' : ''}${path && !on ? ' dim' : ''}${e.back ? ' back' : ''}`}>
                  <path d={e.d} markerEnd={`url(#${on ? 'h' : 'a'}${uid})`} />
                  {e.label && (
                    <g className="dd-elabel" transform={`translate(${e.lx},${e.ly})`}>
                      <rect x={-(e.label.length * 3.3 + 8)} y={-10} width={e.label.length * 6.6 + 16} height={20} rx={10} />
                      <text textAnchor="middle" y={4}>{e.label}</text>
                    </g>
                  )}
                </g>
              );
            })}
            {L.nodes.map((n) => {
              const gap = gapOf(n, ctx);
              const on = path?.nodes.has(n.id);
              const cls = [`dd-node k-${n.kind}`, gap?.fit ? `fit-${gap.fit}` : '', gap?.scope ? 'moved' : '', on ? 'on' : '', path && !on ? 'dim' : '', picked === n.id ? 'picked' : ''].filter(Boolean).join(' ');
              return (
                <g key={n.id} className={cls} transform={`translate(${n.x},${n.y})`} tabIndex={0} role="button" data-node={n.id}
                  aria-label={`${KIND_WORD[n.kind]}: ${n.label}${gap?.fit ? ` (${FIT_WORD[gap.fit] ?? gap.fit})` : ''}`}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                  onClick={() => { if (!drag.current?.moved) setPicked((p) => (p === n.id ? null : n.id)); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked((p) => (p === n.id ? null : n.id)); } }}>
                  <rect width={n.w} height={n.h} rx={14} />
                  <rect className="dd-bar" width={5} height={n.h - 20} x={0} y={10} rx={2.5} />
                  <text x={16} y={18} className="dd-k">{KIND_WORD[n.kind].toUpperCase()}{n.step ? ` · Q${n.step}` : ''}</text>
                  {wrap(n.label).map((t, k) => <text key={k} x={16} y={36 + k * 16} className="dd-t">{t}</text>)}
                  {gap?.fit && <g className="dd-badge" transform={`translate(${n.w - 12},12)`}><circle r={8} /><text textAnchor="middle" y={4}>{gap.fit === 'no' ? '!' : '½'}</text></g>}
                </g>
              );
            })}
          </svg>
        </div>
        {node && (
          <aside className="dd-card" data-testid="diagram-card" aria-label={`About ${node.label}`}>
            <div className="dd-card-h">
              <span className={`dd-chip k-${node.kind}`}>{KIND_WORD[node.kind]}</span>
              <span className="dd-card-lane">{lanes.get(node.lane)?.label}</span>
              <button className="tp-x" aria-label="Close" data-action="diagram-card-close" onClick={() => setPicked(null)}>×</button>
            </div>
            <div className="dd-card-t">{node.label}</div>
            {node.detail && <p className="dd-card-d">{node.detail}</p>}
            {node.feature && (() => {
              const f = ctx.features.find((x) => x.name.toLowerCase() === node.feature!.toLowerCase());
              return (
                <div className="dd-card-s">
                  <div className="dd-card-l">Feature</div>
                  <div><b>{node.feature}</b>{f?.what ? `: ${f.what}` : ''}</div>
                </div>
              );
            })()}
            {(() => {
              const gap = gapOf(node, ctx);
              if (!gap) return node.feature ? <div className="dd-card-s ok"><div className="dd-card-l">Fit</div><div>{FIT_WORD.yes}</div></div> : null;
              return (
                <div className="dd-card-s warn" data-testid="diagram-gap">
                  <div className="dd-card-l">{gap.scope ? 'Moved by the design' : 'Gap'}</div>
                  <div>{gap.scope ?? FIT_WORD[gap.fit!] ?? gap.fit}{gap.note ? `: ${gap.note}` : ''}</div>
                </div>
              );
            })()}
            {node.step && (() => {
              const st = ctx.steps.find((s) => s.n === node.step);
              return st ? (
                <div className="dd-card-s">
                  <div className="dd-card-l">Set by Q{st.n}</div>
                  <div className="dd-card-q">{st.question}</div>
                  <div>{st.answer ?? '(not answered yet)'}</div>
                </div>
              ) : null;
            })()}
          </aside>
        )}
      </div>
      <div className="hint dd-hint">Hover a part to light its path; click it for what it does. Drag or scroll to move around.</div>
    </div>
  );
}

