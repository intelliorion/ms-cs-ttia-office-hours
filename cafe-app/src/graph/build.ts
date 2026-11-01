import type { Idea, PersonRole } from '../ideas/idea';
import type { Round } from '../round/round';
import { CLOSURE_LABELS } from '../ideas/idea';
import { STAGE_NAMES } from '../rules/stages';
import { AI_NODE_TYPES, AI_RELATIONS, BUILTIN_SCHEMA, CONFIRMED_AT, FORM_ONLY_RELATIONS, NOT_APPROVED_NOTE, aiSourceProblem, operatorLinkProblem, canonEdit, canonLink, edgeId, foldedPersonId, idMatchesType, nodeId, operatorSource, typeOfId, type AiLink, type FactSource, type GEdge, type GNode, type NodeType, type OperatorEdit, type Relation, type Schema } from './ontology';
import { defaultEntries, makeRegistry, unapprovedTool, type Registry } from './registry';
import { FIELDS, placeQuote } from './quote';
import { extractTextHash, type AiRead } from '../ai/reads';
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
  /** The ontology this build reads (the workspace's rules/ontology.yaml compiled); the built-in one when absent. */
  schema?: Schema;
  /**
   * The edges the operator's Do it confirmed (graph/confirmations.jsonl). An AI link's confirmedBy: operator counts
   * only when its edge is here; with none given, no confirmedBy is believed.
   */
  confirmations?: ReadonlySet<string>;
  /** What the AI last read of each idea (graph/ai-reads.json): a quote is judged against the text only while it is as the AI read it. */
  reads?: Record<string, AiRead>;
  /** Now, for a readAt in the future (Date.now() when absent). */
  now?: number;
}

