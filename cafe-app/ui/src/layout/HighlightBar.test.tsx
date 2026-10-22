import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useStore, clampHide, DEFAULT_HIDE } from '../state/store';
import { HighlightBar } from './HighlightBar';
import { dimFromHide, edgeStyle, DIM } from '../universe/graphView';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('the highlight bar', () => {
  it('shows only while stars are lit; the slider sets how much of the rest is hidden, 10% to 100%; Clear ends it', async () => {
    useStore.setState({ highlight: null, hideUnlit: DEFAULT_HIDE, selectedId: null });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<HighlightBar />));
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
