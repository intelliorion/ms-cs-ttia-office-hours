import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Flat2D } from './Flat2D';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Flat2D', () => {
  it('shows the empty state for an empty graph instead of NaN coordinates', () => {
    const el = document.createElement('div');
    act(() => createRoot(el).render(
      <Flat2D graph={{ nodes: [], edges: [] }} layout={{}} selectedId={null} hoverId={null} labels="smart" onSelect={() => {}} onHover={() => {}} />,
    ));
    expect(el.querySelector('[data-testid="flat2d"]')).not.toBeNull();
    expect(el.textContent).toBe(''); // the welcome card carries the invitation
    expect(el.innerHTML).not.toContain('NaN');
  });
});

const many = (n: number) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `capability:c${i}`, type: 'Capability' as const, label: `Capability number ${i}` })),
  edges: [],
});
const crowded = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`capability:c${i}`, [i * 0.01, i * 0.01, 0] as [number, number, number]]));
function draw(props: Partial<Parameters<typeof Flat2D>[0]> & { n: number }) {
  const el = document.createElement('div'); document.body.appendChild(el);
  act(() => createRoot(el).render(
    <Flat2D graph={many(props.n)} layout={crowded(props.n)} selectedId={null} hoverId={null} labels="smart" onSelect={() => {}} onHover={() => {}} {...props} />,
  ));
  return el;
}
const centres = (el: HTMLElement) => [...el.querySelectorAll('g[data-id]')].map((g) => {
  const c = g.querySelectorAll('circle')[1] as SVGCircleElement;
  return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))];
});

describe('Flat2D spacing, labels and zoom', () => {
  it('pushes dots that sit on top of each other apart', () => {
    const el = draw({ n: 12 });
    const p = centres(el);
    let min = Infinity;
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) min = Math.min(min, Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]));
    expect(min).toBeGreaterThan(20);
    el.remove();
  });

  it('labels: Full shows every one, Smart only what matters without overlap, None none', () => {
    const full = draw({ n: 12, labels: 'full' });
    expect(full.querySelectorAll('.flat-label')).toHaveLength(12);
    const none = draw({ n: 12, labels: 'none' });
    expect(none.querySelectorAll('.flat-label')).toHaveLength(0);
    // Unlinked capabilities are not important enough for Smart, until one is hovered.
    const smart = draw({ n: 12, labels: 'smart', hoverId: 'capability:c3' });
    expect([...smart.querySelectorAll('.flat-label')].map((t) => t.textContent)).toEqual(['Capability number 3']);
    [full, none, smart].forEach((x) => x.remove());
  });
});
