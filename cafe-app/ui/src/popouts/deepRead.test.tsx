import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { DeepReadPopout } from './DeepReadPopout';
import { DeepReadButton } from '../layout/DeepReadButton';
import { attention, buttonsFor, dashboard, decisionLine, filterIdeas, kindBars, kindCounts, ringLabel, ringShare, sortIdeas, staleKinds, statusLine, tookText, type DeepReadIdea, type DeepReadView } from './deepReadHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); el?.remove(); vi.unstubAllGlobals(); });

const view = (over: Partial<DeepReadView['job']> = {}, sum: Partial<DeepReadView['summary']> = {}): DeepReadView => ({
  model: { id: 'Xenova/all-MiniLM-L6-v2', dir: '/home/me/.cafe-ai/models', cached: false },
  upkeep: { on: true, pending: 0, waiting: false },
  job: { status: 'idle', done: 0, total: 0, ...over },
  summary: {
    chunks: 40, embedded: 0, percent: 0, available: false,
    kinds: { submission: { chunks: 30, embedded: 0 }, email: { chunks: 10, embedded: 0 }, design: { chunks: 0, embedded: 0 }, review: { chunks: 0, embedded: 0 }, roadshow: { chunks: 0, embedded: 0 }, other: { chunks: 0, embedded: 0 } },
    ideas: [{ id: 'CAFE-2026-001', title: 'Vendor contract summariser', chunks: 25, embedded: 0, status: 'new', kinds: { submission: { chunks: 20, embedded: 0 }, email: { chunks: 5, embedded: 0 } } }, { id: 'CAFE-2026-002', title: 'Desk booking', chunks: 15, embedded: 0, status: 'new', kinds: { submission: { chunks: 10, embedded: 0 }, email: { chunks: 5, embedded: 0 } } }],
    ...sum,
  },
});
const read = (): DeepReadView => ({ ...readNoModel(), model: { id: 'Xenova/all-MiniLM-L6-v2', dir: '/home/me/.cafe-ai/models', cached: true } });
const readNoModel = (): DeepReadView => view({ status: 'done', done: 40, total: 40, embedder: 'Xenova/all-MiniLM-L6-v2', lastRun: { at: '2026-10-26T09:00:00.000Z', ms: 48_000, chunks: 40, ideas: 2 } },
  { embedded: 40, percent: 100, available: true, kinds: { submission: { chunks: 30, embedded: 30 }, email: { chunks: 10, embedded: 10 } }, ideas: [{ id: 'CAFE-2026-001', title: 'Vendor contract summariser', chunks: 25, embedded: 25, status: 'read', kinds: { submission: { chunks: 20, embedded: 20 }, email: { chunks: 5, embedded: 5 } }, lastRead: '2026-10-26T09:00:00.000Z' }, { id: 'CAFE-2026-002', title: 'Desk booking', chunks: 15, embedded: 15, status: 'read', kinds: { submission: { chunks: 10, embedded: 10 }, email: { chunks: 5, embedded: 5 } }, lastRead: '2026-10-26T09:00:00.000Z' }] });
/** Five ideas in every state, out of order, for the dashboard. */
const mixed = (): DeepReadIdea[] => [
  { id: 'CAFE-2026-003', title: 'Three', chunks: 4, embedded: 4, status: 'read', kinds: { submission: { chunks: 4, embedded: 4 } }, lastRead: '2026-10-26T09:00:00.000Z' },
  { id: 'CAFE-2026-005', title: 'Five (emails changed)', chunks: 6, embedded: 4, status: 'stale', kinds: { submission: { chunks: 4, embedded: 4 }, email: { chunks: 1, embedded: 0 }, design: { chunks: 1, embedded: 0 } }, lastRead: '2026-10-25T09:00:00.000Z' },
  { id: 'CAFE-2026-001', title: 'One', chunks: 3, embedded: 0, status: 'new', kinds: { submission: { chunks: 3, embedded: 0 } } },
  { id: 'CAFE-2026-002', title: 'Two', chunks: 5, embedded: 5, status: 'read', kinds: { submission: { chunks: 5, embedded: 5 } }, lastRead: '2026-10-26T10:00:00.000Z' },
  { id: 'CAFE-2026-004', title: 'Four', chunks: 2, embedded: 1, status: 'stale', kinds: { submission: { chunks: 2, embedded: 1 } } },
];

