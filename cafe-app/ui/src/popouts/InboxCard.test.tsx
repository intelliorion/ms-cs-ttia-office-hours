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
    // While the AI works, the Now strip says what it is doing in a sentence; the AI's step carries an AI tag.
    expect(el.querySelector('[data-testid="ai-now"]')?.getAttribute('data-who')).toBe('ai');
    expect(el.querySelector('[data-testid="ai-now-head"]')?.textContent).toBe('The AI is reading this file');
    expect([...el.querySelectorAll('.ib-step.who-ai')].map((x) => x.getAttribute('data-step'))).toEqual(['understand']);
  });

  it('a form export being read: progress, the idea now being read, and a trail of what the AI found, newest first', () => {
    const el = mount(base({ type: 'export', name: 'subs.csv', steps: [
      s('receive', 'done'), s('read', 'done'), s('screen', 'done'), s('match', 'done'),
      { id: 'understand', status: 'running', at, since: at, detail: 'Reading Travel policy assistant', of: [3, 3],
        trail: [{ title: 'Desk booking assistant', found: ['2 pain points', '1 system'] }, { title: 'Expense anomaly finder', found: [], failed: true }] },
      s('context', 'done'), s('graph', 'running', '7 stars and 9 links from the form'), s('check', 'running', 'Waiting'),
    ] }));
    expect(el.querySelector('[data-testid="ai-now-head"]')?.textContent).toBe('The AI is reading “Travel policy assistant”');
    expect(el.querySelector('.ib-now-m b')?.textContent).toBe('3 of 3');
    const rows = [...el.querySelectorAll('.ib-trail li')].map((li) => li.textContent);
    expect(rows).toEqual(['Expense anomaly finder' + 'couldn’t read it', 'Desk booking assistant' + '+ 2 pain points+ 1 system']);
    expect((el.querySelector('[data-testid="ai-trail"]') as HTMLDetailsElement).open).toBe(true);
  });

  it('nothing running: no Now strip, the last step\'s detail instead', () => {
    const el = mount(base({ steps: [s('receive', 'done'), s('read', 'done'), s('screen', 'done'), s('match', 'done'), s('understand', 'done', 'A reply on the desk idea'), s('context', 'done'), s('graph', 'done'), s('check', 'done', 'Done')] }));
    expect(el.querySelector('[data-testid="ai-now"]')).toBeNull();
    expect(el.querySelector('[data-testid="step-detail"]')?.textContent).toBe('AI: A reply on the desk idea · Universe: graph · Done');
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
    act(() => useStore.setState({ graph: { nodes: [{ id: 'capability:slot-finding', type: 'Capability', label: 'Slot finding' }], edges: [] } as any }));
    expect(mount(held('capability:slot-finding')).querySelector('[data-testid="existing-star"]')?.textContent).toBe('Existing star: Slot finding');
    expect(mount(held('capability:room-booking')).querySelector('[data-testid="existing-star"]')?.textContent).toBe('Existing star: room booking');
    act(() => useStore.setState({ graph: null }));
  });
});

describe('InboxCard: what the AI read (pictures)', () => {
  it('a picture shows "What the AI read" with the transcription and the notes', () => {
    const el = mount(base({
      name: '14-whiteboard.png', type: 'note', status: 'applied',
      meta: { readBy: 'ai', notes: 'A whiteboard photo with a bulleted list' },
      preview: 'CAFE-2026-002 DESK BOOKING\nTOOL: COPILOT STUDIO',
      steps: [s('read', 'done', 'Picture read by the AI, 4.2 s, 8 words')],
    }));
    const read = el.querySelector('[data-testid="ai-read"]')!;
    expect(read).not.toBeNull();
    expect(read.querySelector('summary')?.textContent).toBe('What the AI read');
    expect(read.textContent).toContain('CAFE-2026-002 DESK BOOKING');
    expect(read.textContent).toContain('TOOL: COPILOT STUDIO');
    expect(read.textContent).toContain('A whiteboard photo with a bulleted list');
    expect(el.querySelector('.ib-type')?.textContent).toContain('Picture');
  });

  it('a long transcription is marked as cut and says where the rest is', () => {
    const el = mount(base({
      name: 'board.png', type: 'note', status: 'applied', meta: { readBy: 'ai', notes: 'A board' },
      preview: 'x'.repeat(400), previewCut: true, steps: [s('read', 'done')],
    }));
    const read = el.querySelector('[data-testid="ai-read"]')!;
    expect(read.querySelector('.ib-read-text')?.textContent).toBe(`${'x'.repeat(400)}…`);
    expect(read.textContent).toContain('Open the file to read all of it');
  });

  it('a short transcription has no cut sign', () => {
    const el = mount(base({ name: 'board.png', type: 'note', status: 'applied', meta: { readBy: 'ai' }, preview: 'Short', steps: [s('read', 'done')] }));
    expect(el.querySelector('.ib-read-text')?.textContent).toBe('Short');
    expect(el.textContent).not.toContain('Open the file to read all of it');
  });

  it('a held picture (its text not kept) has no "What the AI read" block', () => {
    const el = mount(base({
      name: 'tracker.png', type: 'unknown', status: 'held', meta: { readBy: 'ai' }, hold: { reasons: ['Lists 3 people by name. The text was not kept.'] },
      steps: [s('read', 'done'), s('screen', 'needs-you')],
    }));
    expect(el.querySelector('[data-testid="ai-read"]')).toBeNull();
  });

  it('a normal note has no "What the AI read" block', () => {
    const el = mount(base({ name: 'n.txt', type: 'note', preview: 'Hello there', steps: [s('read', 'done')] }));
    expect(el.querySelector('[data-testid="ai-read"]')).toBeNull();
    expect(el.querySelector('.ib-type')?.textContent).toContain('Note');
  });
});
