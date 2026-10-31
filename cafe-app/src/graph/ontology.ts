export type NodeType = 'Entity' | 'Team' | 'Person' | 'Idea' | 'PainPoint' | 'Capability' | 'Tool' | 'System' | 'Round' | 'Support' | 'Outcome' | 'Beneficiary' | 'Category';
export const NODE_TYPES: NodeType[] = ['Entity', 'Team', 'Person', 'Idea', 'PainPoint', 'Capability', 'Tool', 'System', 'Round', 'Support', 'Outcome', 'Beneficiary', 'Category'];
export type Relation = 'HAS_TEAM' | 'HAS_MEMBER' | 'SUBMITTED' | 'LEADS' | 'SPONSORS' | 'BUILDS' | 'RELATED' | 'REPLACES' | 'NEEDS' | 'BUILT_WITH' | 'USES_DATA' | 'IN_ROUND' | 'ASKS_FOR' | 'WANTS' | 'BENEFITS' | 'IN_CATEGORY'
  | 'DEPENDS_ON' | 'USES' | 'OWNS' | 'SIMILAR_TO';

/**
 * The ontology as data: what each kind of star is and what each link means. The built-in one below is what
 * `rules/ontology.yaml` starts as; a workspace's file is applied over it in place (`applyOntology`), so every module
 * that reads NODE_LABELS, NODE_COLOURS, ALLOWED or RELATION_MEANINGS sees the workspace's words. Only the names known
 * here can be changed: a type or relation the code does not know is reported and ignored.
 */
export interface NodeDef { label: string; colour: string; description: string }
export interface RelationDef { from: NodeType; to: NodeType; meaning: string; inverse: string; derived: boolean }
export interface Ontology { nodes: Record<NodeType, NodeDef>; relations: Record<Relation, RelationDef> }

