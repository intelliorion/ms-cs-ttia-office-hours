import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { LinkTable } from './LinkTable';
import type { LinkRow } from './ideaHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, source: string, confirmed: boolean): LinkRow => ({
  edge: { id, from: 'idea:CAFE-2026-001', to: id, rel: 'NEEDS', description: '', source, confidence: confirmed ? 0.9 : 0.6, confirmed } as any,
  rel: 'NEEDS', out: true, other: { id: `capability:${id}`, label: id, type: 'Capability' }, source, confidence: confirmed ? 0.9 : 0.6, confirmed,
});

describe('LinkTable', () => {
  it('no link can be removed; only a waiting link has an action, "Add it anyway"', () => {
    const el = document.createElement('div');
    act(() => createRoot(el).render(
      <LinkTable busy={false} onConfirm={() => {}} onOpen={() => {}} rows={[
        row('ai-pending', 'ai:claude:challenge', false),
        row('ai-confirmed', 'ai:claude:challenge', true),
        row('form', 'form:CAFE-2026-001:Support Requested', true),
      ]} />,
    ));
    expect(el.querySelector('[data-action="remove-link"]')).toBeNull();
    const acts = (id: string) => [...el.querySelectorAll(`li[data-edge="${id}"] .lk-acts button`)].map((b) => b.getAttribute('data-action'));
    expect(acts('ai-pending')).toEqual(['confirm-link']);
    expect(acts('ai-confirmed')).toEqual([]);
    expect(acts('form')).toEqual([]);
    expect(el.querySelector('li[data-edge="ai-pending"] [data-action="confirm-link"]')?.textContent).toBe('Add it anyway');
    expect(el.querySelector('li[data-edge="ai-pending"] .tag')?.textContent).toBe('Waiting on you');
    expect(el.querySelector('li[data-edge="ai-confirmed"] .tag')).toBeNull();
  });

  it('a click on a link goes to the star at its other end', () => {
    const el = document.createElement('div');
    const opened: string[] = [];
    const confirmed: string[] = [];
    act(() => createRoot(el).render(
      <LinkTable busy={false} onConfirm={(id) => confirmed.push(id)} onOpen={(id) => opened.push(id)} rows={[row('ai-ok', 'ai:fake:x', true), row('ai-wait', 'ai:fake:x', false)]} />,
    ));
    act(() => (el.querySelector('li[data-edge="ai-ok"] [data-action="go-link"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('li[data-edge="ai-wait"] [data-action="confirm-link"]') as HTMLButtonElement).click());
    expect(opened).toEqual(['capability:ai-ok']);
    expect(confirmed).toEqual(['ai-wait']);
  });
});
