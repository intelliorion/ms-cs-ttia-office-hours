import { useMemo } from 'react';
import { useStore, ideasByStage, waitingSummary, supportCounts, functionRegion } from '../state/store';
import { STAGE_RING } from '../universe/graphView';

/**
 * The right panel's charts, drawn in the universe's own language: stages as glowing stars on one line, demand as
 * light beams. Plain SVG and CSS, no axes or grids. Lite quality drops the glow and the grow-in (theme.css).
 */

const STAGE_KEYS = ['2', '3', '4', 'closed'];
const SHORT: Record<string, string> = { 'Review and Select': 'Review', 'Design series': 'Design', 'Launch and Learn': 'Launch', Closed: 'Closed' };

/** Star radius for a count: 0 is a small hollow ring, then grows with the square root so 1 and 9 both read. */
export const starRadius = (n: number) => (n <= 0 ? 6 : Math.min(26, 10 + 5 * Math.sqrt(n)));

export function StageChart() {
  const state = useStore((s) => s.state);
  const rows = useMemo(() => (state ? ideasByStage(state) : []), [state]);
  const W = 400; const H = 176; const y = 86;
  const xs = rows.map((_, i) => 40 + (i * (W - 80)) / Math.max(1, rows.length - 1));
  return (
    <svg className="constellation" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Ideas by stage" data-testid="stage-chart">
      {xs.length > 1 && <line className="orbit" x1={xs[0]} y1={y} x2={xs[xs.length - 1]} y2={y} />}
      {rows.map(([name, count], i) => {
        const c = STAGE_RING[STAGE_KEYS[i]] ?? STAGE_RING.closed;
        const r = starRadius(count);
        return (
          <g key={name} className={`stage-star${count ? '' : ' empty'}`} style={{ ['--c' as string]: c }} data-stage={name} data-count={count}>
            <title>{`${name}: ${count}`}</title>
            {count > 0 && <circle className="halo" cx={xs[i]} cy={y} r={r * 1.9} />}
            <circle className="core" cx={xs[i]} cy={y} r={r} />
            <text className="count" x={xs[i]} y={y - r - 9} textAnchor="middle">{count}</text>
            <text className="label" x={xs[i]} y={H - 16} textAnchor="middle">{SHORT[name] ?? name}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Rows as light beams: the longest is the full width, the rest in proportion; a bright dot ends each beam. */
export function Beams({ rows, colour, testId }: { rows: [string, number][]; colour: string; testId: string }) {
  const top = useMemo(() => rows.slice(0, 6), [rows]);
  const max = Math.max(1, ...top.map(([, n]) => n));
  if (!top.length) return <div className="nodata">Nothing yet</div>;
  return (
    <ul className="beams" style={{ ['--c' as string]: colour }} data-testid={testId}>
      {top.map(([name, n]) => (
        <li key={name} title={`${name}: ${n}`}>
          <span className="beam-l" title={name}>{name}</span>
          <span className="beam-track"><span className="beam" style={{ width: `${Math.max(6, (n / max) * 100)}%` }}><i className="beam-dot" /></span></span>
          <span className="beam-n">{n}</span>
        </li>
      ))}
    </ul>
  );
}

export function SupportChart() {
  const state = useStore((s) => s.state);
  const rows = useMemo(() => (state ? supportCounts(state) : []), [state]);
  return <Beams rows={rows} colour="#e7d8b1" testId="support-chart" />;
}

export function FunctionChart() {
  const state = useStore((s) => s.state);
  const rows = useMemo(() => (state ? functionRegion(state) : []), [state]);
  return <Beams rows={rows} colour="#7dd3cf" testId="function-chart" />;
}

export function Waiting() {
  const { state, openIdea } = useStore();
  if (!state) return null;
  const w = waitingSummary(state);
  const kpis: [number, string, boolean][] = [[w.drafts, 'Drafts to approve', false], [w.approved, 'Approved, not sent', false], [w.repliesDue, 'Replies due', false], [w.late, 'Replies late', w.late > 0]];
  const open = openIdea;
  const byId = new Map<string, any>(state.ideas.map((i: any) => [i.id, i]));
  return (
    <>
      <div className="kpis">
        {kpis.map(([n, l, hot]) => <div key={l} className={`kpi${hot ? ' hot' : ''}${n ? '' : ' zero'}`}><b>{n}</b><span>{l}</span></div>)}
      </div>
      <ul className="latelist">
        {w.lateIdeas.map((id: string) => {
          const i = byId.get(id);
          return (
            <li key={id} onClick={() => open(id)} onMouseEnter={() => useStore.getState().hover(`idea:${id}`)} onMouseLeave={() => useStore.getState().hover(null)}>
              <span className="iid">{id.replace('CAFE-', '')}</span><span className="ttl" title={i?.title}>{i?.title}</span>
              <span className="why">{i?.overdue?.[0]?.text}</span>
            </li>
          );
        })}
        {!w.lateIdeas.length && <li className="none">Nothing is late.</li>}
      </ul>
    </>
  );
}
