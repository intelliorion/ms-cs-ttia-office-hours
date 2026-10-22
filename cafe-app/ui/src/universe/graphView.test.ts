import { describe, it, expect } from 'vitest';
import { neighbourhood, relatedGraph, starSize, labelAlways, edgeStyle, bounds, ringColour, degrees, extent, starLabel, LABEL_MAX } from './graphView';
const g: any = { nodes: [{ id: 'a', type: 'Idea', label: 'A' }, { id: 'b', type: 'Person', label: 'B' }, { id: 'c', type: 'Tool', label: 'C' }],
  edges: [{ id: 'b|RELATED|a', from: 'b', to: 'a', confirmed: true, confidence: 1 }, { id: 'a|NEEDS|c', from: 'a', to: 'c', confirmed: false, confidence: 0.6 }] };
describe('graph view helpers', () => {
  it('finds the neighbourhood', () => expect([...neighbourhood(g, 'a')].sort()).toEqual(['a', 'b', 'c']));
  it('sizes stars by type and links, capped', () => {
    expect(starSize({ type: 'Person' } as any, 0)).toBe(1);
    expect(starSize({ type: 'Idea' } as any, 2)).toBeCloseTo(2.9);
    expect(starSize({ type: 'Idea' } as any, 50)).toBe(3.5);
  });
  it('makes the division the biggest star and teams the next, whatever their links', () => {
    const division = starSize({ type: 'Entity' } as any, 2);
    const team = starSize({ type: 'Team' } as any, 5);
    const busiest = Math.max(...(['Idea', 'Capability', 'PainPoint', 'System', 'Person', 'Tool', 'Round', 'Support'] as const).map((t) => starSize({ type: t } as any, 99)));
    expect(division).toBeGreaterThan(team);
    expect(team).toBeGreaterThan(busiest);
    // Easy to catch, not huge: at most about half again as big as than the busiest idea.
    expect(division / busiest).toBeLessThanOrEqual(1.75);
    expect(starSize({ type: 'Entity' } as any, 40)).toBe(division);
  });
  it('labels ideas, teams, tools and entities always', () => {
    expect(labelAlways({ type: 'Idea' } as any)).toBe(true); expect(labelAlways({ type: 'Round' } as any)).toBe(true); expect(labelAlways({ type: 'Person' } as any)).toBe(false);
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

describe('extent', () => {
  it('is null for no points, so an empty graph never yields NaN', () => expect(extent([])).toBeNull());
  it('spans the points', () => expect(extent([[1, 5], [-3, 2], [4, -1]])).toEqual({ x0: -3, x1: 4, y0: -1, y1: 5 }));
});

describe('labelSpotVisible', () => {
  it('keeps labels out from under the side panels, unless Focus (or drawers) frees the whole stage', async () => {
    const { labelSpotVisible: v } = await import('./graphView');
    expect(v(600, 800, 1920, true)).toBe(true);
    expect(v(470, 600, 1920, true)).toBe(false); // starts under the Ideas panel
    expect(v(1300, 1450, 1920, true)).toBe(false); // runs under the right panels
    expect(v(100, 300, 1920, false)).toBe(true);
    expect(v(1500, 1700, 1920, false)).toBe(true);
    expect(v(250, 400, 960, true)).toBe(true); // a half-size canvas: 500..800 on the stage
    expect(v(200, 400, 960, true)).toBe(false);
  });
  it('star labels: up to 40 characters in full, longer ones cut with an ellipsis', () => {
    expect(starLabel('Collaboration Tooling Guidance')).toBe('Collaboration Tooling Guidance');
    const forty = 'x'.repeat(LABEL_MAX);
    expect(starLabel(forty)).toBe(forty);
    const long = 'A very long idea title that goes on and on past the limit';
    const cut = starLabel(long);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(LABEL_MAX);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });
});

describe('relatedGraph (Only related)', () => {
  const n = (id: string, type: any = 'Capability') => ({ id, type, label: id } as any);
  const e = (from: string, to: string) => ({ id: `${from}>${to}`, from, to, rel: 'NEEDS', confirmed: true } as any);
  const g = {
    nodes: [n('idea:A', 'Idea'), n('cap:1'), n('tool:x', 'Tool'), n('idea:B', 'Idea'), n('cap:far')],
    edges: [e('idea:A', 'cap:1'), e('tool:x', 'idea:A'), e('cap:1', 'tool:x'), e('idea:B', 'cap:1'), e('idea:B', 'cap:far')],
    layout: { 'idea:A': [0, 0, 0], 'cap:1': [1, 0, 0], 'tool:x': [0, 1, 0], 'idea:B': [5, 5, 5], 'cap:far': [9, 9, 9] } as any,
  };
  it('keeps the node, its one-hop neighbours and only the links among them', () => {
    const r = relatedGraph(g, 'idea:A');
    expect(r.nodes.map((x) => x.id).sort()).toEqual(['cap:1', 'idea:A', 'tool:x']);
    expect(r.edges.map((x) => x.id).sort()).toEqual(['cap:1>tool:x', 'idea:A>cap:1', 'tool:x>idea:A']);
  });
  it('keeps positions and drops the rest of the layout', () => {
    const r = relatedGraph(g, 'idea:A');
    expect(Object.keys(r.layout!).sort()).toEqual(['cap:1', 'idea:A', 'tool:x']);
    expect(r.layout!['cap:1']).toEqual([1, 0, 0]);
  });
  it('an unknown node leaves just that id, with no stars', () => {
    expect(relatedGraph(g, 'idea:none').nodes).toEqual([]);
  });
  it('does not touch the graph it was given', () => {
    relatedGraph(g, 'idea:A');
    expect(g.nodes.length).toBe(5);
  });
});
