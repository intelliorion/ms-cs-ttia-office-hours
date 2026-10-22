import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useStore, clampHide, DEFAULT_HIDE } from '../state/store';
import { FocusBar } from './FocusBar';
import { dimFromHide, edgeStyle, DIM } from '../universe/graphView';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('the focus bar', () => {
  it('shows only while stars are lit; the slider sets how much of the rest is hidden, 10% to 100%; Clear ends it', async () => {
    useStore.setState({ highlight: null, hideUnlit: DEFAULT_HIDE, selectedId: null, graph: { nodes: [{ id: 'team:gss', type: 'Team', label: 'GSS' }, { id: 'entity:cs', type: 'Entity', label: 'CS' }], edges: [{ id: 'e', from: 'entity:cs', to: 'team:gss', rel: 'HAS_TEAM', confirmed: true }] } });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<FocusBar />));
    expect(el.querySelector('[data-testid="highlight-bar"]')).toBeNull();
    await act(async () => { useStore.setState({ highlight: ['team:gss', 'entity:cs'] }); });
    expect(el.querySelector('.hl-n')?.textContent).toBe('✦2 stars lit');
    expect(el.querySelector('.hl-slide b')?.textContent).toBe('88%');
    const range = el.querySelector('[data-testid="highlight-hide"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '100');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(useStore.getState().hideUnlit).toBe(1);
    expect(el.querySelector('.hl-slide b')?.textContent).toBe('Only these');
    await act(async () => { (el.querySelector('[data-action="highlight-clear"]') as HTMLButtonElement).click(); });
    expect(useStore.getState().highlight).toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it('a clicked star gets the same bar: its name and links, the same slider; Clear lets go of it', async () => {
    useStore.setState({ highlight: null, selectedId: 'team:gss' });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<FocusBar />));
    expect(el.querySelector('.hl-n')?.textContent).toBe('✦GSS and its 1 link');
    expect(el.querySelector('[data-testid="highlight-hide"]')).not.toBeNull();
    await act(async () => { (el.querySelector('[data-action="highlight-clear"]') as HTMLButtonElement).click(); });
    expect(useStore.getState().selectedId).toBeNull();
    expect(el.querySelector('[data-testid="highlight-bar"]')).toBeNull();
    act(() => root.unmount()); el.remove();
  });

  it('hide maps to the brightness of the rest: 88% is the usual dim, 100% hides stars and links, never below 10%', () => {
    expect(dimFromHide(DEFAULT_HIDE)).toBeCloseTo(DIM);
    expect(dimFromHide(1)).toBe(0);
    expect(clampHide(0)).toBe(0.1);
    expect(clampHide(2)).toBe(1);
    const lit = new Set(['a', 'b']);
    expect(edgeStyle({ from: 'a', to: 'c', confirmed: true }, null, lit, 0).opacity).toBe(0);
    expect(edgeStyle({ from: 'a', to: 'b', confirmed: true }, null, lit, 0).opacity).toBe(0.85);
  });
});
