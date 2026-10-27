import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getChat: vi.fn(async () => ({ threads: [], current: { thread: null, entries: [] } })),
  getThread: vi.fn(), chatStream: vi.fn(), chatPost: vi.fn(),
}));
import { chatPost, chatStream, getThread } from '../api';
import { useStore } from '../state/store';
import { useChat } from '../state/chat';
import { Assistant, AssistantLauncher } from './Assistant';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollTo = function () {};

const graph = { nodes: [
  { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Vendor contract summariser' },
  { id: 'team:gss', type: 'Team', label: 'GSS' },
  { id: 'person:kwame-mensah', type: 'Person', label: 'Kwame Mensah' },
], edges: [] };
const answer = {
  id: 'c1', thread: 't1', at: '2026-10-22', text: 'who leads @GSS ideas?', kind: 'question', reply: 'Kwame Mensah leads the GSS idea.',
  steps: [{ kind: 'search', text: 'Finding the leads of GSS ideas', found: 1 }], highlight: ['team:gss', 'person:kwame-mensah'],
  trace: [[{ text: 'Start from every idea in GSS', size: 1 }]], followups: ['Which of those are at stage 2?'], actions: [], problems: [],
};
const type = (el: HTMLTextAreaElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
  el.setSelectionRange(v.length, v.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (el: Element, k: string, extra: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

async function mount() {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<><AssistantLauncher /><Assistant /></>));
  return { el, root, box: () => el.querySelector('[data-testid="command-input"]') as HTMLTextAreaElement };
}

describe('the Café assistant', () => {
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    vi.mocked(chatStream).mockReset(); vi.mocked(chatPost).mockReset();
    refresh = vi.fn(async () => {});
    useStore.setState({ graph, refresh, leftView: { kind: 'idea', id: 'CAFE-2026-001' } as any, selectedId: null, highlight: null, inbox: null, ai: { provider: 'claude' } as any });
    useChat.setState({ open: false, thread: null, entries: [], threads: [], running: null, busy: false, error: null });
  });

  it('opens from the AI button or Ctrl/⌘+K; shows what "this" means and suggestions that fit it', async () => {
    const { el, root } = await mount();
    expect(el.querySelector('[data-testid="assistant"]')).toBeNull();
    expect(el.querySelector('[data-action="assistant-open"]')?.textContent).toBe('✦AI');
    await act(async () => { key(document.body, 'k', { ctrlKey: true }); });
    expect(el.querySelector('[data-testid="assistant"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="assistant-about"]')?.textContent).toBe('About: Vendor contract summariser');
    expect([...el.querySelectorAll('.as-sugg .cmd-eg')].map((b) => b.textContent)).toContain('Who leads this?');
    await act(async () => { (el.querySelector('[data-action="assistant-open"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('[data-testid="assistant"]')).toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it('a message streams its steps live, then shows the answer with star chips, how it was found, follow-ups, and lights the stars', async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(chatStream).mockImplementation(async (_b, onProgress) => {
      onProgress({ stage: 'thinking', step: 0 });
      onProgress({ stage: 'step', step: { kind: 'search', text: 'Finding the leads of GSS ideas', found: 1 } });
      return new Promise((ok) => { finish = ok; });
    });
    useChat.setState({ open: true });
    const { el, root, box } = await mount();
    await act(async () => { box().focus(); type(box(), 'who leads @GSS ideas?'); });
    await act(async () => { key(box(), 'Enter'); });
    expect(vi.mocked(chatStream).mock.calls[0][0]).toMatchObject({ text: 'who leads @GSS ideas?', focus: ['idea:CAFE-2026-001'] });
    expect(el.querySelector('[data-testid="command-thinking"] [data-testid="assistant-steps"]')?.textContent).toMatch(/Finding the leads of GSS ideas1 found/);
    expect(el.querySelector('[data-action="assistant-stop"]')).not.toBeNull();
    await act(async () => { finish(answer); });
    expect(el.querySelector('[data-testid="command-thinking"]')).toBeNull();
    expect([...el.querySelectorAll('.cmd-reply .star-chip')].map((c) => c.getAttribute('data-star'))).toEqual(['person:kwame-mensah', 'team:gss']);
    expect(el.querySelector('[data-testid="command-trace"]')).not.toBeNull();
    expect(useStore.getState().highlight).toEqual(['team:gss', 'person:kwame-mensah']);
    // A follow-up is one click, in the same conversation.
    vi.mocked(chatStream).mockResolvedValue({ ...answer, id: 'c2', text: 'Which of those are at stage 2?', followups: [] });
    await act(async () => { (el.querySelector('[data-testid="assistant-followups"] .cmd-eg') as HTMLButtonElement).click(); });
    expect(vi.mocked(chatStream).mock.calls[1][0]).toMatchObject({ text: 'Which of those are at stage 2?', thread: 't1' });
    expect(el.querySelectorAll('.as-msg.cmd-entry')).toHaveLength(2);
    // Clicking a star chip flies to it.
    await act(async () => { (el.querySelector('.cmd-reply .star-chip') as HTMLButtonElement).click(); });
    expect(useStore.getState().selectedId).toBe('person:kwame-mensah');
    act(() => root.unmount()); el.remove();
  });

  it('Do it runs the change and redraws the universe; Undo shows on a done change', async () => {
    const proposed = { ...answer, kind: 'command', reply: 'You asked to link Kwame Mensah to GSS.', highlight: [], trace: [], followups: [], steps: [],
      actions: [{ id: 'a1', label: 'Link GSS → Kwame Mensah (has the member)', status: 'proposed' }] };
    vi.mocked(chatPost).mockResolvedValue({ ...proposed, actions: [{ ...proposed.actions[0], status: 'done', inverse: { t: 'edit-off', id: 'op-1' } }] });
    const { el, root } = await mount();
    await act(async () => { useChat.setState({ open: true, thread: { id: 't1', title: 'x' }, entries: [proposed] as any }); });
    await act(async () => { (el.querySelector('[data-action="command-do"]') as HTMLButtonElement).click(); });
    expect(chatPost).toHaveBeenCalledWith('c1', 'do', 'a1');
    expect(refresh).toHaveBeenCalled();
    expect(el.querySelector('[data-action="command-undo"]')).not.toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it('after Do it the graph is fetched again first, then the changed stars and threads flash, the selection and the camera untouched; a note says what changed', async () => {
    const proposed = { ...answer, kind: 'command', reply: 'You asked to make Kwame Mensah lead.', highlight: [], trace: [], followups: [], steps: [],
      actions: [{ id: 'a1', label: 'Make Kwame Mensah lead on Vendor contract summariser', status: 'proposed' }] };
    const changed = { nodes: ['idea:CAFE-2026-001', 'person:kwame-mensah'], edges: ['person:kwame-mensah|LEADS|idea:CAFE-2026-001'], note: 'Updated: Kwame Mensah → Lead on Vendor contract summariser' };
    vi.mocked(chatPost).mockResolvedValue({ ...proposed, actions: [{ ...proposed.actions[0], status: 'done', inverse: { t: 'team' } }], changed });
    const order: string[] = [];
    refresh.mockImplementation(async () => { order.push(`refresh (flash: ${useStore.getState().flash ? 'on' : 'off'})`); });
    await act(async () => { useStore.setState({ selectedId: 'person:kwame-mensah', viewNonce: 7, flash: null } as any); });
    const { el, root } = await mount();
    await act(async () => { useChat.setState({ open: true, thread: { id: 't1', title: 'x' }, entries: [proposed] as any }); });
    await act(async () => { (el.querySelector('[data-action="command-do"]') as HTMLButtonElement).click(); });
    expect(order).toEqual(['refresh (flash: off)']);
    expect(useStore.getState().flash).toMatchObject(changed);
    expect(useStore.getState()).toMatchObject({ selectedId: 'person:kwame-mensah', viewNonce: 7 });
    act(() => root.unmount()); el.remove();
    useStore.setState({ flash: null } as any);
  });

  it('/ shortcuts keep their names whole: a long hint takes the rest of the row, in plain case', async () => {
    useChat.setState({ open: true, thread: null, entries: [] });
    const { el, root, box } = await mount();
    await act(async () => { box().focus(); type(box(), '/'); });
    const rows = [...el.querySelectorAll('[data-testid="command-slash"] li')];
    expect(rows.map((r) => r.querySelector('.cm-cmd b')?.textContent)).toEqual(['/new', '/grow', '/undo', '/import', '/rounds']);
    // Before, the name cell shrank to nothing beside "Read the idea on screen again…" and the hints showed in capitals.
    // The stylesheet as written (Vitest hands CSS imports back empty), read with Node's fs.
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync: (f: string, enc: 'utf8') => string };
    const css = fs.readFileSync(`${(globalThis as any).process.cwd()}/src/theme.css`, 'utf8');
    const rule = (sel: string) => css.split(`${sel}{`)[1]?.split('}')[0] ?? '';
    expect(rule('.cmd-mentions .cm-cmd')).toContain('flex:none');
    expect(rule('.cmd-mentions .cm-hint')).toMatch(/min-width:0/);
    expect(rule('.cmd-mentions .cm-hint')).toMatch(/text-transform:none/);
    act(() => root.unmount()); el.remove();
  });

  it('@ picks a star by kind; / offers shortcuts; /new starts a fresh chat; Stop ends a running message', async () => {
    useChat.setState({ open: true, thread: { id: 't1', title: 'x' }, entries: [answer] as any });
    const { el, root, box } = await mount();
    await act(async () => { box().focus(); type(box(), 'who is @person:'); });
    expect([...el.querySelectorAll('[data-testid="command-mentions"] .cm-l')].map((x) => x.textContent)).toEqual(['Kwame Mensah']);
    await act(async () => { key(box(), 'Enter'); });
    expect(box().value).toBe('who is @Kwame Mensah ');
    await act(async () => { type(box(), '/n'); });
    expect([...el.querySelectorAll('[data-testid="command-slash"] b')].map((x) => x.textContent)).toEqual(['/new']);
    await act(async () => { key(box(), 'Enter'); });
    expect(useChat.getState().entries).toEqual([]);
    expect(useChat.getState().thread).toBeNull();
    vi.mocked(chatStream).mockImplementation((_b, _p, signal) => new Promise((_ok, no) => signal!.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    await act(async () => { type(box(), 'list every idea?'); });
    await act(async () => { key(box(), 'Enter'); });
    await act(async () => { (el.querySelector('[data-action="assistant-stop"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('.cmd-err')?.textContent).toBe('Stopped. Nothing was changed.');
    act(() => root.unmount()); el.remove();
  });

  it('@ offers ＋ New person for a name not in the graph; picking it sends the name marked as a new person', async () => {
    vi.mocked(chatStream).mockResolvedValue({ ...answer, id: 'c7', kind: 'command', reply: 'ok', actions: [], followups: [], highlight: [], trace: [], steps: [] });
    useChat.setState({ open: true });
    const { el, root, box } = await mount();
    await act(async () => { box().focus(); type(box(), 'add @Jane Roe'); });
    const opts = [...el.querySelectorAll('[data-testid="command-mentions"] li')].map((x) => x.textContent);
    expect(opts.at(-1)).toBe('＋ New person: Jane RoeCoded for the AI');
    await act(async () => { key(box(), 'Enter'); });
    expect(box().value).toBe('add @Jane Roe ');
    await act(async () => { type(box(), 'add @Jane Roe as builder of this'); });
    await act(async () => { key(box(), 'Enter'); });
    expect(vi.mocked(chatStream).mock.calls.at(-1)![0]).toMatchObject({ mentions: ['new-person:Jane Roe'] });
    act(() => root.unmount()); el.remove();
  });

  it('earlier chats reopen with their messages', async () => {
    vi.mocked(getThread).mockResolvedValue({ thread: { id: 't9', title: 'Policy bots' }, entries: [answer] });
    const { el, root } = await mount();
    await act(async () => { useChat.setState({ open: true, threads: [{ id: 't9', title: 'Policy bots', updated: Date.now(), count: 1 }] }); });
    await act(async () => { (el.querySelector('[data-action="assistant-history"]') as HTMLButtonElement).click(); });
    await act(async () => { (el.querySelector('[data-testid="assistant-threads"] button') as HTMLButtonElement).click(); });
    expect(el.querySelector('.as-thread')?.textContent).toBe('Policy bots');
    expect(el.querySelectorAll('.as-msg.cmd-entry')).toHaveLength(1);
    act(() => root.unmount()); el.remove();
  });
});

describe('the universe waits for the answer', () => {
  /** What the operator sees in the universe: every store field the picture reads. */
  const MAP = ['selectedId', 'selectedIds', 'highlight', 'hiddenTypes', 'leftView', 'viewNonce', 'focus', 'hideUnlit', 'graph'] as const;
  let changes: string[][];
  let stopWatching: () => void;
  beforeEach(() => {
    vi.mocked(chatStream).mockReset();
    useStore.setState({ graph, refresh: vi.fn(async () => {}), leftView: { kind: 'list' } as any, selectedId: 'team:gss', selectedIds: [], highlight: ['team:gss'], inbox: null, ai: { provider: 'claude' } as any });
    useChat.setState({ open: true, thread: null, entries: [], threads: [], running: null, busy: false, error: null });
    changes = [];
    stopWatching = useStore.subscribe((now, before) => {
      const moved = MAP.filter((k) => now[k] !== before[k]);
      if (moved.length) changes.push([...moved]);
    });
  });
  const ask = async (box: () => HTMLTextAreaElement, text: string) => {
    await act(async () => { box().focus(); type(box(), text); });
    await act(async () => { key(box(), 'Enter'); });
  };
  const pending = () => {
    let finish!: (v: unknown) => void; let fail!: (e: Error) => void;
    vi.mocked(chatStream).mockImplementation(async (_b, onProgress, signal) => {
      onProgress({ stage: 'thinking', step: 0 });
      onProgress({ stage: 'step', step: { kind: 'search', text: 'Finding the leads of GSS ideas', found: 1 } });
      onProgress({ stage: 'thinking', step: 1 });
      return new Promise((ok, no) => {
        finish = ok; fail = no;
        signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
    return { finish: (v: unknown) => finish(v), fail: (e: Error) => fail(e) };
  };

  it('nothing in the universe changes on send or while the AI works; the answer moves it once, to its stars', async () => {
    const run = pending();
    const { el, root, box } = await mount();
    await ask(box, 'who leads @GSS ideas?');
    expect(el.querySelector('[data-testid="command-thinking"]')).not.toBeNull();
    expect(changes).toEqual([]);
    expect(useStore.getState()).toMatchObject({ selectedId: 'team:gss', highlight: ['team:gss'] });
    await act(async () => { run.finish(answer); });
    expect(changes).toEqual([['highlight']]);
    expect(useStore.getState()).toMatchObject({ selectedId: 'team:gss', highlight: ['team:gss', 'person:kwame-mensah'] });
    stopWatching(); act(() => root.unmount()); el.remove();
  });

  it('an answer with no graph evidence leaves the universe as it was', async () => {
    const run = pending();
    const { el, root, box } = await mount();
    await ask(box, 'what is the weather?');
    await act(async () => { run.finish({ ...answer, id: 'c3', reply: 'The graph does not hold that.', highlight: [], trace: [] }); });
    expect(el.querySelector('.cmd-reply')?.textContent).toBe('The graph does not hold that.');
    expect(changes).toEqual([]);
    expect(useStore.getState().highlight).toEqual(['team:gss']);
    stopWatching(); act(() => root.unmount()); el.remove();
  });

  it('changes waiting for Do it light nothing, even after a search', async () => {
    const run = pending();
    const { el, root, box } = await mount();
    await ask(box, 'merge the duplicates');
    await act(async () => { run.finish({ ...answer, id: 'c4', kind: 'command', actions: [{ id: 'a1', label: 'Merge X into Y', status: 'proposed' }] }); });
    expect(el.querySelector('[data-action="command-do"]')).not.toBeNull();
    expect(changes).toEqual([]);
    stopWatching(); act(() => root.unmount()); el.remove();
  });

  it('an error or Stop leaves the universe as it was', async () => {
    let run = pending();
    const { el, root, box } = await mount();
    await ask(box, 'who leads @GSS ideas?');
    await act(async () => { run.fail(new Error('The AI is not available')); });
    expect(el.querySelector('.cmd-err')?.textContent).toBe('The AI is not available');
    run = pending();
    await ask(box, 'who leads @GSS ideas?');
    await act(async () => { (el.querySelector('[data-action="assistant-stop"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('.cmd-err')?.textContent).toBe('Stopped. Nothing was changed.');
    expect(changes).toEqual([]);
    expect(useStore.getState()).toMatchObject({ selectedId: 'team:gss', highlight: ['team:gss'] });
    stopWatching(); act(() => root.unmount()); el.remove();
  });
});
