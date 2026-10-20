import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, ideaDir } from '../src/ideas/store';
import { cafeCheck } from '../src/design/cafecheck';
import {
  emptyDesign, readDesign, writeDesign, renderDesignMd, writeDesignMd, loadSkill, skillGuidance, type DesignState,
} from '../src/design/store';

const feat = (over = {}) => ({ id: 'f1', name: 'Intake form', flags: [], ...over });

describe('embedded skills', () => {
  it('load without front matter and ship with the MIT notice', async () => {
    for (const n of ['brainstorming', 'writing-plans'] as const) {
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
    const full = loadSkill('brainstorming');
    const g = skillGuidance('brainstorming', 2000);
    expect(g.length).toBeLessThanOrEqual(2000);
    expect(full.startsWith(g)).toBe(true);
    expect(full[g.length]).toBe('\n');
    expect(skillGuidance('writing-plans').length).toBeLessThanOrEqual(12000);
  });
});

describe('design state', () => {
  it('round-trips in the idea folder and defaults to not-started', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    expect(await readDesign(root, 'CAFE-2026-001')).toEqual(emptyDesign());
    const state: DesignState = {
      version: 1, status: 'designing', summary: 'A form',
      features: [feat({ tool: 'Power Apps', pathway: 'Citizen-Led' })],
      steps: [{ n: 1, question: 'Smallest input?', suggested: ['a'], answer: 'One sheet', source: 'operator', askedTeam: { emailKey: 'k' } }],
    };
    await writeDesign(root, 'CAFE-2026-001', state);
    expect(await readDesign(root, 'CAFE-2026-001')).toEqual(state);
    const dir = await ideaDir(root, 'CAFE-2026-001');
    expect((await readFile(path.join(dir, 'design.yaml'), 'utf8'))).toContain('version: 1');
  });

  it('renders design.md ending with the Café check', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ title: 'Email scheduler', outcomes: ['Fewer missed emails'] });
    await saveIdea(root, idea);
    const state: DesignState = { ...emptyDesign(), status: 'designing', features: [feat({ tool: 'custom app' })], steps: [{ n: 1, question: 'Q one?', suggested: [], source: 'operator' }] };
    const md = renderDesignMd(idea, state);
    expect(md.startsWith('# Email scheduler')).toBe(true);
    const order = ['## What it must show', '## Smallest input', '## Features and tools', '## Decisions so far', '## Café check'].map((h) => md.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain('(not yet answered)');
    expect(md).toContain('**CSIC flags**\n- custom app');
    expect(md).toContain('**Value words**\n- Clean');
    expect(md.trimEnd().split('\n').filter((l) => l.startsWith('## ')).pop()).toBe('## Café check');
    const file = await writeDesignMd(root, idea, state);
    expect(await readFile(file, 'utf8')).toBe(md);
  });
});

describe('cafeCheck', () => {
  const idea = sampleIdea({ challenge: 'Team spends time on intake.' });
  it('is clean for a plain synthetic-data design', () => {
    const r = cafeCheck(idea, { ...emptyDesign(), features: [feat({ tool: 'Power Apps' })] });
    expect(r).toEqual({ valueWords: [], dataFlags: [], csicFlags: [], ok: true });
  });

  it('flags value words once each, in order', () => {
    const state = { ...emptyDesign(), summary: 'It saves 3 FTE and a 20% cost cut; ROI is great. Another FTE.' };
    expect(cafeCheck(idea, state).valueWords).toEqual(['fte', '20%', 'cost', 'roi']);
    expect(cafeCheck(idea, { ...emptyDesign(), summary: 'Annual savings of $5000' }).valueWords).toEqual(['savings', '$5000']);
  });

  it('does not flag bare symbols or word fragments', () => {
    expect(cafeCheck(idea, { ...emptyDesign(), summary: 'A $ sign, 100 percent, costume, benefit-free? no' }).valueWords).toEqual(['benefit']);
  });

  it('flags data and CSIC triggers', () => {
    const state: DesignState = {
      ...emptyDesign(),
      features: [feat({ tool: 'custom app' })],
      steps: [{ n: 1, question: 'q', suggested: [], source: 'operator', answer: 'Needs a live integration with ServiceNow and customer PII, third party feeds' }],
    };
    const r = cafeCheck(idea, state);
    expect(r.csicFlags).toEqual(['custom app', 'live integration', 'servicenow']);
    expect(r.dataFlags).toEqual(['customer', 'pii', 'third party']);
    expect(r.ok).toBe(false);
  });

  it('flags the Technology squad and Salesforce but not "sap" inside words', () => {
    const r = cafeCheck(idea, { ...emptyDesign(), summary: 'Hand to the Technology squad; pull from Salesforce; sapphire' });
    expect(r.csicFlags).toEqual(['technology squad', 'salesforce']);
  });
});
