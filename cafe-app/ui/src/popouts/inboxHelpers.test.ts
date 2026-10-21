import { describe, it, expect } from 'vitest';
import {
  confidenceWord, groupActions, itemHeadline, canUndo, applyableIds, inboxCount, askCandidates, isAsking, dayOf,
  duplicateNotice, handProblems, needsHand, typeWord, filenameHeader, tooLargeNotice, MAX_DROP_BYTES, dropSummary, type ActionRecord, type InboxItemView,
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
    const h = itemHeadline({ ...base, meta: { subject: 'RE: hi' }, triage: { ideaId: null, confidence: 0.9, ask: false, candidates: [], notes: [], ai: { what: 'Person 2\nanswers <b>two</b> questions' } } });
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
    const h = itemHeadline({ ...base, triage: { ideaId: null, confidence: 0, ask: false, candidates: [], notes: [], ai: { what: 'x'.repeat(300) } } });
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

describe('filenameHeader (final review 1)', () => {
  it('encodes any name so it fits in a Latin-1 header, and the server can decode it back', () => {
    const name = 'RE Café – update ’24 ✓.eml';
    const h = filenameHeader(name);
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
    expect(() => new Headers({ 'x-filename': h })).not.toThrow();
    expect(decodeURIComponent(h)).toBe(name);
  });
});

describe('tooLargeNotice (final review 5)', () => {
  it('refuses a file over 20 MB before it is sent, in plain words', () => {
    expect(MAX_DROP_BYTES).toBe(20 * 1024 * 1024);
    expect(tooLargeNotice({ name: 'big.xlsx', size: MAX_DROP_BYTES + 1 })).toBe('big.xlsx is too large to drop (over 20 MB). Save a smaller copy and drop that.');
    expect(tooLargeNotice({ name: 'ok.eml', size: MAX_DROP_BYTES })).toBeNull();
  });
});

describe('dropSummary: one notice for a multi-file drop', () => {
  it('a single file keeps its own words', () => {
    expect(dropSummary([{ kind: 'added', name: 'a.eml' }])).toEqual({ text: 'a.eml is in the Inbox.', kind: 'ok' });
    expect(dropSummary([{ kind: 'duplicate', name: 'a.eml', text: 'Already dropped on 20 Oct 2026: a.eml' }])).toEqual({ text: 'Already dropped on 20 Oct 2026: a.eml. Nothing was done again.', kind: 'ok' });
    expect(dropSummary([{ kind: 'failed', name: 'a.eml', text: 'Boom' }])).toEqual({ text: 'Boom', kind: 'error' });
    expect(dropSummary([])).toBeNull();
  });
  it('several files: counts per outcome, names for anything not added', () => {
    expect(dropSummary([
      { kind: 'added', name: 'a.eml' }, { kind: 'added', name: 'b.vtt' },
      { kind: 'too-large', name: 'big.xlsx', text: 'x' },
    ])).toEqual({ text: '2 added, 1 too large: big.xlsx.', kind: 'error' });
    expect(dropSummary([
      { kind: 'added', name: 'a.eml' }, { kind: 'duplicate', name: 'b.eml', text: 'x' },
      { kind: 'failed', name: 'c.msg', text: 'Boom' }, { kind: 'failed', name: 'd.msg', text: 'Bang' },
    ])).toEqual({ text: '1 added, 1 already dropped: b.eml, 2 not added: c.msg (Boom), d.msg (Bang).', kind: 'error' });
    expect(dropSummary([{ kind: 'added', name: 'a' }, { kind: 'duplicate', name: 'b', text: 'x' }])).toEqual({ text: '1 added, 1 already dropped: b.', kind: 'ok' });
  });
});

import { shouldPoll, groupByDay, filterItems, resultLine, heldChoices } from './inboxHelpers';

describe('agentic inbox helpers', () => {
  const step = (id: string, status: string) => ({ id, status, at: '2026-10-21T10:00:00Z', detail: id });
  it('shouldPoll only while a step is running', () => {
    expect(shouldPoll({ items: [{ steps: [step('read', 'running')] }] } as any)).toBe(true);
    expect(shouldPoll({ items: [{ steps: [step('check', 'done')] }] } as any)).toBe(false);
    expect(shouldPoll(null)).toBe(false);
  });
  it('groupByDay labels today and yesterday, then dates, newest first', () => {
    const g = groupByDay([{ receivedAt: '2026-10-21T09:00:00Z' }, { receivedAt: '2026-10-20T09:00:00Z' }, { receivedAt: '2026-10-01T09:00:00Z' }] as any, new Date('2026-10-21T12:00:00Z'));
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday', '1 Oct 2026']);
  });
  it('filterItems by chip and by text over name and idea', () => {
    const items = [
      { name: 'reply.eml', status: 'applied', steps: [step('check', 'done')], triage: { ideaId: 'CAFE-2026-001' } },
      { name: 'people.csv', status: 'held', steps: [step('screen', 'needs-you')] },
      { name: 'reply2.eml', status: 'triaged', steps: [step('check', 'needs-you')], actions: [{ status: 'pending', held: { rule: 'low-confidence', why: 'x' } }] },
    ] as any;
    expect(filterItems(items, 'needs-you', '').map((i: any) => i.name)).toEqual(['reply2.eml']);
    expect(filterItems(items, 'held', '').map((i: any) => i.name)).toEqual(['people.csv']);
    expect(filterItems(items, 'all', '001').map((i: any) => i.name)).toEqual(['reply.eml']);
  });
  it('resultLine is the check detail, else the hold reason, else the last step detail', () => {
    expect(resultLine({ steps: [step('check', 'done')] } as any)).toBe('check');
    expect(resultLine({ status: 'held', hold: { reasons: ['Looks like a list of people'] }, steps: [] } as any)).toBe('Looks like a list of people');
  });
  it('heldChoices per rule', () => {
    expect(heldChoices({ rule: 'near-duplicate-star', why: 'x', existing: 'capability:slot-finding' }).map((c) => c.label)).toEqual(['Use the existing star', 'Keep both', 'No']);
    expect(heldChoices({ rule: 'contradicts-fact', why: 'x' }).map((c) => c.label)).toEqual(["Keep the form's value", "Take the file's value"]);
    expect(heldChoices({ rule: 'low-confidence', why: 'x' }).map((c) => c.label)).toEqual(['Yes', 'No']);
  });
});
