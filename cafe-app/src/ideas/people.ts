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
    team = addPerson(team, { name, roles: roles.length ? roles : ['member'], ...(typeof p.note === 'string' && p.note ? { note: p.note } : {}) });
  }
  if (typeof r.builder === 'string' && r.builder.trim()) team = withRole(team, r.builder.trim(), 'builder');
  const { builder: _old, ...rest } = r;
  return { ...(rest as object), ...(typeof r.submitter === 'string' ? { submitter: r.submitter } : {}), team };
}

/** Add someone, or give an entry already there for the same name the new roles too (notes are joined). */
export function addPerson(team: Person[], p: Person): Person[] {
  const i = team.findIndex((x) => sameName(x.name, p.name));
  if (i < 0) return [...team, { ...p, roles: cleanRoles(p.roles) }];
  const have = team[i];
  const note = [have.note, p.note].filter(Boolean).filter((n, k, all) => all.indexOf(n) === k).join('; ');
  return team.map((x, k) => (k === i ? { ...have, roles: cleanRoles([...have.roles, ...p.roles]), ...(note ? { note } : {}) } : x));
}

/** Give someone a role (adding them to the team when they are not on it). */
export const withRole = (team: Person[], name: string, role: PersonRole): Person[] => addPerson(team, { name, roles: [role] });

/** Take one role off someone; a person left with none stays on the team as a member. */
export function withoutRole(team: Person[], name: string, role: PersonRole): Person[] {
  return team.map((p) => (sameName(p.name, name) ? { ...p, roles: cleanRoles(p.roles.filter((r) => r !== role)) } : p));
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
