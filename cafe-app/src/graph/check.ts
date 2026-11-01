import { AI_NODE_TYPES, AI_RELATIONS, BUILTIN_SCHEMA, FORM_ONLY_RELATIONS, operatorLinkProblem, aiSourceProblem, canonEdit, canonLink, idMatchesType, nameKey, type GEdge, type GNode, type NodeType, type Relation, type Schema } from './ontology';
import { loadOntology } from './ontologyFile';
import { readEntities } from './registryFile';
import { REGISTRY_SECTIONS, approvedTool, unapprovedTool } from './registry';
import { APPROVED_TOOLS } from './ontology';
import { paths } from '../workspace/paths';
import { readText } from '../workspace/files';
import { readEdits } from './operator';
import { readAiLinks, readConfirmations, rebuildGraph } from './store';
import { formOnly, mergeProblem, mergedInto, staleEdits, type StaleEdit } from './build';
import { confirmer, readRules, type Rule } from './rules';
import { confirmAt } from '../ai/confirm';
import { loadSettings } from '../round/store';

/**
 * `cafe ontology check`: the workspace's files and graph against the ontology. It reads, it reports, it never fixes
 * (`cafe ontology fix` does, dry-run first). Each violation is one line saying which file, where, and what is wrong.
 */
export interface CheckResult {
  violations: string[]; checked: { nodes: number; edges: number; derived: number };
  /** Operator edits pointing at stars the graph no longer holds (after following merges): skipped by the build, never deleted. */
  stale: StaleEdit[];
  /** Capability-level facts stated for no idea: they give no idea a dependency on their own (see rules.ts). */
  unscoped?: Unscoped[];
  /** AI links confirmed without the operator's Do it although their confidence is below the threshold. */
  lowConfidence?: LowConfidence[];
}
export interface Unscoped {
  /** "operator.jsonl op-9" or "ai-links.jsonl line 12". */
  where: string; edge: string; from: string; rel: Relation; to: string;
  /** The ideas that need the capability; those whose own facts already derive the same dependency (they confirm it). */
  needers: string[]; confirming: string[];
}
export interface LowConfidence { line: number; edge: string; confidence: number; idea?: string }

/** One line per stale edit, as the CLI prints it and /api/graph lists it. */
export const staleLine = (s: StaleEdit) => `operator.jsonl ${s.id}: ${s.what}: ${s.missing.join(', ')} ${s.missing.length === 1 ? 'is' : 'are'} not in the graph`;

/** The relations a same-idea rule reads that have no Idea end: a fact of that kind must say which idea it is for. */
export function scopedRelations(rules: Rule[], schema: Schema = BUILTIN_SCHEMA): Relation[] {
  const out = new Set<Relation>();
  for (const r of rules) if (r.kind === 'chain' && r.enabled && r.scope === 'same-idea') for (const rel of r.chain) if (schema.allowed[rel] && schema.allowed[rel][0] !== 'Idea' && schema.allowed[rel][1] !== 'Idea') out.add(rel);
  return [...out];
}

/**
 * For a capability-level fact: the ideas that need its capability, and of those the ones that confirm it (their own
 * facts already derive the same dependency, so the fact holds for them). What `fix` stamps, and what check shows.
 */
export function scopeCandidates(graph: { nodes: GNode[]; edges: GEdge[] }, from: string, to: string): { needers: string[]; confirming: string[] } {
  const types = new Map(graph.nodes.map((n) => [n.id, n.type]));
  // The ideas that reach the fact's near end: those that need a capability, those that depend on (or use) a system or
  // anything else by a derived link, or are linked to it by a stated one.
  const ideaEnd = (e: GEdge) => (types.get(e.from) === 'Idea' && e.to === from ? e.from : types.get(e.to) === 'Idea' && e.from === from ? e.to : undefined);
  const reached = graph.edges.filter((e) => (types.get(from) === 'Capability' ? e.rel === 'NEEDS' && !e.derived : true)).map(ideaEnd).filter((x): x is string => !!x);
  const needers = [...new Set(reached.map((x) => x.slice('idea:'.length)))].sort();
  const confirms = confirmer(graph.edges, (id) => types.get(id));
  const self = graph.edges.find((e) => !e.derived && e.from === from && e.to === to)?.id;
  // An idea confirms it when its own facts reach the far end by another link than this one (the rules read it so).
  return { needers, confirming: needers.filter((i) => confirms(i, to, self)) };
}

