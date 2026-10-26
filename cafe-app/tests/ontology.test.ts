import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { ALLOWED, NODE_COLOURS, NODE_LABELS, RELATION_MEANINGS, NODE_DESCRIPTIONS, BUILTIN_ONTOLOGY, applyOntology, currentOntology, resetOntology, DERIVED_RELATIONS, AI_RELATIONS } from '../src/graph/ontology';
import { loadOntology, readOntologyFile } from '../src/graph/ontologyFile';
import { extractTask } from '../src/ai/tasks';
import { writeYaml, writeFileAtomic } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import { tmpWorkspace } from './helpers';

afterEach(() => resetOntology());

describe('the ontology as data', () => {
  it('the built-in ontology is what the constants derive from, and what init writes', async () => {
    for (const t of Object.keys(NODE_LABELS) as (keyof typeof NODE_LABELS)[]) {
      expect(BUILTIN_ONTOLOGY.nodes[t]).toEqual({ label: NODE_LABELS[t], colour: NODE_COLOURS[t], description: NODE_DESCRIPTIONS[t] });
    }
    for (const r of Object.keys(ALLOWED) as (keyof typeof ALLOWED)[]) {
      expect(BUILTIN_ONTOLOGY.relations[r]).toEqual({ from: ALLOWED[r][0], to: ALLOWED[r][1], meaning: RELATION_MEANINGS[r].meaning, inverse: RELATION_MEANINGS[r].inverse, derived: DERIVED_RELATIONS.includes(r) });
      expect(RELATION_MEANINGS[r].meaning.length).toBeGreaterThan(10);
    }
    const root = await tmpWorkspace();
    expect(YAML.parse(await readFile(path.join(root, 'rules', 'ontology.yaml'), 'utf8'))).toEqual(BUILTIN_ONTOLOGY);
    expect(await loadOntology(root)).toEqual({ ontology: BUILTIN_ONTOLOGY, problems: [] });
    expect(currentOntology()).toEqual(BUILTIN_ONTOLOGY);
  });
  it('a missing or unreadable file means the built-in ontology; a changed label, colour or meaning is applied in place', async () => {
    const root = await tmpWorkspace();
    await writeFileAtomic(paths(root).ontology, 'nodes: [a: {');
    expect((await loadOntology(root)).ontology).toEqual(BUILTIN_ONTOLOGY);
    const file = (await readOntologyFile(root)) ?? BUILTIN_ONTOLOGY;
    await writeYaml(paths(root).ontology, {
      nodes: { ...BUILTIN_ONTOLOGY.nodes, System: { ...BUILTIN_ONTOLOGY.nodes.System, label: 'System', colour: '#00ff00' } },
      relations: { ...BUILTIN_ONTOLOGY.relations, USES_DATA: { ...BUILTIN_ONTOLOGY.relations.USES_DATA, meaning: 'reads from the system' } },
    });
    const { problems } = await loadOntology(root);
    expect(problems).toEqual([]);
    expect(NODE_LABELS.System).toBe('System'); expect(NODE_COLOURS.System).toBe('#00ff00');
    expect(RELATION_MEANINGS.USES_DATA.meaning).toBe('reads from the system');
    expect(ALLOWED.USES_DATA).toEqual(['Capability', 'System']);
    resetOntology();
    expect(NODE_LABELS.System).toBe('System or data');
    expect(file.nodes.System.label).toBe('System or data');
  });
  it('unknown types, relations and bad pairs are reported and ignored; the rest still applies', () => {
    const problems = applyOntology({
      nodes: { Gadget: { label: 'Gadget', colour: '#fff', description: '' }, Idea: { label: 'Use case', colour: NODE_COLOURS.Idea, description: 'x' } },
      relations: { LOVES: { from: 'Idea', to: 'Idea', meaning: 'm', inverse: 'i', derived: false }, NEEDS: { from: 'Idea', to: 'Gadget', meaning: 'm', inverse: 'i', derived: false } },
    } as any);
    expect(problems).toEqual([
      'ontology.yaml: unknown node type "Gadget" (ignored)',
      'ontology.yaml: unknown relation "LOVES" (ignored)',
      'ontology.yaml: NEEDS: unknown node type "Gadget" (the pair is kept as built in)',
    ]);
    expect(NODE_LABELS.Idea).toBe('Use case');
    expect(ALLOWED.NEEDS).toEqual(['Idea', 'Capability']);
  });
  it('the extraction prompt tells the AI what each relation means, from the ontology', () => {
    const prompt = extractTask.prompt({ idea: { id: 'CAFE-2026-001', title: 'X' }, existing: { capabilities: [], systems: [], painPoints: [] } });
    for (const r of AI_RELATIONS.filter((x) => x !== 'BUILT_WITH')) expect(prompt).toContain(`${r} ${ALLOWED[r][1]} (${RELATION_MEANINGS[r].meaning})`);
    applyOntology({ relations: { NEEDS: { ...BUILTIN_ONTOLOGY.relations.NEEDS, meaning: 'must be able to do this' } } } as any);
    expect(extractTask.prompt({ idea: { id: 'CAFE-2026-001', title: 'X' }, existing: { capabilities: [], systems: [], painPoints: [] } })).toContain('NEEDS Capability (must be able to do this)');
  });
});

