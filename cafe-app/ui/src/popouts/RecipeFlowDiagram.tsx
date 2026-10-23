import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DS_H, DS_W, FLOW_KIND_WORD, flowDetail, flowLabel, flowLayout, flowPathOf, RC_R, type FlowNode, type RecipeFlow,
} from '../../../src/design/recipeFlow';

const ZOOMS = [0.5, 0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5];
/** The legend chips: the same colours as the parts. */
const LEGEND: [string, string][] = [['k-input', 'Input dataset'], ['k-store', 'Dataset or rules sheet'], ['k-step', 'Recipe'], ['k-output', 'Output dataset'], ['k-person', 'Dashboard']];

function Shape({ n }: { n: FlowNode }) {
  const lines = flowLabel(n);
  if (n.type === 'recipe') {
    return (
      <>
        <circle cx={n.cx} cy={n.cy} r={RC_R} />
        <text className="rf-ic" x={n.cx} y={n.cy + 5} textAnchor="middle">{(n.kind[0] ?? 'r').toUpperCase()}</text>
        {lines.map((t, k) => <text key={k} className="rf-t" x={n.cx} y={n.cy + RC_R + 16 + k * 15} textAnchor="middle">{t}</text>)}
      </>
    );
  }
  const x = n.cx - DS_W / 2; const y = n.cy - DS_H / 2;
  return (
    <>
      <rect x={x} y={y} width={DS_W} height={DS_H} rx={n.type === 'dashboard' ? 14 : 6} />
      <rect className="rf-bar" x={x} y={y} width={DS_W} height={5} rx={2.5} />
      <text className="rf-k" x={x + 10} y={y + 19}>{n.type === 'dashboard' ? 'DASHBOARD' : (FLOW_KIND_WORD[n.kind] ?? 'Dataset').toUpperCase()}</text>
      {lines.map((t, k) => <text key={k} className="rf-t" x={x + 10} y={y + 36 + k * 14}>{t}</text>)}
    </>
  );
}

/**
 * The Dataiku kit's recipe flow, as Dataiku draws its Flow: datasets (boxes) go into recipes (circles), which make the
 * output datasets and the dashboard. Hover a part to light its path; click it for its card (a recipe's steps, a
 * dataset's columns). Drawn with the design diagram's styles, so it reads the same in every theme.
 */
export function RecipeFlowDiagram({ flow }: { flow: RecipeFlow }) {
  const L = useMemo(() => flowLayout(flow), [flow]);
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const fitZoom = () => {
    const w = box.current?.clientWidth ?? 0;
    return w ? Math.max(0.6, Math.min(1.25, (w - 8) / L.width)) : 1;
  };
  useEffect(() => { setZoom(fitZoom()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [L.width]);
  const lit = hover ?? picked;
  const path = useMemo(() => (lit ? flowPathOf(flow, lit) : null), [flow, lit]);
  const step = (dir: 1 | -1) => setZoom((z) => (dir === 1 ? ZOOMS.find((x) => x > z + 0.001) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((x) => x < z - 0.001) ?? ZOOMS[0]));
  const card = picked ? flowDetail(flow, picked) : undefined;
  const toggle = (id: string) => setPicked((p) => (p === id ? null : id));
  return (
    <div className="dd rf" data-testid="recipe-flow">
      <div className="dd-tools">
        <div className="dd-legend" aria-label="Kinds of part">
          {LEGEND.filter(([k]) => k !== 'k-person' || flow.dashboard).map(([k, w]) => <span key={k} className={`dd-chip ${k}`}>{w}</span>)}
        </div>
        <div className="dd-zoom">
          <button className="btn sm ghost" data-action="flow-zoom-out" aria-label="Zoom out" onClick={() => step(-1)}>−</button>
          <span className="dd-pct" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button className="btn sm ghost" data-action="flow-zoom-in" aria-label="Zoom in" onClick={() => step(1)}>+</button>
          <button className="btn sm ghost" data-action="flow-fit" onClick={() => setZoom(fitZoom())}>Fit</button>
        </div>
      </div>
      <div className="dd-stage">
        <div className="dd-box" ref={box}>
          <svg className="dd-svg" width={Math.round(L.width * zoom)} height={Math.round(L.height * zoom)} viewBox={`0 0 ${L.width} ${L.height}`}
            role="img" aria-label={`Recipe flow: ${flow.datasets.length} datasets, ${flow.recipes.length} recipes${flow.dashboard ? ', a dashboard' : ''}`}>
            <defs>
              <marker id="rf-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="dd-head" /></marker>
              <marker id="rf-h" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="dd-head on" /></marker>
            </defs>
            {L.edges.map((e) => {
              const on = path?.edges.has(`${e.from}>${e.to}`);
              return <path key={`${e.from}>${e.to}`} className={`rf-edge${on ? ' on' : ''}${path && !on ? ' dim' : ''}`} d={e.d} markerEnd={`url(#rf-${on ? 'h' : 'a'})`} />;
            })}
            {L.nodes.map((n) => {
              const on = path?.nodes.has(n.id);
              const cls = ['rf-node', `rf-${n.type}`, `rk-${n.kind}`, on ? 'on' : '', path && !on ? 'dim' : '', picked === n.id ? 'picked' : ''].filter(Boolean).join(' ');
              return (
                <g key={n.id} className={cls} tabIndex={0} role="button" data-node={n.id}
                  aria-label={`${n.type === 'dashboard' ? 'Dashboard' : FLOW_KIND_WORD[n.kind] ?? n.type}: ${n.label}`}
                  onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
                  onClick={() => toggle(n.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n.id); } }}>
                  <Shape n={n} />
                </g>
              );
            })}
          </svg>
        </div>
        {card && (
          <aside className="dd-card" data-testid="flow-card" aria-label={`About ${card.title}`}>
            <div className="dd-card-h">
              <span className="dd-card-lane">{card.kind}</span>
              <button className="tp-x" aria-label="Close" data-action="flow-card-close" onClick={() => setPicked(null)}>×</button>
            </div>
            <div className="dd-card-t">{card.title}</div>
            {card.lines.map((l) => (
              <div key={l.label} className="dd-card-s">
                <div className="dd-card-l">{l.label}</div>
                {l.items.length === 1 && l.label !== 'Steps' ? <div>{l.items[0]}</div> : (
                  l.label === 'Steps' ? <ol className="rf-list">{l.items.map((x, i) => <li key={i}>{x}</li>)}</ol> : <ul className="rf-list">{l.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                )}
              </div>
            ))}
          </aside>
        )}
      </div>
      <div className="hint dd-hint">Hover a dataset or recipe to light its path; click it for its columns or its steps. The same picture is in flow-diagram.html.</div>
    </div>
  );
}
