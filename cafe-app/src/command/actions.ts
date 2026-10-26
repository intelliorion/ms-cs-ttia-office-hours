import { ALLOWED, MERGEABLE, NODE_LABELS, OPERATOR_STARS, edgeId, nodeId, type GEdge, type GNode, type NodeType, type Relation } from '../graph/ontology';
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
import { mergeStars, setAiLinkStatus } from '../graph/store';
import type { Registry } from '../graph/registry';

/** What the app will do for one step of a command, once the operator says "Do it". */

/** "An idea and a system or data can't be linked that way.": the kinds in words, each with its article. */
export function cantLink(a: NodeType, b: NodeType): string {
  const kind = (t: NodeType) => { const w = NODE_LABELS[t].toLowerCase(); return `${/^[aeiou]/.test(w) ? 'an' : 'a'} ${w}`; };
  const both = `${kind(a)} and ${kind(b)}`;
  return `${both[0].toUpperCase()}${both.slice(1)} can't be linked that way.`;
}

export type CommandAction =
  | { t: 'link'; from: string; rel: Relation; to: string }
  | { t: 'unlink'; from: string; rel: Relation; to: string; source: string }
  | { t: 'role'; ideaId: string; person: string; role: PersonRole | null; drop?: boolean }
  | { t: 'round'; ideaIds: string[]; roundId?: string; newName?: string }
  | { t: 'new_round'; name: string }
  | { t: 'rename'; node: string; label: string }
  | { t: 'merge'; from: string; into: string }
  | { t: 'alias'; node: string; label: string; of: string }
  | { t: 'add_star'; node: string; type: NodeType; label: string; link: { from: string; rel: Relation; to: string } }
  | { t: 'remove_star'; node: string }
  | { t: 'grow'; ideaId: string };

/** How to take a done action back. */
export type CommandInverse =
  | { t: 'edit-off'; id: string }
  | { t: 'edit-on'; id: string }
  | { t: 'edits-off'; ids: string[] }
  | { t: 'ai-links-off'; edgeIds: string[] }
  | { t: 'team'; ideaId: string; before: Person[]; after: Person[] }
  | { t: 'rounds'; roundId: string; before: { ideaId: string; round: string }[] };

export interface Proposal { label: string; action: CommandAction }

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
      const choices = (s.rel ? [s.rel] : (Object.keys(ALLOWED) as Relation[])).filter(fits);
      if (choices.includes('BUILT_WITH')) { problems.push('Tools are picked in the tool picker, so I left that link out.'); continue; }
      const rel = choices.filter((r) => r !== 'IN_ROUND')[0];
      if (!rel) { problems.push(cantLink(a.type, b.type)); continue; }
      const [ft] = ALLOWED[rel];
      const [from, to] = a.type === ft ? [a, b] : [b, a];
      if (ctx.graph.edges.some((e) => e.id === edgeId(from.id, rel, to.id))) { problems.push(`${from.label} and ${to.label} are already linked.`); continue; }
      proposals.push({ label: `Link ${from.label} → ${to.label}${REL_WORD[rel] ? ` (${REL_WORD[rel]})` : ''}`, action: { t: 'link', from: from.id, rel, to: to.id } });
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
      const home = star(s.b);
      if (!home) { problems.push(`Say which idea or star ${name} belongs to, so it is not left floating.`); continue; }
      const hit = ctx.registry?.resolve(type, name);
      const same = ctx.graph.nodes.find((n) => n.label.toLowerCase() === name.toLowerCase()) ?? (hit ? nodes.get(hit.id) : undefined);
      if (same) { problems.push(`${same.label} is already a star${hit && same.label.toLowerCase() !== name.toLowerCase() ? ` (known as "${name}")` : ''}: ask me to link it to ${home.label} instead.`); continue; }
      const rel = (Object.keys(ALLOWED) as Relation[]).find((r) => { const [f, t] = ALLOWED[r]; return (f === home.type && t === type) || (f === type && t === home.type); });
      if (!rel) {
        problems.push(type === 'System' && home.type === 'Idea'
          ? `A system links to a capability, not to an idea: say which capability uses ${name}.`
          : `A ${word(type)} can't be linked to a ${word(home.type)}.`);
        continue;
      }
      // A name the registry knows but no star carries yet is born with its registered id and label.
      const node = hit?.id ?? nodeId(type, name);
      const label = hit?.label ?? name;
      const [from, to] = ALLOWED[rel][0] === home.type ? [home.id, node] : [node, home.id];
      const dir = from === home.id ? `linked from ${home.label}` : `linked to ${home.label}`;
      proposals.push({ label: `New ${word(type)}: ${label}, ${dir}${REL_WORD[rel] ? ` (${REL_WORD[rel]})` : ''}`, action: { t: 'add_star', node, type, label, link: { from, rel, to } } });
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
    } else if (s.op === 'alias') {
      // Another name for a star: kept in the registry, so a label under that wording lands on this star from now on.
      const a = star(s.a); const name = s.name?.trim().replace(/\s+/g, ' ');
      if (!a || !name) { problems.push('Say which star, and the other name it goes by.'); continue; }
      if (a.type === 'Person' || a.type === 'Idea' || a.type === 'Round') { problems.push(`${a.label} comes from the form, so it has no aliases.`); continue; }
      const known = ctx.registry?.resolve(a.type, name) ?? ctx.graph.nodes.filter((n) => n.type === a.type).map((n) => ({ id: n.id, label: n.label })).find((n) => n.label.toLowerCase() === name.toLowerCase());
      if (known) { problems.push(known.id === a.id ? `${a.label} is already known as "${name}".` : `"${name}" is already a ${word(a.type)}: ${known.label}. Merge them instead.`); continue; }
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
  switch (a.t) {
    case 'link': return edit({ t: 'link', from: a.from, rel: a.rel, to: a.to });
    case 'rename': return edit({ t: 'rename', node: a.node, label: a.label });
    case 'merge': { const r = await mergeStars(root, a.from, a.into, clock); return { inverse: { t: 'edits-off', ids: r.edits } }; }
    case 'alias': return edit({ t: 'alias', node: a.node, label: a.label, of: a.of });
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
      // The star and its link are two edits, done and undone together.
      const star = await edit({ t: 'add', node: a.node, type: a.type, label: a.label });
      const link = await edit({ t: 'link', ...a.link });
      return { inverse: { t: 'edits-off', ids: [star.inverse.id, link.inverse.id] } };
    }
    case 'unlink': {
      // A link the operator added is switched off; anything else is hidden by an unlink edit, so the form and AI records stay as they were.
      if (a.source === 'operator') {
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
