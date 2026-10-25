import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), inboxPost: vi.fn(async () => ({})), inboxDropFile: vi.fn() }));
import { inboxDropFile } from '../api';
import { useStore } from '../state/store';
import { InboxPopout } from './InboxPopout';
import type { InboxItemView } from './inboxHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date().toISOString();
const item = (id: string, extra: Partial<InboxItemView>): InboxItemView => ({ id, file: `${id}.eml`, name: `${id}.eml`, type: 'email', receivedAt: at, status: 'triaged', ...extra });
const view = (items: InboxItemView[]) => ({ items, counts: { new: 0, ok: 0, held: 0, applied: 0 }, problems: [] });

describe('InboxPopout', () => {
  let refreshInbox: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    refreshInbox = vi.fn(async () => {});
    useStore.setState({ refreshInbox, refresh: vi.fn(async () => {}), state: { ideas: [] } as any, notice: null });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('polls the Import every second while a step runs, and stops when closed', () => {
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

  it('while the AI works: no closing, no choosing files, the reason shown, and the pop-out edge glows', () => {
    const closePopout = vi.fn();
    useStore.setState({ closePopout, inbox: view([item('ib1', { name: '01-submissions.csv', steps: [{ id: 'understand', status: 'running', at, detail: 'Reading idea 2 of 7' }] })]) });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<InboxPopout />));
    const x = el.querySelector('[data-action="close"]') as HTMLButtonElement;
    expect(x.disabled).toBe(true);
    expect(x.title).toMatch(/01-submissions\.csv/);
    expect(el.querySelector('.modal')!.classList.contains('ai-working')).toBe(true);
    expect((el.querySelector('[data-testid="inbox-file"]') as HTMLInputElement).disabled).toBe(true);
    expect(el.querySelector('[data-testid="import-locked"]')?.textContent).toMatch(/01-submissions\.csv/);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    act(() => { (el.querySelector('[data-testid="modal-back"]') as HTMLElement).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(closePopout).not.toHaveBeenCalled();
    // When the run ends, everything comes back.
    act(() => { useStore.setState({ inbox: view([item('ib1', { name: '01-submissions.csv', steps: [{ id: 'check', status: 'done', at, detail: 'Done' }] })]) }); });
    expect((el.querySelector('[data-action="close"]') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('.modal')!.classList.contains('ai-working')).toBe(false);
    expect((el.querySelector('[data-testid="inbox-file"]') as HTMLInputElement).disabled).toBe(false);
    expect(el.querySelector('[data-testid="import-locked"]')).toBeNull();
    act(() => root.unmount()); el.remove();
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

  it('reads the Import every 400 ms while a drop is on its way, and stops when it comes back', async () => {
    useStore.setState({ inbox: view([]) });
    vi.mocked(inboxDropFile).mockImplementation(() => new Promise((ok) => setTimeout(() => ok({ item: { id: 'ib9', name: 'note.txt' } }), 1000)));
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    act(() => root.render(<InboxPopout />));
    // The note box is gone: notes arrive as files; commands go to the command bar.
    expect(el.querySelector('[data-testid="inbox-paste"]')).toBeNull();
    const before = refreshInbox.mock.calls.length;
    const drop = new Event('drop', { bubbles: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [new File(['A quick note'], 'note.txt')] } });
    act(() => { el.querySelector('[data-testid="modal-back"]')!.dispatchEvent(drop); });
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(refreshInbox.mock.calls.length - before).toBeGreaterThanOrEqual(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const after = refreshInbox.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(refreshInbox.mock.calls.length).toBe(after);
    act(() => root.unmount());
    el.remove();
  });
});
