import YAML from 'yaml';
import { ALLOWED, DERIVED_RELATIONS, edgeId, type GEdge, type GNode, type Relation } from './ontology';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';

/**
 * The inference rules: what the graph can say that nobody wrote down, derived from what it holds. A chain rule joins
 * two or more stored links end to end (Idea NEEDS Capability, Capability USES_DATA System → Idea DEPENDS_ON System);
 * the shared-stars rule links two ideas that share enough stars. They are data (`rules/inference.yaml`), each can be
 * switched off, and what they derive looks derived: `source: rule:<name>`, `derived: { rule, inputs, alternatives }`,
 * the lowest confidence of its inputs, confirmed only when every input is.
 *
 * Scope is what keeps a fact about one idea from spreading to the next one that shares a star:
 * - `same-idea`: every link in the chain is stated for one same idea (a tool picked for 008's feature is 008's, so an
 *   idea that only shares the feature does not use the tool). A link stated for no idea (an operator's capability-level
 *   fact made with no idea on screen) applies only to the ideas that confirm it: those whose own stated facts already
 *   reach its far end (006's own read found the T&E policy, so the operator's "Policy question answering uses the
 *   T&E policy" holds for 006; 007's facts never mention the policy, so it does not). Never a workspace-wide spread.
 * - `same-idea-first`: as same-idea; only an idea with no same-idea derivation falls back to links of any idea (a
 *   team owns the ideas its record names; the submitter's other teams only when the record names none).
 * - `any`: links of any idea join (shared knowledge, said so in the file).
 */
export type Scope = 'same-idea' | 'same-idea-first' | 'any';
export const SCOPES: Scope[] = ['same-idea', 'same-idea-first', 'any'];
export type Rule =
  | { name: string; kind: 'chain'; chain: Relation[]; then: Relation; scope: Scope; enabled: boolean }
  | { name: string; kind: 'shared-stars'; then: 'SIMILAR_TO'; min: number; enabled: boolean };

export const DEFAULT_RULES: Rule[] = [
  { name: 'needs+uses_data', kind: 'chain', chain: ['NEEDS', 'USES_DATA'], then: 'DEPENDS_ON', scope: 'same-idea', enabled: true },
  { name: 'needs+built_with', kind: 'chain', chain: ['NEEDS', 'BUILT_WITH'], then: 'USES', scope: 'same-idea', enabled: true },
  { name: 'member+submitted', kind: 'chain', chain: ['HAS_MEMBER', 'SUBMITTED'], then: 'OWNS', scope: 'same-idea-first', enabled: true },
  { name: 'shared-stars', kind: 'shared-stars', then: 'SIMILAR_TO', min: 2, enabled: true },
];

/** The stars two ideas can share for the shared-stars rule. */
const SHARED_OVER: Relation[] = ['NEEDS', 'REPLACES', 'IN_CATEGORY'];
const isRelation = (v: unknown): v is Relation => typeof v === 'string' && Object.hasOwn(ALLOWED, v);

/** `enabled` as YAML people write it: false, no, off and 0 switch a rule off; true, yes, on and 1 (or nothing) keep it on. */
export function enabledValue(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v !== 'string') return undefined;
  const w = v.trim().toLowerCase();
  if (['true', 'yes', 'on', '1', 'y'].includes(w)) return true;
  if (['false', 'no', 'off', '0', 'n'].includes(w)) return false;
  return undefined;
}

export interface ParsedRules { rules: Rule[]; problems: string[] }

/**
 * The rules as the file gives them, with a line for everything it could not take. A rule that does not make sense is
 * dropped and said so; no file (or an empty one) means the defaults. A rule with no scope takes the scope of the
 * built-in rule of its name, else same-idea: a rule never spreads a fact across ideas unless the file says `any`.
 */
