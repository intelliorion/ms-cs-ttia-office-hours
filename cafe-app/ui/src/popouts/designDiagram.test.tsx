import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { DesignDiagram, gapOf } from './DesignDiagram';
import { columns, layout, pathOf, wrap, NODE_W } from './diagramLayout';
import { plainDiagram, type DiagramSpec } from '../../../src/design/diagram';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement | undefined; let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); el = undefined; root = undefined; });

const SPEC: DiagramSpec = {
  lanes: [{ id: 'people', label: 'People', kind: 'person' }, { id: 'tool', label: 'Dataiku', kind: 'tool' }, { id: 'data', label: 'Data', kind: 'data' }],
  nodes: [
    { id: 'in', lane: 'data', label: 'Expense export', kind: 'input', detail: 'CSV: claim id, date, policy', step: 1 },
    { id: 'rules', lane: 'data', label: 'Rules sheet', kind: 'store' },
    { id: 'chk', lane: 'tool', label: 'Weekend check', kind: 'step', feature: 'Weekend spend check' },
    { id: 'list', lane: 'tool', label: 'Flagged list', kind: 'output', feature: 'Review list' },
    { id: 'lead', lane: 'people', label: 'Controls lead', kind: 'person' },
    { id: 'other', lane: 'tool', label: 'Unlinked', kind: 'gap' },
  ],
  edges: [{ from: 'in', to: 'chk', label: 'claims' }, { from: 'rules', to: 'chk' }, { from: 'chk', to: 'list' }, { from: 'list', to: 'lead', label: 'reads' }, { from: 'lead', to: 'chk' }],
};
const CTX = {
  features: [{ name: 'Weekend spend check', what: 'Flags weekend claims' }, { name: 'Review list' }],
  fit: [{ feature: 'Weekend spend check', fit: 'yes' }, { feature: 'Review list', fit: 'partly', note: 'Marking is clumsy' }],
  steps: [{ n: 1, question: 'What is the input?', answer: 'A masked CSV export' }],
  tool: 'Dataiku',
};

describe('the diagram layout', () => {
  it('places parts by how far along the flow they are; a loop back does not push them right', () => {
    const c = columns(SPEC);
    expect([c.get('in'), c.get('rules'), c.get('chk'), c.get('list'), c.get('lead')]).toEqual([0, 0, 1, 2, 3]);
    const L = layout(SPEC);
    expect(L.lanes.map((l) => l.kind)).toEqual(['data', 'tool', 'person']);
    const at = (id: string) => L.nodes.find((n) => n.id === id)!;
    expect(at('chk').x - at('in').x).toBeGreaterThanOrEqual(NODE_W);
    // Two parts in one lane and column stack, not overlap.
    expect(Math.abs(at('in').y - at('rules').y)).toBeGreaterThanOrEqual(at('in').h);
    expect(L.edges.find((e) => e.from === 'lead')!.back).toBe(true);
    expect(L.edges.every((e) => e.d.startsWith('M'))).toBe(true);
    expect(L.width).toBeGreaterThan(at('lead').x + at('lead').w);
  });
  it('a part\'s path is everything flowing into and out of it', () => {
    const p = pathOf(SPEC, 'rules');
    expect([...p.nodes].sort()).toEqual(['chk', 'lead', 'list', 'rules']);
    expect(p.nodes.has('other')).toBe(false);
  });
  it('wraps a label in two lines with an ellipsis', () => {
    expect(wrap('Flagged claims review list for the controls committee', 20)).toEqual(['Flagged claims', 'review list for the…']);
    expect(wrap('Short')).toEqual(['Short']);
  });
  it('marks gaps: a feature the tool fits partly, a "gap" part, a feature the design moved', () => {
    expect(gapOf({ kind: 'output', feature: 'Review list' }, CTX)).toEqual({ fit: 'partly', note: 'Marking is clumsy' });
    expect(gapOf({ kind: 'step', feature: 'Weekend spend check' }, CTX)).toBeNull();
    expect(gapOf({ kind: 'gap' }, CTX)).toEqual({ fit: 'no' });
    expect(gapOf({ kind: 'step', feature: 'X' }, { ...CTX, features: [{ name: 'X', scope: { status: 'outside', by: 'Power Apps' } }] })!.scope).toMatch(/outside the Dataiku build/);
  });
});

describe('the interactive diagram', () => {
  const mount = (spec: DiagramSpec) => {
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    act(() => root!.render(<DesignDiagram spec={spec} ctx={CTX} />));
    return el;
  };
  it('draws lanes, parts and arrows; hover lights a path; click opens the card with the feature, the gap and the question', () => {
    const d = mount(SPEC);
    expect(d.querySelectorAll('.dd-lane')).toHaveLength(3);
    expect(d.querySelectorAll('[data-node]')).toHaveLength(6);
    expect(d.querySelectorAll('.dd-edge')).toHaveLength(5);
    const node = (id: string) => d.querySelector(`[data-node="${id}"]`)!;
    act(() => { node('rules').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(node('chk').getAttribute('class')).toMatch(/\bon\b/);
    expect(node('other').getAttribute('class')).toMatch(/\bdim\b/);
    expect(node('list').getAttribute('class')).toMatch(/fit-partly/);
    act(() => { node('list').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const card = d.querySelector('[data-testid="diagram-card"]')!;
    expect(card.textContent).toContain('Flagged list');
    expect(card.textContent).toContain('Review list');
    expect(d.querySelector('[data-testid="diagram-gap"]')!.textContent).toMatch(/only partly: Marking is clumsy/);
    act(() => { node('in').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(d.querySelector('[data-testid="diagram-card"]')!.textContent).toMatch(/Set by Q1What is the input\?A masked CSV export/);
    act(() => (d.querySelector('[data-action="diagram-card-close"]') as HTMLButtonElement).click());
    expect(d.querySelector('[data-testid="diagram-card"]')).toBeNull();
  });
  it('zooms in and out, and the plain diagram (no AI) draws too', () => {
    const d = mount(plainDiagram({ features: [{ name: 'A' }, { name: 'B', scope: { status: 'out' } }], steps: [], tool: { tool: 'Power Apps' } }));
    const pct = () => d.querySelector('.dd-pct')!.textContent;
    const before = pct();
    act(() => (d.querySelector('[data-action="diagram-zoom-in"]') as HTMLButtonElement).click());
    expect(pct()).not.toBe(before);
    expect(d.querySelectorAll('[data-node]').length).toBe(4);
    expect(d.textContent).toContain('Power Apps');
  });
});
