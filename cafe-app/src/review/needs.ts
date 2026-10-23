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
