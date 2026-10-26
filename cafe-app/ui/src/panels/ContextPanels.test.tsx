import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

vi.mock('../api', async (orig) => ({ ...(await orig<typeof import('../api')>()), getHistory: vi.fn(async () => []), post: vi.fn(async () => ({})) }));
import { useStore } from '../state/store';
import { RightPanels } from './ContextPanels';
import { ideasAround, rightContext } from './contextHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const graph = {
  nodes: [
    { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Travel policy assistant', attrs: { stage: 1, stageLabel: 'Submit Idea' } },
    { id: 'idea:CAFE-2026-002', type: 'Idea', label: 'Procurement FAQ bot', attrs: { stage: 2, stageLabel: 'Review and Select' } },
    { id: 'capability:policy-q-a', type: 'Capability', label: 'Policy Q&A' },
    { id: 'system:policy-library', type: 'System', label: 'Policy library' },
    { id: 'team:gss', type: 'Team', label: 'GSS' },
    { id: 'person:p1', type: 'Person', label: 'Person 1' },
    { id: 'entity:cs', type: 'Entity', label: 'Corporate Services (CS)' },
  ],
  edges: [
    { id: 'e1', from: 'idea:CAFE-2026-001', to: 'capability:policy-q-a', rel: 'NEEDS', confirmed: true, confidence: 0.9, source: 'ai:x', description: '' },
    { id: 'e2', from: 'idea:CAFE-2026-002', to: 'capability:policy-q-a', rel: 'NEEDS', confirmed: true, confidence: 0.9, source: 'ai:x', description: '' },
    { id: 'e3', from: 'capability:policy-q-a', to: 'system:policy-library', rel: 'USES_DATA', confirmed: true, confidence: 0.9, source: 'ai:x', description: '' },
    { id: 'e4', from: 'team:gss', to: 'person:p1', rel: 'HAS_MEMBER', confirmed: true, confidence: 1, source: 'form:x', description: '' },
    { id: 'e5', from: 'person:p1', to: 'idea:CAFE-2026-001', rel: 'SUBMITTED', confirmed: true, confidence: 1, source: 'form:x', description: '' },
    { id: 'e6', from: 'entity:cs', to: 'team:gss', rel: 'HAS_TEAM', confirmed: true, confidence: 1, source: 'form:x', description: '' },
    { id: 'd1', from: 'idea:CAFE-2026-001', to: 'system:policy-library', rel: 'DEPENDS_ON', confirmed: true, confidence: 0.9, source: 'rule:needs+uses_data', description: 'via Policy Q&A', derived: { rule: 'needs+uses_data', inputs: ['e1', 'e3'] } },
    { id: 'd2', from: 'idea:CAFE-2026-001', to: 'idea:CAFE-2026-002', rel: 'SIMILAR_TO', confirmed: true, confidence: 0.67, source: 'rule:shared-stars', description: 'share Policy Q&A, Knowledge assistant', derived: { rule: 'shared-stars', inputs: ['e1', 'e2'] } },
  ],
};
const ideas = [
  { id: 'CAFE-2026-001', title: 'Travel policy assistant', stage: 1, outcomes: [], support: [], flags: ['Participation is Individual but 5 people are listed'], people: { team: [] }, overdue: [], challenge: 'Travellers ask the same questions.', aiRead: { at: '2026-10-26T14:02:00.000Z', changed: true } },
  { id: 'CAFE-2026-002', title: 'Procurement FAQ bot', stage: 2, outcomes: [], support: [], flags: [], people: { team: [] }, overdue: [] },
];

describe('what the right side shows', () => {
  it('picks the context: the open idea, else the clicked star (an idea star is its idea), else the overview', () => {
    const list = { kind: 'list' };
    expect(rightContext({ leftView: list, selectedId: null }, graph)).toEqual({ kind: 'overview' });
    expect(rightContext({ leftView: list, selectedId: 'team:gss' }, graph)).toEqual({ kind: 'star', nodeId: 'team:gss' });
    expect(rightContext({ leftView: list, selectedId: 'idea:CAFE-2026-002' }, graph)).toEqual({ kind: 'idea', id: 'CAFE-2026-002' });
    expect(rightContext({ leftView: { kind: 'idea', id: 'CAFE-2026-001' }, selectedId: 'team:gss' }, graph)).toEqual({ kind: 'idea', id: 'CAFE-2026-001' });
    expect(rightContext({ leftView: list, selectedId: 'gone' }, graph)).toEqual({ kind: 'overview' });
  });

  it('ideas around a star: direct links first, then one star away (a system through its capability, a team through its people), never through the division', () => {
    expect(ideasAround(graph, 'capability:policy-q-a')).toEqual([{ id: 'idea:CAFE-2026-002', hops: 1 }, { id: 'idea:CAFE-2026-001', hops: 1 }]);
    expect(ideasAround(graph, 'system:policy-library').map((x) => x.hops)).toEqual([2, 2]);
    expect(ideasAround(graph, 'team:gss')).toEqual([{ id: 'idea:CAFE-2026-001', hops: 2 }]);
    expect(ideasAround(graph, 'entity:cs')).toEqual([]);
  });
});

