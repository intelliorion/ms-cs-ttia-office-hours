import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { fixedClock } from '../src/clock';
import { createConnector, type Provider } from '../src/ai/connector';
import { DEFAULT_SETTINGS } from '../src/round/round';
import { rebuildGraph } from '../src/graph/store';
import { appendEdit, readEdits } from '../src/graph/operator';
import { buildGraph } from '../src/graph/build';
import { checkWorkspace } from '../src/graph/check';
import { toNodeLink, cycleRelations, runNetwork } from '../src/graph/network';
import { spawnSync } from 'node:child_process';
import { applyAction, undoAction, resolveSteps } from '../src/command/actions';
import { runCommand, doActions, undoChatAction } from '../src/command/chat';
import { runQuery, QUERY_GUIDE } from '../src/command/query';
import { readIdeaForAgent } from '../src/command/readIdea';
import { agentTask } from '../src/ai/tasks';
import { fakeProvider } from '../src/ai/providers/fake';
import {
  BUILTIN_ONTOLOGY, BUILTIN_SCHEMA, FORM_ONLY_RELATIONS, ORG_RELATIONS, operatorLinkProblem, type GNode, type OperatorEdit,
} from '../src/graph/ontology';

const clock = fixedClock('2026-11-02');
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a',
    people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'Technology', dedupe_key: 'b',
    people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', roles: ['lead'] }] } }),
];
const NAMES = /Avery|Chen|Kwame|Mensah|Jordan|Lee\b/;
const CS = 'entity:cs'; const TECH = 'entity:technology';
const edit = (id: string, e: Record<string, unknown>): OperatorEdit => ({ id, at: '2026-11-01', status: 'active', ...e } as OperatorEdit);
const leaders = (g: { edges: { from: string; rel: string; to: string }[] }, division: string) => g.edges.filter((e) => e.rel === 'LEADS_DIVISION' && e.to === division).map((e) => e.from).sort();

