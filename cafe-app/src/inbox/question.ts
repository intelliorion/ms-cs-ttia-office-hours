/**
 * Question matching, shared by the Inbox (answers to questions we sent) and the design brainstorm
 * (answers to design questions asked in an E2). A leaf module: it imports nothing from the app.
 */

/** A question as lowercase words, without punctuation or a leading list number. */
const words = (s: string) => s.toLowerCase().replace(/^\s*\d{1,2}[.)]\s*/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * Is this the same question? Forgiving of wording, strict about meaning: after lowercasing and dropping
 * punctuation and any leading number, one contains the other, or at least 60% of the shorter one's words
 * appear in the other. A shorter side of under 3 words must instead cover 60% of the longer one's words.
 */
export function sameQuestion(a: string, b: string): boolean {
  const x = words(a); const y = words(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const have = new Set(long);
  const shared = short.filter((w) => have.has(w)).length;
  // Under 3 words ("budget") the shorter one must cover 60% of the longer one, not just appear in it.
  if (short.length < 3) return shared / long.length >= 0.6;
  if (` ${long.join(' ')} `.includes(` ${short.join(' ')} `)) return true;
  return shared / short.length >= 0.6;
}
