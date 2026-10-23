import type { Clock } from '../clock';
import type { Idea } from '../ideas/idea';
import { loadIdea, saveIdea } from '../ideas/store';
import { tick } from '../checklist/checklist';
import { loadSteps } from '../rules/stages';
import { suggestion, type Suggest } from '../ideas/suggest';
import { draftEmail, updateDraft } from '../comms/outbox';
import { sameQuestion } from '../inbox/question';
import { DESIGN_TAGS, type DesignDiagramInput, type DesignStepInput, type DesignStepOutput } from '../ai/tasks';
import { isDesignTag, pointOf, POINT_MAX } from './points';
import { basisOf, checkDiagram, type DiagramSpec } from './diagram';
import { csicFlags, scopeWords } from './choice';
import { retiredToolNote } from '../graph/ontology';
import {
  readDesign, writeDesign, renderDesignMd, writeDesignMd, skillGuidance, CSIC_NOTE,
  type DesignState, type DesignStep, type DesignTag, type StepSource,
} from './store';

import { toolFeatures } from './choice';
import { reviewInput } from '../review/suggestInput';
import { showNames, type Coded } from '../command/names';

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
  | { t: 'done'; summary: string; settled?: Partial<Record<string, string>> }
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
      // A new question reopens a finished design: the summary (and what it said was settled) no longer covers everything.
      delete state.summary;
      delete state.settled;
      reopen();
      break;
    }
    case 'done': {
      // A summary longer than the cap (names restored after the AI can make it so) ends on a whole word, with an ellipsis.
      const full = line(e.summary, 4000);
      const summary = full.length <= SUMMARY_MAX ? full : `${full.slice(0, SUMMARY_MAX - 1).replace(/\s+\S*$/, '')}…`;
      if (!summary) throw new DesignError('A finished design needs a summary');
      state.summary = summary;
      // What the earlier answers settle though no question was tagged with it: design tags only, one line each.
      const settled = Object.fromEntries(Object.entries(e.settled ?? {})
        .filter(([k]) => isDesignTag(k)).map(([k, v]) => [k, line(v, POINT_MAX)]).filter(([, v]) => v));
      if (Object.keys(settled).length) state.settled = settled; else delete state.settled;
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
 * Applies events and keeps the three in step: design.yaml, design.md, and the
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
  await writeDesign(root, idea.id, state);
  await writeDesignMd(root, idea, state);
  await saveDesignAnswers(root, idea.id, state);
  if (ticks.length) {
    const steps = await loadSteps(root);
    for (const t of [...new Set(ticks)]) await tick(root, idea.id, t, true, { by: 'app', source: DESIGN_FILE, clock, steps });
  }
  return { state, designMd: renderDesignMd(idea, state) };
}

/** Where the design questions' answers say they came from, on the idea. */
export const DESIGN_SOURCE = 'design questions';

/**
 * Every answered design question goes on the idea as an answer, at once and without asking: the decision, the tool
 * picker, the brief and later suggestions read them like any other. Kept in step with the design (a changed or removed
 * answer changes or leaves the idea too); "asked the team" is not an answer.
 */
export async function saveDesignAnswers(root: string, id: string, state: DesignState): Promise<void> {
  const idea = await loadIdea(root, id) as Idea & { answers?: { question: string; answer: string; source?: string }[] };
  const mine = state.steps.filter((s) => s.answer?.trim()).map((s) => ({ question: s.question, answer: s.answer!.trim(), source: DESIGN_SOURCE }));
  const others = (idea.answers ?? []).filter((a) => a.source !== DESIGN_SOURCE);
  const before = JSON.stringify((idea.answers ?? []).filter((a) => a.source === DESIGN_SOURCE));
  if (before === JSON.stringify(mine)) return;
  await saveIdea(root, { ...idea, answers: [...others, ...mine] } as Idea);
}

export const applyDesignEvent = (root: string, idea: Idea, event: DesignEvent, clock: Clock) =>
  applyDesignEvents(root, idea, [event], clock);

/**
 * The AI's input for the next question: the idea, the feature list, the one tool with its cons and the features it fits
 * only partly or not at all (what the questions should aim at), the answers so far and, when given, the "Learned since
 * the form" brief and the team's answers (already coded: see codedDesignInput).
 */
