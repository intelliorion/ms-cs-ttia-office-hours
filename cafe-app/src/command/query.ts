import { DERIVED_RELATIONS, NODE_LABELS, type GEdge, type GNode, type NodeType, type Relation } from '../graph/ontology';
import type { Idea } from '../ideas/idea';
import type { Round } from '../round/round';
import type { JsonSchema } from '../ai/schema';

/**
 * The questions the command bar can answer, as steps over a set of stars. The AI writes the steps; the app runs
 * them on the graph and the idea records, so every answer, count and lit star comes from the knowledge graph itself.
 */
export const QUERY_OPS = ['stars', 'follow', 'filter', 'role', 'intersect', 'path', 'rank', 'count_by', 'search', 'similar'] as const;
export const QUERY_ROLES = ['submitter', 'lead', 'sponsor', 'builder', 'member'] as const;
export const COUNT_BY = ['stage', 'function', 'region', 'round', 'type'] as const;
const NODE_TYPES: NodeType[] = ['Entity', 'Team', 'Person', 'Idea', 'PainPoint', 'Capability', 'Tool', 'System', 'Round', 'Support', 'Outcome', 'Beneficiary', 'Category'];
const RELATIONS: Relation[] = ['HAS_TEAM', 'HAS_MEMBER', 'SUBMITTED', 'LEADS', 'SPONSORS', 'BUILDS', 'RELATED', 'REPLACES', 'NEEDS', 'BUILT_WITH', 'USES_DATA', 'IN_ROUND', 'ASKS_FOR', 'WANTS', 'BENEFITS', 'IN_CATEGORY', ...DERIVED_RELATIONS];
/** How many derived links a step names in the trace before "and N more". */
const DERIVED_TRACE_MAX = 5;

export interface QueryStep {
  op: (typeof QUERY_OPS)[number];
  type?: NodeType; codes?: string[]; match?: string; last?: boolean;
  rel?: Relation; dir?: 'out' | 'in' | 'both';
  stage?: string; function?: string; region?: string; round?: string;
  role?: (typeof QUERY_ROLES)[number];
  by?: (typeof COUNT_BY)[number]; limit?: number;
  with?: QueryStep[];
}
export interface Query { steps: QueryStep[] }

const STEP_PROPS: Record<string, JsonSchema> = {
  op: { type: 'string', enum: QUERY_OPS },
  type: { type: 'string', enum: NODE_TYPES },
  codes: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 2, maxLength: 8 } },
  last: { type: 'boolean' },
  match: { type: 'string', minLength: 1, maxLength: 60 },
  rel: { type: 'string', enum: RELATIONS },
  dir: { type: 'string', enum: ['out', 'in', 'both'] },
  stage: { type: 'string', maxLength: 40 }, function: { type: 'string', maxLength: 40 },
  region: { type: 'string', maxLength: 40 }, round: { type: 'string', maxLength: 40 },
  role: { type: 'string', enum: QUERY_ROLES },
  by: { type: 'string', enum: COUNT_BY },
  limit: { type: 'number', minimum: 1, maximum: 50 },
};
const INNER_STEP: JsonSchema = { type: 'object', additionalProperties: false, required: ['op'], properties: STEP_PROPS };
export const QUERY_SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['steps'],
  properties: {
    steps: {
      type: 'array', minItems: 1, maxItems: 8,
      items: { type: 'object', additionalProperties: false, required: ['op'], properties: { ...STEP_PROPS, with: { type: 'array', maxItems: 6, items: INNER_STEP } } },
    },
  },
};

