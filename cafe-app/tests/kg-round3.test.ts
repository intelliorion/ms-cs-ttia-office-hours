import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea, startServer } from './helpers';
import { saveIdea, loadIdea } from '../src/ideas/store';
import { appendAiLink, readAiLinks, rebuildGraph, setAiLinkStatus } from '../src/graph/store';
import { appendEdit } from '../src/graph/operator';
import { buildGraph } from '../src/graph/build';
import { checkWorkspace } from '../src/graph/check';
import { infer, DEFAULT_RULES } from '../src/graph/rules';
import { canonId, nameKey, nodeId, type AiLink, type GEdge, type GNode } from '../src/graph/ontology';
import { makeRegistry } from '../src/graph/registry';
import { fixedClock } from '../src/clock';
import { runQuery, type Query } from '../src/command/query';
import { doActions, proposeLink, runCommand } from '../src/command/chat';
import { applyUpdate, planUpdates } from '../src/review/updates';
import { writeFileAtomic } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import { similarStarsChecked } from '../src/design/tools';
import type { Connector } from '../src/ai/connector';

const clock = fixedClock('2026-10-30');
const PY = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim();
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', ...l });

/** Four ideas like the practice workspace's: three share capabilities, the fourth sits apart. */
/** A second peer of the travel and desk assistants: link prediction wants two peers that each share two capabilities. */
const PEER = sampleIdea({ id: 'CAFE-2026-005', slug: 'rooms', title: 'Room booking helper', function: 'BSI', entity: 'CS', dedupe_key: 'e', features: ['Request handling', 'Policy answering', 'Booking update'], people: { submitter: 'Hana Kobayashi', team: [] } });
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a', features: ['Request handling', 'Booking update'],
    people: { submitter: 'Avery Chen', team: [{ name: 'Avery Chen', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'b', features: ['Request handling', 'Policy answering', 'Booking update'],
    people: { submitter: 'Kwame Mensah', team: [{ name: 'Kwame Mensah', roles: ['lead'] }] } }),
  sampleIdea({ id: 'CAFE-2026-003', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'c', features: ['Request handling', 'Policy answering'],
    people: { submitter: 'Zainab Okafor', team: [] } }),
  sampleIdea({ id: 'CAFE-2026-004', slug: 'lonely', title: 'Lonely ledger tool', function: 'TAX', entity: 'CS', dedupe_key: 'd', people: { submitter: 'Ingrid Solberg', team: [] } }),
];
async function workspace(): Promise<string> {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  // Request handling uses the shared mailbox for 001 only (the AI read 001 and found it).
  await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:shared-mailbox', idea: 'CAFE-2026-001', newNodes: [{ id: 'system:shared-mailbox', type: 'System', label: 'Shared mailbox' }] }));
  return root;
}
const post = (base: string, url: string, body: unknown) => fetch(`${base}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('must 1: a proposal "suggested by NetworkX" is one NetworkX suggested, and passes the same guards as the assistant (log 03-propose)', () => {
  it.each([
    ['SUBMITTED', 'person:avery-chen', 'idea:CAFE-2026-004'],
    ['HAS_MEMBER', 'team:bsi', 'person:kwame-mensah'],
    ['LEADS', 'person:avery-chen', 'idea:CAFE-2026-002'],
    ['BUILT_WITH', 'capability:request-handling', 'tool:copilot-studio'],
    ['DEPENDS_ON', 'idea:CAFE-2026-003', 'system:shared-mailbox'],
  ])('%s is refused on the Propose route; nothing is written', async (rel, from, to) => {
    const root = await workspace();
    await expect(proposeLink(root, { from, rel, to }, clock)).rejects.toThrow(/.+/);
    expect(await readFile(path.join(paths(root).chat, 'log.jsonl'), 'utf8').catch(() => '')).toBe('');
  });

  it.skipIf(!PY)('a NEEDS link NetworkX does not suggest is refused as its suggestion; one it does suggest is proposed with NetworkX\'s own reason', async () => {
    const root = await workspace(); await saveIdea(root, PEER);
    await expect(proposeLink(root, { from: 'idea:CAFE-2026-004', rel: 'NEEDS', to: 'capability:booking-update', why: 'made up' }, clock))
      .rejects.toThrow(/NetworkX does not suggest that Lonely ledger tool needs Booking update/);
    const e = await proposeLink(root, { from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update', why: 'made up' }, clock);
    expect(e.actions.map((a) => a.label)).toEqual(['Link Travel policy assistant → Booking update (needs) · suggested by NetworkX']);
    expect(e.reply).toMatch(/closest peers by weight/);
    expect(e.reply).not.toMatch(/made up/);
  });

  it('Do it checks the card again: a SUBMITTED or BUILT_WITH link or an idea put in the chat log by hand is not done', async () => {
    const root = await workspace();
    const entry = { id: 'c1', thread: 't1', at: '2026-10-30', ts: 1, text: 'x', reply: '', problems: [], actions: [
      { id: 'a1', label: 'x', status: 'proposed', action: { t: 'link', from: 'person:avery-chen', rel: 'SUBMITTED', to: 'idea:CAFE-2026-004' } },
      { id: 'a2', label: 'y', status: 'proposed', action: { t: 'link', from: 'capability:request-handling', rel: 'BUILT_WITH', to: 'tool:copilot-studio' } },
      { id: 'a3', label: 'z', status: 'proposed', action: { t: 'add_star', node: 'idea:CAFE-2026-999', type: 'Idea', label: 'Phantom', link: { from: 'idea:CAFE-2026-999', rel: 'NEEDS', to: 'capability:request-handling' } } },
    ] };
    await writeFileAtomic(path.join(paths(root).chat, 'log.jsonl'), JSON.stringify(entry) + '\n');
    const done = await doActions(root, 'c1', undefined, clock);
    expect(done.actions.map((a) => [a.status, a.note])).toEqual([
      ['failed', expect.stringMatching(/SUBMITTED comes only from the idea's record/)],
      ['failed', expect.stringMatching(/BUILT_WITH comes only from the tool picker/)],
      ['failed', expect.stringMatching(/an idea comes only from the form/)],
    ]);
    expect(await readFile(path.join(paths(root).graph, 'operator.jsonl'), 'utf8').catch(() => '')).toBe('');
  });

  it('an operator SUBMITTED link already in the log (op-15 of the retest) is refused by the build and named by check; no OWNS comes of it', async () => {
    const root = await workspace();
    await appendEdit(root, { id: 'op-15', at: '2026-10-30', status: 'active', t: 'link', from: 'person:avery-chen', rel: 'SUBMITTED', to: 'idea:CAFE-2026-004' });
    const g = await rebuildGraph(root);
    expect(g.edges.some((e) => e.id === 'person:avery-chen|SUBMITTED|idea:CAFE-2026-004')).toBe(false);
    expect(g.edges.some((e) => e.id === 'team:bsi|OWNS|idea:CAFE-2026-004')).toBe(false);
    const line = "operator.jsonl op-15: link person:avery-chen SUBMITTED idea:CAFE-2026-004: SUBMITTED comes only from the idea's record (its submitter and team), never from a link (refused by the build)";
    expect(g.problems.map((p) => p.message)).toContain(line);
    expect((await checkWorkspace(root)).violations).toContain(line);
  });
});

describe('must 2: nothing below the threshold is confirmed without Do it, whoever wrote it', () => {
  it('a link stored as confirmed at 0.5 (the 11 in the practice workspace) counts as waiting; the operator\'s Do it confirms it', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update', confidence: 0.5, idea: 'CAFE-2026-003' }));
    const id = 'idea:CAFE-2026-003|NEEDS|capability:booking-update';
    expect((await rebuildGraph(root)).edges.find((e) => e.id === id)?.confirmed).toBe(false);
    await setAiLinkStatus(root, id, 'confirmed', '2026-10-30');
    expect((await readAiLinks(root)).links.at(-1)).toMatchObject({ status: 'confirmed', confirmedBy: 'operator', confirmedAt: '2026-10-30' });
    expect((await rebuildGraph(root)).edges.find((e) => e.id === id)?.confirmed).toBe(true);
  });

  it('settings graph.confirmAt is the build\'s threshold too', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:booking-update', confidence: 0.8, idea: 'CAFE-2026-003' }));
    await writeFileAtomic(paths(root).settings, 'graph:\n  confirmAt: 0.85\n');
    expect((await rebuildGraph(root)).edges.find((e) => e.id === 'idea:CAFE-2026-003|NEEDS|capability:booking-update')?.confirmed).toBe(false);
  });

  it('an answer\'s graph link (review updates) below the threshold is planned and applied as waiting, never confirmed', async () => {
    const root = await workspace();
    const idea = await loadIdea(root, 'CAFE-2026-003');
    const updates = await planUpdates(root, idea, { graph: { nodes: [], links: [{ from: 'idea', to: 'Booking update', rel: 'NEEDS', description: 'maybe', confidence: 0.5 }] } } as any, new Map(), 'fake');
    const u = updates.find((x) => x.kind === 'link')!;
    expect(u.link!.status).toBe('pending');
    expect(u.label).toMatch(/waits for your Do it/);
    await applyUpdate(root, 'CAFE-2026-003', u, clock, { by: 'app', source: 'review answers' });
    expect((await readAiLinks(root)).links.at(-1)).toMatchObject({ status: 'pending', confidence: 0.5 });
    expect((await rebuildGraph(root)).edges.find((e) => e.id === 'idea:CAFE-2026-003|NEEDS|capability:booking-update')?.confirmed).toBe(false);
    // A confirmed-looking update planned before the fix is applied as waiting too.
    await applyUpdate(root, 'CAFE-2026-003', { ...u, link: { ...u.link!, to: 'capability:policy-answering', status: 'confirmed' } }, clock, { by: 'app', source: 'review answers' });
    expect((await readAiLinks(root)).links.at(-1)).toMatchObject({ status: 'pending' });
  });
});

describe('must 3 and 4: phantom ideas and links with no source never reach the graph (log 05-c3-attacks)', () => {
  it.each([
    ['Idea', 'idea:CAFE-2026-999', /an idea comes only from the form/],
    ['Round', 'round:fake', /a round is made in the Rounds pop-out/],
    ['Person', 'person:evil', /a person comes only from an idea's team/],
    ['Tool', 'tool:uipath', /a tool comes only from the tool picker/],
  ])('an operator add of a %s is refused at build and reported', async (type, node, why) => {
    const root = await workspace();
    await appendEdit(root, { id: 'op-1', at: '2026-10-30', status: 'active', t: 'add', node, type: type as any, label: 'Phantom' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-30', status: 'active', t: 'link', from: 'idea:CAFE-2026-999', rel: 'NEEDS', to: 'capability:request-handling' });
    const g = await rebuildGraph(root);
    expect(g.nodes.some((n) => n.id === node)).toBe(false);
    expect(g.edges.some((e) => e.from === 'idea:CAFE-2026-999' || e.to === 'idea:CAFE-2026-999')).toBe(false);
    expect(g.problems.map((p) => p.message).join('\n')).toMatch(why);
    expect((await checkWorkspace(root)).violations.join('\n')).toMatch(why);
  });

  it.each([
    ['', /source is empty/],
    ['   ', /source is empty/],
    ['form:CAFE-2026-001:Feature', /is not an AI read/],
    ['operator', /is not an AI read/],
    ['ai:', /is not an AI read/],
  ])('an AI link with source %j is dropped from the graph and reported', async (source, why) => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-004', rel: 'NEEDS', to: 'capability:booking-update', source }));
    const g = await rebuildGraph(root);
    expect(g.edges.some((e) => e.id === 'idea:CAFE-2026-004|NEEDS|capability:booking-update')).toBe(false);
    expect(g.problems.map((p) => p.message).join('\n')).toMatch(why);
    expect((await checkWorkspace(root)).violations).toEqual([expect.stringMatching(new RegExp(`^ai-links\\.jsonl line 2: .*${why.source}.*\\(dropped by the build\\)$`))]);
  });
});

describe('must 5: one normal form for a name, id and lookup alike (log 06-entity-resolution)', () => {
  // The practice workspace: the policy star added by hand, "travel policy" and "T&E policy" its aliases.
  const registry = makeRegistry({}, [
    { id: 'op-4', at: '', status: 'active', t: 'alias', node: 'system:travel-expense-policy', label: 'travel policy', of: 'Travel & Expense policy' },
    { id: 'op-8', at: '', status: 'active', t: 'alias', node: 'system:travel-expense-policy', label: 'T&E policy', of: 'Travel & Expense policy' },
  ]);
  const star = (label: string) => registry.resolve('System', label)?.id ?? nodeId('System', label);
  const POLICY = 'system:travel-expense-policy';
  it.each([
    ['T&E policy', POLICY], ['travel policy', POLICY], ['Travel & Expense policy', POLICY], ['Travel and Expense policy', POLICY],
    ['travel & expense POLICY', POLICY], ['T and E policy', POLICY], ['T+E policy', POLICY], ['T & E policy', POLICY], ['T&E Policy', POLICY],
    ['TandE policy', POLICY], ['T/E policy', POLICY], ['Travel & Expenses policy', POLICY], ['Travel and Expenses Policy', POLICY],
    ['travel expense policy', POLICY], ['Travel-Expense policy', POLICY], ['T-and-E policy', POLICY], ['T&amp;E policy', POLICY],
    ['Travel policies', POLICY], ['travel  policy', POLICY], ['Trável policy', POLICY],
    // Different things stay apart.
    ['travel policy document', 'system:travel-policy-document'], ['Travel policy PDF', 'system:travel-policy-pdf'],
    ['Travel & Expense Policy (2026)', 'system:travel-expense-policy-2026'], ['Expense policy', 'system:expense-policy'], ['policy', 'system:policy'],
  ])('System "%s" is %s', (label, id) => {
    expect(star(label)).toBe(id);
    // The lookup key and the id part are one thing.
    expect(nodeId('System', label)).toBe(`system:${nameKey(label, 'System')}`);
  });
  it('email, e-mail and E-mail are one star; Outlook and a mailbox are others (a mailbox is a kind of email system: see KIND_OF)', () => {
    expect(new Set(['Email', 'e-mail', 'E-mail'].map((l) => nodeId('System', l)))).toEqual(new Set(['system:email']));
    expect(nodeId('System', 'Outlook')).toBe('system:outlook');
    expect(nodeId('System', 'mailbox')).toBe('system:mailbox');
  });
  it('dotted initials are the bare initials: G.S.S. is GSS; C++, C# and C stay three', () => {
    expect(nodeId('Team', 'G.S.S.')).toBe(nodeId('Team', 'GSS'));
    expect(new Set([nodeId('Capability', 'C++ coding'), nodeId('Capability', 'C# coding'), nodeId('Capability', 'C coding')]).size).toBe(3);
  });
  it('people: the exact name (case and spacing aside), never accents folded', () => {
    expect(nodeId('Person', 'Lucía Fernández')).toBe('person:lucía-fernández');
    expect(nodeId('Person', 'Lucia Fernandez')).toBe('person:lucia-fernandez');
    expect(nodeId('Person', 'lucía  fernández')).toBe('person:lucía-fernández');
    expect(nodeId('Person', 'Fernández, Lucía')).not.toBe(nodeId('Person', 'Lucía Fernández'));
  });
  it('tools: the names people use, never a not-approved tool', async () => {
    const { defaultEntries } = await import('../src/graph/registry');
    const r = makeRegistry(defaultEntries(), []);
    expect(r.resolve('Tool', 'MS Copilot')?.id).toBe('tool:microsoft-copilot');
    expect(r.resolve('Tool', 'Power-App')?.id).toBe('tool:power-apps');
    expect(r.resolve('Tool', 'Microsoft Copilot Studio')?.id).toBe('tool:copilot-studio');
    expect(r.resolve('Tool', 'UiPath')).toBeUndefined();
  });
  it('ids written in an older form name the same star: an AI link to system:t-e-policy and capability:deadline-tracking-and-alerting', () => {
    expect(canonId('system:t-e-policy')).toBe(POLICY);
    expect(canonId('capability:deadline-tracking-and-alerting')).toBe('capability:deadline-tracking-alerting');
    expect(canonId('system:team-onboarding-checklists')).toBe('system:team-onboarding-checklist');
    expect(canonId('idea:CAFE-2026-001')).toBe('idea:CAFE-2026-001');
    const idea = sampleIdea({ features: ['Deadline tracking and alerting'] });
    const g = buildGraph([idea], [ai({ from: 'capability:deadline-tracking-and-alerting', rel: 'USES_DATA', to: 'system:team-onboarding-checklists', idea: 'CAFE-2026-001', newNodes: [{ id: 'system:team-onboarding-checklists', type: 'System', label: 'Team onboarding checklists' }] })]);
    expect(g.edges.find((e) => e.rel === 'DEPENDS_ON')?.id).toBe('idea:CAFE-2026-001|DEPENDS_ON|system:team-onboarding-checklist');
  });
  it('an older accent-folded person id in an operator edit still names the person', () => {
    const idea = sampleIdea({ people: { submitter: 'Lucía Fernández', team: [] }, function: 'GSS' });
    const g = buildGraph([idea], [], [], [{ id: 'op-1', at: '', status: 'active', t: 'link', from: 'team:gss', rel: 'HAS_MEMBER', to: 'person:lucia-fernandez' }]);
    expect(g.edges.filter((e) => e.rel === 'HAS_MEMBER').map((e) => e.to)).toEqual(['person:lucía-fernández']);
    expect(g.nodes.some((n) => n.id === 'person:lucia-fernandez')).toBe(false);
  });
  it('check names two stars of one kind whose names read the same', async () => {
    const root = await workspace();
    await appendEdit(root, { id: 'op-1', at: '', status: 'active', t: 'add', node: 'system:tep', type: 'System', label: 'Travel & Expense policy' });
    await appendEdit(root, { id: 'op-2', at: '', status: 'active', t: 'add', node: 'system:travel-expense-policy', type: 'System', label: 'T&E policy' });
    expect((await checkWorkspace(root)).violations).toContain('graph: system:tep and system:travel-expense-policy: two System stars with one name ("travel-expense-policy"): merge them');
  });
});

describe('must 6: the rules and the checks that were still loose', () => {
  const n = (id: string, type: GNode['type'], label = id): GNode => ({ id, type, label });
  const e = (from: string, rel: GEdge['rel'], to: string, extra: Partial<GEdge> = {}): GEdge => ({ id: `${from}|${rel}|${to}`, from, rel, to, description: '', source: 'form:x', confidence: 1, confirmed: true, ...extra });

  it('the main derivation is the same-idea one, even when a looser way is surer', () => {
    const nodes = [n('idea:A', 'Idea'), n('idea:B', 'Idea'), n('capability:c', 'Capability'), n('capability:d', 'Capability'), n('system:s', 'System')];
    const edges = [
      e('idea:A', 'NEEDS', 'capability:c', { confidence: 0.75 }), e('capability:c', 'USES_DATA', 'system:s', { ideas: ['A'], confidence: 0.75 }),
      e('idea:A', 'NEEDS', 'capability:d'), e('capability:d', 'USES_DATA', 'system:s', { ideas: ['B'] }),
    ];
    const rules = [{ name: 'any', kind: 'chain' as const, chain: ['NEEDS', 'USES_DATA'] as GEdge['rel'][], then: 'DEPENDS_ON' as const, scope: 'any' as const, enabled: true }];
    const d = infer(nodes, edges, rules).find((x) => x.id === 'idea:A|DEPENDS_ON|system:s')!;
    // Through d (stated for B, surer) is only the other way; through c (stated for A) is the main one.
    expect(d.derived!.inputs).toEqual(['idea:A|NEEDS|capability:c', 'capability:c|USES_DATA|system:s']);
    expect(d.derived!.alternatives).toEqual([['idea:A|NEEDS|capability:d', 'capability:d|USES_DATA|system:s']]);
    expect(d.ideas).toEqual(['A']);
  });

  it('SIMILAR_TO is confirmed when at least min of the shared stars are confirmed for both ideas', () => {
    const nodes = [n('idea:A', 'Idea'), n('idea:B', 'Idea'), n('capability:x', 'Capability'), n('capability:y', 'Capability'), n('capability:z', 'Capability')];
    const edges = [
      e('idea:A', 'NEEDS', 'capability:x'), e('idea:B', 'NEEDS', 'capability:x'), e('idea:A', 'NEEDS', 'capability:y'), e('idea:B', 'NEEDS', 'capability:y'),
      e('idea:A', 'NEEDS', 'capability:z'), e('idea:B', 'NEEDS', 'capability:z', { confirmed: false, confidence: 0.5 }),
    ];
    expect(infer(nodes, edges, DEFAULT_RULES).find((x) => x.rel === 'SIMILAR_TO')?.confirmed).toBe(true);
    edges[3] = { ...edges[3], confirmed: false };
    expect(infer(nodes, edges, DEFAULT_RULES).find((x) => x.rel === 'SIMILAR_TO')?.confirmed).toBe(false);
  });

  it('a merge of two kinds is refused at build and reported', async () => {
    const root = await workspace();
    await appendEdit(root, { id: 'op-1', at: '', status: 'active', t: 'merge', from: 'capability:booking-update', into: 'system:shared-mailbox' });
    const g = await rebuildGraph(root);
    expect(g.nodes.some((x) => x.id === 'capability:booking-update')).toBe(true);
    const line = 'operator.jsonl op-1: merge capability:booking-update into system:shared-mailbox: a capability and a system are different kinds of star, and only stars of one kind merge (refused by the build)';
    expect(g.problems.map((p) => p.message)).toContain(line);
    expect((await checkWorkspace(root)).violations).toContain(line);
  });

  it('ontology.yaml and inference.yaml problems are in /api/graph (the UI banner reads them)', async () => {
    const s = await startServer();
    try {
      await writeFileAtomic(paths(s.root).ontology, 'nodes: [a: {');
      await writeFileAtomic(paths(s.root).inference, 'rules:\n  - name: x\n    chain: [NEEDS]\n    then: DEPENDS_ON\n');
      const g = await (await fetch(`${s.base}/api/graph`)).json() as any;
      const msgs = g.problems.map((p: any) => p.message);
      expect(msgs.some((m: string) => /^ontology\.yaml could not be read \(.+\): the built-in ontology applies until it is fixed$/.test(m))).toBe(true);
      expect(msgs).toContain('inference.yaml: x: a chain needs two or more relations (dropped)');
      await writeFileAtomic(paths(s.root).ontology, 'relations:\n  NEEDS: { from: Idea, to: Gadget }\n');
      const g2 = await (await fetch(`${s.base}/api/graph`)).json() as any;
      expect(g2.problems.map((p: any) => p.message)).toContain('ontology.yaml: NEEDS: unknown node type "Gadget" (the pair is kept as built in)');
    } finally { s.server.close(); }
  });

  it('entities.yaml and alias edits that name a not-approved tool as an approved one are reported', async () => {
    const root = await workspace();
    await writeFileAtomic(paths(root).entities, 'Tool:\n  - id: tool:copilot-studio\n    label: Copilot Studio\n    aliases: [UiPath]\n');
    await appendEdit(root, { id: 'op-1', at: '', status: 'active', t: 'alias', node: 'tool:power-apps', label: 'Power Automate', of: 'Power Apps' });
    const v = (await checkWorkspace(root)).violations;
    expect(v).toContain('entities.yaml: Tool: "tool:copilot-studio": alias "UiPath" names UiPath, which is not on the approved list: an approved tool\'s name would make it look approved (remove it)');
    expect(v).toContain('operator.jsonl op-1: alias "Power Automate" on tool:power-apps names Power Automate, which is not on the approved list: an approved tool\'s name would make it look approved (switch the edit off)');
  });

  it('two features of one tool pick that look like one thing are flagged', async () => {
    const root = await tmpWorkspace();
    const idea = sampleIdea({ features: ['Invoice reading', 'Invoice reading and matching', 'Approval routing'] });
    await saveIdea(root, idea);
    const r = await similarStarsChecked(root, idea);
    expect(r.similar).toEqual(expect.arrayContaining([expect.objectContaining({ feature: 'Invoice reading and matching', star: 'Invoice reading', samePick: true })]));
    expect(r.similar.some((x) => x.feature === 'Approval routing')).toBe(false);
  });
});

describe('must 7: follow over two hops keeps to the ideas each link is stated for (bug 12)', () => {
  it('System ← USES_DATA ← Capability ← NEEDS ← Idea reaches only the ideas the USES_DATA link is stated for', async () => {
    const root = await workspace();
    const g = await rebuildGraph(root);
    const world = { graph: g, ideas: IDEAS, rounds: [], idOf: () => undefined };
    const q: Query = { steps: [{ op: 'stars', type: 'System', match: 'Shared mailbox' }, { op: 'follow', rel: 'USES_DATA', dir: 'in', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea' }] };
    const r = runQuery(q, world);
    // Request handling is needed by 001, 002 and 003, but uses the mailbox for 001 only: the derived DEPENDS_ON agrees.
    expect(r.final).toEqual(['idea:CAFE-2026-001']);
    expect(g.edges.filter((e) => e.rel === 'DEPENDS_ON').map((e) => e.from)).toEqual(['idea:CAFE-2026-001']);
    expect(r.trace[2].text).toMatch(/kept to the ideas each link is stated for \(2 links stated for other ideas not followed\)/);
    // From an idea outwards too: 002's capabilities reach no system, since none is stated for 002.
    expect(runQuery({ steps: [{ op: 'stars', type: 'Idea', match: 'Procurement FAQ bot' }, { op: 'follow', rel: 'NEEDS', type: 'Capability' }, { op: 'follow', rel: 'USES_DATA', type: 'System' }] }, world).final).toEqual([]);
    // Shared-capability questions still cross ideas (NEEDS is each idea's own link).
    const shared = runQuery({ steps: [{ op: 'stars', type: 'Idea', match: 'Desk booking assistant' }, { op: 'follow', rel: 'NEEDS', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea' }] }, world);
    expect(shared.final.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
  });
});

describe('must 7: no answer takes minutes', () => {
  /** A connector whose agent never answers in time: each call takes all the time it is given, then fails as a timeout. */
  const hanging = (): Connector => ({
    status: async () => ({ provider: 'fake', label: 'Hang' }), choices: async () => [],
    run: async () => { throw new Error('no'); }, look: async () => { throw new Error('no'); },
    runWith: async (_t, _i, opts) => { await new Promise((r) => setTimeout(r, opts?.timeoutMs ?? 60_000)); throw new Error(`Hang timed out after ${Math.round((opts?.timeoutMs ?? 0) / 1000)} s`); },
  });
  it('the whole answer stops at its deadline with a clear message and the trace so far; nothing runs past it', async () => {
    const root = await workspace();
    const t0 = Date.now();
    const e = await runCommand(root, 'Which ideas would be affected if the T&E policy changed?', hanging(), clock, { deadlineMs: 10_000 });
    expect(Date.now() - t0).toBeLessThan(11_500);
    expect(e.error).toMatch(/^This answer was stopped at its deadline of 10 s \(assistant\.deadlineSeconds in rules\/settings\.yaml\), after 0 searches\. Nothing was changed\./);
    expect(e.trace?.at(-1)?.[0].text).toMatch(/^Stopped at the answer's deadline \(10 s\) after \d+ s$/);
  }, 20_000);

  it('an answer does not wait behind a slow write: /api/chat is outside the server\'s write lock', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // The agent answers at once; every other task (here the decision suggestion) waits until released.
    const connector: Connector = {
      status: async () => ({ provider: 'fake', label: 'Gate' }), choices: async () => [], look: async () => { throw new Error('no'); },
      run: async () => { await gate; throw new Error('released'); },
      runWith: async (task: any) => {
        if (task.name === 'agent') return { provider: 'fake', label: 'Gate', output: { next: 'answer', thought: 't', reply: 'Quick answer.' } as any };
        await gate; throw new Error('released');
      },
    };
    const s = await startServer('2026-10-30', { connector });
    try {
      for (const i of IDEAS) await saveIdea(s.root, i);
      const slow = post(s.base, '/api/ai/review-suggest', { id: 'CAFE-2026-001' });
      await new Promise((r) => setTimeout(r, 200));
      const t0 = Date.now();
      const chat = await (await post(s.base, '/api/chat', { text: 'Which ideas need Request handling?' })).json() as any;
      expect(Date.now() - t0).toBeLessThan(3_000);
      expect(chat.reply).toBe('Quick answer.');
      release();
      await slow;
    } finally { release(); s.server.closeAllConnections(); s.server.close(); }
  });
});

describe('should 8: an open schema, and a system counted with its kinds (KIND_OF)', () => {
  const ONTOLOGY = [
    'nodes:',
    '  Vendor: { label: Vendor, colour: "#334455", description: A company that supplies a capability. }',
    'relations:',
    '  SUPPLIED_BY: { from: Capability, to: Vendor, meaning: the capability is supplied by this vendor, inverse: supplies, derived: false }',
    '  RELIES_ON_VENDOR: { from: Idea, to: Vendor, meaning: the idea relies on this vendor (derived), derived: true }',
  ].join('\n');
  const RULES = [
    'rules:',
    '  - { name: needs+uses_data, chain: [NEEDS, USES_DATA], then: DEPENDS_ON, scope: same-idea }',
    '  - { name: needs+supplied_by, chain: [NEEDS, SUPPLIED_BY], then: RELIES_ON_VENDOR, scope: same-idea }',
  ].join('\n');

  it('ontology.yaml declares a kind and two relations; a rule chains them; the operator\'s facts make the derived link; check holds it to the schema', async () => {
    const root = await workspace();
    await writeFileAtomic(paths(root).ontology, ONTOLOGY);
    await writeFileAtomic(paths(root).inference, RULES);
    await appendEdit(root, { id: 'op-1', at: '2026-10-30', status: 'active', t: 'add', node: 'vendor:acme', type: 'Vendor' as any, label: 'Acme' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-30', status: 'active', t: 'link', from: 'capability:booking-update', rel: 'SUPPLIED_BY' as any, to: 'vendor:acme', idea: 'CAFE-2026-002' });
    const g = await rebuildGraph(root);
    expect(g.nodes.find((n) => n.id === 'vendor:acme')).toMatchObject({ type: 'Vendor', label: 'Acme' });
    const d = g.edges.filter((e) => (e.rel as string) === 'RELIES_ON_VENDOR');
    // Scoped as every capability-level fact: 002's link holds for 002, not for 001 that also needs Booking update.
    expect(d.map((e) => [e.from, e.to, e.derived?.rule])).toEqual([['idea:CAFE-2026-002', 'vendor:acme', 'needs+supplied_by']]);
    const c = await checkWorkspace(root);
    expect(c.violations).toEqual([]);
    expect(c.checked.derived).toBeGreaterThan(0);
    // A link of the declared relation between the wrong kinds is refused like any other.
    await appendEdit(root, { id: 'op-3', at: '2026-10-30', status: 'active', t: 'link', from: 'idea:CAFE-2026-001', rel: 'SUPPLIED_BY' as any, to: 'vendor:acme' });
    expect((await checkWorkspace(root)).violations).toEqual(['operator.jsonl op-3: SUPPLIED_BY goes Capability → Vendor, not Idea → Vendor (skipped by the build)']);
  });

  it('declarations that do not hold are named by check and ignored', async () => {
    const root = await workspace();
    await writeFileAtomic(paths(root).ontology, [
      'nodes:', '  vendor: { label: v }', '  Painpoint: { label: P }', '  Gadget: {}',
      'relations:', '  supplied: { from: Capability, to: System, meaning: m }', '  NEW_ONE: { from: Capability, to: Widget, meaning: m }',
      '  NO_MEANING: { from: Capability, to: System }', '  ODD: { from: Capability, to: System, meaning: m, derived: maybe }',
    ].join('\n'));
    expect((await checkWorkspace(root)).violations).toEqual([
      'ontology.yaml: node type "vendor": a new kind needs a name like "Vendor" (a capital, then letters or digits) (ignored)',
      'ontology.yaml: node type "Painpoint": its ids would start with "painpoint:", which another kind uses (ignored)',
      'ontology.yaml: node type "Gadget": a new kind needs a label (ignored)',
      'ontology.yaml: relation "supplied": a new relation needs a name like "SUPPLIED_BY" (capitals, digits and _) (ignored)',
      'ontology.yaml: relation "NEW_ONE": unknown node type "Widget" (ignored)',
      'ontology.yaml: relation "NO_MEANING": a new relation needs a meaning (ignored)',
      'ontology.yaml: relation "ODD": derived must be true or false (ignored)',
    ]);
    // A rule over an undeclared relation is dropped, said so.
    await writeFileAtomic(paths(root).inference, 'rules:\n  - { name: r, chain: [NEEDS, SUPPLIED_BY], then: DEPENDS_ON }\n');
    expect((await checkWorkspace(root)).violations).toContain('inference.yaml: r: unknown relation "SUPPLIED_BY" (dropped)');
  });

  it('a mailbox that is a kind of email: the rules derive DEPENDS_ON email, and "which ideas do not depend on email" counts it', async () => {
    const root = await workspace();
    // 001's Request handling uses the shared mailbox; the operator says a shared mailbox is a kind of email system.
    await appendEdit(root, { id: 'op-1', at: '2026-10-30', status: 'active', t: 'add', node: 'system:email', type: 'System', label: 'Email' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-30', status: 'active', t: 'link', from: 'system:shared-mailbox', rel: 'KIND_OF', to: 'system:email' });
    const g = await rebuildGraph(root);
    const dep = g.edges.find((e) => e.id === 'idea:CAFE-2026-001|DEPENDS_ON|system:email')!;
    expect(dep.derived).toMatchObject({ rule: 'needs+uses_data', inputs: ['idea:CAFE-2026-001|NEEDS|capability:request-handling', 'capability:request-handling|USES_DATA|system:shared-mailbox', 'system:shared-mailbox|KIND_OF|system:email'] });
    expect(dep.description).toBe('via Request handling, Shared mailbox being a kind of Email');
    expect(dep.ideas).toEqual(['CAFE-2026-001']);
    const world = { graph: g, ideas: IDEAS, rounds: [], idOf: () => undefined };
    const deps = runQuery({ steps: [{ op: 'stars', type: 'System', match: 'Email' }, { op: 'follow', rel: 'DEPENDS_ON', dir: 'in', type: 'Idea' }] }, world);
    expect(deps.final).toEqual(['idea:CAFE-2026-001']);
    const notDeps = IDEAS.map((i) => `idea:${i.id}`).filter((id) => !deps.final.includes(id));
    expect(notDeps).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-003', 'idea:CAFE-2026-004']);
    // A follow along a stated relation from Email also starts from its kinds, and says so.
    const caps = runQuery({ steps: [{ op: 'stars', type: 'System', match: 'Email' }, { op: 'follow', rel: 'USES_DATA', dir: 'in', type: 'Capability' }] }, world);
    expect(caps.final).toEqual(['capability:request-handling']);
    expect(caps.trace[1].text).toMatch(/with Shared mailbox as a kind of Email/);
    expect((await checkWorkspace(root)).violations).toEqual([]);
  });
});

describe.skipIf(!PY)('should 10: NetworkX ranks capabilities, systems, people and teams; link prediction needs evidence of the relation\'s kind', () => {
  it('form choices are left out of centrality by default (formChoices: true keeps them)', async () => {
    const { runNetwork } = await import('../src/graph/network');
    const ideas = IDEAS.map((i) => ({ ...i, outcomes: ['Save Time'], support: ['Agent Design Guidance'] }));
    const g = buildGraph(ideas, []);
    const off = (await runNetwork(g, ['central'], { top: 20 })).results.central;
    expect(off.formChoices).toBe('left out');
    expect(off.betweenness.map((x: any) => x.type)).not.toEqual(expect.arrayContaining(['Outcome']));
    expect(off.betweenness.some((x: any) => ['Outcome', 'Support', 'Category', 'Beneficiary'].includes(x.type))).toBe(false);
    const on = (await runNetwork(g, ['central'], { top: 20, formChoices: true })).results.central;
    expect(on.betweenness.some((x: any) => x.type === 'Outcome')).toBe(true);
  });

  it('a capability that shares two systems with one busy capability is not told to use all of its others (the retest\'s "Key term extraction uses Team onboarding checklists")', async () => {
    const { runNetwork } = await import('../src/graph/network');
    const idea = sampleIdea({ id: 'CAFE-2026-005', features: ['Key term extraction', 'Document text extraction', 'Task completion tracking'], dedupe_key: 'k' });
    const sys = (cap: string, s: string): AiLink => ai({ from: `capability:${cap}`, rel: 'USES_DATA', to: `system:${s}`, idea: 'CAFE-2026-005', newNodes: [{ id: `system:${s}`, type: 'System', label: s.replace(/-/g, ' ') }] });
    const g = buildGraph([idea], [
      sys('key-term-extraction', 'contract-library'), sys('key-term-extraction', 'meeting-note'),
      sys('document-text-extraction', 'contract-library'), sys('document-text-extraction', 'meeting-note'), sys('document-text-extraction', 'team-onboarding-checklist'),
      sys('task-completion-tracking', 'meeting-note'), sys('task-completion-tracking', 'team-onboarding-checklist'),
    ]);
    const r = (await runNetwork(g, ['suggest'], { top: 50 })).results.suggest;
    expect(r.suggestions.filter((x: any) => x.from.id === 'capability:key-term-extraction')).toEqual([]);
    // With the old rule (one peer, any shared neighbour) it was suggested: minPeers 1 and minShared 1 bring it back.
    const loose = (await runNetwork(g, ['suggest'], { top: 50, minPeers: 1, minShared: 1 } as any)).results.suggest;
    expect(loose.suggestions.some((x: any) => x.from.id === 'capability:key-term-extraction' && x.to.id === 'system:team-onboarding-checklist')).toBe(true);
  });
});

describe('must 7: why an answer took fifteen minutes, and the hold that stops it', () => {
  it('on a Mac, an answer keeps the machine awake with caffeinate -i -w <pid> while it runs, and lets it go after', async () => {
    const { awakeHooks, holdAwake, awakeHolds } = await import('../src/ai/awake');
    const started: string[][] = []; let killed = 0;
    const was = awakeHooks.platform;
    awakeHooks.platform = 'darwin';
    const before = awakeHooks.setSpawner((cmd, args) => { started.push([cmd, ...args]); const fake: any = { on: () => fake, kill: () => { killed++; } }; return fake; });
    try {
      const a = holdAwake({}); const b = holdAwake({});
      expect(started).toEqual([['/usr/bin/caffeinate', '-i', '-w', String(process.pid)]]);
      a(); expect(killed).toBe(0);
      b(); b(); expect(killed).toBe(1);
      expect(awakeHolds()).toBe(0);
      holdAwake({ CAFE_NO_CAFFEINATE: '1' })();
      expect(started).toHaveLength(1);
      awakeHooks.platform = 'linux';
      holdAwake({})();
      expect(started).toHaveLength(1);
    } finally { awakeHooks.platform = was; awakeHooks.setSpawner(before); }
  });
});
