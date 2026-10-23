import { sameQuestion } from '../inbox/question';
import type { PrepNeed } from '../ideas/idea';

/**
 * Matching the to-do list with what came back. A leaf module (it imports only the question matcher), so the
 * page uses it too.
 */
export interface EmailAnswer { question: string; answer: string; source?: string }

/** The team's emailed answer to this item, if a reply answered its question. */
export function emailAnswerFor(need: Pick<PrepNeed, 'ask'>, answers: EmailAnswer[] = []): EmailAnswer | undefined {
  return [...answers].reverse().find((a) => a.answer?.trim() && sameQuestion(need.ask, a.question));
}

/** Still open: not met at the last evaluation, and nothing pasted or emailed back since. */
export function isOpenNeed(need: PrepNeed, answers: EmailAnswer[] = []): boolean {
  return !need.met && !need.answer?.trim() && !emailAnswerFor(need, answers);
}

/** Answered since the last evaluation (pasted or emailed), but not yet re-evaluated. */
export function awaitsReevaluation(need: PrepNeed, answers: EmailAnswer[] = []): boolean {
  return !need.met && (!!need.answer?.trim() || !!emailAnswerFor(need, answers));
}

/** The same to-do item, by its words or its question. */
export const sameNeed = (a: { need: string; ask: string }, b: { need: string; ask: string }) =>
  a.need.trim().toLowerCase() === b.need.trim().toLowerCase() || sameQuestion(a.ask, b.ask);

/**
 * A fresh to-do list from the AI, laid over the last one: an item it kept keeps its id, what the operator pasted and
 * when it was asked; new items get the next ids. `note` turns the AI's "what covered it" into words for the page.
 */
export function mergeNeeds(
  prev: PrepNeed[], out: { need: string; ask: string; met: boolean; answer?: string }[], note: (s: string) => string = (s) => s,
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
    return {
      id: p?.id ?? `n${++n}`, need: o.need, ask: o.ask, met: o.met,
      ...(said ? { note: said } : {}),
      ...(p?.answer ? { answer: p.answer } : {}),
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
    const { answer: _old, ...rest } = x;
    return answer ? { ...rest, answer } : rest;
  });
}
