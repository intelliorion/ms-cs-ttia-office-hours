import { describe, it, expect } from 'vitest';
import {
  approvedTools, buildInstruction, designPhase, featureRows, flagsFor, hasAgentKit, ideaFolder, mergeRows, openStep, pathwayText,
  picksBody, picksProblem, stepStatus, suggestedLines, emptyRow, AGENT_FILE, APPROVED_TOOLS, toolView, overrideTool, outOfDate, featuresBody, scopeLabel, retiredNote,
  flagWord,
} from './designHelpers';

// The features route's mixed reply: a saved DesignFeature first, then AI suggestions (and an older row with a tool).
const MIXED = [
  { id: 'request-intake-form', name: 'Request intake form', flags: [] },
  { name: 'Draft replies', what: 'Drafts a first reply', flags: ['personal-data'] },
  { name: 'Scheduling engine', what: 'Works out a send slot', flags: [] },
  { name: 'Odd one', tool: 'PowerApps', flags: ['no-build', 'custom-app', 7, 'needs-live-system'] },
  { name: '   ' },
  null,
];

describe('featureRows', () => {
  it('reads saved features and suggestions, and marks only the AI rows as suggestions', () => {
    const rows = featureRows(MIXED, { fromAi: true });
    expect(rows.map((r) => r.name)).toEqual(['Request intake form', 'Draft replies', 'Scheduling engine', 'Odd one']);
    expect(rows.map((r) => r.suggested)).toEqual([false, true, true, true]);
    expect(rows[0]).toMatchObject({ key: 'request-intake-form', what: '' });
  });
  it('keeps feature flags only: a tool and its flags are not a feature\'s', () => {
    const rows = featureRows(MIXED, { fromAi: true });
    expect(rows[3].flags).toEqual(['needs-live-system']);
    expect(Object.keys(rows[3])).not.toContain('tool');
  });
  it('saved features are never suggestions; junk gives no rows', () => {
    expect(featureRows(MIXED).every((r) => !r.suggested)).toBe(true);
    expect(featureRows(undefined)).toEqual([]);
    expect(featureRows({})).toEqual([]);
  });
});

describe('picksBody', () => {
  it('sends the features (name, what, flags, trimmed; empty rows dropped) and the one tool when there is one', () => {
    const rows = [...featureRows(MIXED, { fromAi: true }).slice(0, 3), emptyRow(), { ...emptyRow(), name: '  Padded  ', what: ' x ' }];
    const body = picksBody(rows);
    expect(body).toEqual({ features: [
      { name: 'Request intake form', flags: [] },
      { name: 'Draft replies', what: 'Drafts a first reply', flags: ['personal-data'] },
      { name: 'Scheduling engine', what: 'Works out a send slot', flags: [] },
      { name: 'Padded', what: 'x', flags: [] },
    ] });
    const tool = toolView({ tool: 'Power Apps', by: 'ai', pros: ['Quick'] })!;
    expect(picksBody(rows, tool).tool).toBe(tool);
  });
  it('the custom-app flag follows the tool', () => {
    expect(flagsFor('Power Apps', ['custom-app', 'no-build'])).toEqual(['no-build']);
    expect(flagsFor('custom app', ['no-build'])).toEqual(['custom-app', 'no-build']);
  });
});

describe('picksProblem', () => {
  it('needs a name on every row and no two the same', () => {
    expect(picksProblem([{ ...emptyRow(), what: 'Something' }])).toBe('Every feature needs a name.');
    expect(picksProblem([{ ...emptyRow(), name: 'Form' }, { ...emptyRow(), name: 'form ' }])).toBe('Two features are called form.');
    expect(picksProblem([{ ...emptyRow(), name: 'Form' }, emptyRow()])).toBeNull();
  });
});

describe('mergeRows', () => {
  it('keeps the operator rows as they are and adds only new names', () => {
    const local = featureRows([{ name: 'Draft replies', what: 'Mine', flags: [] }]);
    const merged = mergeRows(local, featureRows(MIXED, { fromAi: true }));
    expect(merged.map((r) => r.name)).toEqual(['Draft replies', 'Request intake form', 'Scheduling engine', 'Odd one']);
    expect(merged[0].what).toBe('Mine');
  });
});

