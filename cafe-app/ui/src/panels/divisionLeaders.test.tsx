import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), getHistory: vi.fn(async () => []), post: vi.fn(async () => ({})) }));
import { useStore } from '../state/store';
import { StarDetails } from './StarDetails';
import { starProfile } from './starProfile';
import { ideasAround } from './contextHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const edge = (id: string, from: string, rel: string, to: string) => ({ id, from, rel, to, confirmed: true, confidence: 1, source: 'operator:op-1@2026-11-01', description: '' });
const graph = {
  nodes: [
    { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Desk booking' },
    { id: 'person:p1', type: 'Person', label: 'Person 1' },
    { id: 'person:p2', type: 'Person', label: 'Person 2' },
    { id: 'team:gss', type: 'Team', label: 'GSS' },
    { id: 'entity:cs', type: 'Entity', label: 'Corporate Services (CS)' },
    { id: 'entity:tech', type: 'Entity', label: 'Technology' },
  ],
  edges: [
    edge('e1', 'person:p1', 'SUBMITTED', 'idea:CAFE-2026-001'),
    edge('e2', 'team:gss', 'HAS_MEMBER', 'person:p1'),
    edge('e3', 'entity:cs', 'HAS_TEAM', 'team:gss'),
    edge('e4', 'person:p1', 'LEADS_DIVISION', 'entity:cs'),
    edge('e5', 'person:p2', 'LEADS_DIVISION', 'entity:cs'),
    edge('e6', 'person:p1', 'LEADS_DIVISION', 'entity:tech'),
  ],
};
const state = { ideas: [{ id: 'CAFE-2026-001', title: 'Desk booking', people: { submitter: 'Person 1', team: [] } }] };

describe('a division\'s leaders in the left panel', () => {
  it('a division lists its leaders, apart from the other stars it links to', () => {
    const p = starProfile(graph, state, 'entity:cs')!;
    expect(p.leaders).toEqual([{ id: 'person:p1', label: 'Person 1' }, { id: 'person:p2', label: 'Person 2' }]);
    expect(p.leads).toEqual([]);
    expect(p.groups).toEqual([{ type: 'Team', kind: 'Team', items: [{ id: 'team:gss', label: 'GSS', rel: 'HAS_TEAM' }] }]);
  });
  it('a person lists the divisions they lead', () => {
    const p = starProfile(graph, state, 'person:p1')!;
    expect(p.leads).toEqual([{ id: 'entity:cs', label: 'Corporate Services (CS)' }, { id: 'entity:tech', label: 'Technology' }]);
    expect(p.groups.map((g) => g.type)).toEqual(['Team']);
  });
  it('the details show "Led by" on a division and "Leads" on a person, each a click from going there; a division with none says how to add one', async () => {
    useStore.setState({ graph, state, trail: [] } as any);
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<StarDetails id="entity:cs" />));
    const led = el.querySelector('[data-testid="star-leaders"]')!;
    expect(led.querySelector('h3')!.textContent).toBe('Led by 2');
    expect([...led.querySelectorAll('[data-go]')].map((b) => [b.getAttribute('data-go'), b.textContent])).toEqual([['person:p1', 'Person 1'], ['person:p2', 'Person 2']]);
    await act(async () => root.render(<StarDetails id="person:p1" />));
    const leads = el.querySelector('[data-testid="star-leads"]')!;
    expect(leads.querySelector('h3')!.textContent).toBe('Leads the division 2');
    expect([...leads.querySelectorAll('[data-go]')].map((b) => b.textContent)).toEqual(['Corporate Services (CS)', 'Technology']);
    useStore.setState({ graph: { ...graph, edges: graph.edges.filter((e) => e.rel !== 'LEADS_DIVISION') } } as any);
    await act(async () => root.render(<StarDetails id="entity:cs" />));
    expect(el.querySelector('[data-testid="star-leaders"]')!.textContent).toMatch(/No leader recorded yet/);
    root.unmount(); el.remove();
  });
  it('the ideas around a division never come through its leaders', () => {
    expect(ideasAround(graph, 'entity:cs')).toEqual([]);
  });
});