import { checkWorkspace } from '../src/graph/check';
import { importExport } from '../src/import/importRows';
import { DEFAULT_STEPS } from '../src/rules/stages';
import { fixedClock } from '../src/clock';
import { appendAiLink } from '../src/graph/store';
import { appendEdit } from '../src/graph/operator';
import { FIXTURE } from './helpers';

describe('cafe ontology check', () => {
  it('a workspace built by the app is clean', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-26'), steps: DEFAULT_STEPS });
    await appendAiLink(root, { from: 'idea:CAFE-2026-001', to: 'capability:slot-finding', rel: 'NEEDS', description: 'd', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', idea: 'CAFE-2026-001', newNodes: [{ id: 'capability:slot-finding', type: 'Capability', label: 'Slot finding' }] });
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'alias', node: 'capability:slot-finding', label: 'Finding slots', of: 'Slot finding' });
    const r = await checkWorkspace(root);
    expect(r.violations).toEqual([]);
    expect(r.checked).toMatchObject({ nodes: expect.any(Number), edges: expect.any(Number), derived: expect.any(Number) });
    expect(r.checked.nodes).toBeGreaterThan(0);
  });
  it('a broken workspace: every violation named, nothing fixed', async () => {
    const root = await tmpWorkspace();
    await importExport(root, FIXTURE, { clock: fixedClock('2026-10-26'), steps: DEFAULT_STEPS });
    await writeYaml(paths(root).ontology, { nodes: { Gadget: { label: 'G', colour: '#fff', description: '' } }, relations: { NEEDS: { from: 'Idea', to: 'Gadget' } } });
    await writeYaml(paths(root).entities, {
      Tool: [{ id: 'tool:dataiku', label: 'Dataiku', aliases: ['dss'] }, { id: 'tool:dataiku', label: 'Dataiku again', aliases: [] }],
      System: [{ id: 'system:a', label: 'A', aliases: ['dss'] }, { id: 'capability:wrong', label: 'Wrong prefix', aliases: ['dss'] }, { label: 'No id' }],
      Widget: [],
    });
    await writeYaml(paths(root).inference, { rules: [{ name: 'bad', chain: ['NEEDS', 'NOPE'], then: 'DEPENDS_ON' }, { name: 'misfit', chain: ['NEEDS', 'HAS_MEMBER'], then: 'OWNS' }, { name: 'stated', chain: ['NEEDS', 'USES_DATA'], then: 'NEEDS' }] });
    await appendAiLink(root, { from: 'idea:CAFE-2026-001', to: 'system:x', rel: 'NEEDS', description: 'd', source: 'ai:fake', confidence: 0.9, status: 'confirmed', newNodes: [{ id: 'system:x', type: 'System', label: 'X' }] });
    await appendAiLink(root, { from: 'idea:CAFE-2026-001', to: 'capability:y', rel: 'LOVES' as any, description: 'd', source: 'ai:fake', confidence: 0.9, status: 'confirmed' });
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'alias', node: 'capability:gone', label: 'Nothing', of: 'Gone' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-26', status: 'active', t: 'link', from: 'idea:CAFE-2026-001', rel: 'HAS_MEMBER', to: 'idea:CAFE-2026-002' });
    const before = await readFile(paths(root).entities, 'utf8');
    const { violations } = await checkWorkspace(root);
    expect(violations).toEqual([
      'ontology.yaml: unknown node type "Gadget" (ignored)',
      'ontology.yaml: NEEDS: unknown node type "Gadget" (the pair is kept as built in)',
      'entities.yaml: Tool: duplicate id "tool:dataiku"',
      'entities.yaml: System: "capability:wrong" does not start with "system:"',
      'entities.yaml: System: "capability:wrong": alias "dss" is already A\'s',
      'entities.yaml: System: entry 3 has no id or label',
      'entities.yaml: unknown section "Widget"',
      'inference.yaml: bad: unknown relation "NOPE"',
      'inference.yaml: misfit: NEEDS ends at Capability but HAS_MEMBER starts at Team',
      'inference.yaml: stated: NEEDS is not a derived relation',
      'ai-links.jsonl line 1: NEEDS goes Idea → Capability, not Idea → System (skipped by the build)',
      'ai-links.jsonl line 2: unknown relation "LOVES" (skipped by the build)',
      'operator.jsonl op-1: alias "Nothing" on capability:gone, which is not in the graph',
      'operator.jsonl op-2: HAS_MEMBER goes Team → Person, not Idea → Idea (skipped by the build)',
    ]);
    expect(await readFile(paths(root).entities, 'utf8')).toBe(before);
  });
});
