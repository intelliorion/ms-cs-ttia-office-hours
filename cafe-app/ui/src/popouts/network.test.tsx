import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { useChat } from '../state/chat';
import { NetworkPopout } from './NetworkPopout';
import { barShare, becauseText, clusterIds, footerLine, relText, statsLine, type NetView } from './networkHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { if (root) act(() => root.unmount()); el?.remove(); vi.unstubAllGlobals(); });

const star = (id: string, type: string, label: string) => ({ id, type, label });
const VIEW = (scope: 'stored' | 'with-derived' = 'stored'): NetView => ({
  networkx: '3.7', python: '3.14.2', scope, scopeText: scope === 'stored' ? 'confirmed stored facts' : 'confirmed stored facts and derived links',
  results: {
    stats: { nodes: 108, links: 171, density: 0.0291, components: 1, largestComponent: 107, averageClustering: 0, analysed: { nodes: 107, links: 165 } },
    central: { sampled: false, betweenness: [
      { ...star('capability:request-handling', 'Capability', 'Request handling'), betweenness: 0.144, degree: 0.085, links: 9, ideas: 4 },
      { ...star('capability:doc', 'Capability', 'Document text extraction'), betweenness: 0.072, degree: 0.1, links: 11, ideas: 5 },
    ] },
    clusters: { modularity: 0.015, alone: [star('idea:CAFE-2026-009', 'Idea', 'Lonely ledger')], clusters: [
      { ideas: [star('idea:CAFE-2026-002', 'Idea', 'Desk booking assistant'), star('idea:CAFE-2026-007', 'Idea', 'Procurement FAQ bot')], binding: [{ ...star('capability:request-handling', 'Capability', 'Request handling'), ideas: 2 }], weight: 2.1 },
    ] },
    isolated: { components: 1, main: 107, outside: [] },
    suggest: { found: 1, suggestions: [{ from: star('idea:CAFE-2026-006', 'Idea', 'Travel policy assistant'), rel: 'NEEDS', to: star('capability:record-update', 'Capability', 'Record update'), share: 1, adamicAdar: 10.1, jaccard: 0.32,
      because: [{ peer: star('idea:CAFE-2026-007', 'Idea', 'Procurement FAQ bot'), shared: [star('capability:doc', 'Capability', 'Document text extraction')] }] }] },
  },
});

async function mount(fetcher: (url: string, init?: RequestInit) => unknown) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const out = fetcher(url, init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 });
  }));
  useStore.setState({ popout: { kind: 'network' }, highlight: null, selectedId: null });
  el = document.createElement('div'); document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root.render(<NetworkPopout />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return calls;
}

describe('network helpers', () => {
  it('the stats line, the footer naming NetworkX and the facts read, a cluster\'s lit stars, the reason for a suggestion', () => {
    const v = VIEW();
    expect(statsLine(v)).toBe('108 stars · 171 links · density 0.029 · 1 component · average clustering 0.000');
    expect(footerLine(v)).toBe('NetworkX 3.7, confirmed stored facts · Python 3.14.2');
    expect(footerLine(VIEW('with-derived'))).toBe('NetworkX 3.7, confirmed stored facts and derived links · Python 3.14.2');
    expect(clusterIds(v.results.clusters!.clusters[0])).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-007', 'capability:request-handling']);
    expect(becauseText(v.results.suggest!.suggestions[0])).toBe('100 % of its closest peers by weight: Procurement FAQ bot (shares Document text extraction)');
    expect(relText('USES_DATA')).toBe('uses the data');
    expect(barShare(0.072, 0.144)).toBe(50);
  });
});

