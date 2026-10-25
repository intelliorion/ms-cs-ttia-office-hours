import { describe, it, expect } from 'vitest';
import { sampleIdea } from './helpers';
import { emptyDesign, type DesignState } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { renderApproachMd } from '../src/design/tools';
import { fitSummary, SUMMARY_MAX } from '../src/design/brainstorm';

/** The builds audit: approach.md, which every kit sends the builder to, named the builder; a cut summary stopped mid-word. */

describe('approach.md', () => {
  it('people by role, as in the kits that send the builder there', () => {
    const idea = sampleIdea({ stage: 3, people: { submitter: 'Person 8', team: [{ name: 'Person 9', roles: ['builder'] }] } });
    const state: DesignState = {
      ...emptyDesign(), features: [{ id: 'a', name: 'Policy answer', flags: [] }],
      tool: { tool: 'Copilot Studio', pathway: pathwayOf('Copilot Studio'), by: 'ai', reason: 'Q&A', pros: [], cons: [], context: ['Built by Person 9 in the sandbox; asked by Person 8'], flags: [], fit: [], evaluatedFor: [], at: '2026-10-20' },
    };
    const md = renderApproachMd(idea, state);
    expect(md).toContain('- Built by the builder in the sandbox; asked by the submitter');
    expect(md).not.toMatch(/Person [89]/);
  });
});

describe('a summary cut at the cap', () => {
  it('ends on its last whole sentence, never mid-word', () => {
    const first = `${'The agent answers policy questions in chat. '.repeat(12)}`;
    const cut = `${first}A citizen developer builds it, tested with 10 sample q…`;
    expect(cut.length).toBeGreaterThan(SUMMARY_MAX - 20);
    expect(fitSummary(cut.slice(0, SUMMARY_MAX))).toBe(first.trimEnd());
    expect(fitSummary(`${first}${'x '.repeat(200)}`)).toBe(first.trimEnd());
    // A short one is left alone, even with an ellipsis of its own.
    expect(fitSummary('Short one…')).toBe('Short one…');
  });
});
