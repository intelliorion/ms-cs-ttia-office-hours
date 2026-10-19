import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Flat2D } from './Flat2D';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Flat2D', () => {
  it('shows the empty state for an empty graph instead of NaN coordinates', () => {
    const el = document.createElement('div');
    act(() => createRoot(el).render(
      <Flat2D graph={{ nodes: [], edges: [] }} layout={{}} selectedId={null} hoverId={null} labels={false} onSelect={() => {}} onHover={() => {}} />,
    ));
    expect(el.textContent).toBe('Import an export to light up the universe');
    expect(el.innerHTML).not.toContain('NaN');
  });
});
