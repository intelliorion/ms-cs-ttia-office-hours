import { ALLOWED, DERIVED_RELATIONS, NODE_TYPES, type NodeType, type Relation } from './ontology';
import { readOntologyFile } from './ontologyFile';
import { applyOntology, resetOntology } from './ontology';
import { readEntities } from './registryFile';
import { REGISTRY_SECTIONS } from './registry';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';
import { readEdits } from './operator';
import { readAiLinks, rebuildGraph } from './store';
import { slug } from './ontology';
import YAML from 'yaml';

/**
 * `cafe ontology check`: the workspace's files and graph against the ontology. It reads, it reports, it never fixes.
 * Each violation is one line saying which file, where, and what is wrong.
 */
export interface CheckResult { violations: string[]; checked: { nodes: number; edges: number; derived: number } }

const isRelation = (v: unknown): v is Relation => typeof v === 'string' && Object.hasOwn(ALLOWED, v);
const isType = (v: unknown): v is NodeType => typeof v === 'string' && NODE_TYPES.includes(v as NodeType);
const pair = (rel: Relation) => `${ALLOWED[rel][0]} → ${ALLOWED[rel][1]}`;

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
          const k = `${section}|${slug(String(a))}`;
          const owner = aliases.get(k);
          if (owner && owner !== e.label) out.push(`entities.yaml: ${section}: "${e.id}": alias "${a}" is already ${owner}'s`);
          else aliases.set(k, e.label);
        }
      });
    }
  } else if ((await readText(paths(root).entities)) !== undefined) out.push('entities.yaml: could not be read (the built-in tools apply)');

  // 3. The rules file: known relations, chains whose types line up, a derived relation as the result.
  const rulesText = await readText(paths(root).inference);
  if (rulesText !== undefined) {
    let file: unknown;
    try { file = YAML.parse(rulesText); } catch { out.push('inference.yaml: could not be read (the built-in rules apply)'); }
    const list = file && typeof file === 'object' && Array.isArray((file as { rules?: unknown }).rules) ? (file as { rules: unknown[] }).rules : [];
    list.forEach((raw, i) => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const name = typeof r.name === 'string' ? r.name : `rule ${i + 1}`;
      if (r.kind === 'shared-stars') return;
      const chain = Array.isArray(r.chain) ? r.chain : [];
      for (const x of [...chain, r.then]) if (x !== undefined && !isRelation(x)) out.push(`inference.yaml: ${name}: unknown relation "${String(x)}"`);
      if (chain.length === 2 && isRelation(chain[0]) && isRelation(chain[1]) && ALLOWED[chain[0]][1] !== ALLOWED[chain[1]][0]) {
        out.push(`inference.yaml: ${name}: ${chain[0]} ends at ${ALLOWED[chain[0]][1]} but ${chain[1]} starts at ${ALLOWED[chain[1]][0]}`);
      }
      if (isRelation(r.then) && !DERIVED_RELATIONS.includes(r.then)) out.push(`inference.yaml: ${name}: ${r.then} is not a derived relation`);
    });
  }

  // 4. The graph: what the build holds, and what it silently skipped on the way.
  const graph = await rebuildGraph(root);
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const typeOfAny = (id: string, extra: Map<string, NodeType>) => typeOf.get(id) ?? extra.get(id);
  for (const n of graph.nodes) if (!isType(n.type)) out.push(`graph: ${n.id}: unknown node type "${n.type}"`);
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  for (const e of graph.edges) {
    if (!isRelation(e.rel)) { out.push(`graph: ${e.id}: unknown relation "${e.rel}"`); continue; }
    const [f, t] = ALLOWED[e.rel];
    if (typeOf.get(e.from) !== f || typeOf.get(e.to) !== t) out.push(`graph: ${e.id}: ${e.rel} goes ${pair(e.rel)}, not ${typeOf.get(e.from) ?? '?'} → ${typeOf.get(e.to) ?? '?'}`);
    for (const i of e.derived?.inputs ?? []) if (!edgeIds.has(i)) out.push(`graph: ${e.id}: derived by ${e.derived!.rule} from ${i}, which is not in the graph`);
  }
  const { links, problems } = await readAiLinks(root);
  for (const p of problems) out.push(`ai-links.jsonl line ${p.line}: could not be read`);
  const lines = ((await readText(`${paths(root).graph}/ai-links.jsonl`)) ?? '').split('\n').filter((l) => l.trim());
  links.forEach((l, i) => {
    const line = lines.findIndex((raw) => { try { const v = JSON.parse(raw); return v.from === l.from && v.rel === l.rel && v.to === l.to; } catch { return false; } }) + 1 || i + 1;
    if (l.status === 'removed') return;
    if (!isRelation(l.rel)) { out.push(`ai-links.jsonl line ${line}: unknown relation "${String(l.rel)}" (skipped by the build)`); return; }
    const extra = new Map((l.newNodes ?? []).map((n) => [n.id, n.type]));
    const ft = typeOfAny(l.from, extra); const tt = typeOfAny(l.to, extra);
    if (ft && tt && (ft !== ALLOWED[l.rel][0] || tt !== ALLOWED[l.rel][1])) out.push(`ai-links.jsonl line ${line}: ${l.rel} goes ${pair(l.rel)}, not ${ft} → ${tt} (skipped by the build)`);
  });
  for (const e of await readEdits(root)) {
    if (e.status !== 'active') continue;
    if (e.t === 'alias' && !typeOf.has(e.node)) out.push(`operator.jsonl ${e.id}: alias "${e.label}" on ${e.node}, which is not in the graph`);
    if (e.t === 'link') {
      if (!isRelation(e.rel)) { out.push(`operator.jsonl ${e.id}: unknown relation "${String(e.rel)}"`); continue; }
      const ft = typeOf.get(e.from); const tt = typeOf.get(e.to);
      if (ft && tt && (ft !== ALLOWED[e.rel][0] || tt !== ALLOWED[e.rel][1])) out.push(`operator.jsonl ${e.id}: ${e.rel} goes ${pair(e.rel)}, not ${ft} → ${tt} (skipped by the build)`);
    }
  }
  return { violations: out, checked: { nodes: graph.nodes.length, edges: graph.edges.filter((e) => !e.derived).length, derived: graph.edges.filter((e) => e.derived).length } };
}
