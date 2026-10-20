import { describe, it, expect } from 'vitest';
import { chipText, extractNotice, applySuggestion, providerName } from './aiUi';

describe('chipText', () => {
  it('names the connected provider', () => {
    expect(chipText({ provider: 'claude', label: 'Claude Code' })).toBe('Claude Code ✓');
    expect(chipText({ provider: 'fake', label: 'Fake (test)' })).toBe('Fake (test) ✓');
  });
  it('says working by hand when none', () => {
    expect(chipText({ provider: null, label: 'No AI: working by hand' })).toBe('No AI: working by hand');
    expect(chipText(null)).toBe('No AI: working by hand');
  });
});

describe('extractNotice', () => {
  it('counts links and lists new stars', () => {
    expect(extractNotice({ added: 3, unconfirmed: 1, suggestions: { newNodes: [{ label: 'A' }, { label: 'B' }] } }))
      .toBe('Added 3 links, 1 to confirm. New stars to confirm: A, B.');
  });
  it('handles one link and none', () => {
    expect(extractNotice({ added: 1, unconfirmed: 0, suggestions: { newNodes: [] } })).toBe('Added 1 link, 0 to confirm.');
    expect(extractNotice({ added: 0, unconfirmed: 0 })).toMatch(/nothing new/);
  });
});

describe('applySuggestion', () => {
  const form = { criteria: { a: false, b: true }, decision: '', reason: 'old' };
  it('overlays criteria, decision and reason', () => {
    expect(applySuggestion(form, { criteria: { a: true, b: false }, decision: 'csic', reason: 'new' }))
      .toEqual({ criteria: { a: true, b: false }, decision: 'csic', reason: 'new' });
  });
  it('keeps the form when the suggestion is empty, and does not mutate', () => {
    const r = applySuggestion(form, { criteria: {}, decision: '', reason: ' ' });
    expect(r).toEqual(form);
    expect(r.criteria).not.toBe(form.criteria);
  });
});

describe('providerName', () => {
  it('maps ids', () => { expect(providerName('vscode')).toBe('Copilot (VS Code)'); expect(providerName(undefined)).toBe('the AI'); });
});
