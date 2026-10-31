import { ALLOWED, DERIVED_RELATIONS, FORM_ONLY_RELATIONS, IDEA_SCOPED, KNOWN_UNAPPROVED_TOOLS, MERGEABLE, NODE_LABELS, OPERATOR_STARS, edgeId, isOperatorSource, nameKey, nodeId, operatorLinkProblem, type GEdge, type GNode, type NodeType, type Relation } from '../graph/ontology';
import { appendEdit, nextEditId, readEdits, setEditStatus } from '../graph/operator';
import { ideaDir, loadIdea, saveIdea } from '../ideas/store';
import type { Idea, Person, PersonRole } from '../ideas/idea';
import { personOn, rolesText, withAddedRole, withoutRole } from '../ideas/people';
import { appendHistory } from '../workspace/files';
import { assignIdeas, createRound, listRounds, setIdeaRound } from '../round/store';
import type { Round } from '../round/round';
import type { Clock } from '../clock';
import type { CommandStep } from '../ai/tasks';
import type { Coded } from './names';
import type { Connector } from '../ai/connector';
import { growIdea } from '../ai/grow';
import { mergeStars, rebuildGraph, setAiLinkStatus } from '../graph/store';
import { writeExport } from '../graph/jsonld';
import { dataKey } from '../workspace/paths';
import type { Registry } from '../graph/registry';

/** What the app will do for one step of a command, once the operator says "Do it". */

/** "An idea and a system or data can't be linked that way.": the kinds in words, each with its article. */
export function cantLink(a: NodeType, b: NodeType): string {
  const kind = (t: NodeType) => { const w = NODE_LABELS[t].toLowerCase(); return `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`; };
  const both = `${kind(a)} and ${kind(b)}`;
  return `${both[0].toUpperCase()}${both.slice(1)} can't be linked that way.`;
}

/**
 * The ideas a capability-level link (Capability USES_DATA System) is for: the idea named, or the one on screen, or
 * every idea that needs the capability (one proposal each, the operator saying yes to the ones it holds for). Never
 * none: a link no idea owns would give no idea a dependency (the rules scope by the idea), so it is not proposed.
 * Other relations need no idea: `ideas` is empty.
 */
export function linkScope(
  graph: { nodes: GNode[]; edges: GEdge[] }, from: string, rel: Relation, to: string,
  opts: { named?: string; focus?: string; title?: (id: string) => string } = {},
): { ideas: string[]; note?: string } | { problem: string } {
  if (!IDEA_SCOPED.includes(rel)) return { ideas: [] };
  const label = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const title = opts.title ?? ((i: string) => label(`idea:${i}`));
  const have = graph.edges.find((e) => e.id === edgeId(from, rel, to) && !e.derived);
  const needers = [...new Set(graph.edges.filter((e) => e.rel === 'NEEDS' && e.to === from && !e.derived).map((e) => e.from.slice('idea:'.length)))].sort();
  if (opts.named && !needers.includes(opts.named)) return { problem: `${title(opts.named)} does not need ${label(from)}, so the link would give it nothing: link it for an idea that needs ${label(from)}.` };
  const wanted = opts.named ? [opts.named] : opts.focus && needers.includes(opts.focus) ? [opts.focus] : needers;
  if (!wanted.length) return { problem: `No idea needs ${label(from)} yet, so linking it to ${label(to)} would give no idea a dependency: open the idea it is for, or say which idea.` };
  const fresh = wanted.filter((i) => !have?.ideas?.includes(i));
  if (!fresh.length) return { problem: `${label(from)} already ${REL_WORD[rel] ?? 'is linked to'} ${label(to)} for ${wanted.map(title).join(', ')}.` };
  return { ideas: fresh, ...(fresh.length > 1 ? { note: `${label(from)} is needed by ${fresh.length} ideas: say Do it on each idea it holds for; a link holds only for the ideas it names.` } : {}) };
}

/**
 * The checks every proposed link passes, whoever proposes it (the assistant's AI, NetworkX's Propose, a suggestion in
 * an answer): the ontology's pair, no derived relation, nothing only the form, the rounds or the tool picker state
 * (FORM_ONLY_RELATIONS), not a link already there, and the idea a capability-level link is for (linkScope). Returns
 * the proposals (one per idea for a capability-level link) or the one line that says why not.
 */
