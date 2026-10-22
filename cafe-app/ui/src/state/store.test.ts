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

describe('left panel view', () => {
  it('opening an idea shows its details, selects its star, closes any modal and turns Focus off', async () => {
    const { openIdeaPatch } = await import('./store');
    expect(openIdeaPatch('CAFE-2026-002', false)).toEqual({ leftView: { kind: 'idea', id: 'CAFE-2026-002' }, selectedId: 'idea:CAFE-2026-002', popout: null, focus: false, drawer: null });
    expect(openIdeaPatch('CAFE-2026-002', true).drawer).toBe('ideas');
  });
  it('back returns to the list and keeps the selection', async () => {
    const mem: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v; } });
    const { useStore, backPatch } = await import('./store');
    expect(backPatch()).toEqual({ leftView: { kind: 'list' }, notice: null, suggest: null });
    useStore.setState({ focus: true, popout: { kind: 'inbox' } });
    useStore.getState().openIdea('CAFE-2026-003');
    expect(useStore.getState()).toMatchObject({ leftView: { kind: 'idea', id: 'CAFE-2026-003' }, selectedId: 'idea:CAFE-2026-003', focus: false, popout: null });
    expect(mem['cafe-focus']).toBe('0');
    useStore.setState({ notice: { text: 'x' }, suggest: { id: 'CAFE-2026-003', stage: 3, label: 'y' } });
    useStore.getState().backToList();
    expect(useStore.getState()).toMatchObject({ leftView: { kind: 'list' }, selectedId: 'idea:CAFE-2026-003', notice: null, suggest: null });
    vi.unstubAllGlobals();
  });
  it('Esc: a modal handles its own, then details go back, then a drawer closes, then the card', async () => {
    const { escAction: esc } = await import('./store');
    const idea = { kind: 'idea', id: 'x' } as const, list = { kind: 'list' } as const;
    const div = { tagName: 'DIV' };
    expect(esc({ modal: true, leftView: idea, detailsVisible: true, drawer: null, card: true, target: div })).toBe('none');
    expect(esc({ modal: false, leftView: idea, detailsVisible: true, drawer: 'ideas', card: true, target: div })).toBe('back');
    expect(esc({ modal: false, leftView: idea, detailsVisible: true, drawer: null, card: false, target: { tagName: 'TEXTAREA' } })).toBe('blur');
    expect(esc({ modal: false, leftView: idea, detailsVisible: true, drawer: null, card: false, target: { tagName: 'INPUT', type: 'checkbox' } })).toBe('back');
    expect(esc({ modal: false, leftView: idea, detailsVisible: false, drawer: null, card: true, target: div })).toBe('deselect');
    expect(esc({ modal: false, leftView: list, detailsVisible: true, drawer: 'charts', card: true, target: div })).toBe('drawer');
    expect(esc({ modal: false, leftView: list, detailsVisible: true, drawer: null, card: true, target: div })).toBe('deselect');
    expect(esc({ modal: false, leftView: list, detailsVisible: true, drawer: null, card: false, target: div })).toBe('none');
  });
});

