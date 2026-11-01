/**
 * Where an AI link's quoted passage is in the idea's text. Read by the extraction (src/ai/apply.ts), which moves a
 * link's source to the field the passage is in, and by the build, which refuses a quote the text does not hold.
 */

/** The idea's text fields the extract reads: a link names the one it came from, and its source records it. */
export const FIELDS = ['challenge', 'current_process', 'outcomes', 'business_impact', 'beneficiaries', 'additional_context'];

/** Words only, for comparing a quote with the text it came from (case, accents, punctuation and spacing aside). */
const plain = (s: string) => ` ${String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' email ').replace(/<email>/g, ' email ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/**
 * Where a quoted passage really is in the idea's text: the field the AI named when it is there, else the first field
 * that holds it (the source is corrected to it), else not found (the field the AI named is kept, said not found).
 */
export function placeQuote(quote: string | undefined, named: string, text: Partial<Record<string, unknown>> | undefined): { field: string; found?: boolean } {
  const q = plain(quote ?? '');
  if (!quote || q.trim().length < 3 || !text) return { field: named };
  const has = (f: string) => plain(Array.isArray(text[f]) ? (text[f] as unknown[]).join(' ') : String(text[f] ?? '')).includes(q);
  if (has(named)) return { field: named, found: true };
  const other = FIELDS.find((f) => f !== named && has(f));
  return other ? { field: other, found: true } : { field: named, found: false };
}
