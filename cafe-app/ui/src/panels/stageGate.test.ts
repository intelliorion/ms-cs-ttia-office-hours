import { describe, it, expect } from 'vitest';
import { sectionsFor, HOME_STAGE } from './stageGate';

const idea = (stage: number, extra: any = {}) => ({ stage, ...extra });
const review = { decision: 'select', reason: 'ok', criteria: {}, at: '2026-10-20' };
const feats = [{ id: 'f', name: 'F' }];

describe('sectionsFor', () => {
  it('stage 1: nothing but the idea itself', () => {
    expect(sectionsFor(idea(1), null, [])).toEqual({ review: 'hidden', tools: 'hidden', design: 'hidden', plan: 'hidden' });
  });
  it('stage 2: the decision is the one active section', () => {
    expect(sectionsFor(idea(2), null, [])).toEqual({ review: 'active', tools: 'hidden', design: 'hidden', plan: 'hidden' });
  });
  it('stage 3: the decision is a card, the tool picker is active, the design waits for features', () => {
    expect(sectionsFor(idea(3, { review }), { features: [] }, [])).toEqual({ review: 'summary', tools: 'active', design: 'hidden', plan: 'hidden' });
    expect(sectionsFor(idea(3, { review }), { features: feats }, [])).toEqual({ review: 'summary', tools: 'active', design: 'active', plan: 'hidden' });
    expect(sectionsFor(idea(3, { review }), { features: feats, summary: 's', approvedAt: '2026-10-20' }, []))
      .toEqual({ review: 'summary', tools: 'active', design: 'active', plan: 'active' });
  });
  it('after their home stage the decision and tools cards show even without data, so the gap is visible', () => {
    expect(sectionsFor(idea(3), { features: [] }, []).review).toBe('summary');
    expect(sectionsFor(idea(4), { features: [] }, []).tools).toBe('summary');
  });
  it('stage 4: everything that has data is a card, nothing is editable', () => {
    expect(sectionsFor(idea(4, { review }), { features: feats, summary: 's', approvedAt: '2026-10-20' }, []))
      .toEqual({ review: 'summary', tools: 'summary', design: 'summary', plan: 'summary' });
    expect(sectionsFor(idea(4, { review }), { features: [] }, []))
      .toEqual({ review: 'summary', tools: 'summary', design: 'hidden', plan: 'hidden' });
  });
  it('closed: cards only, even at the home stage', () => {
    expect(sectionsFor(idea(2, { review, closed: { as: 'csic' } }), { features: feats }, ['review']))
      .toEqual({ review: 'summary', tools: 'summary', design: 'hidden', plan: 'hidden' });
  });
  it('data wins over stage: a stage-1 idea with a saved decision or picks shows them as cards', () => {
    expect(sectionsFor(idea(1, { review }), { features: feats, steps: [{ n: 1 }] }, []))
      .toEqual({ review: 'summary', tools: 'summary', design: 'summary', plan: 'hidden' });
  });
  it('Edit reopens a card as the full form, unless the idea is closed', () => {
    expect(sectionsFor(idea(3, { review }), { features: [] }, ['review']).review).toBe('active');
    expect(sectionsFor(idea(4, { review }), { features: feats }, ['tools', 'design']))
      .toEqual({ review: 'summary', tools: 'active', design: 'active', plan: 'hidden' });
  });
  it('stage 3 with questions but no features keeps the design open (data wins)', () => {
    expect(sectionsFor(idea(3, { review }), { features: [], steps: [{ n: 1 }] }, []).design).toBe('active');
  });
  it('design not loaded yet: the stage-3 picker still shows (it says Loading), the rest waits', () => {
    expect(sectionsFor(idea(3, { review }), null, [])).toEqual({ review: 'summary', tools: 'active', design: 'hidden', plan: 'hidden' });
  });
  it('plan files written earlier stay visible after the design is reopened (approvedAt gone)', () => {
    expect(sectionsFor(idea(3, { review }), { features: feats, steps: [{ n: 1 }] }, [], { files: ['plan.md'] }).plan).toBe('active');
    expect(sectionsFor(idea(4, { review }), { features: feats }, [], { files: ['plan.md'] }).plan).toBe('summary');
    expect(sectionsFor(idea(3, { review, closed: { as: 'csic' } }), { features: feats }, [], { files: ['plan.md'] }).plan).toBe('summary');
  });
  it('names the home stage of each section', () => {
    expect(HOME_STAGE).toEqual({ review: 2, tools: 3, design: 3, plan: 3 });
  });
});