/** Kinds whose label the operator may change by an edit: never an idea or a person (their own records) or a round (the Rounds pop-out). */
const RENAMED_BY_OPERATOR = (t: NodeType | undefined, schema: Schema) => !!t && (['Team', 'Entity', 'Tool'] as NodeType[]).concat(schema.operatorStars).includes(t);

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
  const schema = opts.schema ?? BUILTIN_SCHEMA;
  const refused: Refused = [];
  const threshold = opts.confirmAt ?? CONFIRMED_AT;
  const now = opts.now ?? Date.now();
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const node = (n: GNode) => { if (!nodes.has(n.id)) nodes.set(n.id, n); return n.id; };
  /**
   * One stored fact; the same fact stated again (for another idea, by another source) adds its idea, its words and
   * its statement: each statement keeps its own status, so the fact is confirmed for an idea only by that idea's own.
   */
  const edge = (from: string, rel: Relation, to: string, description: string, src: FactSource) => {
    const id = edgeId(from, rel, to);
    const existing = edges.get(id);
    if (existing) {
      if (description && !existing.description.includes(description)) existing.description += `; ${description}`;
      if (src.idea) addIdea(existing, src.idea);
      existing.sources = [...(existing.sources ?? []), src];
      return;
    }
    edges.set(id, { id, from, to, rel, description, source: src.source, confidence: src.confidence, confirmed: src.confirmed, ...(src.idea ? { ideas: [src.idea] } : {}), sources: [src] });
  };
  const ideaById = new Map(ideas.map((i) => [i.id, i]));

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
    for (const e of bundle.edges) edge(e.from, e.rel, e.to, e.description, { source: e.source, idea: idea.id, confidence: 1, confirmed: true, confirmedBy: 'form' });
    if (bundle.round) {
      const star = roundStar(bundle.round);
      star.attrs!.ideas = Number(star.attrs!.ideas) + 1;
      edge(nodeId('Idea', idea.id), 'IN_ROUND', star.id, 'Round', { source: `form:${idea.id}`, idea: idea.id, confidence: 1, confirmed: true, confirmedBy: 'form' });
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
    if (e.status === 'active' && e.t === 'add' && schema.operatorStars.includes(e.type) && idMatchesType(e.node, e.type) && e.label.trim()) node({ id: e.node, type: e.type, label: e.label.trim() });
  }

  /** Links of a relation ontology.yaml re-paired that no longer fit it: said once per relation, never one line each. */
  const misfit = new Map<Relation, { form: number; ai: number; operator: number }>();
  const repaired = (rel: Relation) => !!BUILTIN_SCHEMA.allowed[rel] && (BUILTIN_SCHEMA.allowed[rel][0] !== schema.allowed[rel]?.[0] || BUILTIN_SCHEMA.allowed[rel][1] !== schema.allowed[rel]?.[1]);
  const countMisfit = (rel: Relation, kind: 'form' | 'ai' | 'operator') => { const m = misfit.get(rel) ?? { form: 0, ai: 0, operator: 0 }; m[kind]++; misfit.set(rel, m); };

  aiLinks.forEach((l, i) => {
    if (l.status === 'removed') return;
    const at = `ai-links.jsonl link ${i + 1} (${l.from} ${l.rel} ${l.to})`;
    // A tool comes only from the operator's tool pick, people and form choices only from the form: whatever wrote the line.
    if (!AI_RELATIONS.includes(l.rel)) {
      refused.push(`${at}: ${l.rel === 'BUILT_WITH' ? 'a tool comes only from the tool pick, never from an AI link' : `${String(l.rel)} is not a link the AI may make`} (dropped by the build)`);
      return;
    }
    // Where it came from is part of the fact: a link with no AI source (empty, or posing as the form or an edit) is dropped.
    const bad = aiSourceProblem(l.source);
    if (bad) { refused.push(`${at}: ${bad} (dropped by the build)`); return; }
    // How sure the AI was is a number from 0 to 1, or the link says nothing it can be weighed by.
    if (typeof l.confidence !== 'number' || !Number.isFinite(l.confidence) || l.confidence < 0 || l.confidence > 1) {
      refused.push(`${at}: confidence ${JSON.stringify(l.confidence)} is not a number from 0 to 1 (dropped by the build)`); return;
    }
    // When it was read is a time it could have been read at: a date and time, not in the future.
    if (l.readAt !== undefined && readAtProblem(l.readAt, now)) { refused.push(`${at}: readAt ${JSON.stringify(l.readAt)} ${readAtProblem(l.readAt, now)} (dropped by the build)`); return; }
    // A new star must be a kind the AI may make, with an id that carries its kind ("capability:…" for a Capability).
    const wrongStar = (l.newNodes ?? []).find((n) => !AI_NODE_TYPES.includes(n.type) || !idMatchesType(n.id, n.type));
    if (wrongStar) {
      refused.push(`${at}: new star ${String(wrongStar.id)} ${AI_NODE_TYPES.includes(wrongStar.type) ? `is a ${wrongStar.type} but its id does not say so` : `is ${/^[AEIOU]/.test(String(wrongStar.type)) ? 'an' : 'a'} ${String(wrongStar.type)}, which the AI may not make`} (dropped by the build)`);
      return;
    }
    const pair = schema.allowed[l.rel];
    if (!pair) { refused.push(`${at}: ${String(l.rel)} is not a relation of this workspace's ontology (dropped by the build)`); return; }
    const fromKnown = nodes.has(l.from); const toKnown = nodes.has(l.to);
    const newNodes = new Map((l.newNodes ?? []).map((n) => [n.id, n]));
    const fromNew = newNodes.get(l.from); const toNew = newNodes.get(l.to);
    const gone = [!fromKnown && !fromNew ? l.from : '', !toKnown && !toNew ? l.to : ''].filter(Boolean);
    // An end the graph does not hold (its idea or star is gone, or never was) and the link does not bring: said, not silent.
    if (gone.length) { refused.push(`${at}: ${gone.join(' and ')} ${gone.length === 1 ? 'is' : 'are'} not in the graph or among the link's new stars (dropped by the build)`); return; }
    const ft = fromKnown ? nodes.get(l.from)!.type : fromNew!.type; const tt = toKnown ? nodes.get(l.to)!.type : toNew!.type;
    if (ft !== pair[0] || tt !== pair[1]) {
      if (repaired(l.rel)) countMisfit(l.rel, 'ai');
      else refused.push(`${at}: ${l.rel} goes ${pair[0]} → ${pair[1]}, not ${ft} → ${tt} (dropped by the build)`);
      return;
    }
    // The passage it quotes must be in the idea's text, in the field its source names (the extraction moves the source
    // to the field the passage is in). One the text never held, while the text is as the AI read it, was not read there.
    let quoteFound = l.quoteFound;
    const field = /^ai:[^:]+:(.+)$/.exec(l.source.trim())?.[1];
    let source = l.source;
    const quoted = typeof l.quote === 'string' && l.quote.trim() ? l.quote.trim() : undefined;
    const idea = l.idea ? ideaById.get(l.idea) : undefined;
    if (quoted && field && FIELDS.includes(field) && idea) {
      const placed = placeQuote(quoted, field, idea as unknown as Record<string, unknown>);
      const read = opts.reads?.[idea.id];
      const changed = !!read && read.hash !== extractTextHash(idea);
      if (placed.found && placed.field === field) quoteFound = true;
      else if (placed.found) {
        // In the idea's text, in another field: read where it is; fix writes the source so.
        source = `${l.source.trim().replace(/:[^:]+$/, '')}:${placed.field}`; quoteFound = true;
        refused.push(`${at}: its source names ${field} but the quoted passage is in ${placed.field}: read as ${placed.field} (not used as written by the build; cafe ontology fix --apply writes it so)`);
      } else if (!changed && l.quoteFound !== false) {
        refused.push(`${at}: the quoted passage "${quoted.slice(0, 60)}" is not in ${idea.id}'s ${field.replace(/_/g, ' ')} or any other field of its text (dropped by the build)`);
        return;
      } else quoteFound = false;
    }
    if (fromNew && !fromKnown) node(fromNew);
    if (toNew && !toKnown) node(toNew);
    // Confirmed: stored as confirmed AND either at or above the threshold, or with a Do it the app recorded and signed
    // for this link (this fact for this idea). A pending link is a suggestion, whatever its confidence.
    const id = edgeId(l.from, l.rel, l.to);
    const doIt = l.confirmedBy === 'operator' && !!(opts.confirmations?.has(`${id}#${l.idea ?? ''}`) || opts.confirmations?.has(id));
    if (l.status === 'confirmed' && l.confirmedBy === 'operator' && !doIt && l.confidence < threshold) {
      refused.push(`${at}: says the operator confirmed it, but no Do it is recorded for it (graph/confirmations.jsonl): it counts as waiting for your Do it`);
    }
    const confirmed = l.status === 'confirmed' && (l.confidence >= threshold || doIt);
    edge(l.from, l.rel, l.to, l.description, {
      source, ...(l.idea ? { idea: l.idea } : {}), confidence: l.confidence, confirmed,
      ...(confirmed ? { confirmedBy: doIt ? 'operator' : 'threshold' as const, ...(doIt && l.confirmedAt ? { confirmedAt: l.confirmedAt } : {}) } : {}),
      ...(quoted ? { quote: quoted.slice(0, 300), ...(quoteFound === false ? { quoteFound: false } : {}) } : {}),
      ...(typeof l.readAt === 'string' ? { readAt: l.readAt } : {}),
    });
  });

  applyEdits(nodes, edges, edits, refused, schema, registry);

  // A stored link the ontology's pair does not fit any more (ontology.yaml re-paired a built-in relation): left out and
  // said loudly, with how many of each source, never one quiet line per link.
  for (const [id, e] of [...edges]) {
    const p = schema.allowed[e.rel];
    if (p && nodes.get(e.from)?.type === p[0] && nodes.get(e.to)?.type === p[1]) continue;
    if (!p || !repaired(e.rel)) continue;
    edges.delete(id);
    for (const s of e.sources ?? [{ source: e.source } as FactSource]) countMisfit(e.rel, s.source.startsWith('form:') ? 'form' : s.source.startsWith('ai:') ? 'ai' : 'operator');
  }
  for (const [rel, m] of misfit) {
    const n = m.form + m.ai + m.operator;
    const parts = [m.form && `${m.form} from the forms`, m.ai && `${m.ai} AI`, m.operator && `${m.operator} operator`].filter(Boolean).join(', ');
    refused.push(`ontology.yaml: ${rel} is re-paired as ${schema.allowed[rel][0]} → ${schema.allowed[rel][1]} (built in: ${BUILTIN_SCHEMA.allowed[rel][0]} → ${BUILTIN_SCHEMA.allowed[rel][1]}): ${n} stored link${n === 1 ? '' : 's'} (${parts}) no longer fit it and are left out of the graph; put the pair back to keep them (dropped by the build)`);
  }

  // Each stored fact's source and confidence are its first confirmed statement's (the form's, then a read's in file
  // order, then an edit's), else its first. The fact is confirmed when any statement is; per idea, see confirmedFor.
  for (const e of edges.values()) {
    if (!e.sources?.length) continue;
    const best = e.sources.find((x) => x.confirmed) ?? e.sources[0];
    e.source = best.source; e.confidence = best.confidence; e.confirmed = e.sources.some((s) => s.confirmed);
    delete e.quote; delete e.quoteFound; delete e.readAt;
    if (best.quote) { e.quote = best.quote; if (best.quoteFound === false) e.quoteFound = false; }
    if (best.readAt) e.readAt = best.readAt;
  }

  // The last layer: what the rules derive from everything above. Recomputed every time, never read from disk.
  for (const e of infer([...nodes.values()], [...edges.values()], opts.rules ?? DEFAULT_RULES, schema)) if (!edges.has(e.id)) edges.set(e.id, e);

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