/** What the AI is told about the query steps. */
export const QUERY_GUIDE = [
  'A query is a list of steps over a set of stars. Each step starts from the set the step before left:',
  '- stars: start a new set: the stars in codes, or every star of type, or those whose label contains match; ideas can also be narrowed by stage, function, region, round.',
  '  With last: true it starts from the stars the previous answer in this conversation found ("those", "of these", "which of them"), narrowed the same way.',
  '- follow: go to the stars linked to the set, along rel (any when left out), dir out (set → star), in (star → set) or both (the default), keeping type when given.',
  '- filter: keep the stars of type, whose label contains match, or (ideas) with that stage, function, region or round.',
  '- role: from ideas to their people with role (submitter, lead, sponsor, builder, member; anyone when left out; one person can have several), or from people to the ideas they have that role on.',
  '- intersect: keep only the stars also found by the steps in with (a query of its own), for "both" and "shared" questions.',
  '- path: the shortest chain of links between the two stars in codes.',
  '- rank: order the set by how many links each star has (along rel and dir when given) and keep the top limit.',
  '- count_by: count the set by stage, function, region, round or type (the set stays as it is).',
  '- search: Deep read. Start a new set from what people wrote: the ideas whose submission, emails, answers, design, review or roadshow are nearest in meaning to match',
  '  (free text, up to 60 characters), best first, top limit (default 8). The result lists the passages (hits) with the idea and section each came from: quote from them.',
  '  Use it for "what did teams say about …", "which ideas mention …", "who has a problem with …". It finds nothing until Deep read has run.',
  '- similar: Deep read. From the one star in codes, the nearest stars of its kind by meaning (an idea: the nearest other ideas; a capability: the nearest capabilities),',
  '  or from match text, the nearest ideas (or stars of type). Top limit (default 5). Use it for "ideas like [I1]", "is there a capability like X already".',
  '- A match on stars or filter that finds no label containing the words falls back, once Deep read has run, to the stars nearest in meaning; the trace says "nearest".',
  'Links: Entity (the division) HAS_TEAM Team, Team HAS_MEMBER Person, Person SUBMITTED/LEADS/SPONSORS/BUILDS/RELATED Idea (one link per role: a lead who builds it has LEADS and BUILDS; RELATED is a team member with no other role), Idea REPLACES PainPoint, Idea NEEDS Capability,',
  'Capability BUILT_WITH Tool, Capability USES_DATA System, Idea IN_ROUND Round, Idea ASKS_FOR Support,',
  'Idea WANTS Outcome (desired outcomes), Idea BENEFITS Beneficiary (who benefits), Idea IN_CATEGORY Category (use case category).',
  'Derived by the rules from the links above (facts nobody typed; dashed in the universe): Idea DEPENDS_ON System (it needs a capability that uses the system\'s data),',
  'Idea USES Tool (a capability it needs is built with the tool), Team OWNS Idea (a member submitted it), Idea SIMILAR_TO Idea (they share two or more capabilities, pain points or categories).',
  'Use them for dependencies, pairs and facts ("which ideas depend on the expense system", "ideas similar to [I1]", "what does GSS own"): follow or rank with that rel.',
  'A follow or rank with no rel walks the stated links only. For what people WROTE use search, not the derived links.',
  'A team star links only to the people who submitted from it: find a function\'s ideas with stars type Idea and function, never through the team star.',
  'Use one query unless the question has separate parts. Examples (codes as in "stars"):',
  '- what is related to [T1]: [{"op":"stars","codes":["T1"]},{"op":"follow"}]',
  '- GSS ideas that share a capability with a BSI idea: [{"op":"stars","type":"Idea","function":"GSS"},{"op":"follow","rel":"NEEDS","type":"Capability"},',
  '  {"op":"intersect","with":[{"op":"stars","type":"Idea","function":"BSI"},{"op":"follow","rel":"NEEDS","type":"Capability"}]},{"op":"follow","rel":"NEEDS","type":"Idea"},{"op":"filter","function":"GSS"}]',
  '- the most needed capability: [{"op":"stars","type":"Capability"},{"op":"rank","rel":"NEEDS","dir":"in","limit":3}]',
  '- ideas that use data from systems named like expense: [{"op":"stars","type":"System","match":"expense"},{"op":"follow","rel":"USES_DATA","type":"Capability"},{"op":"follow","rel":"NEEDS","type":"Idea"}]',
  '- who leads [I1]: [{"op":"stars","codes":["I1"]},{"op":"role","role":"lead"}]',
  '- ideas per stage in round 2026 Q4: [{"op":"stars","type":"Idea","round":"2026 Q4"},{"op":"count_by","by":"stage"}]',
  '- ideas that want the same outcome as [I1]: [{"op":"stars","codes":["I1"]},{"op":"follow","rel":"WANTS","type":"Outcome"},{"op":"follow","rel":"WANTS","type":"Idea"}]',
  '- ideas per use case category: [{"op":"stars","type":"Category"},{"op":"rank","rel":"IN_CATEGORY","dir":"in","limit":10}]',
  '- how [P1] is connected to [I2]: [{"op":"path","codes":["P1","I2"]}]',
  '- ideas that depend on [S1]: [{"op":"stars","codes":["S1"]},{"op":"follow","rel":"DEPENDS_ON","dir":"in","type":"Idea"}]',
  '- ideas similar to [I1]: [{"op":"stars","codes":["I1"]},{"op":"follow","rel":"SIMILAR_TO","type":"Idea"}]',
  '- what did teams say about data access: [{"op":"search","match":"data access"}]',
  '- ideas like [I1]: [{"op":"similar","codes":["I1"],"limit":5}]',
];

