export interface ChatActionView {
  id: string; label: string; status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed'; note?: string; inverse?: unknown;
}
export interface ChatEntryView {
  id: string; at: string; text: string; reply: string; actions: ChatActionView[]; problems: string[]; error?: string;
  kind?: 'command' | 'question' | 'unclear'; highlight?: string[]; about?: string; trace?: { text: string; size: number }[][];
}

export const STATUS_WORD: Record<ChatActionView['status'], string> = {
  proposed: 'Waiting for you', done: 'Done', cancelled: 'Cancelled', undone: 'Undone', failed: 'Failed',
};
/** How the agent read the message, shown above its answer. */
export const KIND_WORD = { command: 'A change', question: 'A question', unclear: 'Not sure what you meant' } as const;

export const canUndo = (a: ChatActionView) => a.status === 'done' && !!a.inverse;
export const waitingCount = (entries: ChatEntryView[]) => entries.reduce((n, e) => n + e.actions.filter((a) => a.status === 'proposed').length, 0);

/** Ideas for the empty panel: what the command bar can do today. */
export const EXAMPLES = [
  'Link Avery Chen to BSI',
  'Make Zainab Okafor sponsor of the procurement FAQ bot',
  'Put the travel and procurement bots in round 2026 Q4',
  'Add a capability Contract clause finding to the vendor contract summariser',
  'Open an idea, then: grow it',
  'Type @ to pick a star: who works on @GSS ideas?',
  'Remove the star Shared mailbox',
  'Which ideas need a policy Q&A capability?',
  'Highlight what is related to GSS',
];

/** The "@query" being typed just before the caret, if any: where it starts and what has been typed after @. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1 || (at > 0 && /[\p{L}\p{N}]/u.test(before[at - 1]))) return null; // "name@host" is not a mention
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query)) return null;
  return { start: at, query };
}

export interface StarHit { id: string; type: string; label: string }
const RANK: Record<string, number> = { Idea: 0, Team: 1, Person: 2, Capability: 3, PainPoint: 4, System: 5, Support: 6, Round: 7, Tool: 8, Entity: 9 };

/** Stars whose name (or Café ID) contains the query: names starting with it first, then ideas, teams and people before the rest. */
export function searchStars(nodes: { id: string; type: string; label: string; attrs?: Record<string, unknown> }[], query: string, limit = 8): StarHit[] {
  const q = query.trim().toLowerCase();
  const score = (n: (typeof nodes)[number]) => {
    const l = n.label.toLowerCase(); const cafe = String(n.attrs?.cafeId ?? '').toLowerCase();
    if (!q) return 1;
    if (l.startsWith(q) || cafe.startsWith(q)) return 0;
    if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    return l.includes(q) || cafe.includes(q) ? 2 : -1;
  };
  return nodes.map((n) => ({ n, s: score(n) })).filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || (RANK[a.n.type] ?? 9) - (RANK[b.n.type] ?? 9) || a.n.label.localeCompare(b.n.label))
    .slice(0, limit).map(({ n }) => ({ id: n.id, type: n.type, label: n.label }));
}

/** Puts "@Label " in place of the "@query" being typed; returns the new text and where the caret goes. */
export function insertMention(text: string, start: number, caret: number, label: string): { text: string; caret: number } {
  const piece = `@${label} `;
  return { text: text.slice(0, start) + piece + text.slice(caret).replace(/^ /, ''), caret: start + piece.length };
}