/** Why an AI link's readAt is not a time it could have been read at, or undefined. */
export function readAtProblem(v: unknown, now = Date.now()): string | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v.trim())) return 'is not a date and time';
  const t = Date.parse(v.trim());
  if (!Number.isFinite(t)) return 'is not a date and time';
  if (t > now + 86_400_000) return 'is in the future';
  if (t < Date.UTC(2000, 0, 1)) return 'is before any read could have been made';
  return undefined;
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
/**
 * Where a fact the form states changes (it is never unlinked by an edit: the next build would read it from the record
 * again, and an unlink that hides it would make the graph disagree with the record).
 */
export function formOwnedWhere(rel: Relation): string {
  if (rel === 'BUILT_WITH') return 'the tool pick (the design\'s tool picker)';
  if (rel === 'IN_ROUND') return 'the round the idea is in (the Rounds pop-out)';
  if (rel === 'NEEDS') return 'the design\'s features (approach.md)';
  if (rel === 'HAS_TEAM' || rel === 'HAS_MEMBER') return 'the idea\'s CS Function, on its record';
  if (['SUBMITTED', 'LEADS', 'SPONSORS', 'BUILDS', 'RELATED'].includes(rel)) return 'the idea\'s record (its submitter and team)';
  return 'the form\'s answers on the idea\'s record';
}