export function linkProposals(
  graph: { nodes: GNode[]; edges: GEdge[] }, from: GNode, rel: Relation, to: GNode,
  opts: { named?: string; focus?: string; title?: (id: string) => string; suffix?: string } = {},
): { proposals: Proposal[]; note?: string } | { problem: string } {
  const bad = operatorLinkProblem(rel, from.type, to.type);
  if (bad) return { problem: FORM_ONLY_RELATIONS.includes(rel) || DERIVED_RELATIONS.includes(rel) ? `${from.label} → ${to.label}: ${bad}.` : cantLink(from.type, to.type) };
  if (!IDEA_SCOPED.includes(rel) && graph.edges.some((e) => e.id === edgeId(from.id, rel, to.id))) return { problem: `${from.label} and ${to.label} are already linked.` };
  const title = opts.title ?? ((i: string) => graph.nodes.find((n) => n.id === `idea:${i}`)?.label ?? i);
  // A capability-level link says which idea it is for: one proposal per idea, each stamped.
  const scope = linkScope(graph, from.id, rel, to.id, { named: opts.named, focus: opts.focus, title });
  if ('problem' in scope) return { problem: scope.problem };
  const relWord = `${REL_WORD[rel] ? ` (${REL_WORD[rel]})` : ''}`;
  const suffix = opts.suffix ?? '';
  if (!scope.ideas.length) {
    const onIdea = [from, to].some((n) => n.type === 'Idea') ? undefined : opts.focus;
    return { proposals: [{ label: `Link ${from.label} → ${to.label}${relWord}${suffix}`, action: { t: 'link', from: from.id, rel, to: to.id, ...(onIdea ? { idea: onIdea } : {}) } }] };
  }
  return {
    ...(scope.note ? { note: scope.note } : {}),
    proposals: scope.ideas.map((idea) => ({ label: `Link ${from.label} → ${to.label}${relWord} for ${title(idea)}${suffix}`, action: { t: 'link' as const, from: from.id, rel, to: to.id, idea }, ...(scope.note ? { note: scope.note } : {}) })),
  };
}

export type CommandAction =
  | { t: 'link'; from: string; rel: Relation; to: string; idea?: string }
  | { t: 'unlink'; from: string; rel: Relation; to: string; source: string }
  | { t: 'role'; ideaId: string; person: string; role: PersonRole | null; drop?: boolean }
  | { t: 'round'; ideaIds: string[]; roundId?: string; newName?: string }
  | { t: 'new_round'; name: string }
  | { t: 'rename'; node: string; label: string }
  | { t: 'merge'; from: string; into: string }
  | { t: 'alias'; node: string; label: string; of: string }
  | { t: 'add_star'; node: string; type: NodeType; label: string; link: { from: string; rel: Relation; to: string }; idea?: string }
  | { t: 'remove_star'; node: string }
  | { t: 'grow'; ideaId: string }
  | { t: 'export'; ideaId?: string };

/** How to take a done action back. */
export type CommandInverse =
  | { t: 'edit-off'; id: string }
  | { t: 'edit-on'; id: string }
  | { t: 'edits-off'; ids: string[] }
  | { t: 'ai-links-off'; edgeIds: string[] }
  | { t: 'team'; ideaId: string; before: Person[]; after: Person[] }
  | { t: 'rounds'; roundId: string; before: { ideaId: string; round: string }[] };

export interface Proposal {
  label: string; action: CommandAction;
  /** Said to the operator when the resolver changed what the AI asked for (an add became a link; a system went to the idea's capability). */
  note?: string;
}

const REL_WORD: Partial<Record<Relation, string>> = {
  HAS_TEAM: 'has the team', HAS_MEMBER: 'has the member', REPLACES: 'replaces', NEEDS: 'needs', USES_DATA: 'uses the data', ASKS_FOR: 'asks for',
  WANTS: 'wants the outcome', BENEFITS: 'benefits', IN_CATEGORY: 'is in the category',
};
const ROLE_WORD: Record<PersonRole, string> = { lead: 'lead', sponsor: 'sponsor', builder: 'builder', member: 'a team member' };
/** Labels the form owns: ideas and people are renamed in their own files, rounds in the Rounds pop-out. */
const RENAMEABLE: NodeType[] = ['Team', 'Entity', 'Capability', 'PainPoint', 'System', 'Support', 'Outcome', 'Beneficiary', 'Category', 'Tool'];
const ROLE_OF_REL: Partial<Record<Relation, PersonRole>> = { LEADS: 'lead', SPONSORS: 'sponsor', BUILDS: 'builder', RELATED: 'member' };
/** Where a star the command bar can't create or remove comes from. */
const OWNED_ELSEWHERE: Partial<Record<NodeType, (label: string) => string>> = {
  Tool: () => 'Tools are picked in the tool picker.',
  Team: () => "Teams come from the ideas' CS Function.",
  Entity: () => "The division comes from the ideas' submitters.",
  Round: () => 'Rounds are made in the Rounds pop-out.',
};
const word = (t: NodeType) => (t === 'Support' ? 'support request' : NODE_LABELS[t].toLowerCase());

export interface ResolveContext {
  codes: Map<string, Coded>;
  graph: { nodes: GNode[]; edges: GEdge[] };
  ideas: Idea[];
  rounds: Round[];
  /** The workspace's registry (stable names and aliases), when the caller has it. */
  registry?: Registry;
  /** The idea on screen when the command was made: a link made then is that idea's (the rules scope by it). */
  focusIdea?: string;
}

/**
 * Checks each step the AI proposed against the graph and the ideas, and turns it into an action with a plain label.
 * The AI proposes; this decides. A step that does not check out becomes a line saying why, and nothing is done.
 */
