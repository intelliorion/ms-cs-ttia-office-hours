import { APPROVED_TOOLS, BUILTIN_SCHEMA, KNOWN_UNAPPROVED_TOOLS, TOOL_ALIASES, canonId, idMatchesType, nameKey, setToolResolver, slug, typeOfId, type NodeType, type OperatorEdit, type Schema } from './ontology';

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
export const REGISTRY_SECTIONS: NodeType[] = ['Tool', 'System', 'Team', 'Entity', 'Capability', 'PainPoint', 'Beneficiary', 'Category', 'Outcome', 'Support'];

export interface Registry {
  /** The star a label names, by its label or any alias in the one normal form (nameKey), or undefined. */
  resolve(type: NodeType, label: string): { id: string; label: string } | undefined;
  aliasesOf(id: string): string[];
  refOf(id: string): string | undefined;
  /** The approved tools' labels, in file order. */
  tools(): string[];
  entries: RegistryEntries;
  /** A hash of what it was made from: part of the bundle cache's key, so a new alias or entry recomputes the bundles. */
  version: string;
  /** What it would not take, one line each (an id that lies about its section, an alias that makes a tool look approved). */
  refused: string[];
}

/** The not-approved tool a name means (UiPath, Power Automate …), compared in the one normal form, or undefined. */
export function unapprovedTool(name: string): string | undefined {
  return KNOWN_UNAPPROVED_TOOLS.find((t) => nameKey(t, 'Tool') === nameKey(name, 'Tool'));
}

function fnv1a32(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export function makeRegistry(entries: RegistryEntries, edits: OperatorEdit[], schema: Schema = BUILTIN_SCHEMA): Registry {
  const byId = new Map<string, { type: NodeType; label: string; aliases: string[]; ref?: string }>();
  const refused: string[] = [];
  /** A name that would make a tool not on the approved list look like an approved one (or approved itself). */
  const retired = (type: NodeType, name: string) => (type === 'Tool' ? unapprovedTool(name) : undefined);
  for (const type of Object.keys(entries) as NodeType[]) {
    if (!REGISTRY_SECTIONS.includes(type) || !Array.isArray(entries[type])) continue;
    for (const e of entries[type] ?? []) {
      if (!e || typeof e.id !== 'string' || typeof e.label !== 'string' || !e.id.trim() || !e.label.trim()) continue;
      // An id must carry its section's kind: "system:email" filed under Capability would make Email a capability.
      if (!idMatchesType(e.id.trim(), type)) { refused.push(`entities.yaml: ${type}: "${e.id}" does not start with "${type.toLowerCase()}:" (not used by the build)`); continue; }
      const bad = retired(type, e.label);
      if (bad) { refused.push(`entities.yaml: Tool: "${e.id}" is ${bad}, which is not on the approved list (not used by the build)`); continue; }
      const aliases = (Array.isArray(e.aliases) ? e.aliases : []).map(String).filter((a) => a.trim()).filter((a) => {
        const r = retired(type, a);
        if (r) refused.push(`entities.yaml: Tool: "${e.id}": alias "${a}" names ${r}, which is not on the approved list (not used by the build)`);
        return !r;
      });
      byId.set(canonId(e.id.trim()), { type, label: e.label.trim(), aliases, ...(e.ref ? { ref: String(e.ref) } : {}) });
    }
  }
  for (const e of edits) {
    if (e.t !== 'alias' || e.status !== 'active' || !e.label.trim()) continue;
    const node = canonId(e.node);
    const type = typeOfId(node, schema); if (!type) continue;
    const r = retired(type, e.label);
    if (r) { refused.push(`operator.jsonl ${e.id}: alias "${e.label}" on ${e.node} names ${r}, which is not on the approved list (refused by the build)`); continue; }
    const have = byId.get(node);
    if (have) { if (!have.aliases.includes(e.label)) have.aliases.push(e.label); continue; }
    byId.set(node, { type, label: (e.of ?? e.label).trim(), aliases: [e.label] });
  }
  // One lookup table per type: the slug of the label and of every alias → the star.
  const lookup = new Map<NodeType, Map<string, string>>();
  for (const [id, e] of byId) {
    let m = lookup.get(e.type); if (!m) lookup.set(e.type, (m = new Map()));
    for (const name of [e.label, ...e.aliases]) { const k = nameKey(name, e.type); if (!m.has(k)) m.set(k, id); }
  }
  return {
    entries, refused,
    version: fnv1a32(JSON.stringify([entries, edits.filter((e) => e.t === 'alias' && e.status === 'active')])),
    resolve(type, label) {
      const id = lookup.get(type)?.get(nameKey(label, type));
      return id ? { id, label: byId.get(id)!.label } : undefined;
    },
    aliasesOf: (id) => [...(byId.get(canonId(id))?.aliases ?? [])],
    refOf: (id) => byId.get(canonId(id))?.ref,
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
