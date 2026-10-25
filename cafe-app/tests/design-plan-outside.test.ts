import { describe, it, expect } from 'vitest';
import { sampleIdea } from './helpers';
import { emptyDesign, type DesignState } from '../src/design/store';
import { pathwayOf } from '../src/design/choice';
import { designPlanInput, renderPlanMd } from '../src/design/kits';
import { designPlanTask } from '../src/ai/tasks';

/**
 * The builds audit: a feature the design does with another tool, outside the build (a weekly count in Excel), went to
 * the plan AI with that tool, which the plan's schema does not take: its task landed under "Not picked", telling the
 * builder to change the tool.
 */
const design: DesignState = {
  ...emptyDesign(), status: 'approved', approvedAt: '2026-10-20', summary: 'Answers travel policy questions.',
  features: [
    { id: 'answer', name: 'Policy answer', what: 'Answers from the policy', flags: [] },
    { id: 'count', name: 'Weekly count', what: 'Counts questions by week', flags: [], scope: { status: 'outside', by: 'Excel on the SharePoint list', why: 'No weekly view' } },
    { id: 'live', name: 'Live feed', flags: [], scope: { status: 'out', why: 'No live data' } },
  ],
  tool: { tool: 'Copilot Studio', pathway: pathwayOf('Copilot Studio'), by: 'ai', reason: 'Q&A', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: [], at: '2026-10-20' },
};

describe('the plan and a feature done outside the build', () => {
  it('the plan AI sees it under the picked tool, with the other tool said, so its task is not "Not picked"', () => {
    const input = designPlanInput(sampleIdea({ stage: 3 }), design);
    expect(input.features).toEqual([
      { name: 'Policy answer', what: 'Answers from the policy', tool: 'Copilot Studio' },
      { name: 'Weekly count', what: 'Done with Excel on the SharePoint list, outside the Copilot Studio build: Counts questions by week', tool: 'Copilot Studio' },
    ]);
    expect(designPlanTask.prompt(input)).toMatch(/keeps the picked tool's label: name the other tool in the task's title/);
    const md = renderPlanMd(sampleIdea({ stage: 3 }), design, { tasks: [{ title: 'Set up the weekly count in Excel', detail: 'd', tool: 'Copilot Studio', done_when: 'w' }], risks: [] });
    expect(md).not.toContain('### Not picked');
    expect(md).toContain('### Copilot Studio');
  });
});
