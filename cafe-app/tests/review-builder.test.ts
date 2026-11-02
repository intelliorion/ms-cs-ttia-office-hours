import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { suggestPrep, answerNeed, NO_REASON, type RunReview } from '../src/review/prep';
import { removeAnswer, takenBackLine, REVIEW_SOURCE } from '../src/review/updates';
import { readBuilderAnswer, resolvePerson } from '../src/review/builderAnswer';
import { isOpenNeed, awaitsReevaluation } from '../src/review/needs';
import { rebuildGraph, readAiLinks } from '../src/graph/store';
import { readHistory } from '../src/workspace/files';
import { onTouched } from '../src/memory/touch';
import { chunkIdea } from '../src/memory/chunks';
import { readIdeaForAgent } from '../src/command/readIdea';
import { fixedClock } from '../src/clock';
import { alignBrief } from '../src/review/learnedRoles';
import type { ReviewSuggestInput, ReviewSuggestOutput, ReviewUpdates } from '../src/ai/tasks';

const clock = fixedClock('2026-11-01');
const ID = 'CAFE-2026-001';
const NONE: ReviewUpdates = { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } };
const BOTH = { need: 'A builder who can attend every session', ask: 'Who in your team would build the proof of concept, and can they attend every session?' };
const WHO = { need: 'Who builds it', ask: 'Who in your team would build it?' };
const ATTEND = { need: 'Can they attend', ask: 'Can they attend every design session?' };
const KNOWN = ['Lucia Fern', 'Alex Wang', 'Priya Shah', 'Alex Chen'];

function team(extra: { name: string; roles: any[] }[] = []) {
  return { submitter: 'Lucia Fern', team: [{ name: 'Lucia Fern', roles: ['lead'] as any[] }, { name: 'Alex Wang', roles: ['member'] as any[] }, { name: 'Priya Shah', roles: ['member'] as any[] }, ...extra] };
}
/**
 * An AI that understands nothing of the answers (no builder, every item left open, no reason), like the replies the
 * operator saw; `over` changes what it says.
 */
function dumbAi(needs: { need: string; ask: string }[], over: Partial<ReviewSuggestOutput> = {}) {
  const seen: ReviewSuggestInput[] = [];
  const run: RunReview = async (input) => {
    seen.push(input);
    return { provider: 'fake', output: { criteria: {}, decision: 'ask', reason: 'r', needs: needs.map((n) => ({ ...n, met: false })), updates: NONE, learned: [], ...over } as ReviewSuggestOutput };
  };
  return { run, seen };
}
async function withNeeds(needs: { need: string; ask: string }[], people = team()) {
  const root = await tmpWorkspace();
  await saveIdea(root, sampleIdea({ id: ID, slug: 'x', title: 'Procurement FAQ bot', dedupe_key: 'a', sent: { E2: '2026-10-30' }, people }));
  await suggestPrep(root, ID, dumbAi(needs).run, clock);
  return root;
}
const builders = async (root: string) => (await loadIdea(root, ID)).people.team.filter((p) => p.roles.includes('builder')).map((p) => p.name);

describe('reading a builder or attendance answer by code', () => {
  it('reads names, lists of names and yes or no; leaves a sentence to the AI', () => {
    const r = (a: string, ask = BOTH.ask) => readBuilderAnswer(a, ask, KNOWN);
    expect(r('Alex Wang')).toMatchObject({ simple: true, builders: ['Alex Wang'] });
    expect(r('Alex Wang').canAttend).toBeUndefined();
    expect(r('Alex Wang, Priya Shah')).toMatchObject({ simple: true, builders: ['Alex Wang', 'Priya Shah'] });
    expect(r('Alex Wang and Priya Shah - yes both can attend')).toMatchObject({ simple: true, builders: ['Alex Wang', 'Priya Shah'], canAttend: true });
    expect(r('Alex Wang - yes he can attend')).toMatchObject({ simple: true, builders: ['Alex Wang'], canAttend: true });
    expect(r('yes')).toMatchObject({ simple: true, builders: [], canAttend: true });
    expect(r('Priya Shah, no she cannot attend every session')).toMatchObject({ builders: ['Priya Shah'], canAttend: false });
    expect(r('priya shah')).toMatchObject({ simple: true, builders: ['Priya Shah'] });
    expect(r('Jordan Lee')).toMatchObject({ simple: true, builders: ['Jordan Lee'], newPeople: ['Jordan Lee'] });
    expect(r('Our analyst will build it once the data is in, after the first workshop with the vendor team').simple).toBe(false);
    expect(r('our analyst').simple).toBe(false);
  });

  it('a first name that fits one person is that person; one that fits two, or nobody, says why', () => {
    expect(resolvePerson('Priya', KNOWN)).toEqual({ name: 'Priya Shah' });
    expect(resolvePerson('Alex', KNOWN).problem).toBe('Give the builder\'s full name: "Alex" could be Alex Chen or Alex Wang.');
    expect(resolvePerson('Sam', KNOWN).problem).toBe('Give the builder\'s full name: no one called "Sam" is known to the Café yet, and one name alone is not enough to add them.');
    expect(readBuilderAnswer('Alex', BOTH.ask, KNOWN).problem).toMatch(/could be Alex Chen or Alex Wang/);
  });
});

