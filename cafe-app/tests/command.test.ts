import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { fixedClock } from '../src/clock';
import { createConnector, type Provider } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { rebuildGraph } from '../src/graph/store';
import { createRound, listRounds } from '../src/round/store';
import { runCommand, doActions, cancelActions, undoChatAction, readChat, listThreads, type Progress } from '../src/command/chat';

const clock = fixedClock('2026-10-22');
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a',
    challenge: 'Avery Chen says staff email the desk team every morning.',
    people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', role: 'lead' }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'b',
    people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', role: 'lead' }, { name: 'Zainab Okafor', role: 'member' }] } }),
];
const NAMES = /Avery|Chen|Kwame|Mensah|Zainab|Okafor/;

type Turn = (data: any, prompt: string) => unknown;
/** A fake AI: agent turns answered in order (the last one repeats), the extract task answered when asked. */
async function setup(turns: Turn[], extract?: unknown) {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  const prompts: string[] = [];
  let n = 0;
  const provider: Provider = {
    id: 'claude', label: 'Test AI', available: async () => true,
    complete: async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.startsWith('TASK: extract')) return JSON.stringify(extract);
      const data = JSON.parse(prompt.slice(prompt.indexOf('<<<DATA') + 7, prompt.indexOf('DATA>>>')));
      const turn = turns[Math.min(n++, turns.length - 1)];
      const out = turn(data, prompt);
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  return { root, prompts, ai: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }), reset: () => { n = 0; } };
}
const propose = (actions: unknown[], reply = 'You asked.') => (_?: unknown) => ({ next: 'propose', thought: 'Working it out', reply, actions });
const code = (data: any, type: string, label?: string) => data.stars.find((s: any) => s.type === type && (!label || s.label === label))?.code;
const rels = async (root: string) => (await rebuildGraph(root)).edges.map((e) => `${e.from} ${e.rel} ${e.to}`);

