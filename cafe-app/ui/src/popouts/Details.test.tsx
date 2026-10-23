import { describe, it, expect, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { Details } from './IdeaSections';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let el: HTMLDivElement; let root: Root;
afterEach(() => { act(() => root.unmount()); el.remove(); });
const render = (node: React.ReactNode) => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); act(() => root.render(node)); };

const idea = {
  id: 'CAFE-2026-002', participation: 'Team', formWas: { participation: 'Individual' },
  people: { submitter: 'Person 1', team: [
    { name: 'Person 1', roles: ['lead', 'builder'], note: 'Lead', added: ['builder'] },
    { name: 'Person 2', roles: ['sponsor'], note: 'Sponsor' },
    { name: 'Person 3', roles: ['member'], added: ['member'], joined: true },
  ] },
  answers: [{ question: 'Is sample data enough?', answer: 'Yes, sample data is enough.', source: 'review answers' }],
  learned: { at: '2026-10-23', from: 1, points: [{ topic: 'Data', text: 'A made-up desk list and floor plan are enough to build it.' }] },
};

describe('the Submission: what the form said, and what came after', () => {
  it('marks everything added after the form in its own colour', () => {
    const removed: string[] = [];
    render(<Details idea={idea} onRemoveAnswer={(a) => removed.push(a.answer)} />);
    expect(el.querySelector('[data-testid="added-legend"]')?.textContent).toBe('In this colour: added after the form.');
    // A role given later, on someone from the form; a person not on the form.
    const p1 = el.querySelector('[data-person="Person 1"]')!;
    expect([...p1.querySelectorAll('em')].map((e) => [e.textContent, e.className])).toEqual([['Lead', ''], ['· Builder', 'added-role']]);
    expect(el.querySelector('[data-person="Person 2"]')!.className).toBe('tg person');
    expect(el.querySelector('[data-person="Person 3"]')!.className).toBe('tg person added');
    expect(el.querySelector('[data-builder="Person 1"]')!.className).toBe('tg person added');
    expect(el.querySelector('[data-testid="participation"]')?.textContent).toBe('Team (form: Individual)');
    expect(el.querySelector('[data-testid="participation"] .added-v')).not.toBeNull();
    // The AI's brief first; the answers as given are folded under it.
    expect([...el.querySelectorAll('[data-testid="learned-brief"] div')].map((d) => d.textContent)).toEqual(['DataA made-up desk list and floor plan are enough to build it.']);
    expect(el.querySelector('.learned-by')?.textContent).toBe('Summarised by the AI on 23 Oct from 1 answer.');
    expect(el.querySelector('details.learned-raw .learned-a')?.textContent).toBe('Yes, sample data is enough.');
    expect(el.querySelector('[data-testid="learned"] .learned-m')?.textContent).toContain('From your review');
    act(() => (el.querySelector('[data-action="remove-answer"]') as HTMLButtonElement).click());
    expect(removed).toEqual(['Yes, sample data is enough.']);
  });

  it('a form with nothing added has no legend and no learned list', () => {
    render(<Details idea={{ id: 'x', participation: 'Team', people: { team: [{ name: 'Person 1', roles: ['lead'] }] } }} />);
    expect(el.querySelector('[data-testid="added-legend"]')).toBeNull();
    expect(el.querySelector('[data-testid="learned"]')).toBeNull();
    expect(el.querySelector('[data-testid="participation"]')?.textContent).toBe('Team');
  });

  it('says the brief is out of date once an answer is removed, and asks for a re-evaluation when there is none', () => {
    render(<Details idea={{ ...idea, learned: { ...idea.learned, stale: true } }} />);
    expect(el.querySelector('.learned-stale')?.textContent).toContain('Re-evaluate to update it');
    act(() => root.render(<Details idea={{ ...idea, learned: undefined }} />));
    expect(el.querySelector('[data-testid="learned-brief"]')).toBeNull();
    expect(el.querySelector('[data-testid="learned"] .hint')?.textContent).toBe('Re-evaluate to have the AI sum up what the answers add.');
  });
});
