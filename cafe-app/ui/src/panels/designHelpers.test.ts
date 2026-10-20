import { describe, it, expect } from 'vitest';
import {
  approvedTools, buildInstruction, cafeCheckRows, designPhase, featureRows, flagsFor, hasAgentKit, ideaFolder, mergeRows, openStep, pathwayText,
  picksBody, picksProblem, stepStatus, suggestedLines, emptyRow, AGENT_FILE, APPROVED_TOOLS,
} from './designHelpers';

// The suggest route's mixed reply: a saved DesignFeature first, then AI ToolPickFeatures.
const MIXED = [
  { id: 'request-intake-form', name: 'Request intake form', tool: 'Power Apps', pathway: 'Assisted Citizen', flags: [] },
  { name: 'Draft replies', what: 'Drafts a first reply', tool: 'Microsoft Copilot', reason: 'No build needed', flags: ['no-build'] },
  { name: 'Scheduling engine', what: 'Works out a send slot', tool: 'custom app', reason: 'No low-code tool does this', flags: [] },
  { name: 'Odd one', tool: 'PowerApps', flags: ['no-build', 7] },
  { name: '   ' },
  null,
];

describe('featureRows', () => {
  it('reads both shapes and marks only the AI rows as suggestions', () => {
    const rows = featureRows(MIXED, { fromAi: true });
    expect(rows.map((r) => r.name)).toEqual(['Request intake form', 'Draft replies', 'Scheduling engine', 'Odd one']);
    expect(rows.map((r) => r.suggested)).toEqual([false, true, true, true]);
    expect(rows[0]).toMatchObject({ key: 'request-intake-form', what: '', reason: '', tool: 'Power Apps' });
  });
  it('adds the custom-app flag to a custom app pick and drops tools that are not on the list', () => {
    const rows = featureRows(MIXED, { fromAi: true });
    expect(rows[2].flags).toEqual(['custom-app']);
    expect(rows[3]).toMatchObject({ tool: '', flags: ['no-build'] });
  });
  it('saved features are never suggestions; junk gives no rows', () => {
    expect(featureRows(MIXED).every((r) => !r.suggested)).toBe(true);
    expect(featureRows(undefined)).toEqual([]);
    expect(featureRows({})).toEqual([]);
  });
});

describe('picksBody', () => {
  it('sends only name, what, tool, reason and flags, trimmed; drops empty rows', () => {
    const rows = [...featureRows(MIXED, { fromAi: true }).slice(0, 3), emptyRow()];
    const body = picksBody(rows);
    expect(body.features).toHaveLength(3);
    expect(body.features[0]).toEqual({ name: 'Request intake form', tool: 'Power Apps', flags: [] });
    expect(body.features[2]).toEqual({ name: 'Scheduling engine', what: 'Works out a send slot', tool: 'custom app', reason: 'No low-code tool does this', flags: ['custom-app'] });
    for (const f of body.features) expect(Object.keys(f).every((k) => ['name', 'what', 'tool', 'reason', 'flags'].includes(k))).toBe(true);
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
  it('keeps the operator rows and adds only new names', () => {
    const local = featureRows([{ name: 'Draft replies', tool: 'Power Apps', flags: [] }]);
    const merged = mergeRows(local, featureRows(MIXED, { fromAi: true }));
    expect(merged.map((r) => r.name)).toEqual(['Draft replies', 'Request intake form', 'Scheduling engine', 'Odd one']);
    expect(merged[0].tool).toBe('Power Apps');
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

describe('cafeCheckRows', () => {
  it('three rows, clean when empty', () => {
    const rows = cafeCheckRows({ valueWords: [], dataFlags: ['client'], csicFlags: ['custom app', 'sap'] });
    expect(rows.map((r) => r.label)).toEqual(['Value words', 'Data flags', 'CSIC flags']);
    expect(rows.map((r) => r.clean)).toEqual([true, false, false]);
    expect(rows[2].items).toEqual(['custom app', 'sap']);
  });
  it('no check yet reads as clean', () => {
    expect(cafeCheckRows(undefined).every((r) => r.clean && r.items.length === 0)).toBe(true);
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
  it('featureRows keeps a tool only when it is on the list it is given', () => {
    const raw = [{ id: 'a', name: 'A', tool: 'New tool', flags: [] }];
    expect(featureRows(raw)[0].tool).toBe('');
    expect(featureRows(raw, { tools: ['New tool'] })[0].tool).toBe('New tool');
  });
});
