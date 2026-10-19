import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export const AXIS = '#9fb0ae';
export const GRID = '#2b4a48';

/** Mounts an ECharts instance in the returned ref's element; disposed on unmount, resized with its box. */
export function useChart(option: echarts.EChartsCoreOption) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);
  useEffect(() => { chart.current?.setOption({ backgroundColor: 'transparent', animation: false, textStyle: { color: AXIS, fontSize: 12 }, ...option }, true); }, [option]);
  return el;
}