export function readRuleList(file: unknown): ParsedRules {
  if (file === undefined || file === null) return { rules: DEFAULT_RULES, problems: [] };
  const list = typeof file === 'object' && Array.isArray((file as { rules?: unknown }).rules) ? (file as { rules: unknown[] }).rules : undefined;
  if (!list) return { rules: DEFAULT_RULES, problems: ['inference.yaml: there is no "rules:" list (the built-in rules apply until it is fixed)'] };
  const out: Rule[] = []; const problems: string[] = [];
  const names = new Set<string>();
  list.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`inference.yaml: rule ${i + 1} is not a rule (dropped)`); return; }
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const at = name || `rule ${i + 1}`;
    const drop = (why: string) => { problems.push(`inference.yaml: ${at}: ${why} (dropped)`); };
    if (!name) return drop('it has no name');
    if (names.has(name)) return drop('another rule has the same name');
    names.add(name);
    let enabled = enabledValue(r.enabled);
    if (enabled === undefined) { problems.push(`inference.yaml: ${at}: enabled: "${String(r.enabled)}" is not yes or no (the rule is off until it is fixed)`); enabled = false; }
    if (r.kind === 'shared-stars') {
      const min = Number(r.min ?? 2);
      if (!Number.isFinite(min) || min < 1) problems.push(`inference.yaml: ${at}: min must be 1 or more (2 is used)`);
      out.push({ name, kind: 'shared-stars', then: 'SIMILAR_TO', min: Number.isFinite(min) && min >= 1 ? Math.floor(min) : 2, enabled });
      return;
    }
    if (r.kind !== undefined && r.kind !== 'chain') return drop(`kind "${String(r.kind)}" is not chain or shared-stars`);
    const chain = Array.isArray(r.chain) ? r.chain : [];
    if (chain.length < 2) return drop('a chain needs two or more relations');
    const unknown = [...chain, r.then].find((x) => !isRelation(x));
    if (unknown !== undefined || !isRelation(r.then)) return drop(`unknown relation "${String(unknown ?? r.then)}"`);
    const rels = chain as Relation[]; const then = r.then;
    const derivedIn = rels.find((x) => DERIVED_RELATIONS.includes(x));
    if (derivedIn) return drop(`${derivedIn} is derived: rules read stored facts only`);
    if (!DERIVED_RELATIONS.includes(then)) return drop(`${then} is not a derived relation`);
    for (let k = 0; k + 1 < rels.length; k++) {
      if (ALLOWED[rels[k]][1] !== ALLOWED[rels[k + 1]][0]) return drop(`${rels[k]} ends at ${ALLOWED[rels[k]][1]} but ${rels[k + 1]} starts at ${ALLOWED[rels[k + 1]][0]}`);
    }
    if (ALLOWED[rels[0]][0] !== ALLOWED[then][0] || ALLOWED[rels[rels.length - 1]][1] !== ALLOWED[then][1]) {
      return drop(`the chain goes ${ALLOWED[rels[0]][0]} → ${ALLOWED[rels[rels.length - 1]][1]} but ${then} goes ${ALLOWED[then][0]} → ${ALLOWED[then][1]}`);
    }
    const builtin = DEFAULT_RULES.find((d) => d.name === name && d.kind === 'chain') as Extract<Rule, { kind: 'chain' }> | undefined;
    let scope: Scope = builtin?.scope ?? 'same-idea';
    if (r.scope !== undefined) {
      if (SCOPES.includes(r.scope as Scope)) scope = r.scope as Scope;
      else problems.push(`inference.yaml: ${at}: scope "${String(r.scope)}" is not ${SCOPES.join(', ')} (${scope} is used)`);
    }
    out.push({ name, kind: 'chain', chain: [...rels], then, scope, enabled });
  });
  return { rules: out, problems };
}

/** The rules a file holds (problems aside): parseRules(null) is the defaults. */
export const parseRules = (file: unknown): Rule[] => readRuleList(file).rules;

/**
 * rules/inference.yaml with what it could not take. A file YAML cannot read is an error, said by `cafe ontology check`
 * and with the graph's problems in the app; the built-in rules apply until it is fixed, never silently.
 */
export async function readRules(root: string): Promise<ParsedRules> {
  const text = await readText(paths(root).inference);
  if (text === undefined) return { rules: DEFAULT_RULES, problems: [] };
  let file: unknown;
  try { file = YAML.parse(text); } catch (e) {
    const first = String((e as Error).message ?? e).split('\n')[0];
    return { rules: DEFAULT_RULES, problems: [`inference.yaml could not be read (${first}): the built-in rules apply until it is fixed`] };
  }
  return readRuleList(file);
}
export async function loadRules(root: string): Promise<Rule[]> { return (await readRules(root)).rules; }

/**
 * The ideas a stored edge is stated for. An edge with an Idea end is that idea's; otherwise the ideas recorded on it
 * (the form's, the AI read's, the operator edit's), and none for a capability-level fact nobody scoped.
 */
export function ideasOf(e: GEdge, typeOf: (id: string) => string | undefined): string[] {
  const ends = [e.from, e.to].filter((x) => typeOf(x) === 'Idea').map((x) => x.slice('idea:'.length));
  if (ends.length) return [...new Set(ends)];
  if (e.ideas) return e.ideas;
  const m = /^form:(CAFE-\d{4}-\d{3})/.exec(e.source);
  return m ? [m[1]] : [];
}

/**
 * Whether an idea's own stated facts reach a star: some stored edge stated for the idea (other than the one asked
 * about) has it at an end. What "the idea confirms it" means for a fact stated for no idea.
 */
