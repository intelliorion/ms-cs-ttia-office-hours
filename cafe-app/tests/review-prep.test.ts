import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { suggestPrep, answerNeed, draftNeedsEmail, markAsked, unmarkAsked, type RunReview } from '../src/review/prep';
import { isOpenNeed, emailAnswerFor, awaitsReevaluation } from '../src/review/needs';
import { openEmail, unopenEmail, listOutbox } from '../src/comms/outbox';
import { toEml, emlName } from '../src/comms/eml';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';
import { saveSettings } from '../src/round/store';
import type { ReviewSuggestInput, ReviewSuggestOutput } from '../src/ai/tasks';

const clock = fixedClock('2026-10-22');
const idea = sampleIdea({
  id: 'CAFE-2026-001', slug: 'faq', title: 'Procurement FAQ bot', dedupe_key: 'a', challenge: 'Person 1 answers the same questions.',
  people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }] },
});
const criteria = { feasible: true, builder: false, data: true, theme: true, reuse: true };
/** A fake AI that records what it was given and replies with each output in turn. */
function ai(...outs: Omit<ReviewSuggestOutput, 'criteria'>[]) {
  const seen: ReviewSuggestInput[] = [];
  const run: RunReview = async (input) => { seen.push(input); return { provider: 'fake', output: { criteria, ...outs[Math.min(seen.length - 1, outs.length - 1)] } }; };
  return { run, seen };
}
const builder = { need: 'A builder who can attend', ask: 'Who in your team would build it, and can they attend every session?' };
const data = { need: 'What data it reads', ask: 'What data would it read: sample or live?' };

