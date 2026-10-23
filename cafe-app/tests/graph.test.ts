import { describe, it, expect } from 'vitest';
import { buildGraph, nodeId } from '../src/graph/build';
import { ALLOWED, NODE_COLOURS } from '../src/graph/ontology';
import { layoutFor } from '../src/graph/layout';
import { rebuildGraph, appendAiLink, setAiLinkStatus, readAiLinks } from '../src/graph/store';
import { tmpWorkspace, sampleIdea, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';
import { saveIdea } from '../src/ideas/store';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const rfx = sampleIdea({
  id: 'CAFE-2026-002', slug: 'rfx', title: 'RFx CoE Intake', entity: 'CS', function: 'GSS', region: 'APAC', stage: 2,
  support: ['Agent Design Guidance', 'Collab…'],
  people: { submitter: 'Person 2', team: [{ name: 'Person 2', role: 'lead', note: 'Lead' }, { name: 'Person 3', role: 'sponsor', note: 'Sponsor' }, { name: 'Person 4', role: 'member' }] },
});
const inv = sampleIdea({
  id: 'CAFE-2026-003', slug: 'inv', title: 'Invoice Assessment', entity: 'CS', function: 'GSS', region: 'APAC',
  support: ['AI Solution Brainstorming'], people: { submitter: 'Person 5', team: [{ name: 'Person 3', role: 'member' }] },
});

describe('buildGraph', () => {
  it('builds entity → team → person → idea with roles', () => {
    const g = buildGraph([rfx], []);
    const types = Object.fromEntries(g.nodes.map((n) => [n.id, n.type]));
    expect(types['entity:cs']).toBe('Entity');
    expect(types['team:gss']).toBe('Team');
    expect(types['idea:CAFE-2026-002']).toBe('Idea');
    expect(g.nodes.filter((n) => n.type === 'Person').map((n) => n.label).sort()).toEqual(['Person 2', 'Person 3', 'Person 4']);
    const rels = g.edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
    expect(rels).toContain('entity:cs HAS_TEAM team:gss');
    expect(rels).toContain('team:gss HAS_MEMBER person:person-2');
    expect(rels).toContain('person:person-2 SUBMITTED idea:CAFE-2026-002');
    expect(rels).toContain('person:person-3 SPONSORS idea:CAFE-2026-002');
    expect(rels).toContain('person:person-4 RELATED idea:CAFE-2026-002');
    expect(g.edges.find((e) => e.rel === 'SUBMITTED')?.description).toBe('Submitter Name; also listed as Lead');
    expect(rels).toContain('idea:CAFE-2026-002 ASKS_FOR support:agent-design-guidance');
    expect(g.nodes.find((n) => n.id === 'support:agent-design-guidance')?.type).toBe('Support');
    expect(g.nodes.some((n) => n.type === 'Capability')).toBe(false);
  });

  it('turns desired outcomes, beneficiaries and use case categories into shared stars; long free text stays on the idea', () => {
    const a = sampleIdea({ ...rfx, outcomes: ['Save Time', 'Reduce Manual Effort'], beneficiaries: ['Procurement team'], use_case_category: ['Document processing'] });
    const b = sampleIdea({ ...inv, outcomes: ['Save Time', 'x'.repeat(61)], beneficiaries: [], use_case_category: ['Document processing'] });
    const g = buildGraph([a, b], []);
    const rels = g.edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
    expect(rels).toContain('idea:CAFE-2026-002 WANTS outcome:save-time');
    expect(rels).toContain('idea:CAFE-2026-003 WANTS outcome:save-time');
    expect(rels).toContain('idea:CAFE-2026-002 BENEFITS beneficiary:procurement-team');
    expect(rels).toContain('idea:CAFE-2026-003 IN_CATEGORY category:document-processing');
    expect(g.nodes.filter((n) => n.type === 'Outcome').map((n) => n.label).sort()).toEqual(['Reduce Manual Effort', 'Save Time']);
    expect(g.edges.find((e) => e.rel === 'WANTS')?.source).toBe('form:CAFE-2026-002:Desired Outcomes');
    for (const r of ['WANTS', 'BENEFITS', 'IN_CATEGORY'] as const) expect(ALLOWED[r][0]).toBe('Idea');
  });

  it('puts a person in a team only through their own submission', () => {
    const bsi = sampleIdea({
      id: 'CAFE-2026-004', slug: 'bsi', title: 'Meeting notes', entity: 'CS', function: 'BSI', region: 'AMER',
      support: [], people: { submitter: 'Person 6', team: [] },
    });
    const gss = sampleIdea({
      id: 'CAFE-2026-005', slug: 'gss', title: 'FAQ bot', entity: 'CS', function: 'GSS', region: 'AMER',
      support: [], people: { submitter: 'Person 7', team: [{ name: 'Person 7', role: 'lead' }, { name: 'Person 6', role: 'member' }, { name: 'Person 8', role: 'sponsor' }] },
    });
    const rels = buildGraph([bsi, gss], []).edges.map((e) => `${e.from} ${e.rel} ${e.to}`);
    expect(rels).toContain('team:bsi HAS_MEMBER person:person-6');
    expect(rels).not.toContain('team:gss HAS_MEMBER person:person-6');
    expect(rels).not.toContain('team:gss HAS_MEMBER person:person-8');
    expect(rels).toContain('team:gss HAS_MEMBER person:person-7');
    expect(rels).toContain('person:person-6 RELATED idea:CAFE-2026-005');
  });

  it('keeps one node per person across ideas, with a role link to each', () => {
    const g = buildGraph([rfx, inv], []);
    expect(g.nodes.filter((n) => n.label === 'Person 3')).toHaveLength(1);
    expect(g.edges.filter((e) => e.from === 'person:person-3').map((e) => e.rel).sort()).toEqual(['RELATED', 'SPONSORS']);
  });

  it('never turns attributes into nodes and puts stage on the idea node', () => {
    const g = buildGraph([rfx], []);
    // A round star is labelled with the round's own name, so it is left out here.
    expect(g.nodes.some((n) => n.type !== 'Round' && /APAC|2026-|@/.test(n.label))).toBe(false);
    const idea = g.nodes.find((n) => n.id === 'idea:CAFE-2026-002')!;
    expect(idea.attrs).toMatchObject({ stage: 2, stageLabel: 'Review and Select' });
  });

  it('gives every edge a source and confidence 1 for form links', () => {
    const g = buildGraph([rfx], []);
    for (const e of g.edges) {
      expect(e.source).toMatch(/^form:/);
      expect(e.confidence).toBe(1);
      expect(e.confirmed).toBe(true);
      expect(ALLOWED[e.rel]).toBeDefined();
    }
  });

  it('applies AI links, dashed below 0.7, and drops dangling ones', () => {
    const ai = [
      { from: 'idea:CAFE-2026-002', to: 'capability:ticketing-and-status', rel: 'NEEDS' as const, description: 'shared mailbox re-keyed into a tracker', source: 'ai:challenge', confidence: 0.65, status: 'pending' as const, newNodes: [{ id: 'capability:ticketing-and-status', type: 'Capability' as const, label: 'Ticketing and status' }] },
      { from: 'idea:CAFE-2026-099', to: 'capability:x', rel: 'NEEDS' as const, description: 'gone', source: 'ai:challenge', confidence: 0.9, status: 'confirmed' as const, newNodes: [{ id: 'capability:x', type: 'Capability' as const, label: 'X' }] },
      { from: 'idea:CAFE-2026-002', to: 'capability:removed', rel: 'NEEDS' as const, description: 'no', source: 'ai:challenge', confidence: 0.9, status: 'removed' as const, newNodes: [{ id: 'capability:removed', type: 'Capability' as const, label: 'Removed' }] },
    ];
    const g = buildGraph([rfx], ai);
    const e = g.edges.find((x) => x.to === 'capability:ticketing-and-status')!;
    expect(e.confirmed).toBe(false);
    expect(e.confidence).toBe(0.65);
    expect(g.nodes.some((n) => n.id === 'capability:x')).toBe(false);
    expect(g.nodes.some((n) => n.id === 'capability:removed')).toBe(false);
  });

  it('is deterministic and handles an empty workspace', () => {
    expect(buildGraph([rfx, inv], [])).toEqual(buildGraph([inv, rfx], []));
    expect(buildGraph([], [])).toEqual({ nodes: [], edges: [] });
  });

  it('has a colour for every type', () => {
    for (const t of ['Entity', 'Team', 'Person', 'Idea', 'PainPoint', 'Capability', 'Tool', 'System', 'Support', 'Outcome', 'Beneficiary', 'Category'] as const) expect(NODE_COLOURS[t]).toMatch(/^#/);
    expect(nodeId('Team', 'GSS')).toBe('team:gss');
  });
});

describe('hardening', () => {
  it('keeps non-ASCII names apart and folds accents', () => {
    expect(nodeId('Person', '李雷')).not.toBe(nodeId('Person', '王芳'));
    expect(nodeId('Person', 'José')).toBe(nodeId('Person', 'jose'));
    expect(nodeId('Person', '***').length).toBeGreaterThan('person:'.length);
  });
  it('never lets AI links create people, ideas or people links', () => {
    const ai = [
      { from: 'person:evil', to: 'idea:CAFE-2026-002', rel: 'SUBMITTED' as const, description: 'x', source: 'ai:challenge', confidence: 0.9, status: 'confirmed' as const, newNodes: [{ id: 'person:evil', type: 'Person' as const, label: 'Evil' }] },
      { from: 'idea:CAFE-2026-002', to: 'idea:fake', rel: 'NEEDS' as const, description: 'x', source: 'ai:challenge', confidence: 0.9, status: 'confirmed' as const, newNodes: [{ id: 'idea:fake', type: 'Idea' as const, label: 'Fake' }] },
    ];
    const base = buildGraph([rfx], []);
    expect(buildGraph([rfx], ai)).toEqual(base);
  });
});

describe('AI links that bring new nodes', () => {
  it('stay unconfirmed whatever the confidence until the operator confirms them', () => {
    const idea = sampleIdea();
    const link = {
      from: 'idea:CAFE-2026-001', to: 'capability:document-parsing', rel: 'NEEDS' as const, description: 'd', source: 'ai:fake:challenge', confidence: 0.9,
      status: 'pending' as const, newNodes: [{ id: 'capability:document-parsing', type: 'Capability' as const, label: 'Document parsing' }],
    };
    const find = (g: ReturnType<typeof buildGraph>) => g.edges.find((e) => e.to === 'capability:document-parsing')!;
    expect(find(buildGraph([idea], [link])).confirmed).toBe(false);
    expect(find(buildGraph([idea], [{ ...link, status: 'confirmed' }])).confirmed).toBe(true);
  });
});

describe('store and layout', () => {
  it('rebuilds from the folders, caches a stable layout, and confirms a link', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    const g1 = await rebuildGraph(root);
    expect(g1.nodes.length).toBeGreaterThan(5);
    const l1 = await layoutFor(root, g1);
    const l2 = await layoutFor(root, g1);
    expect(l2).toEqual(l1);
    for (const p of Object.values(l1)) expect(p.every(Number.isFinite)).toBe(true);
    await appendAiLink(root, { from: 'idea:CAFE-2026-002', to: 'capability:ticketing-and-status', rel: 'NEEDS', description: 'd', source: 'ai:challenge', confidence: 0.6, status: 'pending', newNodes: [{ id: 'capability:ticketing-and-status', type: 'Capability', label: 'Ticketing and status' }] });
    const g2 = await rebuildGraph(root);
    const edge = g2.edges.find((e) => e.to === 'capability:ticketing-and-status')!;
    expect(edge.confirmed).toBe(false);
    const l3 = await layoutFor(root, g2);
    expect(l3['idea:CAFE-2026-002']).toEqual(l1['idea:CAFE-2026-002']);
    expect(l3['capability:ticketing-and-status']).toBeDefined();
    await setAiLinkStatus(root, edge.id, 'confirmed');
    const g3 = await rebuildGraph(root);
    expect(g3.edges.find((e) => e.id === edge.id)?.confirmed).toBe(true);
    await setAiLinkStatus(root, edge.id, 'removed');
    expect((await rebuildGraph(root)).edges.some((e) => e.id === edge.id)).toBe(false);
    expect(await readFile(path.join(root, 'data', 'graph', 'nodes.jsonl'), 'utf8')).toContain('"idea:CAFE-2026-001"');
  });

  it('an unreadable layout.json is treated as empty and rewritten', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    const g = await rebuildGraph(root);
    await mkdir(path.join(root, 'data', 'graph'), { recursive: true });
    await writeFile(path.join(root, 'data', 'graph', 'layout.json'), '{"idea:CAFE-2026-001": [1, 2', 'utf8');
    const l = await layoutFor(root, g);
    expect(Object.keys(l)).toHaveLength(g.nodes.length);
    expect(JSON.parse(await readFile(path.join(root, 'data', 'graph', 'layout.json'), 'utf8'))).toEqual(l);
  });

  it('a garbage line in ai-links.jsonl is skipped and listed as a problem; writes keep it', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    const link = { from: 'idea:CAFE-2026-002', to: 'capability:ticketing-and-status', rel: 'NEEDS' as const, description: 'd', source: 'ai:challenge', confidence: 0.6, status: 'pending' as const, newNodes: [{ id: 'capability:ticketing-and-status', type: 'Capability' as const, label: 'Ticketing and status' }] };
    await appendAiLink(root, link);
    const file = path.join(root, 'data', 'graph', 'ai-links.jsonl');
    await writeFile(file, `${await readFile(file, 'utf8')}{"from": "torn\n`, 'utf8');
    const read = await readAiLinks(root);
    expect(read.links).toHaveLength(1);
    expect(read.problems).toEqual([{ line: 2, message: expect.any(String) }]);
    const g = await rebuildGraph(root);
    expect(g.problems).toHaveLength(1);
    expect(g.edges.some((e) => e.to === 'capability:ticketing-and-status')).toBe(true);
    await appendAiLink(root, { ...link, to: 'capability:other', newNodes: [{ id: 'capability:other', type: 'Capability', label: 'Other' }] });
    await setAiLinkStatus(root, 'idea:CAFE-2026-002|NEEDS|capability:ticketing-and-status', 'confirmed');
    const after = await readAiLinks(root);
    expect(after.links.map((l) => l.status)).toEqual(['confirmed', 'pending']);
    expect(after.problems).toHaveLength(1);
    expect(await readFile(file, 'utf8')).toContain('{"from": "torn');
  });
});

