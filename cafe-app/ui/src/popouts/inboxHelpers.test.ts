import { describe, it, expect } from 'vitest';
import {
  confidenceWord, groupActions, itemHeadline, canUndo, applyableIds, inboxCount, askCandidates, isAsking, dayOf,
  duplicateNotice, handProblems, needsHand, typeWord, type ActionRecord, type InboxItemView,
} from './inboxHelpers';

const rec = (id: string, t: string, status: ActionRecord['status'], extra: Partial<ActionRecord> = {}): ActionRecord =>
  ({ id, action: { t }, kind: 'safe', status, label: `${t} ${id}`, ...extra });

describe('confidenceWord', () => {
  it('says sure, likely or unsure', () => {
    expect(confidenceWord(0.95)).toBe('sure');
    expect(confidenceWord(0.85)).toBe('sure');
    expect(confidenceWord(0.8)).toBe('likely');
    expect(confidenceWord(0.7)).toBe('likely');
    expect(confidenceWord(0.69)).toBe('unsure');
    expect(confidenceWord(0)).toBe('unsure');
  });
  it('is unsure about anything that is not a number', () => {
    expect(confidenceWord(undefined)).toBe('unsure');
    expect(confidenceWord(null)).toBe('unsure');
    expect(confidenceWord(Number.NaN)).toBe('unsure');
  });
});

describe('groupActions', () => {
  const records = [
    rec('a1', 'file_email', 'applied', { inverse: { t: 'remove-file' } }),
    rec('a2', 'add_flag', 'pending', { kind: 'ok' }),
    rec('a3', 'graph_links', 'failed', { kind: 'ok', error: 'nope' }),
    rec('a4', 'record_answers', 'undone'),
    rec('a5', 'ask_idea', 'pending', { kind: 'ok' }),
    rec('a6', 'graph_links', 'applied'),
  ];
  it('puts applied, waiting (failed included) and undone in their own groups and leaves out Which idea?', () => {
    const g = groupActions(records);
    expect(g.applied.map((r) => r.id)).toEqual(['a1', 'a6']);
    expect(g.ok.map((r) => r.id)).toEqual(['a2', 'a3']);
    expect(g.undone.map((r) => r.id)).toEqual(['a4']);
  });
  it('copes with no actions', () => {
    expect(groupActions(undefined)).toEqual({ applied: [], ok: [], undone: [] });
  });
  it('offers Undo only when the action recorded its inverse', () => {
    expect(canUndo(records[0])).toBe(true);
    expect(canUndo(records[5])).toBe(false);
    expect(canUndo(records[3])).toBe(false);
  });
  it('Apply all sends the waiting ids only', () => {
    expect(applyableIds(records)).toEqual(['a2', 'a3']);
  });
});

const base: InboxItemView = { id: 'in-000000000001', file: 'inbox/x.eml', name: 'reply.eml', type: 'email', receivedAt: '2026-10-20', status: 'triaged' };

describe('itemHeadline', () => {
  it('uses the AI summary first, on one line, as plain text', () => {
    const h = itemHeadline({ ...base, meta: { subject: 'RE: hi' }, triage: { ideaId: null, confidence: 0.9, ask: false, candidates: [], notes: [], ai: { summary: 'Person 2\nanswers <b>two</b> questions' } } });
    expect(h).toBe('Person 2 answers <b>two</b> questions');
  });
  it('falls back to the subject, then the text, then the file name', () => {
    expect(itemHeadline({ ...base, meta: { subject: 'RE: CAFE-2026-001 questions' } })).toBe('RE: CAFE-2026-001 questions');
    expect(itemHeadline({ ...base, preview: 'Call with Person 2\nabout it' })).toBe('Call with Person 2 about it');
    expect(itemHeadline({ ...base })).toBe('reply.eml');
  });
  it('names exports and held files', () => {
    expect(itemHeadline({ ...base, type: 'export', name: 'export.csv', triage: { ideaId: null, confidence: 0, ask: false, candidates: [], notes: [], export: true } })).toBe('An export: export.csv');
    expect(itemHeadline({ ...base, status: 'held', name: 'tracker.csv' })).toBe('tracker.csv is held');
  });
  it('cuts a long summary', () => {
    const h = itemHeadline({ ...base, triage: { ideaId: null, confidence: 0, ask: false, candidates: [], notes: [], ai: { summary: 'x'.repeat(300) } } });
    expect(h.length).toBe(160);
    expect(h.endsWith('…')).toBe(true);
  });
});

describe('the rest of the inbox helpers', () => {
  it('counts new, waiting and held for the title bar', () => {
    expect(inboxCount({ new: 1, ok: 2, held: 3, applied: 9 })).toBe(6);
    expect(inboxCount(null)).toBe(0);
  });
  it('asks which idea with the ask action\'s candidates', () => {
    const item = { ...base, triage: { ideaId: null, confidence: 0.4, ask: true, candidates: [{ id: 'B', title: 'b' }], notes: [] },
      actions: [rec('a1', 'ask_idea', 'pending')] };
    item.actions[0].action.candidates = [{ id: 'A', title: 'a' }];
    expect(isAsking(item)).toBe(true);
    expect(askCandidates(item)).toEqual([{ id: 'A', title: 'a' }]);
    expect(askCandidates({ ...item, actions: [] })).toEqual([{ id: 'B', title: 'b' }]);
    expect(isAsking({ ...item, status: 'dismissed' })).toBe(false);
  });
  it('words dates, duplicates, types and hand-work problems', () => {
    expect(dayOf('2026-10-20T09:00:00Z')).toBe('20 Oct 2026');
    expect(dayOf('soon')).toBe('soon');
    expect(duplicateNotice(base)).toBe('Already dropped on 20 Oct 2026: reply.eml');
    expect(typeWord('transcript')).toBe('Transcript');
    expect(typeWord('weird')).toBe('File');
    const hand = { ...base, triage: { ideaId: null, confidence: 0, ask: true, candidates: [], notes: ['No AI is set up'], needsHand: true as const }, problems: ['No AI is set up', 'Attachment not read'] };
    expect(needsHand(hand)).toBe(true);
    expect(handProblems(hand)).toEqual(['No AI is set up', 'Attachment not read']);
    expect(needsHand({ ...hand, status: 'held' })).toBe(false);
    expect(needsHand(base)).toBe(false);
  });
});
