import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { ChangeNote } from './ChangeNote';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); useStore.setState({ flash: null } as any); });

describe('the change note', () => {
  it('says in one line what a chat change did while it flashes, and is gone after', async () => {
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<ChangeNote />));
    expect(el.querySelector('[data-testid="change-note"]')).toBeNull();
    await act(async () => useStore.setState({ flash: { nodes: ['a'], edges: [], note: 'Updated: Alex Wang → Lead on Procurement FAQ bot', key: 3 } } as any));
    const note = el.querySelector('[data-testid="change-note"]')!;
    expect(note.textContent).toBe('Updated: Alex Wang → Lead on Procurement FAQ bot');
    expect(note.getAttribute('role')).toBe('status');
    await act(async () => useStore.setState({ flash: null } as any));
    expect(el.querySelector('[data-testid="change-note"]')).toBeNull();
  });
});