import { APPROVED_TOOLS, canonicalTool, isApprovedTool } from '../src/graph/ontology';
import { extractInput, planAiLinks } from '../src/ai/apply';
import { extractTask } from '../src/ai/tasks';

describe('approved tools', () => {
  it('maps variants to canonical labels and detects unapproved tools', () => {
    expect(APPROVED_TOOLS).toHaveLength(6);
    expect(canonicalTool('Microsoft Copilot Studio')).toBe('Copilot Studio');
    expect(canonicalTool('  power  APPS ')).toBe('Power Apps');
    expect(canonicalTool('Custom app')).toBe('custom app');
    expect(canonicalTool('custom code')).toBe('custom app');
    expect(isApprovedTool('UiPath')).toBe(true);
    for (const t of ['Microsoft Planner', 'Power Automate', 'Microsoft Teams']) expect(isApprovedTool(t)).toBe(false);
  });
  it('never takes a tool from the AI: Tool stars and BUILT_WITH links are dropped, the rest is kept', () => {
    const graph = { nodes: [{ id: 'capability:routing', type: 'Capability' as const, label: 'Routing' }], edges: [] };
    const out = {
      nodes: [{ type: 'Capability' as const, label: 'Doc parsing' }, { type: 'Tool' as const, label: 'Copilot Studio' }, { type: 'Tool' as const, label: 'Microsoft Planner' }],
      links: [
        { from: 'idea', to: 'Doc parsing', rel: 'NEEDS' as const, description: 'Reads requests', confidence: 0.9 },
        { from: 'Doc parsing', to: 'Copilot Studio', rel: 'BUILT_WITH' as const, description: 'Bot', confidence: 0.9 },
        { from: 'Doc parsing', to: 'Microsoft Planner', rel: 'BUILT_WITH' as const, description: 'Tasks', confidence: 0.9 },
      ],
    };
    const { links, newNodes } = planAiLinks('CAFE-1', out as any, graph, [], 'fake');
    expect(links.map((l) => l.rel)).toEqual(['NEEDS']);
    expect(newNodes.map((n) => n.type)).toEqual(['Capability']);
  });

  it('never adds a support request: the AI cannot reuse or copy a Support star', () => {
    const graph = buildGraph([rfx], []);
    const out = {
      nodes: [{ type: 'Capability' as const, label: 'Agent Design Guidance' }, { type: 'Capability' as const, label: 'Clause finding' }],
      links: [
        { from: 'idea', to: 'Agent Design Guidance', rel: 'NEEDS' as const, description: 'Asked for help', confidence: 0.9 },
        { from: 'idea', to: 'Clause finding', rel: 'NEEDS' as const, description: 'Finds clauses', confidence: 0.9 },
      ],
    };
    const { links } = planAiLinks('CAFE-2026-002', out as any, graph, [], 'fake');
    expect(links.map((l) => l.to)).toEqual(['capability:clause-finding']);
    const input = extractInput(rfx, graph.nodes);
    expect(input.existing.capabilities).not.toContain('Agent Design Guidance');
  });

  it('never adds an outcome, beneficiary or category: those come only from the form', () => {
    const graph = buildGraph([{ ...rfx, outcomes: ['Save Time'] }], []);
    const out = {
      nodes: [{ type: 'Capability' as const, label: 'Save Time' }, { type: 'Outcome' as const, label: 'Happier staff' }],
      links: [
        { from: 'idea', to: 'Save Time', rel: 'NEEDS' as const, description: 'Copies the outcome', confidence: 0.9 },
        { from: 'idea', to: 'Happier staff', rel: 'WANTS' as const, description: 'Made up', confidence: 0.9 },
      ],
    };
    const { links } = planAiLinks('CAFE-2026-002', out as any, graph, [], 'fake');
    expect(links).toEqual([]);
  });

  it('gives the AI the business impact, beneficiaries and additional context, but not the use case category or maturity', () => {
    const idea = { ...rfx, business_impact: 'Saves 2 hours a week', beneficiaries: ['Office managers'], additional_context: 'Pilot first.', maturity: 'Prototype', use_case_category: ['Workplace'] };
    const { idea: sent } = extractInput(idea, []);
    expect(sent).toMatchObject({ business_impact: 'Saves 2 hours a week', beneficiaries: ['Office managers'], additional_context: 'Pilot first.' });
    expect(sent).not.toHaveProperty('maturity');
    expect(extractTask.prompt({ idea: sent, existing: { capabilities: [], systems: [], painPoints: [] } })).toMatch(/Saves 2 hours a week/);
  });
});