describe('the Café assistant: changes', () => {
  it('link a person to a team: the AI sees codes, not the name; nothing changes until Do it; Undo takes it back', async () => {
    const { root, prompts, ai } = await setup([(d) => ({ next: 'propose', thought: 'Linking', reply: 'You asked to link [P1] to [T1].', actions: [{ op: 'link', a: 'P1', b: code(d, 'Team', 'BSI') }] })]);
    const entry = await runCommand(root, 'link Zainab Okafor to BSI', ai, clock);
    expect(prompts.join('\n')).not.toMatch(NAMES);
    expect(entry).toMatchObject({ kind: 'command', reply: 'You asked to link Zainab Okafor to BSI.' });
    expect(entry.actions).toEqual([expect.objectContaining({ id: 'a1', status: 'proposed', label: 'Link BSI → Zainab Okafor (has the member)' })]);
    expect(await rels(root)).not.toContain('team:bsi HAS_MEMBER person:zainab-okafor');
    expect((await doActions(root, entry.id, undefined, clock)).actions[0].status).toBe('done');
    expect(await rels(root)).toContain('team:bsi HAS_MEMBER person:zainab-okafor');
    expect((await undoChatAction(root, entry.id, 'a1', clock)).actions[0].status).toBe('undone');
    expect(await rels(root)).not.toContain('team:bsi HAS_MEMBER person:zainab-okafor');
  });

  it('a role, a new round by name, and the app\'s own checks turning bad steps into reasons', async () => {
    const { root, ai } = await setup([(d) => ({
      next: 'propose', thought: 'Working it out', reply: 'You asked for several things.',
      actions: [
        { op: 'role', a: 'P1', b: code(d, 'Idea', 'Procurement FAQ bot'), role: 'sponsor' },
        { op: 'new_round', name: 'Spring pilots' }, { op: 'round', ideas: [code(d, 'Idea', 'Desk booking assistant')], name: 'Spring pilots' },
        { op: 'stage', a: code(d, 'Idea', 'Desk booking assistant') }, { op: 'link', a: 'Q9', b: 'T1' },
      ],
    })]);
    const entry = await runCommand(root, 'Avery Chen sponsors the procurement faq bot; desk booking into a new round Spring pilots and to launch', ai, clock);
    expect(entry.actions.map((a) => a.label)).toEqual([
      'Make Avery Chen sponsor on Procurement FAQ bot',
      'Create the round Spring pilots and put Desk booking assistant in it',
    ]);
    expect(entry.problems).toEqual([
      'Stages only move by your hand: open Desk booking assistant and use its stage button.',
      'I couldn\'t find both stars in the universe, so I left "link" out.',
    ]);
    await doActions(root, entry.id, undefined, clock);
    expect((await loadIdea(root, 'CAFE-2026-002')).people.team).toContainEqual({ name: 'Avery Chen', role: 'sponsor' });
    expect((await loadIdea(root, 'CAFE-2026-001')).round).toBe((await listRounds(root))[0].id);
    const c = await runCommand(root, 'again', ai, clock, { thread: entry.thread });
    expect((await cancelActions(root, c.id, undefined)).actions.every((a) => a.status === 'cancelled')).toBe(true);
  });

  it('"grow it" with an idea on screen: focus coded, Do it reads the idea again, Undo takes the links back', async () => {
    const { root, prompts, ai } = await setup([(d) => propose([{ op: 'grow', a: d.focus }])({})],
      { nodes: [{ type: 'Capability', label: 'Clause finding' }], links: [{ from: 'idea', to: 'Clause finding', rel: 'NEEDS', description: 'Finds clauses', confidence: 0.9 }] });
    const entry = await runCommand(root, 'grow it', ai, clock, { focus: 'idea:CAFE-2026-002' });
    expect(entry.about).toBe('Procurement FAQ bot');
    expect(JSON.parse(prompts[0].slice(prompts[0].indexOf('<<<DATA') + 7, prompts[0].indexOf('DATA>>>'))).focus).toMatch(/^I\d+$/);
    const done = await doActions(root, entry.id, undefined, clock, ai);
    expect(done.actions[0]).toMatchObject({ status: 'done', note: '1 link added, 1 new star' });
    expect(await rels(root)).toContain('idea:CAFE-2026-002 NEEDS capability:clause-finding');
    await undoChatAction(root, entry.id, 'a1', clock);
    expect(await rels(root)).not.toContain('idea:CAFE-2026-002 NEEDS capability:clause-finding');
  });

  it('several stars on screen ("these"): all go as focus codes, people included as codes only', async () => {
    const { root, prompts, ai } = await setup([() => ({ next: 'clarify', thought: 'Not sure', reply: 'Say more.' })]);
    const e = await runCommand(root, 'what do these share?', ai, clock, { focus: ['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'person:zainab-okafor'] });
    const data = JSON.parse(prompts[0].slice(prompts[0].indexOf('<<<DATA') + 7, prompts[0].indexOf('DATA>>>')));
    expect(data.focus).toEqual([expect.stringMatching(/^I\d+$/), expect.stringMatching(/^I\d+$/), expect.stringMatching(/^P\d+$/)]);
    expect(prompts[0]).not.toMatch(NAMES);
    expect(e.about).toBe('3 selected: Desk booking assistant, Procurement FAQ bot, Zainab Okafor');
  });

  it('@mentions and a person on screen are codes only', async () => {
    const { root, prompts, ai } = await setup([() => ({ next: 'clarify', thought: 'Not sure', reply: 'Say more.' })]);
    await saveIdea(root, { ...IDEAS[0], support: ['Agent Design Guidance'] });
    await runCommand(root, 'link @Zainab Okafor to @Agent Design Guidance please', ai, clock, { focus: 'person:kwame-mensah', mentions: ['person:zainab-okafor', 'support:agent-design-guidance', 'gone:x'] });
    const data = JSON.parse(prompts[0].slice(prompts[0].indexOf('<<<DATA') + 7, prompts[0].indexOf('DATA>>>')));
    expect(data.message).toMatch(/^link \[P\d+\] to \[U\d+\] please$/);
    expect(data.focus).toMatch(/^P\d+$/);
    expect(prompts[0]).not.toMatch(NAMES);
  });
});

describe('the Café assistant: an agent that works in steps over the graph', () => {
  it('searches, sees the result, answers from it: steps, lit stars, trace and follow-ups; no names ever sent', async () => {
    const { root, prompts, ai } = await setup([
      (d) => ({ next: 'search', thought: 'Finding the lead of [I1]', query: { steps: [{ op: 'stars', codes: [code(d, 'Idea', 'Desk booking assistant')] }, { op: 'role', role: 'lead' }] } }),
      (d) => ({ next: 'answer', thought: 'Answering', reply: `[${d.steps[0].result.stars[0].code}] leads it.`, followups: ['What else does [P1] lead?'] }),
    ]);
    const events: Progress[] = [];
    const entry = await runCommand(root, 'who leads the desk booking assistant?', ai, clock, { progress: (p) => events.push(p) });
    expect(entry).toMatchObject({ kind: 'question', reply: 'Avery Chen leads it.', followups: ['What else does Avery Chen lead?'] });
    expect(entry.steps).toEqual([{ kind: 'search', text: 'Finding the lead of Desk booking assistant', found: 1 }]);
    expect(entry.highlight).toEqual(['idea:CAFE-2026-001', 'person:avery-chen']);
    expect(entry.trace).toHaveLength(1);
    expect(events.map((e) => e.stage)).toEqual(['thinking', 'step', 'thinking']);
    // The second call saw what the search returned: the lead as a person code, never a name.
    const second = JSON.parse(prompts[1].slice(prompts[1].indexOf('<<<DATA') + 7, prompts[1].indexOf('DATA>>>')));
    expect(second.steps[0].result).toEqual({ stars: [{ code: expect.stringMatching(/^P\d+$/), type: 'Person' }], total: 1 });
    expect(prompts.join('\n')).not.toMatch(NAMES);
  });

  it('when a search finds nothing it tries another way; a malformed query is reported back, not fatal', async () => {
    const { root, prompts, ai } = await setup([
      () => ({ next: 'search', thought: 'Exact name', query: { steps: [{ op: 'stars', type: 'Idea', match: 'helpdesk' }] } }),
      () => ({ next: 'search', thought: 'Oops', query: { oops: true } }),
      () => ({ next: 'search', thought: 'Looser', query: { steps: [{ op: 'stars', type: 'Idea', match: 'desk' }] } }),
      () => ({ next: 'answer', thought: 'Answering', reply: 'One idea.' }),
    ]);
    const entry = await runCommand(root, 'is there a helpdesk idea?', ai, clock);
    expect(entry.steps!.map((s) => s.found)).toEqual([0, 1]);
    const third = JSON.parse(prompts[2].slice(prompts[2].indexOf('<<<DATA') + 7, prompts[2].indexOf('DATA>>>')));
    expect(third.steps[1].result.error).toMatch(/malformed/);
    expect(entry.highlight).toEqual(['idea:CAFE-2026-001']);
  });

  it('reads an idea\'s text with the names it knows coded', async () => {
    const { root, prompts, ai } = await setup([
      (d) => ({ next: 'read_idea', thought: 'Reading [I1]', idea: code(d, 'Idea', 'Desk booking assistant') }),
      () => ({ next: 'answer', thought: 'Answering', reply: 'Staff email the desk team.' }),
    ]);
    const entry = await runCommand(root, 'what does the desk booking idea say?', ai, clock);
    expect(entry.steps).toEqual([{ kind: 'read', text: 'Reading Desk booking assistant' }]);
    const second = JSON.parse(prompts[1].slice(prompts[1].indexOf('<<<DATA') + 7, prompts[1].indexOf('DATA>>>')));
    expect(second.steps[0].result.answers).toEqual([]);
    expect(second.steps[0].result.challenge).toMatch(/^\[P\d+\] says staff email the desk team every morning\.$/);
    expect(prompts.join('\n')).not.toMatch(NAMES);
  });

  it('a conversation keeps its context: history, the same codes, and follow-ups that start from the last answer', async () => {
    let firstCode = '';
    const { root, prompts, ai } = await setup([
      (d) => ({ next: 'search', thought: 'GSS ideas', query: { steps: [{ op: 'stars', type: 'Idea', function: 'GSS' }] } }),
      (d) => { firstCode = d.steps[0].result.stars[0].code; return { next: 'answer', thought: 'Answering', reply: `[${firstCode}] is the GSS idea.` }; },
      (d) => ({ next: 'search', thought: 'Leads of those', query: { steps: [{ op: 'stars', last: true }, { op: 'role', role: 'lead' }] } }),
      () => ({ next: 'answer', thought: 'Answering', reply: 'Its lead is found.' }),
    ]);
    const one = await runCommand(root, 'which ideas are GSS?', ai, clock);
    const two = await runCommand(root, 'who leads those?', ai, clock, { thread: one.thread });
    expect(two.thread).toBe(one.thread);
    const third = JSON.parse(prompts[2].slice(prompts[2].indexOf('<<<DATA') + 7, prompts[2].indexOf('DATA>>>')));
    expect(third.history).toEqual([{ operator: expect.stringMatching(/^which ideas are \[T\d+\]\?$/), agent: `[${firstCode}] is the GSS idea.`, found: [firstCode] }]);
    // The same star keeps its code in the second message.
    expect(third.stars.find((s: any) => s.label === 'Procurement FAQ bot').code).toBe(firstCode);
    expect(two.steps).toEqual([{ kind: 'search', text: 'Leads of those', found: 1 }]);
    expect(two.highlight).toEqual(['idea:CAFE-2026-002', 'person:kwame-mensah']);
    expect((await listThreads(root)).map((t) => ({ title: t.title, count: t.count }))).toEqual([{ title: 'which ideas are GSS?', count: 2 }]);
  });

  it('a new conversation starts fresh, and changes left waiting in another one are cancelled with a note', async () => {
    const { root, prompts, ai } = await setup([propose([{ op: 'new_round', name: 'Later' }])]);
    const one = await runCommand(root, 'make a round Later', ai, clock);
    const two = await runCommand(root, 'make a round Later', ai, clock);
    expect(two.thread).not.toBe(one.thread);
    expect(JSON.parse(prompts[1].slice(prompts[1].indexOf('<<<DATA') + 7, prompts[1].indexOf('DATA>>>'))).history).toBeUndefined();
    const old = (await readChat(root)).find((e) => e.id === one.id)!;
    expect(old.actions[0]).toMatchObject({ status: 'cancelled', note: 'A new conversation replaced it' });
  });

  it('Stop ends after the step it is on; running out of steps says so; an AI failure changes nothing', async () => {
    const search = () => ({ next: 'search', thought: 'Searching', query: { steps: [{ op: 'stars', type: 'Idea' }] } });
    const s = await setup([search]);
    let calls = 0;
    const stopped = await runCommand(s.root, 'list ideas?', s.ai, clock, { stopped: () => ++calls > 1 });
    expect(stopped.error).toBe('Stopped. Nothing was changed.');
    expect(stopped.steps).toHaveLength(1);
    const long = await runCommand(s.root, 'list ideas?', s.ai, clock);
    expect(long.steps).toHaveLength(5);
    expect(long.problems).toEqual(['I ran out of steps before I could finish. Try asking a narrower question.']);
    const bad = await setup([() => 'not json']);
    const failed = await runCommand(bad.root, 'link Zainab Okafor to BSI', bad.ai, clock);
    expect(failed.error).toMatch(/The AI couldn't finish that/);
    expect(failed.actions).toEqual([]);
  });
});

describe('the Café assistant: people', () => {
  it('a new person picked with @ (＋ New person) is coded before the AI sees them, and joins the idea as builder; Undo restores the team', async () => {
    const { root, prompts, ai } = await setup([(d) => propose([{ op: 'role', a: code(d, 'Person'), b: code(d, 'Idea', 'Desk booking assistant'), role: 'builder' }])({})]);
    const entry = await runCommand(root, 'add @Rhys Llewellyn to the desk booking assistant as builder', ai, clock, { mentions: ['new-person:Rhys Llewellyn'] });
    expect(prompts[0]).not.toMatch(/Rhys|Llewellyn/);
    expect(entry.actions.map((a) => a.label)).toEqual(['Make Rhys Llewellyn the builder of Desk booking assistant']);
    await doActions(root, entry.id, undefined, clock);
    const idea = await loadIdea(root, 'CAFE-2026-001') as any;
    expect(idea.people.builder).toBe('Rhys Llewellyn');
    expect(idea.people.team).toContainEqual({ name: 'Rhys Llewellyn', role: 'member' });
    expect(await rels(root)).toContain('person:rhys-llewellyn RELATED idea:CAFE-2026-001');
    await undoChatAction(root, entry.id, 'a1', clock);
    const back = await loadIdea(root, 'CAFE-2026-001') as any;
    expect(back.people.builder).toBeUndefined();
    expect(back.people.team.map((p: any) => p.name)).toEqual(['Avery Chen']);
  });

  it('a new person typed without @ can still be added by name (the AI saw it as typed), as a member', async () => {
    const { root, ai } = await setup([(d) => propose([{ op: 'role', name: 'Jane Roe', b: code(d, 'Idea', 'Procurement FAQ bot'), role: 'member' }])({})]);
    const entry = await runCommand(root, 'add Jane Roe to the procurement faq bot', ai, clock);
    expect(entry.actions.map((a) => a.label)).toEqual(['Make Jane Roe a team member on Procurement FAQ bot']);
    await doActions(root, entry.id, undefined, clock);
    expect((await loadIdea(root, 'CAFE-2026-002')).people.team).toContainEqual({ name: 'Jane Roe', role: 'member' });
  });
});

describe('the Café assistant: stars', () => {
  it('create a star with its link; remove a star with its links; both undo; form-owned stars get a pointer', async () => {
    const { root, ai } = await setup([(d) => (/remove/.test(d.message)
      ? propose([{ op: 'remove_star', a: code(d, 'Support') }])({})
      : propose([{ op: 'add_star', type: 'Capability', name: 'Contract clause finding', b: code(d, 'Idea', 'Desk booking assistant') }, { op: 'remove_star', a: 'P1' }])({}))]);
    await saveIdea(root, { ...IDEAS[0], support: ['Agent Design Guidance'] });
    const add = await runCommand(root, 'add a capability Contract clause finding to the desk booking assistant and drop Avery Chen', ai, clock);
    expect(add.actions.map((a) => a.label)).toEqual(['New capability: Contract clause finding, linked from Desk booking assistant (needs)']);
    expect(add.problems).toEqual(["People come from the ideas' teams: take Avery Chen off a team instead."]);
    await doActions(root, add.id, undefined, clock);
    expect(await rels(root)).toContain('idea:CAFE-2026-001 NEEDS capability:contract-clause-finding');
    const rm = await runCommand(root, 'remove the star Agent Design Guidance', ai, clock, { thread: add.thread });
    expect(rm.actions.map((a) => a.label)).toEqual(['Remove Agent Design Guidance and its 1 link']);
    await doActions(root, rm.id, undefined, clock);
    expect((await rebuildGraph(root)).nodes.some((n) => n.id === 'support:agent-design-guidance')).toBe(false);
    await undoChatAction(root, rm.id, 'a1', clock);
    expect(await rels(root)).toContain('idea:CAFE-2026-001 ASKS_FOR support:agent-design-guidance');
  });

  it('unlink hides a form link and merge moves links; both undo', async () => {
    const { root, ai } = await setup([(d) => (/unlink/.test(d.message)
      ? propose([{ op: 'unlink', a: code(d, 'Entity'), b: code(d, 'Team', 'BSI') }])({})
      : propose([{ op: 'merge', a: code(d, 'Team', 'BSI'), b: code(d, 'Team', 'GSS') }])({}))]);
    const u = await runCommand(root, 'unlink Corporate Services (CS) and BSI', ai, clock);
    expect(u.actions[0].label).toBe('Remove the link Corporate Services (CS) → BSI');
    await doActions(root, u.id, undefined, clock);
    expect(await rels(root)).not.toContain('entity:cs HAS_TEAM team:bsi');
    await undoChatAction(root, u.id, 'a1', clock);
    expect(await rels(root)).toContain('entity:cs HAS_TEAM team:bsi');
    const m = await runCommand(root, 'merge BSI into GSS', ai, clock);
    await doActions(root, m.id, undefined, clock);
    expect((await rebuildGraph(root)).edges.map((e) => e.id)).toContain('team:gss|HAS_MEMBER|person:avery-chen');
  });

  it('rounds already there are found by code', async () => {
    const { root, ai } = await setup([(d) => propose([{ op: 'round', ideas: [code(d, 'Idea', 'Desk booking assistant')], b: code(d, 'Round') }])({})]);
    const r = await createRound(root, '2026 Q4', clock);
    const entry = await runCommand(root, 'put CAFE-2026-001 in 2026 Q4', ai, clock);
    expect(entry.actions[0]).toMatchObject({ label: 'Put Desk booking assistant in 2026 Q4', action: { roundId: r.id } });
  });
});

import { startServer } from './helpers';
describe('the chat route', () => {
  it('streams progress lines then the message when asked (Accept: application/x-ndjson); plain JSON otherwise; lists conversations', async () => {
    const provider: Provider = {
      id: 'claude', label: 'Test AI', available: async () => true,
      complete: async (prompt: string) => JSON.stringify(/"steps":\[\]/.test(prompt)
        ? { next: 'search', thought: 'Every idea', query: { steps: [{ op: 'stars', type: 'Idea' }] } }
        : { next: 'answer', thought: 'Answering', reply: 'Two ideas.' }),
    };
    const s = await startServer('2026-10-22', { connector: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) });
    try {
      for (const i of IDEAS) await saveIdea(s.root, i);
      const res = await fetch(`${s.base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify({ text: 'how many ideas?' }) });
      const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.map((l) => l.type === 'progress' ? `${l.stage}${l.step?.found !== undefined ? `:${l.step.found}` : ''}` : l.type)).toEqual(['thinking', 'step:2', 'thinking', 'done']);
      expect(lines.at(-1).data).toMatchObject({ kind: 'question', reply: 'Two ideas.' });
      const plain = await (await fetch(`${s.base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'how many ideas?', thread: lines.at(-1).data.thread }) })).json() as any;
      expect(plain.thread).toBe(lines.at(-1).data.thread);
      const list = await (await fetch(`${s.base}/api/chat`)).json() as any;
      expect(list.threads).toHaveLength(1);
      expect(list.current.entries).toHaveLength(2);
    } finally { s.server.closeAllConnections(); await new Promise((r) => s.server.close(() => r(null))); }
  });
});
