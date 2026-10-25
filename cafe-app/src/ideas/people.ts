import type { Idea, Person, PersonRole } from './idea';

/** The order roles are shown and linked in. */
export const ROLE_ORDER: PersonRole[] = ['lead', 'sponsor', 'builder', 'member'];
const isRole = (r: unknown): r is PersonRole => typeof r === 'string' && (ROLE_ORDER as string[]).includes(r);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Roles in the usual order, each once; "member" only when there is no other role. */
export function cleanRoles(roles: readonly PersonRole[]): PersonRole[] {
  const set = new Set(roles.filter(isRole));
  if (set.size > 1) set.delete('member');
  return set.size ? ROLE_ORDER.filter((r) => set.has(r)) : ['member'];
}

/**
 * The idea's people as stored now: one entry per person with every role they have. Older records (one `role` per
 * entry, the same person listed twice, a separate `builder` field) come in the same shape.
 */
export function normalizePeople(raw: unknown): Idea['people'] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { submitter?: unknown; team?: unknown; builder?: unknown };
  let team: Person[] = [];
  for (const p of Array.isArray(r.team) ? r.team : []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name) continue;
    const roles = [...(Array.isArray(p.roles) ? p.roles : []), ...(isRole(p.role) ? [p.role] : [])] as PersonRole[];
    team = addPerson(team, {
      name, roles: roles.length ? roles : ['member'], ...(typeof p.note === 'string' && p.note ? { note: p.note } : {}),
      ...(Array.isArray(p.added) ? { added: p.added.filter(isRole) } : {}), ...(p.joined === true ? { joined: true } : {}),
    });
  }
  // The old builder field never came from the form.
  if (typeof r.builder === 'string' && r.builder.trim()) team = withAddedRole(team, r.builder.trim(), 'builder');
  const { builder: _old, ...rest } = r;
  return { ...(rest as object), ...(typeof r.submitter === 'string' ? { submitter: r.submitter } : {}), team };
}

/** Add someone, or give an entry already there for the same name the new roles too (notes are joined). */
export function addPerson(team: Person[], p: Person): Person[] {
  const i = team.findIndex((x) => sameName(x.name, p.name));
  if (i < 0) return [...team, tidy({ ...p, roles: cleanRoles(p.roles) })];
  const have = team[i];
  const note = [have.note, p.note].filter(Boolean).filter((n, k, all) => all.indexOf(n) === k).join('; ');
  const added = [...(have.added ?? []), ...(p.added ?? [])];
  return team.map((x, k) => (k === i ? tidy({ ...have, roles: cleanRoles([...have.roles, ...p.roles]), ...(note ? { note } : {}), ...(added.length ? { added } : {}) }) : x));
}

/** `added` holds only roles the person has, each once; nothing empty is kept. */
function tidy(p: Person): Person {
  const added = [...new Set(p.added ?? [])].filter((r) => p.roles.includes(r));
  const { added: _a, joined, ...rest } = p;
  return { ...rest, ...(added.length ? { added } : {}), ...(joined ? { joined } : {}) };
}

/** Give someone a role (adding them to the team when they are not on it). */
export const withRole = (team: Person[], name: string, role: PersonRole): Person[] => addPerson(team, { name, roles: [role] });

/**
 * Give someone a role after the form (an answer, an email, the assistant): marked as added, and the person as joined
 * when the form did not list them, so the Submission can show what was not submitted.
 */
export function withAddedRole(team: Person[], name: string, role: PersonRole): Person[] {
  const was = team.find((p) => sameName(p.name, name));
  if (was?.roles.includes(role)) return team;
  return addPerson(team, { name, roles: [role], added: [role], ...(was ? {} : { joined: true }) });
}

/** Take one role off someone; a person left with none stays on the team as a member. */
export function withoutRole(team: Person[], name: string, role: PersonRole): Person[] {
  return team.map((p) => (sameName(p.name, name) ? tidy({ ...p, roles: cleanRoles(p.roles.filter((r) => r !== role)) }) : p));
}

export const personOn = (idea: Idea, name: string): Person | undefined => idea.people.team.find((p) => sameName(p.name, name));
export const hasRole = (p: Person | undefined, role: PersonRole): boolean => !!p?.roles.includes(role);
export const withRoleOn = (idea: Idea, role: PersonRole): Person[] => idea.people.team.filter((p) => p.roles.includes(role));

/** The builder (the first, if the team names more than one). */
export const builderOf = (idea: Idea): string | undefined => withRoleOn(idea, 'builder')[0]?.name;

/** "lead and builder": a person's roles in words. */
export function rolesText(roles: readonly PersonRole[]): string {
  const words = cleanRoles(roles).map((r) => (r === 'member' ? 'team member' : r));
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];
}

/** A name to compare: no accents, no case, no punctuation. "Wiśniewski" and "wisniewski" are the same. */
export const plainName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
  .toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
/** How alike two words are, 0 to 1. */
const alike = (a: string, b: string) => 1 - distance(a, b) / Math.max(a.length, b.length, 1);

/**
 * The known person a typed or AI-written name means, when exactly one fits: the same name (accents and case aside),
 * a name that holds a known person's full name ("Tomasz Wiśniewski Viseiewki"), or the same first name with a close
 * surname ("Tomasz Viseiewki" for "Tomasz Wiśniewski"). Undefined when none fits, or more than one does.
 */
export function matchPerson(name: string, known: readonly string[]): string | undefined {
  const n = plainName(name); const words = n.split(' ');
  const people = [...new Set(known.filter((k) => k.trim()))];
  const pick = (test: (k: string[], kn: string) => boolean) => {
    const hits = people.filter((k) => { const kn = plainName(k); return test(kn.split(' '), kn); });
    return hits.length === 1 ? hits[0] : undefined;
  };
  return pick((_, kn) => kn === n)
    ?? pick((k) => k.length >= 2 && k.every((w) => words.includes(w)))
    ?? pick((k) => k.length >= 2 && words.length >= 2 && k[0] === words[0] && alike(k[k.length - 1], words[words.length - 1]) >= 0.6);
}

/**
 * People appear by role in anything shared: every name the idea holds (the submitter and the team) becomes its role
 * ("the builder", "the lead and builder", "the submitter"), wherever the design's own words or the AI's put it.
 */
export function peopleByRole(idea: Idea): (text: string) => string {
  const people = [
    ...idea.people.team.map((p) => ({ name: p.name.trim(), role: `the ${rolesText(p.roles)}` })),
    ...(idea.people.submitter?.trim() && !idea.people.team.some((p) => p.name.trim().toLowerCase() === idea.people.submitter!.trim().toLowerCase())
      ? [{ name: idea.people.submitter.trim(), role: 'the submitter' }] : []),
  ].filter((p) => p.name.length > 1).sort((a, b) => b.name.length - a.name.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = people.map((p) => ({ re: new RegExp(`(?<![\\p{L}\\p{N}])${esc(p.name)}(?![\\p{L}\\p{N}])`, 'giu'), role: p.role }));
  return (text: string) => rules.reduce((t, r) => t.replace(r.re, r.role), text);
}