export const BUILTIN_ONTOLOGY: Ontology = {
  nodes: {
    Entity: { label: 'Division', colour: '#6366f1', description: 'A division of the firm; its teams sit under it.' },
    Team: { label: 'Team', colour: '#0ea5e9', description: 'A CS Function: the team an idea came from.' },
    Person: { label: 'Person', colour: '#8b5cf6', description: 'Someone on one or more ideas: who submitted, leads, sponsors, builds or helps.' },
    Idea: { label: 'Idea', colour: '#f97316', description: 'A submission to the Café: one star per Café ID.' },
    PainPoint: { label: 'Pain point', colour: '#14b8a6', description: 'A problem an idea sets out to fix.' },
    Capability: { label: 'Capability', colour: '#f59e0b', description: 'Something a solution needs to do: tools build it, systems feed it.' },
    Tool: { label: 'Tool', colour: '#ef4444', description: 'A tool picked in the tool picker to build a feature.' },
    System: { label: 'System or data', colour: '#10b981', description: 'A system or data source a capability uses.' },
    Round: { label: 'Round', colour: '#e7d8b1', description: 'A round of the Café: ideas submitted and reviewed together.' },
    Support: { label: 'Support requested', colour: '#f472b6', description: 'Help a submitter asked the Café for.' },
    Outcome: { label: 'Desired outcome', colour: '#a3e635', description: 'A desired outcome picked on the form.' },
    Beneficiary: { label: 'Beneficiary', colour: '#facc15', description: 'Who would benefit, as picked on the form.' },
    Category: { label: 'Use case category', colour: '#93c5fd', description: 'A use case category picked on the form.' },
  },
  relations: {
    HAS_TEAM: { from: 'Entity', to: 'Team', meaning: 'the division has this team (its CS Function)', inverse: 'is a team of', derived: false },
    HAS_MEMBER: { from: 'Team', to: 'Person', meaning: 'the person submitted an idea from this team', inverse: 'is in the team', derived: false },
    SUBMITTED: { from: 'Person', to: 'Idea', meaning: 'the person submitted the idea on the form', inverse: 'was submitted by', derived: false },
    LEADS: { from: 'Person', to: 'Idea', meaning: 'the person is named as the lead of the idea', inverse: 'is led by', derived: false },
    SPONSORS: { from: 'Person', to: 'Idea', meaning: 'the person is named as the sponsor of the idea', inverse: 'is sponsored by', derived: false },
    BUILDS: { from: 'Person', to: 'Idea', meaning: 'the person is named as the builder of the idea', inverse: 'is built by', derived: false },
    RELATED: { from: 'Person', to: 'Idea', meaning: 'the person is on the idea\'s team with no other role', inverse: 'has on its team', derived: false },
    REPLACES: { from: 'Idea', to: 'PainPoint', meaning: 'the idea sets out to remove this pain point (a problem people have today)', inverse: 'is replaced by', derived: false },
    NEEDS: { from: 'Idea', to: 'Capability', meaning: 'the idea needs this capability: something the solution must be able to do', inverse: 'is needed by', derived: false },
    BUILT_WITH: { from: 'Capability', to: 'Tool', meaning: 'the capability is built with this tool, as picked in the tool picker', inverse: 'builds', derived: false },
    USES_DATA: { from: 'Capability', to: 'System', meaning: 'the capability reads data from, or works in, this system', inverse: 'feeds', derived: false },
    IN_ROUND: { from: 'Idea', to: 'Round', meaning: 'the idea is in this round of the Café', inverse: 'has the idea', derived: false },
    ASKS_FOR: { from: 'Idea', to: 'Support', meaning: 'the submitter asked the Café for this help', inverse: 'is asked for by', derived: false },
    WANTS: { from: 'Idea', to: 'Outcome', meaning: 'the submitter picked this desired outcome', inverse: 'is wanted by', derived: false },
    BENEFITS: { from: 'Idea', to: 'Beneficiary', meaning: 'the submitter said these people would benefit', inverse: 'benefits from', derived: false },
    IN_CATEGORY: { from: 'Idea', to: 'Category', meaning: 'the submitter put the idea in this use case category', inverse: 'holds the idea', derived: false },
    DEPENDS_ON: { from: 'Idea', to: 'System', meaning: 'the idea depends on this system: a capability it needs uses the system\'s data (derived)', inverse: 'is depended on by', derived: true },
    USES: { from: 'Idea', to: 'Tool', meaning: 'the idea uses this tool: a capability it needs is built with it (derived)', inverse: 'is used by', derived: true },
    OWNS: { from: 'Team', to: 'Idea', meaning: 'the team owns the idea: one of its members submitted it (derived)', inverse: 'is owned by', derived: true },
    SIMILAR_TO: { from: 'Idea', to: 'Idea', meaning: 'the two ideas share two or more capabilities, pain points or categories (derived)', inverse: 'is similar to', derived: true },
  },
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const pick = <K extends string, V, R>(o: Record<K, V>, f: (v: V) => R) => Object.fromEntries((Object.keys(o) as K[]).map((k) => [k, f(o[k])])) as Record<K, R>;

/** The constants every module reads, derived from the built-in ontology and changed in place by `applyOntology`. */
export const NODE_LABELS: Record<NodeType, string> = pick(BUILTIN_ONTOLOGY.nodes, (n) => n.label);
export const NODE_COLOURS: Record<NodeType, string> = pick(BUILTIN_ONTOLOGY.nodes, (n) => n.colour);
export const NODE_DESCRIPTIONS: Record<NodeType, string> = pick(BUILTIN_ONTOLOGY.nodes, (n) => n.description);
export const ALLOWED: Record<Relation, [NodeType, NodeType]> = pick(BUILTIN_ONTOLOGY.relations, (r) => [r.from, r.to] as [NodeType, NodeType]);
export const RELATION_MEANINGS: Record<Relation, { meaning: string; inverse: string }> = pick(BUILTIN_ONTOLOGY.relations, (r) => ({ meaning: r.meaning, inverse: r.inverse }));
/** The relations the rules derive: facts that look derived (dashed), are never confirmed by hand and are left out of counts. */
export const DERIVED_RELATIONS: Relation[] = (Object.keys(BUILTIN_ONTOLOGY.relations) as Relation[]).filter((r) => BUILTIN_ONTOLOGY.relations[r].derived);

const isType = (v: unknown): v is NodeType => typeof v === 'string' && NODE_TYPES.includes(v as NodeType);
const isRelation = (v: unknown): v is Relation => typeof v === 'string' && Object.hasOwn(BUILTIN_ONTOLOGY.relations, v);

/**
 * Applies an ontology file over the constants, in place. Returns the problems: an unknown type or relation (ignored),
 * a pair naming an unknown type (the built-in pair is kept). Whether a relation is derived is the code's, not the file's.
 */
export function applyOntology(o: Partial<{ nodes: Record<string, Partial<NodeDef>>; relations: Record<string, Partial<RelationDef>> }>): string[] {
  const problems: string[] = [];
  for (const [t, d] of Object.entries(o.nodes ?? {})) {
    if (!isType(t)) { problems.push(`ontology.yaml: unknown node type "${t}" (ignored)`); continue; }
    if (!d || typeof d !== 'object') continue;
    if (typeof d.label === 'string' && d.label.trim()) NODE_LABELS[t] = d.label.trim();
    if (typeof d.colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(d.colour)) NODE_COLOURS[t] = d.colour;
    if (typeof d.description === 'string') NODE_DESCRIPTIONS[t] = d.description;
  }
  for (const [r, d] of Object.entries(o.relations ?? {})) {
    if (!isRelation(r)) { problems.push(`ontology.yaml: unknown relation "${r}" (ignored)`); continue; }
    if (!d || typeof d !== 'object') continue;
    if (d.from !== undefined || d.to !== undefined) {
      const from = d.from ?? ALLOWED[r][0]; const to = d.to ?? ALLOWED[r][1];
      const bad = [from, to].find((x) => !isType(x));
      if (bad !== undefined) problems.push(`ontology.yaml: ${r}: unknown node type "${String(bad)}" (the pair is kept as built in)`);
      else ALLOWED[r] = [from as NodeType, to as NodeType];
    }
    if (typeof d.meaning === 'string' && d.meaning.trim()) RELATION_MEANINGS[r].meaning = d.meaning.trim();
    if (typeof d.inverse === 'string' && d.inverse.trim()) RELATION_MEANINGS[r].inverse = d.inverse.trim();
  }
  return problems;
}

/** The ontology as the constants now stand (the file applied, or the built-in one). */
export function currentOntology(): Ontology {
  return {
    nodes: Object.fromEntries(NODE_TYPES.map((t) => [t, { label: NODE_LABELS[t], colour: NODE_COLOURS[t], description: NODE_DESCRIPTIONS[t] }])) as Record<NodeType, NodeDef>,
    relations: Object.fromEntries((Object.keys(ALLOWED) as Relation[]).map((r) => [r, { from: ALLOWED[r][0], to: ALLOWED[r][1], meaning: RELATION_MEANINGS[r].meaning, inverse: RELATION_MEANINGS[r].inverse, derived: DERIVED_RELATIONS.includes(r) }])) as Record<Relation, RelationDef>,
  };
}
/** Back to the built-in ontology (tests, and a workspace with no file). */
export function resetOntology(): void { applyOntology(clone(BUILTIN_ONTOLOGY)); }

/**
 * Capability-level facts that must say which idea they are for: the rules read them per idea, so the assistant
 * stamps the idea on every one it proposes (the one on screen, or each idea that needs the capability).
 */
export const IDEA_SCOPED: Relation[] = ['USES_DATA', 'BUILT_WITH'];

/**
 * Relations only the form, the rounds or the tool picker state: who submitted, leads, sponsors, builds or is on an
 * idea lives in the idea's record (the assistant changes the record, never a link), the round in the round's file, a
 * tool in the tool pick. An operator link of one of these is refused by the build and named by check.
 */
export const FORM_ONLY_RELATIONS: Relation[] = ['SUBMITTED', 'LEADS', 'SPONSORS', 'BUILDS', 'RELATED', 'IN_ROUND', 'BUILT_WITH'];
/** The links NetworkX's link prediction proposes, and so the only ones its Propose route may carry. */
export const NETWORK_RELATIONS: Relation[] = ['NEEDS', 'USES_DATA'];
/** Why an operator link of this relation between these kinds is not one the ontology lets anyone store by hand, or undefined. */
export function operatorLinkProblem(rel: Relation, fromType: string | undefined, toType: string | undefined): string | undefined {
  const pair = ALLOWED[rel];
  if (!pair) return `unknown relation "${String(rel)}"`;
  if (DERIVED_RELATIONS.includes(rel)) return `${rel} is derived by the rules from what the graph holds, never stored by hand`;
  if (FORM_ONLY_RELATIONS.includes(rel)) {
    return rel === 'BUILT_WITH' ? 'BUILT_WITH comes only from the tool picker'
      : rel === 'IN_ROUND' ? 'IN_ROUND comes only from the round the idea is put in'
        : `${rel} comes only from the idea's record (its submitter and team), never from a link`;
  }
  if (fromType !== undefined && toType !== undefined && (fromType !== pair[0] || toType !== pair[1])) return `${rel} goes ${pair[0]} → ${pair[1]}, not ${fromType} → ${toType}`;
  return undefined;
}

/** Relations the AI may propose. People links come only from the form. */
export const AI_RELATIONS: Relation[] = ['REPLACES', 'NEEDS', 'BUILT_WITH', 'USES_DATA'];
export const AI_NODE_TYPES: NodeType[] = ['PainPoint', 'Capability', 'Tool', 'System'];
export const CONFIRMED_AT = 0.7;

export interface GNode { id: string; type: NodeType; label: string; attrs?: Record<string, string | number | boolean> }
export interface GEdge {
  id: string; from: string; to: string; rel: Relation; description: string;
  source: string; confidence: number; confirmed: boolean;
  /**
   * The ideas the fact is stated for, sorted: the idea whose form, AI read or operator edit put it there, every one of
   * them when several did (a capability two ideas both use the data of). The rules scope by it: a capability-level fact
   * with no idea (an operator link made with no idea on screen) is stated for none, so it joins no idea's chain. On a
   * derived edge: the ideas every input shares.
   */
  ideas?: string[];
  /**
   * Set on an edge a rule derived: the rule's name and the ids of the edges it rests on (the surest derivation), with
   * every other way the same edge is derived in `alternatives`: the edge goes only when all of them are gone.
   */
  derived?: { rule: string; inputs: string[]; alternatives?: string[][] };
}
/**
 * A change the operator asked for in the command bar, kept in graph/operator.jsonl and laid over the graph built
 * from the ideas and AI links, in file order. "undone" edits are kept for the record and do nothing.
 */
export type OperatorEdit = { id: string; at: string; status: 'active' | 'undone' } & (
  /** stamped: the date `cafe ontology fix` gave a link made with no idea the idea it is for. */
  | { t: 'link'; from: string; rel: Relation; to: string; idea?: string; stamped?: string }
  | { t: 'unlink'; from: string; rel: Relation; to: string }
  | { t: 'rename'; node: string; label: string }
  | { t: 'merge'; from: string; into: string }
  | { t: 'add'; node: string; type: NodeType; label: string }
  | { t: 'remove'; node: string }
  /** Another name for a star: `label` is the alias, `of` the star's label when it was recorded (a merged twin's). */
  | { t: 'alias'; node: string; label: string; of?: string }
);
/** Stars the operator can create or remove from the command bar. The rest come from the form, the rounds or the tool picker. */
export const OPERATOR_STARS: NodeType[] = ['PainPoint', 'Capability', 'System', 'Support', 'Outcome', 'Beneficiary', 'Category'];
/** Star types that can be merged: never ideas, rounds or the division. */
export const MERGEABLE: NodeType[] = ['Team', 'Person', 'PainPoint', 'Capability', 'System', 'Support', 'Outcome', 'Beneficiary', 'Category', 'Tool'];

export interface AiLink {
  from: string; to: string; rel: Relation; description: string; source: string; confidence: number;
  status: 'pending' | 'confirmed' | 'removed'; newNodes?: GNode[];
  /** The idea the link was extracted for (the rules scope by it). */
  idea?: string;
  /** Set when the operator's Do it confirmed the link (a link below the threshold counts as confirmed only then). */
  confirmedBy?: 'operator'; confirmedAt?: string;
}

/**
 * What is wrong with an AI link's source, or undefined: it must say which AI read it and where
 * ("ai:<provider>" or "ai:<provider>:<field or file>"). Empty, or posing as the form or an operator edit, is dropped.
 */
export function aiSourceProblem(source: unknown): string | undefined {
  if (typeof source !== 'string' || !source.trim()) return 'the link says nowhere where it came from (source is empty)';
  if (!/^ai:[^:\s][^:]*(?::\S.*)?$/.test(source.trim())) return `its source "${source.slice(0, 60)}" is not an AI read (ai:<provider>:<where>)`;
  return undefined;
}

function fnv1a32(str: string): number {
  let h = 2166136261;
  for (const c of str) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/**
 * The id part of a label, for things that are not stars (screens, features in a design file, roadshow people). A "+"
 * or "#" closing a word is spelled out, so C++, C# and C stay three; every other mark is a separator. Stars use
 * nameKey (below), which is the one normal form of a star's name.
 */
export const slug = (s: string) =>
  s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/(?<=[\p{L}\p{N}+])\+(?![\p{L}\p{N}])/gu, ' plus ').replace(/(?<=\p{L})#(?![\p{L}\p{N}])/gu, ' sharp ')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || `h${fnv1a32(s).toString(16)}`;

/**
 * Word sequences that name the same thing, read wherever a star's name is normalised (id and lookup alike): T&E,
 * T+E, T/E and "T and E" are Travel & Expense; "e-mail" is email. Whole words only, after "and" is dropped.
 */
export const NAME_SYNONYMS: [string[], string[]][] = [
  [['t', 'e'], ['travel', 'expense']],
  [['tande'], ['travel', 'expense']],
  [['travel', 'expenses'], ['travel', 'expense']],
  [['e', 'mail'], ['email']],
];
/**
 * The kinds whose last word loses a plural s ("Travel policies" → "travel policy"): systems and data sources, named
 * freely as a thing or its documents. Capabilities and pain points are phrases whose plural can carry meaning, so not.
 */
export const PLURAL_FOLDED: NodeType[] = ['System'];
/** Last words that end in s but are not plurals (or are names), kept as they are. */
const NOT_PLURAL = new Set(['news', 'series', 'species', 'analytics', 'logistics', 'status', 'campus', 'canvas', 'atlas', 'alias', 'bias', 'chaos', 'lens', 'windows', 'teams', 'sales', 'ops', 'devops', 'aws', 'sms', 'kms', 'gps', 'dns', 'hris', 'ats', 'crm', 'means', 'physics', 'economics', 'ethics', 'metrics', 'basis', 'thesis', 'axis']);
function singular(w: string): string {
  if (w.length < 4 || NOT_PLURAL.has(w) || /\d/.test(w)) return w;
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is|as|os)$/.test(w) || !w.endsWith('s')) return w;
  return w.slice(0, -1);
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decodeEntities = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  const k = e.toLowerCase();
  if (ENTITIES[k] !== undefined) return ENTITIES[k];
  const n = k.startsWith('#x') ? Number.parseInt(k.slice(2), 16) : k.startsWith('#') ? Number.parseInt(k.slice(1), 10) : NaN;
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});

