import { describe, it, expect } from 'vitest';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { appendAiLink, rebuildGraph } from '../src/graph/store';
import { appendEdit } from '../src/graph/operator';
import { buildGraph } from '../src/graph/build';
import { makeRegistry, defaultEntries } from '../src/graph/registry';
import { applyAction, linkProposals, resolveSteps } from '../src/command/actions';
import { doActions, proposeLink } from '../src/command/chat';
import { reviewInput } from '../src/review/suggestInput';
import { fixedClock } from '../src/clock';
import type { AiLink, GNode } from '../src/graph/ontology';

const clock = fixedClock('2026-10-30');
const travel = sampleIdea({ id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'f', people: { submitter: 'Lucía Fernández', team: [] }, features: ['Policy question answering'], tools: { 'Policy question answering': 'Copilot Studio' } });
const faq = sampleIdea({ id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'g', people: { submitter: 'Kwame Mensah', team: [] }, features: ['Policy question answering', 'Contract lookup'], tools: {} });
const vendor = sampleIdea({ id: 'CAFE-2026-001', slug: 'vendor', title: 'Vendor contract summariser', function: 'GSS', entity: 'CS', dedupe_key: 'a', people: { submitter: 'Avery Chen', team: [] }, features: ['Contract lookup'], tools: {} });
const IDEAS = [vendor, travel, faq];
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', ...l });
const LINKS: AiLink[] = [
  ai({ from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:procurement-policy', idea: 'CAFE-2026-007', newNodes: [{ id: 'system:procurement-policy', type: 'System', label: 'Procurement policy' }] }),
  ai({ from: 'capability:contract-lookup', rel: 'USES_DATA', to: 'system:contract-library', idea: 'CAFE-2026-001', newNodes: [{ id: 'system:contract-library', type: 'System', label: 'Contract library' }] }),
];
const ctxFor = (graph: { nodes: GNode[]; edges: any[] }, focusIdea?: string) => {
  const codes = new Map<string, any>();
  for (const [c, id] of Object.entries({ I6: 'idea:CAFE-2026-006', I7: 'idea:CAFE-2026-007', C1: 'capability:policy-question-answering', S1: 'system:procurement-policy', T1: 'tool:copilot-studio', K1: 'capability:contract-lookup' })) {
    const n = graph.nodes.find((x) => x.id === id); if (n) codes.set(c, { id, type: n.type, label: n.label });
  }
  return { codes, graph, ideas: IDEAS, rounds: [], registry: makeRegistry(defaultEntries(), []), ...(focusIdea ? { focusIdea } : {}) };
};

describe('fault 3 in the assistant: a capability-level link names the idea it is for', () => {
  const graph = buildGraph(IDEAS, LINKS);
  it('with no idea on screen, one proposal per idea that needs the capability, each stamped, the note saying why', () => {
    const r = resolveSteps([{ op: 'link', a: 'C1', b: 'S1', rel: 'USES_DATA' } as any], ctxFor(graph));
    // 007 has it already (its read found it); 006 is offered on its own card.
    expect(r.proposals.map((p) => [p.label, p.action])).toEqual([
      ['Link Policy question answering → Procurement policy (uses the data) for Travel policy assistant', { t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:procurement-policy', idea: 'CAFE-2026-006' }],
    ]);
  });
  it('with an idea on screen, that idea; a link already stated for it is said so', () => {
    expect(resolveSteps([{ op: 'link', a: 'C1', b: 'S1' } as any], ctxFor(graph, 'CAFE-2026-006')).proposals[0].action).toMatchObject({ idea: 'CAFE-2026-006' });
    expect(resolveSteps([{ op: 'link', a: 'C1', b: 'S1' } as any], ctxFor(graph, 'CAFE-2026-007')).problems).toEqual(['Policy question answering already uses the data Procurement policy for Procurement FAQ bot.']);
    const g2 = buildGraph(IDEAS, [...LINKS, { ...LINKS[0], idea: 'CAFE-2026-006' }]);
    expect(resolveSteps([{ op: 'link', a: 'C1', b: 'S1' } as any], ctxFor(g2)).problems).toEqual(['Policy question answering already uses the data Procurement policy for Travel policy assistant, Procurement FAQ bot.']);
  });
  it('a new system on a capability two ideas need: two cards, each stamped; Do it on one gives only that idea the dependency', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    for (const l of LINKS) await appendAiLink(root, l);
    const g = await rebuildGraph(root);
    const r = resolveSteps([{ op: 'add_star', type: 'System', name: 'Policy portal', b: 'C1' } as any], ctxFor(g));
    expect(r.proposals.map((p) => p.label)).toEqual([
      'New system or data: Policy portal, linked from Policy question answering (uses the data) for Travel policy assistant',
      'New system or data: Policy portal, linked from Policy question answering (uses the data) for Procurement FAQ bot',
    ]);
    expect(r.proposals[0].note).toBe('Policy question answering is needed by 2 ideas: say Do it on each idea it holds for; a link holds only for the ideas it names.');
    await applyAction(root, r.proposals[0].action, clock);
    const after = await rebuildGraph(root);
    expect(after.edges.filter((e) => e.rel === 'DEPENDS_ON' && e.to === 'system:policy-portal').map((e) => e.from)).toEqual(['idea:CAFE-2026-006']);
  });
});

describe('fault 5: a derived link is not unlinked by hand', () => {
  const graph = buildGraph(IDEAS, LINKS);
  it('"unlink 006 from Copilot Studio" names the stored facts and offers to remove the idea\'s own need, never an unlink of the derived link', () => {
    const r = resolveSteps([{ op: 'unlink', a: 'I6', b: 'T1', rel: 'USES' } as any], ctxFor(graph));
    // The idea's own need comes from its design's features (the form's): round 5 refuses an unlink of it and says where it changes.
    expect(r.problems).toEqual([
      'Travel policy assistant → Copilot Studio (uses) is derived by needs+built_with from what the graph holds, so it can\'t be removed by itself: it rests on Travel policy assistant needs Policy question answering and Policy question answering built with Copilot Studio. Change one of those stored facts instead.',
      'Travel policy assistant needs Policy question answering comes from the form, so it is not removed by an unlink: it changes in the design\'s features (approach.md).',
    ]);
    expect(r.proposals).toEqual([]);
  });
  it('an unlink action on a derived relation is refused if it ever gets to Do it (it used to be logged and do nothing)', async () => {
    const root = await tmpWorkspace();
    await expect(applyAction(root, { t: 'unlink', from: 'idea:CAFE-2026-006', rel: 'USES', to: 'tool:copilot-studio', source: 'rule:needs+built_with' }, clock)).rejects.toThrow(/derived by the rules: remove one of the stored links/);
  });
});

describe('fault 10 in the assistant: a tool is never aliased to another product', () => {
  const graph = buildGraph(IDEAS, LINKS);
  it('"also know Copilot Studio as UiPath" (retired) or "Power Automate" (not approved) is refused; a plain other name is proposed', () => {
    const r = resolveSteps([{ op: 'alias', a: 'T1', name: 'UiPath' } as any, { op: 'alias', a: 'T1', name: 'power automate' } as any, { op: 'alias', a: 'T1', name: 'MCS' } as any], ctxFor(graph));
    expect(r.problems).toEqual([
      'UiPath is another tool, not on the approved list: it can\'t be another name of Copilot Studio. The approved list is the Café\'s own.',
      'Power Automate is another tool, not on the approved list: it can\'t be another name of Copilot Studio. The approved list is the Café\'s own.',
    ]);
    expect(r.proposals.map((p) => p.label)).toEqual(['Also know Copilot Studio as "MCS"']);
  });
});

describe('fault 13: an accepted NetworkX suggestion carries the idea it was suggested for', () => {
  it('a capability→system link proposed for 006 is stamped 006; with no idea, one card per idea that needs the capability (the checks every proposed link passes)', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    for (const l of LINKS) await appendAiLink(root, l);
    const graph = await rebuildGraph(root);
    const node = (id: string) => graph.nodes.find((n) => n.id === id)!;
    const pqa = node('capability:policy-question-answering'); const lib = node('system:contract-library');
    const one = linkProposals(graph, pqa, 'USES_DATA', lib, { named: 'CAFE-2026-006', suffix: ' · suggested by NetworkX' });
    expect('proposals' in one && one.proposals.map((p) => p.action)).toEqual([{ t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:contract-library', idea: 'CAFE-2026-006' }]);
    const each = linkProposals(graph, pqa, 'USES_DATA', lib, { suffix: ' · suggested by NetworkX' });
    expect('proposals' in each && each.proposals.map((p) => p.label)).toEqual([
      'Link Policy question answering → Contract library (uses the data) for Travel policy assistant · suggested by NetworkX',
      'Link Policy question answering → Contract library (uses the data) for Procurement FAQ bot · suggested by NetworkX',
    ]);
    expect(linkProposals(graph, pqa, 'USES_DATA', lib, { named: 'CAFE-2026-001' })).toEqual({ problem: expect.stringMatching(/does not need Policy question answering/) });
    // On the Propose route it is refused: NetworkX does not suggest it (Policy question answering shares no system with
    // Contract lookup, only an idea), so it cannot go out as NetworkX's suggestion.
    await expect(proposeLink(root, { from: pqa.id, rel: 'USES_DATA', to: lib.id, idea: 'CAFE-2026-006' }, clock)).rejects.toThrow(/NetworkX does not suggest/);
  });
});

describe('fault 4: the decision suggestion reads the idea\'s own systems, not every system its shared capabilities touch', () => {
  it('007 is sent Procurement policy (its own) and not Contract library (001\'s, through the shared Contract lookup)', async () => {
    const root = await tmpWorkspace();
    for (const i of IDEAS) await saveIdea(root, i);
    for (const l of LINKS) await appendAiLink(root, l);
    const { input } = await reviewInput(root, 'CAFE-2026-007');
    const systems = (input.graph ?? []).filter((g) => g.type === 'System').map((g) => g.label);
    expect(systems).toEqual(['Procurement policy']);
    // An operator's unscoped link on the shared capability does not reach it either.
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'add', node: 'system:policy-portal', type: 'System', label: 'Policy portal' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:policy-portal' });
    expect(((await reviewInput(root, 'CAFE-2026-007')).input.graph ?? []).filter((g) => g.type === 'System').map((g) => g.label)).toEqual(['Procurement policy']);
  });
});

import { runQuery } from '../src/command/query';
describe('an answer that rests on an unconfirmed link says so (c65: BSI "owns" an idea through a 0.5 AI link)', () => {
  it('the trace line and the reason of a derived link with an input waiting for Do it are marked not confirmed', () => {
    const links: AiLink[] = [ai({ from: 'capability:contract-lookup', rel: 'USES_DATA', to: 'system:teams-chat', idea: 'CAFE-2026-007', confidence: 0.5, status: 'pending', newNodes: [{ id: 'system:teams-chat', type: 'System', label: 'Teams chat' }] })];
    const g = buildGraph(IDEAS, links);
    const r = runQuery({ steps: [{ op: 'stars', codes: ['S1'] }, { op: 'follow', rel: 'DEPENDS_ON', dir: 'in', type: 'Idea' }] } as any, { graph: g, ideas: IDEAS, rounds: [], idOf: (c: string) => (c === 'S1' ? 'system:teams-chat' : undefined) } as any);
    expect(r.final).toEqual(['idea:CAFE-2026-007']);
    expect(r.trace.map((t) => t.text)).toContain('Procurement FAQ bot depends on Teams chat: derived by needs+uses_data from Procurement FAQ bot NEEDS Contract lookup, Contract lookup USES_DATA Teams chat; not confirmed: it rests on Contract lookup USES_DATA Teams chat (0.5) waiting for your Do it');
    expect(r.reasons).toEqual([{ from: 'idea:CAFE-2026-007', to: 'system:teams-chat', rel: 'DEPENDS_ON', why: 'via Contract lookup (not confirmed: waiting for your Do it)' }]);
  });
});
