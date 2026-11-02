import type { Clock } from '../clock';
import type { Idea, PrepNeed, ReviewPrep } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import { showNames } from '../command/names';
import { NEED_ANSWER_MAX, type ReviewSuggestInput, type ReviewSuggestOutput } from '../ai/tasks';
import { addQuestion } from '../design/brainstorm';
import { draftEmail, updateDraft, type EmailRecord } from '../comms/outbox';
import { peopleFor, reviewInput } from './suggestInput';
import { applyAnswerUpdates, learnedAfter, planUpdates, takeInAnswers, takenBackLine, undoFromAnswer, undoneWords, REVIEW_SOURCE } from './updates';
import { emailAnswerFor, givenAnswer, isOpenNeed, mergeNeeds, withAnswer, type EmailAnswer } from './needs';
import { asksAttend, asksBuilder, builderCheck, readBuilderAnswer, type BuilderCheck } from './builderAnswer';
import { withRoleOn } from '../ideas/people';
import { rebuildGraph } from '../graph/store';

type WithAnswers = Idea & { answers?: EmailAnswer[] };
export type RunReview = (input: ReviewSuggestInput) => Promise<{ provider: string; output: ReviewSuggestOutput }>;


/** Everyone the Café knows by name for this idea: its own people, the universe's, and the names imports have seen. */
async function knownNames(root: string, idea: Idea): Promise<string[]> {
  return (await peopleFor(root, await rebuildGraph(root), idea)).map((n) => n.label);
}

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Said when the AI read an answer and left the item open without saying why. */
export const NO_REASON = 'Re-evaluated: the AI did not find this answer enough and gave no reason. Add what is missing, or Decide anyway.';

/**
 * The code's own reading of an item's answer, for the builder and attendance questions only, when the answer is simple
 * (names, a list of names, yes or no). Undefined for any other item or answer: the AI reads those.
 */
function checkOf(need: Pick<PrepNeed, 'ask'>, answer: string, known: string[], idea: Idea): BuilderCheck | undefined {
  if (!answer.trim() || !(asksBuilder(need.ask) || asksAttend(need.ask))) return undefined;
  const r = readBuilderAnswer(answer, need.ask, known);
  return r.simple ? builderCheck(r, need.ask, withRoleOn(idea, 'builder').map((p) => p.name)) : undefined;
}

/**
 * Suggest a decision and its to-do list, or re-evaluate them: the AI reads the form, the email answers, what
 * the operator pasted and the graph, keeps the last list's items and marks each met or not. Saved on the idea;
 * nothing is decided here. A simple answer to the builder or attendance question (names, yes or no) is read by the code
 * first and applied before the AI is asked, so the AI sees the builder named; the item says how it was read, or why
 * it could not be used. An item the AI leaves open although it has an answer says why.
 */