export function resolveSteps(steps: CommandStep[], ctx: ResolveContext): { proposals: Proposal[]; problems: string[] } {
  const proposals: Proposal[] = []; const problems: string[] = [];
  const nodes = new Map(ctx.graph.nodes.map((n) => [n.id, n]));
  const star = (code?: string): GNode | undefined => {
    const c = code ? ctx.codes.get(code.replace(/^\[|\]$/g, '')) : undefined;
    return c ? nodes.get(c.id) : undefined;
  };
  const ideaOf = (n: GNode) => ctx.ideas.find((i) => `idea:${i.id}` === n.id);
  const roundOf = (n: GNode) => ctx.rounds.find((r) => r.id === n.attrs?.roundId);
  const missing = (s: CommandStep) => problems.push(`I couldn't find ${[s.a, s.b].filter(Boolean).length > 1 ? 'both stars' : 'that star'} in the universe, so I left "${s.op}" out.`);
  const title = (ideaId: string) => ctx.ideas.find((i) => i.id === ideaId)?.title ?? nodes.get(`idea:${ideaId}`)?.label ?? ideaId;
  const scopeFor = (from: string, rel: Relation, to: string, named?: string) => linkScope(ctx.graph, from, rel, to, { named, focus: ctx.focusIdea, title });
  const edgesById = new Map(ctx.graph.edges.map((e) => [e.id, e]));
  const factWords = (id: string) => { const e = edgesById.get(id); return e ? `${nodes.get(e.from)?.label ?? e.from} ${REL_WORD[e.rel] ?? e.rel.toLowerCase().replace(/_/g, ' ')} ${nodes.get(e.to)?.label ?? e.to}` : id; };
  /**
   * A derived link can't be removed: it is what the rules say about the stored facts, and it comes back at the next
   * build. Say which stored facts it rests on (every way it is derived), and offer to remove the idea's own fact in
   * each way (its need for the capability), the one the operator can change here; a tool pick changes in the picker.
   */
  const derivedUnlink = (hit: GEdge) => {
    const ways = [hit.derived!.inputs, ...(hit.derived!.alternatives ?? [])];
    const from = nodes.get(hit.from)?.label ?? hit.from; const to = nodes.get(hit.to)?.label ?? hit.to;
    const rest = ways.map((w) => w.map(factWords).join(' and ')).join('; or ');
    problems.push(`${from} → ${to} (${hit.rel.toLowerCase().replace(/_/g, ' ')}) is derived by ${hit.derived!.rule} from what the graph holds, so it can't be removed by itself: it rests on ${rest}. Change one of those stored facts instead${ways.length > 1 ? `; it goes only when every way (${ways.length}) is gone` : ''}.`);
    const offered = new Set<string>();
    for (const w of ways) {
      const own = w.map((id) => edgesById.get(id)).find((e) => e && !e.derived && (e.from === hit.from || e.to === hit.to) && e.rel !== 'BUILT_WITH' && e.rel !== 'SUBMITTED' && (nodes.get(e.from)?.type === 'Idea' || nodes.get(e.to)?.type === 'Idea'));
      if (!own || offered.has(own.id)) continue;
      offered.add(own.id);
      proposals.push({
        label: `Remove the link ${nodes.get(own.from)!.label} → ${nodes.get(own.to)!.label} (the stored fact behind ${from} → ${to})`,
        action: { t: 'unlink', from: own.from, rel: own.rel, to: own.to, source: own.source },
        note: ways.length > 1 ? `${from} → ${to} is derived ${ways.length} ways: it goes only when each is gone.` : `${from} → ${to} goes with it at the next build.`,
      });
    }
  };

  // A role is added to the ones the person has (a lead can also build it); null takes them off the team.
  const roleProposal = (person: GNode | string, ideaNode: GNode, role: PersonRole | null) => {
    const idea = ideaOf(ideaNode);
    if (!idea) return void problems.push(`${ideaNode.label} is not an idea I can change.`);
    const name = typeof person === 'string' ? person : person.label;
    const now = personOn(idea, name);
    if (role === null) {
      if (idea.people.submitter === name && !now) return void problems.push(`${name} submitted ${idea.title}; the submitter stays.`);
      if (!now) return void problems.push(`${name} is not on ${idea.title}'s team.`);
      return void proposals.push({ label: `Take ${name} off ${idea.title}'s team`, action: { t: 'role', ideaId: idea.id, person: name, role: null } });
    }
    if (now && (now.roles.includes(role) || role === 'member')) return void problems.push(`${name} is already ${role === 'member' ? 'on the team of' : `${ROLE_WORD[role]} on`} ${idea.title}.`);
    const also = now && !now.roles.includes('member') ? ` (also ${rolesText(now.roles)})` : '';
    proposals.push({ label: `Make ${name} ${ROLE_WORD[role]} on ${idea.title}${also}`, action: { t: 'role', ideaId: idea.id, person: name, role } });
  };

  const dropRoleProposal = (person: GNode, ideaNode: GNode, role: PersonRole) => {
    const idea = ideaOf(ideaNode);
    if (!idea) return void problems.push(`${ideaNode.label} is not an idea I can change.`);
    const now = personOn(idea, person.label);
    if (!now?.roles.includes(role)) return void problems.push(`${person.label} is not ${ROLE_WORD[role]} on ${idea.title}.`);
    proposals.push({ label: `${person.label} is no longer ${ROLE_WORD[role]} on ${idea.title}`, action: { t: 'role', ideaId: idea.id, person: person.label, role, drop: true } });
  };

  for (const s of steps) {
    if (s.op === 'stage') {
      const n = star(s.a);
      problems.push(`Stages only move by your hand: open ${n ? n.label : 'the idea'} and use its stage button.`);
    } else if (s.op === 'link' || s.op === 'unlink') {
      const a = star(s.a); const b = star(s.b);
      if (!a || !b) { missing(s); continue; }
      const person = [a, b].find((n) => n.type === 'Person'); const idea = [a, b].find((n) => n.type === 'Idea');
      if (person && idea) {
        if (s.op === 'unlink') {
          // Unlinking one role (LEADS, BUILDS, SPONSORS) takes off only that role; otherwise the person leaves the team.
          const role = s.rel ? ROLE_OF_REL[s.rel] : undefined;
          if (role && role !== 'member') dropRoleProposal(person, idea, role); else roleProposal(person, idea, null);
          continue;
        }
        if (s.rel === 'SUBMITTED') { problems.push('Who submitted an idea comes from the form, so I left it as it is.'); continue; }
        roleProposal(person, idea, (s.rel && ROLE_OF_REL[s.rel]) ?? 'member');
        continue;
      }
      if (s.op === 'unlink') {
        const hit = ctx.graph.edges.find((e) => ((e.from === a.id && e.to === b.id) || (e.from === b.id && e.to === a.id)) && (!s.rel || e.rel === s.rel));
        if (!hit) { problems.push(`There is no link between ${a.label} and ${b.label}.`); continue; }
        if (hit.derived) { derivedUnlink(hit); continue; }
        proposals.push({ label: `Remove the link ${nodes.get(hit.from)!.label} → ${nodes.get(hit.to)!.label}`, action: { t: 'unlink', from: hit.from, rel: hit.rel, to: hit.to, source: hit.source } });
        continue;
      }
      if ((a.type === 'Idea' && b.type === 'Round') || (a.type === 'Round' && b.type === 'Idea')) {
        const i = a.type === 'Idea' ? a : b; const r = roundOf(a.type === 'Round' ? a : b); const ideaRec = ideaOf(i);
        if (r && ideaRec) proposals.push({ label: `Put ${i.label} in ${r.name}`, action: { t: 'round', ideaIds: [ideaRec.id], roundId: r.id } });
        else missing(s);
        continue;
      }
      const fits = (rel: Relation) => { const [f, t] = ALLOWED[rel]; return (a.type === f && b.type === t) || (b.type === f && a.type === t); };
      if (s.rel && DERIVED_RELATIONS.includes(s.rel)) { problems.push(`${s.rel.toLowerCase().replace(/_/g, ' ')} is derived by the rules from what the graph holds, not linked by hand.`); continue; }
      const choices = (s.rel ? [s.rel] : (Object.keys(ALLOWED) as Relation[])).filter(fits).filter((r) => !DERIVED_RELATIONS.includes(r));
      if (choices.includes('BUILT_WITH')) { problems.push('Tools are picked in the tool picker, so I left that link out.'); continue; }
      const rel = choices.filter((r) => r !== 'IN_ROUND')[0];
      if (!rel) { problems.push(cantLink(a.type, b.type)); continue; }
      const [ft] = ALLOWED[rel];
      const [from, to] = a.type === ft ? [a, b] : [b, a];
      const checked = linkProposals(ctx.graph, from, rel, to, { focus: ctx.focusIdea, title });
      if ('problem' in checked) { problems.push(checked.problem); continue; }
      proposals.push(...checked.proposals);
    } else if (s.op === 'role') {
      const a = star(s.a); const b = star(s.b);
      // A person not yet in the graph comes by name: the same person if the name matches one, else a new one.
      const typed = !a && s.name?.trim() ? s.name.trim().replace(/\s+/g, ' ') : '';
      const same = typed ? ctx.graph.nodes.find((n) => n.type === 'Person' && n.label.toLowerCase() === typed.toLowerCase()) : undefined;
      const person = a ?? same ?? (typed.split(' ').length >= 2 ? typed : undefined);
      if (!person || !b || (typeof person !== 'string' && person.type !== 'Person') || b.type !== 'Idea' || !s.role) {
        if (typed && typed.split(' ').length < 2) { problems.push(`Give the person's full name to add them (or pick them with @).`); continue; }
        missing(s); continue;
      }
      roleProposal(person, b, s.role);
    } else if (s.op === 'round') {
      const ideaNodes = (s.ideas ?? []).map((c) => star(c)).filter((n): n is GNode => n?.type === 'Idea' && !!ideaOf(n));
      if (!ideaNodes.length) { problems.push("I couldn't tell which ideas to put in the round."); continue; }
      const target = star(s.b);
      const named = s.name ? ctx.rounds.find((r) => r.name.toLowerCase() === s.name!.trim().toLowerCase()) : undefined;
      const round = (target?.type === 'Round' ? roundOf(target) : undefined) ?? named;
      const titles = ideaNodes.map((n) => n.label).join(', ');
      const ideaIds = ideaNodes.map((n) => ideaOf(n)!.id);
      if (round) proposals.push({ label: `Put ${titles} in ${round.name}`, action: { t: 'round', ideaIds, roundId: round.id } });
      else if (s.name?.trim()) proposals.push({ label: `Create the round ${s.name.trim()} and put ${titles} in it`, action: { t: 'round', ideaIds, newName: s.name.trim() } });
      else problems.push("I couldn't tell which round you meant.");
    } else if (s.op === 'new_round') {
      const name = s.name?.trim();
      if (!name) { problems.push('The round needs a name.'); continue; }
      if (ctx.rounds.some((r) => r.name.toLowerCase() === name.toLowerCase())) { problems.push(`There is already a round called ${name}.`); continue; }
      proposals.push({ label: `Create the round ${name}`, action: { t: 'new_round', name } });
    } else if (s.op === 'rename') {
      const a = star(s.a); const name = s.name?.trim();
      if (!a || !name) { missing(s); continue; }
      if (!RENAMEABLE.includes(a.type)) { problems.push(a.type === 'Round' ? 'Rename rounds in the Rounds pop-out.' : `${a.label} comes from the form, so its name changes there.`); continue; }
      const taken = ctx.registry?.resolve(a.type, name);
      if (taken && taken.id !== a.id && nodes.has(taken.id)) { problems.push(`"${name}" already names ${nodes.get(taken.id)!.label}: merge ${a.label} into it instead.`); continue; }
      proposals.push({ label: `Rename ${a.label} to ${name}`, action: { t: 'rename', node: a.id, label: name } });
    } else if (s.op === 'add_star') {
      const name = s.name?.trim(); const type = s.type;
      if (!name || !type) { problems.push("I couldn't tell what kind of star to create, or its name."); continue; }
      if (!OPERATOR_STARS.includes(type)) {
        problems.push(OWNED_ELSEWHERE[type]?.(name) ?? (type === 'Person' ? "People come from the ideas' teams: add someone with a role, such as \"make X a member of Y\"." : 'Ideas come from the submissions.'));
        continue;
      }
      let home = star(s.b);
      if (!home) { problems.push(`Say which idea or star ${name} belongs to, so it is not left floating.`); continue; }
      const notes: string[] = [];
      // A system the idea already depends on (by its label or an alias): said so, with the capability it goes through, nothing proposed.
      if (type === 'System' && home.type === 'Idea') {
        const known = ctx.registry?.resolve('System', name)?.id ?? ctx.graph.nodes.find((n) => n.type === 'System' && n.label.toLowerCase() === name.toLowerCase())?.id;
        const sys = known ? nodes.get(known) : undefined;
        if (sys) {
          const ideaCaps = new Set(ctx.graph.edges.filter((e) => e.from === home!.id && e.rel === 'NEEDS').map((e) => e.to));
          // Only the capabilities' links stated for this idea: another idea's use of the system is not this one's.
          const mine = home.id.slice('idea:'.length);
          const through = ctx.graph.edges.filter((e) => e.rel === 'USES_DATA' && e.to === sys.id && ideaCaps.has(e.from) && e.ideas?.includes(mine)).map((e) => nodes.get(e.from)?.label).filter((l): l is string => !!l).sort();
          const depends = ctx.graph.edges.some((e) => e.rel === 'DEPENDS_ON' && e.from === home!.id && e.to === sys.id);
          if (through.length || depends) {
            const aka = sys.label.toLowerCase() !== name.toLowerCase() ? ` (known as "${name}")` : '';
            problems.push(`Already there: ${home.label} depends on ${sys.label}${aka}${through.length ? ` through ${through.join(', ')}` : ''}.`);
            continue;
          }
        }
      }
      // A system on an idea: it links to one of the idea's capabilities, not to the idea. One capability: that one; several: ask which.
      // The link is then that idea's.
      const namedIdea = home.type === 'Idea' ? home.id.slice('idea:'.length) : undefined;
      if (type === 'System' && home.type === 'Idea') {
        const caps = ctx.graph.edges.filter((e) => e.from === home!.id && e.rel === 'NEEDS' && !e.derived).map((e) => nodes.get(e.to)).filter((n): n is GNode => n?.type === 'Capability')
          .sort((x, y) => x.label.localeCompare(y.label));
        if (caps.length !== 1) {
          problems.push(caps.length
            ? `A system links to a capability, not to an idea. ${home.label}'s capabilities are ${caps.map((c) => c.label).join(', ')}: say which one uses ${name}.`
            : `A system links to a capability, not to an idea: say which capability uses ${name}.`);
          continue;
        }
        home = caps[0];
        notes.push(`A system links to a capability: this goes to ${home.label}.`);
      }
      const hit = ctx.registry?.resolve(type, name);
      const same = ctx.graph.nodes.find((n) => n.type === type && n.label.toLowerCase() === name.toLowerCase()) ?? (hit ? nodes.get(hit.id) : undefined);
      const rel = (Object.keys(ALLOWED) as Relation[]).find((r) => { const [f, t] = ALLOWED[r]; return (f === home!.type && t === type) || (f === type && t === home!.type); });
      if (!rel) { problems.push(`A ${word(type)} can't be linked to a ${word(home.type)}.`); continue; }
      // A name the registry knows but no star carries yet is born with its registered id and label.
      const node = same?.id ?? hit?.id ?? nodeId(type, name);
      const label = same?.label ?? hit?.label ?? name;
      const [from, to] = ALLOWED[rel][0] === home.type ? [home.id, node] : [node, home.id];
      // A capability-level link is stamped with its idea (the one named, on screen, or each idea that needs it).
      const scoped = IDEA_SCOPED.includes(rel) ? scopeFor(from, rel, to, namedIdea) : { ideas: [] as string[] };
      if ('problem' in scoped) {
        // A system new to the graph has no link yet: the "already" problem cannot apply; only "no idea needs it".
        problems.push(scoped.problem); continue;
      }
      const onIdeas: (string | undefined)[] = scoped.ideas.length ? scoped.ideas : [home.type === 'Idea' ? undefined : ctx.focusIdea];
      if (scoped.note) notes.push(scoped.note);
      const forIdea = (i: string | undefined) => (scoped.ideas.length && i ? ` for ${title(i)}` : '');
      if (same) {
        // The star is there already: the add becomes the link, under the name the operator used.
        const known = same.label.toLowerCase() !== name.toLowerCase() ? ` (known as "${name}")` : '';
        if (!scoped.ideas.length && ctx.graph.edges.some((e) => e.id === edgeId(from, rel, to))) { problems.push(`${nodes.get(from)!.label} already ${REL_WORD[rel] ?? 'is linked to'} ${nodes.get(to)!.label}.`); continue; }
        notes.push(`${same.label} already exists${known ? `, known as "${name}"` : ''}: this links it instead of adding a new one.`);
        for (const onIdea of onIdeas) proposals.push({ label: `Link ${same.label}${known} to ${home.label}${REL_WORD[rel] ? ` (${REL_WORD[rel]})` : ''}${forIdea(onIdea)}`, action: { t: 'link', from, rel, to, ...(onIdea ? { idea: onIdea } : {}) }, note: notes.join(' ') });
        continue;
      }
      const dir = from === home.id ? `linked from ${home.label}` : `linked to ${home.label}`;
      for (const onIdea of onIdeas) proposals.push({ label: `New ${word(type)}: ${label}, ${dir}${REL_WORD[rel] ? ` (${REL_WORD[rel]})` : ''}${forIdea(onIdea)}`, action: { t: 'add_star', node, type, label, link: { from, rel, to }, ...(onIdea ? { idea: onIdea } : {}) }, ...(notes.length ? { note: notes.join(' ') } : {}) });
    } else if (s.op === 'remove_star') {
      const a = star(s.a);
      if (!a) { missing(s); continue; }
      if (a.type === 'Person') {
        // A person is on ideas' teams: removing them takes them off each team (one step each, each with Undo).
        // Whoever submitted an idea stays its submitter, so their star stays while that idea does.
        const on = ctx.ideas.filter((i) => personOn(i, a.label));
        const submitted = ctx.ideas.filter((i) => i.people.submitter?.trim().toLowerCase() === a.label.trim().toLowerCase());
        for (const i of on) { const n = nodes.get(`idea:${i.id}`); if (n) roleProposal(a, n, null); }
        for (const i of submitted) problems.push(`${a.label} submitted ${i.title}; the submitter stays, so their star stays too.`);
        if (!on.length && !submitted.length) problems.push(`${a.label} is not on any idea's team.`);
        continue;
      }
      if (!OPERATOR_STARS.includes(a.type)) {
        problems.push(a.type === 'Idea' ? `Ideas are not removed: close ${a.label} with its stage button.`
            : OWNED_ELSEWHERE[a.type]!(a.label));
        continue;
      }
      const n = ctx.graph.edges.filter((e) => e.from === a.id || e.to === a.id).length;
      proposals.push({ label: `Remove ${a.label} and its ${n} link${n === 1 ? '' : 's'}`, action: { t: 'remove_star', node: a.id } });
    } else if (s.op === 'grow') {
      const n = star(s.a); const idea = n ? ideaOf(n) : undefined;
      if (!n || !idea) { problems.push('Say which idea to grow, or open it first.'); continue; }
      proposals.push({ label: `Read ${idea.title} again with the AI and add the pain points, capabilities and systems it finds`, action: { t: 'grow', ideaId: idea.id } });
    } else if (s.op === 'merge') {
      const a = star(s.a); const b = star(s.b);
      if (!a || !b) { missing(s); continue; }
      if (a.id === b.id || a.type !== b.type || !MERGEABLE.includes(a.type)) { problems.push(`${a.label} and ${b.label} can't be merged: only two stars of the same kind (not ideas, rounds or the division) can.`); continue; }
      proposals.push({ label: `Merge ${a.label} into ${b.label} (its links move to ${b.label})`, action: { t: 'merge', from: a.id, into: b.id } });
    } else if (s.op === 'export') {
      const a = star(s.a); const idea = a ? ideaOf(a) : undefined;
      if (a && !idea) { problems.push(`${a.label} is not an idea: export the whole graph, or name an idea.`); continue; }
      proposals.push(idea
        ? { label: `Export ${idea.title} and what it touches as JSON-LD`, action: { t: 'export', ideaId: idea.id } }
        : { label: 'Export the whole graph as JSON-LD', action: { t: 'export' } });
    } else if (s.op === 'alias') {
      // Another name for a star: kept in the registry, so a label under that wording lands on this star from now on.
      const a = star(s.a); const name = s.name?.trim().replace(/\s+/g, ' ');
      if (!a || !name) { problems.push('Say which star, and the other name it goes by.'); continue; }
      if (a.type === 'Person' || a.type === 'Idea' || a.type === 'Round') { problems.push(`${a.label} comes from the form, so it has no aliases.`); continue; }
      const known = ctx.registry?.resolve(a.type, name) ?? ctx.graph.nodes.filter((n) => n.type === a.type).map((n) => ({ id: n.id, label: n.label })).find((n) => n.label.toLowerCase() === name.toLowerCase());
      if (known) { problems.push(known.id === a.id ? `${a.label} is already known as "${name}".` : `"${name}" is already a ${word(a.type)}: ${known.label}. Merge them instead.`); continue; }
      // A tool's other name must never be another product: "Copilot Studio is also UiPath" would make a retired or
      // unapproved tool look approved. The approved list is changed in rules/entities.yaml, not by an alias.
      if (a.type === 'Tool') {
        const other = KNOWN_UNAPPROVED_TOOLS.find((t) => nameKey(t) === nameKey(name)) ?? ctx.graph.nodes.find((n) => n.type === 'Tool' && n.id !== a.id && nameKey(n.label) === nameKey(name))?.label;
        if (other) { problems.push(`${other} is another tool, not on the approved list: it can't be another name of ${a.label}. Approved tools change in rules/entities.yaml.`); continue; }
      }
      proposals.push({ label: `Also know ${a.label} as "${name}"`, action: { t: 'alias', node: a.id, label: name, of: a.label } });
    }
  }
  // "Create the round X" next to "Create the round X and put … in it" says the same thing twice: keep the one that does both.
  const filling = new Set(proposals.flatMap((p) => (p.action.t === 'round' && p.action.newName ? [p.action.newName.toLowerCase()] : [])));
  return { proposals: proposals.filter((p) => !(p.action.t === 'new_round' && filling.has(p.action.name.toLowerCase()))), problems };
}

