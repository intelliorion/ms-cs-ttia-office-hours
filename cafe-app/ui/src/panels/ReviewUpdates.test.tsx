import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { Updates } from './ReviewSelect';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); });
const render = (node: React.ReactNode) => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); act(() => root.render(node)); };

describe('From your answers', () => {
  it('lists each proposed change with Yes and No, an applied one with Undo; one said no to is gone', () => {
    const calls: string[] = [];
    render(<Updates disabled={false} onUpdate={(u, a) => calls.push(`${u}:${a}`)} updates={[
      { id: 'u1', kind: 'builder', label: 'Make Person 2 the builder', status: 'proposed' },
      { id: 'u2', kind: 'participation', label: 'Set participation to Team', status: 'applied' },
      { id: 'u3', kind: 'flag', label: 'Clear the flag: x', status: 'dismissed' },
    ]} />);
    expect([...el.querySelectorAll('[data-update]')].map((x) => x.getAttribute('data-update'))).toEqual(['u1', 'u2']);
    expect(el.querySelector('.rs-th .sec-n')?.textContent).toBe('1 to say yes or no to');
    act(() => (el.querySelector('[data-update="u1"] [data-action="update-yes"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('[data-update="u1"] [data-action="update-no"]') as HTMLButtonElement).click());
    act(() => (el.querySelector('[data-update="u2"] [data-action="update-undo"]') as HTMLButtonElement).click());
    expect(calls).toEqual(['u1:yes', 'u1:no', 'u2:undo']);
  });

  it('shows nothing when there is nothing to change', () => {
    render(<Updates disabled={false} updates={[{ id: 'u1', kind: 'flag', label: 'x', status: 'dismissed' }]} />);
    expect(el.querySelector('[data-testid="rs-updates"]')).toBeNull();
  });
});