describe('answering the builder question at review', () => {
  it('a bare name is the builder at once, even when the AI did not understand it, and the item says what is still missing', async () => {
    const root = await withNeeds([BOTH]);
    const saved = await answerNeed(root, ID, 'n1', 'Alex Wang', clock);
    // Read as it is saved, before any AI: the page shows this under the answer.
    expect(saved.needs[0].check).toEqual({ ok: true, text: 'Read as: builder Alex Wang. Not said yet: can they attend every session? Add "yes" or "no".' });
    await suggestPrep(root, ID, dumbAi([BOTH]).run, clock);
    expect(await builders(root)).toEqual(['Alex Wang']);
    const n = (await loadIdea(root, ID)).prep!.needs[0];
    expect(n.met).toBe(false);
    expect(n.why).toMatch(/Not said yet: can they attend every session/);
    // Read and found short: open again with its reason, not waiting for another Re-evaluate.
    expect(awaitsReevaluation(n)).toBe(false);
    expect(isOpenNeed(n)).toBe(true);
  });

  it('a name with "yes" settles the item, ticks attendance, and the AI is told the builder is named', async () => {
    const root = await withNeeds([BOTH]);
    await answerNeed(root, ID, 'n1', 'Alex Wang - yes he can attend', clock);
    const ai = dumbAi([BOTH]);
    await suggestPrep(root, ID, ai.run, clock);
    const idea = await loadIdea(root, ID);
    expect(await builders(root)).toEqual(['Alex Wang']);
    expect(idea.checklist.s2e?.done).toBe(true);
    expect(idea.prep!.needs[0]).toMatchObject({ met: true, note: 'Builder Alex Wang; can attend every session.' });
    expect(ai.seen[0].progress?.builderNamed).toBe(true);
    expect(JSON.stringify(ai.seen)).not.toMatch(/Alex|Wang/);
  });

  it('several names are several builders, not one person called "Alex Wang, Priya Shah"', async () => {
    const root = await withNeeds([WHO]);
    await answerNeed(root, ID, 'n1', 'Alex Wang, Priya Shah', clock);
    await suggestPrep(root, ID, dumbAi([WHO]).run, clock);
    expect(await builders(root)).toEqual(['Alex Wang', 'Priya Shah']);
    const idea = await loadIdea(root, ID);
    expect(idea.updates!.map((u) => u.label)).toEqual(['Make Alex Wang and Priya Shah the builders']);
    expect(idea.prep!.needs[0]).toMatchObject({ met: true });
  });

  it('a first name that fits one person resolves; an ambiguous one is refused with the reason, at once and after Re-evaluate', async () => {
    const root = await withNeeds([WHO], team([{ name: 'Alex Chen', roles: ['member'] }]));
    const saved = await answerNeed(root, ID, 'n1', 'Alex', clock);
    expect(saved.needs[0].check).toEqual({ ok: false, text: 'Give the builder\'s full name: "Alex" could be Alex Chen or Alex Wang.' });
    await suggestPrep(root, ID, dumbAi([WHO]).run, clock);
    expect(await builders(root)).toEqual([]);
    expect((await loadIdea(root, ID)).prep!.needs[0].why).toBe('Give the builder\'s full name: "Alex" could be Alex Chen or Alex Wang.');
    await answerNeed(root, ID, 'n1', 'Priya', clock);
    await suggestPrep(root, ID, dumbAi([WHO]).run, clock);
    expect(await builders(root)).toEqual(['Priya Shah']);
  });

  it('"yes" to the attendance question ticks it for the builder the idea has; with no builder it says to name one', async () => {
    const root = await withNeeds([ATTEND], team([{ name: 'Sam Ode', roles: ['builder'] }]));
    await answerNeed(root, ID, 'n1', 'yes', clock);
    await suggestPrep(root, ID, dumbAi([ATTEND]).run, clock);
    const idea = await loadIdea(root, ID);
    expect(idea.checklist.s2e?.done).toBe(true);
    expect(idea.prep!.needs[0].met).toBe(true);
    expect(idea.updates!.at(-1)!.label).toBe('Tick "Builder named, can attend every session" (the answer says Sam Ode can attend)');
    const none = await withNeeds([ATTEND]);
    expect((await answerNeed(none, ID, 'n1', 'yes', clock)).needs[0].check?.text).toBe('"Yes" noted, but no builder is named yet: answer who builds it first.');
  });

  it('the AI writing a first name alone is resolved too; a name it writes that cannot be used is said on the item', async () => {
    const root = await withNeeds([BOTH], team([{ name: 'Alex Chen', roles: ['member'] }]));
    await answerNeed(root, ID, 'n1', 'I think Priya from the procurement team would be best placed to build it with help', clock);
    await suggestPrep(root, ID, dumbAi([BOTH], { updates: { ...NONE, builder: 'Priya' } }).run, clock);
    expect(await builders(root)).toEqual(['Priya Shah']);
    await answerNeed(root, ID, 'n1', 'Alex from the procurement team will build it, as discussed with the sponsor last week', clock);
    await suggestPrep(root, ID, dumbAi([BOTH], { updates: { ...NONE, builder: 'Alex' } }).run, clock);
    expect((await loadIdea(root, ID)).prep!.needs[0].why).toBe('Give the builder\'s full name: "Alex" could be Alex Chen or Alex Wang.');
  });

  it('an answer the AI leaves open says why: its reason, or that it gave none', async () => {
    const root = await withNeeds([{ need: 'Data', ask: 'What data would it read?' }]);
    await answerNeed(root, ID, 'n1', 'Some files', clock);
    await suggestPrep(root, ID, dumbAi([{ need: 'Data', ask: 'What data would it read?' }]).run, clock);
    expect((await loadIdea(root, ID)).prep!.needs[0]).toMatchObject({ met: false, why: NO_REASON, checked: 'Some files' });
    await answerNeed(root, ID, 'n1', 'Some files from the shared drive', clock);
    expect(awaitsReevaluation((await loadIdea(root, ID)).prep!.needs[0])).toBe(true);
    await suggestPrep(root, ID, dumbAi([{ need: 'Data', ask: 'What data would it read?' }], {
      needs: [{ need: 'Data', ask: 'What data would it read?', met: false, why: 'It does not say which files or what columns they have' }],
    }).run, clock);
    expect((await loadIdea(root, ID)).prep!.needs[0].why).toBe('It does not say which files or what columns they have');
  });
});