/**
 * The one normal form of a star's name: its id is `type:` + this, and the registry looks names up by this, so one
 * name can never give two stars. For every kind but people: HTML entities decoded (T&amp;E), accents, case, spacing
 * and punctuation aside, dotted initials joined (G.S.S. is GSS), "&", "+" between words and the word "and" are one
 * thing (T&E, T+E, T and E, T/E), the synonyms above, and for systems and data a plural last
 * word ("Travel policies") is singular. A "+" or "#" closing a word (C++, C#) stays apart from the bare word.
 * People are matched by their exact name (case and spacing aside), never by folding accents: Lucía Fernández and
 * Lucia Fernandez are two people until the operator merges them.
 */
export function nameKey(s: string, type?: NodeType): string {
  const raw = decodeEntities(String(s ?? ''));
  if (type === 'Person') {
    return raw.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || `h${fnv1a32(raw).toString(16)}`;
  }
  const t = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/(?<=[\p{L}\p{N}+])\+(?![\p{L}\p{N}])/gu, ' plus ').replace(/(?<=\p{L})#(?![\p{L}\p{N}])/gu, ' sharp ')
    .replace(/(?<![\p{L}\p{N}])((?:\p{L}\.){2,})(?![\p{L}\p{N}])/gu, (m) => m.replace(/\./g, ''));
  let words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length > 1) words = words.filter((w) => w !== 'and');
  for (const [from, to] of NAME_SYNONYMS) {
    for (let i = 0; i + from.length <= words.length; i++) {
      if (from.every((w, k) => words[i + k] === w)) { words = [...words.slice(0, i), ...to, ...words.slice(i + from.length)]; i += to.length - 1; }
    }
  }
  if (type && PLURAL_FOLDED.includes(type) && words.length) words[words.length - 1] = singular(words[words.length - 1]);
  return words.join('-') || `h${fnv1a32(raw).toString(16)}`;
}
/** The kind a star id's prefix names ("painpoint:…" is a PainPoint), or undefined. */
export const typeOfId = (id: string): NodeType | undefined => {
  const p = String(id).split(':')[0];
  return NODE_TYPES.find((t) => (t === 'Idea' ? 'idea' : t.toLowerCase()) === p);
};
/**
 * A stored star id (an AI link's, an operator edit's, an entities.yaml entry's) in today's normal form, so an id
 * written before nameKey was the one normal form ("system:t-e-policy", "capability:deadline-tracking-and-alerting")
 * names the star its label names today. Ideas and rounds keep their ids; people too (their ids keep accents now,
 * and the build finds an older accent-folded id by its person: see buildGraph).
 */
