import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { Updates } from './ReviewSelect';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); });
const render = (node: React.ReactNode) => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); act(() => root.render(node)); };

describe('Updated from your answers', () => {
  it('lists what the answers changed, read-only: no Yes, No or Undo; an older unapplied one says so; one said no to is gone', () => {
    render(<Updates updates={[
      { id: 'u1', kind: 'builder', label: 'Make Person 2 the builder', status: 'applied' },
      { id: 'u2', kind: 'participation', label: 'Set participation to Team', status: 'proposed' },
      { id: 'u3', kind: 'flag', label: 'Clear the flag: x', status: 'dismissed' },
    ]} />);
    expect([...el.querySelectorAll('[data-update]')].map((x) => x.getAttribute('data-update'))).toEqual(['u1', 'u2']);
    expect(el.querySelector('.rs-th')?.textContent).toBe('Updated from your answers');
    expect(el.querySelectorAll('button')).toHaveLength(0);
    expect(el.querySelector('[data-update="u1"]')?.textContent).not.toMatch(/Not applied/);
    expect(el.querySelector('[data-update="u2"]')?.textContent).toMatch(/Not applied/);
  });

  it('shows nothing when nothing changed', () => {
    render(<Updates updates={[{ id: 'u1', kind: 'flag', label: 'x', status: 'dismissed' }]} />);
    expect(el.querySelector('[data-testid="rs-updates"]')).toBeNull();
  });
});

describe('one section, its own proposals', () => {
  it('the decision, the tool picker and the design each list only what they proposed (older ones are the decision\'s)', async () => {
    const { updatesFrom } = await import('./ReviewSelect');
    const idea = { updates: [{ id: 'u1', from: 'tools' }, { id: 'u2' }, { id: 'u3', from: 'design' }, { id: 'u4', from: 'decision' }] };
    expect(updatesFrom(idea, 'decision').map((u) => u.id)).toEqual(['u2', 'u4']);
    expect(updatesFrom(idea, 'tools').map((u) => u.id)).toEqual(['u1']);
    expect(updatesFrom(idea, 'design').map((u) => u.id)).toEqual(['u3']);
  });
});
