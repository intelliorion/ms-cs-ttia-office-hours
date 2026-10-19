import { describe, it, expect } from 'vitest';
import { neighbourhood, starSize, labelAlways, edgeStyle, bounds, ringColour, degrees } from './graphView';
const g: any = { nodes: [{ id: 'a', type: 'Idea', label: 'A' }, { id: 'b', type: 'Person', label: 'B' }, { id: 'c', type: 'Tool', label: 'C' }],
  edges: [{ id: 'b|RELATED|a', from: 'b', to: 'a', confirmed: true, confidence: 1 }, { id: 'a|NEEDS|c', from: 'a', to: 'c', confirmed: false, confidence: 0.6 }] };
describe('graph view helpers', () => {
  it('finds the neighbourhood', () => expect([...neighbourhood(g, 'a')].sort()).toEqual(['a', 'b', 'c']));
  it('sizes stars by type and links, capped', () => {
    expect(starSize({ type: 'Person' } as any, 0)).toBe(1);
    expect(starSize({ type: 'Idea' } as any, 2)).toBeCloseTo(2.9);
    expect(starSize({ type: 'Idea' } as any, 50)).toBe(4);
  });
  it('labels ideas, teams, tools and entities always', () => {
    expect(labelAlways({ type: 'Idea' } as any)).toBe(true); expect(labelAlways({ type: 'Person' } as any)).toBe(false);
  });
  it('styles edges by confirmation and selection', () => {
    expect(edgeStyle(g.edges[1], null)).toEqual({ opacity: 0.35, dashed: true, pulse: false });
    expect(edgeStyle(g.edges[0], 'a')).toEqual({ opacity: 0.9, dashed: false, pulse: true });
    expect(edgeStyle(g.edges[0], 'c')).toEqual({ opacity: 0.04, dashed: false, pulse: false });
  });
});

describe('framing helpers', () => {
  it('finds the centre and a radius with a floor', () => {
    const { centre, radius } = bounds({ a: [10, 0, 0], b: [-10, 0, 0] });
    expect(centre).toEqual([0, 0, 0]); expect(radius).toBe(40);
  });
  it('colours idea rings by stage, closed grey', () => {
    expect(ringColour({ id: 'i', type: 'Idea', label: 'x', attrs: { stage: 2 } } as any)).toBe('#f5b36b');
    expect(ringColour({ id: 'i', type: 'Idea', label: 'x', attrs: { stage: 3, closed: 'Moved to CSIC' } } as any)).toBe('#5c6b6a');
  });
  it('counts degrees', () => expect(degrees(g).get('a')).toBe(2));
});