describe('RightPanels', () => {
  beforeEach(() => {
    useStore.setState({ graph, state: { ideas, outbox: [], steps: [], stageNames: { 1: 'Submit Idea', 2: 'Review and Select', 3: 'Design series', 4: 'Launch and Learn' }, closures: {} } as any, leftView: { kind: 'list' } as any, selectedId: null, ai: null });
  });
  const mount = async () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<RightPanels />));
    return { el, root, titles: () => [...el.querySelectorAll('h2')].map((h) => h.textContent) };
  };

  it('the Demand panel adds beams by system and by tool from the derived links, only when there are any', async () => {
    const { el, root } = await mount();
    expect(el.querySelector('[data-testid="system-chart"]')?.textContent).toContain('Policy library');
    expect(el.querySelector('[data-testid="tool-chart"]')).toBeNull();
    act(() => root.unmount()); el.remove();
  });
  it('overview: Pipeline and Demand; an idea: Submission (with flags and the challenge) and Connections; a star: the star and the ideas around it', async () => {
    const { el, root, titles } = await mount();
    expect(titles()).toEqual(['Pipeline', 'Demand']);

    await act(async () => { useStore.setState({ leftView: { kind: 'idea', id: 'CAFE-2026-001' } as any }); });
    expect(titles()).toEqual(['Submission', 'Connections']);
    expect(el.querySelector('[data-testid="ctx-submission"]')?.textContent).toMatch(/Participation is Individual.*Travellers ask the same questions/s);
    expect(el.querySelector('[data-tab="links"]')?.textContent).toBe('Links 2');
    // Derived links are listed, tagged, and left out of the count; the Similar block says why; the AI-read line offers Read again.
    expect(el.querySelector('li[data-edge="d1"] .lk-derived')?.textContent).toBe('derived by needs+uses_data');
    expect(el.querySelector('li[data-edge="d1"] [data-action="confirm-link"]')).toBeNull();
    expect(el.querySelector('[data-testid="similar-ideas"]')?.textContent).toMatch(/Procurement FAQ bot.*share Policy Q&A, Knowledge assistant.*67 %/s);
    expect(el.querySelector('[data-testid="ai-read"]')?.textContent).toMatch(/Text changed since the AI last read it/);
    expect(el.querySelector('[data-testid="ai-read"] [data-action="read-again"]')?.textContent).toBe('Read again');
    expect((el.querySelector('[data-testid="ai-read"] [data-action="read-again"]') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { useStore.setState({ leftView: { kind: 'idea', id: 'CAFE-2026-002' } as any, ai: { provider: 'claude' } as any }); });
    expect(el.querySelector('[data-testid="ai-read"]')?.textContent).toMatch(/The AI has not read this idea yet/);
    expect((el.querySelector('[data-testid="ai-read"] [data-action="read-again"]') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('[data-testid="similar-ideas"]')?.textContent).toMatch(/Travel policy assistant/);
    await act(async () => { useStore.setState({ leftView: { kind: 'idea', id: 'CAFE-2026-001' } as any, ai: null }); });

    await act(async () => { useStore.setState({ leftView: { kind: 'list' } as any, selectedId: 'capability:policy-q-a' }); });
    expect(titles()).toEqual(['Star', 'Ideas around it']);
    expect(el.querySelector('.ctx-star-t')?.textContent).toBe('Policy Q&A');
    expect(el.querySelector('.ctx-star-h .nc-sub:last-child')?.textContent).toBe('3 links');
    expect(el.querySelector('.ctx-stages')?.textContent).toBe('1 Review and Select1 Submit Idea');
    expect([...el.querySelectorAll('.ctx-idea')].map((b) => b.getAttribute('data-idea'))).toEqual(['CAFE-2026-002', 'CAFE-2026-001']);

    await act(async () => { (el.querySelector('.ctx-star-h .x') as HTMLButtonElement).click(); });
    expect(titles()).toEqual(['Pipeline', 'Demand']);
    act(() => root.unmount()); el.remove();
  });
});

import { inCommon } from './contextHelpers';
describe('several stars picked', () => {
  it('the right side shows Selected and In common; the context is multi', async () => {
    expect(rightContext({ leftView: { kind: 'list' }, selectedId: 'idea:CAFE-2026-002', selectedIds: ['idea:CAFE-2026-001', 'idea:CAFE-2026-002'] }, graph))
      .toEqual({ kind: 'multi', ids: ['idea:CAFE-2026-001', 'idea:CAFE-2026-002'] });
    expect(inCommon(graph, ['idea:CAFE-2026-001', 'idea:CAFE-2026-002'])).toEqual([{ id: 'capability:policy-q-a', with: ['idea:CAFE-2026-001', 'idea:CAFE-2026-002'] }]);
    useStore.setState({ graph, state: { ideas, outbox: [], steps: [], rounds: [], stageNames: { 1: 'Submit Idea', 2: 'Review and Select' }, closures: {} } as any,
      leftView: { kind: 'list' } as any, selectedId: 'idea:CAFE-2026-002', selectedIds: ['idea:CAFE-2026-001', 'idea:CAFE-2026-002'] });
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<RightPanels />));
    expect([...el.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Selected', 'In common']);
    expect([...el.querySelectorAll('[data-pick]')].map((b) => b.getAttribute('data-pick'))).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002']);
    expect(el.querySelectorAll('[data-testid="ctx-compare"] tbody tr')).toHaveLength(2);
    expect(el.querySelector('[data-common="capability:policy-q-a"] .ctx-share')?.textContent).toBe('2 of 2');
    // Clicking a shared star adds it to the selection.
    await act(async () => { (el.querySelector('[data-common="capability:policy-q-a"]') as HTMLButtonElement).click(); });
    expect(useStore.getState().selectedIds).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'capability:policy-q-a']);
    act(() => root.unmount()); el.remove();
  });
});
