import { daysBetween, formatDate } from '../clock';
import type { Idea } from '../ideas/idea';
import type { StepDef } from '../rules/stages';

export interface Overdue {
  step: string;
  due: string;
  daysLate: number;
  text: string;
}

export function overdue(idea: Idea, steps: StepDef[], today: string): Overdue[] {
  if (idea.closed) return [];
  return Object.entries(idea.due).flatMap(([stepId, due]) => {
    if (idea.checklist[stepId]?.done || today <= due) return [];
    const step = steps.find((s) => s.id === stepId);
    const asked = idea.sent.E2R ? ['E2R', idea.sent.E2R] : idea.sent.E2 ? ['E2', idea.sent.E2] : undefined;
    const text = stepId === 's2d' && asked
      ? `${asked[0]} sent ${daysBetween(asked[1], today)} days ago · reply due ${formatDate(due)}`
      : `${step?.text ?? stepId} · due ${formatDate(due)}`;
    return [{ step: stepId, due, daysLate: daysBetween(due, today), text }];
  });
}

export const needsE2R = (list: Overdue[]) => list.some((o) => o.step === 's2d');
