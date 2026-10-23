/**
 * Question matching, shared by the Import (answers to questions we sent) and the design brainstorm
 * (answers to design questions asked in an E2). A leaf module: it imports nothing from the app.
 */

/** A question as lowercase words, without punctuation or a leading list number. */
const allWords = (s: string) => s.toLowerCase().replace(/^\s*\d{1,2}[.)]\s*/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/**
 * Words every question has: they say nothing about what it asks. "Who in the team will build the proof of concept?"
 * and "How will you run the demo: a link to the proof of concept?" shared 6 of 10 words through them alone.
 */
const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'it', 'its', 'you', 'your', 'we', 'our', 'they',
  'their', 'will', 'would', 'can', 'could', 'do', 'does', 'did', 'how', 'what', 'who', 'which', 'when', 'where', 'why', 'this', 'that', 'these',
  'with', 'by', 'be', 'at', 'from', 'as', 'any', 'there', 'have', 'has', 'if', 'so', 'than', 'then', 'please', 'proof', 'concept']);
/** The words that say what a question asks; all of them when it has nothing else. */
const words = (all: string[]) => { const content = all.filter((w) => !STOP.has(w)); return content.length ? content : all; };

export function sameQuestion(a: string, b: string): boolean {
  const ax = allWords(a); const bx = allWords(b);
  if (!ax.length || !bx.length) return false;
  const [shortAll, longAll] = ax.length <= bx.length ? [ax, bx] : [bx, ax];
  // Under 3 words ("budget") the shorter one must cover 60% of the longer one, not just appear in it.
  if (shortAll.length < 3) return shortAll.filter((w) => longAll.includes(w)).length / longAll.length >= 0.6;
  if (` ${longAll.join(' ')} `.includes(` ${shortAll.join(' ')} `)) return true;
  // Otherwise 60% of the words that say what it asks (not "the", "will", "proof of concept") must be shared.
  const x = words(ax); const y = words(bx);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const have = new Set(long);
  return short.filter((w) => have.has(w)).length / short.length >= 0.6;
}