export async function checkWorkspace(root: string): Promise<CheckResult> {
  const out: string[] = [];

  // 1. The ontology file: compiled the way the build compiles it, which says what it cannot take.
  const onto = await loadOntology(root);
  const schema = onto.schema;
  out.push(...onto.problems);
  const ALLOWED = schema.allowed; const DERIVED_RELATIONS = schema.derived;
  const isRelation = (v: unknown): v is Relation => typeof v === 'string' && Object.hasOwn(ALLOWED, v);
  const isType = (v: unknown): v is NodeType => typeof v === 'string' && schema.types.includes(v as NodeType);
  const pair = (rel: Relation) => `${ALLOWED[rel][0]} → ${ALLOWED[rel][1]}`;

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
        if (!e.id.startsWith(prefix)) out.push(`entities.yaml: ${section}: "${e.id}" does not start with "${prefix}" (not used by the build)`);
        for (const a of [e.label, ...(e.aliases ?? [])]) {
          const k = `${section}|${nameKey(String(a), section as NodeType)}`;
          const owner = aliases.get(k);
          if (owner && owner !== e.label) out.push(`entities.yaml: ${section}: "${e.id}": alias "${a}" is already ${owner}'s`);
          else aliases.set(k, e.label);
          // A tool that is not (or no longer) approved is never another name of an approved one: it would look approved.
          const retired = section === 'Tool' ? unapprovedTool(String(a)) : undefined;
          if (retired) out.push(`entities.yaml: Tool: "${e.id}": ${a === e.label ? 'is' : `alias "${a}" names`} ${retired}, which is not on the approved list: an approved tool's name would make it look approved (not used by the build; remove it)`);
        }
        if (section === 'Tool' && !unapprovedTool(e.label) && !approvedTool(e.label)) out.push(`entities.yaml: Tool: "${e.id}" (${e.label}) is not on the Café's approved list (${APPROVED_TOOLS.join(', ')}): a Tool entry names an approved tool (not used by the build; remove it)`);
      });
    }
  } else if ((await readText(paths(root).entities)) !== undefined) out.push('entities.yaml: could not be read (the built-in tools apply)');

  // 3. The rules file, read the way the build reads it: every rule it cannot take, a file it cannot read.
  const rules = await readRules(root, schema);
  out.push(...rules.problems);

  // 4. The graph: what the build holds, and what it refused or skipped on the way.
  const graph = await rebuildGraph(root);
  const typeOf = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const typeOfAny = (id: string, extra: Map<string, NodeType>) => typeOf.get(id) ?? extra.get(id);
  for (const n of graph.nodes) {
    if (!isType(n.type)) out.push(`graph: ${n.id}: unknown node type "${n.type}"`);
    else if (!idMatchesType(n.id, n.type)) out.push(`graph: ${n.id}: a ${n.type} whose id does not start with "${n.type === 'Idea' ? 'idea' : n.type.toLowerCase()}:"`);
  }
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  for (const e of graph.edges) {
    if (!isRelation(e.rel)) { out.push(`graph: ${e.id}: unknown relation "${e.rel}"`); continue; }
    const [f, t] = ALLOWED[e.rel];
    if (typeOf.get(e.from) !== f || typeOf.get(e.to) !== t) out.push(`graph: ${e.id}: ${e.rel} goes ${pair(e.rel)}, not ${typeOf.get(e.from) ?? '?'} → ${typeOf.get(e.to) ?? '?'}`);
    if (DERIVED_RELATIONS.includes(e.rel) && !e.derived) out.push(`graph: ${e.id}: ${e.rel} is derived by the rules but this one is stored (${e.source})`);
    for (const i of [...(e.derived?.inputs ?? []), ...(e.derived?.alternatives ?? []).flat()]) if (!edgeIds.has(i)) out.push(`graph: ${e.id}: derived by ${e.derived!.rule} from ${i}, which is not in the graph`);
  }
  // What the build itself refused or dropped (a forged confirmation, a confidence out of range, an AI tool, a removed
  // idea, a loop of kinds …): named here as it is in the app's banner.
  const said = new Set(out);
  const buildSays = graph.problems.map((p) => p.message).filter((m) => /\((refused|dropped|not used) by the build\)$|counts as waiting for your Do it$/.test(m));
  const scopedRels = scopedRelations(rules.rules, schema);
  const unscoped: Unscoped[] = []; const lowConfidence: LowConfidence[] = [];
  const threshold = confirmAt(await loadSettings(root).catch(() => ({})));
  const { links: rawLinks, problems } = await readAiLinks(root);
  const confirmations = await readConfirmations(root);
  // Ids compared in today's normal form, as the build reads them (an id written in an older form names the same star).
  const links = rawLinks.map(canonLink);
  for (const p of problems) out.push(`ai-links.jsonl line ${p.line}: could not be read`);
  // The file line of each link that parsed, in order: the n-th link read is on the n-th of these lines.
  const fileLines: number[] = [];
  ((await readText(`${paths(root).graph}/ai-links.jsonl`)) ?? '').split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) fileLines.push(i + 1); } catch { /* reported above */ }
  });
  const moved = mergedInto(await readEdits(root), schema);
  links.forEach((l, i) => {
    const line = fileLines[i] ?? i + 1;
    if (l.status === 'removed') return;
    const at = `ai-links.jsonl line ${line}`;
    if (!isRelation(l.rel)) { out.push(`${at}: unknown relation "${String(l.rel)}" (skipped by the build)`); return; }
    if (DERIVED_RELATIONS.includes(l.rel)) { out.push(`${at}: ${l.rel} is derived by the rules, never stated by the AI (skipped by the build)`); return; }
    if (!AI_RELATIONS.includes(l.rel)) { out.push(`${at}: ${l.rel === 'BUILT_WITH' ? 'a tool comes only from the tool pick, never from an AI link' : `${l.rel} is not a link the AI may propose`} (dropped by the build)`); return; }
    const extra = new Map((l.newNodes ?? []).map((n) => [n.id, n.type]));
    for (const n of l.newNodes ?? []) {
      if (!AI_NODE_TYPES.includes(n.type)) out.push(`${at}: new star ${n.id} is a ${String(n.type)}, which the AI may not make (skipped by the build)`);
      else if (!idMatchesType(n.id, n.type)) out.push(`${at}: new star ${n.id} is a ${n.type} but its id does not start with "${n.type.toLowerCase()}:" (skipped by the build)`);
    }
    // A star merged into another since (an operator merge) is that star now: the build moved the link there.
    const ft = typeOfAny(l.from, extra) ?? typeOf.get(moved(l.from)); const tt = typeOfAny(l.to, extra) ?? typeOf.get(moved(l.to));
    const unknown = [[l.from, ft], [l.to, tt]].filter(([, t]) => !t).map(([id]) => id);
    if (unknown.length) { out.push(`${at}: ${unknown.join(' and ')} ${unknown.length === 1 ? 'is' : 'are'} not in the graph or among the link's new stars (skipped by the build)`); return; }
    if (ft !== ALLOWED[l.rel][0] || tt !== ALLOWED[l.rel][1]) { out.push(`${at}: ${l.rel} goes ${pair(l.rel)}, not ${ft} → ${tt} (skipped by the build)`); return; }
    const bad = aiSourceProblem(l.source);
    if (bad) { out.push(`${at}: ${bad} (dropped by the build)`); return; }
    if (typeof l.confidence !== 'number' || !Number.isFinite(l.confidence) || l.confidence < 0 || l.confidence > 1) { out.push(`${at}: confidence ${JSON.stringify(l.confidence)} is not a number from 0 to 1 (dropped by the build)`); return; }
    const didIt = confirmations.has(`${l.from}|${l.rel}|${l.to}#${l.idea ?? ''}`) || confirmations.has(`${l.from}|${l.rel}|${l.to}`);
    if (l.status === 'confirmed' && l.confirmedBy === 'operator' && l.confidence < threshold && !didIt) out.push(`${at}: says the operator confirmed it, but no Do it is recorded for it (graph/confirmations.jsonl): it counts as waiting for your Do it`);
    if (scopedRels.includes(l.rel) && !l.idea) unscoped.push({ where: at, edge: `${l.from}|${l.rel}|${l.to}`, from: l.from, rel: l.rel, to: l.to, ...scopeCandidates(graph, l.from, l.to) });
    if (l.status === 'confirmed' && typeof l.confidence === 'number' && l.confidence < threshold && !(l.confirmedBy === 'operator' && didIt)) lowConfidence.push({ line, edge: `${l.from}|${l.rel}|${l.to}`, confidence: l.confidence, ...(l.idea ? { idea: l.idea } : {}) });
  });
  const edits = (await readEdits(root)).map(canonEdit);
  for (const e of edits) {
    if (e.status !== 'active') continue;
    const at = `operator.jsonl ${e.id}`;
    if (e.t === 'add') {
      if (!isType(e.type)) out.push(`${at}: unknown node type "${String(e.type)}" (refused by the build)`);
      else if (!idMatchesType(e.node, e.type)) out.push(`${at}: ${e.node} is a ${e.type} but its id does not start with "${e.type === 'Idea' ? 'idea' : e.type.toLowerCase()}:" (refused by the build)`);
      else if (!schema.operatorStars.includes(e.type)) out.push(`${at}: add ${e.node}: ${formOnly(e.type)} (refused by the build)`);
    }
    if (e.t === 'merge' && e.from !== e.into) {
      const a = e.from.split(':')[0]; const b = e.into.split(':')[0];
      if (a !== b || !schema.mergeable.some((m) => m.toLowerCase() === a)) out.push(`${at}: merge ${e.from} into ${e.into}: ${mergeProblem(e.from, e.into)} (refused by the build)`);
    }
    if (e.t === 'link') {
      if (!isRelation(e.rel)) { out.push(`${at}: unknown relation "${String(e.rel)}"`); continue; }
      if (DERIVED_RELATIONS.includes(e.rel)) { out.push(`${at}: ${e.rel} is derived by the rules from what the graph holds, never stored by hand (refused by the build)`); continue; }
      if (FORM_ONLY_RELATIONS.includes(e.rel)) { out.push(`${at}: link ${e.from} ${e.rel} ${e.to}: ${operatorLinkProblem(e.rel, undefined, undefined, schema)} (refused by the build)`); continue; }
      const ft = typeOf.get(e.from); const tt = typeOf.get(e.to);
      if (ft && tt && (ft !== ALLOWED[e.rel][0] || tt !== ALLOWED[e.rel][1])) out.push(`${at}: ${e.rel} goes ${pair(e.rel)}, not ${ft} → ${tt} (skipped by the build)`);
      else if (ft && tt && scopedRels.includes(e.rel) && !e.idea) unscoped.push({ where: at, edge: `${e.from}|${e.rel}|${e.to}`, from: e.from, rel: e.rel, to: e.to, ...scopeCandidates(graph, e.from, e.to) });
    }
  }
  // One name, two stars: two stars of one kind whose labels read the same in the one normal form (nameKey).
  const byName = new Map<string, string[]>();
  for (const n of graph.nodes) if (n.type !== 'Idea' && n.type !== 'Round') { const k = `${n.type}|${nameKey(n.label, n.type)}`; byName.set(k, [...(byName.get(k) ?? []), n.id]); }
  for (const [k, ids] of byName) if (ids.length > 1) out.push(`graph: ${ids.join(' and ')}: two ${k.split('|')[0]} stars with one name ("${k.split('|')[1]}"): merge them`);
  // The build's own refusals that check has not already said in its words (same line, same file place).
  // AI links are named by their file line above; an edit or an entry the check already named is not named twice.
  // An operator edit already named in check's words is not named again; an AI link the build refused for a reason the
  // lines above do not cover (a forged quote, a readAt that is no time) is named by its file line.
  const where = (m: string) => m.split(': ')[0];
  for (const m of buildSays) {
    if (m.startsWith('entities.yaml')) continue;
    const ai = /^ai-links\.jsonl link (\d+) \([^)]*\): (.*)$/.exec(m);
    if (ai) {
      const at = `ai-links.jsonl line ${fileLines[Number(ai[1]) - 1] ?? ai[1]}`;
      if (!out.some((x) => x.startsWith(`${at}:`))) out.push(`${at}: ${ai[2]}`);
      continue;
    }
    if (out.includes(m)) continue;
    if (m.startsWith('operator.jsonl ') && out.some((x) => where(x) === where(m))) continue;
    out.push(m);
  }
  // What else the build could not take: idea folders, the threshold, the Do-it records (none of them end in a refusal word).
  for (const m of graph.problems.map((p) => p.message)) if (/^(ideas\/|settings\.yaml:|confirmations\.jsonl)/.test(m) && !out.includes(m)) out.push(m);
  void said;
  return {
    violations: out, stale: staleEdits(graph.nodes, edits, schema), unscoped, lowConfidence,
    checked: { nodes: graph.nodes.length, edges: graph.edges.filter((e) => !e.derived).length, derived: graph.edges.filter((e) => e.derived).length },
  };
}


