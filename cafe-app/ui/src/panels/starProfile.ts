import { NODE_LABELS, NODE_DESCRIPTIONS } from '../../../src/graph/ontology';

/** What each kind of star is, in a line: the ontology's descriptions (rules/ontology.yaml). */
export const STAR_ABOUT: Record<string, string> = NODE_DESCRIPTIONS;
const ROLE_WORD: Record<string, string> = { submitter: 'Submitter', lead: 'Lead', sponsor: 'Sponsor', builder: 'Builder', member: 'Member' };

export interface StarProfile {
  id: string; type: string; kind: string; label: string; about: string;
  facts: [string, string][];
  /** A person: what they are on each idea. */
  roles: { ideaId: string; title: string; roles: string[] }[];
  /** Every other star it links to (not ideas: those are on the right), grouped by kind. */
  groups: { kind: string; type: string; items: { id: string; label: string; rel: string }[] }[];
}

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** The left panel's view of a star that is not an idea: what it is, its facts, and what it connects to. */
export function starProfile(graph: { nodes: any[]; edges: any[] } | null | undefined, state: any, id: string): StarProfile | null {
  const node = graph?.nodes.find((n) => n.id === id);
  if (!node || node.type === 'Idea') return null;
  const nodes = new Map(graph!.nodes.map((n) => [n.id, n]));
  // The stated links: what a rule derived is left out of the counts and the groups.
  const links = graph!.edges.filter((e) => (e.from === id || e.to === id) && !e.derived);
  const ideaIds = new Set(links.map((e) => (e.from === id ? e.to : e.from)).filter((x) => nodes.get(x)?.type === 'Idea'));

  const facts: [string, string][] = [];
  if (node.type === 'Round') {
    const round = (state?.rounds ?? []).find((r: any) => r.id === node.attrs?.roundId);
    for (const [k, label] of (state?.fields?.round ?? []) as [string, string][]) facts.push([label, round?.[k] || 'Not set']);
  }
  if (node.type === 'Tool' && node.attrs?.approved !== undefined) facts.push(['On the approved list', node.attrs.approved === false ? 'No' : 'Yes']);
  // The registry's other names for it (rules/entities.yaml and merges), and its reference, when it has them.
  if (node.attrs?.aliases) facts.push(['Also known as', String(node.attrs.aliases)]);
  if (node.attrs?.ref) facts.push(['Reference', String(node.attrs.ref)]);
  facts.push(['Ideas', String(ideaIds.size)], ['Links', String(links.length)]);

  const roles = node.type !== 'Person' ? [] : (state?.ideas ?? []).flatMap((i: any) => {
    const r = [
      ...(same(i.people?.submitter, node.label) ? ['submitter'] : []),
      ...((i.people?.team ?? []).find((p: any) => same(p.name, node.label))?.roles ?? []).filter((x: string) => x !== 'member' || !same(i.people?.submitter, node.label)),
    ];
    return r.length ? [{ ideaId: i.id, title: i.title || 'Untitled idea', roles: r.map((x: string) => ROLE_WORD[x] ?? x) }] : [];
  });

  const byType = new Map<string, { id: string; label: string; rel: string }[]>();
  for (const e of links) {
    const other = nodes.get(e.from === id ? e.to : e.from);
    if (!other || other.type === 'Idea') continue;
    const list = byType.get(other.type) ?? [];
    if (!list.some((x) => x.id === other.id)) list.push({ id: other.id, label: other.label, rel: e.rel });
    byType.set(other.type, list);
  }
  const groups = [...byType].map(([type, items]) => ({ type, kind: (NODE_LABELS as Record<string, string>)[type] ?? type, items: items.sort((a, b) => a.label.localeCompare(b.label)) }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  return {
    id, type: node.type, kind: (NODE_LABELS as Record<string, string>)[node.type] ?? node.type, label: node.label,
    about: STAR_ABOUT[node.type] ?? '', facts, roles, groups,
  };
}