describe('the one tool', () => {
  it('toolView keeps an approved tool only, with the custom-app flag following it and only good fit lines', () => {
    expect(toolView({ tool: 'Excel' })).toBeNull();
    expect(toolView(null)).toBeNull();
    const t = toolView({ tool: 'custom app', by: 'ai', fit: [{ feature: 'A', fit: 'no', note: 'x' }, { feature: 'B', fit: 'maybe' }, { fit: 'yes' }] })!;
    expect(t).toMatchObject({ tool: 'custom app', by: 'ai', flags: ['custom-app'], fit: [{ feature: 'A', fit: 'no', note: 'x' }] });
    expect(toolView({ tool: 'New tool' }, ['New tool'])!.tool).toBe('New tool');
  });
  it('overrideTool: the operator\'s tool with no AI: pros, cons and fit cleared, evaluated for the rows there now', () => {
    const rows = featureRows([{ name: 'A' }, { name: 'B' }]);
    expect(overrideTool('Dataiku', rows)).toEqual({ tool: 'Dataiku', by: 'operator', reason: '', pros: [], cons: [], context: [], flags: [], fit: [], evaluatedFor: ['A', 'B'], needsAi: true });
  });
  it('outOfDate: true once the feature names differ from the ones the tool was evaluated for', () => {
    const t = toolView({ tool: 'Power Apps', evaluatedFor: ['A', 'B'] })!;
    expect(outOfDate([{ name: 'b' }, { name: 'A' }], t)).toBe(false);
    expect(outOfDate([{ name: 'A' }], t)).toBe(true);
    expect(outOfDate([{ name: 'A' }], null)).toBe(false);
  });
});

describe('a tool no longer approved', () => {
  it('UiPath is off the list: an older record that chose it shows the note and no tool, never another one', () => {
    expect(APPROVED_TOOLS).not.toContain('UiPath' as any);
    expect(toolView({ tool: 'UiPath', by: 'operator' })).toBeNull();
    expect(retiredNote({ tool: 'UiPath' })).toBe('UiPath is no longer on the approved list: pick another tool');
    expect(retiredNote({ tool: 'Dataiku' })).toBeNull();
    expect(retiredNote(undefined)).toBeNull();
    expect(pathwayText('UiPath')).toBe('');
  });
});

describe('pathwayText', () => {
  it('words the pathway like the server', () => {
    expect(pathwayText('custom app')).toBe('TTIA-Led (CSIC Repository)');
    expect(pathwayText('Microsoft Copilot')).toBe('Citizen-Led (no build)');
    expect(pathwayText('Power Apps')).toBe('Citizen-Led (Assisted Citizen until a builder is named)');
    expect(pathwayText('Power Apps', 'Builder A')).toBe('Citizen-Led');
    expect(pathwayText('')).toBe('');
  });
});

describe('stepStatus and openStep', () => {
  const steps = [
    { n: 1, question: 'A?', answer: 'Yes', source: 'ai-suggested' },
    { n: 2, question: 'B?', askedTeam: { emailKey: 'k' } },
    { n: 3, question: 'C?' },
    { n: 4, question: 'D?', answer: 'From the reply', source: 'e2' },
    { n: 5, question: 'E?', answer: 'Typed', source: 'operator' },
  ];
  it('labels each step', () => {
    expect(steps.map((s) => stepStatus(s).label)).toEqual([
      'Picked a suggested answer', 'Asked the team · E2 drafted', 'Waiting for an answer', 'Answered by the team', 'Answered',
    ]);
    expect(steps.map((s) => stepStatus(s).kind)).toEqual(['answered', 'asked', 'open', 'answered', 'answered']);
  });
  it('the open step is the first unanswered one not asked of the team', () => {
    expect(openStep(steps)?.n).toBe(3);
    expect(openStep(steps.slice(0, 2))).toBeUndefined();
  });
});

describe('designPhase', () => {
  it('moves from no features to approved', () => {
    expect(designPhase(null)).toBe('no-features');
    expect(designPhase({ features: [] })).toBe('no-features');
    expect(designPhase({ features: [{}] })).toBe('designing');
    expect(designPhase({ features: [], summary: 'S' })).toBe('done');
    expect(designPhase({ summary: 'S', approvedAt: '2026-10-20' })).toBe('approved');
  });
});

