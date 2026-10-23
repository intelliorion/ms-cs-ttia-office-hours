import { DECISION_EMAIL } from '../popouts/ideaHelpers';

/** What the notice says once an email went to Outlook. */
export const openedText = (template: string) =>
  `${template} is open in Outlook: check it and send. It counts as sent.`;

/**
 * The emails the Email menu offers for an idea: its current stage's emails (from the steps), without the ones
 * the stage's own buttons make (the questions, the decision), plus the reminder when it is due.
 */
export function stageEmails(idea: any, steps: any[]): string[] {
  const own = new Set(['E2']);
  const out = steps.filter((s) => s.stage === idea.stage && s.email && s.email !== 'decision' && !own.has(s.email)).map((s) => s.email as string);
  // The saved decision's email (E3 to E6) is sent from here, when you are ready; Save decision sends nothing.
  const decided = idea.review?.decision && idea.review.decision !== 'ask' ? DECISION_EMAIL[idea.review.decision] : undefined;
  if (decided && !idea.closed && idea.stage === 2) out.push(decided);
  if (idea.offerE2R) out.push('E2R');
  return [...new Set(out)];
}

/** An idea's emails drafted but not sent yet (one per stage at most): what the Email menu offers to send. */
export function unsentFor(idea: any, outbox: any[] = []): { template: string; key: string }[] {
  return outbox.filter((m) => m.idea === idea.id && m.status !== 'sent' && !m.superseded).map((m) => ({ template: m.template, key: m.key }));
}