async function log(root: string, ideaId: string, clock: Clock, detail: string) {
  await appendHistory(await ideaDir(root, ideaId), { at: clock(), action: 'command', by: 'operator', detail });
}

/** Does one action. Returns how to take it back, when it can be. */
export async function applyAction(root: string, a: CommandAction, clock: Clock, ai?: Connector): Promise<{ inverse?: CommandInverse; note?: string }> {
  const edit = async (e: Record<string, unknown>) => {
    const id = await nextEditId(root);
    await appendEdit(root, { id, at: clock(), status: 'active', ...e } as never);
    return { inverse: { t: 'edit-off' as const, id } };
  };
  // Do it checks the link again, whatever card it came from (a proposal saved in the chat log is only data): the
  // ontology's pair, no derived relation and nothing only the form, the rounds or the tool picker state.
  const linkCheck = async (l: { from: string; rel: Relation; to: string }, born?: { node: string; type: NodeType }) => {
    const g = await rebuildGraph(root);
    const typeOf = (id: string) => (born && id === born.node ? born.type : g.nodes.find((n) => n.id === id)?.type);
    const bad = operatorLinkProblem(l.rel, typeOf(l.from), typeOf(l.to));
    if (bad) throw new Error(`Not done: ${bad}`);
  };
  switch (a.t) {
    case 'link': await linkCheck(a); return edit({ t: 'link', from: a.from, rel: a.rel, to: a.to, ...(a.idea ? { idea: a.idea } : {}) });
    case 'rename': return edit({ t: 'rename', node: a.node, label: a.label });
    case 'merge': { const r = await mergeStars(root, a.from, a.into, clock); return { inverse: { t: 'edits-off', ids: r.edits } }; }
    case 'alias': return edit({ t: 'alias', node: a.node, label: a.label, of: a.of });
    case 'export': {
      // A file written for the operator: nothing to undo, the card says where it is.
      const file = await writeExport(root, a.ideaId ? { kind: 'idea', id: a.ideaId } : { kind: 'all' }, clock);
      return { note: `Written to data/${dataKey(root, file)}` };
    }
    case 'remove_star': return edit({ t: 'remove', node: a.node });
    case 'grow': {
      if (!ai) throw new Error('No AI: growing an idea needs the AI helper');
      const r = await growIdea(root, ai, a.ideaId);
      const waiting = r.links.filter((l) => !l.confirmed).length;
      const fresh = r.suggestions.newNodes.length;
      return {
        inverse: { t: 'ai-links-off', edgeIds: r.links.map((l) => l.id) },
        note: r.links.length ? `${r.added} link${r.added === 1 ? '' : 's'} added${fresh ? `, ${fresh} new star${fresh === 1 ? '' : 's'}` : ''}${waiting ? `, ${waiting} waiting for you` : ''}` : 'Nothing new found',
      };
    }
    case 'add_star': {
      if (!OPERATOR_STARS.includes(a.type)) throw new Error(`Not done: ${a.type === 'Idea' ? 'an idea comes only from the form' : `a ${a.type} is not made from the command bar`}`);
      await linkCheck(a.link, { node: a.node, type: a.type });
      // The star and its link are two edits, done and undone together.
      const star = await edit({ t: 'add', node: a.node, type: a.type, label: a.label });
      const link = await edit({ t: 'link', ...a.link, ...(a.idea ? { idea: a.idea } : {}) });
      return { inverse: { t: 'edits-off', ids: [star.inverse.id, link.inverse.id] } };
    }
    case 'unlink': {
      // A derived link is the rules' to say: an unlink edit would hide it for nothing (it comes back), so it is refused.
      if (DERIVED_RELATIONS.includes(a.rel)) throw new Error(`${a.rel.toLowerCase().replace(/_/g, ' ')} is derived by the rules: remove one of the stored links it rests on instead`);
      // A link the operator added is switched off; anything else is hidden by an unlink edit, so the form and AI records stay as they were.
      if (isOperatorSource(a.source)) {
        const made = (await readEdits(root)).filter((e) => e.t === 'link' && e.status === 'active' && e.from === a.from && e.rel === a.rel && e.to === a.to);
        for (const e of made) await setEditStatus(root, e.id, 'undone');
        if (made.length) return { inverse: { t: 'edit-on', id: made[made.length - 1].id } };
      }
      return edit({ t: 'unlink', from: a.from, rel: a.rel, to: a.to });
    }
    case 'role': {
      const idea = await loadIdea(root, a.ideaId);
      const before = idea.people.team;
      const after: Person[] = a.role === null
        ? before.filter((p) => p.name.toLowerCase() !== a.person.toLowerCase())
        : a.drop ? withoutRole(before, a.person, a.role) : withAddedRole(before, a.person, a.role);
      await saveIdea(root, { ...idea, people: { ...idea.people, team: after } });
      await log(root, idea.id, clock, a.role === null ? `${a.person} taken off the team` : a.drop ? `${a.person} no longer ${a.role}` : `${a.person} set as ${a.role}`);
      return { inverse: { t: 'team', ideaId: idea.id, before, after } };
    }
    case 'round': {
      let roundId = a.roundId; let note: string | undefined;
      if (!roundId) {
        const existing = (await listRounds(root)).find((r) => r.name.toLowerCase() === a.newName!.toLowerCase());
        roundId = existing?.id ?? (await createRound(root, a.newName!, clock)).id;
        if (!existing) note = `Round ${a.newName} created`;
      }
      const before = await Promise.all(a.ideaIds.map(async (id) => ({ ideaId: id, round: (await loadIdea(root, id)).round })));
      await assignIdeas(root, roundId, a.ideaIds, clock);
      return { inverse: { t: 'rounds', roundId, before }, ...(note ? { note } : {}) };
    }
    case 'new_round': {
      await createRound(root, a.name, clock);
      return { note: 'A new round stays; rename it in the Rounds pop-out' };
    }
  }
}