describe('the Review and Select to-do list', () => {
  it('a suggestion saves its decision and to-dos on the idea; nothing is decided', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, idea);
    const { run, seen } = ai({ decision: 'ask', reason: 'No builder yet for [P1].', needs: [{ ...builder, met: false }, { ...data, met: false }] });
    const prep = await suggestPrep(root, 'CAFE-2026-001', run, clock);
    expect(prep).toMatchObject({ decision: 'ask', at: '2026-10-22', basis: 'Based on the form', provider: 'fake' });
    expect(prep.needs.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(prep.reason).toMatch(/^No builder yet for Person 1\.$/);
    expect(JSON.stringify(seen[0])).not.toMatch(/Person 1/);
    expect(seen[0].todo).toBeUndefined();
    const saved = await loadIdea(root, 'CAFE-2026-001');
    expect(saved.prep?.needs).toHaveLength(2);
    expect(saved.review).toBeUndefined();
  });

  it('a pasted answer is saved, read on Re-evaluate as an answer to that question, and the item keeps its id and answer when met', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, idea);
    const first = ai({ decision: 'ask', reason: 'x', needs: [{ ...builder, met: false }, { ...data, met: false }] });
    await suggestPrep(root, 'CAFE-2026-001', first.run, clock);
    const after = await answerNeed(root, 'CAFE-2026-001', 'n1', '  Our analyst will build it and can attend.  ');
    expect(after.needs[0].answer).toBe('Our analyst will build it and can attend.');
    expect(awaitsReevaluation(after.needs[0])).toBe(true);
    expect(isOpenNeed(after.needs[0])).toBe(false);
    expect(isOpenNeed(after.needs[1])).toBe(true);
    const again = ai({ decision: 'select', reason: 'Builder named.', needs: [{ ...builder, met: true, answer: 'A builder is named' }, { ...data, met: true, answer: 'Sample data' }] });
    const prep = await suggestPrep(root, 'CAFE-2026-001', again.run, clock);
    expect(again.seen[0].todo).toEqual([builder, data]);
    expect(again.seen[0].answers).toEqual([{ question: builder.ask, answer: 'Our analyst will build it and can attend.' }]);
    expect(prep.needs).toEqual([
      { id: 'n1', ...builder, met: true, note: 'A builder is named', answer: 'Our analyst will build it and can attend.' },
      { id: 'n2', ...data, met: true, note: 'Sample data' },
    ]);
    expect(prep.basis).toBe('Based on the form, with 1 answer you added');
    expect(prep.needs.some((n) => isOpenNeed(n))).toBe(false);
    // An empty answer clears it; an unknown item is refused.
    expect((await answerNeed(root, 'CAFE-2026-001', 'n1', '')).needs[0].answer).toBeUndefined();
    await expect(answerNeed(root, 'CAFE-2026-001', 'n9', 'x')).rejects.toThrow('That to-do is gone');
  });

  it('an emailed answer to the same question counts as answered for that item', () => {
    const need = { id: 'n1', ...builder, met: false };
    const answers = [{ question: '1. Who in your team would build it, and can they attend every session?', answer: 'Person 3, yes.' }];
    expect(emailAnswerFor(need, answers)?.answer).toBe('Person 3, yes.');
    expect(isOpenNeed(need, answers)).toBe(false);
    expect(emailAnswerFor({ ask: data.ask }, answers)).toBeUndefined();
  });

  it('Draft email puts every open question into one E2 (no example slots left), opens it in Outlook as sent, and Undo puts everything back', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { operatorName: 'Café operator' });
    await saveIdea(root, idea);
    await suggestPrep(root, 'CAFE-2026-001', ai({ decision: 'ask', reason: 'x', needs: [{ ...builder, met: false }, { ...data, met: false }] }).run, clock);
    await answerNeed(root, 'CAFE-2026-001', 'n2', 'Sample only');
    const rec = await draftNeedsEmail(root, 'CAFE-2026-001', clock);
    expect(rec.template).toBe('E2');
    expect(rec.body).toContain(`1. ${builder.ask}`);
    expect(rec.body).not.toContain(data.ask);
    expect(rec.body).not.toMatch(/\[QUESTION/);
    // Not asked until it really goes out.
    expect((await loadIdea(root, 'CAFE-2026-001')).prep?.needs[0].askedAt).toBeUndefined();

    const opened = await openEmail(root, rec.key, clock, steps);
    await markAsked(root, 'CAFE-2026-001', '2026-10-22');
    expect((await loadIdea(root, 'CAFE-2026-001')).prep?.needs.map((n) => n.askedAt)).toEqual(['2026-10-22', undefined]);
    expect(opened.email.status).toBe('sent');
    expect(opened.filename).toMatch(/^E2 - .+\.eml$/);
    expect(opened.eml).toMatch(/^X-Unsent: 1\r\nTo: Person 1\r\nSubject: /);
    const sent = await loadIdea(root, 'CAFE-2026-001');
    expect(sent.sent.E2).toBe('2026-10-22');
    expect(sent.due.s2d).toBe('2026-10-27');
    expect(sent.checklist.s2c?.done).toBe(true);

    await unopenEmail(root, rec.key, clock);
    await unmarkAsked(root, 'CAFE-2026-001', '2026-10-22');
    expect((await loadIdea(root, 'CAFE-2026-001')).prep?.needs[0].askedAt).toBeUndefined();
    const back = await loadIdea(root, 'CAFE-2026-001');
    expect(back.sent.E2).toBeUndefined();
    expect(back.due.s2d).toBeUndefined();
    expect(back.checklist.s2c).toBeUndefined();
    expect((await listOutbox(root)).find((m) => m.key === rec.key)?.status).toBe('draft');
    await expect(unopenEmail(root, rec.key, clock)).rejects.toThrow('Only an email just opened');
    // Nothing open: nothing to ask.
    await answerNeed(root, 'CAFE-2026-001', 'n1', 'Our analyst');
    await expect(draftNeedsEmail(root, 'CAFE-2026-001', clock)).rejects.toThrow('Nothing is open to ask');
  });
});

describe('the Outlook draft file', () => {
  it('is an unsent plain-text email, with any character, that Outlook opens as a new message', () => {
    const eml = toEml({ to: 'Lucía Pérez', subject: 'Café: a few questions', body: 'Hi Lucía,\nThanks.' });
    expect(eml.startsWith('X-Unsent: 1\r\n')).toBe(true);
    expect(eml).toContain('To: =?UTF-8?B?');
    expect(eml).toContain('Content-Type: text/plain; charset=UTF-8');
    const b64 = eml.split('\r\n\r\n')[1].replace(/\r\n/g, '');
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe('Hi Lucía,\r\nThanks.');
    expect(toEml({ to: 'a@b.com; Person 1', subject: 'x\ny', body: '' })).toContain('To: a@b.com, Person 1\r\nSubject: x y\r\n');
    expect(emlName('E3', 'CAFE-2026-001: you\'re in!')).toBe('E3 - CAFE-2026-001 you re in.eml');
  });
});

