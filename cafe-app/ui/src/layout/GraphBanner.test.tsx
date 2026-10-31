import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useStore } from '../state/store';
import { GraphBanner, graphFileProblems } from './GraphBanner';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('the graph banner: what the rules files could not take, and what the build refused', () => {
  const problems = [
    { line: 0, message: 'ontology.yaml could not be read (bad YAML): the built-in ontology applies until it is fixed' },
    { line: 0, message: 'inference.yaml: x: a chain needs two or more relations (dropped)' },
    { line: 0, message: 'operator.jsonl op-15: link person:a SUBMITTED idea:CAFE-2026-004: SUBMITTED comes only from the idea\'s record (its submitter and team), never from a link (refused by the build)' },
    { line: 0, message: 'operator.jsonl op-2: link capability:x USES_DATA system:y: capability:x is not in the graph' },
  ];
  it('sorts the problems: the files first, then the refusals; a stale edit is neither', () => {
    expect(graphFileProblems({ problems })).toEqual({ files: [problems[0].message, problems[1].message], refused: [problems[2].message], other: 1 });
    expect(graphFileProblems(null)).toEqual({ files: [], refused: [], other: 0 });
  });
  it('shows a banner for an ontology.yaml or inference.yaml problem (inference.yaml had none before), with the lines on Show', async () => {
    useStore.setState({ graph: { nodes: [], edges: [], problems } } as any);
    const el = document.createElement('div'); document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<GraphBanner />));
    expect(el.querySelector('[data-testid="graph-banner"]')?.textContent).toMatch(/The rules files have 2 problems/);
    await act(async () => (el.querySelector('[data-action="graph-problems"]') as HTMLButtonElement).click());
    expect([...el.querySelectorAll('.graph-banner li')].map((li) => li.textContent)).toEqual(problems.slice(0, 3).map((p) => p.message));
    useStore.setState({ graph: { nodes: [], edges: [], problems: [problems[3]] } } as any);
    await act(async () => root.render(<GraphBanner />));
    expect(el.querySelector('[data-testid="graph-banner"]')).toBeNull();
    root.unmount(); el.remove();
  });
});
