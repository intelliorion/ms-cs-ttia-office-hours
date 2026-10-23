import { describe, it, expect } from 'vitest';
import { historyLine, ideaLinks, nodeLinks, cafeIdOf, ideaCardModel } from './ideaHelpers';

describe('historyLine', () => {
  it('shows an Import line for a filed email, by file name only', () => {
    expect(historyLine({ at: '2026-10-20', action: 'inbox', detail: 'Email filed as ideas/CAFE-2026-001-email-scheduler/emails/in/2026-10-20-re-questions.eml', source: 'inbox/2026-10-20-reply.eml' }))
      .toBe('Import: Email filed as 2026-10-20-re-questions.eml (from 2026-10-20-reply.eml)');
    expect(historyLine({ at: '2026-10-20', action: 'inbox-undo', detail: 'Undone: File it in CAFE-2026-001' })).toBe('Import: Undone: File it in CAFE-2026-001');
  });
  it('says what the answers changed, as written', () => {
    expect(historyLine({ at: '2026-10-23', action: 'answers-update', by: 'ai', detail: 'Updated from the tool answers: Make Person 2 the builder' }))
      .toBe('Updated from the tool answers: Make Person 2 the builder');
  });
  const steps = [{ id: 's2a', text: 'Feasibility assessed' }];
  it('says where a stage change went', () => {
    expect(historyLine({ at: '2026-10-19', action: 'stage', detail: 'Review and Select → Design series' })).toBe('Moved to Design series');
    expect(historyLine({ at: '2026-10-19', action: 'stage', detail: 'Review and Select → Closed · Reuse' })).toBe('Closed: Reuse');
    expect(historyLine({ at: '2026-10-19', action: 'stage', detail: 'Undone in the Import' })).toBe('Undone in the Import');
    expect(historyLine({ at: '2026-10-19', action: 'round', detail: 'round set to Autumn' })).toBe('Round set to Autumn');
    expect(historyLine({ at: '2026-10-19', action: 'round', detail: 'round cleared' })).toBe('Round cleared');
  });
  it('says which email was sent or drafted', () => {
    expect(historyLine({ at: '2026-10-19', action: 'sent', detail: 'E1' })).toBe('E1 marked sent');
    expect(historyLine({ at: '2026-10-19', action: 'draft', detail: 'E5' })).toBe('E5 drafted');
    expect(historyLine({ at: '2026-10-19', action: 'replaced', detail: 'E3 replaced by E6' })).toContain('E3 replaced by E6');
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
  it('finds the Café ID behind an idea star only', () => {
    expect(cafeIdOf('idea:CAFE-2026-002')).toBe('CAFE-2026-002');
    expect(cafeIdOf('team:gss')).toBeNull();
    expect(cafeIdOf(null)).toBeNull();
  });
});

describe('ideaCardModel', () => {
  const graph = { nodes: [{ id: 'idea:CAFE-1', type: 'Idea', label: 'x', attrs: { stage: 2, stageLabel: 'Triage' } }], edges: [
    { from: 'idea:CAFE-1', to: 'team:a', rel: 'X' }, { from: 'tool:b', to: 'idea:CAFE-1', rel: 'Y' }, { from: 'tool:b', to: 'team:a', rel: 'Z' }] } as any;
  const idea = { id: 'CAFE-1', title: 'Mail bot', function: 'BSI', region: 'AMER', stage: 2, sent: { E1: '2026-10-19' }, overdue: [{ text: 'E2 reply is 8 days late' }] };
  it('summarises an open idea', () => {
    const m = ideaCardModel(idea, graph, [{ idea: 'CAFE-1', template: 'E5', status: 'draft' }]);
    expect(m).toEqual({ id: 'CAFE-1', title: 'Mail bot', stageLabel: 'Triage', stageColour: '#f5b36b', where: 'BSI · AMER',
      emails: ['E1 ✓ 19 Oct', 'E5 draft'], late: 'E2 reply is 8 days late', linkCount: 2 });
  });
  it('closed ideas are never late', () => {
    const m = ideaCardModel({ ...idea, closed: 'csic' }, graph);
    expect(m.late).toBeNull(); expect(m.stageLabel).toBe('Closed · csic'); expect(m.stageColour).toBe('#5c6b6a');
  });
});
