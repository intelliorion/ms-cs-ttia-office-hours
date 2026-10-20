import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import { loadIdea } from '../ideas/store';
import { tick } from '../checklist/checklist';
import { loadSteps } from '../rules/stages';
import { suggestion, type Suggest } from '../ideas/suggest';
import { draftEmail, updateDraft } from '../comms/outbox';
import { sameQuestion } from '../inbox/question';
import { DESIGN_TAGS, type DesignStepInput, type DesignStepOutput } from '../ai/tasks';
import {
  readDesign, writeDesign, renderDesignMd, writeDesignMd, skillGuidance, CSIC_NOTE,
  type DesignState, type DesignStep, type DesignTag, type StepSource,
} from './store';
import { cafeCheck } from './cafecheck';

/** Where design.md is the source of a background tick. */
export const DESIGN_FILE = 'design.md';
/** A step tag that, once answered, ticks a Stage 3 step (tick only; the stage never moves). */
export const TAG_TICKS: Partial<Record<DesignTag, string>> = { 'must-show': 's3c', 'smallest-input': 's3d' };
export const APPROVE_STEP = 's3f';
export const ASKED_TEAM_ANSWER = '(not known yet; asked the team)';

export const QUESTION_MAX = 200;
export const SUGGESTED_MAX = 120;
export const ANSWER_MAX = 1000;
export const SUMMARY_MAX = 600;

export type DesignEvent =
  | { t: 'step'; question: string; suggested: string[]; why?: string; tag?: DesignTag | null; source: StepSource }
  | { t: 'done'; summary: string }
  | { t: 'answer'; n: number; answer: string; source: StepSource }
  | { t: 'asked-team'; n: number; emailKey: string }
  | { t: 'approve' };

export class DesignError extends Error {}

/** Free text as one plain line, capped. */
export const line = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const isOpen = (s: DesignStep) => !s.answer?.trim() && !s.askedTeam;
export const isDone = (state: DesignState) => !!state.summary?.trim();
const stepOf = (state: DesignState, n: number): DesignStep => {
  const s = state.steps.find((x) => x.n === n);
  if (!s) throw new DesignError(`No question ${n}`);
  return s;
};

/**
 * One event on the design, with no side effects. Any change other than the approval itself
 * takes an approved design back to 'designing' (the approval was for what it said before).
 * Returns the Stage 3 steps to tick.
 */
export function reduceDesign(prev: DesignState, e: DesignEvent, clock: Clock): { state: DesignState; ticks: string[] } {
  const state: DesignState = { ...prev, steps: prev.steps.map((s) => ({ ...s })) };
  const ticks: string[] = [];
  const reopen = () => {
    if (state.status === 'approved') { state.status = 'designing'; delete state.approvedAt; }
    if (state.status === 'not-started' || state.status === 'picking') state.status = 'designing';
  };
  switch (e.t) {
    case 'step': {
      const question = line(e.question, QUESTION_MAX);
      if (!question) throw new DesignError('Write the question first');
      const n = state.steps.reduce((m, s) => Math.max(m, s.n), 0) + 1;
      const tag = e.tag && (DESIGN_TAGS as readonly string[]).includes(e.tag) ? e.tag : undefined;
      const why = line(e.why, 160);
      state.steps.push({
        n, question, suggested: e.suggested.map((s) => line(s, SUGGESTED_MAX)).filter(Boolean).slice(0, 4), source: e.source,
        ...(why ? { why } : {}), ...(tag ? { tag } : {}),
      });
      // A new question reopens a finished design: the summary no longer covers everything.
      delete state.summary;
      reopen();
      break;
    }
    case 'done': {
      const summary = line(e.summary, SUMMARY_MAX);
      if (!summary) throw new DesignError('A finished design needs a summary');
      state.summary = summary;
      reopen();
      break;
    }
    case 'answer': {
      const s = stepOf(state, e.n);
      const answer = line(e.answer, ANSWER_MAX);
      if (!answer) throw new DesignError('Write an answer first');
      s.answer = answer;
      s.source = e.source;
      const t = s.tag ? TAG_TICKS[s.tag] : undefined;
      if (t) ticks.push(t);
      reopen();
      break;
    }
    case 'asked-team': {
      const s = stepOf(state, e.n);
      s.askedTeam = { emailKey: e.emailKey };
      reopen();
      break;
    }
    case 'approve': {
      if (!isDone(state)) throw new DesignError('Design is not finished yet');
      state.status = 'approved';
      state.approvedAt = clock();
      ticks.push(APPROVE_STEP);
      break;
    }
  }
  return { state, ticks };
}

/**
 * Applies events and keeps the three in step: design.yaml (with the Café check), design.md, and the
 * background ticks (s3c/s3d/s3f, source design.md). Never changes the stage.
 */
export async function applyDesignEvents(
  root: string, idea: Idea, events: DesignEvent[], clock: Clock,
): Promise<{ state: DesignState; designMd: string }> {
  let state = await readDesign(root, idea.id);
  const ticks: string[] = [];
  for (const e of events) {
    const r = reduceDesign(state, e, clock);
    state = r.state;
    ticks.push(...r.ticks);
  }
  state.cafeCheck = cafeCheck(idea, state);
  await writeDesign(root, idea.id, state);
  await writeDesignMd(root, idea, state);
  if (ticks.length) {
    const steps = await loadSteps(root);
    for (const t of [...new Set(ticks)]) await tick(root, idea.id, t, true, { by: 'app', source: DESIGN_FILE, clock, steps });
  }
  return { state, designMd: renderDesignMd(idea, state) };
}

