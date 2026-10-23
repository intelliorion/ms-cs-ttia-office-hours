import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, ideaDir } from '../src/ideas/store';
import {
  emptyDesign, readDesign, writeDesign, renderDesignMd, writeDesignMd, loadSkill, skillGuidance, CSIC_NOTE, type DesignState, type ToolChoice,
} from '../src/design/store';
import { csicFlags, legacyChoice, outOfDate, toolFeatures } from '../src/design/choice';

const feat = (over = {}) => ({ id: 'f1', name: 'Intake form', flags: [], ...over });
/** The one tool, as a saved choice. */
const choice = (tool: string, over = {}): ToolChoice => ({
  tool, pathway: tool === 'custom app' ? 'TTIA-Led' : 'Citizen-Led', by: 'ai', reason: 'Fits', pros: ['Quick'], cons: [], context: ['Form input'],
  flags: tool === 'custom app' ? ['custom-app'] : [], fit: [{ feature: 'Intake form', fit: 'yes', note: '' }], evaluatedFor: ['Intake form'], at: '2026-10-20', ...over,
});

describe('embedded skills', () => {
  it('load without front matter and ship with the MIT notice', async () => {
    for (const n of ['cafe-design', 'writing-plans'] as const) {
      const t = loadSkill(n);
      expect(t.length).toBeGreaterThan(500);
      expect(t.trimStart().startsWith('---')).toBe(false);
      expect(loadSkill(n)).toBe(t);
    }
    const lic = await readFile(new URL('../skills/LICENSE-superpowers.md', import.meta.url), 'utf8');
    expect(lic).toContain('MIT License');
    expect(lic).toContain('Permission is hereby granted');
  });

  it('trims guidance at the budget on a line break', () => {
    const full = loadSkill('writing-plans');
    const g = skillGuidance('writing-plans', 2000);
    expect(g.length).toBeLessThanOrEqual(2000);
    expect(full.startsWith(g)).toBe(true);
    expect(full[g.length]).toBe('\n');
    expect(skillGuidance('writing-plans').length).toBeLessThanOrEqual(12000);
  });

  it('the Café design guide is short, whole in every prompt, and carries the Café rules', () => {
    const t = loadSkill('cafe-design');
    expect(t.length).toBeGreaterThanOrEqual(1200);
    expect(t.length).toBeLessThanOrEqual(2800);
    expect(skillGuidance('cafe-design')).toBe(t);
    expect(t).toMatch(/One question per reply/);
    expect(t).toMatch(/2 to 4 short suggested answers/);
    expect(t).toMatch(/Synthetic, sample or aggregated data only/);
    expect(t).toMatch(/Never ask for a name/);
    expect(t).toMatch(/Telling a clear request from an unclear one/);
    expect(t).not.toMatch(/git|commit|spec|visual companion/i);
  });
});

describe('design state', () => {
  it('round-trips in the idea folder and defaults to not-started', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    expect(await readDesign(root, 'CAFE-2026-001')).toEqual(emptyDesign());
    const state: DesignState = {
      version: 1, status: 'designing', summary: 'A form',
      features: [feat()], tool: choice('Power Apps'),
      steps: [{ n: 1, question: 'Smallest input?', suggested: ['a'], answer: 'One sheet', source: 'operator', askedTeam: { emailKey: 'k' } }],
    };
    await writeDesign(root, 'CAFE-2026-001', state);
    expect(await readDesign(root, 'CAFE-2026-001')).toEqual(state);
    const dir = await ideaDir(root, 'CAFE-2026-001');
    expect((await readFile(path.join(dir, 'design.yaml'), 'utf8'))).toContain('version: 1');
  });

  it('renders design.md ending with the decisions, with the CSIC note from the tool choice', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ title: 'Email scheduler', outcomes: ['Fewer missed emails'] });
    await saveIdea(root, idea);
    const state: DesignState = { ...emptyDesign(), status: 'designing', features: [feat()], tool: choice('custom app'), steps: [{ n: 1, question: 'Q one?', suggested: [], source: 'operator' }] };
    const md = renderDesignMd(idea, state);
    expect(md.startsWith('# Email scheduler')).toBe(true);
    const order = ['## What it must show', '## Smallest input', '## Features and tools', '## Decisions so far'].map((h) => md.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain('(not yet answered)');
    expect(md).toContain(`${CSIC_NOTE} (custom app)`);
    expect(md).not.toContain('Café check');
    expect(md.trimEnd().split('\n').filter((l) => l.startsWith('## ')).pop()).toBe('## Decisions so far');
    const file = await writeDesignMd(root, idea, state);
    expect(await readFile(file, 'utf8')).toBe(md);
  });
});

