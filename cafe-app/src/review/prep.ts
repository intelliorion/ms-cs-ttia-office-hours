import type { Clock } from '../clock';
import type { Idea, PrepNeed, ReviewPrep } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import { showNames } from '../command/names';
import { NEED_ANSWER_MAX, type ReviewSuggestInput, type ReviewSuggestOutput } from '../ai/tasks';
import { addQuestion } from '../design/brainstorm';
import { draftEmail, updateDraft, type EmailRecord } from '../comms/outbox';
import { reviewInput } from './suggestInput';
import { applyAnswerUpdates, takeInAnswers } from './updates';
import { emailAnswerFor, isOpenNeed, mergeNeeds, withAnswer, type EmailAnswer } from './needs';

type WithAnswers = Idea & { answers?: EmailAnswer[] };
export type RunReview = (input: ReviewSuggestInput) => Promise<{ provider: string; output: ReviewSuggestOutput }>;


/**
 * Suggest a decision and its to-do list, or re-evaluate them: the AI reads the form, the email answers, what
 * the operator pasted and the graph, keeps the last list's items and marks each met or not. Saved on the idea;
 * nothing is decided here.
 */
export async function suggestPrep(root: string, id: string, run: RunReview, clock: Clock): Promise<ReviewPrep> {
  const idea = await loadIdea(root, id) as WithAnswers;
  if (idea.closed) throw new Error(`${id} is closed. Reopen it first (set its stage)`);
  const prev = idea.prep?.needs ?? [];
  // What the operator pasted counts as the team's answer to that item's question.
  const pasted = prev.filter((n) => n.answer?.trim()).map((n) => ({ question: n.ask, answer: n.answer! }));
  const { input, basis, codes } = await reviewInput(root, id, pasted);
  const { provider, output } = await run({ ...input, ...(prev.length ? { todo: prev.map(({ need, ask }) => ({ need, ask })) } : {}) });
  const needs: PrepNeed[] = mergeNeeds(prev, output.needs, (s) => showNames(s, codes));
  const prep: ReviewPrep = {
    at: clock(), decision: output.decision, reason: showNames(output.reason, codes), criteria: output.criteria,
    needs, basis: pasted.length ? `${basis}, with ${pasted.length} answer${pasted.length === 1 ? '' : 's'} you added` : basis, provider,
  };
  // What the answers change (checked, then applied by themselves) and the brief of what they add.
  const taken = await takeInAnswers(root, idea, output, codes, provider, prep.at, (input.answers ?? []).length);
  await saveIdea(root, { ...idea, prep, ...taken });
  await applyAnswerUpdates(root, id, 'decision', clock);
  const open = needs.filter((x) => isOpenNeed(x, idea.answers)).length;
  await appendHistory(await ideaDir(root, id), {
    at: prep.at, action: 'review-suggest', by: 'app',
    detail: `${prev.length ? 'Re-evaluated' : 'Suggested'}: ${output.decision}; ${open ? `${open} to do` : 'nothing open'}`,
  });
  return prep;
}

/** Save what the operator pasted or typed for one item. An empty answer clears it. Not evaluated until Re-evaluate. */
export async function answerNeed(root: string, id: string, needId: string, raw: unknown): Promise<ReviewPrep> {
  const idea = await loadIdea(root, id);
  const prep = idea.prep;
  if (!prep?.needs.some((x) => x.id === needId)) throw new Error('That to-do is gone; suggest a decision again');
  const next = { ...prep, needs: withAnswer(prep.needs, needId, raw) };
  await saveIdea(root, { ...idea, prep: next });
  return next;
}

const LEFTOVER_SLOT = /^\s*\d{1,2}[.)]\s*\[QUESTION \d+[^\]\n]*\]\s*$/;

/**
 * The questions email (E2) for the open to-dos: each open item's question in the draft, the template's
 * example slots that are left over taken out. Returns the email; opening it in Outlook is the caller's next step.
 */
export async function draftNeedsEmail(root: string, id: string, clock: Clock): Promise<EmailRecord> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const open = (idea.prep?.needs ?? []).filter((x) => isOpenNeed(x, idea.answers));
  return draftQuestionsEmail(root, id, open.map((x) => x.ask), clock);
}

/** The questions email (E2) with these questions in it (each once), for any to-do list: the decision's or the tool picker's. */
export async function draftQuestionsEmail(root: string, id: string, asks: string[], clock: Clock): Promise<EmailRecord> {
  if (!asks.length) throw new Error('Nothing is open to ask the team');
  let rec = await draftEmail(root, { template: 'E2', ideaId: id }, clock);
  if (rec.status === 'draft') {
    let body = rec.body;
    for (const ask of asks) body = addQuestion(body, ask);
    // Renumber after taking out the unused example questions, so the team sees 1, 2, 3.
    let k = 0;
    body = body.split('\n').filter((l) => !LEFTOVER_SLOT.test(l))
      .map((l) => (/^\s*\d{1,2}[.)]\s+/.test(l) ? l.replace(/^\s*\d{1,2}([.)])/, (_m, p) => `${++k}${p}`) : l)).join('\n');
    if (body !== rec.body) rec = await updateDraft(root, rec.key, { body });
  }
  return rec;
}

/** Once the questions email is really on its way (opened in Outlook): the open items it asked are marked asked. */
export async function markAsked(root: string, id: string, at: string): Promise<void> {
  const idea = await loadIdea(root, id) as WithAnswers;
  if (!idea.prep) return;
  const needs = idea.prep.needs.map((x) => (isOpenNeed(x, idea.answers) ? { ...x, askedAt: at } : x));
  await saveIdea(root, { ...idea, prep: { ...idea.prep, needs } });
}

/** Undo of that email: the items it marked asked are not asked any more. */
export async function unmarkAsked(root: string, id: string, at: string): Promise<void> {
  const idea = await loadIdea(root, id);
  if (!idea.prep?.needs.some((x) => x.askedAt === at)) return;
  const needs = idea.prep.needs.map(({ askedAt, ...x }) => (askedAt === at ? x : { ...x, ...(askedAt ? { askedAt } : {}) }));
  await saveIdea(root, { ...idea, prep: { ...idea.prep, needs } });
}

export { emailAnswerFor, NEED_ANSWER_MAX };
