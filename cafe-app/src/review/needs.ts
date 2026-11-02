import { sameQuestion } from '../inbox/question';
import type { PrepNeed } from '../ideas/idea';

/**
 * Matching the to-do list with what came back. A leaf module (it imports only the question matcher), so the
 * page uses it too.
 */
/** Where answers saved from the review list say they came from. */
export const REVIEW_SOURCE = 'review answers';

export interface EmailAnswer { question: string; answer: string; source?: string }

/** The team's emailed answer to this item, if a reply answered its question. */
export function emailAnswerFor(need: Pick<PrepNeed, 'ask'>, answers: EmailAnswer[] = []): EmailAnswer | undefined {
  return [...answers].reverse().find((a) => a.answer?.trim() && sameQuestion(need.ask, a.question));
}

/** The answer the item has: what the operator pasted, else the team's emailed one. */
export const givenAnswer = (need: PrepNeed, answers: EmailAnswer[] = []): string =>
  need.answer?.trim() || emailAnswerFor(need, answers)?.answer?.trim() || '';

/**
 * Answered since the last evaluation (pasted or emailed), but not yet re-evaluated. An answer the last evaluation
 * already read and found not enough (`checked`) is not waiting: the item is open again, with the reason shown.
 */
export function awaitsReevaluation(need: PrepNeed, answers: EmailAnswer[] = []): boolean {
  if (need.met) return false;
  const given = givenAnswer(need, answers);
  return !!given && given !== need.checked?.trim();
}

/** Still open: not met at the last evaluation, and no new answer since. */
export function isOpenNeed(need: PrepNeed, answers: EmailAnswer[] = []): boolean {
  return !need.met && !awaitsReevaluation(need, answers);
}

/** The same to-do item, by its words or its question. */
export const sameNeed = (a: { need: string; ask: string }, b: { need: string; ask: string }) =>
  a.need.trim().toLowerCase() === b.need.trim().toLowerCase() || sameQuestion(a.ask, b.ask);

/**
 * A fresh to-do list from the AI, laid over the last one: an item it kept keeps its id, what the operator pasted and
 * when it was asked; new items get the next ids. `note` turns the AI's "what covered it" into words for the page.
 */
export function mergeNeeds(
  prev: PrepNeed[], out: { need: string; ask: string; met: boolean; answer?: string; why?: string }[], note: (s: string) => string = (s) => s,
): PrepNeed[] {
  let n = Math.max(0, ...prev.map((p) => Number(/^n(\d+)$/.exec(p.id)?.[1] ?? 0)));
  // Each earlier item is kept by one item only: the same words first, then the same question in other words. A new item
  // whose question merely looks like a kept one gets an id of its own (two items never share one).
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const match = new Map<number, PrepNeed>();
  const used = new Set<string>();
  out.forEach((o, i) => {
    const p = prev.find((x) => !used.has(x.id) && (same(x.need, o.need) || same(x.ask, o.ask)));
    if (p) { match.set(i, p); used.add(p.id); }
  });
  out.forEach((o, i) => {
    if (match.has(i)) return;
    const p = prev.find((x) => !used.has(x.id) && sameNeed(x, o));
    if (p) { match.set(i, p); used.add(p.id); }
  });
  return out.map((o, i) => {
    const p = match.get(i);
    const said = o.met && o.answer?.trim() ? note(o.answer) : undefined;
    const why = !o.met && o.why?.trim() ? note(o.why) : undefined;
    return {
      id: p?.id ?? `n${++n}`, need: o.need, ask: o.ask, met: o.met,
      ...(said ? { note: said } : {}),
      ...(why ? { why } : {}),
      ...(p?.answer ? { answer: p.answer } : {}),
      ...(p?.answer && p.check ? { check: p.check } : {}),
      ...(p?.askedAt ? { askedAt: p.askedAt } : {}),
    };
  });
}

/** Save what the operator pasted or typed for one item (an empty answer clears it). */
export function withAnswer(needs: PrepNeed[], needId: string, raw: unknown): PrepNeed[] {
  if (!needs.some((x) => x.id === needId)) throw new Error('That to-do is gone; ask the AI again');
  const answer = typeof raw === 'string' ? raw.trim().slice(0, 4000) : '';
  return needs.map((x) => {
    if (x.id !== needId) return x;
    // A new answer is read afresh: what was said about the old one goes with it.
    if (answer === x.answer) return x;
    // An item met by the old answer is open again until the new one is read.
    const { answer: _old, check: _c, why: _w, checked: _k, ...rest } = x;
    const open = x.met && x.answer ? (({ note: _n, ...r }) => ({ ...r, met: false }))(rest) : rest;
    return answer ? { ...open, answer } : open;
  });
}