describe('deep read helpers', () => {
  it('the ring follows the job while it runs and the summary otherwise; no percentage until something is read', () => {
    expect(ringShare(null)).toBe(0);
    expect(ringLabel(null)).toBe('');
    expect(ringLabel(view())).toBe('');
    expect(ringShare(view({ status: 'running', done: 10, total: 40 }))).toBeCloseTo(0.25);
    expect(ringLabel(view({ status: 'running', done: 10, total: 40 }))).toBe('25%');
    expect(ringLabel(read())).toBe('100%');
    expect(ringShare(view({ status: 'running', done: 0, total: 0 }, { percent: 60, available: true }))).toBeCloseTo(0.6);
  });
  it('the status line says what is happening, when it last read and how long it took, and what changed since', () => {
    expect(statusLine(view())).toBe('Not read yet: press Run once to download the model');
    const here = view(); here.model.cached = true;
    expect(statusLine(here)).toBe('Not read yet');
    // Read by upkeep alone (no Run ever pressed): when, from its last decision.
    const kept = read(); delete kept.job.lastRun; kept.job.lastDecision = { act: 'read', ideas: ['CAFE-2026-001'], why: 'read 2026-001 at start-up · 25 passages', at: '2026-10-26T09:00:00.000Z' };
    expect(statusLine(kept)).toMatch(/^Kept current on its own · last read 26 Oct \d\d:\d\d$/);
    expect(statusLine(view({}, { chunks: 0, ideas: [] }))).toBe('Nothing to read yet: import some ideas first');
    expect(statusLine(view({ status: 'running', done: 12, total: 40 }))).toBe('Reading 12 of 40 passages…');
    expect(statusLine(view({ status: 'paused', done: 16, total: 40 }))).toBe('Paused at 16 of 40');
    expect(statusLine(view({ status: 'error', error: 'The model could not be downloaded' }))).toBe('Could not finish: The model could not be downloaded');
    expect(statusLine(read())).toMatch(/^Read 26 Oct \d\d:\d\d in 48 s$/);
    const stale = read(); stale.summary.ideas[1].status = 'stale';
    expect(statusLine(stale)).toMatch(/ in 48 s · 1 idea changed since$/);
    expect(statusLine(view({}, { otherModel: 'fake' }))).toBe('Read with another model (fake). Rerun all to read with this one.');
    expect(tookText(400)).toBe('under a second'); expect(tookText(185_000)).toBe('3 min 05 s');
  });
  it('the controls are Run, Pause, Continue and Rerun all, by state, never a Yes/No', () => {
    expect(buttonsFor(view()).map((b) => [b.id, b.label, !!b.primary, !!b.disabled])).toEqual([['run', 'Run', true, false]]);
    expect(buttonsFor(view({}, { chunks: 0 }))[0].disabled).toBe(true);
    expect(buttonsFor(view({ status: 'running' })).map((b) => b.id)).toEqual(['pause']);
    expect(buttonsFor(view({ status: 'paused' })).map((b) => b.id)).toEqual(['continue', 'rerun']);
    expect(buttonsFor(read()).map((b) => [b.id, b.label, !!b.disabled])).toEqual([['run', 'Read what changed', true], ['rerun', 'Rerun all', false]]);
    const stale = read(); stale.summary.percent = 90;
    expect(buttonsFor(stale)[0]).toMatchObject({ id: 'run', label: 'Read what changed', primary: true, disabled: false });
    expect(buttonsFor(view({ status: 'error' })).map((b) => b.id)).toEqual(['run', 'rerun']);
    expect(buttonsFor(view({}, { otherModel: 'fake' })).map((b) => b.id)).toEqual(['rerun']);
    expect(kindCounts(read().summary)).toEqual([{ label: 'Submissions', chunks: 30, embedded: 30 }, { label: 'Emails', chunks: 10, embedded: 10 }]);
  });
});