describe('taking an answer back', () => {
  /** A review answer that named the builder and led to a link in the universe. */
  async function answered() {
    const root = await withNeeds([BOTH]);
    await answerNeed(root, ID, 'n1', 'Alex Wang - yes he can attend', clock);
    await suggestPrep(root, ID, dumbAi([BOTH], {
      updates: { ...NONE, graph: { nodes: [{ type: 'System', label: 'Policy library' }, { type: 'Capability', label: 'Policy lookup' }],
        links: [{ from: 'Policy lookup', to: 'Policy library', rel: 'USES_DATA', description: 'Reads the pages', confidence: 0.9 }, { from: 'idea', to: 'Policy lookup', rel: 'NEEDS', description: 'Looks up', confidence: 0.9 }] } },
      learned: [{ topic: 'Builder', text: 'One builder, attends every session.' }],
    }).run, clock);
    return root;
  }
  const links = async (root: string) => (await readAiLinks(root)).links.filter((l) => l.source.endsWith(':review-answers'));

  it('replacing a review answer undoes what the old one did: the builder role, the tick, the links; logged; then the new one is read', async () => {
    const root = await answered();
    expect(await builders(root)).toEqual(['Alex Wang']);
    expect(await links(root)).toHaveLength(2);
    const out = await answerNeed(root, ID, 'n1', 'Priya Shah, yes', clock);
    expect(out.undone).toBe('Alex Wang as builder, the "can attend" tick, 2 links');
    const idea = await loadIdea(root, ID);
    expect(await builders(root)).toEqual([]);
    expect(idea.checklist.s2e?.done).toBeFalsy();
    expect(await links(root)).toHaveLength(0);
    expect((await rebuildGraph(root)).edges.some((e) => e.to === 'system:policy-library')).toBe(false);
    expect(idea.learned?.stale).toBe(true);
    // The new answer is checked at once and waits for Re-evaluate.
    expect(idea.prep!.needs[0]).toMatchObject({ answer: 'Priya Shah, yes', check: { ok: true, text: 'Read as: builder Priya Shah; can attend every session.' } });
    expect(awaitsReevaluation(idea.prep!.needs[0])).toBe(true);
    const log = (await readHistory(await ideaDir(root, ID))).map((h: any) => `${h.action}: ${h.detail ?? h.step}`);
    expect(log).toContain('answers-undone: Undone, as its answer was replaced: Make Alex Wang the builder, and tick "Builder named, can attend every session"');
    expect(log).toContain('answer-replaced: Review answer replaced (A builder who can attend every session): Alex Wang - yes he can attend → Priya Shah, yes');
    await suggestPrep(root, ID, dumbAi([BOTH]).run, clock);
    expect(await builders(root)).toEqual(['Priya Shah']);
  });

  it('clearing a review answer takes back the same, and someone it added to the team leaves it', async () => {
    const root = await withNeeds([WHO]);
    await answerNeed(root, ID, 'n1', 'Jordan Lee', clock);
    await suggestPrep(root, ID, dumbAi([WHO]).run, clock);
    expect((await loadIdea(root, ID)).people.team.map((p) => p.name)).toContain('Jordan Lee');
    const out = await answerNeed(root, ID, 'n1', '', clock);
    expect(out.undone).toBe('Jordan Lee as builder');
    expect((await loadIdea(root, ID)).people.team.map((p) => p.name)).toEqual(['Lucia Fern', 'Alex Wang', 'Priya Shah']);
  });

  it('a builder the form named is never taken off by taking back an answer that named them again', async () => {
    const root = await withNeeds([BOTH], { submitter: 'Lucia Fern', team: [{ name: 'Lucia Fern', roles: ['lead'] }, { name: 'Alex Wang', roles: ['builder'] }] });
    await answerNeed(root, ID, 'n1', 'Alex Wang - yes', clock);
    await suggestPrep(root, ID, dumbAi([BOTH]).run, clock);
    expect((await loadIdea(root, ID)).checklist.s2e?.done).toBe(true);
    await answerNeed(root, ID, 'n1', '', clock);
    expect(await builders(root)).toEqual(['Alex Wang']);
    expect((await loadIdea(root, ID)).checklist.s2e?.done).toBeFalsy();
  });

  it('removing a saved answer from the Details takes back what came from it, and Deep read and the assistant see it gone', async () => {
    const root = await withNeeds([BOTH]);
    await saveIdea(root, { ...(await loadIdea(root, ID)), answers: [{ question: BOTH.ask, answer: 'Alex Wang will build it and can attend every session.', source: 'inbox/reply.eml' }, { question: 'Volume?', answer: 'About 30 a week.', source: 'inbox/reply.eml' }] } as any);
    await suggestPrep(root, ID, dumbAi([BOTH], { updates: { ...NONE, builder: 'Alex Wang', builderCanAttend: true }, learned: [{ topic: 'Builder', text: 'Named, attends.' }] }).run, clock);
    expect(await builders(root)).toEqual(['Alex Wang']);
    const touched: string[] = [];
    const off = onTouched((t) => { if (t.root === root) touched.push(...t.ideas); });
    try {
      const out = await removeAnswer(root, ID, BOTH.ask, 'Alex Wang will build it and can attend every session.', clock);
      expect(out).toMatchObject({ removed: true, undone: 'Alex Wang as builder, the "can attend" tick', learned: 'out of date' });
      expect(takenBackLine('removed', out)).toBe('Answer removed. Undone: Alex Wang as builder, the "can attend" tick; the learned brief is out of date: Re-evaluate to rebuild it.');
    } finally { off(); }
    expect(touched).toContain(ID);
    const idea = await loadIdea(root, ID) as any;
    expect(await builders(root)).toEqual([]);
    expect(idea.answers.map((a: any) => a.answer)).toEqual(['About 30 a week.']);
    const chunks = await chunkIdea(root, idea, await ideaDir(root, ID));
    // Only the history still says it was removed.
    expect(chunks.filter((c) => c.section !== 'history').some((c) => c.text.includes('Alex Wang will build it'))).toBe(false);
    const read = await readIdeaForAgent(root, idea, (s) => String(s ?? ''));
    expect(JSON.stringify(read)).not.toMatch(/will build it/);
    expect((read.people as any).team.every((p: any) => !p.roles.includes('builder'))).toBe(true);
  });

  it('replacing a saved answer keeps its question and source, and is logged', async () => {
    const root = await withNeeds([]);
    await saveIdea(root, { ...(await loadIdea(root, ID)), answers: [{ question: 'Volume?', answer: 'About 30 a week.', source: REVIEW_SOURCE }] } as any);
    const out = await removeAnswer(root, ID, 'Volume?', 'About 30 a week.', clock, 'About 50 a week.');
    expect(takenBackLine('replaced', out)).toBe('Answer replaced. Nothing else came from it.');
    expect(((await loadIdea(root, ID)) as any).answers).toEqual([{ question: 'Volume?', answer: 'About 50 a week.', source: REVIEW_SOURCE }]);
    const log = (await readHistory(await ideaDir(root, ID))).map((h: any) => h.detail);
    expect(log).toContain('Answer replaced: About 30 a week. → About 50 a week.');
    await expect(removeAnswer(root, ID, 'Volume?', 'About 50 a week.', clock, 'About 50 a week.')).rejects.toThrow(/change it before saving/);
  });
});

