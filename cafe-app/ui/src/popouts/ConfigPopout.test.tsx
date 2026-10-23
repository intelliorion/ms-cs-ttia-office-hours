import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { ConfigPopout } from './ConfigPopout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); vi.unstubAllGlobals(); });

describe('Project configuration', () => {
  it('shows where the data folder is, and Open data folder asks the app to open it', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ folder: '/work/cafe' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    useStore.setState({ state: { workspace: '/work/cafe', fields: { settings: [['operatorName', 'Your name']] }, settings: {} }, notice: null, refresh: async () => {} } as any);
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    await act(async () => root.render(<ConfigPopout />));
    expect(document.querySelector('.data-dir code')?.textContent).toBe('/work/cafe');
    await act(async () => (document.querySelector('[data-action="open-data-folder"]') as HTMLButtonElement).click());
    expect(fetch).toHaveBeenCalledWith('/api/workspace/open', expect.objectContaining({ method: 'POST' }));
    expect(useStore.getState().notice?.text).toBe('Opened the data folder.');
  });
});
