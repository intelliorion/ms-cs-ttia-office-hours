import { APPROVED_TOOLS, NODE_TYPES, TOOL_ALIASES, setToolResolver, slug, type NodeType, type OperatorEdit } from './ontology';

/**
 * The registry: stable identity for the stars that keep coming back under other words. One entry per star, with its
 * id (type:slug), its label, the other names it goes by and, when there is one, a reference (a CSIC catalogue id,
 * say). It is `rules/entities.yaml` plus the operator's `alias` edits; with no file it is the approved tools alone,
 * so an older workspace builds exactly the graph it did. This module reads no files (the UI imports its neighbours):
 * `registryFile.ts` loads it.
 */
export interface RegistryEntry { id: string; label: string; aliases?: string[]; ref?: string }
export type RegistryEntries = Partial<Record<NodeType, RegistryEntry[]>>;
/** The sections entities.yaml holds, in file order. */
export const REGISTRY_SECTIONS: NodeType[] = ['Tool', 'System', 'Team', 'Entity', 'Capability', 'PainPoint', 'Beneficiary'];

export interface Registry {
  /** The star a label names, by its label or any alias (case, spacing and accents ignored), or undefined. */
  resolve(type: NodeType, label: string): { id: string; label: string } | undefined;
  aliasesOf(id: string): string[];
  refOf(id: string): string | undefined;
  /** The approved tools' labels, in file order. */
  tools(): string[];
  entries: RegistryEntries;
}

const typeOfId = (id: string): NodeType | undefined => NODE_TYPES.find((t) => id.startsWith(`${t.toLowerCase()}:`));

export function makeRegistry(entries: RegistryEntries, edits: OperatorEdit[]): Registry {
  const byId = new Map<string, { type: NodeType; label: string; aliases: string[]; ref?: string }>();
  for (const type of Object.keys(entries) as NodeType[]) {
    if (!NODE_TYPES.includes(type)) continue;
    for (const e of entries[type] ?? []) {
      if (!e || typeof e.id !== 'string' || typeof e.label !== 'string' || !e.id.trim() || !e.label.trim()) continue;
      byId.set(e.id, { type, label: e.label.trim(), aliases: (e.aliases ?? []).map(String).filter((a) => a.trim()), ...(e.ref ? { ref: String(e.ref) } : {}) });
    }
  }
  for (const e of edits) {
    if (e.t !== 'alias' || e.status !== 'active' || !e.label.trim()) continue;
    const type = typeOfId(e.node); if (!type) continue;
    const have = byId.get(e.node);
    if (have) { if (!have.aliases.includes(e.label)) have.aliases.push(e.label); continue; }
    byId.set(e.node, { type, label: (e.of ?? e.label).trim(), aliases: [e.label] });
  }
  // One lookup table per type: the slug of the label and of every alias → the star.
  const lookup = new Map<NodeType, Map<string, string>>();
  for (const [id, e] of byId) {
    let m = lookup.get(e.type); if (!m) lookup.set(e.type, (m = new Map()));
    for (const name of [e.label, ...e.aliases]) { const k = slug(name); if (!m.has(k)) m.set(k, id); }
  }
  return {
    entries,
    resolve(type, label) {
      const id = lookup.get(type)?.get(slug(label));
      return id ? { id, label: byId.get(id)!.label } : undefined;
    },
    aliasesOf: (id) => [...(byId.get(id)?.aliases ?? [])],
    refOf: (id) => byId.get(id)?.ref,
    tools: () => [...byId.values()].filter((e) => e.type === 'Tool').map((e) => e.label),
  };
}

/** The built-in Tool section: today's approved tools and their aliases, as `canonicalTool` always knew them. */
export function defaultEntries(): RegistryEntries {
  return {
    Tool: APPROVED_TOOLS.map((label) => ({
      id: `tool:${slug(label)}`, label,
      aliases: Object.entries(TOOL_ALIASES).filter(([k, v]) => v === label && k !== label.toLowerCase()).map(([k]) => k),
    })),
  };
}

/** What `init` writes: the tools, and an empty section for each other kind the operator may name. */
export function seedEntities(): RegistryEntries {
  const out: RegistryEntries = {};
  for (const t of REGISTRY_SECTIONS) out[t] = t === 'Tool' ? defaultEntries().Tool : [];
  return out;
}

let current: Registry | undefined;
/** The registry last loaded for a workspace; the built-in tools before any load. */
export function currentRegistry(): Registry {
  return current ?? (current = makeRegistry(defaultEntries(), []));
}
export function setCurrentRegistry(r: Registry): void {
  current = r;
  setToolResolver((label) => r.resolve('Tool', label)?.label);
}