/** Two star ids of one mergeable kind (ids are "type:slug"): only such a merge is ever applied, so only such a merge is followed. */
const sameKind = (a: string, b: string, schema: Schema = BUILTIN_SCHEMA) => { const t = a.split(':')[0]; return t === b.split(':')[0] && schema.mergeable.some((m) => m.toLowerCase() === t); };
/** Where a star id ends up once the merges are followed (a merged star's edits go to the star kept, like an alias). */
const follow = (merged: Map<string, string>, id: string) => { const seen = new Set<string>(); let x = id; while (merged.has(x) && !seen.has(x)) { seen.add(x); x = merged.get(x)!; } return x; };
/** The active merges of an edit log (ids in today's form), as a function from a star id to the star it ends up as. */
export function mergedInto(rawEdits: OperatorEdit[], schema: Schema = BUILTIN_SCHEMA): (id: string) => string {
  const merged = new Map<string, string>();
  for (const e of rawEdits.map(canonEdit)) if (e.status === 'active' && e.t === 'merge' && e.from !== e.into && sameKind(e.from, e.into, schema)) merged.set(e.from, e.into);
  return (id) => follow(merged, id);
}
/** The same edit, its star ids followed through the merges. */
function repoint(e: OperatorEdit, merged: Map<string, string>): OperatorEdit {
  if (!merged.size) return e;
  const f = (id: string) => follow(merged, id);
  if (e.t === 'link' || e.t === 'unlink') return { ...e, from: f(e.from), to: f(e.to) };
  if (e.t === 'rename' || e.t === 'remove' || e.t === 'alias' || e.t === 'add') return { ...e, node: f(e.node) };
  return e;
}
/** The edit a stored link came from ("op-21"), when an operator edit made it. */
const editOf = (e: GEdge) => /^operator:([^@]+)@/.exec(e.source)?.[1];
const editNo = (id: string | undefined) => Number(String(id ?? '').replace(/^op-/, '')) || 0;

