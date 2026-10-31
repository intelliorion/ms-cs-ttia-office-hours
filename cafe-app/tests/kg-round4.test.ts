import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { tmpWorkspace, sampleIdea, startServer } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { appendAiLink, rebuildGraph, setAiLinkStatus } from '../src/graph/store';
import { appendEdit } from '../src/graph/operator';
import { checkWorkspace } from '../src/graph/check';
import { BUILTIN_SCHEMA, compileOntology, type AiLink } from '../src/graph/ontology';
import { fixedClock } from '../src/clock';
import { hideNames } from '../src/command/names';
import { runCommand } from '../src/command/chat';
import { writeFileAtomic, writeYaml } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import type { Connector } from '../src/ai/connector';

/**
 * Round 4: the build gates itself, whatever wrote the files (the seven routes of the round-3 log), the ontology is a
 * value per build (no race), and the assistant's small faults (declared-kind codes, raw codes at a deadline, a broken
 * settings file blamed on the AI). Each test reproduces a fault from the log first.
 */
const clock = fixedClock('2026-10-31');
export const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', idea: 'CAFE-2026-001', ...l });
const IDEAS = [
  sampleIdea({ id: 'CAFE-2026-001', slug: 'desk', title: 'Desk booking assistant', function: 'BSI', entity: 'CS', dedupe_key: 'a', features: ['Request handling'], people: { submitter: 'Priya Nair', team: [] } }),
  sampleIdea({ id: 'CAFE-2026-002', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'b', features: ['Request handling'], people: { submitter: 'Kwame Mensah', team: [] } }),
];
async function workspace(): Promise<string> {
  const root = await tmpWorkspace();
  for (const i of IDEAS) await saveIdea(root, i);
  return root;
}
const edge = async (root: string, id: string) => (await rebuildGraph(root)).edges.find((e) => e.id === id);
const problems = async (root: string) => (await rebuildGraph(root)).problems.map((p) => p.message);
const EMAIL = [{ id: 'system:email', type: 'System' as const, label: 'Email' }];