/** The guide the agent reads: with Deep read off, the search and similar steps are left out (they do not exist for it). */
export const queryGuide = (deepRead: boolean): string[] => (deepRead ? QUERY_GUIDE : QUERY_GUIDE.filter((l) => !/Deep read|"op":"search"|"op":"similar"/.test(l)));

export interface StepTrace { text: string; size: number }
/** One passage a search found: where it came from and its text (names are coded before the AI sees it). */
export interface QueryHit { ideaId: string; section: string; file: string; text: string; score: number }
/**
 * Deep read's lookups, prepared before the query runs (every match text embedded in one call), so the query itself
 * stays synchronous. Absent when there is no index: every step then behaves as it did before Deep read.
 */
export interface QueryMemory {
  /** The ideas whose passages are nearest the text, best first, each with its best passages. */
  search(text: string, limit: number): { ideaId: string; score: number; hits: QueryHit[] }[];
  /** The nearest stars to a star (of its kind, or of type) or to a text (ideas, or stars of type). */
  similar(from: { node: GNode } | { text: string }, type: NodeType | undefined, limit: number): { id: string; score: number }[];
  /** The stars (of type when given) whose labels are nearest the text. */
  nearestLabels(text: string, type: NodeType | undefined, limit: number): { id: string; score: number }[];
}
export interface QueryResult {
  /** The set the last step left, in order (ranked when ranked). */
  final: string[];
  /** Every star the query passed through: lit in the universe, so the chain shows. */
  touched: string[];
  ranked?: { id: string; n: number }[];
  counts?: Record<string, number>;
  path?: string[];
  /** The passages a search step found, best first. */
  hits?: QueryHit[];
  trace: StepTrace[];
}

export interface QueryWorld {
  graph: { nodes: GNode[]; edges: GEdge[] };
  ideas: Idea[];
  rounds: Round[];
  /** The code the AI used for a star → the star's id. */
  idOf: (code: string) => string | undefined;
  /** The stars the previous answer in the conversation found, for follow-ups. */
  last?: string[];
  /** Deep read's index, when there is one. */
  memory?: QueryMemory;
}

const PLURAL: Record<NodeType, string> = {
  Entity: 'divisions', Team: 'teams', Person: 'people', Idea: 'ideas', PainPoint: 'pain points', Capability: 'capabilities',
  Tool: 'tools', System: 'systems or data', Round: 'rounds', Support: 'support requests',
  Outcome: 'desired outcomes', Beneficiary: 'beneficiaries', Category: 'use case categories',
};
const SINGULAR: Record<NodeType, string> = {
  Entity: 'division', Team: 'team', Person: 'person', Idea: 'idea', PainPoint: 'pain point', Capability: 'capability',
  Tool: 'tool', System: 'system or data', Round: 'round', Support: 'support request',
  Outcome: 'desired outcome', Beneficiary: 'beneficiary', Category: 'use case category',
};
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();
const relWord = (r?: Relation) => (r ? r.toLowerCase().replace(/_/g, ' ') : 'any');
/** The links a step walks: the stated ones, plus the derived ones only when the step asks for a derived rel. */
const walkable = (edges: GEdge[], rel?: Relation) => (rel && DERIVED_RELATIONS.includes(rel) ? edges : edges.filter((e) => !e.derived));