describe('buildInstruction', () => {
  it('points at design.md, plan.md and the agent file, and keeps the agent inside the kit folder', () => {
    const t = buildInstruction('CAFE-2026-002', 'shared-mailbox-triage');
    const dir = 'ideas/CAFE-2026-002-shared-mailbox-triage';
    expect(t).toContain(`${dir}/design.md`);
    expect(t).toContain(`${dir}/plan.md`);
    expect(t).toContain(`${dir}/${AGENT_FILE}`);
    expect(t).toContain(`Write only inside ${dir}/kit/custom-app/`);
    expect(t).toMatch(/synthetic/i);
    expect(t).toContain('CSIC');
  });
  it('folder without a slug is the bare ID', () => {
    expect(ideaFolder('CAFE-2026-002')).toBe('ideas/CAFE-2026-002');
  });
  it('the folder the server sent wins over the guessed one', () => {
    const real = 'ideas/CAFE-2026-002-desk-booking-assistant';
    expect(ideaFolder('CAFE-2026-002', 'other-slug', real)).toBe(real);
    expect(ideaFolder('CAFE-2026-002', 'other-slug', '  ')).toBe('ideas/CAFE-2026-002-other-slug');
    const t = buildInstruction('CAFE-2026-002', 'other-slug', real);
    expect(t).toContain(`${real}/design.md`);
    expect(t).toContain(`Write only inside ${real}/kit/custom-app/`);
    expect(t).not.toContain('other-slug');
  });
});

describe('small helpers', () => {
  it('finds the custom-app agent kit', () => {
    expect(hasAgentKit(['plan.md', 'kit/custom-app/BUILD-WITH-AGENT.md'])).toBe(true);
    expect(hasAgentKit(['plan.md'])).toBe(false);
    expect(hasAgentKit(undefined)).toBe(false);
  });
  it('suggested answers one per line, at most four', () => {
    expect(suggestedLines('a\n\n b \nc\nd\ne')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('approvedTools', () => {
  it('reads the server list from /api/state, else falls back to the local list', () => {
    expect(approvedTools({ approvedTools: ['Power Apps', 'New tool'] })).toEqual(['Power Apps', 'New tool']);
    expect(approvedTools({})).toEqual([...APPROVED_TOOLS]);
    expect(approvedTools(null)).toEqual([...APPROVED_TOOLS]);
    expect(approvedTools({ approvedTools: [] })).toEqual([...APPROVED_TOOLS]);
    expect(approvedTools({ approvedTools: 'Power Apps' })).toEqual([...APPROVED_TOOLS]);
  });
  it('toolView keeps a tool only when it is on the list it is given', () => {
    expect(toolView({ tool: 'New tool' })).toBeNull();
    expect(toolView({ tool: 'New tool' }, ['New tool'])!.tool).toBe('New tool');
  });
});

describe('a feature the design moved', () => {
  it('keeps its scope through the rows and the save body; "Put it back" (no scope) sends none', () => {
    const rows = featureRows([
      { id: 'a', name: 'Review list', flags: [], scope: { status: 'out', why: 'Leave marking out', step: 2 } },
      { id: 'b', name: 'Query drafting', flags: [], scope: { status: 'outside', by: 'Microsoft Copilot + SharePoint' } },
      { id: 'c', name: 'Bad', flags: [], scope: { status: 'outside' } },
    ]);
    expect(rows.map((r) => r.scope?.status)).toEqual(['out', 'outside', undefined]);
    const body = featuresBody(rows);
    expect(body[0].scope).toEqual({ status: 'out', why: 'Leave marking out', step: 2 });
    expect(featuresBody([{ ...rows[0], scope: undefined }])[0]).not.toHaveProperty('scope');
    expect(scopeLabel(rows[0].scope)).toBe('Out of scope');
    expect(scopeLabel(rows[1].scope, 'Dataiku')).toBe('Microsoft Copilot + SharePoint, outside the Dataiku build');
  });
});

describe('flags as tags', () => {
  it('a flag in words; rows keep feature flags only', () => {
    expect(flagWord('personal-data')).toBe('Personal data');
    expect(flagWord('needs-live-system')).toBe('Needs a live system');
    const rows = featureRows([{ id: 'a', name: 'Dup', flags: ['personal-data', 'custom-app', 'something-else'] }]);
    expect(rows[0].flags).toEqual(['personal-data']);
    expect(featuresBody(rows)[0]).toEqual({ name: 'Dup', flags: ['personal-data'] });
  });
});
