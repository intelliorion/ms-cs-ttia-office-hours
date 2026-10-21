import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { LinkTable } from './LinkTable';
import type { LinkRow } from './ideaHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, source: string, confirmed: boolean): LinkRow => ({
  edge: { id, from: 'idea:CAFE-2026-001', to: id, rel: 'NEEDS', description: '', source, confidence: confirmed ? 0.9 : 0.6, confirmed } as any,
  rel: 'NEEDS', out: true, other: { id, label: id, type: 'Capability' }, source, confidence: confirmed ? 0.9 : 0.6, confirmed,
});

describe('LinkTable', () => {
  it('every AI link can be removed; only unconfirmed ones can be confirmed; form links have no actions', () => {
    const el = document.createElement('div');
    const removed: string[] = [];
    act(() => createRoot(el).render(
      <LinkTable busy={false} onConfirm={() => {}} onRemove={(id) => removed.push(id)} rows={[
        row('ai-pending', 'ai:claude:challenge', false),
        row('ai-confirmed', 'ai:claude:challenge', true),
        row('form', 'form:CAFE-2026-001:Support Requested', true),
      ]} />,
    ));
    const acts = (id: string) => [...el.querySelectorAll(`li[data-edge="${id}"] button`)].map((b) => b.getAttribute('data-action'));
    expect(acts('ai-pending')).toEqual(['confirm-link', 'remove-link']);
    expect(acts('ai-confirmed')).toEqual(['remove-link']);
    expect(acts('form')).toEqual([]);
    act(() => (el.querySelector('li[data-edge="ai-confirmed"] [data-action="remove-link"]') as HTMLButtonElement).click());
    expect(removed).toEqual(['ai-confirmed']);
    expect(el.querySelector('li[data-edge="ai-confirmed"] .tag')).toBeNull();
  });

  it('a confirmed AI link has Remove only; a waiting link says "Waiting on you" and offers "Add it anyway"', () => {
    const el = document.createElement('div');
    act(() => createRoot(el).render(
      <LinkTable busy={false} onConfirm={() => {}} onRemove={() => {}} rows={[
        row('ai-ok', 'ai:fake:x', true),
        row('ai-wait', 'ai:fake:x', false),
      ]} />,
    ));
    expect(el.querySelector('li[data-edge="ai-ok"] [data-action="confirm-link"]')).toBeNull();
    expect(el.querySelector('li[data-edge="ai-ok"] [data-action="remove-link"]')).not.toBeNull();
    const c = el.querySelector('li[data-edge="ai-wait"] [data-action="confirm-link"]');
    expect(c?.textContent).toBe('Add it anyway');
    expect(el.querySelector('li[data-edge="ai-wait"] .tag')?.textContent).toBe('Waiting on you');
  });
});