export function confirmer(edges: GEdge[], typeOf: (id: string) => string | undefined): (idea: string, star: string, except?: string) => boolean {
  const reach = new Map<string, Map<string, Set<string>>>();
  for (const e of edges) {
    if (e.derived) continue;
    for (const i of ideasOf(e, typeOf)) {
      let m = reach.get(i); if (!m) reach.set(i, (m = new Map()));
      for (const end of [e.from, e.to]) { let s = m.get(end); if (!s) m.set(end, (s = new Set())); s.add(e.id); }
    }
  }
  return (idea, star, except) => [...(reach.get(idea)?.get(star) ?? [])].some((id) => id !== except);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
/**
 * Which of two derivations of one edge is its main one: a derivation stated for one same idea first (its inputs are the
 * idea's own facts), then one through a fact the idea confirms, then any; then confirmed over not; then surer.
 */
const better = (e: { confirmed: boolean; confidence: number }, ef: number, was: { confirmed: boolean; confidence: number }, wf: number) =>
  ef !== wf ? ef > wf : (e.confirmed && !was.confirmed) || (e.confirmed === was.confirmed && e.confidence > was.confidence);
const FIT_RANK = { scoped: 2, confirm: 1, loose: 0 } as const;

/** scoped: every link stated for one same idea; confirm: that, but for links stated for no idea; loose: neither. */
interface Candidate { edge: GEdge; fit: 'scoped' | 'confirm' | 'loose'; anchor: string }

/** The edges the enabled rules derive from the graph given, in id order. Edges already there (by id) are not derived again. */
export function infer(nodes: GNode[], edges: GEdge[], rules: Rule[]): GEdge[] {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const labels = new Map(nodes.map((n) => [n.id, n.label]));
  const label = (id: string) => labels.get(id) ?? id;
  const typeOf = (id: string) => type.get(id);
  const have = new Set(edges.map((e) => e.id));
  const out = new Map<string, GEdge>();
  const byRel = new Map<Relation, GEdge[]>();
  for (const e of edges) { const l = byRel.get(e.rel); if (l) l.push(e); else byRel.set(e.rel, [e]); }
  const scopeOf = new Map(edges.map((e) => [e.id, ideasOf(e, typeOf)]));
  const confirms = confirmer(edges, typeOf);
  const fits = (rel: Relation, from: string, to: string) => { const [f, t] = ALLOWED[rel]; return type.get(from) === f && type.get(to) === t; };
  // KIND_OF, stored: each star's parents, so a chain that ends at a kind (a mailbox) also ends at what it is a kind of.
  const parents = new Map<string, GEdge[]>();
  for (const e of byRel.get('KIND_OF') ?? []) if (!e.derived) parents.set(e.from, [...(parents.get(e.from) ?? []), e]);
  /** Every star a star is a kind of, transitively, each with the KIND_OF links that lead there (no cycles). */
  const supersOf = (id: string): [string, GEdge[]][] => {
    const out: [string, GEdge[]][] = []; const seen = new Set([id]);
    const queue: [string, GEdge[]][] = [[id, []]];
    while (queue.length) {
      const [x, via] = queue.shift()!;
      for (const e of parents.get(x) ?? []) if (!seen.has(e.to)) { seen.add(e.to); const p: [string, GEdge[]] = [e.to, [...via, e]]; out.push(p); queue.push(p); }
    }
    return out;
  };
  /** How each kept edge's main derivation fits its idea (FIT_RANK). */
  const fitOf = new Map<string, number>();
  /** Every derivation of one edge is kept: the best fitting and surest as its inputs, the others as alternatives. */
  const keep = (e: GEdge, primary = true, fit = 2) => {
    const was = out.get(e.id);
    if (!was) { out.set(e.id, e); fitOf.set(e.id, fit); return; }
    const key = (w: string[]) => w.join('\n');
    // A way that rests on a fact stated for no idea is only ever another way, never the edge's main derivation.
    const takes = primary && better(e, fit, was, fitOf.get(e.id) ?? 2);
    const best = takes ? e : was;
    if (takes) fitOf.set(e.id, fit);
    const ways = [was.derived!.inputs, ...(was.derived!.alternatives ?? []), e.derived!.inputs].filter((w) => key(w) !== key(best.derived!.inputs));
    const others = [...new Map(ways.map((w) => [key(w), w])).values()].sort((a, b) => key(a).localeCompare(key(b)));
    const ideas = [...new Set([...(was.ideas ?? []), ...(e.ideas ?? [])])].sort();
    out.set(e.id, { ...best, ...(ideas.length ? { ideas } : {}), derived: { rule: best.derived!.rule, inputs: best.derived!.inputs, ...(others.length ? { alternatives: others } : {}) } });
  };

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!DERIVED_RELATIONS.includes(rule.then)) continue;
    if (rule.kind === 'chain') {
      const starts = rule.chain.map((rel) => {
        const m = new Map<string, GEdge[]>();
        for (const e of byRel.get(rel) ?? []) { const l = m.get(e.from); if (l) l.push(e); else m.set(e.from, [e]); }
        return m;
      });
      const found: Candidate[] = [];
      // Every path along the chain, one link per relation, never visiting a star twice.
      const walk = (path: GEdge[], seen: Set<string>) => {
        const k = path.length;
        if (k === rule.chain.length) {
          const a = path[0]; const z = path[k - 1];
          // The chain's end, and every star its end is a kind of (KIND_OF, followed up): an idea that depends on a
          // mailbox depends on email too. The KIND_OF links are inputs of the derivation, never part of its idea scope.
          for (const [end, kinds] of [[z.to, []] as [string, GEdge[]], ...supersOf(z.to)]) {
            if (!fits(rule.then, a.from, end)) continue;
            const id = edgeId(a.from, rule.then, end);
            if (have.has(id)) continue;
            // The ideas every stated link shares; a link stated for no idea is left out here and marks the path "confirm".
            const stated = path.map((e) => scopeOf.get(e.id)!).filter((s) => s.length);
            const shared = stated.length ? [...stated.reduce((acc, s) => acc.filter((x) => s.includes(x)))] : [];
            const fit: Candidate['fit'] = !shared.length ? 'loose' : stated.length === path.length ? 'scoped' : 'confirm';
            if (rule.scope === 'same-idea' && fit === 'loose') continue;
            // A link stated for no idea joins only for an idea whose own facts reach its far end.
            if (rule.scope === 'same-idea' && fit === 'confirm') {
              const open = path.filter((e) => !scopeOf.get(e.id)!.length);
              const ok = shared.filter((i) => open.every((e) => confirms(i, e.to, e.id)));
              if (!ok.length) continue;
              shared.splice(0, shared.length, ...ok);
            }
            const anchor = typeOf(a.from) === 'Idea' ? a.from : typeOf(end) === 'Idea' ? end : a.from;
            const all = [...path, ...kinds];
            found.push({
              fit, anchor,
              edge: {
                id, from: a.from, to: end, rel: rule.then,
                description: `via ${path.slice(0, -1).map((e) => label(e.to)).join(' and ')}${kinds.length ? `, ${label(z.to)} being a kind of ${label(end)}` : ''}`, source: `rule:${rule.name}`,
                confidence: round2(Math.min(...all.map((e) => e.confidence))), confirmed: all.every((e) => e.confirmed),
                ...(fit !== 'loose' ? { ideas: [...shared].sort() } : {}),
                derived: { rule: rule.name, inputs: all.map((e) => e.id) },
              },
            });
          }
          return;
        }
        const next = k === 0 ? byRel.get(rule.chain[0]) ?? [] : starts[k].get(path[k - 1].to) ?? [];
        for (const e of next) {
          if (seen.has(e.to) || e.to === e.from) continue;
          const s = new Set(seen); s.add(e.from); s.add(e.to);
          walk([...path, e], s);
        }
      };
      walk([], new Set());
      const scopedIds = new Set(found.filter((c) => c.fit === 'scoped').map((c) => c.edge.id));
      const anchored = new Set(found.filter((c) => c.fit === 'scoped').map((c) => c.anchor));
      for (const c of found) {
        if (rule.scope === 'same-idea' && c.fit === 'confirm' && scopedIds.has(c.edge.id)) continue;
        // same-idea-first: an idea with a derivation stated for it takes only those; the others fall back to any.
        if (rule.scope === 'same-idea-first' && c.fit !== 'scoped' && anchored.has(c.anchor)) continue;
        keep(c.edge, true, FIT_RANK[c.fit]);
      }
      // Then the ways through a fact stated for no idea, for edges the idea's own facts derive too: one more way, never the main one.
      if (rule.scope === 'same-idea') for (const c of found) if (c.fit === 'confirm' && scopedIds.has(c.edge.id)) keep(c.edge, false, FIT_RANK[c.fit]);
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
        // Confirmed when at least `min` of the shared stars are confirmed for both ideas: one unconfirmed extra star
        // does not make a similarity that holds without it look uncertain.
        const sure = shared.filter((s) => a.get(s)!.confirmed && b.get(s)!.confirmed).length;
        keep({
          id, from: ideas[i], to: ideas[j], rel: rule.then, description: `share ${shared.map(label).join(', ')}`, source: `rule:${rule.name}`,
          confidence: round2(Math.min(1, shared.length / 3)), confirmed: sure >= rule.min,
          derived: { rule: rule.name, inputs: inputs.map((e) => e.id) },
        });
      }
    }
  }
  return [...out.values()].sort((x, y) => x.id.localeCompare(y.id));
}
