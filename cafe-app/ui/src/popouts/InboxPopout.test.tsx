import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), inboxPost: vi.fn(async () => ({})), inboxDropFile: vi.fn(), inboxDropText: vi.fn() }));
import { useStore } from '../state/store';
import { InboxPopout } from './InboxPopout';
import type { InboxItemView } from './inboxHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date().toISOString();
const item = (id: string, extra: Partial<InboxItemView>): InboxItemView => ({ id, file: `${id}.eml`, name: `${id}.eml`, type: 'email', receivedAt: at, status: 'triaged', ...extra });
const view = (items: InboxItemView[]) => ({ items, counts: { new: 0, ok: 0, held: 0, applied: 0 }, problems: [] });

describe('InboxPopout', () => {
  let refreshInbox: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    refreshInbox = vi.fn(async () => {});
    useStore.setState({ refreshInbox, refresh: vi.fn(async () => {}), state: { ideas: [] } as any, notice: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('polls the Inbox every second while a step runs, and stops when closed', () => {
    useStore.setState({ inbox: view([item('ib1', { steps: [{ id: 'read', status: 'running', at, detail: 'Reading the file…' }] })]) });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<InboxPopout />));
    const first = refreshInbox.mock.calls.length; // the read on open
    act(() => { vi.advanceTimersByTime(1000); });
    expect(refreshInbox.mock.calls.length).toBe(first + 1);
    act(() => root.unmount());
    vi.advanceTimersByTime(3000);
    expect(refreshInbox.mock.calls.length).toBe(first + 1);
    el.remove();
  });

  it('does not poll when nothing runs; shows the three zones and the counts', () => {
    useStore.setState({ inbox: view([
      item('ib1', { status: 'applied', steps: [{ id: 'check', status: 'done', at, detail: 'Done' }] }),
      item('ib2', { steps: [{ id: 'check', status: 'needs-you', at, detail: '1 item waits' }] }),
      item('ib3', { status: 'held', hold: { reasons: ['Looks like a list of people'] }, steps: [{ id: 'screen', status: 'needs-you', at, detail: 'x' }] }),
    ]) });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<InboxPopout />));
    const first = refreshInbox.mock.calls.length;
    act(() => { vi.advanceTimersByTime(3000); });
    expect(refreshInbox.mock.calls.length).toBe(first);
    expect(el.querySelector('[data-testid="inbox-drop"].ib-well')).not.toBeNull();
    expect(el.querySelector('[data-testid="inbox-counts"]')?.textContent).toBe('3 processed · 1 need you · 1 held');
    expect([...el.querySelectorAll('.ib-flight > .ib-card')].map((c) => c.getAttribute('data-item'))).toEqual(['ib2', 'ib3']);
    expect(el.querySelectorAll('.ib-row').length).toBe(3);
    // A history row opens its card inline.
    act(() => (el.querySelector('.ib-row[data-row="ib1"]') as HTMLButtonElement).click());
    expect(el.querySelector('.ib-history .ib-card[data-item="ib1"] [data-action="run-again"]')).not.toBeNull();
    // Chips filter the history.
    act(() => (el.querySelector('[data-chip="held"]') as HTMLButtonElement).click());
    expect([...el.querySelectorAll('.ib-row')].map((r) => r.getAttribute('data-row'))).toEqual(['ib3']);
    act(() => root.unmount());
    el.remove();
  });
});