export async function suggestPrep(root: string, id: string, run: RunReview, clock: Clock): Promise<ReviewPrep> {
  let idea = await loadIdea(root, id) as WithAnswers;
  if (idea.closed) throw new Error(`${id} is closed. Reopen it first (set its stage)`);
  const prev = idea.prep?.needs ?? [];
  const known = await knownNames(root, idea);
  // What the operator pasted counts as the team's answer to that item's question.
  const pasted = prev.filter((n) => n.answer?.trim()).map((n) => ({ question: n.ask, answer: n.answer! }));
  // The code reads the simple builder and attendance answers itself: names and yes or no need no AI.
  const checks = new Map<string, BuilderCheck>();
  for (const n of prev) { const c = checkOf(n, givenAnswer(n, idea.answers), known, idea); if (c) checks.set(n.id, c); }
  const usable = prev.filter((n) => checks.get(n.id)?.ok);
  const builders = usable.map((n) => checks.get(n.id)!).find((c) => c.builders.length)?.builders ?? [];
  const attend = usable.map((n) => checks.get(n.id)!.canAttend).find((x) => x !== undefined);
  const direct = builders.length || attend !== undefined
    ? { builders, ...(attend !== undefined ? { canAttend: attend } : {}), basis: usable.map((n) => givenAnswer(n, idea.answers)) } : undefined;
  if (direct) {
    const updates = await planUpdates(root, idea, undefined, new Map(), 'app', idea.updates, 'decision', { direct });
    await saveIdea(root, { ...idea, updates });
    await applyAnswerUpdates(root, id, 'decision', clock);
    idea = await loadIdea(root, id) as WithAnswers;
  }
  const { input, basis, codes } = await reviewInput(root, id, pasted, { network: true });
  const { provider, output } = await run({ ...input, ...(prev.length ? { todo: prev.map(({ need, ask }) => ({ need, ask })) } : {}) });
  // What the AI's updates were read from: every answer it was given.
  const read = [...(idea.answers ?? []).slice(-20).map((a) => a.answer), ...pasted.map((a) => a.answer)];
  const notes: string[] = [];
  const at = clock();
  const taken = await takeInAnswers(root, idea, output, codes, provider, at, (input.answers ?? []).length, 'decision', { ...(direct ? { direct } : {}), basis: read, notes });
  const merged: PrepNeed[] = mergeNeeds(prev, output.needs, (s) => showNames(s, codes));
  const needs = merged.map((n) => {
    const given = givenAnswer(n, idea.answers);
    const c = checks.get(n.id) ?? (given ? checkOf(n, given, known, idea) : undefined);
    let x: PrepNeed = { ...n, ...(c && n.answer ? { check: { ok: c.ok, text: c.text } } : {}) };
    // The code's reading settles a builder or attendance item it read in full; a problem keeps it open, said plainly.
    // Attendance already ticked (an email said so, say) answers that part of an item that only names the builder.
    const attends = !!(idea.checklist.s2e?.done || idea.checklist.s3a?.done);
    if (c?.ok && (c.complete || attends) && c.canAttend !== false) x = { ...x, met: true, note: sentence(c.text.replace(/^Read as: /, '').replace(/ Not said yet:.*$/, '')) };
    else if (c) x = { ...x, met: false, why: c.text };
    if (x.met) { const { why: _w, checked: _k, ...rest } = x; return rest; }
    if (!given) return x;
    const builderNote = asksBuilder(n.ask) ? notes[0] : undefined;
    return { ...x, why: x.why ?? builderNote ?? NO_REASON, checked: given };
  });
  const prep: ReviewPrep = {
    at, decision: output.decision, reason: showNames(output.reason, codes), criteria: output.criteria,
    needs, basis: pasted.length ? `${basis}, with ${pasted.length} answer${pasted.length === 1 ? '' : 's'} you added` : basis, provider,
  };
  // What the answers change (checked, then applied by themselves) and the brief of what they add.
  await saveIdea(root, { ...idea, prep, ...taken });
  await applyAnswerUpdates(root, id, 'decision', clock);
  const open = needs.filter((x) => isOpenNeed(x, idea.answers)).length;
  await appendHistory(await ideaDir(root, id), {
    at: prep.at, action: 'review-suggest', by: 'app',
    detail: `${prev.length ? 'Re-evaluated' : 'Suggested'}: ${output.decision}; ${open ? `${open} to do` : 'nothing open'}`,
  });
  return prep;
}

/**
 * Save what the operator pasted or typed for one item. An empty answer clears it. A new answer in place of an earlier
 * one takes back everything the earlier one led to (the builder it named, its tick, the links read from it) first, and
 * says so in `undone`. A simple answer to the builder or attendance question is read at once (`check` on the item:
 * how it was read, or why it cannot be used); anything else waits for Re-evaluate.
 */
export async function answerNeed(root: string, id: string, needId: string, raw: unknown, clock?: Clock): Promise<ReviewPrep & { undone?: string; line?: string }> {
  const first = await loadIdea(root, id);
  const was = first.prep?.needs.find((x) => x.id === needId);
  if (!first.prep || !was) throw new Error('That to-do is gone; suggest a decision again');
  const nextText = typeof raw === 'string' ? raw.trim() : '';
  const old = was.answer?.trim() ?? '';
  const undone = old && old !== nextText && clock ? await undoFromAnswer(root, id, old, clock, nextText ? 'replaced' : 'removed') : [];
  const idea = await loadIdea(root, id) as WithAnswers;
  const prep = idea.prep!;
  let needs = withAnswer(prep.needs, needId, raw);
  const now = needs.find((x) => x.id === needId)!;
  if (now.answer && now.answer !== was.answer) {
    const c = checkOf(now, now.answer, await knownNames(root, idea), idea);
    if (c) needs = needs.map((x) => (x.id === needId ? { ...x, check: { ok: c.ok, text: c.text } } : x));
  }
  // The answers saved from the old answer went with it (undoFromAnswer); the brief they fed is out of date.
  const next = { ...prep, needs };
  const after = { ...idea, prep: next } as WithAnswers;
  const { learned: _l, ...rest } = after;
  await saveIdea(root, (old && old !== nextText ? { ...rest, ...learnedAfter(after) } : after) as Idea);
  if (old && old !== nextText && clock) {
    await appendHistory(await ideaDir(root, id), {
      at: clock(), action: nextText ? 'answer-replaced' : 'answer-removed', by: 'operator', source: REVIEW_SOURCE,
      detail: nextText ? `Review answer replaced (${was.need}): ${old} → ${nextText}` : `Review answer removed (${was.need}): ${old}`,
    });
  }
  if (!(old && old !== nextText)) return next;
  // One plain line for the page: what went with the old answer, and what became of the brief.
  const brief = idea.learned ? (learnedAfter(after).learned ? 'out of date' : 'cleared') : undefined;
  const words = undoneWords(undone);
  return { ...next, undone: words, line: takenBackLine(nextText ? 'replaced' : 'removed', { undone: words, ...(brief ? { learned: brief } : {}) }) };
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
