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
