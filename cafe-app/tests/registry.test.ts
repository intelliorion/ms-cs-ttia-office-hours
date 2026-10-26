import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { makeRegistry, defaultEntries, currentRegistry, type RegistryEntries } from '../src/graph/registry';
import { loadRegistry } from '../src/graph/registryFile';
import { canonicalTool, isApprovedTool, APPROVED_TOOLS } from '../src/graph/ontology';
import { appendEdit } from '../src/graph/operator';
import { writeYaml, writeFileAtomic } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import { tmpWorkspace } from './helpers';

const entries: RegistryEntries = {
  Tool: [{ id: 'tool:microsoft-copilot', label: 'Microsoft Copilot', aliases: ['copilot', 'M365 Copilot'] }],
  System: [{ id: 'system:travel-expense-policy', label: 'Travel & Expense policy', aliases: ['travel policy', 'T&E policy'], ref: 'CSIC-SYS-014' }],
  Capability: [{ id: 'capability:policy-q-a', label: 'Policy Q&A', aliases: ['Policy questions and answers'] }],
};

describe('the registry resolves a label or an alias to one star', () => {
  const reg = makeRegistry(entries, []);
  it.each([
    ['System', 'Travel & Expense policy', 'system:travel-expense-policy'],
    ['System', 'travel policy', 'system:travel-expense-policy'],
    ['System', '  TRAVEL   Policy ', 'system:travel-expense-policy'],
    ['System', 'T&E policy', 'system:travel-expense-policy'],
    ['Tool', 'copilot', 'tool:microsoft-copilot'],
    ['Capability', 'Policy questions and answers', 'capability:policy-q-a'],
  ] as const)('%s "%s" → %s', (type, label, id) => {
    expect(reg.resolve(type, label)).toEqual({ id, label: entries[type]![0].label });
  });
  it('ignores diacritics and case, and knows nothing of a label it has not seen or of another type', () => {
    const r = makeRegistry({ Team: [{ id: 'team:gss', label: 'GSS', aliases: ['Global Sourcing Sérvices'] }] }, []);
    expect(r.resolve('Team', 'global sourcing services')?.id).toBe('team:gss');
    expect(r.resolve('Team', 'BSI')).toBeUndefined();
    expect(r.resolve('Capability', 'GSS')).toBeUndefined();
  });
  it('lists a star\'s aliases and reference, and the approved tools in file order', () => {
    expect(reg.aliasesOf('system:travel-expense-policy')).toEqual(['travel policy', 'T&E policy']);
    expect(reg.refOf('system:travel-expense-policy')).toBe('CSIC-SYS-014');
    expect(reg.aliasesOf('capability:nothing')).toEqual([]);
    expect(reg.tools()).toEqual(['Microsoft Copilot']);
  });
  it('an alias edit adds an alias to a star the file does not know, with the label it recorded', () => {
    const r = makeRegistry(entries, [
      { id: 'op-1', at: '2026-10-26', status: 'active', t: 'alias', node: 'capability:slot-finding', label: 'Slot findings', of: 'Slot finding' },
      { id: 'op-2', at: '2026-10-26', status: 'undone', t: 'alias', node: 'capability:slot-finding', label: 'Finding slots', of: 'Slot finding' },
      { id: 'op-3', at: '2026-10-26', status: 'active', t: 'alias', node: 'system:travel-expense-policy', label: 'travel rules' },
    ]);
    expect(r.resolve('Capability', 'slot findings')).toEqual({ id: 'capability:slot-finding', label: 'Slot finding' });
    expect(r.resolve('Capability', 'Finding slots')).toBeUndefined();
    expect(r.resolve('System', 'travel rules')).toEqual({ id: 'system:travel-expense-policy', label: 'Travel & Expense policy' });
    expect(r.aliasesOf('capability:slot-finding')).toEqual(['Slot findings']);
  });
});

describe('the default registry is today\'s approved tools', () => {
  it('has every approved tool with its aliases, so canonicalTool is unchanged', () => {
    const d = defaultEntries();
    expect(d.Tool!.map((t) => t.label)).toEqual(APPROVED_TOOLS);
    const r = makeRegistry(d, []);
    expect(r.resolve('Tool', 'PowerApps')).toEqual({ id: 'tool:power-apps', label: 'Power Apps' });
    expect(canonicalTool('Microsoft 365 Copilot')).toBe('Microsoft Copilot');
    expect(canonicalTool('Dataiku DSS')).toBe('Dataiku');
    expect(canonicalTool('UiPath')).toBeUndefined();
    expect(isApprovedTool('bespoke app')).toBe(true);
  });
});

describe('loadRegistry', () => {
  it('reads rules/entities.yaml (written by init) plus the alias edits; without the file it is the default', async () => {
    const root = await tmpWorkspace();
    const file = YAML.parse(await readFile(path.join(root, 'rules', 'entities.yaml'), 'utf8'));
    expect(file.Tool.map((t: any) => t.label)).toEqual(APPROVED_TOOLS);
    for (const section of ['System', 'Team', 'Entity', 'Capability', 'PainPoint', 'Beneficiary']) expect(file[section]).toEqual([]);
    await writeYaml(paths(root).entities, { ...file, System: [{ id: 'system:expense-export', label: 'Expense export', aliases: ['expense system export'] }] });
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'alias', node: 'system:expense-export', label: 'T&E export', of: 'Expense export' });
    const r = await loadRegistry(root);
    expect(r.resolve('System', 'Expense System Export')?.id).toBe('system:expense-export');
    expect(r.resolve('System', 't&e export')?.id).toBe('system:expense-export');
    expect(r.aliasesOf('system:expense-export')).toEqual(['expense system export', 'T&E export']);
    // Loading makes it the registry canonicalTool reads; the tools are still the approved ones.
    expect(currentRegistry()).toBe(r);
    expect(canonicalTool('copilot')).toBe('Microsoft Copilot');
    const bare = await tmpWorkspace();
    await writeYaml(paths(bare).entities, { Tool: [{ id: 'tool:dataiku', label: 'Dataiku', aliases: [] }] });
    const only = await loadRegistry(bare);
    expect(only.tools()).toEqual(['Dataiku']);
    expect(canonicalTool('Power Apps')).toBeUndefined();
    await loadRegistry(root);
    expect(canonicalTool('Power Apps')).toBe('Power Apps');
  });
  it('a missing or unreadable file falls back to the default, never throws', async () => {
    const root = await tmpWorkspace();
    await writeFileAtomic(paths(root).entities, 'Tool: [a: {');
    const r = await loadRegistry(root);
    expect(r.tools()).toEqual(APPROVED_TOOLS);
  });
});