/** One line per unscoped fact: what it is, what it does now, and the command that settles it. */
export function unscopedLine(u: Unscoped): string {
  const head = `${u.where}: unscoped: ${u.from} ${u.rel} ${u.to} names no idea`;
  const now = u.confirming.length ? `, so it only adds a way for ${u.confirming.join(', ')}, whose own facts already say so` : ', so it gives no idea a dependency';
  const fix = u.confirming.length || u.needers.length === 1
    ? `. Fix: cafe ontology fix --apply (stamps ${(u.confirming.length ? u.confirming : u.needers).join(', ')})`
    : u.needers.length
      ? `. Needed by ${u.needers.join(', ')}: say which with cafe ontology fix --apply --stamp ${u.where.replace(/^operator\.jsonl /, '').replace(/^ai-links\.jsonl line /, 'line-')}=${u.needers[0]}`
      : u.from.startsWith('capability:') ? '. No idea needs the capability yet' : `. No idea reaches ${u.from} yet (none needs, depends on or links to it)`;
  return head + now + fix;
}

/** What `cafe ontology check` prints, and its exit code: 1 on a violation, or on a stale edit, an unscoped fact or an unconfirmed-looking AI link with --strict. */
export function checkReport(r: CheckResult, strict: boolean): { lines: string[]; code: number } {
  const lines = [...r.violations];
  lines.push(r.violations.length ? `${r.violations.length} violation${r.violations.length === 1 ? '' : 's'} (nothing was changed)` : `No violations: ${r.checked.nodes} stars, ${r.checked.edges} links and ${r.checked.derived} derived links checked against the ontology.`);
  if (r.stale.length) {
    lines.push(`Stale operator edits (${r.stale.length}): they point at stars the graph no longer holds, so the build skips them (nothing was changed):`);
    lines.push(...r.stale.map(staleLine));
  }
  const unscoped = r.unscoped ?? []; const low = r.lowConfidence ?? [];
  if (unscoped.length) {
    lines.push(`Unscoped facts (${unscoped.length}): a capability-level link must say which idea it is for; until it does it gives no idea a new dependency:`);
    lines.push(...unscoped.map(unscopedLine));
  }
  if (low.length) {
    lines.push(`AI links stored as confirmed below the confidence threshold without your Do it (${low.length}): the build counts them as waiting for it; cafe ontology fix --apply writes them back as waiting:`);
    lines.push(...low.map((l) => `ai-links.jsonl line ${l.line}: ${l.edge.replace(/\|/g, ' ')} at ${l.confidence}${l.idea ? ` (${l.idea})` : ''}`));
  }
  return { lines, code: r.violations.length || (strict && (r.stale.length || unscoped.length || low.length)) ? 1 : 0 };
}