describe('the learned brief follows the builder after an answer is replaced', () => {
  const OLD_BRIEF = [{ topic: 'Builder', text: 'Alex Wang builds it and can attend every design session.' }, { topic: 'Volume', text: 'About 30 requests a week.' }];
  /** Alex Wang named as builder at review, with a brief that says so; then the answer is replaced with Priya Shah. */
  async function replaced(next = 'Priya Shah - yes she can attend') {
    const root = await withNeeds([BOTH]);
    await answerNeed(root, ID, 'n1', 'Alex Wang - yes he can attend', clock);
    await suggestPrep(root, ID, dumbAi([BOTH], { learned: OLD_BRIEF }).run, clock);
    expect((await loadIdea(root, ID)).learned!.points[0].text).toMatch(/Alex Wang/);
    await answerNeed(root, ID, 'n1', next, clock);
    return root;
  }
  const brief = async (root: string) => (await loadIdea(root, ID)).learned?.points ?? [];

  it('Re-evaluate with an AI that writes no brief: the kept brief names the new builder, not the old', async () => {
    const root = await replaced();
    await suggestPrep(root, ID, dumbAi([BOTH]).run, clock);
    expect(await builders(root)).toEqual(['Priya Shah']);
    const points = await brief(root);
    expect(JSON.stringify(points)).not.toMatch(/Alex Wang/);
    expect(points).toContainEqual({ topic: 'Builder', text: 'Priya Shah builds it and can attend every design session.' });
    expect(points).toContainEqual({ topic: 'Volume', text: 'About 30 requests a week.' });
  });

  it('Re-evaluate with an AI that writes the old builder again: the code corrects it from the roles', async () => {
    const root = await replaced();
    const ai = dumbAi([BOTH], { learned: [{ topic: 'Builder', text: '[P1] builds it and attends every session.' }, { topic: 'Team', text: 'Lucia Fern leads the team. Alex Wang will build the first version.' }] });
    // The AI writes the code it was given for Alex Wang: a real AI copying an older answer.
    const run: RunReview = async (input) => {
      const out = await ai.run(input);
      return { ...out, output: { ...out.output, learned: out.output.learned!.map((p) => ({ ...p, text: p.text.replace('[P1]', 'Alex Wang') })) } };
    };
    await suggestPrep(root, ID, run, clock);
    const points = await brief(root);
    expect(JSON.stringify(points)).not.toMatch(/Alex Wang/);
    expect(points[0]).toEqual({ topic: 'Builder', text: 'Priya Shah builds it and can attend every design session.' });
    expect(points[1]).toEqual({ topic: 'Team', text: 'Lucia Fern leads the team.' });
    const log = (await readHistory(await ideaDir(root, ID))).map((h: any) => `${h.action}: ${h.detail}`);
    expect(log.some((l) => l.startsWith('learned-aligned: '))).toBe(true);
  });

  it('the AI is told who builds it now and whether they can attend, coded, and no longer reads the replaced answer', async () => {
    const root = await replaced();
    // An answer an earlier evaluation saved from the old review answer (no basis, so it was not undone with it).
    await saveIdea(root, { ...(await loadIdea(root, ID)), answers: [{ question: BOTH.ask, answer: 'Alex Wang will build it.', source: REVIEW_SOURCE }] } as any);
    const ai = dumbAi([BOTH]);
    await suggestPrep(root, ID, ai.run, clock);
    const seen = ai.seen[0];
    expect(seen.progress?.builders).toHaveLength(1);
    expect(seen.progress?.builders![0]).toMatch(/^\[P\d+\]$/);
    expect(seen.progress?.builderCanAttend).toBe(true);
    expect(JSON.stringify(seen)).not.toMatch(/Alex|Priya/);
    expect(seen.answers!.map((a) => a.answer)).toEqual([seen.answers!.at(-1)!.answer]);
    expect(seen.answers!.at(-1)!.answer).toMatch(/^\[P\d+\] - yes she can attend$/);
  });

  it('as soon as the answer is replaced, the stale brief stops naming the old builder', async () => {
    const root = await replaced();
    const idea = await loadIdea(root, ID);
    expect(idea.learned?.stale).toBe(true);
    expect(JSON.stringify(idea.learned)).not.toMatch(/Alex Wang/);
    expect(idea.learned!.points).toEqual([{ topic: 'Volume', text: 'About 30 requests a week.' }]);
  });

  it('a builder named without "can attend": the brief says so, never that they attend', async () => {
    const root = await replaced('Priya Shah');
    await suggestPrep(root, ID, dumbAi([BOTH], { learned: [{ topic: 'Builder', text: 'Priya Shah builds it and attends every session.' }] }).run, clock);
    expect(await brief(root)).toEqual([{ topic: 'Builder', text: 'Priya Shah builds it; whether they can attend every design session is not said yet.' }]);
  });
});