describe('CSIC flags come from the tool choice, not from words', () => {
  it('a custom app, a tool or in-scope feature flagged live system or personal data; nothing from text', () => {
    expect(csicFlags({ ...emptyDesign(), features: [feat()], tool: choice('Power Apps') })).toEqual([]);
    expect(csicFlags({ ...emptyDesign(), features: [feat()], tool: choice('custom app') })).toEqual(['custom app']);
    expect(csicFlags({
      ...emptyDesign(), tool: choice('Power Apps', { flags: ['needs-live-system'] }),
      features: [feat({ flags: ['personal-data'] }), feat({ id: 'f2', name: 'Dropped', flags: ['needs-live-system'], scope: { status: 'out' } })],
    })).toEqual(['live system: Power Apps', 'personal data: Intake form']);
    expect(csicFlags({ features: [feat({ what: 'A live integration with ServiceNow and customer PII' })], tool: choice('Power Apps') })).toEqual([]);
  });

  it('an older design.yaml with a Café check loads without it', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    const dir = await ideaDir(root, 'CAFE-2026-001');
    await writeFile(path.join(dir, 'design.yaml'), 'version: 1\nstatus: designing\nfeatures: []\nsteps: []\ncafeCheck:\n  valueWords: []\n  dataFlags: []\n  csicFlags: []\n  ok: true\n');
    expect(await readDesign(root, 'CAFE-2026-001')).not.toHaveProperty('cafeCheck');
  });
});

describe('one tool for the whole proof of concept', () => {
  it('design.md names the one tool, each feature under it, and what it cannot do', () => {
    const idea = sampleIdea();
    const state: DesignState = {
      ...emptyDesign(), features: [feat(), feat({ id: 'f2', name: 'Reminders', what: 'Sends reminders' })],
      tool: choice('Power Apps', { fit: [{ feature: 'Intake form', fit: 'yes', note: '' }, { feature: 'Reminders', fit: 'no', note: 'Add Power Automate' }] }),
    };
    const md = renderDesignMd(idea, state);
    expect(md).toContain('One tool for the whole proof of concept: **Power Apps** (Citizen-Led): Fits');
    expect(md).toContain('- **Intake form** (Power Apps)');
    expect(md).toContain('- **Reminders** (Power Apps): Sends reminders (the tool cannot do this: Add Power Automate)');
  });

  it('every feature gets the one tool through toolFeatures; none without a tool', () => {
    const s = { features: [feat(), feat({ id: 'f2', name: 'B' })], tool: choice('Dataiku') };
    expect(toolFeatures(s).map((f) => [f.name, f.tool, f.pathway])).toEqual([['Intake form', 'Dataiku', 'Citizen-Led'], ['B', 'Dataiku', 'Citizen-Led']]);
    expect(toolFeatures({ features: [feat()] })[0].tool).toBeUndefined();
  });

  it('the evaluation is out of date once the feature names change (order and case aside)', () => {
    const c = choice('Power Apps', { evaluatedFor: ['Intake form', 'Reminders'] });
    expect(outOfDate([{ name: 'reminders' }, { name: 'Intake form ' }], c)).toBe(false);
    expect(outOfDate([{ name: 'Intake form' }], c)).toBe(true);
    expect(outOfDate([{ name: 'Intake form' }, { name: 'Reminders' }, { name: 'Summary' }], c)).toBe(true);
    expect(outOfDate([{ name: 'Intake form' }], undefined)).toBe(false);
  });

  it('an older record (a tool on each feature) loads as features and one tool: the most common, with its pros and cons, by the operator', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    const dir = await ideaDir(root, 'CAFE-2026-001');
    await writeFile(path.join(dir, 'design.yaml'), [
      'version: 1', 'status: designing', 'approvedAt: 2026-10-19', 'steps: []', 'features:',
      '  - { id: a, name: Form, what: Takes requests, tool: Power Apps, pathway: Assisted Citizen, reason: A form, pros: [Quick], cons: [No reminders], context: [Form input], flags: [personal-data] }',
      '  - { id: b, name: Engine, tool: custom app, pathway: TTIA-Led, flags: [custom-app] }',
      '  - { id: c, name: List, tool: Power Apps, pathway: Assisted Citizen, flags: [] }',
      '',
    ].join('\n'));
    const st = await readDesign(root, 'CAFE-2026-001');
    expect(st.features).toEqual([
      { id: 'a', name: 'Form', what: 'Takes requests', flags: ['personal-data'] },
      { id: 'b', name: 'Engine', flags: [] },
      { id: 'c', name: 'List', flags: [] },
    ]);
    expect(st.tool).toMatchObject({
      tool: 'Power Apps', pathway: 'Assisted Citizen', by: 'operator', reason: 'A form', pros: ['Quick'], cons: ['No reminders'], context: ['Form input'],
      evaluatedFor: ['Form', 'Engine', 'List'], at: '2026-10-19',
    });
    expect(st.tool!.fit).toEqual([
      { feature: 'Form', fit: 'yes', note: '' },
      { feature: 'Engine', fit: 'partly', note: 'Was picked for custom app before the one-tool picker' },
      { feature: 'List', fit: 'yes', note: '' },
    ]);
    // A tie goes to the first feature's tool; a record with no tools has no tool.
    expect(legacyChoice([{ name: 'A', tool: 'custom app' }, { name: 'B', tool: 'UiPath' }], 'x').tool).toMatchObject({ tool: 'custom app', flags: ['custom-app'], pathway: 'TTIA-Led' });
    expect(legacyChoice([{ name: 'A' }], 'x').tool).toBeUndefined();
  });
});
