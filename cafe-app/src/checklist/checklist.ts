import { CLOSURE_LABELS, type Closure, type Idea } from '../ideas/idea';
import { STAGE_NAMES, type StageNo, type StepDef } from '../rules/stages';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import type { Clock } from '../clock';

export type StepStatus = 'done' | 'open' | 'n/a';

export function stepStatus(idea: Idea, step: StepDef): StepStatus {
  if (idea.checklist[step.id]?.done) return 'done';
  if (idea.closed && step.stage > idea.stage) return 'n/a';
  return 'open';
}

export function progress(idea: Idea, steps: StepDef[]): { done: number; total: number; label: string } {
  const applicable = steps.filter((s) => stepStatus(idea, s) !== 'n/a');
  const done = applicable.filter((s) => stepStatus(idea, s) === 'done').length;
  const where = idea.closed ? `Closed · ${CLOSURE_LABELS[idea.closed.as]}` : STAGE_NAMES[idea.stage];
  return { done, total: applicable.length, label: `${where} · ${done} of ${applicable.length}` };
}

export function missingToAdvance(idea: Idea, steps: StepDef[]): StepDef[] {
  return steps.filter((s) => s.stage === idea.stage && s.needed && !idea.checklist[s.id]?.done);
}

export function withTick(
  idea: Idea, step: StepDef, done: boolean, by: 'operator' | 'app', at: string, source?: string,
): Idea {
  const state = source ? { done, by, at, source } : { done, by, at };
  return { ...idea, checklist: { ...idea.checklist, [step.id]: state } };
}

export async function tick(
  root: string, id: string, stepId: string, done: boolean,
  opts: { by: 'operator' | 'app'; source?: string; clock: Clock; steps: StepDef[] },
): Promise<Idea> {
  const step = opts.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Unknown step ${stepId}`);
  const idea = await loadIdea(root, id);
  if (Boolean(idea.checklist[stepId]?.done) === done) return idea;
  const at = opts.clock();
  const next = withTick(idea, step, done, opts.by, at, opts.source);
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, id), {
    at, action: done ? 'tick' : 'untick', by: opts.by, step: stepId, ...(opts.source ? { source: opts.source } : {}),
  });
  return next;
}

export async function advance(root: string, id: string, steps: StepDef[], clock: Clock): Promise<Idea> {
  const idea = await loadIdea(root, id);
  if (idea.closed) throw new Error(`${id} is closed (${CLOSURE_LABELS[idea.closed.as]})`);
  if (idea.stage === 4) throw new Error(`${id} is already at the last stage`);
  const target = (idea.stage + 1) as StageNo;
  const missing = missingToAdvance(idea, steps);
  if (missing.length) {
    throw new Error(`Still needed before ${STAGE_NAMES[target]}: ${missing.map((s) => s.text).join('; ')}`);
  }
  const next: Idea = { ...idea, stage: target };
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, id), { at: clock(), action: 'advance', by: 'operator', detail: STAGE_NAMES[target] });
  return next;
}

export async function closeIdea(root: string, id: string, as: Closure, clock: Clock, followUp?: string): Promise<Idea> {
  const idea = await loadIdea(root, id);
  const at = clock();
  const next: Idea = { ...idea, closed: followUp ? { as, at, followUp } : { as, at } };
  await saveIdea(root, next);
  await appendHistory(await ideaDir(root, id), { at, action: 'close', by: 'operator', detail: CLOSURE_LABELS[as] });
  return next;
}
