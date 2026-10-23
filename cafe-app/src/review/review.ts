import path from 'node:path';
import { formatDate, type Clock } from '../clock';
import type { Decision, Idea, ReviewRecord } from '../ideas/idea';
import { loadIdea, saveIdea, ideaDir } from '../ideas/store';
import { writeFileAtomic, appendHistory } from '../workspace/files';
import { loadSettings } from '../round/store';
import type { Settings } from '../round/round';
import { withTick } from '../checklist/checklist';
import { suggestion, type StageTarget, type Suggest } from '../ideas/suggest';
import type { StepDef } from '../rules/stages';

export const CRITERIA = [
  { id: 'feasible', text: 'A proof of concept is feasible with approved tools and no live non-Microsoft system' },
  { id: 'builder', text: 'A builder is named and can attend' },
  { id: 'data', text: 'Synthetic, aggregated or sample data is enough' },
  { id: 'theme', text: 'It fits a theme or cohort' },
  { id: 'reuse', text: 'It could be reused beyond the submitting team' },
] as const;

export const DECISION_EMAIL: Record<Decision, string> = { select: 'E3', reuse: 'E4', csic: 'E5', notnow: 'E6', ask: 'E2' };

export const DECISION_LABELS: Record<Decision, string> = {
  select: 'Select for the design series (E3)',
  reuse: 'Reuse what exists (E4)',
  csic: 'Route to the CSIC Repository (E5)',
  notnow: 'Not this round (E6)',
  ask: 'Ask first (E2)',
};

/** The move each decision suggests. "Ask first" suggests none. */
export const DECISION_SUGGESTS: Record<Decision, StageTarget | undefined> = {
  select: { stage: 3 }, reuse: { closeAs: 'reuse' }, csic: { closeAs: 'csic' }, notnow: { closeAs: 'notnow' }, ask: undefined,
};

export interface ReviewInput {
  criteria?: Record<string, unknown>;
  decision?: unknown;
  reason?: unknown;
}

export interface ReviewResult {
  idea: Idea;
  warnings: string[];
  handoff?: string;
  suggest?: Suggest;
}

const NOT_IN_SUBMISSION = 'Not in the Café submission. Ask the team.';

export function renderReview(idea: Idea, r: ReviewRecord): string {
  return [
    `# Review: ${idea.id} ${idea.title}`, '',
    `Date: ${r.at}`, '',
    '## Criteria', '',
    ...CRITERIA.map((c) => `- [${r.criteria[c.id] ? 'x' : ' '}] ${c.text}`), '',
    '## Decision', '', DECISION_LABELS[r.decision], '',
    '## Reason', '', r.reason, '',
  ].join('\n');
}

export function renderHandoff(idea: Idea, settings: Settings): string {
  const sponsor = idea.people.team.find((p) => p.roles.includes('sponsor'));
  const field = (title: string, value: string | undefined, source: string) => {
    const v = value?.trim();
    return [`## ${title}`, '', v || NOT_IN_SUBMISSION, '', `Source: ${v ? source : 'none'}`, ''];
  };
  return [
    `# CSIC Repository intake draft: ${idea.title}`, '',
    `From Creators' Café idea ${idea.id}. Every field says where it came from. Check each one before you paste it into the intake form: ${settings.csicLink?.trim() || '[CSIC REPOSITORY INTAKE LINK]'}`, '',
    ...field('Opportunity description', idea.challenge, 'form, Business Challenge'),
    ...field('Current process', idea.current_process, 'form, Current Process'),
    ...field('Who would use it', undefined, ''),
    ...field(
      'Sponsor',
      sponsor
        ? `${sponsor.name}, named as sponsor in Team Members and Lead. MD status: not confirmed.`
        : 'No sponsor named in the form. The CSIC Repository needs an MD sponsor who has agreed.',
      'form, Team Members and Lead',
    ),
    ...field('Expected change (no figures)', idea.outcomes.join('; '), 'form, Desired Outcomes'),
    ...field('Systems and data', undefined, ''),
    '## Café history', '',
    ...(idea.source ? [`- Submitted: ${idea.source.file}, row ${idea.source.row}`] : []),
    ...(idea.review ? [`- ${idea.review.at}: reviewed and routed to the CSIC Repository. Reason: ${idea.review.reason}`] : []),
    '',
    '## Follow up', '',
    `On ${idea.closed?.followUp ? formatDate(idea.closed.followUp) : '[FOLLOW-UP DATE]'}: did it reach the CSIC Repository?`, '',
  ].join('\n');
}

export async function saveReview(
  root: string, id: string, input: ReviewInput, ctx: { clock: Clock; steps: StepDef[] },
): Promise<ReviewResult> {
  const decision = input.decision as Decision;
  if (typeof decision !== 'string' || !Object.hasOwn(DECISION_EMAIL, decision)) throw new Error('Pick a decision');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new Error('Give a reason for the decision');

  // Saving writes the decision only: its email is sent later, from the idea's ✉ Emails menu.
  let idea = await loadIdea(root, id);
  if (idea.closed) throw new Error(`${id} is closed. Reopen it first (set its stage)`);
  const today = ctx.clock();
  const dir = await ideaDir(root, id);
  const criteria = Object.fromEntries(CRITERIA.map((c) => [c.id, input.criteria?.[c.id] === true]));
  const review: ReviewRecord = { criteria, decision, reason, at: today };
  idea = { ...idea, review };
  const warnings: string[] = [];

  const s2a = ctx.steps.find((s) => s.id === 's2a');
  const ticksS2a = decision !== 'ask' && Boolean(s2a) && !idea.checklist.s2a?.done;
  if (ticksS2a && s2a) idea = withTick(idea, s2a, true, 'operator', today, 'review.md');

  // A review never moves or closes the idea; it only suggests the move.
  const handoff = decision === 'csic' ? path.join(dir, 'csic-handoff.md') : undefined;
  const suggest = suggestion(idea, DECISION_SUGGESTS[decision]);
  const settings = await loadSettings(root);

  if (handoff) await writeFileAtomic(handoff, renderHandoff(idea, settings));
  await writeFileAtomic(path.join(dir, 'review.md'), renderReview(idea, review));
  await saveIdea(root, idea);
  if (ticksS2a) await appendHistory(dir, { at: today, action: 'tick', by: 'operator', step: 's2a', source: 'review.md' });
  await appendHistory(dir, { at: today, action: 'review', by: 'operator', detail: `${decision}: ${reason}`, source: 'review.md' });
  return { idea, warnings, ...(handoff ? { handoff } : {}), ...(suggest ? { suggest } : {}) };
}
