import YAML from 'yaml';
import { ALLOWED, DERIVED_RELATIONS, edgeId, type GEdge, type GNode, type Relation } from './ontology';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';

/**
 * The inference rules: what the graph can say that nobody wrote down, derived from what it holds. A chain rule joins
 * two links end to end (Idea NEEDS Capability, Capability USES_DATA System → Idea DEPENDS_ON System); the shared-stars
 * rule links two ideas that share enough stars. They are data (`rules/inference.yaml`), each can be switched off, and
 * what they derive looks derived: `source: rule:<name>`, `derived: { rule, inputs }`, the lowest confidence of its
 * inputs, confirmed only when every input is.
 */
export type Rule =
  | { name: string; kind: 'chain'; chain: [Relation, Relation]; then: Relation; scope?: 'same-idea'; enabled: boolean }
  | { name: string; kind: 'shared-stars'; then: 'SIMILAR_TO'; min: number; enabled: boolean };

export const DEFAULT_RULES: Rule[] = [
  { name: 'needs+uses_data', kind: 'chain', chain: ['NEEDS', 'USES_DATA'], then: 'DEPENDS_ON', scope: 'same-idea', enabled: true },
  { name: 'needs+built_with', kind: 'chain', chain: ['NEEDS', 'BUILT_WITH'], then: 'USES', enabled: true },
  { name: 'member+submitted', kind: 'chain', chain: ['HAS_MEMBER', 'SUBMITTED'], then: 'OWNS', enabled: true },
  { name: 'shared-stars', kind: 'shared-stars', then: 'SIMILAR_TO', min: 2, enabled: true },
];

/** The stars two ideas can share for the shared-stars rule. */
const SHARED_OVER: Relation[] = ['NEEDS', 'REPLACES', 'IN_CATEGORY'];
const isRelation = (v: unknown): v is Relation => typeof v === 'string' && Object.hasOwn(ALLOWED, v);

/** The rules as the file gives them; a rule that does not make sense is dropped; no list at all means the defaults. */
export function parseRules(file: unknown): Rule[] {
  const list = file && typeof file === 'object' && Array.isArray((file as { rules?: unknown }).rules) ? (file as { rules: unknown[] }).rules : undefined;
  if (!list) return DEFAULT_RULES;
  const out: Rule[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) continue;
    const enabled = r.enabled !== false;
    if (r.kind === 'shared-stars') {
      const min = Number(r.min);
      out.push({ name, kind: 'shared-stars', then: 'SIMILAR_TO', min: Number.isFinite(min) && min >= 1 ? Math.floor(min) : 2, enabled });
      continue;
    }
    const chain = Array.isArray(r.chain) ? r.chain : [];
    if (chain.length !== 2 || !isRelation(chain[0]) || !isRelation(chain[1]) || !isRelation(r.then)) continue;
    out.push({ name, kind: 'chain', chain: [chain[0], chain[1]], then: r.then, ...(r.scope === 'same-idea' ? { scope: 'same-idea' as const } : {}), enabled });
  }
  return out;
}

/** rules/inference.yaml, or the defaults when it is absent or unreadable. */
export async function loadRules(root: string): Promise<Rule[]> {
  const text = await readText(paths(root).inference);
  if (text === undefined) return DEFAULT_RULES;
  try { return parseRules(YAML.parse(text)); } catch { return DEFAULT_RULES; }
}

/** The idea an edge belongs to: the one it was extracted for, the form's, or the Idea end of the link; undefined for shared knowledge. */
export function ideaOf(e: GEdge, typeOf: (id: string) => string | undefined): string | undefined {
  if (e.idea) return e.idea;
  const m = /^form:(CAFE-\d{4}-\d{3})/.exec(e.source);
  if (m) return m[1];
  if (typeOf(e.from) === 'Idea') return e.from.slice(5);
  if (typeOf(e.to) === 'Idea') return e.to.slice(5);
  return undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The edges the enabled rules derive from the graph given, in id order. Edges already there (by id) are not derived again. */
export function infer(nodes: GNode[], edges: GEdge[], rules: Rule[]): GEdge[] {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const typeOf = (id: string) => type.get(id);
  const have = new Set(edges.map((e) => e.id));
  const out = new Map<string, GEdge>();
  const byRel = new Map<Relation, GEdge[]>();
  for (const e of edges) { const l = byRel.get(e.rel); if (l) l.push(e); else byRel.set(e.rel, [e]); }
  const fits = (rel: Relation, from: string, to: string) => { const [f, t] = ALLOWED[rel]; return type.get(from) === f && type.get(to) === t; };
  /** Keeps the better of two derivations of the same edge: confirmed first, then the higher confidence. */
  const keep = (e: GEdge) => {
    const was = out.get(e.id);
    if (!was || (e.confirmed && !was.confirmed) || (e.confirmed === was.confirmed && e.confidence > was.confidence)) out.set(e.id, e);
  };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!DERIVED_RELATIONS.includes(rule.then)) continue;
    if (rule.kind === 'chain') {
      const second = new Map<string, GEdge[]>();
      for (const e of byRel.get(rule.chain[1]) ?? []) { const l = second.get(e.from); if (l) l.push(e); else second.set(e.from, [e]); }
      for (const a of byRel.get(rule.chain[0]) ?? []) {
        for (const b of second.get(a.to) ?? []) {
          if (a.from === b.to || !fits(rule.then, a.from, b.to)) continue;
          if (rule.scope === 'same-idea') {
            const ia = ideaOf(a, typeOf); const ib = ideaOf(b, typeOf);
            if (ia && ib && ia !== ib) continue;
          }
          const id = edgeId(a.from, rule.then, b.to);
          if (have.has(id)) continue;
          keep({
            id, from: a.from, to: b.to, rel: rule.then, description: `via ${label(a.to)}`, source: `rule:${rule.name}`,
            confidence: round2(Math.min(a.confidence, b.confidence)), confirmed: a.confirmed && b.confirmed,
            derived: { rule: rule.name, inputs: [a.id, b.id] },
          });
        }
      }
    } else {
      // Every idea's shared stars; two ideas sharing at least `min` of them are similar, more shared is surer.
      const stars = new Map<string, Map<string, GEdge>>();
      for (const rel of SHARED_OVER) for (const e of byRel.get(rel) ?? []) {
        if (type.get(e.from) !== 'Idea') continue;
        let m = stars.get(e.from); if (!m) stars.set(e.from, (m = new Map()));
        if (!m.has(e.to)) m.set(e.to, e);
      }
      const ideas = [...stars.keys()].sort();
      for (let i = 0; i < ideas.length; i++) for (let j = i + 1; j < ideas.length; j++) {
        const a = stars.get(ideas[i])!; const b = stars.get(ideas[j])!;
        const shared = [...a.keys()].filter((s) => b.has(s)).sort((x, y) => label(x).localeCompare(label(y)));
        if (shared.length < rule.min) continue;
        const id = edgeId(ideas[i], rule.then, ideas[j]);
        if (have.has(id)) continue;
        const inputs = shared.flatMap((s) => [a.get(s)!, b.get(s)!]);
        keep({
          id, from: ideas[i], to: ideas[j], rel: rule.then, description: `share ${shared.map(label).join(', ')}`, source: `rule:${rule.name}`,
          confidence: round2(Math.min(1, shared.length / 3)), confirmed: inputs.every((e) => e.confirmed),
          derived: { rule: rule.name, inputs: inputs.map((e) => e.id) },
        });
      }
    }
  }
  return [...out.values()].sort((x, y) => x.id.localeCompare(y.id));
}
