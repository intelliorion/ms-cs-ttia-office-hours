import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ReviewSelect, needStatus, reasonFor } from './ReviewSelect';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const state = { decisions: { select: 'Select for the design series (E3)', notnow: 'Not this round (E6)', ask: 'Ask first (E2)' } };
const builder = { id: 'n1', need: 'A builder who can attend', ask: 'Who in your team would build it?', met: false };
const data = { id: 'n2', need: 'What data it reads', ask: 'What data would it read?', met: false };
const prep = (needs: any[], decision = 'ask') => ({ at: '2026-10-22', decision, reason: 'No builder yet.', criteria: { builder: false }, needs, basis: 'Based on the form', provider: 'fake' });
const idea = (p?: any, extra: any = {}) => ({ id: 'CAFE-2026-001', stage: 2, ...(p ? { prep: p } : {}), ...extra });

let el: HTMLDivElement; let root: Root;
async function show(i: any, handlers: Partial<Record<'onSuggest' | 'onAnswer' | 'onDraftEmail' | 'onSave', any>> = {}) {
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
  await act(async () => root.render(<ReviewSelect idea={i} state={state} busy={false} aiBusy={false} noAi={false} noAiTip="" aiName="Claude Code"
    onSuggest={handlers.onSuggest ?? (() => {})} onAnswer={handlers.onAnswer ?? (async () => {})} onDraftEmail={handlers.onDraftEmail ?? (() => {})} onSave={handlers.onSave ?? (() => {})} />));
}
afterEach(() => { act(() => root.unmount()); el.remove(); });
const q = (s: string) => el.querySelector(s) as HTMLElement | null;

describe('Review and Select', () => {
  it('starts with only Suggest a decision: no checkboxes, no Save', async () => {
    const onSuggest = vi.fn();
    await show(idea(), { onSuggest });
    expect(el.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(q('[data-action="save-review"]')).toBeNull();
    await act(async () => q('[data-action="ai-suggest-review"]')!.click());
    expect(onSuggest).toHaveBeenCalled();
  });

  it('after a suggestion: the to-dos one by one, each with what is needed, the question and a box; Draft email and Re-evaluate; no Save while any is open', async () => {
    const onDraftEmail = vi.fn(); const onAnswer = vi.fn(async () => {});
    await show(idea(prep([builder, data])), { onDraftEmail, onAnswer });
    expect(q('[data-testid="rs-suggestion"]')?.textContent).toContain('Ask first (E2)');
    expect(q('[data-testid="rs-count"]')?.textContent).toBe('2 open');
    const items = [...el.querySelectorAll('.rs-need')];
    expect(items.map((x) => x.querySelector('.rs-need-t')?.textContent)).toEqual(['A builder who can attend', 'What data it reads']);
    expect(items[0].querySelector('.rs-ask')?.textContent).toBe('Ask: Who in your team would build it?');
    expect(items[0].querySelector('textarea')).toBeTruthy();
    expect(q('[data-action="save-review"]')).toBeNull();
    expect(el.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    await act(async () => q('[data-action="draft-questions"]')!.click());
    expect(onDraftEmail).toHaveBeenCalled();
    // Typing an answer saves it when the box is left.
    const box = items[0].querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Our analyst');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(onAnswer).toHaveBeenCalledWith('n1', 'Our analyst');
  });

  it('answered (pasted or emailed) but not re-evaluated: ◐, Re-evaluate leads, still no Save; Decide anyway opens the form', async () => {
    await show(idea(prep([{ ...builder, answer: 'Our analyst' }, data]), { answers: [{ question: '2. What data would it read?', answer: 'Sample only.' }] }));
    expect([...el.querySelectorAll('.rs-mark')].map((x) => x.textContent)).toEqual(['◐', '◐']);
    expect(q('[data-testid="rs-from-email"]')?.textContent).toBe('From email: Sample only.');
    expect(q('[data-testid="rs-count"]')?.textContent).toBe('2 to re-evaluate');
    expect(q('[data-action="reevaluate"]')?.className).toContain('primary');
    expect(q('[data-action="draft-questions"]')).toHaveProperty('disabled', true);
    expect(q('[data-action="save-review"]')).toBeNull();
    await act(async () => q('[data-action="decide-anyway"]')!.click());
    expect(q('[data-testid="rs-form"]')).toBeTruthy();
  });

  it('all clear: the suggested decision is picked but not saved, there is no reason box, and Save keeps the suggestion\'s reason', async () => {
    const onSave = vi.fn();
    await show(idea({ ...prep([{ ...builder, met: true, note: 'A builder is named' }], 'select'), reason: 'Builder named, sample data.' }), { onSave });
    expect(q('[data-testid="rs-count"]')?.textContent).toBe('all clear');
    expect(q('.rs-note')?.textContent).toBe('A builder is named');
    expect([...el.querySelectorAll('input[type="radio"]')].map((r) => (r as HTMLInputElement).value)).toEqual(['select', 'notnow']);
    expect((q('input[value="select"]') as HTMLInputElement).checked).toBe(true);
    expect(q('textarea.reason')).toBeNull();
    expect(q('[data-testid="rs-saved"]')?.textContent).toMatch(/^Not saved yet/);
    await act(async () => q('[data-action="save-review"]')!.click());
    expect(onSave).toHaveBeenCalledWith({ criteria: { builder: false }, decision: 'select', reason: 'Builder named, sample data.' });
  });

  it('a newer suggestion wins over a decision saved before; the saved one says Saved and cannot be saved twice', async () => {
    const onSave = vi.fn();
    const saved = { review: { decision: 'notnow', reason: 'Old reason', at: '2026-10-20', criteria: {} } };
    await show(idea({ ...prep([], 'select'), reason: 'Ready now.' }, saved), { onSave });
    expect((q('input[value="select"]') as HTMLInputElement).checked).toBe(true);
    expect(q('[data-testid="rs-saved"]')?.textContent).toMatch(/^Not saved yet/);
    // Picking something else is recorded as the operator's choice.
    await act(async () => (q('input[value="notnow"]') as HTMLInputElement).click());
    expect(q('[data-testid="rs-saved"]')?.textContent).toBe('Saved 20 Oct.');
    expect(q('[data-action="save-review"]')).toHaveProperty('disabled', true);
  });

  it('records a different pick as the operator\'s choice, quoting the suggestion', () => {
    const label = (k: string) => ({ select: 'Select', notnow: 'Not this round' } as any)[k];
    expect(reasonFor('select', { decision: 'select', reason: 'Ready.' }, null, label)).toBe('Ready.');
    expect(reasonFor('notnow', { decision: 'select', reason: 'Ready.' }, null, label)).toBe('Not this round, chosen by the operator (the suggestion was Select: Ready.)');
    expect(reasonFor('notnow', null, { decision: 'notnow', reason: 'Old' }, label)).toBe('Old');
  });

  it('labels each item open, answered or met', () => {
    expect(needStatus(builder)).toBe('open');
    expect(needStatus({ ...builder, answer: 'x' })).toBe('answered');
    expect(needStatus({ ...builder, met: true })).toBe('met');
  });
});
