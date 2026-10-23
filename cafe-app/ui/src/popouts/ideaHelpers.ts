// Pure helpers for the idea pop-out and the star card. No React here, so they test in node.
import { NODE_LABELS, type GEdge, type GNode } from '../../../src/graph/ontology';
import { emailChips, stageKey } from '../panels/filterIdeas';
import { STAGE_RING, ringColour } from '../universe/graphView';

/** Emails the operator can draft for one idea. */
export const IDEA_TEMPLATES = ['E1', 'E2', 'E2R', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'PD'];
export const TEMPLATE_TITLES: Record<string, string> = {
  E0: 'Call for ideas', E0B: 'Deadline reminder', E1: 'Idea received', E2: 'A few questions', E2R: 'Reminder about our questions',
  E3: 'Selected for the design series', E4: 'Reuse what exists', E5: 'Route to the CSIC Repository', E6: 'Not in this round',
  E7: 'Session invite', E8: 'Session follow-up', E9: 'Where your idea goes next', E10: 'Roadshow booked', E11: 'Feedback and decision',
  PD: 'Data held', RS: 'Session moved', SR: 'Session reminder',
};
const DECISION_SHORT: Record<string, string> = { select: 'Select', reuse: 'Reuse', csic: 'CSIC Repository', notnow: 'Not this round', ask: 'Ask first' };
/** The email each review decision drafts. */
export const DECISION_EMAIL: Record<string, string> = { select: 'E3', reuse: 'E4', csic: 'E5', notnow: 'E6', ask: 'E2' };

/** Paths in a history line shown by their last part only, so the line never says where the app keeps things. */
const baseNames = (s: unknown) => String(s ?? '').replace(/\S*[\\/](\S+)/g, '$1');

export interface HistoryEntry { at: string; action: string; by?: string; step?: string; detail?: string; source?: string }

/** One history entry in plain words. */
export function historyLine(h: HistoryEntry, steps: { id: string; text: string }[] = []): string {
  const step = (id?: string) => steps.find((s) => s.id === id)?.text ?? id ?? '';
  switch (h.action) {
    case 'created': return `Imported${h.source ? ` from ${String(h.source).split(/[\\/]/).pop()}` : ''}`;
    case 'tick': return `Step done: ${step(h.step)}`;
    case 'untick': return `Step undone: ${step(h.step)}`;
    case 'draft': return `${h.detail} drafted`;
    case 'replaced': return `${h.detail}`;
    case 'unsent': return `${h.detail} not sent after all (Undo)`;
    case 'sent': return `${h.detail} marked sent`;
    case 'review': {
      const [k, ...rest] = String(h.detail ?? '').split(': ');
      return `Reviewed: ${DECISION_SHORT[k] ?? k}${rest.length ? `. ${rest.join(': ')}` : ''}`;
    }
    case 'stage': {
      const detail = String(h.detail ?? '');
      // A stage put back by an undo in the Import has no arrow: it reads as written ("Undone in the Import").
      if (!detail.includes(' → ')) return detail || 'Stage changed';
      const to = detail.split(' → ').pop() ?? '';
      return to.startsWith('Closed · ') ? `Closed: ${to.slice('Closed · '.length)}` : `Moved to ${to}`;
    }
    case 'round': { const d = String(h.detail ?? ''); return d ? d[0].toUpperCase() + d.slice(1) : 'Round changed'; }
    case 'inbox': return `Import: ${baseNames(h.detail)}${h.source ? ` (from ${String(h.source).split(/[\\/]/).pop()})` : ''}`;
    case 'inbox-undo': return `Import: ${baseNames(h.detail)}`;
    // What the answers changed in the record, applied by the AI (older records: by the operator's Yes or Undo).
    case 'answers-update': case 'data-update': case 'review-update': return String(h.detail ?? 'Updated from the answers');
    case 'kit-cleanup': return String(h.detail ?? 'Kit files removed');
    default: return [h.action, h.detail].filter(Boolean).join(': ');
  }
}

export interface LinkRow {
  edge: GEdge;
  rel: string;
  /** Arrow from the node's side: out when the node is the link's "from". */
  out: boolean;
  other: { id: string; label: string; type: string; unapproved?: boolean };
  source: string;
  confidence: number;
  confirmed: boolean;
}

/** Every link touching a node, unconfirmed first, then by relation and the other node's label. */
export function nodeLinks(graph: { nodes: GNode[]; edges: GEdge[] } | null | undefined, nodeId: string): LinkRow[] {
  if (!graph) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.from === nodeId || e.to === nodeId)
    .map((e) => {
      const out = e.from === nodeId;
      const otherId = out ? e.to : e.from;
      const n = byId.get(otherId);
      return {
        edge: e, rel: e.rel, out,
        other: { id: otherId, label: n?.label ?? otherId, type: n ? NODE_LABELS[n.type] ?? n.type : '', ...(n?.type === 'Tool' && n.attrs?.approved === false ? { unapproved: true } : {}) },
        source: e.source, confidence: e.confidence, confirmed: e.confirmed,
      };
    })
    .sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.rel.localeCompare(b.rel) || a.other.label.localeCompare(b.other.label));
}

/** This idea's links. Node ids for ideas are `idea:<Café ID>`. */
export const ideaLinks = (graph: Parameters<typeof nodeLinks>[0], cafeId: string) => nodeLinks(graph, `idea:${cafeId}`);

export const confidenceText = (c: number) => `${Math.round(c * 100)}%`;

/** The idea id behind a star, or null for any other star. */
export const cafeIdOf = (nodeId: string | null | undefined) => (nodeId?.startsWith('idea:') ? nodeId.slice(5) : null);


export interface IdeaCardModel { id: string; title: string; stageLabel: string; stageColour: string; where: string; emails: string[]; late: string | null; linkCount: number }

/** What the floating card for a selected idea star shows. */
export function ideaCardModel(idea: any, graph: { nodes: GNode[]; edges: GEdge[] } | null | undefined, outbox: any[] = [], ring: Record<string, string> = STAGE_RING): IdeaCardModel {
  const node: any = graph?.nodes.find((n) => n.id === `idea:${idea.id}`);
  // A closed idea says how it closed, in words (the graph has them; else the closure's own name, never the record).
  const closedWord = idea.closed ? String(node?.attrs?.closed || (typeof idea.closed === 'object' ? idea.closed.as : idea.closed)) : '';
  const stageLabel = idea.closed ? `Closed · ${closedWord}` : String(node?.attrs?.stageLabel ?? '');
  const stageColour = idea.closed ? ring.closed : node ? ringColour(node as any, ring) : ring[stageKey(idea)] ?? ring[2];
  const nodeId = `idea:${idea.id}`;
  return {
    id: idea.id,
    title: idea.title ?? '',
    stageLabel, stageColour,
    where: [idea.function, idea.region].filter(Boolean).join(' · ') || '—',
    emails: emailChips(idea, outbox),
    late: !idea.closed && idea.overdue?.[0]?.text ? String(idea.overdue[0].text) : null,
    linkCount: (graph?.edges ?? []).filter((e) => e.from === nodeId || e.to === nodeId).length,
  };
}
