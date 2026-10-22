import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { Welcome } from './Welcome';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Welcome', () => {
  let el: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    el = document.createElement('div'); document.body.appendChild(el);
    root = createRoot(el);
    useStore.setState({ state: { ideas: [] } as any, popout: null });
  });
  afterEach(() => { act(() => root.unmount()); el.remove(); });
  const show = () => act(() => root.render(<Welcome />));

  it('shows the card when there are no ideas and no pop-out', () => {
    show();
    const card = el.querySelector('[data-testid="welcome"]');
    expect(card?.classList.contains('welcome')).toBe(true);
    expect(card?.querySelector('h2')?.textContent).toBe('Nothing here but dark matter.');
    expect(card?.querySelector('p')?.textContent).toBe('Drop the first submissions export and watch the stars come out. The app sorts them; you drink the coffee.');
    expect(card?.querySelector('[data-action="welcome-import"]')?.textContent).toBe('Start: import submissions');
  });

  it('hides while a pop-out is open', () => {
    useStore.setState({ popout: { kind: 'outbox' } });
    show();
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
  });

  it('hides once there is one idea', () => {
    useStore.setState({ state: { ideas: [{ id: 'CAFE-2026-001', title: 'One' }] } as any });
    show();
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
  });

  it('vanishes when the first idea arrives', () => {
    show();
    expect(el.querySelector('[data-testid="welcome"]')).not.toBeNull();
    act(() => useStore.setState({ state: { ideas: [{ id: 'CAFE-2026-001', title: 'One' }] } as any }));
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
  });

  it('hides before the state is read', () => {
    useStore.setState({ state: null });
    show();
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
  });

  it('opens the Import pop-out from its button', () => {
    show();
    act(() => (el.querySelector('[data-action="welcome-import"]') as HTMLButtonElement).click());
    expect(useStore.getState().popout).toEqual({ kind: 'inbox' });
    expect(el.querySelector('[data-testid="welcome"]')).toBeNull();
  });
});
