import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { StageChart, Beams, starRadius } from './Charts';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const STATE = {
  ideas: [
    { id: 'A', stage: 1, outcomes: [], support: ['Agent Design Guidance'], flags: [] },
    { id: 'B', stage: 3, outcomes: [], support: ['Agent Design Guidance', 'Collab'], flags: [] },
    { id: 'C', stage: 3, outcomes: [], support: [], flags: [], closed: { as: 'csic' } },
  ],
  outbox: [], stageNames: { 1: 'Submit Idea', 2: 'Review and Select', 3: 'Design series', 4: 'Launch and Learn' }, closures: { csic: 'Routed to CSIC' },
};

let el: HTMLDivElement; let root: Root;
beforeEach(() => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); useStore.setState({ state: STATE } as any); });

describe('charts in the universe style', () => {
  it('stage chart: one star per stage on one line, sized by count, zero as an empty ring', async () => {
    await act(async () => root.render(<StageChart />));
    const stars = el.querySelectorAll('[data-testid="stage-chart"] .stage-star');
    expect(stars.length).toBe(5);
    expect(el.querySelector('.orbit')).toBeTruthy();
    const design = el.querySelector('.stage-star[data-stage="Design series"]')!;
    expect(design.getAttribute('data-count')).toBe('1');
    expect(design.querySelector('.halo')).toBeTruthy();
    const review = el.querySelector('.stage-star[data-stage="Review and Select"]')!;
    expect(review.classList.contains('empty')).toBe(true);
    expect(review.querySelector('.halo')).toBeNull();
    expect(Number(design.querySelector('.core')!.getAttribute('r'))).toBeGreaterThan(Number(review.querySelector('.core')!.getAttribute('r')));
  });
  it('star radius grows with the square root and caps', () => {
    expect(starRadius(0)).toBe(6);
    expect(starRadius(1)).toBeCloseTo(15);
    expect(starRadius(4)).toBeCloseTo(20);
    expect(starRadius(100)).toBe(26);
  });
  it('beams: the biggest row is full width, the rest in proportion, at most six rows, empty says Nothing yet', async () => {
    await act(async () => root.render(<Beams rows={[['A', 4], ['B', 2], ['C', 1], ['D', 1], ['E', 1], ['F', 1], ['G', 1]]} colour="#7dd3cf" testId="t" />));
    const beams = el.querySelectorAll('[data-testid="t"] .beam') as NodeListOf<HTMLElement>;
    expect(beams.length).toBe(6);
    expect(beams[0].style.width).toBe('100%');
    expect(beams[1].style.width).toBe('50%');
    expect(el.querySelectorAll('[data-testid="t"] .beam-n')[0].textContent).toBe('4');
    await act(async () => root.render(<Beams rows={[]} colour="#7dd3cf" testId="t" />));
    expect(el.textContent).toContain('Nothing yet');
  });
});