export function canonId(id: string): string {
  const type = typeOfId(id);
  if (!type || type === 'Idea' || type === 'Round' || type === 'Person') return id;
  const rest = id.slice(id.indexOf(':') + 1);
  if (!rest || /^h[0-9a-f]+$/.test(rest)) return id;
  return `${type.toLowerCase()}:${nameKey(rest.replace(/-/g, ' '), type)}`;
}
/** An AI link with its star ids in today's normal form (canonId), the file line left as it is. */
export function canonLink(l: AiLink): AiLink {
  const f = canonId(l.from); const t = canonId(l.to);
  const nn = l.newNodes?.map((n) => (typeof n?.id === 'string' ? { ...n, id: canonId(n.id) } : n));
  if (f === l.from && t === l.to && (l.newNodes ?? []).every((n, i) => n === nn![i] || n.id === nn![i].id)) return l;
  return { ...l, from: f, to: t, ...(nn ? { newNodes: nn } : {}) };
}
/** An operator edit with its star ids in today's normal form (canonId). */
export function canonEdit(e: OperatorEdit): OperatorEdit {
  if (e.t === 'link' || e.t === 'unlink') { const from = canonId(e.from); const to = canonId(e.to); return from === e.from && to === e.to ? e : { ...e, from, to }; }
  if (e.t === 'merge') { const from = canonId(e.from); const into = canonId(e.into); return from === e.from && into === e.into ? e : { ...e, from, into }; }
  if (e.t === 'rename' || e.t === 'remove' || e.t === 'alias' || e.t === 'add') { const node = canonId(e.node); return node === e.node ? e : { ...e, node }; }
  return e;
}
/** The id an accent-folded person id had before people kept their accents ("person:lucia-fernandez" for Lucía Fernández). */
export const foldedPersonId = (label: string) => `person:${slug(label)}`;
/** Whether a star id carries its type's prefix ("capability:…" for a Capability): an id that lies about its kind is refused. */
export const idMatchesType = (id: string, type: string) => typeof id === 'string' && id.startsWith(`${type === 'Idea' ? 'idea' : type.toLowerCase()}:`) && id.length > type.length + 1;
export function nodeId(type: NodeType, label: string): string {
  if (type === 'Idea') return `idea:${label}`;
  if (type === 'Round') return `round:${slug(label)}`;
  return `${type.toLowerCase()}:${nameKey(label, type)}`;
}
export const edgeId = (from: string, rel: Relation, to: string) => `${from}|${rel}|${to}`;