describe('rounds in the graph', () => {
  const r1 = { id: 'ROUND-001', name: '2026 Q4', created: '2026-10-01' };
  const r2 = { id: 'ROUND-002', name: 'Spring pilots', created: '2026-10-20' };
  const a = sampleIdea({ id: 'CAFE-2026-010', title: 'A', round: 'ROUND-001' });
  const b = sampleIdea({ id: 'CAFE-2026-011', title: 'B', round: 'ROUND-001' });
  const c = sampleIdea({ id: 'CAFE-2026-012', title: 'C', round: '' });

  it('draws every round as a star and links each idea to its round', () => {
    const g = buildGraph([a, b, c], [], [r1, r2]);
    const rounds = g.nodes.filter((n) => n.type === 'Round');
    expect(rounds.map((n) => [n.id, n.label, n.attrs])).toEqual([
      [nodeId('Round', 'ROUND-001'), '2026 Q4', { roundId: 'ROUND-001', ideas: 2 }],
      [nodeId('Round', 'ROUND-002'), 'Spring pilots', { roundId: 'ROUND-002', ideas: 0 }],
    ]);
    const links = g.edges.filter((e) => e.rel === 'IN_ROUND');
    expect(links.map((e) => [e.from, e.to, e.description, e.source, e.confidence, e.confirmed])).toEqual([
      ['idea:CAFE-2026-010', nodeId('Round', 'ROUND-001'), 'Round', 'form:CAFE-2026-010', 1, true],
      ['idea:CAFE-2026-011', nodeId('Round', 'ROUND-001'), 'Round', 'form:CAFE-2026-011', 1, true],
    ]);
    expect(ALLOWED.IN_ROUND).toEqual(['Idea', 'Round']);
    expect(NODE_COLOURS.Round).toBe('#e7d8b1');
  });

  it('still draws the link when the round folder is missing', () => {
    const g = buildGraph([sampleIdea({ round: 'ROUND-999' })], [], [r1]);
    const lost = g.nodes.find((n) => n.id === nodeId('Round', 'ROUND-999'));
    expect(lost).toMatchObject({ type: 'Round', label: 'ROUND-999', attrs: { roundId: 'ROUND-999', ideas: 1 } });
    expect(g.edges.filter((e) => e.rel === 'IN_ROUND').map((e) => e.to)).toEqual([nodeId('Round', 'ROUND-999')]);
  });

  it('rebuilds a legacy workspace with its old round as a star', async () => {
    const root = await tmpWorkspace();
    await mkdir(path.join(root, 'data', 'rounds', 'ROUND-2026-Q4'), { recursive: true });
    await writeFile(path.join(root, 'data', 'rounds', 'ROUND-2026-Q4', 'round.yaml'), 'id: ROUND-2026-Q4\n');
    await saveIdea(root, sampleIdea({ round: 'ROUND-2026-Q4' }));
    const g = await rebuildGraph(root);
    const star = g.nodes.find((n) => n.type === 'Round');
    expect(star?.label).toBe('ROUND-2026-Q4');
    expect(g.edges.filter((e) => e.rel === 'IN_ROUND').map((e) => [e.from, e.to])).toEqual([['idea:CAFE-2026-001', star?.id]]);
  });
});
