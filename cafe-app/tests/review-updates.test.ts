import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { suggestPrep, answerNeed, type RunReview } from '../src/review/prep';
import { decideUpdate, REVIEW_SOURCE } from '../src/review/updates';
import { rebuildGraph } from '../src/graph/store';
import { readHistory } from '../src/workspace/files';
import { fixedClock } from '../src/clock';
import type { ReviewSuggestInput, ReviewSuggestOutput, ReviewUpdates } from '../src/ai/tasks';

const clock = fixedClock('2026-10-23');
const FLAG = 'Participation is Individual but 5 people are listed';
const idea = sampleIdea({
  id: 'CAFE-2026-001', slug: 'vendor', title: 'Vendor contract summariser', dedupe_key: 'a', participation: 'Individual',
  challenge: 'Person 1 reads vendor contracts by hand.', flags: [FLAG], sent: { E2: '2026-10-22' },
  people: { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead'] }, { name: 'Person 2', roles: ['member'] }] },
});
const NONE: ReviewUpdates = { builder: '', builderCanAttend: false, participation: '', resolvedFlags: [], facts: [], graph: { nodes: [], links: [] } };
const need = { need: 'A builder', ask: 'Who would build it, and can they attend?', met: false };
function ai(updates: Partial<ReviewUpdates>) {
  const seen: ReviewSuggestInput[] = [];
  const run: RunReview = async (input) => {
    seen.push(input);
    // The AI sees names coded: it names the builder by the code it was given.
    const code = /\[(P\d+)\]/.exec(JSON.stringify(input.answers ?? []))?.[1];
    const out: ReviewSuggestOutput = {
      criteria: { feasible: true, builder: true, data: true, theme: true, reuse: true }, decision: 'select', reason: 'Answers cover it.',
      needs: [{ ...need, met: true, answer: 'Builder named' }],
      updates: { ...NONE, ...updates, ...(updates.builder === 'CODE' ? { builder: `[${code}]` } : {}) },
    };
    return { provider: 'fake', output: out };
  };
  return { run, seen };
}
async function setup() {
  const root = await tmpWorkspace();
  await saveIdea(root, idea);
  await suggestPrep(root, idea.id, ai({}).run, clock);
  await saveIdea(root, { ...(await loadIdea(root, idea.id)), prep: { ...(await loadIdea(root, idea.id)).prep!, needs: [{ id: 'n1', ...need }] } });
  await answerNeed(root, idea.id, 'n1', 'Person 2 will build it and can make every session. It is a team entry. Sample contracts are enough.');
  return root;
}
const updates = async (root: string) => (await loadIdea(root, idea.id)).updates ?? [];

describe('what your answers change in the record', () => {
  it('re-evaluating proposes each change in plain words; nothing changes until Yes', async () => {
    const root = await setup();
    await suggestPrep(root, idea.id, ai({
      builder: 'CODE', builderCanAttend: true, participation: 'Team', resolvedFlags: [FLAG.toUpperCase(), 'A flag the idea does not have'],
      facts: [{ question: 'Is sample data enough?', answer: 'Sample contracts are enough.' }],
      graph: { nodes: [{ type: 'System', label: 'Contract library' }, { type: 'Capability', label: 'Contract term extraction' }],
        links: [{ from: 'idea', to: 'Contract term extraction', rel: 'NEEDS', description: 'Reads the terms', confidence: 0.9 },
          { from: 'Contract term extraction', to: 'Contract library', rel: 'USES_DATA', description: 'Exported files', confidence: 0.8 }] },
    }).run, clock);
    const u = await updates(root);
    expect(u.map((x) => [x.kind, x.status])).toEqual([
      ['builder', 'proposed'], ['participation', 'proposed'], ['flag', 'proposed'], ['facts', 'proposed'], ['link', 'proposed'], ['link', 'proposed'],
    ]);
    expect(u[0].label).toBe('Make Person 2 the builder, and tick "Builder named, can attend every session"');
    expect(u[1].label).toBe('Set participation to Team (the form says Individual)');
    expect(u[2].label).toBe(`Clear the flag: ${FLAG}`);
    expect(u[4].label).toBe('Vendor contract summariser needs Contract term extraction; adds a new star: Contract term extraction (capability)');
    expect(u[5].label).toBe('Contract term extraction uses data from Contract library; adds a new star: Contract term extraction (capability), Contract library (system or data)');
    const now = await loadIdea(root, idea.id);
    expect(now.participation).toBe('Individual');
    expect(now.people.team[1].roles).toEqual(['member']);
  });

  it('Yes applies one change (and logs it); Undo puts back only that change', async () => {
    const root = await setup();
    await suggestPrep(root, idea.id, ai({ builder: 'CODE', builderCanAttend: true, participation: 'Team', resolvedFlags: [FLAG],
      facts: [{ question: 'Is sample data enough?', answer: 'Sample contracts are enough.' }] }).run, clock);
    const [b, p, f, a] = await updates(root);
    for (const x of [b, p, f, a]) expect((await decideUpdate(root, idea.id, x.id, 'yes', clock)).status).toBe('applied');
    let now = await loadIdea(root, idea.id) as any;
    expect(now.people.team[1]).toEqual({ name: 'Person 2', roles: ['builder'], added: ['builder'] });
    expect(now.formWas).toEqual({ participation: 'Individual' });
    expect(now.checklist.s2e?.done).toBe(true);
    expect(now.participation).toBe('Team');
    expect(now.flags).toEqual([]);
    expect(now.answers).toEqual([{ question: 'Is sample data enough?', answer: 'Sample contracts are enough.', source: REVIEW_SOURCE }]);
    expect(now.checklist.s2d?.done).toBe(true);
    expect((await rebuildGraph(root)).edges.map((e) => `${e.from} ${e.rel}`)).toContain('person:person-2 BUILDS');
    expect((await readHistory(await ideaDir(root, idea.id))).filter((h: any) => h.action === 'review-update')).toHaveLength(4);
    for (const x of [b, p, f, a]) expect((await decideUpdate(root, idea.id, x.id, 'undo', clock)).status).toBe('proposed');
    now = await loadIdea(root, idea.id) as any;
    expect(now.people.team[1]).toEqual({ name: 'Person 2', roles: ['member'] });
    expect(now.checklist.s2e?.done).toBeFalsy();
    expect(now.participation).toBe('Individual');
    expect(now.formWas).toBeUndefined();
    expect(now.flags).toEqual([FLAG]);
    expect(now.answers ?? []).toEqual([]);
  });

  it('No drops a change and it is not proposed again; one already true is never proposed', async () => {
    const root = await setup();
    const run = ai({ participation: 'Team', builder: 'Person 1 Extra' }).run;
    await suggestPrep(root, idea.id, run, clock);
    const x = (await updates(root)).find((y) => y.kind === 'participation')!;
    await decideUpdate(root, idea.id, x.id, 'no', clock);
    await suggestPrep(root, idea.id, run, clock);
    expect((await updates(root)).map((y) => [y.kind, y.status])).toEqual([['participation', 'dismissed'], ['builder', 'proposed']]);
    // Already the form's value, or already the builder: nothing to propose.
    await saveIdea(root, { ...(await loadIdea(root, idea.id)), prep: undefined, updates: undefined, people: { ...idea.people, team: [{ name: 'Person 2', roles: ['builder'] }] } });
    await suggestPrep(root, idea.id, ai({ participation: 'Individual', builder: 'Person 2' }).run, clock);
    expect(await updates(root)).toEqual([]);
  });
});

describe('the same person, the same answers: no duplicates', () => {
  const team = { submitter: 'Person 1', team: [{ name: 'Person 1', roles: ['lead', 'builder'] as any }, { name: 'Tomasz Wiśniewski', roles: ['sponsor'] as any, note: 'Sponsor' }] };
  const start = async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, { ...idea, people: team });
    return root;
  };

  it('a builder spelt another way, or with an extra word, is the person already known, and takes over as the builder', async () => {
    const root = await start();
    await suggestPrep(root, idea.id, ai({ builder: 'Tomasz Wiśniewski Viseiewki' }).run, clock);
    let [b] = await updates(root);
    expect(b.label).toBe('Make Tomasz Wiśniewski the builder (the answer says "Tomasz Wiśniewski Viseiewki") instead of Person 1');
    await decideUpdate(root, idea.id, b.id, 'yes', clock);
    expect((await loadIdea(root, idea.id)).people.team).toEqual([
      { name: 'Person 1', roles: ['lead'] }, { name: 'Tomasz Wiśniewski', roles: ['sponsor', 'builder'], note: 'Sponsor', added: ['builder'] },
    ]);
    // Re-evaluated, the answer spelt yet another way: nothing new to do.
    await suggestPrep(root, idea.id, ai({ builder: 'Tomasz Viseiewki' }).run, clock);
    expect((await updates(root)).filter((x) => x.status === 'proposed')).toEqual([]);
    // Undo puts the team back as it was.
    [b] = await updates(root);
    await decideUpdate(root, idea.id, b.id, 'undo', clock);
    expect((await loadIdea(root, idea.id)).people.team).toEqual(team.team);
  });

  it('answers re-worded on a second re-evaluation replace the ones saved before', async () => {
    const root = await start();
    await suggestPrep(root, idea.id, ai({ facts: [{ question: 'Can the builder attend all sessions?', answer: 'Not confirmed yet.' }, { question: 'Is sample data enough?', answer: 'Yes.' }] }).run, clock);
    await decideUpdate(root, idea.id, (await updates(root))[0].id, 'yes', clock);
    await suggestPrep(root, idea.id, ai({ facts: [{ question: 'Can the builder attend all of the sessions?', answer: 'Confirmed, every session.' }, { question: 'Is sample data enough?', answer: 'Yes' }] }).run, clock);
    const fresh = (await updates(root)).find((x) => x.status === 'proposed')!;
    expect(fresh.facts).toEqual([{ question: 'Can the builder attend all of the sessions?', answer: 'Confirmed, every session.' }]);
    expect(fresh.label).toMatch(/^Save this answer on the idea \(in place of 1 saved before\)/);
    await decideUpdate(root, idea.id, fresh.id, 'yes', clock);
    expect(((await loadIdea(root, idea.id)) as any).answers.map((a: any) => a.answer)).toEqual(['Yes.', 'Confirmed, every session.']);
    await decideUpdate(root, idea.id, fresh.id, 'undo', clock);
    expect(((await loadIdea(root, idea.id)) as any).answers.map((a: any) => a.answer).sort()).toEqual(['Not confirmed yet.', 'Yes.']);
  });
});

