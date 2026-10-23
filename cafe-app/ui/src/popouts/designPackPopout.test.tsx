import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

const api = vi.hoisted(() => ({
  ideaGet: vi.fn(), post: vi.fn(), designPost: vi.fn(), getHistory: vi.fn(async () => []), copyText: vi.fn(async () => true), roadshowUpload: vi.fn(),
}));
vi.mock('../api', () => api);

import { useStore } from '../state/store';
import { DesignPackPopout } from './DesignPackPopout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const ID = 'CAFE-2026-004';
let el: HTMLDivElement; let root: Root;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const FLOW = {
  project: 'Claims',
  datasets: [{ id: 'in', name: 'claims_sample', kind: 'input', about: '', columns: [] }, { id: 'out', name: 'weekend_flags', kind: 'output', about: '', columns: [] }],
  recipes: [{ id: 'r1', name: 'Flag weekends', kind: 'prepare', inputs: ['in'], outputs: ['out'], steps: ['Formula: weekday(claim_date) >= 6'], feature: 'Weekend flag' }],
};
const state = (tool: string) => ({
  version: 1, status: 'approved', approvedAt: '2026-10-20', summary: 'Flags weekend claims.', steps: [],
  features: [{ id: 'w', name: 'Weekend flag', flags: [] }],
  tool: { tool, pathway: 'Citizen-Led', by: 'operator', reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [] },
});

beforeEach(() => {
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
  for (const f of Object.values(api)) f.mockReset();
  useStore.setState({ state: { ideas: [{ id: ID, title: 'Claims check' }], approvedTools: ['Microsoft Copilot', 'Copilot Studio', 'Power Apps', 'Dataiku', 'custom app'] }, ai: { provider: 'fake', label: 'Fake' } } as any);
});
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe('the design pack', () => {
  it('a Dataiku kit: the recipe flow drawn in the pack, and flow-diagram.html opens in a new tab', async () => {
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: state('Dataiku') }
      : what === 'plan' ? { files: ['plan.md', 'kit/dataiku/README.md', 'kit/dataiku/flow.json', 'kit/dataiku/flow-diagram.html', 'kit/power-automate/README.md'] } : { deck: null }));
    api.post.mockImplementation(async (_url: string, body: any) => (body?.path === 'kit/dataiku/flow.json' ? { path: body.path, text: JSON.stringify(FLOW) } : { path: body?.path, text: '<!doctype html>' }));
    await act(async () => root.render(<DesignPackPopout id={ID} />));
    await flush();
    const sec = el.querySelector('[data-testid="pack-recipe-flow"]')!;
    expect(sec).not.toBeNull();
    expect(sec.querySelectorAll('.rf-recipe')).toHaveLength(1);
    const rows = [...el.querySelectorAll('.dp-files li')].map((li) => li.getAttribute('data-file'));
    expect(rows.slice(-4)).toEqual(['kit/dataiku/README.md', 'kit/dataiku/flow-diagram.html', 'kit/dataiku/flow.json', 'kit/power-automate/README.md']);
    expect(el.querySelector('[data-file="kit/power-automate/README.md"] .dp-file-t')!.textContent).toBe('Outside the build: power automate · README.md');
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(el.querySelector('[data-file="kit/dataiku/flow-diagram.html"] [data-action="view-file"]')).toBeNull();
    await act(async () => (el.querySelector('[data-file="kit/dataiku/flow-diagram.html"] [data-action="open-file"]') as HTMLButtonElement).click());
    expect(opened).toHaveBeenCalledWith(`/api/ideas/${ID}/design/view/flow-diagram.html`, '_blank', 'noopener');
    opened.mockRestore();
  });

  it('an older record that chose UiPath says it is no longer approved; no flow without a Dataiku kit', async () => {
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: state('UiPath') } : what === 'plan' ? { files: [] } : { deck: null }));
    await act(async () => root.render(<DesignPackPopout id={ID} />));
    await flush();
    expect(el.querySelector('[data-testid="pack-tool-retired"]')!.textContent).toBe('UiPath is no longer on the approved list: pick another tool');
    expect(el.querySelector('[data-testid="pack-recipe-flow"]')).toBeNull();
  });

  it('shows no roadshow, in any stage, even when a deck is built: the roadshow has its own section', async () => {
    const DECK = { title: 'Claims check roadshow', files: ['deck.html', 'deck.pptx', 'script.md', 'run-of-show.md'], slides: [] };
    api.ideaGet.mockImplementation(async (_id: string, what: string) => (what === 'design' ? { state: state('Dataiku') }
      : what === 'plan' ? { files: ['plan.md', 'roadshow/script.md'] } : { deck: DECK }));
    for (const stage of [3, 4]) {
      useStore.setState({ state: { ideas: [{ id: ID, title: 'Claims check', stage }], approvedTools: ['Dataiku'] } } as any);
      await act(async () => root.render(<DesignPackPopout key={stage} id={ID} />));
      await flush();
      expect(el.querySelector('[data-testid="design-pack"]')).not.toBeNull();
      expect(el.querySelector('[data-testid="pack-roadshow"]')).toBeNull();
      expect(el.querySelector('[data-file^="roadshow/"]')).toBeNull();
      expect(el.textContent).not.toMatch(/roadshow/i);
    }
    expect(api.ideaGet.mock.calls.some((c) => c[1] === 'roadshow')).toBe(false);
  });
});
