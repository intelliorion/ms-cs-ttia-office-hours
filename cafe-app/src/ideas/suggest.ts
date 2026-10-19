import { CLOSURE_LABELS, type Closure, type Idea } from './idea';
import { STAGE_NAMES, type StageNo } from '../rules/stages';

/** Where the operator can put an idea: one of the four stages (which reopens it), or closed one way. */
export type StageTarget = { stage: StageNo } | { closeAs: Closure };

/** A move the app offers after a review or a sent email. The operator says yes or no; it is never applied on its own. */
export type Suggest = StageTarget & { label: string };

/** Plain words for where an idea is: a stage name, or "Closed · <how>". */
export function whereLabel(idea: Pick<Idea, 'stage' | 'closed'>): string {
  return idea.closed ? `Closed · ${CLOSURE_LABELS[idea.closed.as]}` : STAGE_NAMES[idea.stage];
}

/** True when moving to the target would change the idea. */
export function changes(idea: Pick<Idea, 'stage' | 'closed'>, target: StageTarget): boolean {
  if ('closeAs' in target) return idea.closed?.as !== target.closeAs;
  return Boolean(idea.closed) || idea.stage !== target.stage;
}

/** The suggestion for a target, or undefined when the idea is already there. */
export function suggestion(idea: Pick<Idea, 'stage' | 'closed'>, target: StageTarget | undefined): Suggest | undefined {
  if (!target || !changes(idea, target)) return undefined;
  return 'closeAs' in target
    ? { closeAs: target.closeAs, label: `Close it as ${CLOSURE_LABELS[target.closeAs]}?` }
    : { stage: target.stage, label: `Move it to ${STAGE_NAMES[target.stage]}?` };
}
