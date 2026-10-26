import type { Idea, PersonRole } from '../ideas/idea';
import type { Round } from '../round/round';
import { CLOSURE_LABELS } from '../ideas/idea';
import { STAGE_NAMES } from '../rules/stages';
import { AI_NODE_TYPES, AI_RELATIONS, ALLOWED, CONFIRMED_AT, MERGEABLE, NOT_APPROVED_NOTE, edgeId, nodeId, type AiLink, type GEdge, type GNode, type NodeType, type OperatorEdit, type Relation } from './ontology';
import { defaultEntries, makeRegistry, type Registry } from './registry';
export { nodeId } from './ontology';

/** The registry a build uses when given none: the built-in tools, so a graph built without a workspace is today's. */
export const DEFAULT_REGISTRY: Registry = makeRegistry(defaultEntries(), []);
export interface BuildOptions {
  /** Stable identities and aliases (rules/entities.yaml plus alias edits): where a star is born, its label resolves here first. */
  registry?: Registry;
}

/** Longer than this, a choice-column answer is free text, not a choice other ideas could share. */
export const CHOICE_MAX = 60;

/** One link per role a person has on an idea. A plain team member is RELATED. */
const ROLE_REL: Record<PersonRole, Relation> = { lead: 'LEADS', sponsor: 'SPONSORS', builder: 'BUILDS', member: 'RELATED' };

export function buildGraph(ideas: Idea[], aiLinks: AiLink[], rounds: Round[] = [], edits: OperatorEdit[] = [], opts: BuildOptions = {}): { nodes: GNode[]; edges: GEdge[] } {
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const node = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  /** A star born from a label: the registry's id and label when it knows the wording, else its own. */
  const born = (type: NodeType, label: string) => {
    const hit = registry.resolve(type, label);
    return node(hit ? { id: hit.id, type, label: nodes.get(hit.id)?.label ?? hit.label } : { id: nodeId(type, label), type, label });
  };
  const edge = (from: string, rel: Relation, to: string, description: string, source: string, confidence = 1, confirmed = true) => {
    const id = edgeId(from, rel, to);
    const existing = edges.get(id);
    if (existing) { if (description && !existing.description.includes(description)) existing.description += `; ${description}`; return; }
    edges.set(id, { id, from, to, rel, description, source, confidence, confirmed });
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

  for (const idea of [...ideas].sort((a, b) => a.id.localeCompare(b.id))) {
    const ideaId = node({
      id: nodeId('Idea', idea.id), type: 'Idea', label: idea.title,
      attrs: {
        stage: idea.stage, stageLabel: STAGE_NAMES[idea.stage],
        closed: idea.closed ? CLOSURE_LABELS[idea.closed.as] : '',
        function: idea.function ?? '', region: idea.region ?? '', cafeId: idea.id,
      },
    });
    const src = `form:${idea.id}`;
    if (idea.round) {
      const star = roundStar(idea.round);
      star.attrs!.ideas = Number(star.attrs!.ideas) + 1;
      edge(ideaId, 'IN_ROUND', star.id, 'Round', src);
    }
    const teamId = idea.function ? born('Team', idea.function) : undefined;
    const entityId = idea.entity ? (registry.resolve('Entity', idea.entity) ? born('Entity', idea.entity) : node({ id: nodeId('Entity', idea.entity), type: 'Entity', label: idea.entity === 'CS' ? 'Corporate Services (CS)' : idea.entity })) : undefined;
    if (entityId && teamId) edge(entityId, 'HAS_TEAM', teamId, 'CS Function', `${src}:CS Function`);

    // One link for each thing a person does on the idea: the submitter who also leads and builds it has three.
    const submitter = idea.people.submitter?.trim();
    if (submitter) {
      const pid = node({ id: nodeId('Person', submitter), type: 'Person', label: submitter });
      // A person's team is the CS Function on their own submission; being on someone else's idea says nothing about it.
      if (teamId) edge(teamId, 'HAS_MEMBER', pid, 'CS Function of their submission', `${src}:CS Function`, 1);
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
        const id = type === 'Beneficiary' ? born(type, label) : node({ id: nodeId(type, label), type, label });
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
  }

  for (const l of aiLinks) {
    if (l.status === 'removed') continue;
    if (!AI_RELATIONS.includes(l.rel)) continue;
    if ((l.newNodes ?? []).some((n) => !AI_NODE_TYPES.includes(n.type))) continue;
    const pair = ALLOWED[l.rel]; if (!pair) continue;
    const fromKnown = nodes.has(l.from); const toKnown = nodes.has(l.to);
    const newNodes = new Map((l.newNodes ?? []).map((n) => [n.id, n]));
    const fromNew = newNodes.get(l.from); const toNew = newNodes.get(l.to);
    if (!fromKnown && !fromNew) continue;
    if (!toKnown && !toNew) continue;
    if ((fromKnown ? nodes.get(l.from)!.type : fromNew!.type) !== pair[0]) continue;
    if ((toKnown ? nodes.get(l.to)!.type : toNew!.type) !== pair[1]) continue;
    if (fromNew && !fromKnown) node(fromNew);
    if (toNew && !toKnown) node(toNew);
    // A link that brings new nodes is a suggestion until the operator says yes, whatever its confidence.
    const confirmed = l.status === 'confirmed' || (l.confidence >= CONFIRMED_AT && !(l.newNodes?.length));
    edge(l.from, l.rel, l.to, l.description, l.source, l.confidence, confirmed);
  }

  applyEdits(nodes, edges, edits);

  // What the registry knows of each star that is left: its other names and its reference, for the star's details.
  for (const n of nodes.values()) {
    const aliases = registry.aliasesOf(n.id); const ref = registry.refOf(n.id);
    if (aliases.length || ref) nodes.set(n.id, { ...n, attrs: { ...n.attrs, ...(aliases.length ? { aliases: aliases.join('; ') } : {}), ...(ref ? { ref } : {}) } });
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The operator's edits, in order, over what the form and the AI drew. An edit whose stars are gone does nothing. */
function applyEdits(nodes: Map<string, GNode>, edges: Map<string, GEdge>, edits: OperatorEdit[]): void {
  for (const e of edits) {
    if (e.status !== 'active') continue;
    if (e.t === 'add') {
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
      const pair = ALLOWED[e.rel]; const from = nodes.get(e.from); const to = nodes.get(e.to);
      if (!pair || !from || !to || from.type !== pair[0] || to.type !== pair[1]) continue;
      const id = edgeId(e.from, e.rel, e.to);
      if (!edges.has(id)) edges.set(id, { id, from: e.from, to: e.to, rel: e.rel, description: 'Added by the operator', source: 'operator', confidence: 1, confirmed: true });
    } else if (e.t === 'merge') {
      const from = nodes.get(e.from); const into = nodes.get(e.into);
      if (!from || !into || from.id === into.id || from.type !== into.type || !MERGEABLE.includes(from.type)) continue;
      for (const [id, x] of [...edges]) {
        if (x.from !== from.id && x.to !== from.id) continue;
        edges.delete(id);
        const f = x.from === from.id ? into.id : x.from; const t = x.to === from.id ? into.id : x.to;
        if (f === t) continue;
        const nid = edgeId(f, x.rel, t);
        if (!edges.has(nid)) edges.set(nid, { ...x, id: nid, from: f, to: t });
      }
      nodes.delete(from.id);
    }
  }
}
