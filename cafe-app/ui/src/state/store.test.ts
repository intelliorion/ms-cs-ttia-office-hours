import { describe, it, expect, vi } from 'vitest';

const api = vi.hoisted(() => ({ getState: vi.fn(), getGraph: vi.fn(), getAiStatus: vi.fn() }));
vi.mock('../api', () => api);
import { ideasByStage, waitingSummary, supportCounts, functionRegion } from './store';

const idea = (o: any) => ({ id: 'CAFE-2026-001', title: 't', stage: 1, support: [], overdue: [], sent: {}, due: {}, flags: [], ...o });
const state: any = {
  stageNames: { 1: 'Submit Idea', 2: 'Review and Select', 3: 'Design series', 4: 'Launch and Learn' },
  ideas: [
    idea({}), idea({ id: 'CAFE-2026-002', stage: 2, closed: { as: 'csic', at: '2026-10-19' }, function: 'GSS', region: 'APAC', support: ['A', 'B'] }),
    idea({ id: 'CAFE-2026-003', stage: 2, function: 'GSS', region: 'APAC', support: ['A'], overdue: [{ step: 's2d', text: 'late' }], due: { s2d: '2026-10-24' } }),
    idea({ id: 'CAFE-2026-004', stage: 2, function: 'GSS', region: 'APAC', due: { s2d: '2026-10-20' }, checklist: { s2d: { done: true } } }),
  ],
  outbox: [{ status: 'draft' }, { status: 'approved' }, { status: 'sent' }],
};

describe('selectors', () => {
  it('counts ideas by stage with closed separate', () =>
    expect(ideasByStage(state)).toEqual([['Submit Idea', 1], ['Review and Select', 2], ['Design series', 0], ['Launch and Learn', 0], ['Closed', 1]]));
  it('summarises what is waiting, leaving out replies already received', () =>
    expect(waitingSummary(state)).toEqual({ drafts: 1, approved: 1, repliesDue: 1, late: 1, lateIdeas: ['CAFE-2026-003'] }));
  it('counts support across open ideas only', () => expect(supportCounts(state)).toEqual([['A', 1]]));
  it('groups function and region', () => expect(functionRegion(state)).toEqual([['GSS · APAC', 3], ['— · —', 1]]));
});

describe('selection', () => {
  it('reset view clears the selection and bumps the nonce; labels toggle', async () => {
    const { useStore } = await import('./store');
    useStore.getState().select('a'); useStore.getState().resetView(); useStore.getState().toggleLabels();
    expect(useStore.getState()).toMatchObject({ selectedId: null, viewNonce: 1, labels: true });
  });
});

describe('keepSame', () => {
  it('keeps the old graph when nothing changed, and the old layout when only links changed', async () => {
    const { keepSame } = await import('./store');
    const a = { nodes: [1], edges: [], layout: { n: [0, 0, 0] } };
    expect(keepSame(a, JSON.parse(JSON.stringify(a)))).toBe(a);
    const b = { ...JSON.parse(JSON.stringify(a)), edges: [2] };
    const k = keepSame(a, b);
    expect(k).not.toBe(a);
    expect(k.layout).toBe(a.layout);
    expect(keepSame(null, b)).toBe(b);
  });
});

describe('refresh', () => {
  it('keeps the loaded universe and says why when the graph cannot be read', async () => {
    const { useStore } = await import('./store');
    const prev = { nodes: [{ id: 'a' }], edges: [], layout: {} };
    useStore.setState({ graph: prev, notice: null });
    api.getState.mockResolvedValue({ ideas: [] });
    api.getGraph.mockRejectedValue(new Error('bad cache'));
    await useStore.getState().refresh();
    expect(useStore.getState().graph).toBe(prev);
    expect(useStore.getState().state).toEqual({ ideas: [] });
    expect(useStore.getState().notice).toEqual({ text: "Couldn't refresh the universe: bad cache", kind: 'error' });
  });
});

describe('drawers', () => {
  it('opens one drawer at a time, closes it, and a pop-out closes it', async () => {
    const { useStore } = await import('./store');
    useStore.getState().setDrawer('ideas');
    expect(useStore.getState().drawer).toBe('ideas');
    useStore.getState().setDrawer('charts');
    expect(useStore.getState().drawer).toBe('charts');
    useStore.getState().setDrawer(null);
    expect(useStore.getState().drawer).toBeNull();
    useStore.getState().setDrawer('ideas');
    useStore.getState().openPopout({ kind: 'import' });
    expect(useStore.getState().drawer).toBeNull();
  });
});

describe('focus mode', () => {
  it('labels the pill', async () => { const { focusLabel } = await import('./store'); expect([focusLabel(false), focusLabel(true)]).toEqual(['Focus', 'Show panels']); });
  it('toggleFocus flips, persists, closes drawers and re-frames', async () => {
    const mem: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } });
    const { useStore } = await import('./store');
    const n = useStore.getState().viewNonce;
    useStore.getState().setDrawer('ideas');
    useStore.getState().toggleFocus();
    expect(useStore.getState()).toMatchObject({ focus: true, drawer: null, viewNonce: n + 1 });
    expect(mem['cafe-focus']).toBe('1');
    useStore.getState().toggleFocus();
    expect(useStore.getState().focus).toBe(false);
    expect(mem['cafe-focus']).toBe('0');
    vi.unstubAllGlobals();
  });
  it('survives unavailable storage', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } });
    const { readFocus, useStore } = await import('./store');
    expect(readFocus()).toBe(false);
    expect(() => useStore.getState().toggleFocus()).not.toThrow();
    vi.unstubAllGlobals();
  });
  it('F ignores typing, modifiers and open pop-outs', async () => {
    const { focusKeyApplies: k } = await import('./store');
    expect(k({ key: 'f', target: { tagName: 'DIV' } }, false)).toBe(true);
    expect(k({ key: 'F', target: { tagName: 'INPUT' } }, false)).toBe(false);
    expect(k({ key: 'f', target: { tagName: 'TEXTAREA' } }, false)).toBe(false);
    expect(k({ key: 'f', target: { tagName: 'DIV' } }, true)).toBe(false);
    expect(k({ key: 'f', metaKey: true, target: { tagName: 'DIV' } }, false)).toBe(false);
    expect(k({ key: 'x', target: { tagName: 'DIV' } }, false)).toBe(false);
  });
});