describe('taking back a saved answer', () => {
  it('removes that one answer and logs it', async () => {
    const root = await tmpWorkspace();
    const answers = [{ question: 'Q1', answer: 'Old', source: REVIEW_SOURCE }, { question: 'Q1', answer: 'New', source: REVIEW_SOURCE }];
    await saveIdea(root, { ...idea, answers } as any);
    const { removeAnswer } = await import('../src/review/updates');
    await removeAnswer(root, idea.id, 'Q1', 'Old', clock);
    expect(((await loadIdea(root, idea.id)) as any).answers).toEqual([answers[1]]);
    await expect(removeAnswer(root, idea.id, 'Q1', 'Old', clock)).rejects.toThrow('gone already');
    expect((await readHistory(await ideaDir(root, idea.id))).at(-1)).toMatchObject({ action: 'answer-removed', detail: 'Answer removed: Old' });
  });
});

describe('the brief of what the answers add', () => {
  it('is the AI\'s own summary, names restored, kept on the idea; removing an answer marks it out of date', async () => {
    const root = await setup();
    const run: RunReview = async (input) => {
      const code = /\[(P\d+)\]/.exec(JSON.stringify(input.answers ?? []))?.[1];
      return { provider: 'fake', output: {
        criteria: { feasible: true, builder: true, data: true, theme: true, reuse: true }, decision: 'select', reason: 'x', needs: [],
        updates: NONE, learned: [{ topic: 'Builder', text: `[${code}] builds it and attends every session.` }, { topic: 'Data', text: 'Sample contracts are enough.' }],
      } };
    };
    await suggestPrep(root, idea.id, run, clock);
    const now = await loadIdea(root, idea.id) as any;
    expect(now.learned).toEqual({ at: '2026-10-23', provider: 'fake', from: 1, points: [
      { topic: 'Builder', text: 'Person 2 builds it and attends every session.' }, { topic: 'Data', text: 'Sample contracts are enough.' },
    ] });
    await saveIdea(root, { ...now, answers: [{ question: 'Q', answer: 'A', source: REVIEW_SOURCE }] } as any);
    const { removeAnswer } = await import('../src/review/updates');
    await removeAnswer(root, idea.id, 'Q', 'A', clock);
    expect(((await loadIdea(root, idea.id)) as any).learned.stale).toBe(true);
  });
});