describe('item 1: the build refuses what no route of the app would write, from any file', () => {
  it('bug 3a: a hand-written confirmedBy is not a Do it; the Do it the app records is', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', confidence: 0.1, confirmedBy: 'operator', confirmedAt: '2026-10-31', newNodes: EMAIL }));
    const id = 'capability:request-handling|USES_DATA|system:email';
    expect((await edge(root, id))!.confirmed).toBe(false);
    expect((await edge(root, 'idea:CAFE-2026-001|DEPENDS_ON|system:email'))!.confirmed).toBe(false);
    expect((await problems(root)).some((m) => /says the operator confirmed it, but no Do it is recorded for it/.test(m))).toBe(true);
    expect((await checkWorkspace(root)).violations.some((m) => /line 1: says the operator confirmed it, but no Do it is recorded/.test(m))).toBe(true);
    await setAiLinkStatus(root, id, 'confirmed');
    expect((await edge(root, id))!.confirmed).toBe(true);
    expect(await readFile(`${paths(root).graph}/confirmations.jsonl`, 'utf8')).toContain(id);
    expect((await checkWorkspace(root)).violations).toEqual([]);
  });
  it('bug 3b: a pending link is a suggestion whatever its confidence', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', confidence: 0.95, status: 'pending', newNodes: EMAIL }));
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-002', rel: 'REPLACES', to: 'painpoint:slow-answers', confidence: 0.95, status: 'pending', idea: 'CAFE-2026-002', newNodes: [{ id: 'painpoint:slow-answers', type: 'PainPoint', label: 'Slow answers' }] }));
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'add', node: 'painpoint:slow-answers', type: 'PainPoint', label: 'Slow answers' });
    expect((await edge(root, 'capability:request-handling|USES_DATA|system:email'))!.confirmed).toBe(false);
    // No new star, high confidence, still pending: still waiting.
    expect((await edge(root, 'idea:CAFE-2026-002|REPLACES|painpoint:slow-answers'))!.confirmed).toBe(false);
  });
  it.each([[5], [-0.1], ['0.9'], [null]])('bug 3c: confidence %s is not a confidence: the link is dropped and said so', async (c) => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', confidence: c as number, newNodes: EMAIL }));
    expect(await edge(root, 'capability:request-handling|USES_DATA|system:email')).toBeUndefined();
    expect((await problems(root)).some((m) => /is not a number from 0 to 1 \(dropped by the build\)$/.test(m))).toBe(true);
    expect((await checkWorkspace(root)).violations.some((m) => /^ai-links\.jsonl line 1: confidence .* is not a number from 0 to 1 \(dropped by the build\)$/.test(m))).toBe(true);
  });
  it('bug 4: an AI link may not pick a tool or make a Tool star, from the file either: no USES follows', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'BUILT_WITH', to: 'tool:uipath', newNodes: [{ id: 'tool:uipath', type: 'Tool', label: 'UiPath' }] }));
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-001', rel: 'NEEDS', to: 'capability:bot-runs', newNodes: [{ id: 'capability:bot-runs', type: 'Capability', label: 'Bot runs' }, { id: 'tool:uipath', type: 'Tool', label: 'UiPath' }] }));
    const g = await rebuildGraph(root);
    expect(g.nodes.some((n) => n.type === 'Tool')).toBe(false);
    expect(g.edges.some((e) => e.rel === 'USES' || e.rel === 'BUILT_WITH')).toBe(false);
    const msgs = g.problems.map((p) => p.message);
    expect(msgs).toContain('ai-links.jsonl link 1 (capability:request-handling BUILT_WITH tool:uipath): a tool comes only from the tool pick, never from an AI link (dropped by the build)');
    expect(msgs).toContain('ai-links.jsonl link 2 (idea:CAFE-2026-001 NEEDS capability:bot-runs): new star tool:uipath is a Tool, which the AI may not make (dropped by the build)');
    expect((await checkWorkspace(root)).violations).toContain('ai-links.jsonl line 1: a tool comes only from the tool pick, never from an AI link (dropped by the build)');
  });
  it('bug 5: remove and rename of an idea, a team or a person are refused and named; a capability is still the operator\'s', async () => {
    const root = await workspace();
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'remove', node: 'idea:CAFE-2026-002' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-31', status: 'active', t: 'remove', node: 'team:gss' });
    await appendEdit(root, { id: 'op-3', at: '2026-10-31', status: 'active', t: 'rename', node: 'person:priya-nair', label: 'Someone else' });
    await appendEdit(root, { id: 'op-4', at: '2026-10-31', status: 'active', t: 'rename', node: 'idea:CAFE-2026-001', label: 'Renamed idea' });
    await appendEdit(root, { id: 'op-5', at: '2026-10-31', status: 'active', t: 'rename', node: 'capability:request-handling', label: 'Handling requests' });
    await appendEdit(root, { id: 'op-6', at: '2026-10-31', status: 'active', t: 'rename', node: 'team:gss', label: 'Global Shared Services' });
    const g = await rebuildGraph(root);
    expect(g.nodes.some((n) => n.id === 'idea:CAFE-2026-002')).toBe(true);
    expect(g.nodes.some((n) => n.id === 'team:gss')).toBe(true);
    expect(g.nodes.find((n) => n.id === 'person:priya-nair')!.label).toBe('Priya Nair');
    expect(g.nodes.find((n) => n.id === 'idea:CAFE-2026-001')!.label).toBe('Desk booking assistant');
    expect(g.nodes.find((n) => n.id === 'capability:request-handling')!.label).toBe('Handling requests');
    expect(g.nodes.find((n) => n.id === 'team:gss')!.label).toBe('Global Shared Services');
    const v = (await checkWorkspace(root)).violations;
    expect(v).toContain('operator.jsonl op-1: remove idea:CAFE-2026-002: an idea comes only from the form (a Café submission), so it is not removed by an edit (refused by the build)');
    expect(v).toContain('operator.jsonl op-2: remove team:gss: a Team comes only from the form, so it is not removed by an edit (refused by the build)');
    expect(v).toContain("operator.jsonl op-3: rename person:priya-nair: a person's name is its own record's, never an edit's (refused by the build)");
    expect(v).toContain("operator.jsonl op-4: rename idea:CAFE-2026-001: an idea's name is its own record's, never an edit's (refused by the build)");
    expect(v.filter((m) => /op-5|op-6/.test(m))).toEqual([]);
  });
  it('bug 6: KIND_OF self-loops and loops are refused; no nonsense dependency comes of them', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:procurement-mailbox', idea: 'CAFE-2026-002', newNodes: [{ id: 'system:procurement-mailbox', type: 'System', label: 'Procurement mailbox' }] }));
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'add', node: 'system:email', type: 'System', label: 'Email' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-31', status: 'active', t: 'link', from: 'system:procurement-mailbox', rel: 'KIND_OF', to: 'system:email' });
    await appendEdit(root, { id: 'op-3', at: '2026-10-31', status: 'active', t: 'link', from: 'system:email', rel: 'KIND_OF', to: 'system:procurement-mailbox' });
    await appendEdit(root, { id: 'op-4', at: '2026-10-31', status: 'active', t: 'link', from: 'system:email', rel: 'KIND_OF', to: 'system:email' });
    const g = await rebuildGraph(root);
    expect(g.edges.filter((e) => e.rel === 'KIND_OF').map((e) => e.id)).toEqual(['system:procurement-mailbox|KIND_OF|system:email']);
    expect(g.edges.filter((e) => e.rel === 'DEPENDS_ON').map((e) => e.id).sort()).toEqual(['idea:CAFE-2026-002|DEPENDS_ON|system:email', 'idea:CAFE-2026-002|DEPENDS_ON|system:procurement-mailbox']);
    const v = (await checkWorkspace(root)).violations;
    expect(v).toContain('operator.jsonl op-3: link system:email KIND_OF system:procurement-mailbox: system:procurement-mailbox is already a kind of system:email, so this would make a loop (refused by the build)');
    expect(v).toContain('operator.jsonl op-4: link system:email KIND_OF system:email: a system is not a kind of itself (refused by the build)');
  });
  it('bug 7: an entities.yaml id that lies about its section is not used: Email stays a system and its dependencies stay', async () => {
    const root = await workspace();
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', newNodes: EMAIL }));
    await writeYaml(paths(root).entities, { Tool: [{ id: 'tool:copilot-studio', label: 'Copilot Studio', aliases: ['UiPath'] }], Capability: [{ id: 'system:email', label: 'Email' }] });
    const g = await rebuildGraph(root);
    expect(g.nodes.find((n) => n.id === 'system:email')!.type).toBe('System');
    expect(g.edges.some((e) => e.id === 'idea:CAFE-2026-001|DEPENDS_ON|system:email')).toBe(true);
    const msgs = g.problems.map((p) => p.message);
    expect(msgs).toContain('entities.yaml: Capability: "system:email" does not start with "capability:" (not used by the build)');
    expect(msgs).toContain('entities.yaml: Tool: "tool:copilot-studio": alias "UiPath" names UiPath, which is not on the approved list (not used by the build)');
  });
});

