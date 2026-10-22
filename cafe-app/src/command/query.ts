import { NODE_LABELS, type GEdge, type GNode, type NodeType, type Relation } from '../graph/ontology';
import type { Idea } from '../ideas/idea';
import type { Round } from '../round/round';
import type { JsonSchema } from '../ai/schema';

/**
 * The questions the command bar can answer, as steps over a set of stars. The AI writes the steps; the app runs
 * them on the graph and the idea records, so every answer, count and lit star comes from the knowledge graph itself.
 */
export const QUERY_OPS = ['stars', 'follow', 'filter', 'role', 'intersect', 'path', 'rank', 'count_by'] as const;
export const QUERY_ROLES = ['submitter', 'lead', 'sponsor', 'member'] as const;
export const COUNT_BY = ['stage', 'function', 'region', 'round', 'type'] as const;
const NODE_TYPES: NodeType[] = ['Entity', 'Team', 'Person', 'Idea', 'PainPoint', 'Capability', 'Tool', 'System', 'Round', 'Support', 'Outcome', 'Beneficiary', 'Category'];
const RELATIONS: Relation[] = ['HAS_TEAM', 'HAS_MEMBER', 'SUBMITTED', 'SPONSORS', 'RELATED', 'REPLACES', 'NEEDS', 'BUILT_WITH', 'USES_DATA', 'IN_ROUND', 'ASKS_FOR', 'WANTS', 'BENEFITS', 'IN_CATEGORY'];

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
  '- role: from ideas to their people with role (submitter, lead, sponsor, member; anyone when left out), or from people to the ideas they have that role on.',
  '- intersect: keep only the stars also found by the steps in with (a query of its own), for "both" and "shared" questions.',
  '- path: the shortest chain of links between the two stars in codes.',
  '- rank: order the set by how many links each star has (along rel and dir when given) and keep the top limit.',
  '- count_by: count the set by stage, function, region, round or type (the set stays as it is).',
  'Links: Entity HAS_TEAM Team, Team HAS_MEMBER Person, Person SUBMITTED/SPONSORS/RELATED Idea, Idea REPLACES PainPoint, Idea NEEDS Capability,',
  'Capability BUILT_WITH Tool, Capability USES_DATA System, Idea IN_ROUND Round, Idea ASKS_FOR Support,',
  'Idea WANTS Outcome (desired outcomes), Idea BENEFITS Beneficiary (who benefits), Idea IN_CATEGORY Category (use case category).',
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
];

export interface StepTrace { text: string; size: number }
export interface QueryResult {
  /** The set the last step left, in order (ranked when ranked). */
  final: string[];
  /** Every star the query passed through: lit in the universe, so the chain shows. */
  touched: string[];
  ranked?: { id: string; n: number }[];
  counts?: Record<string, number>;
  path?: string[];
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
    ...idea.people.team.map((p) => ({ name: p.name, role: p.role as string })),
  ].filter((p) => !role || p.role === role);

  const touched = new Set<string>();
  const trace: StepTrace[] = [];
  let ranked: QueryResult['ranked']; let counts: QueryResult['counts']; let path: string[] | undefined;

  const run = (steps: QueryStep[], log: boolean): string[] => {
    let set: string[] = [];
    for (const s of steps) {
      let text = '';
      if (s.op === 'stars') {
        const coded = (s.codes ?? []).map(w.idOf).filter((x): x is string => !!x && nodes.has(x));
        const from = s.last ? (w.last ?? []).filter((id) => nodes.has(id)) : s.codes?.length ? coded : w.graph.nodes.map((n) => n.id);
        set = from.filter((id) => fits(id, s));
        text = s.last ? `Start from the previous answer${s.type || s.match || ideaFilterWords(s) ? `, keeping ${kinds(s.type)}${s.match ? ` named like "${s.match}"` : ''}${ideaFilterWords(s)}` : ''}`
          : s.codes?.length ? `Start from ${coded.map(name).join(', ') || 'nothing I know'}` : `Start from every ${s.type ? SINGULAR[s.type] : 'star'}${s.match ? ` named like "${s.match}"` : ''}${ideaFilterWords(s)}`;
      } else if (s.op === 'follow') {
        const from = new Set(set); const out = new Set<string>();
        for (const e of w.graph.edges) {
          if (s.rel && e.rel !== s.rel) continue;
          if (s.dir !== 'in' && from.has(e.from)) out.add(e.to);
          if (s.dir !== 'out' && from.has(e.to)) out.add(e.from);
        }
        set = [...out].filter((id) => !s.type || nodes.get(id)?.type === s.type);
        text = `Follow ${relWord(s.rel)} links to ${kinds(s.type)}`;
      } else if (s.op === 'filter') {
        set = set.filter((id) => fits(id, s));
        text = `Keep ${kinds(s.type)}${s.match ? ` named like "${s.match}"` : ''}${ideaFilterWords(s)}`;
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
        path = a && b && nodes.has(a) && nodes.has(b) ? shortestPath(w.graph.edges, a, b) : [];
        set = path;
        text = path.length ? `Shortest chain: ${path.map(name).join(' — ')}` : 'No chain of links between them';
      } else if (s.op === 'rank') {
        const n = new Map(set.map((id) => [id, 0]));
        for (const e of w.graph.edges) {
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
      if (log) trace.push({ text, size: set.length });
      // A broad scan to start from ("every capability") is not lit when later steps narrow it: only what the query found is.
      const broadStart = s.op === 'stars' && !s.codes?.length && !s.match && !s.last && steps.indexOf(s) < steps.length - 1;
      // The inner search of an intersect only filters; it is not part of the chain shown.
      if (log && !broadStart) for (const id of set) touched.add(id);
    }
    return set;
  };

  const final = run(q.steps, true);
  // Nothing found: nothing lit, so an empty answer never looks like a result.
  return { final, touched: final.length ? [...touched] : [], trace, ...(ranked ? { ranked } : {}), ...(counts ? { counts } : {}), ...(path ? { path } : {}) };
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
