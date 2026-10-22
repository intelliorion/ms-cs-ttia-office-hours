import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { TypeFilter, showLabel } from './TypeFilter';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('the Show filter', () => {
  it('labels how many kinds are on', () => {
    expect(showLabel(['Idea', 'Person'], [])).toBe('Show: All');
    expect(showLabel(['Idea', 'Person'], ['Person', 'Tool'])).toBe('Show: 1 of 2');
  });

  it('lists the kinds in the graph with counts; unticking one hides it from the picture only; Show all brings it back', async () => {
    const graph = { nodes: [{ id: 'idea:1', type: 'Idea', label: 'A' }, { id: 'idea:2', type: 'Idea', label: 'B' }, { id: 'painpoint:x', type: 'PainPoint', label: 'X' }], edges: [] };
    useStore.setState({ graph, hiddenTypes: [] } as any);
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<TypeFilter />));
    expect(el.querySelector('.tf-menu')).toBeNull();
    await act(async () => (el.querySelector('[data-action="type-filter"]') as HTMLButtonElement).click());
    const rows = [...el.querySelectorAll('.tf-row')].map((r) => `${r.querySelector('.tf-name')?.textContent} ${r.querySelector('.tf-n')?.textContent}`);
    expect(rows).toEqual(['Idea 2', 'Pain point 1']);
    await act(async () => (el.querySelectorAll('.tf-row input')[1] as HTMLInputElement).click());
    expect(useStore.getState().hiddenTypes).toEqual(['PainPoint']);
    expect(useStore.getState().graph).toBe(graph);
    expect(el.querySelector('[data-action="type-filter"]')?.textContent).toBe('Show: 1 of 2');
    await act(async () => (el.querySelector('.tf-foot button') as HTMLButtonElement).click());
    expect(useStore.getState().hiddenTypes).toEqual([]);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(el.querySelector('.tf-menu')).toBeNull();
    root.unmount(); el.remove();
  });
});