export const applyDesignEvent = (root: string, idea: Idea, event: DesignEvent, clock: Clock) =>
  applyDesignEvents(root, idea, [event], clock);

/** The AI's input for the next question: the idea, its features and the answers so far. */
export function designStepInput(idea: Idea, state: DesignState): DesignStepInput {
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    features: state.features.map((f) => ({ name: f.name, ...(f.what ? { what: f.what } : {}), ...(f.tool ? { tool: f.tool } : {}) })),
    stepsSoFar: state.steps.map((s) => ({ question: s.question, answer: s.answer?.trim() || ASKED_TEAM_ANSWER })),
    guidance: skillGuidance('brainstorming'),
  };
}

/** Refuses a new question while the last one is still open (one question at a time). */
export function assertNoOpenStep(state: DesignState): void {
  const open = state.steps.find(isOpen);
  if (open) throw new DesignError(`Answer question ${open.n} first, or say "I don't know"`);
}

/** The AI's reply as an event. */
export const stepEvent = (out: DesignStepOutput): DesignEvent => (out.done
  ? { t: 'done', summary: out.summary ?? '' }
  : { t: 'step', question: out.question ?? '', suggested: out.suggested ?? [], why: out.why, tag: out.tag ?? null, source: 'ai-suggested' });

const NUMBERED = /^\s*\d{1,2}[.)]\s+/;

/**
 * Puts a question into an E2 body: the first [QUESTION k…] slot left, else a new numbered line after
 * the last one. A question already in the body is left alone.
 */
export function addQuestion(body: string, question: string): string {
  const lines = body.split('\n');
  if (lines.some((l) => NUMBERED.test(l) && !l.replace(NUMBERED, '').startsWith('[') && sameQuestion(l, question))) return body;
  const slot = /\[QUESTION \d+[^\]\n]*\]/;
  if (slot.test(body)) return body.replace(slot, () => question);
  let last = -1;
  lines.forEach((l, i) => { if (NUMBERED.test(l)) last = i; });
  if (last < 0) return `${body}\n\n1. ${question}`;
  const k = Number(/^\s*(\d{1,2})/.exec(lines[last])![1]) + 1;
  lines.splice(last + 1, 0, `${k}. ${question}`);
  return lines.join('\n');
}

/**
 * "I don't know": draft (or reuse) the idea's E2 with this question in it and leave the step open,
 * waiting for the team's reply.
 */
export async function askTeam(root: string, idea: Idea, n: number, clock: Clock): Promise<{ state: DesignState; designMd: string; emailKey: string }> {
  const state = await readDesign(root, idea.id);
  const step = stepOf(state, n);
  if (step.answer?.trim()) throw new DesignError(`Question ${n} already has an answer`);
  const rec = await draftEmail(root, { template: 'E2', ideaId: idea.id }, clock);
  if (rec.status !== 'draft') throw new DesignError('An E2 is approved and waiting to be sent. Send it first, then ask again');
  const body = addQuestion(rec.body, step.question);
  if (body !== rec.body) await updateDraft(root, rec.key, { body });
  const out = await applyDesignEvent(root, idea, { t: 'asked-team', n, emailKey: rec.key }, clock);
  return { ...out, emailKey: rec.key };
}

/**
 * The Inbox hook: answers the team sent back fill the design questions we asked them in an E2
 * (open steps with askedTeam whose question matches). Returns how many were filled. Never throws,
 * so the Inbox works the same with or without a design.
 */
export async function fillDesignAnswers(
  root: string, idea: Idea, answers: { question: string; answer: string }[], clock: Clock,
): Promise<number> {
  try {
    const state = await readDesign(root, idea.id);
    const events: DesignEvent[] = [];
    for (const s of state.steps) {
      if (s.answer?.trim() || !s.askedTeam) continue;
      const a = answers.find((x) => sameQuestion(s.question, x.question) && line(x.answer, ANSWER_MAX));
      if (a) events.push({ t: 'answer', n: s.n, answer: a.answer, source: 'e2' });
    }
    if (!events.length) return 0;
    await applyDesignEvents(root, idea, events, clock);
    return events.length;
  } catch {
    return 0;
  }
}

/** Approve a finished design: stores approvedAt, ticks s3f and, with a CSIC flag, suggests closing as Routed to CSIC (never applied). */
export async function approveDesign(
  root: string, id: string, clock: Clock,
): Promise<{ state: DesignState; designMd: string; notice: string; suggest?: Suggest }> {
  const idea = await loadIdea(root, id);
  const out = await applyDesignEvent(root, idea, { t: 'approve' }, clock);
  const flags = out.state.cafeCheck?.csicFlags ?? [];
  const suggest = flags.length ? suggestion(await loadIdea(root, id), { closeAs: 'csic' }) : undefined;
  const notice = flags.length ? `Design approved. ${CSIC_NOTE} (${flags.join(', ')})` : 'Design approved.';
  return { ...out, notice, ...(suggest ? { suggest } : {}) };
}
