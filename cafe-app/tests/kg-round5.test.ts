import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea, startServer } from './helpers';
import { saveIdea, listIdeas } from '../src/ideas/store';
import { appendAiLink, rebuildGraph, setAiLinkStatus } from '../src/graph/store';
import { appendEdit } from '../src/graph/operator';
import { checkWorkspace } from '../src/graph/check';
import { planFix, applyFix } from '../src/graph/fix';
import { buildGraph } from '../src/graph/build';
import { readRuleList } from '../src/graph/rules';
import { unapprovedTool, makeRegistry, defaultEntries } from '../src/graph/registry';
import { APPROVED_TOOLS, TOOL_ALIASES, compileOntology, type AiLink, type GNode } from '../src/graph/ontology';
import { runQuery, type Query } from '../src/command/query';
import { resolveSteps } from '../src/command/actions';
import { runCommand, readThreads } from '../src/command/chat';
import { clearNetworkCache, runNetwork } from '../src/graph/network';
import { fixedClock } from '../src/clock';
import { writeFileAtomic, writeYaml } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import type { Connector } from '../src/ai/connector';

/**
 * Round 5: the faults the fourth independent re-test found (kgtest4/LOG.txt), each reproduced first. A fact is
 * confirmed per (fact, idea), the build refuses and reports what it used to take in silence, the Do-it records are
 * signed with a key outside the workspace, NetworkX reads confirmed links by default, and the assistant answers the
 * questions it got wrong because of the app.
 */
const clock = fixedClock('2026-10-31');
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', idea: 'CAFE-2026-001', ...l });
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'vendor', title: 'Vendor contract summariser', function: 'GSS', entity: 'CS', dedupe_key: 'a', features: ['Document text extraction'], people: { submitter: 'Avery Chen', team: [] }, challenge: 'Contracts arrive by email as attachments.' }),
  sampleIdea({ id: 'CAFE-2026-003', slug: 'onboard', title: 'Onboarding checklist helper', function: 'BSI', entity: 'CS', dedupe_key: 'b', features: ['Document text extraction'], people: { submitter: 'Mateo Álvarez', team: [] }, challenge: 'New joiner forms come in by email and are typed again.' }),
  sampleIdea({ id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'c', features: ['Policy question answering'], tools: { 'Policy question answering': 'Copilot Studio' }, people: { submitter: 'Lucía Fernández', team: [] } }),
  sampleIdea({ id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'd', features: ['Policy question answering'], people: { submitter: 'Kwame Mensah', team: [] } }),
];
const EMAIL: GNode[] = [{ id: 'system:email', type: 'System', label: 'Email' }];
const DTE = 'capability:document-text-extraction|USES_DATA|system:email';
async function workspace(): Promise<string> {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  return root;
}
const edge = async (root: string, id: string) => (await rebuildGraph(root)).edges.find((e) => e.id === id);
const problems = async (root: string) => (await rebuildGraph(root)).problems.map((p) => p.message);