describe('a person leads a division: the relation', () => {
  it('is a stated Person → Entity relation, not form-only, that the operator may store by hand', () => {
    expect(BUILTIN_ONTOLOGY.relations.LEADS_DIVISION).toMatchObject({ from: 'Person', to: 'Entity', derived: false, inverse: 'is led by' });
    expect(BUILTIN_SCHEMA.stated).toContain('LEADS_DIVISION');
    expect(FORM_ONLY_RELATIONS).not.toContain('LEADS_DIVISION');
    expect(operatorLinkProblem('LEADS_DIVISION', 'Person', 'Entity')).toBeUndefined();
    expect(operatorLinkProblem('LEADS_DIVISION', 'Person', 'Team')).toMatch(/goes Person → Entity/);
  });
  it('is part of the org chart, so a leader on a team of their own division is never a dependency cycle', () => {
    expect(ORG_RELATIONS).toEqual(expect.arrayContaining(['HAS_TEAM', 'HAS_MEMBER', 'LEADS_DIVISION']));
    expect(cycleRelations(BUILTIN_SCHEMA)).toEqual([]);
  });
  it('the build keeps several leaders of one division and one person leading several divisions', () => {
    const g = buildGraph(IDEAS, [], [], [
      edit('op-1', { t: 'link', from: 'person:avery-chen', rel: 'LEADS_DIVISION', to: CS }),
      edit('op-2', { t: 'link', from: 'person:kwame-mensah', rel: 'LEADS_DIVISION', to: CS }),
      edit('op-3', { t: 'link', from: 'person:avery-chen', rel: 'LEADS_DIVISION', to: TECH }),
    ]);
    expect(g.refused).toEqual([]);
    expect(leaders(g, CS)).toEqual(['person:avery-chen', 'person:kwame-mensah']);
    expect(leaders(g, TECH)).toEqual(['person:avery-chen']);
    expect(g.edges.find((e) => e.rel === 'LEADS_DIVISION')).toMatchObject({ confirmed: true, description: 'Added by the operator' });
  });
  it('a leader on no idea is a star the operator added; once no division is left for them, the star goes', () => {
    const add = edit('op-1', { t: 'add', node: 'person:jordan-lee', type: 'Person', label: 'Jordan Lee' });
    const link = edit('op-2', { t: 'link', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: CS });
    const g = buildGraph(IDEAS, [], [], [add, link]);
    expect(g.refused).toEqual([]);
    expect(g.nodes.find((n) => n.id === 'person:jordan-lee')).toMatchObject({ type: 'Person', label: 'Jordan Lee' });
    expect(leaders(g, CS)).toEqual(['person:jordan-lee']);
    const gone = buildGraph(IDEAS, [], [], [add, { ...link, status: 'undone' }]);
    expect(gone.nodes.some((n) => n.id === 'person:jordan-lee')).toBe(false);
    expect(gone.refused).toEqual(["operator.jsonl op-1: add person:jordan-lee: a person comes only from an idea's team, or with the division they lead, and no division is left for them to lead (refused by the build)"]);
    // A person the ideas name stays whatever their leadership: only the operator's own star goes.
    const named = buildGraph(IDEAS, [], [], [edit('op-1', { t: 'add', node: 'person:avery-chen', type: 'Person', label: 'Avery Chen' })]);
    expect(named.nodes.some((n) => n.id === 'person:avery-chen')).toBe(true);
  });
  it('a person added any other way, or linked to anything but a division, is still refused', () => {
    const g = buildGraph(IDEAS, [], [], [
      edit('op-1', { t: 'add', node: 'person:jordan-lee', type: 'Person', label: 'Jordan Lee' }),
      edit('op-2', { t: 'link', from: 'person:jordan-lee', rel: 'LEADS', to: 'idea:CAFE-2026-001' }),
      edit('op-3', { t: 'remove', node: 'person:avery-chen' }),
    ]);
    expect(g.nodes.some((n) => n.id === 'person:jordan-lee')).toBe(false);
    expect(g.refused.join('\n')).toMatch(/op-2: link person:jordan-lee LEADS idea:CAFE-2026-001: LEADS comes only from the idea's record/);
    expect(g.refused.join('\n')).toMatch(/op-3: remove person:avery-chen/);
  });
  it('check names nothing for a leader the operator added', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    await appendEdit(root, edit('op-1', { t: 'add', node: 'person:jordan-lee', type: 'Person', label: 'Jordan Lee' }));
    await appendEdit(root, edit('op-2', { t: 'link', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: CS }));
    const r = await checkWorkspace(root);
    expect(r.violations).toEqual([]);
    expect(r.stale).toEqual([]);
  });
});

/** The codes the assistant would use, for the graph given. */
const ctxFor = (graph: { nodes: GNode[]; edges: any[] }, extra: GNode[] = []) => {
  const codes = new Map<string, any>();
  const all = [...graph.nodes, ...extra];
  for (const [c, id] of Object.entries({ P1: 'person:avery-chen', P2: 'person:kwame-mensah', P3: 'person:jordan-lee', E1: CS, E2: TECH, I1: 'idea:CAFE-2026-001', T1: 'team:bsi' })) {
    const n = all.find((x) => x.id === id); if (n) codes.set(c, { id, type: n.type, label: n.label });
  }
  return { codes, graph: { ...graph, nodes: all }, ideas: IDEAS, rounds: [] };
};