describe('the Deep read pop-out', () => {
  it('shows the ring, the counts, each idea and the copy; Run posts and takes the reply as the new state', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/memory') return new Response(JSON.stringify(view()), { status: 200 });
      if (url === '/api/memory/run' && init?.method === 'POST') return new Response(JSON.stringify(view({ status: 'running', done: 0, total: 40 })), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    useStore.setState({ memory: null, popout: { kind: 'deep-read' } } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<DeepReadPopout />));
    expect(document.querySelector('.modal-title h2')?.textContent).toBe('What the assistant has read');
    expect(document.querySelector('.dr-big')?.textContent).toBe('0%');
    expect(document.querySelector('[data-testid="deep-read-status"]')?.textContent).toBe('Not read yet: press Run once to download the model');
    expect([...document.querySelectorAll('[data-testid="deep-read-bars"] li .beam-n')].map((n) => n.textContent)).toEqual(['0 / 30', '0 / 10']);
    expect(document.querySelectorAll('[data-testid="deep-read-table"] tbody tr')).toHaveLength(2);
    expect(document.querySelector('[data-testid="deep-read-table"] tbody tr .dr-pill')?.textContent).toBe('not yet');
    expect([...document.querySelectorAll('[data-testid="deep-read-tiles"] .dr-tile')].map((t) => t.textContent)).toEqual(['0Read0 %', '0Changed since0 %', '2Not yet100 %']);
    expect(document.querySelector('[data-testid="deep-read-togo"]')?.textContent).toBe('passages to go: 40 (100 %)');
    const heads = [...document.querySelectorAll('.dr-block h4')].map((h) => h.textContent);
    expect(heads).toEqual(['Why', 'Without it', 'What it reads', 'Stays here', 'When it is on']);
    expect(document.querySelector('.dr-model')?.textContent).toContain('downloaded on the first Run');
    expect(document.querySelector('.dr-model')?.textContent).toContain('/home/me/.cafe-ai/models');
    // No Yes/No anywhere: the controls are the four verbs.
    expect([...document.querySelectorAll('.dr-btns button')].map((b) => b.textContent)).toEqual(['Run']);
    await act(async () => (document.querySelector('[data-action="deep-read-run"]') as HTMLButtonElement).click());
    expect(fetch).toHaveBeenCalledWith('/api/memory/run', expect.objectContaining({ method: 'POST' }));
    expect(document.querySelector('[data-testid="deep-read-status"]')?.textContent).toBe('Reading 0 of 40 passages…');
    expect([...document.querySelectorAll('.dr-btns button')].map((b) => b.textContent)).toEqual(['Pause']);
  });

  it('the title-bar button carries the ring and the percentage once read, and opens the pop-out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(read()), { status: 200 })));
    useStore.setState({ memory: null, popout: null } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<DeepReadButton />));
    const btn = document.querySelector('[data-action="deep-read"]') as HTMLButtonElement;
    expect(btn.textContent).toBe('Deep read100%');
    expect(btn.querySelector('.dr-ring svg')).not.toBeNull();
    await act(async () => btn.click());
    expect(useStore.getState().popout).toEqual({ kind: 'deep-read' });
  });
});