export function designStepInput(
  idea: Idea, state: DesignState, extra: { learned?: { topic: string; text: string }[]; teamAnswers?: { question: string; answer: string }[] } = {},
): DesignStepInput {
  const t = state.tool;
  return {
    idea: { id: idea.id, title: idea.title, challenge: idea.challenge, current_process: idea.current_process, outcomes: idea.outcomes },
    features: toolFeatures(state).map((f) => ({
      name: f.name, ...(f.what ? { what: f.what } : {}), ...(f.tool ? { tool: f.tool } : {}), ...(f.scope ? { scope: scopeWords(f.scope, t?.tool) } : {}),
    })),
    ...(t ? { tool: { tool: t.tool, pathway: t.pathway, cons: t.cons, gaps: t.fit.filter((x) => x.fit !== 'yes') } } : {}),
    ...(extra.learned?.length ? { learned: extra.learned } : {}),
    ...(extra.teamAnswers?.length ? { teamAnswers: extra.teamAnswers } : {}),
    stepsSoFar: state.steps.map((s) => ({ question: s.question, answer: s.answer?.trim() || ASKED_TEAM_ANSWER })),
    guidance: skillGuidance('cafe-design'),
  };
}

/**
 * designStepInput with the people coded the way the decision codes them (reviewInput): the idea text, the team's
 * answers, the "Learned since the form" brief and the design questions and answers so far. It also carries what the
 * updates are checked against (the form's participation, the flags, the graph). The codes come back so the AI's reply
 * can be decoded, and its proposed updates read (takeInAnswers).
 */
export async function codedDesignInput(root: string, idea: Idea, state: DesignState): Promise<{ input: DesignStepInput; codes: Map<string, Coded>; read: number }> {
  const brief = idea.learned?.points ?? [];
  const base = designStepInput(idea, state);
  // The brief and each step (its question, then its answer) ride in as extra answers, so their names get the same codes
  // as everything else; they come back out in the same order.
  const steps = base.stepsSoFar.flatMap((s) => [{ question: 'Q', answer: s.question }, { question: 'A', answer: s.answer }]);
  const { input: seen, codes } = await reviewInput(root, idea.id, [...brief.map((p) => ({ question: p.topic, answer: p.text })), ...steps], { skipSource: DESIGN_SOURCE });
  const all = seen.answers ?? [];
  const nTeam = all.length - brief.length - steps.length;
  const teamAnswers = all.slice(0, nTeam);
  const learned = all.slice(nTeam, nTeam + brief.length).map((a) => ({ topic: a.question, text: a.answer }));
  const coded = all.slice(nTeam + brief.length);
  const stepsSoFar = base.stepsSoFar.map((_, i) => ({ question: coded[2 * i].answer, answer: coded[2 * i + 1].answer }));
  const input: DesignStepInput = {
    ...base, idea: { ...base.idea, challenge: seen.idea.challenge, current_process: seen.idea.current_process },
    ...(learned.length ? { learned } : {}), ...(teamAnswers.length ? { teamAnswers } : {}), stepsSoFar,
    ...(seen.form?.participation ? { form: { participation: seen.form.participation } } : {}),
    ...(seen.flags ? { flags: seen.flags } : {}), ...(seen.graph ? { graph: seen.graph } : {}),
  };
  const read = teamAnswers.length + state.steps.filter((s) => s.answer?.trim()).length;
  return { input, codes, read };
}

/** The AI's reply with any person code turned back into the name. */
export function decodeStep(out: DesignStepOutput, codes: Map<string, Coded>): DesignStepOutput {
  const n = (t?: string) => (t === undefined ? t : showNames(t, codes));
  return {
    ...out, ...(out.question !== undefined ? { question: n(out.question) } : {}), ...(out.why !== undefined ? { why: n(out.why) } : {}),
    ...(out.summary !== undefined ? { summary: n(out.summary) } : {}), ...(out.suggested ? { suggested: out.suggested.map((x) => showNames(x, codes)) } : {}),
    ...(out.settled ? { settled: Object.fromEntries(Object.entries(out.settled).map(([k, v]) => [k, showNames(String(v), codes)])) } : {}),
    ...(out.features ? { features: out.features.map((f) => ({ ...f, ...(f.what ? { what: n(f.what) } : {}), ...(f.by ? { by: n(f.by) } : {}), ...(f.why ? { why: n(f.why) } : {}) })) } : {}),
  };
}

/**
 * The diagram AI's input: the design with the people coded the way the design questions code them (the summary, each
 * question and answer and each settled point ride in as extra answers, so their names get codes, then come back out).
 */