describe('one unsent email per stage', () => {
  it('a newer email of the same stage replaces the waiting one; another stage, a sent one or the same email are left alone', async () => {
    const { draftEmail } = await import('../src/comms/outbox');
    const { readHistory } = await import('../src/workspace/files');
    const { ideaDir } = await import('../src/ideas/store');
    const root = await tmpWorkspace();
    await saveSettings(root, { operatorName: 'Café operator' });
    await saveIdea(root, idea);
    const e3 = await draftEmail(root, { template: 'E3', ideaId: 'CAFE-2026-001' }, clock);
    expect((await draftEmail(root, { template: 'E3', ideaId: 'CAFE-2026-001' }, clock)).key).toBe(e3.key);
    const e7 = await draftEmail(root, { template: 'E7', ideaId: 'CAFE-2026-001' }, clock);
    // Changed the decision: E6 replaces E3 (both Review and Select); E7 (Design series) stays.
    await draftEmail(root, { template: 'E6', ideaId: 'CAFE-2026-001' }, clock);
    const mine = (await listOutbox(root)).filter((m) => m.idea === 'CAFE-2026-001').map((m) => m.template).sort();
    expect(mine).toEqual(['E6', 'E7']);
    expect((await readHistory(await ideaDir(root, 'CAFE-2026-001'))).some((h: any) => h.action === 'replaced' && h.detail === 'E3 replaced by E6')).toBe(true);
    // A sent email is never thrown away.
    const e2 = await draftEmail(root, { template: 'E2', ideaId: 'CAFE-2026-001' }, clock);
    expect((await listOutbox(root)).map((m) => m.template)).not.toContain('E6');
    await openEmail(root, e2.key, clock, steps);
    await draftEmail(root, { template: 'E1', ideaId: 'CAFE-2026-001' }, clock);
    expect((await listOutbox(root)).find((m) => m.key === e2.key)?.status).toBe('sent');
    void e7;
  });

  it('a round email goes to the round asked for; an unknown round is refused', async () => {
    const { draftEmail } = await import('../src/comms/outbox');
    const { createRound } = await import('../src/round/store');
    const root = await tmpWorkspace();
    const r1 = await createRound(root, 'First', clock);
    await createRound(root, 'Second', clock);
    const rec = await draftEmail(root, { template: 'E0', round: r1.id }, clock);
    expect(rec.round).toBe(r1.id);
    expect(rec.key).toContain(`rounds/${r1.id}/emails/`);
    await expect(draftEmail(root, { template: 'E0', round: '../x' }, clock)).rejects.toThrow('No round ../x');
  });
});

describe('older unsent emails from before one-per-stage', () => {
  it('only the newest unsent email of a stage counts; older ones are marked superseded, sent ones never', async () => {
    const { listOutbox } = await import('../src/comms/outbox');
    const { writeFileAtomic } = await import('../src/workspace/files');
    const { ideaDir } = await import('../src/ideas/store');
    const path = await import('node:path');
    const root = await tmpWorkspace();
    await saveIdea(root, idea);
    const dir = path.join(await ideaDir(root, 'CAFE-2026-001'), 'emails');
    const rec = (n: string, t: string, status: string, created: string) => writeFileAtomic(path.join(dir, `${n}-${t}.md`),
      `---\ntemplate: ${t}\nidea: CAFE-2026-001\nround: ""\nstatus: ${status}\ncreated: ${created}\nto: x\nsubject: s\n---\nbody\n`);
    await rec('001', 'E1', 'sent', '2026-10-01'); await rec('002', 'E3', 'draft', '2026-10-02'); await rec('003', 'E6', 'draft', '2026-10-03'); await rec('004', 'E7', 'draft', '2026-10-03');
    const items = await listOutbox(root);
    const by = (t: string) => items.find((m) => m.template === t)!;
    expect([by('E1').superseded, by('E3').superseded, by('E6').superseded, by('E7').superseded]).toEqual([undefined, true, undefined, undefined]);
    expect([by('E3').stage, by('E7').stage]).toEqual([2, 3]);
  });
});