describe('the dashboard', () => {
  it('the summary math: counts and shares add up to the ideas, passages to go is what is left', () => {
    const d = dashboard({ ...read().summary, chunks: 20, embedded: 14, percent: 70, ideas: mixed() });
    expect(d).toEqual({ total: 5, read: 2, stale: 2, new: 1, shares: { read: 40, stale: 40, new: 20 }, toGo: 6, toGoPercent: 30 });
    expect(d.shares.read + d.shares.stale + d.shares.new).toBe(100);
    // Rounding: 3 ideas, one each: 33 + 33 + 34 (the largest group takes the remainder; ties go to the first).
    const three = dashboard({ ...read().summary, ideas: mixed().slice(0, 3) });
    expect(three.shares).toEqual({ read: 34, stale: 33, new: 33 });
    expect(dashboard({ ...read().summary, chunks: 0, embedded: 0, percent: 0, ideas: [] })).toEqual({ total: 0, read: 0, stale: 0, new: 0, shares: { read: 0, stale: 0, new: 0 }, toGo: 0, toGoPercent: 0 });
  });
  it('sorts not yet first, then changed since, then read, by ID within; filters by status and by text', () => {
    expect(sortIdeas(mixed()).map((i) => i.id)).toEqual(['CAFE-2026-001', 'CAFE-2026-004', 'CAFE-2026-005', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(filterIdeas(mixed(), 'stale', '').map((i) => i.id)).toEqual(['CAFE-2026-004', 'CAFE-2026-005']);
    expect(filterIdeas(mixed(), 'all', 'two').map((i) => i.id)).toEqual(['CAFE-2026-002']);
    expect(filterIdeas(mixed(), 'read', '005')).toEqual([]);
    expect(filterIdeas(mixed(), 'new', '2026-001').map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect(staleKinds(mixed()[1])).toBe('emails, design');
    expect(staleKinds(mixed()[0])).toBe('');
    expect(staleKinds(mixed()[2])).toBe('submission');
  });
  it('the kind bars, the last decision line and the title-bar attention dot', () => {
    expect(kindBars(read().summary)).toEqual([{ label: 'Submissions', chunks: 30, embedded: 30 }, { label: 'Emails', chunks: 10, embedded: 10 }]);
    expect(decisionLine(undefined)).toBe('');
    expect(decisionLine({ act: 'read', ideas: ['CAFE-2026-003'], why: 'read 2026-003 after Import · 3 passages', at: '2026-10-26T09:00:00.000Z' })).toMatch(/^Last: read 2026-003 after Import · 3 passages · 26 Oct \d\d:\d\d$/);
    expect(decisionLine({ act: 'skip', ideas: ['CAFE-2026-003'], why: 'nothing changed in 2026-003', at: '2026-10-26T09:00:00.000Z' })).toMatch(/^Last: skipped, nothing changed in 2026-003 · 26 Oct/);
    expect(decisionLine({ act: 'queue', ideas: [], why: 'a read is running: 2026-003 will be checked when it ends', at: '2026-10-26T09:00:00.000Z' })).toMatch(/^Last: queued, a read is running/);
    expect(decisionLine({ act: 'defer', ideas: [], why: 'could not read 2026-003: no model; will try again at the next change', at: '2026-10-26T09:00:00.000Z' })).toMatch(/^Last: deferred, could not read 2026-003/);
    expect(attention(null)).toBe(false);
    expect(attention(view())).toBe(false);
    expect(attention(read())).toBe(false);
    const stale = read(); stale.summary.ideas[1].status = 'stale';
    expect(attention(stale)).toBe(true);
    const fresh = read(); fresh.summary.ideas.push(mixed()[2]);
    expect(attention(fresh)).toBe(true);
  });

  it('renders the tiles, the table in order with its pills, the kind bars and the keeps-current block; a chip filters; a row opens the idea and the chip is kept', async () => {
    const v = read(); v.summary.ideas = mixed(); v.summary.chunks = 20; v.summary.embedded = 14; v.summary.percent = 70;
    v.job.lastDecision = { act: 'read', ideas: ['CAFE-2026-003'], why: 'read 2026-003 after Import · 3 passages', at: '2026-10-26T09:00:00.000Z' };
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/memory/upkeep' && init?.method === 'POST') return new Response(JSON.stringify({ ...v, upkeep: { on: false, pending: 0, waiting: false } }), { status: 200 });
      return new Response(JSON.stringify(v), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    useStore.setState({ memory: null, popout: { kind: 'deep-read' }, deepReadView: { filter: 'all', q: '' } } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<DeepReadPopout />));
    const tiles = [...document.querySelectorAll('[data-testid="deep-read-tiles"] .dr-tile')].map((t) => t.textContent);
    expect(tiles).toEqual(['2Read40 %', '2Changed since40 %', '1Not yet20 %']);
    expect(document.querySelector('[data-testid="deep-read-togo"]')?.textContent).toBe('passages to go: 6 (30 %)');
    expect(document.querySelector('[data-testid="deep-read-last"]')?.textContent).toMatch(/^Last: read 2026-003 after Import · 3 passages · 26 Oct/);
    const rows = [...document.querySelectorAll('[data-testid="deep-read-table"] tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-idea'))).toEqual(['CAFE-2026-001', 'CAFE-2026-004', 'CAFE-2026-005', 'CAFE-2026-002', 'CAFE-2026-003']);
    expect(rows.map((r) => r.querySelector('.dr-pill')?.textContent)).toEqual(['not yet', 'changed since', 'changed since', 'read', 'read']);
    expect(rows[2].querySelector('.dr-stale')?.textContent).toBe('emails, design');
    expect(rows[2].querySelector('.dr-count')?.textContent).toBe('4 / 6');
    expect(rows[3].querySelector('.dr-when')?.textContent).toMatch(/26 Oct \d\d:\d\d/);
    expect(rows[0].querySelector('.dr-when')?.textContent).toBe('—');
    expect([...document.querySelectorAll('[data-testid="deep-read-bars"] li')].map((l) => l.querySelector('.beam-n')?.textContent)).toEqual(['30 / 30', '10 / 10']);
    expect(document.querySelector('[data-testid="deep-read-keeps"] p')?.textContent).toContain('reads only what is new or changed');
    expect(document.querySelector('[data-testid="deep-read-keeps"] p')?.textContent).toContain('at start-up');
    expect(document.querySelector('[data-action="deep-read-upkeep"]')?.textContent).toBe('Automatic upkeep: on');
    // The chip row narrows the table; the chip is kept in the store.
    await act(async () => (document.querySelector('[data-chip="stale"]') as HTMLButtonElement).click());
    expect([...document.querySelectorAll('[data-testid="deep-read-table"] tbody tr')].map((r) => r.getAttribute('data-idea'))).toEqual(['CAFE-2026-004', 'CAFE-2026-005']);
    expect(useStore.getState().deepReadView.filter).toBe('stale');
    // A row opens the idea in the left panel and closes the pop-out; the chip survives for next time.
    await act(async () => (document.querySelector('[data-idea="CAFE-2026-005"]') as HTMLTableRowElement).click());
    expect(useStore.getState().leftView).toEqual({ kind: 'idea', id: 'CAFE-2026-005' });
    expect(useStore.getState().popout).toBeNull();
    expect(useStore.getState().deepReadView.filter).toBe('stale');
  });

  it('the switch posts and takes the reply; the block shows before the first run too, with the download line when the model is not here', async () => {
    const v = read();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/memory/upkeep' && init?.method === 'POST') return new Response(JSON.stringify({ ...v, upkeep: { on: false, pending: 0, waiting: false } }), { status: 200 });
      return new Response(JSON.stringify(v), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    useStore.setState({ memory: null, popout: { kind: 'deep-read' }, deepReadView: { filter: 'all', q: '' } } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<DeepReadPopout />));
    await act(async () => (document.querySelector('[data-action="deep-read-upkeep"]') as HTMLButtonElement).click());
    expect(fetch).toHaveBeenCalledWith('/api/memory/upkeep', expect.objectContaining({ method: 'POST', body: JSON.stringify({ on: false }) }));
    expect(document.querySelector('[data-action="deep-read-upkeep"]')?.textContent).toBe('Automatic upkeep: off');
    expect(document.querySelector('[data-testid="deep-read-model"]')).toBeNull();
    // Never run, the model not on this machine: the switch shows (on by default) and the one thing to do is said.
    await act(async () => useStore.setState({ memory: view() } as any));
    expect(document.querySelector('[data-testid="deep-read-keeps"]')).not.toBeNull();
    expect(document.querySelector('[data-action="deep-read-upkeep"]')?.textContent).toBe('Automatic upkeep: on');
    expect(document.querySelector('[data-testid="deep-read-model"]')?.textContent).toBe('The model is not on this machine yet: press Run once to download it. After that Deep read keeps itself current.');
    expect(document.querySelector('[data-testid="deep-read-tiles"]')).not.toBeNull();
    // The model here: no download line.
    const here = view(); here.model.cached = true;
    await act(async () => useStore.setState({ memory: here } as any));
    expect(document.querySelector('[data-testid="deep-read-model"]')).toBeNull();
    // Not here and not downloadable (offline, or the last Run could not get it): the one message with the three ways in,
    // in place of the download line; the status line points at it; the footer says downloads are off.
    const WAYS = 'The reading model (Xenova/all-MiniLM-L6-v2, about 23 MB) is not on this machine and downloads are off (CAFE_MODEL_OFFLINE=1). Three ways in:\n1. Firm mirror: set CAFE_MODEL_MIRROR …\n2. Import by hand: … cafe model import <folder-or-zip> …\n3. Export from a colleague: … cafe model export model.zip …';
    const blocked = view(); blocked.model = { ...blocked.model, offline: true, help: WAYS };
    await act(async () => useStore.setState({ memory: blocked } as any));
    expect(document.querySelector('[data-testid="deep-read-model"]')).toBeNull();
    expect(document.querySelector('[data-testid="deep-read-ways"]')?.textContent).toBe(WAYS);
    expect(document.querySelector('[data-testid="deep-read-status"]')?.textContent).toBe('Not read yet: the model is not on this machine (see below)');
    expect(document.querySelector('.dr-model')?.textContent).toContain('not on this machine (downloads are off)');
    const failed = view({ status: 'error', error: WAYS }); failed.model = { ...failed.model, help: WAYS };
    await act(async () => useStore.setState({ memory: failed } as any));
    expect(document.querySelector('[data-testid="deep-read-status"]')?.textContent).toBe('Could not start: the model is not on this machine (see below)');
    expect(document.querySelector('[data-testid="deep-read-ways"]')?.textContent).toBe(WAYS);
    // Imported, or from the mirror: the footer says so.
    const imported = read(); imported.model = { ...imported.model, source: 'import' };
    await act(async () => useStore.setState({ memory: imported } as any));
    expect(document.querySelector('.dr-model')?.textContent).toContain('on this machine (imported)');
    expect(document.querySelector('[data-testid="deep-read-ways"]')).toBeNull();
  });

  it('the title-bar pill shows a dot when anything is changed since or not yet', async () => {
    const stale = read(); stale.summary.ideas[1].status = 'stale';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(stale), { status: 200 })));
    useStore.setState({ memory: null, popout: null } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<DeepReadButton />));
    expect(document.querySelector('[data-action="deep-read"] .dr-attn')).not.toBeNull();
    expect(document.querySelector('[data-action="deep-read"]')?.getAttribute('aria-label')).toContain('1 idea to read');
  });
});
