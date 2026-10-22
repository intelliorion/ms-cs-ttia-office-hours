import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Details } from './IdeaSections';

const base = { id: 'CAFE-2026-001', title: 'Desk finder', outcomes: [], support: [], people: { team: [] } };

describe('Details', () => {
  it('shows the newer form columns', () => {
    const html = renderToStaticMarkup(<Details idea={{ ...base, business_impact: 'Saves 2 hours a week', beneficiaries: ['Employees', 'Office managers'], use_case_category: ['Workplace services'], maturity: 'Prototype', additional_context: 'Pilot first.' }} />);
    for (const t of ['Business impact', 'Saves 2 hours a week', 'Office managers', 'Workplace services', 'Prototype', 'Additional context', 'Pilot first.']) expect(html).toContain(t);
  });
  it('an idea from an older export says "Not given" and leaves out additional context', () => {
    const html = renderToStaticMarkup(<Details idea={base} />);
    expect(html).toContain('Solution maturity');
    expect(html).not.toContain('Additional context');
  });
});

import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Review } from './IdeaSections';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
describe('Review: a suggested decision', () => {
  it('says what it was based on, so a new email visibly changes it', async () => {
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    const state = { decisions: { select: 'Select', ask: 'Ask' }, criteria: [{ id: 'builder', text: 'A builder is named' }] };
    await act(async () => root.render(<Review idea={{ ...base, stage: 2 }} state={state} busy={false} onSave={() => {}} aiName="Claude Code" onClearAi={() => {}} aiBar={null}
      aiReview={{ criteria: { builder: true }, decision: 'select', reason: 'A builder is named in the reply.', basis: 'Based on the form, 2 email answers and a builder named' }} />));
    expect(el.querySelector('[data-testid="ai-review-by"]')?.textContent).toBe('Suggested by Claude Code. Based on the form, 2 email answers and a builder named. Check it, change what you like, then save.');
    act(() => root.unmount()); el.remove();
  });
});