export async function codedDiagramInput(root: string, idea: Idea, state: DesignState): Promise<{ input: DesignDiagramInput; codes: Map<string, Coded> }> {
  const points = DESIGN_TAGS.map((t) => [t, pointOf(state, t) ?? ''] as const);
  const texts = [state.summary ?? '', ...state.steps.flatMap((s) => [s.question, s.answer?.trim() || ASKED_TEAM_ANSWER]), ...points.map(([, v]) => v)];
  const { input: seen, codes } = await reviewInput(root, idea.id, texts.map((answer) => ({ question: 'T', answer })), { skipSource: DESIGN_SOURCE });
  const all = (seen.answers ?? []).map((a) => a.answer);
  const tail = all.slice(all.length - texts.length);
  const t = state.tool;
  const fits = new Map((t?.fit ?? []).map((x) => [x.feature.toLowerCase(), x]));
  const outsideTools = [...new Set(state.features.filter((f) => f.scope?.status === 'outside').map((f) => f.scope!.by!))];
  return {
    codes,
    input: {
      idea: { id: idea.id, title: idea.title, challenge: seen.idea.challenge, current_process: seen.idea.current_process, outcomes: idea.outcomes },
      ...(tail[0] ? { summary: tail[0] } : {}),
      ...(t ? { tool: { tool: t.tool, pathway: t.pathway } } : {}),
      features: state.features.map((f) => {
        const x = fits.get(f.name.toLowerCase());
        return {
          name: f.name, ...(f.what ? { what: f.what } : {}), ...(x ? { fit: x.fit, ...(x.note ? { note: x.note } : {}) } : {}),
          ...(f.scope ? { scope: scopeWords(f.scope, t?.tool) } : {}),
        };
      }),
      steps: state.steps.map((s, i) => ({ n: s.n, question: tail[1 + 2 * i], answer: tail[2 + 2 * i], ...(s.tag ? { tag: s.tag } : {}) })),
      points: Object.fromEntries(points.map(([k], i) => [k, tail[1 + 2 * state.steps.length + i]]).filter(([, v]) => v)),
      outsideTools,
    },
  };
}

/**
 * Draws the design diagram with the AI: names coded on the way out and restored on the way back, the reply checked
 * against the design (checkDiagram), stored with the design it was drawn from. Throws when the AI fails; nothing changes.
 */
export async function drawDiagram(
  root: string, id: string, run: (input: DesignDiagramInput) => Promise<{ provider: string; output: DiagramSpec }>, clock: Clock,
): Promise<DesignState> {
  const idea = await loadIdea(root, id);
  const state = await readDesign(root, id);
  const { input, codes } = await codedDiagramInput(root, idea, state);
  const { provider, output } = await run(input);
  const n = (s: string | undefined) => (s === undefined ? s : showNames(s, codes));
  const decoded = {
    lanes: output.lanes.map((l) => ({ ...l, label: n(l.label) })),
    nodes: output.nodes.map((x) => ({ ...x, label: n(x.label), ...(x.detail ? { detail: n(x.detail) } : {}) })),
    edges: output.edges.map((e) => ({ ...e, ...(e.label ? { label: n(e.label) } : {}) })),
  };
  const spec = checkDiagram(decoded, state);
  // Read again: the design may have moved while the AI drew.
  const now = await readDesign(root, id);
  now.diagram = { spec, by: 'ai', at: clock(), provider, basis: basisOf(state) };
  await writeDesign(root, id, now);
  return now;
}

/** Refuses a new question while the last one is still open (one question at a time). */
export function assertNoOpenStep(state: DesignState): void {
  const open = state.steps.find(isOpen);
  if (open) throw new DesignError(`Answer question ${open.n} first, or say "I don't know"`);
}

/** The AI's reply as an event. */
export const stepEvent = (out: DesignStepOutput): DesignEvent => (out.done
  ? { t: 'done', summary: out.summary ?? '', ...(out.settled ? { settled: out.settled } : {}) }
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
 * The Import hook: answers the team sent back fill the design questions we asked them in an E2
 * (open steps with askedTeam whose question matches). Returns how many were filled. Never throws,
 * so the Import works the same with or without a design.
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
  // A tool that has left the approved list (an older record's UiPath) is not approved with the design: pick another first.
  const retired = retiredToolNote((await readDesign(root, id)).tool?.tool);
  if (retired) throw new DesignError(retired);
  const out = await applyDesignEvent(root, idea, { t: 'approve' }, clock);
  // Straight from the tool choice's flags (a custom app, a live system, personal data).
  const flags = csicFlags(out.state);
  const suggest = flags.length ? suggestion(await loadIdea(root, id), { closeAs: 'csic' }) : undefined;
  const notice = flags.length ? `Design approved. ${CSIC_NOTE} (${flags.join(', ')})` : 'Design approved.';
  return { ...out, notice, ...(suggest ? { suggest } : {}) };
}
