import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { StepCarousel } from './DesignSection';
import { fileNote, packFiles } from '../popouts/designPack';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); });

describe('design questions in a row', () => {
  const steps = [{ n: 1, question: 'A?', answer: 'a' }, { n: 2, question: 'B?' }, { n: 3, question: 'C?', answer: 'c' }];
  it('opens on the question waiting for an answer; ‹ › and the dots move between them', () => {
    el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
    act(() => root.render(<StepCarousel steps={steps} render={(st) => <li data-q={st.n}>{st.question}</li>} />));
    const shown = () => el.querySelector('[data-q]')!.getAttribute('data-q');
    expect(shown()).toBe('2');
    expect(el.querySelector('[data-testid="design-pos"]')!.textContent).toBe('Question 2 of 3');
    act(() => (el.querySelector('[data-action="prev-question"]') as HTMLButtonElement).click());
    expect(shown()).toBe('1');
    expect((el.querySelector('[data-action="prev-question"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => (el.querySelectorAll('[data-action="go-question"]')[2] as HTMLButtonElement).click());
    expect(shown()).toBe('3');
    expect((el.querySelector('[data-action="next-step"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the design pack', () => {
  it('lists the files in reading order, each with what it is and how to use it', () => {
    expect(packFiles(['kit/power-apps/screens.md', 'plan.md', 'kit/power-apps/README.md'], true))
      .toEqual(['design.md', 'approach.md', 'plan.md', 'kit/power-apps/README.md', 'kit/power-apps/screens.md']);
    expect(packFiles([], false)).toEqual(['design.md']);
    expect(fileNote('approach.md').title).toBe('The tool and why');
    expect(fileNote('kit/power-apps/screens.md')).toEqual({ title: 'Starter kit: power apps · screens.md', use: 'The Power Apps screens to make, and what each shows.' });
  });
});