/**
 * The operator's edits, in order, over what the form and the AI drew. An edit made after a merge at the merged star's
 * id follows the merge to the star kept. An edit whose stars are gone does nothing (staleEdits names it).
 */
function applyEdits(nodes: Map<string, GNode>, edges: Map<string, GEdge>, edits: OperatorEdit[], refused: Refused = [], schema: Schema = BUILTIN_SCHEMA, registry: Registry = DEFAULT_REGISTRY): void {
  const merged = new Map<string, string>();
  /** KIND_OF as it stands so far: a link that would make a star a kind of itself, directly or round a loop, is refused. */
  const kindOfReaches = (from: string, to: string) => {
    const seen = new Set<string>(); const queue = [from];
    while (queue.length) { const x = queue.shift()!; if (x === to) return true; if (seen.has(x)) continue; seen.add(x); for (const e of edges.values()) if (e.rel === 'KIND_OF' && e.from === x) queue.push(e.to); }
    return false;
  };
  const typeOf = (id: string) => nodes.get(id)?.type ?? typeOfId(id, schema);
  const merges: string[] = [];
  for (const raw of edits) {
    if (raw.status !== 'active') continue;
    const e = raw.t === 'merge' ? raw : repoint(raw, merged);
    if (e.t === 'add') {
      // A star of a kind the ontology does not know, or whose id lies about its kind, is refused (check names it); so
      // is one of a kind only the form, the rounds or the tool picker make (an idea, a round, a person): no phantom idea.
      if (!schema.types.includes(e.type) || !idMatchesType(e.node, e.type)) { refused.push(`operator.jsonl ${e.id}: add ${e.node}: ${schema.types.includes(e.type) ? `its id does not start with "${e.type === 'Idea' ? 'idea' : e.type.toLowerCase()}:"` : `unknown node type "${String(e.type)}"`} (refused by the build)`); continue; }
      if (!schema.operatorStars.includes(e.type)) { refused.push(`operator.jsonl ${e.id}: add ${e.node}: ${formOnly(e.type)} (refused by the build)`); continue; }
      if (!nodes.has(e.node) && e.label.trim()) nodes.set(e.node, { id: e.node, type: e.type, label: e.label.trim() });
    } else if (e.t === 'remove') {
      // Only a star the operator could have made goes this way: an idea, a team, a person, a round or a tool is the record's.
      const t = typeOf(e.node);
      if (t && !schema.operatorStars.includes(t)) { refused.push(`operator.jsonl ${e.id}: remove ${e.node}: ${formOnly(t)}, so it is not removed by an edit (refused by the build)`); continue; }
      if (!nodes.delete(e.node)) continue;
      for (const [id, x] of [...edges]) if (x.from === e.node || x.to === e.node) edges.delete(id);
    } else if (e.t === 'rename') {
      const t = typeOf(e.node);
      if (t && !RENAMED_BY_OPERATOR(t, schema)) { refused.push(`operator.jsonl ${e.id}: rename ${e.node}: ${t === 'Round' ? 'a round is renamed in the Rounds pop-out' : `${t === 'Idea' ? 'an idea' : `a ${t.toLowerCase()}`}'s name is its own record's`}, never an edit's (refused by the build)`); continue; }
      // A tool renamed to a tool that is not approved would look approved; to another approved tool, it would be that tool.
      if (t === 'Tool') {
        const retired = unapprovedTool(e.label);
        if (retired) { refused.push(`operator.jsonl ${e.id}: rename ${e.node} to "${e.label}": ${retired} is not on the approved list, and an approved tool's star under its name would make it look approved (refused by the build)`); continue; }
        const other = registry.resolve('Tool', e.label);
        if (other && other.id !== e.node) { refused.push(`operator.jsonl ${e.id}: rename ${e.node} to "${e.label}": that is ${other.label}, another tool; a tool pick changes in the tool picker (refused by the build)`); continue; }
      }
      const n = nodes.get(e.node);
      if (n && e.label.trim()) nodes.set(n.id, { ...n, label: e.label.trim() });
    } else if (e.t === 'unlink') {
      // A derived link is the rules' (it comes back from the facts it rests on); a fact the form states is its record's.
      if (schema.derived.includes(e.rel)) { refused.push(`operator.jsonl ${e.id}: unlink ${e.from} ${e.rel} ${e.to}: ${e.rel} is derived by the rules from the stored facts: remove one of those instead (refused by the build)`); continue; }
      const id = edgeId(e.from, e.rel, e.to);
      const there = edges.get(id);
      const formSaid = there?.sources?.some((s) => s.source.startsWith('form:')) ?? (there ? there.source.startsWith('form:') : false);
      if (formSaid || FORM_ONLY_RELATIONS.includes(e.rel)) { refused.push(`operator.jsonl ${e.id}: unlink ${e.from} ${e.rel} ${e.to}: the form states it, so it changes in ${formOwnedWhere(e.rel)}, never by an unlink (refused by the build)`); continue; }
      edges.delete(id);
    } else if (e.t === 'link') {
      // A derived relation is the rules' to state, and a role, round or tool pick the record's: one stored by hand is
      // refused here and named by check.
      const from = nodes.get(e.from); const to = nodes.get(e.to);
      const bad = operatorLinkProblem(e.rel, from?.type, to?.type, schema);
      if (bad) { refused.push(`operator.jsonl ${e.id}: link ${e.from} ${e.rel} ${e.to}: ${bad} (refused by the build)`); continue; }
      if (!from || !to) continue;
      // A kind of itself, or a loop of kinds (Email a kind of a mailbox that is a kind of Email), says nothing: refused.
      if (e.rel === 'KIND_OF' && (e.from === e.to || kindOfReaches(e.to, e.from))) { refused.push(`operator.jsonl ${e.id}: link ${e.from} KIND_OF ${e.to}: ${e.from === e.to ? 'a system is not a kind of itself' : `${e.to} is already a kind of ${e.from}, so this would make a loop`} (refused by the build)`); continue; }
      const id = edgeId(e.from, e.rel, e.to);
      const there = edges.get(id);
      const src: FactSource = { source: operatorSource(e.id, e.at), ...(e.idea ? { idea: e.idea } : {}), confidence: 1, confirmed: true, confirmedBy: 'edit', confirmedAt: e.at };
      // The same fact stated for another idea: that idea is added to it (a capability another idea also uses the data of).
      if (there) { if (e.idea) addIdea(there, e.idea); there.sources = [...(there.sources ?? []), src]; continue; }
      edges.set(id, { id, from: e.from, to: e.to, rel: e.rel, description: 'Added by the operator', source: src.source, confidence: 1, confirmed: true, ...(e.idea ? { ideas: [e.idea] } : {}), sources: [src] });
    } else if (e.t === 'merge') {
      if (e.from !== e.into && !sameKind(e.from, e.into, schema)) { refused.push(`operator.jsonl ${e.id}: merge ${e.from} into ${e.into}: ${mergeProblem(e.from, e.into)} (refused by the build)`); continue; }
      if (e.from !== e.into && sameKind(e.from, e.into, schema)) merged.set(e.from, e.into);
      const from = nodes.get(e.from); const into = nodes.get(follow(merged, e.into));
      if (!from || !into || from.id === into.id || from.type !== into.type || !schema.mergeable.includes(from.type)) continue;
      merges.push(e.id);
      for (const [id, x] of [...edges]) {
        if (x.from !== from.id && x.to !== from.id) continue;
        edges.delete(id);
        const f = x.from === from.id ? into.id : x.from; const t = x.to === from.id ? into.id : x.to;
        if (f === t) continue;
        const nid = edgeId(f, x.rel, t);
        const kept = edges.get(nid);
        if (!kept) edges.set(nid, { ...x, id: nid, from: f, to: t });
        else { for (const i of x.ideas ?? []) addIdea(kept, i); kept.sources = [...(kept.sources ?? []), ...(x.sources ?? [])]; }
      }
      nodes.delete(from.id);
    }
    // An alias edit is the registry's: it changes no star or link here.
  }
  // A merge can close a loop of kinds that no single link made (D KIND_OF E and P KIND_OF D, then E merged into P):
  // the loop's latest KIND_OF link is refused, said with the merge that closed it, until no loop is left.
  for (let cycle = kindOfCycle(edges); cycle; cycle = kindOfCycle(edges)) {
    const last = [...cycle].sort((a, b) => editNo(editOf(b)) - editNo(editOf(a)))[0];
    edges.delete(last.id);
    const loop = [...cycle.map((x) => x.from), cycle[0].from].join(' → ');
    refused.push(`operator.jsonl ${editOf(last) ?? '?'}: link ${last.from} KIND_OF ${last.to}: after ${merges.length ? `the merge${merges.length === 1 ? '' : 's'} ${merges.join(', ')}` : 'the edits'} it makes a loop of kinds (${loop}), so it is left out (refused by the build)`);
  }
}

