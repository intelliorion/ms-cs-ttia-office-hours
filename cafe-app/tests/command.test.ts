import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { fixedClock } from '../src/clock';
import { createConnector, type Provider } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { rebuildGraph } from '../src/graph/store';
import { createRound, listRounds } from '../src/round/store';
import { runCommand, doActions, cancelActions, undoChatAction, readChat } from '../src/command/chat';

const clock = fixedClock('2026-10-22');
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a',
    people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', role: 'lead' }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'b',
    people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', role: 'lead' }, { name: 'Zainab Okafor', role: 'member' }] } }),
];
async function setup(reply: (prompt: string) => unknown) {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  const prompts: string[] = [];
  const provider: Provider = {
    id: 'claude', label: 'Test AI', available: async () => true,
    complete: async (prompt: string) => { prompts.push(prompt); return JSON.stringify(reply(prompt)); },
  };
  return { root, prompts, ai: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) };
}
const rels = async (root: string) => (await rebuildGraph(root)).edges.map((e) => `${e.from} ${e.rel} ${e.to}`);

describe('the command bar', () => {
  it('link a person to a team: the AI sees codes, not the name; nothing changes until Do it; Undo takes it back', async () => {
    const { root, prompts, ai } = await setup(() => ({ reply: 'Link [P1] to [T1].', actions: [{ op: 'link', a: 'P1', b: 'T1' }] }));
    const entry = await runCommand(root, 'link Zainab Okafor to BSI', ai, clock);
    expect(prompts[0]).not.toMatch(/Zainab|Okafor/);
    expect(prompts[0]).toMatch(/link \[P1\] to \[T1\]/);
    expect(entry.reply).toBe('Link Zainab Okafor to BSI.');
    expect(entry.actions).toEqual([expect.objectContaining({ id: 'a1', status: 'proposed', label: 'Link BSI → Zainab Okafor (has the member)' })]);
    expect(await rels(root)).not.toContain('team:bsi HAS_MEMBER person:zainab-okafor');

    const done = await doActions(root, entry.id, undefined, clock);
    expect(done.actions[0].status).toBe('done');
    expect(await rels(root)).toContain('team:bsi HAS_MEMBER person:zainab-okafor');

    const undone = await undoChatAction(root, entry.id, 'a1', clock);
    expect(undone.actions[0].status).toBe('undone');
    expect(await rels(root)).not.toContain('team:bsi HAS_MEMBER person:zainab-okafor');
    expect((await readChat(root)).map((e) => e.text)).toEqual(['link Zainab Okafor to BSI']);
  });

  it('a person and an idea: sets their role in the idea itself, with history; Undo restores the team', async () => {
    const { root, ai } = await setup(() => ({ reply: 'Make [P1] sponsor of [I1].', actions: [{ op: 'role', a: 'P1', b: 'I1', role: 'sponsor' }] }));
    const entry = await runCommand(root, 'Avery Chen sponsors the procurement faq bot', ai, clock);
    expect(entry.actions[0].label).toBe('Make Avery Chen sponsor on Procurement FAQ bot');
    await doActions(root, entry.id, 'a1', clock);
    expect((await loadIdea(root, 'CAFE-2026-002')).people.team).toContainEqual({ name: 'Avery Chen', role: 'sponsor' });
    expect(await rels(root)).toContain('person:avery-chen SPONSORS idea:CAFE-2026-002');
    await undoChatAction(root, entry.id, 'a1', clock);
    expect((await loadIdea(root, 'CAFE-2026-002')).people.team.map((p) => p.name)).toEqual(['Kwame Mensah', 'Zainab Okafor']);
  });

  it('put ideas in a new round, by name; a separate "create it" step is not shown twice', async () => {
    const { root, ai } = await setup(() => ({ reply: 'Put them in a new round.', actions: [{ op: 'new_round', name: 'Spring pilots' }, { op: 'round', ideas: ['I1', 'I2'], name: 'Spring pilots' }] }));
    const entry = await runCommand(root, 'put both ideas in a new round called Spring pilots', ai, clock);
    expect(entry.actions.map((a) => a.label)).toEqual(['Create the round Spring pilots and put Desk booking assistant, Procurement FAQ bot in it']);
    const done = await doActions(root, entry.id, undefined, clock);
    expect(done.actions[0].note).toBe('Round Spring pilots created');
    const [round] = await listRounds(root);
    expect((await loadIdea(root, 'CAFE-2026-001')).round).toBe(round.id);
  });

  it('the app decides: a stage move, a tool link, an unknown code and a wrong pair become plain reasons, not actions', async () => {
    const { root, ai } = await setup(() => ({
      reply: 'Here is what I understood.',
      actions: [{ op: 'stage', a: 'I1' }, { op: 'link', a: 'T1', b: 'T2' }, { op: 'link', a: 'Q9', b: 'T1' }, { op: 'merge', a: 'T1', b: 'I1' }],
    }));
    const entry = await runCommand(root, 'move the desk booking assistant to launch and other things', ai, clock);
    expect(entry.actions).toEqual([]);
    expect(entry.problems).toEqual([
      'Stages only move by your hand: open Desk booking assistant and use its stage button.',
      "A Team and a Team can't be linked that way.",
      'I couldn\'t find both stars in the universe, so I left "link" out.',
      "BSI and Desk booking assistant can't be merged: only two stars of the same kind (not ideas, rounds or the division) can.",
    ]);
  });

  it('cancel leaves everything as it was; an AI failure says so and changes nothing', async () => {
    const { root, ai } = await setup(() => ({ reply: 'Link.', actions: [{ op: 'link', a: 'P1', b: 'T1' }] }));
    const entry = await runCommand(root, 'link Zainab Okafor to BSI', ai, clock);
    const c = await cancelActions(root, entry.id, undefined);
    expect(c.actions[0].status).toBe('cancelled');
    expect(await rels(root)).not.toContain('team:bsi HAS_MEMBER person:zainab-okafor');
    const bad = await setup(() => 'not json');
    const failed = await runCommand(bad.root, 'link Zainab Okafor to BSI', bad.ai, clock);
    expect(failed.error).toMatch(/The AI couldn't read that/);
    expect(failed.actions).toEqual([]);
  });

  it('unlink a form link hides it; a merge moves the links; both undo', async () => {
    const { root, ai } = await setup((p) => (/"command": "unlink/.test(p)
      ? { reply: 'Remove it.', actions: [{ op: 'unlink', a: 'D1', b: 'T1' }] }
      : { reply: 'Merge.', actions: [{ op: 'merge', a: 'T1', b: 'T2' }] }));
    const u = await runCommand(root, 'unlink Corporate Services (CS) and BSI', ai, clock);
    expect(u.actions[0].label).toBe('Remove the link Corporate Services (CS) → BSI');
    await doActions(root, u.id, undefined, clock);
    expect(await rels(root)).not.toContain('entity:cs HAS_TEAM team:bsi');
    await undoChatAction(root, u.id, 'a1', clock);
    expect(await rels(root)).toContain('entity:cs HAS_TEAM team:bsi');
    const m = await runCommand(root, 'merge BSI into GSS', ai, clock);
    await doActions(root, m.id, undefined, clock);
    const g = await rebuildGraph(root);
    expect(g.nodes.some((n) => n.id === 'team:bsi')).toBe(false);
    expect(g.edges.map((e) => e.id)).toContain('team:gss|HAS_MEMBER|person:avery-chen');
  });

  it('a new command cancels what the last one left waiting, saying so', async () => {
    const { root, ai } = await setup(() => ({ reply: 'Link.', actions: [{ op: 'link', a: 'P1', b: 'T1' }] }));
    const first = await runCommand(root, 'link Zainab Okafor to BSI', ai, clock);
    await runCommand(root, 'link Zainab Okafor to GSS', ai, clock);
    const old = (await readChat(root)).find((e) => e.id === first.id)!;
    expect(old.actions[0]).toMatchObject({ status: 'cancelled', note: 'A newer command replaced it' });
  });

  it('rounds already there are found by name', async () => {
    const { root, ai } = await setup(() => ({ reply: 'Put it in [R1].', actions: [{ op: 'round', ideas: ['I1'], b: 'R1' }] }));
    const r = await createRound(root, '2026 Q4', clock);
    const entry = await runCommand(root, 'put CAFE-2026-001 in 2026 Q4', ai, clock);
    expect(entry.actions[0]).toMatchObject({ label: 'Put Desk booking assistant in 2026 Q4', action: { roundId: r.id } });
  });
});