/** The Café's approved tools (app design section 6). Anything else is "not on the approved list". */
export const APPROVED_TOOLS: string[] = ['Microsoft Copilot', 'Copilot Studio', 'Power Apps', 'Dataiku', 'custom app'];
export const TOOL_ALIASES: Record<string, string> = {
  'microsoft copilot': 'Microsoft Copilot', 'copilot': 'Microsoft Copilot', 'm365 copilot': 'Microsoft Copilot', 'microsoft 365 copilot': 'Microsoft Copilot', 'ms copilot': 'Microsoft Copilot',
  'copilot studio': 'Copilot Studio', 'microsoft copilot studio': 'Copilot Studio',
  'power apps': 'Power Apps', 'powerapps': 'Power Apps', 'microsoft power apps': 'Power Apps', 'power app': 'Power Apps',
  'dataiku': 'Dataiku', 'dataiku dss': 'Dataiku',
  'custom app': 'custom app', 'custom application': 'custom app', 'custom code': 'custom app', 'custom-built app': 'custom app', 'bespoke app': 'custom app',
};
/** The built-in tool table, read until a workspace's registry is loaded (src/graph/registryFile.ts installs its own). */
let resolveTool: (label: string) => string | undefined = (label) => TOOL_ALIASES[label.trim().toLowerCase().replace(/\s+/g, ' ')];
export function setToolResolver(fn: (label: string) => string | undefined): void { resolveTool = fn; }
/** The canonical approved label for a tool name, or undefined when it is not on the list (the registry decides). */
export function canonicalTool(label: string): string | undefined {
  return resolveTool(label);
}
export const isApprovedTool = (label: string) => canonicalTool(label) !== undefined;
export const NOT_APPROVED_NOTE = ' — not on the approved list';
/**
 * Tools the Café has met that are not on the approved list (UiPath has left it). A name here is never taken as
 * another name of an approved tool: "also know Copilot Studio as UiPath" would make a retired tool look approved.
 */
export const KNOWN_UNAPPROVED_TOOLS: string[] = ['UiPath', 'Power Automate', 'GitHub Copilot', 'ChatGPT', 'Automation Anywhere', 'Blue Prism', 'Alteryx', 'Zapier'];
/** The source an operator link carries: the edit that made it and its date. */
export const operatorSource = (id: string, at: string) => `operator:${id}@${at}`;
export const isOperatorSource = (source: string) => source === 'operator' || source.startsWith('operator:');
/**
 * Said wherever an older record's tool is shown that has since left the approved list (UiPath did). The record loads
 * as it is: the tool is never swapped for another one; the picker needs a new pick.
 */
export const noLongerApproved = (tool: string) => `${tool} is no longer on the approved list: pick another tool`;
/** The stored tool's note when it is not (or no longer) approved; undefined for an approved tool or none. */
export const retiredToolNote = (tool: string | undefined) => (tool && !isApprovedTool(tool) ? noLongerApproved(tool) : undefined);