describe('the Network pop-out', () => {
  it('shows the stats, the central stars, the clusters, nothing cut off and the suggestion, with "NetworkX 3.7, confirmed stored facts" in the footer', async () => {
    const calls = await mount(() => ({ body: VIEW() }));
    expect(calls[0].url).toBe('/api/network?analysis=stats,central,clusters,isolated,suggest&top=8');
    expect(el.querySelector('[data-testid="network-stats"]')!.textContent).toBe('108 stars · 171 links · density 0.029 · 1 component · average clustering 0.000');
    expect(el.querySelector('[data-testid="network-central"]')!.textContent).toMatch(/Request handling0\.144 · 4 ideas/);
    expect(el.querySelector('[data-cluster="1"]')!.textContent).toMatch(/Cluster 1 · 2 ideas.*Desk booking assistant.*Procurement FAQ bot.*Bound by.*Request handling/);
    expect(el.querySelector('[data-testid="network-isolated"]')!.textContent).toMatch(/No idea, team or system is cut off/);
    expect(el.querySelector('[data-testid="network-footer"]')!.textContent).toBe('NetworkX 3.7, confirmed stored facts · Python 3.14.2');
  });

  it('the derived-links switch asks again with withDerived', async () => {
    const calls = await mount((url) => ({ body: VIEW(url.includes('withDerived') ? 'with-derived' : 'stored') }));
    await act(async () => { (el.querySelector('[data-action="network-derived"]') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(calls.at(-1)!.url).toContain('&withDerived=1');
    expect(el.querySelector('[data-testid="network-footer"]')!.textContent).toMatch(/stored facts and derived links/);
  });

  it('every analysis reads confirmed links only; the waiting-links switch asks again with unconfirmed and the footer says so', async () => {
    const calls = await mount((url) => ({ body: url.includes('unconfirmed=1') ? { ...VIEW(), scopeText: 'stored facts, links waiting for your Do it included', unconfirmed: true } : VIEW() }));
    expect(calls[0].url).not.toContain('unconfirmed');
    expect(el.querySelector('.net-lede')!.textContent).toContain('over confirmed stored facts');
    await act(async () => { (el.querySelector('[data-action="network-unconfirmed"]') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(calls.at(-1)!.url).toContain('&unconfirmed=1');
    expect(el.querySelector('[data-testid="network-footer"]')!.textContent).toBe('NetworkX 3.7, stored facts, links waiting for your Do it included · Python 3.14.2');
  });

  it('a cluster lights its ideas and binding stars; a star is selected in the universe; the pop-out closes', async () => {
    await mount(() => ({ body: VIEW() }));
    await act(async () => { (el.querySelector('[data-action="network-light-cluster"]') as HTMLButtonElement).click(); });
    expect(useStore.getState().highlight).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-007', 'capability:request-handling']);
    expect(useStore.getState().popout).toBeNull();
    act(() => root.unmount()); el.remove();
    await mount(() => ({ body: VIEW() }));
    await act(async () => { (el.querySelector('[data-testid="network-central"] [data-star="capability:doc"]') as HTMLButtonElement).click(); });
    expect(useStore.getState().selectedId).toBe('capability:doc');
  });

  it('Propose sends the link to the assistant as a proposal and opens it there; nothing is done here', async () => {
    const entry = { id: 'c1', thread: 't1', text: 'Propose', reply: 'NetworkX suggests…', actions: [{ id: 'a1', label: 'Link …', status: 'proposed', action: { t: 'link' } }], problems: [] };
    const calls = await mount((url) => (url === '/api/network/propose' ? { body: entry } : url.startsWith('/api/chat/threads/') ? { body: { thread: { id: 't1', title: 'Propose' }, entries: [entry] } } : { body: VIEW() }));
    await act(async () => { (el.querySelector('[data-action="network-propose"]') as HTMLButtonElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const sent = calls.find((c) => c.url === '/api/network/propose')!;
    expect(sent.body).toMatchObject({ from: 'idea:CAFE-2026-006', rel: 'NEEDS', to: 'capability:record-update', why: expect.stringMatching(/^100 % of its closest peers/) });
    expect(calls.some((c) => c.url.includes('/do'))).toBe(false);
    expect(useChat.getState().open).toBe(true);
    expect(useChat.getState().entries[0].actions[0].status).toBe('proposed');
    expect((el.querySelector('[data-action="network-propose"]') as HTMLButtonElement).textContent).toBe('Proposed');
  });

  it('when Python is missing, the one plain message is shown', async () => {
    await mount(() => ({ status: 400, body: { error: 'Network analysis needs Python 3.9 or later on this machine. No python3 or python was found.' } }));
    expect(el.querySelector('[data-testid="network-error"]')!.textContent).toMatch(/^Network analysis needs Python 3\.9 or later/);
    expect(el.querySelector('[data-testid="network-footer"]')).toBeNull();
  });
});

import { similarText } from '../panels/ToolPickerSection';
describe('the tool picker names look-alikes across ideas, with NetworkX\'s reason', () => {
  it('on the idea it reads as before; across ideas it names the ideas and the prediction', async () => {
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    const base = { feature: 'Booking amendment process', featureId: 'capability:booking-amendment-process', star: 'Booking update', starId: 'capability:booking-update' };
    await act(async () => { root.render(<>{similarText({ ...base, star: 'Booking', starId: 'capability:booking' })}</>); });
    expect(el.textContent).toBe('Booking amendment process looks like Booking, which the AI found in the submission.');
    await act(async () => { root.render(<>{similarText({ ...base, ideas: [{ id: 'idea:1', label: 'Desk booking assistant' }, { id: 'idea:2', label: 'Procurement FAQ bot' }], networkx: { version: '3.7', share: 1, peers: ['Procurement FAQ bot', 'Desk booking assistant'] } })}</>); });
    expect(el.textContent).toBe('Booking amendment process looks like Booking update, which Desk booking assistant, Procurement FAQ bot already need. NetworkX predicts this idea needs it too: 100 % of its closest peers by weight (Procurement FAQ bot, Desk booking assistant) do.');
  });
});
