import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', () => ({ inboxPost: vi.fn(async () => ({})) }));
import { inboxPost } from '../api';
import { InboxCard, type Run } from './InboxCard';
import { useStore } from '../state/store';
import type { InboxItemView, Step } from './inboxHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const at = '2026-10-21T10:00:00Z';
const s = (id: Step['id'], status: Step['status'], detail: string = id): Step => ({ id, status, at, detail });
const base = (extra: Partial<InboxItemView>): InboxItemView => ({
  id: 'ib1', file: 'reply.eml', name: 'reply.eml', type: 'email', receivedAt: at, status: 'triaged', ...extra,
});
const run: Run = async (_label, fn, ok, say) => { const r = await fn(); say?.(ok ? { text: ok(r) ?? '' } : null); };

function mount(item: InboxItemView) {
  const el = document.createElement('div');
  act(() => createRoot(el).render(<ul><InboxCard item={item} busy={false} ideaTitle={() => 'An idea'} openIdea={() => {}} run={run} /></ul>));
  return el;
}
const click = async (b: Element | null | undefined) => { await act(async () => { (b as HTMLButtonElement).click(); }); };
const button = (el: Element, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent === text);

describe('InboxCard', () => {
  beforeEach(() => { vi.mocked(inboxPost).mockClear(); });

  it('draws the eight steps: four done, the AI running, three to come, and the running detail', () => {
    const el = mount(base({ steps: [s('receive', 'done'), s('read', 'done'), s('screen', 'done'), s('match', 'done'), s('understand', 'running', 'Asking the AI…')] }));
    expect(el.querySelectorAll('.ib-step').length).toBe(8);
    expect(el.querySelectorAll('.ib-step.st-ok').length).toBe(4);
    expect(el.querySelectorAll('.ib-step.st-run').length).toBe(1);
    expect(el.querySelectorAll('.ib-step.st-todo').length).toBe(3);
    expect(el.querySelector('[data-testid="step-detail"]')?.textContent).toBe('Asking the AI…');
  });

  it('a near-duplicate star offers three choices; "Use the existing star" applies with use-existing', async () => {
    const el = mount(base({
      steps: [s('check', 'needs-you')],
      actions: [{ id: 'a2', action: { t: 'graph_links' }, kind: 'ok', status: 'pending', label: 'Add star Slot finder', held: { rule: 'near-duplicate-star', existing: 'capability:x', why: 'Looks like Slot finding' } }],
    }));
    const held = el.querySelector('[data-testid="held"]')!;
    expect([...held.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Use the existing star', 'Keep both', 'No']);
    expect(held.querySelector('.ib-why')?.textContent).toBe('Looks like Slot finding');
    expect(el.querySelector('[data-group="ok"]')).toBeNull();
    await click(button(el, 'Use the existing star'));
    expect(inboxPost).toHaveBeenCalledWith('ib1', 'apply', { actionIds: ['a2'], resolve: { a2: 'use-existing' } });
  });

  it('a contradiction: "Keep the form\'s value" drops the proposal', async () => {
    const el = mount(base({
      steps: [s('check', 'needs-you')],
      actions: [{ id: 'a3', action: { t: 'record_answers' }, kind: 'ok', status: 'pending', label: 'Region: APAC', held: { rule: 'contradicts-fact', why: 'The form says EMEA' } }],
    }));
    await click(button(el, "Keep the form's value"));
    expect(inboxPost).toHaveBeenCalledWith('ib1', 'dismiss-action', { actionId: 'a3' });
  });

  it('folds what the AI understood, and offers Run again when expanded', async () => {
    const el = document.createElement('div');
    const item = base({ status: 'applied', steps: [s('check', 'done', 'Done')], triage: { ideaId: 'CAFE-2026-001', confidence: 0.9, ask: false, candidates: [], notes: [], ai: { what: 'A reply', understood: ['Two builders now'], uncertain: ['The region'] } } });
    act(() => createRoot(el).render(<ul><InboxCard item={item} busy={false} ideaTitle={() => 'An idea'} openIdea={() => {}} run={run} expanded /></ul>));
    expect(el.querySelector('.ib-understood summary')?.textContent).toBe('What the AI understood');
    expect([...el.querySelectorAll('.ib-understood li')].map((l) => l.textContent)).toEqual(['Two builders now', 'The region']);
    await click(el.querySelector('[data-action="run-again"]'));
    expect(inboxPost).toHaveBeenCalledWith('ib1', 'process');
  });

  it('a near-duplicate names the existing star, from the graph or else from its id', () => {
    const held = (existing: string): InboxItemView => base({
      steps: [s('check', 'needs-you')],
      actions: [{ id: 'a2', action: { t: 'graph_links' }, kind: 'ok', status: 'pending', label: 'Add star Slot finder', held: { rule: 'near-duplicate-star', existing, why: 'Looks the same' } }],
    });
    useStore.setState({ graph: { nodes: [{ id: 'capability:slot-finding', type: 'Capability', label: 'Slot finding' }], edges: [] } as any });
    expect(mount(held('capability:slot-finding')).querySelector('[data-testid="existing-star"]')?.textContent).toBe('Existing star: Slot finding');
    expect(mount(held('capability:room-booking')).querySelector('[data-testid="existing-star"]')?.textContent).toBe('Existing star: room booking');
    useStore.setState({ graph: null });
  });
});
