import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Universe } from './Universe';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas: the WebGL probe gets null and the universe draws flat.
HTMLCanvasElement.prototype.getContext = (() => null) as any;

describe('Universe', () => {
  it('clears a selection whose star is gone instead of dimming everything', () => {
    const el = document.createElement('div');
    const onSelect = vi.fn();
    const graph = { nodes: [{ id: 'team:gss', type: 'Team', label: 'GSS' }], edges: [] } as any;
    act(() => createRoot(el).render(
      <Universe graph={graph} layout={{ 'team:gss': [0, 0, 0] }} selectedId="capability:gone" hoverId={null} labels={false} onSelect={onSelect} onHover={() => {}} />,
    ));
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(el.querySelector('[data-id="team:gss"]')?.getAttribute('opacity')).toBe('1');
  });
});