/** A loop of KIND_OF links, as the links in order, or undefined. */
function kindOfCycle(edges: Map<string, GEdge>): GEdge[] | undefined {
  const out = new Map<string, GEdge[]>();
  for (const e of edges.values()) if (e.rel === 'KIND_OF' && !e.derived) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const state = new Map<string, 1 | 2>(); const stack: GEdge[] = [];
  const visit = (x: string): GEdge[] | undefined => {
    state.set(x, 1);
    for (const e of out.get(x) ?? []) {
      if (state.get(e.to) === 1) { const i = stack.findIndex((s) => s.from === e.to); return [...stack.slice(i === -1 ? stack.length : i), e]; }
      if (!state.has(e.to)) { stack.push(e); const c = visit(e.to); if (c) return c; stack.pop(); }
    }
    state.set(x, 2);
    return undefined;
  };
  for (const x of [...out.keys()].sort()) if (!state.has(x)) { const c = visit(x); if (c) return c; }
  return undefined;
}

/** An operator edit that points at a star the graph no longer holds: the build skips it; check names it; nothing deletes it. */
export interface StaleEdit { id: string; what: string; missing: string[] }

/**
 * The active edits whose stars are not in the graph, each star followed through the merges first (an edit to a merged
 * star is not stale: it lands on the star kept). Adds and removes are left out: an add makes its star and a remove's
 * star is meant to be gone; a merge's own star is gone by design, so only the star it merges into must be there.
 */
export function staleEdits(graphNodes: { id: string; type?: NodeType; label?: string }[], rawEdits: OperatorEdit[], schema: Schema = BUILTIN_SCHEMA): StaleEdit[] {
  const have = new Set(graphNodes.map((n) => n.id));
  const folded = new Map<string, string | null>();
  for (const n of graphNodes) if (n.type === 'Person' && n.label) { const f = foldedPersonId(n.label); if (f !== n.id) folded.set(f, folded.has(f) ? null : n.id); }
  const person = (id: string) => (id.startsWith('person:') && !have.has(id) && folded.get(id) ? folded.get(id)! : id);
  const edits = rawEdits.map(canonEdit).map((e) => (e.t === 'link' || e.t === 'unlink' ? { ...e, from: person(e.from), to: person(e.to) } : e.t === 'merge' ? { ...e, into: person(e.into) } : e.t === 'add' ? e : 'node' in e ? { ...e, node: person(e.node) } : e)) as OperatorEdit[];
  const merged = new Map<string, string>();
  for (const e of edits) if (e.status === 'active' && e.t === 'merge' && e.from !== e.into && sameKind(e.from, e.into, schema)) merged.set(e.from, e.into);
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