describe('item 1: confirmed per (fact, idea), every statement kept with its own provenance', () => {
  it('A4: a pending read for 001 that duplicates 003\'s confirmed fact gives 001 no confirmed dependency', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', confidence: 0.8, quote: 'come in by email', readAt: '2026-10-30T10:00:00Z', newNodes: EMAIL }));
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-001', confidence: 0.2, status: 'pending', description: 'smuggled' }));
    const g = await rebuildGraph(root);
    const fact = g.edges.find((e) => e.id === DTE)!;
    expect(fact.ideas).toEqual(['CAFE-2026-001', 'CAFE-2026-003']);
    expect(fact.sources!.map((s) => [s.idea, s.confirmed, s.confirmedBy ?? null, s.confidence, s.quote ?? null])).toEqual([
      ['CAFE-2026-003', true, 'threshold', 0.8, 'come in by email'], ['CAFE-2026-001', false, null, 0.2, null],
    ]);
    expect(g.edges.find((e) => e.id === 'idea:CAFE-2026-003|DEPENDS_ON|system:email')!.confirmed).toBe(true);
    // Before round 5 this came out confirmed: the pending read rode on 003's confirmation.
    expect(g.edges.find((e) => e.id === 'idea:CAFE-2026-001|DEPENDS_ON|system:email')!.confirmed).toBe(false);
    // The links step, asked for 001, gives 001's own statement; asked for 003, 003's, with who confirmed it.
    const ask = (code: string) => runQuery({ steps: [{ op: 'links', codes: [code] }] } as Query, { graph: g, ideas: IDEAS, rounds: [], idOf: (c) => c, schema: g.schema });
    const for1 = ask('idea:CAFE-2026-001').links!.find((l) => l.rel === 'USES_DATA')!;
    expect(for1).toMatchObject({ forIdea: 'CAFE-2026-001', confirmed: false, confidence: 0.2 });
    const for3 = ask('idea:CAFE-2026-003').links!.find((l) => l.rel === 'USES_DATA')!;
    expect(for3).toMatchObject({ forIdea: 'CAFE-2026-003', confirmed: true, confirmedBy: 'threshold', quote: 'come in by email' });
    expect(for3.statements!.map((s) => [s.idea, s.confirmed])).toEqual([['CAFE-2026-003', true], ['CAFE-2026-001', false]]);
  });
  it('a Do it for one idea confirms that idea\'s statement only, and records who and when', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', confidence: 0.4, status: 'pending', newNodes: EMAIL }));
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-001', confidence: 0.3, status: 'pending' }));
    await setAiLinkStatus(root, DTE, 'confirmed', '2026-10-31', 'CAFE-2026-001');
    const f = (await edge(root, DTE))!;
    expect(f.sources!.map((s) => [s.idea, s.confirmed, s.confirmedBy ?? null, s.confirmedAt ?? null])).toEqual([['CAFE-2026-003', false, null, null], ['CAFE-2026-001', true, 'operator', '2026-10-31']]);
    expect((await edge(root, 'idea:CAFE-2026-001|DEPENDS_ON|system:email'))!.confirmed).toBe(true);
    expect((await edge(root, 'idea:CAFE-2026-003|DEPENDS_ON|system:email'))!.confirmed).toBe(false);
    expect((await checkWorkspace(root)).violations).toEqual([]);
  });
  it('POST /api/graph/confirm with an idea confirms that idea\'s statement; /api/graph counts a fact still waiting for another idea', async () => {
    const s = await startServer('2026-10-31');
    try {
      for (const i of IDEAS) await saveIdea(s.root, i);
      await appendAiLink(s.root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', confidence: 0.9, newNodes: EMAIL }));
      await appendAiLink(s.root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-001', confidence: 0.3, status: 'pending' }));
      const before: any = await (await fetch(`${s.base}/api/graph`)).json();
      expect(before.unconfirmed).toBe(1);
      const ok = await fetch(`${s.base}/api/graph/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ edgeId: DTE, idea: 'idea:CAFE-2026-001' }) });
      expect(ok.status).toBe(200);
      const after: any = await (await fetch(`${s.base}/api/graph`)).json();
      expect(after.unconfirmed).toBe(0);
      expect(after.edges.find((e: any) => e.id === DTE).sources.map((x: any) => [x.idea, x.confirmedBy])).toEqual([['CAFE-2026-003', 'threshold'], ['CAFE-2026-001', 'operator']]);
    } finally { s.server.close(); }
  });
  it('an operator link stated for another idea adds that idea\'s own statement, confirmed by the edit', () => {
    const g = buildGraph(IDEAS, [ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', confidence: 0.3, status: 'pending', newNodes: EMAIL })], [],
      [{ id: 'op-1', at: '2026-10-31', status: 'active', t: 'link', from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-001' }]);
    expect(g.edges.find((e) => e.id === DTE)!.sources!.map((s) => [s.source, s.idea, s.confirmedBy ?? null])).toEqual([['ai:fake:challenge', 'CAFE-2026-003', null], ['operator:op-1@2026-10-31', 'CAFE-2026-001', 'edit']]);
    expect(g.edges.find((e) => e.id === 'idea:CAFE-2026-001|DEPENDS_ON|system:email')!.confirmed).toBe(true);
    expect(g.edges.find((e) => e.id === 'idea:CAFE-2026-003|DEPENDS_ON|system:email')!.confirmed).toBe(false);
  });
});

describe('item 2: KIND_OF loops a merge closes are refused and said', () => {
  it('A9b: D KIND_OF E, P KIND_OF D, merge E into P: the loop is cut at its latest link, named with the merge', async () => {
    const root = await workspace();
    let n = 1;
    for (const [id, label] of [['system:desk-mailbox', 'Desk mailbox'], ['system:procurement-mailbox', 'Procurement mailbox'], ['system:email', 'Email']]) await appendEdit(root, { id: `op-${n++}`, at: '2026-10-31', status: 'active', t: 'add', node: id, type: 'System', label });
    await appendEdit(root, { id: 'op-20', at: '2026-10-31', status: 'active', t: 'link', from: 'system:desk-mailbox', rel: 'KIND_OF', to: 'system:email' });
    await appendEdit(root, { id: 'op-21', at: '2026-10-31', status: 'active', t: 'link', from: 'system:procurement-mailbox', rel: 'KIND_OF', to: 'system:desk-mailbox' });
    await appendEdit(root, { id: 'op-22', at: '2026-10-31', status: 'active', t: 'merge', from: 'system:email', into: 'system:procurement-mailbox' });
    const g = await rebuildGraph(root);
    expect(g.edges.filter((e) => e.rel === 'KIND_OF').map((e) => e.id)).toEqual(['system:desk-mailbox|KIND_OF|system:procurement-mailbox']);
    const msg = 'operator.jsonl op-21: link system:procurement-mailbox KIND_OF system:desk-mailbox: after the merge op-22 it makes a loop of kinds (system:desk-mailbox → system:procurement-mailbox → system:desk-mailbox), so it is left out (refused by the build)';
    expect(g.problems.map((p) => p.message)).toContain(msg);
    expect((await checkWorkspace(root)).violations).toContain(msg);
  });
});

describe('item 3: check says nothing wrong of an AI link a merge moved', () => {
  it('an AI link to a star merged since is moved by the build, and check does not call it skipped', async () => {
    const root = await workspace();
    // The inbox star was the operator's (not the link's new star): once merged, the link's end is the star kept.
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'add', node: 'system:inbox', type: 'System', label: 'Inbox' });
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:inbox' }));
    await appendEdit(root, { id: 'op-2', at: '2026-10-31', status: 'active', t: 'add', node: 'system:email', type: 'System', label: 'Email' });
    await appendEdit(root, { id: 'op-3', at: '2026-10-31', status: 'active', t: 'merge', from: 'system:inbox', into: 'system:email' });
    expect(await edge(root, DTE)).toBeDefined();
    expect((await checkWorkspace(root)).violations).toEqual([]);
  });
});

describe('item 4: tools: an unapproved tool by any near spelling, never by a rename or a new entry', () => {
  it('near spellings of unapproved tools are those tools; approved names never are', () => {
    for (const [name, is] of [['UI Path', 'UiPath'], ['UiPath RPA', 'UiPath'], ['UiPath Studio', 'UiPath'], ['Chat GPT', 'ChatGPT'], ['Chat-GPT', 'ChatGPT'], ['Power-Automate', 'Power Automate'], ['Blue Prism RPA', 'Blue Prism'], ['Zapier.com', 'Zapier'], ['ChatGPT Enterprise', 'ChatGPT']]) expect(unapprovedTool(name)).toBe(is);
    for (const name of [...APPROVED_TOOLS, ...Object.keys(TOOL_ALIASES), 'Power App', 'Copilot']) expect(unapprovedTool(name)).toBeUndefined();
  });
  it('A21: renaming Copilot Studio to UiPath (or to another approved tool) is refused by the build and in chat', async () => {
    const root = await workspace();
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'rename', node: 'tool:copilot-studio', label: 'UI Path' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-31', status: 'active', t: 'rename', node: 'tool:copilot-studio', label: 'Power Apps' });
    const g = await rebuildGraph(root);
    expect(g.nodes.find((n) => n.id === 'tool:copilot-studio')!.label).toBe('Copilot Studio');
    const v = (await checkWorkspace(root)).violations;
    expect(v).toContain('operator.jsonl op-1: rename tool:copilot-studio to "UI Path": UiPath is not on the approved list, and an approved tool\'s star under its name would make it look approved (refused by the build)');
    expect(v).toContain('operator.jsonl op-2: rename tool:copilot-studio to "Power Apps": that is Power Apps, another tool; a tool pick changes in the tool picker (refused by the build)');
    const codes = new Map([['T1', { id: 'tool:copilot-studio', type: 'Tool' as const, label: 'Copilot Studio' }]]);
    const r = resolveSteps([{ op: 'rename', a: 'T1', name: 'Power Automate' } as any, { op: 'alias', a: 'T1', name: 'UiPath Studio' } as any], { codes, graph: g, ideas: IDEAS, rounds: [], registry: makeRegistry(defaultEntries(), []) });
    expect(r.proposals).toEqual([]);
    expect(r.problems[0]).toMatch(/^Power Automate is not on the approved list, so Copilot Studio is not renamed/);
    expect(r.problems[1]).toMatch(/^UiPath is another tool, not on the approved list/);
  });
  it('A11a/b: entities.yaml: a near-spelt unapproved alias, or a Tool entry that is not an approved tool, is not used, and named', async () => {
    const root = await workspace();
    await writeYaml(paths(root).entities, { Tool: [
      { id: 'tool:copilot-studio', label: 'Copilot Studio', aliases: ['MCS', 'UI Path', 'Chat GPT', 'Zapier.com'] },
      { id: 'tool:chat-gpt', label: 'Chat GPT' }, { id: 'tool:acme-bot', label: 'Acme Bot' },
    ] });
    const g = await rebuildGraph(root);
    expect(g.nodes.find((n) => n.id === 'tool:copilot-studio')!.attrs!.aliases).toBe('MCS; microsoft copilot studio');
    const v = (await checkWorkspace(root)).violations;
    for (const a of ['UI Path', 'Chat GPT', 'Zapier.com']) expect(v.some((m) => m.includes(`alias "${a}" names`))).toBe(true);
    expect(v.some((m) => /"tool:chat-gpt": is ChatGPT, which is not on the approved list/.test(m))).toBe(true);
    expect(v).toContain('entities.yaml: Tool: "tool:acme-bot" (Acme Bot) is not on the Café\'s approved list (Microsoft Copilot, Copilot Studio, Power Apps, Dataiku, custom app): a Tool entry names an approved tool (not used by the build; remove it)');
    expect(g.problems.some((p) => /"tool:acme-bot" \(Acme Bot\) is not on the Café's approved list/.test(p.message))).toBe(true);
  });
});

describe('item 5: the form\'s facts are never unlinked', () => {
  it('U1: unlinks of SUBMITTED, a tool pick, HAS_TEAM and a derived link are refused at the build and named', async () => {
    const root = await workspace();
    const ops = [['person:lucía-fernández', 'SUBMITTED', 'idea:CAFE-2026-006'], ['capability:policy-question-answering', 'BUILT_WITH', 'tool:copilot-studio'], ['entity:cs', 'HAS_TEAM', 'team:gss'], ['idea:CAFE-2026-006', 'USES', 'tool:copilot-studio']] as const;
    for (const [i, [from, rel, to]] of ops.entries()) await appendEdit(root, { id: `op-${i + 1}`, at: '2026-10-31', status: 'active', t: 'unlink', from, rel, to });
    const g = await rebuildGraph(root);
    for (const [from, rel, to] of ops) expect(g.edges.some((e) => e.id === `${from}|${rel}|${to}`)).toBe(true);
    const v = (await checkWorkspace(root)).violations;
    expect(v).toContain("operator.jsonl op-1: unlink person:lucía-fernández SUBMITTED idea:CAFE-2026-006: the form states it, so it changes in the idea's record (its submitter and team), never by an unlink (refused by the build)");
    expect(v).toContain("operator.jsonl op-2: unlink capability:policy-question-answering BUILT_WITH tool:copilot-studio: the form states it, so it changes in the tool pick (the design's tool picker), never by an unlink (refused by the build)");
    expect(v).toContain("operator.jsonl op-3: unlink entity:cs HAS_TEAM team:gss: the form states it, so it changes in the idea's CS Function, on its record, never by an unlink (refused by the build)");
    expect(v).toContain('operator.jsonl op-4: unlink idea:CAFE-2026-006 USES tool:copilot-studio: USES is derived by the rules from the stored facts: remove one of those instead (refused by the build)');
  });
  it('an AI link is still the operator\'s to unlink', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', newNodes: EMAIL }));
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'unlink', from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email' });
    expect(await edge(root, DTE)).toBeUndefined();
    expect((await checkWorkspace(root)).violations).toEqual([]);
  });
});

describe('item 6: one Café ID, one idea', () => {
  it('F1: a second folder with the same Café ID is not read, never merged, and is a violation', async () => {
    const root = await workspace();
    const ideas = paths(root).ideas;
    const src = (await readdir(ideas)).find((x) => x.startsWith('CAFE-2026-006'))!;
    await cp(path.join(ideas, src), path.join(ideas, 'CAFE-2026-006-evil-twin'), { recursive: true });
    const y = path.join(ideas, 'CAFE-2026-006-evil-twin', 'idea.yaml');
    await writeFile(y, (await readFile(y, 'utf8')).replace('title: Travel policy assistant', 'title: Evil twin').replace('function: GSS', 'function: BSI'));
    expect((await listIdeas(root)).ideas.filter((i) => i.id === 'CAFE-2026-006').map((i) => i.title)).toEqual(['Travel policy assistant']);
    const g = await rebuildGraph(root);
    expect(g.nodes.find((x) => x.id === 'idea:CAFE-2026-006')!.label).toBe('Travel policy assistant');
    expect(g.edges.some((e) => e.id === 'team:bsi|OWNS|idea:CAFE-2026-006')).toBe(false);
    const msg = 'ideas/CAFE-2026-006-evil-twin: a second folder with the Café ID CAFE-2026-006: the idea is read from CAFE-2026-006-travel, and this folder is not read; move or remove it (refused by the build)';
    expect(g.problems.map((p) => p.message)).toContain(msg);
    expect((await checkWorkspace(root)).violations).toContain(msg);
  });
});

const PY = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim();
describe.skipIf(!PY)('item 7: NetworkX reads confirmed links by default, and says so', () => {
  it('nx1: a "Hub thing" five pending reads point at never tops centrality; with unconfirmed it does, and the scope says so', async () => {
    const root = await workspace();
    for (const i of IDEAS) await appendAiLink(root, ai({ from: `idea:${i.id}`, rel: 'NEEDS', to: 'capability:hub-thing', idea: i.id, confidence: 0.3, status: 'pending', newNodes: [{ id: 'capability:hub-thing', type: 'Capability', label: 'Hub thing' }] }));
    clearNetworkCache();
    const g = await rebuildGraph(root);
    const sure = await runNetwork(g, ['central', 'stats'], { top: 5 });
    expect(sure.scopeText).toBe('confirmed stored facts');
    expect(sure.results.central.betweenness.map((x: any) => x.id)).not.toContain('capability:hub-thing');
    expect(sure.results.stats.nodes).toBe(g.nodes.length - 1);
    const all = await runNetwork(g, ['central'], { top: 5 }, { withUnconfirmed: true });
    expect(all.scopeText).toBe('stored facts, links waiting for your Do it included');
    expect(all.results.central.betweenness[0].id).toBe('capability:hub-thing');
  });
});

describe('item 8: what the build drops it says, loudly', () => {
  it('an AI link to a star that is gone, or of the wrong kinds, is dropped and named in the graph\'s problems', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:nowhere' }));
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-001', rel: 'NEEDS', to: 'tool:copilot-studio' }));
    const p = await problems(root);
    expect(p).toContain('ai-links.jsonl link 1 (capability:document-text-extraction USES_DATA system:nowhere): system:nowhere is not in the graph or among the link\'s new stars (dropped by the build)');
    expect(p).toContain('ai-links.jsonl link 2 (idea:CAFE-2026-001 NEEDS tool:copilot-studio): NEEDS goes Idea → Capability, not Idea → Tool (dropped by the build)');
  });
  it('O1: ontology.yaml re-pairing NEEDS as Idea → Person drops every NEEDS link, said once, with how many of each source', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-001', rel: 'NEEDS', to: 'capability:clause-finding', newNodes: [{ id: 'capability:clause-finding', type: 'Capability', label: 'Clause finding' }] }));
    await writeYaml(paths(root).ontology, { relations: { NEEDS: { from: 'Idea', to: 'Person' } } });
    const g = await rebuildGraph(root);
    expect(g.edges.some((e) => e.rel === 'NEEDS')).toBe(false);
    const msg = 'ontology.yaml: NEEDS is re-paired as Idea → Person (built in: Idea → Capability): 5 stored links (4 from the forms, 1 AI) no longer fit it and are left out of the graph; put the pair back to keep them (dropped by the build)';
    expect(g.problems.map((x) => x.message)).toContain(msg);
    expect((await checkWorkspace(root)).violations).toContain(msg);
  });
});

describe('item 9: a quote and a time an AI read could have had', () => {
  it('A7: a quote the text never held is dropped; a garbage readAt is dropped; a quote in another field is read where it is', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:sap', quote: 'pulled nightly from SAP Concur', newNodes: [{ id: 'system:sap', type: 'System', label: 'SAP' }] }));
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', readAt: 'not a date', newNodes: EMAIL }));
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', source: 'ai:fake:current_process', quote: 'arrive by email', readAt: '2026-10-31T09:00:00Z', newNodes: EMAIL }));
    const g = await rebuildGraph(root);
    const p = g.problems.map((x) => x.message);
    expect(p).toContain('ai-links.jsonl link 1 (capability:document-text-extraction USES_DATA system:sap): the quoted passage "pulled nightly from SAP Concur" is not in CAFE-2026-001\'s challenge or any other field of its text (dropped by the build)');
    expect(p).toContain('ai-links.jsonl link 2 (capability:document-text-extraction USES_DATA system:email): readAt "not a date" is not a date and time (dropped by the build)');
    expect(g.edges.some((e) => e.to === 'system:sap')).toBe(false);
    expect(g.edges.find((e) => e.id === DTE)).toMatchObject({ source: 'ai:fake:challenge', quote: 'arrive by email' });
    const v = (await checkWorkspace(root)).violations;
    expect(v.some((m) => m.startsWith('ai-links.jsonl line 1: the quoted passage'))).toBe(true);
    expect(v.some((m) => m.startsWith('ai-links.jsonl line 2: readAt "not a date"'))).toBe(true);
  });
  it('a quote not in the text is kept, marked not found, when the text changed since the AI read it', async () => {
    const root = await workspace();
    await writeFileAtomic(path.join(paths(root).graph, 'ai-reads.json'), JSON.stringify({ 'CAFE-2026-001': { at: '2026-10-30T09:00:00Z', hash: 'older-text' } }));
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', quote: 'faxed in daily', newNodes: EMAIL }));
    expect(await edge(root, DTE)).toMatchObject({ quote: 'faxed in daily', quoteFound: false });
  });
  it('S1: confirmAt 0 is reported and not used: 0.7 stays the threshold', async () => {
    const root = await workspace();
    await writeFileAtomic(paths(root).settings, 'graph:\n  confirmAt: 0\n');
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', confidence: 0.3, newNodes: EMAIL }));
    expect((await edge(root, DTE))!.confirmed).toBe(false);
    const msg = 'settings.yaml: graph.confirmAt 0 is below 0.5: nearly every AI read would count as confirmed with no Do it, so 0.7 is used until it is fixed (refused by the build)';
    expect(await problems(root)).toContain(msg);
    expect((await checkWorkspace(root)).violations).toContain(msg);
  });
});

describe('item 10: the Do-it records are signed with a key outside the workspace', () => {
  it('A2: confirmedBy written in ai-links.jsonl and a hand-written confirmations.jsonl line together are not believed', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', confidence: 0.4, confirmedBy: 'operator', confirmedAt: '2026-10-30', newNodes: EMAIL }));
    await writeFileAtomic(path.join(paths(root).graph, 'confirmations.jsonl'), `${JSON.stringify({ edge: DTE, idea: 'CAFE-2026-001', at: '2026-10-30', by: 'operator', ts: '2026-10-30T10:00:00Z', prev: '', mac: 'a'.repeat(64) })}\n`);
    expect((await edge(root, DTE))!.confirmed).toBe(false);
    expect((await problems(root)).some((m) => /^confirmations\.jsonl line 1: .*(its signature does not match|there is no key to check it with).*\(refused by the build\)$/.test(m))).toBe(true);
    // The app's own Do it is believed, signed and chained; the key is not in the workspace.
    await setAiLinkStatus(root, DTE, 'confirmed', '2026-10-31', 'CAFE-2026-001');
    expect((await edge(root, DTE))!.confirmed).toBe(true);
    const lines = (await readFile(path.join(paths(root).graph, 'confirmations.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[1]).toMatchObject({ edge: DTE, idea: 'CAFE-2026-001', by: 'operator', prev: '', mac: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const id = (await readFile(path.join(paths(root).rules, 'workspace-id'), 'utf8')).trim();
    expect(await readFile(path.join(process.env.CAFE_KEYS_DIR!, id), 'utf8')).toMatch(/^[0-9a-f]{64}\n$/);
    const inData = await readdir(paths(root).data, { recursive: true });
    expect(inData.some((f) => String(f).includes(id))).toBe(false);
    // A signed line changed by hand (another edge) is not believed either.
    const forged = { ...lines[1], edge: 'capability:document-text-extraction|USES_DATA|system:sap' };
    await writeFileAtomic(path.join(paths(root).graph, 'confirmations.jsonl'), `${JSON.stringify(lines[0])}\n${JSON.stringify(lines[1])}\n${JSON.stringify(forged)}\n`);
    expect((await problems(root)).some((m) => /^confirmations\.jsonl line 3: .*its signature does not match/.test(m))).toBe(true);
  });
  it('a record from before signing counts as waiting until cafe ontology fix --apply signs it; a removed line breaks the chain, said', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', confidence: 0.4, confirmedBy: 'operator', newNodes: EMAIL }));
    await writeFileAtomic(path.join(paths(root).graph, 'confirmations.jsonl'), `${JSON.stringify({ edge: DTE, at: '2026-10-30', by: 'operator', ts: '2026-10-30T10:00:00Z' })}\n`);
    expect((await edge(root, DTE))!.confirmed).toBe(false);
    expect(await problems(root)).toContain(`confirmations.jsonl line 1: ${DTE.replace(/\|/g, ' ')}: not signed (written before Do-it records were signed), so it counts as waiting for your Do it until cafe ontology fix --apply signs it`);
    const plan = await planFix(root);
    expect(plan.sign).toEqual([{ line: 1, edge: DTE, why: 'unsigned' }]);
    expect(await applyFix(root, plan, clock)).toContain(`confirmations.jsonl line 1: ${DTE.replace(/\|/g, ' ')}: signed (written before records were signed)`);
    expect((await edge(root, DTE))!.confirmed).toBe(true);
    // Two Do its, then the first removed by hand: the second still verifies, and the break is said.
    await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:fax', confidence: 0.4, status: 'pending', newNodes: [{ id: 'system:fax', type: 'System', label: 'Fax' }] }));
    await setAiLinkStatus(root, 'capability:document-text-extraction|USES_DATA|system:fax', 'confirmed');
    const file = path.join(paths(root).graph, 'confirmations.jsonl');
    await writeFileAtomic(file, `${(await readFile(file, 'utf8')).trim().split('\n').slice(1).join('\n')}\n`);
    expect((await edge(root, 'capability:document-text-extraction|USES_DATA|system:fax'))!.confirmed).toBe(true);
    expect(await problems(root)).toContain('confirmations.jsonl line 1: a line before it was removed or changed (the chain of Do-it records is broken there)');
  });
});

describe('item 11: conversation ids never collide', () => {
  it('ten new conversations started at once get ten ids', async () => {
    const root = await workspace();
    const c = { status: async () => ({ provider: 'fake', label: 'F' }), choices: async () => [], run: async () => { throw new Error('no'); }, look: async () => { throw new Error('no'); },
      runWith: async () => ({ provider: 'fake', label: 'F', output: { next: 'answer', thought: 'answer', reply: 'Nothing to add.' } }) } as unknown as Connector;
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => runCommand(root, `question ${i}`, c, clock)));
    expect(new Set(out.map((e) => e.thread)).size).toBe(10);
    expect(new Set(out.map((e) => e.id)).size).toBe(10);
    expect((await readThreads(root)).length).toBe(10);
  });
});

describe('item 12: the assistant\'s answers that were wrong because of the app', () => {
  const g = buildGraph(IDEAS, [
    ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-003', confidence: 0.8, newNodes: EMAIL }),
    ai({ from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:fax', idea: 'CAFE-2026-007', confidence: 0.55, status: 'pending', newNodes: [{ id: 'system:fax', type: 'System', label: 'Fax' }] }),
  ], [], [
    { id: 'op-1', at: '2026-10-26', status: 'active', t: 'add', node: 'system:travel-expense-policy', type: 'System', label: 'Travel & Expense policy' },
    { id: 'op-9', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:travel-expense-policy' },
  ]);
  const world = (extra: object = {}) => ({ graph: g, ideas: IDEAS, rounds: [], idOf: (c: string) => c, ...extra });
  it('Q22: "Who is Lucia Fernandez?" finds Lucía Fernández, said so; the ids stay apart', () => {
    const r = runQuery({ steps: [{ op: 'stars', type: 'Person', match: 'Lucia Fernandez' }, { op: 'role' }] } as Query, world());
    expect(r.trace[0].text).toBe('Start from every person named like "Lucia Fernandez" (by the name with accents aside: Lucía Fernández; a person is never the same as another of a like name until you merge them)');
    expect(r.people!.map((p) => p.id)).toEqual(['person:lucía-fernández']);
  });
  it('Q24: "does the FAQ bot use Copilot Studio?" says by name which link was not followed and why', () => {
    const r = runQuery({ steps: [{ op: 'stars', codes: ['idea:CAFE-2026-007'] }, { op: 'follow', rel: 'NEEDS', type: 'Capability' }, { op: 'follow', rel: 'BUILT_WITH', type: 'Tool' }] } as Query, world());
    expect(r.final).toEqual([]);
    expect(r.trace.map((t) => t.text)).toContain('Not followed (it holds for other ideas, so it gives these nothing): Policy question answering built with Copilot Studio is stated for Travel policy assistant only, not for Procurement FAQ bot');
    const back = runQuery({ steps: [{ op: 'stars', codes: ['tool:copilot-studio'] }, { op: 'follow', rel: 'BUILT_WITH', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', type: 'Idea' }] } as Query, world());
    expect(back.final).toEqual(['idea:CAFE-2026-006']);
    expect(back.trace.map((t) => t.text)).toContain('Not followed (it holds for other ideas, so it gives these nothing): Procurement FAQ bot needs Policy question answering, but what led here holds for Travel policy assistant only');
  });
  it('Q36/Q45: a link stated for no idea is said so, with the ideas it holds for; never "stated for one idea"', () => {
    const r = runQuery({ steps: [{ op: 'links', source: 'operator' }] } as Query, world());
    const op9 = r.links!.find((l) => l.edit === 'op-9')!;
    expect(op9.unscoped).toEqual({ holdsFor: [] });
    expect(r.trace.map((t) => t.text)).toContain('Policy question answering uses data Travel & Expense policy: added by the operator (op-9, 2026-10-26); stated for no idea, so it holds only for the ideas whose own facts already reach it (none: it gives no idea a dependency); cafe ontology fix stamps it');
  });
  it('Q46: a link read before times were kept says when the AI last read the idea', () => {
    const r = runQuery({ steps: [{ op: 'links', codes: ['idea:CAFE-2026-003'], source: 'ai' }] } as Query, world({ reads: { 'CAFE-2026-003': { at: '2026-10-27T01:35:34.043Z' } } }));
    expect(r.links![0]).toMatchObject({ lastRead: '2026-10-27T01:35:34.043Z' });
    expect(r.trace.map((t) => t.text).find((t) => t.startsWith('Document text extraction uses data Email'))).toContain('(no time kept for this link; the AI last read the idea on 2026-10-27)');
  });
  it('008: "which AI links for this idea are waiting?" counts its capability-level facts too', () => {
    const r = runQuery({ steps: [{ op: 'links', codes: ['idea:CAFE-2026-007'], source: 'ai' }] } as Query, world());
    expect(r.links!.map((l) => [l.rel, l.to, l.confirmed])).toEqual([['USES_DATA', 'system:fax', false]]);
  });
  it('Q54: a NetworkX path hop along a capability-level fact says which ideas it is stated for', () => {
    const run = { ok: { networkx: '3.7', scopeText: 'confirmed stored facts', unconfirmed: false, results: { path: { found: true, length: 2, count: 1, paths: [{ stars: [{ id: 'idea:CAFE-2026-001' }, { id: 'capability:document-text-extraction' }, { id: 'system:email' }], hops: [
      { from: 'idea:CAFE-2026-001', to: 'capability:document-text-extraction', rels: [{ from: 'idea:CAFE-2026-001', rel: 'NEEDS', to: 'capability:document-text-extraction' }] },
      { from: 'capability:document-text-extraction', to: 'system:email', rels: [{ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:email' }] }] }] } } } };
    const r = runQuery({ steps: [{ op: 'network', analysis: 'path', codes: ['idea:CAFE-2026-001', 'system:email'] }] } as Query, world({ network: () => run }));
    expect(r.trace.map((t) => t.text)).toContain('Document text extraction uses data Email (stated for Onboarding checklist helper only)');
  });
  it('a star of a kind ontology.yaml declared is proposed through the chat like any other', () => {
    const { schema } = compileOntology({ nodes: { Vendor: { label: 'Vendor' } }, relations: { SUPPLIED_BY: { from: 'Capability', to: 'Vendor', meaning: 'supplied by', derived: false } } });
    const codes = new Map([['C1', { id: 'capability:policy-question-answering', type: 'Capability' as const, label: 'Policy question answering' }]]);
    const r = resolveSteps([{ op: 'add_star', type: 'Vendor', name: 'Acme', b: 'C1' } as any], { codes, graph: { ...g, schema }, ideas: IDEAS, rounds: [] });
    expect(r.problems).toEqual([]);
    expect(r.proposals.map((p) => p.label)).toEqual(['New vendor: Acme, linked from Policy question answering for Travel policy assistant', 'New vendor: Acme, linked from Policy question answering for Procurement FAQ bot']);
  });
});

describe('item 13: the built-in rules a file leaves out still run, said', () => {
  it('a file with one rule of its own keeps OWNS, USES and SIMILAR_TO, and names each built-in it does not list', async () => {
    const r = readRuleList({ rules: [{ name: 'mine', chain: ['NEEDS', 'USES_DATA'], then: 'DEPENDS_ON' }] });
    expect(r.rules.map((x) => x.name)).toEqual(['mine', 'needs+uses_data', 'needs+built_with', 'member+submitted', 'shared-stars']);
    const root = await workspace();
    await writeFileAtomic(paths(root).inference, 'rules:\n  - { name: needs+uses_data, chain: [NEEDS, USES_DATA], then: DEPENDS_ON }\n');
    const g = await rebuildGraph(root);
    expect(g.edges.some((e) => e.rel === 'OWNS')).toBe(true);
    expect(g.edges.some((e) => e.rel === 'USES')).toBe(true);
    expect((await checkWorkspace(root)).violations).toEqual(['needs+built_with', 'member+submitted', 'shared-stars'].map((x) => `inference.yaml: the built-in rule ${x} is not listed, so it still runs (write it with enabled: false to switch it off)`));
    // Switched off by name: off, and nothing said.
    await writeFileAtomic(paths(root).inference, 'rules:\n  - { name: needs+uses_data, chain: [NEEDS, USES_DATA], then: DEPENDS_ON }\n  - { name: needs+built_with, enabled: false, chain: [NEEDS, BUILT_WITH], then: USES }\n  - { name: member+submitted, enabled: false, chain: [HAS_MEMBER, SUBMITTED], then: OWNS }\n  - { name: shared-stars, kind: shared-stars, enabled: false }\n');
    const off = await rebuildGraph(root);
    expect(off.edges.some((e) => e.rel === 'OWNS' || e.rel === 'USES' || e.rel === 'SIMILAR_TO')).toBe(false);
    expect((await checkWorkspace(root)).violations).toEqual([]);
  });
});