describe('a person leads a division: the assistant proposes, Do it does', () => {
  const graph = buildGraph(IDEAS, [], [], [edit('op-1', { t: 'link', from: 'person:kwame-mensah', rel: 'LEADS_DIVISION', to: TECH })]);
  const lead = (person: string, label: string, division: string, divisionLabel: string, isNew = false) =>
    ({ label: `Make ${label}${isNew ? ' (new to the graph)' : ''} a leader of ${divisionLabel}`, action: { t: 'division_lead', person: label, node: person, division } });

  it('link person and division, or role lead on a division: a card to make them its leader', () => {
    const r = resolveSteps([{ op: 'link', a: 'P1', b: 'E1' } as any, { op: 'role', a: 'P1', b: 'E2', role: 'lead' } as any], ctxFor(graph));
    expect(r.problems).toEqual([]);
    expect(r.proposals).toEqual([lead('person:avery-chen', 'Avery Chen', CS, 'Corporate Services (CS)'), lead('person:avery-chen', 'Avery Chen', TECH, 'Technology')]);
  });
  it('a person who is not a star yet goes by full name (typed or picked as new), and is added with the link', () => {
    const jordan: GNode = { id: 'person:jordan-lee', type: 'Person', label: 'Jordan Lee' };
    const typed = resolveSteps([{ op: 'role', name: 'Jordan Lee', b: 'E1', role: 'lead' } as any], ctxFor(graph));
    expect(typed.proposals).toEqual([lead('person:jordan-lee', 'Jordan Lee', CS, 'Corporate Services (CS)', true)]);
    const picked = resolveSteps([{ op: 'link', a: 'P3', b: 'E1', rel: 'LEADS_DIVISION' } as any], ctxFor(graph, [jordan]));
    expect(picked.proposals).toEqual([lead('person:jordan-lee', 'Jordan Lee', CS, 'Corporate Services (CS)', true)]);
    expect(resolveSteps([{ op: 'role', name: 'Jordan', b: 'E1', role: 'lead' } as any], ctxFor(graph)).problems).toEqual(["Give the person's full name to add them (or pick them with @)."]);
  });
  it('says why not: already its leader, or a role a division does not have', () => {
    const r = resolveSteps([{ op: 'link', a: 'P2', b: 'E2' } as any, { op: 'role', a: 'P1', b: 'E1', role: 'sponsor' } as any], ctxFor(graph));
    expect(r.proposals).toEqual([]);
    expect(r.problems).toEqual([
      'Kwame Mensah already leads Technology.',
      'A division has leaders only: say "make Avery Chen a leader of Corporate Services (CS)", or put them on an idea\'s team.',
    ]);
  });
  it('unlink person and division, or remove a leader on no idea: a card to take the leadership off', () => {
    const g = buildGraph(IDEAS, [], [], [
      edit('op-1', { t: 'link', from: 'person:kwame-mensah', rel: 'LEADS_DIVISION', to: TECH }),
      edit('op-2', { t: 'add', node: 'person:jordan-lee', type: 'Person', label: 'Jordan Lee' }),
      edit('op-3', { t: 'link', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: CS }),
    ]);
    const r = resolveSteps([{ op: 'unlink', a: 'P2', b: 'E2' } as any, { op: 'remove_star', a: 'P3' } as any], ctxFor(g));
    expect(r.problems).toEqual([]);
    expect(r.proposals.map((p) => [p.label, p.action])).toEqual([
      ['Kwame Mensah no longer leads Technology', { t: 'unlink', from: 'person:kwame-mensah', rel: 'LEADS_DIVISION', to: TECH, source: 'operator:op-1@2026-11-01' }],
      ['Jordan Lee no longer leads Corporate Services (CS)', { t: 'unlink', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: CS, source: 'operator:op-3@2026-11-01' }],
    ]);
  });

  it('Do it adds a new person with the link; Undo takes both back; an existing person gets the link only', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    const done = await applyAction(root, { t: 'division_lead', person: 'Jordan Lee', node: 'person:jordan-lee', division: CS }, clock);
    let g = await rebuildGraph(root);
    expect(g.nodes.find((n) => n.id === 'person:jordan-lee')?.label).toBe('Jordan Lee');
    expect(leaders(g, CS)).toEqual(['person:jordan-lee']);
    await undoAction(root, done.inverse!, clock);
    g = await rebuildGraph(root);
    expect(g.nodes.some((n) => n.id === 'person:jordan-lee')).toBe(false);
    expect(leaders(g, CS)).toEqual([]);
    const second = await applyAction(root, { t: 'division_lead', person: 'Avery Chen', node: 'person:avery-chen', division: CS }, clock);
    expect(second.inverse).toMatchObject({ t: 'edits-off', ids: [expect.any(String)] });
    expect(leaders(await rebuildGraph(root), CS)).toEqual(['person:avery-chen']);
    // Do it checks again: twice is refused, and so is a division that is not one.
    await expect(applyAction(root, { t: 'division_lead', person: 'Avery Chen', node: 'person:avery-chen', division: CS }, clock)).rejects.toThrow(/already leads/);
    await expect(applyAction(root, { t: 'division_lead', person: 'Avery Chen', node: 'person:avery-chen', division: 'team:bsi' }, clock)).rejects.toThrow(/not a division/);
    // Taking it off: the operator's link is switched off.
    await applyAction(root, { t: 'unlink', from: 'person:avery-chen', rel: 'LEADS_DIVISION', to: CS, source: 'operator:x' }, clock);
    expect(leaders(await rebuildGraph(root), CS)).toEqual([]);
    expect((await readEdits(root)).filter((e) => e.status === 'active' && e.t === 'link')).toEqual([]);
    // A leader the operator added goes with their last division, so check is left with nothing to say; Undo brings both back.
    await applyAction(root, { t: 'division_lead', person: 'Jordan Lee', node: 'person:jordan-lee', division: CS }, clock);
    await applyAction(root, { t: 'division_lead', person: 'Jordan Lee', node: 'person:jordan-lee', division: TECH }, clock);
    await applyAction(root, { t: 'unlink', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: TECH, source: 'operator:x' }, clock);
    expect((await rebuildGraph(root)).nodes.some((n) => n.id === 'person:jordan-lee')).toBe(true);
    const last = await applyAction(root, { t: 'unlink', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: CS, source: 'operator:x' }, clock);
    expect((await rebuildGraph(root)).nodes.some((n) => n.id === 'person:jordan-lee')).toBe(false);
    expect((await checkWorkspace(root)).violations).toEqual([]);
    await undoAction(root, last.inverse!, clock);
    expect(leaders(await rebuildGraph(root), CS)).toEqual(['person:jordan-lee']);
  });
});

