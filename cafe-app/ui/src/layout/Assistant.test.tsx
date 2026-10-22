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
  let refresh: ReturnType<typeof vi.fn>;
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
