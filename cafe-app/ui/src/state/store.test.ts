import { describe, it, expect } from 'vitest';
import { ideasByStage, waitingSummary, supportCounts, functionRegion } from './store';

const idea = (o: any) => ({ id: 'CAFE-2026-001', title: 't', stage: 1, support: [], overdue: [], sent: {}, due: {}, flags: [], ...o });
const state: any = {
  stageNames: { 1: 'Submit Idea', 2: 'Review and Select', 3: 'Design series', 4: 'Launch and Learn' },
  ideas: [
    idea({}), idea({ id: 'CAFE-2026-002', stage: 2, closed: { as: 'csic', at: '2026-10-19' }, function: 'GSS', region: 'APAC', support: ['A', 'B'] }),
    idea({ id: 'CAFE-2026-003', stage: 2, function: 'GSS', region: 'APAC', support: ['A'], overdue: [{ step: 's2d', text: 'late' }], due: { s2d: '2026-10-24' } }),
    idea({ id: 'CAFE-2026-004', stage: 2, function: 'GSS', region: 'APAC', due: { s2d: '2026-10-20' }, checklist: { s2d: { done: true } } }),
  ],
  outbox: [{ status: 'draft' }, { status: 'approved' }, { status: 'sent' }],
};

describe('selectors', () => {
  it('counts ideas by stage with closed separate', () =>
    expect(ideasByStage(state)).toEqual([['Submit Idea', 1], ['Review and Select', 2], ['Design series', 0], ['Launch and Learn', 0], ['Closed', 1]]));
  it('summarises what is waiting, leaving out replies already received', () =>
    expect(waitingSummary(state)).toEqual({ drafts: 1, approved: 1, repliesDue: 1, late: 1, lateIdeas: ['CAFE-2026-003'] }));
  it('counts support across open ideas only', () => expect(supportCounts(state)).toEqual([['A', 1]]));
  it('groups function and region', () => expect(functionRegion(state)).toEqual([['GSS · APAC', 3], ['— · —', 1]]));
});

describe('selection', () => {
  it('reset view clears the selection and bumps the nonce; labels toggle', async () => {
    const { useStore } = await import('./store');
    useStore.getState().select('a'); useStore.getState().resetView(); useStore.getState().toggleLabels();
    expect(useStore.getState()).toMatchObject({ selectedId: null, viewNonce: 1, labels: true });
  });
});
