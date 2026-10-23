import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { SettingsMenu } from './SettingsMenu';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); try { localStorage.clear(); } catch { /* none */ } });

describe('Settings', () => {
  it('holds the AI connector, Project configuration and the theme; picking Frost is remembered', async () => {
    useStore.setState({ ai: { provider: 'claude', label: 'Claude Code' }, theme: 'default', popout: null } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<SettingsMenu />));
    expect(el.querySelector('.set-menu')).toBeNull();
    await act(async () => (el.querySelector('[data-action="settings"]') as HTMLButtonElement).click());
    expect([...el.querySelectorAll('.set-h')].map((h) => h.textContent)).toEqual(['AI connector', 'Project', 'Theme']);
    expect(el.querySelector('[data-action="ai"]')?.textContent).toContain('Claude Code');
    expect([...el.querySelectorAll('.theme-row b')].map((b) => b.textContent)).toEqual(['Default', 'Frost', 'Blueprint', 'Mech']);
    await act(async () => (el.querySelector('[data-theme-id="frost"]') as HTMLButtonElement).click());
    expect(useStore.getState().theme).toBe('frost');
    expect(localStorage.getItem('cafe-theme')).toBe('frost');
    await act(async () => (el.querySelector('[data-action="config"]') as HTMLButtonElement).click());
    expect(useStore.getState().popout).toEqual({ kind: 'config' });
  });
});
