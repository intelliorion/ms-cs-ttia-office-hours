import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), getChat: vi.fn(), chatSend: vi.fn(), chatPost: vi.fn() }));
import { getChat, chatSend, chatPost } from '../api';
import { useStore } from '../state/store';
import { CommandBar } from './CommandBar';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const proposed = { id: 'c1', at: '2026-10-22', text: 'link Zainab Okafor to BSI', reply: 'Link Zainab Okafor to BSI.', problems: ['Stages only move by your hand.'],
  actions: [{ id: 'a1', label: 'Link BSI → Zainab Okafor (has the member)', status: 'proposed' }] };

async function mount() {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<CommandBar />));
  return { el, root };
}
const type = (input: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('CommandBar', () => {
  let refresh: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh = vi.fn(async () => {});
    useStore.setState({ refresh, ai: { provider: 'claude', label: 'Claude Code' } as any });
    vi.mocked(getChat).mockResolvedValue({ entries: [] });
  });

  it('sends on Enter, shows the AI reading, then the reply, the reasons and the action waiting for Do it', async () => {
    let finish!: (v: unknown) => void;
    vi.mocked(chatSend).mockImplementation(() => new Promise((ok) => { finish = ok; }));
    const { el, root } = await mount();
    const input = el.querySelector('[data-testid="command-input"]') as HTMLInputElement;
    await act(async () => { input.focus(); type(input, 'link Zainab Okafor to BSI'); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(chatSend).toHaveBeenCalledWith('link Zainab Okafor to BSI');
    expect(el.querySelector('[data-testid="command-thinking"]')?.textContent).toBe('Claude Code is reading your command…');
    await act(async () => { finish(proposed); });
    expect(el.querySelector('[data-testid="command-thinking"]')).toBeNull();
    expect(el.querySelector('.cmd-reply')?.textContent).toBe('Link Zainab Okafor to BSI.');
    expect(el.querySelector('.cmd-problem')?.textContent).toBe('Stages only move by your hand.');
    expect(el.querySelector('.cmd-card.s-proposed .cmd-card-t')?.textContent).toBe('Link BSI → Zainab Okafor (has the member)');
    act(() => root.unmount()); el.remove();
  });

  it('Do it runs the action and redraws the universe; Undo shows on a done action', async () => {
    vi.mocked(getChat).mockResolvedValue({ entries: [proposed] });
    vi.mocked(chatPost).mockResolvedValue({ ...proposed, actions: [{ ...proposed.actions[0], status: 'done', inverse: { t: 'edit-off', id: 'op-1' } }] });
    const { el, root } = await mount();
    await act(async () => { (el.querySelector('[data-testid="command-input"]') as HTMLInputElement).focus(); });
    await act(async () => { (el.querySelector('[data-action="command-do"]') as HTMLButtonElement).click(); });
    expect(chatPost).toHaveBeenCalledWith('c1', 'do', 'a1');
    expect(refresh).toHaveBeenCalled();
    expect(el.querySelector('.cmd-card.s-done .cmd-card-s')?.textContent).toBe('Done');
    expect(el.querySelector('[data-action="command-undo"]')).not.toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it('shows only the current command: a new one replaces it, and a finished one is not brought back after a reload', async () => {
    vi.mocked(getChat).mockResolvedValue({ entries: [proposed] });
    vi.mocked(chatSend).mockResolvedValue({ id: 'c2', at: '2026-10-22', text: 'put the bots in 2026 Q4', reply: 'Put them in 2026 Q4.', problems: [], actions: [] });
    const { el, root } = await mount();
    const input = el.querySelector('[data-testid="command-input"]') as HTMLInputElement;
    await act(async () => { input.focus(); type(input, 'put the bots in 2026 Q4'); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect([...el.querySelectorAll('.cmd-me')].map((x) => x.textContent)).toEqual(['put the bots in 2026 Q4']);
    act(() => root.unmount()); el.remove();
    vi.mocked(getChat).mockResolvedValue({ entries: [{ ...proposed, actions: [{ ...proposed.actions[0], status: 'done' }] }] });
    const m = await mount();
    await act(async () => { (m.el.querySelector('[data-testid="command-input"]') as HTMLInputElement).focus(); });
    expect(m.el.querySelector('.cmd-entry')).toBeNull();
    expect(m.el.querySelectorAll('.cmd-eg').length).toBeGreaterThan(2);
    act(() => m.root.unmount()); m.el.remove();
  });

  it('a question: shows it was read as a question, lights its stars in the universe, and the chip clears them', async () => {
    vi.mocked(chatSend).mockResolvedValue({ id: 'c3', at: '2026-10-22', text: 'highlight what is related to GSS', kind: 'question',
      reply: 'Lit GSS and everything linked to it.', problems: [], actions: [], highlight: ['team:gss', 'entity:cs', 'person:kwame-mensah'] });
    useStore.setState({ highlight: null });
    const { el, root } = await mount();
    const input = el.querySelector('[data-testid="command-input"]') as HTMLInputElement;
    await act(async () => { input.focus(); type(input, 'highlight what is related to GSS'); });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(el.querySelector('.cmd-kind')?.textContent).toBe('A question');
    expect(useStore.getState().highlight).toEqual(['team:gss', 'entity:cs', 'person:kwame-mensah']);
    expect(el.querySelector('[data-action="command-clear-lit"]')?.textContent).toMatch(/3 stars lit/);
    await act(async () => { (el.querySelector('[data-action="command-clear-lit"]') as HTMLButtonElement).click(); });
    expect(useStore.getState().highlight).toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it('the empty panel offers examples; a waiting action shows a badge when closed', async () => {
    const { el, root } = await mount();
    await act(async () => { (el.querySelector('[data-testid="command-input"]') as HTMLInputElement).focus(); });
    expect(el.querySelectorAll('.cmd-eg').length).toBeGreaterThan(2);
    act(() => root.unmount()); el.remove();
    vi.mocked(getChat).mockResolvedValue({ entries: [proposed] });
    const m = await mount();
    expect(m.el.querySelector('.cmd-badge')?.textContent).toBe('1');
    act(() => m.root.unmount()); m.el.remove();
  });
});
