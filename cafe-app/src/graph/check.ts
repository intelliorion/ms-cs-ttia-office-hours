import { AI_NODE_TYPES, AI_RELATIONS, ALLOWED, DERIVED_RELATIONS, NODE_TYPES, idMatchesType, nameKey, type GEdge, type GNode, type NodeType, type Relation } from './ontology';
import { readOntologyFile } from './ontologyFile';
import { applyOntology, resetOntology } from './ontology';
import { readEntities } from './registryFile';
import { REGISTRY_SECTIONS } from './registry';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';
import { readEdits } from './operator';
import { readAiLinks, rebuildGraph } from './store';
import { staleEdits, type StaleEdit } from './build';
import { confirmer, readRules, type Rule } from './rules';
import { confirmAt } from '../ai/confirm';
import { loadSettings } from '../round/store';

/**
 * `cafe ontology check`: the workspace's files and graph against the ontology. It reads, it reports, it never fixes
 * (`cafe ontology fix` does, dry-run first). Each violation is one line saying which file, where, and what is wrong.
 */
export interface CheckResult {
  violations: string[]; checked: { nodes: number; edges: number; derived: number };
  /** Operator edits pointing at stars the graph no longer holds (after following merges): skipped by the build, never deleted. */
  stale: StaleEdit[];
  /** Capability-level facts stated for no idea: they give no idea a dependency on their own (see rules.ts). */
  unscoped?: Unscoped[];
  /** AI links confirmed without the operator's Do it although their confidence is below the threshold. */
  lowConfidence?: LowConfidence[];
}
export interface Unscoped {
  /** "operator.jsonl op-9" or "ai-links.jsonl line 12". */
  where: string; edge: string; from: string; rel: Relation; to: string;
  /** The ideas that need the capability; those whose own facts already derive the same dependency (they confirm it). */
  needers: string[]; confirming: string[];
}
export interface LowConfidence { line: number; edge: string; confidence: number; idea?: string }

/** One line per stale edit, as the CLI prints it and /api/graph lists it. */
export const staleLine = (s: StaleEdit) => `operator.jsonl ${s.id}: ${s.what}: ${s.missing.join(', ')} ${s.missing.length === 1 ? 'is' : 'are'} not in the graph`;

const isRelation = (v: unknown): v is Relation => typeof v === 'string' && Object.hasOwn(ALLOWED, v);
const isType = (v: unknown): v is NodeType => typeof v === 'string' && NODE_TYPES.includes(v as NodeType);
const pair = (rel: Relation) => `${ALLOWED[rel][0]} → ${ALLOWED[rel][1]}`;

/** The relations a same-idea rule reads that have no Idea end: a fact of that kind must say which idea it is for. */
export function scopedRelations(rules: Rule[]): Relation[] {
  const out = new Set<Relation>();
  for (const r of rules) if (r.kind === 'chain' && r.enabled && r.scope === 'same-idea') for (const rel of r.chain) if (ALLOWED[rel][0] !== 'Idea' && ALLOWED[rel][1] !== 'Idea') out.add(rel);
  return [...out];
}

/**
 * For a capability-level fact: the ideas that need its capability, and of those the ones that confirm it (their own
 * facts already derive the same dependency, so the fact holds for them). What `fix` stamps, and what check shows.
 */
export function scopeCandidates(graph: { nodes: GNode[]; edges: GEdge[] }, from: string, to: string): { needers: string[]; confirming: string[] } {
  const needers = [...new Set(graph.edges.filter((e) => e.rel === 'NEEDS' && e.to === from && !e.derived).map((e) => e.from.slice('idea:'.length)))].sort();
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const confirms = confirmer(graph.edges, (id) => types.get(id));
  const self = graph.edges.find((e) => !e.derived && e.from === from && e.to === to)?.id;
  // An idea confirms it when its own facts reach the far end by another link than this one (the rules read it so).
  return { needers, confirming: needers.filter((i) => confirms(i, to, self)) };
}

