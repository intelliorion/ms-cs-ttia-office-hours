import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { RecipeFlowDiagram } from './RecipeFlowDiagram';
import { checkFlow, type RecipeFlow } from '../../../src/design/recipeFlow';
import { fileNote, packFiles, kitSlug } from './designPack';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement | undefined; let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); el?.remove(); el = undefined; root = undefined; });

const FLOW: RecipeFlow = checkFlow({
  datasets: [
    { id: 'claims', name: 'claims_sample', kind: 'input', about: 'From sample-data.csv', columns: [{ name: 'claim_date', type: 'date' }] },
    { id: 'rules', name: 'policy_rules', kind: 'rules', about: '', columns: [] },
    { id: 'joined', name: 'claims_with_rules', kind: 'intermediate', about: '', columns: [] },
    { id: 'flags', name: 'weekend_flags', kind: 'output', about: '', columns: [] },
    { id: 'other', name: 'other_in', kind: 'input', about: '', columns: [] },
    { id: 'other_out', name: 'other_out', kind: 'output', about: '', columns: [] },
  ],
  recipes: [
    { id: 'j', name: 'Join the rules', kind: 'join', inputs: ['claims', 'rules'], outputs: ['joined'], steps: ['Left join on code'] },
    { id: 'f', name: 'Flag weekends', kind: 'prepare', inputs: ['joined'], outputs: ['flags'], steps: ['Formula: weekday(claim_date) >= 6', 'Filter: keep flagged'], feature: 'Weekend flag' },
    { id: 'o', name: 'Unrelated', kind: 'filter', inputs: ['other'], outputs: ['other_out'], steps: [] },
  ],
  dashboard: { name: 'Weekend claims', shows: ['Count by code'], from: ['flags'] },
}, 'Claims project', ['Weekend flag'])!;

describe('the recipe flow in the pack', () => {
  const mount = () => {
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    act(() => root!.render(<RecipeFlowDiagram flow={FLOW} />));
    return el;
  };
  it('draws datasets as boxes and recipes as circles; hover lights the path; click shows the recipe\'s steps or the columns', () => {
    const d = mount();
    expect(d.querySelectorAll('.rf-recipe circle')).toHaveLength(3);
    expect(d.querySelectorAll('.rf-dataset')).toHaveLength(6);
    expect(d.querySelectorAll('.rf-dashboard')).toHaveLength(1);
    expect(d.querySelectorAll('.rf-edge')).toHaveLength(8);
    const node = (id: string) => d.querySelector(`[data-node="${id}"]`)!;
    act(() => { node('f').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(node('claims').getAttribute('class')).toMatch(/\bon\b/);
    expect(node('dashboard').getAttribute('class')).toMatch(/\bon\b/);
    expect(node('o').getAttribute('class')).toMatch(/\bdim\b/);
    act(() => { node('f').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const card = d.querySelector('[data-testid="flow-card"]')!;
    expect(card.textContent).toContain('Prepare recipe');
    expect(card.textContent).toContain('Weekend flag');
    expect(card.textContent).toContain('Formula: weekday(claim_date) >= 6');
    act(() => { node('claims').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(d.querySelector('[data-testid="flow-card"]')!.textContent).toContain('claim_date (date)');
    act(() => (d.querySelector('[data-action="flow-card-close"]') as HTMLButtonElement).click());
    expect(d.querySelector('[data-testid="flow-card"]')).toBeNull();
    const pct = d.querySelector('.dd-pct')!.textContent;
    act(() => (d.querySelector('[data-action="flow-zoom-in"]') as HTMLButtonElement).click());
    expect(d.querySelector('.dd-pct')!.textContent).not.toBe(pct);
  });
});

describe('the pack\'s kit files', () => {
  it('the picked tool\'s kit first, in the order of work, the checklist last, then each outside tool\'s kit', () => {
    const files = ['kit/power-automate/README.md', 'kit/dataiku/test-checklist.md', 'kit/dataiku/flow.md', 'kit/dataiku/README.md', 'kit/dataiku/sample-data.csv',
      'kit/dataiku/flow-diagram.html', 'kit/dataiku/datasets.md', 'kit/dataiku/notes.md', 'plan.md'];
    expect(packFiles(files, true, kitSlug('Dataiku'))).toEqual(['design.md', 'approach.md', 'plan.md',
      'kit/dataiku/README.md', 'kit/dataiku/sample-data.csv', 'kit/dataiku/datasets.md', 'kit/dataiku/flow.md', 'kit/dataiku/flow-diagram.html', 'kit/dataiku/notes.md',
      'kit/dataiku/test-checklist.md', 'kit/power-automate/README.md']);
    expect(kitSlug('Copilot Studio')).toBe('copilot-studio');
  });
  it('the custom app\'s starter scaffold: listed after the agent instruction, read as text in the pack (never run from it)', async () => {
    const { opensInTab } = await import('./designPack');
    const files = ['kit/custom-app/test-checklist.md', 'kit/custom-app/app/style.css', 'kit/custom-app/app/app.js', 'kit/custom-app/app/index.html', 'kit/custom-app/BUILD-WITH-AGENT.md', 'kit/custom-app/README.md'];
    expect(packFiles(files, false, 'custom-app').slice(1)).toEqual(['kit/custom-app/README.md', 'kit/custom-app/BUILD-WITH-AGENT.md',
      'kit/custom-app/app/index.html', 'kit/custom-app/app/app.js', 'kit/custom-app/app/style.css', 'kit/custom-app/test-checklist.md']);
    expect(opensInTab('kit/custom-app/app/index.html')).toBe(false);
    expect(opensInTab('kit/dataiku/flow-diagram.html')).toBe(true);
    for (const f of ['app/index.html', 'app/app.js', 'app/style.css']) expect(fileNote(`kit/custom-app/${f}`).use, f).not.toBe('A file in the starter kit folder.');
  });
  it('every new file says what it is and how to use it; an outside tool\'s README says it is outside the build', () => {
    for (const f of ['sample-data.csv', 'test-checklist.md', 'prompts.md', 'instructions.md', 'skills.md', 'knowledge.md', 'data-model.md', 'screens.md', 'flows.md',
      'flow.md', 'datasets.md', 'rules.csv', 'flow-diagram.html', 'flow.json', 'BUILD-WITH-AGENT.md']) {
      expect(fileNote(`kit/x/${f}`).use, f).not.toBe('A file in the starter kit folder.');
    }
    expect(fileNote('kit/copilot-studio/instructions.md', 'copilot-studio')).toEqual({
      title: 'Starter kit: copilot studio · instructions.md', use: "The agent's instructions: paste them into the Instructions box in Copilot Studio and name the agent as it says.",
    });
    expect(fileNote('kit/power-automate/README.md', 'dataiku').title).toBe('Outside the build: power automate · README.md');
    expect(fileNote('kit/power-automate/README.md', 'dataiku').use).toMatch(/outside the main build/);
    expect(fileNote('kit/x/README.md').use).not.toMatch(/fill it in/);
  });
});
