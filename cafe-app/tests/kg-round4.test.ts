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