describe('each section keeps its own proposals', () => {
  it('a proposal says which suggestion made it; a new one in another section leaves it waiting', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, idea);
    const { takeInAnswers } = await import('../src/review/updates');
    const now = await loadIdea(root, idea.id);
    // The decision proposes participation; then the tool picker proposes a builder.
    await saveIdea(root, { ...now, ...(await takeInAnswers(root, now, { updates: { ...NONE, participation: 'Team' } }, new Map(), 'fake', '2026-10-23', 1, 'decision')) });
    const mid = await loadIdea(root, idea.id);
    await saveIdea(root, { ...mid, ...(await takeInAnswers(root, mid, { updates: { ...NONE, builder: 'Person 2' } }, new Map(), 'fake', '2026-10-23', 1, 'tools')) });
    expect((await updates(root)).map((u) => [u.kind, u.from, u.status])).toEqual([['participation', 'decision', 'proposed'], ['builder', 'tools', 'proposed']]);
    // The decision suggests again with nothing to change: only its own waiting proposal goes.
    const last = await loadIdea(root, idea.id);
    await saveIdea(root, { ...last, ...(await takeInAnswers(root, last, { updates: NONE }, new Map(), 'fake', '2026-10-23', 1, 'decision')) });
    expect((await updates(root)).map((u) => [u.kind, u.from])).toEqual([['builder', 'tools']]);
  });
});
