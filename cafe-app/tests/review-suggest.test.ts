import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { appendAiLink } from '../src/graph/store';
import { reviewInput } from '../src/review/suggestInput';
import { reviewSuggestTask } from '../src/ai/tasks';

const base = sampleIdea({
  id: 'CAFE-2026-001', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', region: 'AMER', dedupe_key: 'a',
  challenge: 'Kwame Mensah answers the same questions every week.', support: ['Agent Design Guidance'], maturity: 'Idea',
  people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', role: 'lead' }] },
});
const other = sampleIdea({ id: 'CAFE-2026-002', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', dedupe_key: 'b', people: { submitter: 'Lucía Fernández', team: [] } });
const link = (from: string, to: string, label: string) => ({ from, to, rel: 'NEEDS' as const, description: '', source: 'ai:test', confidence: 0.9, status: 'confirmed' as const, newNodes: [{ id: to, type: 'Capability' as const, label }] });

describe('what the decision suggestion reads', () => {
  it('the form alone: the basis says so, and no person is named', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, base);
    const { input, basis } = await reviewInput(root, 'CAFE-2026-001');
    expect(basis).toBe('Based on the form');
    expect(JSON.stringify(input)).not.toMatch(/Kwame|Mensah/);
    expect(input.idea.challenge).toMatch(/^\[P\d+\] answers the same questions every week\.$/);
    expect(input.form).toMatchObject({ support: ['Agent Design Guidance'], maturity: 'Idea', function: 'GSS' });
  });

  it('after an email: the answers, the builder, the reply and the flags are read too, and the graph says what the idea needs and who else needs it', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, {
      ...base, flags: ['Answers mention a live SAP system'],
      people: { ...base.people, builder: 'Zainab Okafor' } as any,
      answers: [{ question: 'Who will build it?', answer: 'Zainab Okafor can build it in Copilot Studio.', source: 'inbox/reply.eml' }, { question: 'What data?', answer: 'Sample FAQ only.', source: 'inbox/reply.eml' }],
      checklist: { s2d: { done: true, by: 'app', at: '2026-10-22' } },
    } as any);
    await saveIdea(root, other);
    await appendAiLink(root, link('idea:CAFE-2026-001', 'capability:policy-q-a', 'Policy Q&A'));
    await appendAiLink(root, { ...link('idea:CAFE-2026-002', 'capability:policy-q-a', 'Policy Q&A'), newNodes: [] });
    const { input, basis } = await reviewInput(root, 'CAFE-2026-001');
    expect(basis).toBe('Based on the form, 2 email answers, a builder named, a reply received, 1 flag and 1 graph link');
    expect(input.answers).toEqual([
      { question: 'Who will build it?', answer: expect.stringMatching(/^\[P\d+\] can build it in Copilot Studio\.$/) },
      { question: 'What data?', answer: 'Sample FAQ only.' },
    ]);
    expect(input.progress).toEqual({ builderNamed: true, replyReceived: true, attendanceConfirmed: false });
    expect(input.flags).toEqual(['Answers mention a live SAP system']);
    expect(input.graph).toEqual([{ type: 'Capability', label: 'Policy Q&A', alsoNeededBy: 1 }]);
    expect(JSON.stringify(input)).not.toMatch(/Kwame|Mensah|Zainab|Okafor/);
    // The prompt carries all of it.
    expect(reviewSuggestTask.prompt(input)).toMatch(/Sample FAQ only/);
  });
  it('changes an email found that still wait for a Yes in the Import are named in the basis, not read', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, base);
    const { saveDrop, updateItem } = await import('../src/inbox/store');
    const item = await saveDrop(root, 'reply.eml', 'x');
    await updateItem(root, item.id, { actions: [
      { id: 'a1', action: { t: 'name_builder', ideaId: 'CAFE-2026-001', name: 'Person 9' }, kind: 'ok', status: 'pending', label: 'x' },
      { id: 'a2', action: { t: 'add_flag', ideaId: 'CAFE-2026-001', text: 'x' }, kind: 'ok', status: 'pending', label: 'x' },
      { id: 'a3', action: { t: 'add_flag', ideaId: 'CAFE-2026-002', text: 'x' }, kind: 'ok', status: 'pending', label: 'x' },
    ] } as any);
    const { basis, waiting, input } = await reviewInput(root, 'CAFE-2026-001');
    expect(waiting).toBe(2);
    expect(basis).toBe('Based on the form. 2 changes from the Import still wait for your Yes and are not read yet');
    expect(input.progress?.builderNamed).toBe(false);
  });
  it('one code list for the whole suggestion: a person has the same code in every text, and the reply decodes', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, { ...base, answers: [{ question: 'Who?', answer: 'Kwame Mensah will.', source: 'x' }] } as any);
    const { input, codes } = await reviewInput(root, 'CAFE-2026-001');
    const inChallenge = /\[(P\d+)\]/.exec(input.idea.challenge!)![1];
    expect(input.answers![0].answer).toBe(`[${inChallenge}] will.`);
    const { showNames } = await import('../src/command/names');
    expect(showNames(`[${inChallenge}] leads it.`, codes)).toBe('Kwame Mensah leads it.');
  });
});