describe('quality', () => {
  it('cycles Full → Lite → Flat → Full and labels the pill', async () => {
    const { nextQuality, qualityLabel } = await import('./store');
    expect([nextQuality('full'), nextQuality('lite'), nextQuality('flat')]).toEqual(['lite', 'flat', 'full']);
    expect(['full', 'lite', 'flat'].map((q) => qualityLabel(q as any))).toEqual(['Quality: Full', 'Quality: Lite', 'Quality: Flat']);
  });
  it('reads and writes the per-browser quality, ignoring junk and broken storage', async () => {
    const { readQuality, writeQuality, readQualityByHand } = await import('./store');
    localStorage.clear();
    expect(readQuality()).toBeNull();
    writeQuality('lite', true);
    expect([readQuality(), readQualityByHand()]).toEqual(['lite', true]);
    localStorage.setItem('cafe-quality', 'ultra');
    expect(readQuality()).toBeNull();
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try { expect(readQuality()).toBeNull(); expect(readQualityByHand()).toBe(false); } finally { Storage.prototype.getItem = get; }
    localStorage.clear();
  });
  it('spots software WebGL renderers', async () => {
    const { detectSoftwareGl } = await import('./store');
    for (const r of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Mesa OffScreen', 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)', 'Google SwiftShader', 'ANGLE (Software)'])
      expect(detectSoftwareGl(r)).toBe(true);
    for (const r of [null, '', 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel(R) UHD Graphics 620'])
      expect(detectSoftwareGl(r)).toBe(false);
  });
  it('auto-picks Lite once on software graphics, and never overrides a quality set by hand', async () => {
    const { useStore, SOFTWARE_NOTICE, SLOW_NOTICE } = await import('./store');
    localStorage.clear();
    useStore.setState({ quality: 'full', qualitySetByHand: false, notice: null });
    useStore.getState().autoPickQuality('Google SwiftShader');
    expect(useStore.getState()).toMatchObject({ quality: 'lite', qualitySetByHand: false, notice: { text: SOFTWARE_NOTICE } });
    // Second load: something is stored, so no auto-pick and no notice.
    useStore.setState({ quality: 'full', notice: null });
    useStore.getState().autoPickQuality('Google SwiftShader');
    expect(useStore.getState()).toMatchObject({ quality: 'full', notice: null });
    // A hardware renderer on a fresh browser stays Full.
    localStorage.clear();
    useStore.getState().autoPickQuality('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)');
    expect(useStore.getState().quality).toBe('full');
    // The fps watchdog drops Full to Lite once...
    useStore.getState().slowQuality();
    expect(useStore.getState()).toMatchObject({ quality: 'lite', notice: { text: SLOW_NOTICE } });
    expect(localStorage.getItem('cafe-quality')).toBe('lite');
    // ...but not a quality the operator picked.
    useStore.getState().setQuality('full');
    useStore.setState({ notice: null });
    useStore.getState().slowQuality();
    expect(useStore.getState()).toMatchObject({ quality: 'full', qualitySetByHand: true, notice: null });
    useStore.getState().cycleQuality();
    expect([useStore.getState().quality, localStorage.getItem('cafe-quality'), localStorage.getItem('cafe-quality-by-hand')]).toEqual(['lite', 'lite', '1']);
    localStorage.clear();
  });
});

describe('clicking a star', () => {
  it('an idea opens at once (no card); any other star shows with the list on the left; a lit answer ends; empty space only deselects', async () => {
    const { useStore } = await import('./store');
    useStore.setState({ leftView: { kind: 'list' }, selectedId: null, highlight: ['team:gss'], focus: false } as any);
    useStore.getState().clickStar('idea:CAFE-2026-001');
    expect(useStore.getState()).toMatchObject({ leftView: { kind: 'idea', id: 'CAFE-2026-001' }, selectedId: 'idea:CAFE-2026-001', highlight: null });
    useStore.getState().clickStar('capability:x');
    expect(useStore.getState()).toMatchObject({ leftView: { kind: 'list' }, selectedId: 'capability:x' });
    useStore.setState({ highlight: ['a'] });
    useStore.getState().clickStar(null);
    expect(useStore.getState()).toMatchObject({ selectedId: null, highlight: ['a'] });
  });
});

describe('clicking a star in focus mode', () => {
  it('only selects it: no idea opens, the list stays, focus mode stays on', async () => {
    const { useStore } = await import('./store');
    useStore.setState({ leftView: { kind: 'list' }, selectedId: null, highlight: ['x'], focus: true, drawer: null } as any);
    useStore.getState().clickStar('idea:CAFE-2026-001');
    expect(useStore.getState()).toMatchObject({ focus: true, leftView: { kind: 'list' }, selectedId: 'idea:CAFE-2026-001', highlight: null, drawer: null });
    useStore.getState().clickStar('team:gss');
    expect(useStore.getState()).toMatchObject({ focus: true, leftView: { kind: 'list' }, selectedId: 'team:gss' });
    useStore.setState({ focus: false });
  });
});
