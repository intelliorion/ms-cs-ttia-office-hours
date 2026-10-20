import { describe, it, expect } from 'vitest';
import { buildGraph, nodeId } from '../src/graph/build';
import { ALLOWED, NODE_COLOURS } from '../src/graph/ontology';
import { layoutFor } from '../src/graph/layout';
import { rebuildGraph, appendAiLink, setAiLinkStatus, readAiLinks } from '../src/graph/store';
import { tmpWorkspace, sampleIdea, FIXTURE } from './helpers';
import { importExport } from '../src/import/importRows';
import { DEFAULT_STEPS as steps } from '../src/rules/stages';
import { fixedClock } from '../src/clock';
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
    expect(rels).toContain('idea:CAFE-2026-002 NEEDS capability:agent-design-guidance');
  });

  it('keeps one node per person across ideas, with a role link to each', () => {
    const g = buildGraph([rfx, inv], []);
    expect(g.nodes.filter((n) => n.label === 'Person 3')).toHaveLength(1);
    expect(g.edges.filter((e) => e.from === 'person:person-3').map((e) => e.rel).sort()).toEqual(['RELATED', 'SPONSORS']);
  });

  it('never turns attributes into nodes and puts stage on the idea node', () => {
    const g = buildGraph([rfx], []);
    expect(g.nodes.some((n) => /APAC|2026-|@/.test(n.label))).toBe(false);
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
    for (const t of ['Entity', 'Team', 'Person', 'Idea', 'PainPoint', 'Capability', 'Tool', 'System'] as const) expect(NODE_COLOURS[t]).toMatch(/^#/);
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
    expect(await readFile(path.join(root, 'graph', 'nodes.jsonl'), 'utf8')).toContain('"idea:CAFE-2026-001"');
  });

  it('an unreadable layout.json is treated as empty and rewritten', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    const g = await rebuildGraph(root);
    await mkdir(path.join(root, 'graph'), { recursive: true });
    await writeFile(path.join(root, 'graph', 'layout.json'), '{"idea:CAFE-2026-001": [1, 2', 'utf8');
    const l = await layoutFor(root, g);
    expect(Object.keys(l)).toHaveLength(g.nodes.length);
    expect(JSON.parse(await readFile(path.join(root, 'graph', 'layout.json'), 'utf8'))).toEqual(l);
  });

  it('a garbage line in ai-links.jsonl is skipped and listed as a problem; writes keep it', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-19'), steps });
    const link = { from: 'idea:CAFE-2026-002', to: 'capability:ticketing-and-status', rel: 'NEEDS' as const, description: 'd', source: 'ai:challenge', confidence: 0.6, status: 'pending' as const, newNodes: [{ id: 'capability:ticketing-and-status', type: 'Capability' as const, label: 'Ticketing and status' }] };
    await appendAiLink(root, link);
    const file = path.join(root, 'graph', 'ai-links.jsonl');
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
