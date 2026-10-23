/**
 * The roadshow's to-do list, the decision's and the tool picker's pattern: "Suggest" has the AI read everything the
 * idea holds and list what the story still needs from the team; each item has a box for the answer, "Draft email"
 * sends the open questions (E2) and "Re-evaluate" reads it all again. What the operator pastes is saved on the idea at
 * once as an answer (source "roadshow"), as the design's answers are: nothing to say yes to. The AI's reply rewrites the
 * "Learned since the form" brief, as the design step's does.
 */
import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import { ideaDir, loadIdea, saveIdea } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import { showNames } from '../command/names';
import type { EmailRecord } from '../comms/outbox';
import { draftQuestionsEmail } from '../review/prep';
import { isOpenNeed, mergeNeeds, withAnswer, type EmailAnswer } from '../review/needs';
import { takeInAnswers } from '../review/updates';
import type { RoadshowInput, RoadshowPrepOutput } from '../ai/tasks';
import { readRoadshow, writeRoadshow, type RoadshowState } from './store';
import { codedRoadshowInput, gatherRoadshow } from './source';

/** Where the roadshow's answers say they came from, on the idea. */
export const ROADSHOW_SOURCE = 'roadshow';

type WithAnswers = Idea & { answers?: EmailAnswer[] };
export type RunRoadshowPrep = (input: RoadshowInput) => Promise<{ provider: string; output: RoadshowPrepOutput }>;

/** Suggest the to-do list, or Re-evaluate it with the answers. The list is saved; so is the rewritten brief. */
export async function suggestRoadshowPrep(root: string, id: string, run: RunRoadshowPrep, clock: Clock): Promise<RoadshowState> {
  const src = await gatherRoadshow(root, id);
  if (src.idea.closed) throw new Error(`${id} is closed. Reopen it first (set its stage)`);
  const prev = src.state.prep?.needs ?? [];
  const { input, codes, read } = await codedRoadshowInput(root, src, { todo: prev.map(({ need, ask }) => ({ need, ask })) });
  const { provider, output } = await run(input);
  const at = clock();
  // Read again: nothing that changed while the AI worked may be lost.
  const state = await readRoadshow(root, id);
  // Names come back from their codes in every line (the question goes to the team as written).
  const name = (s: string) => showNames(s, codes);
  const said = output.needs.map((n) => ({ ...n, need: name(n.need), ask: name(n.ask) }));
  state.prep = { at, provider, needs: mergeNeeds(state.prep?.needs ?? prev, said, name) };
  await writeRoadshow(root, id, state);
  const now = await loadIdea(root, id);
  await saveIdea(root, { ...now, ...(await takeInAnswers(root, now, { learned: output.learned }, codes, provider, at, read, 'roadshow')) });
  const open = state.prep.needs.filter((n) => isOpenNeed(n, (now as WithAnswers).answers)).length;
  await appendHistory(await ideaDir(root, id), {
    at, action: 'roadshow-suggest', by: 'app', detail: `${prev.length ? 'Re-evaluated' : 'Suggested'} the roadshow to-do list: ${open ? `${open} to do` : 'nothing open'}`,
  });
  return state;
}

/**
 * Every answer pasted against the to-do list goes on the idea as an answer, at once and without asking (the design's
 * pattern): the deck, the brief and later suggestions read them like any other. Kept in step: a changed or cleared
 * answer changes or leaves the idea too.
 */
export async function saveRoadshowAnswers(root: string, id: string, state: RoadshowState): Promise<void> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const mine = (state.prep?.needs ?? []).filter((n) => n.answer?.trim()).map((n) => ({ question: n.ask, answer: n.answer!.trim(), source: ROADSHOW_SOURCE }));
  const others = (idea.answers ?? []).filter((a) => a.source !== ROADSHOW_SOURCE);
  if (JSON.stringify((idea.answers ?? []).filter((a) => a.source === ROADSHOW_SOURCE)) === JSON.stringify(mine)) return;
  await saveIdea(root, { ...idea, answers: [...others, ...mine] } as Idea);
}

/** Save what the operator pasted for one item (an empty answer clears it), and the answers on the idea with it. */
export async function answerRoadshowNeed(root: string, id: string, needId: string, raw: unknown): Promise<RoadshowState> {
  const state = await readRoadshow(root, id);
  if (!state.prep) throw new Error('No to-do list yet: Suggest first');
  state.prep = { ...state.prep, needs: withAnswer(state.prep.needs, needId, raw) };
  await writeRoadshow(root, id, state);
  await saveRoadshowAnswers(root, id, state);
  return state;
}

/** The open items as the questions email (E2). Opening it in Outlook is the caller's next step. */
export async function draftRoadshowNeedsEmail(root: string, id: string, clock: Clock): Promise<EmailRecord> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const open = ((await readRoadshow(root, id)).prep?.needs ?? []).filter((x) => isOpenNeed(x, idea.answers));
  return draftQuestionsEmail(root, id, open.map((x) => x.ask), clock);
}

/** Once that email is opened in Outlook: the open items it asked are marked asked (and unmarked on its Undo). */
export async function markRoadshowAsked(root: string, id: string, at: string, asked = true): Promise<void> {
  const idea = await loadIdea(root, id) as WithAnswers;
  const state = await readRoadshow(root, id);
  if (!state.prep) return;
  const needs = state.prep.needs.map((x) => {
    if (asked) return isOpenNeed(x, idea.answers) ? { ...x, askedAt: at } : x;
    const { askedAt, ...rest } = x;
    return askedAt === at ? rest : x;
  });
  state.prep = { ...state.prep, needs };
  await writeRoadshow(root, id, state);
}