export async function checkWorkspace(root: string): Promise<CheckResult> {
  const out: string[] = [];

  // 1. The ontology file: applied the way the app applies it, which says what it cannot take.
  resetOntology();
  const ontology = await readOntologyFile(root);
  if (ontology) out.push(...applyOntology(ontology));
  else if ((await readText(paths(root).ontology)) !== undefined) out.push('ontology.yaml: could not be read (the built-in ontology applies)');

  // 2. The entities file: known sections, ids with the section's prefix, no duplicate ids or aliases.
  const entities = await readEntities(root);
  if (entities) {
    const ids = new Set<string>(); const aliases = new Map<string, string>();
    for (const [section, list] of Object.entries(entities)) {
      if (!REGISTRY_SECTIONS.includes(section as NodeType)) { out.push(`entities.yaml: unknown section "${section}"`); continue; }
      const prefix = `${section.toLowerCase()}:`;
      (Array.isArray(list) ? list : []).forEach((e, i) => {
        if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.label !== 'string') { out.push(`entities.yaml: ${section}: entry ${i + 1} has no id or label`); return; }
        if (ids.has(e.id)) out.push(`entities.yaml: ${section}: duplicate id "${e.id}"`); else ids.add(e.id);
        if (!e.id.startsWith(prefix)) out.push(`entities.yaml: ${section}: "${e.id}" does not start with "${prefix}"`);
        for (const a of [e.label, ...(e.aliases ?? [])]) {
          const k = `${section}|${nameKey(String(a))}`;
          const owner = aliases.get(k);
          if (owner && owner !== e.label) out.push(`entities.yaml: ${section}: "${e.id}": alias "${a}" is already ${owner}'s`);
          else aliases.set(k, e.label);
        }
      });
    }
  } else if ((await readText(paths(root).entities)) !== undefined) out.push('entities.yaml: could not be read (the built-in tools apply)');

  // 3. The rules file, read the way the build reads it: every rule it cannot take, a file it cannot read.
  const rules = await readRules(root);
  out.push(...rules.problems);

  // 4. The graph: what the build holds, and what it refused or skipped on the way.
  const graph = await rebuildGraph(root);
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const typeOfAny = (id: string, extra: Map<string, NodeType>) => typeOf.get(id) ?? extra.get(id);
  for (const n of graph.nodes) {
    if (!isType(n.type)) out.push(`graph: ${n.id}: unknown node type "${n.type}"`);
    else if (!idMatchesType(n.id, n.type)) out.push(`graph: ${n.id}: a ${n.type} whose id does not start with "${n.type === 'Idea' ? 'idea' : n.type.toLowerCase()}:"`);
  }
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  for (const e of graph.edges) {
    if (!isRelation(e.rel)) { out.push(`graph: ${e.id}: unknown relation "${e.rel}"`); continue; }
    const [f, t] = ALLOWED[e.rel];
    if (typeOf.get(e.from) !== f || typeOf.get(e.to) !== t) out.push(`graph: ${e.id}: ${e.rel} goes ${pair(e.rel)}, not ${typeOf.get(e.from) ?? '?'} → ${typeOf.get(e.to) ?? '?'}`);
    if (DERIVED_RELATIONS.includes(e.rel) && !e.derived) out.push(`graph: ${e.id}: ${e.rel} is derived by the rules but this one is stored (${e.source})`);
    for (const i of [...(e.derived?.inputs ?? []), ...(e.derived?.alternatives ?? []).flat()]) if (!edgeIds.has(i)) out.push(`graph: ${e.id}: derived by ${e.derived!.rule} from ${i}, which is not in the graph`);
  }
  const scopedRels = scopedRelations(rules.rules);
  const unscoped: Unscoped[] = []; const lowConfidence: LowConfidence[] = [];
  const threshold = confirmAt(await loadSettings(root).catch(() => ({})));
  const { links, problems } = await readAiLinks(root);
  for (const p of problems) out.push(`ai-links.jsonl line ${p.line}: could not be read`);
  // The file line of each link that parsed, in order: the n-th link read is on the n-th of these lines.
  const fileLines: number[] = [];
  ((await readText(`${paths(root).graph}/ai-links.jsonl`)) ?? '').split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) fileLines.push(i + 1); } catch { /* reported above */ }
  });
  links.forEach((l, i) => {
    const line = fileLines[i] ?? i + 1;
    if (l.status === 'removed') return;
    const at = `ai-links.jsonl line ${line}`;
    if (!isRelation(l.rel)) { out.push(`${at}: unknown relation "${String(l.rel)}" (skipped by the build)`); return; }
    if (DERIVED_RELATIONS.includes(l.rel)) { out.push(`${at}: ${l.rel} is derived by the rules, never stated by the AI (skipped by the build)`); return; }
    if (!AI_RELATIONS.includes(l.rel)) { out.push(`${at}: ${l.rel} is not a link the AI may propose (skipped by the build)`); return; }
    const extra = new Map((l.newNodes ?? []).map((n) => [n.id, n.type]));
    for (const n of l.newNodes ?? []) {
      if (!AI_NODE_TYPES.includes(n.type)) out.push(`${at}: new star ${n.id} is a ${String(n.type)}, which the AI may not make (skipped by the build)`);
      else if (!idMatchesType(n.id, n.type)) out.push(`${at}: new star ${n.id} is a ${n.type} but its id does not start with "${n.type.toLowerCase()}:" (skipped by the build)`);
    }
    const ft = typeOfAny(l.from, extra); const tt = typeOfAny(l.to, extra);
    const unknown = [[l.from, ft], [l.to, tt]].filter(([, t]) => !t).map(([id]) => id);
    if (unknown.length) { out.push(`${at}: ${unknown.join(' and ')} ${unknown.length === 1 ? 'is' : 'are'} not in the graph or among the link's new stars (skipped by the build)`); return; }
    if (ft !== ALLOWED[l.rel][0] || tt !== ALLOWED[l.rel][1]) { out.push(`${at}: ${l.rel} goes ${pair(l.rel)}, not ${ft} → ${tt} (skipped by the build)`); return; }
    if (!l.source?.trim()) out.push(`${at}: the link says nowhere where it came from (source is empty)`);
    if (scopedRels.includes(l.rel) && !l.idea) unscoped.push({ where: at, edge: `${l.from}|${l.rel}|${l.to}`, from: l.from, rel: l.rel, to: l.to, ...scopeCandidates(graph, l.from, l.to) });
    if (l.status === 'confirmed' && l.confidence < threshold) lowConfidence.push({ line, edge: `${l.from}|${l.rel}|${l.to}`, confidence: l.confidence, ...(l.idea ? { idea: l.idea } : {}) });
  });
  const edits = await readEdits(root);
  for (const e of edits) {
    if (e.status !== 'active') continue;
    const at = `operator.jsonl ${e.id}`;
    if (e.t === 'add') {
      if (!isType(e.type)) out.push(`${at}: unknown node type "${String(e.type)}" (refused by the build)`);
      else if (!idMatchesType(e.node, e.type)) out.push(`${at}: ${e.node} is a ${e.type} but its id does not start with "${e.type === 'Idea' ? 'idea' : e.type.toLowerCase()}:" (refused by the build)`);
    }
    if (e.t === 'link') {
      if (!isRelation(e.rel)) { out.push(`${at}: unknown relation "${String(e.rel)}"`); continue; }
      if (DERIVED_RELATIONS.includes(e.rel)) { out.push(`${at}: ${e.rel} is derived by the rules from what the graph holds, never stored by hand (refused by the build)`); continue; }
      const ft = typeOf.get(e.from); const tt = typeOf.get(e.to);
      if (ft && tt && (ft !== ALLOWED[e.rel][0] || tt !== ALLOWED[e.rel][1])) out.push(`${at}: ${e.rel} goes ${pair(e.rel)}, not ${ft} → ${tt} (skipped by the build)`);
      else if (ft && tt && scopedRels.includes(e.rel) && !e.idea) unscoped.push({ where: at, edge: `${e.from}|${e.rel}|${e.to}`, from: e.from, rel: e.rel, to: e.to, ...scopeCandidates(graph, e.from, e.to) });
    }
  }
  return {
    violations: out, stale: staleEdits(graph.nodes, edits), unscoped, lowConfidence,
    checked: { nodes: graph.nodes.length, edges: graph.edges.filter((e) => !e.derived).length, derived: graph.edges.filter((e) => e.derived).length },
  };
}

