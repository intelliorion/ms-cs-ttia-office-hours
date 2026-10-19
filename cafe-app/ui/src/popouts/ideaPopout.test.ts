import { describe, it, expect } from 'vitest';
import { emailAction, historyLine, ideaLinks, nodeLinks, clipText, cafeIdOf } from './ideaHelpers';

describe('emailAction', () => {
  it('offers approve and copy on a draft with nothing missing', () => {
    expect(emailAction({ status: 'draft', missingSettings: [] }, [])).toEqual({ label: 'Approve and copy', enabled: true, kind: 'approve' });
  });
  it('asks for missing settings first', () => {
    const a = emailAction({ status: 'draft' }, ['Teams link', 'Your name']);
    expect(a).toEqual({ label: 'Set first: Teams link, Your name', enabled: true, kind: 'set-first' });
  });
  it('reads missing settings from the item when none are passed', () => {
    expect(emailAction({ status: 'draft', missingSettings: [{ label: 'Form link' }] }).label).toBe('Set first: Form link');
  });
  it('offers mark as sent once approved', () => {
    expect(emailAction({ status: 'approved' }, [])).toEqual({ label: 'Mark as sent', enabled: true, kind: 'sent' });
  });
  it('has nothing to do once sent', () => {
    expect(emailAction({ status: 'sent', sentAt: '2026-10-19' }, [])).toEqual({ label: 'Sent 19 Oct', enabled: false, kind: 'none' });
  });
});

describe('historyLine', () => {
  const steps = [{ id: 's2a', text: 'Feasibility assessed' }];
  it('says where a stage change went', () => {
    expect(historyLine({ at: '2026-10-19', action: 'stage', detail: 'Review and Select → Design series' })).toBe('Moved to Design series');
    expect(historyLine({ at: '2026-10-19', action: 'stage', detail: 'Review and Select → Closed · Reuse' })).toBe('Closed: Reuse');
  });
  it('says which email was sent or drafted', () => {
    expect(historyLine({ at: '2026-10-19', action: 'sent', detail: 'E1' })).toBe('E1 marked sent');
    expect(historyLine({ at: '2026-10-19', action: 'draft', detail: 'E5' })).toBe('E5 drafted in the Outbox');
  });
  it('names the step', () => {
    expect(historyLine({ at: '2026-10-19', action: 'tick', step: 's2a' }, steps)).toBe('Step done: Feasibility assessed');
    expect(historyLine({ at: '2026-10-19', action: 'untick', step: 's9z' }, steps)).toBe('Step undone: s9z');
  });
  it('words reviews and imports plainly', () => {
    expect(historyLine({ at: '2026-10-19', action: 'review', detail: 'csic: Needs a live system' })).toBe('Reviewed: CSIC Repository. Needs a live system');
    expect(historyLine({ at: '2026-10-19', action: 'created', source: 'inbox/2026-10-19-export.csv' })).toBe('Imported from 2026-10-19-export.csv');
  });
  it('never says ticket or record', () => {
    for (const action of ['created', 'tick', 'untick', 'draft', 'sent', 'review', 'stage']) {
      expect(historyLine({ at: '2026-10-19', action, detail: 'x → y' })).not.toMatch(/ticket|record/i);
    }
  });
});

describe('ideaLinks', () => {
  const graph: any = {
    nodes: [
      { id: 'idea:CAFE-2026-002', type: 'Idea', label: 'RFx intake' },
      { id: 'person:p2', type: 'Person', label: 'Person 2' },
      { id: 'capability:x', type: 'Capability', label: 'Agent design' },
      { id: 'painpoint:y', type: 'PainPoint', label: 'Re-keying' },
      { id: 'idea:CAFE-2026-003', type: 'Idea', label: 'Other' },
    ],
    edges: [
      { id: 'a', from: 'person:p2', to: 'idea:CAFE-2026-002', rel: 'SUBMITTED', source: 'form', confidence: 1, confirmed: true, description: '' },
      { id: 'b', from: 'idea:CAFE-2026-002', to: 'capability:x', rel: 'NEEDS', source: 'form', confidence: 1, confirmed: true, description: '' },
      { id: 'c', from: 'idea:CAFE-2026-002', to: 'painpoint:y', rel: 'REPLACES', source: 'ai', confidence: 0.6, confirmed: false, description: '' },
      { id: 'd', from: 'person:p2', to: 'idea:CAFE-2026-003', rel: 'RELATED', source: 'form', confidence: 1, confirmed: true, description: '' },
    ],
  };
  it('lists only links touching the idea, unconfirmed first', () => {
    const rows = ideaLinks(graph, 'CAFE-2026-002');
    expect(rows.map((r) => r.edge.id)).toEqual(['c', 'b', 'a']);
    expect(rows[0]).toMatchObject({ rel: 'REPLACES', out: true, other: { label: 'Re-keying', type: 'Pain point' }, confidence: 0.6, confirmed: false });
    expect(rows[2]).toMatchObject({ out: false, other: { label: 'Person 2', type: 'Person' } });
  });
  it('copes with no graph and unknown nodes', () => {
    expect(ideaLinks(null, 'CAFE-2026-002')).toEqual([]);
    expect(nodeLinks({ nodes: [], edges: graph.edges }, 'person:p2').map((r) => [r.rel, r.other.label])).toEqual([
      ['RELATED', 'idea:CAFE-2026-003'], ['SUBMITTED', 'idea:CAFE-2026-002'],
    ]);
  });
});

describe('small helpers', () => {
  it('builds the clipboard text', () => { expect(clipText({ subject: 'Hi', body: 'Body' })).toBe('Subject: Hi\n\nBody'); });
  it('finds the Café ID behind an idea star only', () => {
    expect(cafeIdOf('idea:CAFE-2026-002')).toBe('CAFE-2026-002');
    expect(cafeIdOf('team:gss')).toBeNull();
    expect(cafeIdOf(null)).toBeNull();
  });
});
