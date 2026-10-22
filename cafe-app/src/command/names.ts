import type { GNode, NodeType } from '../graph/ontology';

/** The code letter for each kind of star, so the AI can tell a person [P1] from a team [T1]. */
const LETTER: Record<NodeType, string> = {
  Person: 'P', Team: 'T', Entity: 'D', Idea: 'I', Round: 'R', Capability: 'C', PainPoint: 'K', System: 'S', Support: 'U', Tool: 'X', Outcome: 'O', Beneficiary: 'B', Category: 'G',
};
/** Always listed for the AI, mentioned or not, so "the travel bot" can still be found: none of these are people. */
const ALWAYS: NodeType[] = ['Idea', 'Team', 'Entity', 'Round'];

export interface Coded { id: string; type: NodeType; label: string }
export interface LegendEntry { code: string; type: NodeType; label?: string }

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const norm = (s: string) => s.toLowerCase();

/** "Avery Chen" also answers to "Chen, Avery" and, when no one else shares it, "Avery". */
function aliases(n: GNode, firstNames: Map<string, number>): string[] {
  const out = [n.label];
  if (n.type === 'Idea' && typeof n.attrs?.cafeId === 'string') out.push(n.attrs.cafeId);
  if (n.type === 'Round' && typeof n.attrs?.roundId === 'string') out.push(n.attrs.roundId);
  if (n.type === 'Person') {
    const parts = n.label.trim().split(/\s+/);
    if (parts.length > 1) {
      out.push(`${parts.slice(1).join(' ')}, ${parts[0]}`);
      if (parts[0].length >= 3 && firstNames.get(norm(parts[0])) === 1) out.push(parts[0]);
    }
  }
  return out.filter((a) => a.trim().length >= 2);
}

/**
 * Swaps every star the text names for a code like [P1], longest name first, whole words only, and lists the codes
 * for the AI. A person is listed by type only: their name never leaves the app.
 */
/**
 * `seed` carries a conversation's codes forward, so a star keeps its code through the whole thread
 * ([P1] in the first message is [P1] in the tenth); stars that are gone drop out, renamed ones take their new label.
 */
export function hideNames(text: string, nodes: GNode[], opts: { all?: boolean; seed?: Map<string, Coded> } = {}): { text: string; legend: LegendEntry[]; codes: Map<string, Coded> } {
  const firstNames = new Map<string, number>();
  for (const n of nodes) if (n.type === 'Person') { const f = norm(n.label.split(/\s+/)[0]); firstNames.set(f, (firstNames.get(f) ?? 0) + 1); }
  const cands = nodes.flatMap((n) => aliases(n, firstNames).map((alias) => ({ n, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  // Find non-overlapping matches on the original text, longest names first.
  const lower = norm(text);
  const taken: { start: number; end: number; n: GNode }[] = [];
  for (const { n, alias } of cands) {
    const a = norm(alias);
    for (let i = lower.indexOf(a); i !== -1; i = lower.indexOf(a, i + 1)) {
      const end = i + a.length;
      if (isWordChar(text[i - 1]) || isWordChar(text[end])) continue;
      if (taken.some((t) => i < t.end && end > t.start)) continue;
      taken.push({ start: i, end, n });
    }
  }
  taken.sort((a, b) => a.start - b.start);

  const codes = new Map<string, Coded>();
  const codeOf = new Map<string, string>();
  const count: Partial<Record<NodeType, number>> = {};
  const live = new Map(nodes.map((x) => [x.id, x]));
  for (const [c, v] of opts.seed ?? []) {
    const k = Number(c.slice(1)) || 0;
    count[v.type] = Math.max(count[v.type] ?? 0, k); // never reuse a code, even one whose star is gone
    const now = live.get(v.id);
    if (now) { codes.set(c, { id: now.id, type: now.type, label: now.label }); codeOf.set(now.id, c); }
  }
  const code = (n: GNode) => {
    let c = codeOf.get(n.id);
    if (!c) {
      count[n.type] = (count[n.type] ?? 0) + 1;
      c = `${LETTER[n.type]}${count[n.type]}`;
      codeOf.set(n.id, c); codes.set(c, { id: n.id, type: n.type, label: n.label });
    }
    return c;
  };
  let out = ''; let at = 0;
  for (const t of taken) { out += `${text.slice(at, t.start)}[${code(t.n)}]`; at = t.end; }
  out += text.slice(at);
  for (const n of nodes) if (opts.all || ALWAYS.includes(n.type)) code(n);

  const legend = [...codes].map(([c, v]) => (v.type === 'Person' ? { code: c, type: v.type } : { code: c, type: v.type, label: v.label }));
  return { text: out, legend, codes };
}

/** The code a star already has, or a new one of its kind (a star a query found that the message never named). */
export function codeFor(codes: Map<string, Coded>, n: GNode): string {
  for (const [c, v] of codes) if (v.id === n.id) return c;
  const letter = LETTER[n.type];
  let k = 1; while (codes.has(`${letter}${k}`)) k++;
  codes.set(`${letter}${k}`, { id: n.id, type: n.type, label: n.label });
  return `${letter}${k}`;
}

/** The AI's words with the real names put back; an unknown code stays as written. */
export function showNames(text: string, codes: Map<string, Coded>): string {
  let out = text.replace(/\[([A-Z]\d+)\]|\b([A-Z]\d+)\b/g, (m, a?: string, b?: string) => codes.get((a ?? b)!)?.label ?? m);
  // The AI sometimes writes the code and the label side by side ("[I1] Travel bot", "[T1] (GSS)"): say the name once.
  for (const { label } of codes.values()) {
    const l = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`${l}\\s*(?:\\(\\s*${l}\\s*\\)|"${l}"|${l})(?![\\p{L}\\p{N}])`, 'gu'), label);
  }
  return out;
}
