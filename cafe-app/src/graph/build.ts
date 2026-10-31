import type { Idea, PersonRole } from '../ideas/idea';
import type { Round } from '../round/round';
import { CLOSURE_LABELS } from '../ideas/idea';
import { STAGE_NAMES } from '../rules/stages';
import { AI_NODE_TYPES, AI_RELATIONS, ALLOWED, CONFIRMED_AT, DERIVED_RELATIONS, MERGEABLE, NODE_TYPES, NOT_APPROVED_NOTE, OPERATOR_STARS, aiSourceProblem, operatorLinkProblem, canonEdit, canonLink, edgeId, foldedPersonId, idMatchesType, nodeId, operatorSource, type AiLink, type GEdge, type GNode, type NodeType, type OperatorEdit, type Relation } from './ontology';
import { defaultEntries, makeRegistry, type Registry } from './registry';
import { DEFAULT_RULES, infer, type Rule } from './rules';
export { nodeId } from './ontology';

/** Longer than this, a choice-column answer is free text, not a choice other ideas could share. */
export const CHOICE_MAX = 60;

/** One link per role a person has on an idea. A plain team member is RELATED. */
const ROLE_REL: Record<PersonRole, Relation> = { lead: 'LEADS', sponsor: 'SPONSORS', builder: 'BUILDS', member: 'RELATED' };

/** The registry a build uses when given none: the built-in tools, so a graph built without a workspace is today's. */
export const DEFAULT_REGISTRY: Registry = makeRegistry(defaultEntries(), []);

export interface BuildOptions {
  /** Stable identities and aliases (rules/entities.yaml plus alias edits): where a star is born, its label resolves here first. */
  registry?: Registry;
  /** The inference rules (rules/inference.yaml): the last layer, run after the operator's edits. The defaults when absent. */
  rules?: Rule[];
  /** Per-idea bundles kept between builds, keyed by the idea's content and the registry's version. */
  cache?: BundleCache;
  /**
   * The confidence at or above which an AI link counts as confirmed (settings graph.confirmAt; CONFIRMED_AT when
   * absent). A link stored as confirmed below it counts as confirmed only when the operator's Do it confirmed it.
   */
  confirmAt?: number;
}

/** What the build refused or dropped on the way, one line each (also named by `cafe ontology check`). */
export type Refused = string[];

/** What one idea's record puts in the graph on its own: its star, its people, teams and form choices, its features and tools. */
export interface Bundle { nodes: GNode[]; edges: GEdge[]; round?: string }

