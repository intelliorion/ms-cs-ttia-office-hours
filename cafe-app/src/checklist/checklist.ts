import type { Idea } from '../ideas/idea';
import type { StepDef } from '../rules/stages';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { appendHistory } from '../workspace/files';
import type { Clock } from '../clock';

// Steps are a quiet background log: they tick themselves (or via Reply received) and are never shown as a
// checklist, and they never gate a stage change. See src/ideas/stage.ts for how the stage is set.

export type StepStatus = 'done' | 'open' | 'n/a';

export function stepStatus(idea: Idea, step: StepDef): StepStatus {
  if (idea.checklist[step.id]?.done) return 'done';
  if (idea.closed && step.stage > idea.stage) return 'n/a';
  return 'open';
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
