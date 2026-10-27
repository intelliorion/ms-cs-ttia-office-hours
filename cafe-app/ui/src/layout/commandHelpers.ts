export interface ChatActionView {
  id: string; label: string; status: 'proposed' | 'done' | 'cancelled' | 'undone' | 'failed'; note?: string; inverse?: unknown;
}
export interface ChatEntryView {
  id: string; at: string; text: string; reply: string; actions: ChatActionView[]; problems: string[]; error?: string;
  kind?: 'command' | 'question' | 'unclear'; highlight?: string[]; about?: string; trace?: { text: string; size: number }[][];
  thread?: string; steps?: { kind: 'search' | 'read'; text: string; found?: number }[]; followups?: string[];
  /** On the reply to a Do or an Undo only: what it changed in the graph, and one line saying so. */
  changed?: { nodes: string[]; edges: string[]; note: string };
}

export const STATUS_WORD: Record<ChatActionView['status'], string> = {
  proposed: 'Waiting for you', done: 'Done', cancelled: 'Cancelled', undone: 'Undone', failed: 'Failed',
};
/** How the agent read the message, shown above its answer. */
export const KIND_WORD = { command: 'A change', question: 'A question', unclear: 'Not sure what you meant' } as const;

export const canUndo = (a: ChatActionView) => a.status === 'done' && !!a.inverse;
export const waitingCount = (entries: ChatEntryView[]) => entries.reduce((n, e) => n + e.actions.filter((a) => a.status === 'proposed').length, 0);
/**
 * What the universe lights once a message is answered: the stars the answer rests on, or null to leave the picture as the
 * operator left it (no answer, no graph evidence, an error, or changes waiting for Do it).
 */
export function answerLight(e: ChatEntryView | null | undefined): string[] | null {
  if (!e || e.error || !e.highlight?.length) return null;
  if (e.actions.some((a) => a.status === 'proposed')) return null;
  return e.highlight;
}

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
const RANK: Record<string, number> = { Idea: 0, Team: 1, Person: 2, Capability: 3, PainPoint: 4, System: 5, Support: 6, Outcome: 6, Beneficiary: 6, Category: 6, Round: 7, Tool: 8, Entity: 9 };

/** Stars whose name (or Café ID) contains the query: names starting with it first, then ideas, teams and people before the rest. */
export function searchStars(nodes: { id: string; type: string; label: string; attrs?: Record<string, unknown> }[], query: string, limit = 8): StarHit[] {
  // "@idea:desk", "@person:", "@team:gss": narrow to one kind first.
  const kind = /^(idea|person|team|capability|pain|system|support|round|tool|division):(.*)$/i.exec(query.trim());
  if (kind) {
    const type = KIND_OF[kind[1].toLowerCase()];
    return searchStars(nodes.filter((n) => n.type === type), kind[2], limit);
  }
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

const KIND_OF: Record<string, string> = {
  idea: 'Idea', person: 'Person', team: 'Team', capability: 'Capability', pain: 'PainPoint', system: 'System', support: 'Support', outcome: 'Outcome', beneficiary: 'Beneficiary', category: 'Category', round: 'Round', tool: 'Tool', division: 'Entity',
};

/** The / shortcuts: what each does, shown as you type "/". */
export const SLASH = [
  { cmd: '/new', hint: 'Start a new chat' },
  { cmd: '/grow', hint: 'Read the idea on screen again and add what it finds' },
  { cmd: '/undo', hint: 'Undo the last change in this chat' },
  { cmd: '/import', hint: 'Open the Import' },
  { cmd: '/rounds', hint: 'Open Rounds' },
] as const;
export type SlashCmd = (typeof SLASH)[number]['cmd'];
/** The shortcuts matching what is typed, while the message is a bare "/word". */
export const slashMatches = (text: string) => (/^\/\w*$/.test(text) ? SLASH.filter((s) => s.cmd.startsWith(text.toLowerCase())) : []);

export type Segment = string | { id: string; label: string };
const QUOTES: Record<string, string> = { "'": "'", '"': '"', '\u2018': '\u2019', '\u201c': '\u201d' };
/**
 * The text cut into plain runs and star names (longest names first, whole words only), so the names can show as chips.
 * A name in quotes stays text: it is a name being said (a star to add), and a chip would pad the quotes apart.
 * With mentionsOnly, only names typed with @ are chips: the operator's message as it was sent, whatever became a star since.
 */
export function chipSegments(text: string, stars: { id: string; label: string }[], mentionsOnly = false): Segment[] {
  const found: { start: number; end: number; id: string; label: string }[] = [];
  const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (const s of [...stars].filter((x) => x.label.length >= 3).sort((a, b) => b.label.length - a.label.length)) {
    for (let i = text.indexOf(s.label); i !== -1; i = text.indexOf(s.label, i + 1)) {
      const end = i + s.label.length;
      if (word(text[i - 1]) || word(text[end])) continue;
      if (mentionsOnly ? text[i - 1] !== '@' : !!QUOTES[text[i - 1]] && QUOTES[text[i - 1]] === text[end]) continue;
      if (found.some((f) => i < f.end && end > f.start)) continue;
      found.push({ start: i, end, id: s.id, label: s.label });
    }
  }
  found.sort((a, b) => a.start - b.start);
  const out: Segment[] = []; let at = 0;
  for (const f of found) { if (f.start > at) out.push(text.slice(at, f.start)); out.push({ id: f.id, label: f.label }); at = f.end; }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** The operator's message as it was sent: only the stars picked with @ are chips. */
export const sentSegments = (text: string, stars: { id: string; label: string }[]): Segment[] => chipSegments(text, stars, true);

/** What to offer on an empty chat, from what is on screen and what is waiting. */
export function suggestionsFor(ctx: { focusType?: string; waiting?: number }): string[] {
  if (ctx.focusType === 'Idea') return ['Who leads this?', 'Grow it', 'Which ideas share a capability with this one?', 'What does this idea say about its current process?'];
  if (ctx.focusType) return ['Which ideas are linked to this?', 'What is related to this?', 'Which of those are in GSS?', 'Rename this to …'];
  return [
    ...(ctx.waiting ? ['What is waiting for me in the Import?'] : []),
    'Which capability is needed by the most ideas?', 'Which pain points come up in more than one idea?', 'How many ideas does each function have, by stage?', 'Put the policy bots in a new round called 2026 Q4',
  ].slice(0, 4);
}

/**
 * The "＋ New person" choice in the @ list: offered for a full name (two words or more, letters only) that matches no
 * person in the graph. Picking it marks the name as a person, so it is coded before the AI sees it.
 */
export function newPersonHit(nodes: { type: string; label: string }[], query: string): StarHit | null {
  const name = query.trim().replace(/\s+/g, ' ');
  if (name.includes(':') || name.split(' ').length < 2 || name.split(' ').length > 4 || !/^[\p{L}' .-]+$/u.test(name)) return null;
  if (nodes.some((n) => n.type === 'Person' && n.label.toLowerCase() === name.toLowerCase())) return null;
  return { id: `new-person:${name}`, type: 'Person', label: name };
}
