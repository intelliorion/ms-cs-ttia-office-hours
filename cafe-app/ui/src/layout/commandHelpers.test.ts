import { describe, it, expect } from 'vitest';
import { insertMention, mentionQuery, searchStars } from './commandHelpers';

const nodes = [
  { id: 'idea:CAFE-2026-001', type: 'Idea', label: 'Vendor contract summariser', attrs: { cafeId: 'CAFE-2026-001' } },
  { id: 'capability:contract-clause-finding', type: 'Capability', label: 'Contract clause finding' },
  { id: 'person:avery-chen', type: 'Person', label: 'Avery Chen' },
  { id: 'team:gss', type: 'Team', label: 'GSS' },
];

describe('@ mentions', () => {
  it('finds the "@query" before the caret; an email address is not a mention', () => {
    expect(mentionQuery('link @ven', 9)).toEqual({ start: 5, query: 'ven' });
    expect(mentionQuery('link @', 6)).toEqual({ start: 5, query: '' });
    expect(mentionQuery('mail a@b.com', 12)).toBeNull();
    expect(mentionQuery('no mention', 10)).toBeNull();
  });
  it('searches names and Café IDs: starts-with first, then by kind', () => {
    expect(searchStars(nodes, 'contract').map((h) => h.label)).toEqual(['Contract clause finding', 'Vendor contract summariser']);
    expect(searchStars(nodes, 'cafe-2026-001').map((h) => h.id)).toEqual(['idea:CAFE-2026-001']);
    expect(searchStars(nodes, 'chen').map((h) => h.label)).toEqual(['Avery Chen']);
    expect(searchStars(nodes, '').map((h) => h.type)).toEqual(['Idea', 'Team', 'Person', 'Capability']);
  });
  it('puts the full name in place of what was typed', () => {
    expect(insertMention('link @ven to GSS', 5, 9, 'Vendor contract summariser')).toEqual({ text: 'link @Vendor contract summariser to GSS', caret: 33 });
  });
});

import { chipSegments, slashMatches, suggestionsFor } from './commandHelpers';
describe('chat helpers', () => {
  it('@kind: narrows the search to one kind', () => {
    expect(searchStars(nodes, 'person:').map((h) => h.label)).toEqual(['Avery Chen']);
    expect(searchStars(nodes, 'idea:vendor').map((h) => h.type)).toEqual(['Idea']);
  });
  it('/ shortcuts match while the message is a bare /word', () => {
    expect(slashMatches('/').map((s) => s.cmd)).toEqual(['/new', '/grow', '/undo', '/import', '/rounds']);
    expect(slashMatches('/gr').map((s) => s.cmd)).toEqual(['/grow']);
    expect(slashMatches('/grow it')).toEqual([]);
  });
  it('cuts text into runs and star chips, longest names first, whole words only', () => {
    const stars = [{ id: 'team:gss', label: 'GSS' }, { id: 'idea:1', label: 'Vendor contract summariser' }, { id: 'c:1', label: 'Vendor' }];
    expect(chipSegments('Vendor contract summariser is a GSS idea, not GSSX.', stars)).toEqual([
      { id: 'idea:1', label: 'Vendor contract summariser' }, ' is a ', { id: 'team:gss', label: 'GSS' }, ' idea, not GSSX.',
    ]);
  });
  it('suggests from what is on screen', () => {
    expect(suggestionsFor({ focusType: 'Idea' })[0]).toBe('Who leads this?');
    expect(suggestionsFor({ waiting: 2 })[0]).toBe('What is waiting for me in the Import?');
  });
});

import { newPersonHit } from './commandHelpers';
describe('＋ New person', () => {
  it('is offered for a full name that matches no person; never for one word, a kind filter or someone already known', () => {
    expect(newPersonHit(nodes, 'Jane Roe')).toEqual({ id: 'new-person:Jane Roe', type: 'Person', label: 'Jane Roe' });
    expect(newPersonHit(nodes, 'Jane')).toBeNull();
    expect(newPersonHit(nodes, 'person:Jane Roe')).toBeNull();
    expect(newPersonHit(nodes, 'avery chen')).toBeNull();
  });
});

import { answerLight } from './commandHelpers';
describe('what an answer lights', () => {
  const base = { id: 'c1', at: '', text: 'q?', reply: 'r', actions: [], problems: [], kind: 'question' as const, highlight: ['team:gss'] };
  it('the stars of a finished answer with graph evidence', () => expect(answerLight(base)).toEqual(['team:gss']));
  it('nothing for no answer, no evidence, an error, or changes waiting for Do it', () => {
    expect(answerLight(null)).toBeNull();
    expect(answerLight({ ...base, highlight: [] })).toBeNull();
    expect(answerLight({ ...base, highlight: undefined })).toBeNull();
    expect(answerLight({ ...base, error: 'The AI could not finish that' })).toBeNull();
    expect(answerLight({ ...base, kind: 'command', actions: [{ id: 'a1', label: 'Merge', status: 'proposed' }] as any })).toBeNull();
    expect(answerLight({ ...base, kind: 'command', actions: [{ id: 'a1', label: 'Merge', status: 'done' }] as any })).toEqual(['team:gss']);
  });
});

import { sentSegments } from './commandHelpers';
describe('a message shows as it was sent', () => {
  const stars = [{ id: 'capability:policy-change-tracking', label: 'Policy change tracking' }, { id: 'idea:6', label: 'Travel helper' }];
  it('the operator\'s own words chip only the stars they picked with @, never a name a later change made a star', () => {
    expect(sentSegments('add a new capability Policy change tracking to @Travel helper', stars)).toEqual([
      'add a new capability Policy change tracking to @', { id: 'idea:6', label: 'Travel helper' },
    ]);
  });
  it('a name the reply quotes stays as quoted text, so no chip pads the quotes', () => {
    expect(chipSegments("You asked to add a new capability 'Policy change tracking' to Travel helper.", stars)).toEqual([
      "You asked to add a new capability 'Policy change tracking' to ", { id: 'idea:6', label: 'Travel helper' }, '.',
    ]);
    expect(chipSegments('Add "Policy change tracking" now', stars)).toEqual(['Add "Policy change tracking" now']);
  });
});