function fnv1a32(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** The bundles of ideas that have not changed since the last build, so a rebuild recomputes only what did. */
export class BundleCache {
  private items = new Map<string, { key: string; bundle: Bundle }>();
  hits = 0; misses = 0;
  get(ideaId: string, key: string): Bundle | undefined {
    const hit = this.items.get(ideaId);
    if (hit && hit.key === key) { this.hits++; return hit.bundle; }
    this.misses++;
    return undefined;
  }
  set(ideaId: string, key: string, bundle: Bundle): void { this.items.set(ideaId, { key, bundle }); }
  /** Deep read's touch bus names the idea whose folder changed: its bundle goes, whatever its key. */
  drop(ideaId: string): void { this.items.delete(ideaId); }
}

/**
 * The form layer for one idea, a pure function of its record (and the registry): the stars it brings and the links
 * between them. Bundles are merged in id order, the first star born with an id keeping its label.
 */
export function ideaBundle(idea: Idea, registry: Registry = DEFAULT_REGISTRY): Bundle {
  const nodes: GNode[] = []; const edges: GEdge[] = [];
  const node = (n: GNode) => { if (!nodes.some((x) => x.id === n.id)) nodes.push(n); return n.id; };
  /** A star born from a label: the registry's id and label when it knows the wording, else its own. */
  const born = (type: NodeType, label: string) => {
    const hit = registry.resolve(type, label);
    return node(hit ? { id: hit.id, type, label: hit.label } : { id: nodeId(type, label), type, label });
  };
  const edge = (from: string, rel: Relation, to: string, description: string, source: string) => {
    const id = edgeId(from, rel, to);
    const existing = edges.find((e) => e.id === id);
    if (existing) { if (description && !existing.description.includes(description)) existing.description += `; ${description}`; return; }
    edges.push({ id, from, to, rel, description, source, confidence: 1, confirmed: true });
  };

  const ideaId = node({
    id: nodeId('Idea', idea.id), type: 'Idea', label: idea.title,
    attrs: {
      stage: idea.stage, stageLabel: STAGE_NAMES[idea.stage],
      closed: idea.closed ? CLOSURE_LABELS[idea.closed.as] : '',
      function: idea.function ?? '', region: idea.region ?? '', cafeId: idea.id,
    },
  });
  const src = `form:${idea.id}`;
  const teamId = idea.function ? born('Team', idea.function) : undefined;
  const entityId = idea.entity ? (registry.resolve('Entity', idea.entity) ? born('Entity', idea.entity) : node({ id: nodeId('Entity', idea.entity), type: 'Entity', label: idea.entity === 'CS' ? 'Corporate Services (CS)' : idea.entity })) : undefined;
  if (entityId && teamId) edge(entityId, 'HAS_TEAM', teamId, 'CS Function', `${src}:CS Function`);

  // One link for each thing a person does on the idea: the submitter who also leads and builds it has three.
  const submitter = idea.people.submitter?.trim();
  if (submitter) {
    const pid = node({ id: nodeId('Person', submitter), type: 'Person', label: submitter });
    // A person's team is the CS Function on their own submission; being on someone else's idea says nothing about it.
    if (teamId) edge(teamId, 'HAS_MEMBER', pid, 'CS Function of their submission', `${src}:CS Function`);
    edge(pid, 'SUBMITTED', ideaId, 'Submitter Name', `${src}:Submitter Name`);
  }
  for (const p of idea.people.team) {
    const name = p.name.trim(); if (!name) continue;
    const pid = node({ id: nodeId('Person', name), type: 'Person', label: name });
    // The submitter is on the idea already: "team member" adds nothing to SUBMITTED.
    const roles = submitter && name.toLowerCase() === submitter.toLowerCase() ? p.roles.filter((r) => r !== 'member') : p.roles;
    for (const r of roles) {
      const named = r === 'builder' && !/\b(builder|build|developer)\b/i.test(p.note ?? '');
      edge(pid, ROLE_REL[r], ideaId, named ? 'Named as the builder' : (p.note ?? 'Team member'), named ? `${src}:builder` : `${src}:Team Members and Lead`);
    }
  }
  // Help the submitter asked of the Café, not something the solution does: its own kind of star.
  for (const s of idea.support) {
    const sid = node({ id: nodeId('Support', s), type: 'Support', label: s });
    edge(ideaId, 'ASKS_FOR', sid, 'Support Requested', `${src}:Support Requested`);
  }
  // The form's other choice columns: ideas that picked the same answer share one star. Long free text stays on the idea.
  for (const [values, type, rel, column] of [
    [idea.outcomes, 'Outcome', 'WANTS', 'Desired Outcomes'],
    [idea.beneficiaries, 'Beneficiary', 'BENEFITS', 'Beneficiaries'],
    [idea.use_case_category, 'Category', 'IN_CATEGORY', 'Use Case Category'],
  ] as const) {
    for (const v of values ?? []) {
      const label = v.trim();
      if (!label || label.length > CHOICE_MAX) continue;
      // The registry first, as for every star born from a label: an alias the operator gave a category or an outcome holds.
      const id = born(type, label);
      edge(ideaId, rel, id, column, `${src}:${column}`);
    }
  }
  // The saved features: the idea NEEDS each one; only the ones the tool covers are BUILT_WITH it.
  const tools = idea.tools ?? {};
  for (const feature of idea.features ?? Object.keys(tools)) {
    const cid = born('Capability', feature);
    const tool = tools[feature];
    edge(ideaId, 'NEEDS', cid, tool ? 'Feature' : 'Feature, not covered by the tool', `${src}:approach.md`);
    if (!tool) continue;
    const tid = born('Tool', tool);
    // An older record's tool that has left the approved list (UiPath) stays as it was, marked so.
    edge(cid, 'BUILT_WITH', tid, registry.resolve('Tool', tool) ? 'Tool pick' : `Tool pick${NOT_APPROVED_NOTE}`, `${src}:approach.md`);
  }
  return { nodes, edges, ...(idea.round ? { round: idea.round } : {}) };
}

export function buildGraph(ideas: Idea[], aiLinksIn: AiLink[], rounds: Round[] = [], editsIn: OperatorEdit[] = [], opts: BuildOptions = {}): { nodes: GNode[]; edges: GEdge[]; refused: Refused } {
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const refused: Refused = [];
  const threshold = opts.confirmAt ?? CONFIRMED_AT;
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const node = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  /** One stored fact; the same fact stated again (for another idea, by another source) adds its idea and its words. */
  const edge = (from: string, rel: Relation, to: string, description: string, source: string, confidence = 1, confirmed = true, idea?: string) => {
    const id = edgeId(from, rel, to);
    const existing = edges.get(id);
    if (existing) {
      if (description && !existing.description.includes(description)) existing.description += `; ${description}`;
      if (idea) addIdea(existing, idea);
      return;
    }
    edges.set(id, { id, from, to, rel, description, source, confidence, confirmed, ...(idea ? { ideas: [idea] } : {}) });
  };

  // Every round is a star, with or without ideas. An idea whose round folder is gone still gets its round by id.
  const roundStars = new Map<string, GNode>();
  const roundStar = (id: string, label = id) => {
    let star = roundStars.get(id);
    if (!star) {
      star = { id: nodeId('Round', id), type: 'Round', label, attrs: { roundId: id, ideas: 0 } };
      roundStars.set(id, star);
      node(star);
    }
    return star;
  };
  for (const r of rounds) roundStar(r.id, r.name);

  // The form layer, one bundle per idea, served from the cache when the idea and the registry are as they were.
  for (const idea of [...ideas].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = opts.cache ? `${fnv1a32(JSON.stringify(idea))}:${registry.version}` : '';
    let bundle = opts.cache?.get(idea.id, key);
    if (!bundle) { bundle = ideaBundle(idea, registry); opts.cache?.set(idea.id, key, bundle); }
    for (const n of bundle.nodes) node({ ...n, ...(n.attrs ? { attrs: { ...n.attrs } } : {}) });
    for (const e of bundle.edges) edge(e.from, e.rel, e.to, e.description, e.source, 1, true, idea.id);
    if (bundle.round) {
      const star = roundStar(bundle.round);
      star.attrs!.ideas = Number(star.attrs!.ideas) + 1;
      edge(nodeId('Idea', idea.id), 'IN_ROUND', star.id, 'Round', `form:${idea.id}`, 1, true, idea.id);
    }
  }

  // Star ids written in an older form name the star their label names today (canonId); a person's accent-folded id
  // from before people kept their accents names that person, when exactly one person folds to it.
  const folded = new Map<string, string | null>();
  for (const n of nodes.values()) if (n.type === 'Person') { const f = foldedPersonId(n.label); if (f !== n.id) folded.set(f, folded.has(f) ? null : n.id); }
  const person = (id: string) => (id.startsWith('person:') && !nodes.has(id) && folded.get(id) ? folded.get(id)! : id);
  const aiLinks = aiLinksIn.map(canonLink).map((l) => ({ ...l, from: person(l.from), to: person(l.to) }));
  const edits = editsIn.map(canonEdit).map((e) => (e.t === 'link' || e.t === 'unlink' ? { ...e, from: person(e.from), to: person(e.to) }
    : e.t === 'merge' ? { ...e, from: person(e.from), into: person(e.into) } : e.t === 'add' ? e : 'node' in e ? { ...e, node: person(e.node) } : e)) as OperatorEdit[];

  // The stars the operator added are there for the AI links too: the AI is shown every star, the operator's
  // included, and links to them (a policy the operator added, then found again by a read) must not be dropped.
  // Each add is applied again, in order, with the other edits below; a later remove still removes it.
  for (const e of edits) {
    if (e.status === 'active' && e.t === 'add' && OPERATOR_STARS.includes(e.type) && idMatchesType(e.node, e.type) && e.label.trim()) node({ id: e.node, type: e.type, label: e.label.trim() });
  }

  aiLinks.forEach((l, i) => {
    if (l.status === 'removed') return;
    if (!AI_RELATIONS.includes(l.rel)) return;
    // Where it came from is part of the fact: a link with no AI source (empty, or posing as the form or an edit) is dropped.
    const bad = aiSourceProblem(l.source);
    if (bad) { refused.push(`ai-links.jsonl link ${i + 1} (${l.from} ${l.rel} ${l.to}): ${bad} (dropped by the build)`); return; }
    // A new star must be a kind the AI may make, with an id that carries its kind ("capability:…" for a Capability).
    if ((l.newNodes ?? []).some((n) => !AI_NODE_TYPES.includes(n.type) || !idMatchesType(n.id, n.type))) return;
    const pair = ALLOWED[l.rel]; if (!pair) return;
    const fromKnown = nodes.has(l.from); const toKnown = nodes.has(l.to);
    const newNodes = new Map((l.newNodes ?? []).map((n) => [n.id, n]));
    const fromNew = newNodes.get(l.from); const toNew = newNodes.get(l.to);
    if (!fromKnown && !fromNew) return;
    if (!toKnown && !toNew) return;
    if ((fromKnown ? nodes.get(l.from)!.type : fromNew!.type) !== pair[0]) return;
    if ((toKnown ? nodes.get(l.to)!.type : toNew!.type) !== pair[1]) return;
    if (fromNew && !fromKnown) node(fromNew);
    if (toNew && !toKnown) node(toNew);
    // Nothing the AI is less sure of than the threshold is confirmed without the operator's Do it, whatever the file
    // says; a link that brings new nodes is a suggestion until the operator says yes, whatever its confidence.
    const confirmed = l.status === 'confirmed'
      ? l.confidence >= threshold || l.confirmedBy === 'operator'
      : l.status === 'pending' && l.confidence >= threshold && !(l.newNodes?.length);
    edge(l.from, l.rel, l.to, l.description, l.source, l.confidence, confirmed, l.idea);
  });

  applyEdits(nodes, edges, edits, refused);

  // The last layer: what the rules derive from everything above. Recomputed every time, never read from disk.
  for (const e of infer([...nodes.values()], [...edges.values()], opts.rules ?? DEFAULT_RULES)) if (!edges.has(e.id)) edges.set(e.id, e);

  // What the registry knows of each star that is left: its other names and its reference, for the star's details.
  for (const n of nodes.values()) {
    const aliases = registry.aliasesOf(n.id); const ref = registry.refOf(n.id);
    if (aliases.length || ref) nodes.set(n.id, { ...n, attrs: { ...n.attrs, ...(aliases.length ? { aliases: aliases.join('; ') } : {}), ...(ref ? { ref } : {}) } });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    refused,
  };
}

/** Adds an idea to the ones a fact is stated for, kept sorted. */
function addIdea(e: GEdge, idea: string): void {
  if (e.ideas?.includes(idea)) return;
  e.ideas = [...(e.ideas ?? []), idea].sort();
}

/** Why a star of this kind is not the operator's to add. */
export const formOnly = (t: NodeType) => (t === 'Idea' ? 'an idea comes only from the form (a Café submission)' : t === 'Round' ? 'a round is made in the Rounds pop-out'
  : t === 'Tool' ? 'a tool comes only from the tool picker' : t === 'Person' ? 'a person comes only from an idea\'s team' : `a ${t} comes only from the form`);
/** Why a merge of two stars of different kinds (or of a kind never merged) is refused. */
export function mergeProblem(from: string, into: string): string {
  const a = from.split(':')[0]; const b = into.split(':')[0];
  return a !== b ? `a ${a} and a ${b} are different kinds of star, and only stars of one kind merge` : `${a} stars are never merged`;
}

/** Two star ids of one mergeable kind (ids are "type:slug"): only such a merge is ever applied, so only such a merge is followed. */
const sameKind = (a: string, b: string) => { const t = a.split(':')[0]; return t === b.split(':')[0] && MERGEABLE.some((m) => m.toLowerCase() === t); };
/** Where a star id ends up once the merges are followed (a merged star's edits go to the star kept, like an alias). */
const follow = (merged: Map<string, string>, id: string) => { const seen = new Set<string>(); let x = id; while (merged.has(x) && !seen.has(x)) { seen.add(x); x = merged.get(x)!; } return x; };
/** The same edit, its star ids followed through the merges. */
function repoint(e: OperatorEdit, merged: Map<string, string>): OperatorEdit {
  if (!merged.size) return e;
  const f = (id: string) => follow(merged, id);
  if (e.t === 'link' || e.t === 'unlink') return { ...e, from: f(e.from), to: f(e.to) };
  if (e.t === 'rename' || e.t === 'remove' || e.t === 'alias' || e.t === 'add') return { ...e, node: f(e.node) };
  return e;
}

/**
 * The operator's edits, in order, over what the form and the AI drew. An edit made after a merge at the merged star's
 * id follows the merge to the star kept. An edit whose stars are gone does nothing (staleEdits names it).
 */
function applyEdits(nodes: Map<string, GNode>, edges: Map<string, GEdge>, edits: OperatorEdit[], refused: Refused = []): void {
  const merged = new Map<string, string>();
  for (const raw of edits) {
    if (raw.status !== 'active') continue;
    const e = raw.t === 'merge' ? raw : repoint(raw, merged);
    if (e.t === 'add') {
      // A star of a kind the ontology does not know, or whose id lies about its kind, is refused (check names it); so
      // is one of a kind only the form, the rounds or the tool picker make (an idea, a round, a person): no phantom idea.
      if (!NODE_TYPES.includes(e.type) || !idMatchesType(e.node, e.type)) { refused.push(`operator.jsonl ${e.id}: add ${e.node}: ${NODE_TYPES.includes(e.type) ? `its id does not start with "${e.type === 'Idea' ? 'idea' : e.type.toLowerCase()}:"` : `unknown node type "${String(e.type)}"`} (refused by the build)`); continue; }
      if (!OPERATOR_STARS.includes(e.type)) { refused.push(`operator.jsonl ${e.id}: add ${e.node}: ${formOnly(e.type)} (refused by the build)`); continue; }
      if (!nodes.has(e.node) && e.label.trim()) nodes.set(e.node, { id: e.node, type: e.type, label: e.label.trim() });
    } else if (e.t === 'remove') {
      if (!nodes.delete(e.node)) continue;
      for (const [id, x] of [...edges]) if (x.from === e.node || x.to === e.node) edges.delete(id);
    } else if (e.t === 'rename') {
      const n = nodes.get(e.node);
      if (n && e.label.trim()) nodes.set(n.id, { ...n, label: e.label.trim() });
    } else if (e.t === 'unlink') {
      edges.delete(edgeId(e.from, e.rel, e.to));
    } else if (e.t === 'link') {
      // A derived relation is the rules' to state, and a role, round or tool pick the record's: one stored by hand is
      // refused here and named by check.
      const from = nodes.get(e.from); const to = nodes.get(e.to);
      const bad = operatorLinkProblem(e.rel, from?.type, to?.type);
      if (bad) { refused.push(`operator.jsonl ${e.id}: link ${e.from} ${e.rel} ${e.to}: ${bad} (refused by the build)`); continue; }
      if (!from || !to) continue;
      const id = edgeId(e.from, e.rel, e.to);
      const there = edges.get(id);
      // The same fact stated for another idea: that idea is added to it (a capability another idea also uses the data of).
      if (there) { if (e.idea) addIdea(there, e.idea); continue; }
      edges.set(id, { id, from: e.from, to: e.to, rel: e.rel, description: 'Added by the operator', source: operatorSource(e.id, e.at), confidence: 1, confirmed: true, ...(e.idea ? { ideas: [e.idea] } : {}) });
    } else if (e.t === 'merge') {
      if (e.from !== e.into && !sameKind(e.from, e.into)) { refused.push(`operator.jsonl ${e.id}: merge ${e.from} into ${e.into}: ${mergeProblem(e.from, e.into)} (refused by the build)`); continue; }
      if (e.from !== e.into && sameKind(e.from, e.into)) merged.set(e.from, e.into);
      const from = nodes.get(e.from); const into = nodes.get(follow(merged, e.into));
      if (!from || !into || from.id === into.id || from.type !== into.type || !MERGEABLE.includes(from.type)) continue;
      for (const [id, x] of [...edges]) {
        if (x.from !== from.id && x.to !== from.id) continue;
        edges.delete(id);
        const f = x.from === from.id ? into.id : x.from; const t = x.to === from.id ? into.id : x.to;
        if (f === t) continue;
        const nid = edgeId(f, x.rel, t);
        const kept = edges.get(nid);
        if (!kept) edges.set(nid, { ...x, id: nid, from: f, to: t });
        else for (const i of x.ideas ?? []) addIdea(kept, i);
      }
      nodes.delete(from.id);
    }
    // An alias edit is the registry's: it changes no star or link here.
  }
}

/** An operator edit that points at a star the graph no longer holds: the build skips it; check names it; nothing deletes it. */
export interface StaleEdit { id: string; what: string; missing: string[] }

/**
 * The active edits whose stars are not in the graph, each star followed through the merges first (an edit to a merged
 * star is not stale: it lands on the star kept). Adds and removes are left out: an add makes its star and a remove's
 * star is meant to be gone; a merge's own star is gone by design, so only the star it merges into must be there.
 */
export function staleEdits(graphNodes: { id: string; type?: NodeType; label?: string }[], rawEdits: OperatorEdit[]): StaleEdit[] {
  const have = new Set(graphNodes.map((n) => n.id));
  const folded = new Map<string, string | null>();
  for (const n of graphNodes) if (n.type === 'Person' && n.label) { const f = foldedPersonId(n.label); if (f !== n.id) folded.set(f, folded.has(f) ? null : n.id); }
  const person = (id: string) => (id.startsWith('person:') && !have.has(id) && folded.get(id) ? folded.get(id)! : id);
  const edits = rawEdits.map(canonEdit).map((e) => (e.t === 'link' || e.t === 'unlink' ? { ...e, from: person(e.from), to: person(e.to) } : e.t === 'merge' ? { ...e, into: person(e.into) } : e.t === 'add' ? e : 'node' in e ? { ...e, node: person(e.node) } : e)) as OperatorEdit[];
  const merged = new Map<string, string>();
  for (const e of edits) if (e.status === 'active' && e.t === 'merge' && e.from !== e.into && sameKind(e.from, e.into)) merged.set(e.from, e.into);
  const out: StaleEdit[] = [];
  for (const raw of edits) {
    if (raw.status !== 'active') continue;
    const e = raw.t === 'merge' ? { ...raw, into: follow(merged, raw.into) } : repoint(raw, merged);
    const check = (what: string, ids: string[]) => { const missing = ids.filter((id) => !have.has(id)); if (missing.length) out.push({ id: e.id, what, missing }); };
    if (e.t === 'link' || e.t === 'unlink') check(`${e.t} ${e.from} ${e.rel} ${e.to}`, [e.from, e.to]);
    else if (e.t === 'rename') check(`rename ${e.node} to "${e.label}"`, [e.node]);
    else if (e.t === 'alias') check(`alias "${e.label}" on ${e.node}`, [e.node]);
    else if (e.t === 'merge') check(`merge ${e.from} into ${e.into}`, [e.into]);
  }
  return out;
}