type Turn = (data: any, prompt: string) => unknown;
async function setup(turns: Turn[]) {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  const prompts: string[] = [];
  let n = 0;
  const provider: Provider = {
    id: 'claude', label: 'Test AI', available: async () => true,
    complete: async (prompt: string) => {
      prompts.push(prompt);
      const data = JSON.parse(prompt.slice(prompt.indexOf('<<<DATA') + 7, prompt.indexOf('DATA>>>')));
      const out = turns[Math.min(n++, turns.length - 1)](data, prompt);
      return typeof out === 'string' ? out : JSON.stringify(out);
    },
  };
  return { root, prompts, ai: createConnector({ providers: [provider], settings: DEFAULT_SETTINGS }) };
}
const code = (data: any, type: string, label?: string) => data.stars.find((s: any) => s.type === type && (!label || s.label === label))?.code;

describe('a person leads a division: in the chat', () => {
  it('a new person picked with @ leads a division: the AI sees a code, the card waits for Do it, Undo takes it back', async () => {
    const { root, prompts, ai } = await setup([(d) => ({ next: 'propose', thought: 'Making a division leader', reply: 'You asked to make them a leader.', actions: [{ op: 'role', a: code(d, 'Person'), b: code(d, 'Entity', 'Corporate Services (CS)'), role: 'lead' }] })]);
    const entry = await runCommand(root, 'make @Jordan Lee a leader of the CS division', ai, clock, { mentions: ['new-person:Jordan Lee'] });
    expect(prompts.join('\n')).not.toMatch(NAMES);
    expect(prompts[0]).toContain('LEADS_DIVISION');
    expect(entry.actions).toEqual([expect.objectContaining({ status: 'proposed', label: 'Make Jordan Lee (new to the graph) a leader of Corporate Services (CS)' })]);
    expect(leaders(await rebuildGraph(root), CS)).toEqual([]);
    expect((await doActions(root, entry.id, undefined, clock)).actions[0].status).toBe('done');
    expect(leaders(await rebuildGraph(root), CS)).toEqual(['person:jordan-lee']);
    expect((await undoChatAction(root, entry.id, entry.actions[0].id, clock)).actions[0].status).toBe('undone');
    expect((await rebuildGraph(root)).nodes.some((n) => n.id === 'person:jordan-lee')).toBe(false);
  });

  it('"who leads the CS division" is answered from the graph by following LEADS_DIVISION', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    await applyAction(root, { t: 'division_lead', person: 'Avery Chen', node: 'person:avery-chen', division: CS }, clock);
    await applyAction(root, { t: 'division_lead', person: 'Kwame Mensah', node: 'person:kwame-mensah', division: CS }, clock);
    const graph = await rebuildGraph(root);
    const r = runQuery({ steps: [{ op: 'stars', codes: ['E1'] }, { op: 'follow', rel: 'LEADS_DIVISION', dir: 'in', type: 'Person' }] }, { graph, ideas: IDEAS, rounds: [], idOf: (c: string) => ({ E1: CS } as Record<string, string>)[c] });
    expect([...r.final].sort()).toEqual(['person:avery-chen', 'person:kwame-mensah']);
  });

  it('the chat answers "who leads" a division picked with @, names shown back to the operator', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    await applyAction(root, { t: 'division_lead', person: 'Avery Chen', node: 'person:avery-chen', division: CS }, clock);
    await applyAction(root, { t: 'division_lead', person: 'Jordan Lee', node: 'person:jordan-lee', division: CS }, clock);
    const ai = createConnector({ providers: [fakeProvider()], settings: DEFAULT_SETTINGS });
    const was = process.env.CAFE_AI_FAKE; process.env.CAFE_AI_FAKE = '1';
    let entry;
    try { entry = await runCommand(root, 'who leads @Corporate Services (CS)?', ai, clock, { mentions: [CS] }); } finally { if (was === undefined) delete process.env.CAFE_AI_FAKE; else process.env.CAFE_AI_FAKE = was; }
    expect(entry.reply).toBe('Corporate Services (CS) is led by Avery Chen and Jordan Lee.');
  });

  it('the query guide and the agent prompt say how a division is led', () => {
    expect(QUERY_GUIDE.join('\n')).toMatch(/Person LEADS_DIVISION Entity/);
    expect(QUERY_GUIDE.join('\n')).toContain('"rel":"LEADS_DIVISION","dir":"in","type":"Person"');
    const p = agentTask.prompt({ message: 'x', stars: [], steps: [], stepsLeft: 5 } as any);
    expect(p).toMatch(/a division b: role lead makes the person one of its leaders/);
  });

  it('read_idea says who leads the idea\'s division, by code', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, IDEAS[0]);
    const out = await readIdeaForAgent(root, IDEAS[0] as any, (s) => String(s).replace(/Jordan Lee/g, '[P9]'), { name: 'Corporate Services (CS)', leaders: ['Jordan Lee'] });
    expect(out.division).toEqual({ name: 'Corporate Services (CS)', leaders: ['[P9]'] });
  });

  it('NetworkX is sent the link (the division itself is left out of its analyses)', () => {
    const g = buildGraph(IDEAS, [], [], [edit('op-1', { t: 'link', from: 'person:avery-chen', rel: 'LEADS_DIVISION', to: CS })]);
    expect(toNodeLink(g, false).edges).toContainEqual(expect.objectContaining({ source: 'person:avery-chen', target: CS, rel: 'LEADS_DIVISION' }));
  });
});

const PY = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim();
describe.skipIf(!PY)('a person leads a division: NetworkX', () => {
  it('a leader on no idea is left out with the division, never reported as cut off from the rest', async () => {
    const g = buildGraph(IDEAS, [], [], [
      edit('op-1', { t: 'add', node: 'person:jordan-lee', type: 'Person', label: 'Jordan Lee' }),
      edit('op-2', { t: 'link', from: 'person:jordan-lee', rel: 'LEADS_DIVISION', to: CS }),
      edit('op-3', { t: 'link', from: 'person:avery-chen', rel: 'LEADS_DIVISION', to: CS }),
    ]);
    const without = buildGraph(IDEAS, [], [], []);
    const r = await runNetwork(g, ['isolated', 'stats']);
    const r0 = await runNetwork(without, ['isolated', 'stats']);
    expect(JSON.stringify(r.results.isolated)).not.toContain('person:jordan-lee');
    expect((r.results.isolated as any).components).toBe((r0.results.isolated as any).components);
  });
});