export function runQuery(q: Query, w: QueryWorld): QueryResult {
  const nodes = new Map(w.graph.nodes.map((n) => [n.id, n]));
  const ideaById = new Map(w.ideas.map((i) => [`idea:${i.id}`, i]));
  const roundName = new Map(w.rounds.map((r) => [r.id, r.name]));
  const personByLabel = new Map(w.graph.nodes.filter((n) => n.type === 'Person').map((n) => [n.label, n.id]));
  const name = (id: string) => nodes.get(id)?.label ?? id;
  const kinds = (t?: NodeType) => (t ? PLURAL[t] : 'stars');

  const ideaFits = (id: string, s: QueryStep) => {
    if (!(s.stage || s.function || s.region || s.round)) return true;
    const n = nodes.get(id); const idea = ideaById.get(id);
    if (!n || n.type !== 'Idea' || !idea) return false;
    if (s.stage && !(lc(n.attrs?.stageLabel).includes(lc(s.stage)) || lc(n.attrs?.stage) === lc(s.stage))) return false;
    if (s.function && lc(idea.function) !== lc(s.function)) return false;
    if (s.region && lc(idea.region) !== lc(s.region)) return false;
    if (s.round && !(lc(roundName.get(idea.round)) === lc(s.round) || lc(idea.round) === lc(s.round))) return false;
    return true;
  };
  const fits = (id: string, s: QueryStep) => {
    const n = nodes.get(id); if (!n) return false;
    if (s.type && n.type !== s.type) return false;
    if (s.match && !(lc(n.label).includes(lc(s.match)) || lc(n.attrs?.cafeId) === lc(s.match))) return false;
    return ideaFits(id, s);
  };
  const people = (idea: Idea, role?: string) => [
    ...(idea.people.submitter ? [{ name: idea.people.submitter, role: 'submitter' }] : []),
    ...idea.people.team.flatMap((p) => p.roles.map((r) => ({ name: p.name, role: r as string }))),
  ].filter((p) => !role || p.role === role);

  const touched = new Set<string>();
  const trace: StepTrace[] = [];
  const edgeById = new Map(w.graph.edges.map((e) => [e.id, e]));
  /** One trace line per derived link a step used: what it says and the links it rests on, at most a few. */
  const derivedLines = (used: GEdge[]): StepTrace[] => {
    const lines = used.slice(0, DERIVED_TRACE_MAX).map((e) => ({
      text: `${name(e.from)} ${relWord(e.rel)} ${name(e.to)}: derived by ${e.derived!.rule} from ${e.derived!.inputs.map((id) => { const i = edgeById.get(id); return i ? `${name(i.from)} ${i.rel} ${name(i.to)}` : id; }).join(', ')}`,
      size: 1,
    }));
    if (used.length > DERIVED_TRACE_MAX) lines.push({ text: `and ${used.length - DERIVED_TRACE_MAX} more derived links`, size: used.length - DERIVED_TRACE_MAX });
    return lines;
  };
  let ranked: QueryResult['ranked']; let counts: QueryResult['counts']; let path: string[] | undefined; let hits: QueryHit[] | undefined;
  /** Deep read's fallback for a match no label contains: the nearest labels by meaning, within the candidates. */
  const nearestIn = (s: QueryStep, from: string[]): { ids: string[]; note: string } => {
    if (!s.match || !w.memory) return { ids: [], note: '' };
    const pool = new Set(from);
    const ids = w.memory.nearestLabels(s.match, s.type, 5).map((x) => x.id).filter((id) => pool.has(id) && nodes.get(id)?.type !== 'Person' && ideaFits(id, s));
    return { ids, note: ids.length ? ` (nearest: ${ids.map(name).join(', ')})` : '' };
  };

  const run = (steps: QueryStep[], log: boolean): string[] => {
    let set: string[] = [];
    for (const s of steps) {
      let text = '';
      if (s.op === 'stars') {
        const coded = (s.codes ?? []).map(w.idOf).filter((x): x is string => !!x && nodes.has(x));
        const from = s.last ? (w.last ?? []).filter((id) => nodes.has(id)) : s.codes?.length ? coded : w.graph.nodes.map((n) => n.id);
        set = from.filter((id) => fits(id, s));
        const near = set.length || s.codes?.length ? { ids: [], note: '' } : nearestIn(s, from);
        if (near.ids.length) set = near.ids;
        text = s.last ? `Start from the previous answer${s.type || s.match || ideaFilterWords(s) ? `, keeping ${kinds(s.type)}${s.match ? ` named like "${s.match}"` : ''}${ideaFilterWords(s)}` : ''}`
          : s.codes?.length ? `Start from ${coded.map(name).join(', ') || 'nothing I know'}` : `Start from every ${s.type ? SINGULAR[s.type] : 'star'}${s.match ? ` named like "${s.match}"` : ''}${ideaFilterWords(s)}`;
        text += near.note;
      } else if (s.op === 'follow') {
        const from = new Set(set); const out = new Set<string>(); const used: GEdge[] = [];
        for (const e of walkable(w.graph.edges, s.rel)) {
          if (s.rel && e.rel !== s.rel) continue;
          let hit = false;
          if (s.dir !== 'in' && from.has(e.from)) { out.add(e.to); hit = true; }
          if (s.dir !== 'out' && from.has(e.to)) { out.add(e.from); hit = true; }
          if (hit && e.derived) used.push(e);
        }
        set = [...out].filter((id) => !s.type || nodes.get(id)?.type === s.type);
        text = `Follow ${relWord(s.rel)} links to ${kinds(s.type)}`;
        if (log && used.length) { trace.push({ text, size: set.length }); trace.push(...derivedLines(used.filter((e) => set.includes(e.from) || set.includes(e.to)))); text = ''; }
      } else if (s.op === 'filter') {
        const before = set;
        set = set.filter((id) => fits(id, s));
        const near = set.length ? { ids: [], note: '' } : nearestIn(s, before);
        if (near.ids.length) set = near.ids;
        text = `Keep ${kinds(s.type)}${s.match ? ` named like "${s.match}"` : ''}${ideaFilterWords(s)}${near.note}`;
      } else if (s.op === 'search') {
        const limit = Math.min(s.limit ?? 8, 20);
        const found = s.match && w.memory ? w.memory.search(s.match, limit) : [];
        set = found.map((f) => `idea:${f.ideaId}`).filter((id) => nodes.has(id) && ideaFits(id, s));
        const keep = new Set(set);
        hits = [...(hits ?? []), ...found.filter((f) => keep.has(`idea:${f.ideaId}`)).flatMap((f) => f.hits)];
        text = !w.memory ? 'Deep read has not run: nothing to search' : `Search what people wrote for "${s.match ?? ''}"${ideaFilterWords(s)}`;
      } else if (s.op === 'similar') {
        const limit = Math.min(s.limit ?? 5, 20);
        const code = (s.codes ?? []).map(w.idOf).find((x): x is string => !!x && nodes.has(x));
        const from = code ? { node: nodes.get(code)! } : s.match ? { text: s.match } : undefined;
        const found = from && w.memory ? w.memory.similar(from, s.type, limit) : [];
        set = found.map((f) => f.id).filter((id) => nodes.has(id) && ideaFits(id, s));
        text = !w.memory ? 'Deep read has not run: nothing to compare' : `Nearest ${kinds(s.type ?? (code ? nodes.get(code)!.type : 'Idea'))} to ${code ? name(code) : `"${s.match ?? ''}"`}`;
      } else if (s.op === 'role') {
        const out = new Set<string>();
        for (const id of set) {
          const n = nodes.get(id);
          if (n?.type === 'Idea') { const idea = ideaById.get(id); if (idea) for (const p of people(idea, s.role)) { const pid = personByLabel.get(p.name); if (pid) out.add(pid); } }
          if (n?.type === 'Person') for (const idea of w.ideas) if (people(idea, s.role).some((p) => p.name === n.label)) out.add(`idea:${idea.id}`);
        }
        set = [...out];
        text = `Go to ${s.role ? `the ${s.role}s` : 'everyone on the team'}, from the ideas' records`;
      } else if (s.op === 'intersect') {
        const other = new Set(run(s.with ?? [], false));
        set = set.filter((id) => other.has(id));
        text = 'Keep only what a second search also found';
      } else if (s.op === 'path') {
        const [a, b] = (s.codes ?? []).map(w.idOf);
        path = a && b && nodes.has(a) && nodes.has(b) ? shortestPath(walkable(w.graph.edges), a, b) : [];
        set = path;
        text = path.length ? `Shortest chain: ${path.map(name).join(' — ')}` : 'No chain of links between them';
      } else if (s.op === 'rank') {
        const n = new Map(set.map((id) => [id, 0]));
        for (const e of walkable(w.graph.edges, s.rel)) {
          if (s.rel && e.rel !== s.rel) continue;
          if (s.dir !== 'in' && n.has(e.from)) n.set(e.from, n.get(e.from)! + 1);
          if (s.dir !== 'out' && n.has(e.to)) n.set(e.to, n.get(e.to)! + 1);
        }
        ranked = [...n].map(([id, k]) => ({ id, n: k })).sort((x, y) => y.n - x.n || name(x.id).localeCompare(name(y.id))).slice(0, s.limit ?? 10);
        set = ranked.map((r) => r.id);
        text = `Rank by ${s.rel ? `${relWord(s.rel)} ` : ''}links, top ${s.limit ?? 10}`;
      } else if (s.op === 'count_by') {
        const by = s.by ?? 'type';
        counts = {};
        for (const id of set) {
          const n = nodes.get(id)!; const idea = ideaById.get(id);
          const key = by === 'type' ? NODE_LABELS[n.type]
            : !idea ? '(not an idea)'
              : by === 'stage' ? String(n.attrs?.stageLabel ?? idea.stage)
                : by === 'round' ? (roundName.get(idea.round) ?? 'No round')
                  : String(idea[by] ?? 'Not given');
          counts[key] = (counts[key] ?? 0) + 1;
        }
        text = `Count by ${by}`;
      }
      if (log && text) trace.push({ text, size: set.length });
      // A broad scan to start from ("every capability") is not lit when later steps narrow it: only what the query found is.
      const broadStart = s.op === 'stars' && !s.codes?.length && !s.match && !s.last && steps.indexOf(s) < steps.length - 1;
      // The inner search of an intersect only filters; it is not part of the chain shown.
      if (log && !broadStart) for (const id of set) touched.add(id);
    }
    return set;
  };

  const final = run(q.steps, true);
  // Nothing found: nothing lit, so an empty answer never looks like a result.
  return { final, touched: final.length ? [...touched] : [], trace, ...(ranked ? { ranked } : {}), ...(counts ? { counts } : {}), ...(path ? { path } : {}), ...(hits?.length ? { hits } : {}) };
}