describe('item 2: one ontology per build, never module state', () => {
  const VENDOR = { nodes: { Vendor: { label: 'Vendor', colour: '#123456', description: 'Who supplies a system' } }, relations: { SUPPLIED_BY: { from: 'System', to: 'Vendor', meaning: 'the system is supplied by the vendor', derived: false } } };
  async function seedVendor(root: string): Promise<void> {
    await writeYaml(paths(root).ontology, VENDOR);
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:expense-system', newNodes: [{ id: 'system:expense-system', type: 'System', label: 'Expense system' }] }));
    await appendEdit(root, { id: 'op-1', at: '2026-10-31', status: 'active', t: 'add', node: 'vendor:acme', type: 'Vendor' as never, label: 'Acme Corp' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-31', status: 'active', t: 'link', from: 'system:expense-system', rel: 'SUPPLIED_BY' as never, to: 'vendor:acme' });
  }
  it('bug 1: 120 builds at once, of a workspace with a declared kind and one without, each keep their own ontology', async () => {
    const declared = await workspace(); await seedVendor(declared);
    const plain = await workspace();
    const runs = await Promise.all(Array.from({ length: 120 }, (_, i) => rebuildGraph(i % 3 ? declared : plain).then((g) => ({ i, g }))));
    for (const { i, g } of runs) {
      if (i % 3) {
        expect(g.nodes.some((n) => n.id === 'vendor:acme' && n.type === ('Vendor' as never))).toBe(true);
        expect(g.edges.some((e) => e.id === 'system:expense-system|SUPPLIED_BY|vendor:acme')).toBe(true);
        expect(g.problems).toEqual([]);
      } else expect(g.schema.types).toEqual(BUILTIN_SCHEMA.types);
    }
    // The built-in tables never saw the declaration.
    expect(BUILTIN_SCHEMA.types.includes('Vendor' as never)).toBe(false);
  }, 60_000);
  it('bug 1: 120 concurrent /api/graph calls on the server all hold the declared vendor', async () => {
    const s = await startServer('2026-10-31');
    try {
      for (const i of IDEAS) await saveIdea(s.root, i);
      await seedVendor(s.root);
      const all = await Promise.all(Array.from({ length: 120 }, () => fetch(`${s.base}/api/graph`).then((r) => r.json() as Promise<any>)));
      const lost = all.filter((g) => !g.nodes.some((n: any) => n.id === 'vendor:acme') || !g.edges.some((e: any) => e.rel === 'SUPPLIED_BY'));
      expect(lost).toHaveLength(0);
      expect(all[0].ontology.nodes.Vendor.label).toBe('Vendor');
      expect(all[0].schema).toBeUndefined();
    } finally { s.server.close(); }
  }, 90_000);
  it('bug 2: a declared kind codes as Y1 for the AI, never undefined1', () => {
    const h = hideNames('Which ideas rely on Acme Corp?', [{ id: 'vendor:acme', type: 'Vendor' as never, label: 'Acme Corp' }, { id: 'vendor:globex', type: 'Vendor' as never, label: 'Globex' }], { all: true });
    expect(h.text).toBe('Which ideas rely on [Y1]?');
    expect([...h.codes.keys()].sort()).toEqual(['Y1', 'Y2']);
  });
  it('a compiled ontology is frozen: nothing can change it after the build began', () => {
    const { schema } = compileOntology(VENDOR);
    expect(Object.isFrozen(schema.types)).toBe(true);
    expect(() => { (schema.types as string[]).push('X'); }).toThrow();
  });
});

describe('item 2: the assistant says what went wrong as it is', () => {
  it('a deadline partial reply names the stars, never raw codes', async () => {
    const root = await workspace();
    let calls = 0;
    // The agent runs one search, then takes all the time it has left.
    const slow: Connector = {
      status: async () => ({ provider: 'fake', label: 'Slow' }), choices: async () => [], run: async () => { throw new Error('no'); }, look: async () => { throw new Error('no'); },
      runWith: async (_t: any, input: any, opts: any) => {
        if (calls++ === 0) {
          const code = input.stars.find((s: any) => s.label === 'Request handling')?.code;
          const steps = code ? [{ op: 'stars', codes: [code] }] : [{ op: 'stars', type: 'Capability', match: 'Request handling' }];
          return { provider: 'fake', label: 'Slow', output: { next: 'search', thought: 'Who needs it', query: { steps: [...steps, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true }] } } as any };
        }
        await new Promise((r) => setTimeout(r, opts?.timeoutMs ?? 1000)); throw new Error('timed out');
      },
    } as Connector;
    const e = await runCommand(root, 'Which ideas need Request handling?', slow, clock, { deadlineMs: 10_000 });
    expect(e.error).toMatch(/stopped at its deadline/);
    expect(e.reply).toContain('Request handling: Desk booking assistant, Procurement FAQ bot');
    expect(e.reply).not.toMatch(/\[[A-Z]\d+\]/);
  }, 20_000);
  it('a broken settings file is said as itself, and the AI is not asked', async () => {
    const root = await workspace();
    await writeFileAtomic(paths(root).settings, 'ai:\n  provider: "claude\n  bad: [');
    let asked = 0;
    const c = { status: async () => ({ provider: 'fake', label: 'X' }), choices: async () => [], run: async () => { throw new Error('no'); }, look: async () => { throw new Error('no'); }, runWith: async () => { asked++; throw new Error('should not be asked'); } } as unknown as Connector;
    const e = await runCommand(root, 'Which ideas need Request handling?', c, clock);
    expect(asked).toBe(0);
    expect(e.error).toMatch(/^rules\/settings\.yaml could not be read \(.+\), so the AI was not asked\. Fix the file/);
    expect(e.error).not.toMatch(/couldn't finish/);
  });
});

/* ---------- items 3 to 5 ---------- */
import { spawnSync } from 'node:child_process';
import { buildGraph } from '../src/graph/build';
import { runQuery, type Query } from '../src/command/query';
import { exportJsonLd } from '../src/graph/jsonld';
import { vocabularyTurtle } from '../src/graph/schema';
import { runNetwork, cycleRelations } from '../src/graph/network';
import { reviewInput } from '../src/review/suggestInput';
import { placeQuote, planAiLinks } from '../src/ai/apply';
import { defaultEntries, makeRegistry } from '../src/graph/registry';
import { checkReport, unscopedLine } from '../src/graph/check';

const PY = spawnSync('python3', ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim();
const THREE = [
  ...IDEAS,
  sampleIdea({ id: 'CAFE-2026-003', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'c', features: ['Policy answering'], outcomes: ['Save Time'], people: { submitter: 'Lucia Fernandez', team: [] } }),
];
const world = (g: ReturnType<typeof buildGraph>, extra: Partial<Parameters<typeof runQuery>[1]> = {}) => ({ graph: g, ideas: THREE, rounds: [], idOf: (c: string) => c, ...extra });

describe('item 3: "not confirmed" survives everywhere', () => {
  // 003 needs Request handling only by an AI link at 0.6, waiting for Do it (the f49 answer said all four were confirmed).
  const links: AiLink[] = [ai({ from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:request-handling', confidence: 0.6, idea: 'CAFE-2026-003' }), ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-001', newNodes: EMAIL })];
  const g = buildGraph(THREE, links);
  it('a plain follow over a link waiting for Do it says so, in the trace and in the facts the AI gets (qa-fix f49)', () => {
    const r = runQuery({ steps: [{ op: 'stars', codes: ['capability:request-handling'] }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea' }] } as Query, world(g));
    expect(r.final.sort()).toEqual(['idea:CAFE-2026-001', 'idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
    expect(r.trace.map((t) => t.text)).toContain('Not confirmed (waiting for your Do it): Travel policy assistant needs Request handling (0.6)');
    expect(r.unconfirmed).toEqual([{ from: 'idea:CAFE-2026-003', rel: 'NEEDS', to: 'capability:request-handling', confidence: 0.6 }]);
  });
  it('a ranking that counts a link waiting for Do it says how many of each count are not confirmed', () => {
    const r = runQuery({ steps: [{ op: 'stars', type: 'Capability' }, { op: 'rank', rel: 'NEEDS', dir: 'in', limit: 3 }] } as Query, world(g));
    expect(r.trace.some((t) => t.text === 'Not confirmed in these counts (waiting for your Do it): Request handling 1 of 3')).toBe(true);
  });
  it('an idea that needs a capability using the system for another idea only is said not to depend on it (q25: the bot and the travel policy)', () => {
    const r = runQuery({ steps: [{ op: 'stars', codes: ['system:email'] }, { op: 'follow', rel: 'DEPENDS_ON', dir: 'in', type: 'Idea' }] } as Query, world(g));
    expect(r.final).toEqual(['idea:CAFE-2026-001']);
    expect(r.trace.find((t) => t.text.startsWith('Not followed'))!.text).toBe('Not followed, so no depends on link for them: Procurement FAQ bot (needs Request handling, which uses Email for Desk booking assistant only); Travel policy assistant (needs Request handling, which uses Email for Desk booking assistant only)');
  });
  it('the decision AI is told which graph facts are not confirmed (suggestInput)', async () => {
    const root = await tmpWorkspace();
    for (const i of THREE) await saveIdea(root, i);
    for (const l of links) await appendAiLink(root, l);
    const { input, basis } = await reviewInput(root, 'CAFE-2026-003');
    expect(input.graph?.find((x) => x.label === 'Request handling')).toMatchObject({ confirmed: false });
    expect(basis).toMatch(/graph links? \(1 not confirmed\)/);
  });
  it('the export writes plain triples for confirmed facts only; an unconfirmed one is a Link with confirmed false', () => {
    const doc = exportJsonLd(g, { kind: 'all' });
    const idea3 = doc['@graph'].find((n: any) => n['@id'] === 'star:idea:CAFE-2026-003')!;
    expect(idea3.NEEDS ?? []).not.toContainEqual({ '@id': 'star:capability:request-handling' });
    expect(doc['@graph'].find((n: any) => n['@type'] === 'Link' && n.from === 'star:idea:CAFE-2026-003' && n.rel === 'NEEDS' && n.to === 'star:capability:request-handling')).toMatchObject({ confirmed: false });
  });
  it.skipIf(!PY)('NetworkX: suggestions rest on confirmed links only; a system counts the ideas that depend on it', async () => {
    const out = await runNetwork(g, ['central', 'suggest'], { top: 50, types: ['System'] });
    const email = out.results.central.byType.System.find((x: any) => x.id === 'system:email');
    expect(email.ideas).toBe(1);
    expect(out.results.suggest.evidence).toBe('confirmed links only');
  }, 60_000);
});

describe('item 4: NetworkX earns its place, honestly', () => {
  it.skipIf(!PY)('clusters leave out form choices and give a plain verdict from modularity', async () => {
    const g = buildGraph(THREE, []);
    const out = await runNetwork(g, ['clusters'], {});
    const c = out.results.clusters;
    expect(c.method).toMatch(/form choices, people and teams left out/);
    expect(['no-groups', 'some-groups', 'clear-groups']).toContain(c.verdict);
    expect(c.verdictText).toMatch(/groups|grouping/);
    for (const k of c.clusters) for (const b of k.binding) expect(['Capability', 'PainPoint']).toContain(b.type);
  }, 60_000);
  it('cycles: with the built-in ontology nothing can form one, said so; a declared loop of kinds can', async () => {
    expect(cycleRelations(BUILTIN_SCHEMA)).toEqual([]);
    const { schema } = compileOntology({ nodes: { Vendor: { label: 'Vendor' } }, relations: { SUPPLIED_BY: { from: 'System', to: 'Vendor', meaning: 'm', derived: false }, RUNS: { from: 'Vendor', to: 'System', meaning: 'm', derived: false } } });
    expect(cycleRelations(schema).sort()).toEqual(['RUNS', 'SUPPLIED_BY']);
    if (PY) {
      const out = await runNetwork(buildGraph(THREE, []), ['cycles'], {});
      expect(out.results.cycles).toMatchObject({ applicable: false });
    }
  }, 60_000);
  it('a path does not run through a form-choice hub (q17: Priya Nair to the Expense system through Reduce Manual Effort)', () => {
    const two = [
      sampleIdea({ id: 'CAFE-2026-001', slug: 'a', title: 'A idea', dedupe_key: 'a', outcomes: ['Save Time'], features: ['Cap one'], people: { submitter: 'Ann Lee', team: [] } }),
      sampleIdea({ id: 'CAFE-2026-002', slug: 'b', title: 'B idea', dedupe_key: 'b', outcomes: ['Save Time'], features: ['Cap two'], people: { submitter: 'Bo Kim', team: [] } }),
    ];
    const g = buildGraph(two, []);
    const r = runQuery({ steps: [{ op: 'path', codes: ['person:ann-lee', 'idea:CAFE-2026-002'] }] } as Query, { graph: g, ideas: two, rounds: [], idOf: (c: string) => c });
    expect(r.path ?? []).not.toContain('outcome:save-time');
  });
});

describe('item 5: newcomer-safe RDF and verifiable provenance', () => {
  const two = [
    sampleIdea({ id: 'CAFE-2026-001', slug: 'a', title: 'A idea', dedupe_key: 'a', features: ['Cap one', 'Cap two'], people: { submitter: 'Ann Lee', team: [] } }),
    sampleIdea({ id: 'CAFE-2026-002', slug: 'b', title: 'B idea', dedupe_key: 'b', features: ['Cap one', 'Cap two'], people: { submitter: 'Bo Kim', team: [] } }),
  ];
  it('SIMILAR_TO is symmetric: declared so and written both ways', () => {
    const doc = exportJsonLd(buildGraph(two, []), { kind: 'all' });
    const a = doc['@graph'].find((n: any) => n['@id'] === 'star:idea:CAFE-2026-001')!;
    const b = doc['@graph'].find((n: any) => n['@id'] === 'star:idea:CAFE-2026-002')!;
    expect(a.SIMILAR_TO).toEqual([{ '@id': 'star:idea:CAFE-2026-002' }]);
    expect(b.SIMILAR_TO).toEqual([{ '@id': 'star:idea:CAFE-2026-001' }]);
    expect(vocabularyTurtle()).toMatch(/cafe:SIMILAR_TO a rdf:Property, owl:ObjectProperty, owl:SymmetricProperty/);
  });
  it('aliases are skos:altLabel, so "T&E policy" is found by its name', () => {
    const registry = makeRegistry(defaultEntries(), [{ id: 'op-1', at: '', status: 'active', t: 'alias', node: 'system:travel-expense-policy', label: 'T&E policy', of: 'Travel & Expense policy' }]);
    const g = buildGraph(two, [ai({ from: 'capability:cap-one', rel: 'USES_DATA', to: 'system:travel-expense-policy', newNodes: [{ id: 'system:travel-expense-policy', type: 'System', label: 'Travel & Expense policy' }] })], [], [], { registry });
    const doc = exportJsonLd(g, { kind: 'all' });
    expect(doc['@graph'].find((n: any) => n['@id'] === 'star:system:travel-expense-policy')).toMatchObject({ altLabel: ['T&E policy'] });
    expect(doc['@context'].altLabel).toEqual({ '@id': 'http://www.w3.org/2004/02/skos/core#altLabel', '@container': '@set' });
  });
  it('an AI fact carries the passage it was read in and when; a quote in another field moves the source there (apply.ts:156)', () => {
    const idea = sampleIdea({ challenge: 'Claims are checked by hand.', additional_context: 'We keep the anomaly rules in a small rules spreadsheet.' });
    expect(placeQuote('the anomaly rules in a small rules spreadsheet', 'challenge', idea as never)).toEqual({ field: 'additional_context', found: true });
    expect(placeQuote('something nobody wrote', 'challenge', idea as never)).toEqual({ field: 'challenge', found: false });
    const out = { nodes: [{ type: 'System' as const, label: 'Rules spreadsheet' }, { type: 'Capability' as const, label: 'Rule checks' }], links: [
      { from: 'idea', to: 'Rule checks', rel: 'NEEDS' as const, description: 'd', confidence: 0.9, field: 'challenge', quote: 'Claims are checked by hand' },
      { from: 'Rule checks', to: 'Rules spreadsheet', rel: 'USES_DATA' as const, description: 'd', confidence: 0.9, field: 'challenge', quote: 'anomaly rules in a small rules spreadsheet' },
    ] };
    const plan = planAiLinks(idea.id, out, buildGraph([idea], []), [], 'claude', { text: idea as never, at: '2026-10-31T10:00:00.000Z' });
    expect(plan.links.map((l) => [l.source, l.quote, l.readAt])).toEqual([
      ['ai:claude:challenge', 'Claims are checked by hand', '2026-10-31T10:00:00.000Z'],
      ['ai:claude:additional_context', 'anomaly rules in a small rules spreadsheet', '2026-10-31T10:00:00.000Z'],
    ]);
    const g = buildGraph([idea], plan.links.map((l) => ({ ...l, status: 'confirmed' as const })));
    const e = g.edges.find((x) => x.rel === 'USES_DATA')!;
    expect(e).toMatchObject({ quote: 'anomaly rules in a small rules spreadsheet', readAt: '2026-10-31T10:00:00.000Z' });
    const link = exportJsonLd(g, { kind: 'all' })['@graph'].find((n: any) => n['@type'] === 'Link' && n.rel === 'USES_DATA')!;
    expect(link).toMatchObject({ quote: 'anomaly rules in a small rules spreadsheet', quoteFound: true, readAt: '2026-10-31T10:00:00.000Z', source: 'ai:claude:additional_context' });
  });
  it('provenance is queryable: which links the operator added, and where one link came from (q45)', () => {
    const edits = [{ id: 'op-1', at: '2026-10-26', status: 'active' as const, t: 'link' as const, from: 'idea:CAFE-2026-001', rel: 'REPLACES' as const, to: 'painpoint:slow', idea: 'CAFE-2026-001' },
      { id: 'op-0', at: '2026-10-26', status: 'active' as const, t: 'add' as const, node: 'painpoint:slow', type: 'PainPoint' as const, label: 'Slow' }];
    const g = buildGraph(two, [ai({ from: 'capability:cap-one', rel: 'USES_DATA', to: 'system:email', quote: 'by email', newNodes: EMAIL })], [], [edits[1], edits[0]]);
    const r = runQuery({ steps: [{ op: 'links', source: 'operator' }] } as Query, { graph: g, ideas: two, rounds: [], idOf: (c: string) => c });
    expect(r.links!.map((l) => [l.from, l.rel, l.to, l.edit, l.at])).toEqual([['idea:CAFE-2026-001', 'REPLACES', 'painpoint:slow', 'op-1', '2026-10-26']]);
    expect(r.trace.map((t) => t.text)).toContain('A idea replaces Slow: added by the operator (op-1, 2026-10-26) for CAFE-2026-001');
    const one = runQuery({ steps: [{ op: 'links', codes: ['capability:cap-one', 'system:email'] }] } as Query, { graph: g, ideas: two, rounds: [], idOf: (c: string) => c });
    expect(one.trace.map((t) => t.text).find((t) => t.startsWith('Cap one uses data Email'))).toMatch(/read by the AI \(fake\) in challenge: "by email"/);
  });
  it('the registry wins over containment: Microsoft Copilot is not Copilot Studio (q27, q47)', () => {
    const idea = sampleIdea({ features: ['Policy answering'], tools: { 'Policy answering': 'Copilot Studio' } });
    const g = buildGraph([idea], []);
    const registry = makeRegistry(defaultEntries(), []);
    for (const match of ['Microsoft Copilot', 'Copilot', 'M365 Copilot']) {
      const r = runQuery({ steps: [{ op: 'stars', type: 'Tool', match }, { op: 'follow', rel: 'USES', dir: 'in', type: 'Idea' }] } as Query, { graph: g, ideas: [idea], rounds: [], idOf: (c: string) => c, registry });
      expect(r.final).toEqual([]);
      expect(r.trace[0].text).toMatch(/exactly: Microsoft Copilot, known as .*not in the graph/);
    }
    const studio = runQuery({ steps: [{ op: 'stars', type: 'Tool', match: 'Copilot Studio' }, { op: 'follow', rel: 'USES', dir: 'in', type: 'Idea' }] } as Query, { graph: g, ideas: [idea], rounds: [], idOf: (c: string) => c, registry });
    expect(studio.final).toEqual(['idea:CAFE-2026-001']);
  });
  it('check.ts:53: an unscoped fact about a system says no idea reaches the system, not "needs the capability"', () => {
    const line = unscopedLine({ where: 'operator.jsonl op-402', edge: 'system:expense-system|SUPPLIED_BY|vendor:acme', from: 'system:expense-system', rel: 'SUPPLIED_BY' as never, to: 'vendor:acme', needers: [], confirming: [] });
    expect(line).toMatch(/No idea reaches system:expense-system yet/);
    expect(line).not.toMatch(/capability/);
    void checkReport;
  });
});

describe('item 4: a cluster is passed on only when the groups are real', () => {
  it.skipIf(!PY)('two groups that share nothing are clear groups; each idea\'s stage input names its own', async () => {
    const { ideaNetwork } = await import('../src/graph/network');
    const mk = (n: number, caps: string[]) => sampleIdea({ id: `CAFE-2026-00${n}`, slug: `i${n}`, title: `Idea ${n}`, dedupe_key: `k${n}`, features: caps, people: { submitter: `Person ${n}`, team: [] } });
    const ideas = [mk(1, ['Cap a', 'Cap b']), mk(2, ['Cap a', 'Cap b']), mk(3, ['Cap a', 'Cap b']), mk(4, ['Cap c', 'Cap d']), mk(5, ['Cap c', 'Cap d']), mk(6, ['Cap c', 'Cap d'])];
    const g = buildGraph(ideas, []);
    const out = await runNetwork(g, ['clusters'], {});
    expect(out.results.clusters.verdict).toBe('clear-groups');
    const n = await ideaNetwork(g, 'CAFE-2026-001');
    expect(n.available && n.cluster?.others.map((x) => x.id).sort()).toEqual(['idea:CAFE-2026-002', 'idea:CAFE-2026-003']);
  }, 60_000);
});

describe('the hypothetical idea (c5c): a capability fact proposed with the idea that needs it is for that idea', () => {
  it('"X needs C, and for this idea C uses S" proposes both, the second stamped for X, even when another idea has it already', async () => {
    const { resolveSteps } = await import('../src/command/actions');
    const hypo = sampleIdea({ id: 'CAFE-2026-008', slug: 'h', title: 'Hypothetical claims checker', dedupe_key: 'h', people: { submitter: 'Hy Po', team: [] } });
    const g = buildGraph([...IDEAS, hypo], [ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:expense-system', newNodes: [{ id: 'system:expense-system', type: 'System', label: 'Expense system' }] })]);
    const codes = new Map([['I8', { id: 'idea:CAFE-2026-008', type: 'Idea' as const, label: 'Hypothetical claims checker' }], ['C1', { id: 'capability:request-handling', type: 'Capability' as const, label: 'Request handling' }], ['S1', { id: 'system:expense-system', type: 'System' as const, label: 'Expense system' }]]);
    const r = resolveSteps([{ op: 'link', a: 'I8', b: 'C1', rel: 'NEEDS' }, { op: 'link', a: 'C1', b: 'S1', rel: 'USES_DATA' }], { codes, graph: g, ideas: [...IDEAS, hypo], rounds: [] });
    expect(r.problems).toEqual([]);
    expect(r.proposals.map((p) => p.action)).toEqual([
      { t: 'link', from: 'idea:CAFE-2026-008', rel: 'NEEDS', to: 'capability:request-handling' },
      expect.objectContaining({ t: 'link', from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:expense-system', idea: 'CAFE-2026-008' }),
    ]);
  });
});

describe('f48: a capability fact stated for no idea is followed for the ideas the rules let it hold for', () => {
  it('op-9 (Policy answering uses the policy, no idea) counts for the travel assistant, whose own facts confirm it', () => {
    const idea = sampleIdea({ id: 'CAFE-2026-006', slug: 't', title: 'Travel policy assistant', dedupe_key: 't', features: ['Policy answering', 'Text extraction'], people: { submitter: 'Lu Fe', team: [] } });
    const links = [ai({ from: 'capability:text-extraction', rel: 'USES_DATA', to: 'system:travel-policy', idea: 'CAFE-2026-006', newNodes: [{ id: 'system:travel-policy', type: 'System', label: 'Travel policy' }] })];
    const op9 = { id: 'op-9', at: '2026-10-26', status: 'active' as const, t: 'link' as const, from: 'capability:policy-answering', rel: 'USES_DATA' as const, to: 'system:travel-policy' };
    const g = buildGraph([idea], links, [], [op9]);
    const r = runQuery({ steps: [{ op: 'stars', codes: ['system:travel-policy'] }, { op: 'follow', rel: 'USES_DATA', dir: 'in', type: 'Capability' }, { op: 'follow', rel: 'NEEDS', dir: 'in', type: 'Idea', group: true }] } as Query, { graph: g, ideas: [idea], rounds: [], idOf: (c: string) => c });
    expect(r.groups!.map((x) => `${x.from} ${x.to.join(',')}`).sort()).toEqual(['capability:policy-answering idea:CAFE-2026-006', 'capability:text-extraction idea:CAFE-2026-006']);
  });
});

describe('cafe ontology fix: repoint or retire a stale edit, record a confirmation, correct a source field: only as told', () => {
  it('lists the stale edit with candidates, changes nothing unasked, and repoints, retires or confirms only as told', async () => {
    const { planFix, applyFix, fixLines } = await import('../src/graph/fix');
    const root = await workspace();
    await saveIdea(root, sampleIdea({ ...IDEAS[0], additional_context: 'Requests also come in through the shared mailbox.' }));
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:shared-mailbox', newNodes: [{ id: 'system:shared-mailbox', type: 'System', label: 'Shared mailbox' }] }));
    await appendAiLink(root, ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', confidence: 0.3, confirmedBy: 'operator', newNodes: EMAIL }));
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:request-routing', rel: 'USES_DATA', to: 'system:shared-mailbox', idea: 'CAFE-2026-001' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:gone', rel: 'USES_DATA', to: 'system:shared-mailbox', idea: 'CAFE-2026-001' });
    const dry = await planFix(root);
    expect(dry.stale.map((x) => [x.edit, x.candidates[0]?.id])).toEqual([['op-1', 'capability:request-handling'], ['op-2', 'capability:request-handling']]);
    expect(dry.fields).toEqual([{ line: 1, edge: 'capability:request-handling|USES_DATA|system:shared-mailbox', was: 'challenge', now: 'additional_context', by: 'label' }]);
    expect(dry.forged).toEqual([{ line: 2, edge: 'capability:request-handling|USES_DATA|system:email', confidence: 0.3 }]);
    const lines = fixLines(dry);
    expect(lines.some((l) => l.includes('--repoint op-1=capability:request-handling (Request handling)'))).toBe(true);
    expect(lines.some((l) => l.includes('--confirm line-2'))).toBe(true);
    const plan = await planFix(root, {}, { repoint: { 'op-1': 'capability:request-handling' }, retire: ['op-2'], confirm: [2] });
    const done = await applyFix(root, plan, fixedClock('2026-10-31'));
    expect(done).toEqual(expect.arrayContaining([
      'operator.jsonl op-1: repointed from capability:request-routing to capability:request-handling (Request handling)',
      'operator.jsonl op-2: switched off (link capability:gone USES_DATA system:shared-mailbox), kept in the log',
      'ai-links.jsonl line 2: your Do it recorded (cafe ontology fix --confirm)',
    ]));
    const after = await checkWorkspace(root);
    expect(after.stale).toEqual([]);
    expect((await rebuildGraph(root)).edges.find((e) => e.id === 'capability:request-handling|USES_DATA|system:email')!.confirmed).toBe(true);
    expect((await rebuildGraph(root)).edges.find((e) => e.id === 'capability:request-handling|USES_DATA|system:shared-mailbox')!.source).toBe('ai:fake:additional_context');
  });
});

describe('q17 (after fix): a NetworkX path hop along a derived link says how it is derived', () => {
  it('the trace gives the rule and the stated links, so the reply never guesses the capability', () => {
    const g = buildGraph(IDEAS, [ai({ from: 'capability:request-handling', rel: 'USES_DATA', to: 'system:email', newNodes: EMAIL })]);
    const run = { ok: { networkx: '3.7', scopeText: 'stored facts and derived links', results: { path: { found: true, length: 1, count: 1, paths: [{ stars: [{ id: 'idea:CAFE-2026-001' }, { id: 'system:email' }], hops: [{ from: 'idea:CAFE-2026-001', to: 'system:email', rels: [{ from: 'idea:CAFE-2026-001', rel: 'DEPENDS_ON', to: 'system:email' }] }] }] } } } };
    const r = runQuery({ steps: [{ op: 'network', analysis: 'path', codes: ['idea:CAFE-2026-001', 'system:email'], derived: true }] } as Query, { graph: g, ideas: IDEAS, rounds: [], idOf: (c: string) => c, network: () => run as never });
    expect(r.trace[1].text).toBe('Desk booking assistant depends on Email (derived by needs+uses_data from Desk booking assistant NEEDS Request handling, Request handling USES_DATA Email)');
  });
});
