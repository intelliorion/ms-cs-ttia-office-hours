import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { DeepReadPopout } from './DeepReadPopout';
import { DeepReadButton } from '../layout/DeepReadButton';
import { buttonsFor, kindCounts, ringLabel, ringShare, statusLine, tookText, type DeepReadView } from './deepReadHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); el?.remove(); vi.unstubAllGlobals(); });

const view = (over: Partial<DeepReadView['job']> = {}, sum: Partial<DeepReadView['summary']> = {}): DeepReadView => ({
  model: { id: 'Xenova/all-MiniLM-L6-v2', dir: '/home/me/.cafe-ai/models', cached: false },
  job: { status: 'idle', done: 0, total: 0, ...over },
  summary: {
    chunks: 40, embedded: 0, percent: 0, available: false,
    kinds: { submission: { chunks: 30, embedded: 0 }, email: { chunks: 10, embedded: 0 }, design: { chunks: 0, embedded: 0 }, review: { chunks: 0, embedded: 0 }, roadshow: { chunks: 0, embedded: 0 }, other: { chunks: 0, embedded: 0 } },
    ideas: [{ id: 'CAFE-2026-001', title: 'Vendor contract summariser', chunks: 25, embedded: 0, status: 'new' }, { id: 'CAFE-2026-002', title: 'Desk booking', chunks: 15, embedded: 0, status: 'new' }],
    ...sum,
  },
});
const read = (): DeepReadView => view({ status: 'done', done: 40, total: 40, lastRun: { at: '2026-10-26T09:00:00.000Z', ms: 48_000, chunks: 40, ideas: 2 } },
  { embedded: 40, percent: 100, available: true, kinds: { submission: { chunks: 30, embedded: 30 }, email: { chunks: 10, embedded: 10 } }, ideas: [{ id: 'CAFE-2026-001', title: 'Vendor contract summariser', chunks: 25, embedded: 25, status: 'read' }, { id: 'CAFE-2026-002', title: 'Desk booking', chunks: 15, embedded: 15, status: 'read' }] });

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
    expect(statusLine(view())).toBe('Not read yet');
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
    expect(document.querySelector('[data-testid="deep-read-status"]')?.textContent).toBe('Not read yet');
    expect(document.querySelector('[data-testid="deep-read-kinds"]')?.textContent).toBe('Submissions 0/30Emails 0/10');
    expect(document.querySelectorAll('[data-testid="deep-read-ideas"] li')).toHaveLength(2);
    expect(document.querySelector('[data-testid="deep-read-ideas"] li .dr-st')?.textContent).toBe('not yet');
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
