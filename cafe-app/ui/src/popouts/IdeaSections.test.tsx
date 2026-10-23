import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Details } from './IdeaSections';

const base = { id: 'CAFE-2026-001', title: 'Desk finder', outcomes: [], support: [], people: { team: [] } };

describe('Details', () => {
  it('shows the newer form columns', () => {
    const html = renderToStaticMarkup(<Details idea={{ ...base, business_impact: 'Saves 2 hours a week', beneficiaries: ['Employees', 'Office managers'], use_case_category: ['Workplace services'], maturity: 'Prototype', additional_context: 'Pilot first.' }} />);
    for (const t of ['Builder', 'Business impact', 'Saves 2 hours a week', 'Office managers', 'Workplace services', 'Prototype', 'Additional context', 'Pilot first.']) expect(html).toContain(t);
  });
  it('an idea from an older export says "Not given" and leaves out additional context', () => {
    const html = renderToStaticMarkup(<Details idea={base} />);
    expect(html).toContain('Solution maturity');
    expect(html).not.toContain('Additional context');
  });
});
