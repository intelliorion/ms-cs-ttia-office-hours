import { describe, it, expect } from 'vitest';
import { Color, Quaternion, type Matrix4 } from 'three';
import { frameWatch } from './quality';
import { writeHalos, haloDiameter, LITE_HALO, LITE_HALO_SELECTED } from './Stars';
import { STARFIELD } from './Backdrop';

describe('fps watchdog', () => {
  it('says slow once when the frames after warm-up average over 50 ms', () => {
    const w = frameWatch({ warmup: 2, windowMs: 300, slowMs: 50 });
    const out = [500, 500, 80, 80, 80, 80, 80].map((d) => w(d));
    expect(out.filter(Boolean)).toEqual(['slow']);
    expect(w(80)).toBeNull();
  });
  it('says ok for a smooth browser and skips hidden-tab gaps', () => {
    const w = frameWatch({ warmup: 0, windowMs: 100, slowMs: 50 });
    const out = [5000, 16, 16, 16, 16, 16, 16, 16].map((d) => w(d));
    expect(out.filter(Boolean)).toEqual(['ok']);
  });
});

describe('lite halos', () => {
  it('writes one halo instance per star, without rendering', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, type: i % 7 ? 'Capability' : 'Idea', label: `N${i}` })) as any[];
    const pos = new Map(nodes.map((d, i) => [d.id, [i, -i, i / 2] as [number, number, number]]));
    const seen = { m: new Set<number>(), c: new Set<number>() };
    const sink = { setMatrixAt: (i: number, _m: Matrix4) => seen.m.add(i), setColorAt: (i: number, _c: Color) => seen.c.add(i) };
    const count = writeHalos(sink, {
      nodes, pos, sizes: nodes.map(() => 2), base: nodes.map(() => new Color('#7dd3cf')), bright: nodes.map(() => 1),
      hood: null, selectedId: 'n3', hoverIndex: -1, lite: true, t: 0, facing: new Quaternion(),
    });
    expect(count).toBe(300);
    expect(seen.m.size).toBe(300);
    expect(seen.c.size).toBe(300);
  });
  it('makes the selected star\'s halo larger and pulsing in Lite', () => {
    const plain = haloDiameter(2, { lite: true, selected: false, hovered: false, t: 0 });
    expect(plain).toBeCloseTo(4 * LITE_HALO);
    const sel = [0, 0.3, 0.6].map((t) => haloDiameter(2, { lite: true, selected: true, hovered: false, t }));
    expect(Math.min(...sel)).toBeGreaterThan(plain);
    expect(sel[0]).toBeCloseTo(4 * LITE_HALO_SELECTED);
    expect(new Set(sel.map((x) => x.toFixed(3))).size).toBe(3);
  });
  it('draws a sixth of the starfield in Lite', () => {
    expect(STARFIELD.lite.count).toBe(Math.round(STARFIELD.full.count / 6));
    expect(STARFIELD.lite.factor).toBeGreaterThan(STARFIELD.full.factor);
  });
});

describe('lite links', () => {
  it('batches the quiet links by look and leaves the selection\'s links out', async () => {
    const { linkBatches } = await import('./Links');
    const edges = [
      { id: 'e1', from: 'a', to: 'b', confirmed: true, rel: 'NEEDS' },
      { id: 'e2', from: 'b', to: 'c', confirmed: true, rel: 'NEEDS' },
      { id: 'e3', from: 'c', to: 'd', confirmed: false, rel: 'NEEDS' },
      { id: 'e4', from: 'a', to: 'd', confirmed: true, rel: 'HAS_MEMBER' },
    ] as any[];
    const pts = new Map(edges.map((e) => [e.id, [[0, 0, 0], [1, 1, 1]] as any]));
    const idle = linkBatches(edges, pts, null);
    expect(idle.map((b) => [b.dashed, b.points.length])).toEqual([[false, 4], [true, 2], [false, 2]]);
    const sel = linkBatches(edges, pts, 'a'); // e1 and e4 touch the selection: drawn on their own, with glow
    expect(sel.reduce((n, b) => n + b.points.length / 2, 0)).toBe(2);
  });
});
