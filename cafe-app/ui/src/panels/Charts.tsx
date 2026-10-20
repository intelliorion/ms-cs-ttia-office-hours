import { useMemo } from 'react';
import { useStore, ideasByStage, waitingSummary, supportCounts, functionRegion } from '../state/store';
import { STAGE_RING } from '../universe/graphView';
import { useChart, AXIS, GRID } from './useChart';

const STAGE_COLOURS = ['1', '2', '3', '4', 'closed'].map((k) => STAGE_RING[k]);
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Chart({ option, height }: { option: Record<string, unknown>; height: number }) {
  const ref = useChart(option);
  return <div ref={ref} className="chart" style={{ height }} />;
}

export function StageChart() {
  const state = useStore((s) => s.state);
  const option = useMemo(() => {
    const rows = state ? ideasByStage(state) : [];
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: rows.map(([n]) => n.replace('Review and Select', 'Review').replace('Launch and Learn', 'Launch').replace('Submit Idea', 'Submit')), axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 12, interval: 0 } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AXIS, fontSize: 11 } },
      series: [{ type: 'bar', barWidth: 28, data: rows.map(([, c], i) => ({ value: c, itemStyle: { color: STAGE_COLOURS[i] ?? STAGE_COLOURS[4] } })), label: { show: true, position: 'top', color: '#e7d8b1', fontSize: 12 } }],
    };
  }, [state]);
  return <Chart option={option} height={150} />;
}

function HBars({ rows, colour, height }: { rows: [string, number][]; colour: string; height: number }) {
  const top = useMemo(() => rows.slice(0, 6).reverse(), [rows]);
  const option = useMemo(() => ({
    grid: { left: 8, right: 30, top: 4, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
    xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AXIS, fontSize: 11 } },
    yAxis: { type: 'category', data: top.map(([n]) => short(n)), axisLine: { lineStyle: { color: GRID } }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 12 } },
    series: [{ type: 'bar', barWidth: 14, data: top.map(([, c]) => c), itemStyle: { color: colour, borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', color: '#e7d8b1', fontSize: 12 } }],
  }), [top, colour]);
  return rows.length ? <Chart option={option} height={height} /> : <div className="nodata" style={{ height }}>Nothing yet</div>;
}

export function SupportChart() {
  const state = useStore((s) => s.state);
  const rows = useMemo(() => (state ? supportCounts(state) : []), [state]);
  return <HBars rows={rows} colour="#e7d8b1" height={Math.max(90, rows.slice(0, 6).length * 30 + 20)} />;
}

export function FunctionChart() {
  const state = useStore((s) => s.state);
  const rows = useMemo(() => (state ? functionRegion(state) : []), [state]);
  return <HBars rows={rows} colour="#7dd3cf" height={Math.max(90, rows.slice(0, 6).length * 30 + 20)} />;
}

export function Waiting() {
  const { state, select, openPopout } = useStore();
  if (!state) return null;
  const w = waitingSummary(state);
  const kpis: [number, string, boolean][] = [[w.drafts, 'Drafts to approve', false], [w.approved, 'Approved, not sent', false], [w.repliesDue, 'Replies due', false], [w.late, 'Replies late', w.late > 0]];
  const open = (id: string) => { select(`idea:${id}`); openPopout({ kind: 'idea', id }); };
  const byId = new Map<string, any>(state.ideas.map((i: any) => [i.id, i]));
  return (
    <>
      <div className="kpis">
        {kpis.map(([n, l, hot]) => <div key={l} className={`kpi${hot ? ' hot' : ''}`}><b>{n}</b><span>{l}</span></div>)}
      </div>
      <ul className="latelist">
        {w.lateIdeas.map((id: string) => {
          const i = byId.get(id);
          return (
            <li key={id} onClick={() => open(id)} onMouseEnter={() => useStore.getState().hover(`idea:${id}`)} onMouseLeave={() => useStore.getState().hover(null)}>
              <span className="iid">{id.replace('CAFE-', '')}</span><span className="ttl">{i?.title}</span>
              <span className="why">{i?.overdue?.[0]?.text}</span>
            </li>
          );
        })}
        {!w.lateIdeas.length && <li className="none">Nothing is late.</li>}
      </ul>
    </>
  );
}