function ideaFilterWords(s: QueryStep): string {
  const parts = [s.stage && `at stage ${s.stage}`, s.function && `in ${s.function}`, s.region && `in ${s.region}`, s.round && `in round ${s.round}`].filter(Boolean);
  return parts.length ? ` ${parts.join(', ')}` : '';
}

/** Breadth-first over links in either direction: the stars on the shortest chain from a to b, or none. */
export function shortestPath(edges: GEdge[], a: string, b: string, maxDepth = 8): string[] {
  const adj = new Map<string, string[]>();
  const add = (x: string, y: string) => { const l = adj.get(x); if (l) l.push(y); else adj.set(x, [y]); };
  for (const e of edges) { add(e.from, e.to); add(e.to, e.from); }
  const prev = new Map<string, string | null>([[a, null]]);
  let frontier = [a];
  for (let d = 0; d < maxDepth && frontier.length && !prev.has(b); d++) {
    const next: string[] = [];
    for (const x of frontier) for (const y of adj.get(x) ?? []) if (!prev.has(y)) { prev.set(y, x); next.push(y); }
    frontier = next;
  }
  if (!prev.has(b)) return [];
  const out: string[] = [];
  for (let x: string | null = b; x; x = prev.get(x) ?? null) out.unshift(x);
  return out;
}
