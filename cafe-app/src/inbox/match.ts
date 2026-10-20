import type { Idea } from '../ideas/idea';
import type { InboxItem } from './store';

export type MatchHow = 'cafe-id' | 'title' | 'sender' | 'chosen' | 'none';

export interface MatchResult {
  ideaId?: string;
  confidence: number;
  how: MatchHow;
  /** Café IDs that might fit, best first (at most 5). */
  candidates: string[];
  /** Plain-English note for the operator, e.g. a Café ID that doesn't exist. */
  note?: string;
}

export const ASK_BELOW = 0.7;
const CAFE_ID = /\bCAFE-\d{4}-\d{3}\b/gi;
const STOP = new Set(['with', 'from', 'that', 'this', 'your', 'have', 'into', 'about', 'their', 'what', 'when', 'which', 'will', 'idea', 'agent', 'tool']);

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasPhrase = (hay: string, phrase: string) => phrase.length > 0 && ` ${hay} `.includes(` ${phrase} `);

function splitAddress(s: string): { name: string; addr: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].trim(), addr: m[2].trim() };
  return s.includes('@') ? { name: '', addr: s.trim() } : { name: s.trim(), addr: '' };
}

/** "Person 2 <person.2@example.com>" → "Person 2"; a bare address → its local part. Never an address. */
export function displayName(s: string): string {
  const { name, addr } = splitAddress(s);
  return (name || addr.split('@')[0] || '').replace(/@.*/, '').trim();
}

/** "Person 2 <person.2@example.com>" → display name, full address, address local part. */
function senderKeys(from: string | undefined): string[] {
  if (!from) return [];
  const { name, addr: rawAddr } = splitAddress(from);
  const addr = rawAddr.toLowerCase();
  const keys = [norm(name), addr, norm(addr.split('@')[0] ?? '')];
  return [...new Set(keys.filter((k) => k.length > 1))];
}

/** A submitter as written in the form, e.g. "Person 1 (CS)" or an address. */
function submitterKeys(s: string | undefined): string[] {
  if (!s) return [];
  const plain = s.replace(/\([^)]*\)/g, '').trim();
  if (plain.includes('@')) return [plain.toLowerCase(), norm(plain.split('@')[0])];
  return [norm(plain)].filter((k) => k.length > 1);
}

/** Deterministic: which idea is this item about, and how sure. The AI may lower this, never raise it. */
export function matchIdea(item: InboxItem, ideas: Idea[]): MatchResult {
  const meta = item.meta ?? {};
  const head = [meta.subject ?? '', item.name ?? ''].join('\n');
  const body = [item.text ?? '', meta.quoted ?? ''].join('\n');
  const byId = new Map(ideas.map((i) => [i.id, i]));

  // Scores for candidates: title phrase, sender, function and title words.
  const hay = norm(`${head}\n${body}`);
  const words = new Set(hay.split(' '));
  const sender = senderKeys(meta.from);
  const headNorm = norm(head);
  const titled = ideas.filter((i) => norm(i.title).length >= 4);
  /** The whole title in the subject or file name: strong. Only in the body: weak (asks). */
  const titleHits = titled.filter((i) => hasPhrase(headNorm, norm(i.title)));
  const bodyTitleHits = titled.filter((i) => !titleHits.includes(i) && hasPhrase(hay, norm(i.title)));
  const senderHits = sender.length ? ideas.filter((i) => submitterKeys(i.people.submitter).some((k) => sender.includes(k))) : [];
  const score = (i: Idea) => {
    let s = 0;
    if (titleHits.includes(i)) s += 3;
    if (bodyTitleHits.includes(i)) s += 2;
    if (senderHits.includes(i)) s += 3;
    if (i.function && words.has(norm(i.function))) s += 1;
    for (const w of new Set(norm(i.title).split(' '))) if (w.length >= 4 && !STOP.has(w) && words.has(w)) s += 1;
    return s;
  };
  const candidates = ideas.map((i) => ({ id: i.id, s: score(i) })).filter((c) => c.s > 0)
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id)).slice(0, 5).map((c) => c.id);
  const none = (note?: string, extra: string[] = []): MatchResult =>
    ({ confidence: 0, how: 'none', candidates: [...new Set([...extra, ...candidates])].slice(0, 5), ...(note ? { note } : {}) });

  // 1. A Café ID: the subject or file name first, then the text.
  const idsIn = (s: string) => [...new Set((s.match(CAFE_ID) ?? []).map((x) => x.toUpperCase()))];
  const mentioned = idsIn(head).length ? idsIn(head) : idsIn(body);
  if (mentioned.length) {
    const known = mentioned.filter((id) => byId.has(id));
    const missing = mentioned.filter((id) => !byId.has(id));
    const note = missing.length ? `Mentions ${missing.join(', ')} which doesn't exist` : undefined;
    if (known.length === 1) return { ideaId: known[0], confidence: 1, how: 'cafe-id', candidates: [known[0]], ...(note ? { note } : {}) };
    if (known.length > 1) return none(`Mentions ${known.length} Café IDs`, known);
    return none(note);
  }

  // 2. The whole title in the subject or file name, 3. the sender is the submitter of exactly one idea,
  // 4. the title only in the body (0.6: a hint that asks).
  if (titleHits.length === 1) return { ideaId: titleHits[0].id, confidence: 0.9, how: 'title', candidates: [titleHits[0].id] };
  if (titleHits.length > 1) return none(undefined, titleHits.map((i) => i.id));
  if (senderHits.length === 1) return { ideaId: senderHits[0].id, confidence: 0.8, how: 'sender', candidates: [senderHits[0].id] };
  if (bodyTitleHits.length === 1) return { ideaId: bodyTitleHits[0].id, confidence: 0.6, how: 'title', candidates: [...new Set([bodyTitleHits[0].id, ...candidates])].slice(0, 5) };
  return none(undefined, bodyTitleHits.map((i) => i.id));
}