describe('the brief and the roles, by code', () => {
  const at = { at: '2026-11-01', from: 1 };
  const idea = (people: any, s2e = false) => sampleIdea({ id: ID, slug: 'x', title: 't', dedupe_key: 'a', people, checklist: s2e ? { s2e: { done: true } } : {} } as any);
  it('leaves a brief that agrees alone, keeps what else a builder point says, and drops a builder point when no one builds it', () => {
    const ok = { ...at, points: [{ topic: 'Builder', text: 'Alex Wang builds it in Power Apps.' }] };
    const alexBuilds = { ...team(), team: team().team.map((p) => (p.name === 'Alex Wang' ? { ...p, roles: ['builder'] } : p)) };
    expect(alignBrief(ok, idea(alexBuilds), KNOWN)).toBe(ok);
    const none = alignBrief({ ...at, points: [{ topic: 'Builder', text: 'Alex Wang builds it.' }, { topic: 'Data', text: 'Sample files.' }] }, idea(team()), KNOWN);
    expect(none.points).toEqual([{ topic: 'Data', text: 'Sample files.' }]);
  });
  it('a brief that says they attend when the tick is off (or not when it is on) is written from the roles', () => {
    const people = { ...team(), team: team().team.map((p) => (p.name === 'Priya Shah' ? { ...p, roles: ['builder'] } : p)) };
    expect(alignBrief({ ...at, points: [{ topic: 'Builder', text: 'Priya Shah cannot attend every session.' }] }, idea(people, true), KNOWN).points)
      .toEqual([{ topic: 'Builder', text: 'Priya Shah builds it and can attend every design session.' }]);
  });
});