/** One line per unscoped fact: what it is, what it does now, and the command that settles it. */
export function unscopedLine(u: Unscoped): string {
  const head = `${u.where}: unscoped: ${u.from} ${u.rel} ${u.to} names no idea`;
  const now = u.confirming.length ? `, so it only adds a way for ${u.confirming.join(', ')}, whose own facts already say so` : ', so it gives no idea a dependency';
  const fix = u.confirming.length || u.needers.length === 1
    ? `. Fix: cafe ontology fix --apply (stamps ${(u.confirming.length ? u.confirming : u.needers).join(', ')})`
    : u.needers.length
      ? `. Needed by ${u.needers.join(', ')}: say which with cafe ontology fix --apply --stamp ${u.where.replace(/^operator\.jsonl /, '').replace(/^ai-links\.jsonl line /, 'line-')}=${u.needers[0]}`
      : '. No idea needs the capability yet';
  return head + now + fix;
}

/** What `cafe ontology check` prints, and its exit code: 1 on a violation, or on a stale edit, an unscoped fact or an unconfirmed-looking AI link with --strict. */
export function checkReport(r: CheckResult, strict: boolean): { lines: string[]; code: number } {
  const lines = [...r.violations];
  lines.push(r.violations.length ? `${r.violations.length} violation${r.violations.length === 1 ? '' : 's'} (nothing was changed)` : `No violations: ${r.checked.nodes} stars, ${r.checked.edges} links and ${r.checked.derived} derived links checked against the ontology.`);
  if (r.stale.length) {
    lines.push(`Stale operator edits (${r.stale.length}): they point at stars the graph no longer holds, so the build skips them (nothing was changed):`);
    lines.push(...r.stale.map(staleLine));
  }
  const unscoped = r.unscoped ?? []; const low = r.lowConfidence ?? [];
  if (unscoped.length) {
    lines.push(`Unscoped facts (${unscoped.length}): a capability-level link must say which idea it is for; until it does it gives no idea a new dependency:`);
    lines.push(...unscoped.map(unscopedLine));
  }
  if (low.length) {
    lines.push(`AI links confirmed below the confidence threshold (${low.length}): stored as confirmed without your Do it; cafe ontology fix --apply sets them back to waiting for it:`);
    lines.push(...low.map((l) => `ai-links.jsonl line ${l.line}: ${l.edge.replace(/\|/g, ' ')} at ${l.confidence}${l.idea ? ` (${l.idea})` : ''}`));
  }
  return { lines, code: r.violations.length || (strict && (r.stale.length || unscoped.length || low.length)) ? 1 : 0 };
}
