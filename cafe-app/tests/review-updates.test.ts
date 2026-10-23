import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea, ideaDir } from '../src/ideas/store';
import { suggestPrep, answerNeed, type RunReview } from '../src/review/prep';
import { REVIEW_SOURCE } from '../src/review/updates';
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
  it('re-evaluating applies each checked change at once, in plain words, and logs each by the AI', async () => {
    const root = await setup();
    await suggestPrep(root, idea.id, ai({
      builder: 'CODE', builderCanAttend: true, participation: 'Team', resolvedFlags: [FLAG.toUpperCase(), 'A flag the idea does not have'],
      facts: [{ question: 'Is sample data enough?', answer: 'Sample contracts are enough.' }],
      graph: { nodes: [{ type: 'System', label: 'Contract library' }, { type: 'Capability', label: 'Contract term extraction' }],
        links: [{ from: 'idea', to: 'Contract term extraction', rel: 'NEEDS', description: 'Reads the terms', confidence: 0.9 },
          { from: 'Contract term extraction', to: 'Contract library', rel: 'USES_DATA', description: 'Exported files', confidence: 0.8 }] },
    }).run, clock);
    const u = await updates(root);
    expect(u.map((x) => [x.kind, x.status, x.from])).toEqual([
      ['builder', 'applied', 'decision'], ['participation', 'applied', 'decision'], ['flag', 'applied', 'decision'], ['facts', 'applied', 'decision'],
      ['link', 'applied', 'decision'], ['link', 'applied', 'decision'],
    ]);
    expect(u[0].label).toBe('Make Person 2 the builder, and tick "Builder named, can attend every session"');
    expect(u[1].label).toBe('Set participation to Team (the form says Individual)');
    expect(u[2].label).toBe(`Clear the flag: ${FLAG}`);
    expect(u[4].label).toBe('Vendor contract summariser needs Contract term extraction; adds a new star: Contract term extraction (capability)');
    expect(u[5].label).toBe('Contract term extraction uses data from Contract library; adds a new star: Contract term extraction (capability), Contract library (system or data)');
    const now = await loadIdea(root, idea.id) as any;
    expect(now.people.team[1]).toEqual({ name: 'Person 2', roles: ['builder'], added: ['builder'] });
    expect(now.formWas).toEqual({ participation: 'Individual' });
    expect(now.checklist.s2e?.done).toBe(true);
    expect(now.participation).toBe('Team');
    expect(now.flags).toEqual([]);
    expect(now.answers).toEqual([{ question: 'Is sample data enough?', answer: 'Sample contracts are enough.', source: REVIEW_SOURCE }]);
    expect(now.checklist.s2d?.done).toBe(true);
    const edges = (await rebuildGraph(root)).edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
    expect(edges.some((e) => e.startsWith('person:person-2 BUILDS'))).toBe(true);
    expect(edges.some((e) => e.endsWith('NEEDS capability:contract-term-extraction'))).toBe(true);
    const log = (await readHistory(await ideaDir(root, idea.id))).filter((h: any) => h.action === 'answers-update');
    expect(log).toHaveLength(6);
    expect(log[0]).toMatchObject({ by: 'ai', source: 'decision answers', detail: 'Updated from the decision answers: Make Person 2 the builder, and tick "Builder named, can attend every session"' });
    // Nothing is made twice: suggesting again with the same answers changes nothing more.
    await suggestPrep(root, idea.id, ai({ builder: 'CODE', participation: 'Team' }).run, clock);
    expect(await updates(root)).toHaveLength(6);
  });

  it('a change said no to before updates applied themselves is never made; an older waiting one is made on the next suggestion', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, { ...idea, updates: [
      { id: 'u1', key: 'participation:Team', kind: 'participation', participation: 'Team', label: 'Set participation to Team', status: 'dismissed', from: 'decision' },
      { id: 'u2', key: 'flag:x', kind: 'flag', flag: FLAG, label: `Clear the flag: ${FLAG}`, status: 'proposed', from: 'decision' },
      { id: 'u3', key: 'builder:person 2', kind: 'builder', builder: { name: 'Person 2', canAttend: false }, label: 'Make Person 2 the builder', status: 'proposed', from: 'tools' },
    ] });
    await suggestPrep(root, idea.id, ai({ participation: 'Team', resolvedFlags: [FLAG] }).run, clock);
    const u = await updates(root);
    expect(u.map((x) => [x.kind, x.from, x.status])).toEqual([
      ['participation', 'decision', 'dismissed'], ['builder', 'tools', 'proposed'], ['flag', 'decision', 'applied'],
    ]);
    const now = await loadIdea(root, idea.id);
    expect(now.participation).toBe('Individual');
    expect(now.flags).toEqual([]);
    // Already the form's value, or already the builder: nothing to change.
    await saveIdea(root, { ...now, prep: undefined, updates: undefined, people: { ...idea.people, team: [{ name: 'Person 2', roles: ['builder'] }] } });
    await suggestPrep(root, idea.id, ai({ participation: 'Individual', builder: 'Person 2' }).run, clock);
    expect(await updates(root)).toEqual([]);
  });

  it('a fact restating an answer the team already gave elsewhere is not saved again', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, { ...idea, answers: [{ question: 'How many claims a month?', answer: 'About 12,000.', source: 'reply.eml' }] } as any);
    await suggestPrep(root, idea.id, ai({ facts: [{ question: 'How many claims a month?', answer: 'Roughly twelve thousand claims.' }] }).run, clock);
    expect(await updates(root)).toEqual([]);
    expect(((await loadIdea(root, idea.id)) as any).answers).toHaveLength(1);
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
    const [b] = await updates(root);
    expect(b.label).toBe('Make Tomasz Wiśniewski the builder (the answer says "Tomasz Wiśniewski Viseiewki") instead of Person 1');
    expect(b.status).toBe('applied');
    expect((await loadIdea(root, idea.id)).people.team).toEqual([
      { name: 'Person 1', roles: ['lead'] }, { name: 'Tomasz Wiśniewski', roles: ['sponsor', 'builder'], note: 'Sponsor', added: ['builder'] },
    ]);
    // Re-evaluated, the answer spelt yet another way: nothing new to do.
    await suggestPrep(root, idea.id, ai({ builder: 'Tomasz Viseiewki' }).run, clock);
    expect(await updates(root)).toHaveLength(1);
  });

  it('answers re-worded on a second re-evaluation replace the ones saved before', async () => {
    const root = await start();
    await suggestPrep(root, idea.id, ai({ facts: [{ question: 'Can the builder attend all sessions?', answer: 'Not confirmed yet.' }, { question: 'Is sample data enough?', answer: 'Yes.' }] }).run, clock);
    await suggestPrep(root, idea.id, ai({ facts: [{ question: 'Can the builder attend all of the sessions?', answer: 'Confirmed, every session.' }, { question: 'Is sample data enough?', answer: 'Yes' }] }).run, clock);
    const fresh = (await updates(root))[1];
    expect(fresh.facts).toEqual([{ question: 'Can the builder attend all of the sessions?', answer: 'Confirmed, every session.' }]);
    expect(fresh.label).toMatch(/^Save this answer on the idea \(in place of 1 saved before\)/);
    expect(fresh.status).toBe('applied');
    expect(((await loadIdea(root, idea.id)) as any).answers.map((a: any) => a.answer)).toEqual(['Yes.', 'Confirmed, every session.']);
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

describe('each section keeps its own updates', () => {
  it('an update says which suggestion made it; each section applies only its own', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, idea);
    const { takeInAnswers, applyAnswerUpdates } = await import('../src/review/updates');
    const now = await loadIdea(root, idea.id);
    // The decision proposes participation; then the tool picker proposes a builder.
    await saveIdea(root, { ...now, ...(await takeInAnswers(root, now, { updates: { ...NONE, participation: 'Team' } }, new Map(), 'fake', '2026-10-23', 1, 'decision')) });
    const mid = await loadIdea(root, idea.id);
    await saveIdea(root, { ...mid, ...(await takeInAnswers(root, mid, { updates: { ...NONE, builder: 'Person 2' } }, new Map(), 'fake', '2026-10-23', 1, 'tools')) });
    expect((await applyAnswerUpdates(root, idea.id, 'tools', clock)).map((u) => u.kind)).toEqual(['builder']);
    expect((await updates(root)).map((u) => [u.kind, u.from, u.status])).toEqual([['participation', 'decision', 'proposed'], ['builder', 'tools', 'applied']]);
    expect((await loadIdea(root, idea.id)).participation).toBe('Individual');
    expect((await applyAnswerUpdates(root, idea.id, 'decision', clock)).map((u) => u.kind)).toEqual(['participation']);
    expect((await loadIdea(root, idea.id)).participation).toBe('Team');
  });
});
