import { describe, it, expect } from 'vitest';
import { roleStyle, withFlash, neighbourhood, LINK_IN_VIEW, starSize, labelAlways, edgeStyle, bounds, ringColour, degrees, extent, starLabel, LABEL_MAX, visibleGraph, spreadApart, zoomAt, frameOf, fitFlat, litKey, wantsLabel, nextLabelMode, labelModeText, SMART_LINKS } from './graphView';
const g: any = { nodes: [{ id: 'a', type: 'Idea', label: 'A' }, { id: 'b', type: 'Person', label: 'B' }, { id: 'c', type: 'Tool', label: 'C' }],
  edges: [{ id: 'b|RELATED|a', from: 'b', to: 'a', confirmed: true, confidence: 1 }, { id: 'a|NEEDS|c', from: 'a', to: 'c', confirmed: false, confidence: 0.6 }] };
describe('graph view helpers', () => {
  it('spreads dots apart, inside the box, the same way every time', () => {
    const pts = new Map([['a', [100, 100]], ['b', [100, 100]], ['c', [102, 101]]] as [string, [number, number]][]);
    const box = { x0: 0, y0: 0, x1: 400, y1: 400 };
    const out = spreadApart(pts, () => 15, box);
    const d = (x: string, y: string) => Math.hypot(out.get(x)![0] - out.get(y)![0], out.get(x)![1] - out.get(y)![1]);
    expect(Math.min(d('a', 'b'), d('a', 'c'), d('b', 'c'))).toBeGreaterThanOrEqual(29.9);
    expect(spreadApart(pts, () => 15, box)).toEqual(out);
    const edge = spreadApart(new Map([['a', [0, 0]], ['b', [0, 0]]] as [string, [number, number]][]), () => 50, { x0: 0, y0: 0, x1: 10, y1: 10 });
    for (const [x, y] of edge.values()) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(10); expect(y).toBeLessThanOrEqual(10); }
  });
  it('zooms about the cursor, between 0.5× and 8×', () => {
    const v = zoomAt({ k: 1, x: 0, y: 0 }, [300, 200], [100, 100], 2);
    expect(v.k).toBe(2);
    // The point under the cursor stays where it was.
    expect(100 + (300 - 100) * v.k + v.x).toBeCloseTo(300 + (300 - 300));
    expect(zoomAt({ k: 1, x: 0, y: 0 }, [0, 0], [0, 0], 100).k).toBe(8);
    expect(zoomAt({ k: 1, x: 0, y: 0 }, [0, 0], [0, 0], 0.01).k).toBe(0.5);
  });
  it('labels cycle Full → Smart → None, and each mode wants the right ones', () => {
    expect(nextLabelMode('full')).toBe('smart'); expect(nextLabelMode('smart')).toBe('none'); expect(nextLabelMode('none')).toBe('full');
    expect(labelModeText('smart')).toBe('Labels: Smart');
    const cap = { type: 'Capability' } as const;
    expect(wantsLabel('full', cap, 0, {})).toBe(true);
    expect(wantsLabel('none', cap, 99, {})).toBe(false);
    expect(wantsLabel('none', cap, 0, { hover: true })).toBe(true);
    expect(wantsLabel('none', cap, 0, { picked: true })).toBe(true);
    expect(wantsLabel('smart', cap, 0, {})).toBe(false);
    expect(wantsLabel('smart', cap, SMART_LINKS, {})).toBe(true);
    expect(wantsLabel('smart', { type: 'Idea' }, 0, {})).toBe(true);
    expect(wantsLabel('smart', cap, 0, { inView: true })).toBe(true);
  });
  it('hides kinds of star from the picture with their links, keeps picked stars, and changes nothing when none are hidden', () => {
    expect(visibleGraph(g, [])).toBe(g);
    const v = visibleGraph(g, ['Tool']);
    expect(v.nodes.map((n: any) => n.id)).toEqual(['a', 'b']);
    expect(v.edges.map((e: any) => e.id)).toEqual(['b|RELATED|a']);
    expect(visibleGraph(g, ['Tool'], ['c']).nodes.map((n: any) => n.id)).toEqual(['a', 'b', 'c']);
    expect(g.nodes).toHaveLength(3);
  });
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
    expect(edgeStyle(g.edges[1], null)).toEqual({ opacity: 0.35, dashed: true, derived: false, pulse: false });
    expect(edgeStyle(g.edges[0], 'a')).toEqual({ opacity: LINK_IN_VIEW, dashed: false, derived: false, pulse: true });
    expect(edgeStyle(g.edges[0], 'c')).toEqual({ opacity: 0.04, dashed: false, derived: false, pulse: false });
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

describe('edge styles for what is in view', () => {
  it('a lit set shows the links between lit stars and fades the rest; a selection pulses its own links (the universe passes no selection while stars are lit)', () => {
    const lit = new Set(['a', 'b']);
    expect(edgeStyle({ from: 'a', to: 'b', confirmed: true }, null, lit)).toMatchObject({ opacity: LINK_IN_VIEW, pulse: false });
    expect(edgeStyle({ from: 'a', to: 'c', confirmed: true }, null, lit).opacity).toBe(0.03);
    expect(edgeStyle({ from: 'a', to: 'c', confirmed: true }, 'c', lit)).toMatchObject({ opacity: LINK_IN_VIEW, pulse: true });
  });
});

describe('theme palettes', () => {
  it('each theme has its own scene: night glows, Frost and Blueprint do not', async () => {
    const { paletteFor } = await import('./graphView');
    expect(paletteFor('default').frost).toBe(false);
    expect(paletteFor('frost').frost).toBe(true);
    expect(paletteFor('blueprint')).toMatchObject({ frost: false, blueprint: true, bg: '#2b5f96' });
    expect(paletteFor('unknown')).toBe(paletteFor('default'));
  });
});

describe('workshop shapes', () => {
  it('a gear has its teeth, and its SVG path closes the outline and the hole', async () => {
    const { gearOutline, gearPath, GEAR_TEETH } = await import('./workshopShapes');
    const pts = gearOutline();
    expect(pts).toHaveLength(GEAR_TEETH * 4);
    expect(Math.max(...pts.map(([x, y]) => Math.hypot(x, y)))).toBeCloseTo(1);
    const d = gearPath(100, 100, 10);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(d).not.toContain('NaN');
  });
  it("an old 'mech' choice now reads as Workshop", async () => {
    localStorage.setItem('cafe-theme', 'mech');
    const { readTheme } = await import('../state/store');
    expect(readTheme()).toBe('workshop');
    localStorage.removeItem('cafe-theme');
  });
});

describe('framing an answer', () => {
  it('frameOf: the middle of the stars, far enough back to see them all (70 to 400)', () => {
    expect(frameOf([])).toBeNull();
    expect(frameOf([[10, 0, 0]])).toEqual({ centre: [10, 0, 0], distance: 70 });
    const f = frameOf([[-50, 0, 0], [50, 0, 0]])!;
    expect(f.centre).toEqual([0, 0, 0]); expect(f.distance).toBe(120);
    expect(frameOf([[-900, 0, 0], [900, 0, 0]])!.distance).toBe(400);
  });
  it('fitFlat: the dots end up in the middle of the box, zoom 1 to 2.5', () => {
    const box = { x: 500, y: 100, w: 760, h: 650 };
    const centre: [number, number] = [box.x + box.w / 2, box.y + box.h / 2];
    expect(fitFlat([], box, centre)).toBeNull();
    const v = fitFlat([[600, 200], [700, 300]], box, centre)!;
    const mid = [centre[0] + (650 - centre[0]) * v.k + v.x, centre[1] + (250 - centre[1]) * v.k + v.y];
    expect(mid[0]).toBeCloseTo(centre[0]); expect(mid[1]).toBeCloseTo(centre[1]);
    expect(v.k).toBe(2.5);
    expect(fitFlat([[0, 0], [5000, 5000]], box, centre)!.k).toBe(1);
  });
  it('litKey: the same stars in any order are the same highlight', () => {
    expect(litKey(['b', 'a'])).toBe(litKey(['a', 'b']));
    expect(litKey(null)).toBe(''); expect(litKey([])).toBe('');
  });
});

import { NIGHT, FROST, BLUEPRINT, WORKSHOP } from './graphView';
describe('derived links', () => {
  it('a derived link is dashed and marked derived, whatever its confirmation; every palette has a colour for it', () => {
    const d = { from: 'a', to: 'b', confirmed: true, derived: { rule: 'needs+uses_data', inputs: [] } };
    expect(edgeStyle(d, null)).toMatchObject({ dashed: true, derived: true });
    expect(edgeStyle({ from: 'a', to: 'b', confirmed: false }, null)).toMatchObject({ dashed: true, derived: false });
    expect(edgeStyle({ from: 'a', to: 'b', confirmed: true }, null)).toMatchObject({ dashed: false, derived: false });
    expect(edgeStyle(d, 'a')).toMatchObject({ dashed: true, derived: true, pulse: true });
    for (const p of [NIGHT, FROST, BLUEPRINT, WORKSHOP]) { expect(p.derived).toMatch(/^#/); expect(p.derived).not.toBe(p.unconfirmed); }
  });
});

describe('a person\'s role on an idea, drawn', () => {
  it('lead, builder, sponsor and member each have their own look; other links have none', () => {
    const lead = roleStyle('LEADS', NIGHT)!; const builder = roleStyle('BUILDS', NIGHT)!; const sponsor = roleStyle('SPONSORS', NIGHT)!; const member = roleStyle('RELATED', NIGHT)!;
    expect(lead).toMatchObject({ role: 'lead', colour: NIGHT.roles.LEADS });
    expect(lead.width).toBeGreaterThan(builder.width);
    expect(new Set([lead.colour, builder.colour, sponsor.colour, NIGHT.link]).size).toBe(4);
    expect(member).toMatchObject({ role: 'member', dash: [expect.any(Number), expect.any(Number)] });
    expect(builder.dash).toBeUndefined();
    expect(roleStyle('SUBMITTED', NIGHT)).toBeNull();
    expect(roleStyle('NEEDS', NIGHT)).toBeNull();
    expect(roleStyle(undefined, NIGHT)).toBeNull();
    // Each theme has its own colours; the look per role is the same.
    expect(roleStyle('LEADS', FROST)!.colour).toBe(FROST.roles.LEADS);
    expect(roleStyle('LEADS', FROST)!.width).toBe(lead.width);
    // A role thread a rule derived or still waiting keeps the derived or waiting look.
    expect(roleStyle('LEADS', NIGHT, { derived: true })).toBeNull();
    expect(roleStyle('LEADS', NIGHT, { confirmed: false })).toBeNull();
  });
  it('a changed thread pulses like a selection\'s, at least as bright as a link in view, with nothing selected', () => {
    const e = { id: 'p|LEADS|i', from: 'p', to: 'i', confirmed: true, rel: 'LEADS' };
    const quiet = edgeStyle(e, null);
    expect(withFlash(quiet, e, null)).toEqual(quiet);
    expect(withFlash(quiet, e, new Set(['other']))).toEqual(quiet);
    expect(withFlash(quiet, e, new Set([e.id]))).toEqual({ ...quiet, opacity: LINK_IN_VIEW, pulse: true });
    // Under a selection that already lights it, it stays as it is.
    const sel = edgeStyle(e, 'p');
    expect(withFlash(sel, e, new Set([e.id]))).toEqual(sel);
  });
});
