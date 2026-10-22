import type { Idea } from '../ideas/idea';
import type { Round } from '../round/round';
import { CLOSURE_LABELS } from '../ideas/idea';
import { STAGE_NAMES } from '../rules/stages';
import { AI_NODE_TYPES, AI_RELATIONS, ALLOWED, CONFIRMED_AT, MERGEABLE, edgeId, nodeId, type AiLink, type GEdge, type GNode, type OperatorEdit, type Relation } from './ontology';
export { nodeId } from './ontology';

const ROLE_REL: Record<string, Relation> = { lead: 'RELATED', sponsor: 'SPONSORS', member: 'RELATED' };

export function buildGraph(ideas: Idea[], aiLinks: AiLink[], rounds: Round[] = [], edits: OperatorEdit[] = []): { nodes: GNode[]; edges: GEdge[] } {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const node = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
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
    const teamId = idea.function ? node({ id: nodeId('Team', idea.function), type: 'Team', label: idea.function }) : undefined;
    const entityId = idea.entity ? node({ id: nodeId('Entity', idea.entity), type: 'Entity', label: idea.entity === 'CS' ? 'Corporate Services (CS)' : idea.entity }) : undefined;
    if (entityId && teamId) edge(entityId, 'HAS_TEAM', teamId, 'CS Function', `${src}:CS Function`);

    const roles = new Map<string, { rel: Relation; notes: string[] }>();
    const submitter = idea.people.submitter?.trim();
    if (submitter) roles.set(submitter, { rel: 'SUBMITTED', notes: ['Submitter Name'] });
    for (const p of idea.people.team) {
      const name = p.name.trim(); if (!name) continue;
      const have = roles.get(name);
      const note = p.note ? `also listed as ${p.note}` : 'Team member';
      if (have) { if (have.rel === 'SUBMITTED' || p.role === 'member') have.notes.push(note); else have.rel = ROLE_REL[p.role]; }
      else roles.set(name, { rel: ROLE_REL[p.role] ?? 'RELATED', notes: [p.note ?? 'Team member'] });
    }
    for (const [name, r] of roles) {
      const pid = node({ id: nodeId('Person', name), type: 'Person', label: name });
      // A person's team is the CS Function on their own submission; being on someone else's idea says nothing about it.
      if (teamId && r.rel === 'SUBMITTED') edge(teamId, 'HAS_MEMBER', pid, 'CS Function of their submission', `${src}:CS Function`, 1);
      edge(pid, r.rel, ideaId, r.notes.join('; '), `${src}:Team Members and Lead`);
    }
    // Help the submitter asked of the Café, not something the solution does: its own kind of star.
    for (const s of idea.support) {
      const sid = node({ id: nodeId('Support', s), type: 'Support', label: s });
      edge(ideaId, 'ASKS_FOR', sid, 'Support Requested', `${src}:Support Requested`);
    }
    const tools = idea.tools ?? {};
    for (const [feature, tool] of Object.entries(tools)) {
      const cid = node({ id: nodeId('Capability', feature), type: 'Capability', label: feature });
      const tid = node({ id: nodeId('Tool', tool), type: 'Tool', label: tool });
      edge(ideaId, 'NEEDS', cid, 'Feature', `${src}:approach.md`);
      edge(cid, 'BUILT_WITH', tid, 'Tool pick', `${src}:approach.md`);
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