/** Takes a done action back. Returns a note when part of it was kept because it changed since. */
export async function undoAction(root: string, inv: CommandInverse, clock: Clock): Promise<string | undefined> {
  if (inv.t === 'edit-off') { await setEditStatus(root, inv.id, 'undone'); return undefined; }
  if (inv.t === 'edit-on') { await setEditStatus(root, inv.id, 'active'); return undefined; }
  if (inv.t === 'edits-off') { for (const id of inv.ids) await setEditStatus(root, id, 'undone'); return undefined; }
  if (inv.t === 'ai-links-off') { for (const id of inv.edgeIds) await setAiLinkStatus(root, id, 'removed').catch(() => {}); return undefined; }
  if (inv.t === 'team') {
    const idea = await loadIdea(root, inv.ideaId);
    if (JSON.stringify(idea.people.team) !== JSON.stringify(inv.after)) return `Kept: ${idea.title}'s team changed since`;
    await saveIdea(root, { ...idea, people: { ...idea.people, team: inv.before } });
    await log(root, idea.id, clock, 'team change undone');
    return undefined;
  }
  const kept: string[] = [];
  for (const b of inv.before) {
    const idea = await loadIdea(root, b.ideaId);
    if (idea.round !== inv.roundId) { kept.push(idea.title); continue; }
    await setIdeaRound(root, b.ideaId, b.round, clock);
  }
  return kept.length ? `Kept: ${kept.join(', ')} changed round since` : undefined;
}
