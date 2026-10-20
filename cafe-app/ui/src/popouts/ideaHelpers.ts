// Pure helpers for the idea pop-out and the star card. No React here, so they test in node.
import { NODE_LABELS, type GEdge, type GNode } from '../../../src/graph/ontology';
import { shortDate } from '../panels/filterIdeas';
import { ApiError, copyText, post } from '../api';

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

export type EmailActionKind = 'approve' | 'set-first' | 'sent' | 'none';
export interface EmailAction { label: string; enabled: boolean; kind: EmailActionKind }

/** The one main action an Outbox item offers. `missing` are the labels of settings still to set. */
export function emailAction(
  item: { status: string; sentAt?: string; missingSettings?: { label: string }[] },
  missing: string[] = (item.missingSettings ?? []).map((m) => m.label),
): EmailAction {
  if (item.status === 'draft') {
    return missing.length
      ? { label: `Set first: ${missing.join(', ')}`, enabled: true, kind: 'set-first' }
      : { label: 'Approve and copy', enabled: true, kind: 'approve' };
  }
  if (item.status === 'approved') return { label: 'Mark as sent', enabled: true, kind: 'sent' };
  return { label: item.sentAt ? `Sent ${shortDate(item.sentAt)}` : 'Sent', enabled: false, kind: 'none' };
}

/** Status chip wording for an Outbox item. */
export const emailStatus = (status: string) =>
  status === 'draft' ? 'Draft' : status === 'approved' ? 'Approved' : 'Sent';

/** What goes on the clipboard when an email is approved. */
export const clipText = (m: { subject: string; body: string }) => `Subject: ${m.subject}\n\n${m.body}`;

export const APPROVED_NOTICE = (template: string) => `${template} approved and copied. Paste it into Outlook, send it, then mark it as sent.`;

/**
 * Approves one Outbox item and puts "Subject: ...\n\n<body>" on the clipboard.
 * Returns the approved item; `fallback` is the text to show selected when the browser refused to copy.
 * Missing settings become "Set first: ..." so the operator knows to open Round.
 */
export async function approveAndCopy(
  key: string,
  api: { post: typeof post; copyText: typeof copyText } = { post, copyText },
): Promise<{ item: any; fallback: string | null }> {
  try {
    const item = await api.post('/api/outbox/approve', { key });
    const text = clipText(item);
    return { item, fallback: (await api.copyText(text)) ? null : text };
  } catch (e) {
    if (e instanceof ApiError && e.missing?.length) throw new ApiError(`Set first: ${e.missing.join(', ')}. Open Round to fill them in.`);
    throw e;
  }
}

export interface HistoryEntry { at: string; action: string; by?: string; step?: string; detail?: string; source?: string }

/** One history entry in plain words. */
export function historyLine(h: HistoryEntry, steps: { id: string; text: string }[] = []): string {
  const step = (id?: string) => steps.find((s) => s.id === id)?.text ?? id ?? '';
  switch (h.action) {
    case 'created': return `Imported${h.source ? ` from ${String(h.source).split(/[\\/]/).pop()}` : ''}`;
    case 'tick': return `Step done: ${step(h.step)}`;
    case 'untick': return `Step undone: ${step(h.step)}`;
    case 'draft': return `${h.detail} drafted in the Outbox`;
    case 'sent': return `${h.detail} marked sent`;
    case 'review': {
      const [k, ...rest] = String(h.detail ?? '').split(': ');
      return `Reviewed: ${DECISION_SHORT[k] ?? k}${rest.length ? `. ${rest.join(': ')}` : ''}`;
    }
    case 'stage': {
      const to = String(h.detail ?? '').split(' → ').pop() ?? '';
      return to.startsWith('Closed · ') ? `Closed: ${to.slice('Closed · '.length)}` : `Moved to ${to}`;
    }
    default: return [h.action, h.detail].filter(Boolean).join(': ');
  }
}

export interface LinkRow {
  edge: GEdge;
  rel: string;
  /** Arrow from the node's side: out when the node is the link's "from". */
  out: boolean;
  other: { id: string; label: string; type: string };
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
        other: { id: otherId, label: n?.label ?? otherId, type: n ? NODE_LABELS[n.type] ?? n.type : '' },
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

/** Identity of the saved review a form was filled from: the idea and when its review was saved. */
export const reviewKey = (idea: { id: string; review?: { at?: string } | null }) => `${idea.id}|${idea.review?.at ?? ''}`;
/** The review form resets only when its idea or the saved review changes, never on a plain refresh. */
export const shouldResetReview = (prevKey: string | null, nextKey: string) => prevKey !== nextKey;
